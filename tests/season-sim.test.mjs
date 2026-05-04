import test from "node:test";
import assert from "node:assert/strict";
import {
  initialDb,
  makeUser,
  prepareSeasonSim,
  runSeasonSimDraft,
  runSeasonSimToEnd,
  seasonSimState,
  simulateSeasonWeek
} from "../server.js";

function addManagerTeam(db, index) {
  const user = makeUser(`u-sim-${index}`, `sim${index}`, `Sim Manager ${index}`, "manager", `password-${index}`);
  const team = {
    id: `t-sim-${index}`,
    name: `Sim Team ${index}`,
    manager: `S${index}`,
    ownerUserId: user.id,
    logoUrl: "",
    color: "#4f7ee8",
    wins: 0,
    losses: 0,
    ties: 0,
    waiverRank: db.teams.length + 1
  };
  db.users.push(user);
  db.teams.push(team);
  db.lineups[team.id] = {};
  db.league.draft.order.push(team.id);
}

test("base seed starts with only commissioner, empty rosters, and no schedule", () => {
  const db = initialDb();

  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].role, "commissioner");
  assert.equal(db.teams.length, 1);
  assert.equal(db.players.every((player) => !player.ownership), true);
  assert.deepEqual(db.matchups, []);
  assert.deepEqual(db.transactions, []);
});

test("season sim waits for real teams before draft and week advancement", () => {
  const db = initialDb();

  const prepared = prepareSeasonSim(db);

  assert.equal(prepared.stage, "signup");
  assert.ok(prepared.blockers.some((item) => item.includes("four teams")));
  assert.equal(runSeasonSimDraft(db).error.includes("four teams"), true);
  assert.equal(simulateSeasonWeek(db).error.includes("four teams"), true);
});

test("season sim can draft, advance one week, and run through championship", () => {
  const db = initialDb();
  for (let index = 2; index <= 4; index++) addManagerTeam(db, index);

  const prepared = prepareSeasonSim(db);
  assert.equal(prepared.stage, "draft_ready");
  assert.equal(db.matchups.filter((matchup) => matchup.week === 1).length, 2);

  const drafted = runSeasonSimDraft(db);
  assert.equal(drafted.draftStatus, "complete");
  assert.equal(drafted.rosteredTeams, 4);
  assert.equal(db.teams.every((team) => Object.keys(db.lineups[team.id] || {}).length > 0), true);

  const weekOne = simulateSeasonWeek(db);
  assert.equal(weekOne.processed.week, 1);
  assert.equal(db.meta.currentWeek, 2);
  assert.equal(db.matchups.filter((matchup) => matchup.week === 1).every((matchup) => matchup.status === "final"), true);
  assert.ok(db.weeklyPlayerStats.some((stat) => stat.provider === "season-sim-2025" && stat.week === 1));

  const finished = runSeasonSimToEnd(db);
  assert.equal(finished.seasonPhase, "offseason");
  assert.ok(finished.championTeamId);
  assert.equal(seasonSimState(db).completedWeeks.includes(16), true);
});
