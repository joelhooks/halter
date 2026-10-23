// The facts are the truth. A db is a log of transactions; everything else is a view of it.

export class Kw {
  private static readonly interned = new Map<string, Kw>();
  private constructor(readonly name: string) {}
  static of(name: string): Kw {
    let k = Kw.interned.get(name);
    if (k === undefined) {
      k = new Kw(name);
      Kw.interned.set(name, k);
    }
    return k;
  }
  toString(): string {
    return this.name;
  }
}
export const kw = (n: string): Kw => Kw.of(n);

export type Val = string | number | boolean | Kw;
export type Eid = string | number;

export type AttrType = "string" | "keyword" | "number" | "boolean" | "date" | "duration" | "ref";
export interface Attr {
  readonly ident: string;
  readonly type: AttrType;
  readonly many: boolean;
  readonly doc: string;
  // one entity per value: asserting it on a second entity is refused
  readonly unique?: boolean;
}

export interface Triple {
  readonly e: Eid;
  readonly a: string;
  readonly v: Val;
}
export interface Datom extends Triple {
  readonly tx: number;
  readonly added: boolean;
}
export const SOURCES = ["asked", "observed", "inferred", "assumed"] as const;
export type EvidenceKind = (typeof SOURCES)[number];
export interface Tx {
  readonly t: number;
  readonly who: string;
  readonly at: string;
  readonly why: string;
  readonly source: EvidenceKind;
  readonly rule?: string;
  readonly datoms: ReadonlyArray<Datom>;
}
export interface Db {
  readonly log: ReadonlyArray<Tx>;
}
export interface Op extends Triple {
  readonly added: boolean;
}
// A move rebases people on a path onto another version of its structure (D32). It's a transaction op,
// so the transaction's why must quote a person. The interpreter applies it; the log keeps it as tx/move.
export interface Move {
  readonly path: string;
  readonly toVersion?: number;
  readonly fromVersion?: number;
  readonly from?: string;
  readonly to?: string;
  readonly map?: ReadonlyArray<readonly [string, string]>;
}
export const moveText = (m: Move): string =>
  `(move ${JSON.stringify(m.path)}${m.toVersion === undefined ? "" : ` :to-version ${m.toVersion}`}${m.fromVersion === undefined ? "" : ` :from-version ${m.fromVersion}`}${m.from === undefined ? "" : ` :from ${m.from}`}${m.to === undefined ? "" : ` :to ${m.to}`}${m.map?.length ? ` :map (${m.map.map(([o, n]) => `(${o} ${n})`).join(" ")})` : ""})`;
const QUOTED = /“[^”]+”|"[^"]+"/;
export const quotes = (why: string): boolean => QUOTED.test(why);
// A waiver or a move needs one of two kinds of why (D35): words in quotes, or an inferred tx naming
// its :rule, the evidence a rule acted on. Nothing writes words for anyone.
export const validWhy = (x: { readonly why: string; readonly source: string; readonly rule?: string | undefined }): boolean =>
  quotes(x.why) || (x.source === "inferred" && !!x.rule?.trim());

export interface TxInput {
  readonly who: string;
  readonly at: string;
  readonly why: string;
  readonly source: EvidenceKind;
  readonly rule?: string;
  readonly ops: ReadonlyArray<Op>;
  readonly undoes?: number;
  readonly moves?: ReadonlyArray<Move>;
}
export type Transacted = { readonly ok: true; readonly db: Db; readonly tx: Tx } | { readonly ok: false; readonly error: string };

const a = (ident: string, type: AttrType, doc: string, many = false, unique = false): Attr => ({ ident, type, many, doc, ...(unique ? { unique } : {}) });

// The schema, as data. Transaction 1 writes it into the db as facts, so queries can join on it.
export const SCHEMA: ReadonlyArray<Attr> = [
  a("db/type", "keyword", "the value type of an attribute"),
  a("db/card", "keyword", "one or many"),
  a("db/doc", "string", "what the attribute means"),
  a("tx/who", "string", "who made the change"),
  a("tx/at", "date", "when, on the sketch's fake clock"),
  a("tx/why", "string", "the quoted words that justify the change"),
  a("tx/source", "keyword", "how we know: asked, observed, inferred or assumed"),
  a("tx/rule", "string", "the rule that derived an inferred value"),
  a("tx/undoes", "number", "the transaction this one reverses"),
  a("tx/move", "string", "a move op this transaction carries, as printed; the interpreter rebases people", true),
  a("seen/path", "string", "a person's cursor on a path's feed, PATH@TX: they've seen everything up to TX (D37)", true),
  a("list/name", "string", "a mailing list"),
  a("list/slug", "string", "the list's id in the Lisp"),
  a("product/name", "string", "what people buy"),
  a("product/slug", "string", "the product's id in the Lisp"),
  a("product/kind", "keyword", "cohort, self-paced or bundle"),
  a("product/buyer-tag", "string", "the tag a buyer gets"),
  a("course/name", "string", "a free course"),
  a("course/slug", "string", "the course's id in the Lisp"),
  a("lesson/course", "ref", "the course a lesson belongs to"),
  a("lesson/n", "number", "the lesson's number"),
  a("lesson/title", "string", "the lesson's title"),
  a("dim/name", "string", "a dimension people are segmented by"),
  a("dim/values", "keyword", "the values it may take", true),
  a("dim/many", "boolean", "true when a person may hold several values"),
  a("person/name", "string", "a fake recipient"),
  a("person/email", "string", "an example.com or example.org address"),
  a("person/lists", "ref", "lists the person is on", true),
  a("person/tags", "string", "tags on the person", true),
  a("path/entered", "string", "path event: the person entered this path", true),
  a("path/at", "string", "path event: the PATH/STATE the person is in, one per path; history keeps the trail", true),
  a("path/version", "string", "path event: PATH@TX, the structure version the person runs, one per path; history keeps every version", true),
  a("send/sent", "string", "path event: deliver succeeded for this PATH/MESSAGE", true),
  a("send/skipped", "string", "path event: a guard skipped this PATH/MESSAGE; the tx why holds the reason", true),
  a("path/finished", "string", "path event: the person reached done on this path, and at least one delivery went out", true),
  a("path/passed", "string", "path event: the person reached done on this path, and no delivery was sent (D34)", true),
  a("path/exited", "string", "path event: exit-on fired on this path", true),
  a("path/reached-target", "string", "path event: this path's target turned true inside its window", true),
  a("path/missed-target", "string", "path event: this path's target window ended while it was false", true),
  a("send/missed", "string", "path event: the send came due during a hold or outage, and its state had already ended", true),
  // Deliveries (D33): each is its own entity, one per person, send and channel, written with the path event.
  a("delivery/person", "ref", "the person the delivery went to"),
  a("delivery/send", "string", "the send in the structure, as PATH/KEY"),
  a("delivery/message", "string", "the message that went out; after a vary, the variant the person got"),
  a("delivery/content", "number", "the content version: the last transaction that changed this channel's rendition before it went out"),
  a("delivery/via", "keyword", "the one channel this delivery used"),
  a("delivery/status", "keyword", "sent when the provider confirmed it, uncertain when it never did"),
  a("delivery/key", "string", "PERSON|PATH/KEY|CHANNEL: one delivery per person, send and channel", false, true),
  // Acts (D39): each world act is its own entity, and records when it happened, which can differ from when it was written.
  a("act/person", "ref", "the person who did it"),
  a("act/kind", "keyword", "bought, finished, did or answered"),
  a("act/of", "string", "the product, course or act it's about; for answered, the dimension"),
  a("act/at", "date", "when it happened; freshness reads this, never the transaction"),
  a("act/source", "keyword", "how we know, from the transaction that first wrote the act; a correction doesn't change it"),
  a("act/value", "keyword", "an answered act's value; a person's value for the dimension follows their latest answered act"),
  // A refusal at run (D40): the interpreter stopped one send for one person, and how.
  a("refusal/person", "ref", "the person the refusal named"),
  a("refusal/send", "string", "the send it stopped, as PATH/KEY"),
  a("refusal/key", "string", "the send's key"),
  a("refusal/check", "string", "the refusal that was true for this person and this send"),
  a("refusal/outcome", "keyword", "else when the vary's safe else went out instead, skipped when nothing went"),
  a("log/cursor", "number", "the interpreter has handled every transaction up to this one"),
  a("person/synthetic", "boolean", "a fake person who only runs in simulations"),
  a("person/phone", "string", "a fictional 555-01xx number; sms also needs consent"),
  a("person/sms-consent", "boolean", "they agreed to texts; only an asked or observed transaction counts"),
  a("person/account", "boolean", "they have a site account, so the site channel can reach them"),
  a("person/access", "string", "path event: a site page or lesson the person can now open", true),
  a("path/title", "string", "a human name"),
  a("path/list", "ref", "the list the path draws from"),
  a("path/enters-on", "ref", "the predicate that lets a person in"),
  a("path/enters-since", "date", "older facts count toward enters-on back to this instant"),
  a("path/hold-until", "date", "delivery on this path stops until this instant", true),
  a("path/exit-on", "ref", "the predicate that takes a person out"),
  a("path/target", "ref", "the person's real result: a predicate the path is measured on"),
  a("path/target-within", "duration", "how long after entry the target is watched"),
  a("path/rate", "number", "starting sends per minute"),
  a("path/ramp-to", "number", "ramp ceiling per minute"),
  a("path/ramp-step", "number", "ramp step per minute"),
  a("path/ramp-every", "duration", "how often the ramp steps"),
  a("path/waives", "string", "a check the path waives; the tx why quotes who decided", true),
  a("offer/path", "ref", "the path that makes this offer"),
  a("offer/product", "ref", "the product on offer"),
  a("offer/pricing", "string", "a named pricing version, never a number"),
  a("offer/opens", "date", "the calendar window opens"),
  a("offer/closes", "date", "the calendar window closes"),
  a("offer/window-state", "keyword", "the offer is open while a person is in this state"),
  a("offer/early-bird-until", "date", "the pricing version flips"),
  a("offer/class-starts", "date", "the cohort actually starts"),
  a("offer/bonus", "ref", "a product given free with this offer"),
  a("state/path", "ref", "the path a state belongs to"),
  a("state/name", "keyword", "the state's name"),
  a("state/rank", "number", "the state's place in the path"),
  a("to/state", "ref", "the state a transition leaves"),
  a("to/rank", "number", "the transition's place in its state"),
  a("to/target", "keyword", "where the person goes next"),
  a("to/after", "duration", "move after this long in the state"),
  a("to/when", "ref", "move when this predicate becomes true"),
  a("send/path", "ref", "the path a send belongs to"),
  a("send/state", "ref", "the state a send belongs to"),
  a("send/key", "string", "the message id"),
  a("send/rank", "number", "the send's place in the path, as written"),
  a("send/job", "keyword", "teach, pain, dream, fix, announce-pitch, proof, faq, urgency, last-call, survey or support"),
  a("send/on", "date", "a calendar instant"),
  a("send/after", "duration", "time after entering the send's state"),
  a("send/deadline", "keyword", "the event an urgency or last-call send points at"),
  a("send/vary-by", "ref", "the dimension the copy varies by"),
  a("send/vary-hard", "boolean", "true when the copy states who the person is"),
  a("send/vary-else", "string", "the message for everyone else"),
  a("send/via-op", "keyword", "or: the first channel the person can receive; and: every channel. Absent for one channel"),
  a("via/send", "ref", "the send this channel belongs to"),
  a("via/rank", "number", "the channel's place in :via; or tries them in this order"),
  a("via/channel", "keyword", "email, sms or site"),
  a("message/id", "string", "content: the id a send or a vary names"),
  a("rendition/message", "ref", "the message this rendition belongs to"),
  a("rendition/channel", "keyword", "email, sms or site"),
  a("rendition/subject", "string", "an email subject"),
  a("rendition/body", "string", "a content ref for the body, never inline text"),
  a("rendition/page", "string", "the site page or lesson the person can now open"),
  a("variant/send", "ref", "the send a variant belongs to"),
  a("variant/rank", "number", "the variant's place"),
  a("variant/value", "keyword", "the dimension value it answers"),
  a("variant/message", "string", "the message id for that value"),
  a("guard/path", "ref", "the path whose guard holds the clause"),
  a("guard/rank", "number", "position in the guard; first match wins"),
  a("guard/when", "ref", "the predicate this clause matches on"),
  a("guard/action", "keyword", "skip or defer"),
  a("guard/reason", "string", "why a skip happens"),
  a("guard/for", "duration", "how long a defer waits"),
  a("pred/name", "keyword", "a predicate, ending in ?"),
  a("pred/parent", "ref", "the and, or or not this predicate sits inside"),
  a("pred/rank", "number", "position inside its parent"),
  a("pred/arg", "string", "the predicate's first argument"),
  a("pred/arg2", "string", "the predicate's second argument"),
  a("pred/within", "duration", "the window for due?"),
];
export const ATTRS = new Map(SCHEMA.map((attr) => [attr.ident, attr]));

// Instants are UTC to the minute: "2027-03-02T17:00Z".
const DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/;
export const dateMs = (s: string): number | undefined => {
  const m = DATE.exec(s);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "00", m[5] ?? "00"].map(Number) as [number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && h < 24 && mi < 60 ? ms : undefined;
};
export const msDate = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`;

export const valKey = (v: Val): string =>
  v instanceof Kw ? `k:${v.name}` : typeof v === "string" ? `s:${v}` : typeof v === "number" ? `n:${v}` : `b:${v}`;

const typeError = (attr: Attr, v: Val): string | undefined => {
  switch (attr.type) {
    case "string":
      return typeof v === "string" ? undefined : "a string";
    case "keyword":
      return v instanceof Kw ? undefined : "a keyword";
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? undefined : "a number";
    case "boolean":
      return typeof v === "boolean" ? undefined : "true or false";
    case "date":
      return typeof v === "string" && dateMs(v) !== undefined ? undefined : "an instant like 2027-03-02T17:00Z";
    case "duration":
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v % 60_000 === 0 ? undefined : "a whole number of minutes";
    case "ref":
      return (typeof v === "string" && v !== "") || typeof v === "number" ? undefined : "an entity id";
  }
};

export const empty: Db = { log: [] };
export const basis = (db: Db): number => db.log.at(-1)?.t ?? 0;

// Current state: card-one keeps one value, card-many keeps a set. Retractions remove.
interface Cell {
  readonly e: Eid;
  readonly a: string;
  readonly vals: Map<string, Val>;
}
type State = Map<string, Cell>;
const slot = (e: Eid, attr: string) => `${typeof e}:${e}\u0000${attr}`;

const stateCache = new WeakMap<Db, State>();
const stateOf = (db: Db): State => {
  const hit = stateCache.get(db);
  if (hit) return hit;
  const state: State = new Map();
  for (const tx of db.log) apply(state, tx.datoms);
  stateCache.set(db, state);
  return state;
};
const apply = (state: State, datoms: ReadonlyArray<Datom>) => {
  for (const d of datoms) {
    const key = slot(d.e, d.a);
    const old = state.get(key);
    const vals = new Map(old?.vals ?? []);
    if (d.added) vals.set(valKey(d.v), d.v);
    else vals.delete(valKey(d.v));
    if (vals.size === 0) state.delete(key);
    else state.set(key, { e: d.e, a: d.a, vals });
  }
};

export const facts = (db: Db): Array<Triple> => {
  const out: Array<Triple> = [];
  for (const { e, a, vals } of stateOf(db).values()) for (const v of vals.values()) out.push({ e, a, v });
  return sortTriples(out);
};

export const tripleKey = (t: Triple) => `${typeof t.e}:${t.e}\u0000${t.a}\u0000${valKey(t.v)}`;
export const sortTriples = (ts: ReadonlyArray<Triple>): Array<Triple> => [...ts].sort((x, y) => (tripleKey(x) < tripleKey(y) ? -1 : tripleKey(x) > tripleKey(y) ? 1 : 0));

export const history = (db: Db): Array<Datom> => db.log.flatMap((tx) => tx.datoms);

export const asOf = (db: Db, t: number): Db => ({ log: db.log.filter((tx) => tx.t <= t) });

export const transact = (db: Db, input: TxInput): Transacted => {
  if (input.why.trim() === "") return { ok: false, error: "refused: a transaction needs a why. Quote the words that justify it." };
  if (input.who.trim() === "") return { ok: false, error: "refused: a transaction needs a who." };
  if (!SOURCES.includes(input.source)) return { ok: false, error: "refused: :tx/source is asked, observed, inferred or assumed" };
  if (input.source === "inferred" && !input.rule?.trim()) return { ok: false, error: "refused: an inferred transaction names its :tx/rule" };
  if (dateMs(input.at) === undefined) return { ok: false, error: `refused: :tx/at ${JSON.stringify(input.at)} is not a date` };
  const t = basis(db) + 1;
  const state = new Map(stateOf(db));
  const out: Array<Datom> = [];
  const ordered = [...input.ops.filter((op) => !op.added), ...input.ops.filter((op) => op.added)];
  for (const raw of ordered) {
    // a cursor written as "PATH@" names the transaction that writes it (D37)
    const op = raw.a === "seen/path" && raw.added && typeof raw.v === "string" && raw.v.endsWith("@") ? { ...raw, v: `${raw.v}${t}` } : raw;
    const attr = ATTRS.get(op.a);
    if (attr === undefined) return { ok: false, error: `refused: no attribute :${op.a} in the schema` };
    if (op.a.startsWith("tx/")) return { ok: false, error: `refused: :${op.a} is written by the transaction itself` };
    const bad = typeError(attr, op.v);
    if (bad) return { ok: false, error: `refused: :${op.a} takes ${bad}` };
    // An act's source is how we first knew it (D39). The transaction that first writes it sets it, and
    // a later correction that retracts and re-asserts the act must assert the same source.
    if (op.a === "act/source" && op.added) {
      const first = db.log.flatMap((x) => x.datoms).find((d) => d.e === op.e && d.a === "act/source" && d.added);
      const want = first ? first.v : kw(input.source);
      if (valKey(want) !== valKey(op.v))
        return {
          ok: false,
          error: first
            ? `refused: :act/source of ${op.e} is ${String(first.v)}, fixed by t=${first.tx}, the transaction that first wrote it; a correction keeps it`
            : `refused: :act/source of a new act is this transaction's source, ${input.source}`,
        };
    }
    const key = slot(op.e, op.a);
    const vals = new Map(state.get(key)?.vals ?? []);
    const vk = valKey(op.v);
    if (!op.added) {
      if (!vals.has(vk)) return { ok: false, error: `refused: can't retract ${op.a} ${vk.slice(2)} from ${op.e}; it isn't there` };
      vals.delete(vk);
      out.push({ e: op.e, a: op.a, v: op.v, tx: t, added: false });
    } else {
      if (attr.unique)
        for (const c of state.values())
          if (c.a === op.a && c.e !== op.e && c.vals.has(vk)) return { ok: false, error: `refused: :${op.a} is unique, and ${String(c.e)} already holds ${vk.slice(2)}` };
      // A redundant assert is dropped, except a waiver: asserting it again is how a person confirms
      // an agent's waiver, so the confirmation lands as its own transaction (D31).
      if (vals.has(vk) && op.a !== "path/waives") continue;
      if (!attr.many) {
        for (const old of vals.values()) out.push({ e: op.e, a: op.a, v: old, tx: t, added: false });
        vals.clear();
      }
      vals.set(vk, op.v);
      out.push({ e: op.e, a: op.a, v: op.v, tx: t, added: true });
    }
    if (vals.size === 0) state.delete(key);
    else state.set(key, { e: op.e, a: op.a, vals });
  }
  const moves = input.moves ?? [];
  if (moves.length > 0 && !validWhy(input))
    return { ok: false, error: "refused: a move changes structure under people, so its why quotes someone's own words, or is :source inferred with a :rule" };
  if (out.length === 0 && moves.length === 0) return { ok: false, error: "refused: nothing to commit; every fact is already true" };
  const meta: Array<Datom> = [
    { e: t, a: "tx/who", v: input.who, tx: t, added: true },
    { e: t, a: "tx/at", v: input.at, tx: t, added: true },
    { e: t, a: "tx/why", v: input.why, tx: t, added: true },
    { e: t, a: "tx/source", v: kw(input.source), tx: t, added: true },
    ...(input.rule === undefined ? [] : [{ e: t, a: "tx/rule", v: input.rule, tx: t, added: true }]),
    ...(input.undoes === undefined ? [] : [{ e: t, a: "tx/undoes", v: input.undoes, tx: t, added: true }]),
    ...moves.map((m) => ({ e: t, a: "tx/move", v: moveText(m), tx: t, added: true })),
  ];
  const tx: Tx = {
    t,
    who: input.who,
    at: input.at,
    why: input.why,
    source: input.source,
    ...(input.rule === undefined ? {} : { rule: input.rule }),
    datoms: [...out, ...meta],
  };
  const next: Db = { log: [...db.log, tx] };
  const nextState = new Map(stateOf(db));
  apply(nextState, tx.datoms);
  stateCache.set(next, nextState);
  return { ok: true, db: next, tx };
};

export const replay = (inputs: ReadonlyArray<TxInput>, from: Db = empty): Db =>
  inputs.reduce((db, input) => {
    const r = transact(db, input);
    if (!r.ok) throw new Error(`replay failed at t=${basis(db) + 1}: ${r.error}`);
    return r.db;
  }, from);

export const schemaOps = (): Array<Op> =>
  SCHEMA.flatMap((attr) => [
    { e: attr.ident, a: "db/type", v: kw(attr.type), added: true },
    { e: attr.ident, a: "db/card", v: kw(attr.many ? "many" : "one"), added: true },
    { e: attr.ident, a: "db/doc", v: attr.doc, added: true },
  ]);

// Undo is a new transaction: flip every datom the old one wrote. History is never rewritten.
export const inverse = (tx: Tx): Array<Op> =>
  tx.datoms.filter((d) => !d.a.startsWith("tx/")).map(({ e, a, v, added }) => ({ e, a, v, added: !added }));

export const diff = (before: ReadonlyArray<Triple>, after: ReadonlyArray<Triple>): Array<Op> => {
  const b = new Map(before.map((t) => [tripleKey(t), t]));
  const n = new Map(after.map((t) => [tripleKey(t), t]));
  const ops: Array<Op> = [];
  for (const [k, t] of b) if (!n.has(k)) ops.push({ ...t, added: false });
  for (const [k, t] of n) if (!b.has(k)) ops.push({ ...t, added: true });
  return ops;
};
