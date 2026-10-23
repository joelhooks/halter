// Attribution goes through the bibliography only. Entries follow LANGUAGE.md's Bibliography table:
// the original creators and their public sources. On the site a citation is a numbered footnote;
// keys are internal and never shown.
export interface Work {
  readonly title: string;
  readonly url?: string;
}
export interface Entry {
  readonly key: string;
  readonly works: ReadonlyArray<Work>;
  // where a source has no public link, say what it is instead
  readonly unpublished?: string;
  readonly where?: string;
  readonly creators: string;
  readonly takes: string;
  // the Bibliography page groups entries by this
  readonly group: string;
  // a short label for places a footnote can't go, like the live checks panel
  readonly short: string;
}

export const BIB: ReadonlyArray<Entry> = [
  {
    key: "hulick",
    works: [
      { title: "Value Paths", url: "https://www.valuepaths.com/" },
      { title: "\u201cSamuel Hulick on designing paths, not products\u201d, Intercom, 2021", url: "https://www.intercom.com/blog/podcasts/useronboards-samuel-hulick-on-designing-paths-not-products/" },
      { title: "\u201cValue Paths & Fireballs\u201d, Userlist, 2020", url: "https://userlist.com/podcast/value-paths-fireballs-with-samuel-hulick/" },
    ],
    creators: "Samuel Hulick",
    takes: "Design paths, not products. A person moves from a before state to an after state, and our offer is never the whole path. Reading the path as a state machine is halter's addition.",
    group: "Samuel Hulick",
    short: "Hulick, Value Paths",
  },
  {
    key: "dunn-bridge",
    works: [{ title: "\u201cReplicating 1:1 Sales with Email Automation: Advice from Brennan Dunn\u201d, Userlist", url: "https://userlist.com/blog/replicating-sales-with-email-automation-brennan-dunn/" }],
    creators: "Brennan Dunn",
    takes: "An email course, then a bridge, then the pitch. Every send has a job. Buyers leave the pitch at once.",
    group: "Brennan Dunn",
    short: "Dunn, email sales",
  },
  {
    key: "dunn-launch",
    works: [{ title: "Mastering ConvertKit, a course", url: "https://createandsell.co/courses/mastering-kit" }],
    creators: "Brennan Dunn",
    takes: "Launches personalized by segment, deadlines that really change the offer, a control group, and asking non-buyers why. Flag tags stand in for events.",
    group: "Brennan Dunn",
    short: "Dunn, Mastering ConvertKit",
  },
  {
    key: "hoy-lcc",
    works: [{ title: "Launch Crash Course: \u201cA Thousand Launches\u201d, \u201cHow to Structure Your Launch\u201d and \u201c3 Examples: Real Launch Timelines\u201d" }],
    unpublished: "course material, not public",
    creators: "Amy Hoy, Alex Hillman, with launch timelines from Chris Hartjes, Brandon Savage and Brennan Dunn",
    takes: "Build slow, give to get, create events. At least three emails before launch. Launch day is one event among several, each on a specific day and time.",
    group: "Amy Hoy and Alex Hillman",
    short: "Hoy and Hillman, Launch Crash Course",
  },
  {
    key: "barry-launch",
    works: [{ title: "\u201c3 reasons product launches fail\u201d, from Mastering Product Launches" }],
    unpublished: "course material, not public",
    creators: "Nathan Barry",
    takes: "Launches fail on audience, excitement or urgency. A cold pitch in one email sells nothing.",
    group: "Nathan Barry",
    short: "Barry, why launches fail",
  },
  { key: "dunn-rm", works: [{ title: "RightMessage", url: "https://rightmessage.com/" }], creators: "Brennan Dunn", takes: "Personalization and segmentation. Asked beats inferred, and inferred values can be wrong.", group: "Brennan Dunn", short: "Dunn, RightMessage" },
  {
    key: "dunn-survey",
    works: [
      { title: "Segment With Surveys, a course", url: "https://createandsell.co/courses/segment-with-surveys" },
      { title: "\u201cHow to survey subscribers using custom fields\u201d, Kit", url: "https://help.convertkit.com/en/articles/5434217-how-to-survey-subscribers-using-custom-fields-in-convertkit" },
      { title: "\u201cMastering Email Software with Brennan Dunn\u201d, Userlist", url: "https://userlist.com/podcast/mastering-email-software-with-brennan-dunn/" },
      { title: "\u201cThe Key to Personalized Emails: How to Segment Your Subscribers\u201d, Julia Saxena, Course Creator Lab", url: "https://www.coursecreatorlab.co/blog/the-key-to-personalized-emails-how-to-segment-your-subscribers" },
    ],
    creators: "Brennan Dunn",
    takes: "Survey answers stored as custom fields with stable values, not tags, and a default for everyone else.",
    group: "Brennan Dunn",
    short: "Dunn, Segment With Surveys",
  },
  { key: "hoy-30x500", works: [{ title: "30x500", url: "https://30x500.com/" }], creators: "Amy Hoy, Alex Hillman", takes: "Pain-Dream-Fix.", group: "Amy Hoy and Alex Hillman", short: "Hoy and Hillman, 30x500" },
  {
    key: "hoy-safari",
    works: [{ title: "\u201cSales Safari in Action\u201d, Stacking the Bricks", url: "https://stackingthebricks.com/video-sales-safari-in-action/" }],
    creators: "Amy Hoy, Alex Hillman",
    takes: "Observation beats asking.",
    group: "Amy Hoy and Alex Hillman",
    short: "Hoy and Hillman, Sales Safari",
  },
  {
    key: "stb",
    works: [
      { title: "Stacking the Bricks", url: "https://stackingthebricks.com/" },
      { title: "Just Fucking Ship", url: "https://justfuckingship.com/" },
    ],
    creators: "Amy Hoy, Alex Hillman",
    takes: "Plan post-launch work. Proof and objections belong on the page.",
    group: "Amy Hoy and Alex Hillman",
    short: "Hoy and Hillman, Stacking the Bricks",
  },
  { key: "coz", works: [{ title: "Mariah Coz", url: "https://mariahcoz.com/" }], creators: "Mariah Coz", takes: "The launch schedule the example cohort follows.", group: "Mariah Coz", short: "Coz, launch schedule" },
  { key: "kit", works: [{ title: "Kit developer documentation", url: "https://developers.kit.com/" }], creators: "Kit", takes: "What the email provider can and can't do. It has no custom events.", group: "Kit", short: "Kit docs" },
  {
    key: "hooks-kit",
    works: [{ title: "\u201cSelf-Paced Email Course and Evergreen Product Pitch using Convertkit Automations\u201d", url: "https://joelhooks.com/self-paced-email-course-convertkit" }],
    creators: "Joel Hooks, after Brennan Dunn's Mastering ConvertKit course",
    takes: "The bridge sequence and the evergreen pitch, with tags standing in for events.",
    group: "Joel Hooks",
    short: "Hooks, ConvertKit pitch",
  },
  {
    key: "hooks-process",
    works: [{ title: "\u201cThe Process is a Lie\u201d" }],
    unpublished: "unpublished notes from the Value Paths work with Samuel Hulick",
    creators: "Joel Hooks",
    takes: "Outcomes ahead of process, which is why doctrine alarms and never blocks.",
    group: "Joel Hooks",
    short: "Hooks, The Process is a Lie",
  },
  { key: "pu", works: [{ title: "pi-until", url: "https://github.com/joelhooks/pi-until" }], creators: "Joel Hooks", takes: "The trigger rules.", group: "Joel Hooks", short: "pi-until" },
  {
    key: "rk",
    works: [{ title: "Rat King's delivery judge", url: "https://github.com/joelhooks/rat-king" }],
    where: "packages/ratking-client/src/attend.ts",
    creators: "Joel Hooks",
    takes: "One pure decision, computed time, and dry runs.",
    group: "Joel Hooks",
    short: "Rat King's delivery judge",
  },
  { key: "bc-gates", works: [{ title: "Launch-gate practice" }], unpublished: "unpublished", creators: "Badass Courses", takes: "Nothing is live until a synthetic run leaves a receipt.", group: "Badass Courses", short: "launch-gate practice" },
];
export const BIB_BY_KEY = new Map(BIB.map((e) => [e.key, e]));
// Creator groups in the order the Bibliography page shows them.
export const GROUP_ORDER = [...new Set(BIB.map((e) => e.group))];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// "Work. Creators." as plain text and as HTML; an unpublished source says what it is.
// When a work's title is just its author's name, the site's domain is the title: "Mariah Coz, mariahcoz.com".
export const titleOf = (e: Entry, w: Work): string => (w.title === e.creators && w.url ? new URL(w.url).hostname.replace(/^www\./, "") : w.title);
export const workText = (e: Entry) => `${e.works.map((w) => (w.url ? `${titleOf(e, w)} (${w.url})` : titleOf(e, w))).join(" and ")}${e.unpublished ? ` (${e.unpublished})` : ""}`;
export const workHtml = (e: Entry) =>
  `${e.works.map((w) => (w.url ? `<a href="${esc(w.url)}">${esc(titleOf(e, w))}</a>` : esc(titleOf(e, w)))).join(" and ")}${e.where ? ` (<code>${esc(e.where)}</code>)` : ""}${e.unpublished ? ` <span class="mute">(${esc(e.unpublished)})</span>` : ""}`;
export const entryHtml = (e: Entry) => `${workHtml(e)}. ${esc(e.creators)}. ${esc(e.takes)}`;
export const entryText = (e: Entry) => `${workText(e)}. ${e.creators}. ${e.takes}`;
// A citation key in prose: [hulick], [dunn-bridge].
export const CITE = /\[([a-z][a-z0-9-]{1,15})\]/g;

export interface Term {
  readonly term: string;
  readonly slug: string;
  readonly def: string;
  // the page that teaches it
  readonly page: string;
  // other words that count as a first use
  readonly also?: ReadonlyArray<string>;
}
const t = (term: string, page: string, def: string, also: ReadonlyArray<string> = []): Term => ({
  term,
  slug: term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  def,
  page,
  also,
});
export const TERMS: ReadonlyArray<Term> = [
  t("path", "/language/", "The only campaign form: a machine each person walks, state by state. A broadcast is a path with one state.", ["paths"]),
  t("state", "/language/", "One stop on a path. It holds sends and transitions, and states run in the order they're written.", ["states"]),
  t("send", "/language/", "One message a state delivers, timed :after entering the state or :on a calendar instant.", ["sends"]),
  t("via", "/language/", "The channels a send goes through, from email, sms and site: one, (or …) for the first the person can receive, or (and …) for every one.", ["channel", "channels"]),
  t("target", "/language/", "The person's real result, (target PRED :within DURATION). It measures and never gates a send, and it's watched after done or exited.", ["targets"]),
  t("support", "/paths/small-tools-start/", "A :job in the after band: a send that helps someone who already bought reach the path's target."),
  t("structure", "/language/", "The path: states, timing, triggers, guards and pace. A person runs it as it was when they entered."),
  t("content", "/language/", "The messages a path names, one rendition per channel, with bodies as refs. Read at delivery.", ["message", "messages", "rendition", "renditions"]),
  t("job", "/language/", "Why a send exists, from a closed list: teach, pain, dream, fix, announce-pitch, proof, faq, urgency, last-call, survey."),
  t("offer", "/language/", "What a path sells: a product, a named pricing version, and the events that change it."),
  t("offer event", "/language/", "An instant at which an offer changes: close, early-bird or class. A deadline must name one.", ["deadline"]),
  t("enters-on", "/language/", "The predicate that lets a person onto a path. The only way in, and how one path subscribes to another."),
  t("exit-on", "/language/", "The predicate that takes a person off a path for good, to exited."),
  t("guard", "/language/", "Clauses checked before every send. The first match skips or defers; no match means send."),
  t("predicate", "/language/", "A pure test over facts, written in the Lisp. Every predicate's name ends in ?.", ["predicates"]),
  t("dimension", "/language/", "A way people differ, with a short list of stable values. Every person is unknown until a fact says otherwise.", ["dimensions"]),
  t("waiver", "/checks/", "A fact that turns one alarm off for one path. Anyone can write it except whoever raised the alarm; that author's waiver stays pending until someone else confirms it. Its why quotes its author, or names an inferred :rule.", ["waivers", "waive"]),
  t("fact", "/facts/", "One [entity attribute value tx]. The facts are the data; everything else is a view of them.", ["facts", "datom", "datoms"]),
  t("transaction", "/facts/", "A group of facts asserted or retracted together, carrying who, when, why and how we know.", ["transactions"]),
  t("how we know", "/facts/", "The :tx/source of a transaction: asked, observed, inferred (with its rule) or assumed.", ["how-we-know"]),
  t("world event", "/facts/", "A transaction from outside halter: a purchase, a finished course, a survey answer.", ["world events"]),
  t("path event", "/facts/", "A transaction the interpreter writes as agent:halter: entered, at, sent, skipped, finished, exited.", ["path events"]),
  t("as-of", "/facts/", "The database as it stood at transaction t. The slider on each path page moves it.", ["as of"]),
  t("check", "/checks/", "A saved query that should come back empty. Each row it returns is one problem.", ["checks"]),
  t("refusal", "/checks/", "A check result that blocks: the path is ill-formed, or would cause harm that can't be undone.", ["refuse", "refused", "refusals"]),
  t("alarm", "/checks/", "A check result the author can ship past, or waive on the record.", ["alarms"]),
  t("registry", "/machine/", "The fixed list of reviewed code the Lisp can name. A new word is new code, never new data."),
  t("interpreter", "/machine/", "The fixed code that turns each path into an XState v6 machine per person and writes path events."),
  t("arc strip", "/paths/fieldkit-c7/", "A path's sends as a strip of coloured blocks by job band: pain, dream, fix, after.", ["arc strips"]),
  t("printout", "/language/", "The halter file: print(asOf(db, t)). Reading it back gives the same facts.", ["print"]),
];
