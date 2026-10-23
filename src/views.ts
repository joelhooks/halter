// Pure HTML views over the db, for the pages and for the workspace program's read-only panels.
import { asOf, ATTRS, dateMs, facts, history, transact, type Db, type Transacted, type Tx } from "./db.ts";
import { judge, quotes, refusalKeys, verdict, type Finding, type Verdict } from "./checks.ts";
import { esc, highlight, numbered } from "./hl.ts";
import { allSends, band, fromFacts, type Path } from "./model.ts";
import { duration, printPath } from "./printer.ts";
import { messagesFrom, printContent, printMessage, type Message } from "./content.ts";
import { feedOf } from "./feed.ts";
import { currentVersion } from "./version.ts";
import { onVersions, parseVersion, versionsOf } from "./version.ts";
import { nameOf, outcomesOn, kwName } from "./time.ts";

export const H = 3_600_000;
const q = JSON.stringify;

// The printout as of t, with the waiver whys as comments.
export const waiverNotes = (c: string, d: Db): Map<string, string> => {
  const out = new Map<string, string>();
  for (const tx of d.log) for (const x of tx.datoms) if (x.e === c && x.a === "path/waives" && x.added) out.set(String(x.v), `${tx.who}, t=${tx.t}: ${tx.why}`);
  return out;
};
// Waivers whose author raised the alarm, from a verdict's findings: check -> author (D36).
export const pendingWaivers = (v: Verdict): Map<string, string> =>
  new Map(v.findings.flatMap((f) => (f.waived !== undefined && f.waived !== "staged" && f.waived.pending ? [[f.check, f.waived.pending] as const] : [])));
export interface View {
  readonly t: number;
  readonly db: Db;
  readonly path: Path | undefined;
  readonly text: string;
  // the content file for the messages this path names, as of t
  readonly content: string;
  readonly verdict: Verdict | undefined;
}
// Message ids a path names: each send's own, and every message its vary can pick.
export const messageIds = (p: Path): Array<string> => [
  ...new Set(allSends(p).flatMap((s) => [s.key, ...(s.vary?.cases.map((c) => c.message) ?? []), ...(s.vary?.else === undefined ? [] : [s.vary.else])])),
];
// What the commit that made a version answers for: the refusals it added (D40).
const atCommit = new WeakMap<Db, Map<string, ReadonlySet<string>>>();
const commitBaseline = (db: Db, id: string, d: Db): ReadonlySet<string> => {
  const ver = currentVersion(history(d), id);
  if (ver === undefined) return new Set();
  const m = atCommit.get(db) ?? new Map<string, ReadonlySet<string>>();
  atCommit.set(db, m);
  const hit = m.get(`${id}@${ver}`);
  if (hit) return hit;
  // the refusals that commit added: there after it, not in the transaction before it (D40). Anything else
  // came from an earlier commit or from the world, and is true at run.
  const at = (t: number) => {
    const d0 = asOf(db, t);
    const p0 = fromFacts(id, facts(d0));
    return p0 ? refusalKeys(verdict(printPath(p0), { facts: facts(d0), history: history(d0) })) : new Set<string>();
  };
  const before = at(ver - 1);
  const keys = new Set([...at(ver)].filter((k) => !before.has(k)));
  m.set(`${id}@${ver}`, keys);
  return keys;
};
export const viewAt = (db: Db, id: string, t: number): View => {
  const d = asOf(db, t);
  const f = facts(d);
  const path = fromFacts(id, f);
  const tx = d.log.at(-1);
  // The verdict first: whether a waiver is pending depends on who raised the alarm. Its comment goes on
  // the waiver's own line, so the line numbers hold.
  const header = `print(asOf(db, t=${t}))  ${tx?.at ?? ""}`;
  const first = path ? verdict(printPath(path, { header, waivers: waiverNotes(id, d) }), { facts: f, history: history(d) }) : undefined;
  const pending = first ? pendingWaivers(first) : new Map<string, string>();
  const text = path && first
    ? printPath(path, { header, waivers: waiverNotes(id, d), pending })
    : `; ${id} has no facts yet at t=${t}.\n; Drag the slider to the right.\n`;
  // a pending note that doesn't fit beside its waiver prints on its own line above it, so the findings'
  // line numbers are read again from the text as shown
  const raw = path && pending.size > 0 ? verdict(text, { facts: f, history: history(d) }) : first;
  // a refusal the world raised after this version was committed doesn't refuse the page: it's true at run
  const v = raw ? judge(raw, commitBaseline(db, id, d), "page") : undefined;
  const ids = path ? messageIds(path) : [];
  const have = messagesFrom(f).filter((m) => ids.includes(m.id));
  const missing = ids.filter((i) => !have.some((m) => m.id === i));
  const content = path
    ? `; content(asOf(db, t=${t}))  ${tx?.at ?? ""}\n; read at delivery: an edit reaches whoever has not had it yet\n${have.length ? printContent(have) : ""}${missing.map((m) => `; no message "${m}" yet\n`).join("")}`
    : `; ${id} names no messages yet at t=${t}.\n`;
  return { t, db: d, path, text, content, verdict: v };
};

export const marksOf = (v: Verdict | undefined) => {
  const m = new Map<number, string>();
  for (const f of v?.findings ?? []) {
    if (f.waived !== undefined && f.waived !== "staged" && f.waived.counts) continue;
    // a finding on an older version points at that version's printout, not this one
    if (f.version !== undefined) continue;
    // a refusal that doesn't refuse (true at run, or already there) marks its line as an alarm does
    const sev = f.severity === "refuse" && f.standing !== undefined ? "alarm" : f.severity;
    if (m.get(f.line) !== "refuse") m.set(f.line, sev);
  }
  return m;
};
export const printoutHtml = (text: string, v: Verdict | undefined) => `<pre class="code lisp numbered">${numbered(text, marksOf(v))}</pre>`;
// The Printout tab shows one of the two files: structure (the path) or content (its messages).
export type FileView = "structure" | "content";
export const fileHtml = (v: View, file: FileView) => (file === "content" ? `<pre class="code lisp numbered content-file">${numbered(v.content)}</pre>` : printoutHtml(v.text, v.verdict));

// Someone else confirms a pending waiver by asserting it again in their own transaction (D36). The why
// is exactly what they typed: the editor never writes a quote for anyone, so no quote means no transaction.
// Whoever raised the alarm can't confirm it at all.
export const NEEDS_WORDS = "Confirming needs your own words, in quotes.";
export const SELF_WAIVE = "You raised this alarm, so someone else must waive it.";
export const confirmWaiver = (
  db: Db,
  x: { readonly id: string; readonly check: string; readonly who: string; readonly why: string; readonly at: string; readonly raisedBy?: ReadonlyArray<string> },
): Transacted =>
  x.raisedBy?.includes(x.who)
    ? { ok: false, error: `refused: ${SELF_WAIVE}` }
    : quotes(x.why)
      ? transact(db, { who: x.who, at: x.at, why: x.why, source: "assumed", ops: [{ e: x.id, a: "path/waives", v: x.check, added: true }] })
      : { ok: false, error: `refused: ${NEEDS_WORDS}` };
// Where a path's sends fall: by offset from entry for :after, by instant for :on.
interface Mark {
  readonly key: string;
  readonly job: string;
  readonly x: number;
}
export const layout = (m: Path): { marks: Array<Mark>; states: Array<{ name: string; x: number }>; events: Array<{ name: string; x: number }>; span: string } => {
  const sends = allSends(m);
  const calendar = sends.some((s) => s.on !== undefined);
  if (calendar) {
    const times = sends.flatMap((s) => (s.on ? [dateMs(s.on) ?? 0] : []));
    const ev: Array<[string, string | undefined]> = [
      ["opens", m.offer?.opens],
      ["early-bird", m.offer?.earlyBird],
      ["close", m.offer?.closes],
      ["class", m.offer?.classStarts],
    ];
    const all = [...times, ...ev.flatMap(([, v]) => (v ? [dateMs(v) ?? 0] : []))];
    const lo = Math.min(...all);
    const hi = Math.max(...all, lo + H);
    const x = (ms: number) => (ms - lo) / (hi - lo);
    return {
      marks: sends.flatMap((s) => (s.on ? [{ key: s.key, job: s.job ?? "", x: x(dateMs(s.on) ?? lo) }] : [])),
      states: [],
      events: ev.flatMap(([name, v]) => (v ? [{ name, x: x(dateMs(v) ?? lo) }] : [])),
      span: `${new Date(lo).toISOString().slice(0, 10)} to ${new Date(hi).toISOString().slice(0, 10)}`,
    };
  }
  let start = 0;
  const marks: Array<Mark> = [];
  const states: Array<{ name: string; x: number }> = [];
  for (const st of m.states) {
    states.push({ name: st.name, x: start });
    for (const s of st.sends) marks.push({ key: s.key, job: s.job ?? "", x: start + (s.after ?? 0) });
    const len = Math.max(...st.tos.flatMap((t) => (t.after === undefined ? [] : [t.after])), ...st.sends.map((s) => (s.after ?? 0) + H), H);
    start += len;
  }
  const total = Math.max(start, H);
  return {
    marks: marks.map((k) => ({ ...k, x: k.x / total })),
    states: states.map((s) => ({ ...s, x: s.x / total })),
    events: [],
    span: `${duration(total)} from entry`,
  };
};

// The arc strip: one block per send, coloured by its P-D-F band, with tiny counts of what happened.
export const arcStrip = (m: Path, counts?: ReadonlyMap<string, { sent: number; skipped: number }>, small = false, W = 600): string => {
  const pad = 14;
  const L = layout(m);
  const X = (x: number) => pad + x * (W - 2 * pad);
  const max = Math.max(1, ...[...(counts?.values() ?? [])].map((c) => c.sent + c.skipped));
  const h = small ? 40 : counts ? 74 : 54;
  const parts: Array<string> = [];
  parts.push(`<line x1="${pad}" x2="${W - pad}" y1="26" y2="26" class="axis"/>`);
  for (const s of L.states) parts.push(`<line x1="${X(s.x)}" x2="${X(s.x)}" y1="8" y2="34" class="tick"/><text x="${X(s.x) + 2}" y="9" class="lab">${esc(s.name)}</text>`);
  for (const e of L.events) parts.push(`<line x1="${X(e.x)}" x2="${X(e.x)}" y1="14" y2="38" class="tick ev"/><text x="${X(e.x) + 2}" y="${small ? 39 : 46}" class="lab ev">${small ? "" : esc(e.name)}</text>`);
  for (const k of L.marks) {
    const x = X(k.x);
    parts.push(`<rect x="${x - 4}" y="18" width="8" height="16" rx="1.5" class="b-${band(k.job)}"><title>${esc(k.key)}: ${esc(k.job)}</title></rect>`);
    if (!small) parts.push(`<text x="${x}" y="15" class="key">${esc(k.key)}</text>`);
    const c = counts?.get(k.key);
    if (c && !small) {
      const sh = (c.sent / max) * 16;
      const kh = (c.skipped / max) * 16;
      parts.push(`<rect x="${x - 3}" y="${72 - sh}" width="3" height="${sh}" class="spark sent"><title>${c.sent} sent</title></rect>`);
      parts.push(`<rect x="${x + 1}" y="${72 - kh}" width="3" height="${kh}" class="spark skipped"><title>${c.skipped} skipped</title></rect>`);
    }
  }
  return `<svg class="arc${small ? " small" : ""}" viewBox="0 0 ${W} ${h}" role="img" aria-label="Arc strip for ${esc(m.id)}">${parts.join("")}</svg>`;
};
export const legend = () =>
  `<p class="legend"><span class="sw b-pain"></span>pain: teach, pain <span class="sw b-dream"></span>dream: dream, announce-pitch <span class="sw b-fix"></span>fix: fix, proof, faq, urgency, last-call <span class="sw b-after"></span>after: survey <span class="sw spark sent"></span>sent <span class="sw spark skipped"></span>skipped</p>`;

// Four numbers side by side: entered, finished, passed, reached target. The slider moves them.
export const outcomesHtml = (db: Db, id: string): string => {
  const name = nameOf(db);
  const o = outcomesOn(db, id);
  const names = (xs: ReadonlyArray<string>) => xs.map(name).join(", ");
  const finishedMissed = o.finished.filter((p) => o.missed.includes(p));
  const exitedReached = o.exited.filter((p) => o.reached.includes(p));
  const watching = o.entered.filter((p) => !o.reached.includes(p) && !o.missed.includes(p));
  const num = (n: number, label: string, cls: string) => `<div class="num ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const notes = [
    finishedMissed.length ? `<li class="honest"><b>Finished but missed: ${finishedMissed.length}</b> (${esc(names(finishedMissed))}). The honest failure: the path ran to the end and the person didn't get the result.</li>` : "",
    exitedReached.length ? `<li>Exited, then reached: ${esc(names(exitedReached))}. The target is watched after exit-on.</li>` : "",
    o.missed.some((p) => o.exited.includes(p)) ? `<li>Missed after exiting: ${esc(names(o.missed.filter((p) => o.exited.includes(p))))}.</li>` : "",
    o.passed.length ? `<li>Passed: ${esc(names(o.passed))}. They reached done and nothing went out, so successors on finished? never see them.</li>` : "",
    watching.length ? `<li class="mute">Still watching: ${esc(names(watching))}.</li>` : "",
  ].join("");
  return `<div class="outcomes" aria-label="Outcomes on ${esc(id)}">${num(o.entered.length, "entered", "")}${num(o.finished.length, "finished", "")}${num(o.passed.length, "passed", "passed")}${num(o.reached.length, "reached target", "reached")}</div>${notes ? `<ul class="outcome-notes">${notes}</ul>` : ""}`;
};

export const txLine = (tx: Tx) =>
  `<b>t=${tx.t}</b> <span class="mute">${esc(tx.at)}</span> ${esc(tx.who)} <span class="src src-${tx.source}">${tx.source}${tx.rule ? `, rule ${esc(tx.rule)}` : ""}</span><br>${esc(tx.why)}${tx.datoms
    .filter((d) => d.a === "tx/move")
    .map((d) => `<br><code class="move">${esc(String(d.v))}</code>`)
    .join("")}`;

// On each version (D32): every version of the path as of t, the transaction that made it, and who runs it.
// A table that stacks into labelled rows on a phone: each td gets its column's th as data-label,
// and the table the class stack. Tables that already have it are left alone.
export const stackTables = (html: string): string =>
  html.replace(/<table(\s[^>]*)?>([\s\S]*?)<\/table>/g, (whole, attrs: string | undefined, inner: string) => {
    if (/\bdata-label=/.test(inner) || /class="[^"]*\bstack\b/.test(attrs ?? "")) return whole;
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(inner)?.[1] ?? "";
    const labels = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => (m[1] ?? "").replace(/<[^>]*>/g, "").replace(/"/g, "&quot;").trim());
    // three columns or fewer read fine as a table on a phone; wider ones stack (UPDATE-32 §2)
    if (labels.length <= 3) return whole;
    const body = inner.replace(/<tr(\s[^>]*)?>([\s\S]*?)<\/tr>/g, (row, rowAttrs: string | undefined, cells: string) => {
      if (/<th\b/.test(cells)) return row;
      let col = 0;
      const labelled = cells.replace(/<td(\s[^>]*)?>/g, (_m, tdAttrs: string | undefined) => {
        const a = tdAttrs ?? "";
        const label = labels[col] ?? "";
        col += Number(/colspan="(\d+)"/.exec(a)?.[1] ?? 1);
        return `<td${a} data-label="${label}">`;
      });
      return `<tr${rowAttrs ?? ""}>${labelled}</tr>`;
    });
    const a = attrs ?? "";
    const cls = /class="/.test(a) ? a.replace(/class="/, 'class="stack ') : `${a} class="stack"`;
    return `<table${cls}>${body}</table>`;
  });

export const versionsHtml = (db: Db, id: string): string => {
  const h = history(db);
  const vs = versionsOf(h, id);
  if (vs.length === 0) return `<p class="mute">${esc(id)} has no versions yet. Drag the slider to the right.</p>`;
  const fs = facts(db);
  const on = onVersions(fs, id);
  const name = nameOf(db);
  const ran = new Map<number, Set<string>>();
  for (const d of h) if (d.a === "path/version" && d.added && parseVersion(String(d.v))?.path === id) ran.set(parseVersion(String(d.v))?.v ?? 0, new Set([...(ran.get(parseVersion(String(d.v))?.v ?? 0) ?? []), String(d.e)]));
  const rows = vs.map((v, i) => {
    const tx = db.log.find((x) => x.t === v);
    const now = on.get(v) ?? [];
    return `<tr${i === vs.length - 1 ? ` class="current"` : ""}><td class="num">${v}${i === vs.length - 1 ? " <span class=\"mute\">current</span>" : ""}</td><td><span class="num">${now.length}</span>${now.length ? `<br><span class="mute small">${esc(now.map(name).join(", "))}</span>` : ""}</td><td class="num">${ran.get(v)?.size ?? 0}</td><td><span class="mute small">${esc(tx?.at ?? "")} ${esc(tx?.who ?? "")}</span><br>${esc(tx?.why ?? "")}</td></tr>`;
  });
  return `<div class="table-wrap"><table class="versions"><thead><tr><th>version</th><th>on it now</th><th>ever ran it</th><th>made by</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
};

// What they got (D33): each person's deliveries on this path as of the slider, each printed as of its
// content version, so the copy shown is the copy that went out.
export const gotAnchor = (id: string, person: string) => `got-${id}-${person.replace(/^person\//, "")}`;
const copyAt = new WeakMap<Db, Map<number, ReadonlyArray<Message>>>();
const messagesAt = (db: Db, t: number): ReadonlyArray<Message> => {
  const m = copyAt.get(db) ?? new Map<number, ReadonlyArray<Message>>();
  copyAt.set(db, m);
  const hit = m.get(t) ?? messagesFrom(facts(asOf(db, t)));
  m.set(t, hit);
  return hit;
};
export const deliveryCopy = (db: Db, message: string, via: string, content: number): string => {
  const m = messagesAt(db, content).find((x) => x.id === message);
  if (!m) return `; ${message} isn't in the content as of t=${content}`;
  const only: Message = { id: m.id, ...(via === "email" && m.email ? { email: m.email } : {}), ...(via === "sms" && m.sms ? { sms: m.sms } : {}), ...(via === "site" && m.site ? { site: m.site } : {}) };
  return printMessage(only);
};
export const valText = (a: string, v: unknown) =>
  typeof v === "number" && ATTRS.get(a)?.type === "duration" ? duration(v) : typeof v === "string" ? q(v) : kwName(v);
// Since you last looked (D37), for Mara: agent transactions on this path after her cursor, as of the
// slider. A report, not a queue: nothing waits on it, and there's no approve or reject.
const liveAlarms = (d: Db, id: string): Map<string, Finding> => {
  const f = facts(d);
  const p = fromFacts(id, f);
  if (!p) return new Map();
  const v = verdict(printPath(p), { facts: f, history: history(d) });
  return new Map(v.findings.filter((x) => x.severity === "alarm" && !(x.waived !== undefined && x.waived !== "staged" && x.waived.counts)).map((x) => [x.check, x]));
};
const changes = (before: Map<string, Finding>, after: Map<string, Finding>) => [
  ...[...after.keys()].filter((k) => !before.has(k)).map((k) => `${k} on`),
  ...[...before.keys()].filter((k) => !after.has(k)).map((k) => `${k} off`),
];
export interface FeedRow {
  readonly t: number;
  readonly who: string;
  readonly what: string;
  readonly turned: ReadonlyArray<string>;
  readonly ruleOrWhy: string;
  readonly marks: ReadonlyArray<string>;
}
export interface Feed {
  readonly who: string;
  readonly cursor: number | undefined;
  readonly rows: ReadonlyArray<FeedRow>;
  readonly net: ReadonlyArray<string>;
}
export const feedData = (db: Db, id: string, who = "mara"): Feed => {
  const { cursor, txs } = feedOf(db, id, who);
  const rows = txs.map((tx): FeedRow => {
    const at = asOf(db, tx.t);
    const what: Array<string> = [];
    const marks: Array<string> = [];
    for (const m of tx.datoms.filter((x) => x.a === "tx/move")) if (String(m.v).startsWith(`(move ${JSON.stringify(id)}`)) what.push(`move to version ${currentVersion(history(at), id) ?? "?"}`);
    const alarms = liveAlarms(at, id);
    for (const w of tx.datoms.filter((x) => x.e === id && x.a === "path/waives" && x.added)) {
      what.push(`waive ${String(w.v)}`);
      const f = viewAt(db, id, tx.t).verdict?.findings.find((x) => x.check === w.v);
      const ws = f?.waived;
      if (ws !== undefined && ws !== "staged") {
        if (ws.pending) marks.push("pending: raised it");
        else if (ws.counts && (f?.raisedBy ?? []).length > 0 && (f?.raisedBy ?? []).every((r) => r.startsWith("agent:")) && ws.who.startsWith("agent:")) marks.push("counts · agent waived an agent's alarm");
        else if (ws.counts) marks.push("counts");
      }
    }
    for (const h of tx.datoms.filter((x) => x.e === id && x.a === "path/hold-until")) what.push(h.added ? `hold until ${String(h.v)}` : "hold dropped");
    const struct = tx.datoms.filter((x) => (x.e === id || String(x.e).startsWith(`${id}/`)) && x.a !== "path/waives" && x.a !== "path/hold-until" && !x.a.startsWith("tx/"));
    if (struct.length && !what.some((x) => x.startsWith("move"))) what.push(`structure, ${struct.length} ${struct.length === 1 ? "datom" : "datoms"}`);
    // a refusal at run: who it stopped, which send, and what went out instead (D40)
    for (const r of tx.datoms.filter((x) => x.a === "refusal/send" && x.added && String(x.v).startsWith(`${id}/`))) {
      const get = (a: string) => tx.datoms.find((x) => x.e === r.e && x.a === a)?.v;
      const person = String(get("refusal/person") ?? "");
      const first = String(facts(at).find((f) => f.e === person && f.a === "person/name")?.v ?? person).split(" ")[0];
      what.push(`refused at run: ${String(get("refusal/check"))}, ${first}'s ${String(get("refusal/key"))} ${kwName(get("refusal/outcome")) === "else" ? "got its else" : "was skipped"}`);
    }
    const msgs = [...new Set(tx.datoms.filter((x) => String(x.e).startsWith("message/")).map((x) => String(x.e).split("/")[1]))];
    if (msgs.length) what.push(`content: ${msgs.join(", ")}`);
    // a move's alarms are judged after the interpreter's rebase, not in the one transaction before it
    const rebase = db.log.find((x) => x.t > tx.t && x.who === "agent:halter" && x.why.startsWith(`${id}: moved by t=${tx.t},`));
    const turned = changes(liveAlarms(asOf(db, tx.t - 1), id), rebase ? liveAlarms(asOf(db, rebase.t), id) : alarms);
    return { t: tx.t, who: tx.who, what: what.join("; ") || "touched the path", turned, ruleOrWhy: tx.rule ? `rule ${tx.rule}` : tx.why, marks };
  });
  return { who, cursor, rows, net: cursor === undefined && rows.length === 0 ? [] : changes(liveAlarms(asOf(db, cursor ?? 0), id), liveAlarms(db, id)) };
};

// The figure the bridge page puts in its margin: who subscribes to whom, from enters-on.
export const SUCCESSORS = `(query "successors"
  :doc "Who reacts to a path's events. Read from each path's enters-on; no path names its successor."
  :find (?q ?pred ?p)
  :where ((?q :path/enters-on ?e) (?e :pred/name ?pred)
          (in? ?pred finished? exited? reached? reached-target? missed-target?) (?e :pred/arg ?p)))`;

// A path's exit-on is a fact, not an event; a path that enters on the same fact picks those people up.
export const PICKUPS = `(query "pick-ups"
  :doc "Who enters on the fact a path exits on. No path names the other; they read the same fact."
  :find (?q ?pred ?arg)
  :where ((?c :path/exit-on ?x) (?x :pred/name ?pred) (?x :pred/arg ?arg)
          (?q :path/enters-on ?e) (?e :pred/name ?pred) (?e :pred/arg ?arg) (!= ?q ?c)))`;

export const chainSvg = (from: string, rows: ReadonlyArray<{ q: string; pred: string }>, exitOn: string | undefined, pickups: ReadonlyArray<string> = []): string => {
  const lines: Array<string> = [];
  const W = 260;
  let y = 18;
  lines.push(`<text x="4" y="${y}" class="node">${esc(from)}</text>`);
  const branch = (label: string, to: string, dead: boolean) => {
    y += 30;
    lines.push(`<path d="M12 ${y - 24} V${y - 4} H24" class="edge${dead ? " dead" : ""}"/>`);
    lines.push(`<text x="28" y="${y - 6}" class="elab">${esc(label)}</text>`);
    lines.push(`<text x="28" y="${y + 8}" class="node${dead ? " dead" : ""}">${esc(to)}</text>`);
    y += 10;
  };
  for (const r of rows) branch(`(${r.pred.replace(/\?$/, "")})`, `→ ${r.q}`, false);
  if (exitOn) {
    if (pickups.length === 0) branch(`(exited on ${exitOn})`, "→ nothing subscribes", true);
    for (const q of pickups) branch(`(exit-on ${exitOn}) = (enters-on ${exitOn})`, `→ ${q}`, false);
  }
  return `<svg class="chain" viewBox="0 0 ${W} ${y + 6}" role="img" aria-label="Paths that react to ${esc(from)}">${lines.join("")}</svg>`;
};

export const lispHtml = (src: string) => `<pre class="code lisp"><code>${highlight(src.replace(/\n$/, ""))}</code></pre>`;
