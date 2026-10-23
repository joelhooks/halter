// Port of hl.py: the Lisp highlighter, now with [datom] brackets and ?vars.
const TOK = /(;[^\n]*)|("(?:[^"\\]|\\.)*")|([(\[])|([)\]])|(\s+)|([^\s()\[\]";]+)/g;
const FORMS = new Set(["path", "query", "check", "guard", "when", "else", "and", "or", "not", "count", "state", "to", "send", "vary", "offer", "window", "early-bird", "class", "enters-on", "exit-on", "pace", "rate", "ramp", "waive", "dimension", "tx", "assert", "retract", "skip", "defer"]);
const BARE = new Set(["true", "false", "refuse", "alarm", "closed", "done", "exited", "asked", "observed", "inferred", "assumed"]);

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const highlight = (src: string): string => {
  const out: Array<string> = [];
  let afterOpen = false;
  let depth = 0;
  for (const m of src.matchAll(TOK)) {
    const t = m[0];
    const e = esc(t);
    if (m[5] !== undefined) {
      out.push(e);
      continue;
    }
    if (m[3] !== undefined) {
      out.push(`<span class="p p${depth % 3}">${e}</span>`);
      depth++;
      afterOpen = t === "(";
      continue;
    }
    if (m[4] !== undefined) {
      depth = Math.max(0, depth - 1);
      out.push(`<span class="p p${depth % 3}">${e}</span>`);
      afterOpen = false;
      continue;
    }
    let cls: string;
    if (m[1] !== undefined) cls = "c";
    else if (m[2] !== undefined) cls = "s";
    else if (t.startsWith(":")) cls = "k";
    else if (t.startsWith("?") || t === "_") cls = "v";
    else if (/^-?\d+(\.\d+)?$|^\d+[mhd]$/.test(t)) cls = "n";
    else if (BARE.has(t)) cls = "b";
    else if (afterOpen) cls = FORMS.has(t) ? "f" : "h";
    else cls = "y";
    afterOpen = false;
    out.push(`<span class="${cls}">${e}</span>`);
  }
  return out.join("");
};

// One element per line so the page can number lines and mark the ones with problems.
export const numbered = (src: string, marks: ReadonlyMap<number, string> = new Map()): string =>
  highlight(src.replace(/\n$/, ""))
    .split("\n")
    .map((line, i) => {
      const mark = marks.get(i + 1);
      return `<span class="ln${mark ? ` ${mark}` : ""}" data-line="${i + 1}"><i>${i + 1}</i><span>${line || " "}</span></span>`;
    })
    .join("");

// Generated TypeScript: just enough colour to read it.
const TS = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:import|export|from|const|readonly|interface|type|return|undefined|true|false)\b)|(\b\d[\d_]*\b)|(\b[A-Za-z_$][\w$]*(?=\s*\())|([\s\S])/g;
export const highlightTs = (src: string): string => {
  const out: Array<string> = [];
  for (const m of src.matchAll(TS)) {
    const e = esc(m[0]);
    if (m[1] !== undefined) out.push(`<span class="c">${e}</span>`);
    else if (m[2] !== undefined) out.push(`<span class="s">${e}</span>`);
    else if (m[3] !== undefined) out.push(`<span class="f">${e}</span>`);
    else if (m[4] !== undefined) out.push(`<span class="n">${e}</span>`);
    else if (m[5] !== undefined) out.push(`<span class="h">${e}</span>`);
    else out.push(e);
  }
  return out.join("");
};
