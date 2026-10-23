// halter reads no clock. Time enters as facts, and so do the things that happen to people:
// these are views over the path events in the log, as of a basis t.
import { facts, history, Kw, type Db, type Tx } from "./db.ts";

export const kwName = (v: unknown): string => (v instanceof Kw ? v.name : String(v));

export const nameOf = (db: Db) => {
  const names = new Map(facts(db).filter((f) => f.a === "person/name").map((f) => [String(f.e), String(f.v)]));
  return (p: string) => names.get(p) ?? p.replace(/^person\//, "");
};

// Where everyone is on one path: the current :path/at values, plus who has finished or exited.
export interface Place {
  readonly person: string;
  readonly where: string;
}
export const placesOn = (db: Db, path: string): Array<Place> => {
  const out = new Map<string, string>();
  for (const f of facts(db)) {
    const p = String(f.e);
    if (f.a === "path/at" && String(f.v).startsWith(`${path}/`)) out.set(p, String(f.v).slice(path.length + 1));
    else if (f.a === "path/finished" && f.v === path) out.set(p, "done");
    else if (f.a === "path/passed" && f.v === path) out.set(p, "passed");
    else if (f.a === "path/exited" && f.v === path) out.set(p, "exited");
  }
  return [...out].map(([person, where]) => ({ person, where })).sort((x, y) => x.person.localeCompare(y.person));
};

// Finishing a path and reaching its target are different numbers (D28). Finished but missed is
// the honest failure; a target is still watched after done or exited until :within runs out.
export interface Outcomes {
  readonly entered: ReadonlyArray<string>;
  readonly finished: ReadonlyArray<string>;
  // reached done with nothing sent (D34)
  readonly passed: ReadonlyArray<string>;
  readonly exited: ReadonlyArray<string>;
  readonly reached: ReadonlyArray<string>;
  readonly missed: ReadonlyArray<string>;
}
export const outcomesOn = (db: Db, path: string): Outcomes => {
  const fs = facts(db);
  const who = (a: string) => fs.filter((f) => f.a === a && f.v === path).map((f) => String(f.e)).sort();
  return { entered: who("path/entered"), finished: who("path/finished"), passed: who("path/passed"), exited: who("path/exited"), reached: who("path/reached-target"), missed: who("path/missed-target") };
};
export const targetOf = (o: Outcomes, person: string): "reached" | "missed" | "watching" =>
  o.reached.includes(person) ? "reached" : o.missed.includes(person) ? "missed" : "watching";

// How each send has gone so far: delivered and skipped, counted from path events.
export const sendCounts = (db: Db, path: string): Map<string, { sent: number; skipped: number }> => {
  const out = new Map<string, { sent: number; skipped: number }>();
  for (const f of facts(db)) {
    if (f.a !== "send/sent" && f.a !== "send/skipped") continue;
    const v = String(f.v);
    if (!v.startsWith(`${path}/`)) continue;
    const k = v.slice(path.length + 1);
    const c = out.get(k) ?? { sent: 0, skipped: 0 };
    out.set(k, f.a === "send/sent" ? { ...c, sent: c.sent + 1 } : { ...c, skipped: c.skipped + 1 });
  }
  return out;
};

// Every transaction that touched one person, world events and path events alike.
export const personLog = (db: Db, person: string): Array<Tx> => db.log.filter((tx) => tx.datoms.some((d) => d.e === person));

// The transactions that touched a path's definition or its people.
export const touchesPath = (tx: Tx, path: string): boolean =>
  tx.datoms.some(
    (d) =>
      d.e === path ||
      (typeof d.e === "string" && d.e.startsWith(`${path}/`)) ||
      (typeof d.v === "string" && (d.v === path || d.v.startsWith(`${path}/`) || d.v.startsWith(`${path}@`)) && !d.a.startsWith("tx/")) ||
      (d.a === "tx/move" && typeof d.v === "string" && d.v.startsWith(`(move ${JSON.stringify(path)}`)),
  );

export const isPathEvent = (tx: Tx) => tx.who === "agent:halter";
export const allHistory = history;
