// A told deadline is locked (D38). A person is told event E when a sent delivery of a send whose :deadline
// is E reaches them. The instant they were told is computed then, under the version they ran; a move that
// would give anyone told a different instant is refused, whoever wrote it.
import { msDate, dateMs, type Triple } from "./db.ts";
import { PACK } from "./checks.ts";
import { fill, run } from "./query.ts";
import type { Path } from "./model.ts";

// E's instant for one person: calendar events read the offer; a per-person close is the instant they
// leave the window's state, entered at stateAt, by its earliest timed transition.
export const eventInstant = (p: Path | undefined, ev: string, state: string, stateAt: number): number | undefined => {
  const o = p?.offer;
  if (!o) return undefined;
  if (ev === "early-bird") return o.earlyBird === undefined ? undefined : dateMs(o.earlyBird);
  if (ev === "class") return o.classStarts === undefined ? undefined : dateMs(o.classStarts);
  if (ev !== "close") return undefined;
  if (o.windowState === undefined) return o.closes === undefined ? undefined : dateMs(o.closes);
  if (state !== o.windowState) return undefined;
  const afters = (p?.states.find((s) => s.name === state)?.tos ?? []).flatMap((t) => (t.after === undefined ? [] : [t.after]));
  return afters.length ? stateAt + Math.min(...afters) : undefined;
};

export interface Broken {
  readonly person: string;
  readonly event: string;
  readonly told: number;
  readonly now: number | undefined;
}
export const toldFacts = (path: string, bs: ReadonlyArray<Broken>): Array<Triple> =>
  bs.flatMap((b, i) => {
    const k = `told/${path}/${i}`;
    return [
      { e: k, a: "told/path", v: path },
      { e: k, a: "told/person", v: b.person },
      { e: k, a: "told/event", v: b.event },
      { e: k, a: "told/at", v: msDate(b.told) },
      { e: k, a: "told/now", v: b.now === undefined ? "never" : msDate(b.now) },
    ];
  });
const check = PACK.find((x) => x.query.name === "deadline-kept")?.query;
// The refusal, in the check's own words, or undefined when nobody told is moved to a different instant.
export const deadlineRefusal = (path: string, bs: ReadonlyArray<Broken>): string | undefined => {
  if (!check) return undefined;
  const r = run(check, { facts: toldFacts(path, bs), history: [] }, new Map([["?c", path]]));
  if (!r.ok || r.bindings.length === 0) return undefined;
  const says = [...new Set(r.bindings.map((b) => fill(check.say, b)))];
  return `refused: deadline-kept: ${says.join(" ")}`;
};
