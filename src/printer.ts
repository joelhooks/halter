// The halter file is a printout of the facts. print(asOf(db, t)) is what the page shows.
// One canonical form per meaning: fixed form order, fixed key order, two-space indent.
import { ATOMS, isAtom, type Answer, type Dimension, type GuardClause, type Path, type Pred, type Send, type To, type Via } from "./model.ts";
import { commentLines, flat, form, layout, pairs, type Form, type Node } from "./fit.ts";

const q = JSON.stringify;
// Hours, not days: two sends in one day stay expressible.
export const duration = (ms: number): string => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`);

export const predNode = (p: Pred): Form => {
  if (!isAtom(p.name)) return form(p.name, (p.kids ?? []).map(predNode));
  const kinds: ReadonlyArray<string> = ATOMS[p.name].args;
  const vals = [p.arg, p.arg2];
  const parts = kinds.flatMap((k, i) => {
    const v = k === "dur" ? (p.within === undefined ? undefined : duration(p.within)) : vals[i];
    if (v === undefined) return [];
    return [k === "str" ? q(v) : v];
  });
  return form(p.name, parts);
};
export const printPred = (p: Pred): string => flat(predNode(p));

const actionNode = (g: GuardClause): Form =>
  g.action === "skip" ? form("skip", [g.reason === undefined ? undefined : q(g.reason)]) : form("defer", [g.for === undefined ? undefined : duration(g.for)]);
export const printAction = (g: GuardClause): string => flat(actionNode(g));

const viaNode = (v: Via): Node => (v.op === undefined ? v.channels.join(" ") : form(v.op, v.channels));
export const printVia = (v: Via): string => flat(viaNode(v));

// :answers (DIM VALUE), or ((DIM VALUE) (DIM VALUE)) for more than one
const answersNode = (xs: ReadonlyArray<Answer>): Node => {
  const one = (x: Answer) => form(x.dim, [x.value]);
  const [first, ...rest] = xs;
  return first === undefined ? "()" : rest.length === 0 ? one(first) : form("", xs.map(one));
};
const sendNode = (s: Send): Form => {
  const v = s.vary;
  return form("send", [
    q(s.key),
    ...pairs([
      ["after", s.after === undefined ? undefined : duration(s.after)],
      ["on", s.on === undefined ? undefined : q(s.on)],
      ["job", s.job],
      ["via", s.via === undefined ? undefined : viaNode(s.via)],
      // LANGUAGE.md's order: :deadline, :asks, :answers, :bonus
      ["deadline", s.deadline],
      ["asks", s.asks],
      ["answers", s.answers === undefined ? undefined : answersNode(s.answers)],
      ["bonus", s.bonus === undefined ? undefined : q(s.bonus)],
    ]),
    v && form("vary", [v.dim, v.hard && ":hard", ...v.cases.map((c) => form(c.value, [q(c.message)])), v.else !== undefined && form("else", [q(v.else)])]),
  ]);
};

const toNode = (t: To): Form => form("to", [t.target, ...pairs([["after", t.after === undefined ? undefined : duration(t.after)], ["when", t.when ? predNode(t.when) : undefined]])]);

export interface Notes {
  readonly header?: string;
  readonly waivers?: ReadonlyMap<string, string>;
  // check -> the person or agent whose own waiver waits for someone else; printed as a comment
  readonly pending?: ReadonlyMap<string, string>;
  // the column the layout fits; 44 unless a caller wants one form per line
  readonly width?: number;
}

export const pathNode = (m: Path, notes: Notes = {}): Form => {
  const o = m.offer;
  const p = m.pace;
  const ramp = pairs([
    ["to", p.rampTo?.toString()],
    ["step", p.rampStep?.toString()],
    ["every", p.rampEvery === undefined ? undefined : duration(p.rampEvery)],
  ]);
  return form("path", [
    q(m.id),
    ...pairs([
      ["title", q(m.title)],
      ["list", q(m.list)],
    ]),
    o &&
      form("offer", [
        q(o.product),
        ...pairs([["pricing", q(o.pricing)]]),
        o.windowState !== undefined
          ? form("window", pairs([["state", o.windowState]]))
          : (o.opens !== undefined || o.closes !== undefined) &&
            form(
              "window",
              pairs([
                ["opens", o.opens === undefined ? undefined : q(o.opens)],
                ["closes", o.closes === undefined ? undefined : q(o.closes)],
              ]),
            ),
        o.earlyBird !== undefined && form("early-bird", pairs([["until", q(o.earlyBird)]])),
        o.classStarts !== undefined && form("class", pairs([["starts", q(o.classStarts)]])),
        ...(o.bonuses ?? []).map((b) => form("bonus", [q(b.product), ...pairs([["until", b.until]])])),
      ]),
    m.entersOn && form("enters-on", [predNode(m.entersOn), ...pairs([["since", m.since === undefined ? undefined : q(m.since)]])]),
    ...m.holds.map((h) => form("hold", pairs([["until", q(h)]]))),
    ...m.states.map((st) => form("state", [st.name, ...st.sends.map(sendNode), ...st.tos.map(toNode)])),
    m.exitOn && form("exit-on", [predNode(m.exitOn)]),
    m.target && form("target", [predNode(m.target.pred), ...pairs([["within", m.target.within === undefined ? undefined : duration(m.target.within)]])]),
    m.guard.length > 0 && form("guard", m.guard.map((g) => form("when", [predNode(g.when), actionNode(g)]))),
    form("pace", [form("rate", [String(p.rate)]), ramp.length > 0 && form("ramp", ramp)]),
    // The why prints above the waiver as a comment, so the closing paren stays code.
    ...m.waives.flatMap((w): Array<Node> => {
      const note = notes.waivers?.get(w);
      const by = notes.pending?.get(w);
      return [...(note ? [{ comment: note.replace(/\n/g, " ") }] : []), form("waive", [w], by ? `pending: ${by} raised it` : undefined)];
    }),
  ]);
};

export const printPath = (m: Path, notes: Notes = {}): string => {
  const head = notes.header ? `${notes.header
    .split("\n")
    .map((l) => commentLines(l, notes.width))
    .join("\n")}\n` : "";
  return `${head}${layout(pathNode(m, notes), 0, notes.width)}\n`;
};
// A dimension prints as LANGUAGE.md writes it: its values as one list, then :many, then :objections.
export const printDimension = (d: Dimension): string =>
  `${layout(form("dimension", [d.name, form("", d.values), d.many && ":many", ...(d.objections.length ? [":objections", form("", d.objections)] : [])]), 0)}\n`;
// Older call sites print a "campaign"; it is a path.
export const printCampaign = printPath;
