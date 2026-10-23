// The browser boot: replay the seed once the static page has painted, then mount the workspace
// program over its static render.
import { Effect } from "effect";
import { Runtime } from "foldkit";
import { AUTHORED, seedDb } from "../seed.ts";
import { Flags, Model, initModel } from "./model.ts";
import { update } from "./update.ts";
import { view } from "./view.ts";

const container = document.querySelector<HTMLElement>("[data-workspace]");
const pathId = container?.dataset.workspace ?? "";

if (container) {
  container.id = `ws-${pathId}`;
  setTimeout(() => {
    const element = Runtime.makeElement({
      Model,
      Flags,
      flags: Effect.sync(() => ({ pathId, db: seedDb(), authored: AUTHORED })),
      init: (flags: Flags) => ({ model: initModel(flags) }),
      update,
      view,
      container,
    });
    Runtime.run(element);
  }, 30);
}
