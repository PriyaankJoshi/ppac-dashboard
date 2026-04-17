const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");
const { scrapeAllData } = require("./scraper");
const { mergeDatasets } = require("./dataProcessor");

const app = express();
const PORT = process.env.PORT || 4000;
const VALID_PRODUCTS = ["LPG", "Naphtha", "ATF"];
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_DIR = path.join(DATA_DIR, "products");
const META_FILE = path.join(DATA_DIR, "meta.json");

app.use(cors());
app.use(express.json());

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

app.get("/data", async (req, res) => {
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
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
