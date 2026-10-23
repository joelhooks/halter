// Predicates are pure: they read facts and nothing else. This is the one evaluator,
// used by the interpreter, the editor's "who would this hit" column and the tests.
import { Kw, type Datom, type Triple } from "./db.ts";
import { COURSE, DIM, LIST, PRODUCT, type Pred } from "./model.ts";

export interface World {
  // every current fact
  readonly facts: ReadonlyArray<Triple>;
  // every datom so far, for reached?
  readonly history: ReadonlyArray<Datom>;
  // due? needs the schedule, which only the interpreter knows; outside it, due? is false
  readonly due?: (person: string, path: string, withinMs: number) => boolean;
}

const vals = (w: World, e: string, a: string) => w.facts.filter((f) => f.e === e && f.a === a).map((f) => f.v);
const has = (w: World, e: string, a: string, v: unknown) => w.facts.some((f) => f.e === e && f.a === a && (f.v instanceof Kw ? f.v.name : f.v) === v);

// A person's value for a dimension: the fact named by the dimension's :dim/attr, or unknown.
export const answer = (w: World, person: string, dim: string): string => {
  const attr = vals(w, DIM + dim, "dim/attr")[0];
  const v = typeof attr === "string" ? vals(w, person, attr)[0] : undefined;
  return v instanceof Kw ? v.name : typeof v === "string" ? v : "unknown";
};

// An act counts when it is a current fact and the transaction that last asserted it was
// observed or asked. An inferred act can be wrong, so it never counts.
const did = (w: World, person: string, act: string): boolean => {
  if (!has(w, person, "person/did", act)) return false;
  const d = [...w.history].reverse().find((x) => x.e === person && x.a === "person/did" && x.v === act && x.added);
  const src = d ? w.history.find((x) => x.e === d.tx && x.a === "tx/source")?.v : undefined;
  const name = src instanceof Kw ? src.name : String(src ?? "");
  return name === "observed" || name === "asked";
};

export const holds = (p: Pred, person: string, w: World): boolean => {
  const a = p.arg ?? "";
  switch (p.name) {
    case "and":
      return (p.kids ?? []).every((k) => holds(k, person, w));
    case "or":
      return (p.kids ?? []).some((k) => holds(k, person, w));
    case "not":
      return !holds(p.kids?.[0] ?? { name: "and", kids: [] }, person, w);
    case "on-list?":
      return has(w, person, "person/lists", LIST + a);
    case "tag?":
      return has(w, person, "person/tags", a);
    case "domain?":
      return String(vals(w, person, "person/email")[0] ?? "").endsWith(`@${a}`);
    case "finished?":
      return has(w, person, "person/finished", COURSE + a) || has(w, person, "path/finished", a);
    case "exited?":
      return has(w, person, "path/exited", a);
    case "passed?":
      return has(w, person, "path/passed", a);
    case "reached?":
      return w.history.some((d) => d.e === person && d.a === "path/at" && d.added && d.v === `${a}/${p.arg2 ?? ""}`);
    case "bought?":
      return has(w, person, "person/bought", PRODUCT + a);
    case "answered?":
      return answer(w, person, a) === p.arg2;
    case "known?":
      return answer(w, person, a) !== "unknown";
    case "in?":
      return vals(w, person, "path/at").some((v) => (p.arg2 === undefined ? String(v).startsWith(`${a}/`) : v === `${a}/${p.arg2}`));
    case "due?":
      return w.due?.(person, a, p.within ?? 0) ?? false;
    case "did?":
      return did(w, person, a);
    case "reached-target?":
      return has(w, person, "path/reached-target", a);
    case "missed-target?":
      return has(w, person, "path/missed-target", a);
  }
};

export const people = (w: World): Array<string> =>
  [...new Set(w.facts.filter((f) => f.a === "person/name").map((f) => String(f.e)))].sort();
