// UI behaviour is a scene: each test drives the workspace's real view through roles, names and text.
// A Command that runs the interpreter is resolved with what the real interpreter says: the test runs
// the Command the update returned first, so a refusal on the page is the engine's own refusal.
import { Effect } from "effect";
import { Command, click, expect, given, role, scene, selector, text, type } from "foldkit/scene";
import { AUTHORED, seedDb } from "../seed.ts";
import { SELF_WAIVE } from "../views.ts";
import { draftText } from "./derive.ts";
import { Message } from "./message.ts";
import { initModel, type Model } from "./model.ts";
import { RunInterpreter, ScrollToDelivery, ScrollToHere, update } from "./update.ts";
import { view } from "./view.ts";

const db = seedDb();
const program = { update, view };
const at = (pathId: string, t: number, rest: Partial<Model> = {}): Model => ({ ...initModel({ pathId, db, authored: AUTHORED }), t, ...rest });

let failed = 0;
let passed = 0;
const test = async (name: string, f: () => void | Promise<void>) => {
  try {
    await f();
    passed++;
    console.log(`ok ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// The Message the interpreter Command really produces after these Messages.
const interpreted = (model: Model, messages: ReadonlyArray<Message>): Promise<Message> => {
  const last = messages.reduce<ReturnType<typeof update>>((r, m) => update(r.model, m), { model });
  const cmd = (last.commands ?? []).find((c) => c.name === "RunInterpreter");
  if (!cmd) {
    return Promise.reject(new Error("no RunInterpreter command"));
  }
  return Effect.runPromise(cmd.effect as Effect.Effect<Message>);
};

await test("the slider replays the log", () => {
  scene(program, given(at("bf-2027", 220)), expect(text("t=220")).toExist(), type(selector("input.slider"), "84"), expect(text("t=84")).toExist(), expect(text("2027-10-22T16:00Z")).toExist());
});

await test("tabs switch the panel, and History scrolls to the slider's transaction", () => {
  scene(
    program,
    given(at("small-tools-bridge", 125)),
    expect(role("button", { name: "Printout" })).toHaveAttr("aria-pressed", "true"),
    click(role("button", { name: "History" })),
    Command.expectExact(ScrollToHere()),
    Command.resolve(ScrollToHere, Message.CompletedScrollToHere()),
    expect(role("button", { name: "History" })).toHaveAttr("aria-pressed", "true"),
    expect(selector("ol.hist li.here")).toExist(),
  );
});

await test("a name under Where people are opens what they got", () => {
  scene(
    program,
    given(at("small-tools-bridge", 125)),
    click(role("button", { name: "Ana Birch" })),
    Command.expectExact(ScrollToDelivery({ anchor: "got-small-tools-bridge-ana" })),
    Command.resolve(ScrollToDelivery, Message.CompletedScrollToDelivery()),
    expect(role("button", { name: "Got" })).toHaveAttr("aria-pressed", "true"),
    expect(selector("details#got-small-tools-bridge-ana")).toHaveAttr("open", "true"),
    expect(selector("details#got-small-tools-bridge-ben")).toExist(),
  );
});

await test("nobody confirms a waiver of their own alarm (D36)", () => {
  scene(
    program,
    given(at("fieldkit-c7", 17, { tab: "Edit" })),
    type(selector("label.why input"), 'Mara: "ok"'),
    expect(role("button", { name: "Confirm as Mara" })).toHaveAttr("aria-disabled", "true"),
    expect(role("button", { name: "Confirm as Mara" })).toHaveAttr("title", SELF_WAIVE),
  );
});

await test("confirming someone else's pending waiver commits it (D36)", async () => {
  const why = 'Mara: "Fine, keep the variants."';
  const m = at("bf-2027", 84, { tab: "Edit" });
  const result = await interpreted(m, [Message.UpdatedWhy({ value: why }), Message.ClickedConfirmWaiver({ check: "few-values" })]);
  scene(
    program,
    given(m),
    expect(role("button", { name: "Confirm as Mara" })).toHaveAttr("aria-disabled", "true"),
    type(selector("label.why input"), why),
    click(role("button", { name: "Confirm as Mara" })),
    expect(text("Running the interpreter from your edit…")).toExist(),
    Command.resolve(RunInterpreter, result),
    expect(text("Mara confirmed the few-values waiver", { exact: false })).toExist(),
  );
});

const twoDays = 'Mara: "Give them two more days."';
const surged = (m: Model) => draftText(m).replace(':closes "2027-11-30T07:59Z"', ':closes "2027-12-02T07:59Z"');

await test("a told deadline is locked: Commit and move everyone is refused and nothing changes (D38)", async () => {
  const m = at("bf-2027", 178, { tab: "Edit" });
  const draft = surged(m);
  const result = await interpreted(m, [Message.UpdatedDraft({ text: draft }), Message.UpdatedWhy({ value: twoDays }), Message.ClickedCommit({ kind: "move" })]);
  scene(
    program,
    given(m),
    type(selector("textarea.lisp-edit"), draft),
    type(selector("label.why input"), twoDays),
    click(role("button", { name: "Commit and move everyone" })),
    Command.resolve(RunInterpreter, result),
    expect(text("Nothing committed: refused: deadline-kept: 4 people were told close is 2027-11-30T07:59Z.", { exact: false })).toExist(),
    expect(text("t=178")).toExist(),
    expect(selector("input.slider")).toHaveAttr("max", String(db.log.length)),
    expect(role("button", { name: "Commit for new entrants" })).not.toHaveAttr("aria-disabled", "true"),
    expect(role("button", { name: "Commit and move everyone" })).not.toHaveAttr("aria-disabled", "true"),
  );
});

await test("Commit for new entrants still works after the last call (D38)", async () => {
  const m = at("bf-2027", 178, { tab: "Edit" });
  const draft = surged(m);
  const result = await interpreted(m, [Message.UpdatedDraft({ text: draft }), Message.UpdatedWhy({ value: twoDays }), Message.ClickedCommit({ kind: "new" })]);
  scene(
    program,
    given(m),
    type(selector("textarea.lisp-edit"), draft),
    type(selector("label.why input"), twoDays),
    click(role("button", { name: "Commit for new entrants" })),
    Command.resolve(RunInterpreter, result),
    expect(text("a new version for whoever enters next", { exact: false })).toExist(),
  );
});

await test("Mark seen moves the cursor and empties the feed (D37)", async () => {
  const m = at("bf-2027", 220);
  const result = await interpreted(m, [Message.ClickedMarkSeen()]);
  scene(
    program,
    given(m),
    expect(text("counts · agent waived an agent's alarm")).toExist(),
    click(role("button", { name: "Mark seen" })),
    Command.resolve(RunInterpreter, result),
    expect(text("Marked seen at t=221. The feed starts here.")).toExist(),
    expect(text("Nothing from agents since t=221.")).toExist(),
  );
});

console.log(failed === 0 ? `${passed} scenes passed` : `${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
