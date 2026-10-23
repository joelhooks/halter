# The halter language, version 0.2

Status: a proposal. Joel ruled on D9 to D13; everything else here is McBride's call and open for the grill. The canonical definition: the builder renders it, and the model conforms to it.

Bibliography keys look like `[dunn-bridge]`. Every principle and every doctrine check cites one, and the bibliography holds the attribution.

## Principles

These are the ideas halter is built on. Each is a short line that names an idea. The footnote credits where the idea comes from, and the skill page that carries it explains it in our words (see Skills, below). The indented line says what it does to halter.

- **Design the path, not the product. Our offer is never the whole path.** [hulick]
  halter reads a value path as a state machine. That reading is ours, not Hulick's wording. So the only campaign form is the path, a machine each person walks. Paths hand off to each other.
- **Every sequence has a job. Every email within it earns the right to send the next one.** [dunn-bridge]
  Every send names its `:job` from a closed list, and the checks read the arc.
- **Build slow, give to get, create events.** [hoy-lcc]
  There are alarms for a pitch before warm-up, and for sends that pile up.
- **Pain-Dream-Fix mirrors how people move from awareness to purchase.** [hoy-30x500]
  Jobs fall into pain, dream and fix bands, and the arc strip shows them.
- **The deadline is real: the cohort actually starts, the price actually changes.** Once anyone has been told a deadline, it doesn't move (D38). [hoy-lcc] [dunn-launch]
  An urgency send must point at an event that changes the offer. Otherwise it's refused.
- **Observation beats asking. Behavioural segmentation can be wrong.** [hoy-safari] [dunn-rm]
  Every transaction says how we know. Inferred values never drive hard claims.
- **Always have a default.** [dunn-survey]
  Every `vary` has an `else`, and unknown is a real value.
- **If they buy, pull them out of the pitch sequence immediately.** [dunn-bridge]
  A pitch path needs a buyer exit. Otherwise it's refused.
- **Proof is not decoration. Every objection maps to one of four fix types.** [stb]
  Claims, proof and objections are facts, and the checks match them.
- **Plan post-launch work before you launch.** [stb]
  There's an alarm when no post-close survey is planned.
- **The Process is a Lie.** [hooks-process]
  Doctrine numbers alarm and never block. Anyone, person or agent, can waive one on the record, except whoever raised it (D36).
- **Configuration shown as green while the journey is broken is a failure.** [bc-gates]
  Nothing goes live until a synthetic run leaves a receipt.
- **Kit doesn't have events, so flag tags simulate them.** [kit] [hooks-kit]
  halter has typed events and no workarounds. Provider mechanics stay in adapters.
- **A trigger is a predicate, not a job.** [pu]
  Every trigger is "when this fact is true". No trigger does work.
- **True must prove fresh, positive evidence.** [pu]
  A trigger built only from `not`, or from acts that happened before the path, is refused or needs an explicit window. Fresh means when the act happened, not when it was written (D39).

## What halter is

- **halter is a library:** an Effect v4 layer, plus Alchemy where a campaign needs infrastructure. An app uses it through an adapter, and email providers sit behind adapters too.
- **halter is campaigns as pure data.**
  - XState v6 runs the data: one machine for each person on each path.
  - Effect v4 does every piece of work, each as a declared actor.
  - Alchemy 2 comes in only where a campaign's intent needs infrastructure.
- **The facts are the data.** Each fact is `[entity attribute value tx]`, and transactions carry who, when, why and how we know.
- **The Lisp is the UI.** A halter file is `print(asOf(db, t))`. Reading it back gives the same facts, and an edit becomes a transaction.
- **Predicates are data, work is code.**
  - Guards are pure expressions over facts, written in the Lisp.
  - Anything that does work is a registered word that the Lisp can only name.
  - A new word is reviewed code, never new data.
- **Paths notify; they never call.** A path never names what comes after it. Everything that happens to a person becomes a fact in the log: they entered, moved, were sent, finished, passed or exited. Any path can react to any of it. The transaction log is the event stream.
- **Skills give agents the principles; halter holds the structure.** An agent building a campaign loads a skill to learn what good looks like, then writes halter forms. The skill says why. halter holds the structure and checks it. Each doctrine check is a skill's principle made checkable, and its message links to the skill's page, so an agent that trips one can read why and fix the structure.
- **halter reads no clock.** Time enters as facts: the tx time of the fact a person entered on, plus calendar instants in offers. The runtime supplies "now" through Effect's `Clock`, and the page supplies it through the as-of slider.

## Lexical rules

| Thing | Looks like | Notes |
|---|---|---|
| comment | `; to end of line` | The reader ignores it. The printer writes comments only from facts, such as a waiver's why. A comment you type is lost on save, so put it in the why. |
| list | `( … )` | A form, a clause or a group. |
| string | `"fieldkit-c7"` | Ids, titles, messages, instants. |
| keyword | `:job` | Keys only, always followed by a value. |
| symbol | `teach`, `pitch`, `podcaster` | Names from a closed list, or names declared in this file (states, dimension values). |
| integer | `150` | Non-negative. No floats. |
| duration | `30m`, `48h` | Minutes or hours only. Hours, not days, so two sends in a day stay expressible. [dunn-bridge] |
| instant | `"2027-03-02T17:00Z"` | ISO 8601, UTC, to the minute. |
| variable | `?send` | Queries and checks only. |

## Top-level forms

halter keeps structure and content apart (see Structure and content), so it prints them as two files.
- **The structure file** holds any number of these, in this order: `dimension`, `hold`, `path`, `check`, `query`. A top-level `(hold :until INSTANT)` holds every path.
- **The content file** holds `message` forms only. A copy edit never shows up as a structure diff.

### `(path ID body…)`

The only campaign form. A campaign with one node is still a path (D13).

```lisp
(path ID
  :title STRING
  :list STRING
  (offer …)?
  (enters-on PRED [:since INSTANT])
  (hold :until INSTANT)*
  (state NAME …)+
  (exit-on PRED)?
  (target PRED :within DURATION)
  (guard (when PRED ACTION)+)?
  (pace (rate N)
    (ramp :to N :step N :every DURATION)?)
  (waive CHECK-ID)*)
```

- **`:title` / `:list`:** a human title, and the list the path draws from.
- **`(enters-on PRED [:since INSTANT])`:** a person enters the first state on the transaction that makes `PRED` true for them. By default only acts that happened after the path went live count, judged by their `:act/at` (D39). `:since` lets older acts in, back to that instant (see Triggers and Acts). This is the only way in. A path never names its successor; it only notifies (see Events). The next path subscribes with its own `enters-on`, e.g. `(enters-on (finished? "small-tools-bridge"))`. There is no `next`.
- **`(state NAME send… to*)`:** states run in the order they're written.
  - A state with no `to` ends after its last send goes out.
  - Reaching the end of the last state puts the person in `done`. If at least one of their deliveries on the path was `sent`, the interpreter writes `:path/finished` and `finished?` becomes true for them.
  - **Nothing out means passed, not finished** (D34). When every send was skipped or missed, reaching `done` writes `:path/passed` instead. A successor on `finished?` never sees them.
- **`(exit-on PRED)`:** whenever `PRED` becomes true, the person leaves for `exited` (not `done`) and gets nothing more.
- **`(target PRED :within DURATION)`:** required. This is the real result the path exists for: the person's result, not ours (D28). It measures and notifies. It never gates a send or a transition.
  - It's a trigger, so the trigger rules apply. Fresh here means acts whose `:act/at` is after this person entered this path.
  - It's watched from entry until `:within` runs out, even after `done` or `exited`. A buyer who leaves the pitch can still reach the target, and that's the point.
  - The first time it's true inside the window, halter writes `:path/reached-target`. When the window ends without it, halter writes `:path/missed-target`. Each is written once per person per path.
  - Finishing a path and reaching its target are different numbers. Every path page shows entered, finished, passed and reached side by side. Finished but missed is the honest failure.
- **`(guard (when PRED ACTION)…)`:** checked before every send, top to bottom. The first match wins, and no match means send.
- **`(hold :until INSTANT)`:** stops delivery on this path until the instant. Triggers and transitions keep running (see Triggers).
- **`(pace …)`:** sends per minute, with an optional ramp.
- **`(waive CHECK-ID)`:** turns one alarm off for this path. A waiver is a fact, and its transaction's why says why the alarm is fine here. Refusals can't be waived.
  - **`no-self-waiver`:** nobody waives their own alarm (D36). This applies to people and agents alike. A waiver is pending when its `:who` wrote any fact that a current finding's `:at` points at. The waiver fact lands, the alarm stays on, and the finding says `waiver pending: agent:drafter raised this alarm, someone else must confirm`.
  - **Re-judged on every run.** Checks run on every transaction, so a waiver that counted goes pending again if its author later writes one of the offending facts. A waiver can't clear its author's future work.
  - **Alarms nobody wrote.** When the offending facts come from the world or the interpreter (`uncertain-sends`, `people-on-old-version`), anyone can waive them.
  - **Confirming:** someone else confirms by writing a transaction that asserts the same waiver, with their own why. The waiver's author is whoever wrote the last assert, so history shows both the proposal and the confirmation.
  - **Printing:** the printer marks a pending waiver with a comment read from the facts: `(waive rest-days) ; pending: agent:drafter raised it`.
  - **Example.** One writer, many reviewers, with no person in the loop:

```lisp
(tx 121 :who "agent:drafter"
    :source inferred :rule "close-window"
    :why "all 3 sends land in the last 48h"
  ;; pending: agent:drafter raised it
  (waive rest-days))

(tx 122 :who "agent:judge"
    :source inferred :rule "close-window"
    :why "all 3 sends land in the last 48h"
  (waive rest-days))   ; counts
```

### `(offer PRODUCT :pricing STRING window? early-bird? class? bonus*)`

- **`(window :opens INSTANT :closes INSTANT)`:** a calendar window, for a cohort or a sale.
- **`(window :state NAME)`:** a per-person window. The offer is open while the person is in that state, and leaving the state closes it. This is how an evergreen deadline stays real.
- **`(early-bird :until INSTANT)`:** the pricing version flips at that instant.
- **`(class :starts INSTANT)`:** the cohort actually starts.
- **`(bonus PRODUCT :until EVENT)`:** something extra that comes with buying (D41).
  - A bonus is a product, so owning it is a `bought` act (D39).
  - `:until` names one of the offer's events, such as `close` or `early-bird`. A bonus deadline is a real deadline, `deadline-kept` covers it, and there's no new kind of instant.

Each of these is an **event**: an instant at which something changes. A `:deadline` can only name one of them: `close`, `early-bird` or `class`.

- **A told deadline is locked** (D38). A person has been told a deadline once they have a `sent` delivery of a send whose `:deadline` names it. For that person, the deadline's instant can't change in either direction. Closing early breaks the promise as surely as extending it does.
  - **On a calendar window,** the change would come from an edit to `:closes`, `:until` or `:starts` that applies to them, so through "Commit and move everyone".
  - **On a per-person window,** the change would come from a move that re-times the state the window follows.
  - **`deadline-kept` refuses the transaction,** whoever wrote it, person or agent.
- **The honest route is a new offer.** A new window and its own announcement are a new promise, not a broken one. That covers the outage case: when checkout was down on the last day, the extra day is a new offer that says so. Never move a deadline silently.

### `(send MESSAGE-ID timing :job JOB :via VIA [:deadline EVENT] [:asks DIM] [:answers (DIM VALUE)] [:bonus PRODUCT] [(vary …)])`

A send delivers one message to one person through one or more channels. "Send" doesn't mean email.

- **Timing:** exactly one of these.
  - `:after DURATION` counts from entering the state.
  - `:on INSTANT` is a calendar instant. Whoever is in the state at that instant gets it.
- **`:job`:** one of `teach pain dream fix announce-pitch proof faq urgency last-call survey support`. The list is closed (D29). Agents can't invent jobs, because the arc checks read them, and a synonym like `educate` would slip past every check. A new job is a reviewed language change, the same rule as a new registry word.
  - Bands for the arc strip: pain is `teach pain`; dream is `dream announce-pitch`; fix is `fix proof faq urgency last-call`; after is `survey support`.
  - `support` helps someone who already bought get to the path's target.
  - An unknown job is refused with the full list and the nearest job, taken from a fixed synonym table in the check pack, e.g. `nudge` → `support`, `educate` → `teach`.
- **`:via`:** required, and channels come from a closed list: `email`, `sms`, `site`.
  - `:via email` uses one channel.
  - `:via (or sms email)` uses one channel the person can receive. The path sets which channels are allowed, and the person picks among them (D24):
    - A stated preference wins. It must be an `asked` fact on the built-in dimension `channel`, whose values are `email`, `sms` and `site`, e.g. `(answered? channel email)`.
    - With no stated preference, the written order applies.
    - A preference never adds a channel the path didn't list, and an inferred preference never reorders anything. [rk] [dunn-rm]
  - `:via (and site email)` uses every channel listed, e.g. a lesson unlocks on the site and an email says it's ready.
  - `or` and `and` take two or more channels. If no channel fits, the send is `:send/skipped` with the reason `no-channel`.
- **`:deadline EVENT`:** required on `urgency` and `last-call` sends.
- **`:asks DIM`:** the send asks the person for their value on `DIM` (D43). It's required on `survey` sends and allowed on any other, e.g. a teach email whose links read "I write" and "I podcast" asks `role`.
  - **An answer records the delivery it answered** with `:act/delivery` (see Acts). Since each delivery records its content (D33), answers to an old wording of the question can be told apart from answers to a new one.
  - **An answer to an `:asks` send is `asked`,** whether it came as a reply, a form or a click on an answer link. A click with no `:asks` behind it is `observed`, and a value worked out from it is `inferred`.
- **`:answers (DIM VALUE)`:** the send answers that objection (D42). `VALUE` must be one of the dimension's `:objections`. A send can answer more than one, e.g. `:answers ((why-not no-time) (why-not too-expensive))`.
- **`:bonus PRODUCT`:** the send offers that bonus (D41). The offer must declare it (`bonus-declared`).
  - Every variant of the send carries the bonus, so someone who already owns it skips the whole send (`bonus-to-owner`, D40).
  - Keep the bonus in a send of its own, so an owner only misses that one:

```lisp
(offer "fieldkit" :pricing "bf-2027"
  (window :opens "2027-11-26T08:00Z"
    :closes "2027-11-29T08:00Z")
  (bonus "tool-templates" :until close))

(send "bf-03" :on "2027-11-27T15:00Z"
  :job urgency
  :via email
  :deadline close
  :bonus "tool-templates")
;; Eli has a bought act for tool-templates,
;; so bonus-to-owner is true for him on
;; bf-03. He skips it with the reason
;; "refused: bonus-to-owner". Every other
;; send still reaches him.
```
- **`(vary DIM [:hard] (VALUE MESSAGE-ID)… (else MESSAGE-ID))`:** picks a message by the person's value for `DIM`.
  - `:hard` means the copy states the value as who they are ("as a podcaster…").
  - `else` is required.

### `(to STATE :after DURATION | :when PRED)`

- **`:after`:** move after time in the state.
- **`:when`:** move as soon as a world fact makes `PRED` true, e.g. `(to writers :when (answered? role writer))`.
- **Targets:** a declared state, or `closed`, which ends the path for that person.

### `(dimension NAME (VALUE…) [:many] [:objections (VALUE…)])`

The values are stable internal slugs. Display labels live in the content, never in facts. [dunn-survey]

A dimension is single-valued unless marked `:many`. Every person also has the value `unknown` for every dimension until a fact says otherwise.

- **`:objections (VALUE…)`:** says which of the dimension's values are objections (D42). An objection is an answer, and the author decides which answers count as one:

```lisp
(dimension why-not
  (no-time too-expensive not-for-me
   didnt-see-it bought-elsewhere)
  :many
  :objections (no-time too-expensive))
```

  - **Not every answer is an objection.** `didnt-see-it` needs a channel or timing fix, not another email. `bought-elsewhere` is just a fact. `not-for-me` is a fit signal, and "fixing" it means pushing the wrong people.
  - **Marking is a judgment made on the record.** Marking `not-for-me` says you want to talk those people round.
  - **The language knows nothing about any particular question.** "Why didn't you buy?" is the copy of a `survey` send, `why-not` is a dimension its author declared, and replies are `answered` acts (D39).

## Structure and content

A path is **structure**: states, timing, triggers, guards and pace. A message is **content**: what a person receives. They're separate entities, and they run on separate clocks.

- **Structure is fixed at entry.** A person runs the path's structure as of the transaction that entered them. That structure is their **version**: the id of the last transaction that changed the path's structure before they entered. An edit makes a new version for people who enter afterwards, and replaying anyone's history gives the exact definition they ran. [pu]
- **Holds are the exception.** A `(hold …)` reaches everyone on the path at once, whatever their version, because stopping delivery can't do harm that can't be undone.
- **Content is read at delivery.** A send names a message id, and the message is read as of the moment it goes out. A typo fix reaches everyone who hasn't had that message yet. Each delivery records the content version it read, so the log still says exactly what each person got (see Deliveries).
- **Moving people is explicit.** A `move` is a transaction op, and it's the only way to change structure under people who are already on a path. An agent's move runs at once, just like a person's (D35). The why says what the move acted on: a person's own words in quotes, or `:source inferred` with `:rule NAME`.

```lisp
(tx 15 :who "mara" :at "2027-02-01T18:25Z"
    :source assumed
    :why "Mara: \"move everyone, the 72h pitch felt rushed\""
  (move "small-tools-bridge"
    :to-version 14))
```

  - **`:to-version TX`:** moves people to the structure as of `TX`. Leave it out to move them to the current version.
  - **`:from-version TX`:** moves only the people on that version. Leave it out to move everyone on the path.
  - **`:from STATE :to STATE`:** moves people between states, with or without a new version.
  - **`:map ((OLD NEW)…)`:** places people whose state the new version renamed or removed. A move that would leave anyone without a state is refused.
- **What a move changes:**
  - A moved person keeps their state and the instant they entered it, and their timing is worked out again from that instant under the new version.
  - Sends they've had stay had. Sends are matched by key, so nobody gets one twice.
  - A send the new version makes overdue becomes `:send/missed` and never goes out late. An `:after` that has already passed moves them at once.
  - Each moved person gets a new `:path/version`, so history keeps every version they ran.
- **Editing under people.** When people are on a path, the editor commits an edit in one of two ways:
  - **Commit for new entrants**
  - **Commit and move everyone**, which writes the edit and the move in one transaction
  - Until the people on an old version are moved, `people-on-old-version` alarms. A calendar path enters everyone at go-live, so most edits to one after go-live want the second button.
- **Checks run on every version someone is still on.** A finding names its version. The interpreter keeps a version until the last person on it leaves.
- **A commit answers only for what it adds** (D40). A commit is refused by refusal findings that weren't there before it. Findings already there show and still count for their own version, but they don't refuse it. A fix for new entrants isn't refused because people on an old version hit a refusal at run.
- **Content isn't email.** A message has one rendition per channel:

```lisp
(message "p1"
  (email :subject "Small Tools is open"
    :body "p1.email")
  (sms :body "p1.sms")
  (site :page "small-tools/welcome"))
```

  - `email`: a subject and a body.
  - `sms`: a short body.
  - `site`: a page or a lesson the person can now open, recorded as an access fact.
  - Bodies are content refs, never inline text.
- **Who can receive what.** email needs an address. site needs an account. sms needs a number and an `asked` or `observed` consent fact. Missing consent is a hard stop, because a text can't be unsent.

## Predicates

All predicates are pure, read facts only, and end in `?`.

| Predicate | True when |
|---|---|
| `(and P…)` `(or P…)` `(not P)` | the usual |
| `(on-list? LIST)` | the person is on the list |
| `(tag? STRING)` | the person has the tag |
| `(domain? STRING)` | their email is at that domain |
| `(finished? ID)` | a `finished` act for that course exists, or that path wrote `:path/finished` for them |
| `(passed? ID)` | that path wrote `:path/passed` for them: they reached `done` and nothing went out |
| `(exited? PATH)` | that path wrote `:path/exited` for them |
| `(reached? PATH STATE)` | they have ever entered that state of that path |
| `(bought? PRODUCT)` | a `bought` act for that product exists |
| `(did? ACT)` | a `did` act exists with `:act/source observed` or `asked`. An inferred act doesn't count. |
| `(reached-target? PATH)` | that path wrote `:path/reached-target` for them |
| `(missed-target? PATH)` | that path wrote `:path/missed-target` for them |
| `(answered? DIM VALUE)` | their value for `DIM` is `VALUE`. In a trigger, freshness comes from the `answered` act that set it. |
| `(known? DIM)` | their value for `DIM` isn't `unknown` |
| `(in? PATH [STATE])` | they're currently in that path, or in that state of it |
| `(due? PATH DURATION)` | a send from that path is due to them within the duration |

## Actions in `guard`

- `(skip STRING)`: drop this send for this person, with a reason.
- `(defer DURATION)`: try this send again later.

No match means send.

## Transactions

The history of a halter file is a list of transactions. The page prints them, and the editor makes them.

```lisp
(tx 14 :who "mara" :at "2027-02-01T18:20Z"
    :source assumed
    :why "Mara: \"people who finish want the next tool, not a discount\""
  (retract "small-tools-bridge/state/pitch"
    :state/after 72h)
  (assert  "small-tools-bridge/state/pitch"
    :state/after 96h))
```

- **`:who`:** a person, or `agent:NAME`. People and agents can do the same things. The two limits bind both: nobody waives their own alarm (`no-self-waiver`), and nobody crosses a refusal.
- **`:at`:** an instant.
- **`:why`:** required. A waiver or a move needs one of two kinds of why. It either holds the author's own words in quotes, or it's `:source inferred` with `:rule NAME`, naming the evidence. Nothing ever writes words for a person that the person didn't type.
- **`:source`:** how we know, and required. [hoy-safari] [dunn-rm]
  - `asked`: they told us, in a survey or a reply.
  - `observed`: they did it: bought, finished, clicked.
  - `inferred`: a rule worked it out, and `:rule NAME` is required.
  - `assumed`: someone believes it and nobody has checked it.
- **Ops:** `assert`, `retract` and `move` (see Structure and content). Tx 14 makes version 14 of the bridge. It changes nothing for the people already on version 9 until a `move` like tx 15 says so.
- **Changes:** an undo is a new transaction that retracts and asserts. History is never rewritten.

## Since you last looked

Agents act and waive on their own (D35, D36), so a person needs a way to see what happened without reading the whole log. Each path page has a feed of what agents did since that person last looked (D37).

```
[mara :seen/path "small-tools-bridge@118"]

since you last looked (t=118)
small-tools-bridge
  t=120  agent:drafter
         move to version 115
         rule pitch-too-short
  t=121  agent:drafter
         waive rest-days
         pending: raised it
  t=122  agent:judge
         waive rest-days
         counts
         agent waived an agent's alarm
```

- **A transaction is an entity too.** Its `:tx/who`, `:tx/why`, `:tx/source` and `:tx/rule` are facts, and queries can read them like any others. The feed is a query over them.
- **The cursor is a fact.** `[PERSON :seen/path PATH@TX]` has one value per person per path. Marking the feed seen writes a new one, so the log also shows when each person last looked.
- **The feed lists every agent transaction after the cursor that touched the path.** That covers structure, content, moves, holds and waivers. Each row has its why or its `:rule`. Alarms that turned on or off in the same span are listed too.
- **Agent-on-agent waivers are marked.** No person saw them before they counted, so they're the rows worth a glance.
- **Nothing waits on the feed.** It's a report, not an approval queue. An agent's action counts the moment it's written, whether or not anyone has looked.

## Events

halter is event driven all the way down. An event is a transaction, and the log is the stream.

- **World events** come from outside: a purchase, a finished course, a survey answer, a click. They land as transactions with `:source observed` or `asked`, and each one is an act (see Acts).
- **Path events** are transactions the interpreter writes itself, with `:who "agent:halter"` and `:source observed`:

| Fact | Written when |
|---|---|
| `[p :path/entered PATH]` | the person enters the path |
| `[p :path/at PATH/STATE]` | the person enters a state. One value at a time; history keeps the trail. |
| `[p :path/version PATH@TX]` | the person enters a path, or a move changes their version. One value per path. |
| `[p :send/sent MESSAGE]` | the first delivery of the send is confirmed |
| `[d :delivery/…]` | `deliver` hands a message to one channel. See Deliveries. |
| `[p :send/skipped MESSAGE]` | a guard skips the send; the tx why holds the reason |
| `[p :path/finished PATH]` | the person reaches `done`, and at least one of their deliveries on the path was `sent` |
| `[p :path/passed PATH]` | the person reaches `done`, and no delivery on the path was `sent` |
| `[p :path/exited PATH]` | `exit-on` fires |
| `[p :path/reached-target PATH]` | `target` turns true inside its window |
| `[p :path/missed-target PATH]` | `target`'s window ends while it's false |
| `[p :send/missed MESSAGE]` | the send came due during a hold or an outage, and its state has already ended |
| `[halter :log/cursor TX]` | the interpreter has handled every transaction up to `TX` |
| `[PERSON :seen/path PATH@TX]` | a person marks a path's feed seen (see Since you last looked) |

- **Reacting.** After each transaction, the interpreter re-checks `enters-on` for every path the person isn't in, and `to :when` and `exit-on` for every path they're in. A path reacts to a change, so `enters-on` fires once, on the transaction that makes it true.
- **Timers are events too.** `:after` and `:on` fire from Effect's `Clock`, and firing writes the path event that results.
- **The event set is known beforehand.** There's no `notify` form. A reached state is the named event: a successor that needs to know a person was pitched reads `(reached? "small-tools-bridge" pitch)`. Anything else is a query over facts.
- **Buyers don't fall through.** `exit-on` writes `exited`, not `finished`, so a successor on `(finished? "small-tools-bridge")` only ever sees people who didn't buy.
- **Nothing doesn't count as finishing.** Someone whose every send was skipped writes `passed`, not `finished`. A successor on `finished?` never asks them about a pitch they never got.

## Acts

Each world act is its own entity, the same as a delivery (D39). It records when it happened, which can differ from when it was written:

```lisp
[a7 :act/person ben]
[a7 :act/kind   finished]
[a7 :act/of     "five-day-tools"]
[a7 :act/at     "2026-09-02T14:00Z"]
[a7 :act/source observed]
```

- **`:act/kind`:** one of `bought`, `finished`, `did`, `answered`.
  - `:act/of` names the product, the course or the act.
  - An `answered` act also has `:act/value`, and the person's value for that dimension follows the latest one.
  - An `answered` act that replies to a send also has `:act/delivery`, the delivery it answered (D43). Its source is `asked`.

```lisp
[a31 :act/person   ana]
[a31 :act/kind     answered]
[a31 :act/of       why-not]
[a31 :act/value    no-time]
[a31 :act/source   asked]
[a31 :act/delivery d204]
```
- **`:act/at`:** when it happened. Freshness reads this, never the transaction.
- **`:act/source`:** how we know, taken from the transaction that first wrote it. A correction doesn't change it.
- **A correction touches the same entity.** Teo's cleanup retracts and re-asserts `a7` at tx 140. `:act/at` still says 2026, so the bridge doesn't pitch Ben.
- **A real repeat is a new act.** After a refund, a re-buy is a new entity, `a9`, with its own `:act/at`, so it's fresh.
- **Something recorded late stays old.** An act that happened just before go-live but was written just after doesn't count, and that's the right side to err on.
- **Path events aren't acts.** The interpreter writes `:path/finished` and the rest once, at the moment they happen, so their transaction time is their time.

## Deliveries

Each delivery is its own entity. When `deliver` hands a message to a channel, halter writes one, in the same transaction as the path event:

```lisp
[d41 :delivery/person ana]
[d41 :delivery/send "small-tools-bridge/p1"]
[d41 :delivery/message "p1"]
[d41 :delivery/content 18]
[d41 :delivery/via email]
[d41 :delivery/status sent]
```

- **`:delivery/send`:** the send in the structure, as `PATH/KEY`.
- **`:delivery/message`:** the message that went out. After a `vary` it's the variant the person got, such as `bf-02-writer`.
- **`:delivery/content`:** the content version, meaning the id of the last transaction that changed this channel's rendition of the message before it went out. A fix to the email body leaves the site rendition's version alone. Printing a delivery reads the message as of this tx, so it shows exactly the copy the person got.
- **`:delivery/via`:** one channel.
  - `(and site email)` makes two deliveries.
  - `(or sms email)` makes one, for the channel that was picked. The tx why says why that channel.
- **`:delivery/status`:**
  - `sent` when the provider confirmed it
  - `uncertain` when it never did
- **One delivery per person, send and channel.** After someone checks the provider, the result updates the same delivery's status. Nothing can make a second delivery for the same send and channel.
- **No delivery means nothing went out.** Skipped and missed sends stay `:send/skipped` and `:send/missed` on the person.
- **`:send/sent` stays the path event.** Successors and checks read it, and the deliveries are the receipts behind it.

Questions about what went out become queries:

```lisp
(query "got-broken-link"
  :doc "who got p1's email before the fix"
  :find (?p)
  :where ((?d :delivery/message "p1")
          (?d :delivery/via email)
          (?d :delivery/content ?t)
          (< ?t 22)
          (?d :delivery/person ?p)))

(query "got-texts"
  :doc "who got a text, and which message"
  :find (?p ?m)
  :where ((?d :delivery/via sms)
          (?d :delivery/person ?p)
          (?d :delivery/message ?m)))
```

## Triggers

A trigger is a predicate over facts: "when this fact is true". `enters-on`, `to :when` and `exit-on` use the same machinery, and only where they lead differs. These rules come from our watch design in pi-until [pu] and the Rat King delivery judge [rk].

- **One gate.** A trigger is true or false, and nothing else. It never does work. [pu]
- **Positive evidence.** A trigger needs at least one clause that asserts a fact. `(not (bought? "small-tools"))` alone is true for everyone before anything happens, so it's refused (`trigger-has-evidence`). [pu]
- **Fresh evidence.** `enters-on` fires only on acts whose `:act/at` is after the path went live, unless `:since` says otherwise. Without this, launching the bridge would pitch everyone who ever finished the course, on day one. A correction, an import or a backfill writes new transactions but keeps the act's `:act/at`, so it can't make an old act fresh. [pu]
- **Once per person per path.** Entry is keyed on the person and the path, never on a timestamp. A second matching fact doesn't put them back in. [pu]
- **The cursor is a fact.** The interpreter records the last transaction it has handled. After a restart it resumes from there and replays nothing. The log is the authority, so a crash loses nothing.
- **No waiting forever.** A state whose only way out is `:when` must also have an `:after`. Otherwise someone can wait in it for good (`wait-has-timeout`).
- **A hold stops delivery, not thinking.** During a hold, triggers and transitions keep running, and only `deliver` waits. [pu]
- **No pile-ups.** When a hold ends or the runtime comes back, overdue sends don't burst out. A person gets at most one send per pace tick. A send whose state has already ended is written as `:send/missed`, not sent late. [pu]
- **Unknown isn't failed.** A delivery the provider never confirms has `:delivery/status uncertain`. halter never retries it blind, because a second email can't be unsent. [pu]
- **One decision, in a fixed order.** Before every send, one pure function decides:
  1. hard stops: unsubscribed, exited, no channel in `:via` the person can receive (sms needs consent), or a refusal that's true for this person and this send (D40). A synthetic person on a live send is one such refusal.
  2. holds
  3. path guards, where the first match wins
  4. pace
  5. deliver

  Each outcome carries a tagged reason, not a display string. [rk]
- **A refusal at run fails closed on the harm, and open on everything else** (D40). Some refusals read the world, not just structure: `hard-from-inferred`, `bonus-to-owner` and `synthetic-live`. A new entrant or a new act can make one true mid-run with no commit behind it. Then halter stops only that send, for only the people the refusal names:
  - **Safe variant first.** If the send has a `vary` and its `else` doesn't trip the same refusal for that person, they get the `else`. It's a normal send with a normal delivery.
  - **Otherwise it skips.** `:send/skipped`, with the refusal in the why.
  - **Everyone else gets the send as written,** and the path keeps running.
  - **It alarms.** `refused-at-run` shows on the path page and in the "since you last looked" feed, so someone can fix the cause.

```lisp
;; bf-02's writer variant states the
;; reader's role as a fact ("As a writer,
;; you…"). Ivy enters at t=150. Her role
;; was inferred from a click, never asked,
;; so she gets the else:
[d88 :delivery/person  ivy]
[d88 :delivery/message "bf-02-plain"]
[ivy :send/sent "bf-02"]
;; with no safe else, it skips instead:
[ivy :send/skipped "bf-02"]
;; why: "refused: hard-from-inferred,
;;       Ivy's role is inferred"
```
- **Time-bounded values are computed.** A window is open because of its opens, its closes and now. Nothing is ever stored as "expired". [rk]
- **Dry run.** `halter test PATH PERSON :as-of TX` replays one person's history through the decision and prints each verdict and reason. It changes nothing. [rk]

## Queries and checks

Both use halter's Datalog. Clauses are lists, variables start with `?`, and all clauses must hold.

```lisp
(query "overlap" :doc STRING
  :find (?p ?who)
  :where (CLAUSE…))

(check "fake-deadline" :severity refuse
  :cites (hoy-lcc dunn-launch)
  :say "send {?k} is an urgency send with no real deadline. Point :deadline at close, early-bird or class."
  :at (?s :send/job)
  :where (CLAUSE…))
```

- **Clauses:**
  - `(?e :attr ?v)`, or `(?e :attr ?v ?tx ?added)` to read history
  - `(not CLAUSE…)`, `(or CLAUSE…)`, `(and CLAUSE…)`
  - comparisons `= != < <= > >=`, `(in? ?x a b c)`, `(between? ?x ?lo ?hi)`, `(within? ?x ?y DURATION)`, `(+ ?a ?b ?sum)`
- **A check passes when its query comes back empty.** Each row it returns is one problem. `:say` fills `{?var}` from the row, and `:at` points the editor at the offending fact.
- **`:severity`:**
  - `refuse`: the campaign is ill-formed, or would cause harm that can't be undone. It can't be waived. At commit, it refuses the transaction. When world facts make it true mid-run, it stops only that send for only those people (see Triggers).
  - `alarm`: everything else. The author can ship past it, and a `waive` turns it off.
- **`:cites`:** bibliography keys. Required on doctrine checks, and absent on shape checks.

## The check pack

### Shape (refuse, no cite)

These make a path well-formed:
- `to-declared-state`
- `send-inside-state`: an `:after` that's longer than the state lasts would never go out
- `offsets-increase`
- `sends-in-order`
- `last-call-before-close`
- `class-after-close`
- `early-bird-inside-doors`
- `no-send-after-close` (except a survey)
- `deadline-names-event`
- `job-on-every-send`: every send names a job from the closed list
- `support-to-buyers`: a `support` send sits in a path whose `enters-on` reads `bought?`
- `else-on-every-vary` [dunn-survey]
- `value-declared`: a `vary`, an `answered?`, an `:objections` list or an `:answers` must name a declared value. An `:answers` must also name one of its dimension's objections.
- `trigger-has-evidence`: every trigger has at least one positive clause
- `wait-has-timeout`: a state left only by `:when` also has an `:after`
- `path-has-target`: every path has exactly one `target`, with a `:within`
- `message-exists`: every message id a send or a `vary` names is declared in the content file
- `via-has-rendition`: every channel in a send's `:via` has a rendition in each message it can pick
- `bonus-declared`: every `:bonus` on a send names a `(bonus …)` its path's offer declares
- `asks-declared`: every `:asks` names a declared dimension, and every `survey` send has an `:asks`

### Doctrine (refuse, harm)

| Check | Says | Cites |
|---|---|---|
| `fake-deadline` | send {k} is an urgency send, but its deadline changes nothing. Point it at close, early-bird or class. | [hoy-lcc] [dunn-launch] |
| `pitch-to-buyer` | path {p} pitches {product} but has no exit-on for its buyers. Add `(exit-on (bought? …))`. | [dunn-bridge] |
| `hard-from-inferred` | send {k} states :{dim} as who they are, but {n} people's values are inferred. Ask, or drop :hard. | [dunn-rm] |
| `bonus-to-owner` | send {k} offers {bonus}, which {n} people already own. They skip it at run (D40). Keep the bonus in its own send. | [dunn-bridge] |
| `synthetic-live` | synthetic person {p} is in a live send. Synthetic people only run in simulations. | [bc-gates] |
| `deadline-kept` | {n} people were told {event} is {told}. It can't move to {now}. Make a new offer and announce it. | [hoy-lcc] [dunn-launch] |

### Doctrine (alarm)

| Check | Says | Cites |
|---|---|---|
| `teach-before-fix` | fewer than 3 teach sends before the first fix in {p}. | [hoy-lcc] [barry-launch] |
| `bridge-announces-pitch` | the state before the pitch in {p} has no announce-pitch send. | [dunn-bridge] |
| `rest-days` | 3 sends on consecutive days in {p} outside the close. | [dunn-launch] |
| `few-values` | dimension {d} has {n} values. Four or five is plenty. | [dunn-survey] |
| `post-close-survey` | nothing in {p} or after it asks non-buyers why. A `survey` send after close counts when its `:asks` dimension marks `:objections` (D43). | [dunn-launch] |
| `objection-has-fix` | objection {d} {o} has no fix, or is only answered in a faq send. Answer it in a fix or proof send. | [stb] |
| `target-is-our-object` | the target of {p} only reads `bought?`. That's our result, not theirs. Name what buying gets them, e.g. `(and (bought? …) (did? …))`. | [hulick] |
| `uncertain-sends` | {n} sends in {p} were never confirmed. Check the provider before anything retries. | [pu] |
| `refused-at-run` | {n} people in {p} hit {check} mid-run. Their {k} fell back to its else, or was skipped. Fix the cause. | [bc-gates] |
| `people-on-old-version` | {n} people run version {v} of {p}, and the current version is {cur}. Move them, or waive this to leave them there on purpose. | [bc-gates] |

## How the data runs (XState v6, Effect v4)

A small fixed interpreter builds one machine per path. The registry holds every word that does work, and nothing outside it can.

| halter | XState v6 / Effect v4 |
|---|---|
| `path` | `setupEffect({ actors, schemas }).createMachine(…)`, one actor per person on the path |
| `state` | a state node. `done` and `exited` are final, and `closed` routes to `done`. Entering `done` writes `finished` or `passed`, depending on the person's `sent` deliveries |
| `send` | invokes one registered `deliver` actor per channel (`deliver/email`, `deliver/sms`, `deliver/site`), each an Effect `createEffectLogic`, with the chosen message id. Each actor writes one delivery, and its result sets the delivery's status. |
| `:after` | a delayed transition. Timers run on Effect's `Clock`, which is `TestClock` in a simulation |
| `:on` | a delayed transition armed for that instant |
| the log | each transaction becomes a `fact` event, sent to the actors of the people it touches |
| `enters-on` | a subscription on the log that spawns the person's actor when `P` turns true |
| `target` | a parallel region beside the path's walk, `measuring → reached \| missed`, with `after: within` → `missed`. The actor stops when both the walk and the target region are final |
| `(to … :when P)`, `exit-on` | transitions on `fact` events, guarded by `P` |
| path events | transactions the interpreter writes on entry, on each state entry, and on final states |
| `guard`, `hold`, `pace` | the one pure decision, evaluated before `deliver` |
| the cursor | the interpreter's position in the log, written as a fact after each transaction it handles |
| `pace` | the registered `pace` actor |
| predicates | pure guard functions built from the predicate data |

**Registry today:** `deliver/email`, `deliver/sms`, `deliver/site` and `pace`. Email and sms providers sit behind adapters. The `site` channel is the first place a campaign's intent needs infrastructure: granting access to a lesson needs a route and a store, which are Alchemy resources.

**Before live:** a synthetic run of the same data on `TestClock` with fake people must reach its expected sends and leave a receipt as a fact. [bc-gates]

## Printing

- **One canonical form per meaning.** Fixed form order, fixed key order and two-space indent. No shorthand, and no optional spellings.
- **The laws:** `read(print(facts)) = facts`, and `print(read(text)) = text` for canonical text. Property tests hold both.

## Examples

### A one-node path: a broadcast

```lisp
(path "spring-note"
  :title "Spring note"
  :list "fernhill-news"
  (enters-on (on-list? "fernhill-news"))
  (state note
    (send "spring-note"
      :on "2027-04-01T16:00Z"
      :job teach
      :via email))
  (target (did? "shipped-tool")
    :within 720h)
  (pace (rate 200)))
```

### A course on a site: lessons unlock, and email says so

```lisp
(path "five-day-tools"
  :title "Five days of small tools"
  :list "fernhill-news"
  (enters-on (tag? "signup:five-day-tools"))
  (state course
    (send "day-1" :after 0h
      :job teach
      :via (and site email))
    (send "day-2" :after 24h
      :job pain
      :via (and site email))
    (send "day-3" :after 48h
      :job teach
      :via (and site email))
    (send "day-4" :after 72h
      :job dream
      :via (and site email))
    (send "day-5" :after 96h
      :job teach
      :via (and site email))
    (to closed :after 100h))
  (target (did? "shipped-tool")
    :within 504h)
  (pace (rate 150)))
```

Finishing the course is just this path writing `:path/finished`. The bridge subscribes to that. The target is the point of the course: the person ships a small tool. Reading five emails isn't the result. Day 5 asks them to reply with a link, and the reply lands as `[p :did "shipped-tool"]` with `:source asked`.

### The bridge: a path keyed off a finished course

The bridge doesn't say what comes next. It only notifies.

```lisp
(path "small-tools-bridge"
  :title "Small Tools: bridge and pitch"
  :list "fernhill-news"
  (offer "small-tools"
    :pricing "bridge-2027"
    (window :state pitch))
  (enters-on (finished? "five-day-tools"))
  (state bridge
    (send "b1" :after 2h
      :job announce-pitch
      :via email)
    (to pitch :after 48h))
  (state pitch
    (send "p1" :after 0h
      :job fix
      :via (and site email))
    (send "p2" :after 24h
      :job proof
      :via email)
    (send "p3" :after 90h
      :job last-call
      :via (or sms email)
      :deadline close)
    (to closed :after 96h))
  (exit-on (bought? "small-tools"))
  (target (and (bought? "small-tools")
               (did? "tool-in-use"))
    :within 1440h)
  (guard
    (when (tag? "bought:library")
      (skip "owns the library")))
  (pace (rate 150)))
```

### The successor: subscribes to the bridge

```lisp
(path "why-didnt-you-buy"
  :title "Why didn't you buy?"
  :list "fernhill-news"
  (enters-on
    (finished? "small-tools-bridge"))
  (state ask
    (send "w1" :after 24h
      :job survey
      :via email
      :asks why-not))
  (target (did? "shipped-tool")
    :within 720h)
  (pace (rate 150)))
```

The survey isn't the target. The answers are ours to learn from. A non-buyer's result is still a shipped tool, so the successor is measured on that.

### Buyers: support toward the target

The bridge's buyers leave on `exit-on`, and this path picks them up. Its sends are `support`, and its target is the bridge's target.

```lisp
(path "small-tools-start"
  :title "Small Tools: get your first tool in use"
  :list "fernhill-news"
  (enters-on (bought? "small-tools"))
  (state start
    (send "s1" :after 1h
      :job support
      :via (and site email))
    (send "s2" :after 72h
      :job support
      :via email)
    (send "s3" :after 168h
      :job support
      :via email))
  (exit-on (did? "tool-in-use"))
  (target (did? "tool-in-use")
    :within 1440h)
  (pace (rate 150)))
```

When the person gets there, `exit-on` stops the sends, and the target records the win.

## Bibliography

halter's doctrine comes from the people below. Each entry names the idea and where it's published. Where the source is course material or unpublished notes, the entry says so and has no link. On the site each citation renders as a numbered footnote, and the keys never appear.

| Key | Work | Creators | What halter takes |
|---|---|---|---|
| `hulick` | Value Paths, https://www.valuepaths.com/; "Samuel Hulick on designing paths, not products", Intercom, 2021, https://www.intercom.com/blog/podcasts/useronboards-samuel-hulick-on-designing-paths-not-products/; "Value Paths & Fireballs", Userlist, 2020, https://userlist.com/podcast/value-paths-fireballs-with-samuel-hulick/ | Samuel Hulick | Design paths, not products. A person moves from a before state to an after state, and our offer is never the whole path. Reading the path as a state machine is halter's addition. |
| `dunn-bridge` | "Replicating 1:1 Sales with Email Automation: Advice from Brennan Dunn", Userlist, https://userlist.com/blog/replicating-sales-with-email-automation-brennan-dunn/ | Brennan Dunn | An email course, then a bridge, then the pitch. Every send has a job. Buyers leave the pitch at once. |
| `hooks-kit` | "Self-Paced Email Course and Evergreen Product Pitch using Convertkit Automations", https://joelhooks.com/self-paced-email-course-convertkit | Joel Hooks, after Brennan Dunn's Mastering ConvertKit course | The bridge sequence and the evergreen pitch, with tags standing in for events. |
| `dunn-launch` | Mastering ConvertKit, a course, https://createandsell.co/courses/mastering-kit | Brennan Dunn | Launches personalized by segment, deadlines that really change the offer, a control group, and asking non-buyers why. Flag tags stand in for events. |
| `hoy-lcc` | Launch Crash Course: "A Thousand Launches", "How to Structure Your Launch" and "3 Examples: Real Launch Timelines" (course material, not public) | Amy Hoy, Alex Hillman, with launch timelines from Chris Hartjes, Brandon Savage and Brennan Dunn | Build slow, give to get, create events. At least three emails before launch. Launch day is one event among several, each on a specific day and time. |
| `barry-launch` | "3 reasons product launches fail", from Mastering Product Launches (course material, not public) | Nathan Barry | Launches fail on audience, excitement or urgency. A cold pitch in one email sells nothing. |
| `dunn-rm` | RightMessage, https://rightmessage.com/ | Brennan Dunn | Personalization and segmentation. Asked beats inferred, and inferred values can be wrong. |
| `dunn-survey` | Segment With Surveys, a course, https://createandsell.co/courses/segment-with-surveys; "How to survey subscribers using custom fields", Kit, https://help.convertkit.com/en/articles/5434217-how-to-survey-subscribers-using-custom-fields-in-convertkit; "Mastering Email Software with Brennan Dunn", Userlist, https://userlist.com/podcast/mastering-email-software-with-brennan-dunn/; "The Key to Personalized Emails: How to Segment Your Subscribers", Julia Saxena, Course Creator Lab, https://www.coursecreatorlab.co/blog/the-key-to-personalized-emails-how-to-segment-your-subscribers | Brennan Dunn | Survey answers stored as custom fields with stable values, not tags, and a default for everyone else. |
| `hoy-30x500` | 30x500, https://30x500.com/ | Amy Hoy, Alex Hillman | Pain-Dream-Fix. |
| `hoy-safari` | "Sales Safari in Action", Stacking the Bricks, https://stackingthebricks.com/video-sales-safari-in-action/ | Amy Hoy, Alex Hillman | Observation beats asking. |
| `stb` | Stacking the Bricks, https://stackingthebricks.com/, and Just Fucking Ship, https://justfuckingship.com/ | Amy Hoy, Alex Hillman | Plan post-launch work. Proof and objections belong on the page. |
| `coz` | Mariah Coz, https://mariahcoz.com/ | Mariah Coz | The launch schedule the example cohort follows. |
| `kit` | Kit developer documentation, https://developers.kit.com/ | Kit | What the email provider can and can't do. It has no custom events. |
| `hooks-process` | "The Process is a Lie" (unpublished notes from the Value Paths work with Samuel Hulick) | Joel Hooks | Outcomes ahead of process, which is why doctrine alarms and never blocks. |
| `bc-gates` | Launch-gate practice (unpublished) | Badass Courses | Nothing is live until a synthetic run leaves a receipt. |
| `pu` | pi-until, https://github.com/joelhooks/pi-until | Joel Hooks | The trigger rules. |
| `rk` | Rat King's delivery judge, https://github.com/joelhooks/rat-king (`packages/ratking-client/src/attend.ts`) | Joel Hooks | One pure decision, computed time, and dry runs. |

### Skills

Badass Courses' skills complement halter. They give agents the principles for building its data structures. Each skill gets a wiki page built around the principle it represents, says which structures an agent builds from it, and names the checks that hold it. The pages embody the idea in our words. They don't copy the skill or its source material. Each page credits the people the idea comes from, using the keys above. The skills repo is private, so pages name the skill and don't link to it.

| Page | Skill | The principle, in our words | Builds on | What an agent builds, and the checks that hold it |
|---|---|---|---|---|
| `/skills/value-paths/` | value-paths | People want their situation improved, not our product. A path is a machine they walk toward a real result, and our offer is one piece of it. | `hulick` `hooks-process` | `path`, `target`, path events, successors; `path-has-target`, `target-is-our-object` |
| `/skills/email-sequence-architect/` | email-sequence-architect | Each sequence has one job, and people move at their own pace. A bridge comes before the pitch, and buyers leave the pitch at once. | `dunn-bridge` `hooks-kit` | `:job`, `exit-on`, `pitch-to-buyer`, `bridge-announces-pitch` |
| `/skills/launch-sequencer/` | launch-sequencer | People rarely buy from one announcement. Warm up first, give before asking, and make the deadline a real event. | `hoy-lcc` `barry-launch` `hoy-30x500` `coz` | `teach-before-fix`, `fake-deadline`, `rest-days` |
| `/skills/launch-runbook/` | launch-runbook | Outcomes lead and process follows. A plan isn't a launch, and each launch teaches the next. | `hooks-process` `hoy-lcc` `coz` `stb` | alarms that never block, waivers on the record, `post-close-survey` |
| `/skills/launch-operations/` | launch-operations | A time-bound sale is personalized by segment, measured against a control, and followed by asking non-buyers why. | `dunn-launch` `dunn-rm` | `bf-2027`, `vary`, the experiment alarms, `post-close-survey` |
| `/skills/stb-copy-coach/` | stb-copy-coach | Pain, then dream, then fix. Specific beats vague, and the reader is the star. | `hoy-30x500` `stb` | job bands, the arc strip |
| `/skills/sales-safari/` | sales-safari | You can't create desire, only meet it. Watching what people say unprompted beats asking them. | `hoy-safari` `hoy-30x500` | transaction sources, `hard-from-inferred` |
| `/skills/subscriber-intelligence/` | subscriber-intelligence | Know your coverage before you personalize. A segment you inferred can be wrong. | `dunn-rm` | coverage queries, `hard-from-inferred` |
| `/skills/survey-strategy/` | survey-strategy | Ask few questions with stable answers, and always have a default. | `dunn-survey` `dunn-rm` | `dimension`, `asked`, `vary … else`, `few-values` |
| `/skills/proof-and-objections/` | proof-and-objections | Work out what kind of fix an objection needs before answering it. Proof is evidence, not decoration. | `stb` | claim, proof and objection facts, `objection-has-fix` |
| `/skills/shipping-discipline/` | shipping-discipline | Ship in small, visible steps. Feelings make poor evidence. | `stb` | facts over impressions, receipts |
| `/skills/paid-attribution-kernel/` | paid-attribution-kernel | Prove the core contract with a synthetic run before wiring any provider. | `bc-gates` | `synthetic-live`, receipts before live, adapters |
| `/skills/kit-automation-architect/` | kit-automation-architect | Provider mechanics, like flag tags standing in for events, are workarounds. Keep them in the adapter. | `kit` `hooks-kit` `dunn-bridge` | typed events, provider adapters |

## Open for the grill (McBride's calls in this draft)

1. ~~No `next`.~~ Ruled by Joel (D16): paths notify, successors subscribe.
7. ~~No `notify` form.~~ Ruled by Joel (D18): the event set is known beforehand, and "when this fact is true" is the trigger.
8. ~~Fresh evidence by default.~~ Ruled by Joel (D20): `enters-on` ignores facts from before the path went live, unless `:since` says otherwise.
9. Overdue sends become `:send/missed` rather than going out late.
10. ~~Structure is fixed at entry.~~ Ruled by Joel (D32): each person keeps the version they entered on, and `(move PATH :to-version TX)` is the only way to change it under them. Holds are the exception. The two commit buttons, `people-on-old-version` and the overdue-means-missed rule for moves are McBride's mechanics.
16. ~~What a delivery records.~~ Ruled by Joel (D33): each delivery is its own entity, with its content version and its channel. One delivery per person, send and channel, `uncertain` as a delivery status, and `:send/sent` kept as the path event are McBride's mechanics.
17. ~~Finishing on nothing.~~ Ruled by Joel (D34): a person who reaches `done` with no `sent` delivery on the path writes `:path/passed`, not `:path/finished`. The `passed?` predicate and the fourth number on the path page are McBride's.
18. ~~Where autonomy stops.~~ Ruled by Joel (D36), widening D31: nobody waives their own alarm. Agents and people can do the same things, any other actor can waive, and refusals bind everyone. Judging "own" by the `:at` facts' `:who`, re-judging on every run, and letting anyone waive world alarms are McBride's mechanics.
19. ~~How a person finds out what agents did.~~ Ruled by Joel (D37): each path gets a "since you last looked" feed of agent actions, and agent-on-agent waivers are marked. McBride's mechanics: the per-person cursor fact, transactions as queryable entities, listing alarms that changed, and no approval step.
20. ~~A deadline someone was told.~~ Ruled by Joel (D38): once a `sent` delivery has told someone a deadline, moving it is refused for everyone, in either direction. McBride's mechanics: the lock is per person, it covers calendar and per-person windows, and a new announced offer is the honest route, including after an outage.
21. ~~Fresh by when it was written.~~ Ruled by Joel (D39): freshness reads when the act happened. Each world act is its own entity with `:act/at`. McBride's mechanics: `:act/source` fixed at first write, `answered` acts setting dimension values, and path events staying as they are.
22. ~~A refusal that turns true mid-run.~~ Ruled by Joel (D40): "failing closed on the harm and open on everything else". Only the offending send, only for the people named, with the rest of the path running and an alarm. McBride's mechanics: the safe `else` first, otherwise skip, the `refused-at-run` alarm, and commits answering only for the refusals they add.
23. ~~A bonus the language can't see.~~ Ruled by Joel (D41): bonuses are declared as `(bonus PRODUCT :until EVENT)` on the offer and named with `:bonus` on the sends that offer them. McBride's mechanics: owning a bonus is a `bought` act, `:until` reuses an offer event, owners skip the whole send, the `bonus-declared` shape refusal, and the advice to keep a bonus in its own send.
24. ~~What an objection is.~~ Ruled by Joel (D42): an objection is a type of answer. `:objections (VALUE…)` on a dimension marks which answers are objections, and only those need a fix. Joel's questions shaped it: "is objection really a built in?" (no reserved name), "objection is like a type of answer?" (the mark goes on the answers) and "'why didnt you buy' isnt a language feature its a survey answer right?" (right). McBride's mechanics: `:answers (DIM VALUE)` on sends, `value-declared` covering both, and fix or proof as the only jobs that count.
25. ~~A survey that doesn't say what it asks.~~ Ruled by Joel (D43): "ya sur". `:asks DIM` is required on `survey` sends and allowed on any send, and each answer records the delivery it answered with `:act/delivery`. McBride's mechanics: the `asks-declared` shape refusal, an answer to an `:asks` send is `asked` even when it's a click, and `post-close-survey` counts only a survey whose dimension marks objections.
26. **Whose words is a quote?** Parked (Q26). A why can hold a quote that its `:who` never typed. McBride's proposal was that a quote only counts as the words of the transaction's own `:who`, refused otherwise by `quote-is-who`. Proving who made a transaction is the deploy's job. Joel turned to the site rebuild before ruling.
15. ~~A move needs a person.~~ Ruled by Joel (D35): "i think agents can have full autonomy for many circumstance". An agent's move runs at once and isn't pending. Where autonomy stops is ruled by D36 (item 18).
11. `:via` with `or` and `and`, required on every send. Who picks within `or` was ruled by Joel (D24): the person's asked preference, then the written order.
2. `(window :state NAME)` as the evergreen deadline.
3. Durations in minutes and hours only, no days.
4. Comments are never preserved; the why is the place for notes.
5. Calendar `:on` sends go to whoever is in the state at that instant, including late joiners.
6. Shape checks are refusals with no cite; doctrine checks always cite.
13. ~~A closed `:job` list.~~ Ruled by Joel (D29): closed, with `support` added. `support-to-buyers` is McBride's check.
14. ~~Who can waive.~~ Ruled by Joel (D31): only a person. An agent's waiver lands pending, the alarm stays on, and a person confirms it with their own transaction. Widened by D36 (item 18).
12. ~~A target on every path.~~ Ruled by Joel (D28): `(target PRED :within DURATION)` is required, measures only, and is watched past `done` and `exited`. `target-is-our-object` alarms when it only reads `bought?`.
