// VIEW
// The workspace: the as-of slider, the feed, the tabs and their panels, and the checks beside them.
// Printouts, the history list, the arc and the outcome numbers come from the same escaped generators
// the static pages use, so each has one source; everything a reader acts on is a builder element.
import type { Html, HtmlBuilder } from "foldkit/html";
import { Button, Input, Select, Textarea } from "@foldkit/ui";
import { SOURCES, asOf, facts, type Db } from "../db.ts";
import { pendingText, quotes, type Finding, type Verdict } from "../checks.ts";
import { BIB_BY_KEY } from "../bib.ts";
import { highlight } from "../hl.ts";
import { JOBS, fromFacts, type Path } from "../model.ts";
import { duration } from "../printer.ts";
import { deliveriesOf } from "../delivery.ts";
import { SKILL_OF_CHECK } from "../skillmap.ts";
import { nameOf, outcomesOn, placesOn, sendCounts, targetOf } from "../time.ts";
import { parseVersion } from "../version.ts";
import { arcStrip, deliveryCopy, feedData, fileHtml, gotAnchor, NEEDS_WORDS, outcomesHtml, SELF_WAIVE, stackTables, txLine, valText, versionsHtml, type FeedRow } from "../views.ts";
import { touchesPath } from "../time.ts";
import type { Tx } from "../db.ts";
import { draftOf, draftText, isOnPath, viewOf } from "./derive.ts";
import { Message } from "./message.ts";
import { TABS, WHO, type Model, type Tab } from "./model.ts";
import { UNDER_PEOPLE } from "./update.ts";

type H = HtmlBuilder<Message>;

const raw = (h: H, cls: string, html: string): Html => h.div([h.Class(cls), h.InnerHTML(html)]);
const td = (h: H, label: string, children: ReadonlyArray<Html | string>, cls = ""): Html => h.td([h.DataAttribute("label", label), ...(cls ? [h.Class(cls)] : [])], children);
const mute = (h: H, text: string, small = false): Html => h.span([h.Class(small ? "mute small" : "mute")], [text]);

const button = (h: H, label: string, onClick: Message, x: { readonly cls?: string; readonly title?: string; readonly disabled?: boolean } = {}): Html =>
  Button.view(
    {
      onClick,
      ...(x.disabled === undefined ? {} : { isDisabled: x.disabled }),
      toView: (attributes) => h.button([...attributes.button, ...(x.cls ? [h.Class(x.cls)] : []), ...(x.title ? [h.Title(x.title)] : [])], [label]),
    },
    h,
  );

// CHECKS

const cites = (h: H, f: Finding): ReadonlyArray<Html> => [
  ...(f.cites ?? []).flatMap((k) => {
    const e = BIB_BY_KEY.get(k);
    return e ? [h.a([h.Class("cite-inline"), h.Href(`/bibliography/#${k}`)], [`source: ${e.short}`])] : [];
  }),
  ...(SKILL_OF_CHECK.has(f.check) ? [h.a([h.Class("cite-inline"), h.Href(`/skills/${SKILL_OF_CHECK.get(f.check)}/`)], [`why: ${SKILL_OF_CHECK.get(f.check) ?? ""}`])] : []),
];

export const verdictView = (h: H, v: Verdict | undefined): Html =>
  v === undefined
    ? h.p([h.Class("verdict none")], ["No path here yet."])
    : !v.ok
      ? h.p([h.Class("verdict bad")], [h.b([], ["Refused."]), ` ${v.refusals} ${v.refusals === 1 ? "problem" : "problems"} to fix before this ships.`])
      : h.p([h.Class("verdict good")], [h.b([], ["Ships."]), ` ${v.alarms === 0 ? "No live alarms." : `${v.alarms} live ${v.alarms === 1 ? "alarm" : "alarms"}, which the author can ship past.`}`]);

// confirm: the editor offers Mara's confirmation for a pending waiver, enabled once the why holds a quote.
const findingView = (h: H, f: Finding, confirm: "off" | "ready" | "waiting"): Html => {
  const w = f.waived;
  const counts = w !== undefined && w !== "staged" && w.counts;
  const pending = w !== undefined && w !== "staged" && w.pending !== undefined && w.pending !== "";
  const waived =
    w === undefined ? [] : w === "staged" ? [" ", h.i([], ["waiver staged"])] : w.counts ? [" ", h.i([], [`waived by ${w.who} at t=${w.t}`])] : w.pending ? [" ", h.i([], [pendingText(w)])] : [" ", h.i([], ["waiver has no quote, so it doesn't count"])];
  const self = f.raisedBy?.includes("mara") ?? false;
  const act =
    confirm !== "off" && pending
      ? [
          h.br([]),
          h.span([h.Class("pending")], ["pending, someone else must confirm"]),
          " ",
          button(h, "Confirm as Mara", Message.ClickedConfirmWaiver({ check: f.check }), {
            disabled: self || confirm === "waiting",
            title: self ? SELF_WAIVE : confirm === "ready" ? "Writes your why, as Mara" : NEEDS_WORDS,
          }),
        ]
      : [];
  return h.li(
    [h.Class(`finding ${f.severity}${counts ? " waived" : pending ? " pending" : ""}`), h.DataAttribute("line", String(f.line))],
    [
      h.span([h.Class("sev")], [f.severity]),
      " ",
      h.b([], [f.check]),
      " ",
      mute(h, `${f.version === undefined ? "" : `version ${f.version}, `}line ${f.line}`),
      ...waived,
      ...act,
      h.br([]),
      f.message,
      ...(f.hint ? [h.br([]), mute(h, f.hint)] : []),
      ...cites(h, f).flatMap((c) => [" ", c]),
    ],
  );
};
export const findingsView = (h: H, v: Verdict | undefined, confirm: "off" | "ready" | "waiting" = "off"): Html =>
  v === undefined ? h.empty : v.findings.length === 0 ? h.p([h.Class("mute")], ["Every check comes back empty."]) : h.ul([h.Class("findings")], v.findings.map((f) => findingView(h, f, confirm)));

// WHERE PEOPLE ARE

export const placesView = (h: H, db: Db, id: string): Html => {
  const name = nameOf(db);
  const places = placesOn(db, id);
  const p = fromFacts(id, facts(db));
  const o = outcomesOn(db, id);
  const ds = deliveriesOf(facts(db));
  // The channel a person last got, from :delivery/via (D33). Why that channel stays in the tx why.
  const lastSend = (person: string): ReadonlyArray<Html> => {
    const tx = [...db.log].reverse().find((x) => x.datoms.some((d) => d.e === person && d.a === "send/sent" && String(d.v).startsWith(`${id}/`)));
    const send = String(tx?.datoms.find((d) => d.e === person && d.a === "send/sent")?.v ?? "");
    const via = ds.filter((d) => d.person === person && d.send === send).map((d) => d.via);
    if (via.length === 0) {
      return [];
    }
    const reason = /deliver succeeded via [^(]*(\(.*\))$/.exec(tx?.why ?? "")?.[1];
    return [h.br([]), mute(h, `${send.slice(id.length + 1)} via ${via.join(" and ")}${reason ? ` ${reason}` : ""}`, true)];
  };
  const versionOf = new Map(facts(db).flatMap((f) => (f.a === "path/version" && parseVersion(String(f.v))?.path === id ? [[String(f.e), parseVersion(String(f.v))?.v] as const] : [])));
  const rows: Array<Html> = places.map((x) =>
    h.keyed("tr")(x.person, [], [
      td(h, "person", [button(h, name(x.person), Message.ClickedPerson({ person: x.person }), { cls: "linklike", title: `Open what ${name(x.person)} got` })]),
      td(h, "where", [x.where, ...lastSend(x.person)]),
      td(h, "version", [String(versionOf.get(x.person) ?? "")], "num"),
      td(h, "target", [targetOf(o, x.person)], `tg tg-${targetOf(o, x.person)}`),
    ]),
  );
  // Fresh evidence: people who already matched before the path went live stay out.
  if (p?.entersOn && p.since === undefined) {
    const live = db.log.find((tx) => tx.datoms.some((d) => d.e === id && d.a === "path/title" && d.added));
    if (live) {
      const entered = new Set(places.map((x) => x.person));
      const arg = p.entersOn.arg ?? "";
      for (const f of facts(asOf(db, live.t - 1))) {
        const done = (f.a === "person/finished" && f.v === `course/${arg}`) || (f.a === "path/finished" && f.v === arg);
        if (p.entersOn.name === "finished?" && done && !entered.has(String(f.e))) {
          rows.push(h.keyed("tr")(`out-${String(f.e)}`, [h.Class("out")], [td(h, "person", [name(String(f.e))]), h.td([h.Colspan(3), h.DataAttribute("label", "where")], [`stayed out: finished before this path went live at t=${live.t}`])]));
        }
      }
    }
  }
  if (rows.length === 0) {
    return h.p([h.Class("mute")], ["Nobody has entered yet."]);
  }
  return h.table([h.Class("places stack")], [h.thead([], [h.tr([], ["person", "where", "version", "target"].map((c) => h.th([], [c])))]), h.tbody([], rows)]);
};

// SINCE YOU LAST LOOKED (D37)

const feedRow = (h: H, r: FeedRow): Html =>
  h.keyed("tr")(r.t, [], [
    td(h, "t", [`t=${r.t}`], "num"),
    td(h, "who", [r.who]),
    td(h, "what changed", [r.what, ...(r.turned.length ? [h.br([]), mute(h, `alarm ${r.turned.join(", ")}`, true)] : [])]),
    td(h, "rule or why", [r.ruleOrWhy]),
    td(h, "marks", r.marks.flatMap((m) => [h.span([h.Class(`feed-mark${m.startsWith("pending") ? " pending" : m.includes("agent waived") ? " agent" : ""}`)], [m]), " "])),
  ]);
export const feedView = (h: H, db: Db, id: string): Html => {
  const f = feedData(db, id);
  const name = (f.who[0]?.toUpperCase() ?? "") + f.who.slice(1);
  const seen = button(h, "Mark seen", Message.ClickedMarkSeen(), { title: "Writes your cursor here. Nothing is approved or rejected." });
  const head =
    f.cursor === undefined
      ? h.p([], [h.b([], ["Since you last looked"]), " ", mute(h, `as ${name}`), ". You haven't looked at this path yet, so this lists everything agents did. ", seen])
      : h.p([], [h.b([], ["Since you last looked"]), " ", mute(h, `(t=${f.cursor}), as ${name}`), " ", seen]);
  if (f.rows.length === 0) {
    return h.div([h.Class("ws-feed")], [head, h.p([h.Class("mute")], [`Nothing from agents since t=${f.cursor ?? 0}.`])]);
  }
  return h.div(
    [h.Class("ws-feed")],
    [
      head,
      h.table([h.Class("feed stack")], [h.thead([], [h.tr([], ["t", "who", "what changed", "rule or why", ""].map((c) => h.th([], [c])))]), h.tbody([], f.rows.map((r) => feedRow(h, r)))]),
      h.p(
        [h.Class("mute small")],
        [`${f.net.length ? `Alarms since t=${f.cursor ?? 0}: ${f.net.join(", ")}.` : `No alarm is on now that wasn't at t=${f.cursor ?? 0}, or the other way round.`} A report: nothing here waits for you.`],
      ),
    ],
  );
};

// WHAT THEY GOT (D33)

export const gotView = (h: H, db: Db, id: string, open: ReadonlyArray<string>): Html => {
  const name = nameOf(db);
  const ds = deliveriesOf(facts(db)).filter((d) => d.send.startsWith(`${id}/`));
  if (ds.length === 0) {
    return h.p([h.Class("mute")], [`Nothing has gone out on ${id} yet. Drag the slider to the right.`]);
  }
  const sentAt = new Map<string, number>();
  for (const tx of db.log) {
    for (const d of tx.datoms) {
      if (d.a === "delivery/key" && d.added) {
        sentAt.set(String(d.e), tx.t);
      }
    }
  }
  const people = [...new Set(ds.map((d) => d.person))];
  return h.div(
    [h.Class("got-list")],
    people.map((p) => {
      const mine = ds.filter((d) => d.person === p).sort((a, b) => (sentAt.get(a.id) ?? 0) - (sentAt.get(b.id) ?? 0));
      return h.keyed("details")(p, [h.Class("got"), h.Id(gotAnchor(id, p)), h.Open(open.includes(p)), h.OnToggle((isOpen) => Message.ToggledDelivery({ person: p, isOpen }))], [
        h.summary([], [`${name(p)}: ${mine.length} ${mine.length === 1 ? "delivery" : "deliveries"}`]),
        h.div(
          [h.Class("got-rows")],
          mine.map((d) =>
            h.keyed("div")(d.id, [h.Class(`got-row st-${d.status}`)], [
              h.p([h.Class("got-head")], [h.b([], [d.send.slice(id.length + 1)]), ` ${d.message} via ${d.via}, ${d.status}`, mute(h, ` · t=${sentAt.get(d.id) ?? ""} · content ${d.content}`, true)]),
              h.pre([h.Class("code lisp"), h.InnerHTML(`<code>${highlight(deliveryCopy(db, d.message, d.via, d.content))}</code>`)]),
            ]),
          ),
        ),
      ]);
    }),
  );
};

// HISTORY

const datomLine = (d: { e: unknown; a: string; v: unknown; added: boolean }) => `${d.added ? "+" : "\u2212"} [${String(d.e)} :${d.a} ${valText(d.a, d.v)}]`;
const historyItem = (h: H, tx: Tx, t: number, here: number): Html => {
  const ds = tx.datoms.filter((d) => !d.a.startsWith("tx/") && d.a !== "log/cursor");
  return h.keyed("li")(tx.t, [h.Class(`${tx.t === here ? "here" : tx.t > t ? "later" : ""}${tx.who === "agent:halter" ? " event" : ""}`), h.DataAttribute("t", String(tx.t))], [
    h.span([h.InnerHTML(txLine(tx))]),
    h.details([], [
      h.summary([], [`${ds.length} ${ds.length === 1 ? "datom" : "datoms"}`]),
      ...ds.slice(0, 6).flatMap((d, i) => [...(i ? [h.br([])] : []), h.code([], [datomLine(d)])]),
      ...(ds.length > 6 ? [h.br([]), mute(h, `and ${ds.length - 6} more`)] : []),
    ]),
  ]);
};
// "here" is the path's latest transaction at or before the slider, so History always has a place to stand.
export const historyView = (h: H, db: Db, id: string, t: number): Html => {
  const rows = db.log.filter((tx) => touchesPath(tx, id));
  const here = rows.filter((tx) => tx.t <= t).at(-1)?.t ?? -1;
  return h.ol([h.Class("hist")], rows.map((tx) => historyItem(h, tx, t, here)));
};

// THE EDITOR

const cardsView = (h: H, p: Path | undefined): Html =>
  p === undefined
    ? h.empty
    : h.div(
        [h.Class("cards")],
        p.states.map((st) =>
          h.keyed("div")(st.name, [h.Class("card")], [
            h.b([], [`state ${st.name}`]),
            ...st.sends.map((s) =>
              h.keyed("div")(s.key, [h.Class("sendcard")], [
                h.code([], [s.key]),
                Select.view(
                  {
                    id: `card-${s.key}-job`,
                    value: s.job ?? "",
                    onChange: (value) => Message.ChangedCard({ key: s.key, field: "job", value }),
                    toView: (a) => h.select([...a.select, h.AriaLabel(`job of ${s.key}`)], JOBS.map((j) => h.option([h.Value(j), h.Selected(j === s.job)], [j]))),
                  },
                  h,
                ),
                Input.view(
                  {
                    id: `card-${s.key}-timing`,
                    value: s.on ?? duration(s.after ?? 0),
                    toView: (a) => h.input([...a.input, h.Size(18), h.AriaLabel(`timing of ${s.key}`), h.OnChange((value) => Message.ChangedCard({ key: s.key, field: "timing", value }))]),
                  },
                  h,
                ),
              ]),
            ),
          ]),
        ),
      );

const stagedView = (h: H, ops: ReadonlyArray<{ e: unknown; a: string; v: unknown; added: boolean }>): Html =>
  ops.length === 0
    ? h.p([h.Class("mute")], ["Nothing staged. The draft prints the same facts as the head."])
    : h.details([h.Open(true)], [
        h.summary([], [`${ops.length} ${ops.length === 1 ? "fact" : "facts"} staged`]),
        ...ops.slice(0, 14).flatMap((o, i) => [...(i ? [h.br([])] : []), h.code([], [datomLine(o)])]),
        ...(ops.length > 14 ? [h.br([]), mute(h, `and ${ops.length - 14} more`)] : []),
      ]);

const selectView = (h: H, id: string, label: string, value: string, options: ReadonlyArray<string>, onChange: (value: string) => Message): Html =>
  Select.view(
    {
      id,
      value,
      onChange,
      toView: (a) => h.label([...a.label], [`${label} `, h.select([...a.select], options.map((o) => h.option([h.Value(o), h.Selected(o === value)], [o])))]),
    },
    h,
  );

const editView = (model: Model, h: H): Html => {
  const d = draftOf(model);
  const ready = quotes(model.why);
  const onPath = isOnPath(model);
  const gated = { disabled: !ready, ...(ready ? {} : { title: UNDER_PEOPLE }) };
  const commits = onPath
    ? [button(h, "Commit for new entrants", Message.ClickedCommit({ kind: "new" }), gated), " ", button(h, "Commit and move everyone", Message.ClickedCommit({ kind: "move" }), { cls: "primary", ...gated })]
    : [button(h, "Commit", Message.ClickedCommit({ kind: "plain" }), { cls: "primary" })];
  return h.div([h.Class("panel edit")], [
    h.p([h.Class("mute")], [
      `You're editing the Lisp as of t=${model.t}. Each change is read back into facts and checked as you type. The cards are views over the Lisp; change one and the Lisp is reprinted. Committing forks the log here: seed transactions after this point are set aside, and the interpreter runs on from your edit.`,
    ]),
    Textarea.view(
      {
        id: `lisp-${model.pathId}`,
        value: draftText(model),
        rows: 22,
        onInput: (text) => Message.UpdatedDraft({ text }),
        toView: (a) => h.textarea([...a.textarea, h.Class("lisp-edit"), h.Spellcheck(false), h.AriaLabel(`halter Lisp for ${model.pathId}`)]),
      },
      h,
    ),
    h.div([h.Class("edit-cards")], [cardsView(h, d.path)]),
    h.div([h.Class("edit-live")], [
      d.error ? h.p([h.Class("verdict bad")], [h.b([], ["Unreadable."]), ` ${d.error}`]) : verdictView(h, d.verdict),
      findingsView(h, d.verdict, ready ? "ready" : "waiting"),
      stagedView(h, d.ops),
    ]),
    h.div([h.Class("commit")], [
      selectView(h, `who-${model.pathId}`, "who", model.who, WHO, (value) => Message.SelectedWho({ who: WHO.find((w) => w === value) ?? "mara" })),
      selectView(h, `source-${model.pathId}`, "how we know", model.source, SOURCES, (value) => Message.SelectedSource({ source: SOURCES.find((s) => s === value) ?? "assumed" })),
      Input.view(
        {
          id: `why-${model.pathId}`,
          value: model.why,
          placeholder: 'Mara: "quote the words that justify it"',
          onInput: (value) => Message.UpdatedWhy({ value }),
          toView: (a) => h.label([...a.label, h.Class("why")], ["why ", h.input([...a.input])]),
        },
        h,
      ),
    ]),
    h.p([h.Class("buttons")], [
      ...commits,
      " ",
      button(h, "Undo last edit", Message.ClickedUndo()),
      " ",
      button(h, "Break it", Message.ClickedBreak()),
      " ",
      button(h, "Reset draft", Message.ClickedReset()),
    ]),
    noticeView(h, model.notice),
    onPath
      ? h.p([h.Class("mute small")], [
          "People are on this path. ",
          h.b([], ["Commit for new entrants"]),
          " makes a new version, and the people already here keep theirs until a move. ",
          h.b([], ["Commit and move everyone"]),
          " writes the edit and ",
          h.code([], [`(move ${JSON.stringify(model.pathId)})`]),
          " in one transaction.",
        ])
      : h.empty,
  ]);
};

// What the last action did. It sits by the editor's buttons, or under the tabs when the editor isn't showing.
const noticeView = (h: H, notice: string): Html => h.p([h.Class("edit-msg"), h.Role("status")], [notice]);

// THE WORKSPACE

const tabButton = (model: Model, h: H, tab: Tab): Html =>
  Button.view({ onClick: Message.SelectedTab({ tab }), toView: (a) => h.button([...a.button, h.AriaPressed(String(model.tab === tab))], [tab]) }, h);
const fileButton = (model: Model, h: H, file: "structure" | "content", label: string): Html =>
  Button.view({ onClick: Message.SelectedFile({ file }), toView: (a) => h.button([...a.button, h.AriaPressed(String(model.tab === "Printout" && model.file === file))], [label]) }, h);

const panel = (model: Model, h: H): Html => {
  const v = viewOf(model);
  const id = model.pathId;
  if (model.tab === "Edit") {
    return editView(model, h);
  }
  if (model.tab === "History") {
    return h.div([h.Class("panel history")], [historyView(h, model.db, id, model.t)]);
  }
  if (model.tab === "Got") {
    return h.div([h.Class("panel got-panel")], [h.p([h.Class("mute small")], ["Each person's deliveries as of the slider, each printed as of its content version."]), gotView(h, v.db, id, model.openPeople)]);
  }
  if (model.tab === "Versions") {
    return h.div([h.Class("panel versions-panel")], [h.p([h.Class("mute small")], ["Every version as of the slider, the transaction that made it, and who runs it."]), raw(h, "versions-live", stackTables(versionsHtml(v.db, id)))]);
  }
  return raw(h, "panel print", fileHtml(v, model.file));
};

export const view = (model: Model, h: H): Html => {
  const v = viewOf(model);
  const id = model.pathId;
  const tx = v.db.log.at(-1);
  return h.div([h.Class("ws-live"), h.DataAttribute("workspace", id)], [
    h.div([h.Class("asof")], [
      Input.view(
        {
          id: `asof-${id}`,
          type: "range",
          value: String(model.t),
          onInput: (value) => Message.MovedSlider({ t: Number(value) }),
          toView: (a) =>
            h.div([], [
              h.label([...a.label], ["as of ", h.b([h.Class("t")], [`t=${model.t}`]), " ", h.span([h.Class("mute at")], [tx?.at ?? ""])]),
              h.input([...a.input, h.Class("slider"), h.Min("1"), h.Max(String(model.db.log.length)), h.Step("1")]),
            ]),
        },
        h,
      ),
      h.p([h.Class("txline"), h.InnerHTML(tx ? txLine(tx) : "")]),
    ]),
    raw(h, "ws-outcomes", outcomesHtml(v.db, id)),
    feedView(h, v.db, id),
    h.div([h.Class("ws-grid")], [
      h.div([h.Class("ws-main")], [
        h.div([h.Class("tabs"), h.Role("group"), h.AriaLabel("Workspace views")], [
          ...TABS.map((tab) => tabButton(model, h, tab)),
          h.span([h.Class("filetoggle"), h.Role("group"), h.AriaLabel("Which file the printout shows")], [fileButton(model, h, "structure", "Structure"), fileButton(model, h, "content", "Content")]),
        ]),
        model.tab === "Edit" || model.notice === "" ? h.empty : noticeView(h, model.notice),
        panel(model, h),
      ]),
      h.div([h.Class("ws-side")], [
        h.h4([], ["Checks"]),
        verdictView(h, v.verdict),
        findingsView(h, v.verdict),
        h.h4([], ["Where people are"]),
        placesView(h, v.db, id),
        h.h4([], ["Arc"]),
        v.path ? raw(h, "arc-wrap", arcStrip(v.path, sendCounts(v.db, id), false, 340)) : h.empty,
      ]),
    ]),
  ]);
};

