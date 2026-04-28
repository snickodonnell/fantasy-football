import test from "node:test";
import assert from "node:assert/strict";
import { canPerformInPhase, generatePlayoffBracket, updatePlayoffBracketFromFinals } from "../server.js";

function makeDb() {
  return {
    meta: { seasonPhase: "regular_season" },
    league: { playoffs: { teams: 4, weeks: "16 & 17", consolationTeams: 2 } },
    teams: [
      { id: "t1", name: "One", wins: 10, losses: 1, ties: 0 },
      { id: "t2", name: "Two", wins: 9, losses: 2, ties: 0 },
      { id: "t3", name: "Three", wins: 8, losses: 3, ties: 0 },
      { id: "t4", name: "Four", wins: 7, losses: 4, ties: 0 },
      { id: "t5", name: "Five", wins: 6, losses: 5, ties: 0 },
      { id: "t6", name: "Six", wins: 5, losses: 6, ties: 0 }
    ],
    players: [],
    matchups: []
  };
}

test("season phase gates core actions", () => {
  const db = makeDb();
  db.meta.seasonPhase = "draft";
  assert.equal(canPerformInPhase(db, "draft"), true);
  assert.equal(canPerformInPhase(db, "lineup"), false);
  db.meta.seasonPhase = "playoffs";
  assert.equal(canPerformInPhase(db, "lineup"), true);
  assert.equal(canPerformInPhase(db, "trade"), false);
});

test("playoff bracket seeds top teams and creates final after semis", () => {
  const db = makeDb();
  const bracket = generatePlayoffBracket(db);
  assert.deepEqual(bracket.seeds.map((seed) => seed.teamId), ["t1", "t2", "t3", "t4"]);
  assert.equal(db.matchups.filter((matchup) => matchup.id.startsWith("playoff-")).length, 3);

  const semiOne = db.matchups.find((matchup) => matchup.id === "playoff-po-semi-1");
  const semiTwo = db.matchups.find((matchup) => matchup.id === "playoff-po-semi-2");
  Object.assign(semiOne, { homeScore: 100, awayScore: 80, status: "final" });
  Object.assign(semiTwo, { homeScore: 75, awayScore: 90, status: "final" });
  updatePlayoffBracketFromFinals(db, 16);

  const final = db.league.playoffs.bracket.games.find((game) => game.round === "championship");
  assert.equal(final.homeTeamId, "t1");
  assert.equal(final.awayTeamId, "t3");
  assert.ok(db.matchups.find((matchup) => matchup.id === "playoff-po-final"));
});
