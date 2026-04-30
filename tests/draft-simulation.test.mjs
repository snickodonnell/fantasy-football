import test from "node:test";
import assert from "node:assert/strict";
import {
  initialDb,
  replaceDraftPick,
  simulateMockDraft,
  skipDraftPick,
  swapDraftPicks
} from "../server.js";

test("mock draft simulation is deterministic and does not mutate rosters", () => {
  const db = initialDb();
  db.meta.seasonPhase = "draft";
  const before = Object.fromEntries(db.players.map((player) => [player.id, player.ownership || null]));

  const first = simulateMockDraft(db, { rounds: 3, strategy: "balanced" });
  const second = simulateMockDraft(db, { rounds: 3, strategy: "balanced" });
  const after = Object.fromEntries(db.players.map((player) => [player.id, player.ownership || null]));

  assert.equal(first.sourceChanged, false);
  assert.deepEqual(after, before);
  assert.deepEqual(first.picks.map((pick) => pick.playerId), second.picks.map((pick) => pick.playerId));
  assert.equal(first.picks.length, db.teams.length * 3);
  assert.equal(first.rosters.length, db.teams.length);
});

test("mock draft simulation supports alternate deterministic strategies", () => {
  const db = initialDb();
  db.meta.seasonPhase = "draft";
  for (const player of db.players) player.ownership = null;

  const bestAvailable = simulateMockDraft(db, { rounds: 1, strategy: "best_available" });
  const upside = simulateMockDraft(db, { rounds: 1, strategy: "upside" });

  assert.equal(bestAvailable.picks[0].playerName, "Patrick Mahomes");
  assert.notDeepEqual(
    bestAvailable.picks.map((pick) => pick.playerId),
    upside.picks.map((pick) => pick.playerId)
  );
});

test("commissioner can skip and later replace an accidental draft pick", () => {
  const db = initialDb();
  db.meta.seasonPhase = "draft";
  db.league.draft.status = "in_progress";
  db.league.draft.currentPick = 1;
  db.league.draft.rounds = 1;
  db.league.draft.clockStartedAt = new Date().toISOString();
  for (const player of db.players) player.ownership = null;

  const skipped = skipDraftPick(db, "Manager disconnected");
  assert.equal(skipped.ok, true);
  assert.equal(skipped.pick.skipped, true);
  assert.equal(db.league.draft.currentPick, 2);

  const replaced = replaceDraftPick(db, 1, "p1");
  assert.equal(replaced.ok, true);
  assert.equal(replaced.pick.playerName, "Josh Allen");
  assert.equal(replaced.pick.skipped, false);
  assert.equal(db.players.find((player) => player.id === "p1").ownership, "t1");
});

test("commissioner can swap completed draft pick teams and ownership", () => {
  const db = initialDb();
  db.meta.seasonPhase = "draft";
  db.league.draft.status = "in_progress";
  db.league.draft.currentPick = 1;
  db.league.draft.rounds = 1;
  db.league.draft.clockStartedAt = new Date().toISOString();
  for (const player of db.players) player.ownership = null;

  skipDraftPick(db);
  replaceDraftPick(db, 1, "p1");
  skipDraftPick(db);
  replaceDraftPick(db, 2, "p2");

  const swapped = swapDraftPicks(db, 1, 2);
  assert.equal(swapped.ok, true);
  assert.equal(db.league.draft.picks.find((pick) => pick.pickNumber === 1).teamId, "t2");
  assert.equal(db.league.draft.picks.find((pick) => pick.pickNumber === 2).teamId, "t1");
  assert.equal(db.players.find((player) => player.id === "p1").ownership, "t2");
  assert.equal(db.players.find((player) => player.id === "p2").ownership, "t1");
});
