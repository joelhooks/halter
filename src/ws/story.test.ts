// The workspace's update, told as stories: Messages in, Model and Commands out. No view, no DOM.
import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { deepStrictEqual, ok } from "node:assert/strict";
import { AUTHORED, seedDb } from "../seed.ts";
import { Message } from "./message.ts";
import { CommitState, initModel, type Model } from "./model.ts";
import { BREAK, RunInterpreter, ScrollToHere, update } from "./update.ts";
import { draftOf, draftText } from "./derive.ts";

const db = seedDb();

// Moments in the seed, looked up by what happened, so new seed transactions don't renumber the tests.
const tOf = (who: string, at: string) => {
  const x = db.log.find((tx) => tx.who === who && tx.at === at);
  if (!x) throw new Error(`no transaction by ${who} at ${at}`);
  return x.t;
};
const HEAD = db.log.at(-1)?.t ?? 0;
// Mara's own waiver on the cohort, and agent:drafter's on Black Friday (D36)
const C7_SELF = tOf("mara", "2027-02-10T18:20Z");
const DRAFTER_SELF = tOf("agent:drafter", "2027-10-22T16:00Z");
// the bridge just after Mara's move and its rebase
const BRIDGE_MID = tOf("mara", "2027-11-22T10:00Z") + 2;
// two transactions after Black Friday's last call went out
const AFTER_LAST_CALL = (db.log.filter((tx) => tx.at <= "2027-11-30T02:00Z").at(-1)?.t ?? 0) + 2;
const at = (pathId: string, t: number, rest: Partial<Model> = {}): Model => ({ ...initModel({ pathId, db, authored: AUTHORED }), t, ...rest });
let failed = 0;
let passed = 0;
const test = (name: string, f: () => void) => {
  try {
    f();
    passed++;
    console.log(`ok ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

test("the editor follows the slider until there's a draft, and Reset hands it back", () => {
  story(
    update,
    given(at("bf-2027", HEAD)),
    message(Message.MovedSlider({ t: DRAFTER_SELF })),
    model((m) => {
      deepStrictEqual(m.t, DRAFTER_SELF);
      ok(Option.isNone(m.maybeDraft));
    }),
    message(Message.ClickedBreak()),
    model((m) => {
      ok(Option.isSome(m.maybeDraft) && m.maybeDraft.value.includes('(knitter "bf-02-knitter")'));
      deepStrictEqual(m.notice, "Broken on purpose. Read the checks, then Reset.");
    }),
    message(Message.MovedSlider({ t: 90 })),
    model((m) => ok(Option.isSome(m.maybeDraft), "a draft stays put when the slider moves")),
    message(Message.ClickedReset()),
    model((m) => ok(Option.isNone(m.maybeDraft))),
  );
});

// D40: a commit answers only for what it adds. At the head, hard-from-inferred is true on Black Friday
// (Jo's guessed role), and an edit that doesn't add a refusal still commits.
const headDraft = draftText(at("bf-2027", HEAD));
test("a commit isn't refused by a refusal that was there before it", () => {
  story(
    update,
    given(at("bf-2027", HEAD, { tab: "Edit" })),
    message(Message.UpdatedDraft({ text: headDraft.replace(':title "Black Friday 2027"', ':title "Black Friday, 2027"') })),
    message(Message.UpdatedWhy({ value: 'Mara: "Put a comma in the title."' })),
    model((m) => {
      const v = draftOf(m).verdict;
      ok(v.ok, JSON.stringify(v.findings.filter((f) => f.severity === "refuse")));
      deepStrictEqual(v.findings.filter((f) => f.standing === "before").map((f) => f.check), ["hard-from-inferred"]);
    }),
    message(Message.ClickedCommit({ kind: "plain" })),
    model((m) => ok(CommitState.isAnyOf(["Running"])(m.commit), m.notice)),
    Command.expectHas(RunInterpreter),
    Command.resolve(RunInterpreter, Message.FailedRunInterpreter({ reason: "not run in a story" })),
  );
});
test("a commit that adds a refusal is refused, and names only that one", () => {
  story(
    update,
    given(at("bf-2027", HEAD, { tab: "Edit" })),
    message(Message.UpdatedDraft({ text: headDraft.replace('\n        (else "bf-02")', "") })),
    message(Message.UpdatedWhy({ value: 'Mara: "Drop the else."' })),
    message(Message.ClickedCommit({ kind: "plain" })),
    Command.expectNone(),
    model((m) => {
      ok(m.notice.startsWith("Nothing committed: refused: else-on-every-vary:"), m.notice);
      ok(!m.notice.includes("hard-from-inferred"), m.notice);
      deepStrictEqual(m.db, db);
    }),
  );
});

test("History asks to scroll to the slider's transaction; other tabs ask for nothing", () => {
  story(update, given(at("small-tools-bridge", BRIDGE_MID)), message(Message.SelectedTab({ tab: "History" })), Command.expectExact(ScrollToHere()), Command.resolve(ScrollToHere, Message.CompletedScrollToHere()));
  story(update, given(at("small-tools-bridge", BRIDGE_MID)), message(Message.SelectedTab({ tab: "Got" })), Command.expectNone());
});

test("Content shows the printout tab, whatever tab was open", () => {
  story(
    update,
    given(at("bf-2027", HEAD, { tab: "Edit" })),
    message(Message.SelectedFile({ file: "content" })),
    model((m) => {
      deepStrictEqual(m.tab, "Printout");
      deepStrictEqual(m.file, "content");
    }),
  );
});

test("committing under people without a quote writes nothing and runs nothing", () => {
  story(
    update,
    given(at("bf-2027", AFTER_LAST_CALL, { tab: "Edit", maybeDraft: Option.some("(path") })),
    message(Message.ClickedCommit({ kind: "move" })),
    Command.expectNone(),
    model((m) => {
      ok(m.notice.startsWith("Nothing committed:"), m.notice);
      deepStrictEqual(m.db, db);
    }),
  );
});

test("a commit runs the interpreter in a Command, and a refusal leaves the log as it was", () => {
  story(
    update,
    given(at("bf-2027", HEAD)),
    message(Message.ClickedMarkSeen()),
    model((m) => {
      ok(CommitState.isAnyOf(["Running"])(m.commit));
      deepStrictEqual(m.notice, "Running the interpreter from your edit…");
    }),
    Command.expectHas(RunInterpreter),
    Command.resolve(RunInterpreter, Message.FailedRunInterpreter({ reason: "refused: deadline-kept: 1 people were told close is X." })),
    model((m) => {
      ok(CommitState.isAnyOf(["Idle"])(m.commit));
      deepStrictEqual(m.db, db);
      deepStrictEqual(m.authored, AUTHORED);
      deepStrictEqual(m.notice, "Nothing committed: refused: deadline-kept: 1 people were told close is X.");
    }),
  );
});

test("Break changes every path it names, every edit landing on the printed head", () => {
  for (const [pathId, edits] of Object.entries(BREAK)) {
    const head = draftText(at(pathId, db.log.length));
    for (const [from] of edits) ok(head.includes(from), `${pathId}: Break looks for ${JSON.stringify(from)}`);
  }
});

console.log(failed === 0 ? `${passed} stories passed` : `${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
