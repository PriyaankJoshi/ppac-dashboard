/**
 * bseScraper.js
 *
 * Puppeteer scraper for BSE Integrated Filing (Finance).
 * Extracts only: Year, Quarter, Status, Filing Date Time,
 * Revised Filing Date Time, Revision Reason, XBRL Link.
 */

const puppeteer = require("puppeteer");

const NAV_TIMEOUT_MS = 60_000;
const WAIT_FOR_TABLE_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTable(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("table")).some(
        (t) => t.querySelectorAll("tbody tr").length > 1
      ),
    { timeout: WAIT_FOR_TABLE_MS }
  );
}

// ---------------------------------------------------------------------------
// Target columns — edit here if BSE renames a column in the future.
// ---------------------------------------------------------------------------

const TARGET_COLUMNS = [
  "Year",
  "Quarter",
  "Status",
  "Filing Date Time",
  "Revised Filing Date Time",
  "Revision Reason",
  "XBRL Link",
];

// ---------------------------------------------------------------------------
// Column matching — resolves a target label to a header map index.
//
// Priority order (stops at first match):
//   1. Exact match:       "filing date time" === "filing date time"
//   2. Header starts with target: avoids "filing date time" matching
//      "revised filing date time"
//   3. Target starts with header: narrow header matching wider target
//
// Deliberately NO k.includes(needle) or needle.includes(k) — that's what
// caused "Filing Date Time" and "Revised Filing Date Time" to collide.
// ---------------------------------------------------------------------------

function resolveColumnIndex(target, headerMap) {
  const needle = target.toLowerCase();

  // 1. Exact match
  if (headerMap[needle] !== undefined) return headerMap[needle];

  // 2. Header key starts with the target (e.g. header = "filing date time (ist)")
  const startsWithMatch = Object.keys(headerMap).find((k) => k.startsWith(needle));
  if (startsWithMatch !== undefined) return headerMap[startsWithMatch];

  // 3. Target starts with the header key (e.g. target longer than header label)
  const targetStartsMatch = Object.keys(headerMap).find((k) => needle.startsWith(k));
  if (targetStartsMatch !== undefined) return headerMap[targetStartsMatch];

  return -1;
}

// ---------------------------------------------------------------------------
// DOM extraction — runs inside the browser via page.evaluate
// ---------------------------------------------------------------------------

function extractFilingTable(targetColumns) {
  const clean = (text) =>
    (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  // Must be defined inside evaluate — cannot reference outer resolveColumnIndex
  function resolveIndex(target, headerMap) {
    const needle = target.toLowerCase();
    if (headerMap[needle] !== undefined) return headerMap[needle];
    const startsWithMatch = Object.keys(headerMap).find((k) => k.startsWith(needle));
    if (startsWithMatch !== undefined) return headerMap[startsWithMatch];
    const targetStartsMatch = Object.keys(headerMap).find((k) => needle.startsWith(k));
    if (targetStartsMatch !== undefined) return headerMap[targetStartsMatch];
    return -1;
  }

  const tables = Array.from(document.querySelectorAll("table"));

  for (const table of tables) {
    // ── Build header map: normalised label → column index ──
    const theadCells = Array.from(
      table.querySelectorAll("thead tr th, thead tr td")
    );
    const rawHeaderCells = theadCells.length
      ? theadCells
      : Array.from(
          table.querySelectorAll("tr:first-child th, tr:first-child td")
        );

    const headerMap = {};
    rawHeaderCells.forEach((cell, idx) => {
      const label = clean(cell.textContent).toLowerCase();
      if (label) headerMap[label] = idx;
    });

    // Only process the filing table — must have both year and quarter columns
    const hasYear = Object.keys(headerMap).some((k) => k.includes("year"));
    const hasQuarter = Object.keys(headerMap).some((k) => k.includes("quarter"));
    if (!hasYear || !hasQuarter) continue;

    // ── Resolve each target column to its index using strict matching ──
    const colIndexes = {};
    targetColumns.forEach((col) => {
      colIndexes[col] = resolveIndex(col, headerMap);
    });

    // ── Header label set — used to skip rogue header rows in tbody ──
    const headerLabels = new Set(Object.keys(headerMap));

    // ── Extract body rows ──
    const tbodyRows = Array.from(table.querySelectorAll("tbody tr"));

    const rows = [];
    tbodyRows.forEach((tr) => {
      const cellEls = Array.from(tr.querySelectorAll("td, th"));
      const cells = cellEls.map((td) => clean(td.textContent));

      if (!cells.length || cells.every((c) => !c)) return;

      // Skip repeated header rows injected into tbody
      const firstCellNorm = (cells[0] || "").toLowerCase();
      if (headerLabels.has(firstCellNorm)) return;
      const headerMatchCount = cells.filter((c) =>
        headerLabels.has(c.toLowerCase())
      ).length;
      if (headerMatchCount >= 2) return;

      // ── Build the row object ──
      const row = {};
      targetColumns.forEach((col) => {
        const idx = colIndexes[col];

        if (col === "XBRL Link") {
          const tdEl = idx > -1 ? cellEls[idx] : null;
          const anchor =
            tdEl?.querySelector("a") ||
            tr.querySelector("a[href*='xbrl'], a[href*='.xml'], a[href*='filing']");
          row[col] = anchor
            ? { text: clean(anchor.textContent) || "View", href: anchor.href }
            : { text: cells[idx] ?? "", href: null };
        } else {
          row[col] = idx > -1 ? (cells[idx] ?? "") : "";
        }
      });

      rows.push(row);
    });

    if (rows.length) return rows;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function scrapeBseFinancials(company) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setViewport({ width: 1440, height: 900 });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    await page.goto(company.url, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });

    await waitForTable(page);
    await delay(1500);

    const rows = await page.evaluate(extractFilingTable, TARGET_COLUMNS);

    return {
      companyId: company.id,
      companyName: company.name,
      shortName: company.shortName,
      ticker: company.ticker,
      bseCode: company.bseCode,
      sourceUrl: company.url,
      scrapedAt: new Date().toISOString(),
      columns: TARGET_COLUMNS,
      rows,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeBseFinancials };