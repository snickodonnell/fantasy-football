# Fantasy Football App TODO

Living roadmap for the local family fantasy football app. The first roadmap is complete; this is the second-pass plan for turning the app into a first-class home-network league tool.

## In Progress

No active in-progress feature work.

## Maintenance Rule

Run `npm run check` before and after feature work. New features should add or update tests in the same pass, especially for server rules, data changes, commissioner workflows, and navigation behavior.

## Recommended Order From Here

1. Commissioner command center.
2. Data quality and provider reliability.
3. Draft simulation and draft night.
4. Commissioner configurability.
5. Weekly operations.
6. Family nice-to-have features.
7. Deeper database repository refactor and migration tests.
8. Browser/UI automation when Playwright is introduced.

## Second Pass: Home Network Readiness

- [x] One-command home server startup.
  - [x] Add a Windows-friendly start script that binds to the LAN IP, prints the family access URL, and checks port availability.
  - [x] Add optional Windows startup/task scheduler instructions.
  - [x] Add a health page for server, database, provider sync, and backup status.
- [x] Local network access hardening.
  - [x] Add first-run setup that requires changing seeded passwords before league use.
  - [x] Add optional LAN allowlist / private-network warning.
  - [x] Add session/device management so managers can sign out old sessions.
  - [x] Add backup reminders before major destructive commissioner actions.
- [x] Backup and restore polish.
  - [x] Add scheduled SQLite backups with retention.
  - [x] Add restore-from-backup flow for commissioner.
  - [x] Add backup integrity checks and visible last-backup status.
  - [x] Add export/import validation reports before data is applied.

## Second Pass: Data And Database

- [ ] Database architecture pass.
  - [ ] Move from full-table rewrite saves toward targeted SQLite writes or explicit repository functions.
  - [ ] Add schema versioning and migration tests.
  - [x] Add indexes for common lookups: users, teams, ownership, claims, trades, activity, weekly stats.
  - [x] Add foreign-key and consistency checks after imports/restores.
- [x] Data quality tooling.
  - [x] Add duplicate-player detection and merge tooling.
  - [x] Add orphaned lineup/claim/trade/player-reference repair tools.
  - [x] Add commissioner data audit screen for warnings and suggested fixes.
  - [x] Add preseason readiness checklist.
- [x] Provider reliability.
  - [x] Add configurable provider refresh cadence.
  - [x] Add cached provider snapshots so sync failures do not break the UI.
  - [x] Add manual stat import for a week.
  - [x] Add provider mapping tools for unmatched players.

## Second Pass: UI And Navigation

- [x] Full navigation polish.
  - [x] Finish route-backed links for every meaningful app state.
  - [x] Add route-helper coverage for back/forward-safe hashes.
  - [x] Add shareable deep links for players, team tabs, league tabs, draft/player filters, waivers, trades, and activity filters.
  - [x] Add toast/error status surfaces for major action failures.
- [x] Responsive family-room UX pass.
  - [x] Tune mobile nav density after role-aware nav changes.
  - [ ] Add tablet layout checks for draft night.
  - [ ] Add large-screen draft-board / TV mode.
  - [x] Add accessibility pass: focus states, labels, keyboard controls, color contrast, reduced motion.
- [x] Visual design system pass.
  - [x] Formalize light/dark theme tokens.
  - [x] Replace static inline spacing/alignment styles with reusable classes.
  - [x] Add consistent button, table, form, status, health, warning, toast, and spacing patterns.
  - [x] Add confirmation dialogs for irreversible actions.
- [ ] Manager onboarding polish.
  - [ ] Add first-login profile/team setup wizard.
  - [ ] Add invite/reset instructions designed for family members.
  - [ ] Add simple "what can I do now?" guidance based on season phase.

## Second Pass: League Workflow

- [x] Commissioner command center.
  - [x] Add readiness checklist for draft, regular season, playoffs, and offseason.
  - [x] Add scheduled jobs panel for syncs, backups, waivers, and scoring.
  - [x] Add dry-run previews for phase changes, playoff generation, imports, and roster corrections.
  - [x] Add league event timeline with filters and rollback notes.
- [ ] Draft simulation and draft night.
  - [ ] Add deterministic mock draft simulator with configurable strategies.
  - [ ] Add draft rehearsal mode that does not mutate real rosters.
  - [ ] Add pause/reconnect recovery and browser refresh resilience.
  - [ ] Add commissioner override tools for skipped picks, swapped picks, keepers, and accidental selections.
  - [ ] Add draft board TV mode with recent picks, on-clock team, queue prompt, and timer cues.
- [ ] Commissioner configurability.
  - [ ] Add deeper scoring rule editor validation.
  - [ ] Add waiver modes: rolling priority, FAAB, and free-agent windows.
  - [ ] Add trade deadline and playoff roster lock configuration.
  - [ ] Add custom playoff formats and consolation rules.
  - [ ] Add roster slot templates and position eligibility tuning.
- [ ] Weekly operations.
  - [ ] Add weekly matchup preview generated from lineups, projections, injuries, and provider health.
  - [ ] Add lineup lock countdowns by NFL game kickoff.
  - [ ] Add waiver processing schedule and manual override queue.
  - [ ] Add finalization checklist before standings update.

## Second Pass: Testing And Quality

- [ ] Expand server test coverage.
  - [x] Add CSRF, seeded-password, CSV import, and data-reference tests.
  - [ ] Add rate-limit, full auth flow, and role-permission tests.
  - [ ] Add data export/restore tests.
  - [ ] Add draft simulation, waivers, trades, playoffs, and scoring workflow tests.
  - [ ] Add database migration and integrity tests.
- [ ] Add browser/UI testing.
  - [ ] Add Playwright smoke tests for login, navigation, manager workflows, commissioner workflows, and mobile.
  - [ ] Add visual regression screenshots for light/dark mode and draft TV mode.
  - [ ] Add accessibility checks for core screens.
- [ ] Add operational checks.
  - [x] Add `npm run check` that runs syntax checks, tests, and basic data integrity checks.
  - [x] Add Windows-stable in-process test harness for `node:test`.
  - [ ] Add seed/reset test fixtures for realistic league states.
  - [ ] Add mocked provider fixtures for live week, delayed stats, missing players, and playoff weeks.

## Second Pass: Nice-To-Have Family Features

- [ ] Family engagement layer.
  - [ ] Add matchup recaps, weekly awards, rivalry notes, and fun league history.
  - [ ] Add optional manager avatars/photos stored locally.
  - [ ] Add weekly email/printable summary export for the house.
  - [ ] Add trophy room / past champions / records.
- [ ] Communication polish.
  - [ ] Add mentions and reactions in league chat.
  - [ ] Add commissioner announcements pinned to dashboard.
  - [ ] Add notification digest controls.
- [ ] Research and decision tools.
  - [ ] Add player watchlist screen.
  - [ ] Add start/sit comparison.
  - [ ] Add matchup strength and bye-week views.
  - [ ] Add roster health score and trade fairness summary.

## Completed

- [x] Local Node app with SQLite persistence.
- [x] Commissioner user/account management.
- [x] Yahoo-style configurable league rules.
- [x] Sleeper and balldontlie provider sync.
- [x] Family users and placeholder teams.
- [x] Schedule generation.
- [x] Snake draft room with test draft.
- [x] Scoring engine, weekly processing, lineup locks, and corrections.
- [x] Priority-based waivers without bidding.
- [x] Roster validation.
- [x] Trade review flow with commissioner approval/veto.
- [x] Sleeper-style legal lineup move UI.
- [x] First-pass Player Detail / Research Hub.
- [x] Real weekly NFL stat reliability.
  - [x] Validate Sleeper actual stats during live NFL weeks.
  - [x] Add ESPN public scoreboard/stat fallback if Sleeper is delayed or incomplete.
  - [x] Add provider health/status display.
- [x] Notifications / activity feed.
  - [x] Log draft picks, trades, waivers, lineup saves, scoring updates, commissioner actions, chat, and corrections.
  - [x] Add manager-friendly feed filters.
  - [x] Store local per-user read state and preferences.
  - [x] Store delivery metadata so push/email can be added later.
- [x] Draft room polish.
  - [x] Pick timer.
  - [x] Pause/resume.
  - [x] Team queues.
  - [x] Positional scarcity and team needs.
  - [x] Draft chat.
  - [x] Undo history.
  - [x] Keeper support.
  - [x] Timer animations and sound cues.
  - [x] Commissioner-configurable draft order and style.
- [x] Waiver UX polish.
  - [x] Claim ordering.
  - [x] Manager claim queue.
  - [x] Claim editing/canceling.
  - [x] Process preview.
  - [x] Waiver priority display.
- [x] Trade UX polish.
  - [x] Counteroffers.
  - [x] Trade block.
  - [x] Player comparison.
  - [x] Expiration countdowns.
  - [x] Private manager-only offer visibility.
- [x] Season state machine.
  - [x] Preseason, draft, regular season, playoffs, offseason.
  - [x] Enforce allowed actions by season phase.
- [x] Playoffs.
  - [x] Bracket generation.
  - [x] Seeding and reseeding.
  - [x] Consolation bracket.
  - [x] Championship/final standings behavior.
- [x] Manager settings.
  - [x] Self-service password change.
  - [x] Display name/profile settings.
  - [x] Team logo/avatar/color.
  - [x] Notification preferences.
  - [x] Username/contact settings.
  - [x] Privacy controls for profile/contact visibility.
- [x] Commissioner audit log.
  - [x] Rule changes.
  - [x] Score corrections.
  - [x] Roster edits.
  - [x] Waiver processing.
  - [x] Trade approvals/vetoes.
- [x] Production hardening.
  - [x] CSRF protection.
  - [x] Rate limiting.
  - [x] Stronger session secret setup guidance.
  - [x] Input escaping/sanitization review.
  - [x] Password reset flow.
  - [x] Role-based UI hardening.
  - [x] Import/export/backup tools.
  - [x] Export league data.
  - [x] Backup SQLite.
  - [x] Import rosters/draft results from CSV.
- [x] Players pagination and working screen subtabs/placeholders.
- [x] Draft room timer, pause/resume, needs panel, and explicit queue/chat placeholders.
- [x] Waiver filtering, cancellation, and process preview.
- [x] Player comparison and saved research with private notes/watchlist.
- [x] Dark mode theme toggle with persistent manager preference.
- [x] Production hardening pass with CSRF, rate limits, password reset tokens, role-aware navigation, escaped client payloads, and commissioner data tools.
- [x] Home-network hosting pass with LAN startup script, Task Scheduler docs, admin health status, seeded-password action lock, LAN allowlist, session cleanup, managed backups, restore flow, backup retention, import validation, DB indexes, and integrity checks.
- [x] Testing maintenance pass with `npm run check`, Windows-stable in-process test harness, data integrity script, and operational tests for CSRF tokens, seeded-password detection, CSV parsing/imports, and reference validation.
- [x] App shell polish pass with tested route helpers, deep links, mobile nav cleanup, reusable visual classes, accessible focus states, reduced-motion handling, and toast status surfaces.
- [x] Commissioner workflow and data quality pass with readiness checks, scheduled job status, dry-run previews, data diagnostics/repair, duplicate merge tooling, provider cadence/snapshots, manual stat import, and provider mapping suggestions.
