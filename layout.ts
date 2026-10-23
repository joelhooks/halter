// The layout gate: every page at 375px and 1440px, in a real browser through agent-browser.
// At both widths nothing overflows the page sideways. At 375px no pre or table scrolls sideways, every
// h1 starts within 160px of the top, and every touch target is at least 44 by 44px. A link inside
// running text is exempt, as WCAG 2.5.8's inline exception allows; buttons, inputs, selects, summaries,
// sidenote toggles, footnote markers and links in the nav or footer are not.
// At 375px the text keeps one edge, E = max(1.25rem, env(safe-area-inset-left)) (UPDATE-32, the
// "one text edge" addendum): the text of every p, h1 to h4, header, footer and pre starts at E; every
// list item starts at E plus 2ch per marked list it sits in; nothing ends past the width minus E. On
// the root, bridge and language pages the ragged right, the gap at the end of each line but the last,
// has a median of 3ch or less and a p90 of 6ch or less. Text set in on purpose (table cells, notes,
// the workspace's bordered panels, svg) is outside the edge check; the report counts what was measured.
// Marks inside a sentence (UPDATE-35): at 375px no gap between line tops in a p or li is more than
// 1.15 times that block's median gap, a line holding a superscript or margin toggle is no taller than
// the median, two adjacent sup.cite sit at most 1ch apart, and each mark's tap area, the pseudo-element
// drawn round it, is still at least 44 by 44px. The mark itself is measured by that area, not its box.
// Run: bun layout.ts [base-url]. It serves dist itself when no base is given.
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const dist = `${here}dist`;
const session = "halter-layout";
const ab = (...args: Array<string>): string => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 60_000 });

const pages = (dir: string, base = ""): Array<string> =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) return pages(p, `${base}/${f}`);
    return f === "index.html" ? [`${base}/`] : [];
  });

const MEASURE = `(() => {
  const W = document.documentElement.clientWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "") + " " + (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)).trim();
  const sideways = (el) => el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX);
  const scrollers = [...document.querySelectorAll("body *")].filter((el) => visible(el) && sideways(el));
  const preScroll = scrollers.filter((el) => el.tagName === "PRE" || el.querySelector("pre") || el.closest("pre")).map(name);
  const tableScroll = scrollers.filter((el) => el.tagName === "TABLE" || el.querySelector("table")).map(name);
  const wide = [...document.querySelectorAll("body *")].filter((el) => visible(el) && el.getBoundingClientRect().right > W + 1 && !el.closest("[aria-hidden=true]") && !scrollers.some((s) => s !== el && s.contains(el))).map(name).slice(0, 5);
  // text that spills out of its box: named by its parent when no element box is past the edge
  if (wide.length === 0 && document.documentElement.scrollWidth > W + 1) {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n && wide.length < 5; n = tw.nextNode()) {
      const r = document.createRange();
      r.selectNodeContents(n);
      if ([...r.getClientRects()].some((x) => x.right > W + 1)) wide.push("text in " + name(n.parentElement));
    }
  }
  const h1 = document.querySelector("h1");
  const h1Top = h1 ? Math.round(h1.getBoundingClientRect().top + scrollY) : -1;
  const inline = (a) => {
    if (a.closest("nav, footer, .site-nav, .breadcrumb")) return false;
    if (a.closest("sup") || a.classList.contains("footnote-ref")) return false;
    const block = a.closest("p, li, td, dd, figcaption, blockquote, span.sidenote, span.marginnote");
    if (!block) return false;
    return (block.textContent || "").trim().length > (a.textContent || "").trim().length + 2;
  };
  const targets = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, label.margin-toggle, [role=button]")]
    .filter((el) => visible(el) && !(el.tagName === "A" && inline(el)) && !(el.tagName === "INPUT" && el.type === "checkbox" && getComputedStyle(el).display === "none"));
  // a mark in a sentence: its tap area is the absolutely placed pseudo-element centred on it
  const MARK = "sup a, a.footnote-ref, label.margin-toggle";
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    if (!el.matches(MARK)) return { w: r.width, h: r.height, mark: false };
    const ps = getComputedStyle(el, el.matches("label.sidenote-number") ? "::before" : "::after");
    if (ps.content === "none" || ps.position !== "absolute" || ps.display === "none") return { w: r.width, h: r.height, mark: true };
    return { w: Math.max(r.width, parseFloat(ps.width) || 0), h: Math.max(r.height, parseFloat(ps.height) || 0), mark: true };
  };
  const small = targets.filter((el) => { const r = hit(el); return r.w < 44 - 0.5 || r.h < 44 - 0.5; }).map((el) => { const r = hit(el); return name(el) + " " + Math.round(r.w) + "x" + Math.round(r.h); });
  const marks = targets.filter((el) => el.matches(MARK)).length;
  // line tops in every p and li: text outside marks, grouped into lines by vertical midpoint
  const SKIP = "sup, label.margin-toggle, .sidenote, .marginnote, .cite-note, ul, ol, pre, table, svg";
  const lineGaps = [];
  let blocks = 0;
  for (const b of document.querySelectorAll("main p, main li")) {
    if (!visible(b) || b.closest(".sidenote, .marginnote, .cite-note, table, nav, .ws")) continue;
    const rects = [];
    const tw = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.data.trim() || n.parentElement.closest(SKIP) && b.contains(n.parentElement.closest(SKIP))) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const x of rg.getClientRects()) if (x.height > 0) rects.push({ top: x.top, bottom: x.bottom });
    }
    const markEls = [...b.querySelectorAll(MARK)].filter((m) => m.closest("p, li") === b && visible(m)).map((m) => m.getBoundingClientRect());
    rects.sort((x, y) => x.top - y.top);
    const lines = [];
    for (const x of rects) {
      const mid = (x.top + x.bottom) / 2;
      const last = lines[lines.length - 1];
      if (last && mid >= last.top && mid <= last.bottom) { last.top = Math.min(last.top, x.top); last.bottom = Math.max(last.bottom, x.bottom); }
      else lines.push({ top: x.top, bottom: x.bottom });
    }
    if (lines.length < 2) continue;
    blocks++;
    const gaps = lines.slice(1).map((l, i) => l.top - lines[i].top);
    const sorted = [...gaps].sort((x, y) => x - y);
    const lh = parseFloat(getComputedStyle(b).lineHeight);
    const median = gaps.length >= 2 ? sorted[Math.floor(sorted.length / 2)] : (isFinite(lh) ? lh : gaps[0]);
    gaps.forEach((g, i) => {
      const hasMark = markEls.some((m) => { const mid = (m.top + m.bottom) / 2; return [lines[i], lines[i + 1]].some((l) => mid >= l.top - 2 && mid <= l.bottom + 2); });
      if (g > median * 1.15 + 0.5) lineGaps.push(name(b).slice(0, 40) + ": gap " + Math.round(g) + "px, median " + Math.round(median) + (hasMark ? " (mark)" : ""));
      else if (hasMark && g > median + 1) lineGaps.push(name(b).slice(0, 40) + ": a mark makes a line " + Math.round(g - median) + "px taller");
    });
  }
  // adjacent cites: nothing but spaces and hidden notes between them, on one line, at most 1ch apart
  const citeGaps = [];
  let citePairs = 0;
  for (const a of document.querySelectorAll("sup.cite")) {
    if (!visible(a)) continue;
    let n = a.nextSibling, ok = true;
    while (n && !(n.nodeType === 1 && n.matches("sup.cite"))) {
      if (n.nodeType === 3 ? n.data.trim() : getComputedStyle(n).display !== "none") { ok = false; break; }
      n = n.nextSibling;
    }
    if (!ok || !n || !visible(n)) continue;
    // the glyphs, not the boxes: a range over each mark's text
    const ink = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
    const ra = ink(a), rb = ink(n);
    if (Math.abs(ra.top - rb.top) > 2) continue;
    citePairs++;
    const z = document.createElement("span");
    z.textContent = "0".repeat(10);
    z.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
    a.parentElement.appendChild(z);
    const ch = z.getBoundingClientRect().width / 10;
    z.remove();
    if (rb.left - ra.right > ch + 0.5) citeGaps.push(name(a) + " " + name(n) + ": " + Math.round(rb.left - ra.right) + "px apart, 1ch is " + Math.round(ch));
  }
  // margin notes never overlap each other (UPDATE-32 §2)
  const notes = [...document.querySelectorAll(".sidenote, .marginnote, .cite-note")].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i].r, b = notes[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(name(notes[i].el) + " / " + name(notes[j].el));
    }
  // the prose measure in characters of the paragraph's own font
  const measure = (() => {
    const p = [...document.querySelectorAll("main > p")].find((x) => !x.classList.contains("status")) ?? document.querySelector("main > p");
    if (!p) return 0;
    const s = document.createElement("span");
    s.textContent = "0".repeat(20);
    p.appendChild(s);
    const ch = s.getBoundingClientRect().width / 20;
    s.remove();
    return Math.round((p.getBoundingClientRect().width / ch) * 10) / 10;
  })();
  return JSON.stringify({ W, notes: notes.length, overlaps, measure, overflow: document.documentElement.scrollWidth > W + 1, scrollW: document.documentElement.scrollWidth, wide, preScroll, tableScroll, h1Top, targets: targets.length, small, marks, blocks, lineGaps, citePairs, citeGaps });
})()`;

const EDGE = `(() => {
  const W = document.documentElement.clientWidth;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:var(--E, 0px)";
  document.querySelector("main").appendChild(probe);
  const E = probe.getBoundingClientRect().width;
  probe.style.width = "1ch";
  const ch = probe.getBoundingClientRect().width;
  probe.remove();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const SET_IN = "table, .sidenote, .marginnote, blockquote, svg, ul.findings, .ws-feed, ol.hist, .cards, .commit, .multiples, .side-by-side, .got-rows, .tabs, .outcomes, .legend, details.src > summary";
  // where the ink is: each run of non-space characters, so a tap area's padding or a hanging space
  // at the end of a pre-wrap line doesn't count as text
  const rects = (el) => {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      for (const m of n.data.matchAll(/\\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        for (const x of r.getClientRects()) if (x.width > 0.5 && x.height > 0.5) out.push(x);
      }
    }
    return out;
  };
  const label = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : "") + " " + (el.textContent || "").trim().slice(0, 24);
  const r1 = (x) => Math.round(x * 10) / 10;
  const starts = [], ends = [];
  let measured = 0;
  const textEls = [...document.querySelectorAll("main p, main h1, main h2, main h3, main h4, main pre, body > header .brand, body > footer")]
    .filter((el) => visible(el) && !el.closest(SET_IN) && !el.closest("li"));
  for (const el of textEls) {
    const rs = rects(el);
    if (!rs.length) continue;
    measured++;
    const left = Math.min(...rs.map((x) => x.left));
    // a sentence that starts with a link or a mark may start a little in; nothing may start before E
    const want = E;
    if (want !== null && Math.abs(left - want) > 1) starts.push(label(el) + " at " + r1(left));
    const right = Math.max(...rs.map((x) => x.right));
    if (right > W - E + 1) ends.push(label(el) + " ends " + r1(right));
  }
  const marked = (l) => getComputedStyle(l).listStyleType !== "none";
  const lis = [...document.querySelectorAll("main li")].filter((el) => visible(el) && !el.closest(SET_IN));
  for (const li of lis) {
    measured++;
    // 2ch of each list's own font, per marked list the item sits in
    let level = 0, indent = 0;
    const base = parseFloat(getComputedStyle(document.querySelector("main")).fontSize);
    for (let a = li.parentElement; a && a.tagName !== "MAIN"; a = a.parentElement)
      if ((a.tagName === "UL" || a.tagName === "OL") && marked(a)) { level++; indent += 2 * ch * parseFloat(getComputedStyle(a).fontSize) / base; }
    const left = li.getBoundingClientRect().left;
    if (Math.abs(left - (E + indent)) > 1) starts.push(label(li) + " level " + level + " at " + r1(left));
    const rs = rects(li);
    if (rs.length && Math.max(...rs.map((x) => x.right)) > W - E + 1) ends.push(label(li) + " ends " + r1(Math.max(...rs.map((x) => x.right))));
  }
  // the ragged right: prose and list items with no block inside
  const gaps = [];
  const prose = [...document.querySelectorAll("main p, main li")].filter((el) => visible(el) && !el.closest(SET_IN) && !el.closest("figure, nav, .ws-live") && !el.querySelector("p, ul, ol, pre, div, table, br"));
  for (const el of prose) {
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const edge = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    // a line is the run of rects that overlap it vertically, so a raised [2] stays on its line
    const lines = [];
    for (const x of rects(el)) {
      const last = lines[lines.length - 1];
      const overlap = last ? Math.min(last.bottom, x.bottom) - Math.max(last.top, x.top) : 0;
      if (last && overlap > 0.3 * Math.min(last.bottom - last.top, x.height)) {
        last.right = Math.max(last.right, x.right);
        last.top = Math.min(last.top, x.top);
        last.bottom = Math.max(last.bottom, x.bottom);
      } else lines.push({ top: x.top, bottom: x.bottom, right: x.right });
    }
    const ordered = lines.map((l) => l.right);
    const own = ch * parseFloat(cs.fontSize) / parseFloat(getComputedStyle(document.querySelector("main")).fontSize);
    for (const end of ordered.slice(0, -1)) gaps.push({ gap: Math.max(0, edge - end) / own, at: label(el) });
  }
  gaps.sort((a, b) => a.gap - b.gap);
  const q = (f) => (gaps.length ? r1(gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))].gap) : 0);
  const worst = gaps.slice(-6).reverse().map((g) => r1(g.gap) + "ch " + g.at);
  return JSON.stringify({ E: r1(E), ch: r1(ch), measured, starts, ends, lines: gaps.length, median: q(0.5), p90: q(0.9), max: q(1), worst });
})()`;

interface Edge {
  readonly E: number;
  readonly ch: number;
  readonly measured: number;
  readonly starts: ReadonlyArray<string>;
  readonly ends: ReadonlyArray<string>;
  readonly lines: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
  readonly worst: ReadonlyArray<string>;
}
const RAGGED = new Set(["/", "/paths/small-tools-bridge/", "/language/"]);

interface Row {
  readonly page: string;
  readonly width: number;
  readonly W: number;
  readonly overflow: boolean;
  readonly scrollW: number;
  readonly wide: ReadonlyArray<string>;
  readonly preScroll: ReadonlyArray<string>;
  readonly tableScroll: ReadonlyArray<string>;
  readonly h1Top: number;
  readonly targets: number;
  readonly small: ReadonlyArray<string>;
  readonly notes: number;
  readonly marks: number;
  readonly blocks: number;
  readonly lineGaps: ReadonlyArray<string>;
  readonly citePairs: number;
  readonly citeGaps: ReadonlyArray<string>;
  readonly overlaps: ReadonlyArray<string>;
  readonly measure: number;
  readonly edge?: Edge;
}

const given = process.argv[2];
const port = 48799;
const server = given ? undefined : spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: dist, stdio: "ignore" });
const base = given ?? `http://127.0.0.1:${port}`;
await new Promise((r) => setTimeout(r, given ? 0 : 800));

const rows: Array<Row> = [];
try {
  for (const width of [375, 1440]) {
    ab("set", "viewport", String(width), width === 375 ? "812" : "900");
    for (const page of pages(dist).sort()) {
      ab("open", `${base}${page}`);
      // the workspace program mounts after the static page paints
      if (page.startsWith("/paths/") && page !== "/paths/") ab("wait", "2500");
      const out = ab("eval", MEASURE).trim();
      const json = JSON.parse(JSON.parse(out)) as Omit<Row, "page" | "width">;
      const edge = width === 375 ? (JSON.parse(JSON.parse(ab("eval", EDGE).trim())) as Edge) : undefined;
      rows.push({ page, width, ...json, ...(edge ? { edge } : {}) });
    }
  }
} finally {
  server?.kill();
  try {
    ab("close");
  } catch {
    // already closed
  }
}

const fails: Array<string> = [];
for (const r of rows) {
  if (r.width === 1440 && r.measure > 70.5) fails.push(`${r.page} @1440: prose measure ${r.measure}ch, over 70`);
  if (r.overlaps.length) fails.push(`${r.page} @${r.width}: ${r.overlaps.length} margin notes overlap: ${r.overlaps.slice(0, 3).join(" | ")}`);
  if (r.overflow) fails.push(`${r.page} @${r.width}: page scrolls sideways (${r.scrollW}px > ${r.W}px): ${r.wide.join(" | ")}`);
  if (r.width === 375) {
    if (r.preScroll.length) fails.push(`${r.page} @375: ${r.preScroll.length} pre scroll sideways: ${r.preScroll.slice(0, 3).join(" | ")}`);
    if (r.tableScroll.length) fails.push(`${r.page} @375: ${r.tableScroll.length} tables scroll sideways: ${r.tableScroll.slice(0, 3).join(" | ")}`);
    if (r.h1Top > 160) fails.push(`${r.page} @375: h1 starts at ${r.h1Top}px`);
    if (r.lineGaps.length) fails.push(`${r.page} @375: ${r.lineGaps.length} line gaps over 1.15x the block's median: ${r.lineGaps.slice(0, 3).join(" | ")}`);
    if (r.citeGaps.length) fails.push(`${r.page} @375: ${r.citeGaps.length} adjacent cites more than 1ch apart: ${r.citeGaps.slice(0, 3).join(" | ")}`);
    if (r.small.length) fails.push(`${r.page} @375: ${r.small.length} of ${r.targets} touch targets under 44px: ${r.small.slice(0, 4).join(" | ")}`);
    const e = r.edge;
    if (e) {
      if (e.starts.length) fails.push(`${r.page} @375: ${e.starts.length} of ${e.measured} texts off the edge E=${e.E}px: ${e.starts.slice(0, 4).join(" | ")}`);
      if (e.ends.length) fails.push(`${r.page} @375: ${e.ends.length} texts end past ${r.W - e.E}px: ${e.ends.slice(0, 4).join(" | ")}`);
      if (RAGGED.has(r.page) && (e.median > 3 || e.p90 > 6)) fails.push(`${r.page} @375: ragged right median ${e.median}ch, p90 ${e.p90}ch over ${e.lines} lines (at most 3ch and 6ch); widest: ${e.worst.join(" | ")}`);
    }
  }
}
writeFileSync(`${here}layout-report.json`, JSON.stringify(rows, null, 2));
const at375 = rows.filter((r) => r.width === 375);
const h1Max = Math.max(...at375.map((r) => r.h1Top));
const targetCount = at375.reduce((n, r) => n + r.targets, 0);
if (fails.length) {
  for (const f of fails) console.log(`not ok ${f}`);
  console.log(`layout: ${fails.length} failures over ${rows.length} page loads`);
  process.exit(1);
}
const measured = at375.reduce((n, r) => n + (r.edge?.measured ?? 0), 0);
const ragged = at375.filter((r) => RAGGED.has(r.page)).map((r) => `${r.page} ${r.edge?.median}/${r.edge?.p90}/${r.edge?.max}ch`);
const at1440 = rows.filter((r) => r.width === 1440);
const noteCount = at1440.reduce((n, r) => n + r.notes, 0);
const measureMax = Math.max(...at1440.map((r) => r.measure));
console.log(`layout ok: ${at375.length} pages at 375px and 1440px, no sideways page, pre or table scroll; h1 at most ${h1Max}px down; ${targetCount} touch targets all at least 44px`);
console.log(`desktop ok: ${noteCount} margin notes at 1440px, none overlapping; widest prose measure ${measureMax}ch (at most 70)`);
console.log(`lines ok: ${at375.reduce((n, r) => n + r.blocks, 0)} paragraphs and list items at 375px keep even line gaps (none over 1.15x the median); ${at375.reduce((n, r) => n + r.marks, 0)} marks in sentences add no height and keep 44px tap areas; ${at375.reduce((n, r) => n + r.citePairs, 0)} adjacent cite pairs within 1ch`);
console.log(`edge ok: ${measured} texts at 375px start on E=${at375[0]?.edge?.E}px (lists 2ch per level) and end by ${(at375[0]?.W ?? 375) - (at375[0]?.edge?.E ?? 0)}px; ragged right median/p90/max: ${ragged.join(", ")}`);
