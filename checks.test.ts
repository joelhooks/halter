// Every check gets one planted violation that must fail, and the seed must pass clean.
// Run: bun checks.test.ts
import { deepStrictEqual, ok } from "node:assert";
import { asOf, dateMs, diff, facts, history, kw, transact, type Db, type Move, type Op, type Triple, type TxInput } from "./src/db.ts";
import { PACK, pendingText, verdict } from "./src/checks.ts";
import { confirmWaiver } from "./src/views.ts";
import { renderHtml } from "./src/ws/static.ts";
import { feedView } from "./src/ws/view.ts";
import type { Db as FeedDb } from "./src/db.ts";
const feedHtml = (d: FeedDb, id: string): string => renderHtml((h) => feedView(h, d, id));
import type { Finding } from "./src/checks.ts";
import { fromFacts, toFacts, type Path } from "./src/model.ts";
import { interpret } from "./src/run.ts";
import { holds } from "./src/pred.ts";
import { parseVersion } from "./src/version.ts";
import { deliveriesOf, deliveryOps, keyLookup } from "./src/delivery.ts";
import { printPath } from "./src/printer.ts";
import { readPath } from "./src/extract.ts";
import { toldFacts } from "./src/deadline.ts";
import { fitSource } from "./src/fit.ts";
import { readFileSync } from "node:fs";
import { cursorOf, feedOf, markSeenOps, messagesOf, touchesFeed } from "./src/feed.ts";
import { parseQuery, run } from "./src/query.ts";
import { AUTHORED, closeShift, HORIZON, PATHS, seedDb } from "./src/seed.ts";

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
  "wait-has-timeout": { src: swap(W, '      :via email))', '      :via email)\n    (to closed :when (bought? "small-tools")))') },
  "fake-deadline": { src: swap(C, " :deadline early-bird", "") },
  "pitch-to-buyer": { src: swap(B, '  (exit-on (bought? "small-tools"))\n', "") },
  "hard-from-inferred": { src: swap(F, "(vary role\n", "(vary role :hard\n") },
  "synthetic-live": { src: swap(B, ':list "fernhill-news"', ':list "fernhill-test"') },
  "teach-before-fix": { src: swap(B, "  (waive teach-before-fix)", "").replace(/\n\)$/, ")").replace(/\(pace \(rate 150\)\)\n\)/, "(pace (rate 150)))") },
  "bridge-announces-pitch": { src: swap(B, ":job announce-pitch", ":job dream") },
  "rest-days": { src: swap(C, '"c7-06" :on "2027-03-08T17:00Z"', '"c7-06" :on "2027-03-03T17:00Z"') },
  "few-values": { src: swap(F, "  (waive few-values)\n", "") },
  "post-close-survey": { src: swap(F, '\n    (send "bf-06" :on "2027-12-02T17:00Z"\n      :job survey\n      :via email))', ")") },
  "message-exists": { src: swap(B, '(send "p2" :after 24h', '(send "p2b" :after 24h') },
  "via-has-rendition": { src: swap(B, '      :job proof\n      :via email)', '      :job proof\n      :via (or sms email))') },
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

test("the seed's paths have no refusals", () => {
  for (const id of PATHS) {
    const v = verdict(text(id), { facts: fs, history: hist });
    deepStrictEqual(v.findings.filter((f) => f.severity === "refuse").map((f) => f.message), [], id);
    deepStrictEqual(v.ran.filter((r) => r.error), [], id);
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
  deepStrictEqual(at(db, "bf-2027").alarms, 0);
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
  const off = judge(db, "2028-02-02T09:00Z", [{ e: vary.e, a: vary.a, v: vary.v, added: false }]);
  const on = judge(off, "2028-02-02T10:00Z", [{ e: vary.e, a: vary.a, v: vary.v, added: true }]);
  const w = fv(on)?.waived;
  ok(w !== undefined && w !== "staged" && !w.counts && w.pending === "agent:judge", JSON.stringify(w));
  ok(at(on, "bf-2027").alarms > 0);
});
test("world alarms can be waived by anyone", () => {
  const BR = "small-tools-bridge";
  const d0 = deliveriesOf(fs).find((x) => x.person === "person/ana" && x.send === `${BR}/p2`);
  ok(d0);
  if (!d0) return;
  const r0 = transact(db, { who: "adapter:email", at: "2028-02-01T01:00Z", source: "observed", why: "provider: no receipt", ops: deliveryOps(keyLookup(fs), { ...d0, status: "uncertain" }) });
  ok(r0.ok);
  if (!r0.ok) return;
  for (const [who, source, rule, why] of [["mara", "assumed", undefined, 'Mara: "I checked the provider, it went."'], ["agent:desk", "inferred", "provider-log", "provider-log: the message id is in the provider's sent log"]] as const) {
    const r = transact(r0.db, { who, at: "2028-02-01T02:00Z", source, ...(rule ? { rule } : {}), why, ops: [{ e: BR, a: "path/waives", v: "uncertain-sends", added: true }] });
    ok(r.ok);
    if (!r.ok) continue;
    const f = finding(r.db, BR, "uncertain-sends");
    deepStrictEqual(f?.raisedBy, []);
    ok(counts(f?.waived), `${who}: ${JSON.stringify(f?.waived)}`);
  }
});
test("a move or waiver with an inferred why and no :rule is refused, and one with :rule passes", () => {
  const waive: Op = { e: "fieldkit-c7", a: "path/waives", v: "rest-days", added: true };
  const base = { who: "agent:judge", at: "2028-02-02T09:00Z", why: "close-window: all 3 fall in the last 48 hours" } as const;
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
  const r = transact(db, { who: "mara", at: "2028-02-02T09:00Z", why: 'Mara: "Waive it, I know what I\'m doing."', source: "assumed", ops: [{ e: "small-tools-bridge", a: "path/waives", v: "to-declared-state", added: true }] });
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
  for (const who of ["ivy", "dee"]) ok(dsOf(who, "p1").every((x) => x.content === fixTx), who);
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
  const r = transact(db, { who: "adapter:email", at: "2028-02-01T01:00Z", source: "observed", why: "provider: no receipt for this message", ops });
  ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const after = deliveriesOf(facts(r.db)).filter((x) => x.person === "person/ana" && x.send === `${BR}/p2`);
  deepStrictEqual(after.map((x) => [x.id, x.status]), [[d.id, "uncertain"]]);
  // a second entity claiming the same key is refused
  const dup = transact(db, { who: "adapter:email", at: "2028-02-01T01:00Z", source: "observed", why: "a copy", ops: [{ e: "delivery/x", a: "delivery/key", v: `person/ana|${BR}/p2|email`, added: true }] });
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
const mark = (d: Db, ops: Array<Op>, at = "2028-02-02T09:00Z") => {
  const r = transact(d, { who: "mara", at, source: "assumed", why: "marked seen", ops });
  if (!r.ok) throw new Error(r.error);
  return r;
};
test("the feed lists only agent transactions after the cursor and on that path", () => {
  const f = feedOf(db, BF, "mara");
  ok(f.cursor !== undefined && f.txs.length === 4, JSON.stringify(f.txs.map((x) => x.t)));
  for (const tx of f.txs) ok(tx.t > (f.cursor ?? 0) && tx.who.startsWith("agent:") && tx.who !== "agent:halter" && touchesFeed(tx, BF, messagesOf(db, BF)), `t=${tx.t}`);
  deepStrictEqual(f.txs.map((x) => x.who), ["agent:judge", "agent:drafter", "agent:drafter", "agent:judge"]);
  deepStrictEqual(feedOf(db, "small-tools-bridge", "mara").txs, [], "bf's guard names the bridge but doesn't touch it");
});
test("a person's transaction never appears", () => {
  const r = transact(db, { who: "teo", at: "2028-02-02T08:00Z", source: "assumed", why: 'Teo: "Hold Black Friday."', ops: [{ e: BF, a: "path/hold-until", v: "2028-02-03T00:00Z", added: true }] });
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
  const all = r.db.log.filter((x) => /^agent:/.test(x.who) && x.who !== "agent:halter" && touchesFeed(x, BF, messagesOf(r.db, BF))).map((x) => x.t);
  deepStrictEqual(feedOf(r.db, BF, "mara").txs.map((x) => x.t), all);
  ok(all.length > 4 && feedHtml(r.db, BF).includes("You haven't looked at this path yet"));
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
  deepStrictEqual(r, "refused: deadline-kept: 4 people were told close is 2027-11-30T07:59Z. It can't move to 2027-12-02T07:59Z. Make a new offer and announce it.");
});
test("closing earlier is refused too", () => {
  ok(/^refused: deadline-kept: 4 people were told close is 2027-11-30T07:59Z\. It can't move to 2027-11-30T05:59Z\./.test(attempt(closeShift(db, { hours: -2 }))));
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
    deepStrictEqual(printPath({ ...p, waives: [] }), block);
  }
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
console.log(failed === 0 ? `${PACK.length + 43} checks passed` : `${failed} failed`);
if (failed > 0) process.exit(1);
