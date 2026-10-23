// MODEL
// The workspace on each path page, as one Foldkit program. The log itself (Db) and the authored
// transactions behind it are engine values; the Model holds them whole and replaces them on a commit.
import { Option, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";
import { SOURCES, type Db, type TxInput } from "../db.ts";

export const DbValue = Schema.declare<Db>((u): u is Db => typeof u === "object" && u !== null && Array.isArray((u as { log?: unknown }).log));
export const AuthoredValue = Schema.declare<ReadonlyArray<TxInput>>((u): u is ReadonlyArray<TxInput> => Array.isArray(u));

export const TABS = ["Printout", "Edit", "History", "Got", "Versions"] as const;
export const Tab = Schema.Literals(TABS);
export type Tab = typeof Tab.Type;
export const FileView = Schema.Literals(["structure", "content"]);
export type FileView = typeof FileView.Type;
export const WHO = ["mara", "teo", "agent:desk", "agent:drafter", "agent:judge"] as const;
export const Who = Schema.Literals(WHO);
export type Who = typeof Who.Type;
export const Source = Schema.Literals(SOURCES);
export type Source = typeof Source.Type;

// What a commit said it would do, so the notice after the interpreter runs can say what happened.
export const Said = defineTaggedUnion({
  Plain: {},
  ForNewEntrants: {},
  MoveEveryone: {},
  ConfirmWaiver: { check: Schema.String },
  MarkSeen: {},
  Undo: { target: Schema.Number },
});
export type Said = typeof Said.Type;

export const Pending = Schema.Struct({
  at: Schema.String,
  who: Schema.String,
  why: Schema.String,
  hasMoves: Schema.Boolean,
  setAside: Schema.Number,
  authored: AuthoredValue,
  said: Said,
});
export type Pending = typeof Pending.Type;

export const CommitState = defineTaggedUnion({
  Idle: {},
  Running: { pending: Pending },
});
export type CommitState = typeof CommitState.Type;

export const Model = Schema.Struct({
  pathId: Schema.String,
  db: DbValue,
  authored: AuthoredValue,
  t: Schema.Number,
  tab: Tab,
  file: FileView,
  who: Who,
  source: Source,
  why: Schema.String,
  maybeDraft: Schema.Option(Schema.String),
  notice: Schema.String,
  commit: CommitState,
  openPeople: Schema.Array(Schema.String),
});
export type Model = typeof Model.Type;

export const Flags = Schema.Struct({ pathId: Schema.String, db: DbValue, authored: AuthoredValue });
export type Flags = typeof Flags.Type;

export const initModel = (flags: Flags): Model => ({
  pathId: flags.pathId,
  db: flags.db,
  authored: flags.authored,
  t: flags.db.log.length,
  tab: "Printout",
  file: "structure",
  who: "mara",
  source: "assumed",
  why: "",
  maybeDraft: Option.none(),
  notice: "",
  commit: CommitState.Idle(),
  openPeople: [],
});
