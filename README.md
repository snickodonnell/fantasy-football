# Family Fantasy Football

A local-first fantasy football web app for a family league. It includes accounts, commissioner password management, league dashboard, roster and lineup tools, standings, matchups, player pool, add/drop transactions, waiver claims, trades, chat, seeded sample data, configurable Yahoo-style league rules, and an API-provider sync hook.

## Run Locally

```powershell
npm start
```

Open http://localhost:3100.

Before and after feature work, run the maintained quality gate:

```powershell
npm run check
```

It runs syntax checks for the server/client, the Node test suite, and a local data integrity check against the SQLite database.

The test script uses an in-process `node:test` harness (`scripts/run-tests.mjs`) so it stays reliable on Windows and in restricted shells that block the Node runner's per-file child processes.

For home-network hosting from your PC, use:

```powershell
npm run home
```

That script binds the server to your LAN, checks that the port is free, and prints both the local URL and the family LAN URL. Keep the PC awake while family members are using the app.

To run the app automatically when Windows starts, create a Task Scheduler task that starts in this repository folder and runs:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-home.ps1
```

Optional home-network settings in `.env`:

- `HOST=0.0.0.0` binds the server for LAN access.
- `BACKUP_RETENTION=14` keeps the latest managed backup files.
- `BACKUP_INTERVAL_HOURS=24` controls scheduled backup cadence.
- `LAN_ALLOWLIST=192.168.1.,127.0.0.1` limits API access to matching IPs or prefixes.

Default seeded commissioner:

- Username: `admin`
- Password: `password`

Change that password from the Commissioner screen after signing in.

For anything beyond private local testing, set a long random `SESSION_SECRET` in `.env` before starting the server:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Local Data

The app stores local data in SQLite at `data/app.sqlite`. Reset the sample database with:

```powershell
npm run seed
```

Commissioners can export league JSON, download a SQLite backup, and import roster or draft-result CSVs from the Commissioner screen. CSV import accepts headers such as `team`, `player`, `playerId`, `round`, and `pick`; team and player values may be names or IDs.

The server also creates managed SQLite backups in `data/backups`, keeps the most recent backups according to `BACKUP_RETENTION`, and creates a pre-restore backup before any restore. The Commissioner screen shows database integrity, migration, provider, security, and backup status.

## Security Hardening

The local app now includes baseline production hardening for shared-family deployments:

- Same-site HTTP-only session cookies paired with a per-session CSRF header for mutating API calls.
- In-memory rate limiting for login/password-reset attempts and general API traffic.
- Bounded JSON request bodies and escaped JSON strings before rendering in the client.
- Commissioner-only navigation and server authorization checks for admin tools.
- Commissioner-generated password reset tokens that expire after one hour.

## API Keys

Copy `.env.example` to `.env` when you are ready to add secrets. The server already looks for:

- `BALLDONTLIE_API_KEY`
- `SPORTSDATAIO_API_KEY`
- `SESSION_SECRET`

The current live sync implementation imports NFL players from balldontlie when `BALLDONTLIE_API_KEY` is present. Until then, the app runs entirely from seeded local data.

## Provider Strategy

The app uses two free-friendly provider lanes:

### Sleeper

Use Sleeper for fantasy-native data:

- Player metadata and fantasy positions
- Injury/status fields from the player map
- Trending adds/drops
- Future projection/stat adapters where useful

Sleeper requires no API key. Its player map is large, so the app caches it and refreshes it at most once per day. Trending add/drop data is small and can refresh more often. Sleeper's docs recommend staying under 1,000 calls per minute; this app uses only a few calls per sync.

### balldontlie

Use balldontlie for NFL data:

- Teams are refreshed each sync.
- Current-season games are refreshed each sync.
- Players sync one page at a time and remember the next cursor.
- If the configured season has no published schedule yet, games fall back to the previous season for preload testing.
- Paid-tier endpoints such as injuries and stats are kept out of the required path for now.

balldontlie's free NFL tier is much tighter, currently 5 requests per minute. The app skips already-cached teams/games and pages players incrementally so repeated syncs can continue safely.

## League Rules

The seeded league rules are based on Yahoo's default fantasy football settings:

- Head-to-Head Points, 10 teams, 15-player roster
- Starters: `QB, WR, WR, RB, RB, TE, FLEX, K, D/ST`
- Bench: 6, IR: 2
- 0.5 PPR, 4-point passing TDs, -1 interceptions, -2 fumbles lost
- Rolling waivers, 2-day waiver/trade windows
- Playoffs Weeks 16 & 17 with 4 playoff teams

All of those can be edited by a commissioner in the app.

## Season Phases

The league has an explicit commissioner-controlled phase:

- **Preseason:** roster and trade setup work is open.
- **Draft:** draft setup, queues, chat, keepers, picks, pause/resume, and test drafts are open.
- **Regular Season:** lineups, free-agent roster moves, waivers, trades, and scoring operations are open.
- **Playoffs:** lineups and scoring remain open, trades/waivers are locked, and playoff bracket operations are available.
- **Offseason:** competitive roster, lineup, waiver, trade, draft, and scoring actions are locked until the commissioner advances the phase.

The current phase appears in the app header and Commissioner screen. Server endpoints enforce phase rules, so disabled buttons are backed by actual action gates.

## Draft Room

The draft room is built for a future live snake draft and for testing while the app is under construction:

- Commissioner can start a 15-round snake draft and optionally clear rosters.
- Commissioner can manually draft a player, autopick the current slot, undo the latest pick, reset the draft, or run a full balanced test draft.
- Commissioner can pause/resume the draft, see animated on-clock timer states, enable browser-generated sound cues, and review the current team's positional needs.
- Commissioner can configure draft rounds, pick timer length, team order, and draft style: snake, linear, or third-round reversal.
- Managers can maintain persistent team queues; autopick uses the on-clock team's queue before falling back to roster-needs logic.
- Draft chat is available directly in the draft room.
- Commissioner can mark keepers before the draft; starting/resetting draft flows preserve keeper settings and apply keepers when the draft starts.
- The configured draft order writes drafted players directly onto team rosters.
- Test drafts are useful for exercising lineup, matchup, roster, and schedule screens before the real season.

## Playoffs

Commissioners can generate a playoff bracket from current standings. The bracket:

- Seeds teams by record, with projected points as a tie-break style fallback.
- Creates semifinal matchups for the configured playoff week.
- Creates championship and third-place games after semifinal results are finalized.
- Supports a consolation bracket for the configured number of consolation teams.
- Tracks champion, runner-up, third place, and fourth place after the final is finalized.

Moving the league to the Playoffs phase automatically generates a bracket if one does not already exist.

## Live Scoring Plan

Yahoo defaults are confirmed as the current scoring baseline. To make scoring live in a free/local-friendly way:

- **Roster locks:** lock each started player at that player's NFL kickoff. Bench players remain movable until their own kickoff. Completed games stay locked until commissioner correction.
- **Refresh cadence:** refresh live stats every 60-120 seconds during active game windows, and slower outside game windows. This avoids abusing free APIs.
- **Provider split:** Sleeper should remain the fantasy metadata/trending source. balldontlie is good for teams/games and some supplemental data, but its free tier is too tight for high-frequency live stat polling.
- **Likely extra source needed:** truly live official player stats usually require a paid feed. For a free build, the practical options are Sleeper's public stats/projection endpoints if stable enough, ESPN public scoreboard/stat endpoints as a fallback, or commissioner-entered stat corrections after games.
- **Scoring engine:** store raw weekly player stats, calculate fantasy points from Commissioner rules, update matchup scores, then finalize standings when games finish.

The app should support both live-refresh scoring and commissioner manual overrides, because free data sources can lag, change shape, or miss corrections.

## Scoring Operations

Commissioner scoring controls live in the Commissioner screen:

1. **Ingest Projections** uses Sleeper projection data for the configured season/week. This is best for preseason testing.
2. **Ingest Actual Stats** uses a reliability wrapper: Sleeper is tried first, validated for row/mapping coverage, and ESPN public scoreboard/boxscore summaries are used as a fallback when Sleeper is empty, unavailable, or unmapped.
3. **Process Week** calculates starter fantasy points from cached stats, applies manual corrections, locks started players when their game has kicked off or when no kickoff is available, and updates matchup scores as `live`.
4. **Finalize Week** does the same calculation, marks week matchups final, and recomputes standings from final matchups.
5. **Corrections** allow commissioner point adjustments by team and/or player with a note.

For live season use, run actual-stat ingestion on a conservative interval during NFL games. With free APIs, start at 60-120 seconds during active windows and slower outside game windows. The Commissioner screen shows the latest provider health: primary provider, fallback provider, rows saved, local player mappings, starter coverage, warnings, and errors. Keep manual corrections enabled for stat corrections, delayed feeds, and provider outages.

## Waivers And Roster Validation

Waivers are priority-based only for now; bidding/FAAB is intentionally disabled.

Commissioner controls:

- Process all pending waiver claims.
- Validate all rosters.
- Configure waiver type/day, free-agent adds, waiver claims, and injured-to-IR setting.

Manager controls:

- Submit waiver claim for a free agent.
- Optionally select a drop player.
- Manage a personal pending-claim queue with up/down ordering.
- Edit the drop player on pending claims.
- Filter waiver claims and cancel pending claims.
- Review waiver priority and process preview before claims run.
- Edit team name/initials.

Validation currently checks:

- Roster size limit from league settings.
- Added player is actually available.
- Dropped player belongs to the team.
- Dropped player is not locked for the current week.
- Lineup players are rostered by the team.
- No duplicate starters.
- Position eligibility, including FLEX as RB/WR/TE.

Processing uses rolling priority first and each manager's claim queue order second. Successful claimers move to the bottom of waiver priority, and failed claims keep their priority. The Commissioner screen shows the same process preview and priority ladder managers see, plus the process button.

## Trade Review

Trades are manager-friendly and commissioner-configurable:

- A manager proposes a trade from the Players screen.
- Starting from another team's player pre-fills the trade form and comparison panel.
- Managers can compare offered/requested players inline before sending or reviewing offers.
- Managers can send counteroffers, and the original pending offer is marked countered.
- Teams can place rostered players on the trade block with a short note.
- The receiving manager can accept or decline.
- The offering manager can cancel while the offer is pending.
- If trade review is set to Commissioner, accepted trades move to `commissioner_review`.
- The commissioner can approve or veto from the Commissioner screen.
- If commissioner review is disabled, accepted trades execute immediately.
- Offers show expiration countdowns, and the commissioner can expire old offers.
- Non-commissioner managers only see trade offers involving their own team.

Trades validate before completion:

- Offered players must still belong to the offering team.
- Requested players must still belong to the receiving team.
- Locked players cannot be traded.
- Completed trades remove moved players from old lineups.
- Transaction history records completed trades.

## Player Research

Managers can save private player research from each Player Detail screen:

- Watchlist flag for quick tracking from the Players screen.
- Private notes tied to the signed-in manager.
- Player comparison cards use projections, status, ownership, watchlist state, and trade-block state.

## Manager Settings

Managers have a dedicated Settings screen for:

- Display name, username, contact email, and profile visibility.
- Self-service password changes with current-password verification.
- Team name, initials, logo URL, and team color.
- Local notification category preferences and future push-delivery opt-in.

Commissioners can still manage accounts and team identities from the Commissioner screen.

## Commissioner Audit

The Commissioner screen includes an audit log built from structured activity events. It highlights league-rule changes, score corrections, roster/team edits, waiver processing, trade approvals/vetoes, phase changes, playoff bracket generation, provider syncs, and account actions.

## Local Notifications And Activity

The app now keeps a structured local activity feed with per-user visibility and read state.

- Managers see updates relevant to their team plus league-wide updates.
- Commissioners also see commissioner/audit-style updates.
- The League screen includes filters for roster, draft, trade, waiver, scoring, commissioner, and chat updates.
- The Commissioner screen includes local notification preferences per signed-in user.
- Push/email is not enabled yet, but each activity event stores delivery metadata (`local`, `pushReady`, `pushedAt`, `pushProvider`) so a later background delivery layer can reuse the same events.
