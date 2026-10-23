// Predicates are pure: they read facts and nothing else. This is the one evaluator,
// used by the interpreter, the editor's "who would this hit" column and the tests.
import { dateMs, Kw, tripleKey, type Datom, type Triple } from "./db.ts";
import { LIST, type Pred } from "./model.ts";

export interface World {
  // every current fact
  readonly facts: ReadonlyArray<Triple>;
  // every datom so far, for reached? and for when a fact was written
  readonly history: ReadonlyArray<Datom>;
  // due? needs the schedule, which only the interpreter knows; outside it, due? is false
  readonly due?: (person: string, path: string, withinMs: number) => boolean;
}

// An act (D39): its own entity, with when it happened. Freshness reads :act/at, never the transaction.
export interface Act {
  readonly e: string;
  readonly person: string;
  readonly kind: string;
  readonly of: string;
  readonly at: number;
  readonly source: string;
  readonly value?: string;
  // the transaction that first wrote it, to order two acts at the same instant
  readonly t: number;
}
const name = (v: unknown) => (v instanceof Kw ? v.name : String(v ?? ""));

const actIndex = new WeakMap<ReadonlyArray<Triple>, Map<string, Array<Act>>>();
const firstWrite = new WeakMap<ReadonlyArray<Datom>, Map<string, number>>();
// The transaction that first wrote each entity's act/kind, from history
const firstT = (w: World, e: string): number => {
  let m = firstWrite.get(w.history);
  if (!m) {
    m = new Map();
    for (const d of w.history) if (d.a === "act/kind" && d.added && !m.has(String(d.e))) m.set(String(d.e), d.tx);
    firstWrite.set(w.history, m);
  }
  return m.get(e) ?? 0;
};
export const acts = (w: World, person: string): ReadonlyArray<Act> => {
  let idx = actIndex.get(w.facts);
  if (!idx) {
    const by = new Map<string, Map<string, unknown>>();
    for (const f of w.facts) {
      if (!f.a.startsWith("act/")) continue;
      const k = String(f.e);
      const m = by.get(k) ?? new Map<string, unknown>();
      m.set(f.a, f.v);
      by.set(k, m);
    }
    idx = new Map();
    for (const [e, m] of by) {
      const at = dateMs(String(m.get("act/at") ?? ""));
      const who = m.get("act/person");
      if (at === undefined || who === undefined || !m.has("act/kind") || !m.has("act/of")) continue;
      const value = m.get("act/value");
      const a: Act = {
        e,
        person: String(who),
        kind: name(m.get("act/kind")),
        of: String(m.get("act/of")),
        at,
        source: name(m.get("act/source")),
        t: firstT(w, e),
        ...(value === undefined ? {} : { value: name(value) }),
      };
      idx.set(a.person, [...(idx.get(a.person) ?? []), a]);
    }
    actIndex.set(w.facts, idx);
  }
  return idx.get(person) ?? [];
};

// The latest answered act for a dimension: by when it happened, then by when it was written.
export const latestAnswer = (w: World, person: string, dim: string): Act | undefined =>
  acts(w, person)
    .filter((a) => a.kind === "answered" && a.of === dim && a.value !== undefined)
    .reduce<Act | undefined>((best, a) => (!best || a.at > best.at || (a.at === best.at && a.t > best.t) ? a : best), undefined);
// A person's value for a dimension follows their latest answered act, or is unknown.
export const answer = (w: World, person: string, dim: string): string => latestAnswer(w, person, dim)?.value ?? "unknown";

// When a fact that isn't an act was written: the instant of the transaction that last asserted it.
// Path events, list joins and tags are written once, at the moment they happen, so that's their time.
const written = new WeakMap<ReadonlyArray<Datom>, { readonly fact: Map<string, number>; readonly tx: Map<number, number> }>();
const when = (w: World) => {
  let x = written.get(w.history);
  if (!x) {
    const tx = new Map<number, number>();
    for (const d of w.history) if (d.a === "tx/at" && d.added) tx.set(d.tx, dateMs(String(d.v)) ?? 0);
    const fact = new Map<string, number>();
    for (const d of w.history) if (d.added) fact.set(tripleKey(d), tx.get(d.tx) ?? 0);
    x = { fact, tx };
    written.set(w.history, x);
  }
  return x;
};
const writtenAt = (w: World, t: Triple): number => when(w).fact.get(tripleKey(t)) ?? 0;

const vals = (w: World, e: string, a: string) => w.facts.filter((f) => f.e === e && f.a === a);
// A current fact, counted only when it was written at or after since (when there is one)
const has = (w: World, e: string, a: string, v: unknown, since?: number) =>
  w.facts.some((f) => f.e === e && f.a === a && name(f.v) === v && (since === undefined || writtenAt(w, f) >= since));
// An act counts when it happened at or after since (D39). A correction keeps :act/at, so it can't make an act fresh.
const hasAct = (w: World, person: string, kind: string, of: string, since?: number, ok: (a: Act) => boolean = () => true) =>
  acts(w, person).some((a) => a.kind === kind && a.of === of && ok(a) && (since === undefined || a.at >= since));

// holds reads every fact. With since, it's a trigger's fresh evidence: each positive clause counts only
// evidence from since on, and a clause under not reads everything, so an old purchase still keeps someone out.
export const holds = (p: Pred, person: string, w: World, since?: number): boolean => {
  const a = p.arg ?? "";
  switch (p.name) {
    case "and":
      return (p.kids ?? []).every((k) => holds(k, person, w, since));
    case "or":
      return (p.kids ?? []).some((k) => holds(k, person, w, since));
    case "not":
      return !holds(p.kids?.[0] ?? { name: "and", kids: [] }, person, w);
    case "on-list?":
      return has(w, person, "person/lists", LIST + a, since);
    case "tag?":
      return has(w, person, "person/tags", a, since);
    case "domain?":
      return vals(w, person, "person/email").some((f) => String(f.v).endsWith(`@${a}`) && (since === undefined || writtenAt(w, f) >= since));
    case "finished?":
      return hasAct(w, person, "finished", a, since) || has(w, person, "path/finished", a, since);
    case "exited?":
      return has(w, person, "path/exited", a, since);
    case "passed?":
      return has(w, person, "path/passed", a, since);
    case "reached?":
      return w.history.some((d) => d.e === person && d.a === "path/at" && d.added && d.v === `${a}/${p.arg2 ?? ""}` && (since === undefined || (when(w).tx.get(d.tx) ?? 0) >= since));
    case "bought?":
      return hasAct(w, person, "bought", a, since);
    case "answered?": {
      // freshness comes from the act that set the value
      const x = latestAnswer(w, person, a);
      if (!x) return p.arg2 === "unknown" && since === undefined;
      return x.value === p.arg2 && (since === undefined || x.at >= since);
    }
    case "known?": {
      const x = latestAnswer(w, person, a);
      return !!x && x.value !== "unknown" && (since === undefined || x.at >= since);
    }
    case "in?":
      return vals(w, person, "path/at").some((f) => (p.arg2 === undefined ? String(f.v).startsWith(`${a}/`) : f.v === `${a}/${p.arg2}`) && (since === undefined || writtenAt(w, f) >= since));
    case "due?":
      return w.due?.(person, a, p.within ?? 0) ?? false;
    case "did?":
      // an inferred act can be wrong, so only observed or asked counts
      return hasAct(w, person, "did", a, since, (x) => x.source === "observed" || x.source === "asked");
    case "reached-target?":
      return has(w, person, "path/reached-target", a, since);
    case "missed-target?":
      return has(w, person, "path/missed-target", a, since);
  }
};

export const people = (w: World): Array<string> =>
  [...new Set(w.facts.filter((f) => f.a === "person/name").map((f) => String(f.e)))].sort();
