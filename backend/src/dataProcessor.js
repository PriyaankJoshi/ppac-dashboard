const MONTH_ORDER = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function getMonthSortKey(monthLabel) {
  const match = String(monthLabel || "").match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/i
  );
  if (!match) return Number.MAX_SAFE_INTEGER;
  const mon = match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase();
  const year = Number(match[2]);
  return year * 100 + MONTH_ORDER[mon];
}

function normalizeValue(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return value;
}

function mergeDatasets(importExportRows, consumptionRows, productFilter) {
  const mergedMap = new Map();

  const upsert = (row) => {
    if (!row?.product || !row?.month) return;
    const key = `${row.product}|${row.month}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        product: row.product,
        month: row.month,
        imports: null,
        exports: null,
        consumption: null,
      });
    }

    const existing = mergedMap.get(key);
    if (row.imports !== undefined && row.imports !== null) existing.imports = normalizeValue(row.imports);
    if (row.exports !== undefined && row.exports !== null) existing.exports = normalizeValue(row.exports);
    if (row.consumption !== undefined && row.consumption !== null) {
      existing.consumption = normalizeValue(row.consumption);
    }
  };

  importExportRows.forEach(upsert);
  consumptionRows.forEach(upsert);

  let merged = Array.from(mergedMap.values());
  if (productFilter) {
    merged = merged.filter((item) => item.product.toLowerCase() === productFilter.toLowerCase());
  }

  merged.sort((a, b) => getMonthSortKey(a.month) - getMonthSortKey(b.month));
  return merged;
}

module.exports = { mergeDatasets };
