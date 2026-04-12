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

function countWins(frameworks, tests) {
  const wins = new Map(frameworks.map((framework) => [framework.name, 0]));

  for (const test of tests) {
    const ranked = frameworks
      .map((framework) => ({
        name: framework.name,
        time: framework.byTest[test],
      }))
      .filter((entry) => typeof entry.time === "number")
      .sort((left, right) => left.time - right.time);

    if (ranked.length > 0) {
      wins.set(ranked[0].name, (wins.get(ranked[0].name) ?? 0) + 1);
    }
  }

  return wins;
}

function renderSpotlight(frameworks, tests) {
  const winner = frameworks[0];
  const runnerUp = frameworks[1];
  const wins = countWins(frameworks, tests);
  const lead =
    runnerUp && winner.average > 0
      ? ((runnerUp.average - winner.average) / winner.average) * 100
      : 0;

  return `
    <section class="hero-shell">
      <div class="hero-copy">
        <span class="eyebrow">Benchmark Overview</span>
        <h1>JS Reactivity Benchmark</h1>
        <p class="subtitle">Propagation, graph, and computation stress tests. Lower average runtime wins.</p>
        <div class="hero-notes">
          <div class="hero-chip">Leader: ${escapeHtml(winner.name)}</div>
          <div class="hero-chip">Tests: ${tests.length}</div>
          <div class="hero-chip">Frameworks: ${frameworks.length}</div>
        </div>
      </div>
      <aside class="spotlight-card">
        <p class="spotlight-label">Fastest Overall</p>
        <h2>${escapeHtml(winner.name)}</h2>
        <div class="spotlight-metric">${formatTime(winner.average)}<span> ms avg</span></div>
        <p class="spotlight-copy">${wins.get(winner.name) ?? 0} test wins${runnerUp ? ` and ${lead.toFixed(1)}% ahead of ${escapeHtml(runnerUp.name)}` : ""}.</p>
      </aside>
    </section>
  `;
}

function renderStatCards(frameworks, tests, generatedAt, sourceLabel) {
  const winner = frameworks[0];
  const runnerUp = frameworks[1];
  const slowest = frameworks[frameworks.length - 1];
  const spread =
    slowest && winner.average > 0
      ? slowest.average / winner.average
      : 1;
  const wins = countWins(frameworks, tests);

  return `
    <section class="stats-grid">
      <article class="stat-card">
        <span class="stat-label">Best Average</span>
        <strong>${formatTime(winner.average)} ms</strong>
        <p>${escapeHtml(winner.name)} leads the full suite.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Closest Rival</span>
        <strong>${runnerUp ? escapeHtml(runnerUp.name) : "N/A"}</strong>
        <p>${runnerUp ? `${(((runnerUp.average - winner.average) / winner.average) * 100).toFixed(1)}% behind the leader.` : "Only one framework in this run."}</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Most Wins</span>
        <strong>${escapeHtml(
          Array.from(wins.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? winner.name
        )}</strong>
        <p>${Array.from(wins.values()).sort((a, b) => b - a)[0] ?? 0} first-place finishes across individual tests.</p>
      </article>
      <article class="stat-card">
        <span class="stat-label">Run Snapshot</span>
        <strong>${tests.length} tests</strong>
        <p>Updated ${escapeHtml(formatDate(generatedAt))}. ${escapeHtml(sourceLabel)}. Slowest to fastest spread: ${spread.toFixed(2)}x.</p>
      </article>
    </section>
  `;
}

function renderLeaderboardCards(frameworks, tests) {
  const wins = countWins(frameworks, tests);
  const fastestAverage = frameworks[0]?.average ?? 0;

  return frameworks
    .map((framework, index) => {
      const relative =
        index === 0 || fastestAverage === 0
          ? "baseline"
          : `+${(((framework.average - fastestAverage) / fastestAverage) * 100).toFixed(1)}%`;

      return `
        <article class="leader-card${index === 0 ? " leader-card-top" : ""}" style="--card-delay:${index * 45}ms">
          <div class="leader-head">
            <span class="leader-rank">#${index + 1}</span>
            <span class="leader-delta">${relative}</span>
          </div>
          <h3>${escapeHtml(framework.name)}</h3>
          <div class="leader-time">${formatTime(framework.average)} <span>ms avg</span></div>
          <div class="leader-meta">
            <span>${wins.get(framework.name) ?? 0} wins</span>
            <span>${framework.entries.length} results</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTestFilter(tests) {
  const options = tests
    .map(
      (test) =>
        `<option value="${escapeHtml(test)}">${escapeHtml(test)}</option>`
    )
    .join("");

  return `
    <section class="controls-shell">
      <div class="view-toggle" role="group" aria-label="Density mode">
        <button class="view-button is-active" type="button" data-density="detailed">Detailed</button>
        <button class="view-button" type="button" data-density="compact">Compact</button>
      </div>
      <label class="filter-box">
        <span class="filter-label">Filter tests</span>
        <input id="testFilterInput" class="filter-input" type="search" placeholder="Search by test name" autocomplete="off" />
      </label>
      <label class="filter-box filter-select-box">
        <span class="filter-label">Jump to test</span>
        <select id="testFilterSelect" class="filter-select">
          <option value="">All tests</option>
          ${options}
        </select>
      </label>
      <button id="clearTestFilter" class="clear-filter-button" type="button">Reset</button>
    </section>
  `;
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
  :root {
    --bg: #07120f;
    --bg-deep: #020707;
    --surface: rgba(37, 39, 46, 0.82);
    --surface-strong: rgba(43, 45, 53, 0.94);
    --surface-glass: rgba(58, 62, 72, 0.3);
    --line: rgba(126, 255, 205, 0.18);
    --line-strong: rgba(126, 255, 205, 0.3);
    --text: #f2f4f8;
    --muted: #a2a8b5;
    --accent: #7affc8;
    --accent-2: #f7b955;
    --accent-3: #4bd6ff;
    --danger: #ff7a67;
    --shadow: 0 22px 60px rgba(0, 0, 0, 0.38);
    --radius-xl: 28px;
    --radius-lg: 22px;
    --radius-md: 16px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Bahnschrift, "Arial Narrow", "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at 18% 0%, rgba(122, 255, 200, 0.08), transparent 24%),
      radial-gradient(circle at 85% 0%, rgba(75, 214, 255, 0.07), transparent 18%),
      linear-gradient(180deg, #181a20 0%, #121419 38%, #090b10 100%);
    color: var(--text);
    min-height: 100vh;
    position: relative;
  }
  body::before,
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }
  body::before {
    background:
      linear-gradient(90deg, transparent 0, rgba(126, 255, 205, 0.015) 50%, transparent 100%),
      repeating-linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.02) 0,
        rgba(255, 255, 255, 0.02) 1px,
        transparent 1px,
        transparent 6px
      );
    opacity: 0.35;
  }
  body::after {
    background:
      linear-gradient(120deg, transparent 0 46%, rgba(126, 255, 205, 0.02) 50%, transparent 54% 100%);
    animation: sweep 14s linear infinite;
  }
  main {
    position: relative;
    z-index: 1;
    max-width: 1320px;
    margin: 0 auto;
    padding: 28px 20px 72px;
  }
  .hero-shell {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 420px);
    gap: 20px;
    align-items: stretch;
    margin-bottom: 18px;
  }
  .hero-copy,
  .spotlight-card,
  .card,
  .stat-card,
  .leader-card {
    border: 1px solid var(--line);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 40%),
      var(--surface);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow);
  }
  .hero-copy {
    border-radius: 32px;
    padding: 28px 30px;
    position: relative;
    overflow: hidden;
  }
  .hero-copy::before,
  .spotlight-card::before,
  .card::before,
  .stat-card::before,
  .leader-card::before {
    content: "";
    position: absolute;
    inset: 10px;
    border: 1px solid rgba(126, 255, 205, 0.08);
    border-radius: inherit;
    pointer-events: none;
  }
  .hero-copy::after {
    content: "";
    position: absolute;
    inset: auto -6% -20% auto;
    width: 260px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(122, 255, 200, 0.08), transparent 65%);
    pointer-events: none;
  }
  .eyebrow {
    display: inline-flex;
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #d7dbe3;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  h1 {
    margin: 0;
    max-width: 12ch;
    font-size: clamp(34px, 6vw, 60px);
    line-height: 0.98;
    letter-spacing: -0.04em;
  }
  .subtitle {
    margin: 12px 0 0;
    max-width: 56ch;
    font-size: 15px;
    line-height: 1.5;
    color: var(--muted);
  }
  .hero-notes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
  .hero-chip {
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 13px;
    color: var(--text);
  }
  .spotlight-card {
    position: relative;
    border-radius: 32px;
    padding: 26px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0)),
      var(--surface-strong);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    animation: fade-up 700ms ease both;
  }
  .spotlight-label,
  .note,
  .meta,
  .stat-label,
  .leader-delta,
  .comparison-rank,
  .comparison-time,
  .comparison-delta,
  th {
    color: var(--muted);
  }
  .spotlight-card h2 {
    margin: 8px 0 10px;
    font-size: 30px;
  }
  .spotlight-metric {
    font-size: clamp(32px, 6vw, 54px);
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -0.05em;
    color: var(--accent);
  }
  .spotlight-metric span {
    font-size: 18px;
    font-weight: 500;
    color: var(--muted);
  }
  .spotlight-copy {
    margin: 14px 0 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--muted);
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin: 0 0 18px;
  }
  .controls-shell {
    position: sticky;
    top: 12px;
    z-index: 20;
    display: grid;
    grid-template-columns: auto minmax(220px, 1fr) minmax(200px, 240px) auto;
    gap: 12px;
    align-items: end;
    margin: 0 0 18px;
    padding: 12px;
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(35, 37, 44, 0.84);
    backdrop-filter: blur(18px);
    box-shadow: var(--shadow);
  }
  .view-toggle {
    display: inline-grid;
    grid-auto-flow: column;
    gap: 8px;
    padding: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
  }
  .view-button,
  .clear-filter-button,
  .filter-input,
  .filter-select {
    border: 1px solid rgba(255, 255, 255, 0.08);
    font: inherit;
  }
  .view-button,
  .clear-filter-button {
    cursor: pointer;
    transition: transform 180ms ease, background-color 180ms ease, color 180ms ease, border-color 180ms ease;
  }
  .view-button {
    padding: 9px 13px;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
  }
  .view-button.is-active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
    color: var(--text);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }
  .filter-box {
    display: grid;
    gap: 6px;
  }
  .filter-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
  }
  .filter-input,
  .filter-select {
    min-height: 42px;
    width: 100%;
    border-radius: 12px;
    background: rgba(20, 22, 28, 0.92);
    padding: 0 14px;
    color: var(--text);
  }
  .filter-input::placeholder {
    color: rgba(162, 168, 181, 0.7);
  }
  .clear-filter-button {
    min-height: 42px;
    padding: 0 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
  }
  .clear-filter-button:hover,
  .view-button:hover {
    transform: translateY(-1px);
  }
  .stat-card {
    border-radius: var(--radius-lg);
    padding: 18px;
    animation: fade-up 560ms ease both;
  }
  .stat-card strong {
    display: block;
    margin-top: 12px;
    font-size: clamp(24px, 3vw, 34px);
    letter-spacing: -0.04em;
  }
  .stat-card p {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--muted);
  }
  .stat-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 420px);
    gap: 20px;
    align-items: start;
  }
  .leaderboard-stack {
    display: grid;
    gap: 16px;
  }
  .leader-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .detail-only {
    display: block;
  }
  .leader-card {
    padding: 18px;
    border-radius: 20px;
    animation: fade-up 620ms ease both;
    animation-delay: var(--card-delay, 0ms);
  }
  .leader-card-top {
    background:
      linear-gradient(145deg, rgba(15, 118, 110, 0.14), rgba(255, 255, 255, 0.7)),
      var(--surface-strong);
  }
  .leader-head,
  .leader-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .leader-rank {
    display: inline-flex;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    font-size: 12px;
  }
  .leader-card h3 {
    margin: 16px 0 10px;
    font-size: 19px;
  }
  .leader-time {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--accent);
  }
  .leader-time span {
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
  }
  .leader-meta {
    margin-top: 14px;
    font-size: 13px;
    color: var(--muted);
  }
  .card {
    border-radius: var(--radius-xl);
    padding: 24px;
    animation: fade-up 560ms ease both;
  }
  h2 {
    margin: 0 0 16px;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th, td {
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  th {
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .rank {
    width: 36px;
  }
  .framework {
    font-weight: 600;
  }
  .framework.winner {
    color: var(--accent);
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
    height: 16px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
    width: 0;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--bar-color) 76%, black), color-mix(in srgb, var(--bar-color) 88%, white));
    box-shadow: 0 0 18px color-mix(in srgb, var(--bar-color) 40%, transparent);
    animation: grow-bar 900ms cubic-bezier(.2,.8,.2,1) forwards;
    animation-delay: calc(var(--row-delay, 0ms) + 120ms);
  }
  .bar-value {
    text-align: right;
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
    position: relative;
    padding: 16px;
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0)),
      rgba(31, 33, 40, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.08);
    animation: fade-up 620ms ease both;
    animation-delay: var(--card-delay, 0ms);
  }
  .comparison-card h3 {
    margin: 0 0 12px;
    font-size: 15px;
    line-height: 1.35;
  }
  .comparison-card.is-hidden {
    display: none;
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
  }
  .comparison-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .comparison-name-winner {
    color: var(--accent);
    font-weight: 650;
  }
  .comparison-bar {
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
  }
  .comparison-bar-fill {
    height: 100%;
    width: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--danger), var(--accent-2), var(--accent));
    box-shadow: 0 0 18px rgba(247, 185, 85, 0.18);
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
  body[data-density="compact"] .stats-grid,
  body[data-density="compact"] .detail-only {
    display: none;
  }
  body[data-density="compact"] .hero-shell {
    grid-template-columns: minmax(0, 1fr);
  }
  body[data-density="compact"] .hero-copy {
    padding: 24px;
  }
  body[data-density="compact"] .dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  body[data-density="compact"] .card,
  body[data-density="compact"] .leader-card,
  body[data-density="compact"] .comparison-card {
    padding: 16px;
  }
  body[data-density="compact"] .comparison-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
  body[data-density="compact"] .comparison-card h3 {
    font-size: 14px;
    margin-bottom: 8px;
  }
  body[data-density="compact"] .comparison-list {
    gap: 6px;
  }
  body[data-density="compact"] .comparison-row {
    grid-template-columns: 18px minmax(70px, 120px) minmax(0, 1fr) 64px;
  }
  body[data-density="compact"] .comparison-rank,
  body[data-density="compact"] .comparison-time,
  body[data-density="compact"] .comparison-name {
    font-size: 11px;
  }
  body[data-density="compact"] .comparison-delta {
    display: none;
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
  @keyframes sweep {
    from {
      transform: translateX(-18%);
    }
    to {
      transform: translateX(18%);
    }
  }
  @media (max-width: 1080px) {
    .hero-shell,
    .dashboard-grid,
    .stats-grid {
      grid-template-columns: 1fr;
    }
    .controls-shell {
      grid-template-columns: 1fr 1fr;
      align-items: stretch;
    }
  }
  @media (max-width: 720px) {
    main {
      padding: 14px 12px 56px;
    }
    .controls-shell {
      top: 8px;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      padding: 10px;
      border-radius: 18px;
      align-items: center;
    }
    .filter-box {
      min-width: 0;
    }
    .filter-select-box,
    .clear-filter-button {
      display: none;
    }
    .view-toggle {
      order: 2;
      justify-self: end;
    }
    .view-button {
      padding-inline: 11px;
      font-size: 12px;
    }
    .filter-label {
      display: none;
    }
    .filter-input {
      min-height: 40px;
    }
    .hero-copy,
    .spotlight-card,
    .card {
      padding: 18px;
      border-radius: 22px;
    }
    .hero-shell {
      gap: 12px;
    }
    .hero-copy {
      padding-bottom: 16px;
    }
    .eyebrow {
      margin-bottom: 8px;
      font-size: 11px;
    }
    h1 {
      font-size: 28px;
      max-width: none;
    }
    .subtitle {
      margin-top: 8px;
      font-size: 14px;
      line-height: 1.4;
    }
    .hero-notes {
      gap: 8px;
      margin-top: 14px;
    }
    .hero-chip {
      font-size: 12px;
      padding: 7px 10px;
    }
    .spotlight-card {
      padding-top: 18px;
    }
    .spotlight-card h2 {
      font-size: 24px;
    }
    .spotlight-copy {
      font-size: 14px;
    }
    .stat-card,
    .leader-card {
      border-radius: 20px;
    }
    .leader-grid,
    .comparison-grid {
      grid-template-columns: 1fr;
    }
    .comparison-row {
      grid-template-columns: 22px minmax(76px, 110px) minmax(0, 1fr) 70px;
    }
    .comparison-time {
      font-size: 11px;
    }
    .comparison-delta {
      display: none;
    }
    .bar-row {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .bar-value {
      text-align: left;
    }
  }
</style>
</head>
<body data-density="detailed">
<main>
  ${renderSpotlight(frameworks, tests)}
  ${renderStatCards(frameworks, tests, generatedAt, sourceLabel)}
  ${renderTestFilter(tests)}

  <section class="dashboard-grid">
    <div class="leaderboard-stack">
      <article class="card">
        <h2>Leaderboard</h2>
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
      <section class="leader-grid">
        ${renderLeaderboardCards(frameworks, tests)}
      </section>
    </div>

    <article class="card">
      <h2>Visual Comparison</h2>
      ${renderBars(frameworks)}
      <p class="meta">Each bar shows average runtime relative to the slowest average in this run.</p>
    </article>
  </section>

  <section class="card remarks">
    <h2>Per-Test Comparison</h2>
    <p class="meta">Every card ranks frameworks for a single scenario, so outliers and specialists stay visible.</p>
    <div class="comparison-grid">${renderPerTestComparison(frameworks, tests)}</div>
  </section>
</main>
<script>
  (() => {
    const body = document.body;
    const buttons = Array.from(document.querySelectorAll("[data-density]"));
    const input = document.getElementById("testFilterInput");
    const select = document.getElementById("testFilterSelect");
    const clear = document.getElementById("clearTestFilter");
    const cards = Array.from(document.querySelectorAll(".comparison-card"));

    function setDensity(mode) {
      body.dataset.density = mode;
      buttons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.density === mode);
      });
    }

    function applyFilter(value) {
      const query = value.trim().toLowerCase();

      cards.forEach((card) => {
        const title = card.querySelector("h3")?.textContent?.toLowerCase() ?? "";
        const visible = query === "" || title.includes(query);
        card.classList.toggle("is-hidden", !visible);
      });
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => setDensity(button.dataset.density || "detailed"));
    });

    input?.addEventListener("input", () => {
      applyFilter(input.value);
      if (select) {
        select.value = "";
      }
    });

    select?.addEventListener("change", () => {
      const selected = select.value;
      if (input) {
        input.value = selected;
      }
      applyFilter(selected);
    });

    clear?.addEventListener("click", () => {
      if (input) {
        input.value = "";
      }
      if (select) {
        select.value = "";
      }
      applyFilter("");
    });
  })();
</script>
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
