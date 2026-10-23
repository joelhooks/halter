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
  scene(program, given(at("bf-2027", HEAD)), expect(text(`t=${HEAD}`)).toExist(), type(selector("input.slider"), String(DRAFTER_SELF)), expect(text(`t=${DRAFTER_SELF}`)).toExist(), expect(text("2027-10-22T16:00Z")).toExist());
});

await test("tabs switch the panel, and History scrolls to the slider's transaction", () => {
  scene(
    program,
    given(at("small-tools-bridge", BRIDGE_MID)),
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
    given(at("small-tools-bridge", BRIDGE_MID)),
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
    given(at("fieldkit-c7", C7_SELF, { tab: "Edit" })),
    type(selector("label.why input"), 'Mara: "ok"'),
    expect(role("button", { name: "Confirm as Mara" })).toHaveAttr("aria-disabled", "true"),
    expect(role("button", { name: "Confirm as Mara" })).toHaveAttr("title", SELF_WAIVE),
  );
});

await test("confirming someone else's pending waiver commits it (D36)", async () => {
  const why = 'Mara: "Fine, keep the variants."';
  const m = at("bf-2027", DRAFTER_SELF, { tab: "Edit" });
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
  const m = at("bf-2027", AFTER_LAST_CALL, { tab: "Edit" });
  const draft = surged(m);
  const result = await interpreted(m, [Message.UpdatedDraft({ text: draft }), Message.UpdatedWhy({ value: twoDays }), Message.ClickedCommit({ kind: "move" })]);
  scene(
    program,
    given(m),
    type(selector("textarea.lisp-edit"), draft),
    type(selector("label.why input"), twoDays),
    click(role("button", { name: "Commit and move everyone" })),
    Command.resolve(RunInterpreter, result),
    expect(text("Nothing committed: refused: deadline-kept: 5 people were told close is 2027-11-30T07:59Z.", { exact: false })).toExist(),
    expect(text(`t=${AFTER_LAST_CALL}`)).toExist(),
    expect(selector("input.slider")).toHaveAttr("max", String(db.log.length)),
    expect(role("button", { name: "Commit for new entrants" })).not.toHaveAttr("aria-disabled", "true"),
    expect(role("button", { name: "Commit and move everyone" })).not.toHaveAttr("aria-disabled", "true"),
  );
});

await test("Commit for new entrants still works after the last call (D38)", async () => {
  const m = at("bf-2027", AFTER_LAST_CALL, { tab: "Edit" });
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
  const m = at("bf-2027", HEAD);
  const result = await interpreted(m, [Message.ClickedMarkSeen()]);
  scene(
    program,
    given(m),
    expect(text("counts · agent waived an agent's alarm")).toExist(),
    click(role("button", { name: "Mark seen" })),
    Command.resolve(RunInterpreter, result),
    expect(text(`Marked seen at t=${HEAD + 1}. The feed starts here.`)).toExist(),
    expect(text(`Nothing from agents since t=${HEAD + 1}.`)).toExist(),
  );
});

// D41: a :bonus the offer doesn't declare is refused in the editor, and declaring it clears the refusal.
const stickers = (m: Model) =>
  draftText(m).replace('      :via email\n      :deadline close)\n    (send "bf-05"', '      :via email\n      :deadline close\n      :bonus "sticker-pack")\n    (send "bf-05"');
const declared = (m: Model) => stickers(m).replace('(bonus "template-pack" :until close))', '(bonus "template-pack" :until close)\n    (bonus "sticker-pack" :until close))');
const giveStickers = 'Mara: "Throw in the sticker pack too."';
await test("a :bonus the offer doesn't declare is refused, and declaring it clears it (D41)", async () => {
  const m = at("bf-2027", HEAD, { tab: "Edit" });
  if (!stickers(m).includes(':bonus "sticker-pack"') || !declared(m).includes('(bonus "sticker-pack" :until close)')) throw new Error("the edits didn't land");
  const result = await interpreted(m, [Message.UpdatedDraft({ text: declared(m) }), Message.UpdatedWhy({ value: giveStickers }), Message.ClickedCommit({ kind: "plain" })]);
  scene(
    program,
    given(m),
    type(selector("textarea.lisp-edit"), stickers(m)),
    type(selector("label.why input"), giveStickers),
    expect(text("bonus-declared")).toExist(),
    expect(text("send bf-04 offers bonus sticker-pack, which bf-2027's offer doesn't declare.", { exact: false })).toExist(),
    click(role("button", { name: "Commit" })),
    Command.expectNone(),
    expect(text("Nothing committed: refused: bonus-declared:", { exact: false })).toExist(),
    expect(selector("input.slider")).toHaveAttr("max", String(db.log.length)),
    type(selector("textarea.lisp-edit"), declared(m)),
    expect(text("bonus-declared")).not.toExist(),
    click(role("button", { name: "Commit" })),
    expect(text("Running the interpreter from your edit…")).toExist(),
    Command.resolve(RunInterpreter, result),
    expect(text("Committed t=", { exact: false })).toExist(),
  );
});

// D42: an objection needs a fix or proof send that answers it, and only an objection can be answered.
const ANSWER = "\n      :answers (why-not no-time)";
await test("answering an objection in a fix send clears it, and answering a non-objection is refused (D42)", () => {
  const m = at("small-tools-bridge", HEAD, { tab: "Edit" });
  const head = draftText(m);
  if (!head.includes(ANSWER)) throw new Error("the bridge's p1 has no :answers");
  const unanswered = head.replace(ANSWER, "");
  scene(
    program,
    given(m),
    type(selector("textarea.lisp-edit"), unanswered),
    expect(text("objection why-not no-time has no fix, or is only answered in a faq send.", { exact: false })).toExist(),
    type(selector("textarea.lisp-edit"), head),
    expect(text("objection-has-fix")).not.toExist(),
    type(selector("textarea.lisp-edit"), head.replace("(why-not no-time)", "(why-not didnt-see-it)")),
    type(selector("label.why input"), 'Mara: "Tell people who missed it."'),
    expect(text("send p1 answers why-not didnt-see-it, which isn't one of its objections.", { exact: false })).toExist(),
    click(role("button", { name: "Commit" })),
    Command.expectNone(),
    expect(text("Nothing committed: refused: value-declared:", { exact: false })).toExist(),
  );
});

console.log(failed === 0 ? `${passed} scenes passed` : `${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
