// One-line kill switch CLI (invariant 2): works against the DB directly so a
// wedged deploy can still be halted.
//   pnpm kill-switch on | off | status
import { createDb, closeDb } from "./client.js";
import { createRepos } from "./repos.js";

const cmd = process.argv[2];
const db = createDb();
const repos = createRepos(db);

try {
  if (cmd === "on") {
    await repos.killSwitch.set(true);
    console.log("kill switch ENGAGED — all writes and inference halt within one iteration");
  } else if (cmd === "off") {
    await repos.killSwitch.set(false);
    console.log("kill switch disengaged — normal operation resumes");
  } else {
    const engaged = await repos.killSwitch.isEngaged();
    console.log(`kill switch is ${engaged ? "ENGAGED" : "off"}`);
  }
} finally {
  await closeDb(db);
}
