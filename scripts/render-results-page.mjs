import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INPUT = path.resolve("bench-results", "latest.log");
const DEFAULT_OUTPUT = path.resolve("index.html");
const DEFAULT_SOURCE_LABEL = "Auto-generated from benchmark output";

export function parseBenchOutput(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];

  for (const line of lines) {
    const parts = line.split(/\s*,\s*/);
    if (parts.length !== 3) {
      continue;
    }

    const [framework, test, timeText] = parts;
    if (framework === "framework" && test === "test" && timeText === "time") {
      continue;
    }

    const time = Number.parseFloat(timeText);
    if (!framework || !test || Number.isNaN(time)) {
      continue;
    }

    rows.push({ framework, test, time });
  }

  if (rows.length === 0) {
    throw new Error("No benchmark rows were found in the provided output.");
  }

  const tests = [];
  const seenTests = new Set();
  const byFramework = new Map();

  for (const row of rows) {
    if (!seenTests.has(row.test)) {
      seenTests.add(row.test);
      tests.push(row.test);
    }

    if (!byFramework.has(row.framework)) {
      byFramework.set(row.framework, {
        name: row.framework,
        entries: [],
        totals: 0,
      });
    }

    const framework = byFramework.get(row.framework);
    framework.entries.push({ test: row.test, time: row.time });
    framework.totals += row.time;
  }

  const frameworks = Array.from(byFramework.values())
    .map((framework) => ({
      ...framework,
      average: framework.totals / framework.entries.length,
      byTest: Object.fromEntries(
        framework.entries.map((entry) => [entry.test, entry.time])
      ),
    }))
    .sort((left, right) => left.average - right.average);

  return { rows, tests, frameworks };
}

function formatTime(value) {
  return value.toFixed(2);
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRows(frameworks) {
  return frameworks
    .map((framework, index) => {
      const winnerClass = index === 0 ? " winner" : "";
      return `<tr><td class="rank">${index + 1}</td><td class="framework${winnerClass}">${escapeHtml(framework.name)}</td><td class="time">${formatTime(framework.average)}</td></tr>`;
    })
    .join("");
}

function renderBars(frameworks) {
  const maxAverage = Math.max(...frameworks.map((framework) => framework.average));
  const colors = [
    "#0f766e",
    "#1d4ed8",
    "#7c3aed",
    "#c2410c",
    "#be123c",
    "#4f46e5",
    "#0f766e",
    "#1f2937",
  ];

  return frameworks
    .map((framework, index) => {
      const width = maxAverage === 0 ? 0 : (framework.average / maxAverage) * 100;
      const color = colors[index % colors.length];
      return `<div class="bar-row" style="--row-delay:${index * 60}ms"><div class="bar-label" title="${escapeHtml(framework.name)}">${escapeHtml(framework.name)}</div><div class="bar-track"><div class="bar-fill" style="--target-width:${width.toFixed(2)}%;--bar-color:${color}"></div></div><div class="bar-value">${formatTime(framework.average)}</div></div>`;
    })
    .join("");
}

function renderPerTestComparison(frameworks, tests) {
  return tests
    .map((test, testIndex) => {
      const ranked = frameworks
        .map((framework) => ({
          name: framework.name,
          time: framework.byTest[test],
        }))
        .filter((entry) => typeof entry.time === "number")
        .sort((left, right) => left.time - right.time);

      if (ranked.length === 0) {
        return "";
      }

      const fastest = ranked[0].time;
      const slowest = ranked[ranked.length - 1].time;

      const rows = ranked
        .map((entry, index) => {
          const relative =
            fastest === 0 ? 0 : ((entry.time - fastest) / fastest) * 100;
          const width =
            slowest === 0 ? 0 : (entry.time / slowest) * 100;

          return `<div class="comparison-row" style="--row-delay:${testIndex * 45 + index * 35}ms"><div class="comparison-rank">${index + 1}</div><div class="comparison-name${index === 0 ? " comparison-name-winner" : ""}">${escapeHtml(entry.name)}</div><div class="comparison-bar"><div class="comparison-bar-fill" style="--target-width:${width.toFixed(2)}%"></div></div><div class="comparison-time">${formatTime(entry.time)} ms</div><div class="comparison-delta">${index === 0 ? "best" : `+${relative.toFixed(1)}%`}</div></div>`;
        })
        .join("");

      return `<article class="comparison-card" style="--card-delay:${testIndex * 55}ms"><h3>${escapeHtml(test)}</h3><div class="comparison-list">${rows}</div></article>`;
    })
    .join("");
}

export function renderResultsPage(parsed, options = {}) {
  const { frameworks, tests } = parsed;
  const generatedAt = options.generatedAt ?? new Date();
  const sourceLabel = options.sourceLabel ?? DEFAULT_SOURCE_LABEL;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JS Reactivity Benchmark</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 28%),
      radial-gradient(circle at top right, rgba(29, 78, 216, 0.10), transparent 30%),
      #f7f7f3;
    color: #171717;
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 20px 56px;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 30px;
    font-weight: 650;
  }
  .subtitle, .meta, .note {
    color: #57534e;
  }
  .subtitle {
    margin: 0 0 10px;
    font-size: 14px;
  }
  .meta {
    margin: 0 0 24px;
    font-size: 13px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
    gap: 20px;
  }
  .card {
    background: rgba(255, 255, 255, 0.84);
    border: 1px solid rgba(23, 23, 23, 0.08);
    border-radius: 18px;
    padding: 20px;
    backdrop-filter: blur(12px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.05);
    animation: fade-up 560ms ease both;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th, td {
    padding: 10px 0;
    border-bottom: 1px solid rgba(23, 23, 23, 0.08);
  }
  th {
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #78716c;
  }
  .rank {
    width: 36px;
    color: #78716c;
  }
  .framework {
    font-weight: 500;
  }
  .framework.winner {
    color: #0f766e;
  }
  .time {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .bar-row {
    display: grid;
    grid-template-columns: minmax(110px, 180px) minmax(0, 1fr) 64px;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
    animation: fade-up 520ms ease both;
    animation-delay: var(--row-delay, 0ms);
  }
  .bar-label, .bar-value {
    font-size: 13px;
  }
  .bar-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar-track {
    height: 14px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(23, 23, 23, 0.08);
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
    width: 0;
    background: var(--bar-color);
    animation: grow-bar 900ms cubic-bezier(.2,.8,.2,1) forwards;
    animation-delay: calc(var(--row-delay, 0ms) + 120ms);
  }
  .bar-value {
    text-align: right;
    color: #57534e;
    font-variant-numeric: tabular-nums;
  }
  .remarks {
    margin-top: 20px;
  }
  .comparison-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
  }
  .comparison-card {
    padding: 14px;
    border-radius: 14px;
    background: rgba(29, 78, 216, 0.05);
    border: 1px solid rgba(29, 78, 216, 0.08);
    animation: fade-up 620ms ease both;
    animation-delay: var(--card-delay, 0ms);
  }
  .comparison-card h3 {
    margin: 0 0 12px;
    font-size: 14px;
  }
  .comparison-list {
    display: grid;
    gap: 8px;
  }
  .comparison-row {
    display: grid;
    grid-template-columns: 24px minmax(90px, 150px) minmax(0, 1fr) 82px 64px;
    gap: 8px;
    align-items: center;
    animation: fade-up 520ms ease both;
    animation-delay: var(--row-delay, 0ms);
  }
  .comparison-rank, .comparison-time, .comparison-delta {
    font-size: 12px;
    color: #57534e;
  }
  .comparison-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .comparison-name-winner {
    color: #0f766e;
    font-weight: 650;
  }
  .comparison-bar {
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(23, 23, 23, 0.08);
  }
  .comparison-bar-fill {
    height: 100%;
    width: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, #1d4ed8, #0f766e);
    animation: grow-bar 820ms cubic-bezier(.2,.8,.2,1) forwards;
    animation-delay: calc(var(--row-delay, 0ms) + 140ms);
  }
  .comparison-time {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .comparison-delta {
    text-align: right;
  }
  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes grow-bar {
    from {
      width: 0;
    }
    to {
      width: var(--target-width);
    }
  }
  .remark {
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(29, 78, 216, 0.06);
    border: 1px solid rgba(29, 78, 216, 0.1);
    font-size: 13px;
    color: #1f2937;
  }
  .remark-title {
    font-weight: 650;
    color: #1d4ed8;
  }
  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 720px) {
    .comparison-row {
      grid-template-columns: 22px minmax(80px, 120px) minmax(0, 1fr) 74px 54px;
    }
    .comparison-delta {
      display: none;
    }
  }
</style>
</head>
<body>
<main>
  <h1>JS Reactivity Benchmark</h1>
  <p class="subtitle">Average execution time across all tests in milliseconds. Lower is faster.</p>
  <p class="meta">Updated ${escapeHtml(formatDate(generatedAt))}. ${escapeHtml(sourceLabel)}.</p>

  <section class="grid">
    <article class="card">
      <h2>Average Results</h2>
      <table>
        <thead>
          <tr>
            <th class="rank">#</th>
            <th>Framework</th>
            <th class="time">Avg, ms</th>
          </tr>
        </thead>
        <tbody>${renderRows(frameworks)}</tbody>
      </table>
      <p class="note">Average across ${tests.length} tests for ${frameworks.length} frameworks.</p>
    </article>

    <article class="card">
      <h2>Visual Comparison</h2>
      ${renderBars(frameworks)}
    </article>
  </section>

  <section class="card remarks">
    <h2>Per-Test Comparison Across Frameworks</h2>
    <div class="comparison-grid">${renderPerTestComparison(frameworks, tests)}</div>
  </section>
</main>
</body>
</html>`;
}

export async function updateResultsPage({
  inputPath = DEFAULT_INPUT,
  outputPath = DEFAULT_OUTPUT,
  generatedAt = new Date(),
  sourceLabel = DEFAULT_SOURCE_LABEL,
} = {}) {
  const input = await readFile(inputPath, "utf8");
  const parsed = parseBenchOutput(input);
  const html = renderResultsPage(parsed, { generatedAt, sourceLabel });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  return { parsed, outputPath };
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;
  const outputPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : DEFAULT_OUTPUT;

  updateResultsPage({ inputPath, outputPath })
    .then(({ parsed }) => {
      console.log(
        `Generated ${path.relative(process.cwd(), outputPath)} from ${parsed.rows.length} benchmark rows.`
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
