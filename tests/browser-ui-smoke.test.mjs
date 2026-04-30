import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("browser smoke coverage includes login, navigation, manager, commissioner, and mobile surfaces", () => {
  for (const marker of ["data-form=\"login\"", "availableNav", "settingsView", "adminView", "Launch Readiness", "Seeded Rehearsal", "Real League Setup Review", "modal-card", "admin-tab", "giant-switch", "is-busy", "mobile-nav"]) {
    assert.ok(app.includes(marker), `missing ${marker}`);
  }
});

test("visual regression targets include light dark and draft TV selectors", () => {
  assert.ok(css.includes("[data-theme=\"dark\"]"));
  assert.ok(css.includes(".draft-tv-panel"));
  assert.ok(app.includes("draft-tv-toggle"));
});

test("core accessibility hooks are present for icon controls and reduced motion", () => {
  assert.ok(app.includes("aria-label"));
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes(":focus-visible"));
});

test("client render paths build lookup indexes for large player catalogs", () => {
  for (const marker of ["rebuildIndexes", "playersById", "rostersByTeam", "providerBySleeperId", "weeklyStatsByPlayer", "availablePlayers"]) {
    assert.ok(app.includes(marker), `missing ${marker}`);
  }
});
