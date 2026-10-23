// Build the halter wiki into dist/: one directory per page with index.html and index.md,
// plus llms.txt and llms-full.txt. Shape after the rat-stack site; content from LANGUAGE.md and the seed.
// Run: bun site.ts
import { fitSource, form, layout, pairs, readNodes } from "./src/fit.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BIB, BIB_BY_KEY, titleOf, entryHtml, entryText, GROUP_ORDER, TERMS, workText } from "./src/bib.ts";
import { DOCTRINE, PACK, SHAPE, UNBUILT } from "./src/checks.ts";
import { facts, history, kw, ATTRS, type Tx, type Val } from "./src/db.ts";
import { esc, highlight, highlightTs } from "./src/hl.ts";
import { generateMachine, INTERPRETER, REGISTRY } from "./src/machine.ts";
import { footnotesMd, newCtx, render, sectionOf, slugify, toMarkdown, type Ctx } from "./src/md.ts";
import { fromFacts, type Path } from "./src/model.ts";
import { duration, printPath } from "./src/printer.ts";
import { parseQuery, run, show } from "./src/query.ts";
import { deliveryQueries, SAVED_QUERIES } from "./src/queries.ts";
import { deliveriesOf } from "./src/delivery.ts";
import { FEED } from "./src/feed.ts";
import { SKILL_OF_CHECK, skillsFrom, type Skill } from "./src/skills.ts";
import { AUTHORED, closeShift, HORIZON, PATHS, seedDb } from "./src/seed.ts";
import { interpret } from "./src/run.ts";
import { transact } from "./src/db.ts";
import { kwName, nameOf, personLog, sendCounts } from "./src/time.ts";
import { arcStrip, chainSvg, deliveryCopy, legend, lispHtml, PICKUPS, stackTables, SUCCESSORS, versionsHtml, viewAt } from "./src/views.ts";
import { renderHtml, workspaceStatic } from "./src/ws/static.ts";
import { gotView } from "./src/ws/view.ts";
import { versionsOf } from "./src/version.ts";

const here = new URL(".", import.meta.url).pathname;
const BASE = "https://halter.wzrrd.sh";
const LANGUAGE = readFileSync(`${here}LANGUAGE.md`, "utf8");
const STATUS = "A sketch. Every person, product and address is made up, and the editor is a mock.";
const SKILLS = skillsFrom(LANGUAGE);
const db = seedDb();
const fs = facts(db);
const hist = history(db);
const path = (id: string): Path => {
  const p = fromFacts(id, fs);
  if (!p) throw new Error(`no path ${id}`);
  return p;
};
const name = nameOf(db);

interface Page {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly plain: string;
  readonly diagram?: string;
  readonly group: "start" | "language" | "skills" | "paths" | "system" | "reference";
  // a line under the title, as HTML, and a parent for the breadcrumb
  readonly subtitle?: string;
  readonly parent?: readonly [string, string];
  // lines the page's index.md opens with, before the front matter
  readonly head?: string;
  readonly terms: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<string>;
  readonly body: string;
  readonly script?: boolean;
  readonly section?: Ctx["section"];
}

// ---------- figures: each has an HTML form and a markdown form ----------
type Fig = { readonly html: string; readonly md: string };
const figure = (html: string, caption: string, full = false): string =>
  `<figure${full ? ' class="fullwidth"' : ""}>${html}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
const mdTable = (head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");

const valLisp = (a: string, v: Val): string => {
  const type = ATTRS.get(a)?.type;
  if (typeof v === "number" && type === "duration") return duration(v);
  if (typeof v === "string") return JSON.stringify(v);
  return kwName(v);
};
export const printTx = (tx: Tx, limit = 99): string => {
  const ds = tx.datoms.filter((d) => !d.a.startsWith("tx/") && d.a !== "log/cursor");
  return layout(
    form("tx", [
      String(tx.t),
      ...pairs([
        ["who", JSON.stringify(tx.who)],
        ["at", JSON.stringify(tx.at)],
        ["source", tx.source],
        ["rule", tx.rule ? JSON.stringify(tx.rule) : undefined],
        ["why", JSON.stringify(tx.why)],
      ]),
      ...ds.slice(0, limit).map((d) => form(d.added ? "assert " : "retract", [JSON.stringify(String(d.e)), `:${d.a}`, valLisp(d.a, d.v)])),
      ds.length > limit && { comment: `and ${ds.length - limit} more` },
      // a move is an op too, kept as printed
      ...tx.datoms.filter((d) => d.a === "tx/move").flatMap((d) => readNodes(String(d.v)) ?? [String(d.v)]),
    ]),
  );
};

const multiples = (): Fig => ({
  html: figure(
    `<div class="multiples">${PATHS.map((id) => {
      const p = path(id);
      return `<a href="/paths/${id}/"><span class="t">${esc(p.title)}</span><br><span class="m">${p.states.length} ${p.states.length === 1 ? "state" : "states"}, ${p.states.flatMap((s) => s.sends).length} sends</span>${arcStrip(p, undefined, true)}</a>`;
    }).join("")}</div>${legend()}`,
    "Small multiples: each path's arc strip, at the same scale within a path. Calendar paths run from the first instant to the last; relative paths run from entry.",
    true,
  ),
  md: PATHS.map((id) => `- [${path(id).title}](/paths/${id}/): ${path(id).states.flatMap((s) => s.sends).map((s) => `${s.key} ${s.job}`).join(", ")}`).join("\n"),
});

const workspace = (id: string): Fig => {
  const p = path(id);
  return {
    html: `<figure class="fullwidth ws">${workspaceStatic(db, id, AUTHORED)}<figcaption>The facts as of t, printed. Drag the slider to replay the log: authored edits, world events, and the path events the interpreter wrote. Edit changes the Lisp; it reads back into facts and stages a transaction.</figcaption></figure>`,
    md: `\`\`\`lisp\n${printPath(p)}\`\`\`\n\nWhere people are at the end of the log:\n\n${mdTable(
      ["person", "where"],
      fs
        .filter((f) => (f.a === "path/finished" || f.a === "path/exited") && f.v === id)
        .map((f) => [name(String(f.e)), f.a === "path/finished" ? "done" : "exited"]),
    )}`,
  };
};

const chain = (id: string): Fig => {
  const q = parseQuery(SUCCESSORS);
  const r = run(q, { facts: fs, history: hist });
  const rows = r.ok ? r.rows.filter((x) => x[2] === id).map((x) => ({ q: String(x[0]), pred: kwName(x[1]) })) : [];
  const p = path(id);
  const exit = p.exitOn ? `${p.exitOn.name.replace(/\?$/, "")} ${p.exitOn.arg ?? ""}` : undefined;
  const all = r.ok ? r.rows : [];
  const pk = run(parseQuery(PICKUPS), { facts: fs, history: hist }, new Map([["?c", id]]));
  const pickups = pk.ok ? [...new Set(pk.rows.map((x) => String(x[0])))] : [];
  return {
    html: `<p>Nothing in the bridge says what comes next. The figure in the margin is drawn from the other paths' <code>enters-on</code>, by the queries below it.${`<label for="mn-chain" class="margin-toggle">&#8853;</label><input type="checkbox" id="mn-chain" class="margin-toggle"/><span class="marginnote">${chainSvg(id, rows, exit, pickups)}<br>Drawn from enters-on. A buyer leaves by <code>exit-on</code>, which writes <code>exited</code>, not <code>finished</code>, so <code>why-didnt-you-buy</code> never hears of them. <code>small-tools-start</code> enters on the same <code>(bought? "small-tools")</code> fact, so buyers land there.</span>`}</p>${lispHtml(fitSource(SUCCESSORS))}${lispHtml(fitSource(PICKUPS))}<div class="table-wrap"><table><thead><tr><th>?q</th><th>?pred</th><th>?p</th></tr></thead><tbody>${all
      .map((x) => `<tr>${x.map((v) => `<td><code>${esc(show(v))}</code></td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`,
    md: `${id} names no successor. The successors query reads enters-on:\n\n\`\`\`lisp\n${fitSource(SUCCESSORS)}\n\`\`\`\n\n${mdTable(["?q", "?pred", "?p"], all.map((x) => x.map(show)))}\n\nBuyers leave by exit-on. The pick-ups query finds paths that enter on the same fact: ${pickups.join(", ") || "none"}.\n\n\`\`\`lisp\n${fitSource(PICKUPS)}\n\`\`\``,
  };
};

const personLogFig = (person: string, from: string, until: string): Fig => {
  const txs = personLog(db, person).filter((tx) => tx.at >= from && tx.at <= until && !tx.why.startsWith("bf-2027"));
  const rows = txs.map((tx) => {
    const ds = tx.datoms.filter((d) => d.e === person);
    // A subscription is a path entering on another path's event; entering on a world fact is a path event.
    const kind = tx.who === "agent:halter" ? (/: \(enters-on \((finished|exited|reached)\? "/.test(tx.why) ? "subscription" : "path event") : "world event";
    return { tx, kind, what: ds.map((d) => `${d.added ? "+" : "−"} :${d.a} ${typeof d.v === "string" ? d.v : kwName(d.v)}`) };
  });
  return {
    html: figure(
      `<div class="table-wrap" style="width:100%"><table class="personlog"><thead><tr><th>t</th><th>when</th><th>kind</th><th>who, how we know</th><th>facts about ${esc(name(person))}</th><th>why</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr class="${r.kind.replace(" ", "-")}"><td>${r.tx.t}</td><td>${esc(r.tx.at.slice(5).replace("T", " "))}</td><td>${r.kind}</td><td>${esc(r.tx.who)}, <span class="src src-${r.tx.source}">${r.tx.source}</span></td><td><code>${r.what.map(esc).join("<br>")}</code></td><td>${esc(r.tx.why)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
      `${esc(name(person))}'s log, from the world event that started it (signing up) to the last subscription that fired. Every row is one transaction. The course path finishing is what the bridge subscribes to, and the bridge finishing is what the survey subscribes to. Black Friday's events for her are left out to keep the chain readable.`,
      true,
    ),
    md: mdTable(["t", "when", "kind", "who", "facts", "why"], rows.map((r) => [String(r.tx.t), r.tx.at, r.kind, `${r.tx.who}, ${r.tx.source}`, r.what.join("; "), r.tx.why])),
  };
};

// Teo's mid-run link fix to p1's email, the content story the delivery queries ask about.
const linkFix = () => db.log.find((x) => x.who === "teo" && x.datoms.some((d) => d.e === "message/p1/email"))?.t ?? 0;
const savedQueries = (): Fig => {
  const parts = [...SAVED_QUERIES, ...deliveryQueries(linkFix())].map(({ source, query }) => {
    const r = run(query, { facts: fs, history: hist });
    const rows = r.ok ? r.rows.slice(0, 12) : [];
    return {
      html: `<h3 id="q-${query.name}">${esc(query.name)}</h3><p>${esc(query.doc)}</p>${lispHtml(fitSource(source))}${
        r.ok
          ? `<div class="table-wrap"><table><thead><tr>${query.find.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${rows
              .map((x) => `<tr>${x.map((v) => `<td>${esc(show(v).slice(0, 90))}</td>`).join("")}</tr>`)
              .join("")}</tbody></table></div><p class="mute small">${r.rows.length} ${r.rows.length === 1 ? "row" : "rows"}${r.rows.length > 12 ? ", first 12 shown" : ""}.</p>`
          : `<p>The query failed: ${esc(r.error)}</p>`
      }`,
      md: `### ${query.name}\n\n${query.doc}\n\n\`\`\`lisp\n${fitSource(source)}\n\`\`\`\n\n${r.ok ? mdTable(query.find, rows.map((x) => x.map(show))) : r.error}`,
    };
  });
  return { html: parts.map((p) => p.html).join("\n"), md: parts.map((p) => p.md).join("\n\n") };
};

const example = (n: number): Fig => {
  const tx = db.log.find((x) => x.t === n);
  return tx ? { html: lispHtml(printTx(tx)), md: `\`\`\`lisp\n${printTx(tx)}\n\`\`\`` } : { html: "", md: "" };
};

const sourceCounts = (): Fig => {
  const authored = db.log.filter((tx) => tx.who !== "agent:halter");
  const by = (s: string) => db.log.filter((tx) => tx.source === s).length;
  const rows = [
    ["asked", String(by("asked")), "they told us: the role survey import"],
    ["observed", String(by("observed")), `they did it: purchases and finished courses, plus ${db.log.length - authored.length} path events by agent:halter`],
    ["inferred", String(by("inferred")), "a rule worked it out: roles guessed from the signup page, rule role-from-signup-page"],
    ["assumed", String(by("assumed")), "someone believes it: every path edit, each quoting a person"],
  ];
  return {
    html: `<div class="table-wrap"><table><thead><tr><th>how we know</th><th>transactions</th><th>in this log</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? `<span class="src src-${c}">${c}</span>` : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
    md: mdTable(["how we know", "transactions", "in this log"], rows),
  };
};

const machine = (): Fig => {
  const p = path("small-tools-bridge");
  const lisp = printPath(p);
  const ts = generateMachine(p);
  return {
    html: `<figure class="fullwidth"><div class="side-by-side"><div><h4>The Lisp, printed from the facts</h4><pre class="code lisp"><code>${highlight(lisp.replace(/\n$/, ""))}</code></pre></div><div><h4>The machine, generated from the same facts</h4><pre class="code ts"><code>${highlightTs(ts)}</code></pre></div></div><figcaption>Generated, illustrative, not run here. Transitions are functions that return <code>{ target, context }</code>. The only names the machine uses, <code>deliver</code>, <code>pace</code>, <code>preds</code> and <code>FactEvent</code>, come from the registry. <code>deliver</code> makes the one decision, then hands the message to <code>deliver/email</code>, <code>deliver/sms</code> or <code>deliver/site</code> for each channel <code>:via</code> picks.</figcaption></figure>`,
    md: `\`\`\`lisp\n${lisp}\`\`\`\n\nGenerated, illustrative, not run here:\n\n\`\`\`ts\n${ts}\`\`\``,
  };
};
const registry = (): Fig => {
  const rows = [
    ...REGISTRY.actors.map(([n, d]) => ["actor", n, d]),
    ...REGISTRY.events.map(([n, d]) => ["event", n, d]),
    ...REGISTRY.guards.map(([n, d]) => ["guard", n, d]),
  ];
  return {
    html: `<div class="table-wrap"><table><thead><tr><th>kind</th><th>word</th><th>what the reviewed code does</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td><code>${esc(r[1] ?? "")}</code></td><td>${esc(r[2] ?? "")}</td></tr>`).join("")}</tbody></table></div>`,
    md: mdTable(["kind", "word", "what"], rows.map((r) => r.map((c) => c ?? ""))),
  };
};
const interpreter = (): Fig => ({ html: `<pre class="code ts"><code>${highlightTs(INTERPRETER)}</code></pre>`, md: `\`\`\`ts\n${INTERPRETER}\`\`\`` });

// Bibliography keys are internal: a query's :cites is shown as its footnote, not in the code.
const shown = (source: string) => fitSource(source.replace(/ :cites \([^)]*\)/, ""));

// A check that trips points the agent at the skill page that says why.
const skillLink = (check: string) => {
  const sk = SKILL_OF_CHECK.get(check);
  return sk ? ` Why: [${sk}](/skills/${sk}/).` : "";
};

const pack = (): Fig => {
  const say = (s: string) => s.replace(/\{\?([\w-]+)\}/g, "{$1}");
  const one = ({ query, source }: (typeof PACK)[number]) => {
    const shape = SHAPE.includes(source);
    // the source of the idea, as a numbered footnote
    const margin = query.cites.length ? ` ${query.cites.map((k) => `[${k}]`).join(" ")}` : "";
    return {
      md: `### ${query.name}\n\n**${query.severity}**, ${shape ? "shape" : "doctrine"}. ${say(query.say)}${margin}${skillLink(query.name)}\n\n{{fig:query-src:${query.name}}}\n`,
    };
  };
  return { html: "", md: PACK.map(one).map((x) => x.md).join("\n") };
};

const FIGS: Record<string, () => Fig> = {
  multiples,
  chain: () => chain("small-tools-bridge"),
  "personlog:ana": () => personLogFig("person/ana", "2027-11-13", "2027-11-25"),
  queries: savedQueries,
  "tx:bridge-edit": () => example(db.log.find((x) => x.why.includes("four days of pitch"))?.t ?? 0),
  delivery: () => {
    const d = deliveriesOf(fs).find((x) => x.person === "person/ana" && x.send === "small-tools-bridge/p1" && x.via === "email");
    const text = d ? fs.filter((f) => f.e === d.id).map((f) => `[${d.id} :${f.a} ${valLisp(f.a, f.v)}]`).join("\n") : "";
    return { html: lispHtml(text), md: `\`\`\`lisp\n${text}\n\`\`\`` };
  },
  "tx:link-fix": () => example(linkFix()),
  // D38: the drafter's attempt to push Black Friday's close back, printed, and the interpreter's refusal
  "deadline-attempt": () => {
    const attempt = closeShift(db, { hours: 48 });
    const r = transact(db, attempt);
    let refusal = "accepted";
    try {
      interpret([...AUTHORED, attempt], HORIZON);
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    const text = `; attempted, never committed\n${r.ok ? printTx(r.tx).replace(/^\(tx \d+ /, "(tx ") : ""}\n; ${refusal.replace(/\. (?=[A-Z])/g, ".\n; ")}`;
    return { html: lispHtml(text), md: `\`\`\`lisp\n${text}\n\`\`\`` };
  },
  "feed-query": () => ({ html: lispHtml(fitSource(FEED)), md: `\`\`\`lisp\n${fitSource(FEED)}\n\`\`\`` }),
  "tx:bridge-move": () => example(db.log.find((x) => x.datoms.some((d) => d.a === "tx/move" && String(d.v).startsWith('(move "small-tools-bridge"')))?.t ?? 0),
  "tx:survey": () => example(db.log.find((x) => x.source === "asked")?.t ?? 0),
  sources: sourceCounts,
  machine,
  registry,
  interpreter,
  legend: () => ({ html: legend(), md: "" }),
  ...Object.fromEntries(PATHS.map((id) => [`workspace:${id}`, () => workspace(id)])),
  ...Object.fromEntries(PATHS.map((id) => [`versions:${id}`, () => versionsFig(id)])),
  ...Object.fromEntries(PATHS.map((id) => [`got:${id}`, () => gotFig(id)])),
  ...Object.fromEntries(PACK.map(({ query, source }) => [`query-src:${query.name}`, () => ({ html: `<details class="src"><summary>the query</summary>${lispHtml(shown(source))}</details>`, md: `\`\`\`lisp\n${shown(source)}\n\`\`\`` })])),
};
// A skill's snippet: forms from a seed path's printout, elided between picks. A pick [re, n] starts at
// the line re matches and takes n forms: that form and the ones beside or directly under it, each with
// every line it runs over. n = Infinity takes the matched form whole. The excerpt is moved left so its leftmost line starts the block.
const indentOf = (l: string) => l.length - l.trimStart().length;
const pickForms = (id: string, picks: ReadonlyArray<readonly [RegExp, number]>, what: string): string => {
  const lines = printPath(path(id)).replace(/\n$/, "").split("\n");
  const taken = picks.map(([re, n]) => {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`${what}: no line ${re} in ${id}`);
    const base = indentOf(lines[i]!);
    const out: Array<string> = [];
    let forms = 0;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j]!;
      if (j > i && indentOf(l) < base) break;
      // Infinity takes the whole form: everything under it, up to its next sibling
      if (n === Infinity && j > i && indentOf(l) <= base) break;
      if (n !== Infinity && l.trimStart().startsWith("(") && indentOf(l) <= base + 2) {
        if (forms === n) break;
        forms++;
      }
      out.push(l);
    }
    return out;
  });
  const left = Math.min(...taken.flat().map(indentOf));
  return taken.map((ls) => ls.map((l) => l.slice(left)).join("\n")).join("\n…\n");
};
const snippetText = (sk: Skill): string => pickForms(sk.snippet.path, sk.snippet.picks, `snippet for ${sk.skill}`);
for (const sk of SKILLS)
  FIGS[`snippet:${sk.skill}`] = () => {
    const text = snippetText(sk);
    const cap = `From <a href="/paths/${sk.snippet.path}/">${esc(path(sk.snippet.path).title)}</a>, printed from the seed.`;
    return { html: figure(lispHtml(text), cap), md: `\`\`\`lisp\n${text}\n\`\`\`\n\nFrom ${path(sk.snippet.path).title} (/paths/${sk.snippet.path}/), printed from the seed.` };
  };
const figHtml = (n: string) => FIGS[n]?.().html ?? `<p>missing figure ${esc(n)}</p>`;
const figMd = (n: string) => FIGS[n]?.().md ?? "";

// ---------- pages ----------
const SKILLS_LINE = (() => {
  const line = sectionOf(LANGUAGE, "What halter is")
    .split("\n")
    .find((l) => l.startsWith("- **Skills give agents the principles"));
  if (!line) throw new Error("LANGUAGE.md lost its skills line");
  return line;
})();
// Each principle links to the skill page that carries it.
const PRINCIPLE_SKILL: ReadonlyArray<readonly [string, string]> = [
  ["Design the path, not the product", "value-paths"],
  ["Every sequence has a job", "email-sequence-architect"],
  ["Build slow", "launch-sequencer"],
  ["Pain-Dream-Fix", "stb-copy-coach"],
  ["The deadline is real", "launch-sequencer"],
  ["Observation beats asking", "sales-safari"],
  ["Always have a default", "survey-strategy"],
  ["If they buy", "email-sequence-architect"],
  ["Proof is not decoration", "proof-and-objections"],
  ["Plan post-launch work", "launch-runbook"],
  ["The Process is a Lie", "launch-runbook"],
  ["Configuration shown as green", "paid-attribution-kernel"],
  ["Kit doesn't have events", "kit-automation-architect"],
];
const linkPrinciples = (md: string) =>
  md
    .replace(/\(see Skills, below\)/, "(see [Skills](/skills/))")
    .replace(/^- \*\*(.+?)\*\*/gm, (m, text: string) => {
      const sk = PRINCIPLE_SKILL.find(([start]) => text.startsWith(start))?.[1];
      return sk ? `- **[${text}](/skills/${sk}/)**` : m;
    });
const principles = linkPrinciples(sectionOf(LANGUAGE, "Principles"));
// The language page renders LANGUAGE.md, but keys never appear on a page: the line that explains
// them goes, and the Bibliography table becomes a pointer to the Bibliography page.
const languageBody = LANGUAGE.replace(/^# .*\n/, "")
  .replace(/\n## Principles\n[\s\S]*?(?=\n## )/, (m) => linkPrinciples(m))
  .replace(/^Bibliography keys look like .*\n/m, "")
  .replace(/ :cites \([a-z0-9 -]+\)/g, " :cites (…)")
  .replace(/\n## Bibliography\n[\s\S]*?(?=\n## )/, "\n## Bibliography\n\nEvery source is on the [Bibliography](/bibliography/) page, grouped by creator. On this site each citation is a numbered footnote, listed under Sources at the end of the page.\n\n### Skills\n\nBadass Courses' skills carry these ideas into working practice. Each has a page in [Skills](/skills/), built around the principle it represents, crediting the people the idea comes from. The skills repo is private, so the pages name each skill and don't link to it.\n");
const ALL_KEYS = BIB.map((b) => b.key);

// On each version (D32): a static table at the head of the log, which the workspace's slider keeps current.
const versionsFig = (id: string): Fig => {
  const h = history(db);
  const rows = versionsOf(h, id).map((v) => {
    const tx = db.log.find((x) => x.t === v);
    const ran = new Set(h.filter((d) => d.a === "path/version" && d.added && d.v === `${id}@${v}`).map((d) => String(d.e))).size;
    return `| ${v} | ${ran} | ${tx?.at ?? ""} ${tx?.who ?? ""}: ${(tx?.why ?? "").replace(/\|/g, "\\|")} |`;
  });
  return {
    html: figure(versionsHtml(db, id), "At the head of the log, where nobody is on a path. The workspace's Versions tab follows the slider."),
    md: `| version | ever ran it | made by |\n|---|---|---|\n${rows.join("\n")}\n\nAt the head of the log nobody is on this path.`,
  };
};
const EACH_VERSION = (id: string) => `

## On each version

A version is the transaction that last changed the path's structure. Each person runs the version they entered on, and only a \`move\` changes it under them. Holds reach every version.

{{fig:versions:${id}}}

## What they got

Every delivery on this path, one per person, send and channel. Each prints the message as of its own content version, the last transaction that changed it before it went out, so a later edit never changes what someone got. In the workspace, click a name under Where people are to open theirs in the Got tab.

{{fig:got:${id}}}`;

// What they got (D33): every delivery at the head of the log, which the slider keeps current.
const gotFig = (id: string): Fig => {
  const ds = deliveriesOf(fs).filter((d) => d.send.startsWith(`${id}/`));
  const rows = ds.map((d) => `| ${d.person.replace(/^person\//, "")} | ${d.send.slice(id.length + 1)} | ${d.message} | ${d.via} | ${d.status} | ${d.content} | \`${deliveryCopy(db, d.message, d.via, d.content).replace(/\n\s*/g, " ").replace(/\|/g, "\\|")}\` |`);
  return {
    html: figure(renderHtml((h) => gotView(h, db, id, [])), "At the head of the log. The workspace's Got tab follows the slider. Each copy is printed as of the delivery's content version."),
    md: ds.length ? `| person | send | message | channel | status | content tx | copy |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}` : "Nothing has gone out on this path.",
  };
};

const pathPage = (id: string, plain: string, description: string, diagram: string, body: string, terms: ReadonlyArray<string>, sources: ReadonlyArray<string>): Page => ({
  slug: `/paths/${id}/`,
  title: path(id).title,
  parent: ["/paths/", "Campaigns"],
  description,
  plain,
  diagram,
  group: "paths",
  terms,
  sources,
  body: body + EACH_VERSION(id),
  script: true,
});


// ---------- the root page: the spec, as use cases (UPDATE-32) ----------
// Every excerpt is printed from the seed by the canonical printer; nothing here is hand-written halter.
const EXCERPT_MAX = 20;
const lispBlock = (text: string, what: string) => {
  const n = text.split("\n").length;
  if (n > EXCERPT_MAX) throw new Error(`${what}: the excerpt is ${n} lines, over ${EXCERPT_MAX}`);
  return `\`\`\`lisp\n${text.replace(/\n$/, "")}\n\`\`\``;
};
const sayOf = (name: string) => {
  const c = PACK.find((x) => x.query.name === name);
  if (!c) throw new Error(`the spec names check ${name}, which isn't built`);
  return c.query.say.replace(/\{\?([\w-]+)\}/g, "{$1}");
};
const checksMd = (names: ReadonlyArray<string>) =>
  `What halter checks:\n\n${names.map((n) => `- [\`${n}\`](/checks/#${n}): ${sayOf(n)}`).join("\n")}`;
const txAt = (t: number, limit?: number) => {
  const tx = db.log.find((x) => x.t === t);
  if (!tx) throw new Error(`the spec prints tx ${t}, which the seed doesn't have`);
  return printTx(tx, limit);
};
const savedSource = (name: string) => {
  const q = [...SAVED_QUERIES, ...deliveryQueries(linkFix())].find((x) => x.query.name === name);
  if (!q) throw new Error(`the spec prints query ${name}, which isn't saved`);
  return fitSource(q.source);
};
const txWhere = (f: (tx: (typeof db.log)[number]) => boolean, what: string) => {
  const tx = db.log.find(f);
  if (!tx) throw new Error(`the spec looks for ${what} in the seed`);
  return tx.t;
};

interface UseCase {
  readonly goal: string;
  readonly say: string;
  readonly excerpts: ReadonlyArray<string>;
  readonly checks: ReadonlyArray<string>;
  readonly live: readonly [string, string];
}
const useCases = (): ReadonlyArray<UseCase> => {
  const bridgeMove = txWhere((x) => x.datoms.some((d) => d.a === "tx/move" && String(d.v).startsWith('(move "small-tools-bridge"')), "the bridge move");
  const agentMove = txWhere((x) => x.who.startsWith("agent:") && x.rule !== undefined && x.datoms.some((d) => d.a === "tx/move" && String(d.v).startsWith('(move "bf-2027"')), "an agent's move on bf-2027");
  const fix = linkFix();
  return [
    {
      goal: "Send one email to a list",
      say: "A broadcast is a path with one state and one send. `:on` fixes the instant, and `:since` keeps the trigger to fresh evidence, so only people who join the list after it count. The target names what readers should go and do; halter measures it and never holds a send back for it.",
      excerpts: [pickForms("spring-note", [[/^ {2}\(enters-on /, Infinity], [/^ {2}\(state note/, Infinity], [/^ {2}\(target /, Infinity]], "spring-note")],
      checks: ["path-has-target", "trigger-has-evidence", "job-on-every-send", "message-exists"],
      live: ["/paths/spring-note/", "Spring note"],
    },
    {
      goal: "Teach with a free email course",
      say: "A course runs on each reader's own clock. `:after` counts from when that person entered the state, so day 2 goes 24 hours after their day 1. `(to closed :after 100h)` ends the course, and that's what `finished?` waits for.",
      excerpts: [pickForms("five-day-tools", [[/^ {2}\(state course/, 3], [/^ {4}\(to closed/, 1]], "five-day-tools")],
      checks: ["offsets-increase", "send-inside-state", "path-has-target"],
      live: ["/paths/five-day-tools/", "Five days of small tools"],
    },
    {
      goal: "Pitch after the course, and stop when they buy",
      say: "The bridge enters on `(finished? \"five-day-tools\")`, so it starts only for people the course reached. `exit-on` takes buyers out the moment they buy. The last call names the deadline it counts down to, and `(or sms email)` sends it by one channel: the person's asked preference, then the written order.",
      excerpts: [pickForms("small-tools-bridge", [[/^ {2}\(enters-on /, Infinity], [/\(send "p3"/, Infinity], [/^ {2}\(exit-on /, Infinity]], "small-tools-bridge")],
      checks: ["pitch-to-buyer", "fake-deadline", "bridge-announces-pitch", "via-has-rendition"],
      live: ["/paths/small-tools-bridge/", "Small Tools: bridge and pitch"],
    },
    {
      goal: "Launch a cohort on a calendar",
      say: "A launch runs on fixed instants. The offer carries the window, the early bird and the class start, and every `:on` is checked against them. A deadline send names the event it counts down to.",
      excerpts: [pickForms("fieldkit-c7", [[/^ {2}\(offer /, Infinity], [/\(send "c7-06"/, Infinity]], "fieldkit-c7")],
      checks: ["early-bird-inside-doors", "class-after-close", "last-call-before-close", "no-send-after-close"],
      live: ["/paths/fieldkit-c7/", "Field Kit, Cohort 7"],
    },
    {
      goal: "Run a sale with a deadline you keep",
      say: "Once a send has told someone when the sale closes, that time is a promise. halter refuses any change that would move it for people already told. Make a new offer and announce it instead. The sale's page prints an agent's attempt to push the close back, and the refusal.",
      excerpts: [pickForms("bf-2027", [[/^ {2}\(offer /, Infinity], [/\(send "bf-05"/, Infinity]], "bf-2027 deadline")],
      checks: ["deadline-kept", "fake-deadline", "no-send-after-close"],
      live: ["/paths/bf-2027/", "Black Friday 2027"],
    },
    {
      goal: "Write to each kind of reader",
      say: "`vary` picks a message by a person's value on a dimension, and `else` covers everyone without one. Marking a vary `:hard` states the value as who they are, and halter refuses that while any of those values were inferred rather than asked.",
      excerpts: [pickForms("bf-2027", [[/\(send "bf-02"/, Infinity]], "bf-2027 vary")],
      checks: ["hard-from-inferred", "else-on-every-vary", "value-declared", "few-values"],
      live: ["/paths/bf-2027/", "Black Friday 2027"],
    },
    {
      goal: "Ask people who didn't buy why",
      say: "The survey is its own path. It enters on `(finished? \"small-tools-bridge\")`, which is true only for people who walked the whole pitch: buyers leave by `exit-on`, and leaving isn't finishing.",
      excerpts: [pickForms("why-didnt-you-buy", [[/^ {2}\(enters-on/, Infinity], [/^ {2}\(state ask/, Infinity]], "why-didnt-you-buy")],
      checks: ["post-close-survey", "trigger-has-evidence", "path-has-target"],
      live: ["/paths/why-didnt-you-buy/", "Why didn't you buy?"],
    },
    {
      goal: "Help buyers get the result",
      say: "Buying isn't the result. This path enters on the purchase, sends `support` until the tool is in use, and names that as its target: the person's result, not ours.",
      excerpts: [pickForms("small-tools-start", [[/^ {2}\(enters-on /, Infinity], [/^ {2}\(state start/, 2], [/^ {2}\(exit-on /, Infinity], [/^ {2}\(target /, Infinity]], "small-tools-start")],
      checks: ["support-to-buyers", "target-is-our-object", "path-has-target"],
      live: ["/paths/small-tools-start/", "Small Tools: get your first tool in use"],
    },
    {
      goal: "Fix a broken link after it went out",
      say: `Content lives in its own file, and an edit to it is a transaction like any other. Teo fixed p1's link at t=${fix}. Everyone who got p1 before that got the broken link, and a query over the delivery facts names them.`,
      excerpts: [txAt(fix), savedSource("got-broken-link")],
      checks: ["message-exists", "via-has-rendition", "uncertain-sends"],
      live: ["/paths/small-tools-bridge/", "Small Tools: bridge and pitch"],
    },
    {
      goal: "Change a campaign people are already on",
      say: "An edit to a path makes a new version. People already on it stay on theirs until a `move` takes them over, and the move is a transaction with its own why.",
      excerpts: [txAt(bridgeMove)],
      checks: ["people-on-old-version", "deadline-kept", "to-declared-state"],
      live: ["/paths/small-tools-bridge/", "Small Tools: bridge and pitch"],
    },
    {
      goal: "Let an agent run it",
      say: "An agent writes the same transactions a person does, as `agent:NAME`, and an inferred one names the `:rule` it followed. Nobody waives their own alarm, person or agent ([`no-self-waiver`](/language/#path-id-body)). Each path page has a feed of what changed since you last looked.",
      excerpts: [txAt(agentMove, 4)],
      checks: ["people-on-old-version", "deadline-kept"],
      live: ["/paths/bf-2027/", "Black Friday 2027"],
    },
    {
      goal: "Ask the facts a question",
      say: "A question is a query over the same facts, and a check is a query that must come back empty. These two run against the seed on the facts page.",
      excerpts: [savedSource("got-texts"), savedSource("who-was-where")],
      checks: ["uncertain-sends", "people-on-old-version"],
      live: ["/facts/", "Facts, events and time"],
    },
  ];
};

// Every form, with the LANGUAGE.md heading that defines it; the build fails on a heading that moved.
const FORMS: ReadonlyArray<readonly [string, string, string]> = [
  ["path", "A campaign: states a person walks, with sends along the way.", "`(path ID body…)`"],
  ["offer", "What's for sale, at what pricing, with its window, early bird and class.", "`(offer PRODUCT :pricing STRING window? early-bird? class? bonus*)`"],
  ["enters-on", "The predicate that puts a person on the path; `:since` keeps it to fresh evidence.", "`(path ID body…)`"],
  ["hold", "Stops delivery until an instant.", "`(path ID body…)`"],
  ["state", "A named place on the path, with its sends and its ways out.", "`(path ID body…)`"],
  ["send", "One message, its timing, its job and its channels.", "`(send MESSAGE-ID timing :job JOB :via VIA [:deadline EVENT] [:asks DIM] [:answers (DIM VALUE)] [:bonus PRODUCT] [(vary …)])`"],
  ["vary", "Picks the message by a person's value on a dimension, with an else.", "`(send MESSAGE-ID timing :job JOB :via VIA [:deadline EVENT] [:asks DIM] [:answers (DIM VALUE)] [:bonus PRODUCT] [(vary …)])`"],
  ["to", "Moves a person to another state, after a duration or when a predicate holds.", "`(to STATE :after DURATION | :when PRED)`"],
  ["exit-on", "Takes a person off the path the moment a predicate holds.", "`(path ID body…)`"],
  ["target", "The person's result, measured within a window; it never gates a send.", "`(path ID body…)`"],
  ["guard", "Skips or defers a send for people a predicate picks out.", "Actions in `guard`"],
  ["pace", "How many sends go out per minute, and how that ramps.", "`(path ID body…)`"],
  ["waive", "Silences one alarm on the record. A refusal can't be waived.", "`(path ID body…)`"],
  ["dimension", "A thing people differ on, with its values.", "`(dimension NAME (VALUE…) [:many] [:objections (VALUE…)])`"],
  ["message", "The content: one rendition per channel, in its own file.", "Structure and content"],
  ["predicates", "`bought?`, `finished?`, `did?`, `tag?`, `on-list?`, `in?` and `and`, `or`, `not`.", "Predicates"],
  ["tx", "A transaction: who, when, how we know, why, and the facts it asserts and retracts.", "Transactions"],
  ["move", "Takes people on an old version of a path to the current one.", "Transactions"],
  ["query", "A question over the facts.", "Queries and checks"],
  ["check", "A query that must come back empty, with what to say when it doesn't.", "Queries and checks"],
];
const HEADINGS = new Set([...LANGUAGE.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!));
const formsMd = () =>
  `| Form | What it does |\n|---|---|\n${FORMS.map(([f, line, heading]) => {
    if (!HEADINGS.has(heading)) throw new Error(`form ${f}: LANGUAGE.md has no heading ${heading}`);
    return `| [\`${f}\`](/language/#${slugify(heading)}) | ${line} |`;
  }).join("\n")}`;

// The harm refusals in plain words; a harm check without words here fails the build.
const NEVER: Readonly<Record<string, string>> = {
  "fake-deadline": "It never sends a deadline that changes nothing. An urgency send points at a real close, early bird or class.",
  "pitch-to-buyer": "It never keeps pitching someone who already bought.",
  "hard-from-inferred": "It never tells people who they are from a guess. A `:hard` value has to have been asked.",
  "synthetic-live": "It never sends to a made-up test person on a live list.",
  "deadline-kept": "It never moves a deadline people were already told.",
};
const neverMd = () => {
  const harm = PACK.filter((c) => !SHAPE.includes(c.source) && c.query.severity === "refuse").map((c) => c.query.name);
  for (const n of harm) if (!NEVER[n]) throw new Error(`harm refusal ${n} has no plain words on the root page`);
  return `${harm.map((n) => `- ${NEVER[n]} [\`${n}\`](/checks/#${n})`).join("\n")}\n- A refusal can't be waived, by anyone, person or agent. Alarms can, on the record, by someone other than whoever raised them.`;
};

const homeBody = () => {
  const head = db.log.at(-1)?.t ?? 0;
  const v = viewAt(db, "spring-note", head).verdict;
  const live = (f: { readonly waived?: unknown }) => f.waived === undefined || (typeof f.waived === "object" && f.waived !== null && !(f.waived as { counts?: boolean }).counts);
  const refusals = v ? v.findings.filter((f) => f.severity === "refuse" && live(f)).length : 0;
  const alarms = v ? v.findings.filter((f) => f.severity === "alarm" && live(f)).length : 0;
  const owned = fs.filter((f) => String(f.e) === "spring-note" || String(f.e).startsWith("spring-note/")).length;
  const got = deliveriesOf(fs).filter((d) => d.send.startsWith("spring-note/"));
  const people = new Set(got.map((d) => d.person)).size;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `## What halter is

halter is a small Lisp for email campaigns. A campaign is a path: states a person walks through, with sends along the way. halter keeps it as facts, prints it as the Lisp on this page, and checks it before anything goes out. Every excerpt here is printed from the seed by the same printer the editor uses. [The language](/language/) is the definition; this page is what it's for.

## The smallest campaign

${lispBlock(printPath(path("spring-note")), "spring-note")}

- **Checks.** All ${PACK.length} checks run on it. At the head of the log they find ${n(refusals, "refusal", "refusals")} and ${n(alarms, "alarm", "alarms")}. [The checks](/checks/).
- **Facts.** It's ${owned} facts. The Lisp above is printed from them, and it reads back into the same facts. [Facts, events and time](/facts/).
- **Who got what.** ${n(people, "person", "people")} got it, ${n(got.length, "delivery", "deliveries")} in all. Each delivery is a fact too, with the content version it carried. [Spring note, live](/paths/spring-note/).

## Use cases

${useCases()
  .map(
    (u) => `### ${u.goal}

${u.say}

${u.excerpts.map((x, i) => lispBlock(x, `${u.goal}, excerpt ${i + 1}`)).join("\n\n")}

${checksMd(u.checks)}

Live: [${u.live[1]}](${u.live[0]}).`,
  )
  .join("\n\n")}

## Every form

${formsMd()}

## What halter never does

${neverMd()}

## Principles

${principles}

${SKILLS_LINE} See [Skills](/skills/).`;
};

const PAGES_BUT_HUB: ReadonlyArray<Page> = [
  {
    slug: "/",
    title: "halter",
    description: "A small Lisp for email campaigns. Every campaign is a path, the facts are the data, and checks run before anything ships.",
    plain: "halter writes each email campaign as a path people walk, keeps it as facts, prints it as Lisp, and checks it before it ships.",
    group: "start",
    terms: ["path", "fact", "check"],
    sources: ALL_KEYS,
    section: (h) => (h === "Principles" ? { continuationsInMargin: true } : {}),
    body: homeBody(),
  },
  {
    slug: "/language/",
    title: "The halter language",
    description: "The canonical definition of halter 0.2: principles, forms, predicates, events, triggers, checks and printing.",
    plain: "Every campaign is a path of states and sends, triggers are predicates over facts, and the printout reads back into the same facts.",
    diagram: "facts --print--> Lisp --read--> facts\n  |                                ^\n  | interpreter                    |\n  v                                |\npath events ---- transactions -----+",
    group: "language",
    terms: ["path", "state", "send", "predicate", "printout"],
    sources: ALL_KEYS,
    section: (h) => (h === "Principles" ? { continuationsInMargin: true } : h === "Triggers" ? { citesInMargin: true } : {}),
    body: `${languageBody}

## Notes from building this sketch

These aren't part of 0.2. They came up while making the seed run, and they're for the grill.^[Each one is visible on the pages linked here. Drag the slider to the transaction named.]

- **The broadcast example reaches nobody under fresh evidence.** \`spring-note\` enters on \`(on-list? "fernhill-news")\` with no \`:since\`. Everyone joined the list before the note went live, so no fact is fresh. The seed gives the [cohort](/paths/fieldkit-c7/), [Black Friday](/paths/bf-2027/) and [Spring note](/paths/spring-note/) \`:since "2027-01-01T00:00Z"\`. Either broadcasts default to \`:since\` the list's start, or the example needs it.
- **\`:path/at\` can't be one value per person.** Black Friday and the bridge overlap in November, so the same person is in two paths at once. The sketch keeps one value per path.
- **The last assert decides who waived.** If whoever raised an alarm asserts a waiver someone else already confirmed, the waiver becomes theirs and goes pending, so the alarm comes back on. That errs toward the alarm. Undoing a confirmation in the sketch's editor retracts the waiver, rather than returning it to pending.
- **An alarm on the whole path has no author.** \`no-self-waiver\` reads who wrote the facts a finding's \`:at\` points at. \`post-close-survey\` points at the path itself, which names no single fact, so the sketch lets anyone waive it, as it does \`uncertain-sends\` and \`people-on-old-version\`. Whether the path's author raised an alarm about something missing is open.
- **A quote can't prove whose words it is.** A valid why holds words in quotes, or is \`:source inferred\` with a \`:rule\`. The sketch checks that the quote is there, not that the author said it.
- **Fresh targets are judged by comparison.** The sketch's interpreter calls a target fresh when it's true now and was false as of the person's entry. That's right for facts that only get added. An act retracted and asserted again after entry would count as fresh, and 0.2 doesn't say whether it should.
- **Targets outlast the walk, so the log does too.** The longest window is \`:within 2400h\`, so the seed runs to 1 February 2028 for every window to close. A live system never closes the log; it just keeps watching.
- **Deferred sends pile up.** Ben left the bridge on 26 November and got two deferred Black Friday sends in the same minute. The no-pile-ups rule covers holds; it should cover defers too.
- **Old versions count toward the verdict.** Checks run on every version someone is still on, and a refusal on an old version counts as a refusal. That fails closed, but it means fixing a path for new entrants still shows Refused until the people on the old version are moved.
- **The editor forks the log.** The editor edits as of the slider. Committing sets aside the seed transactions after that point and runs the interpreter on from the edit, so its path events follow.
- **Content versions are per message, not per channel.** Teo's fix changed only \`p1\`'s email, but Ivy's site delivery of \`p1\` also records it as its content version, because the rule reads the last transaction that changed the message. The copy printed is still right; only the version number is coarser than it could be.
- **Nothing in the seed is uncertain.** Every deliver in the sketch succeeds, so \`uncertain-sends\` only fires in its test. A provider adapter would write \`:delivery/status uncertain\` and later update the same delivery.
- **Shape checks and cites.** The pack gives \`else-on-every-vary\` a source,[dunn-survey] but shape checks carry no cite. The sketch keeps it.`,
  },
  pathPage(
    "fieldkit-c7",
    "A cohort launch is a path with one state, whose sends go out on calendar instants to whoever is in it.",
    "The Field Kit cohort launch: one state of calendar sends, real doors, a real early-bird and a real class start.",
    "launch: c7-01 c7-03 teach . c7-04 announce\n  . c7-05 fix . c7-06 urgency(early-bird)\n  . c7-07 last-call(close) . c7-08 survey\n  every send :via email\ntarget: bought? fieldkit-c7 and\n  did? used-the-kit, within 2160h",
    `A cohort launch is a path with one state.^[A campaign with one node is still a path. Joel ruled on this as D13.] Everyone on the list entered it when it went live, and each send went out at its instant to whoever was still in the state. The offer's events are real instants, so the urgency send can point at the early-bird and mean it. [hoy-lcc] [dunn-launch]

{{fig:workspace:fieldkit-c7}}

## What happened

- Ben bought on 4 March. \`exit-on\` took him out at once, so he got none of the urgency or last-call sends. [dunn-bridge]
- Eli owns the library. The guard skipped every send to him, and each skip is a path event with the reason in its why. Nothing went out, so he passed Field Kit rather than finishing it.
- **Every edit after go-live moved everyone.** A cohort enters the whole list at go-live, so an edit without a move would reach nobody. Mara's doors change, her library guard, Teo's slower start and the dropped warmup were each committed with \`(move "fieldkit-c7")\` in the same transaction, and the interpreter's next path event moved all eight people onto the new version. On each version, below, shows the trail.
- Mara dropped the middle warmup, which raised \`teach-before-fix\`: she wrote every send on this path, so the alarm is hers. She waived it, quoting herself, but nobody waives their own alarm, so the waiver was pending until Teo confirmed it the next morning, in his own words.^^[Nobody waives their own alarm, person or agent. A waiver is pending while its author wrote a fact the alarm points at, and anyone else can confirm it. Its why quotes the author's own words, or is \`:source inferred\` with a \`:rule\`. Refusals can't be waived.] Drag the slider back to those transactions to see the alarm come and go.

## The target

\`(target (and (bought? "fieldkit-c7") (did? "used-the-kit")) :within 2160h)\`. A sale is our result. Using the kit in the field is theirs, so that's what the cohort is measured on. [hulick]

- **Ben reached it after he left.** He bought on 4 March and \`exit-on\` took him out, but the target kept watching. The class log saw him run the week-1 field exercise on 29 March, an observed \`[p :did "used-the-kit"]\`.
- **Hal bought and missed.** He bought on 10 March and never used the kit, so his window ran out in April with \`:path/missed-target\`.
- **Six finished but missed.** They saw every send and didn't buy. That's the honest failure, counted beside the sales rather than hidden by them.`,
    ["offer event", "waiver", "exit-on", "target"],
    ["hoy-lcc", "dunn-launch", "dunn-bridge", "coz"],
  ),
  pathPage(
    "bf-2027",
    "Black Friday is one state of calendar sends that steps aside for anyone in the middle of the bridge.",
    "The Black Friday 2027 sale: calendar sends over a four-day window, a role variation, and a guard that defers to the bridge.",
    "sale: bf-01 announce . bf-02 fix (vary role)\n  . bf-03 proof . bf-04 urgency(close)\n  . bf-05 last-call(close) . bf-06 survey\n  every send :via email\ntarget: bought? library and\n  did? finished-a-library-course,\n  within 2400h",
    `The sale is a path with one state. People who already own the library never enter, because \`enters-on\` checks \`(not (bought? "library"))\` next to the list. A guard defers any send to someone who is on the bridge right now.

{{fig:workspace:bf-2027}}

## What happened

- Dee finished the course on 24 November, so she was on the bridge for the whole sale. Her sends kept deferring a day at a time until the offer closed, and then each was skipped with that reason.
- **The bridge guard and Sunday sends moved everyone.** Both edits came after go-live, and both carried \`(move "bf-2027")\`. The guard was drafted by \`agent:desk\` from Mara's words, so an agent wrote that move, and an agent's move runs at once, as a person's does.
- Ben left the bridge on 26 November and got two deferred sends in the same minute on the 27th.^[That's a pile-up. The no-pile-ups rule covers holds; the sketch's interpreter doesn't spread defers yet.] [pu]
- The \`few-values\` alarm fired when the survey answers landed: \`role\` has six values. [dunn-survey]
- **An agent waived Mara's alarm, and it counted at once.** Mara wrote the fix send with no warmup before it, so she raised \`teach-before-fix\`. On 5 October \`agent:judge\` waived it with \`:source inferred :rule "warm-list"\`: everyone on the path had opened mail from us in the last 90 days. The judge didn't raise the alarm, so the waiver counted.
- **The drafter raised an alarm and couldn't waive it.** On 22 October \`agent:drafter\` read the survey and gave podcasters and writers their own \`bf-02\`, by \`:rule "survey-roles"\`, with \`(move "bf-2027")\` and no quote. That \`:vary-by\` is the drafter's fact, and the role dimension has 6 values, so the drafter raised \`few-values\`. An hour later it waived its own alarm. The waiver landed pending, the alarm stayed on, and the printout marked it \`(waive few-values) ; pending: agent:drafter raised it\`. On the 25th \`agent:judge\` asserted the same waiver under the same rule, and it counted, with no person in the loop. Drag the slider across those transactions: off, on, pending, waived. History keeps both asserts.
- **Try it.** In the Edit tab, drag to the drafter's waiver, type Mara's own words, in quotes, in the why box and press **Confirm as Mara**: she didn't raise \`few-values\`, so her confirmation counts. On [Field Kit, Cohort 7](/paths/fieldkit-c7/) at Mara's own waiver, the same button stays disabled: "You raised this alarm, so someone else must waive it." The editor never writes a quote for anyone.^^[The waiver's author is whoever wrote the last assert. The database keeps a repeated assert of a waiver so a confirmation is its own transaction; other repeated asserts are dropped.]
- **Mara can see what the agents did.** She marked Black Friday seen on 1 October, before any of this. The **Since you last looked** panel at the top of the workspace lists every agent transaction on the path after her cursor, as of the slider: the judge's waiver of her alarm, the drafter's move, the drafter's pending waiver, and the judge's confirmation, marked \`counts · agent waived an agent's alarm\` because no person saw it before it counted. Nothing waits on the panel; **Mark seen** just moves her cursor. The selection is a query over transaction facts:

{{fig:feed-query}}
- **A told deadline is locked.** On 30 November, after the last call went out, \`agent:drafter\` tried to push close back two days by \`:rule "late-surge"\`, with \`(move "bf-2027")\`. The interpreter refused the whole transaction, **refused: deadline-kept**, because the people it would move had a sent delivery telling them when the sale ends. Closing early is refused the same way, whoever writes it. The honest route is a new offer with its own window and its own announcement: a new promise, not a broken one. The sketch doesn't build that offer. [hoy-lcc] [dunn-launch]

{{fig:deadline-attempt}}

- **Try it.** Drag the slider past the last call, open the Edit tab, change \`:closes\` and press **Commit and move everyone**: it's refused and nothing changes. **Commit for new entrants** still works, because nobody already told runs the new version.
- Send \`bf-02\` varies by role, softly. Each message it can pick, \`bf-02-podcaster\`, \`bf-02-writer\` and the \`else\`, is declared in the content file with an email rendition, or \`via-has-rendition\` refuses. Turning on \`:hard\` is refused, because two people's roles were inferred, not asked. [dunn-rm]

## The target

\`(target (and (bought? "library") (did? "finished-a-library-course")) :within 2400h)\`. The library is worth something when someone finishes a course in it.

- **Fay** bought on 27 November, left on \`exit-on\`, and finished a course on 15 December: reached.
- **Hal** bought on the 29th and hasn't finished one: missed after exiting.
- **Five** saw the whole sale without buying: finished but missed.`,
    ["guard", "dimension", "alarm"],
    ["dunn-survey", "dunn-rm", "pu", "dunn-launch"],
  ),
  pathPage(
    "five-day-tools",
    "The free course is a path too: each lesson unlocks on the site, and an email says it's open.",
    "Five days of small tools: a course on a site, one lesson a day, each send going to both the site and email.",
    "tag? signup:five-day-tools\n  -> course --100h--> closed (done)\n     day-1 0h . day-2 24h . day-3 48h\n     . day-4 72h . day-5 96h\n     every send :via (and site email)\n  target: did? shipped-tool, within 504h",
    `A send doesn't mean email. This course is a path whose sends go \`:via (and site email)\`: the site rendition unlocks the day's lesson, recorded as an access fact, and the email rendition says it's open. Finishing the course is just this path writing \`:path/finished\`, and that is the event [the bridge](/paths/small-tools-bridge/) subscribes to.^[Before this, a finished course was a world fact from a course adapter. Now it's a path event, so the course and the bridge use the same machinery.] [dunn-bridge]

{{fig:workspace:five-day-tools}}

## What happened

- **Gus took it in May.** He signed up on 16 May and finished on the 20th, two weeks before the bridge went live, so the bridge never pitched him. [pu]
- **Everyone else took it in November.** Ana, Ben, Cy, Dee and Eli each got five lessons, one a day, and each lesson wrote a \`:person/access\` fact for its page.
- **The site needs an account.** Signing up makes one. Someone without an account would get the email half of each send only, because \`and\` uses every channel the person can receive.
- **Ivy came in from the site.** She signed up on 18 November without joining the newsletter, so the course reached her and the list's launches didn't.

## The target

Finishing is \`:path/finished\`. The point is a shipped tool: \`(target (did? "shipped-tool") :within 504h)\`. Day 5 asks for a link, and a reply lands as \`[p :did "shipped-tool"]\` with \`:source asked\`.

- **Ana, Cy and Eli** shipped inside the three weeks.
- **Ben, Dee, Gus and Ivy finished but missed.** They read all five days and shipped nothing in time. That's the honest failure, and it's the number the course should be judged on.^[Ben did ship on 10 December, three days after his window closed. [Why didn't you buy?](/paths/why-didnt-you-buy/) entered him later, so it counts that one.]`,
    ["send", "path event", "enters-on", "target"],
    ["hulick", "pu"],
  ),
  pathPage(
    "small-tools-bridge",
    "The bridge gives people who finish the free course two days of bridge and four of pitch, and pulls buyers out at once.",
    "The Small Tools bridge: a relative-time path keyed off a finished course, with an evergreen deadline tied to the pitch state.",
    "finished? five-day-tools\n  -> bridge --48h--> pitch --96h--> closed\n     b1 2h email                    (done)\n                     p1 0h site+email\n                     p2 24h email\n                     p3 90h sms|email\n  exit-on bought? small-tools -> exited\n  target: bought? small-tools and\n    did? tool-in-use, within 1440h",
    `The bridge is the path most people will copy. It enters on a finished course, runs on time since entry, and its deadline is the pitch state itself: \`(window :state pitch)\`, so leaving the state closes the offer. [hulick] [dunn-bridge]

The printout has two files. **Structure** is the path: states, timing, triggers and channels. **Content** is the messages it names, one rendition per channel, with bodies as refs.^^[Structure is fixed at entry: a person runs the path as it was on the transaction that entered them, and only an explicit \`(move …)\` changes it under them. Content is read at delivery: a message is read as of the moment it goes out, so a typo fix reaches everyone who hasn't had it yet, and each delivery records the content version it read.] Flip the toggle beside History to see the content file as of the same transaction.

{{fig:workspace:small-tools-bridge}}

## Who comes next

{{fig:chain}}

## What happened

- **Four days of pitch, for whoever comes next.** The bridge went live with three days of pitch. On 21 November Mara gave it four. Structure is fixed at entry, so that edit made a new version for new entrants, and Ana, Ben and Cy, who were already on the bridge, kept three days. \`people-on-old-version\` alarmed. On the 22nd Mara moved them, in her own words: "Ana is halfway through her pitch, and three days felt rushed." Each kept their state and the instant they entered it, so Ana's last call went out at 90 hours instead of 66. Drag the slider across 21 and 22 November to see the alarm come on and clear. [pu] [bc-gates]
- **Gus stayed out.** He finished the course in May, before the bridge went live on 2 June. Fresh evidence means only facts after go-live count, so launching the bridge didn't pitch everyone who ever finished. [pu]
- **The hold made a miss.** Teo held the bridge during a provider outage. Ana's \`b1\` came due during the hold, and her bridge state ended before the hold did, so it's written as \`:send/missed\`, not sent late. Her \`p1\` went out when the hold ended. [pu]
- **The person picks the channel.** \`p3\` is \`:via (or sms email)\`: the path allows two channels, and the person picks between them. [rk] [dunn-rm]
  - Ana gave a phone number but never said yes to texts, so sms was out and email was the first channel she could receive. Missing consent is a hard stop, because a text can't be unsent.
  - Ben said yes to texts, but he also told us \`(answered? channel email)\`. A stated preference wins, so his last call went by email, though sms is written first.
  - Dee said yes to texts, and a desk rule guessed she prefers email. An inferred preference never reorders anything, so hers went by sms, in the written order.
  - "Where people are" shows the channel each person last got, read from their delivery's \`:delivery/via\`, and why that channel, from the transaction.
- **The pitch opened a page.** \`p1\` is \`:via (and site email)\`, so it went both ways: an email, and a \`:person/access\` fact for \`small-tools/welcome\`, read from the content as it was when the send went out.
- **Teo waived Mara's alarm.** Mara wrote the bridge's sends, and a pitch right after a course has no teach sends before it, so she raised \`teach-before-fix\`. Nobody waives their own alarm, so Teo waived it, in his own words: the five days are the warmup.
- **Teo fixed a link mid-run.** The workspace link in \`p1\`'s email was broken, and Teo pointed it at a fixed body on 23 November. Ana, Ben and Cy had already got \`p1\`; Ivy and Dee got it after. **What they got** below prints each person's copy as of their delivery's content version, so Ana's still shows the broken body and Ivy's the fixed one. Click a name under Where people are to open theirs.
- **Cy bought and left.** \`exit-on\` wrote \`exited\`, so the successor, which listens for \`finished\`, never saw him. [Small Tools: get your first tool in use](/paths/small-tools-start/) enters on the same \`(bought? "small-tools")\` fact, so it picked him up. [dunn-bridge]
- **Eli passed the bridge.** He owns the library, so the guard skipped all four sends, and nothing went out. Reaching \`done\` with no sent delivery writes \`:path/passed\`, not \`:path/finished\`, so [Why didn't you buy?](/paths/why-didnt-you-buy/), which enters on \`(finished? "small-tools-bridge")\`, never asks him about a pitch he never got. A path that wants him can enter on \`(passed? "small-tools-bridge")\`.
- **Ana missed one send during a hold.** Her \`b1\` came due during Teo's hold and her bridge state ended first, so it was \`:send/missed\`. She still got \`p1\` to \`p3\`, so she finished. Only a person with no sent delivery at all passes.

## The target

The sale isn't the result. \`(target (and (bought? "small-tools") (did? "tool-in-use")) :within 1440h)\` is: someone bought it and their first tool runs.

- **Cy reached it after he left.** He bought on 23 November, and his first tool ran on 6 December. The target watches past \`exit-on\`, so the bridge gets the credit for a buyer it had already let go.
- **Ivy bought and missed.** She bought on 25 November and never got a tool running.
- **Ana, Ben and Dee finished but missed.** They saw the whole bridge and didn't buy.
- **Eli passed, and missed too.** His miss isn't the bridge failing: he never got the pitch.`,
    ["enters-on", "path event", "registry", "target"],
    ["hulick", "dunn-bridge", "pu", "rk"],
  ),
  pathPage(
    "spring-note",
    "A broadcast is a path with one state and one send, to everyone on the list.",
    "The spring note: the smallest path there is.",
    "note: spring-note on 2027-04-01\ntarget: did? shipped-tool, within 720h",
    `The smallest path there is: one state, one send, everyone on the list. When the send goes out, the state has sent its last message, so each person reaches \`done\`.

{{fig:workspace:spring-note}}

## Fresh evidence

The language's own example has no \`:since\`. Everyone joined the list before the note went live, so under the fresh-evidence rule nobody would get it. The seed adds \`:since\` so the example runs.^[This is in the notes at the end of the [language page](/language/), for the grill.] [pu]

## The target

Even a broadcast is measured on the reader's result: \`(target (did? "shipped-tool") :within 720h)\`.

- **Hal replied** on 8 April that he'd shipped his first tool. That's \`:source asked\`, so it counts.
- **Fay doesn't count.** On 10 April a desk rule guessed she'd shipped from her site activity. That's \`:source inferred\`, and an inferred act never satisfies \`did?\`.
- **Everyone else finished but missed.** One note, read, and no tool. That's a fair result for a note, and now it's a number.`,
    ["path", "send"],
    ["pu"],
  ),
  pathPage(
    "why-didnt-you-buy",
    "The successor subscribes to the bridge's finished event and asks one question a day later.",
    "Why didn't you buy: a one-question survey path that enters when someone finishes the bridge without buying.",
    "finished? small-tools-bridge\n  -> ask --24h--> w1 survey -> done\ntarget: did? shipped-tool, within 720h",
    `This path is how the bridge's hand-off works. The bridge doesn't name it. It enters on \`(finished? "small-tools-bridge")\`, and buyers never reach \`finished\`, so it only hears from people who didn't buy. [dunn-launch]

{{fig:workspace:why-didnt-you-buy}}

The \`post-close-survey\` check passes for the bridge because of this path: the check looks for any path that enters on the bridge finishing and has a survey send.

## The target

The survey isn't the target; the answers are ours to learn from. A non-buyer's result is still a shipped tool: \`(target (did? "shipped-tool") :within 720h)\`.

- **Ben reached it.** His reply to the one question said he'd shipped a tool.
- **Eli was never asked.** He passed the bridge, because nothing went out to him, and this path enters on \`finished?\`. He still shipped on 1 December; no path here claims it.
- **Ana missed, and the rule is why.** She shipped on 17 November, before she entered this path. Fresh means facts transacted after this person entered this path, so her old reply doesn't count here.^[It did count for [the course](/paths/five-day-tools/), which she was on at the time.] [pu]
- **Dee finished but missed.**`,
    ["enters-on", "check", "target"],
    ["dunn-launch", "pu"],
  ),
  pathPage(
    "small-tools-start",
    "Buyers leave the bridge, and this path helps them get their first tool running. Its sends are support, and its target is the bridge's target.",
    "Small Tools: get your first tool in use. Support sends for buyers, entered on the purchase, measured on the same result as the bridge.",
    "bought? small-tools\n  -> start  s1 1h site+email\n            s2 72h email\n            s3 168h email\n            every send :job support\n  exit-on did? tool-in-use -> exited\n  target: did? tool-in-use, within 1440h",
    `The bridge lets buyers go with \`exit-on\`, and names nobody to hand them to. This path enters on the same fact, \`(enters-on (bought? "small-tools"))\`, so it picks them up. Its sends are \`:job support\`, the after band, and \`support-to-buyers\` refuses a support send anywhere else. [dunn-bridge]

{{fig:workspace:small-tools-start}}

## The target

\`(target (did? "tool-in-use") :within 1440h)\` is the bridge's target, with the purchase already given. \`exit-on\` reads the same fact, so reaching it also stops the sends. [hulick]

- **Gus got there mid-path.** He bought on 5 December and his first tool ran on the 9th, before \`s3\`. \`exit-on\` stopped the last send, and the target recorded the win.
- **Cy got there after the path ended.** He had all three sends, reached \`done\`, and his tool ran on 6 December. The target watches after \`done\`.
- **Ivy finished but missed.** Three support notes, and no tool in use when her window closed in January.`,
    ["support", "target", "exit-on"],
    ["dunn-bridge", "hulick"],
  ),
  {
    slug: "/checks/",
    title: "Checks",
    description: `The check pack: ${SHAPE.length} shape refusals and ${DOCTRINE.length} doctrine checks, each a query that must come back empty.`,
    plain: "A check is a saved query that should come back empty. Shape and harm refuse, doctrine alarms, and every doctrine check cites its source.",
    group: "system",
    terms: ["check", "refusal", "alarm", "waiver"],
    sources: [...new Set(PACK.flatMap((p) => p.query.cites))],
    body: `Each check is written in halter's own Datalog and read by the same reader as the paths. A check selects by structure, never by kind: a send with \`:on\` is calendar timed, and a send with \`:after\` is relative. Every check has one planted violation in \`checks.test.ts\` that must fail.^[Run \`bun checks.test.ts\`. It also checks that every seed path has no refusals.]

A refusal blocks. An alarm doesn't; the author can ship past it, or waive it on the record with a quote. [hooks-process]

Nobody waives their own alarm, person or agent (\`no-self-waiver\`). A waiver is pending while its author wrote a fact the alarm points at, and anyone else can confirm it. Nobody wrote the facts behind \`uncertain-sends\` and \`people-on-old-version\`, so anyone can waive those. A waiver's why quotes its author's own words, or is \`:source inferred\` with a \`:rule\`. Refusals bind everyone.

${pack().md}

## Not built yet

${UNBUILT.map((u) => `### ${u.name}\n\n**${u.severity}**, doctrine, not built. ${u.why} [${u.cites}]${skillLink(u.name)}`).join("\n\n")}`,
  },
  {
    slug: "/facts/",
    title: "Facts, events and time",
    description: "The datom, the transaction, how we know, world and path events, and time as facts.",
    plain: "Everything is a fact in one log: edits, purchases, survey answers and everything the interpreter does, each with who, when, why and how we know.",
    diagram: "[entity attribute value tx added?]\n tx: who, at, why, source\n     (asked | observed | inferred | assumed)",
    group: "system",
    terms: ["fact", "transaction", "how we know", "world event", "path event", "as-of"],
    sources: ["hoy-safari", "dunn-rm", "pu", "rk"],
    body: `## The datom

A fact is \`[entity attribute value tx]\`, and a datom adds whether it was asserted or retracted. The schema is facts too: transaction 1 writes every attribute as \`:db/type\`, \`:db/card\` and \`:db/doc\`, so queries can join on it. The seed has ${db.log.length} transactions and ${hist.length} datoms.

## The transaction

A transaction groups facts and says who, when, why, and how we know. Here is Mara changing the bridge, printed the way the language prints transactions:

{{fig:tx:bridge-edit}}

That edit made a new version of the bridge for whoever entered next. Ana, Ben and Cy were already on it, so they kept three days of pitch until Mara moved them the next day. A move is an op in a transaction, and its why quotes a person:

{{fig:tx:bridge-move}}

An undo is a new transaction that flips the old one. History is never rewritten.

## How we know

Every transaction carries \`:tx/source\`. [hoy-safari] [dunn-rm] Inferred values never drive hard claims: that's the \`hard-from-inferred\` refusal.

{{fig:sources}}

{{fig:tx:survey}}

## Events

World events come from outside, through adapters. Path events are the transactions the interpreter writes as \`agent:halter\`: entered, at, sent, skipped, missed, finished, exited. Every path event also records \`:log/cursor\`, the last transaction handled, so a restart replays nothing. Here is one person's log, from the world event that started it to the subscription that fired at the end:

{{fig:personlog:ana}}

## Deliveries

Each delivery is its own entity, written in the same transaction as the \`:send/sent\` path event: one per person, send and channel. Ana's \`p1\` went \`:via (and site email)\`, so she has two. Here is the email one:

{{fig:delivery}}

\`:delivery/content\` is the content version: the last transaction that changed that message before it went out, the same rule as a path's version. Teo fixed a broken link in \`p1\`'s email in the middle of the run:

{{fig:tx:link-fix}}

Ana, Ben and Cy had already got \`p1\`, so their deliveries still read the copy with the broken link. Ivy and Dee got it after the fix. Each path page's **What they got** panel prints each delivery as of its content version, and \`got-broken-link\` below asks the log directly. The channel a send used is a fact now too: \`got-texts\` finds Dee's last call. A delivery the provider never confirms has \`:delivery/status uncertain\`, and \`uncertain-sends\` alarms on it. [pu]

## Time as facts

halter reads no clock.^[The runtime supplies now through Effect's Clock, and TestClock in a simulation. This page supplies it through the as-of slider on each path page.] A person's entry is the time of the transaction that made \`enters-on\` true. Calendar instants live in offers and \`:on\` sends. Windows are computed from opens, closes and now, never stored as expired. [rk]

## Saved queries

{{fig:queries}}`,
  },
  {
    slug: "/machine/",
    title: "The machine",
    description: "The bridge's Lisp beside the XState v6 machine generated from the same facts, and the fixed interpreter around it.",
    plain: "A fixed interpreter builds one XState v6 machine per path from its facts. Nobody edits the machine by hand.",
    group: "system",
    terms: ["registry", "interpreter"],
    sources: ["pu", "rk", "bc-gates"],
    body: `The machine is built from the data. Predicates are data, and work is code: the Lisp can only name words in the registry, and a new word is new reviewed code, not new data.

{{fig:machine}}

## The registry

{{fig:registry}}

The first infrastructure word would be something like \`(capture "join" :route "/join")\`, provisioned through an Alchemy resource. It isn't in 0.2.

## Fact events and lifecycle transactions

Each transaction becomes a \`fact\` event for the people it touches, and \`exit-on\` and \`(to … :when)\` are transitions on it. When an actor reaches a final state, the interpreter, not the machine, writes the lifecycle transaction. [pu]

{{fig:interpreter}}

Before live, a synthetic run of the same data on \`TestClock\` with fake people must reach its expected sends and leave a receipt as a fact. [bc-gates] The sketch doesn't run one; its interpreter is a plain loop that only makes the seed's path events.`,
  },
];

// /paths/: the campaigns hub (UPDATE-32 §2), one line each from the path pages themselves
const hub = (pages: ReadonlyArray<Page>): Page => ({
  slug: "/paths/",
  title: "Campaigns",
  description: `The ${PATHS.length} seed campaigns, each a path with a live workspace.`,
  plain: "Each campaign is a path people walk. Every page has the printed Lisp, a slider over the log, and an editor.",
  group: "paths",
  terms: ["path"],
  sources: [],
  body: `${PATHS.map((id) => {
    const pg = pages.find((x) => x.slug === `/paths/${id}/`);
    if (!pg) throw new Error(`the hub lists ${id}, which has no page`);
    return `- **[${pg.title}](${pg.slug})**: ${pg.plain}`;
  }).join("\n")}

{{fig:multiples}}`,
});
const PAGES: ReadonlyArray<Page> = (() => {
  const at = PAGES_BUT_HUB.findIndex((x) => x.slug.startsWith("/paths/"));
  return [...PAGES_BUT_HUB.slice(0, at), hub(PAGES_BUT_HUB), ...PAGES_BUT_HUB.slice(at)];
})();

// ---------- the glossary and bibliography pages, built from the others ----------
interface Built {
  readonly page: Page;
  readonly html: string;
  readonly cites: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<string>;
  readonly links: ReadonlySet<string>;
}
// rat.css site-links: groups of links joined by a dot, groups spaced apart
const NAV: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
  [
    ["/language/", "language"],
    ["/paths/", "campaigns"],
    ["/skills/", "skills"],
    ["/checks/", "checks"],
  ],
];
// The rest of the site, in the footer (UPDATE-32 §2)
const FOOT: ReadonlyArray<readonly [string, string]> = [
  ["/facts/", "facts"],
  ["/machine/", "machine"],
  ["/glossary/", "glossary"],
  ["/bibliography/", "bibliography"],
  ["/llms.txt", "agent guide"],
];

const build = (page: Page, bodyHtml?: string): Built => {
  const ctx = newCtx(page.slug, TERMS, figHtml, page.section);
  const html = bodyHtml ?? render(page.body, ctx);
  // cites: footnotes in the order the page cites them; sources: every source the page draws on
  return { page, html, cites: [...ctx.cites], sources: [...new Set([...ctx.cites, ...page.sources])], links: ctx.links };
};

const glossaryPage: Page = {
  slug: "/glossary/",
  title: "Glossary",
  description: "Every halter term, A to Z, with a plain definition and the page that teaches it.",
  plain: "The words halter uses, each in one or two plain sentences.",
  group: "reference",
  terms: [],
  sources: [],
  body: [...TERMS]
    .sort((a, b) => a.term.localeCompare(b.term))
    .map((t) => `- **${t.term}**: ${t.def} [More](${t.page})`)
    .join("\n"),
};
const glossaryHtml = `<dl class="glossary">${[...TERMS]
  .sort((a, b) => a.term.localeCompare(b.term))
  .map((t) => `<dt id="${t.slug}">${esc(t.term)}</dt><dd>${esc(t.def)} <a href="${t.page}">Taught on ${esc(PAGES.find((p) => p.slug === t.page)?.title ?? t.page)}</a>.</dd>`)
  .join("")}</dl>`;

// ---------- skills: one page per skill, built around its principle ----------
const checkSeverity = (id: string) => PACK.find((p) => p.query.name === id)?.query.severity ?? (UNBUILT.some((u) => u.name === id) ? "not built yet" : "");
const heldByMd = (sk: Skill) => sk.heldBy.map((c) => `- [\`${c}\`](/checks/#${c}), ${checkSeverity(c) === "refuse" ? "refuses" : checkSeverity(c) === "alarm" ? "alarms" : checkSeverity(c)}.`).join("\n");
const skillPage = (sk: Skill): Page => ({
  slug: sk.slug,
  title: sk.title,
  description: `${sk.principle} The ${sk.skill} skill, and the halter structure it produces.`,
  plain: sk.principle,
  group: "skills",
  parent: ["/skills/", "Skills"],
  subtitle: `<b>${esc(sk.skill)}</b>, a skill by Badass Courses. Footnotes credit where the idea comes from.`,
  terms: [],
  sources: sk.sources,
  head: [`principle: ${sk.principle}`, `skill: ${sk.skill} (Badass Courses)`, `builds: ${sk.builds.replace(/`/g, "")}`, `held-by: ${sk.heldBy.join(", ")}`, `sources: ${sk.sources.join(", ")}`].join("\n"),
  body: `## The idea

${sk.idea}

## Why it holds

${sk.why}

## How halter holds it

${sk.how} See [${path(sk.campaign).title}](/paths/${sk.campaign}/): ${sk.look}

## What an agent builds with this

What it produces in halter: ${sk.builds}.

{{fig:snippet:${sk.skill}}}

The checks that hold it:

${heldByMd(sk)}`,
});
const skillPages = SKILLS.map(skillPage);
const skillsIndex: Page = {
  slug: "/skills/",
  title: "Skills",
  description: "Thirteen skills, each built around one principle, and the halter structures an agent writes with it.",
  plain: "Skills give agents the principles. halter holds the structure.",
  group: "skills",
  terms: ["check"],
  sources: [],
  body: `An agent building a campaign loads a skill to learn what good looks like, then writes halter forms. Badass Courses wrote the skills; the ideas in them come from the people in the [Bibliography](/bibliography/). Each page here is built around one principle and explains it in our own prose, with footnotes to where the idea comes from. The skills repo is private, so the pages name each skill and don't link to it.

Each doctrine check on the [Checks](/checks/) page links back to the page that carries its principle, so an agent that trips one knows what to read next.

${SKILLS.map((sk) => `- [${sk.title}](${sk.slug}) *${sk.skill}*. Builds ${sk.builds}.`).join("\n")}`,
};

const built = [...PAGES.map((p) => build(p)), build(skillsIndex), ...skillPages.map((p) => build(p)), build(glossaryPage, glossaryHtml)];
// A skill page's footnotes must credit every source the Skills table names for it.
for (const b of built) {
  const sk = SKILLS.find((x) => x.slug === b.page.slug);
  const missing = sk?.sources.filter((k) => !b.cites.includes(k)) ?? [];
  if (missing.length) throw new Error(`${b.page.slug} never cites ${missing.join(", ")}`);
}
const citedOn = (key: string) => built.filter((b) => b.sources.includes(key));
const COLOPHON = "Styles based on ratstack.sh (MIT).";
const builtOn = (sk: Skill) => sk.sources.map((k) => BIB_BY_KEY.get(k)?.short ?? "").join("; ");
const bibPage: Page = {
  slug: "/bibliography/",
  title: "Bibliography",
  description: "Every source halter's ideas come from, grouped by creator, with the pages that cite each one.",
  plain: "halter's ideas come from the people below. Each entry names the idea, where it's published, and what halter takes from it.",
  group: "reference",
  terms: [],
  sources: [],
  body: `${GROUP_ORDER.map((g) => `## ${g}\n\n${BIB.filter((e) => e.group === g).map((e) => `- ${entryText(e)}`).join("\n")}`).join("\n\n")}\n\n## Skills\n\n${SKILLS.map((sk) => `- ${sk.skill}, Badass Courses: ${sk.title} (${sk.slug}). Builds on ${builtOn(sk)}.`).join("\n")}\n\n## Colophon\n\n${COLOPHON}`,
};
const bibHtml = `<p>On every page a citation is a numbered footnote, and the Sources list at the end of the page names the work. Each principle is a short line that names an idea, and its footnote credits where the idea comes from. Some lines are the creators' own phrases. A paid course links to its public page. Unpublished notes and course material with no public page say so and have no link.</p>${GROUP_ORDER.map(
  (g) =>
    `<h2 id="by-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">${esc(g)}</h2><ul class="bib">${BIB.filter((e) => e.group === g)
      .map(
        (e) =>
          `<li id="${e.key}">${entryHtml(e)}<br><span class="mute small">Cited on: ${
            citedOn(e.key)
              .map((b) => `<a href="${b.page.slug}">${esc(b.page.title)}</a>`)
              .join(", ") || "none yet"
          }</span></li>`,
      )
      .join("")}</ul>`,
).join("")}<h2 id="skills">Skills</h2><p>Badass Courses' skills carry these ideas into practice. Each has a page built around its principle. The skills repo is private, so the pages don't link to it.</p><ul class="bib">${SKILLS.map(
  (sk) =>
    `<li><a href="${sk.slug}">${esc(sk.title)}</a> <span class="mute">${esc(sk.skill)}, Badass Courses</span>. Builds on ${sk.sources
      .map((k) => `<a href="#${k}">${esc(BIB_BY_KEY.get(k)?.short ?? "")}</a>`)
      .join(", ")}.</li>`,
).join("")}</ul><h2 id="colophon">Colophon</h2><p>${COLOPHON.replace("ratstack.sh", '<a href="https://ratstack.sh/">ratstack.sh</a>')}</p>`;
const all = [...built, build(bibPage, bibHtml)];

// ---------- page shell ----------
const sourcesBlock = (b: Built) =>
  b.cites.length === 0
    ? ""
    : `<section class="bibliography" aria-labelledby="sources"><h2 id="sources">Sources</h2><ol>${b.cites
        .flatMap((k, i) => {
          const e = BIB_BY_KEY.get(k);
          return e ? [`<li id="source-${i + 1}">${entryHtml(e)} <a href="#cite-${i + 1}" aria-label="back to the first citation">&#8617;</a> <a href="/bibliography/#${k}" class="small">In the bibliography</a></li>`] : [];
        })
        .join("")}</ol></section>`;
const backlinks = (b: Built) => {
  const from = all.filter((x) => x !== b && x.links.has(b.page.slug));
  return from.length === 0
    ? ""
    : `<section class="linked-from" aria-labelledby="linked-from"><h2 id="linked-from">Linked from</h2><ol>${from
        .map((x) => `<li><a href="${x.page.slug}">${esc(x.page.title)}</a>. ${esc(x.page.description)}</li>`)
        .join("")}</ol></section>`;
};
// notes: sidenotes or margin notes, which use the margin from 761px. cites: citations, which use it from 1024px.
const mainClass = (html: string) => {
  const cls = [...(/class="(sidenote|marginnote)"/.test(html) ? ["notes"] : []), ...(/class="cite-note"/.test(html) ? ["cites"] : [])];
  return cls.length ? ` class="${cls.join(" ")}"` : "";
};
// <wbr> after / and : in inline code (never inside pre), so a long name can end a line instead of
// leaving a gap before it
const breakable = (html: string) =>
  html.replace(/(?<!<pre[^>]*>)<code>([^<]*)<\/code>/g, (_m, t: string) => `<code>${t.replace(/([/:])(?=[^\s/:])/g, "$1<wbr>")}</code>`);

const shell = (b: Built) => {
  const p = b.page;
  const home = p.slug === "/";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${home ? "halter: campaigns as paths, facts as the source of truth" : `${esc(p.title)} | halter`}</title>
<meta name="description" content="${esc(p.description)}"><meta name="robots" content="noindex">
<link rel="alternate" type="text/markdown" href="${p.slug}index.md"><link rel="stylesheet" href="/rat.css"><link rel="stylesheet" href="/halter.css">
</head><body>
<header><nav aria-label="Primary navigation" class="site-nav"><a class="brand" href="/"${home ? ' aria-current="page"' : ""}><strong>halter</strong></a><div class="site-links">${NAV.map(
    (group) => `<ul>${group.map(([href, label]) => `<li><a href="${href}"${href === p.slug ? ' aria-current="page"' : ""}>${label}</a></li>`).join("")}</ul>`,
  ).join("")}</div></nav></header>
<main data-path="${p.slug}"${mainClass(b.html)}>
<p class="status">${STATUS}</p>
${home ? "" : `<nav aria-label="Breadcrumb" class="breadcrumb"><a href="/">halter</a> / ${p.parent ? `<a href="${p.parent[0]}">${esc(p.parent[1])}</a> / ` : ""}<span class="here">${esc(p.title)}</span></nav>`}
<h1>${esc(p.title)}</h1>
${p.subtitle ? `<p class="subtitle">${p.subtitle}</p>` : ""}
${home ? "" : `<p class="plain">${esc(p.plain)}</p>`}
${p.diagram ? `<pre class="diagram" aria-label="diagram">${esc(p.diagram)}</pre>` : ""}
${breakable(stackTables(b.html))}
${sourcesBlock(b)}
${backlinks(b)}
</main>
<footer><nav aria-label="More" class="foot-links"><ul>${FOOT.map(([href, label]) => `<li><a href="${href}"${href === p.slug ? ' aria-current="page"' : ""}>${label}</a></li>`).join("")}</ul></nav><p>halter, a sketch. Fictional brand, people and data. <a href="${p.slug}index.md">This page as markdown</a>.</p></footer>
${p.script ? `<script src="/app.js" defer></script>` : ""}
</body></html>
`;
};

const yaml = (p: Page, cites: ReadonlyArray<string>) => {
  const q = JSON.stringify;
  const lines = [
    "---",
    `title: ${q(p.title)}`,
    `description: ${q(p.description)}`,
    `plain: ${q(p.plain)}`,
    ...(p.diagram ? ["diagram: |-", ...p.diagram.split("\n").map((l) => `  ${l}`)] : []),
    `group: ${p.group}`,
    `terms: [${p.terms.map((x) => q(x)).join(", ")}]`,
    "sources:",
    ...cites.flatMap((k) => {
      const e = BIB_BY_KEY.get(k);
      const url = e?.works.find((w) => w.url)?.url;
      return e ? [`  - title: ${q(e.works.map((w) => titleOf(e, w)).join(" and "))}`, ...(url ? [`    url: ${q(url)}`] : []), `    creators: ${q(e.creators)}`, `    note: ${q(e.takes)}`] : [];
    }),
    "---",
  ];
  return lines.join("\n");
};
const markdown = (b: Built) => {
  const p = b.page;
  // Citations become markdown footnotes, numbered in the order this page cites them.
  const { text, cites } = toMarkdown(p.body, figMd);
  const src = cites.length ? `\n\n## Sources\n\n${footnotesMd(cites)}` : "";
  const sub = p.subtitle ? `\n\n${p.subtitle.replace(/<[^>]+>/g, "")}` : "";
  return `${p.head ? `${p.head}\n\n` : ""}${yaml(p, b.sources)}\n\n# ${p.title}${sub}\n\n${p.plain}\n\n> ${STATUS}\n\n${text}${src}\n`;
};

// ---------- write ----------
rmSync(`${here}dist`, { recursive: true, force: true });
mkdirSync(`${here}dist`, { recursive: true });
execFileSync(`${here}node_modules/.bin/vite`, ["build"], { cwd: here, stdio: "inherit" });
writeFileSync(`${here}dist/app.js`, readFileSync(`${here}dist-client/app.js`));
for (const css of ["rat.css", "halter.css"]) writeFileSync(`${here}dist/${css}`, readFileSync(`${here}site/${css}`, "utf8"));
const mds: Array<string> = [];
for (const b of all) {
  const dir = `${here}dist${b.page.slug}`;
  mkdirSync(dir, { recursive: true });
  const html = shell(b);
  if (/\u2014/.test(html)) throw new Error(`em dash on ${b.page.slug}`);
  writeFileSync(`${dir}index.html`, html);
  const md = markdown(b);
  writeFileSync(`${dir}index.md`, md);
  mds.push(md);
}
const order = ["start", "language", "paths", "system", "reference"];
const llms = `# halter

> ${PAGES[0]?.plain ?? ""}

${STATUS}

Every page is also markdown at its path plus \`index.md\`.

## Skills: principles for building halter structures

Load a skill's page for why; write halter forms for the structure. Each line: the principle, the skill, the forms it builds, and the checks that hold it.

${SKILLS.map((sk) => `- [${sk.title}](${BASE}${sk.slug}index.md): ${sk.principle} Skill: ${sk.skill} (Badass Courses). Builds: ${sk.builds.replace(/`/g, "")}. Held by: ${sk.heldBy.join(", ")}.`).join("\n")}

${order
  .map((g) => {
    const ps = all.filter((b) => b.page.group === g);
    return `## ${g[0]?.toUpperCase()}${g.slice(1)}\n\n${ps.map((b) => `- [${b.page.title}](${BASE}${b.page.slug}index.md): ${b.page.description}`).join("\n")}`;
  })
  .join("\n\n")}

## Everything at once

- [llms-full.txt](${BASE}/llms-full.txt): every page's markdown in one response
`;
writeFileSync(`${here}dist/llms.txt`, llms);
writeFileSync(`${here}dist/llms-full.txt`, mds.join("\n\n"));
const size = (f: string) => `${(readFileSync(`${here}dist/${f}`).length / 1024).toFixed(1)} KiB`;
// Embodied, not copied: a skill page that shares a 12-word run with its skill fails the build.
execFileSync("bun", [`${here}gate.ts`], { stdio: "inherit" });
console.log(`${all.length} pages; app.js ${size("app.js")}; llms-full.txt ${size("llms-full.txt")}`);
void kw;
