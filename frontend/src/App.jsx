import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";
import { BsePage } from "./BsePage"; // ← NEW

const PRODUCTS = ["LPG", "Naphtha", "ATF"];
const PATHS = { dashboard: "/", news: "/news", bse: "/bse" }; // ← NEW

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function formatDateTime(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function AccordionSection({ source, payload, isOpen, onToggle }) {
  return (
    <div className="accordionSection">
      <button
        type="button"
        className={`accordionHeader ${isOpen ? "active" : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="headerLeft">
          <span className="icon">{isOpen ? "−" : "+"}</span>
          <span className="sourceTitle">{source}</span>
        </div>
        <span className="articleBadge">{payload.items?.length || 0} Articles</span>
      </button>

      {isOpen && (
        <div className="accordionContent">
          {!!payload.errors?.length && (
            <div className="status error">
              Feed errors: {payload.errors.map((item) => item.message).join(" | ")}
            </div>
          )}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Published</th>
                  <th>Title</th>
                  <th>Feed</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item, index) => (
                  <tr key={`${item.link || index}`}>
                    <td>{formatDateTime(item.publishedAt)}</td>
                    <td>
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noreferrer">
                          {item.title || "Untitled"}
                        </a>
                      ) : (
                        item.title || "Untitled"
                      )}
                    </td>
                    <td>{item.feedUrl || "Unknown feed"}</td>
                  </tr>
                ))}
                {!payload.items?.length && (
                  <tr>
                    <td colSpan="3">No matching news for configured keywords.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const [product, setProduct] = useState("LPG");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [crudeKpis, setCrudeKpis] = useState(null);
  const [kpiError, setKpiError] = useState("");

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/api/data?product=${encodeURIComponent(product)}&refresh=${forceRefresh}`
      );
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      setRows(payload.data || []);
      setFromCache(Boolean(payload.fromCache));
      setRefreshedAt(payload.refreshedAt || null);
    } catch (err) {
      setError(err.message || "Could not fetch data");
      setRows([]);
      setRefreshedAt(null);
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const fetchCrudeKpis = useCallback(async (forceRefresh = false) => {
    setKpiError("");
    try {
      const response = await fetch(`${API_BASE}/api/kpis/crude?refresh=${forceRefresh}`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = await response.json();
      setCrudeKpis(payload);
    } catch (err) {
      setKpiError(err.message || "Could not fetch crude KPIs");
      setCrudeKpis(null);
    }
  }, []);

  useEffect(() => {
    fetchCrudeKpis(false);
  }, [fetchCrudeKpis]);

  const tableRows = useMemo(
    () =>
      rows.map((item) => ({
        ...item,
        imports: item.imports ?? 0,
        exports: item.exports ?? 0,
        consumption: item.consumption ?? 0,
      })),
    [rows]
  );

  const readableRefreshedAt = useMemo(() => {
    if (!refreshedAt) return "Unknown";
    const parsed = new Date(refreshedAt);
    if (Number.isNaN(parsed.getTime())) return refreshedAt;
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(parsed);
  }, [refreshedAt]);

  return (
    <>
      <div className="pageHeader">
        <h1>PPAC Product Dashboard</h1>
        <div className="kpiArea">
          <div className="kpiCard">
            <div className="kpiLabel">ICB Ratio - <b> Sweet : Sour </b> </div>
            <div className="kpiValue">{crudeKpis?.icbRatio || "--"}</div>
          </div>
          <div className="kpiCard">
            <div className="kpiLabel">Price of Crude Oil</div>
            <div className="kpiValue">{crudeKpis?.crudeOilPrice || "--"}</div>
          </div>
        </div>
      </div>

      <div className="controls">
        <label htmlFor="product">Product</label>
        <select id="product" value={product} onChange={(e) => setProduct(e.target.value)}>
          {PRODUCTS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => fetchData(true)} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div className="status">Loading latest data...</div>}
      {error && <div className="status error">Error: {error}</div>}
      {!loading && !error && (
        <div className="status">
          Source: {fromCache ? "Cache" : "Live scrape"} | Last refreshed: {readableRefreshedAt}
        </div>
      )}
      {kpiError && <div className="status error">KPI Error: {kpiError}</div>}

      <div className="chartCard">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={tableRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="imports" name="Imports" stroke="#2b6cb0" />
            <Line type="monotone" dataKey="exports" name="Exports" stroke="#2f855a" />
            <Line type="monotone" dataKey="consumption" name="Consumption" stroke="#c05621" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Product</th>
              <th>Imports</th>
              <th>Exports</th>
              <th>Consumption</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((item) => (
              <tr key={`${item.product}-${item.month}`}>
                <td>{item.month}</td>
                <td>{item.product}</td>
                <td>{item.imports}</td>
                <td>{item.exports}</td>
                <td>{item.consumption}</td>
              </tr>
            ))}
            {!tableRows.length && !loading && !error && (
              <tr>
                <td colSpan="5">No records found for this product.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewsPage() {
  const [newsPayload, setNewsPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeSource, setActiveSource] = useState(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/news`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = await response.json();
      setNewsPayload(payload);
    } catch (err) {
      setError(err.message || "Could not fetch RSS news");
      setNewsPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  const sourceEntries = useMemo(() => {
    const sources = newsPayload?.sources || {};
    const preferredOrder = ["IEA", "EIA"];
    const remainder = Object.keys(sources).filter((source) => !preferredOrder.includes(source));
    const orderedSources = [...preferredOrder.filter((source) => sources[source]), ...remainder];

    return orderedSources.map((source) => {
      const payload = sources[source] || { items: [], errors: [] };
      const sortedItems = [...(payload.items || [])].sort(
        (left, right) => new Date(right.publishedAt) - new Date(left.publishedAt)
      );
      return [source, { ...payload, items: sortedItems }];
    });
  }, [newsPayload]);

  const handleToggle = (source) => {
    setActiveSource((current) => (current === source ? null : source));
  };

  return (
    <>
      <h1>Energy News (RSS)</h1>
      <div className="controls">
        <button type="button" onClick={fetchNews} disabled={loading}>
          Refresh News
        </button>
      </div>

      {loading && <div className="status">Loading RSS news...</div>}
      {error && <div className="status error">Error: {error}</div>}
      {!loading && !error && (
        <div className="status">
          Last refreshed: {formatDateTime(newsPayload?.updatedAt)} | Keywords:{" "}
          {(newsPayload?.keywords || []).join(", ")}
        </div>
      )}

      <div className="accordionContainer">
        {sourceEntries.map(([source, payload]) => (
          <AccordionSection
            key={source}
            source={source}
            payload={payload}
            isOpen={activeSource === source}
            onToggle={() => handleToggle(source)}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// App — root with three-tab navigation
// ---------------------------------------------------------------------------

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  const navigateTo = (nextPath) => {
    if (window.location.pathname === nextPath) return;
    window.history.pushState({}, "", nextPath);
    setPathname(nextPath);
  };

  useEffect(() => {
    const handlePathChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePathChange);
    return () => window.removeEventListener("popstate", handlePathChange);
  }, []);

  const activePage = () => {
    if (pathname === PATHS.news) return <NewsPage />;
    if (pathname === PATHS.bse) return <BsePage />;   // ← NEW
    return <DashboardPage />;
  };

  return (
    <div className="app">
      <nav className="pageNav">
        <button
          type="button"
          onClick={() => navigateTo(PATHS.dashboard)}
          className={pathname === PATHS.dashboard ? "active" : ""}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => navigateTo(PATHS.news)}
          className={pathname === PATHS.news ? "active" : ""}
        >
          RSS News
        </button>
        {/* ── NEW TAB ── */}
        <button
          type="button"
          onClick={() => navigateTo(PATHS.bse)}
          className={pathname === PATHS.bse ? "active" : ""}
        >
          BSE Financials
        </button>
      </nav>
      {activePage()}
    </div>
  );
}

export default App;
