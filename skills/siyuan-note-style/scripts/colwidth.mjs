#!/usr/bin/env node
// 表格列宽计算：读 markdown 表格，输出可直接粘的 colgroup IAL
//
// 用法：
//   node colwidth.mjs < table.md          # 输出 {: colgroup="…" style="…"}
//   node colwidth.mjs --json < table.md   # 只输出 [219,126,235]
//   node colwidth.mjs table.md            # 也可直接给文件名
//
// 规则：min-width 下限 72px、上限 620px（思源 td,th 有 max-width: 620px）；总宽 < 560px 时按比例撑到 560

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
const src = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");

const textPx = (s) => {
  let w = 0;
  let code = false;
  for (const ch of String(s)) {
    if (ch === "`") { code = !code; continue; }
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300;
    w += wide ? 16 : code ? 9.8 : 8.4;
  }
  return w;
};

const rows = src
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("|") && !l.startsWith("{:"))
  .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim()))
  .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));   // 去掉分隔行

if (!rows.length) {
  console.error("没读到表格行（需要 markdown 管道表）");
  process.exit(1);
}

const nCol = Math.max(...rows.map((r) => r.length));
const need = new Array(nCol).fill(0);
for (const cells of rows) {
  for (let i = 0; i < nCol; i++) need[i] = Math.max(need[i], textPx(cells[i] ?? ""));
}
let px = need.map((v) => Math.min(Math.max(Math.ceil((v + 20) * 1.06), 72), 620));
const total = px.reduce((a, b) => a + b, 0);
if (total < 560) px = px.map((x) => Math.min(Math.ceil((x * 560) / total), 620));

if (asJson) {
  console.log(JSON.stringify(px));
} else {
  console.log(`{: colgroup="${px.map((n) => `min-width: ${n}px`).join("|")}" style="text-align: center"}`);
}
