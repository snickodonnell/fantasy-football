import test from "node:test";
import assert from "node:assert/strict";
import {
  dataQualityReport,
  dryRunPreview,
  importManualWeeklyStats,
  initialDb,
  mergePlayers,
  providerSettings,
  readinessChecklist,
  repairOrphanReferences
} from "../server.js";

test("data quality report summarizes duplicates and invalid references", () => {
  const db = initialDb();
  db.players.push({ ...db.players[0], id: "dup-qb", ownership: null });
  db.lineups.t1.BAD = "missing-player";

  const report = dataQualityReport(db);

  assert.equal(report.ok, false);
  assert.equal(report.summary.duplicates, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("missing player")));
});

test("orphan repair removes invalid lineup refs and ownership", () => {
  const db = initialDb();
  db.players[0].ownership = "missing-team";
  db.lineups.t1.BAD = "missing-player";

  const result = repairOrphanReferences(db);

  assert.equal(result.repaired, 2);
  assert.equal(db.players[0].ownership, null);
  assert.equal(db.lineups.t1.BAD, undefined);
});

test("merge players rewrites lineup references and removes source", () => {
  const db = initialDb();
  db.players.push({ ...db.players[0], id: "source-player", ownership: "t1", projection: 99 });
  db.lineups.t1.QB = "source-player";

  const result = mergePlayers(db, "source-player", "p1");

  assert.equal(result.error, undefined);
  assert.equal(db.lineups.t1.QB, "p1");
  assert.equal(db.players.some((player) => player.id === "source-player"), false);
  assert.equal(db.players.find((player) => player.id === "p1").projection, 99);
});

test("readiness checklist reflects phase-specific checks", () => {
  const db = initialDb();
  db.meta.seasonPhase = "draft";
  db.league.draft.order = [];

  const checklist = readinessChecklist(db, "draft");

  assert.ok(checklist.checks.some((check) => check.id === "draft-order" && check.ok));
  assert.ok(checklist.checks.find((check) => check.id === "draft-order").detail.includes("/"));
});

test("dry-run phase preview reports playoff bracket side effect", () => {
  const db = initialDb();
  delete db.league.playoffs.bracket;

  const preview = dryRunPreview(db, "phase", { phase: "playoffs" });

  assert.equal(preview.type, "phase");
  assert.ok(preview.effects.some((effect) => effect.includes("Playoff bracket")));
});

test("dry-run import preview reports assignment counts without mutating source db", () => {
  const db = initialDb();
  const before = db.players.find((player) => player.id === "p22").ownership;

  const preview = dryRunPreview(db, "import", { csv: "team,player\nNick's Team,Lamar Jackson", mode: "rosters" });

  assert.equal(preview.effects[0], "1 assignment(s), 0 skipped.");
  assert.equal(db.players.find((player) => player.id === "p22").ownership, before);
});

test("dry-run correction preview describes the scoring change", () => {
  const db = initialDb();
  const preview = dryRunPreview(db, "correction", { teamId: "t1", pointsDelta: 2.5, week: 6 });

  assert.ok(preview.effects[0].includes("2.5 points"));
  assert.ok(preview.effects[0].includes("Nick's Team"));
});

test("manual weekly stats import stores fantasy points", () => {
  const db = initialDb();

  const result = importManualWeeklyStats(db, "player,fantasyPoints\nJosh Allen,31.2", { season: 2026, week: 6, statType: "actual" });

  assert.equal(result.imported, 1);
  const stat = db.weeklyPlayerStats.find((item) => item.id === "manual-2026-6-actual-p1");
  assert.equal(stat.fantasyPoints, 31.2);
  assert.equal(db.providerSync.details.scoring.primary.provider, "manual");
});

test("provider settings have conservative defaults", () => {
  const settings = providerSettings(initialDb());

  assert.equal(settings.refreshCadenceMinutes, 120);
  assert.equal(settings.scoringRefreshCadenceMinutes, 15);
  assert.equal(settings.cacheSnapshots, true);
});
