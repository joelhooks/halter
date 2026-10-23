// Every check gets one planted violation that must fail, and the seed must pass clean.
// Run: bun checks.test.ts
import { deepStrictEqual, ok } from "node:assert";
import { asOf, dateMs, diff, facts, history, kw, transact, type Db, type Move, type Op, type Triple, type TxInput } from "./src/db.ts";
import { judge, PACK, pendingText, refusalKeys, verdict } from "./src/checks.ts";
import { confirmWaiver, viewAt } from "./src/views.ts";
import { renderHtml } from "./src/ws/static.ts";
import { feedView } from "./src/ws/view.ts";
import type { Db as FeedDb } from "./src/db.ts";
const feedHtml = (d: FeedDb, id: string): string => renderHtml((h) => feedView(h, d, id));
import type { Finding } from "./src/checks.ts";
import { dimFromFacts, fromFacts, toFacts, type Path } from "./src/model.ts";
import { interpret, refusalAt, replyOps } from "./src/run.ts";
import { holds } from "./src/pred.ts";
import { parseVersion } from "./src/version.ts";
import { kwName } from "./src/time.ts";
import { deliveriesOf, deliveryOps, keyLookup } from "./src/delivery.ts";
import { printDimension, printPath } from "./src/printer.ts";
import { readDimension, readPath } from "./src/extract.ts";
import { toldFacts } from "./src/deadline.ts";
import { fitSource } from "./src/fit.ts";
import { readFileSync } from "node:fs";
import { cursorOf, feedOf, markSeenOps, messagesOf, refusedOn, touchesFeed } from "./src/feed.ts";
import { parseQuery, run } from "./src/query.ts";
import { AUTHORED, closeShift, HORIZON, PATHS, seedDb, WHY_NOT } from "./src/seed.ts";

const db = seedDb();
const fs = facts(db);
const hist = history(db);
const text = (id: string) => {
  const p = fromFacts(id, fs);
  if (!p) throw new Error(`no path ${id}`);
  return printPath(p);
};
const B = text("small-tools-bridge");
const C = text("fieldkit-c7");
const F = text("bf-2027");
const W = text("why-didnt-you-buy");
const swap = (src: string, from: string, to: string) => {
  if (!src.includes(from)) throw new Error(`plant missing: ${from}`);
  return src.replace(from, to);
};

const PLANTED: Record<string, { readonly src: string; readonly extra?: ReadonlyArray<Triple> }> = {
  "to-declared-state": { src: swap(B, "(to pitch :after 48h)", "(to pich :after 48h)") },
  "send-inside-state": { src: swap(B, '"p3" :after 90h', '"p3" :after 99h') },
  "offsets-increase": { src: swap(B, '"p2" :after 24h', '"p2" :after 0h') },
  "sends-in-order": { src: swap(C, '"c7-03" :on "2027-02-22T17:00Z"', '"c7-03" :on "2027-02-01T17:00Z"') },
  "last-call-before-close": { src: swap(C, '"c7-07" :on "2027-03-15T17:00Z"', '"c7-07" :on "2027-03-16T17:00Z"') },
  "class-after-close": { src: swap(C, '(class :starts "2027-03-22T17:00Z")', '(class :starts "2027-03-10T17:00Z")') },
  "early-bird-inside-doors": { src: swap(C, '(early-bird :until "2027-03-08T23:00Z")', '(early-bird :until "2027-03-20T23:00Z")') },
  "no-send-after-close": { src: swap(F, '"bf-04" :on "2027-11-29T17:00Z"', '"bf-04" :on "2027-12-01T17:00Z"') },
  "deadline-names-event": { src: swap(C, ":deadline early-bird", ":deadline soon") },
  "job-on-every-send": { src: swap(B, " :job proof", "") },
  "else-on-every-vary": { src: swap(F, ' (else "bf-02")', "") },
  "value-declared": { src: swap(F, '(writer "bf-02-writer")', '(knitter "bf-02-knitter")') },
  "trigger-has-evidence": { src: swap(W, '(enters-on\n    (finished? "small-tools-bridge"))', '(enters-on (not (bought? "small-tools")))') },
  "wait-has-timeout": { src: swap(W, '      :answers (why-not too-expensive)))', '      :answers (why-not too-expensive))\n    (to closed :when (bought? "small-tools")))') },
  "objection-has-fix": { src: swap(B, '\n      :answers (why-not too-expensive)', "") },
  "fake-deadline": { src: swap(C, " :deadline early-bird", "") },
  "pitch-to-buyer": { src: swap(B, '  (exit-on (bought? "small-tools"))\n', "") },
  // bf-02 is :hard; a second guessed role on one of its variants
  "hard-from-inferred": {
    src: F,
    extra: [
      { e: "act/plant-role", a: "act/person", v: "person/ivy" },
      { e: "act/plant-role", a: "act/kind", v: kw("answered") },
      { e: "act/plant-role", a: "act/of", v: "role" },
      { e: "act/plant-role", a: "act/value", v: kw("podcaster") },
      { e: "act/plant-role", a: "act/source", v: kw("inferred") },
      { e: "act/plant-role", a: "act/at", v: "2027-11-28T09:00Z" },
    ],
  },
  "refused-at-run": {
    src: B,
    extra: [
      { e: "refusal/plant", a: "refusal/person", v: "person/ana" },
      { e: "refusal/plant", a: "refusal/send", v: "small-tools-bridge/p2" },
      { e: "refusal/plant", a: "refusal/key", v: "p2" },
      { e: "refusal/plant", a: "refusal/check", v: "synthetic-live" },
      { e: "refusal/plant", a: "refusal/outcome", v: kw("skipped") },
    ],
  },
  "synthetic-live": { src: swap(B, ':list "fernhill-news"', ':list "fernhill-test"') },
  "bonus-declared": { src: swap(F, ':bonus "template-pack"', ':bonus "sticker-pack"') },
  "asks-declared": { src: swap(W, "\n      :asks why-not", "") },
  // someone still in the sale who already owns the template pack, with the bonus send ahead of them
  "bonus-to-owner": {
    src: F,
    extra: [
      { e: "person/zed", a: "path/at", v: "bf-2027/sale" },
      { e: "act/plant-bonus", a: "act/person", v: "person/zed" },
      { e: "act/plant-bonus", a: "act/kind", v: kw("bought") },
      { e: "act/plant-bonus", a: "act/of", v: "template-pack" },
    ],
  },
  "teach-before-fix": { src: swap(B, "  (waive teach-before-fix)", "").replace(/\n\)$/, ")").replace(/\(pace \(rate 150\)\)\n\)/, "(pace (rate 150)))") },
  "bridge-announces-pitch": { src: swap(B, ":job announce-pitch", ":job dream") },
  "rest-days": { src: swap(C, '"c7-06" :on "2027-03-08T17:00Z"', '"c7-06" :on "2027-03-03T17:00Z"') },
  "few-values": { src: swap(F, "  (waive few-values)\n", "") },
  "post-close-survey": { src: swap(F, '\n    (send "bf-06" :on "2027-12-02T17:00Z"\n      :job survey\n      :via email\n      :asks why-not))', ")") },
  "message-exists": { src: swap(B, '(send "p2" :after 24h', '(send "p2b" :after 24h') },
  "via-has-rendition": { src: swap(B, '      :job proof\n      :via email\n', '      :job proof\n      :via (or sms email)\n') },
  "support-to-buyers": { src: swap(B, ":job proof", ":job support") },
  "path-has-target": { src: swap(W, '\n  (target (did? "shipped-tool")\n    :within 720h)', "") },
  "target-is-our-object": { src: swap(B, '(target (and (bought? "small-tools")\n               (did? "tool-in-use"))\n    :within 1440h)', '(target (bought? "small-tools") :within 1440h)') },
  "people-on-old-version": {
    src: B,
    extra: [
      { e: "person/zed", a: "path/at", v: "small-tools-bridge/pitch" },
      { e: "person/zed", a: "path/version", v: "small-tools-bridge@3" },
    ],
  },
  // a move that would give Ana a different close than the one her p3 told her (D38)
  "deadline-kept": {
    src: B,
    extra: toldFacts("small-tools-bridge", [{ person: "person/ana", event: "close", told: Date.UTC(2027, 10, 24, 17), now: Date.UTC(2027, 10, 25, 17) }]),
  },
  "uncertain-sends": {
    src: B,
    extra: [
      { e: "delivery/ana/small-tools-bridge/p2/email", a: "delivery/person", v: "person/ana" },
      { e: "delivery/ana/small-tools-bridge/p2/email", a: "delivery/send", v: "small-tools-bridge/p2" },
      { e: "delivery/ana/small-tools-bridge/p2/email", a: "delivery/status", v: kw("uncertain") },
    ],
  },
};

let failed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

test("the seed's pages have no refusals, and the only refusal at all is one the world made true at run", () => {
  for (const id of PATHS) {
    const page = viewAt(db, id, db.log.length).verdict;
    ok(page, id);
    deepStrictEqual(page.findings.filter((f) => f.severity === "refuse" && f.standing === undefined).map((f) => f.message), [], id);
    ok(page.ok, id);
    const v = verdict(text(id), { facts: fs, history: hist });
    deepStrictEqual(v.ran.filter((r) => r.error), [], id);
    const refusals = v.findings.filter((f) => f.severity === "refuse").map((f) => f.check);
    deepStrictEqual(refusals, id === "bf-2027" ? ["hard-from-inferred"] : [], id);
  }
});
test("every check in the pack has a planted violation", () => {
  deepStrictEqual(PACK.map((c) => c.query.name).filter((n) => !(n in PLANTED)), []);
});
for (const { query } of PACK) {
  test(`${query.name} fails on its planted violation`, () => {
    const plant = PLANTED[query.name];
    ok(plant, "no plant");
    const v = verdict(plant.src, { facts: [...fs, ...(plant.extra ?? [])], history: hist });
    const hit = v.findings.find((f) => f.check === query.name && f.waived === undefined);
    ok(hit, `no ${query.name} finding; got ${v.findings.map((f) => f.check).join(", ") || "nothing"}`);
    ok(hit.line > 0, "a finding points at a line");
    if (query.severity === "refuse") ok(!v.ok, "a refusal blocks");
  });
}
// :via (or …): an asked preference picks among the listed channels; an inferred one changes nothing (D24).
test("the person picks within (or …)", () => {
  const p3 = (who: string) => db.log.find((tx) => tx.datoms.some((d) => d.e === `person/${who}` && d.a === "send/sent" && d.v === "small-tools-bridge/p3"))?.why ?? "";
  ok(p3("ben").includes("via email (prefers email, asked)"), p3("ben"));
  ok(p3("dee").includes("via sms (inferred preference for email ignored; written order)"), p3("dee"));
  ok(p3("ana").includes("via email (sms: no sms consent)"), p3("ana"));
});
// The closed job list: an unknown job is refused with the nearest one from the synonym table.
const jobFinding = (src: string) => verdict(src, { facts: fs, history: hist }).findings.find((f) => f.check === "job-on-every-send")?.message ?? "";
test("an unknown job names the nearest job", () => {
  const m = jobFinding(swap(B, ":job proof", ":job nudge"));
  ok(m.includes(":job nudge") && m.includes("The nearest is support.") && m.includes("survey and support"), m);
  ok(jobFinding(swap(B, ":job proof", ":job educate")).includes("The nearest is teach."));
});
test("an unknown job with no synonym still lists every job", () => {
  const m = jobFinding(swap(B, ":job proof", ":job banana"));
  ok(m.includes(":job banana") && !m.includes("nearest") && m.includes("The jobs are teach"), m);
});
test("a target with no :within is refused", () => {
  const v = verdict(swap(W, " :within 720h", ""), { facts: fs, history: hist });
  ok(v.findings.some((f) => f.check === "path-has-target" && f.message.includes("no :within")));
});
// Nobody waives their own alarm (D36). The seed: agent:drafter adds bf-02's role variants by rule, so it
// raised few-values; its own waiver is pending until agent:judge confirms. Mara's own c7 waiver waits for Teo.
const drafted = db.log.find((x) => x.who === "agent:drafter" && x.datoms.some((d) => d.a === "path/waives"))?.t ?? 0;
const maraC7 = db.log.find((x) => x.who === "mara" && x.datoms.some((d) => d.e === "fieldkit-c7" && d.a === "path/waives" && d.added))?.t ?? 0;
const at = (d: Db, id: string) => {
  const f = facts(d);
  const p = fromFacts(id, f);
  if (!p) throw new Error(`no path ${id}`);
  return verdict(printPath(p), { facts: f, history: history(d) });
};
const finding = (d: Db, id: string, check: string) => at(d, id).findings.find((f) => f.check === check);
const fv = (d: Db) => finding(d, "bf-2027", "few-values");
const counts = (w: Finding["waived"]) => w !== undefined && w !== "staged" && w.counts;
test("a waiver whose author raised the alarm is pending, for an agent and for a person", () => {
  ok(drafted > 0 && maraC7 > 0, "the seed has both stories");
  const f = fv(asOf(db, drafted));
  const w = f?.waived;
  deepStrictEqual(f?.raisedBy, ["agent:drafter"]);
  ok(w !== undefined && w !== "staged" && !w.counts && w.pending === "agent:drafter", JSON.stringify(w));
  deepStrictEqual(pendingText(w), "waiver pending: agent:drafter raised this alarm, someone else must confirm");
  deepStrictEqual(at(asOf(db, drafted), "bf-2027").alarms, at(asOf(db, drafted - 1), "bf-2027").alarms);
  const m = finding(asOf(db, maraC7), "fieldkit-c7", "teach-before-fix");
  ok(m?.raisedBy?.includes("mara") && m.waived !== undefined && m.waived !== "staged" && m.waived.pending === "mara", JSON.stringify(m));
  // the note doesn't fit beside the waiver at 44 columns, so it prints above it as ;; and the path's
  // closing paren stays code even when the waiver is the last line
  const printed = printPath(fromFacts("fieldkit-c7", facts(asOf(db, maraC7)))!, { pending: new Map([["teach-before-fix", "mara"]]) });
  ok(/;; pending: mara raised it\n\s*\(waive teach-before-fix\)\)\n$/.test(printed), printed.slice(-200));
  deepStrictEqual(readPath(printed).problems, []);
});
test("another actor's waiver counts at once, and history keeps both asserts", () => {
  const w = fv(db)?.waived;
  ok(w !== undefined && w !== "staged" && w.counts && w.who === "agent:judge" && w.pending === undefined, JSON.stringify(w));
  deepStrictEqual(hist.filter((d) => d.e === "bf-2027" && d.a === "path/waives" && d.v === "few-values" && d.added).length, 2);
  // the only live alarms are the three refusals at run (D40, D41)
  deepStrictEqual(at(db, "bf-2027").alarms, 3);
  // agent:judge waived Mara's teach-before-fix on bf-2027 by rule, and it counted in that same transaction
  const judged = db.log.find((x) => x.who === "agent:judge" && x.datoms.some((d) => d.a === "path/waives" && d.v === "teach-before-fix"))?.t ?? 0;
  ok(counts(finding(asOf(db, judged), "bf-2027", "teach-before-fix")?.waived));
  ok(counts(finding(asOf(db, maraC7 + 1), "fieldkit-c7", "teach-before-fix")?.waived), "Teo's confirmation counts");
});
test("a waiver goes pending again when its author later edits an offending fact", () => {
  const vary = fs.find((f) => f.a === "send/vary-by" && String(f.e).startsWith("bf-2027/"));
  ok(vary);
  if (!vary) return;
  const judge = (d: Db, t: string, op: Op[]) => {
    const r = transact(d, { who: "agent:judge", at: t, source: "inferred", rule: "survey-roles", why: "survey-roles: redraft bf-02", ops: op });
    if (!r.ok) throw new Error(r.error);
    return r.db;
  };
  const off = judge(db, "2028-03-16T09:00Z", [{ e: vary.e, a: vary.a, v: vary.v, added: false }]);
  const on = judge(off, "2028-03-16T10:00Z", [{ e: vary.e, a: vary.a, v: vary.v, added: true }]);
  const w = fv(on)?.waived;
  ok(w !== undefined && w !== "staged" && !w.counts && w.pending === "agent:judge", JSON.stringify(w));
  ok(at(on, "bf-2027").alarms > 0);
});
test("world alarms can be waived by anyone", () => {
  const BR = "small-tools-bridge";
  const d0 = deliveriesOf(fs).find((x) => x.person === "person/ana" && x.send === `${BR}/p2`);
  ok(d0);
  if (!d0) return;
  const r0 = transact(db, { who: "adapter:email", at: "2028-03-16T01:00Z", source: "observed", why: "provider: no receipt", ops: deliveryOps(keyLookup(fs), { ...d0, status: "uncertain" }) });
  ok(r0.ok);
  if (!r0.ok) return;
  for (const [who, source, rule, why] of [["mara", "assumed", undefined, 'Mara: "I checked the provider, it went."'], ["agent:desk", "inferred", "provider-log", "provider-log: the message id is in the provider's sent log"]] as const) {
    const r = transact(r0.db, { who, at: "2028-03-16T02:00Z", source, ...(rule ? { rule } : {}), why, ops: [{ e: BR, a: "path/waives", v: "uncertain-sends", added: true }] });
    ok(r.ok);
    if (!r.ok) continue;
    const f = finding(r.db, BR, "uncertain-sends");
    deepStrictEqual(f?.raisedBy, []);
    ok(counts(f?.waived), `${who}: ${JSON.stringify(f?.waived)}`);
  }
});
test("a move or waiver with an inferred why and no :rule is refused, and one with :rule passes", () => {
  const waive: Op = { e: "fieldkit-c7", a: "path/waives", v: "rest-days", added: true };
  const base = { who: "agent:judge", at: "2028-03-16T09:00Z", why: "close-window: all 3 fall in the last 48 hours" } as const;
  for (const extra of [{ ops: [waive] }, { ops: [], moves: [{ path: "fieldkit-c7" }] }]) {
    const no = transact(db, { ...base, source: "inferred", ...extra });
    ok(!no.ok && /names its :tx\/rule/.test(no.error), no.ok ? "committed" : no.error);
    const yes = transact(db, { ...base, source: "inferred", rule: "close-window", ...extra });
    ok(yes.ok, yes.ok ? "" : yes.error);
  }
  const bare = transact(db, { ...base, source: "assumed", ops: [], moves: [{ path: "fieldkit-c7" }] });
  ok(!bare.ok && /quotes someone's own words, or is :source inferred with a :rule/.test(bare.error), bare.ok ? "committed" : bare.error);
});
test("a waiver with no quote and no rule doesn't count", () => {
  const base = asOf(db, drafted - 1);
  const r = transact(base, { who: "teo", at: "2027-10-22T16:00Z", why: "fine by me, ship it", source: "assumed", ops: [{ e: "bf-2027", a: "path/waives", v: "few-values", added: true }] });
  ok(r.ok);
  if (!r.ok) return;
  const w = fv(r.db)?.waived;
  ok(w !== undefined && w !== "staged" && !w.counts && w.pending === undefined, JSON.stringify(w));
  deepStrictEqual(at(r.db, "bf-2027").alarms, at(base, "bf-2027").alarms);
});
test("confirming needs your own words, and nobody confirms their own alarm", () => {
  const pending = asOf(db, drafted);
  const raisedBy = fv(pending)?.raisedBy ?? [];
  for (const why of ["", "  ", "confirmed, ship it"]) {
    const r = confirmWaiver(pending, { id: "bf-2027", check: "few-values", who: "mara", why, at: "2027-10-23T09:00Z", raisedBy });
    ok(!r.ok && r.error.includes("your own words"), why);
  }
  const r = confirmWaiver(pending, { id: "bf-2027", check: "few-values", who: "mara", why: 'Mara: "Fine, six roles."', at: "2027-10-23T09:00Z", raisedBy });
  ok(r.ok && at(r.db, "bf-2027").alarms === at(pending, "bf-2027").alarms - 1);
  ok(r.ok && r.tx.why === 'Mara: "Fine, six roles."');
  const c7 = asOf(db, maraC7);
  const own = confirmWaiver(c7, { id: "fieldkit-c7", check: "teach-before-fix", who: "mara", why: 'Mara: "Really, two is fine."', at: "2027-02-10T19:00Z", raisedBy: finding(c7, "fieldkit-c7", "teach-before-fix")?.raisedBy ?? [] });
  ok(!own.ok && own.error.includes("You raised this alarm, so someone else must waive it."), own.ok ? "committed" : own.error);
});
test("a waiver on a refusal is still refused", () => {
  const r = transact(db, { who: "mara", at: "2028-03-16T09:00Z", why: 'Mara: "Waive it, I know what I\'m doing."', source: "assumed", ops: [{ e: "small-tools-bridge", a: "path/waives", v: "to-declared-state", added: true }] });
  ok(r.ok);
  const src = swap(swap(B, "(to pitch :after 48h)", "(to pich :after 48h)"), "  (waive teach-before-fix)", "  (waive teach-before-fix)\n  (waive to-declared-state)");
  const v = verdict(src, { facts: facts(r.db), history: history(r.db) });
  const f = v.findings.find((x) => x.check === "to-declared-state");
  ok(!v.ok && f !== undefined && f.waived === undefined && (f.hint ?? "").includes("can't lift a refusal"), JSON.stringify(f));
});
// D32: structure is fixed at entry, and a move is the only way to migrate people. These run on a cut of
// the seed taken before the bridge's four-day edit: Ana is in pitch on three days, Ben and Cy are in bridge.
const BR = "small-tools-bridge";
const cut = AUTHORED.filter((x) => (dateMs(x.at) ?? 0) < (dateMs("2027-11-21T10:00Z") ?? 0));
const END = "2027-12-05T00:00Z";
const run0 = interpret(cut, END);
const bridgeAt = (at: string): Path => {
  const p = fromFacts(BR, facts(asOf(run0, run0.log.filter((x) => x.at <= at).at(-1)?.t ?? 0)));
  if (!p) throw new Error("no bridge");
  return p;
};
const pitch = (p: Path, f: (st: Path["states"][number]) => Path["states"][number]): Path => ({ ...p, states: p.states.map((st) => (st.name === "pitch" ? f(st) : st)) });
const fourDays = (p: Path) => pitch(p, (st) => ({ ...st, sends: st.sends.map((s) => (s.key === "p3" ? { ...s, after: 90 * 3_600_000 } : s)), tos: [{ target: "closed", after: 96 * 3_600_000 }] }));
const edited = (f: (p: Path) => Path, at = "2027-11-21T10:00Z"): TxInput => {
  const p = bridgeAt(at);
  return { who: "mara", at, source: "assumed", why: 'Mara: "Try this on the bridge."', ops: diff(toFacts(p), toFacts(f(p))) };
};
const moved = (m: Partial<Move> = {}, at = "2027-11-22T10:00Z"): TxInput => ({ who: "mara", at, source: "assumed", why: 'Mara: "Move the people already on the bridge."', ops: [], moves: [{ path: BR, ...m }] });
// A person's path events on the bridge, as at + datom lines.
const events = (d: Db, who: string) =>
  d.log.flatMap((x) => (x.who !== "agent:halter" ? [] : x.datoms.filter((y) => y.e === `person/${who}` && typeof y.v === "string" && (y.v === BR || y.v.startsWith(`${BR}/`) || y.v.startsWith(`${BR}@`))).map((y) => `${x.at} ${y.added ? "+" : "-"}${y.a} ${String(y.v)}`)));
const sent = (d: Db, who: string, key: string) => events(d, who).filter((l) => l.includes(`+send/sent ${BR}/${key}`));

test("an edit with no move changes no path event for people already on the path", () => {
  const withEdit = interpret([...cut, edited(fourDays)], END);
  for (const who of ["ana", "ben", "cy"]) deepStrictEqual(events(withEdit, who), events(run0, who), who);
  ok(JSON.stringify(events(withEdit, "ivy")) !== JSON.stringify(events(run0, "ivy")), "the edit reaches the next entrant");
});
test("a move rebases them, nobody gets a send twice, and history keeps both versions", () => {
  const d = interpret([...cut, edited(fourDays), moved()], END);
  const versions = history(d).filter((x) => x.e === "person/ana" && x.a === "path/version" && x.added && String(x.v).startsWith(`${BR}@`));
  deepStrictEqual(versions.length, 2);
  for (const who of ["ana", "ben", "cy", "dee", "eli", "ivy"]) {
    const refs = events(d, who).filter((l) => l.includes("+send/sent")).map((l) => l.split(" ").at(-1));
    deepStrictEqual(refs.length, new Set(refs).size, `${who} got a send twice`);
  }
  deepStrictEqual(sent(d, "ana", "p3").map((l) => l.split(" ")[0]), ["2027-11-23T14:00Z"]);
  deepStrictEqual(sent(run0, "ana", "p3").map((l) => l.split(" ")[0]), ["2027-11-22T14:00Z"]);
});
test("a move that makes a send overdue writes send/missed, and nothing goes out late", () => {
  const early = (p: Path) => pitch(p, (st) => ({ ...st, sends: st.sends.map((s) => (s.key === "p3" ? { ...s, after: 30 * 3_600_000 } : s)), tos: [{ target: "closed", after: 48 * 3_600_000 }] }));
  const d = interpret([...cut, edited(early), moved()], END);
  const ana = events(d, "ana");
  ok(ana.includes(`2027-11-22T10:00Z +send/missed ${BR}/p3`), ana.join("\n"));
  deepStrictEqual(sent(d, "ana", "p3"), []);
  // the passed :after moves her at once
  ok(ana.includes(`2027-11-22T10:00Z +path/finished ${BR}`), ana.join("\n"));
});
test("a move that strands a state is refused, and :map fixes it", () => {
  const renamed = (p: Path): Path => ({
    ...p,
    ...(p.offer ? { offer: { ...p.offer, windowState: "offer" } } : {}),
    states: p.states.map((st) => ({ ...st, name: st.name === "pitch" ? "offer" : st.name, tos: st.tos.map((x) => (x.target === "pitch" ? { ...x, target: "offer" } : x)) })),
  });
  let err = "";
  try {
    interpret([...cut, edited(renamed), moved()], END);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  ok(/refused: state pitch isn't in version \d+ of small-tools-bridge; map it with :map/.test(err), err);
  const d = interpret([...cut, edited(renamed), moved({ map: [["pitch", "offer"]] })], END);
  ok(events(d, "ana").includes(`2027-11-22T10:00Z +path/at ${BR}/offer`), events(d, "ana").join("\n"));
});
test("a hold reaches people on every version", () => {
  const hold: TxInput = { who: "teo", at: "2027-11-22T12:00Z", source: "assumed", why: 'Teo: "Provider is flaky again. Hold the bridge."', ops: [{ e: BR, a: "path/hold-until", v: "2027-11-24T00:00Z", added: true }] };
  const d = interpret([...cut, edited(fourDays), hold], END);
  const version = (who: string) => facts(d).find((f) => f.e === `person/${who}` && f.a === "path/version" && String(f.v).startsWith(`${BR}@`))?.v;
  ok(version("ana") !== version("ivy"), `ana ${String(version("ana"))}, ivy ${String(version("ivy"))}`);
  for (const who of ["ana", "ivy"]) {
    const during = events(d, who).filter((l) => l.includes("+send/sent") && l >= "2027-11-22T12:00Z" && l < "2027-11-24T00:00Z");
    deepStrictEqual(during, [], who);
  }
  ok(parseVersion(String(version("ivy")))?.v !== d.log.find((x) => x.why.startsWith("Teo: \"Provider is flaky"))?.t, "a hold isn't a version");
});
// D33: each delivery is its own entity, one per person, send and channel.
const seedDs = deliveriesOf(fs);
const dsOf = (who: string, send: string) => seedDs.filter((x) => x.person === `person/${who}` && x.send === `${BR}/${send}`);
const fixTx = db.log.find((x) => x.who === "teo" && x.datoms.some((d) => d.e === "message/p1/email"))?.t ?? 0;
test("(and site email) writes two deliveries, and (or …) writes one with the picked channel", () => {
  deepStrictEqual(dsOf("ana", "p1").map((x) => x.via).sort(), ["email", "site"]);
  deepStrictEqual(dsOf("ana", "p3").map((x) => x.via), ["email"]);
  deepStrictEqual(dsOf("dee", "p3").map((x) => x.via), ["sms"]);
  ok(dsOf("ana", "p1").every((x) => x.status === "sent" && x.message === "p1"));
});
test("delivery/content is the last content tx before the send, and a later edit doesn't change it", () => {
  ok(fixTx > 0);
  for (const who of ["ana", "ben", "cy"]) ok(dsOf(who, "p1").every((x) => x.content < fixTx), who);
  // per rendition: Teo's fix changed the email, so only the email deliveries after it carry it
  for (const who of ["ivy", "dee"]) {
    ok(dsOf(who, "p1").some((x) => x.via === "email" && x.content === fixTx), `${who} email`);
    ok(dsOf(who, "p1").some((x) => x.via === "site" && x.content < fixTx), `${who} site`);
  }
  // the same run without Teo's fix: what Ana got is recorded the same
  const noFix = interpret(AUTHORED.filter((x) => !x.why.startsWith('Teo: "The workspace link')), END);
  const anaNoFix = deliveriesOf(facts(noFix)).filter((x) => x.person === "person/ana" && x.send === `${BR}/p1`);
  deepStrictEqual(anaNoFix.map((x) => x.content), dsOf("ana", "p1").map((x) => x.content));
});
test("a re-delivered key updates its status and never makes a second entity", () => {
  const d = dsOf("ana", "p2")[0];
  ok(d);
  const ops = deliveryOps(keyLookup(fs), { ...d, status: "uncertain" });
  deepStrictEqual(ops.map((o) => o.a), ["delivery/status"]);
  const r = transact(db, { who: "adapter:email", at: "2028-03-16T01:00Z", source: "observed", why: "provider: no receipt for this message", ops });
  ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const after = deliveriesOf(facts(r.db)).filter((x) => x.person === "person/ana" && x.send === `${BR}/p2`);
  deepStrictEqual(after.map((x) => [x.id, x.status]), [[d.id, "uncertain"]]);
  // a second entity claiming the same key is refused
  const dup = transact(db, { who: "adapter:email", at: "2028-03-16T01:00Z", source: "observed", why: "a copy", ops: [{ e: "delivery/x", a: "delivery/key", v: `person/ana|${BR}/p2|email`, added: true }] });
  ok(!dup.ok && /is unique/.test(dup.error), dup.ok ? "committed" : dup.error);
  // and uncertain-sends fires from the delivery's status
  const v = verdict(text(BR), { facts: facts(r.db), history: history(r.db) });
  ok(v.findings.some((f) => f.check === "uncertain-sends"), JSON.stringify(v.findings.map((f) => f.check)));
  ok(!verdict(text(BR), { facts: fs, history: hist }).findings.some((f) => f.check === "uncertain-sends"));
});
test("a skipped or missed send writes no delivery", () => {
  const unsent = fs.filter((f) => f.a === "send/skipped" || f.a === "send/missed");
  ok(unsent.length > 0);
  for (const f of unsent) {
    const sentToo = fs.some((g) => g.e === f.e && g.a === "send/sent" && g.v === f.v);
    if (!sentToo) deepStrictEqual(seedDs.filter((x) => x.person === f.e && x.send === f.v), [], `${String(f.e)} ${String(f.v)}`);
  }
  deepStrictEqual(seedDs.filter((x) => x.person === "person/eli" && x.send.startsWith(`${BR}/`)), [], "Eli skipped all four");
});
// D34: nothing out means passed, not finished.
const has = (fs0: ReadonlyArray<Triple>, who: string, a: string, v: string) => fs0.some((f) => f.e === `person/${who}` && f.a === a && f.v === v);
test("every send skipped writes passed, not finished", () => {
  ok(has(fs, "eli", "path/passed", BR) && !has(fs, "eli", "path/finished", BR));
  const tx = db.log.find((x) => x.datoms.some((y) => y.e === "person/eli" && y.a === "path/passed" && y.v === BR));
  ok(/reached done and passed: nothing went out, all 4 sends were skipped/.test(tx?.why ?? ""), tx?.why);
});
test("a successor on finished? doesn't enter someone who passed", () => {
  ok(!has(fs, "eli", "path/entered", "why-didnt-you-buy"));
  ok(has(fs, "ana", "path/entered", "why-didnt-you-buy"), "a finisher still enters");
  ok(holds({ name: "passed?", arg: BR }, "person/eli", { facts: fs, history: hist, due: () => false }));
  ok(!holds({ name: "finished?", arg: BR }, "person/eli", { facts: fs, history: hist, due: () => false }));
});
test("one sent delivery is enough to finish, and a site delivery counts", () => {
  const siteOnly = (p: Path): Path => ({ ...p, states: p.states.map((st) => ({ ...st, sends: st.sends.filter((s) => s.key === "p1").map((s) => ({ ...s, via: { channels: ["site"] } })) })) });
  const d = interpret([...cut, edited(siteOnly, "2027-11-01T00:00Z")], END);
  const f = facts(d);
  const ana = deliveriesOf(f).filter((x) => x.person === "person/ana" && x.send.startsWith(`${BR}/`));
  deepStrictEqual(ana.map((x) => [x.send, x.via, x.status]), [[`${BR}/p1`, "site", "sent"]]);
  ok(has(f, "ana", "path/finished", BR) && !has(f, "ana", "path/passed", BR));
});
test("every send missed during a hold also passes", () => {
  const hold: TxInput = { who: "teo", at: "2027-11-21T09:30Z", source: "assumed", why: 'Teo: "Hold the bridge again until the new provider is set up."', ops: [{ e: BR, a: "path/hold-until", v: "2027-12-20T00:00Z", added: true }] };
  const d = interpret([...cut, hold], END);
  const f = facts(d);
  ok(f.some((x) => x.e === "person/dee" && x.a === "send/missed") && !deliveriesOf(f).some((x) => x.person === "person/dee" && x.send.startsWith(`${BR}/`)));
  ok(has(f, "dee", "path/passed", BR) && !has(f, "dee", "path/finished", BR));
  const tx = d.log.find((x) => x.datoms.some((y) => y.e === "person/dee" && y.a === "path/passed"));
  ok(/nothing went out, all \d+ sends were missed/.test(tx?.why ?? ""), tx?.why);
});
test("exit-on still writes exited", () => {
  for (const who of ["cy", "ivy"]) ok(has(fs, who, "path/exited", BR) && !has(fs, who, "path/finished", BR) && !has(fs, who, "path/passed", BR), who);
});
// D37: since you last looked. Mara's cursor on bf-2027 sits before the agents' waivers.
const BF = "bf-2027";
const agentOnBf = (d: Db, after: number) => feedOf(d, BF, "mara").txs.map((x) => x.t).filter((x) => x > after);
const mark = (d: Db, ops: Array<Op>, at = "2028-03-16T09:00Z") => {
  const r = transact(d, { who: "mara", at, source: "assumed", why: "marked seen", ops });
  if (!r.ok) throw new Error(r.error);
  return r;
};
test("the feed lists only agent transactions after the cursor and on that path", () => {
  const f = feedOf(db, BF, "mara");
  ok(f.cursor !== undefined && f.txs.length === 7, JSON.stringify(f.txs.map((x) => x.t)));
  for (const tx of f.txs) ok(tx.t > (f.cursor ?? 0) && tx.who.startsWith("agent:") && (tx.who === "agent:halter" ? refusedOn(tx, BF) : touchesFeed(tx, BF, messagesOf(db, BF))), `t=${tx.t}`);
  // the interpreter shows up only for its three refusals at run (D40)
  deepStrictEqual(f.txs.map((x) => x.who), ["agent:judge", "agent:drafter", "agent:drafter", "agent:judge", "agent:halter", "agent:halter", "agent:halter"]);
  deepStrictEqual(feedOf(db, "small-tools-bridge", "mara").txs, [], "bf's guard names the bridge but doesn't touch it");
});
test("a person's transaction never appears", () => {
  const r = transact(db, { who: "teo", at: "2028-03-16T08:00Z", source: "assumed", why: 'Teo: "Hold Black Friday."', ops: [{ e: BF, a: "path/hold-until", v: "2028-02-03T00:00Z", added: true }] });
  ok(r.ok);
  if (!r.ok) return;
  ok(!feedOf(r.db, BF, "mara").txs.some((x) => x.who === "teo" || x.who === "mara"));
  ok(!feedOf(db, BF, "teo").txs.some((x) => !x.who.startsWith("agent:")), "with no cursor, still agents only");
});
test("a waiver where one agent clears another agent's alarm is marked", () => {
  const html = feedHtml(db, BF);
  deepStrictEqual(html.match(/counts · agent waived an agent's alarm/g)?.length, 1);
  ok(/t=85<\/td>.*?counts · agent waived an agent's alarm/.test(html.replace(/\n/g, " ")) || html.includes("agent:judge"), html.slice(0, 300));
  ok(html.includes("pending: raised it"), "the drafter's own waiver");
  const row = (t: number) => html.split("<tr>").find((r: string) => r.includes(`>t=${t}<`)) ?? "";
  const judgeOnMara = feedOf(db, BF, "mara").txs[0]?.t ?? 0;
  ok(row(judgeOnMara).includes(">counts<") && !row(judgeOnMara).includes("agent waived"), "the judge waived Mara's alarm: counts, not agent-on-agent");
});
test("marking seen moves the cursor and empties the feed", () => {
  const r = mark(db, markSeenOps(db, "mara", BF));
  deepStrictEqual(cursorOf(r.db, "mara", BF), r.tx.t);
  deepStrictEqual(facts(r.db).filter((f) => f.e === "mara" && f.a === "seen/path" && String(f.v).startsWith(`${BF}@`)).length, 1, "one value per person per path");
  deepStrictEqual(feedOf(r.db, BF, "mara").txs, []);
  ok(feedHtml(r.db, BF).includes(`Nothing from agents since t=${r.tx.t}.`));
});
test("with no cursor, the feed lists everything", () => {
  const r = mark(db, markSeenOps(db, "mara", BF).filter((o) => !o.added));
  deepStrictEqual(cursorOf(r.db, "mara", BF), undefined);
  const all = r.db.log.filter((x) => (/^agent:/.test(x.who) && x.who !== "agent:halter" && touchesFeed(x, BF, messagesOf(r.db, BF))) || refusedOn(x, BF)).map((x) => x.t);
  deepStrictEqual(feedOf(r.db, BF, "mara").txs.map((x) => x.t), all);
  ok(all.length > 4 && feedHtml(r.db, BF).includes("You haven't looked at this path yet"));
});
test("a refusal at run is a feed row that says who it stopped and what went out, and turns its alarm on", () => {
  const html = feedHtml(db, BF);
  ok(html.includes("refused at run: hard-from-inferred, Jo's bf-02 got its else"), html.slice(0, 400));
  ok(html.includes("refused at run: synthetic-live, Quin's bf-06 was skipped"));
  ok(/refused at run: synthetic-live[^]*?refused-at-run/.test(html), "the row shows the alarm it turned on");
});
test("agent? is true for agent:NAME only", () => {
  const q = parseQuery('(query "agents" :find (?w) :where ((?t :tx/who ?w) (agent? ?w)))');
  const r = run(q, { facts: fs, history: hist });
  ok(r.ok && r.rows.length > 0 && r.rows.every((x) => String(x[0]).startsWith("agent:")));
});
// D38: a told deadline is locked. Every case interprets the whole seed plus one transaction.
const H = 3_600_000;
const attempt = (x: TxInput): string => {
  try {
    interpret([...AUTHORED, x], HORIZON);
    return "accepted";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
test("extending a calendar close after a last-call delivery is refused", () => {
  const r = attempt(closeShift(db, { hours: 48 }));
  // the bonus send told its four readers when the template pack ends, the same close (D41)
  deepStrictEqual(r, "refused: deadline-kept: 5 people were told close is 2027-11-30T07:59Z. It can't move to 2027-12-02T07:59Z. Make a new offer and announce it. 4 people were told the template-pack bonus is 2027-11-30T07:59Z. It can't move to 2027-12-02T07:59Z. Make a new offer and announce it.");
});
test("closing earlier is refused too", () => {
  ok(/^refused: deadline-kept: 5 people were told close is 2027-11-30T07:59Z\. It can't move to 2027-11-30T05:59Z\./.test(attempt(closeShift(db, { hours: -2 }))));
});
test("the same edit before any deadline delivery passes, and new entrants only always passes", () => {
  deepStrictEqual(attempt(closeShift(db, { hours: 48, at: "2027-11-28T00:00Z" })), "accepted");
  deepStrictEqual(attempt(closeShift(db, { hours: 48, move: false })), "accepted");
});
const bridgeAtSeed = (at: string): Path => {
  const p = fromFacts(BR, facts(asOf(db, db.log.filter((x) => x.at <= at).at(-1)?.t ?? 0)));
  if (!p) throw new Error("no bridge");
  return p;
};
const retime = (at: string, f: (p: Path) => Path, who = "mara"): TxInput => {
  const p = bridgeAtSeed(at);
  return { who, at, source: "assumed", why: 'Mara: "Move the people already on the bridge."', ops: diff(toFacts(p), toFacts(f(p))), moves: [{ path: BR }] };
};
test("a move that re-times a per-person window for someone told it is refused", () => {
  // Ana's p3 told her close at 2027-11-23T14:00Z; she's still in pitch an hour later
  const longer = (p: Path) => pitch(p, (st) => ({ ...st, tos: st.tos.map((x) => (x.after === undefined ? x : { ...x, after: 120 * H })) }));
  ok(/^refused: deadline-kept: 1 people were told close is /.test(attempt(retime("2027-11-23T15:00Z", longer))), attempt(retime("2027-11-23T15:00Z", longer)));
});
test("a move that leaves every told person's instant the same passes", () => {
  const slowerBridge = (p: Path): Path => ({ ...p, states: p.states.map((st) => (st.name === "bridge" ? { ...st, tos: st.tos.map((x) => (x.after === undefined ? x : { ...x, after: x.after + 12 * H })) } : st)) });
  deepStrictEqual(attempt(retime("2027-11-23T15:00Z", slowerBridge)), "accepted");
});
test("a refusal binds a person's transaction as well as an agent's", () => {
  ok(/^refused: deadline-kept: /.test(attempt(closeShift(db, { hours: 48, who: "mara", why: 'Mara: "Give them two more days."' }))));
});
// UPDATE-32: the canonical printer fits 44 columns, the way LANGUAGE.md prints the language.
test("every printed path fits 44 columns at every version, except a string that can't break", () => {
  let lines = 0;
  for (const tx of db.log.filter((x) => x.who !== "agent:halter")) {
    for (const id of PATHS) {
      const p = fromFacts(id, facts(asOf(db, tx.t)));
      if (!p) continue;
      for (const l of printPath(p).split("\n")) {
        lines++;
        if (l.length <= 44) continue;
        // past the edge only inside a string literal that starts before it
        ok(/^\s*(:\w+ )?"[^"]*"\)*$/.test(l) || /"[^"]{30,}"/.test(l), `${id} at t=${tx.t}: ${JSON.stringify(l)} is ${l.length} columns`);
      }
    }
  }
  ok(lines > 1000);
});
test("the printer prints the seed paths exactly as LANGUAGE.md's reflowed blocks do", () => {
  const lang = readFileSync(new URL("./LANGUAGE.md", import.meta.url), "utf8");
  const blocks = [...lang.matchAll(/```lisp\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  for (const id of ["small-tools-bridge", "five-day-tools", "small-tools-start"]) {
    const block = blocks.find((b) => b.startsWith(`(path ${JSON.stringify(id)}\n`));
    ok(block, `LANGUAGE.md prints ${id}`);
    const p = fromFacts(id, fs);
    ok(p);
    // LANGUAGE.md's bridge block shows no :answers; the seed's pitch answers why-not (D42)
    const { states } = p;
    const bare = states.map((st) => ({ ...st, sends: st.sends.map(({ answers: _a, ...x }) => x) }));
    deepStrictEqual(printPath({ ...p, states: bare, waives: [] }), block);
  }
  // and the dimension prints as LANGUAGE.md declares it
  const dim = blocks.find((b) => b.startsWith("(dimension why-not\n"));
  ok(dim);
  deepStrictEqual(printDimension(WHY_NOT), dim);
});
test("a check's source lays out at 44 columns and reads back the same", () => {
  for (const { source, query } of PACK) {
    const fitted = fitSource(source);
    deepStrictEqual(parseQuery(fitted).name, query.name);
    // the same query, apart from where in the source each clause starts
    const shape = (x: unknown) => JSON.stringify(x, (k, v) => (k === "at" && typeof v === "number" ? 0 : v));
    deepStrictEqual(shape(parseQuery(fitted)), shape(query));
  }
});

// D39: acts carry when they happened. Freshness reads :act/at, never the transaction.
const BRIDGE_LIVE = "2027-06-02T18:00Z";
const entryAt = (d: Db, who: string, path: string): string | undefined =>
  d.log.find((x) => x.datoms.some((y) => y.e === `person/${who}` && y.a === "path/entered" && y.v === path && y.added))?.at;
// A made-up person who never signs up, so only the acts a test writes can let them in.
const kit = (at: string): TxInput => ({ who: "adapter:site", at, source: "observed", why: 'Site: "account made"', ops: [{ e: "person/kit", a: "person/name", v: "Kit Vale", added: true }, { e: "person/kit", a: "person/email", v: "kit@example.org", added: true }] });
const finishedAct = (e: string, happened: string): Array<Op> => [
  { e, a: "act/person", v: "person/kit", added: true },
  { e, a: "act/kind", v: kw("finished"), added: true },
  { e, a: "act/of", v: "five-day-tools", added: true },
  { e, a: "act/at", v: happened, added: true },
  { e, a: "act/source", v: kw("observed"), added: true },
];
const written = (at: string, ops: Array<Op>, why = 'Old platform: "a completion"'): TxInput => ({ who: "adapter:import", at, source: "observed", why, ops });
// a path that subscribes to the course, with :since, built from the bridge's own structure
const oldFinishers = (since: string | undefined): TxInput => {
  const b = fromFacts(BR, fs);
  if (!b) throw new Error("no bridge");
  const { since: _s, ...rest } = b;
  const p: Path = { ...rest, id: "old-finishers", title: "Old finishers", waives: [], holds: [], ...(since === undefined ? {} : { since }) };
  return { who: "mara", at: "2027-07-01T09:00Z", source: "assumed", why: 'Mara: "Everyone who ever finished the course."', ops: toFacts(p).map((t) => ({ ...t, added: true })) };
};

test("a retract and re-assert of an old act doesn't trigger enters-on", () => {
  const cleanup = db.log.find((x) => x.who === "teo" && x.why.startsWith('Teo: "Re-save the imported completions'));
  ok(cleanup, "the seed has Teo's cleanup");
  // it retracts and re-asserts the same act/at
  const at = cleanup.datoms.filter((d) => d.a === "act/at");
  deepStrictEqual(at.map((d) => `${d.added ? "+" : "-"}${String(d.v)}`).sort(), ["+2026-09-02T14:00Z", "-2026-09-02T14:00Z"]);
  // Ben enters the bridge only when he finishes the course again on the site, not on the cleanup
  deepStrictEqual(entryAt(db, "ben", BR), "2027-11-20T19:00Z");
  ok((dateMs(cleanup.at) ?? 0) < (dateMs("2027-11-20T19:00Z") ?? 0));
  // and without the November course, the cleanup alone never enters him
  const noCourse = interpret(AUTHORED.filter((x) => !(x.why.startsWith("Site: \"signed up") && x.ops.some((o) => o.e === "person/ben"))), "2027-12-31T00:00Z");
  deepStrictEqual(entryAt(noCourse, "ben", BR), undefined);
});
test("a new act after go-live enters, and one written after go-live but done before doesn't", () => {
  const fresh = interpret([...AUTHORED, kit("2027-06-20T09:00Z"), written("2027-07-01T09:00Z", finishedAct("act/kit-1", "2027-06-30T12:00Z"))], "2027-08-01T00:00Z");
  deepStrictEqual(entryAt(fresh, "kit", BR), "2027-07-01T09:00Z");
  const late = interpret([...AUTHORED, kit("2027-06-20T09:00Z"), written("2027-07-01T09:00Z", finishedAct("act/kit-1", "2027-06-01T12:00Z"))], "2027-08-01T00:00Z");
  deepStrictEqual(entryAt(late, "kit", BR), undefined);
  ok((dateMs("2027-06-01T12:00Z") ?? 0) < (dateMs(BRIDGE_LIVE) ?? 0));
});
test(":since lets an older act in", () => {
  const base = [...AUTHORED, kit("2027-06-20T09:00Z"), written("2027-06-21T09:00Z", finishedAct("act/kit-1", "2026-03-01T12:00Z"))];
  const withSince = interpret([...base, oldFinishers("2026-01-01T00:00Z")], "2027-08-01T00:00Z");
  deepStrictEqual(entryAt(withSince, "kit", "old-finishers"), "2027-07-01T09:00Z");
  // Ben's imported 2026 completion counts too: he enters at go-live
  deepStrictEqual(entryAt(withSince, "ben", "old-finishers"), "2027-07-01T09:00Z");
  const noSince = interpret([...base, oldFinishers(undefined)], "2027-08-01T00:00Z");
  deepStrictEqual(entryAt(noSince, "kit", "old-finishers"), undefined);
  // a :since after the act still keeps it out
  const tooLate = interpret([...base, oldFinishers("2026-06-01T00:00Z")], "2027-08-01T00:00Z");
  deepStrictEqual(entryAt(tooLate, "kit", "old-finishers"), undefined);
});
test("a re-buy after a refund is a new act, and it's fresh", () => {
  const buys = (d: Db) => history(d).filter((x) => x.a === "act/person" && x.v === "person/gus" && x.added).map((x) => String(x.e)).filter((e, i, a) => a.indexOf(e) === i);
  // his Small Tools purchases; the template pack in August is its own act (D41)
  const kinds = buys(db).filter((e) => history(db).some((x) => x.e === e && x.a === "act/of" && x.v === "small-tools")).filter((e) => fs.some((f) => f.e === e && f.a === "act/kind" && String(f.v) === "bought") || history(db).some((x) => x.e === e && x.a === "act/kind" && String(x.v) === "bought"));
  deepStrictEqual(kinds.length, 2, "two purchase acts");
  const [first, second] = kinds as [string, string];
  ok(!fs.some((f) => f.e === first), "the refunded purchase has no facts left");
  deepStrictEqual(fs.find((f) => f.e === second && f.a === "act/at")?.v, "2027-12-05T12:00Z");
  deepStrictEqual(entryAt(db, "gus", "small-tools-start"), "2027-12-05T12:00Z");
});
test("did? ignores an inferred act", () => {
  const w = { facts: fs, history: hist };
  const fay = fs.find((f) => f.a === "act/person" && f.v === "person/fay" && fs.some((g) => g.e === f.e && g.a === "act/of" && g.v === "shipped-tool"));
  ok(fay, "Fay has a shipped-tool act");
  deepStrictEqual(String(fs.find((f) => f.e === fay.e && f.a === "act/source")?.v), "inferred");
  ok(!holds({ name: "did?", arg: "shipped-tool" }, "person/fay", w));
  ok(holds({ name: "did?", arg: "shipped-tool" }, "person/hal", w));
});
test("an act's source is fixed by the transaction that first wrote it", () => {
  // Ben's imported 2026 completion, first written observed
  const e = String(fs.find((f) => f.a === "act/at" && f.v === "2026-09-02T14:00Z")?.e);
  const r = transact(db, { who: "teo", at: "2028-03-16T09:00Z", source: "assumed", why: 'Teo: "Fix the source."', ops: [{ e, a: "act/source", v: kw("observed"), added: false }, { e, a: "act/source", v: kw("asked"), added: true }] });
  ok(!r.ok && r.error.includes("fixed by t="), r.ok ? "accepted" : r.error);
  const same = transact(db, { who: "teo", at: "2028-03-16T09:00Z", source: "assumed", why: 'Teo: "Re-save it."', ops: [{ e, a: "act/source", v: kw("observed"), added: false }, { e, a: "act/source", v: kw("observed"), added: true }] });
  ok(same.ok, same.ok ? "" : same.error);
});
test("a fix to one rendition leaves the other rendition's version alone", () => {
  const fix = db.log.find((x) => x.who === "teo" && x.why.startsWith('Teo: "The workspace link'))?.t ?? 0;
  const ivy = deliveriesOf(fs).filter((x) => x.person === "person/ivy" && x.send === `${BR}/p1`);
  deepStrictEqual(ivy.find((x) => x.via === "email")?.content, fix);
  const site = ivy.find((x) => x.via === "site")?.content ?? 0;
  ok(site > 0 && site < fix, `site ${site}`);
  // it's the bridge copy's transaction, the last one to touch the site rendition
  deepStrictEqual(db.log.filter((x) => x.t < fix && x.datoms.some((d) => d.e === "message/p1/site" || d.e === "message/p1")).at(-1)?.t, site);
});
// D40: a refusal that turns true mid-run stops only that send, and only for the people it names.
const refusals = (d: Db) => facts(d).filter((f) => f.a === "refusal/outcome").map((f) => `${String(f.e)} ${kwName(f.v)}`).sort();
test("refused at run: Jo's guessed role gets the else, Quin's bf-06 skips, and nobody else changes", () => {
  deepStrictEqual(refusals(db), ["refusal/gus/bf-2027/bf-bonus/bonus-to-owner skipped", "refusal/jo/bf-2027/bf-02/hard-from-inferred else", "refusal/quin/bf-2027/bf-06/synthetic-live skipped"]);
  const ds = deliveriesOf(fs).filter((d) => d.send.startsWith("bf-2027/"));
  deepStrictEqual(ds.filter((d) => d.person === "person/jo").map((d) => `${d.send.slice(8)} ${d.message}`), ["bf-02 bf-02", "bf-03 bf-03", "bf-04 bf-04", "bf-05 bf-05", "bf-06 bf-06", "bf-bonus bf-bonus"]);
  // Ana's role was asked, so she gets her variant as written
  deepStrictEqual(ds.find((d) => d.person === "person/ana" && d.send === "bf-2027/bf-02")?.message, "bf-02-podcaster");
  ok(!ds.some((d) => d.person === "person/quin" && d.send === "bf-2027/bf-06"));
  ok(fs.some((f) => f.e === "person/quin" && f.a === "send/skipped" && f.v === "bf-2027/bf-06"));
  ok(db.log.some((x) => x.who === "agent:halter" && x.why.includes("bf-06 skipped at run: refused: synthetic-live")));
  ok(db.log.some((x) => x.who === "agent:halter" && x.why.includes("bf-02 at run: refused: hard-from-inferred") && x.why.includes("its else, bf-02, went out")));
  // every send skipped for Quin, and she still passes (D34)
  ok(fs.some((f) => f.e === "person/quin" && f.a === "path/passed" && f.v === "bf-2027"));
});
test("refused at run: the alarm names the check and the send, the world raised it, and anyone can waive it", () => {
  const v = verdict(text("bf-2027"), { facts: fs, history: hist });
  const as = v.findings.filter((f) => f.check === "refused-at-run");
  deepStrictEqual(as.map((f) => f.message).sort(), [
    "1 people in bf-2027 hit bonus-to-owner mid-run. Their bf-bonus fell back to its else, or was skipped. Fix the cause.",
    "1 people in bf-2027 hit hard-from-inferred mid-run. Their bf-02 fell back to its else, or was skipped. Fix the cause.",
    "1 people in bf-2027 hit synthetic-live mid-run. Their bf-06 fell back to its else, or was skipped. Fix the cause.",
  ]);
  ok(as.every((f) => (f.raisedBy ?? []).length === 0 && f.severity === "alarm"), JSON.stringify(as.map((f) => [f.raisedBy, f.waived])));
  const r = transact(db, { who: "mara", at: "2028-03-16T01:00Z", source: "assumed", why: 'Mara: "Jo is asked next week."', ops: [{ e: "bf-2027", a: "path/waives", v: "refused-at-run", added: true }] });
  ok(r.ok, r.ok ? "" : r.error);
  const w = finding(r.db, "bf-2027", "refused-at-run")?.waived;
  ok(w !== undefined && w !== "staged" && w.counts && !w.pending, JSON.stringify(w));
});
test("refusalAt: a :hard variant from a guess is refused and its else is safe; a synthetic person is refused everything", () => {
  const p = fromFacts("bf-2027", fs);
  const s = p?.states.flatMap((x) => x.sends).find((x) => x.key === "bf-02");
  ok(s?.vary);
  const w = { facts: fs, history: hist };
  deepStrictEqual(refusalAt(s, "person/jo", "bf-02-writer", w)?.check, "hard-from-inferred");
  deepStrictEqual(refusalAt(s, "person/jo", "bf-02", w), undefined);
  deepStrictEqual(refusalAt(s, "person/ana", "bf-02-podcaster", w), undefined);
  deepStrictEqual(refusalAt(s, "person/quin", "bf-02", w)?.check, "synthetic-live");
});
test("a commit answers only for what it adds: the head's refusal doesn't refuse an edit, a new one does", () => {
  const head = verdict(text("bf-2027"), { facts: fs, history: hist });
  const edit = judge(verdict(text("bf-2027").replace('"bf-03" :on', '"bf-03"  :on'), { facts: fs, history: hist }), refusalKeys(head), "commit");
  ok(edit.ok, JSON.stringify(edit.findings.filter((f) => f.severity === "refuse")));
  deepStrictEqual(edit.findings.filter((f) => f.standing === "before").map((f) => f.check), ["hard-from-inferred"]);
  const worse = judge(verdict(text("bf-2027").replace(' (else "bf-02")', ""), { facts: fs, history: hist }), refusalKeys(head), "commit");
  ok(!worse.ok);
  deepStrictEqual(worse.findings.filter((f) => f.severity === "refuse" && f.standing === undefined).map((f) => f.check), ["else-on-every-vary"]);
  // and the finding that was already there still shows
  ok(worse.findings.some((f) => f.check === "hard-from-inferred" && f.standing === "before"));
});
test("a page counts a refusal only when its version was committed with it: Jo's arrival is true at run", () => {
  const before = viewAt(db, "bf-2027", db.log.find((x) => x.why.includes("role-from-click") || x.rule === "role-from-click")!.t - 1).verdict;
  ok(before && !before.findings.some((f) => f.check === "hard-from-inferred"));
  const page = viewAt(db, "bf-2027", db.log.length).verdict;
  deepStrictEqual(page?.findings.filter((f) => f.check === "hard-from-inferred").map((f) => f.standing), ["at-run"]);
  ok(page?.ok);
});
// D41: bonuses the language can see.
const BONUS_SEND = '(send "bf-bonus" :on "2027-11-29T09:00Z"\n      :job urgency\n      :via email\n      :deadline close\n      :bonus "template-pack")';
const BONUS = '(bonus "template-pack" :until close)';
test("bonus and :bonus print and read back", () => {
  const t = text("bf-2027");
  ok(t.includes(BONUS) && t.includes(BONUS_SEND), t.slice(0, 600));
  const r = readPath(t);
  deepStrictEqual(r.problems, []);
  ok(r.path);
  deepStrictEqual(r.path?.offer?.bonuses, [{ product: "template-pack", until: "close" }]);
  deepStrictEqual(r.path?.states[0]?.sends.find((x) => x.key === "bf-bonus")?.bonus, "template-pack");
  deepStrictEqual(printPath(r.path), t);
  deepStrictEqual(toFacts(r.path).filter((x) => x.a.startsWith("bonus/") || x.a === "send/bonus").length, 5);
});
test("an undeclared :bonus is refused by bonus-declared, and declaring it clears it", () => {
  const without = text("bf-2027").replace(`\n    ${BONUS})`, ")");
  ok(!without.includes("(bonus "), without.slice(0, 300));
  const v = verdict(without, { facts: fs, history: hist });
  deepStrictEqual(v.findings.filter((f) => f.check === "bonus-declared").map((f) => f.message), [
    `send bf-bonus offers bonus template-pack, which bf-2027's offer doesn't declare. Add (bonus "template-pack" :until close) to the offer, or drop :bonus.`,
  ]);
  ok(!verdict(text("bf-2027"), { facts: fs, history: hist }).findings.some((f) => f.check === "bonus-declared"));
});
test("a bonus :until that names no event of the offer is refused by the reader", () => {
  for (const ev of ["class", "early-bird", "soon"]) {
    const r = readPath(text("bf-2027").replace(BONUS, `(bonus "template-pack" :until ${ev})`));
    ok(r.problems.some((x) => x.message.includes(`bonus template-pack lasts :until ${ev}, which this offer doesn't have`)), `${ev}: ${JSON.stringify(r.problems)}`);
  }
  ok(readPath(text("bf-2027").replace(BONUS, '(bonus "template-pack")')).problems.length > 0, "a bonus needs :until");
});
test("an owner skips the bonus send and nothing else", () => {
  const gus = deliveriesOf(fs).filter((d) => d.person === "person/gus" && d.send.startsWith("bf-2027/")).map((d) => d.send.slice(8));
  deepStrictEqual(gus, ["bf-01", "bf-02", "bf-03", "bf-04", "bf-05", "bf-06"]);
  ok(fs.some((f) => f.e === "person/gus" && f.a === "send/skipped" && f.v === "bf-2027/bf-bonus"));
  ok(db.log.some((x) => x.who === "agent:halter" && x.why === "bf-2027: bf-bonus skipped at run: refused: bonus-to-owner, Gus owns template-pack"));
  // owners of nothing get it as written
  ok(deliveriesOf(fs).some((d) => d.person === "person/ana" && d.send === "bf-2027/bf-bonus" && d.message === "bf-bonus"));
});
test("a commit that adds a bonus send ahead of an owner is refused", () => {
  const t = db.log.filter((x) => x.at <= "2027-11-28T00:00Z").at(-1)?.t ?? 0;
  const d = asOf(db, t);
  ok(facts(d).some((f) => f.e === "person/gus" && f.a === "path/at" && f.v === "bf-2027/sale"), "Gus is in the sale");
  const head = viewAt(db, "bf-2027", t).verdict;
  const p = fromFacts("bf-2027", facts(d));
  ok(p && head);
  const draft = printPath(p).replace('"bf-04" :on "2027-11-29T17:00Z"\n      :job urgency\n      :via email\n      :deadline close)', '"bf-04" :on "2027-11-29T17:00Z"\n      :job urgency\n      :via email\n      :deadline close\n      :bonus "template-pack")');
  ok(draft.includes(':deadline close\n      :bonus "template-pack")\n    (send "bf-05"'), "the edit landed");
  const v = judge(verdict(draft, { facts: facts(d), history: history(d) }), refusalKeys(head), "commit");
  ok(!v.ok);
  deepStrictEqual(v.findings.filter((f) => f.severity === "refuse" && f.standing === undefined).map((f) => f.message), [
    "send bf-04 offers template-pack, which 1 people already own. They skip it at run (D40). Keep the bonus in its own send.",
  ]);
  // the bonus send already there is the head's: Gus will skip it at run, and it doesn't refuse the edit
  ok(v.findings.some((f) => f.check === "bonus-to-owner" && f.standing === "before" && f.message.startsWith("send bf-bonus")));
});
test("deadline-kept covers a bonus's :until: moving it after a bonus send told someone is refused", () => {
  const r = attempt(closeShift(db, { hours: -2 }));
  ok(r.includes("people were told the template-pack bonus is 2027-11-30T07:59Z. It can't move to 2027-11-30T05:59Z."), r);
  // before the bonus send went out, nobody was told it, and only :deadline close's readers are locked
  const early = attempt(closeShift(db, { hours: 48, at: "2027-11-28T00:00Z" }));
  deepStrictEqual(early, "accepted");
});
// D42: objections are a type of answer.
const objections = (src: string, extra: ReadonlyArray<Triple> = [], drop: (t: Triple) => boolean = () => false) =>
  verdict(src, { facts: [...fs.filter((t) => !drop(t)), ...extra], history: hist }).findings.filter((f) => f.check === "objection-has-fix").map((f) => f.message);
const NO_FIX = (o: string) => `objection why-not ${o} has no fix, or is only answered in a faq send. Answer it in a fix or proof send.`;
test("the bridge answers both objections in its fix and proof sends, so objection-has-fix is quiet", () => {
  deepStrictEqual(objections(B), []);
});
test("an objection with no answer alarms", () => {
  deepStrictEqual(objections(swap(B, "\n      :answers (why-not too-expensive)", "")), [NO_FIX("too-expensive")]);
});
test("an objection answered only in a faq send alarms", () => {
  // why-didnt-you-buy: w2 answers the price as a faq, and nothing answers no-time
  deepStrictEqual(objections(W).sort(), [NO_FIX("no-time"), NO_FIX("too-expensive")]);
  deepStrictEqual(objections(swap(B, ":job proof", ":job faq")), [NO_FIX("too-expensive")]);
});
test("a fix or a proof answer clears it", () => {
  deepStrictEqual(objections(swap(W, ":job faq", ":job proof")), [NO_FIX("no-time")]);
  deepStrictEqual(objections(swap(W, ":job faq", ":job fix").replace(":answers (why-not too-expensive)", ":answers ((why-not too-expensive)\n                (why-not no-time))")), []);
});
test("an :answers naming a value that isn't an objection, or isn't declared, is refused by value-declared", () => {
  const refused = (src: string) => verdict(src, { facts: fs, history: hist }).findings.filter((f) => f.check === "value-declared").map((f) => `${f.line} ${f.message}`);
  const notObjection = swap(B, "(why-not no-time)", "(why-not didnt-see-it)");
  deepStrictEqual(refused(notObjection), [`${notObjection.split("\n").findIndex((l) => l.includes("didnt-see-it")) + 1} send p1 answers why-not didnt-see-it, which isn't one of its objections. Answer an objection, or mark this one on the dimension.`]);
  deepStrictEqual(refused(swap(B, "(why-not no-time)", "(why-not bored)")).map((x) => x.replace(/^\d+ /, "")), ["send p1 answers why-not bored, which isn't one of its values."]);
  deepStrictEqual(refused(swap(B, "(why-not no-time)", "(why-ever no-time)")).map((x) => x.replace(/^\d+ /, "")), ["send p1 answers dim/why-ever itself, which isn't a declared dimension."]);
  // and an :objections value the dimension doesn't declare
  deepStrictEqual(
    verdict(B, { facts: [...fs, { e: "dim/why-not", a: "dim/objections", v: kw("bored") }], history: hist }).findings.filter((f) => f.check === "value-declared").map((f) => f.message),
    ["send p1 uses why-not bored, which it marks as an objection but doesn't declare.", "send p2 uses why-not bored, which it marks as an objection but doesn't declare."],
  );
});
test("unmarked values never alarm, and nothing reserves the name objection", () => {
  // the same paths with why-not's marks taken off: every answer is just an answer
  const unmarked = (t: Triple) => t.a === "dim/objections";
  deepStrictEqual(objections(W, [], unmarked), []);
  // an :answers needs an objection, so with no marks the bridge's answers are refused instead
  ok(verdict(B, { facts: fs.filter((t) => !unmarked(t)), history: hist }).findings.some((f) => f.check === "value-declared"));
  // role marks none, and bf-02 varies by it
  ok(!objections(F).length);
  deepStrictEqual(fs.filter((t) => t.a === "dim/name").map((t) => String(t.v)).sort(), ["channel", "role", "why-not"]);
  ok(!fs.some((t) => String(t.e) === "dim/objection"));
});
test("the printer round-trips :answers and (dimension …)", () => {
  const r = readPath(W);
  deepStrictEqual(r.problems, []);
  deepStrictEqual(r.path?.states[0]?.sends.find((x) => x.key === "w2")?.answers, [{ dim: "why-not", value: "too-expensive" }]);
  const two = swap(W, ":answers (why-not too-expensive)", ":answers ((why-not too-expensive)\n                (why-not no-time))");
  const r2 = readPath(two);
  ok(r2.path);
  deepStrictEqual(r2.path?.states[0]?.sends.find((x) => x.key === "w2")?.answers, [{ dim: "why-not", value: "too-expensive" }, { dim: "why-not", value: "no-time" }]);
  deepStrictEqual(printPath(r2.path), two);
  deepStrictEqual(readPath(printPath(r2.path)).triples, r2.triples);
  const d = readDimension(printDimension(WHY_NOT));
  deepStrictEqual(d.problems, []);
  deepStrictEqual(d.dimension, WHY_NOT);
  // facts keep no order, so a dimension read from them prints its values sorted, the canonical form
  deepStrictEqual(dimFromFacts("why-not", fs), { ...WHY_NOT, values: [...WHY_NOT.values].sort(), objections: [...WHY_NOT.objections].sort() });
  const sorted = printDimension(dimFromFacts("why-not", fs)!);
  deepStrictEqual(printDimension(readDimension(sorted).dimension!), sorted);
  ok(readDimension("(dimension why-not (a b) :objections (c))").problems.some((x) => x.message === "objection c isn't one of the dimension's values"));
});
test("why-not answers from the survey are asked acts, counted by value", () => {
  const acts = fs.filter((t) => t.a === "act/of" && t.v === "why-not").map((t) => String(t.e));
  const get = (e: string, a: string) => fs.find((t) => t.e === e && t.a === a)?.v;
  deepStrictEqual([...new Set(acts.map((e) => kwName(get(e, "act/source"))))], ["asked"]);
  const by = new Map<string, number>();
  for (const e of acts) by.set(kwName(get(e, "act/value")), (by.get(kwName(get(e, "act/value"))) ?? 0) + 1);
  deepStrictEqual(Object.fromEntries([...by].sort()), { "didnt-see-it": 1, "no-time": 2, "too-expensive": 2 });
});
test("one uncertain delivery: uncertain-sends fires, and nothing retried it", () => {
  const ds = deliveriesOf(fs).filter((x) => x.status === "uncertain");
  deepStrictEqual(ds.map((x) => `${x.person} ${x.send} ${x.via}`), ["person/ana five-day-tools/day-5 email"]);
  const v = verdict(text("five-day-tools"), { facts: fs, history: hist });
  ok(v.findings.some((f) => f.check === "uncertain-sends"), JSON.stringify(v.findings.map((f) => f.check)));
  // one delivery per person, send and channel, and one send/sent: no second email
  deepStrictEqual(hist.filter((x) => x.a === "delivery/key" && x.added && x.v === "person/ana|five-day-tools/day-5|email").length, 1);
  deepStrictEqual(hist.filter((x) => x.e === "person/ana" && x.a === "send/sent" && x.v === "five-day-tools/day-5" && x.added).length, 1);
});
// D43: a send says what it asks.
const findingsOf = (src: string, check: string) => verdict(src, { facts: fs, history: hist }).findings.filter((f) => f.check === check).map((f) => f.message);
test("a survey send with no :asks is refused by asks-declared", () => {
  deepStrictEqual(findingsOf(swap(W, "\n      :asks why-not", ""), "asks-declared"), ["send w1 is a survey with no :asks. A survey says what it asks: :asks DIM, with DIM declared."]);
  deepStrictEqual(findingsOf(W, "asks-declared"), []);
  // every survey in the seed asks something
  for (const id of PATHS) deepStrictEqual(findingsOf(text(id), "asks-declared"), [], id);
});
test("an :asks naming an undeclared dimension is refused", () => {
  deepStrictEqual(findingsOf(swap(W, ":asks why-not", ":asks why-ever"), "asks-declared"), ["send w1 asks a dimension that isn't declared. A survey says what it asks: :asks DIM, with DIM declared."]);
  // allowed on any send, so long as the dimension is declared
  deepStrictEqual(findingsOf(text("spring-note"), "asks-declared"), []);
  deepStrictEqual(findingsOf(swap(text("spring-note"), ":asks role", ":asks job-title"), "asks-declared").length, 1);
});
const valOf = (ops: ReadonlyArray<Op>, a: string) => ops.find((o) => o.a === a)?.v;
test("an answer to an :asks send is asked and records its delivery, a click included", () => {
  const get = (e: string, a: string) => fs.find((t) => t.e === e && t.a === a)?.v;
  const answers = fs.filter((t) => t.a === "act/of" && t.v === "why-not").map((t) => String(t.e));
  for (const e of answers) {
    deepStrictEqual(kwName(get(e, "act/source")), "asked", e);
    deepStrictEqual(get(String(get(e, "act/delivery")), "delivery/send"), "why-didnt-you-buy/w1", e);
  }
  // Dee clicked "no time" in the email: asked, on her w1 delivery
  const click = replyOps(db, { person: "person/dee", send: "why-didnt-you-buy/w1", value: "no-time", how: "click" }, "2028-03-16T09:00Z");
  ok(click.asked);
  deepStrictEqual(kwName(valOf(click.ops, "act/source")), "asked");
  deepStrictEqual(kwName(valOf(click.ops, "act/kind")), "answered");
  deepStrictEqual(valOf(click.ops, "act/of"), "why-not");
  deepStrictEqual(valOf(click.ops, "act/delivery"), "delivery/dee/why-didnt-you-buy/w1/email");
  // the role answers the drafter read came from clicks on the spring note's links
  const roles = fs.filter((t) => t.a === "act/of" && t.v === "role").map((t) => String(t.e)).filter((e) => kwName(get(e, "act/source")) === "asked");
  deepStrictEqual(roles.map((e) => get(String(get(e, "act/delivery")), "delivery/send")), roles.map(() => "spring-note/spring-note"));
  // Jo's guessed role has no delivery behind it
  const jo = fs.filter((t) => t.a === "act/person" && t.v === "person/jo").map((t) => String(t.e)).filter((e) => get(e, "act/of") === "role");
  deepStrictEqual(jo.map((e) => [kwName(get(e, "act/source")), get(e, "act/delivery")]), [["inferred", undefined]]);
});
test("an answer the dimension doesn't declare is kept as unknown, with what they said", () => {
  const r = replyOps(db, { person: "person/ana", send: "why-didnt-you-buy/w1", value: "my-cat-ate-it", how: "form" }, "2028-03-16T09:00Z");
  deepStrictEqual(kwName(valOf(r.ops, "act/value")), "unknown");
  deepStrictEqual(valOf(r.ops, "act/said"), "my-cat-ate-it");
  deepStrictEqual(kwName(valOf(r.ops, "act/source")), "asked");
  ok(transact(db, { who: "adapter:mail", at: "2028-03-16T09:00Z", why: "form", source: "asked", ops: r.ops }).ok);
});
test("a click with no :asks behind it is observed, and writes no answer", () => {
  const r = replyOps(db, { person: "person/ana", send: "bf-2027/bf-01", value: "writer", how: "click" }, "2028-03-16T09:00Z");
  ok(!r.asked);
  ok(!r.ops.some((o) => o.a === "act/kind"));
  // the interpreter writes it observed
  const out = interpret([...AUTHORED, { who: "adapter:site", at: "2028-03-16T09:00Z", why: 'Site: clicked "I write" in bf-01', source: "asked", ops: [], replies: [{ person: "person/ana", send: "bf-2027/bf-01", value: "writer", how: "click" }] }], HORIZON);
  const last = out.log.find((x) => x.why.startsWith("Site: clicked"))!;
  deepStrictEqual(last.source, "observed");
  // and the transactor refuses replies handed to it directly
  ok(!transact(db, { who: "x", at: "2028-03-16T09:00Z", why: "x", source: "asked", ops: [], replies: [{ person: "person/ana", send: "x/y", value: "z", how: "reply" }] }).ok);
});
test("post-close-survey fires when the only survey after close asks a dimension with no objections", () => {
  deepStrictEqual(findingsOf(F, "post-close-survey"), []);
  deepStrictEqual(findingsOf(swap(F, ":asks why-not))", ":asks role))"), "post-close-survey"), [
    "nothing in bf-2027 or after it asks non-buyers why. A survey send after close counts when its :asks dimension marks :objections.",
  ]);
});
test("the printer round-trips :asks", () => {
  const r = readPath(W);
  deepStrictEqual(r.problems, []);
  deepStrictEqual(r.path?.states[0]?.sends.find((x) => x.key === "w1")?.asks, "why-not");
  deepStrictEqual(printPath(r.path!), W);
  deepStrictEqual(readPath(text("spring-note")).path?.states[0]?.sends[0]?.asks, "role");
  // LANGUAGE.md's w1 block, as written
  ok(W.includes('    (send "w1" :after 24h\n      :job survey\n      :via email\n      :asks why-not)'));
});
test("the reworded w1: answers record which wording they answered", () => {
  const get = (e: string, a: string) => fs.find((t) => t.e === e && t.a === a)?.v;
  const wording = (p: string) => get(`delivery/${p}/why-didnt-you-buy/w1/email`, "delivery/content");
  deepStrictEqual(wording("ana"), wording("ben"));
  ok(Number(wording("dee")) > Number(wording("ana")));
  // Ben replied after the rewording, to the first wording he got
  const ben = fs.find((t) => t.a === "act/person" && t.v === "person/ben" && String(t.e).includes("/w1/"))!.e;
  ok(String(get(String(ben), "act/at")) > "2027-11-29T10:00Z");
  deepStrictEqual(get(String(get(String(ben), "act/delivery")), "delivery/content"), wording("ana"));
});
console.log(failed === 0 ? `${PACK.length + 80} checks passed` : `${failed} failed`);
if (failed > 0) process.exit(1);
