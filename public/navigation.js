export const routeViews = new Set(["dashboard", "team", "matchups", "league", "draft", "players", "settings", "admin", "player"]);

export function routeHash(view = "dashboard", params = {}, fallback = {}) {
  const query = new URLSearchParams();
  const value = (key, defaultValue = "") => params[key] ?? fallback[key] ?? defaultValue;
  const clean = (item) => item !== undefined && item !== null && item !== "";

  if (view === "player" && clean(value("playerId"))) return `#/player/${encodeURIComponent(value("playerId"))}`;
  if (view === "team") {
    if (clean(value("tab", "roster"))) query.set("tab", value("tab", "roster"));
    if (clean(value("teamId"))) query.set("team", value("teamId"));
  }
  if (view === "league") {
    if (clean(value("tab", "standings"))) query.set("tab", value("tab", "standings"));
    if (clean(value("activity"))) query.set("activity", value("activity"));
  }
  if (view === "dashboard" && clean(value("activity"))) query.set("activity", value("activity"));
  if (view === "players") {
    if (Number(value("page", 1)) > 1) query.set("page", String(value("page", 1)));
    if (clean(value("position")) && value("position") !== "ALL") query.set("position", value("position"));
    if (clean(value("filter"))) query.set("q", value("filter"));
    if (clean(value("tradeToTeam"))) query.set("trade", value("tradeToTeam"));
    if (clean(value("waiver")) && value("waiver") !== "all") query.set("waiver", value("waiver"));
  }
  if (view === "draft") {
    if (clean(value("position")) && value("position") !== "ALL") query.set("position", value("position"));
    if (clean(value("filter"))) query.set("q", value("filter"));
  }
  const suffix = query.toString() ? `?${query}` : "";
  return `#/${routeViews.has(view) ? view : "dashboard"}${suffix}`;
}

export function parseRoute(hash = "") {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path = "dashboard", query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const view = routeViews.has(parts[0]) ? parts[0] : "dashboard";
  const params = new URLSearchParams(query);
  return {
    view,
    playerId: view === "player" ? decodeURIComponent(parts[1] || "") : "",
    teamTab: view === "team" ? params.get("tab") || "roster" : "",
    teamId: view === "team" ? params.get("team") || "" : "",
    leagueTab: view === "league" ? params.get("tab") || "standings" : "",
    activityFilter: ["dashboard", "league"].includes(view) ? params.get("activity") || "all" : "",
    playersPage: view === "players" ? Math.max(1, Number(params.get("page") || 1)) : 1,
    position: ["players", "draft"].includes(view) ? params.get("position") || "ALL" : "",
    filter: ["players", "draft"].includes(view) ? params.get("q") || "" : "",
    tradeToTeam: view === "players" ? params.get("trade") || "" : "",
    waiverFilter: view === "players" ? params.get("waiver") || "all" : ""
  };
}
