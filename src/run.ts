// The interpreter, as a sketch. Paths notify; they never call.
// It replays authored transactions in time order. Between them it fires timers, and after every
// transaction it reacts: exit-on and (to :when) for people on a path, enters-on for everyone else,
// and each person's target, which is watched from entry until :within runs out, even after done or exited.
// Everything it does lands as a path event: a transaction by agent:halter with :source observed.
// Structure is fixed at entry (D32): each run reads the path as of its version, and only a move changes
// that under people. Holds are the exception: a run checks holds on the current path, whatever its version.
// The real runtime is XState v6 actors on Effect's Clock; this loop only makes the seed's events.
import { asOf, basis, dateMs, empty, facts, history, Kw, moveText, msDate, transact, type Db, type Move, type Op, type Tx, type TxInput } from "./db.ts";
import { isStructure, versionId } from "./version.ts";
import { MESSAGE, renditionId } from "./content.ts";
import { deliveryOps } from "./delivery.ts";
import { deadlineRefusal, eventInstant, type Broken } from "./deadline.ts";
import { fromFacts, type Path, type Send } from "./model.ts";
import { answer, holds, people, type World } from "./pred.ts";
import { printAction, printPred, printVia, duration } from "./printer.ts";

export const HALTER = "agent:halter";

interface Run {
  readonly person: string;
  readonly path: string;
  // the transaction whose structure this person runs
  version: number;
  state: string;
  stateAt: number;
  lastAt: number;
  handled: Set<string>;
  deferred: Map<string, number>;
  held: Set<string>;
  defers: number;
  // deadlines this person was told (D38): event -> the instant, as of the delivery that told them
  told?: Map<string, number>;
}
// A target watch outlives the walk: it measures the person's result, and never gates a send.
interface Watch {
  readonly person: string;
  readonly path: string;
  readonly enteredAt: number;
  readonly version: number;
  readonly until?: number;
}
export interface InterpretOptions {
  // replay one person: world facts still come from every authored transaction, and only they enter paths
  readonly only?: string;
  // pinned versions, read from a recorded log: the version this person ran on this path at this instant
  readonly versions?: (person: string, path: string, at: number) => number | undefined;
  // with pinned versions: the structure a recorded version names, read from the log that recorded it
  readonly structures?: (path: string, v: number) => Path | undefined;
}
type Timer =
  | { readonly at: number; readonly run: Run; readonly kind: "send"; readonly send: Send }
  | { readonly at: number; readonly run: Run; readonly kind: "move"; readonly target: string; readonly why: string }
  | { readonly at: number; readonly kind: "miss"; readonly watch: Watch };

const add = (e: string, a: string, v: string): Op => ({ e, a, v, added: true });
const fact = (w: World, e: string, a: string) => w.facts.find((f) => f.e === e && f.a === a)?.v;
const drop = (e: string, a: string, v: string): Op => ({ e, a, v, added: false });

export const interpret = (authored: ReadonlyArray<TxInput>, horizon: string, opts: InterpretOptions = {}): Db => {
  let db = empty;
  let now = 0;
  const runs = new Map<string, Run>();
  const watches = new Map<string, Watch>();
  const pathsCache = new WeakMap<Db, Map<string, Path>>();
  const paths = (): Map<string, Path> => {
    const hit = pathsCache.get(db);
    if (hit) return hit;
    const fs = facts(db);
    const out = new Map<string, Path>();
    for (const f of fs) {
      if (f.a !== "path/title" || typeof f.e !== "string") continue;
      const p = fromFacts(f.e, fs);
      if (p) out.set(f.e, p);
    }
    pathsCache.set(db, out);
    return out;
  };
  // Versions: every transaction that changed a path's structure, tracked as authored transactions land.
  const versions = new Map<string, Array<number>>();
  // Content versions (D33): the last transaction that changed each message, by the same rule as structure.
  const contentAt = new Map<string, number>();
  const track = (tx: Tx) => {
    for (const id of paths().keys()) if (tx.datoms.some((d) => isStructure(id, d))) versions.set(id, [...(versions.get(id) ?? []), tx.t]);
    for (const d of tx.datoms) if (typeof d.e === "string" && d.e.startsWith(MESSAGE)) contentAt.set(d.e.slice(MESSAGE.length).split("/")[0] ?? "", tx.t);
  };
  // Deliveries already written, by key: a second delivery with the same key only updates its status.
  const delivered = new Map<string, string>();
  // The message a send picks for this person: its vary case for their value, else the else, else its own key.
  const messageFor = (s: Send, person: string, w: World): string => {
    if (!s.vary) return s.key;
    const v = answer(w, person, s.vary.dim);
    return s.vary.cases.find((c) => c.value === v)?.message ?? s.vary.else ?? s.key;
  };
  const latest = (id: string) => versions.get(id)?.at(-1) ?? 0;
  const structure = new Map<string, Path | undefined>();
  // The path as one version had it, with today's holds: a hold reaches everyone on the path.
  const pathOf = (id: string, v: number): Path | undefined => {
    const k = versionId(id, v);
    if (!structure.has(k)) structure.set(k, opts.structures?.(id, v) ?? fromFacts(id, facts(asOf(db, v))));
    const s = structure.get(k);
    return s ? { ...s, holds: paths().get(id)?.holds ?? [] } : undefined;
  };
  const runPath = (r: Run) => pathOf(r.path, r.version);
  const sendDue = (r: Run, s: Send): number | undefined => {
    const d = r.deferred.get(s.key);
    if (d !== undefined) return d;
    if (s.after !== undefined) return r.stateAt + s.after;
    const on = s.on === undefined ? undefined : dateMs(s.on);
    // A calendar send goes to whoever is in the state at that instant.
    return on === undefined || on < r.stateAt ? undefined : on;
  };
  const world = (): World => ({
    facts: facts(db),
    history: history(db),
    due: (person, path, within) => {
      const r = runs.get(`${person}|${path}`);
      const p = r ? runPath(r) : undefined;
      const st = p?.states.find((s) => s.name === r?.state);
      return !!r && !!st && st.sends.some((s) => !r.handled.has(s.key) && (sendDue(r, s) ?? Infinity) <= now + within);
    },
  });

  // Who can receive what. email needs an address, site an account, and sms a number plus consent
  // that came from an asked or observed transaction. Missing consent is a hard stop: a text can't be unsent.
  const consented = (person: string): boolean => {
    const h = history(db);
    const d = [...h].reverse().find((x) => x.e === person && x.a === "person/sms-consent");
    if (!d || !d.added || d.v !== true) return false;
    const src = h.find((x) => x.e === d.tx && x.a === "tx/source")?.v;
    const name = src instanceof Kw ? src.name : String(src ?? "");
    return name === "asked" || name === "observed";
  };
  const reach = (person: string, ch: string, w: World): string | undefined => {
    if (ch === "email") return fact(w, person, "person/email") === undefined ? "no address" : undefined;
    if (ch === "site") return fact(w, person, "person/account") === true ? undefined : "no site account";
    if (ch === "sms") return fact(w, person, "person/phone") === undefined ? "no phone number" : consented(person) ? undefined : "no sms consent";
    return "unknown channel";
  };
  // A stated channel preference: the person's value on the built-in dimension channel, from an asked transaction.
  const preference = (person: string): { readonly channel: string; readonly asked: boolean } | undefined => {
    const h = history(db);
    const d = [...h].reverse().find((x) => x.e === person && x.a === "person/channel");
    if (!d || !d.added) return undefined;
    const src = h.find((x) => x.e === d.tx && x.a === "tx/source")?.v;
    return { channel: d.v instanceof Kw ? d.v.name : String(d.v), asked: (src instanceof Kw ? src.name : String(src ?? "")) === "asked" };
  };
  // :via picks channels. and/one takes every one the person can receive. Inside (or …) the path sets the
  // allowed channels and the person picks: an asked preference wins, else the written order (D24).
  // A preference never adds a channel the path didn't list, and an inferred one never reorders anything.
  const channels = (s: Send, person: string, w: World) => {
    const via = s.via ?? { channels: ["email"] };
    const why = new Map(via.channels.map((ch) => [ch, reach(person, ch, w)]));
    const ok = via.channels.filter((ch) => why.get(ch) === undefined);
    const pref = via.op === "or" ? preference(person) : undefined;
    const listed = pref !== undefined && via.channels.includes(pref.channel);
    const picked = pref?.asked && listed && ok.includes(pref.channel) ? pref.channel : undefined;
    const use = via.op === "or" ? (picked ? [picked] : ok.slice(0, 1)) : ok;
    const passed = via.channels.filter((ch) => !use.includes(ch) && why.get(ch) !== undefined).map((ch) => `${ch}: ${why.get(ch)}`);
    const notes = [
      ...(picked ? [`prefers ${picked}, asked`] : []),
      ...(pref && !pref.asked && listed ? [`inferred preference for ${pref.channel} ignored; written order`] : []),
      ...(pref && pref.asked && !listed ? [`prefers ${pref.channel}, which this send doesn't list`] : []),
      ...passed,
    ];
    return { use, passed: notes, via: printVia(via) };
  };

  // Path events at one instant, grouped into one transaction per path and cause.
  const batch = new Map<string, { why: string; ops: Array<Op> }>();
  const note = (path: string, why: string, ops: ReadonlyArray<Op>) => {
    const k = `${path}\u0000${why}`;
    const b = batch.get(k) ?? { why, ops: [] };
    b.ops.push(...ops);
    batch.set(k, b);
  };
  const flush = (): boolean => {
    const wrote = batch.size > 0;
    for (const { why, ops } of batch.values()) {
      // The cursor is a fact: every path event also records the last transaction handled.
      const cursor: Op = { e: "halter", a: "log/cursor", v: basis(db), added: true };
      const r = transact(db, { who: HALTER, at: msDate(now), why, source: "observed", ops: [...ops, cursor] });
      if (!r.ok) throw new Error(`${r.error} (${why})`);
      db = r.db;
    }
    batch.clear();
    return wrote;
  };

  // Sends that came due during a hold and never went out are missed when their state ends.
  const missed = (r: Run) => {
    const late = [...r.held].filter((k) => !r.handled.has(k));
    if (late.length) note(r.path, `${r.path}: came due during a hold, and state ${r.state} ended`, late.map((k) => add(r.person, "send/missed", `${r.path}/${k}`)));
  };
  const leave = (r: Run, a: "path/finished" | "path/exited", why: string) => {
    missed(r);
    // Nothing out means passed, not finished (D34): reaching done with no sent delivery on the path
    // writes :path/passed, so a successor on finished? never asks about a pitch they never got.
    const out = a === "path/finished" ? outcome(r) : { a, why: "" };
    note(r.path, `${why}${out.why}`, [add(r.person, out.a, r.path), drop(r.person, "path/at", `${r.path}/${r.state}`)]);
    runs.delete(`${r.person}|${r.path}`);
  };
  // What a person got on a path: sent deliveries, skipped and missed sends, from the log and this instant's batch.
  const outcome = (r: Run): { a: "path/finished" | "path/passed"; why: string } => {
    const pending = [...batch.values()].flatMap((b) => b.ops);
    const fs = [...facts(db), ...pending.filter((o) => o.added)];
    const onPath = (v: unknown) => String(v).startsWith(`${r.path}/`);
    const sentIds = new Set(fs.filter((f) => f.a === "delivery/person" && f.v === r.person).map((f) => String(f.e)));
    const sent = fs.filter((f) => f.a === "delivery/send" && sentIds.has(String(f.e)) && onPath(f.v) && fs.some((g) => g.e === f.e && g.a === "delivery/status" && g.v instanceof Kw && g.v.name === "sent")).length;
    const count = (attr: string) => new Set(fs.filter((f) => f.e === r.person && f.a === attr && onPath(f.v)).map((f) => String(f.v))).size;
    // one shared why, so everyone finishing at one instant lands in one transaction
    if (sent > 0) return { a: "path/finished", why: `; ${r.path} reached done and finished: a delivery went out` };
    const skipped = count("send/skipped");
    const late = count("send/missed");
    const total = skipped + late;
    const how =
      total === 0 ? "it has no sends" : late === 0 ? `all ${total} sends were skipped` : skipped === 0 ? `all ${total} sends were missed` : `${skipped} sends were skipped and ${late} missed`;
    return { a: "path/passed", why: `; ${r.path} reached done and passed: nothing went out, ${how}` };
  };
  const move = (r: Run, p: Path, target: string, why: string) => {
    if (target === "closed" || !p.states.some((s) => s.name === target)) return leave(r, "path/finished", why);
    missed(r);
    note(r.path, why, [drop(r.person, "path/at", `${r.path}/${r.state}`), add(r.person, "path/at", `${r.path}/${target}`)]);
    Object.assign(r, { state: target, stateAt: now, lastAt: now, handled: new Set(), deferred: new Map(), held: new Set(), defers: 0 });
  };

  // A move: who it takes, onto which version, and in which state. Checked before anyone is moved.
  const plan = (m: Move) => {
    const to = m.toVersion ?? latest(m.path);
    if (!(versions.get(m.path) ?? []).includes(to)) throw new Error(`refused: t=${to} isn't a version of ${m.path} (${moveText(m)})`);
    const target = pathOf(m.path, to);
    const taken = [...runs.values()].filter((r) => r.path === m.path && (m.fromVersion === undefined || r.version === m.fromVersion) && (m.from === undefined || r.state === m.from));
    const place = (r: Run) => m.to ?? m.map?.find(([old]) => old === r.state)?.[1] ?? r.state;
    for (const r of taken) {
      const s = place(r);
      if (!target?.states.some((x) => x.name === s)) throw new Error(`refused: state ${s} isn't in version ${to} of ${m.path}; map it with :map`);
    }
    // A told deadline is locked (D38): anyone this move takes keeps every instant they were told.
    const broken: Array<Broken> = taken.flatMap((r) =>
      [...(r.told ?? [])].flatMap(([event, told]) => {
        const s = place(r);
        // :to starts the new state now, as the rebase does
        const after = eventInstant(target, event, s, m.to !== undefined && s !== r.state ? now : r.stateAt);
        // a per-person window they've already left closed when they left it; nothing can move that
        if (after === undefined && eventInstant(runPath(r), event, r.state, r.stateAt) === undefined) return [];
        return after === told ? [] : [{ person: r.person, event, told, now: after }];
      }),
    );
    const refused = deadlineRefusal(m.path, broken);
    if (refused) throw new Error(refused);
    return { to, taken, place };
  };
  // Rebase each run: they keep their state and the instant they entered it, sends they've had stay had
  // (matched by key), and a send the new version makes overdue is missed, never late.
  const rebase = (m: Move, p: ReturnType<typeof plan>, txT: number) => {
    const why = `${m.path}: moved by t=${txT}, ${moveText(m)}`;
    for (const r of p.taken) {
      const v = opts.versions?.(r.person, r.path, now) ?? p.to;
      const s = p.place(r);
      const ops: Array<Op> = [];
      if (v !== r.version) ops.push(drop(r.person, "path/version", versionId(r.path, r.version)), add(r.person, "path/version", versionId(r.path, v)));
      if (s !== r.state) ops.push(drop(r.person, "path/at", `${r.path}/${r.state}`), add(r.person, "path/at", `${r.path}/${s}`));
      if (ops.length === 0) continue;
      r.version = v;
      if (s !== r.state && m.to !== undefined) {
        // :to places them in a new state, which starts now
        missed(r);
        Object.assign(r, { state: s, stateAt: now, lastAt: now, handled: new Set(), deferred: new Map(), held: new Set(), defers: 0 });
      } else r.state = s;
      const st = runPath(r)?.states.find((x) => x.name === r.state);
      const late = (st?.sends ?? []).filter((x) => {
        if (r.handled.has(x.key) || r.deferred.has(x.key)) return false;
        const due = x.after !== undefined ? r.stateAt + x.after : x.on === undefined ? undefined : dateMs(x.on);
        return due !== undefined && due >= r.stateAt && due < now;
      });
      for (const x of late) r.handled.add(x.key);
      note(r.path, why, [...ops, ...late.map((x) => add(r.person, "send/missed", `${r.path}/${x.key}`))]);
      const key = `${r.person}|${r.path}`;
      const wa = watches.get(key);
      const tg = runPath(r)?.target;
      if (wa) watches.set(key, { person: wa.person, path: wa.path, enteredAt: wa.enteredAt, version: v, ...(tg?.within === undefined ? {} : { until: wa.enteredAt + tg.within }) });
    }
  };

  // Fresh evidence: enters-on fires on the transaction that makes it true, and only
  // transactions after the path went live count, unless :since reaches further back.
  const liveAt = new Map<string, number>();
  const goLive = (id: string) => {
    let t = liveAt.get(id);
    if (t === undefined) {
      const first = db.log.find((x) => x.datoms.some((d) => d.e === id && d.a === "path/title" && d.added));
      t = dateMs(first?.at ?? "") ?? now;
      liveAt.set(id, t);
    }
    return t;
  };
  const before = new Map<number, World>();
  const worldBefore = (cutoff: number): World => {
    let w = before.get(cutoff);
    if (!w) {
      const t = [...db.log].reverse().find((x) => (dateMs(x.at) ?? 0) < cutoff)?.t ?? 0;
      const d = asOf(db, t);
      w = { facts: facts(d), history: history(d) };
      before.set(cutoff, w);
    }
    return w;
  };

  // React to the transaction that just landed, until nothing more changes at this instant.
  const react = () => {
    for (let lap = 0; lap < 8; lap++) {
      const ps = paths();
      const w = world();
      for (const r of [...runs.values()]) {
        const p = runPath(r);
        if (!p) continue;
        if (p.exitOn && holds(p.exitOn, r.person, w)) {
          leave(r, "path/exited", `${r.path}: (exit-on ${printPred(p.exitOn)}) held`);
          continue;
        }
        const to = p.states.find((s) => s.name === r.state)?.tos.find((t) => t.when && holds(t.when, r.person, w));
        if (to?.when) move(r, p, to.target, `${r.path}: (to ${to.target} :when ${printPred(to.when)}) held`);
      }
      for (const p of ps.values()) {
        const first = p.states[0];
        if (!p.entersOn || !first) continue;
        for (const person of people(w)) {
          if (opts.only !== undefined && person !== opts.only) continue;
          if (runs.has(`${person}|${p.id}`) || w.facts.some((f) => f.e === person && f.a === "path/entered" && f.v === p.id)) continue;
          if (!holds(p.entersOn, person, w)) continue;
          const cutoff = p.since === undefined ? goLive(p.id) : (dateMs(p.since) ?? 0);
          if (cutoff > now || holds(p.entersOn, person, worldBefore(cutoff))) continue;
          // They run the structure as of the last change before they entered: their version.
          const version = opts.versions?.(person, p.id, now) ?? latest(p.id);
          const vp = pathOf(p.id, version) ?? p;
          const start = vp.states[0] ?? first;
          note(p.id, `${p.id}: (enters-on ${printPred(p.entersOn)}) held`, [add(person, "path/entered", p.id), add(person, "path/version", versionId(p.id, version)), add(person, "path/at", `${p.id}/${start.name}`)]);
          runs.set(`${person}|${p.id}`, { person, path: p.id, version, state: start.name, stateAt: now, lastAt: now, handled: new Set(), deferred: new Map(), held: new Set(), defers: 0 });
          if (vp.target) watches.set(`${person}|${p.id}`, { person, path: p.id, enteredAt: now, version, ...(vp.target.within === undefined ? {} : { until: now + vp.target.within }) });
        }
      }
      // Targets: fresh means true now and not before this person entered this path.
      for (const [k, wa] of [...watches]) {
        const tg = pathOf(wa.path, wa.version)?.target;
        if (!tg || !holds(tg.pred, wa.person, w) || holds(tg.pred, wa.person, worldBefore(wa.enteredAt))) continue;
        note(wa.path, `${wa.path}: (target ${printPred(tg.pred)}) held`, [add(wa.person, "path/reached-target", wa.path)]);
        watches.delete(k);
      }
      if (!flush()) return;
    }
  };

  const timers = (): Array<Timer> => {
    const out: Array<Timer> = [];
    for (const r of runs.values()) {
      const p = runPath(r);
      const st = p?.states.find((s) => s.name === r.state);
      if (!p || !st) continue;
      const pending = st.sends.filter((s) => !r.handled.has(s.key));
      for (const s of pending) {
        const at = sendDue(r, s);
        if (at === undefined) r.handled.add(s.key);
        else out.push({ at, run: r, kind: "send", send: s });
      }
      for (const t of st.tos) if (t.after !== undefined) out.push({ at: r.stateAt + t.after, run: r, kind: "move", target: t.target, why: `${r.path}: (to ${t.target} :after ${duration(t.after)}) came due` });
      // A state with no to ends after its last send; states run in the order written.
      if (st.tos.length === 0 && st.sends.every((s) => r.handled.has(s.key))) {
        const next = p.states[p.states.indexOf(st) + 1];
        out.push({ at: r.lastAt, run: r, kind: "move", target: next?.name ?? "closed", why: `${r.path}: state ${st.name} sent its last message` });
      }
    }
    for (const wa of watches.values()) if (wa.until !== undefined) out.push({ at: wa.until, kind: "miss", watch: wa });
    return out;
  };

  const fire = (until: number) => {
    for (let guard = 0; guard < 5000; guard++) {
      const ts = timers();
      const at = Math.min(...ts.map((t) => t.at));
      if (!Number.isFinite(at) || at >= until) return;
      now = Math.max(now, at);
      const w = world();
      const due = ts.filter((t) => t.at === at);
      for (const t of due.filter((x) => x.kind === "send")) {
        if (t.kind !== "send") continue;
        const r = t.run;
        const p = runPath(r);
        if (!p || !runs.has(`${r.person}|${r.path}`)) continue;
        const ref = `${r.path}/${t.send.key}`;
        const closes = p.offer?.closes === undefined ? undefined : dateMs(p.offer.closes);
        // One decision, in a fixed order: hard stops, holds, guards, pace, deliver.
        const ch = channels(t.send, r.person, w);
        if (ch.use.length === 0) {
          r.handled.add(t.send.key);
          r.lastAt = now;
          note(r.path, `${r.path}: ${t.send.key} skipped, no-channel: :via ${ch.via} reaches nobody here (${ch.passed.join("; ")})`, [add(r.person, "send/skipped", ref)]);
          continue;
        }
        const holdEnd = Math.max(...p.holds.map((h) => dateMs(h) ?? 0).filter((h) => h > now), -Infinity);
        if (Number.isFinite(holdEnd) && !(closes !== undefined && now > closes)) {
          // A hold stops delivery, not thinking. Overdue sends come out one per pace tick after it.
          r.held.add(t.send.key);
          r.deferred.set(t.send.key, holdEnd + 60_000 * [...r.held].filter((k) => !r.handled.has(k)).indexOf(t.send.key));
          continue;
        }
        const g = p.guard.find((c) => holds(c.when, r.person, w));
        r.handled.add(t.send.key);
        r.lastAt = now;
        if (closes !== undefined && now > closes && t.send.job !== "survey") note(r.path, `${r.path}: the offer closed before ${t.send.key} could go`, [add(r.person, "send/skipped", ref)]);
        else if (g?.action === "skip") note(r.path, `${r.path}: guard (when ${printPred(g.when)} ${printAction(g)})`, [add(r.person, "send/skipped", ref)]);
        else if (g?.action === "defer" && r.defers < 12) {
          r.handled.delete(t.send.key);
          r.deferred.set(t.send.key, now + (g.for ?? 3_600_000));
          r.defers++;
        } else {
          // Content is read at delivery: the site page is whatever the message says now, and each delivery
          // records the content version it read, so the log says exactly what this person got (D33).
          const message = messageFor(t.send, r.person, w);
          const page = ch.use.includes("site") ? fact(w, renditionId(message, "site"), "rendition/page") : undefined;
          const how = `deliver succeeded via ${ch.use.join(" and ")}${ch.passed.length ? ` (${ch.passed.join("; ")})` : ""}`;
          const receipts = ch.use.flatMap((via) => {
            const ops = deliveryOps((k) => delivered.get(k), { person: r.person, send: ref, message, content: contentAt.get(message) ?? 0, via, status: "sent" });
            const e = ops.find((o) => o.a === "delivery/key");
            if (e) delivered.set(String(e.v), String(e.e));
            return ops;
          });
          // a deadline send that went out tells this person its instant, under the version they run now
          if (t.send.deadline) {
            const at = eventInstant(runPath(r), t.send.deadline, r.state, r.stateAt);
            if (at !== undefined && !r.told?.has(t.send.deadline)) r.told = new Map([...(r.told ?? []), [t.send.deadline, at]]);
          }
          note(r.path, `${r.path}: ${how}`, [add(r.person, "send/sent", ref), ...receipts, ...(typeof page === "string" ? [add(r.person, "person/access", page)] : [])]);
        }
      }
      if (flush()) react();
      for (const t of due) {
        if (t.kind !== "miss" || watches.get(`${t.watch.person}|${t.watch.path}`) !== t.watch) continue;
        const tg = pathOf(t.watch.path, t.watch.version)?.target;
        note(t.watch.path, `${t.watch.path}: :within ${duration(tg?.within ?? 0)} ran out before (target ${tg ? printPred(tg.pred) : "…"}) held`, [add(t.watch.person, "path/missed-target", t.watch.path)]);
        watches.delete(`${t.watch.person}|${t.watch.path}`);
      }
      for (const t of due.filter((x) => x.kind === "move")) {
        if (t.kind !== "move") continue;
        const r = t.run;
        const p = runPath(r);
        if (p && runs.get(`${r.person}|${r.path}`) === r) move(r, p, t.target, t.why);
      }
      if (flush()) react();
    }
  };

  for (const input of [...authored].sort((x, y) => (dateMs(x.at) ?? 0) - (dateMs(y.at) ?? 0))) {
    const at = dateMs(input.at) ?? 0;
    fire(at);
    now = Math.max(now, at);
    const r = transact(db, input);
    if (!r.ok) throw new Error(`${r.error} (${input.why})`);
    db = r.db;
    track(r.tx);
    const moves = input.moves ?? [];
    // A move that would leave anyone without a state refuses the whole transaction.
    const plans = moves.map((m) => plan(m));
    plans.forEach((p, i) => rebase(moves[i]!, p, r.tx.t));
    react();
  }
  fire(dateMs(horizon) ?? 0);
  return db;
};
