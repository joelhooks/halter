// What the update and the view both read off the Model: the path as of the slider, and the draft.
// Pure and memoized by the Db, so a keystroke doesn't replay the log.
import { Option } from "effect";
import { asOf, diff, facts, history, type Db, type Op } from "../db.ts";
import { verdict, type Verdict } from "../checks.ts";
import { readPath } from "../extract.ts";
import { owned, type Path } from "../model.ts";
import { viewAt, type View } from "../views.ts";
import type { Model } from "./model.ts";

const views = new WeakMap<Db, Map<string, View>>();
export const viewOf = (model: Model): View => {
  const m = views.get(model.db) ?? new Map<string, View>();
  views.set(model.db, m);
  const key = `${model.pathId}@${model.t}`;
  const hit = m.get(key) ?? viewAt(model.db, model.pathId, model.t);
  m.set(key, hit);
  return hit;
};
const heres = new WeakMap<Db, Map<number, Db>>();
export const hereOf = (model: Model): Db => {
  const m = heres.get(model.db) ?? new Map<number, Db>();
  heres.set(model.db, m);
  const hit = m.get(model.t) ?? asOf(model.db, model.t);
  m.set(model.t, hit);
  return hit;
};
// People on the path as of the slider: an edit then makes a new version, and they keep theirs unless moved.
export const isOnPath = (model: Model): boolean => facts(hereOf(model)).some((f) => f.a === "path/at" && String(f.v).startsWith(`${model.pathId}/`));

const bare = (text: string) => text.replace(/^;.*\n/, "");
// The editor follows the slider until there's a draft.
export const draftText = (model: Model): string => Option.getOrElse(model.maybeDraft, () => bare(viewOf(model).text));

export interface Draft {
  readonly text: string;
  readonly path: Path | undefined;
  readonly ops: ReadonlyArray<Op>;
  readonly error: string | undefined;
  readonly verdict: Verdict;
}
const drafts = new WeakMap<Db, Map<string, Draft>>();
export const draftOf = (model: Model): Draft => {
  const text = draftText(model);
  const m = drafts.get(model.db) ?? new Map<string, Draft>();
  drafts.set(model.db, m);
  const key = `${model.pathId}@${model.t}\n${text}`;
  const hit = m.get(key);
  if (hit) return hit;
  const here = hereOf(model);
  const fs = facts(here);
  const ex = readPath(text);
  const v = verdict(text, { facts: fs, history: history(here) });
  const d: Draft =
    ex.id !== "" && ex.id !== model.pathId
      ? { text, path: undefined, ops: [], error: `this draft names "${ex.id}"; the path on this page is "${model.pathId}"`, verdict: v }
      : !ex.path
        ? { text, path: undefined, ops: [], error: ex.problems[0]?.message ?? "the reader can't read this", verdict: v }
        : { text, path: ex.path, ops: diff(owned(model.pathId, fs), ex.triples), error: undefined, verdict: v };
  m.set(key, d);
  return d;
};
