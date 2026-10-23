// Deliveries (D33). Each delivery is its own entity: one per person, send and channel, written in the same
// transaction as the path event. :send/sent stays the path event; the deliveries are the receipts behind it.
import { kw, Kw, type Op, type Triple } from "./db.ts";

export interface Delivery {
  readonly person: string;
  // PATH/KEY
  readonly send: string;
  readonly message: string;
  // the last transaction that changed this channel's rendition of the message before it went out
  readonly content: number;
  readonly via: string;
  readonly status: "sent" | "uncertain";
}
export interface Stored extends Delivery {
  readonly id: string;
}

export const deliveryKey = (person: string, send: string, via: string) => `${person}|${send}|${via}`;
export const deliveryId = (person: string, send: string, via: string) => `delivery/${person.replace(/^person\//, "")}/${send}/${via}`;

// The ops for one delivery. A key that already has a delivery only gets its status updated, so a
// re-delivery never makes a second entity. existing looks a key up and returns its entity.
export const deliveryOps = (existing: (key: string) => string | undefined, d: Delivery): Array<Op> => {
  const key = deliveryKey(d.person, d.send, d.via);
  const held = existing(key);
  if (held !== undefined) return [{ e: held, a: "delivery/status", v: kw(d.status), added: true }];
  const e = deliveryId(d.person, d.send, d.via);
  return [
    { e, a: "delivery/person", v: d.person, added: true },
    { e, a: "delivery/send", v: d.send, added: true },
    { e, a: "delivery/message", v: d.message, added: true },
    { e, a: "delivery/content", v: d.content, added: true },
    { e, a: "delivery/via", v: kw(d.via), added: true },
    { e, a: "delivery/status", v: kw(d.status), added: true },
    { e, a: "delivery/key", v: key, added: true },
  ];
};
export const keyLookup = (fs: ReadonlyArray<Triple>) => {
  const m = new Map(fs.filter((f) => f.a === "delivery/key").map((f) => [String(f.v), String(f.e)]));
  return (key: string) => m.get(key);
};

const name = (v: unknown) => (v instanceof Kw ? v.name : String(v));
// Every delivery in a set of facts, optionally for one person.
export const deliveriesOf = (fs: ReadonlyArray<Triple>, person?: string): Array<Stored> => {
  const by = new Map<string, Map<string, unknown>>();
  for (const f of fs) {
    if (!f.a.startsWith("delivery/") || typeof f.e !== "string") continue;
    const m = by.get(f.e) ?? new Map<string, unknown>();
    m.set(f.a, f.v);
    by.set(f.e, m);
  }
  return [...by]
    .map(([id, m]) => ({
      id,
      person: String(m.get("delivery/person")),
      send: String(m.get("delivery/send")),
      message: String(m.get("delivery/message")),
      content: Number(m.get("delivery/content")),
      via: name(m.get("delivery/via")),
      status: name(m.get("delivery/status")) === "uncertain" ? ("uncertain" as const) : ("sent" as const),
    }))
    .filter((d) => person === undefined || d.person === person);
};
