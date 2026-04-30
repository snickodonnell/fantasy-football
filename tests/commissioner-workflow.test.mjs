import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupDuplicatePlayers,
  dataQualityReport,
  dryRunPreview,
  importManualWeeklyStats,
  initialDb,
  launchReadinessChecklist,
  liveOpsReadiness,
  markLoadedTableFingerprints,
  mergePlayers,
  playerSyncPlan,
  playerSyncServiceState,
  providerSettings,
  readinessChecklist,
  rehearsalChecklist,
  repairOrphanReferences,
  runSmartPlayerSyncStep,
  setupReview,
  unchangedProviderTables
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

test("duplicate player cleanup keeps the rostered canonical player", () => {
  const db = initialDb();
  db.players.push({ ...db.players[0], id: "slp-duplicate", ownership: null, projection: 5 });
  db.weeklyPlayerStats.push({ id: "stat-dup", appPlayerId: "slp-duplicate", season: 2026, week: 6, statType: "actual", fantasyPoints: 12 });

  const result = cleanupDuplicatePlayers(db);

  assert.equal(result.merged, 1);
  assert.equal(result.after, 0);
  assert.equal(db.players.some((player) => player.id === "slp-duplicate"), false);
  assert.equal(db.weeklyPlayerStats.find((item) => item.id === "stat-dup").appPlayerId, "p1");
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
  assert.equal(settings.playerSyncIntervalSeconds, 13);
  assert.equal(settings.cacheSnapshots, true);
});

test("launch readiness checklist flags seeded passwords as blockers", () => {
  const db = initialDb();

  const readiness = launchReadinessChecklist(db);

  assert.equal(readiness.ready, false);
  assert.ok(readiness.summary.blockers >= 1);
  assert.equal(readiness.checks.find((check) => check.id === "accounts").status, "blocker");
  assert.equal(readiness.checks.find((check) => check.id === "accounts").target.view, "settings");
});

test("rehearsal setup and live ops readiness expose actionable pre-manual checks", () => {
  const db = initialDb();
  const rehearsal = rehearsalChecklist(db);
  const setup = setupReview(db);
  const live = liveOpsReadiness(db);

  assert.ok(rehearsal.steps.some((step) => step.id === "scoring"));
  assert.equal(setup.users.total, db.users.length);
  assert.ok(Array.isArray(setup.impossible));
  assert.ok(live.checks.some((check) => check.id === "schedule-window"));
});

test("smart player sync plans game-day stats and free-tier catalog paging", () => {
  const db = initialDb();
  const now = Date.parse("2026-10-04T18:00:00.000Z");
  db.nflTeams = Array.from({ length: 32 }, (_, index) => ({ id: `team-${index}`, provider: "balldontlie", providerId: String(index), abbreviation: `T${index}` }));
  db.nflGames = [{ id: "g-live", provider: "balldontlie", providerId: "1", season: 2026, week: db.meta.currentWeek, status: "in_progress", date: new Date(now - 30 * 60000).toISOString() }];
  db.meta.playerSyncService = { enabled: true, intervalSeconds: 13, lastBdlAt: new Date(now - 14 * 1000).toISOString(), lastScoringAt: new Date(now - 120 * 1000).toISOString() };

  const plan = playerSyncPlan(db, now);

  assert.equal(playerSyncServiceState(db).enabled, true);
  assert.equal(plan.schedule.mode, "live");
  assert.ok(plan.actions.includes("balldontlie-catalog-page"));
  assert.ok(plan.actions.includes("weekly-actual-stats"));
  assert.equal(plan.freeRateLimits.balldontliePerMinute, 5);
});

test("smart player sync step imports a balldontlie player page when switch is on", async (t) => {
  const db = initialDb();
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  db.nflTeams = Array.from({ length: 32 }, (_, index) => ({ id: `team-${index}`, provider: "balldontlie", providerId: String(index), abbreviation: `T${index}` }));
  db.nflGames = [{ id: "g1", provider: "balldontlie", providerId: "1", season: 2026, week: db.meta.currentWeek, status: "scheduled", date: new Date(now + 86400000).toISOString() }];
  db.providerSync.nextPlayerCursor = "stale-provider-cursor";
  db.providerPlayers = [{ provider: "sleeper", providerId: "cached", name: "Cached Player", team: "BUF", syncedAt: new Date(now).toISOString() }];
  db.providerTrending = [{ id: "trend-cached", provider: "sleeper", providerId: "cached", trendType: "add", count: 1, syncedAt: new Date(now).toISOString() }];
  db.meta.playerSyncService = { enabled: true, intervalSeconds: 13, lastBdlAt: new Date(now - 14000).toISOString(), lastSleeperPlayersAt: new Date(now).toISOString(), lastSleeperTrendingAt: new Date(now).toISOString() };
  const originalFetch = global.fetch;
  const originalKey = process.env.BALLDONTLIE_API_KEY;
  process.env.BALLDONTLIE_API_KEY = "test-key";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BALLDONTLIE_API_KEY;
    else process.env.BALLDONTLIE_API_KEY = originalKey;
  });
  global.fetch = async (url) => {
    assert.ok(String(url).includes("/players?per_page=100"));
    return {
      ok: true,
      json: async () => ({
        data: [{ id: 987, first_name: "Switchy", last_name: "McPlayer", position_abbreviation: "WR", team: { abbreviation: "BUF" } }],
        meta: { next_cursor: 988 }
      })
    };
  };

  const result = await runSmartPlayerSyncStep(db, { now });

  assert.equal(result.runCount, 1);
  assert.equal(result.bdlNextPlayerCursor, "988");
  assert.ok(db.players.some((player) => player.id === "bdl-987" && player.name === "Switchy McPlayer"));
});

test("smart player sync clears the player cursor when catalog paging completes", async (t) => {
  const db = initialDb();
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  db.nflTeams = Array.from({ length: 32 }, (_, index) => ({ id: `team-${index}`, provider: "balldontlie", providerId: String(index), abbreviation: `T${index}` }));
  db.nflGames = [{ id: "g1", provider: "balldontlie", providerId: "1", season: 2026, week: db.meta.currentWeek, status: "scheduled", date: new Date(now + 86400000).toISOString() }];
  db.providerSync.nextPlayerCursor = "stale-provider-cursor";
  db.providerPlayers = [{ provider: "sleeper", providerId: "cached", name: "Cached Player", team: "BUF", syncedAt: new Date(now).toISOString() }];
  db.providerTrending = [{ id: "trend-cached", provider: "sleeper", providerId: "cached", trendType: "add", count: 1, syncedAt: new Date(now).toISOString() }];
  db.meta.playerSyncService = { enabled: true, intervalSeconds: 13, bdlNextPlayerCursor: "last-page", lastBdlAt: new Date(now - 14000).toISOString(), lastSleeperPlayersAt: new Date(now).toISOString(), lastSleeperTrendingAt: new Date(now).toISOString() };
  const originalFetch = global.fetch;
  const originalKey = process.env.BALLDONTLIE_API_KEY;
  process.env.BALLDONTLIE_API_KEY = "test-key";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BALLDONTLIE_API_KEY;
    else process.env.BALLDONTLIE_API_KEY = originalKey;
  });
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{ id: 988, first_name: "Final", last_name: "Page", position_abbreviation: "RB", team: { abbreviation: "DAL" } }],
      meta: { next_cursor: null }
    })
  });

  const result = await runSmartPlayerSyncStep(db, { now });

  assert.equal(result.bdlNextPlayerCursor, null);
  assert.ok(result.bdlPlayersCompleteAt);
  assert.ok(db.players.some((player) => player.id === "bdl-988" && player.name === "Final Page"));
});

test("unchanged provider sync tables can be preserved during normal league saves", () => {
  const db = initialDb();
  db.providerPlayers = [{ id: "sleeper-1", provider: "sleeper", providerId: "1", name: "Cached Player", syncedAt: "2026-10-05T12:00:00.000Z" }];
  db.providerTrending = [{ id: "trend-1", provider: "sleeper", providerId: "1", trendType: "add", count: 3, syncedAt: "2026-10-05T12:00:00.000Z" }];
  db.nflTeams = [{ id: "team-1", provider: "balldontlie", providerId: "1", abbreviation: "BUF", syncedAt: "2026-10-05T12:00:00.000Z" }];
  markLoadedTableFingerprints(db);

  db.players[0].projection = 42;
  const unchanged = unchangedProviderTables(db);

  assert.ok(unchanged.has("provider_players"));
  assert.ok(unchanged.has("provider_trending"));
  assert.ok(unchanged.has("nfl_teams"));

  db.providerTrending[0].count = 4;
  assert.equal(unchangedProviderTables(db).has("provider_trending"), false);
});
