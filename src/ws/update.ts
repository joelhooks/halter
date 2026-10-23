// UPDATE
// Every commit forks the authored log at the slider, sets aside what came later (a cursor keeps it),
// and runs the interpreter on from the edit in a Command, so its path events follow. A refusal,
// from transact or from the interpreter, leaves the Model's log as it was.
import { Effect, Option, Schema } from "effect";
import { Command, Dom, type Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import { dateMs, inverse, msDate, transact, type Db, type Tx, type TxInput } from "../db.ts";
import { quotes } from "../checks.ts";
import { markSeenOps } from "../feed.ts";
import { type Send, type Path } from "../model.ts";
import { printPath } from "../printer.ts";
import { HORIZON } from "../seed.ts";
import { interpret } from "../run.ts";
import { nameOf } from "../time.ts";
import { confirmWaiver, gotAnchor, NEEDS_WORDS, SELF_WAIVE, H } from "../views.ts";
import { draftOf, draftText, hereOf, viewOf } from "./derive.ts";
import { Message, type CommitKind } from "./message.ts";
import { AuthoredValue, CommitState, Said, type Model, type Pending } from "./model.ts";

export const UNDER_PEOPLE = "Committing under people needs your own words, in quotes.";

export const BREAK: Record<string, ReadonlyArray<readonly [string, string]>> = {
  "small-tools-bridge": [
    ['  (exit-on (bought? "small-tools"))\n', ""],
    ['"p3" :after 90h', '"p3" :after 99h'],
  ],
  "fieldkit-c7": [
    ["\n      :deadline early-bird", ""],
    ['(early-bird :until "2027-03-08T23:00Z")', '(early-bird :until "2027-03-20T23:00Z")'],
  ],
  "bf-2027": [
    ['(writer "bf-02-writer")', '(knitter "bf-02-knitter")'],
    ['\n        (else "bf-02")', ""],
  ],
  "spring-note": [['(enters-on (on-list? "fernhill-news")', '(enters-on (not (bought? "library"))']],
  "why-didnt-you-buy": [['      :answers (why-not too-expensive)))', '      :answers (why-not too-expensive))\n    (to closed :when (bought? "small-tools")))']],
  "five-day-tools": [['(send "day-3" :after 48h\n      :job teach\n      :via (and site email))', '(send "day-3" :after 48h\n      :job teach\n      :via (and site sms))']],
};

// COMMAND

export const RunInterpreter = Command.define("RunInterpreter", {
  args: { inputs: AuthoredValue, horizon: Schema.String },
  messages: [Message.SucceededRunInterpreter, Message.FailedRunInterpreter],
  execute: ({ inputs, horizon }) =>
    Effect.sleep("20 millis").pipe(
      Effect.flatMap(() => Effect.try(() => interpret(inputs, horizon))),
      Effect.map((db) => Message.SucceededRunInterpreter({ db })),
      Effect.catch((e) => Effect.succeed(Message.FailedRunInterpreter({ reason: e.cause instanceof Error ? e.cause.message : String(e.cause) }))),
    ),
});

export const ScrollToHere = Command.define("ScrollToHere", {
  messages: [Message.CompletedScrollToHere],
  execute: Dom.scrollIntoView(".hist .here", { block: "nearest" }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollToHere())),
});

export const ScrollToDelivery = Command.define("ScrollToDelivery", {
  args: { anchor: Schema.String },
  messages: [Message.CompletedScrollToDelivery],
  execute: ({ anchor }) => Dom.scrollIntoView(`#${anchor}`, { block: "start" }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollToDelivery())),
});

// UPDATE

type UpdateReturn = Update.Return<Model, Message>;

const nothing = (model: Model, notice: string): UpdateReturn => ({ model: modifyFields(model, { notice: () => notice }) });

// One transaction just after the slider's instant.
const nextAt = (model: Model) => msDate((dateMs(model.db.log[model.t - 1]?.at ?? "") ?? 0) + 60_000);

const write = (model: Model, input: Omit<TxInput, "at">, said: Said, keepLater = false): UpdateReturn => {
  const at = nextAt(model);
  const full: TxInput = { ...input, at };
  const check = transact(hereOf(model), full);
  if (!check.ok) {
    return nothing(model, `Nothing committed: ${check.error}`);
  }
  const keep = model.authored.filter((x) => (dateMs(x.at) ?? 0) < (dateMs(at) ?? 0));
  const later = keepLater ? model.authored.filter((x) => (dateMs(x.at) ?? 0) >= (dateMs(at) ?? 0)) : [];
  const authored = [...keep, full, ...later];
  const pending: Pending = { at, who: full.who, why: full.why, hasMoves: (full.moves?.length ?? 0) > 0, setAside: model.authored.length - keep.length - later.length, authored, said };
  return {
    model: modifyFields(model, { notice: () => "Running the interpreter from your edit…", commit: () => CommitState.Running({ pending }) }),
    commands: [RunInterpreter({ inputs: authored, horizon: (dateMs(at) ?? 0) < (dateMs(HORIZON) ?? 0) ? HORIZON : msDate((dateMs(at) ?? 0) + H) })],
  };
};

const saidText = (said: Said, tx: Tx, pathId: string): string =>
  Said.match(said, {
    Plain: () => `Committed t=${tx.t}: ${tx.datoms.length} datoms.`,
    ForNewEntrants: () => `Committed t=${tx.t}: a new version for whoever enters next. The people already here keep theirs until a move.`,
    MoveEveryone: () => `Committed t=${tx.t}: the edit and (move ${JSON.stringify(pathId)}) in one transaction. Everyone on the path runs the new version.`,
    ConfirmWaiver: ({ check }) => `Committed t=${tx.t}: Mara confirmed the ${check} waiver. It counts now, and history keeps the proposal too.`,
    MarkSeen: () => `Marked seen at t=${tx.t}. The feed starts here.`,
    Undo: ({ target }) => `Committed t=${tx.t}, a new transaction that flips t=${target}. History keeps both.`,
  });

const landed = (model: Model, pending: Pending, db: Db): UpdateReturn => {
  const tx = db.log.find((x) => x.at === pending.at && x.who === pending.who && x.why === pending.why);
  // after a move, land on the interpreter's path event that rebased people, so the slider shows them moved
  const rebased = tx && pending.hasMoves ? db.log.find((x) => x.t > tx.t && x.who === "agent:halter" && x.why.startsWith(`${model.pathId}: moved by t=${tx.t},`)) : undefined;
  const moved = rebased ? [...new Set(rebased.datoms.filter((x) => x.a === "path/version" && x.added).map((x) => String(x.e)))] : [];
  const names = nameOf(db);
  const notice = `${tx ? saidText(pending.said, tx, model.pathId) : "Committed."}${
    rebased ? ` At t=${rebased.t} the interpreter moved ${moved.map(names).join(", ")}.` : tx && pending.hasMoves ? " Nobody needed moving." : ""
  }${pending.setAside ? ` ${pending.setAside} later seed ${pending.setAside === 1 ? "transaction is" : "transactions are"} set aside on this fork.` : ""}`;
  return {
    model: modifyFields(model, {
      db: () => db,
      authored: () => pending.authored,
      t: () => rebased?.t ?? tx?.t ?? db.log.length,
      maybeDraft: () => Option.none(),
      why: () => "",
      notice: () => notice,
      commit: () => CommitState.Idle(),
    }),
  };
};

const commit = (model: Model, kind: CommitKind): UpdateReturn => {
  const d = draftOf(model);
  if (d.error) {
    return nothing(model, `Nothing committed: ${d.error}.`);
  }
  if (kind !== "plain" && !quotes(model.why)) {
    return nothing(model, `Nothing committed: ${UNDER_PEOPLE}`);
  }
  if (d.ops.length === 0 && kind !== "move") {
    return nothing(model, "Nothing committed: nothing is staged.");
  }
  // a commit is refused by the refusals it adds, and only those (D40)
  const adds = d.verdict.findings.filter((f) => f.severity === "refuse" && f.standing === undefined);
  if (adds.length > 0) {
    return nothing(model, `Nothing committed: refused: ${adds.map((f) => `${f.check}: ${f.message}`).join("; ")}`);
  }
  const input = { who: model.who, why: model.why, source: model.source, ...(model.source === "inferred" ? { rule: "editor" } : {}), ops: d.ops, ...(kind === "move" ? { moves: [{ path: model.pathId }] } : {}) };
  return write(model, input, kind === "move" ? Said.MoveEveryone() : kind === "new" ? Said.ForNewEntrants() : Said.Plain());
};

// Nobody waives their own alarm (D36): Mara confirms someone else's pending waiver by asserting it
// again, with the why she typed, unless she raised the alarm herself.
const confirm = (model: Model, check: string): UpdateReturn => {
  const raisedBy = viewOf(model).verdict?.findings.find((f) => f.check === check)?.raisedBy ?? [];
  const r = confirmWaiver(hereOf(model), { id: model.pathId, check, who: "mara", why: model.why, at: nextAt(model), raisedBy });
  if (!r.ok) {
    return nothing(model, `Nothing committed: ${raisedBy.includes("mara") ? SELF_WAIVE : NEEDS_WORDS}`);
  }
  return write(model, { who: "mara", why: model.why, source: "assumed", ops: [{ e: model.pathId, a: "path/waives", v: check, added: true }] }, Said.ConfirmWaiver({ check }));
};

const undo = (model: Model): UpdateReturn => {
  const log = hereOf(model).log;
  const undone = new Set(log.flatMap((x) => x.datoms.filter((d) => d.a === "tx/undoes").map((d) => Number(d.v))));
  const target = [...log]
    .reverse()
    .find((x) => x.who !== "agent:halter" && x.datoms.some((d) => d.e === model.pathId || String(d.e).startsWith(`${model.pathId}/`)) && !undone.has(x.t) && !x.datoms.some((d) => d.a === "tx/undoes"));
  if (!target) {
    return nothing(model, "Nothing to undo here.");
  }
  const why = model.why.trim() ? `Undo of t=${target.t}: ${model.why.trim()}` : `Undo of t=${target.t}`;
  return write(model, { who: model.who, why, source: "assumed", undoes: target.t, ops: inverse(target) }, Said.Undo({ target: target.t }));
};

const editCard = (model: Model, key: string, field: "job" | "timing", value: string): UpdateReturn => {
  const d = draftOf(model);
  if (!d.path) {
    return { model };
  }
  const edit = (s: Send): Send => {
    if (s.key !== key) {
      return s;
    }
    if (field === "job") {
      return { ...s, job: value };
    }
    const m = /^(\d+)([mh])$/.exec(value.trim());
    const { on: _on, after: _after, ...rest } = s;
    if (m) {
      return { ...rest, after: Number(m[1]) * (m[2] === "h" ? H : 60_000) };
    }
    if (dateMs(value.trim()) !== undefined) {
      return { ...rest, on: value.trim() };
    }
    return s;
  };
  const p: Path = { ...d.path, states: d.path.states.map((st) => ({ ...st, sends: st.sends.map(edit) })) };
  return { model: modifyFields(model, { maybeDraft: () => Option.some(printPath(p)) }) };
};

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    MovedSlider: ({ t }) => ({ model: modifyFields(model, { t: () => t }) }),
    SelectedTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab }), ...(tab === "History" ? { commands: [ScrollToHere()] } : {}) }),
    // the editor and the history are structure; asking for content shows the content printout
    SelectedFile: ({ file }) => ({ model: modifyFields(model, { file: () => file, tab: () => "Printout" as const }) }),
    UpdatedDraft: ({ text }) => ({ model: modifyFields(model, { maybeDraft: () => Option.some(text), notice: () => "" }) }),
    UpdatedWhy: ({ value }) => ({ model: modifyFields(model, { why: () => value }) }),
    SelectedWho: ({ who }) => ({ model: modifyFields(model, { who: () => who }) }),
    SelectedSource: ({ source }) => ({ model: modifyFields(model, { source: () => source }) }),
    ChangedCard: ({ key, field, value }) => editCard(model, key, field, value),
    ClickedCommit: ({ kind }) => commit(model, kind),
    ClickedConfirmWaiver: ({ check }) => confirm(model, check),
    // Mark seen (D37): Mara's cursor moves to this point. It's a fact, written by her, and approves nothing.
    ClickedMarkSeen: () => write(model, { who: "mara", why: "marked seen", source: "assumed", ops: markSeenOps(hereOf(model), "mara", model.pathId) }, Said.MarkSeen(), true),
    ClickedUndo: () => undo(model),
    ClickedBreak: () => ({
      model: modifyFields(model, {
        maybeDraft: () => Option.some((BREAK[model.pathId] ?? []).reduce((text, [from, to]) => text.replace(from, to), draftText(model))),
        notice: () => "Broken on purpose. Read the checks, then Reset.",
      }),
    }),
    ClickedReset: () => ({ model: modifyFields(model, { maybeDraft: () => Option.none(), notice: () => "Draft reset to the head." }) }),
    // A name under Where people are opens that person's deliveries in What they got.
    ClickedPerson: ({ person }) => ({
      model: modifyFields(model, { tab: () => "Got" as const, openPeople: (open) => (open.includes(person) ? open : [...open, person]) }),
      commands: [ScrollToDelivery({ anchor: gotAnchor(model.pathId, person) })],
    }),
    ToggledDelivery: ({ person, isOpen }) => ({
      model: modifyFields(model, { openPeople: (open) => (isOpen ? (open.includes(person) ? open : [...open, person]) : open.filter((p) => p !== person)) }),
    }),
    SucceededRunInterpreter: ({ db }) =>
      CommitState.match(model.commit, {
        Idle: () => ({ model }),
        Running: ({ pending }) => landed(model, pending, db),
      }),
    FailedRunInterpreter: ({ reason }) => ({ model: modifyFields(model, { notice: () => `Nothing committed: ${reason}`, commit: () => CommitState.Idle() }) }),
    CompletedScrollToHere: () => ({ model }),
    CompletedScrollToDelivery: () => ({ model }),
  });

