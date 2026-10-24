// Smoke over the built site in dist/: every page is whole, every local link lands, the
// styles are the verbatim rat.css plus halter.css, and nothing outside fake data ships.
// Run after `node site.ts`: node smoke.ts
//
// Private inputs live outside the repo. HALTER_DENY_FILE names a file of private terms, one per line,
// that must never reach dist or the tracked tree. Unset, smoke runs the generic checks and says so;
// `node smoke.ts --require` (what publish.ts runs) refuses instead. RAT_CSS=path optionally diffs
// rat.css against a local rat-stack checkout.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BIB } from "./src/bib.ts";

const here = new URL(".", import.meta.url).pathname;
const dist = `${here}dist`;
const REQUIRE = process.argv.includes("--require");

const walk = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(dist);
const pages = files.filter((f) => f.endsWith("/index.html"));
const fails: Array<string> = [];
const must = (ok: boolean, what: string) => {
  if (!ok) fails.push(what);
};

must(pages.length >= 12, `expected at least 12 pages, found ${pages.length}`);
for (const f of ["rat.css", "halter.css", "app.js", "llms.txt", "llms-full.txt"]) must(existsSync(`${dist}/${f}`), `missing dist/${f}`);

// rat.css: one header line naming the upstream commit and the sha256 of the copy, then the copy.
// The hash pins it byte for byte without the repo pointing at anyone's disk.
{
  const ours = readFileSync(`${dist}/rat.css`, "utf8");
  const nl = ours.indexOf("\n");
  const head = ours.slice(0, nl);
  const body = ours.slice(nl + 1);
  must(ours === readFileSync(`${here}site/rat.css`, "utf8"), "dist/rat.css differs from site/rat.css");
  must(/MIT/.test(head), "rat.css header must name the MIT licence");
  must(/at commit [0-9a-f]{40} /.test(head), "rat.css header must name the upstream commit");
  const pinned = /sha256 of everything after this line: ([0-9a-f]{64})/.exec(head)?.[1];
  must(pinned !== undefined && createHash("sha256").update(body).digest("hex") === pinned, "rat.css doesn't match the sha256 in its header: it was edited, or the pin is stale");
  const local = process.env.RAT_CSS;
  if (local) {
    must(existsSync(local), `RAT_CSS=${local} doesn't exist`);
    if (existsSync(local)) must(body === readFileSync(local, "utf8"), `rat.css differs from RAT_CSS=${local}`);
  }
}

const target = (from: string, href: string) => {
  const clean = href.split("#")[0]?.split("?")[0] ?? "";
  if (clean === "") return from;
  const abs = clean.startsWith("/") ? `${dist}${clean}` : `${from.replace(/[^/]*$/, "")}${clean}`;
  return abs.endsWith("/") ? `${abs}index.html` : abs;
};

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const at = page.slice(dist.length);
  must((html.match(/<h1[\s>]/g) ?? []).length === 1, `${at}: one h1`);
  must(html.includes('href="/rat.css"') && html.indexOf('href="/rat.css"') < html.indexOf('href="/halter.css"'), `${at}: rat.css loads before halter.css`);
  must(/<nav aria-label="Primary navigation" class="site-nav"><a class="brand"/.test(html), `${at}: rat nav`);
  must(!/\u2014/.test(html), `${at}: em dash`);
  must(existsSync(page.replace(/index\.html$/, "index.md")), `${at}: markdown twin`);
  // a page diagram fits 44 columns, the width the code is printed at, so a phone never wraps its art
  for (const m of html.matchAll(/<pre class="diagram"[^>]*>([\s\S]*?)<\/pre>/g)) {
    const wide = (m[1] ?? "").replace(/&[a-z#0-9]+;/g, "x").split("\n").find((l) => l.length > 44);
    must(wide === undefined, `${at}: diagram line over 44 columns: ${wide}`);
  }
  // sidenote ids are unique so each checkbox opens its own note
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  must(dup === undefined, `${at}: duplicate id ${dup}`);
  for (const m of html.matchAll(/ for="([^"]+)"/g)) must(ids.includes(m[1]), `${at}: label for missing #${m[1]}`);
  for (const m of html.matchAll(/ href="([^"]+)"/g)) {
    const href = m[1] ?? "";
    if (/^(https?:|mailto:)/.test(href)) continue;
    const file = target(page, href);
    must(existsSync(file), `${at}: broken link ${href}`);
    // a fragment names an id on the page it points at (the root links to every check and form)
    const frag = href.split("#")[1];
    if (frag && existsSync(file) && file.endsWith(".html")) must(readFileSync(file, "utf8").includes(` id="${decodeURIComponent(frag)}"`), `${at}: ${href} names no id on its page`);
  }
}

// fake data only: every address is example.com or example.org
for (const f of files.filter((f) => /\.(html|md|txt|js)$/.test(f))) {
  for (const m of readFileSync(f, "utf8").matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[a-z]{2,}/g)) {
    must(/@example\.(com|org)$/.test(m[0]), `${f.slice(dist.length)}: address outside example.com/org: ${m[0]}`);
  }
}

// An unexpanded figure marker means a page shipped its own plumbing (the /checks/ queries did).
for (const f of files.filter((f) => /\.(html|md|txt|js|css)$/.test(f))) {
  // a marker is {{name}} or {{fig:...}}; minified script has plain {{ blocks
  const n = (readFileSync(f, "utf8").match(/\{\{(fig:|[\w?-]+\}\})/g) ?? []).length;
  must(n === 0, `${f.slice(dist.length)}: ${n} unexpanded {{ markers`);
}
const bib = readFileSync(`${dist}/bibliography/index.html`, "utf8");
must(bib.includes("Styles based on <a href=\"https://ratstack.sh/\">ratstack.sh</a> (MIT)."), "bibliography colophon");

// Attribution and boundary gates (UPDATE-15, UPDATE-16, UPDATE-33): wrong credits and private
// research never ship. The tracked list is generic; private terms come from HALTER_DENY_FILE.
const GENERIC = ["/Users/", "research/", "our wording", "principle, in our words", "principle in our words", "The skill credits"];
// a credit that repeats its author's name, like "Ann Lee, Ann Lee"
const DOUBLED = /\b([A-Z][a-z]+ [A-Z][a-z]+), \1\b/;
const denyFile = process.env.HALTER_DENY_FILE ?? "";
let PRIVATE: ReadonlyArray<string> = [];
if (denyFile === "") {
  if (REQUIRE) must(false, "HALTER_DENY_FILE is unset, so the private terms weren't checked. Point it at the deny file, then rerun.");
  else console.error("!! private deny list skipped: HALTER_DENY_FILE is unset");
} else if (!existsSync(denyFile)) must(false, `HALTER_DENY_FILE=${denyFile} doesn't exist`);
else {
  PRIVATE = readFileSync(denyFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  must(PRIVATE.length > 0, "HALTER_DENY_FILE has no terms");
}
// a private term is reported by its line in the deny file, never by its text
const denied = (text: string) => PRIVATE.flatMap((t, i) => (text.includes(t) ? [`deny-file line term ${i + 1}`] : []));
for (const f of files.filter((f) => /\.(html|md|txt|js)$/.test(f))) {
  const text = readFileSync(f, "utf8");
  for (const bad of GENERIC) must(!text.includes(bad), `${f.slice(dist.length)}: contains ${JSON.stringify(bad)}`);
  must(!DOUBLED.test(text), `${f.slice(dist.length)}: a credit repeats a name: ${DOUBLED.exec(text)?.[0]}`);
  for (const hit of denied(text)) must(false, `${f.slice(dist.length)}: contains ${hit}`);
}
must(!existsSync(`${dist}/research`), "research/ reached dist");

// The tracked tree (UPDATE-33): the files git tracks or would take on the next `git add .`. None may
// name a home directory, a temp path or the private skills snapshot, or hold a private term, and the
// local-only files stay out. halter runs on Node and pnpm (UPDATE-36), so no tracked file names the old
// runtime as a word; the pattern brackets one letter so this line doesn't match itself.
const OLD_RUNTIME = /\bb[u]n\b/i;
const BOUNDARY = /\/(Users|home)\/[a-z]|\/tmp\/[\w.-]|bc-skill[s]/;
const LOCAL_ONLY = /^(research|dist|dist-client|shots|node_modules|\.wzrrd)\/|^(UPDATE-\d+|BRIEF|REPORT)\.md$|^layout-report\.json$/;
let tracked: Array<string> = [];
try {
  // a file deleted but not yet committed is in the index and not on disk; the next commit drops it
  tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: here, encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "" && existsSync(`${here}${f}`));
} catch {
  if (REQUIRE) must(false, "git ls-files failed, so the tracked tree wasn't checked");
  else console.error("!! tracked-tree grep skipped: not a git checkout");
}
for (const f of tracked) {
  must(!LOCAL_ONLY.test(f), `tracked tree: ${f} is local-only`);
  const text = readFileSync(`${here}${f}`, "utf8");
  const m = BOUNDARY.exec(text);
  must(m === null, `tracked tree: ${f} names ${m?.[0]}`);
  const r = OLD_RUNTIME.exec(text);
  must(r === null, `tracked tree: ${f} names ${r?.[0]}, at line ${r ? text.slice(0, r.index).split("\n").length : 0}. halter runs on Node and pnpm.`);
  for (const hit of denied(text)) must(false, `tracked tree: ${f} contains ${hit}`);
}

// The clone gate (UPDATE-34): a clone of the public repo builds by itself. Copy the tracked tree into
// a fresh temp dir, nothing above it, then install from the lockfile, type-check and run the checks.
// Any step that fails, or a tool that's missing, fails smoke: the gate fails closed.
let cloned = "";
if (tracked.length) {
  const dir = mkdtempSync(join(tmpdir(), "halter-clone-"));
  try {
    for (const f of tracked) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      cpSync(`${here}${f}`, join(dir, f));
    }
    const run = (what: string, cmd: string, args: ReadonlyArray<string>) => {
      try {
        execFileSync(cmd, [...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900_000 });
        return true;
      } catch (e) {
        const out = e as { stdout?: string; stderr?: string };
        const tail = `${out.stdout ?? ""}${out.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n  ");
        must(false, `clone gate: ${what} failed in a clean copy of the ${tracked.length} tracked files:\n  ${tail}`);
        return false;
      }
    };
    if (
      run("pnpm install --frozen-lockfile", "pnpm", ["install", "--frozen-lockfile"]) &&
      run("pnpm exec tsc", "pnpm", ["exec", "tsc", "-p", "tsconfig.json"]) &&
      run("node checks.test.ts", process.execPath, ["checks.test.ts"])
    )
      cloned = `a clean copy installs, type-checks and passes its checks`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// The bibliography is LANGUAGE.md's table: same keys, links, creators and takes.
{
  const L = readFileSync(`${here}LANGUAGE.md`, "utf8");
  const rows = L.slice(L.indexOf("## Bibliography"), L.indexOf("### Skills")).split("\n").filter((l) => l.startsWith("| `"));
  const keys = new Set<string>();
  for (const r of rows) {
    const c = r.split(" | ").map((x) => x.replace(/^\| ?|\s*\|$/g, "").trim());
    const key = (c[0] ?? "").replace(/`/g, "");
    keys.add(key);
    const e = BIB.find((b) => b.key === key);
    must(e !== undefined, `bib: ${key} is in LANGUAGE.md but not bib.ts`);
    if (!e) continue;
    must(JSON.stringify([...(c[1] ?? "").matchAll(/https:\/\/[^\s;,)]+/g)].map((m) => m[0])) === JSON.stringify(e.works.flatMap((w) => (w.url ? [w.url] : []))), `bib: ${key} links differ from LANGUAGE.md`);
    must(c[2] === e.creators, `bib: ${key} creators differ from LANGUAGE.md`);
    must(c[3] === e.takes, `bib: ${key} takes differ from LANGUAGE.md`);
  }
  for (const b of BIB) must(keys.has(b.key), `bib: ${b.key} isn't in LANGUAGE.md`);
}

if (fails.length) {
  for (const f of fails) console.log(`not ok ${f}`);
  process.exit(1);
}
console.log(`smoke ok: ${pages.length} pages, every local link lands, rat.css matches its pinned sha256, fake data only, bib matches LANGUAGE.md, no private research; ${PRIVATE.length} private terms checked; ${tracked.length} tracked files clear of the boundary${cloned ? `; ${cloned}` : ""}`);
