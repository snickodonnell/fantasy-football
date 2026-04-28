import http from "node:http";
import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "app.sqlite");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const PUBLIC_DIR = path.join(__dirname, "public");
loadEnvFile(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-session-secret-change-me";
const DEFAULT_SESSION_SECRET = "local-dev-session-secret-change-me";
const BACKUP_RETENTION = Math.max(1, Number(process.env.BACKUP_RETENTION || 14));
const BACKUP_INTERVAL_HOURS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24));
const LAN_ALLOWLIST = (process.env.LAN_ALLOWLIST || "").split(",").map((item) => item.trim()).filter(Boolean);
const rateBuckets = new Map();
let scheduledBackupTimer = null;

if (SESSION_SECRET === DEFAULT_SESSION_SECRET && !process.argv.includes("--seed")) {
  console.warn("WARNING: using the default SESSION_SECRET. Set a long random SESSION_SECRET in .env before sharing this app beyond local development.");
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional for local development.
  }
}

const positions = ["QB", "WR", "WR", "RB", "RB", "TE", "FLEX", "K", "D/ST"];
const benchSlots = 6;
const irSlots = 2;
const familyManagers = [
  { id: "u1", username: "admin", displayName: "Nick", role: "commissioner", teamId: "t1" },
  { id: "u2", username: "emily", displayName: "Emily", role: "manager", teamId: "t2" },
  { id: "u3", username: "hadley", displayName: "Hadley", role: "manager", teamId: "t3" },
  { id: "u4", username: "sarahkate", displayName: "Sarah Kate", role: "manager", teamId: "t4" },
  { id: "u5", username: "dawson", displayName: "Dawson", role: "manager", teamId: "t5" },
  { id: "u6", username: "sawyer", displayName: "Sawyer", role: "manager", teamId: "t6" }
];

const yahooDefaultRules = {
  source: "Yahoo default football settings",
  scoringType: "Head-to-Head Points",
  maxTeams: 10,
  maxRosterSize: 15,
  maxAcquisitions: "No maximum",
  maxTrades: "No maximum",
  fractionalPoints: true,
  negativePoints: true,
  invitePermissions: "Commissioner Only",
  publicViewable: false,
  rosterChanges: "Weekly",
  postDraftPlayers: "Follow Waiver Rules",
  playoffs: { teams: 4, weeks: "16 & 17", consolationTeams: 4, byeWeeks: "None", reseeding: true, tieBreaker: "Higher seed wins", lockEliminatedTeams: true },
  trade: { review: "Commissioner", rejectionDays: 2, deadline: "Season default", allowDraftPickTrades: false },
  waiver: { periodDays: 2, type: "Continual rolling list", weekly: "Game Time - Tuesday", allowInjuredToIR: true, mode: "rolling", processDay: "Tuesday", budget: 100 },
  draft: { type: "Live Standard Draft", status: "not_started", pickTimeSeconds: 60, positionLimits: { QB: 4, RB: 6, WR: 8, TE: 4, K: 4, "D/ST": 4 } },
  scoring: {
    reception: 0.5,
    passYards: 0.04,
    passTd: 4,
    interception: -1,
    rushYards: 0.1,
    rushTd: 6,
    receivingYards: 0.1,
    receivingTd: 6,
    returnTd: 6,
    offensiveFumbleReturnTd: 6,
    twoPointConversion: 2,
    fumbleLost: -2,
    fieldGoal019: 3,
    fieldGoal2029: 3,
    fieldGoal3039: 3,
    fieldGoal4049: 4,
    fieldGoal50: 5,
    extraPoint: 1,
    defenseSack: 1,
    defenseInterception: 2,
    defenseFumbleRecovery: 2,
    defenseTouchdown: 6,
    defenseSafety: 2,
    defenseBlockedKick: 2,
    defenseReturnTd: 6,
    pointsAllowed0: 10,
    pointsAllowed1To6: 7,
    pointsAllowed7To13: 4,
    pointsAllowed14To20: 1,
    pointsAllowed21To27: 0,
    pointsAllowed28To34: -1,
    pointsAllowed35Plus: -4
  }
};

const samplePlayers = [
  ["p1", "Josh Allen", "QB", "BUF", "BUF @ NYJ", 24.6, "Healthy"],
  ["p2", "Christian McCaffrey", "RB", "SF", "SF @ CLE", 18.2, "Healthy"],
  ["p3", "Breece Hall", "RB", "NYJ", "BUF @ NYJ", 15.3, "Healthy"],
  ["p4", "Justin Jefferson", "WR", "MIN", "MIN @ CHI", 19.7, "Questionable"],
  ["p5", "Amon-Ra St. Brown", "WR", "DET", "DET @ TB", 16.8, "Healthy"],
  ["p6", "Trey McBride", "TE", "ARI", "ARI @ LAR", 10.9, "Healthy"],
  ["p7", "DeVonta Smith", "WR", "PHI", "PHI @ DAL", 13.1, "Healthy"],
  ["p8", "49ers D/ST", "D/ST", "SF", "SF @ CLE", 8.4, "Healthy"],
  ["p9", "Brandon Aubrey", "K", "DAL", "DAL vs PHI", 9.1, "Healthy"],
  ["p10", "James Conner", "RB", "ARI", "ARI @ LAR", 12.4, "Healthy"],
  ["p11", "Zay Flowers", "WR", "BAL", "BAL vs CIN", 9.8, "Healthy"],
  ["p12", "Jonathan Downs", "WR", "IND", "IND @ JAX", 7.6, "Out"],
  ["p13", "Tank Dell", "WR", "HOU", "HOU @ NE", 8.1, "Healthy"],
  ["p14", "Evan Engram", "TE", "JAX", "JAX vs IND", 6.7, "Questionable"],
  ["p15", "Jalen McMillan", "WR", "TB", "TB vs DET", 6.2, "Healthy"],
  ["p16", "Patrick Mahomes", "QB", "KC", "KC @ DEN", 25.1, "Healthy"],
  ["p17", "Bijan Robinson", "RB", "ATL", "ATL vs CAR", 17.2, "Healthy"],
  ["p18", "Ja'Marr Chase", "WR", "CIN", "CIN @ BAL", 18.8, "Healthy"],
  ["p19", "Travis Kelce", "TE", "KC", "KC @ DEN", 11.3, "Healthy"],
  ["p20", "CeeDee Lamb", "WR", "DAL", "DAL vs PHI", 18.6, "Healthy"],
  ["p21", "Saquon Barkley", "RB", "PHI", "PHI @ DAL", 16.4, "Healthy"],
  ["p22", "Lamar Jackson", "QB", "BAL", "BAL vs CIN", 24.3, "Healthy"],
  ["p23", "Puka Nacua", "WR", "LAR", "LAR vs ARI", 15.6, "Healthy"],
  ["p24", "A.J. Brown", "WR", "PHI", "PHI @ DAL", 16.1, "Healthy"],
  ["p25", "Caleb Williams", "QB", "CHI", "CHI vs MIN", 18.5, "Healthy"],
  ["p26", "Jayden Daniels", "QB", "WAS", "WAS vs NYG", 21.1, "Healthy"],
  ["p27", "Jahmyr Gibbs", "RB", "DET", "DET @ TB", 17.6, "Healthy"],
  ["p28", "Isiah Pacheco", "RB", "KC", "KC @ DEN", 13.9, "Questionable"],
  ["p29", "Rachaad White", "RB", "TB", "TB vs DET", 11.8, "Healthy"],
  ["p30", "Garrett Wilson", "WR", "NYJ", "BUF @ NYJ", 15.2, "Healthy"],
  ["p31", "Chris Olave", "WR", "NO", "NO vs ATL", 13.8, "Healthy"],
  ["p32", "Rome Odunze", "WR", "CHI", "CHI vs MIN", 10.1, "Healthy"],
  ["p33", "George Kittle", "TE", "SF", "SF @ CLE", 10.4, "Healthy"],
  ["p34", "Dalton Kincaid", "TE", "BUF", "BUF @ NYJ", 9.6, "Healthy"],
  ["p35", "Ravens D/ST", "D/ST", "BAL", "BAL vs CIN", 8.7, "Healthy"],
  ["p36", "Cowboys D/ST", "D/ST", "DAL", "DAL vs PHI", 7.9, "Healthy"],
  ["p37", "Justin Tucker", "K", "BAL", "BAL vs CIN", 8.8, "Healthy"],
  ["p38", "Harrison Butker", "K", "KC", "KC @ DEN", 8.5, "Healthy"],
  ["p39", "Jordan Addison", "WR", "MIN", "MIN @ CHI", 9.4, "Out"],
  ["p40", "Tyjae Spears", "RB", "TEN", "TEN vs HOU", 8.9, "Healthy"]
].map(([id, name, position, nflTeam, opponent, projection, status]) => ({
  id, name, position, nflTeam, opponent, projection, status, ownership: null, locked: false
}));

function initialDb() {
  const teams = familyManagers.map((manager, index) => ({
    id: manager.teamId,
    name: `${manager.displayName}'s Team`,
    manager: initialsFor(manager.displayName),
    ownerUserId: manager.id,
    logoUrl: "",
    color: teamColors[index % teamColors.length],
    wins: index < 3 ? 3 : 2,
    losses: index < 3 ? 2 : 3,
    ties: 0,
    waiverRank: index + 1
  }));
  const rosters = {
    t1: ["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10","p11","p12","p13","p14","p15"],
    t2: ["p16","p17","p18","p19","p20","p21"],
    t3: ["p22","p23","p24"],
    t4: [], t5: [], t6: []
  };
  const players = samplePlayers.map((player) => {
    const teamId = Object.keys(rosters).find((id) => rosters[id].includes(player.id)) || null;
    return { ...player, ownership: teamId };
  });
  return {
    meta: { version: 1, seededAt: new Date().toISOString(), currentWeek: 6, season: 2026, seasonPhase: "regular_season" },
    users: familyManagers.map((manager) => makeUser(manager.id, manager.username, manager.displayName, manager.role, "password")),
    sessions: [],
    league: {
      id: "league-1",
      name: "The Anderson Family League",
      scoring: yahooDefaultRules.scoring,
      settings: {
        source: yahooDefaultRules.source,
        scoringType: yahooDefaultRules.scoringType,
        maxTeams: yahooDefaultRules.maxTeams,
        maxRosterSize: yahooDefaultRules.maxRosterSize,
        maxAcquisitions: yahooDefaultRules.maxAcquisitions,
        maxTrades: yahooDefaultRules.maxTrades,
        fractionalPoints: yahooDefaultRules.fractionalPoints,
        negativePoints: yahooDefaultRules.negativePoints,
        invitePermissions: yahooDefaultRules.invitePermissions,
        publicViewable: yahooDefaultRules.publicViewable,
        rosterChanges: yahooDefaultRules.rosterChanges,
        postDraftPlayers: yahooDefaultRules.postDraftPlayers
      },
      roster: { starters: positions, bench: benchSlots, ir: irSlots },
      waiver: yahooDefaultRules.waiver,
      trade: yahooDefaultRules.trade,
      playoffs: yahooDefaultRules.playoffs,
      draft: makeDraftState(teams.map((team) => team.id))
    },
    teams,
    players,
    lineups: {
      t1: { QB: "p1", RB: "p2", RB2: "p3", WR: "p4", WR2: "p5", TE: "p6", FLEX: "p7", "D/ST": "p8", K: "p9" },
      t2: { QB: "p16", RB: "p17", RB2: "p21", WR: "p18", WR2: "p20", TE: "p19" },
      t3: { QB: "p22", WR: "p23", WR2: "p24" }
    },
    matchups: [
      { id: "m1", week: 6, homeTeamId: "t1", awayTeamId: "t2", homeScore: 118.4, awayScore: 110.2, status: "preview" },
      { id: "m2", week: 6, homeTeamId: "t3", awayTeamId: "t4", homeScore: 96.2, awayScore: 101.7, status: "preview" },
      { id: "m3", week: 6, homeTeamId: "t5", awayTeamId: "t6", homeScore: 104.5, awayScore: 98.1, status: "preview" }
    ],
    transactions: [
      { id: "tx1", type: "add", teamId: "t1", playerId: "p11", note: "Sophie A. added Zay Flowers", createdAt: Date.now() - 7200000 },
      { id: "tx2", type: "drop", teamId: "t3", playerName: "Rashad Penny", note: "Mike M. dropped Rashad Penny", createdAt: Date.now() - 10800000 },
      { id: "tx3", type: "win", teamId: "t2", note: "The Parkers won vs The Thompsons", createdAt: Date.now() - 86400000 }
    ],
    waiverClaims: [],
    trades: [],
    chat: [
      { id: "c1", author: "Mom", body: "Great win this week, everyone!", createdAt: Date.now() - 3600000 },
      { id: "c2", author: "Dad", body: "Those Thursday night games are going to be huge.", createdAt: Date.now() - 1800000 },
      { id: "c3", author: "Uncle Mike", body: "Let's keep it friendly and have fun. Good luck all!", createdAt: Date.now() - 900000 }
    ],
    providerSync: { provider: "mock", lastRunAt: null, message: "Using seeded local data until an API key is configured.", nextPlayerCursor: null, details: {} },
    activityEvents: [],
    notificationPreferences: familyManagers.map((manager) => defaultNotificationPreferences(manager.id)),
    nflTeams: [],
    nflGames: [],
    nflPlayerStats: [],
    providerPlayers: [],
    providerTrending: [],
    weeklyPlayerStats: [],
    scoreCorrections: [],
    lineupLocks: [],
    playerResearch: [],
    tradeBlock: []
  };
}

const teamColors = ["#4f7ee8", "#49a464", "#8a5cf6", "#f59e0b", "#e76565", "#14b8a6"];

function initialsFor(value = "") {
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function makeUser(id, username, displayName, role, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { id, username, displayName, role, passwordHash: hashPassword(password, salt), salt, email: "", profileVisibility: "league", createdAt: Date.now() };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, email: user.email || "", profileVisibility: user.profileVisibility || "league", teamId: user.teamId || null };
}

function defaultDelivery() {
  return { local: true, pushReady: true, pushedAt: null, pushProvider: null };
}

function defaultNotificationPreferences(userId) {
  return {
    userId,
    preferences: {
      local: true,
      pushReady: false,
      categories: {
        roster: true,
        draft: true,
        trade: true,
        waiver: true,
        scoring: true,
        commissioner: true,
        chat: true
      }
    },
    updatedAt: Date.now()
  };
}

function mergeNotificationPreferences(current = {}, incoming = {}) {
  return {
    ...current,
    ...incoming,
    categories: {
      ...(current.categories || {}),
      ...(incoming.categories || {})
    }
  };
}

function normalizeNotificationPreferences(db) {
  const existing = new Map((db.notificationPreferences || []).map((pref) => [pref.userId, pref]));
  return (db.users || []).map((user) => existing.get(user.id) || defaultNotificationPreferences(user.id));
}

function makeDraftState(order = []) {
  return {
    ...yahooDefaultRules.draft,
    status: "not_started",
    order,
    rounds: 15,
    orderStyle: "snake",
    currentPick: 1,
    startedAt: null,
    clockStartedAt: null,
    completedAt: null,
    picks: [],
    queues: Object.fromEntries(order.map((teamId) => [teamId, []])),
    chat: [],
    keepers: [],
    mode: "snake"
  };
}

let sqlite;

async function getSqlite() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!sqlite) {
    sqlite = new DatabaseSync(DB_PATH);
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    runMigrations(sqlite);
  }
  return sqlite;
}

function closeSqlite() {
  if (!sqlite) return;
  sqlite.close();
  sqlite = null;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      profile_visibility TEXT NOT NULL DEFAULT 'league',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS league (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      roster_json TEXT NOT NULL,
      waiver_json TEXT NOT NULL,
      trade_json TEXT NOT NULL,
      playoffs_json TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      scoring_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manager TEXT NOT NULL,
      owner_user_id TEXT,
      logo_url TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#4f7ee8',
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      ties INTEGER NOT NULL,
      waiver_rank INTEGER NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position TEXT NOT NULL,
      nfl_team TEXT NOT NULL,
      opponent TEXT NOT NULL,
      projection REAL NOT NULL,
      status TEXT NOT NULL,
      ownership TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (ownership) REFERENCES teams(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS lineups (
      team_id TEXT PRIMARY KEY,
      lineup_json TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS matchups (
      id TEXT PRIMARY KEY,
      week INTEGER NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score REAL NOT NULL,
      away_score REAL NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      team_id TEXT,
      player_id TEXT,
      player_name TEXT,
      note TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS waiver_claims (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      add_player_id TEXT NOT NULL,
      drop_player_id TEXT,
      bid REAL NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      from_team_id TEXT NOT NULL,
      to_team_id TEXT NOT NULL,
      offered_player_ids_json TEXT NOT NULL,
      requested_player_ids_json TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_research (
      user_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      watchlist INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, player_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS trade_block (
      team_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, player_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chat (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_sync (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      last_run_at TEXT,
      message TEXT NOT NULL,
      next_player_cursor TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS nfl_teams (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      conference TEXT,
      division TEXT,
      location TEXT,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nfl_games (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      season INTEGER,
      week INTEGER,
      status TEXT,
      date TEXT,
      home_team_provider_id TEXT,
      visitor_team_provider_id TEXT,
      home_score REAL,
      visitor_score REAL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nfl_player_stats (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      player_provider_id TEXT,
      game_provider_id TEXT,
      season INTEGER,
      week INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_players (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      position TEXT,
      fantasy_positions_json TEXT NOT NULL DEFAULT '[]',
      team TEXT,
      status TEXT,
      injury_status TEXT,
      search_rank INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_trending (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      trend_type TEXT NOT NULL,
      count INTEGER NOT NULL,
      lookback_hours INTEGER NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_player_stats (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      app_player_id TEXT,
      season INTEGER NOT NULL,
      week INTEGER NOT NULL,
      stat_type TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      fantasy_points REAL NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS score_corrections (
      id TEXT PRIMARY KEY,
      season INTEGER NOT NULL,
      week INTEGER NOT NULL,
      team_id TEXT,
      player_id TEXT,
      points_delta REAL NOT NULL,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lineup_locks (
      id TEXT PRIMARY KEY,
      season INTEGER NOT NULL,
      week INTEGER NOT NULL,
      team_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      locked_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      actor_user_id TEXT,
      team_id TEXT,
      player_id TEXT,
      metadata_json TEXT NOT NULL,
      visible_to_json TEXT NOT NULL,
      read_by_json TEXT NOT NULL,
      delivery_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY,
      preferences_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'));
  `);
  migrateColumn(db, "provider_sync", "next_player_cursor", "TEXT");
  migrateColumn(db, "provider_sync", "details_json", "TEXT NOT NULL DEFAULT '{}'");
  migrateColumn(db, "users", "email", "TEXT NOT NULL DEFAULT ''");
  migrateColumn(db, "users", "profile_visibility", "TEXT NOT NULL DEFAULT 'league'");
  migrateColumn(db, "teams", "logo_url", "TEXT NOT NULL DEFAULT ''");
  migrateColumn(db, "teams", "color", "TEXT NOT NULL DEFAULT '#4f7ee8'");
  migrateColumn(db, "waiver_claims", "claim_order", "INTEGER NOT NULL DEFAULT 0");
  migrateColumn(db, "waiver_claims", "priority", "INTEGER");
  migrateColumn(db, "waiver_claims", "reason", "TEXT NOT NULL DEFAULT ''");
  migrateColumn(db, "waiver_claims", "processed_at", "INTEGER");
  migrateColumn(db, "trades", "accepted_at", "INTEGER");
  migrateColumn(db, "trades", "reviewed_by", "TEXT");
  migrateColumn(db, "trades", "review_note", "TEXT NOT NULL DEFAULT ''");
  migrateColumn(db, "trades", "completed_at", "INTEGER");
  migrateColumn(db, "trades", "expires_at", "INTEGER");
  migrateColumn(db, "trades", "parent_trade_id", "TEXT");
  applySchemaVersion(db, 2, () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_players_ownership ON players(ownership);
      CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
      CREATE INDEX IF NOT EXISTS idx_waiver_claims_team_status ON waiver_claims(team_id, status, claim_order);
      CREATE INDEX IF NOT EXISTS idx_trades_team_status ON trades(from_team_id, to_team_id, status);
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_weekly_stats_player_week ON weekly_player_stats(app_player_id, season, week, stat_type);
      CREATE INDEX IF NOT EXISTS idx_matchups_week ON matchups(week);
    `);
  });
  db.exec("PRAGMA optimize");
}

function migrateColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function applySchemaVersion(db, version, fn) {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
  if (applied) return;
  fn();
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))").run(version);
}

async function loadDb() {
  const db = await getSqlite();
  const hasData = db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0;
  if (!hasData) await saveDb(initialDb());

  const metaRows = db.prepare("SELECT key, value FROM meta").all();
  const meta = Object.fromEntries(metaRows.map((row) => [row.key, parseJson(row.value)]));
  const leagueRow = db.prepare("SELECT * FROM league LIMIT 1").get();
  const providerRow = db.prepare("SELECT * FROM provider_sync WHERE id = 1").get();

  return {
    meta,
    users: db.prepare("SELECT * FROM users ORDER BY created_at").all().map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      passwordHash: row.password_hash,
      salt: row.salt,
      email: row.email || "",
      profileVisibility: row.profile_visibility || "league",
      createdAt: row.created_at
    })),
    sessions: db.prepare("SELECT * FROM sessions").all().map((row) => ({
      token: row.token,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    })),
    league: {
      id: leagueRow.id,
      name: leagueRow.name,
      settings: parseJson(leagueRow.settings_json),
      roster: parseJson(leagueRow.roster_json),
      waiver: parseJson(leagueRow.waiver_json),
      trade: parseJson(leagueRow.trade_json),
      playoffs: parseJson(leagueRow.playoffs_json),
      draft: parseJson(leagueRow.draft_json),
      scoring: parseJson(leagueRow.scoring_json)
    },
    teams: db.prepare("SELECT * FROM teams ORDER BY waiver_rank").all().map((row) => ({
      id: row.id,
      name: row.name,
      manager: row.manager,
      ownerUserId: row.owner_user_id,
      logoUrl: row.logo_url || "",
      color: row.color || "#4f7ee8",
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      waiverRank: row.waiver_rank
    })),
    players: db.prepare("SELECT * FROM players ORDER BY name").all().map((row) => ({
      id: row.id,
      name: row.name,
      position: row.position,
      nflTeam: row.nfl_team,
      opponent: row.opponent,
      projection: row.projection,
      status: row.status,
      ownership: row.ownership,
      locked: Boolean(row.locked)
    })),
    lineups: Object.fromEntries(db.prepare("SELECT * FROM lineups").all().map((row) => [row.team_id, parseJson(row.lineup_json)])),
    matchups: db.prepare("SELECT * FROM matchups ORDER BY week, id").all().map((row) => ({
      id: row.id,
      week: row.week,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeScore: row.home_score,
      awayScore: row.away_score,
      status: row.status
    })),
    transactions: db.prepare("SELECT * FROM transactions ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      type: row.type,
      teamId: row.team_id,
      playerId: row.player_id,
      playerName: row.player_name,
      note: row.note,
      createdAt: row.created_at
    })),
    waiverClaims: db.prepare("SELECT * FROM waiver_claims ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      teamId: row.team_id,
      addPlayerId: row.add_player_id,
      dropPlayerId: row.drop_player_id,
      bid: row.bid,
      status: row.status,
      createdAt: row.created_at,
      claimOrder: row.claim_order || 0,
      reason: row.reason || "",
      processedAt: row.processed_at,
      priority: row.priority
    })),
    trades: db.prepare("SELECT * FROM trades ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      fromTeamId: row.from_team_id,
      toTeamId: row.to_team_id,
      offeredPlayerIds: parseJson(row.offered_player_ids_json),
      requestedPlayerIds: parseJson(row.requested_player_ids_json),
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note || "",
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      parentTradeId: row.parent_trade_id
    })),
    playerResearch: db.prepare("SELECT * FROM player_research").all().map((row) => ({
      userId: row.user_id,
      playerId: row.player_id,
      note: row.note,
      watchlist: Boolean(row.watchlist),
      updatedAt: row.updated_at
    })),
    tradeBlock: db.prepare("SELECT * FROM trade_block ORDER BY created_at DESC").all().map((row) => ({
      teamId: row.team_id,
      playerId: row.player_id,
      note: row.note,
      createdAt: row.created_at
    })),
    chat: db.prepare("SELECT * FROM chat ORDER BY created_at").all().map((row) => ({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at
    })),
    providerSync: providerRow ? {
      provider: providerRow.provider,
      lastRunAt: providerRow.last_run_at,
      message: providerRow.message,
      nextPlayerCursor: providerRow.next_player_cursor,
      details: parseJson(providerRow.details_json || "{}")
    } : { provider: "mock", lastRunAt: null, message: "Using seeded local data until an API key is configured.", nextPlayerCursor: null, details: {} },
    nflTeams: db.prepare("SELECT * FROM nfl_teams ORDER BY abbreviation").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      conference: row.conference,
      division: row.division,
      location: row.location,
      name: row.name,
      fullName: row.full_name,
      abbreviation: row.abbreviation,
      syncedAt: row.synced_at
    })),
    nflGames: db.prepare("SELECT * FROM nfl_games ORDER BY date, provider_id").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      season: row.season,
      week: row.week,
      status: row.status,
      date: row.date,
      homeTeamProviderId: row.home_team_provider_id,
      visitorTeamProviderId: row.visitor_team_provider_id,
      homeScore: row.home_score,
      visitorScore: row.visitor_score,
      syncedAt: row.synced_at
    })),
    nflPlayerStats: db.prepare("SELECT * FROM nfl_player_stats ORDER BY synced_at DESC LIMIT 500").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      playerProviderId: row.player_provider_id,
      gameProviderId: row.game_provider_id,
      season: row.season,
      week: row.week,
      syncedAt: row.synced_at
    })),
    providerPlayers: db.prepare("SELECT * FROM provider_players ORDER BY search_rank IS NULL, search_rank, name").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      name: row.name,
      firstName: row.first_name,
      lastName: row.last_name,
      position: row.position,
      fantasyPositions: parseJson(row.fantasy_positions_json || "[]"),
      team: row.team,
      status: row.status,
      injuryStatus: row.injury_status,
      searchRank: row.search_rank,
      syncedAt: row.synced_at
    })),
    providerTrending: db.prepare("SELECT * FROM provider_trending ORDER BY trend_type, count DESC").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      trendType: row.trend_type,
      count: row.count,
      lookbackHours: row.lookback_hours,
      syncedAt: row.synced_at
    })),
    weeklyPlayerStats: db.prepare("SELECT * FROM weekly_player_stats ORDER BY season DESC, week DESC, fantasy_points DESC").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      providerId: row.provider_id,
      appPlayerId: row.app_player_id,
      season: row.season,
      week: row.week,
      statType: row.stat_type,
      stats: parseJson(row.stats_json || "{}"),
      fantasyPoints: row.fantasy_points,
      raw: parseJson(row.raw_json || "{}"),
      syncedAt: row.synced_at
    })),
    scoreCorrections: db.prepare("SELECT * FROM score_corrections ORDER BY created_at DESC").all().map((row) => ({
      id: row.id,
      season: row.season,
      week: row.week,
      teamId: row.team_id,
      playerId: row.player_id,
      pointsDelta: row.points_delta,
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at
    })),
    lineupLocks: db.prepare("SELECT * FROM lineup_locks ORDER BY locked_at DESC").all().map((row) => ({
      id: row.id,
      season: row.season,
      week: row.week,
      teamId: row.team_id,
      playerId: row.player_id,
      lockedAt: row.locked_at,
      reason: row.reason
    })),
    activityEvents: db.prepare("SELECT * FROM activity_events ORDER BY created_at DESC LIMIT 500").all().map((row) => ({
      id: row.id,
      type: row.type,
      category: row.category,
      title: row.title,
      body: row.body,
      actorUserId: row.actor_user_id,
      teamId: row.team_id,
      playerId: row.player_id,
      metadata: parseJson(row.metadata_json || "{}"),
      visibleTo: parseJson(row.visible_to_json || "[]"),
      readBy: parseJson(row.read_by_json || "[]"),
      delivery: parseJson(row.delivery_json || "{}"),
      createdAt: row.created_at
    })),
    notificationPreferences: db.prepare("SELECT * FROM notification_preferences").all().map((row) => ({
      userId: row.user_id,
      preferences: parseJson(row.preferences_json || "{}"),
      updatedAt: row.updated_at
    }))
  };
}

async function loadDbForCheck() {
  return loadDb();
}

async function saveDb(data) {
  const db = await getSqlite();
  const json = (value) => JSON.stringify(value ?? null);
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const table of ["notification_preferences", "activity_events", "lineup_locks", "score_corrections", "weekly_player_stats", "provider_trending", "provider_players", "nfl_player_stats", "nfl_games", "nfl_teams", "provider_sync", "chat", "trade_block", "player_research", "trades", "waiver_claims", "transactions", "matchups", "lineups", "players", "teams", "league", "sessions", "users", "meta"]) {
      db.exec(`DELETE FROM ${table}`);
    }

    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(data.meta || {})) insertMeta.run(key, json(value));

    const insertUser = db.prepare("INSERT INTO users (id, username, display_name, role, password_hash, salt, email, profile_visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const user of data.users) insertUser.run(user.id, user.username, user.displayName, user.role, user.passwordHash, user.salt, user.email || "", user.profileVisibility || "league", user.createdAt);

    const insertSession = db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)");
    for (const session of data.sessions) insertSession.run(session.token, session.userId, session.createdAt, session.expiresAt);

    db.prepare("INSERT INTO league (id, name, settings_json, roster_json, waiver_json, trade_json, playoffs_json, draft_json, scoring_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(data.league.id, data.league.name, json(data.league.settings || {}), json(data.league.roster || {}), json(data.league.waiver || {}), json(data.league.trade || {}), json(data.league.playoffs || {}), json(data.league.draft || {}), json(data.league.scoring || {}));

    const insertTeam = db.prepare("INSERT INTO teams (id, name, manager, owner_user_id, logo_url, color, wins, losses, ties, waiver_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const team of data.teams) insertTeam.run(team.id, team.name, team.manager, team.ownerUserId, team.logoUrl || "", team.color || "#4f7ee8", team.wins, team.losses, team.ties, team.waiverRank);

    const insertPlayer = db.prepare("INSERT INTO players (id, name, position, nfl_team, opponent, projection, status, ownership, locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const player of data.players) insertPlayer.run(player.id, player.name, player.position, player.nflTeam, player.opponent, player.projection, player.status, player.ownership, player.locked ? 1 : 0);

    const insertLineup = db.prepare("INSERT INTO lineups (team_id, lineup_json) VALUES (?, ?)");
    for (const [teamId, lineup] of Object.entries(data.lineups || {})) insertLineup.run(teamId, json(lineup));

    const insertMatchup = db.prepare("INSERT INTO matchups (id, week, home_team_id, away_team_id, home_score, away_score, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const matchup of data.matchups) insertMatchup.run(matchup.id, matchup.week, matchup.homeTeamId, matchup.awayTeamId, matchup.homeScore, matchup.awayScore, matchup.status);

    const insertTransaction = db.prepare("INSERT INTO transactions (id, type, team_id, player_id, player_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const tx of data.transactions) insertTransaction.run(tx.id, tx.type, tx.teamId || null, tx.playerId || null, tx.playerName || null, tx.note, tx.createdAt);

    const insertClaim = db.prepare("INSERT INTO waiver_claims (id, team_id, add_player_id, drop_player_id, bid, status, created_at, claim_order, priority, reason, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const claim of data.waiverClaims) {
      insertClaim.run(claim.id, claim.teamId, claim.addPlayerId, claim.dropPlayerId || null, claim.bid, claim.status, claim.createdAt, claim.claimOrder || 0, claim.priority ?? null, claim.reason || "", claim.processedAt || null);
    }

    const insertTrade = db.prepare("INSERT INTO trades (id, from_team_id, to_team_id, offered_player_ids_json, requested_player_ids_json, message, status, created_at, accepted_at, reviewed_by, review_note, completed_at, expires_at, parent_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const trade of data.trades) {
      insertTrade.run(trade.id, trade.fromTeamId, trade.toTeamId, json(trade.offeredPlayerIds), json(trade.requestedPlayerIds), trade.message, trade.status, trade.createdAt, trade.acceptedAt || null, trade.reviewedBy || null, trade.reviewNote || "", trade.completedAt || null, trade.expiresAt || null, trade.parentTradeId || null);
    }

    const insertResearch = db.prepare("INSERT INTO player_research (user_id, player_id, note, watchlist, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const item of data.playerResearch || []) insertResearch.run(item.userId, item.playerId, item.note || "", item.watchlist ? 1 : 0, item.updatedAt || Date.now());

    const insertTradeBlock = db.prepare("INSERT INTO trade_block (team_id, player_id, note, created_at) VALUES (?, ?, ?, ?)");
    for (const item of data.tradeBlock || []) insertTradeBlock.run(item.teamId, item.playerId, item.note || "", item.createdAt || Date.now());

    const insertChat = db.prepare("INSERT INTO chat (id, author, body, created_at) VALUES (?, ?, ?, ?)");
    for (const chat of data.chat) insertChat.run(chat.id, chat.author, chat.body, chat.createdAt);

    db.prepare("INSERT INTO provider_sync (id, provider, last_run_at, message, next_player_cursor, details_json) VALUES (1, ?, ?, ?, ?, ?)")
      .run(data.providerSync.provider, data.providerSync.lastRunAt, data.providerSync.message, data.providerSync.nextPlayerCursor || null, json(data.providerSync.details || {}));

    const insertNflTeam = db.prepare("INSERT INTO nfl_teams (id, provider, provider_id, conference, division, location, name, full_name, abbreviation, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const team of data.nflTeams || []) insertNflTeam.run(team.id, team.provider, team.providerId, team.conference, team.division, team.location, team.name, team.fullName, team.abbreviation, json(team.raw || team), team.syncedAt || new Date().toISOString());

    const insertNflGame = db.prepare("INSERT INTO nfl_games (id, provider, provider_id, season, week, status, date, home_team_provider_id, visitor_team_provider_id, home_score, visitor_score, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const game of data.nflGames || []) insertNflGame.run(game.id, game.provider, game.providerId, game.season, game.week, game.status, game.date, game.homeTeamProviderId, game.visitorTeamProviderId, game.homeScore, game.visitorScore, json(game.raw || game), game.syncedAt || new Date().toISOString());

    const insertNflStats = db.prepare("INSERT INTO nfl_player_stats (id, provider, provider_id, player_provider_id, game_provider_id, season, week, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const stat of data.nflPlayerStats || []) insertNflStats.run(stat.id, stat.provider, stat.providerId, stat.playerProviderId, stat.gameProviderId, stat.season, stat.week, json(stat.raw || stat), stat.syncedAt || new Date().toISOString());

    const insertProviderPlayer = db.prepare("INSERT INTO provider_players (id, provider, provider_id, name, first_name, last_name, position, fantasy_positions_json, team, status, injury_status, search_rank, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const player of data.providerPlayers || []) {
      insertProviderPlayer.run(player.id, player.provider, player.providerId, player.name, player.firstName || null, player.lastName || null, player.position || null, json(player.fantasyPositions || []), player.team || null, player.status || null, player.injuryStatus || null, player.searchRank ?? null, json(player.raw || player), player.syncedAt || new Date().toISOString());
    }

    const insertProviderTrending = db.prepare("INSERT INTO provider_trending (id, provider, provider_id, trend_type, count, lookback_hours, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const trend of data.providerTrending || []) insertProviderTrending.run(trend.id, trend.provider, trend.providerId, trend.trendType, trend.count, trend.lookbackHours, json(trend.raw || trend), trend.syncedAt || new Date().toISOString());

    const insertWeeklyStats = db.prepare("INSERT INTO weekly_player_stats (id, provider, provider_id, app_player_id, season, week, stat_type, stats_json, fantasy_points, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const stat of data.weeklyPlayerStats || []) {
      insertWeeklyStats.run(stat.id, stat.provider, stat.providerId, stat.appPlayerId || null, stat.season, stat.week, stat.statType, json(stat.stats || {}), stat.fantasyPoints || 0, json(stat.raw || stat), stat.syncedAt || new Date().toISOString());
    }

    const insertCorrection = db.prepare("INSERT INTO score_corrections (id, season, week, team_id, player_id, points_delta, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const correction of data.scoreCorrections || []) insertCorrection.run(correction.id, correction.season, correction.week, correction.teamId || null, correction.playerId || null, correction.pointsDelta, correction.note, correction.createdBy, correction.createdAt);

    const insertLock = db.prepare("INSERT INTO lineup_locks (id, season, week, team_id, player_id, locked_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const lock of data.lineupLocks || []) insertLock.run(lock.id, lock.season, lock.week, lock.teamId, lock.playerId, lock.lockedAt, lock.reason);

    const insertActivity = db.prepare("INSERT INTO activity_events (id, type, category, title, body, actor_user_id, team_id, player_id, metadata_json, visible_to_json, read_by_json, delivery_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const event of data.activityEvents || []) {
      insertActivity.run(event.id, event.type, event.category, event.title, event.body, event.actorUserId || null, event.teamId || null, event.playerId || null, json(event.metadata || {}), json(event.visibleTo || []), json(event.readBy || []), json(event.delivery || defaultDelivery()), event.createdAt);
    }

    const insertPreference = db.prepare("INSERT INTO notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, ?)");
    for (const pref of normalizeNotificationPreferences(data)) {
      insertPreference.run(pref.userId, json(pref.preferences), pref.updatedAt);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function cookieSession(userId) {
  const token = `${userId}.${Date.now()}.${crypto.randomBytes(18).toString("hex")}`;
  return `${token}.${sign(token)}`;
}

function csrfTokenForSession(rawSession = "") {
  return rawSession ? crypto.createHmac("sha256", SESSION_SECRET).update(`csrf:${rawSession}`).digest("hex") : "";
}

function publicSessionId(token = "") {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function getSessionCookie(req) {
  return parseCookies(req).ff_session || "";
}

function validCsrf(req) {
  const raw = getSessionCookie(req);
  const provided = String(req.headers["x-csrf-token"] || "");
  const expected = csrfTokenForSession(raw);
  return Boolean(provided && expected && provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function getSessionUser(db, req) {
  const raw = getSessionCookie(req);
  if (!raw) return null;
  const parts = raw.split(".");
  const token = parts.slice(0, 3).join(".");
  const signature = parts[3];
  if (!signature || sign(token) !== signature) return null;
  const session = db.sessions.find((item) => item.token === raw && item.expiresAt > Date.now());
  return session ? db.users.find((user) => user.id === session.userId) : null;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(escapeClientStrings(body));
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(payload);
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw new Error("Request body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}

function escapeClientStrings(value) {
  if (typeof value === "string") return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  if (Array.isArray(value)) return value.map(escapeClientStrings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeClientStrings(item)]));
  return value;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
}

function allowlisted(req) {
  if (!LAN_ALLOWLIST.length) return true;
  const ip = clientIp(req).replace(/^::ffff:/, "");
  return LAN_ALLOWLIST.some((entry) => ip === entry || ip.startsWith(entry));
}

function rateLimit(req, res, url) {
  const isLogin = url.pathname === "/api/login" || url.pathname === "/api/password-reset";
  const windowMs = isLogin ? 15 * 60 * 1000 : 60 * 1000;
  const max = isLogin ? 12 : 180;
  const key = `${clientIp(req)}:${isLogin ? url.pathname : "api"}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= max) return true;
  send(res, 429, { error: "Too many requests. Please wait a moment and try again." }, { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) });
  return false;
}

const seasonPhases = ["preseason", "draft", "regular_season", "playoffs", "offseason"];
const phaseActions = {
  draft: ["preseason", "draft"],
  lineup: ["regular_season", "playoffs"],
  roster: ["preseason", "regular_season"],
  waiver: ["regular_season"],
  trade: ["preseason", "regular_season"],
  scoring: ["regular_season", "playoffs"],
  playoffs: ["regular_season", "playoffs"],
  admin: seasonPhases
};

function normalizeSeasonPhase(db) {
  const inferred = ["in_progress", "paused"].includes(db.league?.draft?.status) ? "draft" : "regular_season";
  const phase = db.meta?.seasonPhase || db.league?.seasonPhase || inferred;
  db.meta.seasonPhase = seasonPhases.includes(phase) ? phase : "preseason";
  return db.meta.seasonPhase;
}

function canPerformInPhase(db, action) {
  const allowed = phaseActions[action] || [];
  return allowed.includes(normalizeSeasonPhase(db));
}

function requirePhase(db, res, action) {
  if (canPerformInPhase(db, action)) return true;
  send(res, 409, { error: `${labelForPhase(normalizeSeasonPhase(db))} does not allow ${action} actions` });
  return false;
}

function labelForPhase(value = "") {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function enrich(db, user) {
  normalizeSeasonPhase(db);
  normalizeDraftState(db);
  normalizeWaiverClaims(db);
  const teams = db.teams.map((team) => {
    const roster = db.players.filter((player) => player.ownership === team.id);
    const pointsFor = roster.reduce((sum, player) => sum + player.projection * 5.2, 0);
    const projected = roster.reduce((sum, player) => sum + player.projection, 0);
    return { ...team, pointsFor: Number(pointsFor.toFixed(1)), pointsAgainst: Number((pointsFor * 0.91).toFixed(1)), projected: Number(projected.toFixed(1)) };
  }).sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
  const myTeam = teams.find((team) => team.ownerUserId === user?.id) || teams[0];
  const activity = user ? visibleActivityForUser(db, user) : [];
  const preferences = normalizeNotificationPreferences(db).find((pref) => pref.userId === user?.id) || defaultNotificationPreferences(user?.id);
  return {
    currentUser: safeUser(user),
    users: isAdminUser(user) ? db.users.map(safeUser) : [],
    league: db.league,
    meta: { ...db.meta, setupRequired: hasSeededPassword(user), phaseLabel: labelForPhase(db.meta.seasonPhase), phaseActions: Object.fromEntries(Object.keys(phaseActions).map((action) => [action, canPerformInPhase(db, action)])) },
    teams,
    myTeam,
    players: db.players,
    lineups: db.lineups,
    matchups: db.matchups,
    transactions: db.transactions.sort((a, b) => b.createdAt - a.createdAt),
    waiverClaims: db.waiverClaims,
    waiverPreview: waiverPreview(db),
    trades: visibleTradesForUser(db, user),
    playerResearch: (db.playerResearch || []).filter((item) => item.userId === user.id),
    tradeBlock: db.tradeBlock || [],
    chat: db.chat,
    activity,
    auditLog: isAdminUser(user) ? commissionerAuditLog(db) : [],
    notificationPreferences: preferences.preferences,
    unreadActivityCount: activity.filter((event) => !event.read).length,
    providerSync: {
      ...db.providerSync,
      counts: {
        nflTeams: db.nflTeams?.length || 0,
        nflGames: db.nflGames?.length || 0,
        playerStats: db.nflPlayerStats?.length || 0,
        players: db.players?.filter((player) => String(player.id).startsWith("bdl-")).length || 0,
        sleeperPlayers: db.providerPlayers?.filter((player) => player.provider === "sleeper").length || 0,
        trending: db.providerTrending?.length || 0
      }
    },
    ops: {
      readiness: readinessChecklist(db),
      scheduledJobs: scheduledJobsPanel(db),
      dataQuality: dataQualityReport(db),
      providerSettings: providerSettings(db),
      providerSnapshots: db.meta.providerSnapshots || [],
      providerMappings: db.meta.providerMappings || {}
    },
    nflTeams: db.nflTeams || [],
    nflGames: db.nflGames || [],
    providerPlayers: db.providerPlayers || [],
    providerTrending: db.providerTrending || [],
    scoring: {
      weeklyStats: db.weeklyPlayerStats || [],
      corrections: db.scoreCorrections || [],
      locks: db.lineupLocks || [],
      summary: scoringSummary(db)
    }
  };
}

function visibleTradesForUser(db, user) {
  if (isAdminUser(user)) return db.trades || [];
  const managedTeamIds = new Set((db.teams || []).filter((team) => team.ownerUserId === user.id).map((team) => team.id));
  return (db.trades || []).filter((trade) => managedTeamIds.has(trade.fromTeamId) || managedTeamIds.has(trade.toTeamId));
}

function commissionerAuditLog(db) {
  const auditTypes = new Set([
    "league_rules_updated", "score_correction", "corrections_cleared", "rosters_validated",
    "waivers_processed", "trade_approved", "trade_vetoed", "trades_expired", "team_updated",
    "password_changed", "user_created", "family_setup", "season_phase_changed",
    "playoff_bracket_generated", "provider_sync"
  ]);
  return (db.activityEvents || [])
    .filter((event) => event.visibleTo?.includes("commissioner") || event.category === "commissioner" || auditTypes.has(event.type))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);
}

function requireUser(db, req, res) {
  const user = getSessionUser(db, req);
  if (!user) send(res, 401, { error: "Sign in required" });
  return user;
}

function visibleActivityForUser(db, user) {
  const prefs = normalizeNotificationPreferences(db).find((item) => item.userId === user.id)?.preferences || defaultNotificationPreferences(user.id).preferences;
  return (db.activityEvents || [])
    .filter((event) => {
      const visibleTo = event.visibleTo || [];
      const isVisible = visibleTo.includes("all") || visibleTo.includes(user.id) || (isAdminUser(user) && visibleTo.includes("commissioner"));
      return isVisible && prefs.categories?.[event.category] !== false;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80)
    .map((event) => ({ ...event, read: (event.readBy || []).includes(user.id) }));
}

function isAdminUser(user) {
  return ["admin", "commissioner"].includes(user?.role);
}

function requireAdmin(user, res) {
  if (!isAdminUser(user)) {
    send(res, 403, { error: "Commissioner access required" });
    return false;
  }
  return true;
}

function canManageTeam(user, team) {
  return Boolean(team) && (["admin", "commissioner"].includes(user.role) || team.ownerUserId === user.id);
}

function hasSeededPassword(user) {
  return Boolean(user && hashPassword("password", user.salt) === user.passwordHash);
}

function normalizeTeamColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#4f7ee8";
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url.slice(0, 300) : "";
}

function applyFamilySetup(db) {
  const demoNames = new Set(["The Andersons", "The Parkers", "The Millers", "The Johnsons", "The Thompsons", "The Harris Family"]);
  const existingOwners = new Map(db.teams.map((team) => [team.ownerUserId, team]));
  const existingById = new Map(db.teams.map((team) => [team.id, team]));
  const nextTeams = [];
  for (const manager of familyManagers) {
    let user = db.users.find((item) => item.id === manager.id || item.username === manager.username);
    if (!user) {
      user = makeUser(manager.id, manager.username, manager.displayName, manager.role, "password");
      db.users.push(user);
    } else {
      user.username = manager.username;
      user.displayName = manager.displayName;
      user.role = manager.role;
    }
    let team = existingById.get(manager.teamId) || existingOwners.get(user.id);
    if (!team) {
      team = { id: manager.teamId, name: `${manager.displayName}'s Team`, manager: initialsFor(manager.displayName), ownerUserId: user.id, logoUrl: "", color: teamColors[nextTeams.length % teamColors.length], wins: 0, losses: 0, ties: 0, waiverRank: db.teams.length + 1 };
    } else {
      team.id = manager.teamId;
      if (!team.name || demoNames.has(team.name)) team.name = `${manager.displayName}'s Team`;
      team.manager = initialsFor(manager.displayName);
      team.ownerUserId = user.id;
      team.logoUrl = team.logoUrl || "";
      team.color = team.color || teamColors[nextTeams.length % teamColors.length];
    }
    nextTeams.push(team);
  }
  db.teams = nextTeams.map((team, index) => ({ ...team, waiverRank: index + 1 }));
  db.league.settings.maxTeams = familyManagers.length;
  db.league.draft = { ...makeDraftState(db.teams.map((team) => team.id)), ...db.league.draft, order: db.teams.map((team) => team.id) };
}

function clearRosters(db) {
  for (const player of db.players) player.ownership = null;
  db.lineups = Object.fromEntries(db.teams.map((team) => [team.id, {}]));
}

function normalizeDraftState(db) {
  const draft = db.league.draft || {};
  const order = (draft.order || db.teams.map((team) => team.id)).filter((teamId) => db.teams.some((team) => team.id === teamId));
  const missing = db.teams.map((team) => team.id).filter((teamId) => !order.includes(teamId));
  const nextOrder = [...order, ...missing];
  const queues = {};
  for (const teamId of nextOrder) {
    queues[teamId] = (draft.queues?.[teamId] || []).filter((playerId) => db.players.some((player) => player.id === playerId && !player.ownership));
  }
  db.league.draft = {
    ...makeDraftState(nextOrder),
    ...draft,
    order: nextOrder,
    orderStyle: draft.orderStyle || draft.mode || "snake",
    queues,
    chat: draft.chat || [],
    keepers: draft.keepers || [],
    picks: draft.picks || []
  };
  return db.league.draft;
}

function getDraftTeamId(draft) {
  const order = draft.order || [];
  if (!order.length) return null;
  const pickIndex = Math.max(0, Number(draft.currentPick || 1) - 1);
  const roundIndex = Math.floor(pickIndex / order.length);
  const slotIndex = pickIndex % order.length;
  return order[draftSlotIndex(draft.orderStyle || draft.mode || "snake", order.length, roundIndex, slotIndex)];
}

function draftSlotIndex(style, orderLength, roundIndex, slotIndex) {
  if (String(style).toLowerCase().includes("linear")) return slotIndex;
  if (String(style).toLowerCase().includes("third") && roundIndex >= 2) return orderLength - 1 - slotIndex;
  return roundIndex % 2 === 0 ? slotIndex : orderLength - 1 - slotIndex;
}

function pruneDraftQueues(db, playerId) {
  for (const teamId of Object.keys(db.league.draft.queues || {})) {
    db.league.draft.queues[teamId] = (db.league.draft.queues[teamId] || []).filter((id) => id !== playerId);
  }
}

function makeDraftPick(db, playerId) {
  normalizeDraftState(db);
  const draft = db.league.draft;
  if (draft.status !== "in_progress") return { error: "Draft is not in progress" };
  const player = db.players.find((item) => item.id === playerId);
  if (!player) return { error: "Player not found" };
  if (player.ownership) return { error: "Player is already on a roster" };
  const teamId = getDraftTeamId(draft);
  if (!teamId) return { error: "Draft order is empty" };
  const validation = validateRosterMove(db, teamId, { addPlayerId: playerId, ignoreRosterLimit: true });
  if (!validation.ok) return { error: validation.errors.join("; ") };
  const pickNumber = Number(draft.currentPick || 1);
  const round = Math.ceil(pickNumber / draft.order.length);
  const slot = ((pickNumber - 1) % draft.order.length) + 1;
  player.ownership = teamId;
  const pick = { pickNumber, round, slot, teamId, playerId, playerName: player.name, position: player.position, madeAt: new Date().toISOString() };
  draft.picks.push(pick);
  pruneDraftQueues(db, playerId);
  draft.currentPick = pickNumber + 1;
  draft.clockStartedAt = new Date().toISOString();
  if (draft.currentPick > draft.order.length * Number(draft.rounds || 15)) {
    draft.status = "complete";
    draft.completedAt = new Date().toISOString();
    buildDefaultLineups(db);
  }
  return { ok: true, pick };
}

function undoDraftPick(db) {
  normalizeDraftState(db);
  const draft = db.league.draft;
  const pick = draft.picks?.pop();
  if (!pick) return { error: "No draft picks to undo" };
  const player = db.players.find((item) => item.id === pick.playerId);
  if (player && player.ownership === pick.teamId) player.ownership = null;
  draft.currentPick = pick.pickNumber;
  draft.status = "in_progress";
  draft.completedAt = null;
  draft.clockStartedAt = new Date().toISOString();
  return { ok: true, pick };
}

function chooseAutoPick(db) {
  normalizeDraftState(db);
  const teamId = getDraftTeamId(db.league.draft);
  const queued = (db.league.draft.queues?.[teamId] || []).map((id) => db.players.find((player) => player.id === id)).find((player) => player && !player.ownership && player.status !== "Out");
  if (queued) return queued;
  const existing = db.players.filter((player) => player.ownership === teamId);
  const counts = existing.reduce((acc, player) => ({ ...acc, [player.position]: (acc[player.position] || 0) + 1 }), {});
  const desired = ["QB", "RB", "WR", "TE", "RB", "WR", "K", "D/ST", "QB", "RB", "WR", "TE", "RB", "WR", "FLEX"];
  const round = Math.ceil(Number(db.league.draft.currentPick || 1) / db.league.draft.order.length);
  const target = desired[Math.min(desired.length - 1, round - 1)];
  const available = db.players.filter((player) => !player.ownership && player.status !== "Out");
  const positionPool = available.filter((player) => target === "FLEX" ? ["RB", "WR", "TE"].includes(player.position) : player.position === target);
  const pool = positionPool.length ? positionPool : available;
  return pool.sort((a, b) => {
    const scarcity = (counts[a.position] || 0) - (counts[b.position] || 0);
    if (scarcity !== 0) return scarcity;
    if (b.projection !== a.projection) return b.projection - a.projection;
    return a.name.localeCompare(b.name);
  })[0];
}

function runTestDraft(db, rounds = 15) {
  const previous = normalizeDraftState(db);
  db.league.draft = { ...makeDraftState(previous.order), orderStyle: previous.orderStyle || "snake", pickTimeSeconds: previous.pickTimeSeconds, queues: previous.queues || {}, keepers: previous.keepers || [] };
  db.league.draft.rounds = rounds;
  db.league.draft.status = "in_progress";
  db.league.draft.startedAt = new Date().toISOString();
  db.league.draft.clockStartedAt = db.league.draft.startedAt;
  clearRosters(db);
  applyDraftKeepers(db);
  const total = db.league.draft.order.length * rounds;
  for (let i = 0; i < total && db.league.draft.status === "in_progress"; i++) {
    const pick = chooseAutoPick(db);
    if (!pick) break;
    makeDraftPick(db, pick.id);
  }
  buildDefaultLineups(db);
}

function applyDraftKeepers(db) {
  normalizeDraftState(db);
  const applied = [];
  for (const keeper of db.league.draft.keepers || []) {
    const player = db.players.find((item) => item.id === keeper.playerId);
    const keeperTeam = db.teams.find((team) => team.id === keeper.teamId);
    if (!player || !keeperTeam) continue;
    player.ownership = keeper.teamId;
    applied.push({ ...keeper, applied: true });
  }
  db.league.draft.keepers = applied;
}

function buildDefaultLineups(db) {
  const starterSlots = db.league.roster.starters || positions;
  for (const team of db.teams) {
    const teamRoster = db.players.filter((player) => player.ownership === team.id).sort((a, b) => b.projection - a.projection || a.name.localeCompare(b.name));
    const lineup = {};
    const used = new Set();
    const slotCounts = {};
    for (const slot of starterSlots) {
      slotCounts[slot] = (slotCounts[slot] || 0) + 1;
      const key = slotCounts[slot] === 1 ? slot : `${slot}${slotCounts[slot]}`;
      const eligible = slot === "FLEX" ? ["RB", "WR", "TE"] : [slot];
      const selected = teamRoster.find((player) => !used.has(player.id) && eligible.includes(player.position));
      if (selected) {
        lineup[key] = selected.id;
        used.add(selected.id);
      }
    }
    db.lineups[team.id] = lineup;
  }
}

function generateSchedule(teams, weeks = 14, startWeek = 1) {
  const ids = teams.map((team) => team.id);
  const working = ids.length % 2 === 0 ? [...ids] : [...ids, "bye"];
  const rounds = [];
  for (let round = 0; round < working.length - 1; round++) {
    const pairs = [];
    for (let i = 0; i < working.length / 2; i++) {
      const home = working[i];
      const away = working[working.length - 1 - i];
      if (home !== "bye" && away !== "bye") pairs.push(round % 2 === 0 ? [home, away] : [away, home]);
    }
    rounds.push(pairs);
    working.splice(1, 0, working.pop());
  }
  const matchups = [];
  for (let week = 0; week < weeks; week++) {
    const pairs = rounds[week % rounds.length];
    for (let index = 0; index < pairs.length; index++) {
      const [homeTeamId, awayTeamId] = pairs[index];
      matchups.push({ id: `wk${startWeek + week}-g${index + 1}`, week: startWeek + week, homeTeamId, awayTeamId, homeScore: 0, awayScore: 0, status: "scheduled" });
    }
  }
  return matchups;
}

async function ingestReliableWeeklyStats(db, season, week, statType = "actual") {
  const health = {
    statType,
    season,
    week,
    attemptedAt: new Date().toISOString(),
    primary: null,
    fallback: null,
    status: "unknown",
    message: ""
  };
  try {
    const sleeper = await ingestSleeperWeeklyStats(db, season, week, statType);
    const validation = validateWeeklyStatIngest(db, sleeper);
    health.primary = { ...providerHealthFromIngest(sleeper), validation };
    if (validation.ok || statType === "projection") {
      health.status = validation.ok ? "healthy" : "warning";
      health.message = validation.ok ? "Sleeper weekly data passed validation." : `Sleeper projection data saved with warning: ${validation.warnings.join("; ")}`;
      recordScoringHealth(db, health);
      return { ...sleeper, health, fallbackUsed: false };
    }
    if (statType !== "actual") {
      health.status = "warning";
      health.message = `No fallback is configured for ${statType} data.`;
      recordScoringHealth(db, health);
      return { ...sleeper, health, fallbackUsed: false };
    }
  } catch (error) {
    health.primary = { provider: "sleeper", status: "error", error: error.message };
  }

  try {
    const espn = await ingestEspnWeeklyStatsFallback(db, season, week);
    const validation = validateWeeklyStatIngest(db, espn);
    health.fallback = { ...providerHealthFromIngest(espn), validation };
    health.status = validation.ok ? "fallback" : "warning";
    health.message = validation.ok
      ? "Sleeper was unavailable or incomplete; ESPN fallback data was saved."
      : `ESPN fallback saved with warning: ${validation.warnings.join("; ")}`;
    recordScoringHealth(db, health);
    return { ...espn, health, fallbackUsed: true };
  } catch (error) {
    health.fallback = { provider: "espn", status: "error", error: error.message };
    health.status = "error";
    health.message = `Weekly stat ingest failed: Sleeper ${health.primary?.error || "was incomplete"}; ESPN ${error.message}.`;
    recordScoringHealth(db, health);
    throw new Error(health.message);
  }
}

async function ingestSleeperWeeklyStats(db, season, week, statType = "actual") {
  const endpointType = statType === "projection" ? "projections" : "stats";
  const url = `https://api.sleeper.com/${endpointType}/nfl/${season}/${week}?season_type=regular`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Sleeper ${endpointType} returned HTTP ${response.status}`);
  const rows = normalizeSleeperStatPayload(payload);
  const now = new Date().toISOString();
  db.weeklyPlayerStats = db.weeklyPlayerStats.filter((item) => !(item.provider === "sleeper" && item.season === season && item.week === week && item.statType === statType));
  const mapped = rows.map((row) => {
    const providerId = String(row.player_id || row.player?.player_id || row.id || "");
    const appPlayerId = findAppPlayerIdForSleeper(db, providerId);
    const stats = row.stats || row;
    return {
      id: `sleeper-${statType}-${season}-${week}-${providerId}`,
      provider: "sleeper",
      providerId,
      appPlayerId,
      season,
      week,
      statType,
      stats,
      fantasyPoints: calculateFantasyPoints(stats, db.league.scoring),
      raw: row,
      syncedAt: now
    };
  }).filter((item) => item.providerId);
  db.weeklyPlayerStats.push(...mapped);
  return { provider: "sleeper", endpoint: url, statType, season, week, rows: mapped.length };
}

async function ingestEspnWeeklyStatsFallback(db, season, week) {
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?year=${season}&seasontype=2&week=${week}&limit=100`;
  const scoreboard = await fetchJson(scoreboardUrl, "ESPN scoreboard");
  const events = Array.isArray(scoreboard.events) ? scoreboard.events : [];
  if (!events.length) throw new Error(`ESPN scoreboard returned no events for ${season} week ${week}`);
  const now = new Date().toISOString();
  const rowsByProviderId = new Map();
  for (const event of events) {
    if (!event?.id) continue;
    const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${event.id}`;
    const summary = await fetchJson(summaryUrl, `ESPN summary ${event.id}`);
    for (const row of normalizeEspnSummaryStats(summary, db)) {
      const existing = rowsByProviderId.get(row.providerId) || { ...row, stats: {}, raw: [] };
      existing.stats = { ...existing.stats, ...row.stats };
      existing.raw.push(row.raw);
      rowsByProviderId.set(row.providerId, existing);
    }
  }
  const mapped = [...rowsByProviderId.values()].map((row) => ({
    id: `espn-actual-${season}-${week}-${row.providerId}`,
    provider: "espn",
    providerId: row.providerId,
    appPlayerId: row.appPlayerId,
    season,
    week,
    statType: "actual",
    stats: row.stats,
    fantasyPoints: calculateFantasyPoints(row.stats, db.league.scoring),
    raw: row.raw,
    syncedAt: now
  })).filter((item) => item.providerId);
  db.weeklyPlayerStats = db.weeklyPlayerStats.filter((item) => !(item.provider === "espn" && item.season === season && item.week === week && item.statType === "actual"));
  db.weeklyPlayerStats.push(...mapped);
  return { provider: "espn", endpoint: scoreboardUrl, statType: "actual", season, week, rows: mapped.length };
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return payload;
}

function normalizeEspnSummaryStats(summary, db) {
  const rows = [];
  for (const teamBox of summary?.boxscore?.players || []) {
    const teamAbbr = teamBox.team?.abbreviation || "";
    for (const category of teamBox.statistics || []) {
      const labels = category.labels || [];
      for (const athleteRow of category.athletes || []) {
        const athlete = athleteRow.athlete || {};
        const providerId = athlete.id ? String(athlete.id) : `${teamAbbr}-${athlete.displayName || athlete.shortName || ""}`;
        const name = athlete.displayName || athlete.shortName || "";
        const stats = mapEspnStatLine(category.name || category.type || category.displayName, labels, athleteRow.stats || []);
        if (!Object.keys(stats).length) continue;
        rows.push({
          providerId,
          appPlayerId: findAppPlayerIdForNameTeam(db, name, teamAbbr),
          stats,
          raw: { team: teamAbbr, category: category.name || category.displayName, athlete: name, stats: athleteRow.stats || [] }
        });
      }
    }
  }
  return rows;
}

function mapEspnStatLine(category, labels = [], values = []) {
  const normalizedCategory = String(category || "").toLowerCase();
  const byLabel = Object.fromEntries(labels.map((label, index) => [String(label).toLowerCase(), values[index]]));
  const number = (...keys) => {
    for (const key of keys) {
      const raw = byLabel[key.toLowerCase()];
      if (raw === undefined || raw === null || raw === "") continue;
      const firstNumber = String(raw).match(/-?\d+(\.\d+)?/);
      if (firstNumber) return Number(firstNumber[0]);
    }
    return 0;
  };
  if (normalizedCategory.includes("passing")) {
    return { pass_yd: number("YDS", "Yards"), pass_td: number("TD"), pass_int: number("INT") };
  }
  if (normalizedCategory.includes("rushing")) {
    return { rush_yd: number("YDS", "Yards"), rush_td: number("TD") };
  }
  if (normalizedCategory.includes("receiving")) {
    return { rec: number("REC", "Receptions"), rec_yd: number("YDS", "Yards"), rec_td: number("TD") };
  }
  if (normalizedCategory.includes("fumble")) {
    return { fum_lost: number("LOST", "FUM LOST") };
  }
  if (normalizedCategory.includes("kicking")) {
    const made = String(byLabel["fg"] || byLabel["fgm/a"] || "").match(/^(\d+)/);
    return { fgm_30_39: made ? Number(made[1]) : 0, xpm: number("XP", "XPM") };
  }
  if (normalizedCategory.includes("defensive") || normalizedCategory.includes("defense")) {
    return { def_sack: number("SACKS", "SACK"), def_int: number("INT"), def_fr: number("FR"), def_td: number("TD") };
  }
  return {};
}

function findAppPlayerIdForNameTeam(db, name, teamAbbr) {
  if (!name) return null;
  const normalizedName = normalizeName(name);
  const byTeam = db.players.find((player) => normalizeName(player.name) === normalizedName && (!teamAbbr || player.nflTeam === teamAbbr));
  if (byTeam) return byTeam.id;
  return db.players.find((player) => normalizeName(player.name) === normalizedName)?.id || null;
}

function normalizeName(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validateWeeklyStatIngest(db, ingest) {
  const rows = db.weeklyPlayerStats.filter((item) => item.provider === ingest.provider && item.season === ingest.season && item.week === ingest.week && item.statType === ingest.statType);
  const mappedRows = rows.filter((item) => item.appPlayerId);
  const starterIds = new Set(Object.values(db.lineups || {}).flatMap((lineup) => Object.values(lineup || {})).filter(Boolean));
  const mappedStarters = rows.filter((item) => starterIds.has(item.appPlayerId)).length;
  const warnings = [];
  if (!rows.length) warnings.push("provider returned zero player rows");
  if (rows.length && !mappedRows.length) warnings.push("no provider rows matched local players");
  if (ingest.statType === "actual" && starterIds.size && !mappedStarters) warnings.push("no current starters matched provider rows");
  return {
    ok: warnings.length === 0,
    warnings,
    rows: rows.length,
    mappedRows: mappedRows.length,
    mappedStarters,
    starterCount: starterIds.size
  };
}

function providerHealthFromIngest(ingest) {
  return {
    provider: ingest.provider,
    endpoint: ingest.endpoint,
    rows: ingest.rows,
    status: "ok"
  };
}

function recordScoringHealth(db, health) {
  db.providerSync = db.providerSync || { provider: "mock", lastRunAt: null, message: "", details: {} };
  db.providerSync.details = db.providerSync.details || {};
  db.providerSync.details.scoring = health;
}

function normalizeSleeperStatPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    return Object.entries(payload).map(([playerId, value]) => ({ player_id: playerId, ...(value || {}) }));
  }
  return [];
}

function findAppPlayerIdForSleeper(db, providerId) {
  if (!providerId) return null;
  const direct = db.players.find((player) => player.id === `slp-${providerId}`);
  if (direct) return direct.id;
  const provider = db.providerPlayers.find((player) => player.provider === "sleeper" && player.providerId === String(providerId));
  if (!provider) return null;
  const byName = db.players.find((player) => player.name.toLowerCase() === provider.name.toLowerCase() && (!provider.team || player.nflTeam === provider.team));
  return byName?.id || null;
}

function processWeekScoring(db, season, week, options = {}) {
  const { finalize = false, useProjections = true } = options;
  const statMap = buildStatMap(db, season, week, useProjections);
  const corrections = db.scoreCorrections.filter((item) => item.season === season && item.week === week);
  const matchupRows = db.matchups.filter((matchup) => Number(matchup.week) === Number(week));
  const results = [];
  lockStartedPlayers(db, season, week);
  for (const matchup of matchupRows) {
    const homeScore = scoreTeamForWeek(db, matchup.homeTeamId, season, week, statMap, corrections);
    const awayScore = scoreTeamForWeek(db, matchup.awayTeamId, season, week, statMap, corrections);
    matchup.homeScore = roundScore(homeScore);
    matchup.awayScore = roundScore(awayScore);
    matchup.status = finalize ? "final" : "live";
    results.push({ matchupId: matchup.id, homeTeamId: matchup.homeTeamId, awayTeamId: matchup.awayTeamId, homeScore: matchup.homeScore, awayScore: matchup.awayScore });
  }
  if (finalize) recomputeStandings(db);
  if (finalize) updatePlayoffBracketFromFinals(db, week);
  return { season, week, finalize, matchups: results.length, statRows: statMap.size, corrections: corrections.length };
}

function buildStatMap(db, season, week, useProjections) {
  const map = new Map();
  const rows = db.weeklyPlayerStats.filter((item) => item.season === season && item.week === week);
  for (const row of rows.filter((item) => item.statType === "projection" && useProjections)) {
    if (row.appPlayerId) map.set(row.appPlayerId, row);
  }
  for (const row of rows.filter((item) => item.statType === "actual")) {
    if (row.appPlayerId) map.set(row.appPlayerId, row);
  }
  return map;
}

function scoreTeamForWeek(db, teamId, season, week, statMap, corrections) {
  const lineup = db.lineups[teamId] || {};
  const starterIds = Object.values(lineup).filter(Boolean);
  const playerPoints = starterIds.reduce((sum, playerId) => sum + (statMap.get(playerId)?.fantasyPoints || 0), 0);
  const correctionPoints = corrections
    .filter((item) => item.teamId === teamId || (item.playerId && starterIds.includes(item.playerId)))
    .reduce((sum, item) => sum + Number(item.pointsDelta || 0), 0);
  return playerPoints + correctionPoints;
}

function lockStartedPlayers(db, season, week) {
  const existing = new Set(db.lineupLocks.map((lock) => lock.id));
  for (const team of db.teams) {
    const starterIds = Object.values(db.lineups[team.id] || {}).filter(Boolean);
    for (const playerId of starterIds) {
      const id = `lock-${season}-${week}-${team.id}-${playerId}`;
      if (!existing.has(id) && shouldLockPlayer(db, playerId, week)) {
        db.lineupLocks.push({ id, season, week, teamId: team.id, playerId, lockedAt: new Date().toISOString(), reason: "Processed weekly scoring lock" });
      }
    }
  }
}

function shouldLockPlayer(db, playerId, week) {
  const player = db.players.find((item) => item.id === playerId);
  if (!player) return false;
  const game = (db.nflGames || []).find((item) => Number(item.week) === Number(week) && [item.homeTeamProviderId, item.visitorTeamProviderId].some((teamId) => providerTeamMatches(db, teamId, player.nflTeam)));
  if (!game?.date) return true;
  const kickoff = Date.parse(game.date);
  return Number.isNaN(kickoff) ? true : Date.now() >= kickoff;
}

function providerTeamMatches(db, providerId, abbreviation) {
  const team = db.nflTeams?.find((item) => item.providerId === String(providerId));
  return team?.abbreviation === abbreviation;
}

function recomputeStandings(db) {
  for (const team of db.teams) {
    team.wins = 0;
    team.losses = 0;
    team.ties = 0;
  }
  for (const matchup of db.matchups.filter((item) => item.status === "final")) {
    const home = db.teams.find((team) => team.id === matchup.homeTeamId);
    const away = db.teams.find((team) => team.id === matchup.awayTeamId);
    if (!home || !away) continue;
    if (matchup.homeScore > matchup.awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else if (matchup.awayScore > matchup.homeScore) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }
  }
}

function standingsSeedOrder(db) {
  return [...db.teams].sort((a, b) => b.wins - a.wins || b.ties - a.ties || projectedPointsFor(db, b.id) - projectedPointsFor(db, a.id) || a.name.localeCompare(b.name));
}

function projectedPointsFor(db, teamId) {
  return db.players.filter((player) => player.ownership === teamId).reduce((sum, player) => sum + Number(player.projection || 0) * 5.2, 0);
}

function playoffWeeks(db) {
  const raw = String(db.league.playoffs?.weeks || "16 & 17");
  const weeks = raw.match(/\d+/g)?.map(Number) || [16, 17];
  return { semi: weeks[0] || 16, final: weeks[1] || weeks[0] + 1 || 17 };
}

function generatePlayoffBracket(db) {
  const playoffCount = Math.max(2, Number(db.league.playoffs?.teams || 4));
  const consolationCount = Math.max(0, Number(db.league.playoffs?.consolationTeams || 0));
  const seeds = standingsSeedOrder(db).map((team, index) => ({ seed: index + 1, teamId: team.id, teamName: team.name }));
  const playoffSeeds = seeds.slice(0, playoffCount);
  const consolationSeeds = seeds.slice(playoffCount, playoffCount + consolationCount);
  const { semi, final } = playoffWeeks(db);
  const makeGame = (id, week, round, slot, high, low) => ({
    id,
    week,
    round,
    slot,
    homeTeamId: high?.teamId || null,
    awayTeamId: low?.teamId || null,
    homeSeed: high?.seed || null,
    awaySeed: low?.seed || null,
    winnerTeamId: null,
    loserTeamId: null,
    status: "scheduled"
  });
  const semiGames = [];
  for (let i = 0; i < Math.floor(playoffSeeds.length / 2); i++) {
    semiGames.push(makeGame(`po-semi-${i + 1}`, semi, "semifinal", i + 1, playoffSeeds[i], playoffSeeds[playoffSeeds.length - 1 - i]));
  }
  const consolationGames = [];
  for (let i = 0; i < Math.floor(consolationSeeds.length / 2); i++) {
    consolationGames.push(makeGame(`po-con-${i + 1}`, semi, "consolation", i + 1, consolationSeeds[i], consolationSeeds[consolationSeeds.length - 1 - i]));
  }
  const bracket = {
    generatedAt: new Date().toISOString(),
    weeks: { semifinal: semi, final },
    seeds: playoffSeeds,
    consolationSeeds,
    games: [
      ...semiGames,
      makeGame("po-final", final, "championship", 1, null, null),
      makeGame("po-third", final, "third_place", 1, null, null),
      ...consolationGames
    ],
    championTeamId: null,
    runnerUpTeamId: null,
    finalStandings: []
  };
  db.league.playoffs = { ...db.league.playoffs, bracket };
  upsertPlayoffMatchups(db);
  return bracket;
}

function upsertPlayoffMatchups(db) {
  const bracket = db.league.playoffs?.bracket;
  if (!bracket) return;
  const existing = new Map(db.matchups.filter((matchup) => String(matchup.id).startsWith("playoff-")).map((matchup) => [matchup.id, matchup]));
  db.matchups = db.matchups.filter((matchup) => !String(matchup.id).startsWith("playoff-"));
  for (const game of bracket.games || []) {
    if (!game.homeTeamId || !game.awayTeamId) continue;
    const previous = existing.get(`playoff-${game.id}`);
    db.matchups.push({
      id: `playoff-${game.id}`,
      week: game.week,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeScore: previous?.homeScore || 0,
      awayScore: previous?.awayScore || 0,
      status: previous?.status || "scheduled"
    });
  }
}

function updatePlayoffBracketFromFinals(db, week) {
  const bracket = db.league.playoffs?.bracket;
  if (!bracket) return;
  for (const game of bracket.games || []) {
    const matchup = db.matchups.find((item) => item.id === `playoff-${game.id}` && Number(item.week) === Number(week) && item.status === "final");
    if (!matchup) continue;
    game.status = "final";
    game.homeScore = matchup.homeScore;
    game.awayScore = matchup.awayScore;
    game.winnerTeamId = matchup.homeScore >= matchup.awayScore ? matchup.homeTeamId : matchup.awayTeamId;
    game.loserTeamId = game.winnerTeamId === matchup.homeTeamId ? matchup.awayTeamId : matchup.homeTeamId;
  }
  const semis = (bracket.games || []).filter((game) => game.round === "semifinal" && game.status === "final");
  const final = bracket.games.find((game) => game.round === "championship");
  const third = bracket.games.find((game) => game.round === "third_place");
  if (final && semis.length >= 2 && !final.homeTeamId && !final.awayTeamId) {
    final.homeTeamId = semis[0].winnerTeamId;
    final.awayTeamId = semis[1].winnerTeamId;
    third.homeTeamId = semis[0].loserTeamId;
    third.awayTeamId = semis[1].loserTeamId;
    upsertPlayoffMatchups(db);
  }
  if (final?.status === "final") {
    bracket.championTeamId = final.winnerTeamId;
    bracket.runnerUpTeamId = final.loserTeamId;
    const thirdWinner = third?.winnerTeamId;
    bracket.finalStandings = [final.winnerTeamId, final.loserTeamId, thirdWinner, third?.loserTeamId].filter(Boolean);
  }
}

function scoringSummary(db) {
  const season = Number(db.meta?.season || 0);
  const week = Number(db.meta?.currentWeek || 0);
  const health = db.providerSync?.details?.scoring || null;
  return {
    currentSeason: season,
    currentWeek: week,
    weeklyStats: db.weeklyPlayerStats?.filter((item) => item.season === season && item.week === week).length || 0,
    actualStats: db.weeklyPlayerStats?.filter((item) => item.season === season && item.week === week && item.statType === "actual").length || 0,
    projections: db.weeklyPlayerStats?.filter((item) => item.season === season && item.week === week && item.statType === "projection").length || 0,
    corrections: db.scoreCorrections?.filter((item) => item.season === season && item.week === week).length || 0,
    locks: db.lineupLocks?.filter((item) => item.season === season && item.week === week).length || 0,
    providerHealth: health
  };
}

function calculateFantasyPoints(stats = {}, scoring = {}) {
  const value = (...keys) => keys.reduce((found, key) => found ?? Number(stats[key]), null) || 0;
  const hasStat = (...keys) => keys.some((key) => stats[key] !== undefined && stats[key] !== null && stats[key] !== "");
  const passYards = value("pass_yd", "pass_yds", "passing_yards");
  const passTd = value("pass_td", "pass_tds", "passing_tds");
  const interceptions = value("pass_int", "int", "ints", "interceptions");
  const rushYards = value("rush_yd", "rush_yds", "rushing_yards");
  const rushTd = value("rush_td", "rush_tds", "rushing_tds");
  const receptions = value("rec", "receptions");
  const receivingYards = value("rec_yd", "rec_yds", "receiving_yards");
  const receivingTd = value("rec_td", "rec_tds", "receiving_tds");
  const fumbleLost = value("fum_lost", "fumbles_lost");
  const twoPoint = value("pass_2pt", "rush_2pt", "rec_2pt", "two_pt");
  const returnTd = value("return_td", "ret_td");
  const fg019 = value("fgm_0_19", "fg_0_19");
  const fg2029 = value("fgm_20_29", "fg_20_29");
  const fg3039 = value("fgm_30_39", "fg_30_39");
  const fg4049 = value("fgm_40_49", "fg_40_49");
  const fg50 = value("fgm_50p", "fgm_50_plus", "fg_50_plus");
  const extraPoint = value("xpm", "xp_made");
  const sacks = value("def_sack", "sack");
  const defInt = value("def_int", "def_interception");
  const fumRec = value("def_fr", "fum_rec", "def_fum_rec");
  const defTd = value("def_td");
  const safety = value("def_safe", "safe");
  const blockedKick = value("blk_kick", "def_blk");
  const pointsAllowed = hasStat("pts_allow", "points_allowed") ? value("pts_allow", "points_allowed") : null;
  let total = 0;
  total += passYards * (scoring.passYards ?? 0.04);
  total += passTd * (scoring.passTd ?? 4);
  total += interceptions * (scoring.interception ?? -1);
  total += rushYards * (scoring.rushYards ?? 0.1);
  total += rushTd * (scoring.rushTd ?? 6);
  total += receptions * (scoring.reception ?? 0.5);
  total += receivingYards * (scoring.receivingYards ?? 0.1);
  total += receivingTd * (scoring.receivingTd ?? 6);
  total += fumbleLost * (scoring.fumbleLost ?? -2);
  total += twoPoint * (scoring.twoPointConversion ?? 2);
  total += returnTd * (scoring.returnTd ?? 6);
  total += fg019 * (scoring.fieldGoal019 ?? 3);
  total += fg2029 * (scoring.fieldGoal2029 ?? 3);
  total += fg3039 * (scoring.fieldGoal3039 ?? 3);
  total += fg4049 * (scoring.fieldGoal4049 ?? 4);
  total += fg50 * (scoring.fieldGoal50 ?? 5);
  total += extraPoint * (scoring.extraPoint ?? 1);
  total += sacks * (scoring.defenseSack ?? 1);
  total += defInt * (scoring.defenseInterception ?? 2);
  total += fumRec * (scoring.defenseFumbleRecovery ?? 2);
  total += defTd * (scoring.defenseTouchdown ?? 6);
  total += safety * (scoring.defenseSafety ?? 2);
  total += blockedKick * (scoring.defenseBlockedKick ?? 2);
  total += defensePointsAllowed(pointsAllowed, scoring);
  return roundScore(total);
}

function defensePointsAllowed(pointsAllowed, scoring) {
  if (!Number.isFinite(pointsAllowed) || pointsAllowed < 0) return 0;
  if (pointsAllowed === 0) return scoring.pointsAllowed0 ?? 10;
  if (pointsAllowed <= 6) return scoring.pointsAllowed1To6 ?? 7;
  if (pointsAllowed <= 13) return scoring.pointsAllowed7To13 ?? 4;
  if (pointsAllowed <= 20) return scoring.pointsAllowed14To20 ?? 1;
  if (pointsAllowed <= 27) return scoring.pointsAllowed21To27 ?? 0;
  if (pointsAllowed <= 34) return scoring.pointsAllowed28To34 ?? -1;
  return scoring.pointsAllowed35Plus ?? -4;
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function rosterSizeLimit(db) {
  return Number(db.league.settings?.maxRosterSize || ((db.league.roster?.starters?.length || positions.length) + Number(db.league.roster?.bench || benchSlots)));
}

function isPlayerLocked(db, playerId, season = db.meta.season, week = db.meta.currentWeek) {
  return db.lineupLocks.some((lock) => lock.playerId === playerId && Number(lock.season) === Number(season) && Number(lock.week) === Number(week));
}

function isEligibleForSlot(position, slot) {
  if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
  if (slot === "D/ST") return position === "D/ST" || position === "DEF";
  return position === slot;
}

function validateRosterMove(db, teamId, options = {}) {
  const { addPlayerId, dropPlayerId, ignoreRosterLimit = false, season = db.meta.season, week = db.meta.currentWeek } = options;
  const errors = [];
  const team = db.teams.find((item) => item.id === teamId);
  const add = addPlayerId ? db.players.find((player) => player.id === addPlayerId) : null;
  const drop = dropPlayerId ? db.players.find((player) => player.id === dropPlayerId) : null;
  if (!team) errors.push("Team not found");
  if (addPlayerId && !add) errors.push("Added player not found");
  if (add && add.ownership) errors.push(`${add.name} is already rostered`);
  if (dropPlayerId && !drop) errors.push("Dropped player not found");
  if (drop && drop.ownership !== teamId) errors.push(`${drop.name} is not on this roster`);
  if (drop && isPlayerLocked(db, drop.id, season, week)) errors.push(`${drop.name} is locked for Week ${week}`);
  const currentSize = db.players.filter((player) => player.ownership === teamId).length;
  const nextSize = currentSize + (add ? 1 : 0) - (drop ? 1 : 0);
  if (!ignoreRosterLimit && nextSize > rosterSizeLimit(db)) errors.push(`Roster would exceed ${rosterSizeLimit(db)} players`);
  return { ok: errors.length === 0, errors, currentSize, nextSize };
}

function validateLineup(db, teamId, lineup = {}, season = db.meta.season, week = db.meta.currentWeek) {
  const errors = [];
  const rosterIds = new Set(db.players.filter((player) => player.ownership === teamId).map((player) => player.id));
  const used = new Set();
  for (const [slot, playerId] of Object.entries(lineup)) {
    if (!playerId) continue;
    const player = db.players.find((item) => item.id === playerId);
    if (!player) errors.push(`${slot}: player not found`);
    else if (!rosterIds.has(playerId)) errors.push(`${player.name} is not on this roster`);
    else if (!isEligibleForSlot(player.position, slot.replace(/\d+$/, ""))) errors.push(`${player.name} is not eligible for ${slot}`);
    if (used.has(playerId)) errors.push(`${player?.name || playerId} is used more than once`);
    used.add(playerId);
    const existingSlot = Object.entries(db.lineups[teamId] || {}).find(([, id]) => id === playerId)?.[0];
    if (existingSlot && existingSlot !== slot && isPlayerLocked(db, playerId, season, week)) errors.push(`${player?.name || playerId} is locked and cannot move slots`);
  }
  return { ok: errors.length === 0, errors };
}

function processWaivers(db) {
  const settings = db.league.waiver || {};
  normalizeWaiverClaims(db);
  const pending = waiverProcessingOrder(db);
  const results = [];
  for (const claim of pending) {
    const add = db.players.find((player) => player.id === claim.addPlayerId);
    const drop = db.players.find((player) => player.id === claim.dropPlayerId);
    const validation = validateRosterMove(db, claim.teamId, { addPlayerId: claim.addPlayerId, dropPlayerId: claim.dropPlayerId });
    if (!validation.ok) {
      claim.status = "failed";
      claim.reason = validation.errors.join("; ");
      claim.processedAt = Date.now();
      results.push({ claimId: claim.id, status: "failed", reason: claim.reason });
      continue;
    }
    add.ownership = claim.teamId;
    if (drop) {
      drop.ownership = null;
      removePlayerFromLineup(db, claim.teamId, drop.id);
    }
    claim.status = "processed";
    claim.reason = "";
    claim.processedAt = Date.now();
    rotateWaiverPriority(db, claim.teamId, settings.mode || "rolling");
    const team = db.teams.find((item) => item.id === claim.teamId);
    db.transactions.push({ id: `tx${Date.now()}-${claim.id}`, type: "waiver", teamId: claim.teamId, playerId: add.id, note: `${team.name} claimed ${add.name}${drop ? ` and dropped ${drop.name}` : ""}`, createdAt: Date.now() });
    results.push({ claimId: claim.id, status: "processed", addPlayer: add.name, dropPlayer: drop?.name || null });
  }
  return { processed: results.filter((item) => item.status === "processed").length, failed: results.filter((item) => item.status === "failed").length, results };
}

function normalizeWaiverClaims(db) {
  for (const team of db.teams) {
    const pending = db.waiverClaims
      .filter((claim) => claim.teamId === team.id && claim.status === "pending")
      .sort((a, b) => (a.claimOrder || 0) - (b.claimOrder || 0) || a.createdAt - b.createdAt);
    pending.forEach((claim, index) => {
      claim.claimOrder = index + 1;
      claim.priority = team.waiverRank;
    });
  }
}

function waiverProcessingOrder(db) {
  normalizeWaiverClaims(db);
  return db.waiverClaims
    .filter((claim) => claim.status === "pending")
    .sort((a, b) => {
      const aTeam = db.teams.find((team) => team.id === a.teamId);
      const bTeam = db.teams.find((team) => team.id === b.teamId);
      return (aTeam?.waiverRank || 999) - (bTeam?.waiverRank || 999) || (a.claimOrder || 999) - (b.claimOrder || 999) || a.createdAt - b.createdAt;
    });
}

function waiverPreview(db) {
  return waiverProcessingOrder(db).map((claim, index) => {
    const add = db.players.find((player) => player.id === claim.addPlayerId);
    const drop = db.players.find((player) => player.id === claim.dropPlayerId);
    const claimTeam = db.teams.find((team) => team.id === claim.teamId);
    const validation = validateRosterMove(db, claim.teamId, { addPlayerId: claim.addPlayerId, dropPlayerId: claim.dropPlayerId });
    return {
      claimId: claim.id,
      processOrder: index + 1,
      teamId: claim.teamId,
      teamName: claimTeam?.name || claim.teamId,
      waiverRank: claimTeam?.waiverRank || claim.priority || 999,
      claimOrder: claim.claimOrder || 0,
      addPlayerId: claim.addPlayerId,
      addPlayerName: add?.name || claim.addPlayerId,
      dropPlayerId: claim.dropPlayerId || null,
      dropPlayerName: drop?.name || null,
      valid: validation.ok,
      reason: validation.ok ? "" : validation.errors.join("; ")
    };
  });
}

function rotateWaiverPriority(db, teamId, mode) {
  if (!String(mode).toLowerCase().includes("rolling")) return;
  const used = db.teams.find((team) => team.id === teamId);
  if (!used) return;
  const oldRank = used.waiverRank;
  for (const team of db.teams) {
    if (team.id !== teamId && team.waiverRank > oldRank) team.waiverRank -= 1;
  }
  used.waiverRank = db.teams.length;
}

function removePlayerFromLineup(db, teamId, playerId) {
  for (const slot of Object.keys(db.lineups[teamId] || {})) {
    if (db.lineups[teamId][slot] === playerId) delete db.lineups[teamId][slot];
  }
}

function validateAllRosters(db) {
  return db.teams.map((team) => {
    const roster = db.players.filter((player) => player.ownership === team.id);
    const errors = [];
    if (roster.length > rosterSizeLimit(db)) errors.push(`Roster has ${roster.length}/${rosterSizeLimit(db)} players`);
    const lineup = validateLineup(db, team.id, db.lineups[team.id] || {});
    errors.push(...lineup.errors);
    return { teamId: team.id, teamName: team.name, rosterSize: roster.length, valid: errors.length === 0, errors };
  });
}

function tradeReviewMode(db) {
  return String(db.league.trade?.review || "Commissioner").toLowerCase();
}

function tradeNeedsCommissioner(db) {
  const mode = tradeReviewMode(db);
  return mode.includes("commissioner") || mode.includes("approval") || mode.includes("review");
}

function canUserReviewTrade(user, trade, db) {
  if (["admin", "commissioner"].includes(user.role)) return true;
  const toTeam = db.teams.find((team) => team.id === trade.toTeamId);
  return toTeam?.ownerUserId === user.id;
}

function validateTrade(db, trade) {
  const errors = [];
  const offered = trade.offeredPlayerIds || [];
  const requested = trade.requestedPlayerIds || [];
  if (!offered.length && !requested.length) errors.push("Trade must include at least one player");
  for (const id of offered) {
    const player = db.players.find((item) => item.id === id);
    if (!player) errors.push(`Offered player ${id} not found`);
    else if (player.ownership !== trade.fromTeamId) errors.push(`${player.name} is no longer on offering roster`);
    else if (isPlayerLocked(db, id)) errors.push(`${player.name} is locked this week`);
  }
  for (const id of requested) {
    const player = db.players.find((item) => item.id === id);
    if (!player) errors.push(`Requested player ${id} not found`);
    else if (player.ownership !== trade.toTeamId) errors.push(`${player.name} is no longer on receiving roster`);
    else if (isPlayerLocked(db, id)) errors.push(`${player.name} is locked this week`);
  }
  return { ok: errors.length === 0, errors };
}

function executeTrade(db, trade, actorId) {
  const validation = validateTrade(db, trade);
  if (!validation.ok) return { error: validation.errors.join("; ") };
  const fromRosterCount = db.players.filter((player) => player.ownership === trade.fromTeamId).length;
  const toRosterCount = db.players.filter((player) => player.ownership === trade.toTeamId).length;
  const fromNext = fromRosterCount - (trade.offeredPlayerIds || []).length + (trade.requestedPlayerIds || []).length;
  const toNext = toRosterCount - (trade.requestedPlayerIds || []).length + (trade.offeredPlayerIds || []).length;
  const limit = rosterSizeLimit(db);
  if (fromNext > limit || toNext > limit) return { error: `Trade would exceed roster size limit of ${limit}` };
  for (const id of trade.offeredPlayerIds || []) {
    const player = db.players.find((item) => item.id === id);
    player.ownership = trade.toTeamId;
    removePlayerFromLineup(db, trade.fromTeamId, id);
  }
  for (const id of trade.requestedPlayerIds || []) {
    const player = db.players.find((item) => item.id === id);
    player.ownership = trade.fromTeamId;
    removePlayerFromLineup(db, trade.toTeamId, id);
  }
  trade.status = "completed";
  trade.completedAt = Date.now();
  trade.reviewedBy = actorId;
  const fromTeam = db.teams.find((team) => team.id === trade.fromTeamId);
  const toTeam = db.teams.find((team) => team.id === trade.toTeamId);
  db.transactions.push({ id: `tx${Date.now()}-${trade.id}`, type: "trade", teamId: trade.fromTeamId, note: `Trade completed between ${fromTeam?.name} and ${toTeam?.name}`, createdAt: Date.now() });
  return { ok: true };
}

function describeTrade(db, trade) {
  const names = (ids) => (ids || []).map((id) => db.players.find((player) => player.id === id)?.name || id).join(", ");
  return {
    ...trade,
    offeredNames: names(trade.offeredPlayerIds),
    requestedNames: names(trade.requestedPlayerIds)
  };
}

function logActivity(db, options = {}) {
  const event = makeActivityEvent(db, options);
  db.activityEvents = [event, ...(db.activityEvents || [])].slice(0, 1000);
  return event;
}

function makeActivityEvent(db, options = {}) {
  const category = options.category || "commissioner";
  const recipients = resolveActivityRecipients(db, options);
  return {
    id: options.id || `act-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: options.type || category,
    category,
    title: String(options.title || "League update").slice(0, 120),
    body: String(options.body || "").slice(0, 400),
    actorUserId: options.actorUserId || null,
    teamId: options.teamId || null,
    playerId: options.playerId || null,
    metadata: options.metadata || {},
    visibleTo: recipients,
    readBy: options.readBy || [],
    delivery: { ...defaultDelivery(), ...(options.delivery || {}) },
    createdAt: options.createdAt || Date.now()
  };
}

function logDraftPickActivity(db, pick, user) {
  if (!pick) return;
  const team = db.teams.find((item) => item.id === pick.teamId);
  logActivity(db, {
    category: "draft",
    type: "draft_pick",
    title: `Pick ${pick.pickNumber}: ${pick.playerName}`,
    body: `${team?.name || "A team"} drafted ${pick.playerName} (${pick.position}) in Round ${pick.round}.`,
    actorUserId: user.id,
    teamId: pick.teamId,
    playerId: pick.playerId,
    metadata: { pickNumber: pick.pickNumber, round: pick.round, slot: pick.slot }
  });
}

function resolveActivityRecipients(db, options = {}) {
  if (options.visibleTo?.length) return [...new Set(options.visibleTo)];
  if (options.audience === "commissioner") return ["commissioner"];
  if (options.audience === "team" && options.teamId) {
    const owner = db.teams.find((team) => team.id === options.teamId)?.ownerUserId;
    return owner ? [owner, "commissioner"] : ["commissioner"];
  }
  if (options.audience === "trade") {
    const ids = [options.fromTeamId, options.toTeamId]
      .map((teamId) => db.teams.find((team) => team.id === teamId)?.ownerUserId)
      .filter(Boolean);
    return [...new Set([...ids, "commissioner"])];
  }
  return ["all"];
}

function createPasswordReset(db, userId) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + 1000 * 60 * 60;
  const resets = (db.meta.passwordResets || []).filter((item) => item.expiresAt > Date.now() && item.userId !== userId);
  resets.push({ userId, tokenHash: sign(`reset:${token}`), createdAt: Date.now(), expiresAt });
  db.meta.passwordResets = resets;
  return { token, expiresAt };
}

function consumePasswordReset(db, token, newPassword) {
  const resets = (db.meta.passwordResets || []).filter((item) => item.expiresAt > Date.now());
  const tokenHash = sign(`reset:${String(token || "")}`);
  const reset = resets.find((item) => item.tokenHash === tokenHash);
  if (!reset) return { error: "Reset token is invalid or expired" };
  if (String(newPassword || "").length < 8) return { error: "New password must be at least 8 characters" };
  const user = db.users.find((item) => item.id === reset.userId);
  if (!user) return { error: "Reset user not found" };
  user.salt = crypto.randomBytes(16).toString("hex");
  user.passwordHash = hashPassword(newPassword, user.salt);
  db.sessions = (db.sessions || []).filter((session) => session.userId !== user.id);
  db.meta.passwordResets = resets.filter((item) => item !== reset);
  return { user };
}

function exportLeagueData(db) {
  return {
    exportedAt: new Date().toISOString(),
    meta: { ...db.meta, passwordResets: [] },
    league: db.league,
    users: db.users.map(safeUser),
    teams: db.teams,
    players: db.players,
    lineups: db.lineups,
    matchups: db.matchups,
    transactions: db.transactions,
    waiverClaims: db.waiverClaims,
    trades: db.trades,
    tradeBlock: db.tradeBlock || [],
    chat: db.chat || [],
    playerResearch: db.playerResearch || [],
    scoring: {
      weeklyPlayerStats: db.weeklyPlayerStats || [],
      scoreCorrections: db.scoreCorrections || [],
      lineupLocks: db.lineupLocks || []
    },
    provider: {
      providerSync: db.providerSync,
      nflTeams: db.nflTeams || [],
      nflGames: db.nflGames || [],
      providerPlayers: db.providerPlayers || [],
      providerTrending: db.providerTrending || []
    },
    activityEvents: db.activityEvents || []
  };
}

function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let quoted = false;
  for (let index = 0; index < String(text || "").length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function importRosterCsv(db, csv, mode = "rosters") {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { error: "CSV must include a header row and at least one player row" };
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const read = (row, names) => {
    const index = names.map((name) => headers.indexOf(name)).find((item) => item >= 0);
    return index >= 0 ? row[index] : "";
  };
  const draft = normalizeDraftState(db);
  let assigned = 0;
  let skipped = 0;
  const picks = [];
  for (const row of rows.slice(1)) {
    const teamRef = read(row, ["teamid", "team", "teamname"]);
    const playerRef = read(row, ["playerid", "player", "playername", "name"]);
    const team = db.teams.find((item) => item.id === teamRef || item.name.toLowerCase() === teamRef.toLowerCase());
    const player = db.players.find((item) => item.id === playerRef || item.name.toLowerCase() === playerRef.toLowerCase());
    if (!team || !player) {
      skipped += 1;
      continue;
    }
    player.ownership = team.id;
    assigned += 1;
    if (mode === "draft") {
      picks.push({
        pickNumber: Number(read(row, ["pick", "picknumber"])) || picks.length + 1,
        round: Number(read(row, ["round"])) || Math.floor(picks.length / Math.max(1, db.teams.length)) + 1,
        slot: Number(read(row, ["slot"])) || ((picks.length % Math.max(1, db.teams.length)) + 1),
        teamId: team.id,
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        createdAt: new Date().toISOString()
      });
    }
  }
  if (mode === "draft" && picks.length) {
    draft.picks = [...(draft.picks || []), ...picks].sort((a, b) => a.pickNumber - b.pickNumber);
    draft.currentPick = Math.max(draft.currentPick || 1, draft.picks.length + 1);
  }
  return { assigned, skipped, mode };
}

function backupFileName(label = "manual") {
  const safeLabel = String(label || "manual").replace(/[^a-z0-9_-]/gi, "-").slice(0, 24) || "manual";
  return `family-fantasy-${safeLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
}

async function listBackups() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const files = await readdir(BACKUP_DIR);
  const backups = [];
  for (const file of files.filter((item) => item.endsWith(".sqlite"))) {
    const filePath = path.join(BACKUP_DIR, file);
    const info = await stat(filePath);
    backups.push({ file, size: info.size, createdAt: info.mtimeMs });
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt);
}

async function pruneBackups() {
  const backups = await listBackups();
  for (const backup of backups.slice(BACKUP_RETENTION)) {
    await unlink(path.join(BACKUP_DIR, backup.file)).catch(() => {});
  }
}

async function createSqliteBackup(label = "manual") {
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = backupFileName(label);
  const target = path.join(BACKUP_DIR, file);
  const sqliteDb = await getSqlite();
  sqliteDb.exec(`VACUUM INTO ${sqlString(target)}`);
  await pruneBackups();
  return { file, path: target, createdAt: Date.now(), retention: BACKUP_RETENTION };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeBackupPath(file) {
  const base = path.basename(String(file || ""));
  if (!base.endsWith(".sqlite")) return null;
  const resolved = path.resolve(BACKUP_DIR, base);
  return resolved.startsWith(path.resolve(BACKUP_DIR)) ? resolved : null;
}

async function restoreSqliteBackup(file) {
  const source = safeBackupPath(file);
  if (!source) return { error: "Choose a valid backup file" };
  await stat(source);
  await createSqliteBackup("pre-restore");
  closeSqlite();
  await copyFile(source, DB_PATH);
  await getSqlite();
  return { restoredFrom: path.basename(source), restoredAt: Date.now() };
}

async function ensureStartupBackup() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const backups = await listBackups();
  const newest = backups[0];
  if (!newest || Date.now() - newest.createdAt > BACKUP_INTERVAL_HOURS * 60 * 60 * 1000) {
    await createSqliteBackup("scheduled");
  }
}

function startScheduledBackups() {
  if (scheduledBackupTimer) clearInterval(scheduledBackupTimer);
  scheduledBackupTimer = setInterval(() => {
    createSqliteBackup("scheduled").catch((error) => console.error("Scheduled backup failed:", error.message));
  }, BACKUP_INTERVAL_HOURS * 60 * 60 * 1000);
}

function validateDbReferences(db) {
  const warnings = [];
  const teamIds = new Set((db.teams || []).map((team) => team.id));
  const userIds = new Set((db.users || []).map((user) => user.id));
  const playerIds = new Set((db.players || []).map((player) => player.id));
  for (const team of db.teams || []) {
    if (team.ownerUserId && !userIds.has(team.ownerUserId)) warnings.push(`Team ${team.name} has a missing owner user.`);
  }
  for (const player of db.players || []) {
    if (player.ownership && !teamIds.has(player.ownership)) warnings.push(`Player ${player.name} has a missing owning team.`);
  }
  for (const [teamId, lineup] of Object.entries(db.lineups || {})) {
    if (!teamIds.has(teamId)) warnings.push(`Lineup exists for missing team ${teamId}.`);
    for (const playerId of Object.values(lineup || {})) {
      if (playerId && !playerIds.has(playerId)) warnings.push(`Lineup for ${teamId} references missing player ${playerId}.`);
    }
  }
  for (const claim of db.waiverClaims || []) {
    if (!teamIds.has(claim.teamId)) warnings.push(`Waiver claim ${claim.id} has a missing team.`);
    if (!playerIds.has(claim.addPlayerId)) warnings.push(`Waiver claim ${claim.id} has a missing add player.`);
    if (claim.dropPlayerId && !playerIds.has(claim.dropPlayerId)) warnings.push(`Waiver claim ${claim.id} has a missing drop player.`);
  }
  for (const trade of db.trades || []) {
    if (!teamIds.has(trade.fromTeamId) || !teamIds.has(trade.toTeamId)) warnings.push(`Trade ${trade.id} references a missing team.`);
    for (const playerId of [...(trade.offeredPlayerIds || []), ...(trade.requestedPlayerIds || [])]) {
      if (!playerIds.has(playerId)) warnings.push(`Trade ${trade.id} references missing player ${playerId}.`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

function duplicatePlayerGroups(db) {
  const groups = new Map();
  for (const player of db.players || []) {
    const key = `${String(player.name || "").trim().toLowerCase()}|${player.position}|${player.nflTeam}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  return [...groups.values()].filter((items) => items.length > 1).map((items) => ({
    key: `${items[0].name} (${items[0].position}, ${items[0].nflTeam})`,
    players: items.map((player) => ({ id: player.id, name: player.name, ownership: player.ownership, projection: player.projection, status: player.status }))
  }));
}

function providerMappingCandidates(db, limit = 30) {
  const mappedProviderIds = new Set(Object.values(db.meta?.providerMappings || {}));
  const localNames = new Map((db.players || []).map((player) => [player.name.toLowerCase(), player]));
  return (db.providerPlayers || [])
    .filter((provider) => !mappedProviderIds.has(provider.id))
    .map((provider) => {
      const exact = localNames.get(String(provider.name || "").toLowerCase());
      const fuzzy = exact || (db.players || []).find((player) => player.name.split(" ").at(-1)?.toLowerCase() === String(provider.lastName || "").toLowerCase() && (!provider.team || player.nflTeam === provider.team));
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerTeam: provider.team,
        providerPosition: provider.position,
        suggestedPlayerId: fuzzy?.id || "",
        suggestedPlayerName: fuzzy?.name || ""
      };
    })
    .filter((item) => item.suggestedPlayerId)
    .slice(0, limit);
}

function dataQualityReport(db) {
  const references = validateDbReferences(db);
  const duplicates = duplicatePlayerGroups(db);
  const rosterValidations = validateAllRosters(db);
  const providerCandidates = providerMappingCandidates(db);
  const warnings = [
    ...references.warnings,
    ...duplicates.map((group) => `Duplicate player group: ${group.key}`),
    ...rosterValidations.filter((item) => !item.valid).map((item) => `${item.teamName}: ${item.errors.join("; ")}`)
  ];
  return {
    ok: warnings.length === 0,
    warnings,
    references,
    duplicates,
    rosterValidations,
    providerCandidates,
    summary: {
      warnings: warnings.length,
      duplicates: duplicates.length,
      invalidRosters: rosterValidations.filter((item) => !item.valid).length,
      providerCandidates: providerCandidates.length
    }
  };
}

function providerSettings(db) {
  const current = db.meta.providerSettings || {};
  return {
    refreshCadenceMinutes: Number(current.refreshCadenceMinutes || 120),
    scoringRefreshCadenceMinutes: Number(current.scoringRefreshCadenceMinutes || 15),
    cacheSnapshots: current.cacheSnapshots !== false,
    manualImportAllowed: current.manualImportAllowed !== false
  };
}

function readinessChecklist(db, phase = normalizeSeasonPhase(db)) {
  const quality = dataQualityReport(db);
  const rosterValidations = validateAllRosters(db);
  const draft = normalizeDraftState(db);
  const pendingClaims = (db.waiverClaims || []).filter((claim) => claim.status === "pending").length;
  const acceptedTrades = (db.trades || []).filter((trade) => ["offered", "commissioner_review"].includes(trade.status)).length;
  const checks = [
    { id: "quality", label: "Data quality has no warnings", ok: quality.summary.warnings === 0, detail: `${quality.summary.warnings} warning(s)` },
    { id: "rosters", label: "All rosters and lineups validate", ok: rosterValidations.every((item) => item.valid), detail: `${rosterValidations.filter((item) => !item.valid).length} invalid roster(s)` },
    { id: "provider", label: "Provider data is available or manual import is ready", ok: Boolean(db.providerSync?.lastRunAt || (db.weeklyPlayerStats || []).length), detail: db.providerSync?.message || "No sync yet" },
    { id: "backups", label: "Managed backup exists", ok: Boolean((db.meta.providerSnapshots || []).length || db.meta.seededAt), detail: "Use Home Server Health for backup age." }
  ];
  if (phase === "draft") checks.push({ id: "draft-order", label: "Draft order includes every team", ok: new Set(draft.order || []).size >= (db.teams || []).length, detail: `${draft.order?.length || 0}/${db.teams?.length || 0} teams` });
  if (phase === "regular_season") checks.push({ id: "schedule", label: "Regular season schedule exists", ok: (db.matchups || []).some((matchup) => !String(matchup.id).startsWith("playoff-")), detail: `${db.matchups?.length || 0} matchups` });
  if (phase === "playoffs") checks.push({ id: "playoffs", label: "Playoff bracket exists", ok: Boolean(db.league.playoffs?.bracket), detail: db.league.playoffs?.bracket ? "Bracket generated" : "No bracket" });
  checks.push({ id: "waivers", label: "Pending waivers are intentional", ok: pendingClaims === 0, detail: `${pendingClaims} pending claim(s)` });
  checks.push({ id: "trades", label: "Pending trades are intentional", ok: acceptedTrades === 0, detail: `${acceptedTrades} pending trade(s)` });
  return { phase, ready: checks.every((check) => check.ok), checks };
}

function scheduledJobsPanel(db) {
  const settings = providerSettings(db);
  const lastProvider = db.providerSync?.lastRunAt ? Date.parse(db.providerSync.lastRunAt) : null;
  const nextProvider = lastProvider ? lastProvider + settings.refreshCadenceMinutes * 60000 : null;
  const scoringHealth = db.providerSync?.details?.scoring || null;
  return {
    providerSync: { cadenceMinutes: settings.refreshCadenceMinutes, lastRunAt: db.providerSync?.lastRunAt || null, nextRunAt: nextProvider, status: db.providerSync?.message || "Not run yet" },
    scoringRefresh: { cadenceMinutes: settings.scoringRefreshCadenceMinutes, status: scoringHealth?.status || "idle", message: scoringHealth?.message || "No scoring ingest yet" },
    backups: { cadenceHours: BACKUP_INTERVAL_HOURS, retention: BACKUP_RETENTION },
    waivers: { pending: (db.waiverClaims || []).filter((claim) => claim.status === "pending").length, mode: db.league.waiver?.mode || "rolling" }
  };
}

function dryRunPreview(db, type, payload = {}) {
  if (type === "phase") {
    const phase = payload.phase || db.meta.seasonPhase;
    return { type, title: `Move to ${labelForPhase(phase)}`, checklist: readinessChecklist(db, phase), effects: phase === "playoffs" && !db.league.playoffs?.bracket ? ["Playoff bracket will be generated."] : ["Season phase will change."] };
  }
  if (type === "playoffs") {
    const clone = structuredClone(db);
    const bracket = generatePlayoffBracket(clone);
    return { type, title: "Generate playoff bracket", effects: bracket.games.filter((game) => game.homeTeamId && game.awayTeamId).map((game) => `${game.round}: ${clone.teams.find((team) => team.id === game.homeTeamId)?.name} vs ${clone.teams.find((team) => team.id === game.awayTeamId)?.name}`), checklist: readinessChecklist(db, "playoffs") };
  }
  if (type === "import") {
    const clone = structuredClone(db);
    const result = importRosterCsv(clone, payload.csv || "", payload.mode || "rosters");
    return { type, title: "Import CSV preview", effects: result.error ? [result.error] : [`${result.assigned} assignment(s), ${result.skipped} skipped.`], quality: result.error ? null : dataQualityReport(clone) };
  }
  if (type === "correction") {
    return { type, title: "Score correction preview", effects: [`Week ${payload.week || db.meta.currentWeek}: ${payload.pointsDelta || 0} points${payload.teamId ? ` for ${db.teams.find((team) => team.id === payload.teamId)?.name || payload.teamId}` : ""}.`] };
  }
  return { type, title: "Preview unavailable", effects: ["No dry-run preview exists for this action yet."] };
}

function providerSnapshot(db, type = "manual") {
  const snapshots = (db.meta.providerSnapshots || []).slice(-19);
  const snapshot = {
    id: `ps-${Date.now()}`,
    type,
    createdAt: Date.now(),
    providerSync: db.providerSync || {},
    counts: {
      nflTeams: db.nflTeams?.length || 0,
      nflGames: db.nflGames?.length || 0,
      providerPlayers: db.providerPlayers?.length || 0,
      providerTrending: db.providerTrending?.length || 0,
      weeklyStats: db.weeklyPlayerStats?.length || 0
    }
  };
  db.meta.providerSnapshots = [...snapshots, snapshot];
  return snapshot;
}

function importManualWeeklyStats(db, csv, options = {}) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { error: "CSV must include headers and at least one stat row" };
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const read = (row, names) => {
    const index = names.map((name) => headers.indexOf(name)).find((item) => item >= 0);
    return index >= 0 ? row[index] : "";
  };
  const season = Number(options.season || db.meta.season);
  const week = Number(options.week || db.meta.currentWeek);
  const statType = options.statType || "actual";
  let imported = 0;
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const ref = read(row, ["playerid", "player", "playername", "name"]);
    const player = db.players.find((item) => item.id === ref || item.name.toLowerCase() === String(ref).toLowerCase());
    if (!player) {
      skipped += 1;
      continue;
    }
    const stats = {};
    for (const [index, header] of headers.entries()) {
      if (["playerid", "player", "playername", "name", "fantasypoints", "points"].includes(header)) continue;
      const value = Number(row[index]);
      if (Number.isFinite(value)) stats[header] = value;
    }
    const fantasyPoints = Number(read(row, ["fantasypoints", "points"])) || calculateFantasyPoints(stats, db.league.scoring || {});
    const id = `manual-${season}-${week}-${statType}-${player.id}`;
    db.weeklyPlayerStats = (db.weeklyPlayerStats || []).filter((item) => item.id !== id);
    db.weeklyPlayerStats.push({
      id,
      provider: "manual",
      providerId: player.id,
      appPlayerId: player.id,
      season,
      week,
      statType,
      stats,
      fantasyPoints,
      raw: { imported: true },
      syncedAt: new Date().toISOString()
    });
    imported += 1;
  }
  recordScoringHealth(db, { status: imported ? "healthy" : "warning", message: `Manual import saved ${imported} stat rows; ${skipped} skipped.`, primary: { provider: "manual", rows: imported } });
  providerSnapshot(db, "manual-stat-import");
  return { imported, skipped, season, week, statType };
}

function mapProviderPlayer(db, providerId, playerId) {
  const provider = (db.providerPlayers || []).find((item) => item.id === providerId);
  const player = (db.players || []).find((item) => item.id === playerId);
  if (!provider || !player) return { error: "Provider player and app player are required" };
  db.meta.providerMappings = { ...(db.meta.providerMappings || {}), [providerId]: playerId };
  return { providerId, playerId, providerName: provider.name, playerName: player.name };
}

function repairOrphanReferences(db) {
  const teamIds = new Set((db.teams || []).map((team) => team.id));
  const userIds = new Set((db.users || []).map((user) => user.id));
  const playerIds = new Set((db.players || []).map((player) => player.id));
  let repaired = 0;
  for (const team of db.teams || []) {
    if (team.ownerUserId && !userIds.has(team.ownerUserId)) {
      team.ownerUserId = null;
      repaired += 1;
    }
  }
  for (const player of db.players || []) {
    if (player.ownership && !teamIds.has(player.ownership)) {
      player.ownership = null;
      repaired += 1;
    }
  }
  for (const [teamId, lineup] of Object.entries(db.lineups || {})) {
    if (!teamIds.has(teamId)) {
      delete db.lineups[teamId];
      repaired += 1;
      continue;
    }
    for (const [slot, playerId] of Object.entries(lineup || {})) {
      if (playerId && !playerIds.has(playerId)) {
        delete lineup[slot];
        repaired += 1;
      }
    }
  }
  db.waiverClaims = (db.waiverClaims || []).filter((claim) => {
    const keep = teamIds.has(claim.teamId) && playerIds.has(claim.addPlayerId) && (!claim.dropPlayerId || playerIds.has(claim.dropPlayerId));
    if (!keep) repaired += 1;
    return keep;
  });
  db.trades = (db.trades || []).filter((trade) => {
    const ids = [...(trade.offeredPlayerIds || []), ...(trade.requestedPlayerIds || [])];
    const keep = teamIds.has(trade.fromTeamId) && teamIds.has(trade.toTeamId) && ids.every((id) => playerIds.has(id));
    if (!keep) repaired += 1;
    return keep;
  });
  return { repaired, report: dataQualityReport(db) };
}

function mergePlayers(db, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return { error: "Choose two different players" };
  const source = db.players.find((player) => player.id === sourceId);
  const target = db.players.find((player) => player.id === targetId);
  if (!source || !target) return { error: "Source and target players are required" };
  const replace = (id) => (id === sourceId ? targetId : id);
  for (const lineup of Object.values(db.lineups || {})) {
    for (const [slot, playerId] of Object.entries(lineup || {})) lineup[slot] = replace(playerId);
  }
  for (const claim of db.waiverClaims || []) {
    claim.addPlayerId = replace(claim.addPlayerId);
    claim.dropPlayerId = replace(claim.dropPlayerId);
  }
  for (const trade of db.trades || []) {
    trade.offeredPlayerIds = [...new Set((trade.offeredPlayerIds || []).map(replace))];
    trade.requestedPlayerIds = [...new Set((trade.requestedPlayerIds || []).map(replace))];
  }
  for (const item of db.playerResearch || []) item.playerId = replace(item.playerId);
  for (const item of db.tradeBlock || []) item.playerId = replace(item.playerId);
  for (const item of db.transactions || []) item.playerId = replace(item.playerId);
  for (const item of db.weeklyPlayerStats || []) if (item.appPlayerId === sourceId) item.appPlayerId = targetId;
  for (const item of db.scoreCorrections || []) item.playerId = replace(item.playerId);
  for (const item of db.lineupLocks || []) item.playerId = replace(item.playerId);
  if (!target.ownership && source.ownership) target.ownership = source.ownership;
  target.projection = Math.max(Number(target.projection || 0), Number(source.projection || 0));
  db.players = db.players.filter((player) => player.id !== sourceId);
  return { merged: sourceId, into: targetId, report: dataQualityReport(db) };
}

async function buildSystemHealth(db) {
  const sqliteDb = await getSqlite();
  const integrity = sqliteDb.prepare("PRAGMA integrity_check").get()?.integrity_check || "unknown";
  const foreignKeys = sqliteDb.prepare("PRAGMA foreign_key_check").all();
  const migrations = sqliteDb.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
  const backups = await listBackups();
  const dbInfo = await stat(DB_PATH).catch(() => null);
  const references = validateDbReferences(db);
  const seededPasswordUsers = (db.users || []).filter(hasSeededPassword).map((user) => user.displayName);
  const health = {
    server: {
      status: "ok",
      host: HOST,
      port: PORT,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      lanUrl: `http://${getLikelyLanAddress()}:${PORT}`
    },
    database: {
      status: integrity === "ok" && foreignKeys.length === 0 && references.ok ? "ok" : "warning",
      path: DB_PATH,
      size: dbInfo?.size || 0,
      integrity,
      foreignKeyIssues: foreignKeys.length,
      referenceWarnings: references.warnings,
      migrations
    },
    backups: {
      status: backups.length ? "ok" : "warning",
      directory: BACKUP_DIR,
      retention: BACKUP_RETENTION,
      latest: backups[0] || null,
      count: backups.length,
      backups
    },
    provider: {
      status: db.providerSync?.details?.scoring?.status || "idle",
      lastRunAt: db.providerSync?.lastRunAt || null,
      message: db.providerSync?.message || "No provider sync yet."
    },
    security: {
      status: SESSION_SECRET === DEFAULT_SESSION_SECRET || seededPasswordUsers.length ? "warning" : "ok",
      defaultSessionSecret: SESSION_SECRET === DEFAULT_SESSION_SECRET,
      seededPasswordUsers
    }
  };
  health.status = [health.database.status, health.backups.status, health.security.status].includes("warning") ? "warning" : "ok";
  return health;
}

function getLikelyLanAddress() {
  const nets = os.networkInterfaces?.() || {};
  for (const list of Object.values(nets)) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "localhost";
}

async function handleApi(req, res, db) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!allowlisted(req)) return send(res, 403, { error: "This device is not allowed to access the league server." });
  if (!rateLimit(req, res, url)) return;
  if (url.pathname === "/api/session" && req.method === "GET") {
    const sessionUser = getSessionUser(db, req);
    return send(res, 200, { user: safeUser(sessionUser), csrfToken: sessionUser ? csrfTokenForSession(getSessionCookie(req)) : "" });
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    const { username, password } = await parseBody(req);
    const user = db.users.find((item) => item.username.toLowerCase() === String(username || "").toLowerCase());
    if (!user || hashPassword(password || "", user.salt) !== user.passwordHash) return send(res, 401, { error: "Invalid username or password" });
    const token = cookieSession(user.id);
    db.sessions.push({ token, userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 });
    await saveDb(db);
    return send(res, 200, { user: safeUser(user), csrfToken: csrfTokenForSession(token) }, { "Set-Cookie": `ff_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600` });
  }
  if (url.pathname === "/api/password-reset" && req.method === "POST") {
    const { token = "", newPassword = "" } = await parseBody(req);
    const result = consumePasswordReset(db, token, newPassword);
    if (result.error) return send(res, 400, { error: result.error });
    logActivity(db, { category: "commissioner", type: "password_reset_completed", title: "Password reset completed", body: `${result.user.displayName} reset their password with a commissioner token.`, actorUserId: result.user.id, visibleTo: [result.user.id, "commissioner"] });
    await saveDb(db);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    const raw = parseCookies(req).ff_session;
    db.sessions = db.sessions.filter((session) => session.token !== raw);
    await saveDb(db);
    return send(res, 200, { ok: true }, { "Set-Cookie": "ff_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  const user = requireUser(db, req, res);
  if (!user) return;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !validCsrf(req)) return send(res, 403, { error: "Security token expired. Refresh the page and try again." });
  const seededPasswordAllowed = new Set(["/api/profile/password", "/api/logout"]);
  if (hasSeededPassword(user) && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !seededPasswordAllowed.has(url.pathname)) {
    return send(res, 403, { error: "Change your seeded password before using league actions." });
  }

  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    return send(res, 200, { ...enrich(db, user), csrfToken: csrfTokenForSession(getSessionCookie(req)) });
  }
  if (url.pathname === "/api/sessions" && req.method === "GET") {
    const current = getSessionCookie(req);
    const sessions = (db.sessions || [])
      .filter((session) => session.userId === user.id && session.expiresAt > Date.now())
      .map((session) => ({ id: publicSessionId(session.token), createdAt: session.createdAt, expiresAt: session.expiresAt, current: session.token === current }));
    return send(res, 200, { sessions });
  }
  if (url.pathname === "/api/sessions/revoke-others" && req.method === "POST") {
    const current = getSessionCookie(req);
    db.sessions = (db.sessions || []).filter((session) => session.userId !== user.id || session.token === current);
    await saveDb(db);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    return send(res, 200, await buildSystemHealth(db));
  }
  if (url.pathname === "/api/activity/read" && req.method === "POST") {
    const { eventIds = [], all = false } = await parseBody(req);
    const visibleIds = new Set(visibleActivityForUser(db, user).map((event) => event.id));
    for (const event of db.activityEvents || []) {
      if ((all && visibleIds.has(event.id)) || eventIds.includes(event.id)) {
        event.readBy = [...new Set([...(event.readBy || []), user.id])];
      }
    }
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/notifications/preferences" && req.method === "PUT") {
    const { preferences = {} } = await parseBody(req);
    db.notificationPreferences = normalizeNotificationPreferences(db).map((pref) => (
      pref.userId === user.id
        ? { userId: user.id, preferences: mergeNotificationPreferences(pref.preferences, preferences), updatedAt: Date.now() }
        : pref
    ));
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/profile" && req.method === "PUT") {
    const { displayName, username, email = "", profileVisibility = "league" } = await parseBody(req);
    const nextUsername = String(username || user.username).trim();
    if (!nextUsername) return send(res, 400, { error: "Username is required" });
    if (db.users.some((item) => item.id !== user.id && item.username.toLowerCase() === nextUsername.toLowerCase())) return send(res, 400, { error: "Username is already taken" });
    user.username = nextUsername.slice(0, 40);
    user.displayName = String(displayName || user.displayName).trim().slice(0, 80) || user.displayName;
    user.email = String(email).trim().slice(0, 120);
    user.profileVisibility = ["league", "commissioner"].includes(profileVisibility) ? profileVisibility : "league";
    logActivity(db, { category: "commissioner", type: "profile_updated", title: "Profile updated", body: `${user.displayName} updated profile settings.`, actorUserId: user.id, visibleTo: [user.id, "commissioner"] });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/profile/password" && req.method === "PUT") {
    const { currentPassword = "", newPassword = "" } = await parseBody(req);
    if (hashPassword(currentPassword, user.salt) !== user.passwordHash) return send(res, 400, { error: "Current password is incorrect" });
    if (String(newPassword).length < 8) return send(res, 400, { error: "New password must be at least 8 characters" });
    user.salt = crypto.randomBytes(16).toString("hex");
    user.passwordHash = hashPassword(newPassword, user.salt);
    logActivity(db, { category: "commissioner", type: "self_password_changed", title: "Password changed", body: `${user.displayName} changed their password.`, actorUserId: user.id, visibleTo: [user.id, "commissioner"] });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    return send(res, 200, { users: db.users.map(safeUser), teams: db.teams });
  }
  if (url.pathname === "/api/admin/users" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { username, displayName, role = "manager", password, teamId } = await parseBody(req);
    if (!username || !password || db.users.some((item) => item.username === username)) return send(res, 400, { error: "Unique username and password are required" });
    const newUser = makeUser(`u${Date.now()}`, username, displayName || username, role, password);
    db.users.push(newUser);
    if (teamId) {
      const team = db.teams.find((item) => item.id === teamId);
      if (team) team.ownerUserId = newUser.id;
    }
    logActivity(db, { category: "commissioner", type: "user_created", title: "Account created", body: `${user.displayName} created an account for ${newUser.displayName}.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 201, { user: safeUser(newUser) });
  }
  if (url.pathname === "/api/admin/setup-family" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    applyFamilySetup(db);
    logActivity(db, { category: "commissioner", type: "family_setup", title: "Family defaults applied", body: `${user.displayName} applied the family league defaults.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/admin\/users\/[^/]+\/password$/) && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const id = url.pathname.split("/")[4];
    const target = db.users.find((item) => item.id === id);
    const { password } = await parseBody(req);
    if (!target || !password) return send(res, 400, { error: "User and password are required" });
    target.salt = crypto.randomBytes(16).toString("hex");
    target.passwordHash = hashPassword(password, target.salt);
    logActivity(db, { category: "commissioner", type: "password_changed", title: "Password changed", body: `${user.displayName} changed ${target.displayName}'s password.`, actorUserId: user.id, visibleTo: [target.id, "commissioner"], metadata: { targetUserId: target.id } });
    await saveDb(db);
    return send(res, 200, { user: safeUser(target) });
  }
  if (url.pathname.match(/^\/api\/admin\/users\/[^/]+\/reset-token$/) && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const id = url.pathname.split("/")[4];
    const target = db.users.find((item) => item.id === id);
    if (!target) return send(res, 404, { error: "User not found" });
    const reset = createPasswordReset(db, target.id);
    logActivity(db, { category: "commissioner", type: "password_reset_created", title: "Password reset token created", body: `${user.displayName} created a password reset token for ${target.displayName}.`, actorUserId: user.id, visibleTo: [target.id, "commissioner"], metadata: { targetUserId: target.id, expiresAt: reset.expiresAt } });
    await saveDb(db);
    return send(res, 201, { token: reset.token, expiresAt: reset.expiresAt, user: safeUser(target) });
  }
  if (url.pathname.match(/^\/api\/teams\/[^/]+$/) && req.method === "PUT") {
    const teamId = url.pathname.split("/")[3];
    const target = db.teams.find((item) => item.id === teamId);
    if (!target || !canManageTeam(user, target)) return send(res, 403, { error: "You cannot edit that team" });
    const { name, manager, logoUrl, color } = await parseBody(req);
    if (name) target.name = String(name).slice(0, 60);
    if (manager) target.manager = String(manager).slice(0, 4).toUpperCase();
    if (logoUrl !== undefined) target.logoUrl = cleanUrl(logoUrl);
    if (color !== undefined) target.color = normalizeTeamColor(color);
    logActivity(db, { category: "commissioner", type: "team_updated", title: "Team updated", body: `${target.name} settings were updated.`, actorUserId: user.id, teamId, audience: "team" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/schedule/generate" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { weeks = 14, startWeek = 1 } = await parseBody(req);
    db.matchups = generateSchedule(db.teams, Number(weeks), Number(startWeek));
    logActivity(db, { category: "commissioner", type: "schedule_generated", title: "Schedule generated", body: `${user.displayName} generated ${weeks} weeks of matchups.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/season/phase" && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const { phase } = await parseBody(req);
    if (!seasonPhases.includes(phase)) return send(res, 400, { error: "Unsupported season phase" });
    db.meta.seasonPhase = phase;
    if (phase === "playoffs" && !db.league.playoffs?.bracket) generatePlayoffBracket(db);
    logActivity(db, { category: "commissioner", type: "season_phase_changed", title: "Season phase changed", body: `${user.displayName} moved the league to ${labelForPhase(phase)}.`, actorUserId: user.id, audience: "all" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/playoffs/generate" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "playoffs")) return;
    const bracket = generatePlayoffBracket(db);
    logActivity(db, { category: "commissioner", type: "playoff_bracket_generated", title: "Playoff bracket generated", body: `${user.displayName} generated the playoff bracket.`, actorUserId: user.id, audience: "all", metadata: bracket });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/start" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const { rounds = 15, resetRosters = false } = await parseBody(req);
    const previous = normalizeDraftState(db);
    db.league.draft = {
      ...makeDraftState(previous.order),
      orderStyle: previous.orderStyle || "snake",
      pickTimeSeconds: previous.pickTimeSeconds || 60,
      positionLimits: previous.positionLimits || yahooDefaultRules.draft.positionLimits,
      queues: previous.queues || {},
      chat: previous.chat || [],
      keepers: previous.keepers || []
    };
    db.league.draft.rounds = Number(rounds || previous.rounds || 15);
    db.league.draft.status = "in_progress";
    db.league.draft.startedAt = new Date().toISOString();
    db.league.draft.clockStartedAt = db.league.draft.startedAt;
    if (resetRosters) clearRosters(db);
    applyDraftKeepers(db);
    logActivity(db, { category: "draft", type: "draft_started", title: "Draft started", body: `${user.displayName} started a ${db.league.draft.rounds}-round ${db.league.draft.orderStyle} draft.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/config" && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const { rounds, pickTimeSeconds, order = [], orderStyle = "snake" } = await parseBody(req);
    const draft = normalizeDraftState(db);
    const validIds = new Set(db.teams.map((team) => team.id));
    const nextOrder = [...new Set(order.filter((id) => validIds.has(id)))];
    for (const team of db.teams) if (!nextOrder.includes(team.id)) nextOrder.push(team.id);
    draft.order = nextOrder;
    draft.rounds = Math.max(1, Number(rounds || draft.rounds || 15));
    draft.pickTimeSeconds = Math.max(10, Number(pickTimeSeconds || draft.pickTimeSeconds || 60));
    draft.orderStyle = ["snake", "linear", "third_round_reversal"].includes(orderStyle) ? orderStyle : "snake";
    draft.mode = draft.orderStyle;
    draft.queues = Object.fromEntries(nextOrder.map((teamId) => [teamId, draft.queues?.[teamId] || []]));
    logActivity(db, { category: "draft", type: "draft_config_updated", title: "Draft settings updated", body: `${user.displayName} updated draft order, style, rounds, and pick timer.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/draft/queue" && req.method === "POST") {
    if (!requirePhase(db, res, "draft")) return;
    const { teamId, playerId } = await parseBody(req);
    const draftTeam = db.teams.find((team) => team.id === teamId);
    const draftPlayer = db.players.find((player) => player.id === playerId);
    if (!canManageTeam(user, draftTeam)) return send(res, 403, { error: "You cannot manage that draft queue" });
    if (!draftPlayer || draftPlayer.ownership) return send(res, 400, { error: "Only available players can be queued" });
    const draft = normalizeDraftState(db);
    draft.queues[teamId] = [...new Set([...(draft.queues[teamId] || []), playerId])];
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/draft\/queue\/[^/]+\/[^/]+$/) && req.method === "DELETE") {
    if (!requirePhase(db, res, "draft")) return;
    const [, , , teamId, playerId] = url.pathname.split("/");
    const draftTeam = db.teams.find((team) => team.id === teamId);
    if (!canManageTeam(user, draftTeam)) return send(res, 403, { error: "You cannot manage that draft queue" });
    const draft = normalizeDraftState(db);
    draft.queues[teamId] = (draft.queues[teamId] || []).filter((id) => id !== playerId);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/draft/chat" && req.method === "POST") {
    if (!requirePhase(db, res, "draft")) return;
    const { body } = await parseBody(req);
    if (!body) return send(res, 400, { error: "Message is required" });
    const draft = normalizeDraftState(db);
    draft.chat = [...(draft.chat || []), { id: `dc${Date.now()}`, author: user.displayName, body: String(body).slice(0, 300), createdAt: Date.now() }].slice(-80);
    logActivity(db, { category: "chat", type: "draft_chat_message", title: "Draft chat", body: `${user.displayName}: ${String(body).slice(0, 160)}`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/keepers" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const { teamId, playerId, round = 1, note = "" } = await parseBody(req);
    const keeperTeam = db.teams.find((team) => team.id === teamId);
    const keeperPlayer = db.players.find((player) => player.id === playerId);
    if (!keeperTeam || !keeperPlayer) return send(res, 400, { error: "Team and player are required" });
    const draft = normalizeDraftState(db);
    draft.keepers = [
      ...(draft.keepers || []).filter((keeper) => !(keeper.teamId === teamId && keeper.playerId === playerId)),
      { teamId, playerId, round: Number(round || 1), note: String(note).slice(0, 160), applied: false }
    ];
    logActivity(db, { category: "draft", type: "keeper_added", title: "Keeper added", body: `${keeperTeam.name} marked ${keeperPlayer.name} as a keeper.`, actorUserId: user.id, teamId, playerId });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/admin\/draft\/keepers\/[^/]+$/) && req.method === "DELETE") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const playerId = url.pathname.split("/")[5];
    const draft = normalizeDraftState(db);
    draft.keepers = (draft.keepers || []).filter((keeper) => keeper.playerId !== playerId);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/pick" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const { playerId } = await parseBody(req);
    const teamId = getDraftTeamId(db.league.draft);
    const validation = validateRosterMove(db, teamId, { addPlayerId: playerId, ignoreRosterLimit: true });
    if (!validation.ok) return send(res, 400, { error: validation.errors.join("; ") });
    const result = makeDraftPick(db, playerId);
    if (result.error) return send(res, 400, { error: result.error });
    logDraftPickActivity(db, result.pick, user);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/autopick" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const player = chooseAutoPick(db);
    if (!player) return send(res, 400, { error: "No eligible players available" });
    const result = makeDraftPick(db, player.id);
    if (result.error) return send(res, 400, { error: result.error });
    logDraftPickActivity(db, result.pick, user);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/pause" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const draft = normalizeDraftState(db);
    if (!["in_progress", "paused"].includes(draft.status)) return send(res, 400, { error: "Draft must be in progress before it can be paused" });
    draft.status = draft.status === "paused" ? "in_progress" : "paused";
    draft.pausedAt = draft.status === "paused" ? new Date().toISOString() : null;
    if (draft.status === "in_progress") draft.clockStartedAt = new Date().toISOString();
    logActivity(db, { category: "draft", type: "draft_pause_toggle", title: draft.status === "paused" ? "Draft paused" : "Draft resumed", body: `${user.displayName} ${draft.status === "paused" ? "paused" : "resumed"} the draft.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/undo" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const result = undoDraftPick(db);
    if (result.error) return send(res, 400, { error: result.error });
    logActivity(db, { category: "draft", type: "draft_pick_undone", title: "Draft pick undone", body: `${user.displayName} undid ${result.pick.playerName}.`, actorUserId: user.id, teamId: result.pick.teamId, playerId: result.pick.playerId });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/test" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const { rounds = 15 } = await parseBody(req);
    runTestDraft(db, Number(rounds));
    logActivity(db, { category: "draft", type: "test_draft", title: "Test draft completed", body: `${user.displayName} ran a balanced ${rounds}-round test draft.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/draft/reset" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "draft")) return;
    const previous = normalizeDraftState(db);
    db.league.draft = { ...makeDraftState(previous.order), orderStyle: previous.orderStyle || "snake", pickTimeSeconds: previous.pickTimeSeconds || 60, keepers: previous.keepers || [] };
    clearRosters(db);
    logActivity(db, { category: "draft", type: "draft_reset", title: "Draft reset", body: `${user.displayName} reset the draft and cleared rosters.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/lineup" && req.method === "PUT") {
    if (!requirePhase(db, res, "lineup")) return;
    const { teamId, lineup } = await parseBody(req);
    const team = db.teams.find((item) => item.id === teamId);
    if (!team || !canManageTeam(user, team)) return send(res, 403, { error: "You cannot manage that team" });
    const validation = validateLineup(db, teamId, lineup || {});
    if (!validation.ok) return send(res, 400, { error: validation.errors.join("; ") });
    db.lineups[teamId] = lineup || {};
    logActivity(db, { category: "roster", type: "lineup_saved", title: "Lineup saved", body: `${team.name} saved a lineup for Week ${db.meta.currentWeek}.`, actorUserId: user.id, teamId, audience: "team" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/transactions/add-drop" && req.method === "POST") {
    if (!requirePhase(db, res, "roster")) return;
    const { teamId, addPlayerId, dropPlayerId } = await parseBody(req);
    const team = db.teams.find((item) => item.id === teamId);
    if (!team || !canManageTeam(user, team)) return send(res, 403, { error: "You cannot manage that team" });
    if (db.league.waiver?.allowFreeAgentAdds === false && !requireAdmin(user, res)) return;
    const add = db.players.find((player) => player.id === addPlayerId);
    const drop = db.players.find((player) => player.id === dropPlayerId);
    const validation = validateRosterMove(db, teamId, { addPlayerId, dropPlayerId });
    if (!validation.ok) return send(res, 400, { error: validation.errors.join("; ") });
    add.ownership = teamId;
    if (drop) {
      drop.ownership = null;
      removePlayerFromLineup(db, teamId, drop.id);
    }
    db.transactions.push({ id: `tx${Date.now()}`, type: "add_drop", teamId, playerId: add.id, note: `${team.name} added ${add.name}${drop ? ` and dropped ${drop.name}` : ""}`, createdAt: Date.now() });
    logActivity(db, { category: "roster", type: "add_drop", title: "Roster move", body: `${team.name} added ${add.name}${drop ? ` and dropped ${drop.name}` : ""}.`, actorUserId: user.id, teamId, playerId: add.id });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/waivers" && req.method === "POST") {
    if (!requirePhase(db, res, "waiver")) return;
    const { teamId, addPlayerId, dropPlayerId, bid = 0 } = await parseBody(req);
    const team = db.teams.find((item) => item.id === teamId);
    if (!team || !canManageTeam(user, team)) return send(res, 403, { error: "You cannot manage that team" });
    if (db.league.waiver?.allowWaiverAdds === false) return send(res, 400, { error: "Waiver claims are disabled by league settings" });
    const add = db.players.find((player) => player.id === addPlayerId);
    if (!add || add.ownership) return send(res, 400, { error: "Waiver target must be an available player" });
    if (dropPlayerId) {
      const drop = db.players.find((player) => player.id === dropPlayerId);
      if (!drop || drop.ownership !== teamId) return send(res, 400, { error: "Dropped player must be on your roster" });
      if (isPlayerLocked(db, drop.id)) return send(res, 400, { error: "Dropped player is locked this week" });
    }
    normalizeWaiverClaims(db);
    const nextOrder = db.waiverClaims.filter((claim) => claim.teamId === teamId && claim.status === "pending").length + 1;
    const claim = { id: `w${Date.now()}`, teamId, addPlayerId, dropPlayerId, bid: Number(bid), status: "pending", reason: "", priority: team.waiverRank, claimOrder: nextOrder, createdAt: Date.now(), processedAt: null };
    db.waiverClaims.push(claim);
    logActivity(db, { category: "waiver", type: "waiver_claim_submitted", title: "Waiver claim submitted", body: `${team.name} submitted a claim for ${add.name}.`, actorUserId: user.id, teamId, playerId: add.id, audience: "team" });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/waivers\/[^/]+$/) && url.pathname !== "/api/waivers/reorder" && req.method === "PUT") {
    if (!requirePhase(db, res, "waiver")) return;
    const claim = db.waiverClaims.find((item) => item.id === url.pathname.split("/")[3]);
    const { dropPlayerId = "", claimOrder } = await parseBody(req);
    if (!claim) return send(res, 404, { error: "Waiver claim not found" });
    const claimTeam = db.teams.find((item) => item.id === claim.teamId);
    if (!claimTeam || !canManageTeam(user, claimTeam)) return send(res, 403, { error: "You cannot manage that waiver claim" });
    if (claim.status !== "pending") return send(res, 400, { error: "Only pending claims can be edited" });
    if (dropPlayerId) {
      const drop = db.players.find((player) => player.id === dropPlayerId);
      if (!drop || drop.ownership !== claim.teamId) return send(res, 400, { error: "Dropped player must be on your roster" });
      if (isPlayerLocked(db, drop.id)) return send(res, 400, { error: "Dropped player is locked this week" });
    }
    claim.dropPlayerId = dropPlayerId || null;
    if (claimOrder !== undefined) claim.claimOrder = Math.max(1, Number(claimOrder || 1));
    normalizeWaiverClaims(db);
    logActivity(db, { category: "waiver", type: "waiver_claim_edited", title: "Waiver claim edited", body: `${claimTeam.name} edited a waiver claim for ${db.players.find((p) => p.id === claim.addPlayerId)?.name || "a player"}.`, actorUserId: user.id, teamId: claim.teamId, playerId: claim.addPlayerId, audience: "team" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/waivers/reorder" && req.method === "PUT") {
    if (!requirePhase(db, res, "waiver")) return;
    const { teamId, claimIds = [] } = await parseBody(req);
    const claimTeam = db.teams.find((item) => item.id === teamId);
    if (!claimTeam || !canManageTeam(user, claimTeam)) return send(res, 403, { error: "You cannot manage that waiver queue" });
    const allowed = new Set(db.waiverClaims.filter((claim) => claim.teamId === teamId && claim.status === "pending").map((claim) => claim.id));
    claimIds.filter((id) => allowed.has(id)).forEach((id, index) => {
      const claim = db.waiverClaims.find((item) => item.id === id);
      if (claim) claim.claimOrder = index + 1;
    });
    normalizeWaiverClaims(db);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/waivers\/[^/]+$/) && req.method === "DELETE") {
    if (!requirePhase(db, res, "waiver")) return;
    const claim = db.waiverClaims.find((item) => item.id === url.pathname.split("/")[3]);
    if (!claim) return send(res, 404, { error: "Waiver claim not found" });
    const claimTeam = db.teams.find((item) => item.id === claim.teamId);
    if (!claimTeam || !canManageTeam(user, claimTeam)) return send(res, 403, { error: "You cannot manage that waiver claim" });
    if (claim.status !== "pending") return send(res, 400, { error: "Only pending claims can be cancelled" });
    claim.status = "cancelled";
    claim.processedAt = Date.now();
    logActivity(db, { category: "waiver", type: "waiver_claim_cancelled", title: "Waiver claim cancelled", body: `${claimTeam.name} cancelled a waiver claim for ${db.players.find((p) => p.id === claim.addPlayerId)?.name || "a player"}.`, actorUserId: user.id, teamId: claim.teamId, playerId: claim.addPlayerId, audience: "team" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/waivers/process" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "waiver")) return;
    const result = processWaivers(db);
    logActivity(db, { category: "waiver", type: "waivers_processed", title: "Waivers processed", body: `${user.displayName} processed waivers: ${result.processed} successful, ${result.failed} failed.`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), waiverResult: result });
  }
  if (url.pathname === "/api/admin/rosters/validate" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    const validations = validateAllRosters(db);
    logActivity(db, { category: "commissioner", type: "rosters_validated", title: "Rosters validated", body: `${user.displayName} validated rosters: ${validations.filter((item) => item.valid).length}/${validations.length} valid.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 200, { validations });
  }
  if (url.pathname === "/api/player-research" && req.method === "PUT") {
    const { playerId, note = "", watchlist = false } = await parseBody(req);
    if (!db.players.some((player) => player.id === playerId)) return send(res, 404, { error: "Player not found" });
    const next = {
      userId: user.id,
      playerId,
      note: String(note).slice(0, 1000),
      watchlist: Boolean(watchlist),
      updatedAt: Date.now()
    };
    db.playerResearch = [
      ...(db.playerResearch || []).filter((item) => !(item.userId === user.id && item.playerId === playerId)),
      next
    ];
    logActivity(db, { category: "roster", type: "player_research_saved", title: "Player research saved", body: `${user.displayName} updated research for ${db.players.find((player) => player.id === playerId)?.name}.`, actorUserId: user.id, playerId, visibleTo: [user.id] });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/trade-block" && req.method === "POST") {
    const { teamId, playerId, note = "" } = await parseBody(req);
    const blockTeam = db.teams.find((item) => item.id === teamId);
    const blockPlayer = db.players.find((item) => item.id === playerId);
    if (!canManageTeam(user, blockTeam)) return send(res, 403, { error: "You cannot manage that trade block" });
    if (!blockPlayer || blockPlayer.ownership !== teamId) return send(res, 400, { error: "Trade block players must be on that roster" });
    db.tradeBlock = [
      ...(db.tradeBlock || []).filter((item) => !(item.teamId === teamId && item.playerId === playerId)),
      { teamId, playerId, note: String(note).slice(0, 240), createdAt: Date.now() }
    ];
    logActivity(db, { category: "trade", type: "trade_block_added", title: "Trade block updated", body: `${blockTeam.name} put ${blockPlayer.name} on the trade block.`, actorUserId: user.id, teamId, playerId, audience: "all" });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/trade-block\/[^/]+$/) && req.method === "DELETE") {
    const playerId = url.pathname.split("/")[3];
    const item = (db.tradeBlock || []).find((entry) => entry.playerId === playerId);
    if (!item) return send(res, 404, { error: "Trade block item not found" });
    if (!canManageTeam(user, db.teams.find((team) => team.id === item.teamId))) return send(res, 403, { error: "You cannot manage that trade block" });
    db.tradeBlock = (db.tradeBlock || []).filter((entry) => entry.playerId !== playerId);
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/trades\/[^/]+\/counter$/) && req.method === "POST") {
    if (!requirePhase(db, res, "trade")) return;
    const original = db.trades.find((item) => item.id === url.pathname.split("/")[3]);
    const { fromTeamId, toTeamId, offeredPlayerIds = [], requestedPlayerIds = [], message = "" } = await parseBody(req);
    if (!original) return send(res, 404, { error: "Trade not found" });
    if (![original.fromTeamId, original.toTeamId].includes(fromTeamId) || ![original.fromTeamId, original.toTeamId].includes(toTeamId) || fromTeamId === toTeamId) {
      return send(res, 400, { error: "Counteroffers must stay between the original trade teams" });
    }
    if (!canManageTeam(user, db.teams.find((team) => team.id === fromTeamId))) return send(res, 403, { error: "You cannot manage that counteroffer" });
    const trade = {
      id: `tr${Date.now()}`,
      fromTeamId,
      toTeamId,
      offeredPlayerIds,
      requestedPlayerIds,
      message: String(message || "Counteroffer").slice(0, 240),
      status: "offered",
      createdAt: Date.now(),
      acceptedAt: null,
      reviewedBy: null,
      reviewNote: "",
      completedAt: null,
      expiresAt: Date.now() + Number(db.league.trade?.rejectionDays || 2) * 86400000,
      parentTradeId: original.id
    };
    const validation = validateTrade(db, trade);
    if (!validation.ok) return send(res, 400, { error: validation.errors.join("; ") });
    if (original.status === "offered") original.status = "countered";
    db.trades.push(trade);
    logActivity(db, { category: "trade", type: "trade_countered", title: "Trade counteroffer", body: `${db.teams.find((team) => team.id === fromTeamId)?.name} sent a counteroffer.`, actorUserId: user.id, fromTeamId, toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname === "/api/trades" && req.method === "POST") {
    if (!requirePhase(db, res, "trade")) return;
    const { fromTeamId, toTeamId, offeredPlayerIds = [], requestedPlayerIds = [], message = "" } = await parseBody(req);
    const team = db.teams.find((item) => item.id === fromTeamId);
    const targetTeam = db.teams.find((item) => item.id === toTeamId);
    if (!team || !canManageTeam(user, team)) return send(res, 403, { error: "You cannot manage that team" });
    if (!targetTeam || targetTeam.id === team.id) return send(res, 400, { error: "Choose another team for the trade" });
    const trade = {
      id: `tr${Date.now()}`,
      fromTeamId,
      toTeamId,
      offeredPlayerIds,
      requestedPlayerIds,
      message: String(message).slice(0, 240),
      status: "offered",
      createdAt: Date.now(),
      acceptedAt: null,
      reviewedBy: null,
      reviewNote: "",
      completedAt: null,
      expiresAt: Date.now() + Number(db.league.trade?.rejectionDays || 2) * 86400000
    };
    const requestedOwners = new Set((requestedPlayerIds || []).map((id) => db.players.find((player) => player.id === id)?.ownership).filter(Boolean));
    if (requestedOwners.size > 1 || (requestedOwners.size === 1 && !requestedOwners.has(toTeamId))) return send(res, 400, { error: "Requested players must belong to the selected receiving team" });
    const validation = validateTrade(db, trade);
    if (!validation.ok) return send(res, 400, { error: validation.errors.join("; ") });
    db.trades.push(trade);
    logActivity(db, { category: "trade", type: "trade_offered", title: "Trade offered", body: `${team.name} offered a trade to ${db.teams.find((item) => item.id === toTeamId)?.name}.`, actorUserId: user.id, fromTeamId, toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname.match(/^\/api\/trades\/[^/]+$/) && req.method === "PUT") {
    if (!requirePhase(db, res, "trade")) return;
    const trade = db.trades.find((item) => item.id === url.pathname.split("/")[3]);
    const { status, note = "" } = await parseBody(req);
    if (!trade) return send(res, 404, { error: "Trade not found" });
    const targetTeam = db.teams.find((item) => item.id === trade.toTeamId);
    if (!canUserReviewTrade(user, trade, db)) return send(res, 403, { error: "You cannot review this trade" });
    if (["declined", "cancelled"].includes(status)) {
      if (status === "cancelled" && !canManageTeam(user, db.teams.find((item) => item.id === trade.fromTeamId))) return send(res, 403, { error: "Only the offering team can cancel this trade" });
      trade.status = status;
      trade.reviewNote = String(note).slice(0, 240);
      trade.reviewedBy = user.id;
      logActivity(db, { category: "trade", type: `trade_${status}`, title: `Trade ${status}`, body: `${user.displayName} ${status} a trade.`, actorUserId: user.id, fromTeamId: trade.fromTeamId, toTeamId: trade.toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
    } else if (status === "accepted") {
      if (!canManageTeam(user, targetTeam)) return send(res, 403, { error: "Only the receiving team can accept this trade" });
      trade.acceptedAt = Date.now();
      trade.status = tradeNeedsCommissioner(db) ? "commissioner_review" : "accepted";
      if (!tradeNeedsCommissioner(db)) {
        const result = executeTrade(db, trade, user.id);
        if (result.error) return send(res, 400, { error: result.error });
      }
      logActivity(db, { category: "trade", type: trade.status === "completed" ? "trade_completed" : "trade_accepted", title: trade.status === "completed" ? "Trade completed" : "Trade accepted", body: `${user.displayName} accepted a trade${trade.status === "commissioner_review" ? "; commissioner review is pending" : ""}.`, actorUserId: user.id, fromTeamId: trade.fromTeamId, toTeamId: trade.toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
    } else if (["approved", "vetoed"].includes(status)) {
      if (!requireAdmin(user, res)) return;
      trade.reviewNote = String(note).slice(0, 240);
      if (status === "vetoed") {
        trade.status = "vetoed";
        trade.reviewedBy = user.id;
        logActivity(db, { category: "trade", type: "trade_vetoed", title: "Trade vetoed", body: `${user.displayName} vetoed a trade.`, actorUserId: user.id, fromTeamId: trade.fromTeamId, toTeamId: trade.toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
      } else {
        const result = executeTrade(db, trade, user.id);
        if (result.error) return send(res, 400, { error: result.error });
        logActivity(db, { category: "trade", type: "trade_approved", title: "Trade approved", body: `${user.displayName} approved and completed a trade.`, actorUserId: user.id, fromTeamId: trade.fromTeamId, toTeamId: trade.toTeamId, audience: "trade", metadata: describeTrade(db, trade) });
      }
    } else {
      return send(res, 400, { error: "Unsupported trade status" });
    }
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/trades/expire" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "trade")) return;
    let expired = 0;
    for (const trade of db.trades) {
      if (trade.status === "offered" && trade.expiresAt && trade.expiresAt < Date.now()) {
        trade.status = "expired";
        expired += 1;
      }
    }
    if (expired) logActivity(db, { category: "trade", type: "trades_expired", title: "Trades expired", body: `${user.displayName} expired ${expired} old trade offer${expired === 1 ? "" : "s"}.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), expired });
  }
  if (url.pathname === "/api/admin/export" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    const payload = JSON.stringify(exportLeagueData(db), null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="family-fantasy-export-${new Date().toISOString().slice(0, 10)}.json"`
    });
    return res.end(payload);
  }
  if (url.pathname === "/api/admin/health" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    return send(res, 200, await buildSystemHealth(db));
  }
  if (url.pathname === "/api/admin/readiness" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    return send(res, 200, { readiness: readinessChecklist(db), jobs: scheduledJobsPanel(db), quality: dataQualityReport(db) });
  }
  if (url.pathname === "/api/admin/dry-run" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { type, payload = {} } = await parseBody(req);
    return send(res, 200, dryRunPreview(db, type, payload));
  }
  if (url.pathname === "/api/admin/data-quality/repair" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const result = repairOrphanReferences(db);
    logActivity(db, { category: "commissioner", type: "data_repair", title: "Data repair completed", body: `${user.displayName} repaired ${result.repaired} orphaned reference${result.repaired === 1 ? "" : "s"}.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), repair: result });
  }
  if (url.pathname === "/api/admin/data-quality/merge-player" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { sourceId, targetId } = await parseBody(req);
    const result = mergePlayers(db, sourceId, targetId);
    if (result.error) return send(res, 400, { error: result.error });
    logActivity(db, { category: "commissioner", type: "player_merge", title: "Players merged", body: `${user.displayName} merged ${sourceId} into ${targetId}.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), merge: result });
  }
  if (url.pathname === "/api/admin/provider/settings" && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const incoming = await parseBody(req);
    db.meta.providerSettings = {
      refreshCadenceMinutes: Math.max(5, Number(incoming.refreshCadenceMinutes || providerSettings(db).refreshCadenceMinutes)),
      scoringRefreshCadenceMinutes: Math.max(5, Number(incoming.scoringRefreshCadenceMinutes || providerSettings(db).scoringRefreshCadenceMinutes)),
      cacheSnapshots: incoming.cacheSnapshots !== false,
      manualImportAllowed: incoming.manualImportAllowed !== false
    };
    logActivity(db, { category: "commissioner", type: "provider_settings_updated", title: "Provider settings updated", body: `${user.displayName} updated provider cadence and import settings.`, actorUserId: user.id, audience: "commissioner", metadata: db.meta.providerSettings });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/provider/snapshot" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const snapshot = providerSnapshot(db, "commissioner");
    await saveDb(db);
    return send(res, 201, { snapshot, snapshots: db.meta.providerSnapshots || [] });
  }
  if (url.pathname === "/api/admin/provider/map" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { providerId, playerId } = await parseBody(req);
    const result = mapProviderPlayer(db, providerId, playerId);
    if (result.error) return send(res, 400, { error: result.error });
    logActivity(db, { category: "commissioner", type: "provider_player_mapped", title: "Provider player mapped", body: `${user.displayName} mapped ${result.providerName} to ${result.playerName}.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/backup/create" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const backup = await createSqliteBackup("manual");
    logActivity(db, { category: "commissioner", type: "sqlite_backup_created", title: "SQLite backup created", body: `${user.displayName} created backup ${backup.file}.`, actorUserId: user.id, audience: "commissioner", metadata: backup });
    await saveDb(db);
    return send(res, 201, { backup, health: await buildSystemHealth(db) });
  }
  if (url.pathname === "/api/admin/backup" && req.method === "GET") {
    if (!requireAdmin(user, res)) return;
    res.writeHead(200, {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="family-fantasy-backup-${new Date().toISOString().slice(0, 10)}.sqlite"`
    });
    return createReadStream(DB_PATH).pipe(res);
  }
  if (url.pathname === "/api/admin/restore" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { file } = await parseBody(req);
    const result = await restoreSqliteBackup(file);
    if (result.error) return send(res, 400, { error: result.error });
    const restoredDb = await loadDb();
    logActivity(restoredDb, { category: "commissioner", type: "sqlite_backup_restored", title: "SQLite backup restored", body: `${user.displayName} restored backup ${result.restoredFrom}.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(restoredDb);
    return send(res, 200, { ok: true, restore: result, health: await buildSystemHealth(restoredDb) });
  }
  if (url.pathname === "/api/admin/import/rosters" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { csv = "", mode = "rosters" } = await parseBody(req);
    const result = importRosterCsv(db, csv, mode);
    if (result.error) return send(res, 400, { error: result.error });
    const validation = validateDbReferences(db);
    if (!validation.ok) return send(res, 400, { error: "Import created invalid references", warnings: validation.warnings });
    logActivity(db, { category: "commissioner", type: "csv_import", title: "CSV import completed", body: `${user.displayName} imported ${result.assigned} player assignment${result.assigned === 1 ? "" : "s"} from CSV.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), importResult: result });
  }
  if (url.pathname === "/api/admin/scoring/manual-import" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    const { csv = "", season = db.meta.season, week = db.meta.currentWeek, statType = "actual" } = await parseBody(req);
    const result = importManualWeeklyStats(db, csv, { season, week, statType });
    if (result.error) return send(res, 400, { error: result.error });
    logActivity(db, { category: "scoring", type: "manual_stats_imported", title: "Manual stats imported", body: `${user.displayName} imported ${result.imported} manual stat rows for Week ${result.week}.`, actorUserId: user.id, audience: "commissioner", metadata: result });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), manualImport: result });
  }
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const { body } = await parseBody(req);
    if (!body) return send(res, 400, { error: "Message is required" });
    db.chat.push({ id: `c${Date.now()}`, author: user.displayName, body: String(body).slice(0, 400), createdAt: Date.now() });
    logActivity(db, { category: "chat", type: "chat_message", title: "League chat", body: `${user.displayName}: ${String(body).slice(0, 160)}`, actorUserId: user.id });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname === "/api/sync" && req.method === "POST") {
    if (providerSettings(db).cacheSnapshots) providerSnapshot(db, "pre-sync");
    try {
      db.providerSync = await syncProvider(db);
      if (providerSettings(db).cacheSnapshots) providerSnapshot(db, "post-sync");
    } catch (error) {
      const lastSnapshot = (db.meta.providerSnapshots || []).at(-1);
      db.providerSync = { ...(db.providerSync || {}), message: `Provider sync failed: ${error.message}. Cached provider data remains available.`, details: { ...(db.providerSync?.details || {}), lastSyncError: error.message, lastSnapshotId: lastSnapshot?.id || null } };
    }
    logActivity(db, { category: "commissioner", type: "provider_sync", title: "Provider sync complete", body: db.providerSync.message, actorUserId: user.id, audience: "commissioner", metadata: db.providerSync.details || {} });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/scoring/ingest" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "scoring")) return;
    const { season = db.meta.season, week = db.meta.currentWeek, statType = "actual" } = await parseBody(req);
    const result = await ingestReliableWeeklyStats(db, Number(season), Number(week), statType);
    logActivity(db, { category: "scoring", type: "stats_ingested", title: `${statType === "projection" ? "Projections" : "Stats"} ingested`, body: `${user.displayName} ingested ${result.rows} ${statType} rows from ${result.provider}${result.fallbackUsed ? " fallback" : ""}.`, actorUserId: user.id, metadata: result.health || {} });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), ingest: result });
  }
  if (url.pathname === "/api/admin/scoring/process" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "scoring")) return;
    const { season = db.meta.season, week = db.meta.currentWeek, finalize = false, useProjections = true } = await parseBody(req);
    const result = processWeekScoring(db, Number(season), Number(week), { finalize: Boolean(finalize), useProjections: Boolean(useProjections) });
    logActivity(db, { category: "scoring", type: finalize ? "week_finalized" : "week_processed", title: finalize ? "Week finalized" : "Week processed", body: `${user.displayName} ${finalize ? "finalized" : "processed"} Week ${week} scoring for ${result.matchups} matchups.`, actorUserId: user.id, metadata: result });
    await saveDb(db);
    return send(res, 200, { ...enrich(db, user), scoringResult: result });
  }
  if (url.pathname === "/api/admin/scoring/corrections" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "scoring")) return;
    const { season = db.meta.season, week = db.meta.currentWeek, teamId, playerId, pointsDelta, note = "" } = await parseBody(req);
    db.scoreCorrections.push({
      id: `corr-${Date.now()}`,
      season: Number(season),
      week: Number(week),
      teamId: teamId || null,
      playerId: playerId || null,
      pointsDelta: Number(pointsDelta || 0),
      note: String(note).slice(0, 240),
      createdBy: user.id,
      createdAt: Date.now()
    });
    logActivity(db, { category: "scoring", type: "score_correction", title: "Score correction added", body: `${user.displayName} added a ${pointsDelta} point correction${note ? `: ${String(note).slice(0, 120)}` : "."}`, actorUserId: user.id, teamId: teamId || null, playerId: playerId || null, audience: teamId ? "team" : "commissioner" });
    await saveDb(db);
    return send(res, 201, enrich(db, user));
  }
  if (url.pathname === "/api/admin/scoring/corrections/clear" && req.method === "POST") {
    if (!requireAdmin(user, res)) return;
    if (!requirePhase(db, res, "scoring")) return;
    const { season = db.meta.season, week = db.meta.currentWeek } = await parseBody(req);
    db.scoreCorrections = db.scoreCorrections.filter((item) => !(item.season === Number(season) && item.week === Number(week)));
    logActivity(db, { category: "scoring", type: "corrections_cleared", title: "Corrections cleared", body: `${user.displayName} cleared corrections for Week ${week}.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  if (url.pathname === "/api/admin/league" && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const { name, currentWeek, season, settings, roster, waiver, trade, playoffs, draft, scoring } = await parseBody(req);
    if (name) db.league.name = name;
    if (currentWeek) db.meta.currentWeek = Number(currentWeek);
    if (season) db.meta.season = Number(season);
    if (settings) db.league.settings = { ...db.league.settings, ...settings };
    if (roster) db.league.roster = { ...db.league.roster, ...roster };
    if (waiver) db.league.waiver = { ...db.league.waiver, ...waiver };
    if (trade) db.league.trade = { ...db.league.trade, ...trade };
    if (playoffs) db.league.playoffs = { ...db.league.playoffs, ...playoffs };
    if (draft) db.league.draft = { ...db.league.draft, ...draft };
    if (scoring) db.league.scoring = { ...db.league.scoring, ...scoring };
    logActivity(db, { category: "commissioner", type: "league_rules_updated", title: "League rules updated", body: `${user.displayName} updated commissioner-controlled league rules.`, actorUserId: user.id, audience: "commissioner" });
    await saveDb(db);
    return send(res, 200, enrich(db, user));
  }
  return send(res, 404, { error: "Not found" });
}

async function syncProvider(db) {
  const sleeperResult = await syncSleeper(db);
  const bdlResult = await syncBalldontlie(db);
  const details = {
    sleeper: sleeperResult.details,
    balldontlie: bdlResult.details
  };
  return {
    provider: "multi",
    lastRunAt: new Date().toISOString(),
    message: `${sleeperResult.message} ${bdlResult.message}`,
    nextPlayerCursor: bdlResult.nextPlayerCursor,
    details
  };
}

async function syncBalldontlie(db) {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    return { provider: "balldontlie", lastRunAt: new Date().toISOString(), message: "balldontlie skipped: no API key.", nextPlayerCursor: null, details: { skipped: true } };
  }
  const startedAt = new Date().toISOString();
  const details = { teams: "pending", games: "pending", players: "pending", stats: "not attempted" };
  try {
    if ((db.nflTeams || []).length >= 32) {
      details.teams = `cached ${db.nflTeams.length}`;
    } else {
      const teamsPayload = await bdlGet("/teams", apiKey);
      const syncedTeams = (teamsPayload.data || []).map(mapBdlTeam);
      upsertById(db.nflTeams, syncedTeams);
      details.teams = `synced ${syncedTeams.length}`;
    }

    if ((db.nflGames || []).length > 0) {
      details.games = `cached ${db.nflGames.length}`;
    } else {
      let gamesPayload = await bdlGet(`/games?seasons[]=${db.meta.season}&per_page=100`, apiKey);
      let gameSeason = db.meta.season;
      if ((gamesPayload.data || []).length === 0 && Number(db.meta.season) > 2002) {
        gameSeason = Number(db.meta.season) - 1;
        gamesPayload = await bdlGet(`/games?seasons[]=${gameSeason}&per_page=100`, apiKey);
      }
      const syncedGames = (gamesPayload.data || []).map(mapBdlGame);
      upsertById(db.nflGames, syncedGames);
      details.games = `synced ${syncedGames.length} for ${gameSeason}`;
    }

    const cursor = db.providerSync?.nextPlayerCursor;
    const playerPath = `/players?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const playersPayload = await bdlGet(playerPath, apiKey);
    const incoming = (playersPayload.data || []).map(mapBdlPlayer).filter((player) => player.name);
    for (const player of incoming) {
      const existing = db.players.find((item) => item.id === player.id);
      if (existing) {
        existing.name = player.name;
        existing.position = player.position;
        existing.nflTeam = player.nflTeam;
        existing.status = mergeStatus(existing.status, player.status);
      } else {
        db.players.push(player);
      }
    }
    const nextPlayerCursor = playersPayload.meta?.next_cursor ? String(playersPayload.meta.next_cursor) : null;
    details.players = `synced ${incoming.length}${nextPlayerCursor ? "; more pages available" : "; complete"}`;

    return {
      provider: "balldontlie",
      lastRunAt: new Date().toISOString(),
      message: `balldontlie: ${details.teams}, ${details.games}, ${details.players}.`,
      nextPlayerCursor,
      details
    };
  } catch (error) {
    return {
      provider: "balldontlie",
      lastRunAt: startedAt,
      message: `balldontlie stopped: ${error.message}.`,
      nextPlayerCursor: db.providerSync?.nextPlayerCursor || null,
      details: { ...details, error: error.message }
    };
  }
}

async function syncSleeper(db) {
  const details = { players: "pending", trendingAdds: "pending", trendingDrops: "pending" };
  try {
    const now = new Date().toISOString();
    const existingSleeperPlayers = (db.providerPlayers || []).filter((player) => player.provider === "sleeper");
    const lastSleeperSync = newestTimestamp(existingSleeperPlayers.map((player) => player.syncedAt));
    if (existingSleeperPlayers.length > 0 && lastSleeperSync && Date.now() - Date.parse(lastSleeperSync) < 23 * 60 * 60 * 1000) {
      details.players = `cached ${existingSleeperPlayers.length}; refreshes daily`;
    } else {
      const payload = await sleeperGet("/players/nfl");
      const sleeperPlayers = Object.entries(payload || {}).map(([id, player]) => mapSleeperPlayer(id, player, now)).filter((player) => player.name);
      db.providerPlayers = [
        ...(db.providerPlayers || []).filter((player) => player.provider !== "sleeper"),
        ...sleeperPlayers
      ];
      mergeSleeperIntoLeaguePlayers(db, sleeperPlayers);
      details.players = `synced ${sleeperPlayers.length}`;
    }

    const adds = await sleeperGet("/players/nfl/trending/add?lookback_hours=24&limit=50");
    const drops = await sleeperGet("/players/nfl/trending/drop?lookback_hours=24&limit=50");
    const trends = [
      ...(adds || []).map((item) => mapSleeperTrend(item, "add", 24, now)),
      ...(drops || []).map((item) => mapSleeperTrend(item, "drop", 24, now))
    ];
    db.providerTrending = [
      ...(db.providerTrending || []).filter((item) => item.provider !== "sleeper"),
      ...trends
    ];
    details.trendingAdds = `synced ${adds?.length || 0}`;
    details.trendingDrops = `synced ${drops?.length || 0}`;
    return { provider: "sleeper", message: `Sleeper: ${details.players}, trending refreshed.`, details };
  } catch (error) {
    return { provider: "sleeper", message: `Sleeper stopped: ${error.message}.`, details: { ...details, error: error.message } };
  }
}

async function sleeperGet(pathname) {
  const response = await fetch(`https://api.sleeper.app/v1${pathname}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status} for Sleeper ${pathname}`);
  return payload;
}

async function bdlGet(pathname, apiKey) {
  const response = await fetch(`https://api.balldontlie.io/nfl/v1${pathname}`, {
    headers: { Authorization: apiKey }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status} for ${pathname}`);
  return payload;
}

function mapBdlTeam(team) {
  const now = new Date().toISOString();
  return {
    id: `bdl-team-${team.id}`,
    provider: "balldontlie",
    providerId: String(team.id),
    conference: team.conference || "",
    division: team.division || "",
    location: team.location || "",
    name: team.name || "",
    fullName: team.full_name || `${team.location || ""} ${team.name || ""}`.trim(),
    abbreviation: team.abbreviation || "",
    raw: team,
    syncedAt: now
  };
}

function mapBdlGame(game) {
  const now = new Date().toISOString();
  return {
    id: `bdl-game-${game.id}`,
    provider: "balldontlie",
    providerId: String(game.id),
    season: Number(game.season || game.year || 0) || null,
    week: Number(game.week || 0) || null,
    status: game.status || game.period || "",
    date: game.date || game.datetime || game.start_time || "",
    homeTeamProviderId: game.home_team?.id ? String(game.home_team.id) : null,
    visitorTeamProviderId: game.visitor_team?.id ? String(game.visitor_team.id) : null,
    homeScore: Number(game.home_team_score ?? game.home_score ?? 0),
    visitorScore: Number(game.visitor_team_score ?? game.visitor_score ?? 0),
    raw: game,
    syncedAt: now
  };
}

function mapBdlPlayer(player) {
  return {
    id: `bdl-${player.id}`,
    name: `${player.first_name || ""} ${player.last_name || ""}`.trim(),
    position: player.position_abbreviation || normalizePosition(player.position),
    nflTeam: player.team?.abbreviation || "FA",
    opponent: "TBD",
    projection: 0,
    status: "Healthy",
    ownership: null,
    locked: false
  };
}

function mapSleeperPlayer(id, player, syncedAt) {
  const firstName = player.first_name || "";
  const lastName = player.last_name || "";
  const name = player.full_name || `${firstName} ${lastName}`.trim() || player.search_full_name || id;
  return {
    id: `sleeper-${id}`,
    provider: "sleeper",
    providerId: String(id),
    name,
    firstName,
    lastName,
    position: player.position || player.fantasy_positions?.[0] || "",
    fantasyPositions: player.fantasy_positions || [],
    team: player.team || "FA",
    status: player.status || "",
    injuryStatus: player.injury_status || null,
    searchRank: Number.isFinite(player.search_rank) ? player.search_rank : null,
    raw: player,
    syncedAt
  };
}

function mapSleeperTrend(item, type, lookbackHours, syncedAt) {
  return {
    id: `sleeper-trending-${type}-${item.player_id}`,
    provider: "sleeper",
    providerId: String(item.player_id),
    trendType: type,
    count: Number(item.count || 0),
    lookbackHours,
    raw: item,
    syncedAt
  };
}

function mergeSleeperIntoLeaguePlayers(db, sleeperPlayers) {
  const fantasyPositions = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "D/ST"]);
  const usefulPlayers = sleeperPlayers
    .filter((player) => player.status !== "Inactive")
    .filter((player) => (player.fantasyPositions || []).some((position) => fantasyPositions.has(position)) || fantasyPositions.has(player.position))
    .slice(0, 2500);
  for (const sleeper of usefulPlayers) {
    const id = `slp-${sleeper.providerId}`;
    const existing = db.players.find((player) => player.id === id);
    const status = sleeper.injuryStatus || sleeper.status || "Healthy";
    const mapped = {
      id,
      name: sleeper.name,
      position: sleeper.position === "DEF" ? "D/ST" : sleeper.position || "FLEX",
      nflTeam: sleeper.team || "FA",
      opponent: "TBD",
      projection: 0,
      status: normalizePlayerStatus(status),
      ownership: null,
      locked: false
    };
    if (existing) Object.assign(existing, { ...mapped, ownership: existing.ownership, locked: existing.locked });
    else db.players.push(mapped);
  }
}

function normalizePlayerStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["out", "ir", "pup", "suspended", "doubtful"].some((term) => value.includes(term))) return "Out";
  if (["questionable", "limited", "probable"].some((term) => value.includes(term))) return "Questionable";
  return "Healthy";
}

function normalizePosition(position) {
  const value = String(position || "").toLowerCase();
  if (value.includes("quarterback")) return "QB";
  if (value.includes("running")) return "RB";
  if (value.includes("wide")) return "WR";
  if (value.includes("tight")) return "TE";
  if (value.includes("kicker")) return "K";
  if (value.includes("def")) return "D/ST";
  return "FLEX";
}

function mergeStatus(existing, incoming) {
  return existing && existing !== "Healthy" ? existing : incoming;
}

function upsertById(target, incoming) {
  for (const item of incoming) {
    const index = target.findIndex((existing) => existing.id === item.id);
    if (index >= 0) target[index] = { ...target[index], ...item };
    else target.push(item);
  }
}

function newestTimestamp(values) {
  return values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const ext = path.extname(filePath);
    const contentType = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(302, { Location: "/" });
    res.end();
  }
}

async function main() {
  if (process.argv.includes("--seed")) {
    await mkdir(DATA_DIR, { recursive: true });
    await saveDb(initialDb());
    console.log(`Seeded ${DB_PATH}`);
    return;
  }
  await getSqlite();
  await ensureStartupBackup().catch((error) => console.error("Startup backup failed:", error.message));
  startScheduledBackups();
  const server = http.createServer(async (req, res) => {
    try {
      const db = await loadDb();
      if (req.url.startsWith("/api/")) return await handleApi(req, res, db);
      return await serveStatic(req, res);
    } catch (error) {
      console.error(error);
      return send(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Server error", detail: error.statusCode ? undefined : error.message });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`Family Fantasy Football running locally at http://localhost:${PORT}`);
    console.log(`Family Fantasy Football LAN URL: http://${getLikelyLanAddress()}:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export {
  calculateFantasyPoints,
  canPerformInPhase,
  csrfTokenForSession,
  commissionerAuditLog,
  dataQualityReport,
  dryRunPreview,
  generatePlayoffBracket,
  hasSeededPassword,
  importRosterCsv,
  importManualWeeklyStats,
  initialDb,
  ingestReliableWeeklyStats,
  ingestSleeperWeeklyStats,
  ingestEspnWeeklyStatsFallback,
  loadDbForCheck,
  makeActivityEvent,
  makeUser,
  mergePlayers,
  mergeNotificationPreferences,
  mapEspnStatLine,
  providerSettings,
  readinessChecklist,
  repairOrphanReferences,
  normalizeEspnSummaryStats,
  parseCsv,
  updatePlayoffBracketFromFinals,
  validateDbReferences,
  visibleActivityForUser,
  validateWeeklyStatIngest
};
