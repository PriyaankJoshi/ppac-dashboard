const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const Parser = require("rss-parser");
const { scrapeAllData, scrapeCrudeKpis } = require("./scraper");
const { mergeDatasets } = require("./dataProcessor");
const bseRoutes = require("../bseRoutes"); // ← NEW

const app = express();
const PORT = process.env.PORT || 4000;
const VALID_PRODUCTS = ["LPG", "Naphtha", "ATF"];
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_DIR = path.join(DATA_DIR, "products");
const META_FILE = path.join(DATA_DIR, "meta.json");
const RSS_SOURCES_FILE = path.join(__dirname, "..", "rss-sources.json");
const KEYWORDS_FILE = path.join(__dirname, "..", "keywords.json");
const rssParser = new Parser();
const CRUDE_KPI_CACHE_TTL_MS = 15 * 60 * 1000;
let crudeKpiCache = null;

app.use(cors({
  origin: [
    "https://ppac-dashboard.vercel.app/",  // replace with your actual Vercel URL
    "http://localhost:5173",
  ],
}));
app.use(express.json());

// ── BSE routes ───────────────────────────────────────────────────────────────
app.use("/api/bse", bseRoutes); // ← NEW

async function ensureStorage() {
  await fs.mkdir(PRODUCTS_DIR, { recursive: true });
}

function getProductFilePath(product) {
  return path.join(PRODUCTS_DIR, `${product.toLowerCase()}.json`);
}

async function persistAllProducts(data) {
  await ensureStorage();
  const rowsByProduct = new Map(VALID_PRODUCTS.map((product) => [product, []]));

  data.forEach((row) => {
    if (rowsByProduct.has(row.product)) {
      rowsByProduct.get(row.product).push(row);
    }
  });

  await Promise.all(
    Array.from(rowsByProduct.entries()).map(([product, rows]) =>
      fs.writeFile(
        getProductFilePath(product),
        JSON.stringify(
          {
            product,
            updatedAt: new Date().toISOString(),
            count: rows.length,
            data: rows,
          },
          null,
          2
        ),
        "utf-8"
      )
    )
  );

  await fs.writeFile(
    META_FILE,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        products: VALID_PRODUCTS,
      },
      null,
      2
    ),
    "utf-8"
  );
}

async function refreshFromSource() {
  const { importExportRows, consumptionRows } = await scrapeAllData();
  const merged = mergeDatasets(importExportRows, consumptionRows);
  await persistAllProducts(merged);
}

async function readProductData(product) {
  const filePath = getProductFilePath(product);
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

async function readMetaData() {
  const fileContent = await fs.readFile(META_FILE, "utf-8");
  return JSON.parse(fileContent);
}

async function ensureDataFiles() {
  await ensureStorage();
  try {
    await fs.access(META_FILE);
  } catch (_err) {
    await refreshFromSource();
  }
}

async function readJsonFile(filePath) {
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keywords) {
  const cleanedKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((keyword) => String(keyword || "").trim())
    .filter(Boolean);

  if (!cleanedKeywords.length) {
    throw new Error("No keywords found in keywords.json");
  }

  return {
    cleanedKeywords,
    keywordRegex: new RegExp(`(${cleanedKeywords.map(escapeRegex).join("|")})`, "i"),
  };
}

function toTimestamp(value) {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeFeedItem(item, source, feedUrl, keywordRegex) {
  const title = item.title || "";
  const description = item.contentSnippet || item.content || item.summary || "";
  const searchableText = `${title} ${description}`;

  if (!keywordRegex.test(searchableText)) {
    return null;
  }

  return {
    title,
    link: item.link || null,
    publishedAt: item.isoDate || item.pubDate || item.published || null,
    source,
    feedUrl,
    description,
  };
}

async function fetchNewsBySource(source, urls, keywordRegex) {
  const sourceItems = [];
  const sourceErrors = [];

  await Promise.all(
    urls.map(async (feedUrl) => {
      try {
        const response = await fetch(feedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const xml = await response.text();
        const parsedFeed = await rssParser.parseString(xml);
        const parsedItems = (parsedFeed.items || [])
          .map((item) => normalizeFeedItem(item, source, feedUrl, keywordRegex))
          .filter(Boolean);
        sourceItems.push(...parsedItems);
      } catch (error) {
        sourceErrors.push({
          feedUrl,
          message: error.message || "Failed to load feed",
        });
      }
    })
  );

  sourceItems.sort((left, right) => toTimestamp(right.publishedAt) - toTimestamp(left.publishedAt));

  return {
    count: sourceItems.length,
    items: sourceItems,
    errors: sourceErrors,
  };
}

app.get("/api/data", async (req, res) => {
  try {
    const product = req.query.product;
    const refresh = String(req.query.refresh || "").toLowerCase() === "true";

    if (product && !VALID_PRODUCTS.some((item) => item.toLowerCase() === product.toLowerCase())) {
      return res.status(400).json({
        error: "Invalid product. Allowed values: LPG, Naphtha, ATF",
      });
    }

    await ensureDataFiles();

    if (refresh) {
      await refreshFromSource();
    }

    const productPayload = product ? await readProductData(product) : null;
    const allProductPayloads = product
      ? null
      : await Promise.all(VALID_PRODUCTS.map((item) => readProductData(item)));
    const metaPayload = await readMetaData();
    const data = product
      ? productPayload.data || []
      : allProductPayloads.flatMap((payload) => payload.data || []);
    const refreshedAt = product
      ? productPayload.updatedAt || metaPayload.updatedAt || null
      : metaPayload.updatedAt || null;

    return res.json({
      product: product || null,
      fromCache: !refresh,
      refreshedAt,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch PPAC data",
      details: error.message,
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/news", async (_req, res) => {
  try {
    const rssSources = await readJsonFile(RSS_SOURCES_FILE);
    const keywordConfig = await readJsonFile(KEYWORDS_FILE);
    const { cleanedKeywords, keywordRegex } = buildKeywordRegex(keywordConfig.keywords);

    const sourceNames = Object.keys(rssSources || {});
    if (!sourceNames.length) {
      throw new Error("No RSS sources found in rss-sources.json");
    }

    const sourcePayloadEntries = await Promise.all(
      sourceNames.map(async (source) => {
        const urls = Array.isArray(rssSources[source]) ? rssSources[source] : [];
        if (!urls.length) {
          return [
            source,
            {
              count: 0,
              items: [],
              errors: [
                {
                  feedUrl: null,
                  message: `No feeds configured for ${source}`,
                },
              ],
            },
          ];
        }

        const sourcePayload = await fetchNewsBySource(source, urls, keywordRegex);
        return [source, sourcePayload];
      })
    );

    return res.json({
      updatedAt: new Date().toISOString(),
      keywords: cleanedKeywords,
      sources: Object.fromEntries(sourcePayloadEntries),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch RSS news",
      details: error.message,
    });
  }
});

app.get("/api/kpis/crude", async (req, res) => {
  try {
    const refresh = String(req.query.refresh || "").toLowerCase() === "true";
    const isCacheValid =
      crudeKpiCache &&
      Date.now() - new Date(crudeKpiCache.fetchedAt).getTime() < CRUDE_KPI_CACHE_TTL_MS;

    if (!refresh && isCacheValid) {
      return res.json({
        fromCache: true,
        ...crudeKpiCache,
      });
    }

    const latest = await scrapeCrudeKpis();
    crudeKpiCache = latest;

    return res.json({
      fromCache: false,
      ...latest,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch crude KPIs",
      details: error.message,
    });
  }
});

ensureDataFiles()
  .catch((error) => {
    console.error("Failed to initialize local product files:", error);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`PPAC API server running on http://localhost:${PORT}`);
    });
  });
