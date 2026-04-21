const puppeteer = require("puppeteer");

const IMPORT_EXPORT_URL = "https://ppac.gov.in/import-export";
const CONSUMPTION_URL = "https://ppac.gov.in/consumption/products-wise";
const CRUDE_PRICE_URL = "https://ppac.gov.in/prices/international-prices-of-crude-oil";
const TARGET_PRODUCTS = ["LPG", "Naphtha", "ATF"];

function normalizeProduct(productRaw) {
  const normalized = (productRaw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("lpg")) return "LPG";
  if (normalized.includes("naphtha")) return "Naphtha";
  if (normalized.includes("atf")) return "ATF";
  return null;
}

function normalizeMonth(monthRaw) {
  if (!monthRaw) return null;
  const cleaned = String(monthRaw).replace(/\s+/g, " ").replace(/,/g, " ").trim();
  const date = new Date(cleaned);
  if (!Number.isNaN(date.getTime())) {
    return `${date.toLocaleString("en-US", { month: "short" })}-${date.getFullYear()}`;
  }

  const match = cleaned.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\-\/]?(\d{2,4})$/i
  );
  if (match) {
    const month = match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase();
    const year = match[2].length === 2 ? `20${match[2]}` : match[2];
    return `${month}-${year}`;
  }

  return cleaned;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMetric({ metricLabel, context, defaultMetric }) {
  const label = String(metricLabel || "").toLowerCase();
  const ctx = String(context || "").toLowerCase();

  if (label.includes("export")) return "exports";
  if (label.includes("import")) return "imports";
  if (label.includes("consumption")) return "consumption";

  if (ctx.includes("export")) return "exports";
  if (ctx.includes("import")) return "imports";
  if (ctx.includes("consumption")) return "consumption";

  return defaultMetric;
}

async function pickLatestFinancialYear(page) {
  const changed = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select"));
    let didChange = false;

    selects.forEach((select) => {
      const options = Array.from(select.options || []);
      const yearOptions = options.filter((opt) => /\d{4}/.test(opt.textContent || ""));
      if (!yearOptions.length) return;

      const latest = yearOptions[yearOptions.length - 1];
      if (latest && latest.value !== select.value) {
        select.value = latest.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        didChange = true;
      }
    });

    return didChange;
  });

  if (changed) {
    await page.waitForTimeout(1500);
    await page.waitForSelector("table", { timeout: 15000 });
  }
}

async function extractPageData(page, defaultMetric) {
  const rawRows = await page.evaluate((defaultMetricInner) => {
    const rows = [];
    const monthHeaderRegex = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

    const readTable = (table) => {
      const tr = Array.from(table.querySelectorAll("tr"));
      const matrix = tr.map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) =>
          (cell.textContent || "").replace(/\s+/g, " ").trim()
        )
      );
      return matrix.filter((r) => r.length > 0 && r.some(Boolean));
    };

    const getTableContext = (table) => {
      const heading =
        table.closest("section, .view-content, .card, .table-responsive, .content-wrapper")
          ?.querySelector("h1, h2, h3, h4, h5, caption")
          ?.textContent || "";
      return heading.replace(/\s+/g, " ").trim().toLowerCase();
    };

    const tables = Array.from(document.querySelectorAll("table"));
    tables.forEach((table) => {
      const matrix = readTable(table);
      if (matrix.length < 2) return;

      const headers = matrix[0].map((h) => h.toLowerCase());
      const context = getTableContext(table);

      const monthCol = headers.findIndex((h) => h.includes("month"));
      const productCol = headers.findIndex((h) => h.includes("product") || h.includes("commodity"));
      const importCol = headers.findIndex((h) => h.includes("import"));
      const exportCol = headers.findIndex((h) => h.includes("export"));
      const consumptionCol = headers.findIndex((h) => h.includes("consumption"));

      matrix.slice(1).forEach((row) => {
        if (monthCol > -1 && productCol > -1) {
          rows.push({
            product: row[productCol],
            month: row[monthCol],
            imports: importCol > -1 ? row[importCol] : null,
            exports: exportCol > -1 ? row[exportCol] : null,
            consumption: consumptionCol > -1 ? row[consumptionCol] : null,
            context,
          });
        }
      });

      const monthColumns = headers
        .map((h, idx) => ({ h, idx }))
        .filter(({ h }) => monthHeaderRegex.test(h));
      if (!monthColumns.length) return;

      let sectionMetric = defaultMetricInner;
      matrix.slice(1).forEach((row) => {
        const product = row[0];
        const metricLabel = row[0];
        const label = String(row[0] || "").toLowerCase();

        if (label.includes("product export")) {
          sectionMetric = "exports";
          return;
        }
        if (
          label.includes("import^") ||
          label === "products" ||
          label.includes("product import") ||
          label.includes("total import")
        ) {
          sectionMetric = "imports";
          return;
        }

        monthColumns.forEach(({ idx }) => {
          rows.push({
            product,
            month: matrix[0][idx],
            value: row[idx],
            metricLabel,
            sectionMetric,
            context,
          });
        });
      });
    });

    return rows;
  }, defaultMetric);

  const normalized = [];
  rawRows.forEach((row) => {
    const product = normalizeProduct(row.product);
    if (!product || !TARGET_PRODUCTS.includes(product)) return;
    const month = normalizeMonth(row.month);
    if (!month) return;

    let imports = parseNumber(row.imports);
    let exports = parseNumber(row.exports);
    let consumption = parseNumber(row.consumption);

    if (row.value !== undefined && row.value !== null) {
      const value = parseNumber(row.value);
      const metric = inferMetric({
        metricLabel: row.metricLabel || row.product,
        context: row.context,
        defaultMetric: row.sectionMetric || defaultMetric,
      });
      if (metric === "imports") imports = value;
      if (metric === "exports") exports = value;
      if (metric === "consumption") consumption = value;
    }

    normalized.push({ product, month, imports, exports, consumption });
  });

  return normalized;
}

async function scrapeAllData() {
  const browser = await puppeteer.launch({ headless: "new" });

  try {
    const importExportPage = await browser.newPage();
    await importExportPage.goto(IMPORT_EXPORT_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await importExportPage.waitForSelector("table", { timeout: 25000 });
    await pickLatestFinancialYear(importExportPage);
    const importExportRows = await extractPageData(importExportPage, "imports");

    const consumptionPage = await browser.newPage();
    await consumptionPage.goto(CONSUMPTION_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await consumptionPage.waitForSelector("table", { timeout: 25000 });
    await pickLatestFinancialYear(consumptionPage);
    const consumptionRows = await extractPageData(consumptionPage, "consumption");

    return { importExportRows, consumptionRows };
  } finally {
    await browser.close();
  }
}

async function scrapeCrudeKpis() {
  const browser = await puppeteer.launch({ headless: "new" });

  try {
    const page = await browser.newPage();
    await page.goto(CRUDE_PRICE_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("body", { timeout: 25000 });

    const kpis = await page.evaluate(() => {
      const textFrom = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
      const numberRegex = /^-?\d+(?:\.\d+)?$/;

      let crudeOilPrice = null;
      let unit = "$/bbl";
      let icbRatio = null;

      const selectedUnitText =
        textFrom(document.querySelector("select option:checked")) ||
        textFrom(document.querySelector("label[for*='unit'], .unit")) ||
        "";
      if (/inr/i.test(selectedUnitText)) unit = "INR/bbl";

      const notesText = textFrom(document.body);

      // Prefer explicit "as on" daily basket value from notes when available.
      const asOnPriceMatch = notesText.match(
        /Crude Oil Indian Basket as on\s+\d{1,2}\.\d{1,2}\.\d{4}\s+is\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*\/?\s*bbl/i
      );
      if (asOnPriceMatch) {
        crudeOilPrice = `${asOnPriceMatch[1]} $/bbl`;
      }

      const table = document.querySelector("table");
      if (table) {
        const rows = Array.from(table.querySelectorAll("tr"));
        // Pick the first numeric price from monthly cells in data rows.
        rows.forEach((row) => {
          if (crudeOilPrice) return;
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length < 2) return;

          const values = cells
            .slice(1)
            .map((cell) => textFrom(cell).replace(/,/g, ""))
            .filter((value) => numberRegex.test(value));
          if (values.length) {
            crudeOilPrice = `${values[0]} ${unit}`;
          }
        });
      }
      const ratioMatch = notesText.match(
        /ICB Ratio(?:\s+for\s+[A-Za-z]+\s+\d{4})?\s+is\s+(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/i
      );
      if (ratioMatch) {
        icbRatio = `${ratioMatch[1]} : ${ratioMatch[2]}`;
      }

      return { icbRatio, crudeOilPrice };
    });

    if (!kpis.icbRatio && !kpis.crudeOilPrice) {
      throw new Error("Could not extract ICB Ratio and crude oil price from PPAC page");
    }

    return {
      ...kpis,
      sourceUrl: CRUDE_PRICE_URL,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeAllData, scrapeCrudeKpis };
