// Build an XState v6 machine from a path's facts. Generated, illustrative, not run here.
// Every actor, guard and delay the output names comes from a fixed registry of reviewed code.
import { ATOMS, isAtom, type Path, type Pred, type Send } from "./model.ts";
import { duration, printAction, printPred, printVia } from "./printer.ts";

export const REGISTRY = {
  actors: [
    ["deliver", "Effect createEffectLogic: the one decision (hard stops, including a refusal true for this person and send, which sends the vary's safe else or skips; holds, guard, pace), then picks channels from :via and hands the message to deliver/<channel>. Its result is a path event."],
    ["deliver/email", "sends an email rendition through the email provider's adapter."],
    ["deliver/sms", "sends an sms rendition through the sms provider's adapter. Only reached with consent."],
    ["deliver/site", "grants access to a page or lesson, recorded as a fact. Needs a route and a store: Alchemy resources."],
    ["pace", "Effect createEffectLogic: holds a send until the path's rate allows it."],
  ],
  events: [["fact", "one transaction that touched this person, with the facts as of it. The log is the event stream."]],
  guards: Object.entries(ATOMS).map(([name, spec]) => [name, spec.doc] as const),
} as const;

const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^[^a-zA-Z_]+/, "");
const q = JSON.stringify;
const ms = (n: number) => n.toLocaleString("en-US").replace(/,/g, "_");

// A predicate becomes one call per registered word, combined with && || !. With since, each positive
// word counts only evidence from that instant on (fresh[…]), and a word under ! reads everything (D39).
export const predTs = (p: Pred, facts = "facts", since?: string): string => {
  if (p.name === "and" || p.name === "or") return `(${(p.kids ?? []).map((k) => predTs(k, facts, since)).join(p.name === "and" ? " && " : " || ") || "true"})`;
  if (p.name === "not") return `!${predTs(p.kids?.[0] ?? { name: "and", kids: [] }, facts)}`;
  if (!isAtom(p.name)) return "false";
  const args = [p.arg, p.arg2, p.within].flatMap((x) => (x === undefined ? [] : [q(x)]));
  return since === undefined
    ? `preds[${q(p.name)}](${facts}, person${args.length ? `, ${args.join(", ")}` : ""})`
    : `fresh[${q(p.name)}](${facts}, person, ${since}${args.length ? `, ${args.join(", ")}` : ""})`;
};

export const generateMachine = (m: Path): string => {
  const id = m.id;
  const name = `${camel(id) || "path"}Machine`;
  const out: Array<string> = [];
  // With a target, the walk is one region of a parallel machine, two levels deeper.
  let shift = 0;
  const push = (indent: number, s: string) => out.push(`${"  ".repeat(indent + shift)}${s}`);
  const walk = m.target ? `#${id}.walk.` : `#${id}.`;
  out.push(`// generated from the facts of ${q(id)}. Illustrative, not run here.`);
  out.push(`import { setupEffect } from "@xstate/effect";`);
  out.push(`import { types } from "xstate";`);
  out.push(`// reviewed code: the only words the data can name`);
  out.push(`import { deliver, FactEvent, fresh, pace, PathInput, preds, type Facts } from "./halter-registry";`);
  out.push("");
  out.push("interface PathContext {");
  out.push("  readonly person: string;");
  out.push("  readonly outcome: \"done\" | \"exited\" | undefined;");
  if (m.target) {
    out.push("  readonly target: \"reached\" | \"missed\" | undefined;");
    out.push("  // when this person entered: the target only counts acts whose :act/at is at or after it");
    out.push("  readonly enteredAt: number;");
  }
  out.push("}");
  out.push("");
  if (m.guard.length > 0) {
    out.push("// (guard …): deliver checks it before every send. First match wins; no match means send.");
    out.push("const guard = [");
    for (const g of m.guard) {
      push(1, `// (when ${printPred(g.when)} ${printAction(g)})`);
      push(1, `{ when: (facts: Facts, person: string) => ${predTs(g.when)}, ${g.action === "skip" ? `skip: ${q(g.reason ?? "")}` : `deferMs: ${ms(g.for ?? 0)}`} },`);
    }
    out.push("] as const;");
    out.push("");
  }
  out.push(`export const ${name} = setupEffect({`);
  push(1, "actors: { deliver, pace },");
  push(1, "schemas: { context: types<PathContext>(), input: PathInput, events: FactEvent },");
  out.push("}).createMachine({");
  push(1, `id: ${q(id)},`);
  push(1, `context: ({ input }) => ({ person: input.person, outcome: undefined${m.target ? ", target: undefined, enteredAt: input.at" : ""} }),`);
  push(1, "// the interpreter reads this when the actor stops, and writes the lifecycle transaction");
  push(1, `output: ({ context }) => ({ person: context.person, path: ${q(id)}, outcome: context.outcome${m.target ? ", target: context.target" : ""} }),`);
  if (m.target) {
    push(1, "// the walk and the target run side by side; the actor stops when both are final");
    push(1, `type: "parallel",`);
    push(1, "states: {");
    push(2, "walk: {");
    shift = 2;
  }
  push(1, `initial: ${q(m.states[0]?.name ?? "done")},`);
  if (m.exitOn) {
    push(1, `// (exit-on ${printPred(m.exitOn)}): every fact event is checked, in any state`);
    push(1, "on: {");
    push(2, "fact: ({ context, event: { facts } }) => {");
    push(3, "const person = context.person;");
    push(3, `return ${predTs(m.exitOn)} ? { target: ".exited", context: { ...context, outcome: "exited" } } : undefined;`);
    push(2, "},");
    push(1, "},");
  }
  push(1, "states: {");
  m.states.forEach((st, si) => {
    const nextState = m.states[si + 1]?.name ?? "done";
    push(2, `${q(st.name)}: {`);
    const timed = st.tos.filter((t) => t.after !== undefined);
    const when = st.tos.filter((t) => t.when !== undefined);
    const target = (t: string) => q(`${walk}${t === "closed" ? "done" : t}`);
    const final = (t: string) => (t === "closed" || t === "done" ? `{ ...context, outcome: "done" }` : "context");
    if (timed.length > 0) {
      push(3, "after: {");
      for (const t of timed) {
        push(4, `// (to ${t.target} :after ${duration(t.after ?? 0)})${t.target === "closed" ? ": closed routes to done" : ""}`);
        push(4, `${ms(t.after ?? 0)}: ({ context }) => ({ target: ${target(t.target)}, context: ${final(t.target)} }),`);
      }
      push(3, "},");
    }
    if (when.length > 0) {
      push(3, "on: {");
      push(4, "fact: ({ context, event: { facts } }) => {");
      push(5, "const person = context.person;");
      for (const t of when) push(5, `if (${predTs(t.when ?? { name: "and", kids: [] })}) return { target: ${target(t.target)}, context: ${final(t.target)} };`);
      push(5, "return undefined;");
      push(4, "},");
      push(3, "},");
    }
    const sends = st.sends;
    const step = (s: Send) => `send-${s.key}`;
    const waitOf = (s: Send) => `wait-${s.key}`;
    const first = sends[0];
    if (first) {
      const hasWait = (s: Send, prev: Send | undefined) => s.on !== undefined || (s.after ?? 0) - (prev?.after ?? 0) > 0;
      push(3, `initial: ${q(hasWait(first, undefined) ? waitOf(first) : step(first))},`);
      push(3, "states: {");
      sends.forEach((s, i) => {
        const prev = sends[i - 1];
        const nx = sends[i + 1];
        const next = nx === undefined ? "sent" : hasWait(nx, s) ? waitOf(nx) : step(nx);
        if (s.on !== undefined) {
          push(4, `// :on ${q(s.on)}: a delayed transition armed for that instant, on Effect's Clock`);
          push(4, `${q(waitOf(s))}: { after: { ${q(`until:${s.on}`)}: ({ context }) => ({ target: ${q(step(s))}, context }) } },`);
        } else if (hasWait(s, prev)) {
          push(4, `${q(waitOf(s))}: { after: { ${ms((s.after ?? 0) - (prev?.after ?? 0))}: ({ context }) => ({ target: ${q(step(s))}, context }) } },`);
        }
        const timing = s.on !== undefined ? `:on ${q(s.on)}` : `:after ${duration(s.after ?? 0)}`;
        push(4, `// (send ${q(s.key)} ${timing} :job ${s.job ?? "?"}${s.via ? ` :via ${printVia(s.via)}` : ""}${s.deadline ? ` :deadline ${s.deadline}` : ""})`);
        push(4, `${q(step(s))}: {`);
        push(5, "invoke: {");
        push(6, `src: "deliver",`);
        const via = s.via ?? { channels: ["email"] };
        push(6, `input: ({ context }) => ({ person: context.person, path: ${q(id)}, message: ${q(s.key)}, via: { ${via.op ? `op: ${q(via.op)}, ` : ""}channels: [${via.channels.map((c) => q(c)).join(", ")}] }${m.guard.length ? ", guard" : ""} }),`);
        push(6, `onDone: ({ context }) => ({ target: ${q(next)}, context }),`);
        push(5, "},");
        push(4, "},");
      });
      if (timed.length === 0 && when.length === 0) {
        push(4, `// no (to …): the state ends after its last send${nextState === "done" ? ", and the last state ends in done" : ""}`);
        push(4, `sent: { always: ({ context }) => ({ target: ${target(nextState)}, context: ${final(nextState)} }) },`);
      } else push(4, "sent: {},");
      push(3, "},");
    }
    push(2, "},");
  });
  push(2, `done: { type: "final" },`);
  if (m.exitOn) push(2, `exited: { type: "final" },`);
  push(1, "},");
  if (m.target) {
    shift = 0;
    const tg = m.target;
    push(2, "},");
    push(2, `// (target ${printPred(tg.pred)}${tg.within === undefined ? "" : ` :within ${duration(tg.within)}`})`);
    push(2, "// measures only: it never gates a send, and it keeps watching after done or exited");
    push(2, "target: {");
    push(3, `initial: "measuring",`);
    push(3, "states: {");
    push(4, "measuring: {");
    if (tg.within !== undefined) push(5, `after: { ${ms(tg.within)}: ({ context }) => ({ target: "missed", context: { ...context, target: "missed" } }) },`);
    push(5, "on: {");
    push(6, "fact: ({ context, event: { facts } }) => {");
    push(7, "const person = context.person;");
    push(7, "// fresh: acts that happened at or after entry, by :act/at (D39)");
    push(7, `return ${predTs(tg.pred, "facts", "context.enteredAt")}`);
    push(8, `? { target: "reached", context: { ...context, target: "reached" } }`);
    push(8, ": undefined;");
    push(6, "},");
    push(5, "},");
    push(4, "},");
    push(4, `reached: { type: "final" },`);
    push(4, `missed: { type: "final" },`);
    push(3, "},");
    push(2, "},");
    push(1, "},");
  }
  out.push("});");
  return `${out.join("\n")}\n`;
};

// The fixed interpreter around every generated machine. Hand written, reviewed once; shown for the shape.
export const INTERPRETER = `// halter's interpreter: fixed code, the same for every path. Illustrative, not run here.
import { Effect } from "effect";
import { createEffectActor, send } from "@xstate/effect";

// Each transaction becomes a fact event for the people it touches.
export const onTransaction = Effect.fn("halter.onTransaction")(function* (tx: Tx) {
  for (const person of tx.people) {
    for (const actor of yield* actorsOf(person)) yield* send(actor, { type: "fact", tx: tx.t, facts: yield* asOf(tx.t) });
    // enters-on is a subscription on the log: spawn the person's actor when it turns true
    for (const path of yield* pathsNotEntered(person))
      if (path.entersOn(yield* asOf(tx.t), person)) yield* enter(path, person, tx);
  }
});

// Each region writes its own path event the moment it lands, so successors hear :path/finished
// at once, while the target region goes on watching until :within runs out. Written once each.
export const onRegionFinal = Effect.fn("halter.onRegionFinal")(function* (
  out: { person: string; path: string; region: "walk" | "target"; value: "done" | "exited" | "reached" | "missed" },
) {
  const attr = { done: ":path/finished", exited: ":path/exited", reached: ":path/reached-target", missed: ":path/missed-target" }[out.value];
  yield* transact({
    who: "agent:halter",
    source: "observed",
    why: \`\${out.path} \${out.region} reached \${out.value}\`,
    ops: [
      [out.person, attr, out.path],
      ...(out.region === "walk" ? [["retract", out.person, ":path/at", yield* currentState(out.person, out.path)]] : []),
    ],
  });
});
`;
