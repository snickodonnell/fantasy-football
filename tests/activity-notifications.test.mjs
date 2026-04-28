import test from "node:test";
import assert from "node:assert/strict";
import {
  makeActivityEvent,
  mergeNotificationPreferences,
  visibleActivityForUser
} from "../server.js";

function makeDb() {
  return {
    users: [
      { id: "u1", displayName: "Nick", role: "commissioner" },
      { id: "u2", displayName: "Emily", role: "manager" },
      { id: "u3", displayName: "Hadley", role: "manager" }
    ],
    teams: [
      { id: "t1", name: "Nick's Team", ownerUserId: "u1" },
      { id: "t2", name: "Emily's Team", ownerUserId: "u2" }
    ],
    activityEvents: [],
    notificationPreferences: []
  };
}

test("team activity is local to that manager and commissioners", () => {
  const db = makeDb();
  const event = makeActivityEvent(db, {
    category: "roster",
    title: "Lineup saved",
    body: "Emily saved a lineup.",
    teamId: "t2",
    audience: "team",
    createdAt: 10
  });
  db.activityEvents.push(event);

  assert.equal(visibleActivityForUser(db, db.users[1]).length, 1);
  assert.equal(visibleActivityForUser(db, db.users[0]).length, 1);
  assert.equal(visibleActivityForUser(db, db.users[2]).length, 0);
});

test("category preferences hide local updates without deleting events", () => {
  const db = makeDb();
  db.notificationPreferences = [{
    userId: "u2",
    preferences: { local: true, pushReady: false, categories: { trade: false, roster: true } },
    updatedAt: 1
  }];
  db.activityEvents.push(
    makeActivityEvent(db, { category: "trade", title: "Trade offered", body: "Offer", visibleTo: ["u2"], createdAt: 20 }),
    makeActivityEvent(db, { category: "roster", title: "Lineup saved", body: "Saved", visibleTo: ["u2"], createdAt: 10 })
  );

  const visible = visibleActivityForUser(db, db.users[1]);

  assert.equal(db.activityEvents.length, 2);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].category, "roster");
});

test("read state is calculated per user", () => {
  const db = makeDb();
  db.activityEvents.push(makeActivityEvent(db, { category: "draft", title: "Pick made", body: "Drafted", visibleTo: ["all"], readBy: ["u2"], createdAt: 10 }));

  assert.equal(visibleActivityForUser(db, db.users[1])[0].read, true);
  assert.equal(visibleActivityForUser(db, db.users[2])[0].read, false);
});

test("notification preference merges preserve unspecified categories", () => {
  const merged = mergeNotificationPreferences(
    { local: true, pushReady: false, categories: { roster: true, trade: true, chat: true } },
    { pushReady: true, categories: { trade: false } }
  );

  assert.equal(merged.local, true);
  assert.equal(merged.pushReady, true);
  assert.equal(merged.categories.roster, true);
  assert.equal(merged.categories.trade, false);
  assert.equal(merged.categories.chat, true);
});
