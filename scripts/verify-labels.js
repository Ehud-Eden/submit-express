const fs = require("fs");
const path = require("path");

const siteDir = path.join(__dirname, "..", "site");
const data = JSON.parse(
  fs.readFileSync(path.join(siteDir, "assets", "data", "app-data.json"), "utf-8")
);

function norm(s) {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function textContent(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const failures = [];
let checked = 0;

for (const [stem, page] of Object.entries(data.pages)) {
  const htmlFile = path.join(siteDir, stem, "index.html");
  if (!fs.existsSync(htmlFile)) {
    failures.push(`${stem}: HTML missing`);
    continue;
  }
  const html = fs.readFileSync(htmlFile, "utf-8");
  const items = [];
  const liRe = /<li class="task-list-item">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const inner = m[1];
    const afterLabel = inner.replace(/^[\s\S]*?<\/label>/, "");
    items.push(norm(textContent(afterLabel)));
  }

  const expected = page.tasks.map((t) => t.norm);
  if (items.length !== expected.length) {
    failures.push(
      `${stem}: count mismatch got=${items.length} expected=${expected.length}`
    );
    continue;
  }
  expected.forEach((e, i) => {
    checked++;
    if (items[i] !== e) {
      failures.push(`${stem}[${i}]: "${items[i]}" !== "${e}"`);
    }
  });
}

if (failures.length) {
  console.log(`${failures.length} failure(s) on ${checked} labels:`);
  failures.slice(0, 40).forEach((f) => console.log("  - " + f));
  process.exit(1);
} else {
  console.log(`OK: ${checked} labels match between DOM and app-data.json`);
}