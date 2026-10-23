// A small markdown renderer for the wiki, with the Tufte extras:
//   ^[text]   a numbered sidenote        ^^[text]  an unnumbered margin note
//   [key]     a citation: a numbered footnote, one number per source per page   {{fig:x}} a figure
// Glossary terms link to the glossary on their first use on a page.
import { BIB_BY_KEY, CITE, titleOf, workText, type Term } from "./bib.ts";
import { esc, highlight, highlightTs } from "./hl.ts";

export interface Ctx {
  readonly page: string;
  readonly terms: ReadonlyArray<Term>;
  readonly figure: (name: string) => string;
  // per section: put list continuations in the margin, or a rule's sources in the margin
  readonly section?: (heading: string) => { readonly continuationsInMargin?: boolean; readonly citesInMargin?: boolean };
  used: Set<string>;
  cites: Array<string>;
  links: Set<string>;
  notes: number;
}
export const newCtx = (page: string, terms: ReadonlyArray<Term>, figure: Ctx["figure"], section?: Ctx["section"]): Ctx => ({
  page,
  terms,
  figure,
  ...(section ? { section } : {}),
  used: new Set(),
  cites: [],
  links: new Set(),
  notes: 0,
});

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const closing = (s: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > 0) i = j;
      continue;
    }
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
};

export const sidenote = (ctx: Ctx, html: string, numbered: boolean): string => {
  const id = `${numbered ? "sn" : "mn"}-${++ctx.notes}`;
  return numbered
    ? `<label for="${id}" class="margin-toggle sidenote-number"></label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="sidenote">${html}</span>`
    : `<label for="${id}" class="margin-toggle">&#8853;</label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="marginnote">${html}</span>`;
};

// A citation is a numbered footnote: one number per source per page, in order of first use.
// The key is internal; the page shows only the number, and the Sources list at the end says who.
export const citeNumber = (ctx: Ctx, key: string): number => {
  if (!ctx.cites.includes(key)) ctx.cites.push(key);
  return ctx.cites.indexOf(key) + 1;
};
export const citeMarker = (ctx: Ctx, key: string): string => {
  const e = BIB_BY_KEY.get(key);
  if (!e) return "";
  const first = !ctx.cites.includes(key);
  const n = citeNumber(ctx, key);
  const sup = `<sup class="cite"${first ? ` id="cite-${n}"` : ""}><a href="#source-${n}" title="${esc(e.short)}" aria-label="source ${n}: ${esc(e.short)}">[${n}]</a></sup>`;
  // On a wide screen the first citation of a source also sits in the margin beside the text.
  // The Sources list at the end stays the record, on every screen.
  return first ? `${sup}<span class="cite-note" aria-hidden="true">[${n}] ${esc(e.creators)}, ${esc(e.works.map((w) => titleOf(e, w)).join("; "))}${e.unpublished ? ` (${esc(e.unpublished)})` : ""}.</span>` : sup;
};

const glossed = (ctx: Ctx, text: string, link: boolean): string => {
  if (!link || ctx.page === "/glossary/") return esc(text);
  // Pieces already linked are never searched again, so links never nest.
  let pieces: Array<{ text: string; html?: string }> = [{ text }];
  for (const t of ctx.terms) {
    if (ctx.used.has(t.slug)) continue;
    const words = [t.term, ...(t.also ?? [])].sort((a, b) => b.length - a.length).map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    const re = new RegExp(`(^|[^\\w/#?:-])(${words.join("|")})(?![\\w-])`, "i");
    const i = pieces.findIndex((p) => p.html === undefined && re.test(p.text));
    const p = pieces[i];
    if (p === undefined) continue;
    const m = re.exec(p.text);
    if (!m) continue;
    ctx.used.add(t.slug);
    ctx.links.add("/glossary/");
    const at = m.index + (m[1]?.length ?? 0);
    const word = m[2] ?? "";
    pieces = [
      ...pieces.slice(0, i),
      { text: p.text.slice(0, at) },
      { text: word, html: `<a class="term" href="/glossary/#${t.slug}">${esc(word)}</a>` },
      { text: p.text.slice(at + word.length) },
      ...pieces.slice(i + 1),
    ];
  }
  return pieces.map((p) => p.html ?? esc(p.text)).join("");
};

export const inline = (s: string, ctx: Ctx, link = true): string => {
  let out = "";
  let plain = "";
  const flush = () => {
    out += glossed(ctx, plain, link);
    plain = "";
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    const rest = s.slice(i);
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i) {
        flush();
        out += `<code>${esc(s.slice(i + 1, j))}</code>`;
        i = j + 1;
        continue;
      }
    }
    if (rest.startsWith("^^[") || rest.startsWith("^[")) {
      const open = s.indexOf("[", i);
      const end = closing(s, open);
      if (end > 0) {
        flush();
        out += sidenote(ctx, inline(s.slice(open + 1, end), ctx, false), !rest.startsWith("^^"));
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const j = s.indexOf("**", i + 2);
      if (j > i) {
        flush();
        out += `<strong>${inline(s.slice(i + 2, j), ctx, link)}</strong>`;
        i = j + 2;
        continue;
      }
    }
    if (rest.startsWith("~~")) {
      const j = s.indexOf("~~", i + 2);
      if (j > i) {
        flush();
        out += `<del>${inline(s.slice(i + 2, j), ctx, false)}</del>`;
        i = j + 2;
        continue;
      }
    }
    if (c === "*" && /^\*[^\s*]/.test(rest)) {
      const j = s.indexOf("*", i + 1);
      if (j > i) {
        flush();
        out += `<em>${inline(s.slice(i + 1, j), ctx, link)}</em>`;
        i = j + 1;
        continue;
      }
    }
    if (c === "[") {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (lm) {
        flush();
        const href = lm[2] ?? "";
        if (href.startsWith("/")) ctx.links.add(href.replace(/#.*$/, ""));
        out += `<a href="${esc(href)}">${inline(lm[1] ?? "", ctx, false)}</a>`;
        i += lm[0].length;
        continue;
      }
      const cm = /^\[([a-z][a-z0-9-]{1,15})\]/.exec(rest);
      if (cm && BIB_BY_KEY.has(cm[1] ?? "")) {
        flush();
        out += citeMarker(ctx, cm[1] ?? "");
        i += cm[0].length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
};

const citesIn = (s: string) => [...s.matchAll(CITE)].map((m) => m[1] ?? "").filter((k) => BIB_BY_KEY.has(k));

interface Item {
  head: string;
  more: Array<string>;
  kids: Array<{ ordered: boolean; items: Array<Item> }>;
}

export const render = (src: string, ctx: Ctx): string => {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Array<string> = [];
  let section = "";
  let para: Array<string> = [];
  const opts = () => ctx.section?.(section) ?? {};
  const endPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), ctx)}</p>`);
    para = [];
  };
  const itemHtml = (it: Item): string => {
    const o = opts();
    let body: string;
    if (o.continuationsInMargin && it.more.length) {
      body = `${inline(it.head, ctx)}${sidenote(ctx, inline(it.more.join(" "), ctx, false), false)}`;
    } else body = inline([it.head, ...it.more].join(" "), ctx);
    if (o.citesInMargin) {
      const keys = citesIn([it.head, ...it.more].join(" "));
      if (keys.length) {
        const names = keys.map((k) => `[${citeNumber(ctx, k)}] ${esc(BIB_BY_KEY.get(k)?.short ?? "")}`).join("; ");
        body += sidenote(ctx, names, false);
      }
    }
    return `<li>${body}${it.kids.map(listHtml).join("")}</li>`;
  };
  const listHtml = (l: { ordered: boolean; items: Array<Item> }): string => {
    const o = opts();
    const noted = o.continuationsInMargin || o.citesInMargin ? ' class="noted"' : "";
    return `<${l.ordered ? "ol" : "ul"}${noted}>${l.items.map(itemHtml).join("")}</${l.ordered ? "ol" : "ul"}>`;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      endPara();
      const body: Array<string> = [];
      while (i + 1 < lines.length && !(lines[i + 1] ?? "").startsWith("```")) body.push(lines[++i] ?? "");
      i++;
      const code = body.join("\n");
      const lang = fence[1] ?? "";
      out.push(`<pre class="code ${lang === "lisp" ? "lisp" : lang}"><code>${lang === "lisp" ? highlight(code) : lang === "ts" || lang === "typescript" ? highlightTs(code) : esc(code)}</code></pre>`);
      continue;
    }
    const fig = /^\{\{fig:([\w:./-]+)\}\}$/.exec(line.trim());
    if (fig) {
      endPara();
      out.push(ctx.figure(fig[1] ?? ""));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      endPara();
      const level = Math.max(2, (h[1] ?? "").length);
      const text = h[2] ?? "";
      if (level === 2) section = text.replace(/`/g, "");
      out.push(`<h${level} id="${slugify(text)}">${inline(text, ctx, false)}</h${level}>`);
      continue;
    }
    if (line.startsWith("|")) {
      endPara();
      const rows: Array<Array<string>> = [];
      for (; i < lines.length && (lines[i] ?? "").startsWith("|"); i++) {
        const cells = (lines[i] ?? "").replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        rows.push(cells);
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c, ctx, false)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      endPara();
      // Collect the whole list, nesting by indent.
      const root = { ordered: /\d/.test(li[2] ?? ""), items: [] as Array<Item> };
      const stack: Array<{ indent: number; list: { ordered: boolean; items: Array<Item> } }> = [{ indent: (li[1] ?? "").length, list: root }];
      for (; i < lines.length; i++) {
        const l = lines[i] ?? "";
        if (l.trim() === "") {
          const next = lines[i + 1] ?? "";
          if (/^\s*([-*]|\d+\.)\s+/.test(next) || /^\s{2,}\S/.test(next)) continue;
          break;
        }
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
        if (m) {
          const indent = (m[1] ?? "").length;
          while (stack.length > 1 && indent < (stack.at(-1)?.indent ?? 0)) stack.pop();
          let top = stack.at(-1);
          if (top && indent > top.indent) {
            const parent = top.list.items.at(-1);
            if (parent) {
              const list = { ordered: /\d/.test(m[2] ?? ""), items: [] as Array<Item> };
              parent.kids.push(list);
              stack.push({ indent, list });
              top = stack.at(-1);
            }
          }
          top?.list.items.push({ head: m[3] ?? "", more: [], kids: [] });
        } else if (/^\s+\S/.test(l)) {
          const it = stack.at(-1)?.list.items.at(-1);
          it?.more.push(l.trim());
        } else break;
      }
      i--;
      out.push(listHtml(root));
      continue;
    }
    if (line.trim() === "") {
      endPara();
      continue;
    }
    para.push(line.trim());
  }
  endPara();
  return out.join("\n");
};

// The markdown twin of a page: notes become parentheses, figures their text form, and each
// citation a numbered footnote, [^1], defined at the end. Returns the keys in footnote order.
export const toMarkdown = (src: string, figure: (name: string) => string): { readonly text: string; readonly cites: ReadonlyArray<string> } => {
  const cites: Array<string> = [];
  const text = src
    .replace(/^\{\{fig:([\w:./-]+)\}\}$/gm, (_, name: string) => figure(name))
    .replace(/\^\^?\[((?:[^[\]]|\[[^\]]*\])*)\]/g, " ($1)")
    .replace(CITE, (m, key: string) => {
      if (!BIB_BY_KEY.has(key)) return m;
      if (!cites.includes(key)) cites.push(key);
      return `[^${cites.indexOf(key) + 1}]`;
    });
  return { text, cites };
};
export const footnotesMd = (cites: ReadonlyArray<string>): string =>
  cites
    .flatMap((k, i) => {
      const e = BIB_BY_KEY.get(k);
      return e ? [`[^${i + 1}]: ${workText(e)}. ${e.creators}. ${e.takes}`] : [];
    })
    .join("\n");

// One section of a markdown file, by its ## heading.
export const sectionOf = (md: string, heading: string): string => {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const end = md.indexOf("\n## ", start + 4);
  return md.slice(start + heading.length + 5, end < 0 ? undefined : end).trim();
};
