import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../public/navigation.js";

test("player routes encode and parse player ids", () => {
  const hash = routeHash("player", { playerId: "slp-Player 1" });
  assert.equal(hash, "#/player/slp-Player%201");
  assert.deepEqual(parseRoute(hash), {
    view: "player",
    playerId: "slp-Player 1",
    teamTab: "",
    teamId: "",
    leagueTab: "",
    adminTab: "",
    activityFilter: "",
    playersPage: 1,
    position: "",
    filter: "",
    tradeToTeam: "",
    waiverFilter: ""
  });
});

test("team routes preserve tab and selected team", () => {
  const hash = routeHash("team", { tab: "lineup", teamId: "t2" });
  const parsed = parseRoute(hash);

  assert.equal(hash, "#/team?tab=lineup&team=t2");
  assert.equal(parsed.view, "team");
  assert.equal(parsed.teamTab, "lineup");
  assert.equal(parsed.teamId, "t2");
});

test("league routes preserve tab and activity filters", () => {
  const parsed = parseRoute(routeHash("league", { tab: "transactions", activity: "trade" }));

  assert.equal(parsed.view, "league");
  assert.equal(parsed.leagueTab, "transactions");
  assert.equal(parsed.activityFilter, "trade");
});

test("players routes preserve filters pagination trade target and waiver state", () => {
  const hash = routeHash("players", { page: 3, position: "WR", filter: "smith", tradeToTeam: "t3", waiver: "pending" });
  const parsed = parseRoute(hash);

  assert.equal(hash, "#/players?page=3&position=WR&q=smith&trade=t3&waiver=pending");
  assert.equal(parsed.view, "players");
  assert.equal(parsed.playersPage, 3);
  assert.equal(parsed.position, "WR");
  assert.equal(parsed.filter, "smith");
  assert.equal(parsed.tradeToTeam, "t3");
  assert.equal(parsed.waiverFilter, "pending");
});

test("commissioner routes preserve section tabs", () => {
  const hash = routeHash("admin", { tab: "data" });
  const parsed = parseRoute(hash);

  assert.equal(hash, "#/admin?tab=data");
  assert.equal(parsed.view, "admin");
  assert.equal(parsed.adminTab, "data");
});

test("unknown routes fall back to dashboard", () => {
  assert.equal(parseRoute("#/nope").view, "dashboard");
  assert.equal(routeHash("nope"), "#/dashboard");
});
