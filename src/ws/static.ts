// The static render of the workspace: the same program, at the head of the log, rendered to a string
// by Foldkit's server renderer for pages without the script, the page generator and the tests.
import { Effect } from "effect";
import { Server } from "foldkit/experimental";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { Db, TxInput } from "../db.ts";
import type { Message } from "./message.ts";
import { Flags, initModel, type Model } from "./model.ts";
import { view } from "./view.ts";

export const renderHtml = (body: (h: HtmlBuilder<Message>) => Html): string =>
  Effect.runSync(Server.renderToString({ Flags, init: (f: Flags) => ({ model: initModel(f) }), view: (_m: Model, h: HtmlBuilder<Message>) => ({ title: "", body: body(h) }) }, { flags: { pathId: "", db: { log: [] }, authored: [] }, isHydratable: false })).html;

export const workspaceStatic = (db: Db, pathId: string, authored: ReadonlyArray<TxInput>, at: (m: Model) => Model = (m) => m): string =>
  Effect.runSync(Server.renderToString({ Flags, init: (f: Flags) => ({ model: at(initModel(f)) }), view: (m: Model, h: HtmlBuilder<Message>) => ({ title: "", body: view(m, h) }) }, { flags: { pathId, db, authored }, isHydratable: false })).html;
