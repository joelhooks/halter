// Content: what a person receives. A message has one rendition per channel, and bodies are
// content refs, never inline text. Structure (the path) names message ids; this file declares them.
// It prints as its own file, so a copy edit never shows up as a structure diff.
import { form, layout, pairs } from "./fit.ts";
import { Result } from "effect";
import { read, type Problem, type Sexp } from "./read.ts";
import { kw, Kw, type Triple, type Val } from "./db.ts";
import { CHANNELS, SAFE, type Channel } from "./model.ts";

export interface Message {
  readonly id: string;
  readonly email?: { readonly subject: string; readonly body: string };
  readonly sms?: { readonly body: string };
  readonly site?: { readonly page: string };
}

export const MESSAGE = "message/";
export const messageId = (id: string) => `${MESSAGE}${id}`;
export const renditionId = (id: string, ch: Channel) => `${messageId(id)}/${ch}`;
export const channelsOf = (m: Message): ReadonlyArray<Channel> => CHANNELS.filter((c) => m[c] !== undefined);

export const contentFacts = (ms: ReadonlyArray<Message>): Array<Triple> => {
  const out: Array<Triple> = [];
  const put = (e: string, a: string, v: Val | undefined) => {
    if (v !== undefined) out.push({ e, a, v });
  };
  for (const m of ms) {
    put(messageId(m.id), "message/id", m.id);
    for (const ch of channelsOf(m)) {
      const r = renditionId(m.id, ch);
      put(r, "rendition/message", messageId(m.id));
      put(r, "rendition/channel", kw(ch));
    }
    if (m.email) {
      put(renditionId(m.id, "email"), "rendition/subject", m.email.subject);
      put(renditionId(m.id, "email"), "rendition/body", m.email.body);
    }
    if (m.sms) put(renditionId(m.id, "sms"), "rendition/body", m.sms.body);
    if (m.site) put(renditionId(m.id, "site"), "rendition/page", m.site.page);
  }
  return out;
};

// The inverse of contentFacts: every declared message, sorted by id.
export const messagesFrom = (triples: ReadonlyArray<Triple>): Array<Message> => {
  const get = (e: string, a: string) => {
    const v = triples.find((t) => t.e === e && t.a === a)?.v;
    return typeof v === "string" ? v : undefined;
  };
  const ids = triples.filter((t) => t.a === "message/id" && typeof t.v === "string").map((t) => String(t.v));
  const has = (id: string, ch: Channel) => triples.some((t) => t.e === renditionId(id, ch) && t.a === "rendition/channel" && t.v instanceof Kw && t.v.name === ch);
  return [...new Set(ids)].sort().map((id) => {
    const e = renditionId(id, "email");
    const s = renditionId(id, "sms");
    const p = renditionId(id, "site");
    return {
      id,
      ...(has(id, "email") ? { email: { subject: get(e, "rendition/subject") ?? "", body: get(e, "rendition/body") ?? "" } } : {}),
      ...(has(id, "sms") ? { sms: { body: get(s, "rendition/body") ?? "" } } : {}),
      ...(has(id, "site") ? { site: { page: get(p, "rendition/page") ?? "" } } : {}),
    };
  });
};

const q = JSON.stringify;
export const printMessage = (m: Message): string =>
  layout(
    form("message", [
      q(m.id),
      m.email && form("email", pairs([["subject", q(m.email.subject)], ["body", q(m.email.body)]])),
      m.sms && form("sms", pairs([["body", q(m.sms.body)]])),
      m.site && form("site", pairs([["page", q(m.site.page)]])),
    ]),
  );
// The content file: messages sorted by id, one blank line apart.
export const printContent = (ms: ReadonlyArray<Message>): string =>
  `${[...ms]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(printMessage)
    .join("\n\n")}\n`;

export interface ReadContent {
  readonly messages: ReadonlyArray<Message>;
  readonly triples: ReadonlyArray<Triple>;
  readonly problems: ReadonlyArray<Problem>;
}

const KEYS: Record<Channel, ReadonlyArray<string>> = { email: ["subject", "body"], sms: ["body"], site: ["page"] };

export const readContent = (source: string): ReadContent => {
  const problems: Array<Problem> = [];
  // The reader takes one form, so the file is read as one list; positions shift back by one.
  const r = read(`(${source}\n)`);
  if (Result.isFailure(r)) return { messages: [], triples: [], problems: [{ ...r.failure, at: Math.max(0, r.failure.at - 1) }] };
  const refuse = (at: number, message: string, hint?: string) => problems.push({ at: Math.max(0, at - 1), message, ...(hint === undefined ? {} : { hint }) });
  const top = r.success;
  const messages: Array<Message> = [];
  const seen = new Set<string>();
  for (const f of top._tag === "List" ? top.items : []) {
    const items = f._tag === "List" ? f.items : [];
    if (items[0]?._tag !== "Sym" || items[0].name !== "message") {
      refuse(f.at, "the content file holds (message …) forms only", "structure (paths, checks, queries) goes in the structure file");
      continue;
    }
    const idf = items[1];
    const id = idf?._tag === "Str" && SAFE.test(idf.value) ? idf.value : undefined;
    if (id === undefined) {
      refuse(idf?.at ?? f.at, 'a message needs an id like "p1": plain lower-case letters, digits and dashes');
      continue;
    }
    if (seen.has(id)) refuse(f.at, `message ${id} is declared twice`);
    seen.add(id);
    const m: { -readonly [K in keyof Message]: Message[K] } = { id };
    for (const rf of items.slice(2)) {
      const ri = rf._tag === "List" ? rf.items : [];
      const ch = ri[0]?._tag === "Sym" ? ri[0].name : undefined;
      if (ch === undefined || !(CHANNELS as ReadonlyArray<string>).includes(ch)) {
        refuse(rf.at, `message ${id}: a rendition is (email …), (sms …) or (site …)`);
        continue;
      }
      const c = ch as Channel;
      if (m[c] !== undefined) refuse(rf.at, `message ${id} has two ${c} renditions`);
      const vals = new Map<string, string>();
      for (let i = 1; i < ri.length; i += 2) {
        const k = ri[i];
        const v = ri[i + 1];
        if (k?._tag !== "Key" || !KEYS[c].includes(k.name)) refuse(k?.at ?? rf.at, `(${c} …) takes ${KEYS[c].map((x) => `:${x}`).join(" and ")}`);
        else if (v?._tag !== "Str") refuse(v?.at ?? k.at, `:${k.name} needs a "string"`);
        else vals.set(k.name, v.value);
      }
      const missing = KEYS[c].filter((k) => !vals.has(k));
      if (missing.length) {
        refuse(rf.at, `(${c} …) needs ${missing.map((x) => `:${x}`).join(" and ")}`, c === "site" ? undefined : "bodies are content refs, like \"p1.email\", never inline text");
        continue;
      }
      if (c === "email") m.email = { subject: vals.get("subject") ?? "", body: vals.get("body") ?? "" };
      else if (c === "sms") m.sms = { body: vals.get("body") ?? "" };
      else m.site = { page: vals.get("page") ?? "" };
    }
    messages.push(m);
  }
  return { messages, triples: problems.length ? [] : contentFacts(messages), problems };
};
