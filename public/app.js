import { parseRoute, routeHash as makeRouteHash } from "./navigation.js";

const app = document.querySelector("#app");
const state = {
  view: "dashboard",
  data: null,
  user: null,
  csrfToken: "",
  resetTokenMessage: "",
  systemHealth: null,
  sessions: [],
  dryRun: null,
  theme: localStorage.getItem("ff-theme") || (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"),
  filter: "",
  position: "ALL",
  selectedTeam: null,
  selectedPlayerId: null,
  activityFilter: "all",
  teamTab: "roster",
  leagueTab: "standings",
  playersPage: 1,
  waiverFilter: "all",
  waiverEditId: null,
  lineupDrafts: {},
  selectedSlot: null,
  tradeToTeam: null,
  tradeRequestedIds: [],
  tradeCompareIds: [],
  counterTradeId: null,
  draftAudio: false,
  lastDraftPick: 0,
  lastDraftTimerStatus: "",
  toast: null,
  error: ""
};

const nav = [
  ["dashboard", "⌂", "Dashboard"],
  ["team", "☷", "My Team"],
  ["matchups", "◇", "Matchups"],
  ["league", "♜", "League"],
  ["draft", "⇄", "Draft"],
  ["players", "＋", "Players"],
  ["settings", "◉", "Settings"],
  ["admin", "⚙", "Commissioner"]
];

const isCommissioner = () => ["admin", "commissioner"].includes(state.user?.role);
const availableNav = () => nav.filter(([id]) => id !== "admin" || isCommissioner());

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("ff-theme", state.theme);
}

applyTheme();

function routeHash(view = state.view, params = {}) {
  return makeRouteHash(view, params, {
    playerId: state.selectedPlayerId,
    tab: view === "league" ? state.leagueTab : state.teamTab,
    teamId: state.selectedTeam,
    activity: state.activityFilter === "all" ? "" : state.activityFilter,
    page: state.playersPage,
    position: state.position,
    filter: state.filter,
    tradeToTeam: state.tradeToTeam,
    waiver: state.waiverFilter
  });
}

function applyRouteFromLocation() {
  const route = parseRoute(window.location.hash);
  state.view = route.view;
  if (route.playerId) state.selectedPlayerId = route.playerId;
  if (route.view === "team") {
    state.teamTab = route.teamTab || "roster";
    state.selectedTeam = route.teamId || state.selectedTeam;
  }
  if (route.view === "league") {
    state.leagueTab = route.leagueTab || "standings";
    state.activityFilter = route.activityFilter || "all";
  }
  if (route.view === "dashboard") state.activityFilter = route.activityFilter || "all";
  if (route.view === "players") {
    state.playersPage = route.playersPage || 1;
    state.position = route.position || "ALL";
    state.filter = route.filter || "";
    state.tradeToTeam = route.tradeToTeam || state.tradeToTeam;
    state.waiverFilter = route.waiverFilter || "all";
  }
  if (route.view === "draft") {
    state.position = route.position || "ALL";
    state.filter = route.filter || "";
  }
}

function navigate(view, params = {}, replace = false) {
  const next = routeHash(view, params);
  if (window.location.hash === next) {
    applyRouteFromLocation();
    render();
    return;
  }
  if (replace) {
    history.replaceState(null, "", next);
    applyRouteFromLocation();
    render();
    return;
  }
  window.location.hash = next;
}

function setToast(message, tone = "success") {
  state.toast = message ? { message, tone } : null;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(state.csrfToken && !["GET", undefined].includes(options.method) ? { "X-CSRF-Token": state.csrfToken } : {}), ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.csrfToken) state.csrfToken = payload.csrfToken;
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function bootstrap() {
  try {
    const session = await api("/api/session");
    state.user = session.user;
    if (state.user) state.data = await api("/api/bootstrap");
  } catch {
    state.user = null;
  }
  if (state.user && !window.location.hash) navigate("dashboard", {}, true);
  else if (state.user) applyRouteFromLocation();
  render();
}

function initials(value = "") {
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "FF";
}

function moneyTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function player(id) {
  return state.data.players.find((item) => item.id === id);
}

function providerPlayerFor(appPlayer) {
  if (!appPlayer) return null;
  if (appPlayer.id.startsWith("slp-")) return state.data.providerPlayers?.find((p) => p.provider === "sleeper" && p.providerId === appPlayer.id.replace("slp-", ""));
  return state.data.providerPlayers?.find((p) => p.name?.toLowerCase() === appPlayer.name.toLowerCase() && (!p.team || p.team === appPlayer.nflTeam));
}

function playerLink(id, label) {
  const p = player(id);
  return `<a class="link-button" href="${routeHash("player", { playerId: id })}" data-action="view-player" data-player="${id}">${label || p?.name || id}</a>`;
}

function researchFor(playerId) {
  return (state.data.playerResearch || []).find((item) => item.playerId === playerId) || { note: "", watchlist: false };
}

function tradeBlockItem(playerId) {
  return (state.data.tradeBlock || []).find((item) => item.playerId === playerId);
}

function team(id) {
  return state.data.teams.find((item) => item.id === id);
}

function teamAvatar(item, size = 34) {
  const src = item?.logoUrl;
  const bg = item?.color || "#e7eaf0";
  const sizeClass = size >= 52 ? "avatar-lg" : "";
  return src
    ? `<span class="avatar team-avatar ${sizeClass}" style="--team-logo:url('${src.replace(/'/g, "%27")}')"></span>`
    : `<span class="avatar ${sizeClass}" style="--team-color:${bg}">${item?.manager || "FF"}</span>`;
}

function myTeam() {
  if (state.selectedTeam) return team(state.selectedTeam);
  return state.data.myTeam;
}

function roster(teamId) {
  return state.data.players.filter((item) => item.ownership === teamId);
}

function lineupRows(teamId) {
  const lineup = currentLineup(teamId);
  const used = new Set(Object.values(lineup));
  const counts = {};
  const starters = state.data.league.roster.starters.map((slot) => {
    counts[slot] = (counts[slot] || 0) + 1;
    const key = counts[slot] === 1 ? slot : `${slot}${counts[slot]}`;
    return [slot, key, lineup[key]];
  });
  const bench = roster(teamId).filter((item) => !used.has(item.id));
  return { starters, bench };
}

function currentLineup(teamId) {
  if (!state.lineupDrafts[teamId]) state.lineupDrafts[teamId] = { ...(state.data.lineups[teamId] || {}) };
  return state.lineupDrafts[teamId];
}

function slotBase(slotKey) {
  return slotKey.replace(/\d+$/, "");
}

function legalForSlot(playerPosition, slot) {
  const base = slotBase(slot);
  if (base === "FLEX") return ["RB", "WR", "TE"].includes(playerPosition);
  if (base === "D/ST") return playerPosition === "D/ST" || playerPosition === "DEF";
  return playerPosition === base;
}

function projectionFor(teamId) {
  return roster(teamId).reduce((sum, item) => sum + Number(item.projection || 0), 0).toFixed(1);
}

function pager(total, page, size, action) {
  const pages = Math.max(1, Math.ceil(total / size));
  const prev = Math.max(1, page - 1);
  const next = Math.min(pages, page + 1);
  return `<div class="pager"><a class="button-link ${page <= 1 ? "disabled" : ""}" href="${routeHash("players", { page: prev })}" data-action="${action}" data-page="${prev}">Prev</a><span class="small">Page ${page} of ${pages} · ${total} results</span><a class="button-link ${page >= pages ? "disabled" : ""}" href="${routeHash("players", { page: next })}" data-action="${action}" data-page="${next}">Next</a></div>`;
}

function subtabBar(group, active, tabs) {
  const view = group === "league" ? "league" : "team";
  return `<div class="subtabs">${tabs.map(([id, label]) => `<a class="subtab ${active === id ? "active" : ""}" href="${routeHash(view, { tab: id })}" data-action="${group}-tab" data-tab="${id}">${label}</a>`).join("")}</div>`;
}

function layout(content) {
  const navItems = availableNav();
  return `
    <div class="app-shell">
      <aside class="side">
        <div class="brand"><div class="shield">◆</div><div><h1>FAMILY<br>FOOTBALL</h1><p>Local league command center</p></div></div>
        <div class="system-title">Colors</div>
        <div class="swatches">
          <span class="swatch swatch-blue"></span><span class="swatch swatch-green"></span>
          <span class="swatch swatch-slate"></span><span class="swatch swatch-red"></span>
          <span class="swatch swatch-panel"></span><span class="swatch swatch-soft"></span>
        </div>
        <div class="system-title">League Tools</div>
        <div class="icon-grid"><span>⌂</span><span>☷</span><span>◇</span><span>♜</span><span>＋</span><span>⚙</span></div>
        <div class="system-title">Status</div>
        <p class="hint">${state.data.providerSync.message}</p>
        <p class="hint">${syncCounts()}</p>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="brand brand-compact"><div class="shield shield-sm">◆</div></div>
          <nav class="tabs" aria-label="Primary navigation">${navItems.map(([id,, label]) => `<a class="tab ${state.view === id ? "active" : ""}" href="${routeHash(id)}" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
          <div class="user-pill">${phaseBadge()}<button class="icon theme-toggle" title="Toggle dark mode" data-action="theme-toggle" aria-label="Toggle dark mode">${state.theme === "dark" ? "☀" : "☾"}</button><button class="icon" title="Sync data" data-action="sync">↻</button><button class="notification-button" title="Mark updates read" data-action="mark-activity-read">●<span>${state.data.unreadActivityCount || 0}</span></button><span class="avatar">${initials(state.user.displayName)}</span><span>${state.user.displayName}</span><button class="ghost" data-action="logout">Sign out</button></div>
        </header>
        ${state.data.meta.setupRequired ? `<div class="setup-warning"><strong>Password setup required.</strong><span>Change the seeded password in Manager Settings before using league actions on the home network.</span><button data-view="settings">Go to Settings</button></div>` : ""}
        ${content}
        ${state.toast ? `<div class="toast ${state.toast.tone}" role="status">${state.toast.message}</div>` : ""}
      </main>
      <nav class="mobile-nav" aria-label="Mobile navigation">${navItems.map(([id, icon, label]) => `<a class="${state.view === id ? "active" : ""}" href="${routeHash(id)}" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}><span>${icon}</span>${label}</a>`).join("")}</nav>
    </div>
  `;
}

function phaseBadge() {
  return `<span class="pill phase-${state.data.meta.seasonPhase}">${state.data.meta.phaseLabel || labelize(state.data.meta.seasonPhase || "preseason")}</span>`;
}

function actionAllowed(action) {
  return state.data.meta.phaseActions?.[action] !== false;
}

function phaseNotice(action, label) {
  return actionAllowed(action) ? "" : `<div class="empty empty-left stack-sm">${state.data.meta.phaseLabel} locks ${label} actions.</div>`;
}

function dashboard() {
  const data = state.data;
  const matchup = data.matchups.find((item) => item.homeTeamId === data.myTeam.id || item.awayTeamId === data.myTeam.id) || data.matchups[0];
  const home = team(matchup.homeTeamId);
  const away = team(matchup.awayTeamId);
  return layout(`
    <section class="page-head"><div><h2>Main Dashboard</h2><p>Overview of league, matchups, standings, and family activity.</p></div><button class="primary" data-view="team" ${actionAllowed("lineup") ? "" : "disabled"}>Make Lineup Moves</button></section>
    <section class="grid dashboard-grid">
      <article class="card league-card"><span class="avatar">♜</span><div><h3>${data.league.name}</h3><p class="small">${data.teams.length} Teams | Family League</p><a class="button-link" href="${routeHash("league")}" data-view="league">League Settings</a></div></article>
      <article class="card"><div class="between"><button class="icon">‹</button><div><h3>Week ${data.meta.currentWeek}</h3><p class="small">Oct 9 - Oct 15</p></div><button class="icon">›</button></div><a class="button-link primary full-link" href="${routeHash("team", { tab: "lineup" })}" data-view="team">Set Lineup</a></article>
      <article class="card"><h3>Top Scorer</h3><div class="score-row"><span class="avatar">SA</span><div><strong>Sophie A.</strong><div class="score">132.6 <span class="small">PTS</span></div><p class="small up">↑ 18.4 vs proj</p></div></div></article>
      <article class="card"><h3>League Highlight</h3><p class="small">The Parkers pulled off the biggest comeback of the week.</p><a class="button-link" href="${routeHash("matchups")}" data-view="matchups">View Recap</a></article>
    </section>
    <section class="grid two-col section-gap">
      <article class="card">
        <h3>Matchup Snapshot</h3>
        <div class="score-row">
          <div><span class="avatar">${home.manager}</span><strong> ${home.name}</strong><div class="score">${matchup.homeScore}</div><p class="small">Proj ${projectionFor(home.id)}</p></div>
          <div class="vs">vs</div>
          <div class="text-right"><strong>${away.name} </strong><span class="avatar">${away.manager}</span><div class="score">${matchup.awayScore}</div><p class="small">Proj ${projectionFor(away.id)}</p></div>
        </div>
        <div class="progress"><span style="--progress:${Math.min(100, matchup.homeScore / (matchup.homeScore + matchup.awayScore) * 100)}%"></span></div>
        <a class="button-link ghost" href="${routeHash("matchups")}" data-view="matchups">View Full Matchup</a>
      </article>
      <article class="card">
        <h3>Recent Activity</h3>
        ${activityFeed(data.activity?.slice(0, 5) || [], { compact: true })}
      </article>
      <article class="card">
        <h3>Standings</h3>${standingsTable(data.teams.slice(0,4))}
        <a class="button-link ghost" href="${routeHash("league")}" data-view="league">View Full Standings</a>
      </article>
      <article class="card">
        <h3>Family Feed</h3>${chatBox()}
      </article>
    </section>
    <section class="grid three-col section-gap">
      <article class="card"><h3>Data Sync</h3><p class="small">${data.providerSync.message}</p><p class="small">${syncCounts()}</p><button data-action="sync">Sync Providers</button></article>
      <article class="card"><h3>NFL Teams</h3><div class="score">${data.providerSync.counts?.nflTeams || 0}</div><p class="small">Stored from provider</p></article>
      <article class="card"><h3>Sleeper Players</h3><div class="score">${data.providerSync.counts?.sleeperPlayers || 0}</div><p class="small">${data.providerSync.counts?.trending || 0} trending records</p></article>
    </section>
  `);
}

function syncCounts() {
  const counts = state.data?.providerSync?.counts || {};
  return `${counts.nflTeams || 0} NFL teams · ${counts.nflGames || 0} NFL games · ${counts.players || 0} balldontlie players · ${counts.sleeperPlayers || 0} Sleeper players`;
}

function activityFeed(items, options = {}) {
  if (!items.length) return `<div class="empty">No updates yet.</div>`;
  return `<div class="activity ${options.compact ? "compact" : ""}">${items.map((item) => `
    <div class="activity-item ${item.read ? "" : "unread"}">
      <span class="avatar activity-icon">${activityIcon(item.category)}</span>
      <div><strong>${item.title}</strong><p class="small">${item.body}</p><p class="small">${moneyTime(item.createdAt)} · ${labelize(item.category)}</p></div>
    </div>
  `).join("")}</div>`;
}

function activityIcon(category) {
  return ({ roster: "R", draft: "D", trade: "T", waiver: "W", scoring: "S", commissioner: "C", chat: "M" }[category] || "F");
}

function activityFilters() {
  const filters = ["all", "roster", "draft", "trade", "waiver", "scoring", "commissioner", "chat"];
  return `<div class="filter-tabs">${filters.map((filter) => `<a class="${state.activityFilter === filter ? "active" : ""}" href="${routeHash(state.view, { activity: filter === "all" ? "" : filter, tab: state.leagueTab })}" data-action="activity-filter" data-filter="${filter}" ${state.activityFilter === filter ? 'aria-current="true"' : ""}>${labelize(filter)}</a>`).join("")}</div>`;
}

function filteredActivity() {
  const items = state.data.activity || [];
  return state.activityFilter === "all" ? items : items.filter((item) => item.category === state.activityFilter);
}

function standingsTable(teams) {
  return `<table><thead><tr><th>Rank</th><th>Team</th><th>W-L-T</th><th>PF</th></tr></thead><tbody>${teams.map((item, index) => `<tr class="${item.id === state.data.myTeam.id ? "selected" : ""}"><td>${index + 1}</td><td>${teamAvatar(item, 24)} ${item.name}</td><td>${item.wins}-${item.losses}-${item.ties}</td><td>${item.pointsFor}</td></tr>`).join("")}</tbody></table>`;
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key];
    acc[value] = acc[value] || [];
    acc[value].push(item);
    return acc;
  }, {});
}

function currentDraftTeamId(draft) {
  const order = draft.order || [];
  if (!order.length) return null;
  const pickIndex = Math.max(0, Number(draft.currentPick || 1) - 1);
  const roundIndex = Math.floor(pickIndex / order.length);
  const slotIndex = pickIndex % order.length;
  return order[draftSlotIndex(draft.orderStyle || draft.mode || "snake", order.length, roundIndex, slotIndex)];
}

function draftSlotIndex(style, orderLength, roundIndex, slotIndex) {
  if (String(style).includes("linear")) return slotIndex;
  if (String(style).includes("third") && roundIndex >= 2) return orderLength - 1 - slotIndex;
  return roundIndex % 2 === 0 ? slotIndex : orderLength - 1 - slotIndex;
}

function draftBoard(draft) {
  const order = draft.order || [];
  const picks = Object.fromEntries((draft.picks || []).map((pick) => [pick.pickNumber, pick]));
  const rows = [];
  for (let round = 1; round <= Number(draft.rounds || 15); round++) {
    const sequence = order.map((_, slotIndex) => order[draftSlotIndex(draft.orderStyle || draft.mode || "snake", order.length, round - 1, slotIndex)]);
    rows.push(`<div class="draft-round"><strong>Round ${round}</strong><div class="draft-picks">${sequence.map((teamId, index) => {
      const pickNumber = (round - 1) * order.length + index + 1;
      const pick = picks[pickNumber];
      return `<div class="draft-cell ${pickNumber === draft.currentPick ? "active" : ""} ${pick ? "made" : ""}"><span>${pickNumber}. ${team(teamId)?.manager || ""}</span><strong>${pick ? playerLink(pick.playerId, pick.playerName) : "Open"}</strong><small>${pick ? pick.position : team(teamId)?.name || ""}</small></div>`;
    }).join("")}</div></div>`);
  }
  return `<div class="draft-board">${rows.join("")}</div>`;
}

function teamView() {
  const activeTeam = myTeam();
  const rows = lineupRows(activeTeam.id);
  const activeSlot = state.selectedSlot || rows.starters.find(([, key]) => key)?.[1];
  const teamPlayers = roster(activeTeam.id);
  return layout(`
    <section class="page-head"><div><h2>My Team</h2><p>${activeTeam.name} (${activeTeam.wins}-${activeTeam.losses})</p></div><div class="toolbar"><select data-action="select-team">${state.data.teams.map((item) => `<option value="${item.id}" ${item.id === activeTeam.id ? "selected" : ""}>${item.name}</option>`).join("")}</select><button class="primary" data-action="save-lineup" ${actionAllowed("lineup") ? "" : "disabled"}>Save Lineup</button></div></section>
    ${phaseNotice("lineup", "lineup")}
    ${subtabBar("team", state.teamTab, [["roster","Roster"],["lineup","Lineup"],["projections","Projections"],["stats","Stats"]])}
    ${state.teamTab === "roster" ? `
      <section class="grid two-col">
        <article class="card"><h3>Roster</h3>${benchTable(teamPlayers)}</article>
        <aside class="card bench-card">
        <h3>Team Identity</h3>
        <form class="form-grid" data-form="team-settings" data-team="${activeTeam.id}">
          <input name="name" value="${activeTeam.name}" placeholder="Team name">
          <input name="manager" value="${activeTeam.manager}" placeholder="Initials">
          <input name="logoUrl" value="${activeTeam.logoUrl || ""}" placeholder="Logo URL">
          <input name="color" type="color" value="${activeTeam.color || "#4f7ee8"}">
          <button>Save Team</button>
        </form>
        <h3 class="stack-heading">Player Status</h3>${statusSummary(roster(activeTeam.id))}
        </aside>
      </section>
    ` : ""}
    ${state.teamTab === "lineup" ? `
      <section class="grid two-col">
        <article class="card"><h3>Starters</h3>${lineupBoard(activeTeam.id, rows.starters, activeSlot)}</article>
        <aside class="card bench-card"><h3>Legal Bench Moves</h3>${benchMoveList(rows.bench, activeSlot)}<h3 class="stack-heading">Player Status</h3>${statusSummary(teamPlayers)}</aside>
      </section>
    ` : ""}
    ${state.teamTab === "projections" ? `<section class="card"><h3>Projections</h3>${projectionTable(teamPlayers)}</section>` : ""}
    ${state.teamTab === "stats" ? `<section class="card"><h3>Weekly Stats</h3>${teamStatsTable(teamPlayers)}</section>` : ""}
  `);
}

function projectionTable(players) {
  const sorted = [...players].sort((a, b) => Number(b.projection || 0) - Number(a.projection || 0));
  return sorted.length ? `<table><thead><tr><th>Pos</th><th>Player</th><th>Team</th><th>Status</th><th>Projection</th></tr></thead><tbody>${sorted.map((p) => `<tr><td>${p.position}</td><td>${playerLink(p.id, p.name)}</td><td>${p.nflTeam}</td><td>${statusPill(p.status)}</td><td>${p.projection}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No projected players yet.</div>`;
}

function teamStatsTable(players) {
  const rows = players.flatMap((p) => (state.data.scoring.weeklyStats || []).filter((stat) => stat.appPlayerId === p.id).slice(0, 3).map((stat) => ({ p, stat })));
  return rows.length ? `<table><thead><tr><th>Player</th><th>Week</th><th>Type</th><th>Pts</th></tr></thead><tbody>${rows.map(({ p, stat }) => `<tr><td>${playerLink(p.id, p.name)}</td><td>${stat.week}</td><td>${stat.statType}</td><td>${stat.fantasyPoints}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No cached weekly stats for this roster yet. Use Commissioner scoring ingestion when data is available.</div>`;
}

function lineupBoard(teamId, rows, activeSlot) {
  return `<div class="lineup-board">${rows.map(([slot, key, id]) => {
    const p = player(id);
    return `<button class="lineup-slot ${activeSlot === key ? "active" : ""}" data-action="select-slot" data-slot="${key}">
      <span class="slot-name">${slot}</span>
      <strong>${p?.name || "Empty"}</strong>
      <span class="small">${p ? `${p.position} · ${p.nflTeam} · ${p.projection} proj` : "Choose a legal bench player"}</span>
      ${p ? statusPill(p.status) : ""}
    </button>`;
  }).join("")}</div>`;
}

function benchTable(players) {
  return players.length ? `<table><thead><tr><th>Pos</th><th>Player</th><th>Proj</th></tr></thead><tbody>${players.map((p) => `<tr><td>${p.position}</td><td>${playerLink(p.id, p.name)}</td><td>${p.projection}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No bench players.</div>`;
}

function benchMoveList(players, activeSlot) {
  if (!activeSlot) return `<div class="empty">Select a lineup slot.</div>`;
  const legal = players.filter((p) => legalForSlot(p.position, activeSlot));
  if (!legal.length) return `<div class="empty">No legal bench players for ${slotBase(activeSlot)}.</div>${benchTable(players)}`;
  return `<div class="bench-actions">${legal.map((p) => `<button class="bench-move" data-action="move-to-slot" data-player="${p.id}" data-slot="${activeSlot}"><strong>${p.name}</strong><span>${p.position} · ${p.nflTeam} · ${p.projection} proj</span>${statusPill(p.status)}</button>`).join("")}</div>`;
}

function statusPill(status) {
  return `<span class="pill ${status}"><span class="status-dot ${status}"></span>${status}</span>`;
}

function statusSummary(players) {
  const counts = players.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {});
  return ["Healthy", "Questionable", "Out"].map((status) => `<p class="between small"><span><span class="status-dot ${status}"></span> ${status}</span><strong>${counts[status] || 0} Players</strong></p>`).join("");
}

function playerDetailView() {
  const p = player(state.selectedPlayerId) || state.data.players[0];
  if (!p) return layout(`<section class="page-head"><div><h2>Player</h2><p>No player selected.</p></div></section>`);
  const owner = p.ownership ? team(p.ownership) : null;
  const provider = providerPlayerFor(p);
  const trends = (state.data.providerTrending || []).filter((t) => t.provider === "sleeper" && provider && t.providerId === provider.providerId);
  const stats = (state.data.scoring.weeklyStats || []).filter((row) => row.appPlayerId === p.id).slice(0, 8);
  const games = (state.data.nflGames || []).filter((game) => gameMatchesPlayer(game, p)).slice(0, 8);
  const research = researchFor(p.id);
  return layout(`
    <section class="page-head">
      <div><h2>${p.name}</h2><p>${p.position} · ${p.nflTeam} · ${owner ? owner.name : "Free Agent"}</p></div>
      <div class="toolbar"><button data-view="players">Back to Players</button>${!p.ownership ? `<button data-action="add-player" data-player="${p.id}">Add</button>` : `<button data-view="team">View Roster</button>`}</div>
    </section>
    <section class="player-hero">
      <div class="player-badge">${p.position}</div>
      <div>
        <h3>${p.name}</h3>
        <p class="small">${provider?.firstName || ""} ${provider?.lastName || ""} ${provider?.status ? `· ${provider.status}` : ""}</p>
        <div class="toolbar player-chip-row">${statusPill(p.status)}<span class="pill">${p.nflTeam}</span><span class="pill">${owner ? owner.name : "Available"}</span></div>
      </div>
      <div><div class="score">${p.projection}</div><p class="small">Current projection</p></div>
    </section>
    <section class="grid three-col section-gap">
      <article class="card"><h3>Fantasy Context</h3>${playerContext(p, provider, trends)}</article>
      <article class="card"><h3>Trending</h3>${trendingPanel(trends)}</article>
      <article class="card"><h3>Actions</h3>${playerActionPanel(p)}</article>
    </section>
    <section class="grid two-col section-gap">
      <article class="card"><h3>Saved Research</h3>${researchForm(p, research)}</article>
      <article class="card"><h3>Player Comparison</h3>${playerComparison([p.id, ...comparisonCandidates(p).slice(0, 2).map((item) => item.id)])}</article>
    </section>
    <section class="grid two-col section-gap">
      <article class="card"><h3>Recent Stats & Projections</h3>${statsTable(stats)}</article>
      <article class="card"><h3>Schedule Context</h3>${scheduleContext(games)}</article>
    </section>
    <section class="card section-gap"><h3>Provider Metadata</h3>${providerMetadata(provider)}</section>
  `);
}

function playerContext(p, provider, trends) {
  const trendAdd = trends.find((t) => t.trendType === "add")?.count || 0;
  const trendDrop = trends.find((t) => t.trendType === "drop")?.count || 0;
  return `
    <p class="between small"><span>Ownership</span><strong>${p.ownership ? team(p.ownership)?.name : "Free Agent"}</strong></p>
    <p class="between small"><span>Fantasy Positions</span><strong>${provider?.fantasyPositions?.join(", ") || p.position}</strong></p>
    <p class="between small"><span>Injury</span><strong>${provider?.injuryStatus || p.status}</strong></p>
    <p class="between small"><span>Trend Net</span><strong>${trendAdd - trendDrop}</strong></p>
  `;
}

function trendingPanel(trends) {
  if (!trends.length) return `<div class="empty">No Sleeper trend record cached for this player.</div>`;
  return trends.map((trend) => `<p class="between small"><span>${trend.trendType === "add" ? "Adds" : "Drops"} · ${trend.lookbackHours}h</span><strong>${trend.count}</strong></p>`).join("");
}

function playerActionPanel(p) {
  if (!p.ownership) return `<button class="primary" data-action="add-player" data-player="${p.id}">Add Free Agent</button><p class="small">Add/drop validation still applies.</p>`;
  const owner = team(p.ownership);
  if (owner?.id === myTeam()?.id) {
    const blocked = tradeBlockItem(p.id);
    return `<div class="toolbar"><button data-view="team">Manage Lineup</button>${blocked ? `<button data-action="trade-block-remove" data-player="${p.id}">Remove Block</button>` : `<button data-action="trade-block-add" data-player="${p.id}" data-team="${owner.id}">Trade Block</button>`}</div><p class="small">${blocked ? `On trade block${blocked.note ? `: ${blocked.note}` : ""}` : "This player is on your roster."}</p>`;
  }
  return `<button data-action="trade-player" data-player="${p.id}" data-team="${p.ownership}">Start Trade</button><p class="small">Trade review rules apply.</p>`;
}

function researchForm(p, research) {
  return `<form class="form-grid" data-form="player-research">
    <input name="playerId" type="hidden" value="${p.id}">
    <label class="check-row"><input name="watchlist" type="checkbox" ${research.watchlist ? "checked" : ""}> Watchlist</label>
    <textarea name="note" placeholder="Private notes for draft, waivers, and trade decisions">${research.note || ""}</textarea>
    <button>Save Research</button>
  </form>`;
}

function comparisonCandidates(p) {
  return state.data.players
    .filter((item) => item.id !== p.id && item.position === p.position)
    .sort((a, b) => b.projection - a.projection || a.name.localeCompare(b.name));
}

function playerComparison(ids = []) {
  const players = [...new Set(ids)].map((id) => player(id)).filter(Boolean).slice(0, 4);
  if (players.length < 2) return `<div class="empty">Choose two or more players from a trade offer to compare.</div>`;
  const rows = [
    ["Team", (p) => p.nflTeam],
    ["Owner", (p) => p.ownership ? team(p.ownership)?.name : "Free Agent"],
    ["Status", (p) => p.status],
    ["Projection", (p) => Number(p.projection || 0).toFixed(1)],
    ["Opponent", (p) => p.opponent || "-"],
    ["Watch", (p) => researchFor(p.id).watchlist ? "Yes" : "-"],
    ["Block", (p) => tradeBlockItem(p.id) ? "Yes" : "-"]
  ];
  return `<div class="comparison-table"><table><thead><tr><th>Metric</th>${players.map((p) => `<th>${playerLink(p.id, p.name)}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><td>${label}</td>${players.map((p) => `<td>${getter(p) || "-"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function statsTable(stats) {
  if (!stats.length) return `<div class="empty">No cached weekly stats or projections for this player yet.</div>`;
  return `<table><thead><tr><th>Season</th><th>Week</th><th>Type</th><th>Pts</th></tr></thead><tbody>${stats.map((row) => `<tr><td>${row.season}</td><td>${row.week}</td><td>${row.statType}</td><td>${row.fantasyPoints}</td></tr>`).join("")}</tbody></table>`;
}

function scheduleContext(games) {
  if (!games.length) return `<div class="empty">No cached game context for this team yet.</div>`;
  return `<table><thead><tr><th>Week</th><th>Date</th><th>Matchup</th><th>Status</th><th>Score</th></tr></thead><tbody>${games.map((game) => {
    const home = nflTeamName(game.homeTeamProviderId);
    const away = nflTeamName(game.visitorTeamProviderId);
    return `<tr><td>${game.week}</td><td>${formatDate(game.date)}</td><td>${away} @ ${home}</td><td>${game.status || "-"}</td><td>${game.visitorScore ?? 0}-${game.homeScore ?? 0}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function providerMetadata(provider) {
  if (!provider) return `<div class="empty">No provider metadata matched yet.</div>`;
  return `<div class="settings-grid">
    <p class="small"><strong>Sleeper ID</strong><br>${provider.providerId}</p>
    <p class="small"><strong>Search Rank</strong><br>${provider.searchRank ?? "-"}</p>
    <p class="small"><strong>Status</strong><br>${provider.status || "-"}</p>
    <p class="small"><strong>Synced</strong><br>${formatDate(provider.syncedAt)}</p>
  </div>`;
}

function gameMatchesPlayer(game, p) {
  const nflTeam = state.data.nflTeams.find((team) => team.abbreviation === p.nflTeam);
  return nflTeam && [game.homeTeamProviderId, game.visitorTeamProviderId].includes(nflTeam.providerId);
}

function nflTeamName(providerId) {
  const nflTeam = state.data.nflTeams.find((team) => team.providerId === providerId);
  return nflTeam?.abbreviation || nflTeam?.name || providerId || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function matchupsView() {
  const matchup = state.data.matchups[0];
  const home = team(matchup.homeTeamId);
  const away = team(matchup.awayTeamId);
  return layout(`
    <section class="page-head"><div><h2>Matchup Screen</h2><p>Head-to-head comparison with player breakdown and trends.</p></div></section>
    <article class="card matchup-hero">
      <div class="match-team"><span class="avatar">${home.manager}</span><h3>${home.name}</h3><div class="score">${matchup.homeScore}</div><p class="small">Proj ${projectionFor(home.id)}</p><div class="chart"></div></div>
      <div><div class="vs">vs</div><div class="donut section-gap-lg"><span>62%</span></div><p class="small text-center">Live Win %</p></div>
      <div class="match-team"><span class="avatar">${away.manager}</span><h3>${away.name}</h3><div class="score">${matchup.awayScore}</div><p class="small">Proj ${projectionFor(away.id)}</p><div class="chart chart-mirror"></div></div>
    </article>
    <section class="grid two-col section-gap">
      <article class="card"><h3>${home.name} Breakdown</h3>${benchTable(roster(home.id).slice(0,8))}</article>
      <article class="card"><h3>${away.name} Breakdown</h3>${benchTable(roster(away.id).slice(0,8))}</article>
    </section>
  `);
}

function leagueView() {
  const league = state.data.league;
  const byWeek = groupBy(state.data.matchups, "week");
  return layout(`
    <section class="page-head"><div><h2>League / Standings</h2><p>Full league standings with activity feed and chat.</p></div>${phaseBadge()}</section>
    ${subtabBar("league", state.leagueTab, [["standings","Standings"],["schedule","Schedule"],["playoffs","Playoffs"],["transactions","Transactions"],["settings","League Settings"]])}
    ${state.leagueTab === "standings" ? `<section class="grid two-col"><article class="card"><h3>${state.data.league.name}</h3>${standingsTable(state.data.teams)}</article><article class="card"><h3>League Chat</h3>${chatBox(true)}</article></section>` : ""}
    ${state.leagueTab === "schedule" ? `<section class="card"><div class="between"><h3>Fantasy Schedule</h3>${isCommissioner() ? `<button data-action="generate-schedule">Generate Schedule</button>` : ""}</div><div class="schedule-grid">${Object.entries(byWeek).slice(0, 14).map(([week, games]) => `<div class="schedule-week"><strong>Week ${week}</strong>${games.map((game) => `<p class="small">${team(game.homeTeamId)?.name || game.homeTeamId} vs ${team(game.awayTeamId)?.name || game.awayTeamId}</p>`).join("")}</div>`).join("")}</div></section>` : ""}
    ${state.leagueTab === "playoffs" ? playoffView(league.playoffs) : ""}
    ${state.leagueTab === "transactions" ? `<section class="card"><h3>Transactions</h3>${transactionTable()}</section>` : ""}
    ${state.leagueTab === "settings" ? `<section class="grid three-col"><article class="card"><h3>Roster Rules</h3><p class="small">${league.roster.starters.join(", ")} + ${league.roster.bench} bench, ${league.roster.ir} IR</p><p class="small">${league.settings.scoringType}, ${league.settings.maxTeams} teams max</p></article><article class="card"><h3>Waivers & Trades</h3><p class="small">${league.waiver.type}, ${league.waiver.periodDays} days, ${league.waiver.weekly}</p><p class="small">Trade review: ${league.trade.review}, ${league.trade.rejectionDays} days</p></article><article class="card"><h3>Draft & Playoffs</h3><p class="small">${league.draft.type} | ${league.draft.pickTimeSeconds}s picks</p><p class="small">${league.playoffs.teams} playoff teams, Weeks ${league.playoffs.weeks}</p></article></section>` : ""}
    <section class="card section-gap">
      <div class="between"><h3>League Activity</h3><button data-action="mark-activity-read">Mark Read</button></div>
      ${activityFilters()}
      ${activityFeed(filteredActivity())}
    </section>
  `);
}

function transactionTable() {
  const items = state.data.transactions || [];
  return items.length ? `<table><thead><tr><th>When</th><th>Type</th><th>Team</th><th>Note</th></tr></thead><tbody>${items.slice(0, 50).map((item) => `<tr><td>${moneyTime(item.createdAt)}</td><td>${labelize(item.type)}</td><td>${team(item.teamId)?.name || "-"}</td><td>${item.note}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No transactions yet.</div>`;
}

function playoffView(playoffs) {
  const bracket = playoffs.bracket;
  return `<section class="card">
    <div class="between"><h3>Playoffs</h3>${isCommissioner() ? `<button data-action="generate-playoffs">Generate Bracket</button>` : ""}</div>
    <p class="small">${playoffs.teams} playoff teams, Weeks ${playoffs.weeks}. ${bracket?.championTeamId ? `Champion: ${team(bracket.championTeamId)?.name}` : ""}</p>
    ${bracket ? playoffBracket(bracket) : `<div class="empty">No playoff bracket generated yet.</div>`}
  </section>`;
}

function playoffBracket(bracket) {
  const rounds = groupBy(bracket.games || [], "round");
  const order = ["semifinal", "championship", "third_place", "consolation"];
  return `<div class="playoff-bracket">${order.filter((round) => rounds[round]?.length).map((round) => `
    <div class="playoff-round"><h3>${labelize(round)}</h3>${rounds[round].map((game) => playoffGame(game)).join("")}</div>
  `).join("")}</div>`;
}

function playoffGame(game) {
  const home = team(game.homeTeamId);
  const away = team(game.awayTeamId);
  return `<div class="playoff-game ${game.status === "final" ? "final" : ""}">
    <p class="small">Week ${game.week} ${game.status || "scheduled"}</p>
    <p class="between small"><span>${game.homeSeed ? `${game.homeSeed}. ` : ""}${home?.name || "TBD"}</span><strong>${game.homeScore ?? ""}</strong></p>
    <p class="between small"><span>${game.awaySeed ? `${game.awaySeed}. ` : ""}${away?.name || "TBD"}</span><strong>${game.awayScore ?? ""}</strong></p>
    ${game.winnerTeamId ? `<p class="small up">Winner: ${team(game.winnerTeamId)?.name}</p>` : ""}
  </div>`;
}

function draftView() {
  const draft = state.data.league.draft;
  const currentTeamId = currentDraftTeamId(draft);
  const currentTeam = team(currentTeamId);
  const activeTeam = myTeam();
  const timer = draftTimerState(draft);
  const available = state.data.players
    .filter((p) => !p.ownership)
    .filter((p) => state.position === "ALL" || p.position === state.position)
    .filter((p) => !state.filter || p.name.toLowerCase().includes(state.filter.toLowerCase()) || p.nflTeam.toLowerCase().includes(state.filter.toLowerCase()))
    .sort((a, b) => b.projection - a.projection || a.name.localeCompare(b.name))
    .slice(0, 150);
  return layout(`
    <section class="page-head">
      <div><h2>Draft Room</h2><p>Live draft board with queues, keepers, chat, timer cues, and commissioner-controlled draft style.</p></div>
      <div class="toolbar">
        <button data-action="draft-audio">${state.draftAudio ? "Sound On" : "Enable Sound"}</button>
        ${isCommissioner() ? `<button class="primary" data-action="draft-start" ${actionAllowed("draft") ? "" : "disabled"}>Start Draft</button>${["in_progress","paused"].includes(draft.status) ? `<button data-action="draft-pause" ${actionAllowed("draft") ? "" : "disabled"}>${draft.status === "paused" ? "Resume" : "Pause"}</button>` : ""}<button data-action="draft-test" ${actionAllowed("draft") ? "" : "disabled"}>Run Test Draft</button><button data-action="draft-reset" ${actionAllowed("draft") ? "" : "disabled"}>Reset Draft</button>` : ""}
      </div>
    </section>
    ${phaseNotice("draft", "draft")}
    <section class="draft-stage ${timer.status}">
      <div>
        <p class="small">On clock</p>
        <h3>${currentTeam?.name || "-"}</h3>
        <p class="small">Pick ${draft.currentPick || 1} of ${(draft.order?.length || 0) * (draft.rounds || 15)} · ${labelize(draft.orderStyle || "snake")}</p>
      </div>
      <div class="draft-clock ${timer.status}"><span>${timer.label}</span><small>${timer.caption}</small></div>
      ${isCommissioner() ? `<div class="toolbar"><button data-action="draft-autopick">Autopick</button><button data-action="draft-undo">Undo</button></div>` : ""}
    </section>
    <section class="grid three-col section-gap">
      <article class="card"><h3>Status</h3><div class="score">${draft.status.replace("_", " ")}</div><p class="small">${draft.picks?.length || 0} picks made</p><p class="small">Timer: ${draft.pickTimeSeconds || 60}s</p></article>
      <article class="card"><h3>Draft Order</h3>${draftOrderList(draft)}</article>
      <article class="card"><h3>Recent Picks</h3>${draft.picks?.length ? draft.picks.slice(-8).reverse().map((pick) => `<p class="small"><strong>${pick.pickNumber}.</strong> ${playerLink(pick.playerId, pick.playerName)} (${pick.position}) to ${team(pick.teamId)?.name}</p>`).join("") : `<div class="empty">No picks yet.</div>`}</article>
    </section>
    ${isCommissioner() ? `<section class="card section-gap"><h3>Commissioner Draft Setup</h3>${draftConfigForm(draft)}<h3 class="stack-heading">Keepers</h3>${keeperTools(draft)}</section>` : ""}
    <section class="grid two-col section-gap">
      <article class="card">
        <div class="toolbar"><input placeholder="Search draft board" value="${state.filter}" data-action="filter"><select data-action="position"><option>ALL</option>${["QB","RB","WR","TE","FLEX","D/ST","K"].map((p) => `<option ${state.position === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <h3>Available Players</h3>
        <table><thead><tr><th>Pos</th><th>Player</th><th>Team</th><th>Status</th><th>Proj</th><th></th></tr></thead><tbody>${available.map((p) => `<tr><td>${p.position}</td><td>${playerLink(p.id, p.name)}</td><td>${p.nflTeam}</td><td>${statusPill(p.status)}</td><td>${p.projection}</td><td><div class="toolbar">${canManageDraftQueue(activeTeam.id) ? `<button data-action="draft-queue-add" data-player="${p.id}" data-team="${activeTeam.id}">Queue</button>` : ""}${isCommissioner() ? `<button data-action="draft-pick" data-player="${p.id}">Draft</button>` : ""}</div></td></tr>`).join("")}</tbody></table>
      </article>
      <article class="card"><h3>Draft Board</h3>${draftBoard(draft)}</article>
    </section>
    <section class="grid three-col section-gap">
      <article class="card"><h3>Team Needs</h3>${teamNeeds(currentTeamId)}</article>
      <article class="card"><h3>${activeTeam.name} Queue</h3>${draftQueue(activeTeam.id, draft)}</article>
      <article class="card"><h3>Draft Chat</h3>${draftChat(draft)}</article>
    </section>
  `);
}

function draftTimerState(draft) {
  if (draft.status === "paused") return { status: "paused", label: "Paused", caption: "Clock stopped" };
  if (draft.status !== "in_progress") return { status: "idle", label: labelize(draft.status || "not_started"), caption: "Not on clock" };
  const seconds = Number(draft.pickTimeSeconds || 60);
  const started = Date.parse(draft.clockStartedAt || draft.startedAt || new Date());
  const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const remaining = Math.max(0, seconds - elapsed);
  const status = remaining <= 0 ? "expired" : remaining <= 10 ? "urgent" : remaining <= Math.ceil(seconds / 2) ? "warning" : "fresh";
  return { status, label: `${remaining}s`, caption: remaining <= 0 ? "Pick is overdue" : "On the clock" };
}

function teamNeeds(teamId) {
  if (!teamId) return `<div class="empty">No team on clock.</div>`;
  const counts = roster(teamId).reduce((acc, p) => ({ ...acc, [p.position]: (acc[p.position] || 0) + 1 }), {});
  const targets = { QB: 2, RB: 4, WR: 5, TE: 2, K: 1, "D/ST": 1 };
  return Object.entries(targets).map(([pos, target]) => `<p class="between small"><span>${pos}</span><strong>${counts[pos] || 0}/${target}</strong></p>`).join("");
}

function canManageDraftQueue(teamId) {
  return isCommissioner() || myTeam()?.id === teamId;
}

function draftOrderList(draft) {
  return (draft.order || []).map((id, index) => `<p class="between small"><span>${index + 1}. ${team(id)?.name || id}</span><strong>${roster(id).length}</strong></p>`).join("");
}

function draftConfigForm(draft) {
  const order = draft.order || state.data.teams.map((team) => team.id);
  return `<form class="settings-form" data-form="draft-config">
    <div class="settings-grid">
      <label><span>Rounds</span><input name="rounds" type="number" min="1" value="${draft.rounds || 15}"></label>
      <label><span>Pick Timer Seconds</span><input name="pickTimeSeconds" type="number" min="10" value="${draft.pickTimeSeconds || 60}"></label>
      <label><span>Draft Style</span><select name="orderStyle">
        <option value="snake" ${draft.orderStyle === "snake" ? "selected" : ""}>Snake</option>
        <option value="linear" ${draft.orderStyle === "linear" ? "selected" : ""}>Linear</option>
        <option value="third_round_reversal" ${draft.orderStyle === "third_round_reversal" ? "selected" : ""}>Third-round reversal</option>
      </select></label>
      ${order.map((teamId, index) => `<label><span>Pick Slot ${index + 1}</span><select name="order_${index}">${state.data.teams.map((item) => `<option value="${item.id}" ${item.id === teamId ? "selected" : ""}>${item.name}</option>`).join("")}</select></label>`).join("")}
    </div>
    <p class="small">Duplicate slots are ignored and any missing teams are appended when saved.</p>
    <button>Save Draft Setup</button>
  </form>`;
}

function keeperTools(draft) {
  const keepers = draft.keepers || [];
  return `<form class="toolbar" data-form="draft-keeper">
    <select name="teamId">${state.data.teams.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}</select>
    <select name="playerId">${state.data.players.filter((p) => p.ownership).map((p) => `<option value="${p.id}">${p.name} (${team(p.ownership)?.name || "Rostered"})</option>`).join("")}</select>
    <input class="input-xs" name="round" type="number" min="1" value="1">
    <input name="note" placeholder="Keeper note">
    <button>Add Keeper</button>
  </form>
  ${keepers.length ? `<div class="waiver-list">${keepers.map((keeper) => `<div class="waiver-item"><div><p class="small"><strong>${team(keeper.teamId)?.name}</strong> keeps ${playerLink(keeper.playerId)} in Round ${keeper.round}</p>${keeper.note ? `<p class="small">${keeper.note}</p>` : ""}</div><button data-action="draft-keeper-remove" data-player="${keeper.playerId}">Remove</button></div>`).join("")}</div>` : `<div class="empty">No keepers marked.</div>`}`;
}

function draftQueue(teamId, draft) {
  const ids = draft.queues?.[teamId] || [];
  if (!ids.length) return `<div class="empty">Queue players from the available player table.</div>`;
  return `<div class="waiver-list">${ids.map((id, index) => `<div class="waiver-item"><div><p class="small"><strong>${index + 1}.</strong> ${playerLink(id)} <span>${player(id)?.position || ""}</span></p></div><button data-action="draft-queue-remove" data-team="${teamId}" data-player="${id}">Remove</button></div>`).join("")}</div>`;
}

function draftChat(draft) {
  const messages = draft.chat || [];
  return `<div class="chat-list draft-chat">${messages.slice(-8).map((item) => `<div class="chat-item"><span class="avatar">${initials(item.author)}</span><div><strong>${item.author}</strong><p class="small">${item.body}</p></div></div>`).join("") || `<div class="empty">No draft chat yet.</div>`}</div><form class="toolbar section-gap-sm" data-form="draft-chat"><input name="body" placeholder="Draft message"><button class="icon" aria-label="Send draft message">▷</button></form>`;
}

function playersView() {
  const activeTeam = myTeam();
  const activeRoster = roster(activeTeam.id);
  const pageSize = 50;
  const filtered = state.data.players.filter((p) =>
    (!state.filter || p.name.toLowerCase().includes(state.filter.toLowerCase()) || p.nflTeam.toLowerCase().includes(state.filter.toLowerCase())) &&
    (state.position === "ALL" || p.position === state.position)
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.playersPage = Math.min(state.playersPage, maxPage);
  const pageItems = filtered.slice((state.playersPage - 1) * pageSize, state.playersPage * pageSize);
  return layout(`
    <section class="page-head"><div><h2>Players</h2><p>Search free agents, add players, submit waiver claims, and start trades.</p></div></section>
    <div class="toolbar"><input placeholder="Search players" value="${state.filter}" data-action="filter"><select data-action="position"><option>ALL</option>${["QB","RB","WR","TE","FLEX","D/ST","K"].map((p) => `<option ${state.position === p ? "selected" : ""}>${p}</option>`).join("")}</select><button data-action="sync">Sync Provider</button></div>
    <section class="grid two-col">
      <article class="card"><div class="between"><h3>Player Pool</h3>${pager(filtered.length, state.playersPage, pageSize, "players-page")}</div><table><thead><tr><th>Pos</th><th>Player</th><th>Team</th><th>Status</th><th>Proj</th><th></th></tr></thead><tbody>${pageItems.map((p) => `<tr><td>${p.position}</td><td>${playerLink(p.id, p.name)}</td><td>${p.nflTeam}</td><td>${statusPill(p.status)}</td><td>${p.projection}</td><td>${playerAction(p, activeTeam)}</td></tr>`).join("")}</tbody></table>${pager(filtered.length, state.playersPage, pageSize, "players-page")}</article>
      <aside class="card">
        <h3>Submit Waiver Claim</h3>
        <form class="form-grid" data-form="waiver-claim">
          <input name="teamId" type="hidden" value="${activeTeam.id}">
          <select name="addPlayerId">${state.data.players.filter((p) => !p.ownership).slice(0, 300).map((p) => `<option value="${p.id}">${p.name} (${p.position} ${p.nflTeam})</option>`).join("")}</select>
          <select name="dropPlayerId"><option value="">No drop</option>${activeRoster.map((p) => `<option value="${p.id}">${p.name} (${p.position})</option>`).join("")}</select>
          <button ${actionAllowed("waiver") ? "" : "disabled"}>Submit Claim</button>
        </form>
        ${phaseNotice("waiver", "waiver")}
        <h3 class="stack-heading">Waivers</h3>${waiverDashboard(activeTeam)}
        <h3 class="stack-heading">Propose Trade</h3>${tradeForm(activeTeam)}
        ${state.tradeCompareIds.length ? `<h3 class="stack-heading">Compare Offer</h3>${playerComparison(state.tradeCompareIds)}` : ""}
        <h3 class="stack-heading">Trade Block</h3>${tradeBlockList(activeTeam)}
        <h3 class="stack-heading">Watchlist</h3>${watchlistPanel()}
        <h3 class="stack-heading">Trades</h3>${tradesList()}
      </aside>
    </section>
  `);
}

function waiverList() {
  const claims = (state.data.waiverClaims || []).filter((claim) => state.waiverFilter === "all" || claim.status === state.waiverFilter);
  return claims.length
    ? `<div class="waiver-list">${claims.slice(0, 30).map((claim, index) => waiverClaimItem(claim, index, { compact: true })).join("")}</div>`
    : `<div class="empty">No waiver claims yet.</div>`;
}

function waiverTools() {
  const filters = ["all", "pending", "processed", "failed", "cancelled"];
  return `<div class="filter-tabs">${filters.map((filter) => `<a class="${state.waiverFilter === filter ? "active" : ""}" href="${routeHash("players", { waiver: filter === "all" ? "" : filter })}" data-action="waiver-filter" data-filter="${filter}" ${state.waiverFilter === filter ? 'aria-current="true"' : ""}>${labelize(filter)}</a>`).join("")}</div>`;
}

function waiverDashboard(activeTeam) {
  return `
    <div class="waiver-priority-strip">${waiverPriorityDisplay(activeTeam.id)}</div>
    ${waiverTools()}
    <h4>My Claim Queue</h4>${managerClaimQueue(activeTeam)}
    <h4>Process Preview</h4>${waiverProcessPreview()}
    <h4>Claim History</h4>${waiverList()}
  `;
}

function waiverPriorityDisplay(activeTeamId) {
  return [...state.data.teams]
    .sort((a, b) => a.waiverRank - b.waiverRank)
    .map((item) => `<div class="priority-chip ${item.id === activeTeamId ? "active" : ""}"><span>${item.waiverRank}</span><strong>${item.name}</strong><small>${roster(item.id).length} players</small></div>`)
    .join("");
}

function managerClaimQueue(activeTeam) {
  const claims = (state.data.waiverClaims || [])
    .filter((claim) => claim.teamId === activeTeam.id && claim.status === "pending")
    .sort((a, b) => (a.claimOrder || 0) - (b.claimOrder || 0) || a.createdAt - b.createdAt);
  if (!claims.length) return `<div class="empty">No pending claims in your queue.</div>`;
  return `<div class="waiver-list queue-list">${claims.map((claim, index) => waiverClaimItem(claim, index, { queue: true, total: claims.length })).join("")}</div>`;
}

function waiverClaimItem(claim, index, options = {}) {
  const add = player(claim.addPlayerId);
  const drop = claim.dropPlayerId ? player(claim.dropPlayerId) : null;
  const claimTeam = team(claim.teamId);
  const editable = claim.status === "pending" && (claim.teamId === myTeam()?.id || isCommissioner());
  const isEditing = state.waiverEditId === claim.id;
  return `<div class="waiver-item ${claim.status}">
    <div>
      <p class="small"><strong>${options.queue ? `${claim.claimOrder || index + 1}.` : `${index + 1}. ${claimTeam?.name || ""}`}</strong> claims ${playerLink(claim.addPlayerId, add?.name)}${drop ? `, drops ${playerLink(drop.id, drop.name)}` : ""}</p>
      <p class="small">Waiver rank ${claimTeam?.waiverRank || claim.priority || "-"} · Queue ${claim.claimOrder || "-"} · ${moneyTime(claim.createdAt)}</p>
      ${claim.reason ? `<p class="small danger-text">${claim.reason}</p>` : ""}
      ${isEditing ? waiverEditForm(claim) : ""}
    </div>
    <div class="toolbar">
      <span class="pill">${claim.status}</span>
      ${options.queue && index > 0 ? `<button class="icon" title="Move up" data-action="waiver-move" data-claim="${claim.id}" data-direction="up">↑</button>` : ""}
      ${options.queue && index < options.total - 1 ? `<button class="icon" title="Move down" data-action="waiver-move" data-claim="${claim.id}" data-direction="down">↓</button>` : ""}
      ${editable ? `<button data-action="waiver-edit" data-claim="${claim.id}">${isEditing ? "Close" : "Edit"}</button><button data-action="waiver-cancel" data-claim="${claim.id}">Cancel</button>` : ""}
    </div>
  </div>`;
}

function waiverEditForm(claim) {
  const claimRoster = roster(claim.teamId);
  return `<form class="toolbar waiver-edit-form" data-form="waiver-edit" data-claim="${claim.id}">
    <select name="dropPlayerId"><option value="">No drop</option>${claimRoster.map((p) => `<option value="${p.id}" ${claim.dropPlayerId === p.id ? "selected" : ""}>${p.name} (${p.position})</option>`).join("")}</select>
    <button>Save</button>
  </form>`;
}

function waiverProcessPreview() {
  const preview = state.data.waiverPreview || [];
  if (!preview.length) return `<div class="empty">No pending claims to process.</div>`;
  return `<div class="waiver-preview">${preview.slice(0, 12).map((item) => `
    <div class="preview-row ${item.valid ? "" : "invalid"}">
      <span class="preview-order">${item.processOrder}</span>
      <div><strong>${item.teamName}</strong><p class="small">Rank ${item.waiverRank} · Queue ${item.claimOrder}</p></div>
      <div><p class="small">Add</p><strong>${playerLink(item.addPlayerId, item.addPlayerName)}</strong></div>
      <div><p class="small">Drop</p><strong>${item.dropPlayerId ? playerLink(item.dropPlayerId, item.dropPlayerName) : "None"}</strong></div>
      <span class="pill">${item.valid ? "Ready" : "Issue"}</span>
      ${item.reason ? `<p class="small danger-text">${item.reason}</p>` : ""}
    </div>
  `).join("")}</div>`;
}

function tradeBlockList(activeTeam) {
  const items = state.data.tradeBlock || [];
  if (!items.length) return `<div class="empty">No players are on the trade block.</div>`;
  return `<div class="waiver-list">${items.slice(0, 12).map((item) => {
    const p = player(item.playerId);
    const canEdit = item.teamId === activeTeam.id || isCommissioner();
    return `<div class="waiver-item"><div><p class="small"><strong>${team(item.teamId)?.name}</strong>: ${playerLink(item.playerId, p?.name)} ${p ? `(${p.position})` : ""}</p>${item.note ? `<p class="small">${item.note}</p>` : ""}</div><div class="toolbar">${p?.ownership && p.ownership !== activeTeam.id ? `<button data-action="trade-player" data-player="${p.id}" data-team="${p.ownership}">Offer</button>` : ""}${canEdit ? `<button data-action="trade-block-remove" data-player="${item.playerId}">Remove</button>` : ""}</div></div>`;
  }).join("")}</div>`;
}

function watchlistPanel() {
  const items = (state.data.playerResearch || []).filter((item) => item.watchlist);
  if (!items.length) return `<div class="empty">No watchlist players yet.</div>`;
  return items.slice(0, 10).map((item) => `<p class="between small"><span>${playerLink(item.playerId)}</span><strong>${player(item.playerId)?.position || ""}</strong></p>`).join("");
}

function playerAction(p, activeTeam) {
  if (!p.ownership) return `<button data-action="add-player" data-player="${p.id}" data-team="${activeTeam.id}">Add</button>`;
  if (p.ownership === activeTeam.id) return tradeBlockItem(p.id) ? `<button data-action="trade-block-remove" data-player="${p.id}">Unblock</button>` : `<button data-action="trade-block-add" data-player="${p.id}" data-team="${activeTeam.id}">Block</button>`;
  return `<button data-action="trade-player" data-player="${p.id}" data-team="${p.ownership}">Trade</button>`;
}

function tradeForm(activeTeam) {
  const myRoster = roster(activeTeam.id);
  const otherTeams = state.data.teams.filter((item) => item.id !== activeTeam.id);
  const selectedToTeam = state.tradeToTeam || otherTeams[0]?.id || "";
  const compareIds = `data-compare-form="trade-offer"`;
  return `<form class="form-grid" data-form="trade-offer">
    <input name="fromTeamId" type="hidden" value="${activeTeam.id}">
    <label><span class="small">To Team</span><select name="toTeamId">${otherTeams.map((item) => `<option value="${item.id}" ${selectedToTeam === item.id ? "selected" : ""}>${item.name}</option>`).join("")}</select></label>
    <label><span class="small">Offer</span><select name="offeredPlayerIds" multiple size="5" ${compareIds}>${myRoster.map((p) => `<option value="${p.id}">${p.name} (${p.position})</option>`).join("")}</select></label>
    <label><span class="small">Request</span><select name="requestedPlayerIds" multiple size="5" ${compareIds}>${otherTeams.map((other) => `<optgroup label="${other.name}">${roster(other.id).map((p) => `<option value="${p.id}" data-team="${other.id}" ${state.tradeRequestedIds.includes(p.id) ? "selected" : ""}>${p.name} (${p.position})</option>`).join("")}</optgroup>`).join("")}</select></label>
    <input name="message" placeholder="Message">
    <div class="toolbar"><button>Send Offer</button><button type="button" data-action="compare-trade-form">Compare</button></div>
  </form>`;
}

function tradesList() {
  return state.data.trades.length ? state.data.trades.slice(0, 14).map((trade) => {
    const canReceive = myTeam()?.id === trade.toTeamId;
    const canOffer = myTeam()?.id === trade.fromTeamId;
    const needsCommish = trade.status === "commissioner_review";
    const relatedIds = [...(trade.offeredPlayerIds || []), ...(trade.requestedPlayerIds || [])];
    return `<div class="trade-item">
      <p class="small"><strong>${team(trade.fromTeamId)?.name}</strong> offers ${playerNames(trade.offeredPlayerIds)} to <strong>${team(trade.toTeamId)?.name}</strong> for ${playerNames(trade.requestedPlayerIds)}.</p>
      <p class="small">Status: <strong>${trade.status.replace("_", " ")}</strong>${trade.parentTradeId ? " · counteroffer" : ""}${trade.message ? ` · ${trade.message}` : ""}</p>
      <p class="small">Expires: <strong>${tradeCountdown(trade)}</strong> · Visible to involved managers and commissioners.</p>
      ${relatedIds.length > 1 ? playerComparison(relatedIds) : ""}
      <div class="toolbar">
        ${canReceive && trade.status === "offered" ? `<button data-action="trade-accept" data-trade="${trade.id}">Accept</button><button data-action="trade-decline" data-trade="${trade.id}">Decline</button>` : ""}
        ${canOffer && trade.status === "offered" ? `<button data-action="trade-cancel" data-trade="${trade.id}">Cancel</button>` : ""}
        ${(canReceive || canOffer) && trade.status === "offered" ? `<button data-action="counter-trade" data-trade="${trade.id}">Counter</button>` : ""}
        ${isCommissioner() && needsCommish ? `<button class="primary" data-action="trade-approve" data-trade="${trade.id}">Approve</button><button data-action="trade-veto" data-trade="${trade.id}">Veto</button>` : ""}
      </div>
      ${state.counterTradeId === trade.id ? counterTradeForm(trade) : ""}
    </div>`;
  }).join("") : `<div class="empty">No trade offers yet.</div>`;
}

function playerNames(ids = []) {
  return ids.length ? ids.map((id) => playerLink(id)).join(", ") : "nothing";
}

function tradeCountdown(trade) {
  if (!["offered", "commissioner_review"].includes(trade.status)) return labelize(trade.status);
  if (!trade.expiresAt) return "No expiration saved";
  const diff = Number(trade.expiresAt) - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  return `${hours}h ${Math.floor((diff % 3600000) / 60000)}m`;
}

function counterTradeForm(trade) {
  const activeTeam = myTeam();
  const fromTeamId = [trade.fromTeamId, trade.toTeamId].includes(activeTeam.id) ? activeTeam.id : trade.toTeamId;
  const toTeamId = fromTeamId === trade.fromTeamId ? trade.toTeamId : trade.fromTeamId;
  return `<form class="form-grid counter-form" data-form="trade-counter" data-trade="${trade.id}">
    <input name="fromTeamId" type="hidden" value="${fromTeamId}">
    <input name="toTeamId" type="hidden" value="${toTeamId}">
    <label><span class="small">Offer from ${team(fromTeamId)?.name}</span><select name="offeredPlayerIds" multiple size="4">${roster(fromTeamId).map((p) => `<option value="${p.id}">${p.name} (${p.position})</option>`).join("")}</select></label>
    <label><span class="small">Request from ${team(toTeamId)?.name}</span><select name="requestedPlayerIds" multiple size="4">${roster(toTeamId).map((p) => `<option value="${p.id}">${p.name} (${p.position})</option>`).join("")}</select></label>
    <input name="message" placeholder="Counter message" value="Counteroffer">
    <button>Send Counter</button>
  </form>`;
}

function adminView() {
  if (!isCommissioner()) return layout(`<section class="page-head"><div><h2>Commissioner</h2><p>Commissioner access is required.</p></div></section>`);
  const league = state.data.league;
  const scoring = league.scoring;
  return layout(`
    <section class="page-head"><div><h2>Commissioner</h2><p>Manage family accounts, passwords, league settings, and local data sync.</p></div></section>
    <section class="card section-gap">
      <div class="between"><h3>Home Server Health</h3><div class="toolbar"><button data-action="refresh-health">Refresh</button><button data-action="run-backup">Create Backup</button></div></div>
      <div id="admin-health">${systemHealthPanel(state.systemHealth)}</div>
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Commissioner Command Center</h3><div class="toolbar"><button data-action="dry-run-phase">Preview Phase</button><button data-action="dry-run-playoffs">Preview Playoffs</button></div></div>
      ${readinessPanel(state.data.ops?.readiness)}
      ${scheduledJobsPanel(state.data.ops?.scheduledJobs)}
      ${state.dryRun ? dryRunPanel(state.dryRun) : ""}
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Data Quality</h3><div class="toolbar"><button data-action="repair-orphans">Repair Orphans</button></div></div>
      ${dataQualityPanel(state.data.ops?.dataQuality)}
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Provider Reliability</h3><div class="toolbar"><button data-action="provider-snapshot">Snapshot Provider Cache</button></div></div>
      ${providerOpsPanel(state.data.ops)}
    </section>
    <section class="card section-gap">
      <h3>Season Control</h3>
      <form class="toolbar" data-form="season-phase">
        <select name="phase">${["preseason","draft","regular_season","playoffs","offseason"].map((phase) => `<option value="${phase}" ${state.data.meta.seasonPhase === phase ? "selected" : ""}>${labelize(phase)}</option>`).join("")}</select>
        <button>Set Phase</button>
        <span class="small">Current phase: <strong>${state.data.meta.phaseLabel}</strong></span>
      </form>
    </section>
    <section class="grid admin-grid">
      <article class="card"><h3>Users</h3><div id="admin-users"></div></article>
      <article class="card">
        <div class="between"><h3>Family Setup</h3><button data-action="setup-family">Apply Family Defaults</button></div>
        <p class="small">Creates/updates Nick, Emily, Hadley, Sarah Kate, Dawson, and Sawyer with editable placeholder teams.</p>
        <h3 class="stack-heading">Add Account</h3>
        <form class="form-grid" data-form="add-user">
          <input name="displayName" placeholder="Display name">
          <input name="username" placeholder="Username">
          <input name="password" placeholder="Temporary password" type="password">
          <select name="role"><option value="manager">Manager</option><option value="commissioner">Commissioner</option></select>
          <select name="teamId"><option value="">No team</option>${state.data.teams.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}</select>
          <button class="primary">Create Account</button>
        </form>
      </article>
    </section>
    <section class="card section-gap">
      <h3>Teams</h3>
      <div class="team-edit-grid">${state.data.teams.map((item) => `<form class="form-grid team-edit" data-form="team-settings" data-team="${item.id}">${teamAvatar(item)}<input name="name" value="${item.name}"><input name="manager" value="${item.manager}"><input name="logoUrl" value="${item.logoUrl || ""}" placeholder="Logo URL"><input name="color" type="color" value="${item.color || "#4f7ee8"}"><button>Save</button></form>`).join("")}</div>
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Data Tools</h3><div class="toolbar"><button data-action="export-data">Export League JSON</button><button data-action="backup-sqlite">Backup SQLite</button></div></div>
      <p class="small">CSV import accepts columns like team, player, playerId, round, and pick. Team and player values can be names or IDs.</p>
      ${backupRestorePanel(state.systemHealth)}
      <form class="form-grid" data-form="csv-import">
        <select name="mode"><option value="rosters">Roster assignments</option><option value="draft">Draft results</option></select>
        <textarea name="csv" placeholder="team,player&#10;The Andersons,Josh Allen&#10;The Parkers,Christian McCaffrey"></textarea>
        <div class="toolbar"><button type="button" data-action="dry-run-import">Preview Import</button><button>Import CSV</button></div>
      </form>
    </section>
    <section class="card section-gap">
      <h3>Scoring Operations</h3>
      <p class="small">Ingest weekly stats/projections, process matchup scores, lock started players, finalize standings, and apply manual corrections.</p>
      <div class="grid three-col">
        <div><strong>Stats</strong><div class="score">${state.data.scoring.summary.weeklyStats}</div><p class="small">${state.data.scoring.summary.actualStats} actual · ${state.data.scoring.summary.projections} projections</p></div>
        <div><strong>Corrections</strong><div class="score">${state.data.scoring.summary.corrections}</div><p class="small">Manual point adjustments this week</p></div>
        <div><strong>Locks</strong><div class="score">${state.data.scoring.summary.locks}</div><p class="small">Started players locked this week</p></div>
      </div>
      ${providerHealthPanel(state.data.scoring.summary.providerHealth)}
      <div class="toolbar section-gap-sm">
        <button data-action="ingest-stats">Ingest Actual Stats</button>
        <button data-action="ingest-projections">Ingest Projections</button>
        <button data-action="process-week">Process Week</button>
        <button class="primary" data-action="finalize-week">Finalize Week</button>
      </div>
      <form class="settings-form" data-form="correction">
        <div class="settings-grid">
          <label><span>Team</span><select name="teamId"><option value="">No team</option>${state.data.teams.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}</select></label>
          <label><span>Player</span><select name="playerId"><option value="">Team-only correction</option>${state.data.players.filter((p) => p.ownership).slice(0, 350).map((p) => `<option value="${p.id}">${p.name} (${team(p.ownership)?.name || "FA"})</option>`).join("")}</select></label>
          ${field("pointsDelta", "Point Delta", 0, "number", "0.01")}
          ${field("note", "Correction Note", "")}
        </div>
        <div class="toolbar"><button type="button" data-action="dry-run-correction">Preview Correction</button><button>Add Correction</button></div>
      </form>
      ${state.data.scoring.corrections.length ? `<table class="section-gap-sm"><thead><tr><th>Week</th><th>Team</th><th>Player</th><th>Delta</th><th>Note</th></tr></thead><tbody>${state.data.scoring.corrections.slice(0, 12).map((item) => `<tr><td>${item.week}</td><td>${team(item.teamId)?.name || "-"}</td><td>${player(item.playerId)?.name || "-"}</td><td>${item.pointsDelta}</td><td>${item.note}</td></tr>`).join("")}</tbody></table>` : `<div class="empty section-gap-sm">No corrections yet.</div>`}
    </section>
    <section class="card section-gap">
      <h3>Notification Preferences</h3>
      <p class="small">Updates are local and per user now. The stored event delivery metadata is ready for push/email later.</p>
      <form class="settings-form" data-form="notifications">
        <div class="settings-grid">
          ${notificationCheckbox("roster", "Roster Moves")}
          ${notificationCheckbox("draft", "Draft")}
          ${notificationCheckbox("trade", "Trades")}
          ${notificationCheckbox("waiver", "Waivers")}
          ${notificationCheckbox("scoring", "Scoring")}
          ${notificationCheckbox("commissioner", "Commissioner")}
          ${notificationCheckbox("chat", "Chat")}
          ${checkbox("pushReady", "Allow Future Push Delivery", state.data.notificationPreferences?.pushReady)}
        </div>
        <button>Save Notification Preferences</button>
      </form>
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Waivers & Roster Validation</h3><div class="toolbar"><button data-action="process-waivers">Process Waivers</button><button data-action="validate-rosters">Validate Rosters</button></div></div>
      <p class="small">Waivers process by rolling priority. FAAB/bidding is intentionally disabled for now.</p>
      <div class="waiver-priority-strip">${waiverPriorityDisplay(myTeam()?.id)}</div>
      <h3 class="stack-heading">Process Preview</h3>${waiverProcessPreview()}
      <h3 class="stack-heading">Claims</h3>${waiverTools()}${waiverList()}
      <div id="roster-validation" class="empty section-gap-sm">Run validation to check roster size, lineup eligibility, duplicate starters, and locked-player restrictions.</div>
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Trade Review</h3><button data-action="expire-trades">Expire Old Offers</button></div>
      <p class="small">Current review mode: ${league.trade.review}. Accepted trades ${String(league.trade.review).toLowerCase().includes("commissioner") ? "wait for commissioner approval" : "process immediately"}.</p>
      ${tradesList()}
    </section>
    <section class="card section-gap">
      <div class="between"><h3>League Event Timeline</h3><span class="small">${state.data.auditLog?.length || 0} entries · create a backup before rollback-style repairs</span></div>
      ${auditLogTable()}
    </section>
    <section class="card section-gap">
      <h3>League Rules</h3>
      <p class="small">Seeded from Yahoo default football settings, then fully configurable here.</p>
      <form class="settings-form" data-form="league">
        <div class="settings-section">
          <h3>General</h3>
          <div class="settings-grid">
            ${field("name", "League Name", league.name)}
            ${field("season", "Season", state.data.meta.season, "number")}
            ${field("currentWeek", "Current Week", state.data.meta.currentWeek, "number")}
            ${field("scoringType", "Scoring Type", league.settings.scoringType)}
            ${field("maxTeams", "Max Teams", league.settings.maxTeams, "number")}
            ${field("maxRosterSize", "Max Roster Size", league.settings.maxRosterSize, "number")}
            ${field("maxAcquisitions", "Max Acquisitions", league.settings.maxAcquisitions)}
            ${field("maxTrades", "Max Trades", league.settings.maxTrades)}
            ${checkbox("fractionalPoints", "Fractional Points", league.settings.fractionalPoints)}
            ${checkbox("negativePoints", "Negative Points", league.settings.negativePoints)}
            ${checkbox("publicViewable", "Publicly Viewable", league.settings.publicViewable)}
          </div>
        </div>
        <div class="settings-section">
          <h3>Roster</h3>
          <div class="settings-grid">
            ${field("starters", "Starting Slots", league.roster.starters.join(", "))}
            ${field("bench", "Bench Slots", league.roster.bench, "number")}
            ${field("ir", "IR Slots", league.roster.ir, "number")}
          </div>
        </div>
        <div class="settings-section">
          <h3>Waivers, Trades, Draft, Playoffs</h3>
          <div class="settings-grid">
            ${field("waiverType", "Waiver Type", league.waiver.type)}
            ${field("waiverPeriodDays", "Waiver Days", league.waiver.periodDays, "number")}
            ${field("weeklyWaivers", "Weekly Waivers", league.waiver.weekly)}
            ${field("waiverBudget", "Waiver Budget (Unused)", 0, "number")}
            ${checkbox("allowFreeAgentAdds", "Allow Free Agent Adds", league.waiver.allowFreeAgentAdds !== false)}
            ${checkbox("allowWaiverAdds", "Allow Waiver Claims", league.waiver.allowWaiverAdds !== false)}
            ${checkbox("allowInjuredToIR", "Allow Injured Directly To IR", league.waiver.allowInjuredToIR)}
            ${field("tradeReview", "Trade Review", league.trade.review)}
            ${field("tradeRejectionDays", "Trade Reject Days", league.trade.rejectionDays, "number")}
            ${checkbox("allowDraftPickTrades", "Allow Draft Pick Trades", league.trade.allowDraftPickTrades)}
            ${field("draftType", "Draft Type", league.draft.type)}
            ${field("pickTimeSeconds", "Pick Time Seconds", league.draft.pickTimeSeconds, "number")}
            ${field("playoffTeams", "Playoff Teams", league.playoffs.teams, "number")}
            ${field("playoffWeeks", "Playoff Weeks", league.playoffs.weeks)}
            ${field("consolationTeams", "Consolation Teams", league.playoffs.consolationTeams, "number")}
            ${checkbox("playoffReseeding", "Playoff Reseeding", league.playoffs.reseeding)}
            ${checkbox("lockEliminatedTeams", "Lock Eliminated Teams", league.playoffs.lockEliminatedTeams)}
          </div>
        </div>
        <div class="settings-section">
          <h3>Scoring</h3>
          <div class="settings-grid scoring-grid">
            ${Object.entries(scoring).map(([key, value]) => field(`score_${key}`, labelize(key), value, "number", "0.01")).join("")}
          </div>
        </div>
        <button class="primary">Save League Rules</button>
      </form>
    </section>
  `);
}

function settingsView() {
  const activeTeam = myTeam();
  return layout(`
    <section class="page-head"><div><h2>Manager Settings</h2><p>Profile, password, team identity, and local notification preferences.</p></div></section>
    <section class="grid two-col">
      <article class="card appearance-card">
        <h3>Appearance</h3>
        <div class="theme-preview">
          <span class="preview-panel"></span>
          <span class="preview-panel"></span>
          <span class="preview-accent"></span>
        </div>
        <p class="small">Use the ${state.theme === "dark" ? "light" : "dark"} theme for this browser.</p>
        <button class="primary" data-action="theme-toggle">${state.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}</button>
      </article>
      <article class="card">
        <h3>Profile</h3>
        <form class="form-grid" data-form="profile">
          <label><span class="small">Display Name</span><input name="displayName" value="${state.user.displayName}"></label>
          <label><span class="small">Username</span><input name="username" value="${state.user.username}" autocomplete="username"></label>
          <label><span class="small">Contact Email</span><input name="email" value="${state.user.email || ""}" type="email"></label>
          <label><span class="small">Profile Visibility</span><select name="profileVisibility"><option value="league" ${state.user.profileVisibility === "league" ? "selected" : ""}>League members</option><option value="commissioner" ${state.user.profileVisibility === "commissioner" ? "selected" : ""}>Commissioners only</option></select></label>
          <button>Save Profile</button>
        </form>
        <h3 class="stack-heading">Password</h3>
        <form class="form-grid" data-form="self-password">
          <input name="currentPassword" type="password" placeholder="Current password" autocomplete="current-password">
          <input name="newPassword" type="password" placeholder="New password" autocomplete="new-password">
          <button>Change Password</button>
        </form>
      </article>
      <article class="card">
        <h3>Team Identity</h3>
        <form class="form-grid" data-form="team-settings" data-team="${activeTeam.id}">
          <div class="team-preview">${teamAvatar(activeTeam, 52)}<strong>${activeTeam.name}</strong></div>
          <input name="name" value="${activeTeam.name}" placeholder="Team name">
          <input name="manager" value="${activeTeam.manager}" placeholder="Initials">
          <input name="logoUrl" value="${activeTeam.logoUrl || ""}" placeholder="Logo URL">
          <label><span class="small">Team Color</span><input name="color" type="color" value="${activeTeam.color || "#4f7ee8"}"></label>
          <button>Save Team Identity</button>
        </form>
      </article>
    </section>
    <section class="card section-gap">
      <h3>Notifications</h3>
      <form class="settings-form" data-form="notifications">
        <div class="settings-grid">
          ${notificationCheckbox("roster", "Roster Moves")}
          ${notificationCheckbox("draft", "Draft")}
          ${notificationCheckbox("trade", "Trades")}
          ${notificationCheckbox("waiver", "Waivers")}
          ${notificationCheckbox("scoring", "Scoring")}
          ${notificationCheckbox("commissioner", "Commissioner")}
          ${notificationCheckbox("chat", "Chat")}
          ${checkbox("pushReady", "Allow Future Push Delivery", state.data.notificationPreferences?.pushReady)}
        </div>
        <button>Save Notification Preferences</button>
      </form>
    </section>
    <section class="card section-gap">
      <div class="between"><h3>Signed-In Devices</h3><button data-action="revoke-sessions">Sign Out Other Devices</button></div>
      <div id="manager-sessions">${sessionList()}</div>
    </section>
    <section class="card section-gap">
      <h3>Privacy</h3>
      <div class="empty empty-left">Profile visibility controls who can inspect saved contact details. League activity and team names remain visible for league play.</div>
    </section>
  `);
}

function auditLogTable() {
  const entries = state.data.auditLog || [];
  if (!entries.length) return `<div class="empty">No commissioner audit entries yet.</div>`;
  return `<div class="audit-log">${entries.slice(0, 80).map((item) => `
    <div class="audit-row">
      <span class="avatar activity-icon">${activityIcon(item.category)}</span>
      <div>
        <strong>${item.title}</strong>
        <p class="small">${item.body}</p>
        <p class="small">${moneyTime(item.createdAt)} · ${labelize(item.type || item.category)} · ${item.actorUserId ? state.data.users?.find?.((u) => u.id === item.actorUserId)?.displayName || item.actorUserId : "system"}</p>
      </div>
    </div>
  `).join("")}</div>`;
}

function providerHealthPanel(health) {
  if (!health) return `<div class="provider-health empty">No scoring provider ingest has run yet.</div>`;
  const status = health.status || "unknown";
  const primary = health.primary ? providerHealthLine("Primary", health.primary) : "";
  const fallback = health.fallback ? providerHealthLine("Fallback", health.fallback) : "";
  return `<div class="provider-health ${status}">
    <div><strong>Provider Health</strong><p class="small">${health.message || "No provider message."}</p></div>
    <span class="pill">${status}</span>
    <div class="provider-health-grid">${primary}${fallback}</div>
  </div>`;
}

function providerHealthLine(label, item) {
  const validation = item.validation;
  const detail = validation ? `${validation.mappedRows}/${validation.rows} mapped · ${validation.mappedStarters}/${validation.starterCount} starters` : (item.error || `${item.rows || 0} rows`);
  return `<p class="small"><strong>${label}: ${item.provider}</strong><br>${detail}</p>`;
}

function systemHealthPanel(health) {
  if (!health) return `<div class="empty">Loading home server health...</div>`;
  const warnings = [
    ...(health.database?.referenceWarnings || []),
    ...(health.security?.defaultSessionSecret ? ["Default SESSION_SECRET is still in use."] : []),
    ...((health.security?.seededPasswordUsers || []).length ? [`Seeded password still active for: ${health.security.seededPasswordUsers.join(", ")}.`] : []),
    ...(health.backups?.latest ? [] : ["No managed backup has been created yet."])
  ];
  return `<div class="health-grid">
    <div class="health-tile ${health.status}"><strong>Overall</strong><span>${health.status}</span><p class="small">${health.server?.lanUrl || "LAN URL unavailable"}</p></div>
    <div class="health-tile ${health.database?.status}"><strong>Database</strong><span>${health.database?.integrity || "unknown"}</span><p class="small">${Math.round((health.database?.size || 0) / 1024)} KB · ${health.database?.migrations?.length || 0} migrations</p></div>
    <div class="health-tile ${health.backups?.status}"><strong>Backups</strong><span>${health.backups?.count || 0}</span><p class="small">${health.backups?.latest ? new Date(health.backups.latest.createdAt).toLocaleString() : "No latest backup"}</p></div>
    <div class="health-tile ${health.provider?.status}"><strong>Provider</strong><span>${health.provider?.status || "idle"}</span><p class="small">${health.provider?.lastRunAt || "No sync yet"}</p></div>
    ${warnings.length ? `<div class="empty health-warnings">${warnings.map((item) => `<p>${item}</p>`).join("")}</div>` : `<div class="empty health-ok">No readiness warnings.</div>`}
  </div>`;
}

function sessionList() {
  if (!state.sessions?.length) return `<div class="empty">Loading signed-in devices...</div>`;
  return `<div class="waiver-list">${state.sessions.map((session) => `<div class="waiver-item"><div><p class="small"><strong>${session.current ? "This device" : "Signed-in device"}</strong></p><p class="small">Created ${new Date(session.createdAt).toLocaleString()} · Expires ${new Date(session.expiresAt).toLocaleString()}</p></div><span class="pill">${session.current ? "Current" : "Active"}</span></div>`).join("")}</div>`;
}

function backupRestorePanel(health) {
  const backups = health?.backups?.backups || [];
  return `<div class="backup-panel">
    <div class="between"><strong>Managed Backups</strong><span class="small">Retention: ${health?.backups?.retention || "-"} files</span></div>
    ${backups.length ? `<div class="waiver-list">${backups.slice(0, 6).map((backup) => `<div class="waiver-item"><div><p class="small"><strong>${backup.file}</strong></p><p class="small">${new Date(backup.createdAt).toLocaleString()} · ${Math.round(backup.size / 1024)} KB</p></div><button data-action="restore-backup" data-file="${backup.file}">Restore</button></div>`).join("")}</div>` : `<div class="empty">No managed backups yet.</div>`}
  </div>`;
}

function readinessPanel(readiness) {
  if (!readiness) return `<div class="empty">Readiness checks unavailable.</div>`;
  return `<div class="readiness-list">
    <div class="between"><strong>${readiness.ready ? "Ready" : "Needs attention"} for ${labelize(readiness.phase)}</strong><span class="pill ${readiness.ready ? "Healthy" : "Questionable"}">${readiness.checks.filter((item) => item.ok).length}/${readiness.checks.length}</span></div>
    ${readiness.checks.map((check) => `<div class="check-item ${check.ok ? "ok" : "warn"}"><span>${check.ok ? "✓" : "!"}</span><div><strong>${check.label}</strong><p class="small">${check.detail}</p></div></div>`).join("")}
  </div>`;
}

function scheduledJobsPanel(jobs) {
  if (!jobs) return "";
  return `<div class="job-grid section-gap-sm">
    <div class="health-tile"><strong>Provider Sync</strong><span>${jobs.providerSync.cadenceMinutes}m</span><p class="small">${jobs.providerSync.status}</p></div>
    <div class="health-tile"><strong>Scoring Refresh</strong><span>${jobs.scoringRefresh.cadenceMinutes}m</span><p class="small">${jobs.scoringRefresh.message}</p></div>
    <div class="health-tile"><strong>Backups</strong><span>${jobs.backups.cadenceHours}h</span><p class="small">${jobs.backups.retention} retained</p></div>
    <div class="health-tile"><strong>Waivers</strong><span>${jobs.waivers.pending}</span><p class="small">${jobs.waivers.mode}</p></div>
  </div>`;
}

function dryRunPanel(preview) {
  return `<div class="backup-panel section-gap-sm">
    <div class="between"><strong>${preview.title}</strong><span class="pill">${preview.type}</span></div>
    <div class="waiver-list">${(preview.effects || []).map((effect) => `<div class="waiver-item"><p class="small">${effect}</p></div>`).join("") || `<div class="empty">No effects.</div>`}</div>
    ${preview.checklist ? readinessPanel(preview.checklist) : ""}
  </div>`;
}

function dataQualityPanel(report) {
  if (!report) return `<div class="empty">Data quality report unavailable.</div>`;
  return `<div class="quality-panel">
    <div class="job-grid">
      <div class="health-tile ${report.ok ? "ok" : "warning"}"><strong>Warnings</strong><span>${report.summary.warnings}</span></div>
      <div class="health-tile ${report.summary.duplicates ? "warning" : "ok"}"><strong>Duplicates</strong><span>${report.summary.duplicates}</span></div>
      <div class="health-tile ${report.summary.invalidRosters ? "warning" : "ok"}"><strong>Invalid Rosters</strong><span>${report.summary.invalidRosters}</span></div>
      <div class="health-tile"><strong>Mapping Ideas</strong><span>${report.summary.providerCandidates}</span></div>
    </div>
    ${report.warnings.length ? `<div class="empty empty-left section-gap-sm">${report.warnings.slice(0, 8).map((item) => `<p>${item}</p>`).join("")}</div>` : `<div class="empty section-gap-sm">No data quality warnings.</div>`}
    ${report.duplicates.length ? `<h3 class="stack-heading">Duplicate Players</h3><div class="waiver-list">${report.duplicates.slice(0, 6).map((group) => `<div class="waiver-item"><div><p class="small"><strong>${group.key}</strong></p><p class="small">${group.players.map((p) => p.id).join(", ")}</p></div><button data-action="merge-duplicate" data-source="${group.players[1].id}" data-target="${group.players[0].id}">Merge</button></div>`).join("")}</div>` : ""}
  </div>`;
}

function providerOpsPanel(ops = {}) {
  const settings = ops.providerSettings || {};
  const candidates = ops.dataQuality?.providerCandidates || [];
  const snapshots = ops.providerSnapshots || [];
  return `<div class="grid two-col">
    <div>
      <form class="settings-form" data-form="provider-settings">
        <div class="settings-grid">
          ${field("refreshCadenceMinutes", "Provider Sync Minutes", settings.refreshCadenceMinutes || 120, "number")}
          ${field("scoringRefreshCadenceMinutes", "Scoring Refresh Minutes", settings.scoringRefreshCadenceMinutes || 15, "number")}
          ${checkbox("cacheSnapshots", "Cache Provider Snapshots", settings.cacheSnapshots !== false)}
          ${checkbox("manualImportAllowed", "Allow Manual Stat Imports", settings.manualImportAllowed !== false)}
        </div>
        <button>Save Provider Settings</button>
      </form>
      <h3 class="stack-heading">Manual Weekly Stat Import</h3>
      <form class="form-grid" data-form="manual-stats">
        <div class="settings-grid">
          ${field("season", "Season", state.data.meta.season, "number")}
          ${field("week", "Week", state.data.meta.currentWeek, "number")}
          <label><span>Stat Type</span><select name="statType"><option value="actual">Actual</option><option value="projection">Projection</option></select></label>
        </div>
        <textarea name="csv" placeholder="player,fantasyPoints&#10;Josh Allen,24.6"></textarea>
        <button>Import Manual Stats</button>
      </form>
    </div>
    <div>
      <h3>Provider Mapping Suggestions</h3>
      ${candidates.length ? `<div class="waiver-list">${candidates.slice(0, 8).map((item) => `<div class="waiver-item"><div><p class="small"><strong>${item.providerName}</strong> → ${item.suggestedPlayerName}</p><p class="small">${item.providerTeam || "FA"} · ${item.providerPosition || ""}</p></div><button data-action="provider-map" data-provider="${item.providerId}" data-player="${item.suggestedPlayerId}">Map</button></div>`).join("")}</div>` : `<div class="empty">No mapping suggestions right now.</div>`}
      <h3 class="stack-heading">Provider Snapshots</h3>
      ${snapshots.length ? `<div class="waiver-list">${snapshots.slice(-5).reverse().map((snapshot) => `<div class="waiver-item"><div><p class="small"><strong>${snapshot.type}</strong></p><p class="small">${new Date(snapshot.createdAt).toLocaleString()} · ${snapshot.counts?.providerPlayers || 0} provider players</p></div></div>`).join("")}</div>` : `<div class="empty">No provider snapshots yet.</div>`}
    </div>
  </div>`;
}

function field(name, label, value, type = "text", step = "1") {
  return `<label><span>${label}</span><input name="${name}" type="${type}" step="${step}" value="${value ?? ""}"></label>`;
}

function checkbox(name, label, checked) {
  return `<label class="check-row"><input name="${name}" type="checkbox" ${checked ? "checked" : ""}><span>${label}</span></label>`;
}

function notificationCheckbox(category, label) {
  return checkbox(`notify_${category}`, label, state.data.notificationPreferences?.categories?.[category] !== false);
}

function labelize(value) {
  return value.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function chatBox(withForm = false) {
  return `<div class="chat-list">${state.data.chat.slice(-5).map((item) => `<div class="chat-item"><span class="avatar">${initials(item.author)}</span><div><strong>${item.author}</strong><p class="small">${item.body}</p></div></div>`).join("")}</div>${withForm ? `<form class="toolbar section-gap-sm" data-form="chat"><input name="body" placeholder="Type a message..."><button class="icon" aria-label="Send chat message">▷</button></form>` : ""}`;
}

function login() {
  app.innerHTML = `
    <main class="login-shell">
      <form class="login-card form-grid" data-form="login">
        <div class="brand"><div class="shield">◆</div><div><h1>FAMILY<br>FOOTBALL</h1><p>Sign in to manage the league</p></div></div>
        <input name="username" value="admin" placeholder="Username" autocomplete="username">
        <input name="password" value="password" placeholder="Password" type="password" autocomplete="current-password">
        <button class="primary">Sign In</button>
        <p class="hint">Seeded local commissioner: admin / password. Change it in Commissioner after sign-in.</p>
        <div class="error">${state.error}</div>
      </form>
      <form class="login-card form-grid" data-form="password-reset">
        <h3>Password Reset</h3>
        <p class="hint">Use a commissioner-generated reset token to set a new password.</p>
        <input name="token" placeholder="Reset token" autocomplete="one-time-code">
        <input name="newPassword" placeholder="New password" type="password" autocomplete="new-password">
        <button>Reset Password</button>
        <p class="hint">${state.resetTokenMessage}</p>
      </form>
    </main>
  `;
}

function render() {
  if (!state.user || !state.data) return login();
  const views = { dashboard, team: teamView, matchups: matchupsView, league: leagueView, draft: draftView, players: playersView, player: playerDetailView, settings: settingsView, admin: adminView };
  app.innerHTML = (views[state.view] || dashboard)();
  if (state.view === "admin") { renderAdminUsers(); renderAdminHealth(); }
  if (state.view === "settings") renderSessions();
  if (state.view === "draft") draftRenderEffects();
}

function renderAdminUsers() {
  const target = document.querySelector("#admin-users");
  if (!target) return;
  target.innerHTML = `<div class="empty">Loading accounts...</div>`;
  api("/api/admin/users").then(({ users }) => {
    target.innerHTML = `<table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Password</th><th>Reset</th></tr></thead><tbody>${users.map((user) => `<tr><td>${user.displayName}</td><td>${user.username}</td><td>${user.role}</td><td><form class="toolbar" data-form="password" data-user="${user.id}"><input name="password" type="password" placeholder="New password"><button>Change</button></form></td><td><button data-action="password-reset-token" data-user="${user.id}">Create Token</button></td></tr>`).join("")}</tbody></table>${state.resetTokenMessage ? `<div class="empty empty-left section-gap-sm">${state.resetTokenMessage}</div>` : ""}`;
  });
}

async function renderAdminHealth() {
  const target = document.querySelector("#admin-health");
  if (!target) return;
  try {
    state.systemHealth = await api("/api/admin/health");
    target.innerHTML = systemHealthPanel(state.systemHealth);
  } catch (error) {
    target.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

async function renderSessions() {
  const target = document.querySelector("#manager-sessions");
  if (!target) return;
  try {
    const result = await api("/api/sessions");
    state.sessions = result.sessions || [];
    target.innerHTML = sessionList();
  } catch (error) {
    target.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

async function refresh() {
  state.data = await api("/api/bootstrap");
  state.user = state.data.currentUser || state.user;
  render();
}

function draftRenderEffects() {
  const draft = state.data?.league?.draft;
  if (!draft) return;
  const latestPick = draft.picks?.at(-1)?.pickNumber || 0;
  if (state.lastDraftPick && latestPick > state.lastDraftPick) playDraftTone("pick");
  state.lastDraftPick = latestPick;
  const timer = draftTimerState(draft);
  if (timer.status !== state.lastDraftTimerStatus && ["warning", "urgent", "expired"].includes(timer.status)) playDraftTone(timer.status);
  state.lastDraftTimerStatus = timer.status;
}

function playDraftTone(kind) {
  if (!state.draftAudio) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequencies = { pick: 660, warning: 440, urgent: 740, expired: 220 };
  oscillator.frequency.value = frequencies[kind] || 520;
  oscillator.type = kind === "expired" ? "sawtooth" : "sine";
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.24);
}

setInterval(() => {
  if (state.view === "draft" && state.data?.league?.draft?.status === "in_progress") render();
}, 1000);

window.addEventListener("hashchange", () => {
  if (!state.user || !state.data) return;
  applyRouteFromLocation();
  render();
});

app.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    const href = viewButton.getAttribute("href");
    if (href?.startsWith("#/")) {
      if (window.location.hash === href) {
        applyRouteFromLocation();
        render();
      } else {
        window.location.hash = href;
      }
      return;
    }
    navigate(viewButton.dataset.view);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  const action = actionButton?.dataset.action;
  if (!action) return;
  try {
    const destructiveConfirmations = {
      "setup-family": "Apply family defaults? Create a backup first if you want an easy rollback.",
      "draft-reset": "Reset the draft? Create a backup first if this is not a rehearsal.",
      "draft-test": "Run a full test draft? Create a backup first if real rosters matter.",
      "process-waivers": "Process waivers now? Create a backup first if you may need to undo the queue.",
      "finalize-week": "Finalize this week and update standings? Create a backup first if scores are still being checked.",
      "generate-playoffs": "Generate the playoff bracket? Create a backup first if standings may still change."
    };
    if (destructiveConfirmations[action] && !confirm(destructiveConfirmations[action])) return;
    if (action === "view-player") {
      event.preventDefault();
      navigate("player", { playerId: actionButton.dataset.player });
      return;
    }
    if (action === "theme-toggle") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme();
      render();
      return;
    }
    if (action === "logout") {
      await api("/api/logout", { method: "POST" });
      state.user = null; state.data = null; render();
    }
    if (action === "sync") {
      await api("/api/sync", { method: "POST" });
      await refresh();
    }
    if (action === "activity-filter") {
      event.preventDefault();
      state.activityFilter = actionButton.dataset.filter || "all";
      navigate(state.view, { activity: state.activityFilter === "all" ? "" : state.activityFilter, tab: state.leagueTab }, true);
      return;
    }
    if (action === "team-tab") {
      event.preventDefault();
      navigate("team", { tab: actionButton.dataset.tab || "roster", teamId: state.selectedTeam });
      return;
    }
    if (action === "league-tab") {
      event.preventDefault();
      navigate("league", { tab: actionButton.dataset.tab || "standings" });
      return;
    }
    if (action === "players-page") {
      event.preventDefault();
      navigate("players", { page: Number(actionButton.dataset.page || 1) });
      return;
    }
    if (action === "waiver-filter") {
      event.preventDefault();
      state.waiverFilter = actionButton.dataset.filter || "all";
      navigate("players", { waiver: state.waiverFilter === "all" ? "" : state.waiverFilter }, true);
      return;
    }
    if (action === "mark-activity-read") {
      await api("/api/activity/read", { method: "POST", body: JSON.stringify({ all: true }) });
      await refresh();
    }
    if (action === "generate-schedule") {
      await api("/api/admin/schedule/generate", { method: "POST", body: JSON.stringify({ weeks: 14, startWeek: 1 }) });
      await refresh();
    }
    if (action === "generate-playoffs") {
      await api("/api/admin/playoffs/generate", { method: "POST" });
      await refresh();
    }
    if (action === "setup-family") {
      await api("/api/admin/setup-family", { method: "POST" });
      await refresh();
    }
    if (action === "refresh-health") {
      await renderAdminHealth();
      return;
    }
    if (action === "run-backup") {
      await api("/api/admin/backup/create", { method: "POST" });
      await renderAdminHealth();
      return;
    }
    if (action === "dry-run-phase") {
      const phase = document.querySelector("[data-form='season-phase'] select[name='phase']")?.value || state.data.meta.seasonPhase;
      state.dryRun = await api("/api/admin/dry-run", { method: "POST", body: JSON.stringify({ type: "phase", payload: { phase } }) });
      render();
      return;
    }
    if (action === "dry-run-playoffs") {
      state.dryRun = await api("/api/admin/dry-run", { method: "POST", body: JSON.stringify({ type: "playoffs" }) });
      render();
      return;
    }
    if (action === "dry-run-import") {
      const form = actionButton.closest("form");
      const values = Object.fromEntries(new FormData(form).entries());
      state.dryRun = await api("/api/admin/dry-run", { method: "POST", body: JSON.stringify({ type: "import", payload: values }) });
      render();
      return;
    }
    if (action === "dry-run-correction") {
      const form = actionButton.closest("form");
      const values = Object.fromEntries(new FormData(form).entries());
      state.dryRun = await api("/api/admin/dry-run", { method: "POST", body: JSON.stringify({ type: "correction", payload: { ...values, week: state.data.meta.currentWeek } }) });
      render();
      return;
    }
    if (action === "repair-orphans") {
      await api("/api/admin/data-quality/repair", { method: "POST" });
      await refresh();
      return;
    }
    if (action === "merge-duplicate") {
      if (!confirm(`Merge ${actionButton.dataset.source} into ${actionButton.dataset.target}?`)) return;
      await api("/api/admin/data-quality/merge-player", { method: "POST", body: JSON.stringify({ sourceId: actionButton.dataset.source, targetId: actionButton.dataset.target }) });
      await refresh();
      return;
    }
    if (action === "provider-snapshot") {
      await api("/api/admin/provider/snapshot", { method: "POST" });
      await refresh();
      return;
    }
    if (action === "provider-map") {
      await api("/api/admin/provider/map", { method: "POST", body: JSON.stringify({ providerId: actionButton.dataset.provider, playerId: actionButton.dataset.player }) });
      await refresh();
      return;
    }
    if (action === "restore-backup") {
      if (!confirm(`Restore ${actionButton.dataset.file}? A pre-restore backup will be created first.`)) return;
      await api("/api/admin/restore", { method: "POST", body: JSON.stringify({ file: actionButton.dataset.file }) });
      state.systemHealth = null;
      await refresh();
      return;
    }
    if (action === "revoke-sessions") {
      await api("/api/sessions/revoke-others", { method: "POST" });
      await renderSessions();
      return;
    }
    if (action === "password-reset-token") {
      const result = await api(`/api/admin/users/${actionButton.dataset.user}/reset-token`, { method: "POST" });
      state.resetTokenMessage = `Reset token for ${result.user.displayName}: ${result.token} (expires ${new Date(result.expiresAt).toLocaleString()})`;
      await refresh();
      return;
    }
    if (action === "export-data") {
      window.location.href = "/api/admin/export";
      return;
    }
    if (action === "backup-sqlite") {
      window.location.href = "/api/admin/backup";
      return;
    }
    if (action === "draft-audio") {
      state.draftAudio = !state.draftAudio;
      if (state.draftAudio) playDraftTone("pick");
      render();
      return;
    }
    if (action === "draft-start") {
      await api("/api/admin/draft/start", { method: "POST", body: JSON.stringify({ rounds: state.data.league.draft.rounds || 15, resetRosters: true }) });
      await refresh();
    }
    if (action === "draft-test") {
      await api("/api/admin/draft/test", { method: "POST", body: JSON.stringify({ rounds: 15 }) });
      await refresh();
    }
    if (action === "draft-reset") {
      await api("/api/admin/draft/reset", { method: "POST" });
      await refresh();
    }
    if (action === "draft-pause") {
      await api("/api/admin/draft/pause", { method: "POST" });
      await refresh();
    }
    if (action === "draft-autopick") {
      await api("/api/admin/draft/autopick", { method: "POST" });
      await refresh();
    }
    if (action === "draft-undo") {
      await api("/api/admin/draft/undo", { method: "POST" });
      await refresh();
    }
    if (action === "draft-pick") {
      await api("/api/admin/draft/pick", { method: "POST", body: JSON.stringify({ playerId: actionButton.dataset.player }) });
      await refresh();
    }
    if (action === "draft-queue-add") {
      await api("/api/draft/queue", { method: "POST", body: JSON.stringify({ teamId: actionButton.dataset.team, playerId: actionButton.dataset.player }) });
      await refresh();
    }
    if (action === "draft-queue-remove") {
      await api(`/api/draft/queue/${actionButton.dataset.team}/${actionButton.dataset.player}`, { method: "DELETE" });
      await refresh();
    }
    if (action === "draft-keeper-remove") {
      await api(`/api/admin/draft/keepers/${actionButton.dataset.player}`, { method: "DELETE" });
      await refresh();
    }
    if (action === "ingest-stats") {
      await api("/api/admin/scoring/ingest", { method: "POST", body: JSON.stringify({ statType: "actual", season: state.data.meta.season, week: state.data.meta.currentWeek }) });
      await refresh();
    }
    if (action === "ingest-projections") {
      await api("/api/admin/scoring/ingest", { method: "POST", body: JSON.stringify({ statType: "projection", season: state.data.meta.season, week: state.data.meta.currentWeek }) });
      await refresh();
    }
    if (action === "process-week") {
      await api("/api/admin/scoring/process", { method: "POST", body: JSON.stringify({ season: state.data.meta.season, week: state.data.meta.currentWeek, finalize: false, useProjections: true }) });
      await refresh();
    }
    if (action === "finalize-week") {
      await api("/api/admin/scoring/process", { method: "POST", body: JSON.stringify({ season: state.data.meta.season, week: state.data.meta.currentWeek, finalize: true, useProjections: true }) });
      await refresh();
    }
    if (action === "process-waivers") {
      await api("/api/admin/waivers/process", { method: "POST" });
      await refresh();
    }
    if (action === "waiver-cancel") {
      await api(`/api/waivers/${actionButton.dataset.claim}`, { method: "DELETE" });
      await refresh();
    }
    if (action === "waiver-edit") {
      state.waiverEditId = state.waiverEditId === actionButton.dataset.claim ? null : actionButton.dataset.claim;
      render();
      return;
    }
    if (action === "waiver-move") {
      const activeTeam = myTeam();
      const ids = (state.data.waiverClaims || [])
        .filter((claim) => claim.teamId === activeTeam.id && claim.status === "pending")
        .sort((a, b) => (a.claimOrder || 0) - (b.claimOrder || 0) || a.createdAt - b.createdAt)
        .map((claim) => claim.id);
      const index = ids.indexOf(actionButton.dataset.claim);
      const delta = actionButton.dataset.direction === "up" ? -1 : 1;
      const swap = index + delta;
      if (index >= 0 && swap >= 0 && swap < ids.length) {
        [ids[index], ids[swap]] = [ids[swap], ids[index]];
        await api("/api/waivers/reorder", { method: "PUT", body: JSON.stringify({ teamId: activeTeam.id, claimIds: ids }) });
        await refresh();
      }
    }
    if (action === "validate-rosters") {
      const result = await api("/api/admin/rosters/validate");
      const target = document.querySelector("#roster-validation");
      if (target) target.innerHTML = result.validations.map((item) => `<p class="small"><strong>${item.teamName}</strong>: ${item.valid ? "Valid" : item.errors.join("; ")}</p>`).join("");
    }
    if (action === "select-slot") {
      state.selectedSlot = actionButton.dataset.slot;
      render();
      return;
    }
    if (action === "move-to-slot") {
      const activeTeam = myTeam();
      const slot = actionButton.dataset.slot;
      const playerId = actionButton.dataset.player;
      const lineup = currentLineup(activeTeam.id);
      const previousInSlot = lineup[slot];
      const previousSlotForPlayer = Object.entries(lineup).find(([, id]) => id === playerId)?.[0];
      if (previousSlotForPlayer) delete lineup[previousSlotForPlayer];
      lineup[slot] = playerId;
      if (previousInSlot && previousInSlot !== playerId && previousSlotForPlayer) lineup[previousSlotForPlayer] = previousInSlot;
      state.selectedSlot = slot;
      render();
      return;
    }
    if (action === "save-lineup") {
      const activeTeam = myTeam();
      const lineup = currentLineup(activeTeam.id);
      await api("/api/lineup", { method: "PUT", body: JSON.stringify({ teamId: activeTeam.id, lineup }) });
      delete state.lineupDrafts[activeTeam.id];
      await refresh();
    }
    if (action === "add-player") {
      const activeTeam = myTeam();
      const addPlayerId = actionButton.dataset.player;
      const bench = roster(activeTeam.id);
      const dropPlayerId = bench.length >= 15 ? bench[bench.length - 1].id : null;
      await api("/api/transactions/add-drop", { method: "POST", body: JSON.stringify({ teamId: activeTeam.id, addPlayerId, dropPlayerId }) });
      await refresh();
    }
    if (action === "trade-player") {
      state.tradeToTeam = actionButton.dataset.team;
      state.tradeRequestedIds = [actionButton.dataset.player];
      state.tradeCompareIds = [actionButton.dataset.player];
      navigate("players");
      return;
    }
    if (action === "compare-trade-form") {
      const form = actionButton.closest("form");
      state.tradeCompareIds = [
        ...selectedValues(form.elements.offeredPlayerIds),
        ...selectedValues(form.elements.requestedPlayerIds)
      ];
      render();
      return;
    }
    if (action === "trade-block-add") {
      const note = prompt("Trade block note", "Open to offers") || "";
      await api("/api/trade-block", { method: "POST", body: JSON.stringify({ teamId: actionButton.dataset.team || myTeam().id, playerId: actionButton.dataset.player, note }) });
      await refresh();
      return;
    }
    if (action === "trade-block-remove") {
      await api(`/api/trade-block/${actionButton.dataset.player}`, { method: "DELETE" });
      await refresh();
      return;
    }
    if (action === "counter-trade") {
      state.counterTradeId = state.counterTradeId === actionButton.dataset.trade ? null : actionButton.dataset.trade;
      render();
      return;
    }
    if (action?.startsWith("trade-")) {
      const statusMap = {
        "trade-accept": "accepted",
        "trade-decline": "declined",
        "trade-cancel": "cancelled",
        "trade-approve": "approved",
        "trade-veto": "vetoed"
      };
      await api(`/api/trades/${actionButton.dataset.trade}`, { method: "PUT", body: JSON.stringify({ status: statusMap[action] }) });
      await refresh();
    }
    if (action === "expire-trades") {
      await api("/api/admin/trades/expire", { method: "POST" });
      await refresh();
    }
  } catch (error) {
    setToast(error.message, "error");
    render();
  }
});

app.addEventListener("input", (event) => {
  const action = event.target.dataset.action;
  if (action === "filter") {
    state.filter = event.target.value;
    state.playersPage = 1;
    if (["players", "draft"].includes(state.view)) navigate(state.view, { filter: state.filter, page: 1 }, true);
    else render();
  }
  if (action === "position") {
    state.position = event.target.value;
    state.playersPage = 1;
    if (["players", "draft"].includes(state.view)) navigate(state.view, { position: state.position, page: 1 }, true);
    else render();
  }
  if (action === "select-team") { state.selectedTeam = event.target.value; state.selectedSlot = null; state.teamTab = "roster"; navigate("team", { tab: "roster", teamId: state.selectedTeam }); }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const kind = form.dataset.form;
  try {
    if (kind === "login") {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify(values) });
      state.user = result.user;
      state.data = await api("/api/bootstrap");
      if (!window.location.hash) navigate("dashboard", {}, true);
      else applyRouteFromLocation();
    }
    if (kind === "password-reset") {
      await api("/api/password-reset", { method: "POST", body: JSON.stringify(values) });
      state.resetTokenMessage = "Password reset complete. Sign in with the new password.";
      state.error = "";
      render();
      return;
    }
    if (kind === "chat") await api("/api/chat", { method: "POST", body: JSON.stringify(values) });
    if (kind === "add-user") await api("/api/admin/users", { method: "POST", body: JSON.stringify(values) });
    if (kind === "password") await api(`/api/admin/users/${form.dataset.user}/password`, { method: "PUT", body: JSON.stringify(values) });
    if (kind === "profile") await api("/api/profile", { method: "PUT", body: JSON.stringify(values) });
    if (kind === "self-password") await api("/api/profile/password", { method: "PUT", body: JSON.stringify(values) });
    if (kind === "team-settings") await api(`/api/teams/${form.dataset.team}`, { method: "PUT", body: JSON.stringify(values) });
    if (kind === "season-phase") await api("/api/admin/season/phase", { method: "PUT", body: JSON.stringify(values) });
    if (kind === "draft-config") await api("/api/admin/draft/config", { method: "PUT", body: JSON.stringify(draftConfigPayload(form)) });
    if (kind === "draft-keeper") await api("/api/admin/draft/keepers", { method: "POST", body: JSON.stringify(values) });
    if (kind === "draft-chat") await api("/api/draft/chat", { method: "POST", body: JSON.stringify(values) });
    if (kind === "correction") await api("/api/admin/scoring/corrections", { method: "POST", body: JSON.stringify({ ...values, season: state.data.meta.season, week: state.data.meta.currentWeek }) });
    if (kind === "waiver-claim") await api("/api/waivers", { method: "POST", body: JSON.stringify(values) });
    if (kind === "waiver-edit") {
      await api(`/api/waivers/${form.dataset.claim}`, { method: "PUT", body: JSON.stringify(values) });
      state.waiverEditId = null;
    }
    if (kind === "player-research") await api("/api/player-research", { method: "PUT", body: JSON.stringify(researchPayload(form)) });
    if (kind === "trade-offer") {
      await api("/api/trades", { method: "POST", body: JSON.stringify(tradePayload(form)) });
      state.tradeRequestedIds = [];
      state.tradeCompareIds = [];
    }
    if (kind === "trade-counter") {
      await api(`/api/trades/${form.dataset.trade}/counter`, { method: "POST", body: JSON.stringify(tradePayload(form)) });
      state.counterTradeId = null;
    }
    if (kind === "notifications") await api("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(notificationPayload(form)) });
    if (kind === "csv-import") await api("/api/admin/import/rosters", { method: "POST", body: JSON.stringify(values) });
    if (kind === "provider-settings") await api("/api/admin/provider/settings", { method: "PUT", body: JSON.stringify({ ...values, cacheSnapshots: values.cacheSnapshots === "on", manualImportAllowed: values.manualImportAllowed === "on" }) });
    if (kind === "manual-stats") await api("/api/admin/scoring/manual-import", { method: "POST", body: JSON.stringify(values) });
    if (kind === "league") await api("/api/admin/league", { method: "PUT", body: JSON.stringify(leaguePayload(form)) });
    state.error = "";
    setToast("Saved.", "success");
    await refresh();
  } catch (error) {
    state.error = error.message;
    setToast(error.message, "error");
    render();
  }
});

bootstrap();

function selectedValues(select) {
  return Array.from(select?.selectedOptions || []).map((option) => option.value);
}

function tradePayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  return {
    fromTeamId: values.fromTeamId,
    toTeamId: values.toTeamId,
    offeredPlayerIds: selectedValues(form.elements.offeredPlayerIds),
    requestedPlayerIds: selectedValues(form.elements.requestedPlayerIds),
    message: values.message || ""
  };
}

function researchPayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  return {
    playerId: values.playerId,
    note: values.note || "",
    watchlist: Boolean(form.elements.watchlist?.checked)
  };
}

function draftConfigPayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const order = Object.entries(values)
    .filter(([key]) => key.startsWith("order_"))
    .sort(([a], [b]) => Number(a.replace("order_", "")) - Number(b.replace("order_", "")))
    .map(([, value]) => value);
  return {
    rounds: Number(values.rounds || 15),
    pickTimeSeconds: Number(values.pickTimeSeconds || 60),
    orderStyle: values.orderStyle || "snake",
    order
  };
}

function leaguePayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const checked = (name) => form.elements[name]?.checked || false;
  const number = (name) => Number(values[name] || 0);
  const scoring = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("score_")) scoring[key.replace("score_", "")] = Number(value);
  }
  return {
    name: values.name,
    season: number("season"),
    currentWeek: number("currentWeek"),
    settings: {
      scoringType: values.scoringType,
      maxTeams: number("maxTeams"),
      maxRosterSize: number("maxRosterSize"),
      maxAcquisitions: values.maxAcquisitions,
      maxTrades: values.maxTrades,
      fractionalPoints: checked("fractionalPoints"),
      negativePoints: checked("negativePoints"),
      publicViewable: checked("publicViewable")
    },
    roster: {
      starters: values.starters.split(",").map((slot) => slot.trim()).filter(Boolean),
      bench: number("bench"),
      ir: number("ir")
    },
    waiver: {
      type: values.waiverType,
      periodDays: number("waiverPeriodDays"),
      weekly: values.weeklyWaivers,
      mode: values.waiverType?.toLowerCase().includes("rolling") ? "rolling" : "custom",
      processDay: values.weeklyWaivers,
      budget: 0,
      allowFreeAgentAdds: checked("allowFreeAgentAdds"),
      allowWaiverAdds: checked("allowWaiverAdds"),
      allowInjuredToIR: checked("allowInjuredToIR")
    },
    trade: {
      review: values.tradeReview,
      rejectionDays: number("tradeRejectionDays"),
      allowDraftPickTrades: checked("allowDraftPickTrades")
    },
    draft: {
      type: values.draftType,
      pickTimeSeconds: number("pickTimeSeconds")
    },
    playoffs: {
      teams: number("playoffTeams"),
      weeks: values.playoffWeeks,
      consolationTeams: number("consolationTeams"),
      reseeding: checked("playoffReseeding"),
      lockEliminatedTeams: checked("lockEliminatedTeams")
    },
    scoring
  };
}

function notificationPayload(form) {
  const checked = (name) => form.elements[name]?.checked || false;
  return {
    preferences: {
      local: true,
      pushReady: checked("pushReady"),
      categories: {
        roster: checked("notify_roster"),
        draft: checked("notify_draft"),
        trade: checked("notify_trade"),
        waiver: checked("notify_waiver"),
        scoring: checked("notify_scoring"),
        commissioner: checked("notify_commissioner"),
        chat: checked("notify_chat")
      }
    }
  };
}
