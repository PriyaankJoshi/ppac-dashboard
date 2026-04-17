import { useEffect, useMemo, useState } from "react";
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

const PRODUCTS = ["LPG", "Naphtha", "ATF"];

function App() {
  const [product, setProduct] = useState("LPG");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/data?product=${encodeURIComponent(product)}&refresh=${forceRefresh}`
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
  };

  useEffect(() => {
    fetchData(false);
  }, [product]);

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
    <div className="app">
      <h1>PPAC Product Dashboard</h1>

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
    </div>
  );
}

export default App;
