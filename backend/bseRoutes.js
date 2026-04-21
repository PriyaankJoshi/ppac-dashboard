/**
 * bseRoutes.js
 *
 * Express routes for BSE Integrated Filing (Finance) data.
 * Mount in server.js with:
 *
 *   const bseRoutes = require("./bseRoutes");
 *   app.use("/api/bse", bseRoutes);
 */

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { scrapeBseFinancials } = require("./bseScraper");

const router = express.Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BSE_COMPANIES_FILE = path.join(__dirname, "bse-companies.json");
const BSE_CACHE_DIR = path.join(__dirname, "data", "bse");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — BSE quarterly data changes rarely

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureCacheDir() {
  await fs.mkdir(BSE_CACHE_DIR, { recursive: true });
}

function getCacheFilePath(companyId) {
  return path.join(BSE_CACHE_DIR, `${companyId}.json`);
}

async function readCompanies() {
  const raw = await fs.readFile(BSE_COMPANIES_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  const companies = parsed.companies;
  if (!Array.isArray(companies) || !companies.length) {
    throw new Error("No companies found in bse-companies.json");
  }
  return companies;
}

async function readCached(companyId) {
  try {
    const filePath = getCacheFilePath(companyId);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCached(companyId, data) {
  await ensureCacheDir();
  const filePath = getCacheFilePath(companyId);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isCacheStale(cachedData) {
  if (!cachedData?.scrapedAt) return true;
  const age = Date.now() - new Date(cachedData.scrapedAt).getTime();
  return age > CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/bse/companies
 * Returns the list of configured companies (no scraping).
 */
router.get("/companies", async (_req, res) => {
  try {
    const companies = await readCompanies();
    // Return only the metadata fields, not any cached financial data
    const list = companies.map(({ id, name, shortName, ticker, bseCode }) => ({
      id,
      name,
      shortName,
      ticker,
      bseCode,
    }));
    return res.json({ companies: list });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to load company list",
      details: error.message,
    });
  }
});

/**
 * GET /api/bse/financials/:companyId?refresh=true
 * Returns Integrated Filing (Finance) table data for the given company.
 * Serves from cache unless the cache is stale or refresh=true is passed.
 */
router.get("/financials/:companyId", async (req, res) => {
  const { companyId } = req.params;
  const forceRefresh = String(req.query.refresh || "").toLowerCase() === "true";

  try {
    const companies = await readCompanies();
    const company = companies.find((c) => c.id === companyId);

    if (!company) {
      return res.status(404).json({
        error: `Company '${companyId}' not found. Check bse-companies.json.`,
      });
    }

    // Serve from cache if fresh
    if (!forceRefresh) {
      const cached = await readCached(companyId);
      if (cached && !isCacheStale(cached)) {
        return res.json({ fromCache: true, ...cached });
      }
    }

    // Live scrape
    const fresh = await scrapeBseFinancials(company);
    await writeCached(companyId, fresh);

    return res.json({ fromCache: false, ...fresh });
  } catch (error) {
    return res.status(500).json({
      error: `Failed to fetch BSE financials for '${companyId}'`,
      details: error.message,
    });
  }
});

module.exports = router;
