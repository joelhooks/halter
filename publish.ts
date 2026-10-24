// Publish dist/ to halter.wzrrd.sh, only after the checks that need private inputs have run and passed.
// Harm: a public page that copies a skill or names a private source. The build skips those checks
// when their inputs are missing; publishing refuses instead.
//   HALTER_SKILLS_SNAPSHOT  a checkout of the skills repo, for the copy gate (gate.ts)
//   HALTER_DENY_FILE        private terms, one per line, for smoke.ts
// Run: HALTER_SKILLS_SNAPSHOT=… HALTER_DENY_FILE=… node publish.ts (pnpm wzrrd)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const here = new URL(".", import.meta.url).pathname;
const missing = (["HALTER_SKILLS_SNAPSHOT", "HALTER_DENY_FILE"] as const).filter((k) => !process.env[k] || !existsSync(process.env[k]!));
if (missing.length) {
  console.error(`publish: refused. ${missing.map((k) => (process.env[k] ? `${k}=${process.env[k]} doesn't exist` : `${k} is unset`)).join("; ")}. Set it, then rerun node publish.ts.`);
  process.exit(1);
}

const step = (what: string, cmd: string, args: ReadonlyArray<string>) => {
  try {
    execFileSync(cmd, [...args], { cwd: here, stdio: "inherit" });
  } catch {
    console.error(`publish: refused. ${what} failed; nothing was published.`);
    process.exit(1);
  }
};
// rebuild, so what ships is exactly what was checked, each step on this same Node
step("the build", process.execPath, ["site.ts"]);
step("the copy gate", process.execPath, ["gate.ts", "--require"]);
step("smoke", process.execPath, ["smoke.ts", "--require"]);
step("wzrrd publish", `${homedir()}/.local/bin/wzrrd`, ["publish", "--file", "dist", "--slug", "halter", "--non-interactive"]);
console.log("publish ok: https://halter.wzrrd.sh/");
