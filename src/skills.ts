// The skills, as wiki pages. Badass Courses' skills give agents the principles; halter holds the
// structure. Each page is built around one principle, explains it in our own prose, and credits the people the idea
// comes from through bibliography footnotes. The skills repo is private, so nothing links to it.
// The principle, its sources and its forms come from LANGUAGE.md's `### Skills` table; the rest is ours.

export interface Snippet {
  // a seed path, and the printed lines to show: each pick is a line pattern plus how many lines from it
  readonly path: string;
  readonly picks: ReadonlyArray<readonly [RegExp, number]>;
}
export interface SkillPage {
  readonly skill: string;
  // the checks that hold the principle, by id
  readonly heldBy: ReadonlyArray<string>;
  readonly snippet: Snippet;
  // the campaign that shows it: a path page, and what to look at there
  readonly campaign: string;
  readonly idea: string;
  readonly why: string;
  readonly how: string;
  readonly look: string;
}
export interface Skill extends SkillPage {
  readonly slug: string;
  readonly principle: string;
  readonly title: string;
  readonly builds: string;
  readonly sources: ReadonlyArray<string>;
}

const PAGES: ReadonlyArray<SkillPage> = [
  {
    skill: "value-paths",
    heldBy: ["path-has-target", "target-is-our-object", "trigger-has-evidence", "wait-has-timeout"],
    snippet: { path: "small-tools-bridge", picks: [[/^ {2}\(offer /, 2], [/^ {2}\(enters-on /, 1], [/^ {2}\(exit-on /, 2]] },
    campaign: "small-tools-bridge",
    idea: "Nobody signs up for a product because they love products. They have a situation and want a better one. A value path is the route from where someone stands to that better place, and it's theirs, not ours. Our course or our pitch covers one stretch of it.",
    why: "If we picture our offer as the whole journey, we write campaigns that talk past people: they get a pitch for something they haven't reached yet, or a lesson they finished last month. The move is to design the path, not the product. [hulick] Reading that path as a machine with states is halter's own addition, and it makes the question concrete: where is this person now, and what moves them on? Getting someone through our steps isn't the point either; the point is the result they came for. [hooks-process]",
    how: "The only campaign form is `path`, a machine each person walks. Every path names the person's result with `(target PRED :within DURATION)`, and halter measures it: `:path/reached-target` or `:path/missed-target`, once per person. The target never gates a send, and it keeps watching after someone finishes or leaves. A target that only reads `bought?` is our result, not theirs, so it raises an alarm. A path never names what comes next. It writes path events as facts, and a successor subscribes with `enters-on`, so paths chain the way a person's journey does, one piece at a time.",
    look: "The Small Tools bridge holds one offer for one stretch of the journey. Its target isn't the sale: it's `(and (bought? \"small-tools\") (did? \"tool-in-use\"))`, the tool actually running. Cy bought, left the pitch on `exit-on`, and reached that target two weeks later.",
  },
  {
    skill: "email-sequence-architect",
    heldBy: ["job-on-every-send", "pitch-to-buyer", "bridge-announces-pitch", "support-to-buyers"],
    snippet: { path: "small-tools-bridge", picks: [[/^ {2}\(state bridge/, 3], [/^ {2}\(exit-on /, 1]] },
    campaign: "small-tools-bridge",
    idea: "A sequence is a set of emails with one purpose, and each email inside it has a single role in that purpose. People read at their own speed, so the sequence follows them, not the calendar. Between a free course and a sales pitch sits a short bridge that says a pitch is coming. Once someone buys, the selling stops for them.",
    why: "An email with no clear role wastes the reader's attention and the next email's welcome. A pitch that arrives cold feels like a bait and switch, and a pitch that keeps going after the purchase tells the buyer we weren't paying attention. [dunn-bridge] Running this on a provider that has no events meant tags standing in for them. [hooks-kit]",
    how: "Every `send` carries a `:job` from a closed list, so the arc of a path is something a check can read. An unknown job is refused with the nearest real one, so `:job nudge` comes back as `support`. A pitch path has an `exit-on` for buyers. A state that announces the pitch comes before the first fix send. Buyers who leave get `support` sends on a path that enters on `(bought? …)`, and only there.",
    look: "The bridge state sends one announce-pitch email, waits two days, and moves to the pitch. Anyone who buys leaves at once, and [Small Tools: get your first tool in use](/paths/small-tools-start/) picks them up on the same purchase fact.",
  },
  {
    skill: "launch-sequencer",
    heldBy: ["teach-before-fix", "fake-deadline", "deadline-names-event", "rest-days"],
    snippet: { path: "fieldkit-c7", picks: [[/^ {2}\(state launch/, 7]] },
    campaign: "fieldkit-c7",
    idea: "One loud announcement sells very little. A launch works when people have been warmed up first: they got something useful for free, they heard the offer was coming, and the deadline they're asked to beat is real.",
    why: "Trust is built before the pitch, not during it. Free teaching earns the right to ask, and a launch is several events on real days, not one email. [hoy-lcc] A cold pitch to people who aren't ready sells nothing, and urgency only counts when something actually changes. [barry-launch] The pitch itself should walk through the problem, the better place, and then the fix. [hoy-30x500] The cohort in the example follows a published launch schedule. [coz]",
    how: "Jobs make the warm-up visible: teach sends before the first fix, an announce-pitch before the pitch. Every urgency or last-call send names its `:deadline`, and that deadline has to be an event in the offer, like the close or the end of early bird. Sends on three days running before the close raise an alarm.",
    look: "Field Kit, Cohort 7 teaches, announces, then pitches. Both urgency sends point at real offer events.",
  },
  {
    skill: "launch-runbook",
    heldBy: ["post-close-survey"],
    snippet: { path: "fieldkit-c7", picks: [[/\(send "c7-08"/, 1], [/^ {2}\(waive /, 1]] },
    campaign: "fieldkit-c7",
    idea: "Having a plan isn't the same as launching. The result is what counts, and the steps are only there to serve it. The first launch is rough, and each one after it is better because the last one taught something.",
    why: "A process followed for its own sake turns into a checklist that blocks shipping. Keeping the reasons in view lets a team skip a step on purpose and say why. [hooks-process] Launch schedules from people who run many launches show the same pattern: warm up, sell, close, then learn from the people who didn't buy. [coz] [hoy-lcc] [stb]",
    how: "Doctrine checks alarm and never block, and an author can waive one on the record with a reason. The waiver stays in the printed path, so the next launch can see it. A path that closes needs some way of asking non-buyers why, either a survey send in it or a path that enters when it finishes.",
    look: "The cohort waives the warm-up alarm on the record and ends with a survey send to the people who didn't buy.",
  },
  {
    skill: "launch-operations",
    heldBy: ["else-on-every-vary", "post-close-survey"],
    snippet: { path: "bf-2027", picks: [[/\(send "bf-02"/, 2], [/\(send "bf-06"/, 1]] },
    campaign: "bf-2027",
    idea: "A sale with a fixed window works better when the message fits the reader. Split by what you know about people, keep a group that gets the plain version so you can tell whether the split helped, and when it's over, ask the people who didn't buy.",
    why: "Personal messages only earn their extra work if they beat the generic one, and you can't know that without a comparison group. [dunn-launch] Segments have to come from data you trust, which mostly means what people told you. [dunn-rm]",
    how: "A send can `vary` by a dimension, and every `vary` ends with an `else`, so people with no value still get the general message. Black Friday is the example. The control group and the experiment alarms aren't built yet; they need offer facts this sketch doesn't have.",
    look: "Black Friday 2027 sends the fix email in three versions by role, with a generic one for everyone else, and closes with a survey.",
  },
  {
    skill: "stb-copy-coach",
    heldBy: ["job-on-every-send", "teach-before-fix"],
    snippet: { path: "five-day-tools", picks: [[/^ {2}\(state course/, 5]] },
    campaign: "five-day-tools",
    idea: "Good copy starts where the reader hurts, shows them where they could be, and only then offers the way there. It uses their words and their details, and the reader is the hero of it, not the product.",
    why: "Vague claims read like nobody wrote them for anyone. Specifics read like someone was listening. Leading with the fix before the reader has felt the problem skips the part that makes the fix worth anything. [hoy-30x500] [stb]",
    how: "Jobs fall into pain, dream and fix bands, and every page that prints a path draws its arc strip, so you can see the shape of a sequence before reading a word of it.",
    look: "The free course moves through teach, pain, teach and dream before the bridge ever pitches.",
  },
  {
    skill: "sales-safari",
    heldBy: ["hard-from-inferred"],
    snippet: { path: "fieldkit-c7", picks: [[/^ {2}\(guard/, 2]] },
    campaign: "fieldkit-c7",
    idea: "Demand can't be manufactured. The work is finding what people already want, and the best evidence is what they say and do when nobody is asking them anything.",
    why: "Asked directly, people describe who they'd like to be. Watched in their own forums and habits, they show what they actually struggle with. [hoy-safari] [hoy-30x500]",
    how: "Every transaction says how we know: observed, asked or inferred. A purchase is observed. A send that states something as fact about who someone is can't rest on an inferred value.",
    look: "The cohort skips anyone who owns the library. That guard reads a purchase, something we saw happen, not a guess.",
  },
  {
    skill: "subscriber-intelligence",
    heldBy: ["hard-from-inferred", "few-values"],
    snippet: { path: "bf-2027", picks: [[/^ {2}\(enters-on /, 1]] },
    campaign: "bf-2027",
    idea: "Before tailoring anything to a segment, find out how many people you actually know enough about. A segment you guessed from behaviour is a hypothesis, and it can be wrong.",
    why: "Personalizing for a dimension that covers a tenth of the list mostly sends the default. Treating a guess as a fact risks telling someone who they are and being wrong to their face. [dunn-rm]",
    how: "Coverage is a query over facts, not a dashboard. The facts page shows how many values came from each source. A dimension with too many values raises an alarm, and a hard claim can't come from an inferred value.",
    look: "Black Friday leaves out library owners using a purchase fact, the one thing about them we know for sure.",
  },
  {
    skill: "survey-strategy",
    heldBy: ["else-on-every-vary", "value-declared", "few-values"],
    snippet: { path: "bf-2027", picks: [[/\(send "bf-02"/, 2]] },
    campaign: "bf-2027",
    idea: "A short survey with a handful of fixed answers tells you more than a long one with free text. Store the answer as a field you can rely on, and plan for the many people who never answer.",
    why: "Stable values can be used in automation for years. Free-form answers can't. Most of a list skips any survey, so a campaign that only works for people who answered fails most people. [dunn-survey] [dunn-rm]",
    how: "A `dimension` declares its values. An answer is a fact with source `asked`. Every `vary` names only declared values and ends with `else`.",
    look: "Black Friday varies its fix email by role, with two declared values and a generic version for everyone else.",
  },
  {
    skill: "proof-and-objections",
    heldBy: ["objection-has-fix"],
    snippet: { path: "small-tools-bridge", picks: [[/^ {2}\(state pitch/, 4]] },
    campaign: "small-tools-bridge",
    idea: "When someone says no, figure out what kind of no it is before replying. Some objections are about trust, some about clarity, some about the offer itself. Proof is how you show the offer does what it says.",
    why: "Answering a trust problem with a discount, or a scope problem with more testimonials, wastes the reply. Proof that's only there for decoration doesn't move anyone. [stb]",
    how: "Claims, proof and objections are meant to be facts that checks can match. That check isn't built yet: the sketch has no claim facts. Today the pitch carries a proof send by job.",
    look: "The bridge's pitch sends a fix, then proof, then a last call.",
  },
  {
    skill: "shipping-discipline",
    heldBy: ["synthetic-live"],
    snippet: { path: "spring-note", picks: [[/^\(path /, 6]] },
    campaign: "spring-note",
    idea: "Work gets done in small steps you can see. Feeling stuck or behind isn't a measurement, and it's a bad guide to what to do next.",
    why: "A visible step can be checked, shown and built on. A feeling can't. [stb]",
    how: "halter keeps facts, not impressions: who was sent what, when, and how we know. Going live leaves a receipt, and a synthetic person can never reach a real send.",
    look: "Spring note is the smallest campaign there is: one state, one send. It still prints, reads back and checks like the big ones.",
  },
  {
    skill: "paid-attribution-kernel",
    heldBy: ["synthetic-live"],
    snippet: { path: "fieldkit-c7", picks: [[/^ {2}\(pace /, 2]] },
    campaign: "fieldkit-c7",
    idea: "Prove the core behaviour with a fake run before connecting any outside provider. Once a made-up person has gone through the whole journey and left a record, you can trust the wiring.",
    why: "Settings that look correct say nothing about whether the journey works. Only a run does. [bc-gates]",
    how: "Synthetic people run only in simulations, and the check refuses a live path that would send to one. Providers sit behind adapters, so the core can run on a test clock with nothing connected.",
    look: "The cohort ramps its send rate slowly, which is how a live start limits the damage if the run missed something.",
  },
  {
    skill: "kit-automation-architect",
    heldBy: ["trigger-has-evidence"],
    snippet: { path: "why-didnt-you-buy", picks: [[/^\(path /, 6]] },
    campaign: "why-didnt-you-buy",
    idea: "An email provider has its own way of doing things, and some of it is workaround. Kit has no custom events, so tags get added and removed to stand for them. Those tricks belong at the edge, not in the campaign.",
    why: "When a workaround becomes the model, every campaign inherits its limits. [kit] Tags standing in for events got real campaigns running on a provider without events. [hooks-kit] [dunn-bridge]",
    how: "halter has typed events: a path finishing is a fact, and a successor enters on it. Provider mechanics live in adapters.",
    look: "Why didn't you buy? enters when the bridge finishes. No tag is set or cleared to make that happen.",
  },
];

// LANGUAGE.md's `### Skills` table: | page | skill | principle | builds on | embodies |
export const parseSkillsTable = (language: string): ReadonlyMap<string, { principle: string; sources: ReadonlyArray<string>; builds: string }> => {
  const at = language.indexOf("### Skills");
  const rows = language
    .slice(at)
    .split("\n")
    .filter((l) => l.startsWith("| `/skills/"));
  return new Map(
    rows.map((r) => {
      const cells = r.split("|").map((c) => c.trim());
      return [cells[2] ?? "", { principle: cells[3] ?? "", sources: [...(cells[4] ?? "").matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1] ?? ""), builds: cells[5] ?? "" }];
    }),
  );
};

export const skillsFrom = (language: string): ReadonlyArray<Skill> => {
  const table = parseSkillsTable(language);
  return PAGES.map((p) => {
    const row = table.get(p.skill);
    if (!row) throw new Error(`skill ${p.skill} is not in LANGUAGE.md's Skills table`);
    return { ...p, slug: `/skills/${p.skill}/`, principle: row.principle, title: row.principle.split(/(?<=\.) /)[0] ?? row.principle, builds: row.builds, sources: row.sources };
  });
};

import { SKILL_OF_CHECK } from "./skillmap.ts";
export { SKILL_OF_CHECK };
// Every check a page says holds its principle points back at some skill page.
for (const p of PAGES) for (const c of p.heldBy) if (!SKILL_OF_CHECK.has(c)) throw new Error(`check ${c} on ${p.skill} has no skill page`);
