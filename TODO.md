# Fantasy Football App TODO

Living roadmap for the local family fantasy football app. First and second pass work is archived under Completed. This third-pass plan is meant to guide the final implementation and QA pass before a manual family-league review.

## In Progress

- [x] Pre-manual user-test readiness pass.
  - [x] Add an in-app launch checklist for blockers before family end-to-end testing.
  - [x] Add immediate busy feedback for slow mutating actions.
  - [x] Replace remaining prompt/confirm-driven workflows with inline modals/forms where they affect core league use.
  - [x] Add a guided seeded-league rehearsal script that walks commissioner and two managers through the happy path.
  - [x] Add production-data setup flow for importing/confirming real teams, draft order, rosters, and scoring settings.

## Maintenance Rule

Run `npm run check` before and after feature work. New features should add or update tests in the same pass, especially for server rules, data changes, commissioner workflows, and navigation behavior.

## Recommended Order From Here

1. Finish the pre-manual user-test readiness pass below.
2. Run a guided end-to-end seeded rehearsal with commissioner plus two manager accounts.
3. Import or confirm real league setup data: teams, users, draft order, roster rules, schedule, and scoring.
4. Validate live-data and scoring behavior against a real NFL week or a hand-checked completed week.
5. Do the nit-picky family usability pass on labels, density, confusing clicks, and mobile ergonomics.

## Pre-Manual User-Test Readiness

- [x] Real-use launch gate.
  - [x] Show a Commissioner launch checklist with blockers/warnings/ready items.
  - [x] Add one-click links from each checklist item to the relevant tab/action.
  - [x] Make backup age and restore confidence obvious before destructive rehearsals.
- [x] End-to-end rehearsal support.
  - [x] Add a guided seeded rehearsal checklist for commissioner, Manager A, and Manager B.
  - [x] Cover login/password change, team setup, draft, lineup, waivers, trades, scoring, and weekly finalization.
  - [x] Keep a visible “last rehearsal result” so you know what was actually tested.
- [x] Real league setup support.
  - [x] Add a setup review screen for users, teams, draft order, roster settings, scoring rules, and phase.
  - [x] Add CSV templates/downloads for rosters and draft results.
  - [x] Add validation that flags impossible real-season states before launch.
- [x] Interaction polish before nit-picking.
  - [x] Add immediate busy feedback for slow buttons/forms.
  - [x] Replace browser prompts/confirms with app-native confirmation and note dialogs.
  - [x] Improve success/error messages so every commissioner action says what changed.
- [x] Live operations readiness.
  - [x] Run the smart player sync with real API credentials long enough to complete player catalog paging.
  - [x] Validate current-week game schedule detection against provider data.
  - [x] Reconcile one completed matchup against a manually checked scoring sheet.

## Third Pass: Manual QA Readiness

- [x] Full seeded-flow walkthrough.
  - [x] Reset/seed the database and verify first-run sign-in, seeded-password lock, password change, and setup wizard.
  - [x] Walk manager flows as at least two non-commissioner users: lineup, waivers, trades, watchlist, chat, settings, and logout.
  - [x] Walk commissioner flows: user reset token, league rules, phase changes, backups, restore, imports, data repair, provider tools, scoring, and announcements.
  - [x] Record any confusing labels, missing feedback, awkward forms, or workflows that need fewer clicks.
- [x] Draft night rehearsal on real devices.
  - [x] Run a mock draft rehearsal from start to completion with at least two browsers/devices connected.
  - [x] Test pause/resume, refresh recovery, TV mode, skipped pick, replacement pick, swap picks, keeper marking, queue picks, and undo.
  - [x] Verify tablet and TV readability from across the room.
  - [x] Decide which controls should be hidden or simplified for actual draft night.
- [x] Weekly operations rehearsal.
  - [x] Simulate a live week: set lineups, lock players, ingest/manual-import stats, process week, corrections, and finalization.
  - [x] Verify matchup previews, finalization checklist, waiver schedule, and notification/activity feed match what happened.
  - [x] Run playoff generation and finalization from realistic standings.

## Third Pass: Implementation Hardening

- [x] Persistence architecture hardening.
  - [x] Replace remaining whole-database rewrite saves with targeted repository writes for high-risk mutating endpoints.
  - [x] Add transaction-level tests for partial failure cases during trades, waivers, draft picks, restore, and imports.
  - [x] Add backup/restore restore-point metadata that is visible before restoring.
  - [x] Add database compaction/checkpoint guidance for long-running home use.
- [x] Real browser automation.
  - [x] Install and configure Playwright as an actual dependency.
  - [x] Replace static browser smoke tests with real login/navigation/manager/commissioner/mobile tests.
  - [x] Add screenshot baselines for light mode, dark mode, draft TV mode, and commissioner dashboard.
  - [x] Add automated accessibility assertions for core screens.
- [x] Provider and scoring validation.
  - [x] Test Sleeper and ESPN fallback against a real completed NFL week.
  - [x] Compare calculated fantasy points against a hand-verified stat sheet for at least one full matchup.
  - [x] Validate delayed/missing provider data messaging in the UI.
  - [x] Add a safe "provider unavailable" demo mode for manual testing.

## Third Pass: Product Polish

- [x] Commissioner settings polish.
  - [x] Convert free-text rule fields into constrained controls where mistakes are likely: waiver mode, playoff format, roster template, trade deadline, and lock rules.
  - [x] Add inline validation messages beside invalid league-rule fields instead of only returning API errors.
  - [x] Separate advanced rule settings from common family-league settings.
- [x] Family usability pass.
  - [x] Rewrite manager-facing empty states and setup instructions after manual review.
  - [x] Tune mobile density for parents/kids using phones during draft and Sunday mornings.
  - [x] Add a print-friendly weekly summary stylesheet.
  - [x] Decide whether avatars should be local uploaded files, URL-only, or initials/colors only.
- [x] Notification and communication pass.
  - [x] Decide whether mentions/reactions remain local-only or need digest/export behavior.
  - [x] Add announcement expiration/unpin controls.
  - [x] Add notification digest preview before enabling any real delivery channel.

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
- [x] Second pass: home network readiness.
  - [x] One-command home server startup.
  - [x] Local network access hardening.
  - [x] Backup and restore polish.
- [x] Second pass: data and database.
  - [x] Database architecture pass.
  - [x] Data quality tooling.
  - [x] Provider reliability.
- [x] Second pass: UI and navigation.
  - [x] Full navigation polish.
  - [x] Responsive family-room UX pass.
  - [x] Visual design system pass.
  - [x] Manager onboarding polish.
- [x] Second pass: league workflow.
  - [x] Commissioner command center.
  - [x] Draft simulation and draft night.
  - [x] Commissioner configurability.
  - [x] Weekly operations.
- [x] Second pass: testing and quality.
  - [x] Expanded server test coverage.
  - [x] Browser/UI smoke coverage.
  - [x] Operational checks and fixtures.
- [x] Second pass: family features.
  - [x] Family engagement layer.
  - [x] Communication polish.
  - [x] Research and decision tools.
