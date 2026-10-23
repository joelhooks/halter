// The canonical layout: every halter form at 44 columns, the way LANGUAGE.md prints them (UPDATE-32).
// A form that fits prints on one line. One that doesn't keeps its name, its positional arguments and
// its first pair on the head line, if they fit, and puts every other pair on its own line, two spaces in.
// Body forms (path, offer, state, guard, when, vary, pace, message) put their children two spaces in;
// a call like (and A B) lines its arguments up under the first. A trailing comment that doesn't fit
// goes on its own line above its form, as ;;. Strings never break, so a long one can pass the edge.
import { read, type Sexp } from "./read.ts";
import { Result } from "effect";

export const WIDTH = 44;

export interface Form {
  readonly head: string;
  readonly items: ReadonlyArray<Node>;
  readonly trailing?: string;
}
export interface Comment {
  readonly comment: string;
}
export type Node = string | Form | Comment;

export const form = (head: string, items: ReadonlyArray<Node | undefined | false>, trailing?: string): Form => ({
  head,
  items: items.filter((x): x is Node => x !== undefined && x !== false),
  ...(trailing === undefined ? {} : { trailing }),
});
// key-value pairs, skipping absent values
export const pairs = (kvs: ReadonlyArray<readonly [string, Node | undefined]>): Array<Node> => kvs.flatMap(([k, v]) => (v === undefined ? [] : [`:${k}`, v]));

const isComment = (n: Node): n is Comment => typeof n === "object" && "comment" in n;
const isForm = (n: Node): n is Form => typeof n === "object" && "head" in n;
const isKey = (n: Node): n is string => typeof n === "string" && n.startsWith(":") && n.length > 1;

// Forms whose children are a body: how many positional arguments come before it.
const BODY: Readonly<Record<string, number>> = { path: 1, offer: 1, state: 1, guard: 0, when: 1, vary: 1, pace: 1, message: 1, dimension: 1, tx: 1 };
// Pairs these forms always print on their own lines.
const PAIRS_DOWN = new Set(["path"]);
// Keywords that stand alone, with no value.
const FLAGS = new Set([":hard", ":many"]);
// How many pairs a form keeps on its head line; one unless named here.
const HEAD_PAIRS: Readonly<Record<string, number>> = { tx: 2 };
// How far in a broken form's other pairs go; children still go two.
const PAIR_INDENT: Readonly<Record<string, number>> = { tx: 4 };

export const flat = (n: Node): string => {
  if (typeof n === "string") return n;
  if (isComment(n)) return "";
  return `(${[n.head, ...n.items.filter((x) => !isComment(x)).map(flat)].filter((x) => x !== "").join(" ")})`;
};
const hasComments = (n: Node): boolean => isForm(n) && n.items.some((x) => isComment(x) || hasComments(x));

interface Line {
  indent: number;
  text: string;
}
const wrapComment = (indent: number, prefix: string, text: string, width: number): Array<Line> => {
  const room = Math.max(20, width - indent - prefix.length - 1);
  const words = text.split(/\s+/).filter((w) => w !== "");
  const out: Array<Line> = [];
  let cur = "";
  for (const w of words) {
    if (cur !== "" && cur.length + 1 + w.length > room) {
      out.push({ indent, text: `${prefix} ${cur}` });
      cur = w;
    } else cur = cur === "" ? w : `${cur} ${w}`;
  }
  out.push({ indent, text: `${prefix} ${cur}`.trimEnd() });
  return out;
};

type Part = { readonly kind: "pos" | "flag" | "pair" | "kid" | "comment"; readonly node: Node; readonly key?: string };
const partsOf = (f: Form): Array<Part> => {
  const body = BODY[f.head];
  const out: Array<Part> = [];
  let pos = 0;
  let seenKey = false;
  const items = f.items;
  for (let i = 0; i < items.length; i++) {
    const n = items[i]!;
    if (isComment(n)) out.push({ kind: "comment", node: n });
    else if (isKey(n) && FLAGS.has(n)) out.push({ kind: "flag", node: n });
    else if (isKey(n) && i + 1 < items.length) {
      out.push({ kind: "pair", key: n, node: items[i + 1]! });
      seenKey = true;
      i++;
    } else if (!seenKey && (body === undefined || pos < body)) {
      out.push({ kind: "pos", node: n });
      pos++;
    } else out.push({ kind: "kid", node: n });
  }
  return out;
};

const over = (lines: ReadonlyArray<Line>, width: number) => lines.reduce((n, l) => n + Math.max(0, l.indent + l.text.length - width), 0);

const render = (n: Node, col: number, closes: number, width: number): Array<Line> => {
  if (typeof n === "string" || isComment(n)) return renderAs(n, col, closes, width, false);
  const aligned = renderAs(n, col, closes, width, false);
  if (over(aligned, width) === 0 || !partsOf(n).some((p) => p.kind === "pos" && isForm(p.node))) return aligned;
  const hung = renderAs(n, col, closes, width, true);
  return over(hung, width) < over(aligned, width) ? hung : aligned;
};

// hang: every positional argument on its own line, two spaces in, instead of lined up after the head
const renderAs = (n: Node, col: number, closes: number, width: number, hang: boolean): Array<Line> => {
  const shut = ")".repeat(closes);
  if (typeof n === "string") return [{ indent: col, text: n + shut }];
  if (isComment(n)) return wrapComment(col, ";", n.comment, width);
  const one = flat(n);
  // a call on atoms alone, like (did? "x"), has nowhere useful to break
  // and neither does a query clause, like (?o :offer/closes _)
  const atomsOnly = n.head !== "" && n.items.every((x) => typeof x === "string" && (n.head.startsWith("?") || !isKey(x)));
  if (!hasComments(n) && (col + one.length + closes <= width || atomsOnly)) {
    const line = one + shut;
    if (n.trailing === undefined) return [{ indent: col, text: line }];
    if (col + line.length + 3 + n.trailing.length <= width) return [{ indent: col, text: `${line} ; ${n.trailing}` }];
    return [...wrapComment(col, ";;", n.trailing, width), { indent: col, text: line }];
  }
  // a data list of plain words, like a dimension's values, fills its lines the way prose does
  if (n.head === "" && !hasComments(n) && n.items.length > 0 && n.items.every((x) => typeof x === "string" && !isKey(x))) {
    const out: Array<Line> = [];
    let cur = "(";
    for (const w of n.items as ReadonlyArray<string>) {
      const lead = out.length === 0 ? col : col + 1;
      const next = cur === "(" || cur === "" ? `${cur}${w}` : `${cur} ${w}`;
      if (cur !== "(" && cur !== "" && lead + next.length > width) {
        out.push({ indent: lead, text: cur });
        cur = w;
      } else cur = next;
    }
    out.push({ indent: out.length === 0 ? col : col + 1, text: `${cur})${shut}` });
    return out;
  }
  const parts = partsOf(n);
  const call = BODY[n.head] === undefined;
  const lastIdx = parts.length - 1;
  const lines: Array<Line> = [{ indent: col, text: `(${n.head}` }];
  const head = () => lines[0]!;
  let open = true;
  let headPairs = HEAD_PAIRS[n.head] ?? 1;
  let alignCol = -1;
  // a data list, (a b c), has no head word: its first item follows the paren directly
  const sep = () => (head().text === "(" ? "" : " ");
  const room = (extra: string, isLast: boolean) => col + head().text.length + sep().length + extra.length + (isLast ? closes + 1 : 0) <= width;
  const place = (node: Node, at: number, isLast: boolean, prefix = "") => {
    const sub = render(node, at + prefix.length, isLast ? closes + 1 : 0, width);
    if (prefix !== "") {
      sub[0] = { indent: at, text: prefix + sub[0]!.text };
    }
    lines.push(...sub);
  };
  parts.forEach((p, i) => {
    const isLast = i === lastIdx;
    if (p.kind === "comment") {
      open = false;
      lines.push(...wrapComment(col + 2, ";", (p.node as Comment).comment, width));
      return;
    }
    if (p.kind === "pos" || p.kind === "flag") {
      const text = flat(p.node);
      if (hang && p.kind === "pos" && isForm(p.node)) {
        open = false;
        place(p.node, col + 2, isLast);
        return;
      }
      if (open && !hasComments(p.node) && room(text, isLast)) {
        if (alignCol < 0) alignCol = col + head().text.length + sep().length;
        head().text += `${sep()}${text}${isLast ? ")".repeat(closes + 1) : ""}`;
        return;
      }
      // a breakable first argument keeps its head on the head line and breaks under itself
      if (open && alignCol < 0 && isForm(p.node)) {
        const at = col + head().text.length + sep().length;
        const sub = render(p.node, at, isLast ? closes + 1 : 0, width);
        if (at + sub[0]!.text.length <= width && sub.length > 1) {
          head().text += `${sep()}${sub[0]!.text}`;
          lines.push(...sub.slice(1));
          alignCol = at;
          open = false;
          return;
        }
      }
      open = false;
      place(p.node, call && alignCol >= 0 ? alignCol : col + 2, isLast);
      return;
    }
    if (p.kind === "pair") {
      const text = `${p.key} ${flat(p.node)}`;
      if (open && headPairs > 0 && !PAIRS_DOWN.has(n.head) && !hasComments(p.node) && room(text, isLast)) {
        head().text += ` ${text}${isLast ? ")".repeat(closes + 1) : ""}`;
        headPairs--;
        return;
      }
      headPairs = 0;
      open = false;
      place(p.node, col + (PAIR_INDENT[n.head] ?? 2), isLast, `${p.key} `);
      return;
    }
    open = false;
    place(p.node, col + 2, isLast);
  });
  if (parts.length === 0) head().text += ")".repeat(closes + 1);
  // a form that ends in a comment closes on its last line of code
  else if (parts[lastIdx]!.kind === "comment") {
    const code = lines.map((l) => l.text.trimStart().startsWith(";")).lastIndexOf(false);
    lines[code]!.text += ")".repeat(closes + 1);
  }
  if (n.trailing !== undefined) {
    const last = lines[lines.length - 1]!;
    if (last.indent + last.text.length + 3 + n.trailing.length <= width) last.text += ` ; ${n.trailing}`;
    else lines.splice(0, 0, ...wrapComment(col, ";;", n.trailing, width));
  }
  return lines;
};

export const layout = (n: Node, indent = 0, width = WIDTH): string =>
  render(n, indent, 0, width)
    .map((l) => `${" ".repeat(l.indent)}${l.text}`)
    .join("\n");

// Full-line comments at the top of a printout, wrapped to the width.
export const commentLines = (text: string, width = WIDTH): string =>
  wrapComment(0, ";", text, width)
    .map((l) => l.text)
    .join("\n");

// Any halter source, read and laid out again: queries and checks written by hand, for instance.
// Comments don't survive the reader, so a source with comments keeps its own layout.
const toNode = (s: Sexp): Node => {
  switch (s._tag) {
    case "Sym":
      return s.name;
    case "Key":
      return `:${s.name}`;
    case "Str":
      return JSON.stringify(s.value);
    case "Num":
      return String(s.value);
    case "List": {
      const [h, ...rest] = s.items;
      return h !== undefined && h._tag === "Sym" ? { head: h.name, items: rest.map(toNode) } : { head: "", items: s.items.map(toNode) };
    }
  }
};
// Source read into layout nodes, or undefined when it doesn't read.
export const readNodes = (src: string): ReadonlyArray<Node> | undefined => {
  const r = read(`(${src}\n)`);
  return Result.isFailure(r) || r.success._tag !== "List" ? undefined : r.success.items.map(toNode);
};
export const fitSource = (src: string, width = WIDTH): string => {
  if (/(^|\s);/.test(src.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return src;
  const r = read(`(${src}\n)`);
  if (Result.isFailure(r) || r.success._tag !== "List") return src;
  return r.success.items.map((s) => layout(toNode(s), 0, width)).join("\n\n");
};
