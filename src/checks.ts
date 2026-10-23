// The check pack. Every check is a saved query that should come back empty.
// Checks select by structure, never by kind. Shape checks refuse an ill-formed path. Doctrine checks cite the source of the idea:
// refuse only for harm that can't be undone; everything else is an alarm the author can ship past.
import type { Problem } from "./read.ts";
import { Kw, quotes, validWhy, type Datom, type Triple, type Val } from "./db.ts";
import { readPath, type Extracted } from "./extract.ts";
import { fromFacts, JOB_SYNONYMS, JOBS, owns } from "./model.ts";
import { printPath } from "./printer.ts";
import { currentVersion, factsAt, onVersions, parseVersion } from "./version.ts";
import { fill, parseQuery, run, type Query } from "./query.ts";

// The closed :job list, and the nearest job for each synonym in the fixed table (D29).
const JOB_LIST = `${JOBS.slice(0, -1).join(", ")} and ${JOBS.at(-1)}`;
const NEAREST = JOB_SYNONYMS.map(([s, j]) => `(and (= ?j ${s}) (= ?near "The nearest is ${j}. "))`).join("\n                       ");

export const SHAPE = [
  `(check "to-declared-state" :severity refuse
  :say "state {?from} moves to {?n}, which isn't declared. Declare it, or move to closed."
  :at (?t :to/target)
  :where ((?st :state/path ?c) (?st :state/name ?from) (?t :to/state ?st) (?t :to/target ?n) (!= ?n closed)
          (not (?x :state/path ?c) (?x :state/name ?n))))`,
  `(check "send-inside-state" :severity refuse
  :say "send {?k} waits {?x} in {?n}, but people leave {?n} after {?len}. It would never go out."
  :at (?s :send/after)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/state ?st) (?s :send/after ?x)
          (?st :state/name ?n) (?t :to/state ?st) (?t :to/after ?len) (>= ?x ?len)))`,
  `(check "offsets-increase" :severity refuse
  :say "send {?kb} waits {?y} in {?n}, no later than send {?ka}. Offsets in a state go up."
  :at (?b :send/after)
  :where ((?a :send/path ?c) (?a :send/state ?st) (?b :send/state ?st) (?st :state/name ?n)
          (?a :send/rank ?ra) (?b :send/rank ?rb) (< ?ra ?rb)
          (?a :send/after ?x) (?b :send/after ?y) (>= ?x ?y)
          (?a :send/key ?ka) (?b :send/key ?kb)))`,
  `(check "sends-in-order" :severity refuse
  :say "send {?kb} goes out {?y}, not after send {?ka} at {?x}. Fix the instant or the order."
  :at (?b :send/on)
  :where ((?a :send/path ?c) (?b :send/path ?c)
          (?a :send/rank ?ra) (?b :send/rank ?rb) (< ?ra ?rb)
          (?a :send/on ?x) (?b :send/on ?y) (>= ?x ?y)
          (?a :send/key ?ka) (?b :send/key ?kb)))`,
  `(check "last-call-before-close" :severity refuse
  :say "send {?k} is a last call on {?on}, but the offer closes {?cl}. Move it before the close."
  :at (?s :send/on)
  :where ((?s :send/path ?c) (?s :send/job last-call) (?s :send/key ?k) (?s :send/on ?on)
          (?o :offer/path ?c) (?o :offer/closes ?cl) (>= ?on ?cl)))`,
  `(check "class-after-close" :severity refuse
  :say "class starts {?cs}, before the offer closes {?cl}. Move the class or the close."
  :at (?o :offer/class-starts)
  :where ((?o :offer/path ?c) (?o :offer/class-starts ?cs) (?o :offer/closes ?cl) (<= ?cs ?cl)))`,
  `(check "early-bird-inside-doors" :severity refuse
  :say "the early-bird ends {?eb}, outside the window {?op} to {?cl}. Move it inside the window."
  :at (?o :offer/early-bird-until)
  :where ((?o :offer/path ?c) (?o :offer/early-bird-until ?eb)
          (?o :offer/opens ?op) (?o :offer/closes ?cl)
          (not (between? ?eb ?op ?cl))))`,
  `(check "no-send-after-close" :severity refuse
  :say "send {?k} goes out {?on}, after the offer closes {?cl}. Only a survey goes out after the close."
  :at (?s :send/on)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/on ?on) (?s :send/job ?job) (!= ?job survey)
          (?o :offer/path ?c) (?o :offer/closes ?cl) (> ?on ?cl)))`,
  `(check "deadline-names-event" :severity refuse
  :say "send {?k} has :deadline {?d}. A deadline names close, early-bird or class."
  :at (?s :send/deadline)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/deadline ?d) (not (in? ?d close early-bird class))))`,
  `(check "asks-declared" :severity refuse
  :say "send {?k} {?what}. A survey says what it asks: :asks DIM, with DIM declared."
  :at ?s
  :where ((?s :send/path ?c) (?s :send/key ?k)
          (or (and (?s :send/job survey) (not (?s :send/asks _)) (= ?what "is a survey with no :asks"))
              (and (?s :send/asks ?d) (not (?d :dim/name _)) (= ?what "asks a dimension that isn't declared")))))`,
  `(check "bonus-declared" :severity refuse
  :say "send {?k} offers bonus {?b}, which {?c}'s offer doesn't declare. Add (bonus \\"{?b}\\" :until close) to the offer, or drop :bonus."
  :at (?s :send/bonus)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/bonus ?b)
          (not (?o :offer/path ?c) (?x :bonus/offer ?o) (?x :bonus/product ?b))))`,
  `(check "job-on-every-send" :severity refuse
  :say "send {?k} has :job {?j}. {?near}The jobs are ${JOB_LIST}."
  :at (?s :send/job)
  :where ((?s :send/path ?c) (?s :send/key ?k)
          (or (and (not (?s :send/job _)) (= ?j "(none)") (= ?near ""))
              (and (?s :send/job ?j) (not (in? ?j ${JOBS.join(" ")}))
                   (or ${NEAREST}
                       (and (not (in? ?j ${JOB_SYNONYMS.map(([x]) => x).join(" ")})) (= ?near "")))))))`,
  `(check "support-to-buyers" :severity refuse
  :say "send {?k} is a support send, but {?c} doesn't enter on a purchase. Support helps people who bought: enter on (bought? …)."
  :at (?s :send/job)
  :where ((?s :send/path ?c) (?s :send/job support) (?s :send/key ?k)
          (not (?c :path/enters-on ?r) (?r :pred/name bought?))
          (not (?c :path/enters-on ?r) (?q :pred/parent ?r) (?q :pred/name bought?))
          (not (?c :path/enters-on ?r) (?q :pred/parent ?r) (?q2 :pred/parent ?q) (?q2 :pred/name bought?))))`,
  `(check "path-has-target" :severity refuse
  :say "{?c} has {?what}. Every path names the person's result: add (target PRED :within DURATION)."
  :at ?c
  :where ((?c :path/title _)
          (or (and (not (?c :path/target _)) (= ?what "no target"))
              (and (?c :path/target _) (not (?c :path/target-within _)) (= ?what "a target with no :within")))))`,
  `(check "else-on-every-vary" :severity refuse :cites (dunn-survey)
  :say "send {?k} varies by {?dn} but has no else. People without a value get nothing. Add (else \\"…\\") with the generic message."
  :at (?s :send/vary-by)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/vary-by ?d) (?d :dim/name ?dn)
          (not (?s :send/vary-else _))))`,
  // Covers a vary, an :answers, and the :objections of a dimension a send uses (D42). The line is the
  // variant's or the :answers pair's; a dimension's own list isn't in the path, so it points at the send.
  `(check "value-declared" :severity refuse
  :say "send {?k} {?how} {?dn} {?val}, which {?isnt}."
  :at ?x
  :where ((?s :send/path ?c) (?s :send/key ?k)
          (or (and (?s :send/vary-by ?d) (= ?how "varies by") (not (?d :dim/name _))
                   (= ?dn ?d) (= ?val "itself") (= ?isnt "isn't a declared dimension") (= ?x ?s))
              (and (?s :send/vary-by ?d) (= ?how "varies by") (?d :dim/name ?dn)
                   (?x :variant/send ?s) (?x :variant/value ?val) (not (?d :dim/values ?val))
                   (= ?isnt "isn't one of its values. Declare it on the dimension first"))
              (and (?x :answers/send ?s) (?x :answers/dim ?d) (= ?how "answers") (not (?d :dim/name _))
                   (= ?dn ?d) (= ?val "itself") (= ?isnt "isn't a declared dimension"))
              (and (?x :answers/send ?s) (?x :answers/dim ?d) (?x :answers/value ?val) (= ?how "answers")
                   (?d :dim/name ?dn) (not (?d :dim/values ?val)) (= ?isnt "isn't one of its values"))
              (and (?x :answers/send ?s) (?x :answers/dim ?d) (?x :answers/value ?val) (= ?how "answers")
                   (?d :dim/name ?dn) (?d :dim/values ?val) (not (?d :dim/objections ?val))
                   (= ?isnt "isn't one of its objections. Answer an objection, or mark this one on the dimension"))
              (and (or (?s :send/vary-by ?d) (and (?a :answers/send ?s) (?a :answers/dim ?d)))
                   (?d :dim/name ?dn) (?d :dim/objections ?val) (not (?d :dim/values ?val)) (= ?how "uses")
                   (= ?isnt "it marks as an objection but doesn't declare") (= ?x ?s)))))`,
  `(check "trigger-has-evidence" :severity refuse
  :say "the {?where} trigger has no positive clause. (not …) alone is true for everyone before anything happens. Name a fact it must see."
  :at ?r
  :where ((or (and (?c :path/enters-on ?r) (= ?where "enters-on"))
              (and (?c :path/exit-on ?r) (= ?where "exit-on"))
              (and (?st :state/path ?c) (?t :to/state ?st) (?t :to/when ?r) (= ?where "(to … :when)")))
          (not (?r :pred/name ?n) (not (in? ?n and or not)))
          (not (?r :pred/name ?g) (in? ?g and or) (?k :pred/parent ?r) (?k :pred/name ?n2) (not (in? ?n2 and or not)))
          (not (?r :pred/name ?g) (in? ?g and or) (?k :pred/parent ?r) (?k :pred/name ?g2) (in? ?g2 and or)
               (?k2 :pred/parent ?k) (?k2 :pred/name ?n3) (not (in? ?n3 and or not)))))`,
  `(check "wait-has-timeout" :severity refuse
  :say "state {?n} is left only by :when. Someone can wait in it for good. Add (to … :after DURATION) too."
  :at ?st
  :where ((?st :state/path ?c) (?st :state/name ?n) (?t :to/state ?st) (?t :to/when _)
          (not (?t2 :to/state ?st) (?t2 :to/after _))))`,
  `(check "message-exists" :severity refuse
  :say "send {?k} names message {?m}, which the content file doesn't declare. Add (message \\"{?m}\\" …) there."
  :at ?s
  :where ((?s :send/path ?c) (?s :send/key ?k)
          (or (and (= ?m ?k))
              (and (?s :send/vary-else ?m))
              (and (?v :variant/send ?s) (?v :variant/message ?m)))
          (not (?x :message/id ?m))))`,
  `(check "via-has-rendition" :severity refuse
  :say "send {?k} can go by {?ch}, but message {?m} has no {?ch} rendition. Add ({?ch} …) to it in the content file."
  :at ?v
  :where ((?s :send/path ?c) (?s :send/key ?k) (?v :via/send ?s) (?v :via/channel ?ch)
          (or (and (= ?m ?k))
              (and (?s :send/vary-else ?m))
              (and (?w :variant/send ?s) (?w :variant/message ?m)))
          (?mm :message/id ?m)
          (not (?r :rendition/message ?mm) (?r :rendition/channel ?ch))))`,
];

export const DOCTRINE = [
  `(check "fake-deadline" :severity refuse :cites (hoy-lcc dunn-launch)
  :say "send {?k} is an {?j} send, but its deadline changes nothing. Point :deadline at close, early-bird or class, before the send."
  :at (?s :send/job)
  :where ((?s :send/path ?c) (?s :send/job ?j) (in? ?j urgency last-call) (?s :send/key ?k)
          (or (not (?s :send/deadline _))
              (and (?s :send/deadline early-bird) (not (?o :offer/path ?c) (?o :offer/early-bird-until _)))
              (and (?s :send/deadline early-bird) (?o :offer/path ?c) (?o :offer/early-bird-until ?eb) (?s :send/on ?on) (>= ?on ?eb))
              (and (?s :send/deadline class) (not (?o :offer/path ?c) (?o :offer/class-starts _)))
              (and (?s :send/deadline close) (?o :offer/path ?c) (?o :offer/closes ?cl) (?s :send/on ?on) (>= ?on ?cl))
              (and (?s :send/deadline close) (?o :offer/path ?c) (?o :offer/window-state ?ws)
                   (?s :send/state ?st) (?st :state/name ?sn) (!= ?sn ?ws))
              (and (?s :send/deadline close)
                   (not (?o :offer/path ?c) (?o :offer/closes _))
                   (not (?o :offer/path ?c) (?o :offer/window-state _))))))`,
  `(check "pitch-to-buyer" :severity refuse :cites (dunn-bridge)
  :say "{?c} pitches {?pn} but has no exit-on for its buyers. Add (exit-on (bought? \\"{?slug}\\"))."
  :at ?c
  :where ((?o :offer/path ?c) (?o :offer/product ?pr) (?pr :product/slug ?slug) (?pr :product/name ?pn) (?pr :product/buyer-tag ?tag)
          (not (?c :path/exit-on ?x) (?x :pred/name bought?) (?x :pred/arg ?slug))
          (not (?g :guard/path ?c) (?g :guard/action skip) (?g :guard/when ?w) (?w :pred/name tag?) (?w :pred/arg ?tag))))`,
  `(check "hard-from-inferred" :severity refuse :cites (dunn-rm)
  :say "send {?k} states {?dn} as who they are, but {?n} people's values are inferred. Ask them, or drop :hard."
  :at (?s :send/vary-hard)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/vary-by ?d) (?s :send/vary-hard true)
          (?d :dim/name ?dn)
          (count ?n ?p (?v :variant/send ?s) (?v :variant/value ?val)
                 (?a :act/of ?dn) (?a :act/kind answered) (?a :act/value ?val) (?a :act/source inferred) (?a :act/person ?p) (?a :act/at ?t)
                 (not (?b :act/person ?p) (?b :act/kind answered) (?b :act/of ?dn) (?b :act/at ?u) (> ?u ?t)))
          (> ?n 0)))`,
  `(check "bonus-to-owner" :severity refuse :cites (dunn-bridge)
  :say "send {?k} offers {?b}, which {?n} people already own. They skip it at run (D40). Keep the bonus in its own send."
  :at (?s :send/bonus)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/bonus ?b)
          (count ?n ?p (?a :act/kind bought) (?a :act/of ?b) (?a :act/person ?p)
                 (?p :path/at ?st) (starts? ?st ?c)
                 (not (?p :send/sent ?m) (ref? ?m ?c ?k))
                 (not (?p :send/skipped ?m) (ref? ?m ?c ?k))
                 (not (?p :send/missed ?m) (ref? ?m ?c ?k)))
          (> ?n 0)))`,
  `(check "synthetic-live" :severity refuse :cites (bc-gates)
  :say "synthetic person {?who} is on {?l}, which {?c} sends to. Synthetic people only run in simulations."
  :at (?c :path/list)
  :where ((?c :path/list ?l) (?p :person/lists ?l) (?p :person/synthetic true) (?p :person/name ?who)))`,
  `(check "teach-before-fix" :severity alarm :cites (hoy-lcc barry-launch)
  :say "only {?n} teach sends before the first fix, send {?kf}. Three is the usual warmup; ship anyway if this list is warm."
  :at (?f :send/job)
  :where ((?f :send/path ?c) (?f :send/job fix) (?f :send/rank ?rf) (?f :send/key ?kf)
          (not (?g :send/path ?c) (?g :send/job fix) (?g :send/rank ?rg) (< ?rg ?rf))
          (count ?n ?t (?t :send/path ?c) (?t :send/job teach) (?t :send/rank ?rt) (< ?rt ?rf))
          (< ?n 3)))`,
  `(check "bridge-announces-pitch" :severity alarm :cites (dunn-bridge)
  :say "nothing announces the pitch before fix send {?kf}. Give the state before it an announce-pitch send."
  :at (?f :send/job)
  :where ((?f :send/path ?c) (?f :send/job fix) (?f :send/rank ?rf) (?f :send/key ?kf)
          (not (?g :send/path ?c) (?g :send/job fix) (?g :send/rank ?rg) (< ?rg ?rf))
          (not (?a :send/path ?c) (?a :send/job announce-pitch) (?a :send/rank ?ra) (< ?ra ?rf))))`,
  `(check "rest-days" :severity alarm :cites (dunn-launch)
  :say "sends {?ka}, {?kb} and {?kz} go out three days running, before the close. Give people a day off."
  :at (?z :send/on)
  :where ((?a :send/path ?c) (?a :send/on ?x) (day ?x ?dx) (+ ?dx 24h ?dy)
          (?b :send/path ?c) (?b :send/on ?y) (day ?y ?dy) (+ ?dy 24h ?dz)
          (?z :send/path ?c) (?z :send/on ?w) (day ?w ?dz)
          (?o :offer/path ?c) (?o :offer/closes ?cl) (- ?cl 48h ?edge) (< ?w ?edge)
          (?a :send/key ?ka) (?b :send/key ?kb) (?z :send/key ?kz)))`,
  `(check "few-values" :severity alarm :cites (dunn-survey)
  :say "send {?k} varies by {?dn}, which has {?n} values. Four or five is plenty."
  :at (?s :send/vary-by)
  :where ((?s :send/path ?c) (?s :send/key ?k) (?s :send/vary-by ?d) (?d :dim/name ?dn)
          (count ?n ?v (?d :dim/values ?v)) (> ?n 5)))`,
  // A survey counts only when the dimension it asks marks objections (D43): asking what people make
  // doesn't ask non-buyers why.
  `(check "post-close-survey" :severity alarm :cites (dunn-launch)
  :say "nothing in {?c} or after it asks non-buyers why. A survey send after close counts when its :asks dimension marks :objections."
  :at ?c
  :where ((?o :offer/path ?c)
          (not (?s :send/path ?c) (?s :send/job survey) (?s :send/asks ?d) (?d :dim/objections _))
          (not (?q :path/enters-on ?e) (?e :pred/name finished?) (?e :pred/arg ?c)
               (?w :send/path ?q) (?w :send/job survey) (?w :send/asks ?x) (?x :dim/objections _))))`,
  // Per path: each objection of a dimension the path uses needs a fix or proof send that answers it (D42).
  // A path that uses no dimension with objections passes; values nobody marked never alarm.
  `(check "objection-has-fix" :severity alarm :cites (stb)
  :say "objection {?dn} {?o} has no fix, or is only answered in a faq send. Answer it in a fix or proof send."
  :at ?c
  :where ((?s :send/path ?c) (or (?s :send/vary-by ?d) (and (?a :answers/send ?s) (?a :answers/dim ?d)))
          (?d :dim/name ?dn) (?d :dim/objections ?o)
          (not (?f :send/path ?c) (?f :send/job ?j) (in? ?j fix proof)
               (?b :answers/send ?f) (?b :answers/dim ?d) (?b :answers/value ?o))))`,
  `(check "target-is-our-object" :severity alarm :cites (hulick)
  :say "the target of {?c} only reads bought?. That's our result, not theirs. Name what buying gets them, e.g. (and (bought? …) (did? …))."
  :at ?r
  :where ((?c :path/target ?r)
          (not (?r :pred/name ?n) (not (in? ?n and or not bought?)))
          (not (?q :pred/parent ?r) (?q :pred/name ?n2) (not (in? ?n2 and or not bought?)))
          (not (?q :pred/parent ?r) (?q2 :pred/parent ?q) (?q2 :pred/name ?n3) (not (in? ?n3 and or not bought?)))))`,
  `(check "people-on-old-version" :severity alarm :cites (bc-gates)
  :say "{?n} people run version {?vt} of {?c}, and the current version is {?cur}. Move them, or waive this to leave them there on purpose."
  :at ?c
  :where ((?c :path/version-now ?cur)
          (?ve :version/path ?c) (?ve :version/tx ?vt) (!= ?vt ?cur)
          (count ?n ?p (?p :path/version ?ve) (?p :path/at ?s) (starts? ?s ?c))
          (> ?n 0)))`,
  `(check "refused-at-run" :severity alarm :cites (bc-gates)
  :say "{?n} people in {?c} hit {?ck} mid-run. Their {?k} fell back to its else, or was skipped. Fix the cause."
  :at ?c
  :where ((?r :refusal/send ?m) (starts? ?m ?c) (?r :refusal/check ?ck) (?r :refusal/key ?k)
          (count ?n ?p (?x :refusal/send ?m) (?x :refusal/check ?ck) (?x :refusal/person ?p))))`,
  `(check "uncertain-sends" :severity alarm :cites (pu)
  :say "{?n} people have sends in {?c} the provider never confirmed. Check the provider before anything retries."
  :at ?c
  :where ((count ?n ?p (?d :delivery/status uncertain) (?d :delivery/send ?m) (starts? ?m ?c) (?d :delivery/person ?p)) (> ?n 0)))`,
  // A told deadline is locked (D38). Its facts are what a transaction would do to each told person: the
  // instant they were told, as of the delivery, and the instant under their version after the transaction.
  // The interpreter feeds them when it plans a move, the only way a told person's structure changes.
  `(check "deadline-kept" :severity refuse :cites (hoy-lcc dunn-launch)
  :say "{?n} people were told {?ev} is {?told}. It can't move to {?now}. Make a new offer and announce it."
  :at ?c
  :where ((?k :told/path ?c) (?k :told/event ?ev) (?k :told/at ?told) (?k :told/now ?now) (!= ?told ?now)
          (count ?n ?p (?j :told/path ?c) (?j :told/event ?ev) (?j :told/at ?told) (?j :told/now ?now) (?j :told/person ?p))))`,
];

// Doctrine checks LANGUAGE.md lists that this sketch doesn't build yet, and why.
export const UNBUILT: ReadonlyArray<{ readonly name: string; readonly severity: "refuse" | "alarm"; readonly cites: string; readonly why: string }> = [
];

export const PACK: ReadonlyArray<{ readonly source: string; readonly query: Query; readonly shape: boolean }> = [
  ...SHAPE.map((source) => ({ source, query: parseQuery(source), shape: true })),
  ...DOCTRINE.map((source) => ({ source, query: parseQuery(source), shape: false })),
];

export interface Waiver {
  readonly t: number;
  readonly who: string;
  readonly why: string;
  readonly counts: boolean;
  // set when the waiver's author raised the alarm: someone else must confirm (D36)
  readonly pending?: string;
}
export interface Finding {
  readonly check: string;
  readonly severity: "refuse" | "alarm";
  readonly message: string;
  readonly hint?: string;
  readonly cites?: ReadonlyArray<string>;
  readonly at: number;
  readonly line: number;
  readonly col: number;
  readonly waived?: Waiver | "staged";
  // who wrote the facts this finding's :at points at; empty when the world or the interpreter did (D36)
  readonly raisedBy?: ReadonlyArray<string>;
  // set when the finding is on an older version someone still runs; the line is in that version's printout
  readonly version?: number;
  // a refusal that doesn't refuse (D40): "before", already there before this commit; "at-run", raised by
  // the world after the commit that made this version, so halter stops only the sends it names; "old-version",
  // on a version people still run, where the same holds for them
  readonly standing?: "before" | "at-run" | "old-version";
}
export interface Verdict {
  readonly ok: boolean;
  readonly refusals: number;
  readonly alarms: number;
  readonly findings: ReadonlyArray<Finding>;
  readonly extracted: Extracted;
  readonly ran: ReadonlyArray<{ readonly name: string; readonly rows: number; readonly error?: string }>;
}

export interface Context {
  // every current fact as of t, the campaign's own included; its own get replaced by the source's
  readonly facts: ReadonlyArray<Triple>;
  readonly history: ReadonlyArray<Datom>;
}

export { quotes };

export const position = (source: string, at: number) => {
  const before = source.slice(0, Math.max(0, at)).split("\n");
  return { line: before.length, col: (before.at(-1)?.length ?? 0) + 1 };
};

// Who waived a check: the tx that last asserted the waiver fact, read from history.
// Only a person can waive (D31). When an agent wrote the last assert the waiver is pending and the
// alarm stays on until a person asserts the same waiver in their own transaction.
// The waiver on a path for one check, judged against who raised the alarm (D36): nobody waives their
// own alarm, person or agent. The author is whoever wrote the last assert; raisedBy comes from the
// check's current findings, so this is judged again on every run.
export const waiverOf = (c: string, name: string, history: ReadonlyArray<Datom>, raisedBy: ReadonlyArray<string> = []): Waiver | undefined => {
  const assert = [...history].reverse().find((d) => d.e === c && d.a === "path/waives" && d.v === name);
  if (!assert || !assert.added) return undefined;
  const meta = (a: string) => history.find((d) => d.e === assert.tx && d.a === a)?.v;
  const why = String(meta("tx/why") ?? "");
  const who = String(meta("tx/who") ?? "");
  const src = meta("tx/source");
  const rule = meta("tx/rule");
  const own = raisedBy.includes(who);
  const valid = validWhy({ why, source: src instanceof Kw ? src.name : String(src ?? ""), rule: rule === undefined ? undefined : String(rule) });
  return { t: assert.tx, who, why, counts: valid && !own, ...(own ? { pending: who } : {}) };
};
export const pendingText = (w: Waiver) => `waiver pending: ${w.pending} raised this alarm, someone else must confirm`;

// Who wrote a fact: the :who of the transaction that last asserted that value.
const authorsOf = (history: ReadonlyArray<Datom>) => {
  const who = new Map<number, string>();
  const last = new Map<string, number>();
  for (const d of history) {
    if (d.a === "tx/who") who.set(Number(d.e), String(d.v));
    else if (d.added) last.set(`${String(d.e)}|${d.a}|${String(d.v instanceof Kw ? d.v.name : d.v)}`, d.tx);
  }
  return (e: string, a: string, v: unknown) => {
    const t = last.get(`${e}|${a}|${String(v instanceof Kw ? v.name : v)}`);
    return t === undefined ? undefined : who.get(t);
  };
};

// Version facts the checks can query (D32): each version people hold, and the path's current version.
const versionFacts = (id: string, ctx: Context): Array<Triple> => {
  const cur = currentVersion(ctx.history, id);
  const held = new Set(ctx.facts.filter((f) => f.a === "path/version" && parseVersion(String(f.v))?.path === id).map((f) => String(f.v)));
  return [
    ...(cur === undefined ? [] : [{ e: id, a: "path/version-now", v: cur }]),
    ...[...held].flatMap((ve) => [{ e: ve, a: "version/path", v: id }, { e: ve, a: "version/tx", v: parseVersion(ve)?.v ?? 0 }]),
  ];
};

// A commit answers only for what it adds (D40). A finding is the same finding when its check and words are.
export const findingKey = (f: Finding) => `${f.check}|${f.message}`;
export const refusalKeys = (v: Verdict | undefined): ReadonlySet<string> => new Set((v?.findings ?? []).filter((f) => f.severity === "refuse").map(findingKey));
// commit: refusals already in the baseline (the head) don't refuse this draft, nor do old versions' refusals,
// so a fix for new entrants reads clean while the people on the old version hit them at run.
// page: refusals on an old version, or not there when this version was committed, don't refuse the page;
// they're true at run, where halter fails closed for only the people they name.
export const judge = (v: Verdict, baseline: ReadonlySet<string>, mode: "commit" | "page"): Verdict => {
  const findings = v.findings.map((f): Finding => {
    if (f.severity !== "refuse") return f;
    const known = baseline.has(findingKey(f));
    // a version people still run is one this commit doesn't change: true at run for them, on either side
    const standing = f.version !== undefined ? "old-version" : mode === "commit" ? (known ? "before" : undefined) : known ? undefined : "at-run";
    return standing === undefined ? f : { ...f, standing };
  });
  const refusals = findings.filter((f) => f.severity === "refuse" && f.standing === undefined).length;
  return { ...v, findings, refusals, ok: refusals === 0 };
};

export const verdict = (source: string, ctx: Context, older = true): Verdict => {
  const extracted = readPath(source);
  const findings: Array<Finding> = [];
  const add = (f: Omit<Finding, "line" | "col">) => findings.push({ ...f, ...position(source, f.at) });
  for (const p of extracted.problems as ReadonlyArray<Problem>)
    add({ check: "shape", severity: "refuse", message: p.message, ...(p.hint === undefined ? {} : { hint: p.hint }), at: p.at });
  const ran: Array<{ name: string; rows: number; error?: string }> = [];
  const { id } = extracted;
  if (id !== "" && extracted.path !== undefined) {
    const facts = [...ctx.facts.filter((t) => !owns(id, t.e)), ...extracted.triples, ...versionFacts(id, ctx)];
    const waives = new Set(extracted.triples.filter((t) => t.e === id && t.a === "path/waives").map((t) => String(t.v)));
    const author = authorsOf(ctx.history);
    // The facts a finding points at: the :at entity's values for the :at attribute, or all of the
    // entity's facts. A bare :at on the path itself names no fact, so nobody raised it.
    const raisers = (eid: string, a: string | undefined): Array<string> =>
      a === undefined && eid === id
        ? []
        : ctx.facts.filter((f) => String(f.e) === eid && (a === undefined || f.a === a)).flatMap((f) => author(eid, f.a, f.v) ?? []);
    for (const { query } of PACK) {
      const r = run(query, { facts, history: ctx.history }, new Map<string, Val>([["?c", id]]));
      if (!r.ok) {
        ran.push({ name: query.name, rows: 0, error: r.error });
        add({ check: query.name, severity: "refuse", message: `check ${query.name} failed to run: ${r.error}`, at: 0 });
        continue;
      }
      const seen = new Set<string>();
      const rows: Array<{ message: string; eid: string }> = [];
      for (const b of r.bindings) {
        const message = fill(query.say, b);
        if (seen.has(message)) continue;
        seen.add(message);
        const e = query.at ? b.get(query.at.e) : undefined;
        rows.push({ message, eid: e instanceof Kw ? e.name : e === undefined ? id : String(e) });
      }
      // Everyone who wrote a fact any current finding of this check points at.
      const raisedBy = [...new Set(rows.flatMap((x) => raisers(x.eid, query.at?.a)))].sort();
      for (const { message, eid } of rows) {
        const at = (query.at?.a ? extracted.at.get(`${eid}|${query.at.a}`) : undefined) ?? extracted.at.get(eid) ?? extracted.at.get(id) ?? 0;
        let waived: Waiver | "staged" | undefined;
        if (waives.has(query.name) && query.severity === "alarm") waived = waiverOf(id, query.name, ctx.history, raisedBy) ?? "staged";
        add({
          check: query.name,
          severity: query.severity,
          message,
          ...(query.cites.length > 0 ? { cites: query.cites } : {}),
          ...(waives.has(query.name) && query.severity === "refuse" ? { hint: "a waiver can't lift a refusal; refusals guard harm that can't be undone" } : {}),
          at,
          ...(waived === undefined ? {} : { waived }),
          ...(query.severity === "alarm" ? { raisedBy } : {}),
        });
      }
      ran.push({ name: query.name, rows: seen.size });
    }
  }
  // Checks run on every version someone is still on. Waivers are decisions, not structure, so the
  // current ones apply; each finding names its version.
  if (older && id !== "" && extracted.path !== undefined) {
    const cur = currentVersion(ctx.history, id);
    for (const v of [...onVersions(ctx.facts, id).keys()].filter((x) => x !== cur).sort((x, y) => x - y)) {
      const old = fromFacts(id, factsAt(ctx.history, v));
      if (!old) continue;
      const sub = verdict(printPath({ ...old, waives: extracted.path.waives }), ctx, false);
      for (const f of sub.findings) if (f.check !== "people-on-old-version") findings.push({ ...f, version: v, at: Number.MAX_SAFE_INTEGER });
    }
  }
  findings.sort((x, y) => x.at - y.at);
  const live = (f: Finding) => !(f.waived !== undefined && f.waived !== "staged" && f.waived.counts);
  const refusals = findings.filter((f) => f.severity === "refuse").length;
  const alarms = findings.filter((f) => f.severity === "alarm" && live(f)).length;
  return { ok: refusals === 0, refusals, alarms, findings, extracted, ran };
};
