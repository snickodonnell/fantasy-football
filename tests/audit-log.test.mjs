import test from "node:test";
import assert from "node:assert/strict";
import { commissionerAuditLog, makeActivityEvent } from "../server.js";

function db() {
  return {
    teams: [{ id: "t1", ownerUserId: "u2" }],
    users: [{ id: "u1", role: "commissioner" }, { id: "u2", role: "manager" }],
    activityEvents: []
  };
}

test("commissioner audit log includes commissioner and controlled action events", () => {
  const data = db();
  data.activityEvents.push(
    makeActivityEvent(data, { category: "chat", type: "chat_message", title: "Chat", body: "hello", visibleTo: ["all"], createdAt: 10 }),
    makeActivityEvent(data, { category: "trade", type: "trade_approved", title: "Trade approved", body: "approved", visibleTo: ["u2"], createdAt: 20 }),
    makeActivityEvent(data, { category: "commissioner", type: "league_rules_updated", title: "Rules", body: "updated", audience: "commissioner", createdAt: 30 })
  );

  const entries = commissionerAuditLog(data);
  assert.deepEqual(entries.map((entry) => entry.type), ["league_rules_updated", "trade_approved"]);
});
