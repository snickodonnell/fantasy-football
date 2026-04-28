import test from "node:test";
import assert from "node:assert/strict";
import {
  csrfTokenForSession,
  hasSeededPassword,
  importRosterCsv,
  initialDb,
  makeUser,
  parseCsv,
  validateDbReferences
} from "../server.js";

test("csrf token is stable for a session and unique per session", () => {
  const first = csrfTokenForSession("session-a");
  const repeat = csrfTokenForSession("session-a");
  const second = csrfTokenForSession("session-b");

  assert.equal(first, repeat);
  assert.notEqual(first, second);
  assert.equal(first.length, 64);
});

test("seeded password detection flags default local accounts only", () => {
  const seeded = makeUser("u-test-1", "seeded", "Seeded", "manager", "password");
  const changed = makeUser("u-test-2", "changed", "Changed", "manager", "better-password");

  assert.equal(hasSeededPassword(seeded), true);
  assert.equal(hasSeededPassword(changed), false);
});

test("csv parser supports quoted commas and escaped quotes", () => {
  const rows = parseCsv('team,player,note\n"The Andersons","Doe, John","Says ""go"""');

  assert.deepEqual(rows, [
    ["team", "player", "note"],
    ["The Andersons", "Doe, John", 'Says "go"']
  ]);
});

test("roster csv import assigns players by team and player name", () => {
  const db = initialDb();
  const player = db.players.find((item) => item.id === "p22");
  player.ownership = null;

  const result = importRosterCsv(db, "team,player\nNick's Team,Lamar Jackson");

  assert.equal(result.assigned, 1);
  assert.equal(result.skipped, 0);
  assert.equal(player.ownership, "t1");
});

test("draft csv import records draft picks while assigning rosters", () => {
  const db = initialDb();
  const player = db.players.find((item) => item.id === "p23");
  player.ownership = null;

  const result = importRosterCsv(db, "team,player,round,pick\nEmily's Team,Puka Nacua,2,9", "draft");

  assert.equal(result.assigned, 1);
  assert.equal(player.ownership, "t2");
  assert.equal(db.league.draft.picks.at(-1).playerId, "p23");
  assert.equal(db.league.draft.picks.at(-1).round, 2);
});

test("reference validator catches orphaned lineups and missing ownership", () => {
  const db = initialDb();
  db.players[0].ownership = "missing-team";
  db.lineups.t1.QB = "missing-player";

  const result = validateDbReferences(db);

  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((warning) => warning.includes("missing owning team")));
  assert.ok(result.warnings.some((warning) => warning.includes("missing player")));
});

test("reference validator accepts seeded database", () => {
  const result = validateDbReferences(initialDb());

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});
