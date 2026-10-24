// Embodied, not copied. Every /skills/ page is checked against the skill it is about: shingle the
// page text into 12-word runs and fail if any run also appears in the skill's SKILL.md or references.
// Quotes are exempt only inside <blockquote> or <q> (markdown: lines starting with ">").
// Run after `node site.ts`: node gate.ts. The snapshot is private: its location comes only from
// HALTER_SKILLS_SNAPSHOT, it never goes into dist, and the repo never names it.
// Unset, the build skips the gate with one loud line. Publishing is where the harm is, so
// `node gate.ts --require` (what publish.ts runs) refuses instead.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { skillsFrom } from "./src/skills.ts";

const here = new URL(".", import.meta.url).pathname;
const SNAPSHOT = process.env.HALTER_SKILLS_SNAPSHOT ?? "";
const N = 12;

if (SNAPSHOT === "") {
  if (process.argv.includes("--require")) {
    console.error("gate: refused. HALTER_SKILLS_SNAPSHOT is unset, so nothing proves the skill pages aren't copied. Set it to a checkout of the skills repo, then rerun.");
    process.exit(1);
  }
  console.error("!! copy gate skipped: HALTER_SKILLS_SNAPSHOT is unset");
  process.exit(0);
}
// Harm: a skill page that copies the skill or its source material. Fail closed if we can't look.
if (!existsSync(SNAPSHOT)) {
  console.error(`gate: no skills snapshot to compare against. Set HALTER_SKILLS_SNAPSHOT to a checkout of the skills repo, then rerun node gate.ts.`);
  process.exit(1);
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
const shingles = (text: string): Set<string> => {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + N <= w.length; i++) out.add(w.slice(i, i + N).join(" "));
  return out;
};
const entity = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const htmlText = (html: string) =>
  entity(
    (/<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html)
      .replace(/<blockquote[\s\S]*?<\/blockquote>/g, " ")
      .replace(/<q[\s>][\s\S]*?<\/q>/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
const mdText = (md: string) =>
  md
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n");

const filesUnder = (dir: string): Array<string> =>
  existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesUnder(join(dir, f)) : [join(dir, f)])) : [];
const sourceOf = (skill: string): Map<string, string> => {
  const dir = join(SNAPSHOT, skill);
  const files = [join(dir, "SKILL.md"), ...filesUnder(join(dir, "references"))].filter(existsSync);
  if (files.length === 0) throw new Error(`gate: skill ${skill} is missing from the snapshot`);
  const m = new Map<string, string>();
  for (const f of files) for (const sh of shingles(readFileSync(f, "utf8"))) if (!m.has(sh)) m.set(sh, f.slice(SNAPSHOT.length + 1));
  return m;
};

const skills = skillsFrom(readFileSync(`${here}LANGUAGE.md`, "utf8"));
const sources = new Map(skills.map((s) => [s.skill, sourceOf(s.skill)]));
const pages: Array<[string, ReadonlyArray<string>]> = [["/skills/", skills.map((s) => s.skill)], ...skills.map((s) => [s.slug, [s.skill]] as [string, ReadonlyArray<string>])];

let hits = 0;
for (const [slug, against] of pages) {
  const dir = `${here}dist${slug}`;
  const page = new Set([...shingles(htmlText(readFileSync(`${dir}index.html`, "utf8"))), ...shingles(mdText(readFileSync(`${dir}index.md`, "utf8")))]);
  for (const skill of against)
    for (const sh of page) {
      const from = sources.get(skill)?.get(sh);
      if (from) {
        hits++;
        console.error(`gate: ${slug} shares a ${N}-word run with ${from}: "${sh}"`);
      }
    }
}
// The snapshot location is private too.
for (const f of filesUnder(`${here}dist`))
  if (readFileSync(f, "utf8").includes(SNAPSHOT)) {
    hits++;
    console.error(`gate: ${f.slice(here.length)} names the private skills snapshot`);
  }
if (hits) {
  console.error(`gate: ${hits} problem(s). Rewrite the run in our own words, or quote under 25 words in <q> with the person's name.`);
  process.exit(1);
}
console.log(`gate ok: ${pages.length} skill pages share no ${N}-word run with their skill`);
