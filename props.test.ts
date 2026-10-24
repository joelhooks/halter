// Property tests for halter v2. Run: node props.test.ts
// The printing laws from LANGUAGE.md: read(print(facts)) = facts, and print(read(text)) = text for canonical text.
import { deepStrictEqual, ok } from "node:assert/strict";
import fc from "fast-check";
import { PACK, verdict } from "./src/checks.ts";
import { asOf, basis, dateMs, diff, empty, moveText, type Move, facts, history, replay, sortTriples, transact, tripleKey, type Db, Kw, type Op, type Triple, type TxInput } from "./src/db.ts";
import { readMove, readPath } from "./src/extract.ts";
import { ATOMS, CHANNELS, EVENTS, fromFacts, JOBS, owned, toFacts, type GuardClause, type Path, type Pred, type Send, type State, type To, type Via } from "./src/model.ts";
import { contentFacts, messagesFrom, printContent, readContent, type Message } from "./src/content.ts";
import { printPath } from "./src/printer.ts";
import { deliveryQueries, SAVED_QUERIES } from "./src/queries.ts";
import { deliveriesOf } from "./src/delivery.ts";
import { feedOf } from "./src/feed.ts";
import { parseQuery, run } from "./src/query.ts";
import { AUTHORED, HORIZON, PATHS, seedDb } from "./src/seed.ts";
import { interpret, replyOps } from "./src/run.ts";
import { parseVersion } from "./src/version.ts";
import { kwName } from "./src/time.ts";

const H = 3_600_000;
const keys = (ts: ReadonlyArray<Triple>) => sortTriples(ts).map(tripleKey);
let count = 0;
// ONLY=words runs the properties whose name has them; RUNS=n raises a property's run count.
// Node's deepStrictEqual compares prototypes, and fast-check can build records with a null prototype.
// Every record here is a plain object, so a round trip compares like with like.
const record = <T>(model: { [K in keyof T]: fc.Arbitrary<T[K]> }) => fc.record(model, { noNullPrototype: true });
const prop = (name: string, f: () => void) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  f();
  count++;
  console.log(`ok ${count} ${name} (${Date.now() - t0}ms)`);
};

// ---------- arbitraries ----------
const word = fc.constantFrom("vip", "bought:library", 'a "quoted" tag', "gmail.com", "", "ünïcode", "line\nbreak", "small-tools");
const slug = fc.constantFrom("role", "pitch", "fernhill-news", "small-tools", "a1", "warm-2", "x");
const dur = fc.oneof(fc.integer({ min: 0, max: 400 }).map((h) => h * H), fc.integer({ min: 1, max: 600 }).map((m) => m * 60_000));
const instant = fc.integer({ min: 0, max: 60 * 24 * 365 }).map((m) => `${new Date(Date.UTC(2027, 0, 1) + m * 60_000).toISOString().slice(0, 16)}Z`);
const maybe = <T,>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });
const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const atom: fc.Arbitrary<Pred> = fc.constantFrom(...(Object.keys(ATOMS) as Array<keyof typeof ATOMS>)).chain((name) => {
  const spec: ReadonlyArray<string> = ATOMS[name].args;
  const arg = (k: string | undefined) => (k === undefined ? fc.constant(undefined) : k.startsWith("str") ? word : k === "dur" ? fc.constant(undefined) : k.endsWith("?") ? maybe(slug) : slug);
  return fc
    .record({ arg: arg(spec[0]), arg2: arg(spec[1]), within: spec.includes("dur") ? dur : fc.constant(undefined) })
    .map((r) => strip({ name, arg: r.arg, arg2: r.arg2, within: r.within }) as Pred);
});
const pred: fc.Arbitrary<Pred> = fc.letrec<{ p: Pred }>((tie) => ({
  p: fc.oneof(
    { weight: 4, arbitrary: atom },
    { weight: 1, arbitrary: record({ name: fc.constantFrom("and" as const, "or" as const), kids: fc.array(tie("p"), { minLength: 1, maxLength: 3 }) }) },
    { weight: 1, arbitrary: tie("p").map((k): Pred => ({ name: "not", kids: [k] })) },
  ),
})).p;

const via: fc.Arbitrary<Via> = fc.oneof(
  fc.constantFrom(...CHANNELS).map((c): Via => ({ channels: [c] })),
  record({ op: fc.constantFrom("or" as const, "and" as const), channels: fc.shuffledSubarray([...CHANNELS], { minLength: 2 }) }),
);
const sendKey = fc.constantFrom("01", "02", "b1", "p1", "p2", "w1");
const send = (key: string): fc.Arbitrary<Send> =>
  fc
    .record({
      timing: fc.oneof(dur.map((after) => ({ after })), instant.map((on) => ({ on }))),
      // an unknown job still round-trips; refusing it is the check's job, not the reader's
      job: maybe(fc.constantFrom(...JOBS, "nudge")),
      via,
      deadline: maybe(fc.constantFrom(...EVENTS, "soon")),
      vary: maybe(
        record({
          dim: slug,
          hard: fc.boolean(),
          cases: fc.uniqueArray(record({ value: fc.constantFrom("podcaster", "writer", "unknown", "x"), message: word }), { maxLength: 3, selector: (c) => c.value }),
          else: maybe(word),
        }),
      ),
    })
    .map((r) => strip({ key, ...r.timing, job: r.job, via: r.via, deadline: r.deadline, vary: r.vary ? (strip(r.vary) as Send["vary"]) : undefined }) as Send);

const path: fc.Arbitrary<Path> = fc
  .record({
    id: fc.constantFrom(...PATHS),
    title: word,
    list: slug,
    offer: maybe(
      record({
        product: slug,
        pricing: word,
        window: fc.oneof(fc.constant({}), slug.map((windowState) => ({ windowState })), record({ opens: maybe(instant), closes: maybe(instant) }).map((w) => strip(w))),
        earlyBird: maybe(instant),
        classStarts: maybe(instant),
      }),
    ),
    entersOn: maybe(pred),
    since: maybe(instant),
    holds: fc.uniqueArray(instant, { maxLength: 2 }),
    names: fc.uniqueArray(fc.constantFrom("bridge", "pitch", "note", "ask", "warm-2"), { minLength: 1, maxLength: 3 }),
    keys: fc.shuffledSubarray(["01", "02", "b1", "p1", "p2", "w1"], { minLength: 1 }),
    exitOn: maybe(pred),
    target: maybe(record({ pred, within: maybe(dur) })),
    guard: fc.array(
      record({ when: pred, skip: fc.boolean(), reason: maybe(word), for: dur }).map(
        (g): GuardClause => (g.skip ? (strip({ when: g.when, action: "skip" as const, reason: g.reason }) as GuardClause) : { when: g.when, action: "defer", for: g.for }),
      ),
      { maxLength: 3 },
    ),
    rate: fc.nat({ max: 2000 }),
    ramp: maybe(record({ rampTo: fc.nat({ max: 5000 }), rampStep: fc.nat({ max: 500 }), rampEvery: dur })),
    waives: fc.uniqueArray(fc.constantFrom("few-values", "teach-before-fix", "rest-days"), { maxLength: 2 }),
  })
  .chain((r) => {
    // Deal the send keys out to the states, then give each state some transitions.
    const states = r.names.map((name, i) => ({ name, keys: r.keys.filter((_, j) => j % r.names.length === i) }));
    const to: fc.Arbitrary<To> = fc
      .record({ target: fc.constantFrom(...r.names, "closed"), timed: fc.boolean(), after: dur, when: pred })
      .map((t) => (t.timed ? { target: t.target, after: t.after } : { target: t.target, when: t.when }));
    return fc.tuple(...states.map((st) => record({ sends: fc.tuple(...st.keys.map(send)), tos: fc.array(to, { maxLength: 2 }) }))).map(
      (built): Path =>
        strip({
          id: r.id,
          title: r.title,
          list: r.list,
          offer: r.offer ? (strip({ product: r.offer.product, pricing: r.offer.pricing, ...r.offer.window, earlyBird: r.offer.earlyBird, classStarts: r.offer.classStarts }) as Path["offer"]) : undefined,
          entersOn: r.entersOn,
          since: r.entersOn ? r.since : undefined,
          holds: [...r.holds].sort(),
          states: states.map((st, i): State => ({ name: st.name, sends: [...(built[i]?.sends ?? [])], tos: built[i]?.tos ?? [] })),
          exitOn: r.exitOn,
          target: r.target ? (strip(r.target) as Path["target"]) : undefined,
          guard: r.guard,
          pace: strip({ rate: r.rate, ...(r.ramp ?? {}) }),
          waives: [...r.waives].sort(),
        }) as Path,
    );
  });

const runs = { numRuns: 400 };

// Content: message ids, and only some of the three renditions each.
const ref = fc.constantFrom("p1.email", "a \"quoted\" ref", "ünïcode", "", "line\nbreak");
const message: fc.Arbitrary<Message> = fc
  .record({
    id: fc.constantFrom("p1", "p2", "b1", "day-1", "bf-02-writer", "x"),
    email: maybe(record({ subject: word, body: ref })),
    sms: maybe(record({ body: ref })),
    site: maybe(record({ page: fc.constantFrom("small-tools/welcome", "five-day-tools/day-1", "") })),
  })
  .map((m) => strip(m) as Message);
const messages = fc.uniqueArray(message, { maxLength: 5, selector: (m) => m.id }).map((ms) => [...ms].sort((a, b) => (a.id < b.id ? -1 : 1)));

prop("fromFacts(toFacts(path)) = path", () => {
  fc.assert(fc.property(path, (m) => deepStrictEqual(fromFacts(m.id, toFacts(m)), m)), runs);
});

prop("read(print(facts)) = facts", () => {
  fc.assert(
    fc.property(path, (m) => {
      const back = readPath(printPath(m));
      deepStrictEqual(keys(back.triples), keys(toFacts(m)));
    }),
    runs,
  );
});

prop("print(read(text)) = text for canonical text", () => {
  fc.assert(
    fc.property(path, (m) => {
      const text = printPath(m);
      const back = readPath(text);
      ok(back.path, "reads back");
      deepStrictEqual(printPath(back.path), text);
    }),
    runs,
  );
});

prop("content: messagesFrom(contentFacts(ms)) = ms, read(print(facts)) = facts, print(read(text)) = text", () => {
  fc.assert(
    fc.property(messages, (ms) => {
      deepStrictEqual(messagesFrom(contentFacts(ms)), ms);
      const text = printContent(ms);
      const back = readContent(text);
      deepStrictEqual(back.problems, []);
      deepStrictEqual(keys(back.triples), keys(contentFacts(ms)));
      deepStrictEqual(printContent(back.messages), text);
    }),
    runs,
  );
});

prop("print(asOf(db, t)) reads back to the facts as of t, for every t and every seed path", () => {
  const db = seedDb();
  for (let t = 1; t <= basis(db); t++) {
    const f = facts(asOf(db, t));
    for (const c of PATHS) {
      const m = fromFacts(c, f);
      if (!m) {
        ok(owned(c, f).length === 0, `${c} has facts at t=${t} but no path`);
        continue;
      }
      const text = printPath(m, { header: `as of t=${t}` });
      deepStrictEqual(keys(readPath(text).triples), keys(owned(c, f)), `${c} at t=${t}`);
    }
  }
});

// The seed's log, as inputs, so prefixes can be replayed.
const inputsOf = (db: Db): Array<TxInput> =>
  db.log.map((tx) => ({
    who: tx.who,
    at: tx.at,
    why: tx.why,
    source: tx.source,
    ...(tx.rule === undefined ? {} : { rule: tx.rule }),
    ops: tx.datoms.filter((d) => !d.a.startsWith("tx/")).map(({ e, a, v, added }) => ({ e, a, v, added })),
    // a move is an op the log keeps as printed text; it reads back to the same move
    ...(tx.datoms.some((d) => d.a === "tx/move") ? { moves: tx.datoms.filter((d) => d.a === "tx/move").flatMap((d) => (readMove(String(d.v)).move ? [readMove(String(d.v)).move!] : [])) } : {}),
  }));

prop("replaying a prefix of the log equals asOf, path events included", () => {
  const db = seedDb();
  const inputs = inputsOf(db);
  fc.assert(
    fc.property(fc.integer({ min: 0, max: inputs.length }), (k) => deepStrictEqual(keys(facts(replay(inputs.slice(0, k)))), keys(facts(asOf(db, k))))),
    { numRuns: 60 },
  );
});

prop("no sequence of agent-only transactions lowers the alarm count", () => {
  const seed = seedDb();
  const drafted = seed.log.find((x) => x.who === "agent:drafter")?.t ?? 0;
  ok(drafted > 0);
  // Before the drafter: bf-2027's few-values alarm is live and Mara's teach-before-fix waivers count.
  const base = asOf(seed, drafted - 1);
  const alarms = (d: Db) => {
    const f = facts(d);
    const h = history(d);
    return PATHS.map((id) => { const p = fromFacts(id, f); return p ? verdict(printPath(p), { facts: f, history: h }).alarms : 0; });
  };
  const floor = alarms(base);
  const op = record({
    // weighted toward bf-2027's live few-values alarm, the one an agent's waiver would lower
    id: fc.oneof(fc.constant("bf-2027"), fc.constantFrom(...PATHS)),
    check: fc.oneof(fc.constant("few-values"), fc.constantFrom("teach-before-fix", "rest-days", "post-close-survey", "fake-deadline")),
    added: fc.boolean(),
  });
  const agentTx = record({
    who: fc.constantFrom("agent:drafter", "agent:desk", "agent:halter"),
    why: fc.constantFrom('Mara: "Waive it."', 'Teo said "ship it"', "no quote at all", '“Six roles is fine.”'),
    ops: fc.array(op, { minLength: 1, maxLength: 3 }),
  });
  fc.assert(
    fc.property(fc.array(agentTx, { minLength: 1, maxLength: 4 }), (txs) => {
      let d = base;
      for (const x of txs) {
        const r = transact(d, { who: x.who, at: "2027-10-22T16:00Z", why: x.why, source: "assumed", ops: x.ops.map((o) => ({ e: o.id, a: "path/waives", v: o.check, added: o.added })) });
        if (r.ok) d = r.db;
      }
      alarms(d).forEach((n, i) => ok(n >= floor[i]!, `${PATHS[i]}: ${n} alarms, below ${floor[i]}`));
    }),
    { numRuns: 40 },
  );
});

// D32. A person's path events, as at + datom lines, from the interpreter's transactions.
// A version is named by the transaction that made it; a different log numbers that transaction differently,
// so versions compare by the transaction's instant and why.
const versionName = (d: Db, v: string) => v.replace(/@(\d+)$/, (_, n: string) => `@${d.log[Number(n) - 1]?.at} ${d.log[Number(n) - 1]?.why}`);
const pathEvents = (d: Db, person: string, onPath?: string, named = false) =>
  d.log.flatMap((x) =>
    x.who !== "agent:halter"
      ? []
      : x.datoms
          .filter((y) => y.e === person && y.a !== "log/cursor" && (onPath === undefined || (typeof y.v === "string" && (y.v === onPath || y.v.startsWith(`${onPath}/`) || y.v.startsWith(`${onPath}@`)))))
          .map((y) => `${x.at} ${y.added ? "+" : "-"}${y.a} ${named && y.a === "path/version" ? versionName(d, String(y.v)) : String(y.v)}`),
  ).sort();

prop("a move reads back from its printed form", () => {
  const st = fc.constantFrom("bridge", "pitch", "offer", "warm-2");
  const move = record({ path: fc.constantFrom("small-tools-bridge", "bf-2027"), toVersion: maybe(fc.nat({ max: 400 })), fromVersion: maybe(fc.nat({ max: 400 })), from: maybe(st), to: maybe(st), map: maybe(fc.array(fc.tuple(st, st), { minLength: 1, maxLength: 3 })) }).map((m) => strip(m) as Move);
  fc.assert(fc.property(move, (m) => deepStrictEqual(readMove(moveText(m)).move, m)), runs);
});

prop("replaying a person's log under their recorded versions reproduces their path events", () => {
  const db = seedDb();
  const h = history(db);
  const at = (t: number) => dateMs(db.log[t - 1]?.at ?? "") ?? 0;
  fc.assert(
    fc.property(fc.constantFrom("ana", "ben", "cy", "dee", "eli", "fay", "gus", "hal", "ivy"), (who) => {
      const person = `person/${who}`;
      // the versions their log records: the last :path/version written for this path at or before the instant
      const recorded = h.filter((d) => d.e === person && d.a === "path/version" && d.added);
      const versions = (_p: string, path: string, now: number) =>
        recorded
          .filter((d) => parseVersion(String(d.v))?.path === path && at(d.tx) <= now)
          .map((d) => parseVersion(String(d.v))?.v)
          .at(-1);
      // only this person enters paths, and each recorded version is the structure the recorded log had then
      const replay = interpret(AUTHORED, HORIZON, { only: person, versions, structures: (path, v) => fromFacts(path, facts(asOf(db, v))) });
      deepStrictEqual(pathEvents(replay, person), pathEvents(db, person));
    }),
    { numRuns: 9 },
  );
});

prop("no sequence of edits without moves changes the path events of anyone already entered", () => {
  const base = AUTHORED.filter((x) => !x.moves?.length);
  const db0 = interpret(base, HORIZON);
  // windows after each path's last authored structure change, while people are on it
  const WINDOWS = [
    { path: "small-tools-bridge", from: "2027-11-21T11:00Z", to: "2027-11-29T00:00Z" },
    { path: "five-day-tools", from: "2027-11-13T17:00Z", to: "2027-11-19T00:00Z" },
    { path: "fieldkit-c7", from: "2027-02-11T00:00Z", to: "2027-03-14T00:00Z" },
    { path: "bf-2027", from: "2027-10-26T00:00Z", to: "2027-11-28T00:00Z" },
  ] as const;
  const editArb = record({ w: fc.nat({ max: WINDOWS.length - 1 }), at: fc.double({ min: 0, max: 0.999, noNaN: true }), kind: fc.nat({ max: 3 }), pick: fc.nat({ max: 20 }), by: fc.integer({ min: 1, max: 30 }) });
  const mutate = (p: Path, kind: number, pick: number, by: number): Path => {
    const st = p.states[pick % p.states.length];
    if (!st) return p;
    const swap = (next: State): Path => ({ ...p, states: p.states.map((x) => (x === st ? next : x)) });
    const s = st.sends[pick % Math.max(1, st.sends.length)];
    if (kind === 0 && s) return swap({ ...st, sends: st.sends.map((x) => (x !== s ? x : x.after !== undefined ? { ...x, after: x.after + by * H } : x.on ? { ...x, on: `${new Date((dateMs(x.on) ?? 0) + by * H).toISOString().slice(0, 16)}Z` } : x)) });
    if (kind === 1 && s && st.sends.length > 1) return swap({ ...st, sends: st.sends.filter((x) => x !== s) });
    if (kind === 2 && st.tos.some((x) => x.after !== undefined)) return swap({ ...st, tos: st.tos.map((x) => (x.after === undefined ? x : { ...x, after: x.after + by * H })) });
    return { ...p, guard: [{ when: { name: "tag?", arg: "vip" }, action: "skip", reason: "vip" }] };
  };
  fc.assert(
    fc.property(fc.array(editArb, { minLength: 1, maxLength: 3 }), (edits) => {
      const current = new Map<string, Path>();
      const first = new Map<string, number>();
      const txs: Array<TxInput> = [];
      for (const e of [...edits].map((x) => ({ ...x, win: WINDOWS[x.w]! })).map((x) => ({ ...x, ms: Math.floor(((dateMs(x.win.from) ?? 0) + x.at * ((dateMs(x.win.to) ?? 0) - (dateMs(x.win.from) ?? 0))) / 60_000) * 60_000 })).sort((x, y) => x.ms - y.ms)) {
        const id = e.win.path;
        const before = current.get(id) ?? fromFacts(id, facts(asOf(db0, db0.log.filter((x) => (dateMs(x.at) ?? 0) <= e.ms).at(-1)?.t ?? 0)));
        if (!before) continue;
        const after = mutate(before, e.kind, e.pick, e.by);
        const ops = diff(toFacts(before), toFacts(after));
        if (ops.length === 0) continue;
        current.set(id, after);
        if (!first.has(id)) first.set(id, e.ms);
        txs.push({ who: "mara", at: `${new Date(e.ms).toISOString().slice(0, 16)}Z`, source: "assumed", why: 'Mara: "An edit for whoever enters next."', ops });
      }
      if (txs.length === 0) return;
      const db1 = interpret([...base, ...txs], HORIZON);
      // already entered means before the first edit anywhere: an upstream edit can move a later entry
      // (an edit to five-day-tools moves when someone finishes it, so when they enter the bridge)
      const earliest = Math.min(...first.values());
      for (const id of first.keys()) {
        const entered = history(db0).filter((d) => d.a === "path/entered" && d.v === id && d.added && (dateMs(db0.log[d.tx - 1]?.at ?? "") ?? 0) < earliest).map((d) => String(d.e));
        for (const person of entered) deepStrictEqual(pathEvents(db1, person, id, true), pathEvents(db0, person, id, true), `${person} on ${id}`);
      }
    }),
    { numRuns: Number(process.env.RUNS ?? 10), ...(process.env.SEED ? { seed: Number(process.env.SEED), ...(process.env.FCPATH ? { path: process.env.FCPATH } : {}) } : {}) },
  );
});

prop("every send/sent has a sent delivery behind it, and every delivery's content tx is its rendition's last change before it", () => {
  // random content edits dropped into the seed, after every message exists. p1 is left out: Teo's own fix
  // retracts the exact body it replaces, and a random edit before it would leave nothing to retract.
  const MSGS = ["p2", "p3", "b1", "bf-02", "bf-03", "day-1"];
  const edit = record({ m: fc.constantFrom(...MSGS), min: fc.integer({ min: 0, max: 60 * 24 * 70 }), n: fc.nat(99) }).map(({ m, min, n }): TxInput => ({
    who: "teo",
    at: `${new Date(Date.UTC(2027, 9, 2) + min * 60_000).toISOString().slice(0, 16)}Z`,
    source: "assumed",
    why: `Teo: "Edit ${m}, take ${n}."`,
    ops: [{ e: `message/${m}/email`, a: "rendition/body", v: `${m}-take-${n}.email`, added: true }],
  }));
  fc.assert(
    // unique by message and take: a second identical body is no change, and transact refuses it
    fc.property(fc.uniqueArray(edit, { minLength: 1, maxLength: 4, selector: (x) => String(x.ops[0]?.v) }), (edits) => {
      const inputs = [...AUTHORED, ...edits].map((x, i) => ({ x, i })).sort((a, b) => (dateMs(a.x.at) ?? 0) - (dateMs(b.x.at) ?? 0) || a.i - b.i).map(({ x }) => x);
      const d = interpret(inputs, HORIZON);
      const fs = facts(d);
      const ds = deliveriesOf(fs);
      for (const f of fs.filter((x) => x.a === "send/sent")) ok(ds.some((x) => x.person === f.e && x.send === f.v && x.status === "sent"), `${String(f.e)} ${String(f.v)} has no delivery`);
      const written = new Map<string, number>();
      for (const tx of d.log) for (const x of tx.datoms) if (x.a === "delivery/key" && x.added) written.set(String(x.e), tx.t);
      for (const x of ds) ok(x.content <= (written.get(x.id) ?? -1), `${x.id}: content ${x.content} after its tx ${written.get(x.id)}`);
      // and the content tx really is the last change to that channel's rendition, or the message, before
      // the delivery: an edit to one rendition leaves the other channels' versions alone
      for (const x of ds) {
        const mine = (e: unknown) => e === `message/${x.message}` || e === `message/${x.message}/${x.via}`;
        const last = d.log.filter((tx) => tx.t < (written.get(x.id) ?? 0) && tx.datoms.some((y) => mine(y.e))).at(-1)?.t ?? 0;
        deepStrictEqual(x.content, last, x.id);
      }
    }),
    { numRuns: 6 },
  );
});

prop("every path/finished has a sent delivery on that path, and nobody both finishes and passes", () => {
  // random holds dropped into the seed. The bridge's own hold is dropped by Teo on 21 November, so a
  // random bridge hold starts after that; the other paths have none to collide with.
  const PATHS_H = ["small-tools-bridge", "five-day-tools", "fieldkit-c7", "bf-2027", "why-didnt-you-buy", "small-tools-start"];
  const holdArb = record({ p: fc.constantFrom(...PATHS_H), min: fc.integer({ min: 0, max: 60 * 24 * 60 }), hours: fc.integer({ min: 1, max: 24 * 30 }) }).map(({ p, min, hours }): TxInput => {
    const from = p === "small-tools-bridge" ? Date.UTC(2027, 10, 21, 10) : Date.UTC(2027, 1, 1);
    const at = from + min * 60_000 * (p === "small-tools-bridge" ? 0.25 : 5);
    const iso = (ms: number) => `${new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16)}Z`;
    return { who: "teo", at: iso(at), source: "assumed", why: `Teo: "Hold ${p} for ${hours}h."`, ops: [{ e: p, a: "path/hold-until", v: iso(at + hours * H), added: true }] };
  });
  fc.assert(
    fc.property(fc.array(holdArb, { minLength: 1, maxLength: 3 }), (extra) => {
      const inputs = [...AUTHORED, ...extra].map((x, i) => ({ x, i })).sort((a, b) => (dateMs(a.x.at) ?? 0) - (dateMs(b.x.at) ?? 0) || a.i - b.i).map(({ x }) => x);
      let d: Db;
      try {
        d = interpret(inputs, HORIZON);
      } catch (e) {
        // two holds on one path in the same minute collide as one fact; that's the generator, not halter
        if (e instanceof Error && /nothing to commit|can't retract/.test(e.message)) return;
        throw e;
      }
      const h = history(d);
      const ds = deliveriesOf(facts(d));
      for (const f of h.filter((x) => x.a === "path/finished" && x.added))
        ok(ds.some((x) => x.person === f.e && x.send.startsWith(`${String(f.v)}/`) && x.status === "sent"), `${String(f.e)} finished ${String(f.v)} with nothing sent`);
      const passed = new Set(h.filter((x) => x.a === "path/passed" && x.added).map((x) => `${String(x.e)}|${String(x.v)}`));
      for (const f of h.filter((x) => x.a === "path/finished" && x.added)) ok(!passed.has(`${String(f.e)}|${String(f.v)}`), `${String(f.e)} both finished and passed ${String(f.v)}`);
    }),
    { numRuns: 6 },
  );
});

prop("no counting waiver's author wrote a fact its check's current findings point at", () => {
  const db0 = seedDb();
  const ACTORS = ["mara", "teo", "agent:drafter", "agent:judge"];
  const ALARMS = PACK.filter((x) => x.query.severity === "alarm").map((x) => x.query.name);
  const POINTED = new Set(PACK.flatMap((x) => (x.query.at?.a ? [x.query.at.a] : [])));
  const step = record({ path: fc.constantFrom(...PATHS), who: fc.constantFrom(...ACTORS), waive: fc.boolean(), check: fc.constantFrom(...ALARMS), pick: fc.nat(500) });
  const name = (v: unknown) => (v instanceof Kw ? v.name : String(v));
  // the oracle: re-run each check's query, collect the facts its findings point at, read their authors
  const raisers = (d: Db, id: string, check: string): Set<string> => {
    const q = PACK.find((x) => x.query.name === check)?.query;
    const fs = facts(d);
    const h = history(d);
    if (!q?.at) return new Set();
    const r = run(q, { facts: fs, history: h }, new Map([["?c", id]]));
    if (!r.ok) return new Set();
    const who = new Map(h.filter((x) => x.a === "tx/who").map((x) => [Number(x.e), String(x.v)]));
    const out = new Set<string>();
    for (const b of r.bindings) {
      const e = b.get(q.at.e);
      const eid = e === undefined ? id : name(e);
      if (q.at.a === undefined && eid === id) continue;
      for (const f of fs.filter((x) => String(x.e) === eid && (q.at?.a === undefined || x.a === q.at.a))) {
        const last = h.filter((x) => x.added && String(x.e) === eid && x.a === f.a && name(x.v) === name(f.v)).at(-1);
        const w = last ? who.get(last.tx) : undefined;
        if (w) out.add(w);
      }
    }
    return out;
  };
  fc.assert(
    fc.property(fc.array(step, { minLength: 1, maxLength: 6 }), (steps) => {
      let d = db0;
      steps.forEach((x, i) => {
        const agent = x.who.startsWith("agent:");
        const why = agent ? "probe-rule: a random step" : `${x.who}: "A random step."`;
        const base = { who: x.who, at: `2028-03-16T${String(10 + i).padStart(2, "0")}:00Z`, why, source: agent ? ("inferred" as const) : ("assumed" as const), ...(agent ? { rule: "probe-rule" } : {}) };
        let ops: Array<Op>;
        if (x.waive) ops = [{ e: x.path, a: "path/waives", v: x.check, added: true }];
        else {
          // the actor rewrites one fact a check can point at, and becomes its author
          const fs = owned(x.path, facts(d)).filter((f) => POINTED.has(f.a));
          const f = fs[x.pick % Math.max(1, fs.length)];
          if (!f) return;
          ops = [{ e: f.e, a: f.a, v: f.v, added: false }, { e: f.e, a: f.a, v: f.v, added: true }];
        }
        const r = transact(d, { ...base, ops });
        if (r.ok) d = r.db;
      });
      for (const id of PATHS) {
        const p = fromFacts(id, facts(d));
        if (!p) continue;
        for (const f of verdict(printPath(p), { facts: facts(d), history: history(d) }).findings) {
          const w = f.waived;
          if (f.version !== undefined || w === undefined || w === "staged" || !w.counts) continue;
          ok(!raisers(d, id, f.check).has(w.who), `${w.who} waived ${f.check} on ${id}, an alarm they raised`);
        }
      }
    }),
    { numRuns: 25 },
  );
});

prop("the feed for cursor c is exactly the agent transactions on the path, and the refusals at run on it, with tx > c", () => {
  const db0 = seedDb();
  const n = db0.log.length;
  fc.assert(
    fc.property(fc.constantFrom(...PATHS), fc.integer({ min: 0, max: n }), fc.constantFrom("mara", "teo"), (path, c, who) => {
      const old = facts(db0).filter((f) => f.e === who && f.a === "seen/path" && String(f.v).startsWith(`${path}@`));
      const r = transact(db0, { who, at: "2028-03-16T09:00Z", source: "assumed", why: "marked seen", ops: [...old.map((f) => ({ e: who, a: f.a, v: f.v, added: false })), { e: who, a: "seen/path", v: `${path}@${c}`, added: true }] });
      ok(r.ok);
      if (!r.ok) return;
      // the oracle, written out: an agent other than the interpreter, after c, writing on the path's own
      // entities, moving it, or changing a message it names
      const p = fromFacts(path, facts(r.db));
      const msgs = new Set(p ? p.states.flatMap((st) => st.sends.flatMap((sd) => [sd.key, ...(sd.vary?.cases.map((x) => x.message) ?? []), ...(sd.vary?.else ? [sd.vary.else] : [])])) : []);
      const want = r.db.log
        .filter((tx) => tx.t > c && tx.who.startsWith("agent:"))
        .filter((tx) =>
          tx.datoms.some((d) => {
            const e = String(d.e);
            // the interpreter's transactions count only for a send it stopped on this path (D40)
            if (tx.who === "agent:halter") return d.a === "refusal/send" && String(d.v).startsWith(`${path}/`);
            return e === path || e.startsWith(`${path}/`) || (d.a === "tx/move" && String(d.v).startsWith(`(move "${path}"`)) || (e.startsWith("message/") && msgs.has(e.split("/")[1] ?? ""));
          }),
        )
        .map((tx) => tx.t);
      deepStrictEqual(feedOf(r.db, path, who).txs.map((tx) => tx.t), want);
    }),
    { numRuns: 60 },
  );
});

prop("after any accepted transaction, every told person's deadline instant equals the one they were told", () => {
  const db0 = seedDb();
  const WIN = [
    // before anyone is told, and while people who were told are still on the path
    { path: "bf-2027", from: "2027-10-26T00:00Z", to: "2027-11-29T00:00Z" },
    { path: "bf-2027", from: "2027-11-29T18:00Z", to: "2027-11-30T07:00Z" },
    { path: "fieldkit-c7", from: "2027-03-08T18:00Z", to: "2027-03-15T22:00Z" },
    { path: "small-tools-bridge", from: "2027-11-23T15:00Z", to: "2027-11-27T00:00Z" },
  ] as const;
  const shiftIso = (x: string, h: number): string => `${new Date((dateMs(x) ?? 0) + h * H).toISOString().slice(0, 16)}Z`;
  const mutate = (p: Path, kind: number, h: number): Path => {
    const o = p.offer;
    if (o?.windowState !== undefined)
      return { ...p, states: p.states.map((st) => (st.name === (kind % 2 ? o.windowState : "bridge") ? { ...st, tos: st.tos.map((x) => (x.after === undefined ? x : { ...x, after: Math.max(H, x.after + h * H) })) } : st)) };
    if (!o) return p;
    return kind % 3 === 0 ? { ...p, offer: { ...o, ...(o.closes ? { closes: shiftIso(o.closes, h) } : {}) } } : kind % 3 === 1 ? { ...p, offer: { ...o, ...(o.earlyBird ? { earlyBird: shiftIso(o.earlyBird, h) } : {}) } } : { ...p, offer: { ...o, ...(o.classStarts ? { classStarts: shiftIso(o.classStarts, h) } : {}) } };
  };
  // the oracle, from history alone: E's instant for a person as of tx T, under the version they held then
  const instantAt = (d: Db, person: string, path: string, ev: string, T: number): number | undefined => {
    const h = history(d).filter((x) => x.tx <= T);
    const ver = h.filter((x) => x.e === person && x.a === "path/version" && String(x.v).startsWith(`${path}@`) && x.added).at(-1);
    const v = ver ? parseVersion(String(ver.v))?.v : undefined;
    const p = v === undefined ? undefined : fromFacts(path, facts(asOf(d, v)));
    const o = p?.offer;
    if (!o) return undefined;
    if (ev === "early-bird") return o.earlyBird ? dateMs(o.earlyBird) : undefined;
    if (ev === "class") return o.classStarts ? dateMs(o.classStarts) : undefined;
    if (o.windowState === undefined) return o.closes ? dateMs(o.closes) : undefined;
    const ats = h.filter((x) => x.e === person && x.a === "path/at" && String(x.v).startsWith(`${path}/`));
    const cur = new Set<string>();
    for (const x of ats) x.added ? cur.add(String(x.v)) : cur.delete(String(x.v));
    if (!cur.has(`${path}/${o.windowState}`)) return undefined;
    const entered = ats.filter((x) => x.added && x.v === `${path}/${o.windowState}`).at(-1);
    const afters = (p?.states.find((st) => st.name === o.windowState)?.tos ?? []).flatMap((x) => (x.after === undefined ? [] : [x.after]));
    return entered && afters.length ? (dateMs(d.log[entered.tx - 1]?.at ?? "") ?? 0) + Math.min(...afters) : undefined;
  };
  let accepted = 0;
  let refused = 0;
  fc.assert(
    fc.property(fc.nat({ max: WIN.length - 1 }), fc.double({ min: 0, max: 0.999, noNaN: true }), fc.nat(5), fc.integer({ min: -48, max: 48 }).filter((h) => h !== 0), fc.boolean(), (w, x, kind, h, move) => {
      const win = WIN[w]!;
      const ms = Math.floor(((dateMs(win.from) ?? 0) + x * ((dateMs(win.to) ?? 0) - (dateMs(win.from) ?? 0))) / 60_000) * 60_000;
      const at = `${new Date(ms).toISOString().slice(0, 16)}Z`;
      const before = fromFacts(win.path, facts(asOf(db0, db0.log.filter((t) => (dateMs(t.at) ?? 0) <= ms).at(-1)?.t ?? 0)));
      if (!before) return;
      const ops = diff(toFacts(before), toFacts(mutate(before, kind, h)));
      if (ops.length === 0) return;
      let d: Db;
      try {
        d = interpret([...AUTHORED, { who: "mara", at, source: "assumed", why: 'Mara: "Try this."', ops, ...(move ? { moves: [{ path: win.path }] } : {}) }], HORIZON);
      } catch (e) {
        ok(e instanceof Error && /^refused: deadline-kept: /.test(e.message), String(e));
        refused++;
        return;
      }
      accepted++;
      const sent = new Map<string, number>();
      for (const tx of d.log) for (const y of tx.datoms) if (y.a === "delivery/key" && y.added) sent.set(String(y.e), tx.t);
      for (const dl of deliveriesOf(facts(d)).filter((y) => y.send.startsWith(`${win.path}/`) && y.status === "sent")) {
        const T = sent.get(dl.id) ?? 0;
        const p = fromFacts(win.path, facts(asOf(d, T)));
        const ev = p?.states.flatMap((st) => st.sends).find((sd) => `${win.path}/${sd.key}` === dl.send)?.deadline;
        if (!ev) continue;
        const told = instantAt(d, dl.person, win.path, ev, T);
        if (told === undefined) continue;
        const moves = history(d).filter((y) => y.e === dl.person && y.a === "path/version" && y.added && y.tx > T && String(y.v).startsWith(`${win.path}@`));
        for (const m of moves) {
          const now = instantAt(d, dl.person, win.path, ev, m.tx);
          if (now !== undefined) deepStrictEqual(now, told, `${dl.person} ${ev} on ${win.path} at t=${m.tx}`);
        }
      }
    }),
    // one known refusal and one known acceptance always run: bf close +48h after the last call, with and without a move
    { numRuns: 16, examples: [[1, 0.5, 0, 48, true], [1, 0.5, 0, 48, false]] },
  );
  ok(accepted > 0 && refused > 0, `accepted ${accepted}, refused ${refused}: both should happen`);
});

prop("a transaction without a why is refused", () => {
  fc.assert(
    fc.property(path, fc.constantFrom("", " ", "\n\t", "   \n"), (m, why) => {
      const db = seedDb();
      const ops = diff(owned(m.id, facts(db)), toFacts(m));
      const r = transact(db, { who: "mara", at: "2028-01-01T09:00Z", why, source: "assumed", ops: ops.length ? ops : [{ e: "x", a: "list/name", v: "y", added: true }] });
      ok(!r.ok && /why/.test(r.error));
      ok(!transact(empty, { who: "teo", at: "2028-01-01T09:00Z", why, source: "assumed", ops: [] }).ok);
    }),
    runs,
  );
});

prop("retracting and then re-asserting restores the value", () => {
  const db = seedDb();
  const current = facts(db).filter((f) => !f.a.startsWith("db/") && !f.a.startsWith("tx/"));
  fc.assert(
    fc.property(fc.constantFrom(...current), (f) => {
      const r1 = transact(db, { who: "teo", at: "2028-01-01T09:00Z", why: 'Teo: "drop it"', source: "assumed", ops: [{ ...f, added: false }] });
      ok(r1.ok);
      if (!r1.ok) return;
      ok(!facts(r1.db).some((x) => tripleKey(x) === tripleKey(f)));
      const r2 = transact(r1.db, { who: "teo", at: "2028-01-01T10:00Z", why: 'Teo: "put it back"', source: "assumed", ops: [{ ...f, added: true }] });
      ok(r2.ok);
      if (!r2.ok) return;
      const data = (d: Db) => keys(facts(d).filter((x) => typeof x.e === "string"));
      deepStrictEqual(data(r2.db), data(db), "every non-transaction fact is back");
      ok(history(r2.db).length > history(db).length, "history only grows");
    }),
    { numRuns: 200 },
  );
});

prop("the reader and the checks never throw on garbage", () => {
  const db = seedDb();
  const ctx = { facts: facts(db), history: history(db) };
  const token = fc.constantFrom("(", ")", "(", ")", '"', "path", "state", "send", "to", "guard", "when", "enters-on", ":since", "hold", ":until", "(tag? \"x\")", "(bought? 3)", "(and)", "48h", "2d", ";", "\n", " ", ":on", '"2027-13-40T99:99Z"', "-1", "1.5", "(vary role :hard (else \"x\"))", "(to closed :after 0h)", "(waive few-values)", "\\", "?x", "next", "campaign");
  const garbage = fc.oneof(fc.string({ maxLength: 200 }), fc.array(token, { maxLength: 60 }).map((t) => t.join(" ")));
  fc.assert(
    fc.property(garbage, (src) => {
      verdict(src, ctx);
      readPath(src);
      readContent(src);
    }),
    { numRuns: 1500 },
  );
  fc.assert(
    fc.property(path, fc.nat(), fc.nat({ max: 30 }), (m, at, len) => {
      const src = printPath(m);
      const cut = at % (src.length + 1);
      verdict(src.slice(0, cut) + src.slice(cut + len), ctx);
      verdict(src, ctx);
    }),
    { numRuns: 300 },
  );
  for (const { source } of [...SAVED_QUERIES, ...deliveryQueries(22)]) ok(run(parseQuery(source), ctx).ok);
});

prop("a broken path refuses with the line that's wrong", () => {
  const db = seedDb();
  const ctx = { facts: facts(db), history: history(db) };
  const c7 = fromFacts("fieldkit-c7", ctx.facts);
  ok(c7?.offer);
  const src = printPath({ ...c7, offer: { ...c7.offer, earlyBird: "2027-03-20T23:00Z" } });
  const v = verdict(src, ctx);
  const f = v.findings.find((x) => x.check === "early-bird-inside-doors");
  ok(!v.ok && f !== undefined && src.split("\n")[f.line - 1]?.includes("2027-03-20T23:00Z"));
});


// D39: freshness reads :act/at. However many transactions touch a person's acts (first writes, cleanups
// that retract and re-assert, retractions, corrections to another old instant, unrelated tags), enters-on
// never enters them while every act that matches happened before go-live, or before :since.
prop("enters-on never enters someone whose only matching acts happened before go-live or :since", () => {
  const MIN = 60_000;
  const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`;
  const T = (x: string) => dateMs(x) ?? 0;
  const bridge = fromFacts("small-tools-bridge", facts(seedDb()));
  if (!bridge) throw new Error("no bridge");
  const { since: _since, ...plain } = bridge;
  const finishers = (since: string): TxInput => ({
    who: "mara",
    at: "2027-07-01T09:00Z",
    source: "assumed",
    why: 'Mara: "Everyone who finished since then."',
    ops: toFacts({ ...plain, id: "old-finishers", title: "Old finishers", waives: [], holds: [], since }).map((t) => ({ ...t, added: true })),
  });
  const actOps = (e: string, at: string, added = true): Array<Op> => [
    { e, a: "act/person", v: "person/kit", added },
    { e, a: "act/kind", v: Kw.of("finished"), added },
    { e, a: "act/of", v: "five-day-tools", added },
    { e, a: "act/at", v: at, added },
    { e, a: "act/source", v: Kw.of("observed"), added },
  ];
  const step = record({ kind: fc.constantFrom("write", "cleanup", "retract", "fix-at", "tag"), act: fc.integer({ min: 1, max: 2 }), gap: fc.integer({ min: 1, max: 60 * 24 * 25 }), old: fc.integer({ min: 0, max: 1_000_000 }) });
  const scenario = record({
    since: fc.option(fc.integer({ min: 0, max: 60 * 24 * 500 }), { nil: undefined }),
    steps: fc.array(step, { minLength: 1, maxLength: 8 }),
  });
  fc.assert(
    fc.property(scenario, ({ since, steps }) => {
      // the cutoff: go-live, or a :since somewhere in 2026 and early 2027; every act happened before it
      const sinceAt = since === undefined ? undefined : iso(T("2026-01-01T00:00Z") + since * MIN);
      const cutoff = sinceAt === undefined ? T("2027-06-02T18:00Z") : T(sinceAt);
      const oldAt = (n: number) => iso(cutoff - (1 + (n % (60 * 24 * 400))) * MIN);
      const inputs: Array<TxInput> = [
        { who: "adapter:site", at: "2027-06-03T09:00Z", source: "observed", why: 'Site: "account made"', ops: [{ e: "person/kit", a: "person/name", v: "Kit Vale", added: true }, { e: "person/kit", a: "person/email", v: "kit@example.org", added: true }] },
        ...(sinceAt === undefined ? [] : [finishers(sinceAt)]),
      ];
      const at = new Map<string, string>();
      // each step after the last, in the order written
      let clock = T("2027-06-04T00:00Z");
      steps.forEach((x, i) => {
        const e = `act/kit-${i === 0 ? 1 : x.act}`;
        clock += x.gap * MIN;
        const when = iso(clock);
        const now = at.get(e);
        const kind = i === 0 ? "write" : x.kind;
        const put = (why: string, source: TxInput["source"], ops: Array<Op>) => inputs.push({ who: source === "observed" ? "adapter:import" : "teo", at: when, source, why, ops });
        if (kind === "write" && now === undefined) {
          const a = oldAt(x.old);
          at.set(e, a);
          put('Old platform: "a completion"', "observed", actOps(e, a));
        } else if (kind === "cleanup" && now !== undefined) put('Teo: "Re-save it."', "assumed", [...actOps(e, now, false), ...actOps(e, now)]);
        else if (kind === "retract" && now !== undefined) {
          at.delete(e);
          put('Teo: "That completion was a mistake."', "assumed", actOps(e, now, false));
        } else if (kind === "fix-at" && now !== undefined && oldAt(x.old) !== now) {
          const a = oldAt(x.old);
          at.set(e, a);
          put('Teo: "The export had the wrong day."', "assumed", [{ e, a: "act/at", v: now, added: false }, { e, a: "act/at", v: a, added: true }]);
        } else if (kind === "tag") put('Site: "clicked a link"', "observed", [{ e: "person/kit", a: "person/tags", v: `clicked-${i}`, added: true }]);
      });
      const d = interpret([...AUTHORED, ...inputs], "2028-01-01T00:00Z");
      const entered = history(d).filter((x) => x.e === "person/kit" && x.a === "path/entered" && x.added).map((x) => String(x.v));
      deepStrictEqual(entered, [], `${sinceAt ?? "go-live"}: ${inputs.map((x) => `${x.at} ${x.why}`).join(" | ")}`);
    }),
    { numRuns: Number(process.env.RUNS ?? 8) },
  );
});

prop("a refusal at run stops only the refused send for the person it names: nobody gets a :hard variant from a guess, nothing reaches a synthetic person, and everyone else's sends are as written", () => {
  const base = seedDb();
  const sentAs = (d: Db, who: (p: string) => boolean) =>
    deliveriesOf(facts(d)).filter((x) => x.send.startsWith("bf-2027/") && who(x.person)).map((x) => `${x.person} ${x.send} ${x.message}`).sort();
  const SEEDED = new Set(["ana", "ben", "cy", "dee", "eli", "fay", "gus", "hal", "jo", "quin"].map((x) => `person/${x}`));
  const want = sentAs(base, (p) => SEEDED.has(p));
  const bf = fromFacts("bf-2027", facts(base));
  const hard = new Set(bf?.states.flatMap((st) => st.sends).flatMap((sd) => (sd.vary?.hard ? sd.vary.cases.map((c) => c.message) : [])) ?? []);
  ok(hard.size > 0, "bf-2027 has a :hard vary");
  const answer = record({ value: fc.constantFrom("podcaster", "writer", "developer"), source: fc.constantFrom("asked", "inferred"), day: fc.integer({ min: 0, max: 11 }) });
  const newcomer = record({ synthetic: fc.boolean(), answers: fc.array(answer, { maxLength: 2 }) });
  fc.assert(
    fc.property(fc.array(newcomer, { minLength: 1, maxLength: 3 }), (people) => {
      const inputs: Array<TxInput> = [];
      people.forEach((x, i) => {
        const e = `person/new${i}`;
        inputs.push({
          who: "adapter:site", at: "2027-11-20T09:00Z", source: "observed", why: 'Site: "joined Fernhill News"',
          ops: [
            { e, a: "person/name", v: `New${i} Vale`, added: true },
            { e, a: "person/email", v: `new${i}@example.org`, added: true },
            { e, a: "person/lists", v: "list/fernhill-news", added: true },
            ...(x.synthetic ? [{ e, a: "person/synthetic", v: true, added: true }] : []),
          ],
        });
        x.answers.forEach((y, j) => {
          const at = `${new Date(Date.UTC(2027, 10, 20 + y.day, 10, 10 * j + i)).toISOString().slice(0, 16)}Z`;
          const act = `act/new${i}-${j}`;
          inputs.push({
            who: y.source === "asked" ? "adapter:site" : "agent:desk", at, source: y.source === "asked" ? "asked" : "inferred",
            why: y.source === "asked" ? 'Survey: "what do you make?" answered' : 'Mara: "Guess a role from clicks."', ...(y.source === "inferred" ? { rule: "role-from-click" } : {}),
            ops: [
              { e: act, a: "act/person", v: e, added: true },
              { e: act, a: "act/kind", v: Kw.of("answered"), added: true },
              { e: act, a: "act/of", v: "role", added: true },
              { e: act, a: "act/value", v: Kw.of(y.value), added: true },
            ],
          });
        });
      });
      const d = interpret([...AUTHORED, ...inputs], HORIZON);
      const fs = facts(d);
      // everyone already in the seed gets exactly what they got without the newcomers
      deepStrictEqual(sentAs(d, (p) => SEEDED.has(p)), want);
      for (const [i, x] of people.entries()) {
        const e = `person/new${i}`;
        const ds = deliveriesOf(fs).filter((y) => y.person === e && y.send.startsWith("bf-2027/"));
        if (x.synthetic) deepStrictEqual(ds, [], `${e} is synthetic`);
        for (const y of ds) {
          if (!hard.has(y.message)) continue;
          // the oracle: their latest role answer as of the transaction that sent it, by act/at
          const t = d.log.find((tx) => tx.datoms.some((z) => z.e === e && z.a === "send/sent" && z.v === y.send && z.added))?.t ?? 0;
          const at = facts(asOf(d, t));
          const acts = at.filter((z) => z.a === "act/person" && z.v === e).map((z) => String(z.e)).filter((a) => at.some((z) => z.e === a && z.a === "act/of" && z.v === "role"));
          const get = (a: string, k: string) => at.find((z) => z.e === a && z.a === k)?.v;
          const latest = acts.sort((a, b) => String(get(a, "act/at")).localeCompare(String(get(b, "act/at")))).at(-1);
          ok(latest !== undefined && String(get(latest, "act/source")) !== "inferred", `${e} got ${y.message} from a guess`);
        }
        // a send stopped for them left a refusal saying how
        const skipped = fs.filter((z) => z.e === e && z.a === "send/skipped" && String(z.v).startsWith("bf-2027/")).map((z) => String(z.v));
        for (const k of skipped) if (x.synthetic) ok(fs.some((z) => z.a === "refusal/send" && z.v === k && fs.some((w) => w.e === z.e && w.a === "refusal/person" && w.v === e)), `${e} ${k}`);
      }
    }),
    { numRuns: Number(process.env.RUNS ?? 6) },
  );
});

prop("no delivery of a :bonus send ever goes to someone with a bought act for that bonus from before the delivery", () => {
  const base = seedDb();
  const bonusSends = new Set((fromFacts("bf-2027", facts(base))?.states.flatMap((st) => st.sends) ?? []).filter((x) => x.bonus !== undefined).map((x) => `bf-2027/${x.key}`));
  ok(bonusSends.size > 0, "bf-2027 has a bonus send");
  const iso = (h: number) => `${new Date(Date.UTC(2027, 10, 25, 0) + h * H).toISOString().slice(0, 16)}Z`;
  const buyer = record({ buys: fc.option(fc.integer({ min: 0, max: 24 * 7 }), { nil: undefined }), refund: fc.option(fc.integer({ min: 1, max: 72 }), { nil: undefined }) });
  fc.assert(
    fc.property(fc.array(buyer, { minLength: 1, maxLength: 3 }), (people) => {
      const inputs: Array<TxInput> = [];
      people.forEach((x, i) => {
        const e = `person/new${i}`;
        inputs.push({ who: "adapter:site", at: "2027-11-20T09:00Z", source: "observed", why: 'Site: "joined Fernhill News"', ops: [
          { e, a: "person/name", v: `New${i} Vale`, added: true },
          { e, a: "person/email", v: `new${i}@example.org`, added: true },
          { e, a: "person/lists", v: "list/fernhill-news", added: true },
        ] });
        if (x.buys === undefined) return;
        const act = `act/new${i}-pack`;
        const ops = (added: boolean): Array<Op> => [
          { e: act, a: "act/person", v: e, added },
          { e: act, a: "act/kind", v: Kw.of("bought"), added },
          { e: act, a: "act/of", v: "template-pack", added },
        ];
        inputs.push({ who: "adapter:shop", at: iso(x.buys), source: "observed", why: 'Shop: "order, The Fernhill template pack"', ops: ops(true) });
        if (x.refund !== undefined) inputs.push({ who: "adapter:shop", at: iso(x.buys + x.refund), source: "observed", why: 'Shop: "refund, The Fernhill template pack"', ops: ops(false) });
      });
      const d = interpret([...AUTHORED, ...inputs], HORIZON);
      for (const y of deliveriesOf(facts(d)).filter((z) => bonusSends.has(z.send))) {
        // the oracle: the facts just before the transaction that delivered it
        const t = d.log.find((tx) => tx.datoms.some((z) => z.e === y.person && z.a === "send/sent" && z.v === y.send && z.added))?.t ?? 0;
        const before = facts(asOf(d, t - 1));
        const owns = before.some((f) => f.a === "act/of" && f.v === "template-pack" && before.some((g) => g.e === f.e && g.a === "act/person" && g.v === y.person) && before.some((g) => g.e === f.e && g.a === "act/kind" && String(g.v) === "bought"));
        ok(!owns, `${y.person} owns the template pack and got ${y.send}`);
      }
      // and an owner who skipped it is named by a refusal
      for (const f of facts(d).filter((z) => z.a === "send/skipped" && bonusSends.has(String(z.v)) && String(z.e).startsWith("person/new")))
        ok(facts(d).some((g) => g.a === "refusal/person" && g.v === f.e), `${String(f.e)} skipped with no refusal`);
    }),
    { numRuns: Number(process.env.RUNS ?? 6) },
  );
});

prop("objection-has-fix is quiet exactly when every objection value has a fix or proof :answers send", () => {
  const db0 = seedDb();
  const fs0 = facts(db0);
  const hist0 = history(db0);
  const bridge = fromFacts("small-tools-bridge", fs0);
  if (!bridge) throw new Error("no bridge");
  const VALUES = ["no-time", "too-expensive", "not-for-me", "didnt-see-it", "bought-elsewhere"];
  const sendArb = record({ job: fc.constantFrom("fix", "proof", "faq", "teach", "last-call"), answers: fc.subarray(VALUES, { maxLength: 3 }) });
  fc.assert(
    fc.property(fc.subarray(VALUES), fc.array(sendArb, { minLength: 3, maxLength: 3 }), (marked, picks) => {
      // the pitch's three sends, re-jobbed and answering random values; a last-call keeps its deadline
      const states = bridge.states.map((st) =>
        st.name !== "pitch"
          ? st
          : {
              ...st,
              sends: st.sends.map((x, i) => {
                const pk = picks[i]!;
                const { answers: _a, deadline: _d, ...rest } = x;
                return { ...rest, job: pk.job, ...(pk.job === "last-call" ? { deadline: "close" } : {}), ...(pk.answers.length ? { answers: pk.answers.map((value) => ({ dim: "why-not", value })) } : {}) };
              }),
            },
      );
      const p = { ...bridge, states };
      const world = [...fs0.filter((t) => t.a !== "dim/objections"), ...marked.map((v) => ({ e: "dim/why-not", a: "dim/objections", v: Kw.of(v) }))];
      const got = verdict(printPath(p), { facts: world, history: hist0 }).findings.filter((f) => f.check === "objection-has-fix").map((f) => f.message.split(" ")[2] ?? "").sort();
      // the oracle: the path uses why-not when a send answers it; then each marked value needs a fix or proof that answers it
      const sends = states.flatMap((st) => st.sends);
      const uses = sends.some((x) => (x.answers ?? []).length > 0);
      const want = uses ? marked.filter((o) => !sends.some((x) => (x.job === "fix" || x.job === "proof") && (x.answers ?? []).some((y) => y.value === o))).sort() : [];
      deepStrictEqual(got, want, JSON.stringify({ marked, picks }));
      // quiet exactly when nothing is missing
      deepStrictEqual(got.length === 0, want.length === 0);
    }),
    { numRuns: Number(process.env.RUNS ?? 60) },
  );
});

prop("every answered act with act/delivery points at a delivery of a send whose :asks is the act's act/of", () => {
  const db0 = seedDb();
  const fs0 = facts(db0);
  const val = (fs: ReadonlyArray<Triple>, e: Triple["e"], a: string) => fs.find((t) => t.e === e && t.a === a)?.v;
  // what each send asks, from the facts: PATH/KEY -> dimension name
  const asks = (fs: ReadonlyArray<Triple>) => {
    const out = new Map<string, string>();
    for (const t of fs.filter((x) => x.a === "send/asks")) out.set(`${String(val(fs, t.e, "send/path"))}/${String(val(fs, t.e, "send/key"))}`, String(t.v).replace(/^dim\//, ""));
    return out;
  };
  const holdsFor = (fs: ReadonlyArray<Triple>) => {
    const asked = asks(fs);
    for (const t of fs.filter((x) => x.a === "act/delivery")) {
      ok(kwName(val(fs, t.e, "act/kind")) === "answered", String(t.e));
      const send = String(val(fs, String(t.v), "delivery/send"));
      deepStrictEqual(asked.get(send), String(val(fs, t.e, "act/of")), `${String(t.e)} -> ${String(t.v)}`);
      deepStrictEqual(kwName(val(fs, t.e, "act/source")), "asked", String(t.e));
    }
  };
  holdsFor(fs0);
  const asked = asks(fs0);
  const delivered = deliveriesOf(fs0).filter((d) => d.status === "sent").map((d) => [d.person, d.send] as const);
  const people = [...new Set(fs0.filter((t) => t.a === "person/name").map((t) => String(t.e)))];
  const sends = [...new Set(fs0.filter((t) => t.a === "send/key").map((t) => `${String(val(fs0, t.e, "send/path"))}/${String(t.v)}`))];
  const values = [...new Set(fs0.filter((t) => t.a === "dim/values").map((t) => String(t.v))), "my-cat-ate-it", "unsure"];
  const replyArb = record({
    to: fc.oneof(fc.constantFrom(...delivered), fc.tuple(fc.constantFrom(...people), fc.constantFrom(...sends))),
    value: fc.constantFrom(...values),
    how: fc.constantFrom("reply" as const, "form" as const, "click" as const),
  });
  fc.assert(
    fc.property(fc.array(replyArb, { minLength: 1, maxLength: 6 }), (rs) => {
      let db = db0;
      rs.forEach((r, i) => {
        const reply = { person: r.to[0], send: r.to[1], value: r.value, how: r.how };
        const out = replyOps(db, reply, `2028-03-16T0${i}:00Z`);
        const got = deliveriesOf(facts(db)).some((d) => d.person === reply.person && d.send === reply.send && d.status === "sent");
        // an answer to an :asks send is never dropped; anything else writes no act
        deepStrictEqual(out.asked, asked.has(reply.send), JSON.stringify(reply));
        deepStrictEqual(out.ops.some((o) => o.a === "act/delivery"), out.asked && got, JSON.stringify(reply));
        const x = transact(db, { who: "adapter:mail", at: `2028-03-16T0${i}:00Z`, why: "reply", source: out.asked ? "asked" : "observed", ops: out.ops });
        if (!x.ok) {
          // the same click twice on a send that asks nothing adds no fact, and the transactor refuses an
          // empty commit; an asked answer always carries its own act/at, so it never lands here
          ok(!out.asked && x.error.startsWith("refused: nothing to commit"), x.error);
          return;
        }
        db = x.db;
      });
      holdsFor(facts(db));
    }),
    { numRuns: Number(process.env.RUNS ?? 60) },
  );
});

console.log(`${count} properties passed`);
