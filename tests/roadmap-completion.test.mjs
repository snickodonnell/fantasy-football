import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  databaseMaintenanceGuidance,
  exportLeagueData,
  familyEngagement,
  finalizationChecklist,
  initialDb,
  mockedProviderFixtures,
  rateLimit,
  realisticLeagueFixture,
  researchDecisionTools,
  rosterHealthScore,
  runMigrations,
  schemaMigrationStatus,
  syncProviderDemoMode,
  targetedPersistenceAudit,
  tradeFairnessSummary,
  transactionSafetyReport,
  updateLeagueRepository,
  validateCompletedWeekAgainstSheet,
  validateLeagueRules,
  weeklyOperations
} from "../server.js";

test("league rule validation covers scoring, roster, FAAB, trade, and playoffs", () => {
  const db = initialDb();
  const invalid = validateLeagueRules({ ...db.league, roster: { starters: [] }, waiver: { mode: "faab", budget: 0 }, playoffs: { teams: 1 }, scoring: { passTd: "x" } });

  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => item.includes("starting roster")));
  assert.ok(invalid.errors.some((item) => item.includes("FAAB")));
  assert.ok(invalid.errors.some((item) => item.includes("playoff")));

  const updated = updateLeagueRepository(db, {
    waiver: { mode: "faab", budget: 150 },
    trade: { deadline: "Week 12", playoffRosterLock: "Locked at playoffs" },
    playoffs: { teams: 4, consolationTeams: 2, format: "custom" },
    roster: { starters: db.league.roster.starters, bench: 6, ir: 2, template: "family" },
    settings: { maxRosterSize: 15 },
    scoring: { passTd: 4 }
  });

  assert.equal(updated.ok, true);
  assert.equal(db.league.waiver.mode, "faab");
  assert.equal(db.league.trade.deadline, "Week 12");
});

test("weekly operations produce previews, waiver schedule, lock countdowns, and finalization checks", () => {
  const db = initialDb();
  const weekly = weeklyOperations(db);

  assert.ok(weekly.matchupPreviews.length > 0);
  assert.ok(weekly.lineupLockCountdowns.length === db.teams.length);
  assert.equal(weekly.waiverSchedule.mode, db.league.waiver.mode);
  assert.ok(finalizationChecklist(db).some((item) => item.id === "stats"));
});

test("family engagement and research tools summarize the league", () => {
  const db = initialDb();
  const user = db.users[0];
  const family = familyEngagement(db);
  const research = researchDecisionTools(db, user);

  assert.ok(family.recaps.length > 0);
  assert.ok(family.awards.length > 0);
  assert.ok(research.startSit.length > 0);
  assert.ok(rosterHealthScore(db, "t1").score <= 100);
});

test("trade fairness summarizes offer value deltas", () => {
  const db = initialDb();
  const trade = { id: "tr-test", offeredPlayerIds: ["p1"], requestedPlayerIds: ["p16"] };
  const summary = tradeFairnessSummary(db, trade);

  assert.equal(summary.tradeId, "tr-test");
  assert.equal(summary.label, "Balanced");
});

test("fixtures support realistic league states and provider edge cases", () => {
  const fixture = realisticLeagueFixture();
  const provider = mockedProviderFixtures();

  assert.equal(fixture.meta.currentWeek, 8);
  assert.ok(fixture.matchups.length > 0);
  assert.ok(provider.liveWeek.length > 0);
  assert.ok(provider.missingPlayers.some((item) => item.appPlayerId === null));
});

test("export omits reset secrets while preserving restorable data", () => {
  const db = initialDb();
  db.meta.passwordResets = [{ tokenHash: "secret" }];
  const exported = exportLeagueData(db);

  assert.deepEqual(exported.meta.passwordResets, []);
  assert.equal(exported.teams.length, db.teams.length);
});

test("rate limiting blocks repeated login attempts", () => {
  const req = { headers: {}, socket: { remoteAddress: "203.0.113.99" } };
  const url = new URL("http://local/api/login");
  const res = { status: 0, writeHead(status) { this.status = status; }, end() {} };

  for (let i = 0; i < 12; i++) assert.equal(rateLimit(req, res, url), true);
  assert.equal(rateLimit(req, res, url), false);
  assert.equal(res.status, 429);
});

test("schema migrations are versioned and inspectable", () => {
  const sqlite = new DatabaseSync(":memory:");
  runMigrations(sqlite);
  const status = schemaMigrationStatus(sqlite);
  sqlite.close();

  assert.ok(status.currentVersion >= 3);
  assert.ok(status.migrations.length >= 3);
});

test("third-pass persistence audit identifies high-risk repositories and maintenance guidance", () => {
  const db = initialDb();
  const audit = targetedPersistenceAudit(db);
  const safety = transactionSafetyReport(db);
  const guidance = databaseMaintenanceGuidance();

  assert.ok(audit.highRiskAreas.includes("draft"));
  assert.ok(safety.some((item) => item.area === "restore" && item.ok));
  assert.ok(guidance.some((item) => item.includes("backups")));
});

test("provider demo mode exposes unavailable and delayed scenarios without network", () => {
  const db = initialDb();
  db.meta.providerDemoMode = true;
  db.meta.providerDemoScenario = "delayed";
  const result = syncProviderDemoMode(db);

  assert.equal(result.provider, "demo");
  assert.match(result.message, /delayed/i);
  assert.ok(result.details.fixtures.delayedStats.length > 0);
});

test("completed-week score validation compares processed scores to a hand sheet", () => {
  const db = initialDb();
  const season = db.meta.season;
  const week = db.meta.currentWeek;
  const matchup = db.matchups[0];
  const expected = validateCompletedWeekAgainstSheet(db, season, week, [{ matchupId: matchup.id, homeScore: 999, awayScore: 999 }]);

  assert.equal(expected.ok, false);
  assert.ok(expected.mismatches.length > 0);
});
