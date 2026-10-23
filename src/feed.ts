// Since you last looked (D37): what agents did on a path after a person's cursor. Selection is a halter
// query over transaction facts (:tx/who, agent?); the view keeps the transactions that touched the path.
import { facts, type Db, type Op, type Tx } from "./db.ts";
import { allSends, fromFacts } from "./model.ts";
import { parseQuery, run } from "./query.ts";

export const FEED = `(query "since-you-looked"
  :doc "Agent transactions after the reader's cursor. The interpreter's own path events stay out."
  :find (?t ?who)
  :where ((?t :tx/who ?who) (agent? ?who) (!= ?who "agent:halter") (> ?t ?seen)))`;
const feedQuery = parseQuery(FEED);

export const SEEN = "seen/path";
// A person's cursor on a path: the transaction named by their :seen/path PATH@TX, or undefined.
export const cursorOf = (db: Db, who: string, path: string): number | undefined => {
  const ts = facts(db)
    .filter((f) => f.e === who && f.a === SEEN && typeof f.v === "string" && f.v.startsWith(`${path}@`))
    .map((f) => Number(String(f.v).slice(path.length + 1)))
    .filter((n) => Number.isInteger(n));
  return ts.length ? Math.max(...ts) : undefined;
};
// Marking seen replaces the person's cursor on that path. "PATH@" is completed with the mark's own tx.
export const markSeenOps = (db: Db, who: string, path: string): Array<Op> => [
  ...facts(db)
    .filter((f) => f.e === who && f.a === SEEN && typeof f.v === "string" && f.v.startsWith(`${path}@`))
    .map((f) => ({ e: who, a: SEEN, v: f.v, added: false })),
  { e: who, a: SEEN, v: `${path}@`, added: true },
];

// A transaction touched the path: its structure, holds or waivers (facts on the path's own entities), a
// move of it, or the content of a message it names. Another path that merely names this one doesn't count.
export const touchesFeed = (tx: Tx, path: string, messages: ReadonlySet<string>): boolean =>
  tx.datoms.some(
    (d) =>
      d.e === path ||
      (typeof d.e === "string" && d.e.startsWith(`${path}/`)) ||
      (d.a === "tx/move" && typeof d.v === "string" && d.v.startsWith(`(move ${JSON.stringify(path)}`)) ||
      (typeof d.e === "string" && d.e.startsWith("message/") && messages.has(d.e.split("/")[1] ?? "")),
  );

export const messagesOf = (db: Db, path: string): Set<string> => {
  const p = fromFacts(path, facts(db));
  return new Set(p ? allSends(p).flatMap((s) => [s.key, ...(s.vary?.cases.map((c) => c.message) ?? []), ...(s.vary?.else === undefined ? [] : [s.vary.else])]) : []);
};

// The feed: agent transactions after the cursor (all of them with no cursor) that touched the path.
export const feedOf = (db: Db, path: string, who: string): { readonly cursor: number | undefined; readonly txs: ReadonlyArray<Tx> } => {
  const cursor = cursorOf(db, who, path);
  const r = run(feedQuery, { facts: facts(db), history: [] }, new Map([["?seen", cursor ?? 0]]));
  if (!r.ok) throw new Error(r.error);
  const ts = new Set(r.rows.map((x) => Number(x[0])));
  const msgs = messagesOf(db, path);
  return { cursor, txs: db.log.filter((tx) => ts.has(tx.t) && touchesFeed(tx, path, msgs)) };
};
