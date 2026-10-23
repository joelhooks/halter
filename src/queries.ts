// Saved queries, written in halter's own syntax and run by the small matcher in query.ts.
import { parseQuery, type Query } from "./query.ts";

export const SAVED = [
  `(query "not-sent"
  :doc "Every send that didn't go out, and the reason the interpreter wrote. Skips, misses and closed offers all land here."
  :find (?who ?m ?a ?why)
  :where ((?p ?a ?m ?tx true) (in? ?a :send/skipped :send/missed)
          (?p :person/name ?who) (?tx :tx/why ?why)))`,
  `(query "buyer-exits"
  :doc "How each path keeps a product's buyers out: an exit-on that fires when they buy."
  :find (?c ?product)
  :where ((?c :path/exit-on ?x) (?x :pred/name bought?) (?x :pred/arg ?slug)
          (?pr :product/slug ?slug) (?pr :product/name ?product)))`,
  `(query "date-history"
  :doc "Every transaction that moved an instant or a duration, with who and why."
  :find (?t ?who ?e ?a ?old ?new ?why)
  :where ((?e ?a ?old ?t false) (?a :db/type ?ty) (in? ?ty date duration)
          (?e ?a ?new ?t true)
          (?t :tx/who ?who) (?t :tx/why ?why)))`,
  `(query "who-was-where"
  :doc "Every state each person entered, and the transaction that put them there. It reads history: at the log's head everyone has finished every path."
  :find (?who ?at ?t)
  :where ((?p :path/at ?at ?t true) (?p :person/name ?who)))`,
];

// Questions about what went out (D33). got-broken-link names the transaction of Teo's link fix in the seed.
export const deliveryQueries = (fix: number): ReadonlyArray<{ readonly source: string; readonly query: Query }> =>
  [
    `(query "got-broken-link" :doc "who got p1's email before Teo's link fix at tx ${fix}"
  :find (?p)
  :where ((?d :delivery/message "p1") (?d :delivery/via email) (?d :delivery/content ?t) (< ?t ${fix})
          (?d :delivery/person ?p)))`,
    `(query "got-texts" :doc "who got a text, and which message"
  :find (?p ?m)
  :where ((?d :delivery/via sms) (?d :delivery/person ?p) (?d :delivery/message ?m)))`,
  ].map((source) => ({ source, query: parseQuery(source) }));

export const SAVED_QUERIES: ReadonlyArray<{ readonly source: string; readonly query: Query }> = SAVED.map((source) => ({ source, query: parseQuery(source) }));
