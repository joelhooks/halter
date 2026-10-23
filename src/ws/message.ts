// MESSAGE
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { DbValue, FileView, Source, Tab, Who } from "./model.ts";

export const CommitKind = Schema.Literals(["plain", "new", "move"]);
export type CommitKind = typeof CommitKind.Type;

export const Message = defineMessageUnion({
  MovedSlider: { t: Schema.Number },
  SelectedTab: { tab: Tab },
  SelectedFile: { file: FileView },
  UpdatedDraft: { text: Schema.String },
  UpdatedWhy: { value: Schema.String },
  SelectedWho: { who: Who },
  SelectedSource: { source: Source },
  ChangedCard: { key: Schema.String, field: Schema.Literals(["job", "timing"]), value: Schema.String },
  ClickedCommit: { kind: CommitKind },
  ClickedConfirmWaiver: { check: Schema.String },
  ClickedMarkSeen: {},
  ClickedUndo: {},
  ClickedBreak: {},
  ClickedReset: {},
  ClickedPerson: { person: Schema.String },
  ToggledDelivery: { person: Schema.String, isOpen: Schema.Boolean },
  SucceededRunInterpreter: { db: DbValue },
  FailedRunInterpreter: { reason: Schema.String },
  CompletedScrollToHere: {},
  CompletedScrollToDelivery: {},
});
export type Message = typeof Message.Type;
