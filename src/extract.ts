// Read a printed path back into a value and its facts. Lenient: it keeps everything it can
// and reports problems with their offsets, so the editor can point at the line.
import { Result } from "effect";
import { read, type Problem, type Sexp } from "./read.ts";
import { dateMs, type Move, type Triple } from "./db.ts";
import {
  ATOMS,
  CHANNELS,
  entersId,
  exitId,
  targetId,
  guardId,
  isAtom,
  isGroup,
  offerId,
  SAFE,
  sendId,
  stateId,
  toFacts,
  toId,
  variantId,
  viaId,
  type GuardClause,
  type Offer,
  type Pace,
  type Path,
  type Pred,
  type Send,
  type State,
  type Target,
  type To,
  type Variant,
  type Via,
} from "./model.ts";

export interface Extracted {
  readonly id: string;
  readonly path: Path | undefined;
  readonly triples: ReadonlyArray<Triple>;
  // "e|a" -> offset of the value; "e" -> offset of the entity's form
  readonly at: ReadonlyMap<string, number>;
  readonly problems: ReadonlyArray<Problem>;
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000 };
const FORMS = ["offer", "enters-on", "hold", "state", "exit-on", "target", "guard", "pace", "waive"];

const head = (f: Sexp | undefined) => (f?._tag === "List" && f.items[0]?._tag === "Sym" ? f.items[0].name : undefined);
const kids = (f: Sexp | undefined): ReadonlyArray<Sexp> => (f?._tag === "List" ? f.items.slice(1) : []);

export const readPath = (source: string): Extracted => {
  const problems: Array<Problem> = [];
  const at = new Map<string, number>();
  const refuse = (where: number, message: string, hint?: string) => {
    problems.push(hint === undefined ? { at: where, message } : { at: where, message, hint });
  };
  const mark = (e: string, a: string | undefined, where: number | undefined) => {
    if (where === undefined) return;
    const k = a === undefined ? e : `${e}|${a}`;
    if (!at.has(k)) at.set(k, where);
  };
  const r = read(source);
  if (Result.isFailure(r)) return { id: "", path: undefined, triples: [], at, problems: [r.failure] };
  const top = r.success;

  // Split a form's arguments into positional items and :key value pairs.
  const split = (f: Sexp, flags: ReadonlyArray<string> = []) => {
    const pos: Array<Sexp> = [];
    const keys = new Map<string, Sexp>();
    const flagged = new Set<string>();
    const items = kids(f);
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (x === undefined) continue;
      if (x._tag !== "Key") {
        pos.push(x);
        continue;
      }
      if (flags.includes(x.name)) {
        flagged.add(x.name);
        continue;
      }
      const v = items[i + 1];
      if (v === undefined || v._tag === "Key") refuse(x.at, `:${x.name} has no value`, "a keyword is always followed by its value");
      else if (keys.has(x.name)) refuse(x.at, `:${x.name} appears twice`);
      else keys.set(x.name, v);
      i++;
    }
    return { pos, keys, flagged };
  };
  const only = (keys: Map<string, Sexp>, allowed: ReadonlyArray<string>, where: string) => {
    for (const [k, v] of keys) if (!allowed.includes(k)) refuse(v.at, `(${where} …) has no :${k}`, allowed.length ? `it takes ${allowed.map((x) => `:${x}`).join(", ")}` : undefined);
  };
  const str = (f: Sexp | undefined, what: string, near: number): string | undefined => {
    if (f?._tag === "Str") return f.value;
    refuse(f?.at ?? near, `expected ${what} as a "string"`);
    return undefined;
  };
  const sym = (f: Sexp | undefined, what: string, near: number, allowed?: ReadonlyArray<string>): string | undefined => {
    if (f?._tag !== "Sym") {
      refuse(f?.at ?? near, `expected ${what} as a bare word`);
      return undefined;
    }
    if (allowed && !allowed.includes(f.name)) {
      refuse(f.at, `unknown ${what} ${f.name}`, `use one of ${allowed.join(", ")}`);
      return undefined;
    }
    return f.name;
  };
  const name = (f: Sexp | undefined, what: string, near: number): string | undefined => {
    const s = f?._tag === "Str" ? f.value : f?._tag === "Sym" ? f.name : undefined;
    if (s !== undefined && SAFE.test(s)) return s;
    refuse(f?.at ?? near, `${what} needs plain lower-case letters, digits and dashes`);
    return undefined;
  };
  const dur = (f: Sexp | undefined, what: string, near: number): number | undefined => {
    const m = f?._tag === "Sym" ? /^(\d+)([mh])$/.exec(f.name) : null;
    if (m) return Number(m[1]) * (UNIT_MS[m[2] ?? "m"] ?? 0);
    refuse(f?.at ?? near, `expected ${what} as a duration`, "hours, like 48h, or minutes, like 30m. No days.");
    return undefined;
  };
  const instant = (f: Sexp | undefined, what: string, near: number): string | undefined => {
    const s = str(f, what, near);
    if (s === undefined) return undefined;
    if (dateMs(s) === undefined) {
      refuse(f?.at ?? near, `${what} is an instant, UTC to the minute`, '"2027-03-02T17:00Z"');
      return undefined;
    }
    return s;
  };
  const int = (f: Sexp | undefined, what: string, near: number): number | undefined => {
    if (f?._tag === "Num" && Number.isInteger(f.value) && f.value >= 0) return f.value;
    refuse(f?.at ?? near, `expected ${what} as a whole number`);
    return undefined;
  };

  // :via email | (or CH CH…) | (and CH CH…), channels from a closed list
  const VIA_HINT = ":via email, :via (or sms email) or :via (and site email)";
  const viaOf = (f: Sexp | undefined, key: string, near: number): Via | undefined => {
    if (f === undefined) {
      refuse(near, `send ${key} has no :via`, `every send names its channels: ${VIA_HINT}`);
      return undefined;
    }
    if (f._tag === "Sym") {
      const ch = sym(f, "channel", near, CHANNELS);
      return ch === undefined ? undefined : { channels: [ch] };
    }
    const op = head(f);
    if (op !== "or" && op !== "and") {
      refuse(f.at, `:via is one channel or (or …) / (and …)`, VIA_HINT);
      return undefined;
    }
    const chs = kids(f).map((c) => sym(c, "channel", f.at, CHANNELS));
    if (chs.length < 2) refuse(f.at, `(${op} …) takes two or more channels`, `for one channel write :via ${chs[0] ?? "email"}`);
    if (new Set(chs).size !== chs.length) refuse(f.at, `(${op} …) names a channel twice`);
    if (chs.length < 2 || chs.some((c) => c === undefined) || new Set(chs).size !== chs.length) return undefined;
    return { op, channels: chs.flatMap((c) => (c === undefined ? [] : [c])) };
  };

  const pred = (f: Sexp | undefined, near: number, e: string): Pred | undefined => {
    const h = head(f);
    if (f === undefined || h === undefined) {
      refuse(f?.at ?? near, "expected a predicate like (tag? \"vip\")");
      return undefined;
    }
    mark(e, undefined, f.at);
    if (isGroup(h)) {
      const ks = kids(f);
      if (h === "not" && ks.length !== 1) refuse(f.at, "(not …) takes one predicate");
      if (h !== "not" && ks.length === 0) refuse(f.at, `(${h} …) needs at least one predicate`);
      const out = ks.flatMap((k, i) => {
        const p = pred(k, f.at, `${e}/${i + 1}`);
        return p ? [p] : [];
      });
      return { name: h, kids: out };
    }
    if (!isAtom(h)) {
      const hint = isAtom(`${h}?`) ? `predicates end in ?: (${h}? …)` : `use one of and, or, not, ${Object.keys(ATOMS).join(", ")}`;
      refuse(f.at, `unknown predicate ${h}`, hint);
      return undefined;
    }
    const spec: ReadonlyArray<string> = ATOMS[h].args;
    const args = kids(f);
    if (args.length > spec.length || args.length < spec.filter((s) => !s.endsWith("?")).length) refuse(f.at, `(${h} …) takes ${spec.length === 1 ? "one argument" : `${spec.filter((s) => !s.endsWith("?")).length} or ${spec.length} arguments`}`);
    let arg: string | undefined;
    let arg2: string | undefined;
    let within: number | undefined;
    spec.forEach((s, i) => {
      const x = args[i];
      if (x === undefined) return;
      const v = s === "dur" ? undefined : s.startsWith("str") ? str(x, `the argument of ${h}`, f.at) : name(x, `the argument of ${h}`, f.at);
      if (s === "dur") within = dur(x, `the window of ${h}`, f.at);
      else if (i === 0) arg = v;
      else arg2 = v;
    });
    return { name: h, ...(arg === undefined ? {} : { arg }), ...(arg2 === undefined ? {} : { arg2 }), ...(within === undefined ? {} : { within }) };
  };

  if (head(top) !== "path") {
    const h = head(top);
    refuse(top.at, `a halter file holds (path "id" …)${h ? `, not (${h} …)` : ""}`, h === "campaign" ? "every campaign is a path now; a campaign with one node is still a path" : undefined);
    return { id: "", path: undefined, triples: [], at, problems };
  }
  const t = split(top);
  const idForm = t.pos[0];
  const id = name(idForm, "the path id", top.at) ?? "";
  if (id === "") return { id, path: undefined, triples: [], at, problems };
  mark(id, undefined, top.at);
  only(t.keys, ["title", "list"], "path");
  const title = str(t.keys.get("title"), ":title", top.at) ?? "";
  mark(id, "path/title", t.keys.get("title")?.at);
  const list = name(t.keys.get("list"), ":list", top.at) ?? "";
  mark(id, "path/list", t.keys.get("list")?.at);

  let offer: Offer | undefined;
  let entersOn: Pred | undefined;
  let exitOn: Pred | undefined;
  let target: Target | undefined;
  let pace: Pace | undefined;
  let since: string | undefined;
  const holds: Array<string> = [];
  const states: Array<State> = [];
  const guard: Array<GuardClause> = [];
  const waives: Array<string> = [];
  const seen = new Set<string>();
  let lastForm = -1;

  for (const f of t.pos.slice(1)) {
    const h = head(f);
    if (h === undefined || !FORMS.includes(h)) {
      refuse(f.at, h === undefined ? "expected a form here" : `(path …) has no (${h} …)`, h === "next" ? "no next: the successor says (enters-on (finished? \"this-path\"))" : h === "rule" ? "(guard (when …)) replaces (rule …)" : `it takes ${FORMS.join(", ")}`);
      continue;
    }
    const order = FORMS.indexOf(h);
    if (order < lastForm) refuse(f.at, `(${h} …) is out of order`, `forms go ${FORMS.join(", ")}`);
    lastForm = Math.max(lastForm, order);
    if (h !== "state" && h !== "waive" && h !== "hold" && seen.has(h)) refuse(f.at, `(${h} …) appears twice`);
    seen.add(h);
    switch (h) {
      case "offer": {
        const s = split(f);
        only(s.keys, ["pricing"], "offer");
        const o = offerId(id);
        mark(o, undefined, f.at);
        const product = name(s.pos[0], "the product", f.at) ?? "";
        mark(o, "offer/product", s.pos[0]?.at);
        const pricing = str(s.keys.get("pricing"), ":pricing", f.at) ?? "";
        mark(o, "offer/pricing", s.keys.get("pricing")?.at);
        let next: Offer = { product, pricing };
        for (const sub of s.pos.slice(1)) {
          const sh = head(sub);
          const ss = split(sub);
          if (sh === "window") {
            if (ss.keys.has("state")) {
              only(ss.keys, ["state"], "window :state");
              const ws = name(ss.keys.get("state"), "the window state", sub.at);
              mark(o, "offer/window-state", sub.at);
              if (ws) next = { ...next, windowState: ws };
            } else {
              only(ss.keys, ["opens", "closes"], "window");
              const opens = instant(ss.keys.get("opens"), ":opens", sub.at);
              const closes = instant(ss.keys.get("closes"), ":closes", sub.at);
              mark(o, "offer/opens", ss.keys.get("opens")?.at);
              mark(o, "offer/closes", ss.keys.get("closes")?.at);
              next = { ...next, ...(opens ? { opens } : {}), ...(closes ? { closes } : {}) };
            }
          } else if (sh === "early-bird") {
            only(ss.keys, ["until"], "early-bird");
            const eb = instant(ss.keys.get("until"), ":until", sub.at);
            mark(o, "offer/early-bird-until", ss.keys.get("until")?.at);
            if (eb) next = { ...next, earlyBird: eb };
          } else if (sh === "class") {
            only(ss.keys, ["starts"], "class");
            const cs = instant(ss.keys.get("starts"), ":starts", sub.at);
            mark(o, "offer/class-starts", ss.keys.get("starts")?.at);
            if (cs) next = { ...next, classStarts: cs };
          } else refuse(sub.at, `(offer …) has no (${sh ?? "?"} …)`, "it takes window, early-bird and class");
        }
        offer = next;
        break;
      }
      case "hold": {
        const s = split(f);
        only(s.keys, ["until"], "hold");
        const u = instant(s.keys.get("until"), ":until", f.at);
        mark(id, "path/hold-until", f.at);
        if (s.pos.length > 0) refuse(f.at, "(hold :until INSTANT) takes only :until");
        if (u) holds.push(u);
        break;
      }
      case "enters-on":
      case "exit-on": {
        const e = h === "enters-on" ? entersId(id) : exitId(id);
        mark(id, h === "enters-on" ? "path/enters-on" : "path/exit-on", f.at);
        const s = split(f);
        only(s.keys, h === "enters-on" ? ["since"] : [], h);
        const p = pred(s.pos[0], f.at, e);
        if (s.pos.length > 1) refuse(f.at, `(${h} …) takes one predicate; combine with (or …)`);
        if (s.keys.has("since")) {
          since = instant(s.keys.get("since"), ":since", f.at);
          mark(id, "path/enters-since", s.keys.get("since")?.at);
        }
        if (h === "enters-on") entersOn = p;
        else exitOn = p;
        break;
      }
      case "target": {
        // (target PRED :within DURATION). A missing target or :within is the path-has-target check's call.
        mark(id, "path/target", f.at);
        const s = split(f);
        only(s.keys, ["within"], "target");
        const p = pred(s.pos[0], f.at, targetId(id));
        if (s.pos.length > 1) refuse(f.at, "(target …) takes one predicate; combine with (and …)");
        const within = s.keys.has("within") ? dur(s.keys.get("within"), ":within", f.at) : undefined;
        mark(id, "path/target-within", s.keys.get("within")?.at);
        if (p) target = { pred: p, ...(within === undefined ? {} : { within }) };
        break;
      }
      case "state": {
        const ss = kids(f);
        const sn = name(ss[0], "the state name", f.at);
        if (sn === undefined) break;
        if (sn === "closed" || sn === "done" || sn === "exited") refuse(ss[0]?.at ?? f.at, `${sn} is built in; name the state something else`);
        if (states.some((s) => s.name === sn)) refuse(ss[0]?.at ?? f.at, `state ${sn} is declared twice`);
        const se = stateId(id, sn);
        mark(se, undefined, f.at);
        const sends: Array<Send> = [];
        const tos: Array<To> = [];
        for (const x of ss.slice(1)) {
          const xh = head(x);
          if (xh === "send") {
            const s = split(x);
            only(s.keys, ["after", "on", "job", "via", "deadline"], "send");
            const key = name(s.pos[0], "the message id", x.at);
            if (key === undefined) continue;
            const e = sendId(id, key);
            mark(e, undefined, x.at);
            const after = s.keys.has("after") ? dur(s.keys.get("after"), ":after", x.at) : undefined;
            const on = s.keys.has("on") ? instant(s.keys.get("on"), ":on", x.at) : undefined;
            if (s.keys.has("after") === s.keys.has("on")) refuse(x.at, `send ${key} needs exactly one of :after or :on`, ":after counts from entering the state; :on is a calendar instant");
            const job = s.keys.has("job") ? sym(s.keys.get("job"), "job", x.at) : undefined;
            const deadline = s.keys.has("deadline") ? sym(s.keys.get("deadline"), "deadline", x.at) : undefined;
            const via = viaOf(s.keys.get("via"), key, x.at);
            if (via) via.channels.forEach((_, j) => mark(viaId(id, key, j + 1), undefined, s.keys.get("via")?.at));
            for (const [k, a] of [["after", "send/after"], ["on", "send/on"], ["job", "send/job"], ["via", "send/via-op"], ["deadline", "send/deadline"]] as const) mark(e, a, s.keys.get(k)?.at);
            let vary: Send["vary"];
            for (const v of s.pos.slice(1)) {
              if (head(v) !== "vary") {
                refuse(v.at, "a send holds only (vary …)");
                continue;
              }
              const vs = split(v, ["hard"]);
              const dim = name(vs.pos[0], "the dimension", v.at) ?? "";
              mark(e, "send/vary-by", v.at);
              const cases: Array<Variant> = [];
              let other: string | undefined;
              for (const c of vs.pos.slice(1)) {
                const ch = head(c);
                const msg = str(kids(c)[0], "the message id", c.at);
                if (ch === "else") other = msg;
                else if (ch !== undefined && msg !== undefined) {
                  mark(variantId(id, key, cases.length + 1), undefined, c.at);
                  cases.push({ value: ch, message: msg });
                } else refuse(c.at, "expected (VALUE \"message\") or (else \"message\")");
              }
              vary = { dim, hard: vs.flagged.has("hard"), cases, ...(other === undefined ? {} : { else: other }) };
            }
            sends.push({
              key,
              ...(via === undefined ? {} : { via }),
              ...(after === undefined ? {} : { after }),
              ...(on === undefined ? {} : { on }),
              ...(job === undefined ? {} : { job }),
              ...(deadline === undefined ? {} : { deadline }),
              ...(vary === undefined ? {} : { vary }),
            });
          } else if (xh === "to") {
            const s = split(x);
            only(s.keys, ["after", "when"], "to");
            const target = name(s.pos[0], "the target state", x.at);
            const te = toId(id, sn, tos.length + 1);
            mark(te, undefined, x.at);
            mark(te, "to/target", s.pos[0]?.at);
            mark(te, "to/after", s.keys.get("after")?.at);
            if (s.keys.has("after") === s.keys.has("when")) refuse(x.at, "a (to …) needs exactly one of :after or :when");
            const after = s.keys.has("after") ? dur(s.keys.get("after"), ":after", x.at) : undefined;
            const when = s.keys.has("when") ? pred(s.keys.get("when"), x.at, `${te}/when`) : undefined;
            if (target) tos.push({ target, ...(after === undefined ? {} : { after }), ...(when === undefined ? {} : { when }) });
          } else refuse(x.at, `(state …) holds send and to, not ${xh ? `(${xh} …)` : "this"}`);
        }
        if (sends.length === 0) refuse(f.at, `state ${sn} has no sends`);
        states.push({ name: sn, sends, tos });
        break;
      }
      case "guard": {
        for (const w of kids(f)) {
          if (head(w) !== "when") {
            refuse(w.at, "(guard …) holds (when PRED ACTION) clauses");
            continue;
          }
          const ge = guardId(id, guard.length + 1);
          mark(ge, undefined, w.at);
          const [pf, af] = kids(w);
          const when = pred(pf, w.at, `${ge}/when`);
          const ah = head(af);
          const arg = kids(af)[0];
          if (ah === "skip") {
            const reason = arg === undefined ? undefined : str(arg, "the skip reason", w.at);
            if (when) guard.push({ when, action: "skip", ...(reason === undefined ? {} : { reason }) });
          } else if (ah === "defer") {
            const d = dur(arg, "the defer", w.at);
            if (when) guard.push({ when, action: "defer", ...(d === undefined ? {} : { for: d }) });
          } else refuse(af?.at ?? w.at, "a guard action is (skip \"reason\") or (defer 72h)", "no match means send");
        }
        break;
      }
      case "pace": {
        const [rf, rampF] = kids(f);
        if (head(rf) !== "rate") refuse(rf?.at ?? f.at, "expected (rate N) first in (pace …)");
        const rate = int(kids(rf)[0], "the rate", f.at) ?? 0;
        mark(id, "path/rate", rf?.at);
        let next: Pace = { rate };
        if (rampF) {
          if (head(rampF) !== "ramp") refuse(rampF.at, "(pace …) takes (rate N) and an optional (ramp …)");
          const s = split(rampF);
          only(s.keys, ["to", "step", "every"], "ramp");
          const rampTo = int(s.keys.get("to"), ":to", rampF.at);
          const rampStep = int(s.keys.get("step"), ":step", rampF.at);
          const rampEvery = dur(s.keys.get("every"), ":every", rampF.at);
          next = { rate, ...(rampTo === undefined ? {} : { rampTo }), ...(rampStep === undefined ? {} : { rampStep }), ...(rampEvery === undefined ? {} : { rampEvery }) };
        }
        pace = next;
        break;
      }
      case "waive": {
        const w = name(kids(f)[0], "the check id", f.at);
        mark(id, "path/waives", f.at);
        if (w) waives.push(w);
        break;
      }
    }
  }
  if (title === "") refuse(top.at, "a path needs :title");
  if (states.length === 0) refuse(top.at, "a path needs at least one (state …)", "a campaign with one node is still a path");
  if (!entersOn) refuse(top.at, "a path needs (enters-on PRED); it is the only way in");
  if (!pace) refuse(top.at, "a path needs (pace (rate N))");
  const keys = new Set<string>();
  for (const s of states.flatMap((st) => st.sends)) {
    if (keys.has(s.key)) refuse(at.get(sendId(id, s.key)) ?? top.at, `message ${s.key} is sent twice in this path`);
    keys.add(s.key);
  }
  const path: Path = {
    id,
    title,
    list,
    ...(offer ? { offer } : {}),
    ...(entersOn ? { entersOn } : {}),
    ...(since ? { since } : {}),
    holds: [...new Set(holds)].sort(),
    states,
    ...(exitOn ? { exitOn } : {}),
    ...(target ? { target } : {}),
    guard,
    pace: pace ?? { rate: 0 },
    waives: [...new Set(waives)].sort(),
  };
  return { id, path, triples: toFacts(path), at, problems };
};
// Older call sites read a "campaign"; it is a path.
export const readCampaign = readPath;

// (move PATH :to-version TX? :from-version TX? :from STATE? :to STATE? :map ((OLD NEW)…)?), an op inside a tx (D32).
export const readMove = (source: string): { readonly move?: Move; readonly problem?: string } => {
  const r = read(source);
  if (Result.isFailure(r)) return { problem: r.failure.message };
  const top = r.success;
  if (top._tag !== "List" || top.items[0]?._tag !== "Sym" || top.items[0].name !== "move") return { problem: "expected (move PATH …)" };
  const p = top.items[1];
  if (p?._tag !== "Str") return { problem: "(move …) names its path as a string" };
  const out: { -readonly [K in keyof Move]: Move[K] } = { path: p.value };
  const rest = top.items.slice(2);
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (k?._tag !== "Key" || v === undefined) return { problem: "(move …) takes :keyword value pairs" };
    const name = k.name.replace(/^:/, "");
    if ((name === "to-version" || name === "from-version") && v._tag === "Num") out[name === "to-version" ? "toVersion" : "fromVersion"] = v.value;
    else if ((name === "from" || name === "to") && v._tag === "Sym") out[name] = v.name;
    else if (name === "map" && v._tag === "List") {
      const pairs: Array<readonly [string, string]> = [];
      for (const pair of v.items) {
        if (pair._tag !== "List" || pair.items.length !== 2 || pair.items.some((x) => x._tag !== "Sym")) return { problem: ":map takes ((OLD NEW)…)" };
        pairs.push([(pair.items[0] as { name: string }).name, (pair.items[1] as { name: string }).name]);
      }
      out.map = pairs;
    } else return { problem: `(move …) doesn't take ${k.name} ${v._tag === "Sym" ? v.name : "that value"}` };
  }
  return { move: out };
};
