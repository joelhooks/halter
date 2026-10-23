// Structure versions (D32). A person runs the path's structure as of the transaction that entered them:
// their version is the id of the last transaction that changed the path's structure before they entered.
// Waivers and holds aren't structure: a waiver is a decision about checks, and a hold is live for everyone.
import { valKey, type Datom, type Triple } from "./db.ts";
import { owns } from "./model.ts";

const LIVE = new Set(["path/waives", "path/hold-until"]);
export const isStructure = (path: string, d: { readonly e: unknown; readonly a: string }) =>
  typeof d.e === "string" && owns(path, d.e) && !LIVE.has(d.a) && !d.a.startsWith("tx/");

// Every version of a path, oldest first: the transactions that changed its structure.
export const versionsOf = (history: ReadonlyArray<Datom>, path: string): Array<number> =>
  [...new Set(history.filter((d) => isStructure(path, d)).map((d) => d.tx))].sort((x, y) => x - y);
export const currentVersion = (history: ReadonlyArray<Datom>, path: string): number | undefined => versionsOf(history, path).at(-1);

export const versionId = (path: string, v: number) => `${path}@${v}`;
export const parseVersion = (s: string): { readonly path: string; readonly v: number } | undefined => {
  const m = /^(.+)@(\d+)$/.exec(s);
  return m ? { path: m[1] ?? "", v: Number(m[2]) } : undefined;
};

// Current facts as of t, rebuilt from history: what the structure was when that version was made.
export const factsAt = (history: ReadonlyArray<Datom>, t: number): Array<Triple> => {
  const cur = new Map<string, Triple>();
  for (const d of history) {
    if (d.tx > t) continue;
    const k = `${typeof d.e}:${String(d.e)}\u0000${d.a}\u0000${valKey(d.v)}`;
    if (d.added) cur.set(k, { e: d.e, a: d.a, v: d.v });
    else cur.delete(k);
  }
  return [...cur.values()];
};

// Who runs which version of a path, from current facts: people still on it, keyed by version.
export const onVersions = (facts: ReadonlyArray<Triple>, path: string): Map<number, Array<string>> => {
  const on = new Set(facts.filter((f) => f.a === "path/at" && String(f.v).startsWith(`${path}/`)).map((f) => String(f.e)));
  const out = new Map<number, Array<string>>();
  for (const f of facts) {
    if (f.a !== "path/version" || !on.has(String(f.e))) continue;
    const pv = parseVersion(String(f.v));
    if (pv?.path === path) out.set(pv.v, [...(out.get(pv.v) ?? []), String(f.e)]);
  }
  return out;
};
