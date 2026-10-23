// A path as a plain value, and the two maps between it and its facts.
// LANGUAGE.md is the definition; this file follows it. Every campaign is a path.
import { kw, Kw, type Eid, type Triple, type Val } from "./db.ts";

export const JOBS = ["teach", "pain", "dream", "fix", "announce-pitch", "proof", "faq", "urgency", "last-call", "survey", "support"] as const;
export const isJob = (j: string): j is Job => (JOBS as ReadonlyArray<string>).includes(j);
// The closed list stays closed: a synonym an agent might reach for, and the job it means (D29).
export const JOB_SYNONYMS: ReadonlyArray<readonly [string, Job]> = [
  ["nudge", "support"],
  ["help", "support"],
  ["onboard", "support"],
  ["educate", "teach"],
  ["lesson", "teach"],
  ["deadline", "urgency"],
  ["scarcity", "urgency"],
  ["testimonial", "proof"],
  ["ask", "survey"],
];
export type Job = (typeof JOBS)[number];
// The channels a send can go through. Content has one rendition per channel.
export const CHANNELS = ["email", "sms", "site"] as const;
export type Channel = (typeof CHANNELS)[number];
export const isChannel = (c: string): c is Channel => (CHANNELS as ReadonlyArray<string>).includes(c);
// The events a :deadline may name.
export const EVENTS = ["close", "early-bird", "class"] as const;

// P-D-F bands for the arc strip.
export const BAND: Record<Job, "pain" | "dream" | "fix" | "after"> = {
  teach: "pain",
  pain: "pain",
  dream: "dream",
  "announce-pitch": "dream",
  fix: "fix",
  proof: "fix",
  faq: "fix",
  urgency: "fix",
  "last-call": "fix",
  survey: "after",
  support: "after",
};
export const band = (job: string): "pain" | "dream" | "fix" | "after" | "none" => BAND[job as Job] ?? "none";

// Predicates end in ?. Each argument is a string, a symbol or a duration, in this order.
export type ArgKind = "str" | "sym" | "dur";
export const ATOMS = {
  "on-list?": { args: ["str"], doc: "the person is on the list" },
  "tag?": { args: ["str"], doc: "the person has the tag" },
  "domain?": { args: ["str"], doc: "their email is at that domain" },
  "finished?": { args: ["str"], doc: "a finished act for that course exists, or that path wrote :path/finished for them" },
  "exited?": { args: ["str"], doc: "that path wrote :path/exited for them" },
  "passed?": { args: ["str"], doc: "that path wrote :path/passed for them: they reached done and nothing went out" },
  "reached?": { args: ["str", "sym"], doc: "they have ever entered that state of that path" },
  "bought?": { args: ["str"], doc: "a bought act for that product exists" },
  "answered?": { args: ["sym", "sym"], doc: "their latest answered act for the dimension has that value" },
  "known?": { args: ["sym"], doc: "their value for the dimension isn't unknown" },
  "in?": { args: ["str", "sym?"], doc: "they're in that path now, or in that state of it" },
  "due?": { args: ["str", "dur"], doc: "a send from that path is due to them within the duration" },
  "did?": { args: ["str"], doc: "a did act exists with :act/source observed or asked; an inferred act doesn't count" },
  "reached-target?": { args: ["str"], doc: "that path wrote :path/reached-target for them" },
  "missed-target?": { args: ["str"], doc: "that path wrote :path/missed-target for them" },
} as const satisfies Record<string, { args: ReadonlyArray<string>; doc: string }>;
export type AtomName = keyof typeof ATOMS;
export const GROUPS = ["and", "or", "not"] as const;
export type PredName = AtomName | (typeof GROUPS)[number];
export const isAtom = (n: string): n is AtomName => Object.hasOwn(ATOMS, n);
export const isGroup = (n: string): n is (typeof GROUPS)[number] => (GROUPS as ReadonlyArray<string>).includes(n);

export interface Pred {
  readonly name: PredName;
  readonly kids?: ReadonlyArray<Pred>;
  readonly arg?: string;
  readonly arg2?: string;
  readonly within?: number;
}
export interface Variant {
  readonly value: string;
  readonly message: string;
}
export interface Vary {
  readonly dim: string;
  readonly hard: boolean;
  readonly cases: ReadonlyArray<Variant>;
  readonly else?: string;
}
// :via email, :via (or sms email): the first the person can receive, :via (and site email): every one.
export interface Via {
  readonly op?: "or" | "and";
  readonly channels: ReadonlyArray<string>;
}
export interface Send {
  readonly key: string;
  readonly via?: Via;
  readonly after?: number;
  readonly on?: string;
  readonly job?: string;
  readonly deadline?: string;
  readonly vary?: Vary;
}
export interface To {
  readonly target: string;
  readonly after?: number;
  readonly when?: Pred;
}
export interface State {
  readonly name: string;
  readonly sends: ReadonlyArray<Send>;
  readonly tos: ReadonlyArray<To>;
}
export interface Offer {
  readonly product: string;
  readonly pricing: string;
  readonly opens?: string;
  readonly closes?: string;
  readonly windowState?: string;
  readonly earlyBird?: string;
  readonly classStarts?: string;
}
export interface Pace {
  readonly rate: number;
  readonly rampTo?: number;
  readonly rampStep?: number;
  readonly rampEvery?: number;
}
// The person's real result. It measures and notifies; it never gates a send (D28).
export interface Target {
  readonly pred: Pred;
  readonly within?: number;
}
export interface GuardClause {
  readonly when: Pred;
  readonly action: "skip" | "defer";
  readonly reason?: string;
  readonly for?: number;
}
export interface Path {
  readonly id: string;
  readonly title: string;
  readonly list: string;
  readonly offer?: Offer;
  readonly entersOn?: Pred;
  // fresh evidence (D39): by default only acts whose :act/at is after the path went live count; :since reaches back
  readonly since?: string;
  readonly holds: ReadonlyArray<string>;
  readonly states: ReadonlyArray<State>;
  readonly exitOn?: Pred;
  readonly target?: Target;
  readonly guard: ReadonlyArray<GuardClause>;
  readonly pace: Pace;
  readonly waives: ReadonlyArray<string>;
}
// Kept for older call sites: a campaign is a path.
export type Campaign = Path;

export const LIST = "list/";
export const PRODUCT = "product/";
export const COURSE = "course/";
export const DIM = "dim/";
export const offerId = (c: string) => `${c}/offer`;
export const stateId = (c: string, name: string) => `${c}/state/${name}`;
export const toId = (c: string, state: string, rank: number) => `${stateId(c, state)}/to/${rank}`;
export const sendId = (c: string, key: string) => `${c}/send/${key}`;
export const variantId = (c: string, key: string, rank: number) => `${sendId(c, key)}/vary/${rank}`;
export const viaId = (c: string, key: string, rank: number) => `${sendId(c, key)}/via/${rank}`;
export const guardId = (c: string, rank: number) => `${c}/guard/${rank}`;
export const entersId = (c: string) => `${c}/enters`;
export const exitId = (c: string) => `${c}/exit`;
export const targetId = (c: string) => `${c}/target`;
export const owns = (c: string, e: Eid) => e === c || (typeof e === "string" && e.startsWith(`${c}/`));

export const opt = <K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } =>
  (v === undefined ? {} : { [k]: v }) as { [P in K]?: V };

export const allSends = (m: Path): ReadonlyArray<Send & { readonly state: string }> =>
  m.states.flatMap((st) => st.sends.map((s) => ({ ...s, state: st.name })));

const predFacts = (put: (e: string, a: string, v: Val | undefined) => void, e: string, p: Pred, parent?: string, rank?: number) => {
  put(e, "pred/name", kw(p.name));
  put(e, "pred/parent", parent);
  put(e, "pred/rank", rank);
  put(e, "pred/arg", p.arg);
  put(e, "pred/arg2", p.arg2);
  put(e, "pred/within", p.within);
  (p.kids ?? []).forEach((k, i) => predFacts(put, `${e}/${i + 1}`, k, e, i + 1));
};

export const toFacts = (m: Path): Array<Triple> => {
  const out: Array<Triple> = [];
  const put = (e: string, a: string, v: Val | undefined) => {
    if (v !== undefined) out.push({ e, a, v });
  };
  const c = m.id;
  put(c, "path/title", m.title);
  put(c, "path/list", LIST + m.list);
  if (m.entersOn) {
    put(c, "path/enters-on", entersId(c));
    predFacts(put, entersId(c), m.entersOn);
  }
  if (m.exitOn) {
    put(c, "path/exit-on", exitId(c));
    predFacts(put, exitId(c), m.exitOn);
  }
  if (m.target) {
    put(c, "path/target", targetId(c));
    predFacts(put, targetId(c), m.target.pred);
    put(c, "path/target-within", m.target.within);
  }
  // :since lives inside (enters-on …), so it is a fact only beside one
  put(c, "path/enters-since", m.entersOn ? m.since : undefined);
  for (const h of new Set(m.holds)) put(c, "path/hold-until", h);
  for (const w of new Set(m.waives)) put(c, "path/waives", w);
  put(c, "path/rate", m.pace.rate);
  put(c, "path/ramp-to", m.pace.rampTo);
  put(c, "path/ramp-step", m.pace.rampStep);
  put(c, "path/ramp-every", m.pace.rampEvery);
  if (m.offer) {
    const o = offerId(c);
    put(o, "offer/path", c);
    put(o, "offer/product", PRODUCT + m.offer.product);
    put(o, "offer/pricing", m.offer.pricing);
    put(o, "offer/opens", m.offer.opens);
    put(o, "offer/closes", m.offer.closes);
    put(o, "offer/window-state", m.offer.windowState === undefined ? undefined : kw(m.offer.windowState));
    put(o, "offer/early-bird-until", m.offer.earlyBird);
    put(o, "offer/class-starts", m.offer.classStarts);
  }
  let rank = 0;
  m.states.forEach((st, i) => {
    const se = stateId(c, st.name);
    put(se, "state/path", c);
    put(se, "state/name", kw(st.name));
    put(se, "state/rank", i + 1);
    for (const s of st.sends) {
      const e = sendId(c, s.key);
      put(e, "send/path", c);
      put(e, "send/state", se);
      put(e, "send/key", s.key);
      put(e, "send/rank", ++rank);
      put(e, "send/job", s.job === undefined ? undefined : kw(s.job));
      put(e, "send/on", s.on);
      put(e, "send/after", s.after);
      put(e, "send/deadline", s.deadline === undefined ? undefined : kw(s.deadline));
      if (s.via) {
        put(e, "send/via-op", s.via.op === undefined ? undefined : kw(s.via.op));
        s.via.channels.forEach((ch, j) => {
          const ve = viaId(c, s.key, j + 1);
          put(ve, "via/send", e);
          put(ve, "via/rank", j + 1);
          put(ve, "via/channel", kw(ch));
        });
      }
      if (s.vary) {
        put(e, "send/vary-by", DIM + s.vary.dim);
        put(e, "send/vary-hard", s.vary.hard ? true : undefined);
        put(e, "send/vary-else", s.vary.else);
        s.vary.cases.forEach((v, j) => {
          const ve = variantId(c, s.key, j + 1);
          put(ve, "variant/send", e);
          put(ve, "variant/rank", j + 1);
          put(ve, "variant/value", kw(v.value));
          put(ve, "variant/message", v.message);
        });
      }
    }
    st.tos.forEach((t, j) => {
      const te = toId(c, st.name, j + 1);
      put(te, "to/state", se);
      put(te, "to/rank", j + 1);
      put(te, "to/target", kw(t.target));
      put(te, "to/after", t.after);
      if (t.when) {
        put(te, "to/when", `${te}/when`);
        predFacts(put, `${te}/when`, t.when);
      }
    });
  });
  m.guard.forEach((g, i) => {
    const e = guardId(c, i + 1);
    put(e, "guard/path", c);
    put(e, "guard/rank", i + 1);
    put(e, "guard/when", `${e}/when`);
    predFacts(put, `${e}/when`, g.when);
    put(e, "guard/action", kw(g.action));
    put(e, "guard/reason", g.reason);
    put(e, "guard/for", g.for);
  });
  return out;
};

type Bag = Map<string, Array<Val>>;
const one = (b: Bag | undefined, a: string): Val | undefined => b?.get(a)?.[0];
const str = (b: Bag | undefined, a: string): string | undefined => {
  const v = one(b, a);
  return typeof v === "string" ? v : undefined;
};
const num = (b: Bag | undefined, a: string): number | undefined => {
  const v = one(b, a);
  return typeof v === "number" ? v : undefined;
};
const key = (b: Bag | undefined, a: string): string | undefined => {
  const v = one(b, a);
  return v instanceof Kw ? v.name : undefined;
};
const strip = (s: string | undefined, prefix: string) => (s === undefined ? undefined : s.startsWith(prefix) ? s.slice(prefix.length) : s);
const byRank = <T extends { readonly rank: number }>(xs: Array<T>) => xs.sort((x, y) => x.rank - y.rank);

// The inverse of toFacts for every fact set toFacts can make. Undefined before the path exists.
export const fromFacts = (c: string, triples: ReadonlyArray<Triple>): Path | undefined => {
  const bags = new Map<Eid, Bag>();
  for (const t of triples) {
    if (!owns(c, t.e)) continue;
    const bag = bags.get(t.e) ?? new Map<string, Array<Val>>();
    bag.set(t.a, [...(bag.get(t.a) ?? []), t.v]);
    bags.set(t.e, bag);
  }
  const top = bags.get(c);
  const title = str(top, "path/title");
  if (title === undefined) return undefined;
  const kidsOf = new Map<string, Array<{ rank: number; e: string }>>();
  for (const [e, bag] of bags) {
    const parent = str(bag, "pred/parent");
    if (parent !== undefined) kidsOf.set(parent, [...(kidsOf.get(parent) ?? []), { rank: num(bag, "pred/rank") ?? 0, e: String(e) }]);
  }
  const pred = (e: string | undefined): Pred | undefined => {
    if (e === undefined) return undefined;
    const bag = bags.get(e);
    const name = key(bag, "pred/name");
    if (name === undefined || !(isAtom(name) || isGroup(name))) return undefined;
    const kids = byRank(kidsOf.get(e) ?? []).flatMap((k) => {
      const p = pred(k.e);
      return p ? [p] : [];
    });
    return {
      name,
      ...(isGroup(name) ? { kids } : {}),
      ...opt("arg", str(bag, "pred/arg")),
      ...opt("arg2", str(bag, "pred/arg2")),
      ...opt("within", num(bag, "pred/within")),
    };
  };
  const states: Array<{ rank: number; e: string; name: string }> = [];
  const sends: Array<{ rank: number; state: string; send: Send }> = [];
  const tos: Array<{ rank: number; state: string; to: To }> = [];
  const guard: Array<{ rank: number; clause: GuardClause }> = [];
  const variants = new Map<string, Array<{ rank: number; v: Variant }>>();
  const vias = new Map<string, Array<{ rank: number; ch: string }>>();
  for (const [e, bag] of bags) {
    if (bag.has("state/path")) states.push({ rank: num(bag, "state/rank") ?? 0, e: String(e), name: key(bag, "state/name") ?? "" });
    else if (bag.has("via/send")) {
      const s = str(bag, "via/send") ?? "";
      vias.set(s, [...(vias.get(s) ?? []), { rank: num(bag, "via/rank") ?? 0, ch: key(bag, "via/channel") ?? "" }]);
    } else if (bag.has("variant/send")) {
      const s = str(bag, "variant/send") ?? "";
      variants.set(s, [...(variants.get(s) ?? []), { rank: num(bag, "variant/rank") ?? 0, v: { value: key(bag, "variant/value") ?? "", message: str(bag, "variant/message") ?? "" } }]);
    } else if (bag.has("to/state")) {
      tos.push({
        rank: num(bag, "to/rank") ?? 0,
        state: str(bag, "to/state") ?? "",
        to: { target: key(bag, "to/target") ?? "", ...opt("after", num(bag, "to/after")), ...opt("when", pred(str(bag, "to/when"))) },
      });
    } else if (bag.has("guard/path")) {
      guard.push({
        rank: num(bag, "guard/rank") ?? 0,
        clause: {
          when: pred(str(bag, "guard/when")) ?? { name: "and", kids: [] },
          action: key(bag, "guard/action") === "defer" ? "defer" : "skip",
          ...opt("reason", str(bag, "guard/reason")),
          ...opt("for", num(bag, "guard/for")),
        },
      });
    }
  }
  for (const [e, bag] of bags) {
    if (!bag.has("send/path")) continue;
    const vs = byRank(variants.get(String(e)) ?? []).map((x) => x.v);
    const dim = strip(str(bag, "send/vary-by"), DIM);
    const chs = byRank(vias.get(String(e)) ?? []).map((x) => x.ch);
    const op = key(bag, "send/via-op");
    sends.push({
      rank: num(bag, "send/rank") ?? 0,
      state: str(bag, "send/state") ?? "",
      send: {
        key: str(bag, "send/key") ?? "",
        ...(chs.length === 0 ? {} : { via: { ...(op === "or" || op === "and" ? { op } : {}), channels: chs } }),
        ...opt("after", num(bag, "send/after")),
        ...opt("on", str(bag, "send/on")),
        ...opt("job", key(bag, "send/job")),
        ...opt("deadline", key(bag, "send/deadline")),
        ...(dim === undefined ? {} : { vary: { dim, hard: one(bag, "send/vary-hard") === true, cases: vs, ...opt("else", str(bag, "send/vary-else")) } }),
      },
    });
  }
  byRank(sends);
  const o = bags.get(offerId(c));
  const offer: Offer | undefined = o
    ? {
        product: strip(str(o, "offer/product"), PRODUCT) ?? "",
        pricing: str(o, "offer/pricing") ?? "",
        ...opt("opens", str(o, "offer/opens")),
        ...opt("closes", str(o, "offer/closes")),
        ...opt("windowState", key(o, "offer/window-state")),
        ...opt("earlyBird", str(o, "offer/early-bird-until")),
        ...opt("classStarts", str(o, "offer/class-starts")),
      }
    : undefined;
  return {
    id: c,
    title,
    list: strip(str(top, "path/list"), LIST) ?? "",
    ...opt("offer", offer),
    ...opt("entersOn", pred(str(top, "path/enters-on"))),
    ...opt("since", str(top, "path/enters-since")),
    holds: (top?.get("path/hold-until") ?? []).flatMap((v) => (typeof v === "string" ? [v] : [])).sort(),
    states: byRank(states).map((st) => ({
      name: st.name,
      sends: sends.filter((s) => s.state === st.e).map((s) => s.send),
      tos: byRank(tos.filter((t) => t.state === st.e)).map((t) => t.to),
    })),
    ...opt("exitOn", pred(str(top, "path/exit-on"))),
    ...(() => {
      const tp = pred(str(top, "path/target"));
      return tp ? { target: { pred: tp, ...opt("within", num(top, "path/target-within")) } } : {};
    })(),
    guard: byRank(guard).map((g) => g.clause),
    pace: {
      rate: num(top, "path/rate") ?? 0,
      ...opt("rampTo", num(top, "path/ramp-to")),
      ...opt("rampStep", num(top, "path/ramp-step")),
      ...opt("rampEvery", num(top, "path/ramp-every")),
    },
    waives: (top?.get("path/waives") ?? []).flatMap((v) => (typeof v === "string" ? [v] : [])).sort(),
  };
};

export const owned = (c: string, triples: ReadonlyArray<Triple>): Array<Triple> => triples.filter((t) => owns(c, t.e));

// Entity ids for a send key or state name are paths, so keep them to plain characters.
export const SAFE = /^[a-z0-9][a-z0-9-]*$/;
