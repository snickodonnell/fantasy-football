import test from "node:test";
import assert from "node:assert/strict";
import {
  ingestReliableWeeklyStats,
  mapEspnStatLine,
  normalizeEspnSummaryStats
} from "../server.js";

function makeDb() {
  return {
    meta: { season: 2025, currentWeek: 1 },
    league: { scoring: { passYards: 0.04, passTd: 4, interception: -1, rushYards: 0.1, rushTd: 6, reception: 0.5, receivingYards: 0.1, receivingTd: 6 } },
    players: [
      { id: "slp-100", name: "Test Quarterback", position: "QB", nflTeam: "BUF" },
      { id: "p-rb", name: "Test Runner", position: "RB", nflTeam: "BUF" }
    ],
    providerPlayers: [{ provider: "sleeper", providerId: "100", name: "Test Quarterback", team: "BUF" }],
    weeklyPlayerStats: [],
    lineups: { t1: { QB: "slp-100", RB: "p-rb" } },
    providerSync: { provider: "test", lastRunAt: null, message: "", details: {} }
  };
}

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("reliable ingest keeps healthy Sleeper rows as the primary source", async (t) => {
  const db = makeDb();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    assert.match(String(url), /api\.sleeper\.com/);
    return jsonResponse({ 100: { pass_yd: 250, pass_td: 2, pass_int: 1 } });
  };

  const result = await ingestReliableWeeklyStats(db, 2025, 1, "actual");

  assert.equal(result.provider, "sleeper");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.health.status, "healthy");
  assert.equal(db.weeklyPlayerStats.length, 1);
  assert.equal(db.weeklyPlayerStats[0].appPlayerId, "slp-100");
  assert.equal(db.weeklyPlayerStats[0].fantasyPoints, 17);
});

test("reliable ingest falls back to ESPN when Sleeper returns no usable rows", async (t) => {
  const db = makeDb();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("api.sleeper.com")) return jsonResponse({});
    if (href.includes("/scoreboard")) return jsonResponse({ events: [{ id: "401" }] });
    if (href.includes("/summary")) {
      return jsonResponse({
        boxscore: {
          players: [{
            team: { abbreviation: "BUF" },
            statistics: [
              { name: "passing", labels: ["C/ATT", "YDS", "TD", "INT"], athletes: [{ athlete: { id: "espn-qb", displayName: "Test Quarterback" }, stats: ["20/30", "300", "3", "0"] }] },
              { name: "rushing", labels: ["CAR", "YDS", "TD"], athletes: [{ athlete: { id: "espn-rb", displayName: "Test Runner" }, stats: ["15", "82", "1"] }] }
            ]
          }]
        }
      });
    }
    throw new Error(`Unexpected URL ${href}`);
  };

  const result = await ingestReliableWeeklyStats(db, 2025, 1, "actual");

  assert.equal(result.provider, "espn");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.health.status, "fallback");
  assert.equal(db.weeklyPlayerStats.length, 2);
  assert.deepEqual(db.weeklyPlayerStats.map((row) => row.appPlayerId).sort(), ["p-rb", "slp-100"]);
  assert.equal(db.providerSync.details.scoring.fallback.validation.mappedStarters, 2);
});

test("ESPN stat mapper translates common boxscore categories into scoring keys", () => {
  assert.deepEqual(mapEspnStatLine("passing", ["C/ATT", "YDS", "TD", "INT"], ["18/24", "244", "2", "1"]), { pass_yd: 244, pass_td: 2, pass_int: 1 });
  assert.deepEqual(mapEspnStatLine("receiving", ["REC", "YDS", "TD"], ["7", "101", "1"]), { rec: 7, rec_yd: 101, rec_td: 1 });
});

test("ESPN summary normalizer matches athletes by local name and team", () => {
  const db = makeDb();
  const rows = normalizeEspnSummaryStats({
    boxscore: {
      players: [{
        team: { abbreviation: "BUF" },
        statistics: [{ name: "rushing", labels: ["CAR", "YDS", "TD"], athletes: [{ athlete: { id: "espn-rb", displayName: "Test Runner" }, stats: ["9", "45", "0"] }] }]
      }]
    }
  }, db);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].appPlayerId, "p-rb");
  assert.deepEqual(rows[0].stats, { rush_yd: 45, rush_td: 0 });
});
