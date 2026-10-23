// Fernhill School: a fictional brand, seven fake paths, one log.
// The authored transactions are below. The interpreter adds the path events between them.
import { asOf, dateMs, diff, facts, kw, msDate, schemaOps, type Db, type EvidenceKind, type Op, type TxInput } from "./db.ts";
import { contentFacts, type Message } from "./content.ts";
import { allSends, fromFacts, toFacts, type Path, type Send, type Via } from "./model.ts";
import { interpret } from "./run.ts";

const H = 3_600_000;
const add = (e: string, a: string, v: string | number | boolean | ReturnType<typeof kw>): Op => ({ e, a, v, added: true });
const plan = (before: Path | undefined, after: Path): Array<Op> => diff(before ? toFacts(before) : [], toFacts(after));
// Commit and move everyone (D32): the edit and (move PATH) land in one transaction, so nobody on the
// path is left on the old version. A calendar path enters everyone at go-live, so its edits after go-live want this.
const everyone = (input: TxInput, path: string): TxInput => ({ ...input, moves: [{ path }] });
const tx = (who: string, at: string, source: EvidenceKind, why: string, ops: Array<Op>, rule?: string): TxInput => ({
  who,
  at,
  source,
  why,
  ops,
  ...(rule === undefined ? {} : { rule }),
});

const PEOPLE = [
  ["ana", "Ana Birch", "ana@example.com"],
  ["ben", "Ben Okafor", "ben@example.org"],
  ["cy", "Cy Lund", "cy@example.com"],
  ["dee", "Dee Hart", "dee@example.org"],
  ["eli", "Eli Marsh", "eli@example.com"],
  ["fay", "Fay Quinn", "fay@example.org"],
  ["gus", "Gus Reyes", "gus@example.com"],
  ["hal", "Hal Ito", "hal@example.org"],
] as const;

const shared: Array<Op> = [
  add("list/fernhill-news", "list/name", "Fernhill News"),
  add("list/fernhill-news", "list/slug", "fernhill-news"),
  add("list/fernhill-test", "list/name", "Fernhill test list"),
  add("list/fernhill-test", "list/slug", "fernhill-test"),
  ...(
    [
      ["fieldkit-c7", "Field Kit, Cohort 7", "cohort"],
      ["small-tools", "Small Tools, Shipped", "self-paced"],
      ["library", "The Fernhill library", "bundle"],
    ] as const
  ).flatMap(([slug, name, k]) => [
    add(`product/${slug}`, "product/name", name),
    add(`product/${slug}`, "product/slug", slug),
    add(`product/${slug}`, "product/kind", kw(k)),
    add(`product/${slug}`, "product/buyer-tag", `bought:${slug}`),
  ]),
  add("course/five-day-tools", "course/name", "Five-Day Tools"),
  add("course/five-day-tools", "course/slug", "five-day-tools"),
  ...["Pick one small tool", "Make it run once", "Make it run twice", "Write the readme", "Ship it to one friend"].flatMap((title, i) => [
    add(`lesson/five-day-tools/${i + 1}`, "lesson/course", "course/five-day-tools"),
    add(`lesson/five-day-tools/${i + 1}`, "lesson/n", i + 1),
    add(`lesson/five-day-tools/${i + 1}`, "lesson/title", title),
  ]),
  add("dim/role", "dim/name", "role"),
  add("dim/role", "dim/attr", "person/role"),
  // built in: the channel a person prefers, which picks within :via (or …) when they told us (D24)
  add("dim/channel", "dim/name", "channel"),
  add("dim/channel", "dim/attr", "person/channel"),
  ...["email", "sms", "site"].map((c) => add("dim/channel", "dim/values", kw(c))),
  ...PEOPLE.flatMap(([id, name, email]) => [
    add(`person/${id}`, "person/name", name),
    add(`person/${id}`, "person/email", email),
    add(`person/${id}`, "person/lists", "list/fernhill-news"),
  ]),
  add("person/zed", "person/name", "Zed Test"),
  add("person/zed", "person/email", "zed@example.org"),
  add("person/zed", "person/lists", "list/fernhill-test"),
  add("person/zed", "person/synthetic", true),
];

const EMAIL: Via = { channels: ["email"] };
const SITE_EMAIL: Via = { op: "and", channels: ["site", "email"] };
const SMS_EMAIL: Via = { op: "or", channels: ["sms", "email"] };
const send = (key: string, timing: { on: string } | { after: number }, job: string, extra: Partial<Send> = {}): Send => ({ key, via: EMAIL, ...timing, job, ...extra });
const onList = { name: "on-list?", arg: "fernhill-news" } as const;
// Fresh evidence: the list was built before these paths went live, so they reach back with :since.
const SINCE = "2027-01-01T00:00Z";
// Targets: the person's result, not ours (D28). An act is [p :did ACT]; only observed or asked counts.
const did = (act: string) => ({ name: "did?", arg: act }) as const;
const boughtP = (product: string) => ({ name: "bought?", arg: product }) as const;
const shipped = { pred: did("shipped-tool"), within: 720 * H };
const toolInUse = { pred: { name: "and", kids: [boughtP("small-tools"), did("tool-in-use")] }, within: 1440 * H } as const;

const c7: Path = {
  id: "fieldkit-c7",
  title: "Field Kit, Cohort 7: launch",
  list: "fernhill-news",
  offer: {
    product: "fieldkit-c7",
    pricing: "fieldkit-c7-2027",
    opens: "2027-03-01T17:00Z",
    closes: "2027-03-15T23:00Z",
    earlyBird: "2027-03-08T23:00Z",
    classStarts: "2027-03-22T17:00Z",
  },
  entersOn: onList,
  since: SINCE,
  holds: [],
  states: [
    {
      name: "launch",
      sends: [
        send("c7-01", { on: "2027-02-08T17:00Z" }, "teach"),
        send("c7-02", { on: "2027-02-15T17:00Z" }, "teach"),
        send("c7-03", { on: "2027-02-22T17:00Z" }, "teach"),
        send("c7-04", { on: "2027-02-28T17:00Z" }, "announce-pitch"),
        send("c7-05", { on: "2027-03-01T17:00Z" }, "fix"),
        send("c7-06", { on: "2027-03-08T17:00Z" }, "urgency", { deadline: "early-bird" }),
        send("c7-07", { on: "2027-03-15T17:00Z" }, "last-call", { deadline: "close" }),
        send("c7-08", { on: "2027-03-18T17:00Z" }, "survey"),
      ],
      tos: [],
    },
  ],
  exitOn: { name: "bought?", arg: "fieldkit-c7" },
  // what the cohort gets them: they use the kit in the field
  target: { pred: { name: "and", kids: [boughtP("fieldkit-c7"), did("used-the-kit")] }, within: 2160 * H },
  guard: [],
  pace: { rate: 200, rampTo: 600, rampStep: 50, rampEvery: 10 * 60_000 },
  waives: [],
};
const resend = (m: Path, key: string, on: string): Path => ({
  ...m,
  states: m.states.map((st) => ({ ...st, sends: st.sends.map((s) => (s.key === key ? { ...s, on } : s)) })),
});
const offer = (m: Path) => m.offer ?? { product: "", pricing: "" };
const c7a = resend(resend({ ...c7, offer: { ...offer(c7), opens: "2027-03-02T17:00Z" } }, "c7-04", "2027-03-01T17:00Z"), "c7-05", "2027-03-02T17:00Z");
const c7b: Path = { ...c7a, guard: [{ when: { name: "tag?", arg: "bought:library" }, action: "skip", reason: "owns the library" }] };
const c7c: Path = { ...c7b, pace: { ...c7b.pace, rate: 150 } };
const c7d: Path = { ...c7c, states: c7c.states.map((st) => ({ ...st, sends: st.sends.filter((s) => s.key !== "c7-02") })) };
const c7e: Path = { ...c7d, waives: ["teach-before-fix"] };

const spring: Path = {
  id: "spring-note",
  title: "Spring note",
  list: "fernhill-news",
  entersOn: onList,
  since: SINCE,
  holds: [],
  states: [{ name: "note", sends: [send("spring-note", { on: "2027-04-01T16:00Z" }, "teach")], tos: [] }],
  target: shipped,
  guard: [],
  pace: { rate: 200 },
  waives: [],
};

// A course on a site: each lesson unlocks, and an email says so. Finishing is this path writing :path/finished.
const LESSONS = ["Pick one small tool", "Make it run once", "Make it run twice", "Write the readme", "Ship it to one friend"];
const fiveDay: Path = {
  id: "five-day-tools",
  title: "Five days of small tools",
  list: "fernhill-news",
  entersOn: { name: "tag?", arg: "signup:five-day-tools" },
  holds: [],
  states: [
    {
      name: "course",
      sends: (["teach", "pain", "teach", "dream", "teach"] as const).map((job, i) => send(`day-${i + 1}`, { after: i * 24 * H }, job, { via: SITE_EMAIL })),
      tos: [{ target: "closed", after: 100 * H }],
    },
  ],
  target: { pred: did("shipped-tool"), within: 504 * H },
  guard: [],
  pace: { rate: 150 },
  waives: [],
};

const bridge: Path = {
  id: "small-tools-bridge",
  title: "Small Tools: bridge and pitch",
  list: "fernhill-news",
  offer: { product: "small-tools", pricing: "bridge-2027", windowState: "pitch" },
  entersOn: { name: "finished?", arg: "five-day-tools" },
  holds: [],
  states: [
    { name: "bridge", sends: [send("b1", { after: 2 * H }, "announce-pitch")], tos: [{ target: "pitch", after: 48 * H }] },
    {
      name: "pitch",
      sends: [
        send("p1", { after: 0 }, "fix", { via: SITE_EMAIL }),
        send("p2", { after: 24 * H }, "proof"),
        send("p3", { after: 66 * H }, "last-call", { via: SMS_EMAIL, deadline: "close" }),
      ],
      tos: [{ target: "closed", after: 72 * H }],
    },
  ],
  exitOn: { name: "bought?", arg: "small-tools" },
  target: toolInUse,
  guard: [{ when: { name: "tag?", arg: "bought:library" }, action: "skip", reason: "owns the library" }],
  pace: { rate: 150 },
  waives: [],
};
const bridgeB: Path = {
  ...bridge,
  states: bridge.states.map((st) =>
    st.name !== "pitch"
      ? st
      : { ...st, sends: st.sends.map((s) => (s.key === "p3" ? { ...s, after: 90 * H } : s)), tos: [{ target: "closed", after: 96 * H }] },
  ),
};

const bridgeW: Path = { ...bridge, waives: ["teach-before-fix"] };
const bridgeC: Path = { ...bridgeB, waives: ["teach-before-fix"] };
const bridgeHeld: Path = { ...bridgeW, holds: ["2027-11-20T00:00Z"] };

const why: Path = {
  id: "why-didnt-you-buy",
  title: "Why didn't you buy?",
  list: "fernhill-news",
  entersOn: { name: "finished?", arg: "small-tools-bridge" },
  holds: [],
  states: [{ name: "ask", sends: [send("w1", { after: 24 * H }, "survey")], tos: [] }],
  target: shipped,
  guard: [],
  pace: { rate: 150 },
  waives: [],
};

// Buyers: the bridge's exit-on lets them go, and this path picks them up. Support toward the same target.
const start: Path = {
  id: "small-tools-start",
  title: "Small Tools: get your first tool in use",
  list: "fernhill-news",
  entersOn: boughtP("small-tools"),
  holds: [],
  states: [
    {
      name: "start",
      sends: [send("s1", { after: 1 * H }, "support", { via: SITE_EMAIL }), send("s2", { after: 72 * H }, "support"), send("s3", { after: 168 * H }, "support")],
      tos: [],
    },
  ],
  exitOn: did("tool-in-use"),
  target: { pred: did("tool-in-use"), within: 1440 * H },
  guard: [],
  pace: { rate: 150 },
  waives: [],
};

const bf: Path = {
  id: "bf-2027",
  title: "Black Friday 2027",
  list: "fernhill-news",
  offer: { product: "library", pricing: "library-bf-2027", opens: "2027-11-26T08:00Z", closes: "2027-11-30T07:59Z" },
  entersOn: { name: "and", kids: [onList, { name: "not", kids: [{ name: "bought?", arg: "library" }] }] },
  since: SINCE,
  holds: [],
  states: [
    {
      name: "sale",
      sends: [
        send("bf-01", { on: "2027-11-24T17:00Z" }, "announce-pitch"),
        send("bf-02", { on: "2027-11-26T17:00Z" }, "fix", {
          vary: { dim: "role", hard: false, cases: [{ value: "podcaster", message: "bf-02-podcaster" }, { value: "writer", message: "bf-02-writer" }], else: "bf-02" },
        }),
        send("bf-03", { on: "2027-11-27T17:00Z" }, "proof"),
        send("bf-04", { on: "2027-11-29T17:00Z" }, "urgency", { deadline: "close" }),
        send("bf-05", { on: "2027-11-30T02:00Z" }, "last-call", { deadline: "close" }),
        send("bf-06", { on: "2027-12-02T17:00Z" }, "survey"),
      ],
      tos: [],
    },
  ],
  exitOn: { name: "bought?", arg: "library" },
  // what the library gets them: they finish a course in it
  target: { pred: { name: "and", kids: [boughtP("library"), did("finished-a-library-course")] }, within: 2400 * H },
  guard: [],
  pace: { rate: 300, rampTo: 900, rampStep: 100, rampEvery: 10 * 60_000 },
  waives: [],
};
// Mara's Black Friday starts with one bf-02 for everyone; agent:drafter adds the role variants from the
// survey (D35, D36), so the drafter, not Mara, raises few-values.
const plain = (p: Path): Path => ({ ...p, states: p.states.map((st) => ({ ...st, sends: st.sends.map((s) => {
  if (s.key !== "bf-02") return s;
  const { vary: _vary, ...rest } = s;
  return rest;
}) })) });
const bfB: Path = { ...bf, guard: [{ when: { name: "in?", arg: "small-tools-bridge" }, action: "defer", for: 24 * H }] };
const bfC = resend(bfB, "bf-03", "2027-11-28T17:00Z");
const bfD: Path = { ...bfC, waives: ["teach-before-fix"] };
const bfE: Path = { ...bfD, waives: ["few-values", "teach-before-fix"] };
const bf0 = plain(bf);
const bfB0 = plain(bfB);
const bfC0 = plain(bfC);
const bfD0 = plain(bfD);

const ROLES = ["podcaster", "teacher", "designer", "developer", "writer", "founder"];
const ASKED: ReadonlyArray<readonly [string, string]> = [
  ["ana", "podcaster"],
  ["ben", "teacher"],
  ["cy", "developer"],
  ["dee", "designer"],
  ["eli", "writer"],
  ["hal", "founder"],
];
const INFERRED: ReadonlyArray<readonly [string, string]> = [
  ["fay", "developer"],
  ["gus", "podcaster"],
];
// Signing up makes a site account and tags the person; the course path does the rest.
const signup = (...who: Array<string>) => who.flatMap((p) => [add(`person/${p}`, "person/tags", "signup:five-day-tools"), add(`person/${p}`, "person/account", true)]);
const SIGNUP = 'Site: "signed up for Five days of small tools"';
const act = (p: string, a: string) => [add(`person/${p}`, "person/did", a)];
const bought = (p: string, product: string) => [add(`person/${p}`, "person/bought", `product/${product}`), add(`person/${p}`, "person/tags", `bought:${product}`)];


// Content: one message per id a send or a vary names, with only the renditions its :via needs.
// Bodies are refs into a copy store, never inline text. Every subject is made up.
const SUBJECT: Readonly<Record<string, string>> = {
  "c7-01": "What a field kit is for",
  "c7-02": "Packing light",
  "c7-03": "One tool, every day",
  "c7-04": "Cohort 7 opens Tuesday",
  "c7-05": "Field Kit, Cohort 7 is open",
  "c7-06": "Early-bird pricing ends tonight",
  "c7-07": "Last call: doors close tonight",
  "c7-08": "One question about Field Kit",
  "spring-note": "Spring at Fernhill",
  ...Object.fromEntries(LESSONS.map((t, i) => [`day-${i + 1}`, `Day ${i + 1} is open: ${t}`])),
  b1: "Something for people who finished",
  p1: "Small Tools is open",
  p2: "What people shipped",
  p3: "Small Tools closes in six hours",
  w1: "One question, one answer",
  s1: "Your Small Tools workspace is ready",
  s2: "Run your first tool",
  s3: "Stuck? Reply and we'll look",
  "bf-01": "Black Friday starts Friday",
  "bf-02": "The whole library is on sale",
  "bf-02-podcaster": "The library, for podcasters",
  "bf-02-writer": "The library, for writers",
  "bf-03": "What's in the library",
  "bf-04": "The sale ends Monday",
  "bf-05": "Last hours of the sale",
  "bf-06": "One question about the sale",
};
const PAGE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LESSONS.map((_, i) => [`day-${i + 1}`, `five-day-tools/day-${i + 1}`])),
  p1: "small-tools/welcome",
  s1: "small-tools/start",
};
export const messagesFor = (m: Path): Array<Message> => {
  const chans = new Map<string, Set<string>>();
  for (const sd of allSends(m)) {
    const ids = [sd.key, ...(sd.vary?.cases.map((c) => c.message) ?? []), ...(sd.vary?.else === undefined ? [] : [sd.vary.else])];
    for (const id of ids) chans.set(id, new Set([...(chans.get(id) ?? []), ...(sd.via?.channels ?? [])]));
  }
  return [...chans].map(([id, cs]) => ({
    id,
    ...(cs.has("email") ? { email: { subject: SUBJECT[id] ?? id, body: `${id}.email` } } : {}),
    ...(cs.has("sms") ? { sms: { body: `${id}.sms` } } : {}),
    ...(cs.has("site") ? { site: { page: PAGE[id] ?? `pages/${id}` } } : {}),
  }));
};
const copy = (who: string, at: string, why: string, m: Path) => tx(who, at, "assumed", why, contentFacts(messagesFor(m)).map((t) => ({ ...t, added: true })));

export const AUTHORED: ReadonlyArray<TxInput> = [
  tx("teo", "2027-01-04T17:00Z", "assumed", 'Mara: "Write the shape down before anything goes in it."', schemaOps()),
  tx("teo", "2027-01-05T17:00Z", "assumed", 'Teo: "Fake people only. Nothing real goes in the sketch."', shared),
  tx("adapter:shop", "2027-01-06T10:00Z", "observed", 'Shop: "order 1041, The Fernhill library"', bought("eli", "library")),
  copy("mara", "2027-01-11T17:50Z", 'Mara: "Copy for Cohort 7 first, then the dates."', c7),
  tx("mara", "2027-01-11T18:00Z", "assumed", 'Mara: "Doors open the first of March for two weeks. Class starts on the 22nd."', plan(undefined, c7)),
  everyone(tx("mara", "2027-01-20T22:00Z", "assumed", 'Mara: "Move doors to Tuesday the 2nd. Monday clashes with Small Tools office hours."', plan(c7, c7a)), "fieldkit-c7"),
  everyone(tx("mara", "2027-01-21T17:30Z", "assumed", 'Mara: "Anyone with the whole library already has Field Kit. Don\'t pitch them."', plan(c7a, c7b)), "fieldkit-c7"),
  everyone(tx("teo", "2027-02-01T19:00Z", "assumed", 'Teo: "Start slower. The new sending domain is still cold."', plan(c7b, c7c)), "fieldkit-c7"),
  everyone(tx("mara", "2027-02-10T18:00Z", "assumed", 'Mara: "Three warmups is one too many for this list. Drop the middle one."', plan(c7c, c7d)), "fieldkit-c7"),
  // D36: Mara raised teach-before-fix by dropping the warmup, so her own waiver is pending until Teo confirms it.
  tx("mara", "2027-02-10T18:20Z", "assumed", 'Mara: "Two warmups is right here. This list heard from us all winter."', plan(c7d, c7e)),
  tx("teo", "2027-02-11T09:00Z", "assumed", 'Teo: "Agreed, two is plenty. Everyone on this list had the winter newsletters."', [add("fieldkit-c7", "path/waives", "teach-before-fix")]),
  tx("adapter:shop", "2027-03-04T15:00Z", "observed", 'Shop: "order 1187, Field Kit, Cohort 7"', bought("ben", "fieldkit-c7")),
  copy("teo", "2027-04-12T16:50Z", 'Mara: "Each lesson page, and one email per lesson saying it\'s open."', fiveDay),
  tx("teo", "2027-04-12T17:00Z", "assumed", 'Mara: "Put the five days on the site. A lesson unlocks each day and an email says so."', plan(undefined, fiveDay)),
  tx("adapter:site", "2027-04-20T16:00Z", "asked", 'Profile form: "phone (optional)" and "text me about courses" answered', [
    add("person/ana", "person/phone", "+1 555 0101"),
    add("person/ben", "person/phone", "+1 555 0102"),
    add("person/ben", "person/sms-consent", true),
    add("person/dee", "person/phone", "+1 555 0104"),
  ]),
  tx("adapter:site", "2027-04-21T16:00Z", "asked", 'Profile form: "how should we reach you first?" answered', [add("person/ben", "person/channel", kw("email"))]),
  tx("agent:desk", "2027-10-21T16:30Z", "inferred", 'Mara: "Dee opens every email. Guess she prefers email."', [add("person/dee", "person/channel", kw("email"))], "channel-from-opens"),
  // D35: an agent's move runs at once. agent:drafter adds the bf-02 role variants from the survey, by rule,
  // and moves everyone, so it raised few-values. D36: its own waiver is pending; agent:judge confirms it.
  everyone(tx("agent:drafter", "2027-10-22T15:00Z", "inferred", "survey-roles: 6 roles answered; podcasters and writers get their own bf-02, everyone else the plain one", plan(bfD0, bfD), "survey-roles"), "bf-2027"),
  tx("agent:drafter", "2027-10-22T16:00Z", "inferred", "survey-roles: 6 roles, but only podcaster and writer vary; the other 4 get bf-02", plan(bfD, bfE), "survey-roles"),
  tx("agent:judge", "2027-10-25T17:00Z", "inferred", "survey-roles: 6 roles, but only podcaster and writer vary; the other 4 get bf-02", [add("bf-2027", "path/waives", "few-values")], "survey-roles"),
  tx("adapter:sms", "2027-04-22T18:00Z", "observed", 'SMS provider: "+1 555 0104 replied START"', [add("person/dee", "person/sms-consent", true)]),
  copy("teo", "2027-03-20T16:50Z", 'Teo: "One short note. Nothing to sell."', spring),
  tx("teo", "2027-03-20T17:00Z", "assumed", 'Teo: "One note in April so the list hears from us between launches."', plan(undefined, spring)),
  copy("mara", "2027-06-02T17:50Z", 'Mara: "The pitch opens a welcome page, and the last call can be a text if they said yes to texts."', bridge),
  tx("mara", "2027-06-02T18:00Z", "assumed", 'Mara: "When someone finishes the five days, give them two days of bridge, then three days of pitch."', plan(undefined, bridge)),
  // D36: Mara raised teach-before-fix on the bridge, so Teo waives it, in his own words.
  tx("teo", "2027-06-09T16:30Z", "assumed", 'Teo: "The five days are the warmup. Nobody needs three more teach emails after a course."', plan(bridge, bridgeW)),
  copy("teo", "2027-06-10T16:50Z", 'Mara: "One question, by email."', why),
  tx("teo", "2027-06-10T17:00Z", "assumed", 'Mara: "Ask the people who finished the bridge without buying why. One question."', plan(undefined, why)),
  copy("mara", "2027-09-14T17:50Z", 'Mara: "Black Friday copy, with a version for podcasters and one for writers."', bf),
  tx("mara", "2027-09-14T18:00Z", "assumed", 'Mara: "Black Friday runs Friday to Monday. The whole library, one pricing version."', plan(undefined, bf0)),
  everyone(tx("agent:desk", "2027-09-20T20:00Z", "assumed", 'Mara: "If someone is in the middle of the Small Tools bridge, let that finish first."', plan(bf0, bfB0)), "bf-2027"),
  everyone(tx("teo", "2027-10-05T17:00Z", "assumed", 'Teo: "Saturday sends do badly for us. Sunday instead."', plan(bfB0, bfC0)), "bf-2027"),
  // D37: Mara looked at Black Friday on 1 October, before the agents' waivers. Her feed starts here.
  tx("mara", "2027-10-01T09:00Z", "assumed", "marked seen", [add("mara", "seen/path", "bf-2027@")]),
  // D36: an agent waives an alarm a person raised, and it counts at once. Mara wrote the fix send.
  tx("agent:judge", "2027-10-05T17:30Z", "inferred", "warm-list: everyone on bf-2027 is on fernhill-news and opened mail from us in the last 90 days", plan(bfC0, bfD0), "warm-list"),
  tx(
    "adapter:survey",
    "2027-10-20T16:00Z",
    "asked",
    'Answers to "What do you make?", imported as one transaction.',
    [...ROLES.map((r) => add("dim/role", "dim/values", kw(r))), ...ASKED.map(([p, r]) => add(`person/${p}`, "person/role", kw(r)))],
  ),
  tx(
    "agent:desk",
    "2027-10-21T16:00Z",
    "inferred",
    'Mara: "Guess a role from the signup page for people who skipped the survey."',
    INFERRED.map(([p, r]) => add(`person/${p}`, "person/role", kw(r))),
    "role-from-signup-page",
  ),
  tx("adapter:site", "2027-05-16T15:00Z", "observed", SIGNUP, signup("gus")),
  tx("adapter:site", "2027-11-13T16:00Z", "observed", SIGNUP, signup("ana")),
  tx("teo", "2027-11-17T21:00Z", "assumed", 'Teo: "The email provider is down. Hold the bridge until it\'s back."', plan(bridgeW, bridgeHeld)),
  tx("teo", "2027-11-21T09:00Z", "assumed", 'Teo: "Provider is back and confirmed. Drop the hold."', plan(bridgeHeld, bridgeW)),
  // Content is read at delivery (D33): Teo fixes p1's email mid-run. Ana, Ben and Cy already got the broken
  // link; Ivy and Dee get the fix. Each delivery records the content version it read.
  tx("teo", "2027-11-23T15:00Z", "assumed", 'Teo: "The workspace link in the p1 email 404s. Point it at the fixed body."', [
    { e: "message/p1/email", a: "rendition/body", v: "p1.email", added: false },
    { e: "message/p1/email", a: "rendition/body", v: "p1-link-fixed.email", added: true },
  ]),
  // Commit for new entrants: four days of pitch for whoever enters next. Ana, Ben and Cy stay on three
  // days, and people-on-old-version alarms until Mara moves them a day later, in her own words (D32).
  tx("mara", "2027-11-21T10:00Z", "assumed", 'Mara: "People who finish want the next tool, not a discount. Give them four days of pitch."', plan(bridgeW, bridgeC)),
  { ...tx("mara", "2027-11-22T10:00Z", "assumed", 'Mara: "Move the people already in the bridge onto four days too. Ana is halfway through her pitch, and three days felt rushed."', []), moves: [{ path: "small-tools-bridge" }] },
  tx("adapter:site", "2027-11-16T15:00Z", "observed", SIGNUP, signup("ben", "cy")),
  tx("adapter:shop", "2027-11-23T12:00Z", "observed", 'Shop: "order 2210, Small Tools, Shipped"', bought("cy", "small-tools")),
  tx("adapter:site", "2027-11-20T14:00Z", "observed", SIGNUP, signup("dee", "eli")),
  // Acts and buys that the targets measure. Asked: a person told us. Observed: we saw it. Inferred: a guess, which never counts.
  tx("adapter:shop", "2027-03-10T14:00Z", "observed", 'Shop: "order 1203, Field Kit, Cohort 7"', bought("hal", "fieldkit-c7")),
  tx("adapter:class", "2027-03-29T18:00Z", "observed", 'Class log: "ben ran the week-1 field exercise"', act("ben", "used-the-kit")),
  tx("adapter:mail", "2027-04-08T15:00Z", "asked", 'Reply to the spring note: "shipped my first tool this week"', act("hal", "shipped-tool")),
  tx("agent:desk", "2027-04-10T16:00Z", "inferred", 'Mara: "Guess who shipped from site activity."', act("fay", "shipped-tool"), "shipped-from-site-activity"),
  copy("mara", "2027-10-01T16:50Z", 'Mara: "Three short support notes. The first opens the workspace page."', start),
  tx("mara", "2027-10-01T17:00Z", "assumed", 'Mara: "Buyers get help getting their first tool running, not more selling."', plan(undefined, start)),
  tx("adapter:mail", "2027-11-17T21:00Z", "asked", 'Day 5 reply: "here is my tool"', act("ana", "shipped-tool")),
  tx("adapter:mail", "2027-11-20T18:00Z", "asked", 'Day 5 reply: "shipped, link inside"', act("cy", "shipped-tool")),
  // Ivy signs up on the site without joining the newsletter, so only the course and what follows it reach her.
  tx("adapter:site", "2027-11-18T15:00Z", "observed", SIGNUP, [add("person/ivy", "person/name", "Ivy Park"), add("person/ivy", "person/email", "ivy@example.com"), ...signup("ivy")]),
  tx("adapter:shop", "2027-11-25T10:00Z", "observed", 'Shop: "order 2231, Small Tools, Shipped"', bought("ivy", "small-tools")),
  tx("adapter:shop", "2027-11-27T15:00Z", "observed", 'Shop: "order 2236, The Fernhill library"', bought("fay", "library")),
  tx("adapter:shop", "2027-11-29T20:00Z", "observed", 'Shop: "order 2251, The Fernhill library"', bought("hal", "library")),
  tx("adapter:mail", "2027-12-01T17:00Z", "asked", 'Reply: "late, but I shipped it"', act("eli", "shipped-tool")),
  tx("adapter:shop", "2027-12-05T12:00Z", "observed", 'Shop: "order 2290, Small Tools, Shipped"', bought("gus", "small-tools")),
  tx("adapter:site", "2027-12-06T19:00Z", "observed", 'Site: "Small Tools workspace: first tool run"', act("cy", "tool-in-use")),
  tx("adapter:site", "2027-12-09T17:00Z", "observed", 'Site: "Small Tools workspace: first tool run"', act("gus", "tool-in-use")),
  tx("adapter:mail", "2027-12-10T16:00Z", "asked", 'Reply to "One question": "no budget yet, but I shipped a tool"', act("ben", "shipped-tool")),
  tx("adapter:site", "2027-12-15T18:00Z", "observed", 'Site: "course completed: Writing for the web"', act("fay", "finished-a-library-course")),
];

// Late enough that every target window in the seed has closed.
export const HORIZON = "2028-02-01T00:00Z";
export const PATHS = ["fieldkit-c7", "bf-2027", "five-day-tools", "small-tools-bridge", "small-tools-start", "spring-note", "why-didnt-you-buy"] as const;
export const CAMPAIGNS = PATHS;
let cached: Db | undefined;
export const seedDb = (): Db => (cached ??= interpret(AUTHORED, HORIZON));

// D38: after Black Friday's last call, agent:drafter tries to push close back two days. It never lands:
// the people the last call told have a locked deadline. The attempt is built against the seed as of `at`.
export const LATE_SURGE_AT = "2027-11-30T03:00Z";
export const closeShift = (db: Db, x: { readonly hours: number; readonly at?: string; readonly who?: string; readonly why?: string; readonly rule?: string; readonly move?: boolean }): TxInput => {
  const at = x.at ?? LATE_SURGE_AT;
  const t = db.log.filter((tx) => (dateMs(tx.at) ?? 0) <= (dateMs(at) ?? 0)).at(-1)?.t ?? 0;
  const p = fromFacts("bf-2027", facts(asOf(db, t)));
  if (!p?.offer?.closes) throw new Error("bf-2027 has no close");
  const moved: Path = { ...p, offer: { ...p.offer, closes: msDate((dateMs(p.offer.closes) ?? 0) + x.hours * H) } };
  const who = x.who ?? "agent:drafter";
  const agent = who.startsWith("agent:");
  return {
    who,
    at,
    source: agent ? "inferred" : "assumed",
    ...(agent ? { rule: x.rule ?? "late-surge" } : {}),
    why: x.why ?? "late-surge: opens doubled in the last 6 hours, so give them two more days",
    ops: diff(toFacts(p), toFacts(moved)),
    ...(x.move === false ? {} : { moves: [{ path: "bf-2027" }] }),
  };
};
