import { Result } from "effect";

export type Sexp =
  | { readonly _tag: "Sym"; readonly name: string; readonly at: number }
  | { readonly _tag: "Key"; readonly name: string; readonly at: number }
  | { readonly _tag: "Str"; readonly value: string; readonly at: number }
  | { readonly _tag: "Num"; readonly value: number; readonly at: number }
  | { readonly _tag: "List"; readonly items: ReadonlyArray<Sexp>; readonly at: number };

export interface Problem {
  readonly at: number;
  readonly message: string;
  readonly hint?: string;
}

class Unreadable extends Error {
  readonly at: number;
  constructor(at: number, message: string) {
    super(message);
    this.at = at;
  }
}

const TOKEN = /;[^\n]*|"(?:[^"\\]|\\.)*"|"|[()]|[^\s()";]+/g;

const unquote = (text: string, at: number): string => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreadable(at, 'a string escape it cannot read; use \\" \\\\ \\n \\t or \\uXXXX');
  }
};

const atom = (text: string, at: number): Sexp => {
  if (text === '"') throw new Unreadable(at, "a string never closes");
  if (text.startsWith('"')) return { _tag: "Str", value: unquote(text, at), at };
  if (text.startsWith(":")) return { _tag: "Key", name: text.slice(1), at };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { _tag: "Num", value: Number(text), at };
  return { _tag: "Sym", name: text, at };
};

export const read = (source: string): Result.Result<Sexp, Problem> => {
  const tokens = [...source.matchAll(TOKEN)].filter(([text]) => !text.startsWith(";"));
  let next = 0;
  const form = (): Sexp => {
    const token = tokens[next++];
    if (token === undefined) throw new Unreadable(source.length, "the rule ends before a ( closes");
    const [text] = token;
    if (text === ")") throw new Unreadable(token.index, "this ) closes nothing");
    if (text !== "(") return atom(text, token.index);
    const items: Array<Sexp> = [];
    while (tokens[next]?.[0] !== ")") items.push(form());
    next++;
    return { _tag: "List", items, at: token.index };
  };
  try {
    const top = form();
    const rest = tokens[next];
    return rest === undefined
      ? Result.succeed(top)
      : Result.fail({ at: rest.index, message: "one rule per source; this is a second form" });
  } catch (error) {
    if (error instanceof Unreadable) return Result.fail({ at: error.at, message: error.message });
    throw error;
  }
};
