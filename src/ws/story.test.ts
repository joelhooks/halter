// The workspace's update, told as stories: Messages in, Model and Commands out. No view, no DOM.
import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { deepStrictEqual, ok } from "node:assert/strict";
import { AUTHORED, seedDb } from "../seed.ts";
import { Message } from "./message.ts";
import { CommitState, initModel, type Model } from "./model.ts";
import { BREAK, RunInterpreter, ScrollToHere, update } from "./update.ts";
import { draftText } from "./derive.ts";

const db = seedDb();
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
    given(at("bf-2027", 220)),
    message(Message.MovedSlider({ t: 84 })),
    model((m) => {
      deepStrictEqual(m.t, 84);
      ok(Option.isNone(m.maybeDraft));
    }),
    message(Message.ClickedBreak()),
    model((m) => {
      ok(Option.isSome(m.maybeDraft) && m.maybeDraft.value.includes("(vary role :hard\n"));
      deepStrictEqual(m.notice, "Broken on purpose. Read the checks, then Reset.");
    }),
    message(Message.MovedSlider({ t: 90 })),
    model((m) => ok(Option.isSome(m.maybeDraft), "a draft stays put when the slider moves")),
    message(Message.ClickedReset()),
    model((m) => ok(Option.isNone(m.maybeDraft))),
  );
});

test("History asks to scroll to the slider's transaction; other tabs ask for nothing", () => {
  story(update, given(at("small-tools-bridge", 125)), message(Message.SelectedTab({ tab: "History" })), Command.expectExact(ScrollToHere()), Command.resolve(ScrollToHere, Message.CompletedScrollToHere()));
  story(update, given(at("small-tools-bridge", 125)), message(Message.SelectedTab({ tab: "Got" })), Command.expectNone());
});

test("Content shows the printout tab, whatever tab was open", () => {
  story(
    update,
    given(at("bf-2027", 220, { tab: "Edit" })),
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
    given(at("bf-2027", 178, { tab: "Edit", maybeDraft: Option.some("(path") })),
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
    given(at("bf-2027", 220)),
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
