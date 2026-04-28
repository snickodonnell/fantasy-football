import { loadDbForCheck, validateDbReferences } from "../server.js";

const db = await loadDbForCheck();
const validation = validateDbReferences(db);

if (!validation.ok) {
  console.error("Data integrity warnings:");
  for (const warning of validation.warnings) console.error(`- ${warning}`);
  process.exit(1);
}

console.log(`Data integrity OK: ${db.users.length} users, ${db.teams.length} teams, ${db.players.length} players.`);
