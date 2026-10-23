// Queries as data: a sketch of Datalog :find/:where, read by halter's own reader.
// Not a full engine: clauses run in the order written, no rules, no aggregates.
import { Result } from "effect";
import { read, type Sexp } from "./read.ts";
import { dateMs, Kw, kw, msDate, valKey, type Datom, type Triple, type Val } from "./db.ts";

export type Term = { readonly var: string } | { readonly const: Val } | { readonly any: true };
export type Clause =
  | { readonly tag: "fact"; readonly terms: readonly [Term, Term, Term] }
  | { readonly tag: "datom"; readonly terms: readonly [Term, Term, Term, Term, Term] }
  | { readonly tag: "call"; readonly fn: string; readonly args: ReadonlyArray<Term>; readonly at: number }
  | { readonly tag: "not"; readonly body: ReadonlyArray<Clause> }
  | { readonly tag: "or"; readonly branches: ReadonlyArray<ReadonlyArray<Clause>> }
  | { readonly tag: "count"; readonly out: string; readonly of: string; readonly body: ReadonlyArray<Clause> };

export interface Query {
  readonly form: "query" | "check";
  readonly name: string;
  readonly doc: string;
  readonly severity: "refuse" | "alarm";
  // bibliography keys, e.g. (ls si)
  readonly cites: ReadonlyArray<string>;
  readonly find: ReadonlyArray<string>;
  readonly where: ReadonlyArray<Clause>;
  readonly say: string;
  readonly at: { readonly e: string; readonly a?: string } | undefined;
}

export type Binding = ReadonlyMap<string, Val>;
export interface Source {
  readonly facts: ReadonlyArray<Triple>;
  readonly history: ReadonlyArray<Datom>;
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
export const FNS = ["<", "<=", ">", ">=", "=", "!=", "in?", "between?", "within?", "+", "-", "day", "starts?", "ref?", "agent?"];

const term = (f: Sexp): Term => {
  switch (f._tag) {
    case "Sym": {
      if (f.name === "_") return { any: true };
      if (f.name.startsWith("?")) return { var: f.name };
      if (f.name === "true" || f.name === "false") return { const: f.name === "true" };
      const d = /^(\d+)([mhd])$/.exec(f.name);
      if (d) return { const: Number(d[1]) * (UNIT_MS[d[2] ?? "m"] ?? 0) };
      return { const: kw(f.name) };
    }
    case "Key":
      return { const: f.name };
    case "Str":
      return { const: f.value };
    case "Num":
      return { const: f.value };
    case "List":
      throw new Error("a term can't be a list");
  }
};

const clause = (f: Sexp): Clause => {
  if (f._tag !== "List") throw new Error("each :where clause is a list");
  const [first, ...rest] = f.items;
  if (first?._tag === "Sym" && first.name === "not") return { tag: "not", body: rest.map(clause) };
  if (first?._tag === "Sym" && first.name === "or")
    return {
      tag: "or",
      branches: rest.map((b) =>
        b._tag === "List" && b.items[0]?._tag === "Sym" && b.items[0].name === "and" ? b.items.slice(1).map(clause) : [clause(b)],
      ),
    };
  if (first?._tag === "Sym" && first.name === "count") {
    const [out, of, ...body] = rest;
    if (out?._tag !== "Sym" || of?._tag !== "Sym") throw new Error("(count ?n ?x clause…) counts distinct ?x");
    return { tag: "count", out: out.name, of: of.name, body: body.map(clause) };
  }
  if (first?._tag === "Sym" && FNS.includes(first.name)) return { tag: "call", fn: first.name, args: rest.map(term), at: f.at };
  const ts = f.items.map(term);
  if (ts.length === 3) return { tag: "fact", terms: ts as unknown as readonly [Term, Term, Term] };
  if (ts.length === 5) return { tag: "datom", terms: ts as unknown as readonly [Term, Term, Term, Term, Term] };
  throw new Error("a pattern is (e a v) or, over history, (e a v tx added?)");
};

export const parseQuery = (source: string): Query => {
  const r = read(source);
  if (Result.isFailure(r)) throw new Error(r.failure.message);
  const top = r.success;
  if (top._tag !== "List") throw new Error("a query is a list");
  const [h, nameForm, ...rest] = top.items;
  if (h?._tag !== "Sym" || (h.name !== "query" && h.name !== "check")) throw new Error("expected (query …) or (check …)");
  const keys = new Map<string, Sexp>();
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (k?._tag === "Key" && v) keys.set(k.name, v);
  }
  const list = (k: string) => {
    const v = keys.get(k);
    return v?._tag === "List" ? v.items : [];
  };
  const str = (k: string) => {
    const v = keys.get(k);
    return v?._tag === "Str" ? v.value : "";
  };
  const atForm = keys.get("at");
  const sev = keys.get("severity");
  const at =
    atForm?._tag === "Sym"
      ? { e: atForm.name }
      : atForm?._tag === "List" && atForm.items[0]?._tag === "Sym" && atForm.items[1]?._tag === "Key"
        ? { e: atForm.items[0].name, a: atForm.items[1].name }
        : undefined;
  return {
    form: h.name,
    name: nameForm?._tag === "Str" ? nameForm.value : "",
    doc: str("doc"),
    severity: sev?._tag === "Sym" && sev.name === "alarm" ? "alarm" : "refuse",
    cites: list("cites").flatMap((x) => (x._tag === "Sym" ? [x.name] : [])),
    say: str("say"),
    find: list("find").flatMap((x) => (x._tag === "Sym" ? [x.name] : [])),
    where: list("where").map(clause),
    at,
  };
};

const resolve = (t: Term, b: Binding): Val | undefined => ("var" in t ? b.get(t.var) : "const" in t ? t.const : undefined);
const same = (x: Val, y: Val) => valKey(x) === valKey(y);

const unify = (terms: ReadonlyArray<Term>, vals: ReadonlyArray<Val>, b: Binding): Binding | undefined => {
  let out: Map<string, Val> | undefined;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const v = vals[i];
    if (t === undefined || v === undefined || "any" in t) continue;
    if ("const" in t) {
      if (!same(t.const, v)) return undefined;
      continue;
    }
    const bound = (out ?? b).get(t.var);
    if (bound !== undefined) {
      if (!same(bound, v)) return undefined;
      continue;
    }
    out ??= new Map(b);
    out.set(t.var, v);
  }
  return out ?? b;
};

const order = (x: Val, y: Val): number | undefined => {
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  if (x instanceof Kw && y instanceof Kw) return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
  return undefined;
};

const call = (c: Extract<Clause, { tag: "call" }>, b: Binding): Array<Binding> => {
  const args = c.args.map((t) => resolve(t, b));
  const need = (n: number) => {
    for (let i = 0; i < n; i++) {
      if (args[i] === undefined) {
        const t = c.args[i];
        throw new Error(`(${c.fn} …) needs ${t && "var" in t ? t.var : "an argument"} bound first`);
      }
    }
    return args as ReadonlyArray<Val>;
  };
  const keep = (ok: boolean) => (ok ? [b] : []);
  switch (c.fn) {
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const [x, y] = need(2) as [Val, Val];
      const o = order(x, y);
      if (o === undefined) return [];
      return keep(c.fn === "<" ? o < 0 : c.fn === "<=" ? o <= 0 : c.fn === ">" ? o > 0 : o >= 0);
    }
    case "=":
    case "!=": {
      const target = c.args[0];
      if (c.fn === "=" && target && "var" in target && args[0] === undefined) {
        const y = args[1];
        if (y === undefined) throw new Error("(= ?x value) needs a value to bind");
        const r = unify([target], [y], b);
        return r ? [r] : [];
      }
      const [x, y] = need(2) as [Val, Val];
      return keep(same(x, y) === (c.fn === "="));
    }
    case "in?": {
      const [x, ...opts] = need(c.args.length) as [Val, ...Array<Val>];
      return keep(opts.some((o) => same(o, x)));
    }
    case "between?": {
      const [x, lo, hi] = need(3) as [Val, Val, Val];
      const a = order(lo, x);
      const z = order(x, hi);
      return keep(a !== undefined && z !== undefined && a < 0 && z <= 0);
    }
    case "within?": {
      const [x, y, w] = need(3) as [Val, Val, Val];
      const mx = typeof x === "string" ? dateMs(x) : undefined;
      const my = typeof y === "string" ? dateMs(y) : undefined;
      return keep(mx !== undefined && my !== undefined && typeof w === "number" && Math.abs(mx - my) <= w);
    }
    case "+":
    case "-": {
      const [x, d] = need(2) as [Val, Val];
      const ms = typeof x === "string" ? dateMs(x) : undefined;
      if (ms === undefined || typeof d !== "number" || !(typeof x === "string")) return [];
      const out = c.args[2];
      if (out === undefined) return [];
      const r = unify([out], [shift(x, ms, c.fn === "+" ? d : -d)], b);
      return r ? [r] : [];
    }
    case "day": {
      const [x] = need(1) as [Val];
      const out = c.args[1];
      if (typeof x !== "string" || out === undefined || dateMs(x) === undefined) return [];
      // the instant at the start of that UTC day
      const r = unify([out], [`${x.slice(0, 10)}T00:00Z`], b);
      return r ? [r] : [];
    }
    case "starts?": {
      // (starts? ?ref ?path): a PATH/KEY reference belongs to that path
      const [x, p] = need(2) as [Val, Val];
      return keep(typeof x === "string" && typeof p === "string" && x.startsWith(`${p}/`));
    }
    case "ref?": {
      // (ref? ?ref ?path ?key): a PATH/KEY reference names exactly that send
      const [x, p, k] = need(3) as [Val, Val, Val];
      return keep(typeof x === "string" && typeof p === "string" && typeof k === "string" && x === `${p}/${k}`);
    }
    case "agent?": {
      // (agent? ?who): the actor is agent:NAME (D37)
      const [x] = need(1) as [Val];
      return keep(typeof x === "string" && /^agent:[a-z]/.test(x));
    }
    default:
      throw new Error(`unknown function ${c.fn}`);
  }
};

// Dates keep their shape: a day plus whole days is still a day.
const shift = (x: string, ms: number, d: number): string => {
  const out = msDate(ms + d);
  return x.length === 10 && d % 86_400_000 === 0 ? out.slice(0, 10) : out;
};

const solve = (clauses: ReadonlyArray<Clause>, src: Source, start: ReadonlyArray<Binding>): Array<Binding> => {
  let bs: ReadonlyArray<Binding> = start;
  for (const c of clauses) {
    const next: Array<Binding> = [];
    for (const b of bs) {
      switch (c.tag) {
        case "fact":
          for (const f of src.facts) {
            const r = unify(c.terms, [f.e, f.a, f.v], b);
            if (r) next.push(r);
          }
          break;
        case "datom":
          for (const d of src.history) {
            const r = unify(c.terms, [d.e, d.a, d.v, d.tx, d.added], b);
            if (r) next.push(r);
          }
          break;
        case "call":
          next.push(...call(c, b));
          break;
        case "not":
          if (solve(c.body, src, [b]).length === 0) next.push(b);
          break;
        case "or":
          for (const branch of c.branches) next.push(...solve(branch, src, [b]));
          break;
        case "count": {
          const seen = new Set(solve(c.body, src, [b]).map((x) => valKey(x.get(c.of) ?? "")));
          const r = unify([{ var: c.out }], [seen.size], b);
          if (r) next.push(r);
          break;
        }
      }
    }
    bs = next;
  }
  return [...bs];
};

export type Ran = { readonly ok: true; readonly bindings: ReadonlyArray<Binding>; readonly rows: ReadonlyArray<ReadonlyArray<Val>> } | { readonly ok: false; readonly error: string };

export const run = (q: Query, src: Source, start: Binding = new Map()): Ran => {
  try {
    const bindings = solve(q.where, src, [start]);
    const seen = new Set<string>();
    const rows: Array<ReadonlyArray<Val>> = [];
    for (const b of bindings) {
      const row = q.find.map((v) => b.get(v) ?? "");
      const k = row.map(valKey).join("\u0000");
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(row);
    }
    rows.sort((x, y) => {
      for (let i = 0; i < x.length; i++) {
        const o = order(x[i] ?? "", y[i] ?? "") ?? valKey(x[i] ?? "").localeCompare(valKey(y[i] ?? ""));
        if (o !== 0) return o;
      }
      return 0;
    });
    return { ok: true, bindings, rows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// Durations are minutes-precise numbers of ms; show them in hours, the way halter writes them.
export const show = (x: Val): string =>
  x instanceof Kw ? x.name : typeof x === "number" && x >= 60_000 && x % 60_000 === 0 ? (x % 3_600_000 === 0 ? `${x / 3_600_000}h` : `${x / 60_000}m`) : String(x);

export const fill = (template: string, b: Binding): string =>
  template.replace(/\{(\?[\w-]+)\}/g, (_, v: string) => {
    const x = b.get(v);
    if (x === undefined) return v;
    return show(x);
  });
