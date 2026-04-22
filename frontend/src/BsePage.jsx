/**
 * BsePage.jsx
 *
 * Tab content for the BSE Integrated Filing (Finance) page.
 * Shows a list of companies; clicking one loads its filing rows on demand.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FinancialsTable } from "./FinancialsTable";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// CompanyRow — one accordion item per company
// ---------------------------------------------------------------------------

function CompanyRow({ company, isOpen, onToggle }) {
  const [state, setState] = useState({
    data: null,
    loading: false,
    error: "",
    fromCache: false,
  });

  const hasFetched = useRef(false);

  const fetchFinancials = useCallback(
    async (forceRefresh = false) => {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const response = await fetch(
          `${API_BASE}/api/bse/financials/${company.id}?refresh=${forceRefresh}`
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${response.status}`);
        }
        const payload = await response.json();
        setState({
          data: payload,
          loading: false,
          error: "",
          fromCache: Boolean(payload.fromCache),
        });
        hasFetched.current = true;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err.message || "Failed to fetch financials",
        }));
      }
    },
    [company.id]
  );

  // Fetch automatically on first open
  useEffect(() => {
    if (isOpen && !hasFetched.current) {
      fetchFinancials(false);
    }
  }, [isOpen, fetchFinancials]);

  const { data, loading, error, fromCache } = state;

  return (
    <div className="bseCompanyRow">
      {/* Header */}
      <button
        type="button"
        className={`bseCompanyHeader ${isOpen ? "active" : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="bseCompanyHeaderLeft">
          <span className="bseToggleIcon">{isOpen ? "−" : "+"}</span>
          <div className="bseCompanyMeta">
            <span className="bseCompanyName">{company.name}</span>
            <span className="bseCompanyTags">
              <span className="bseTag">{company.ticker}</span>
              <span className="bseTag secondary">BSE {company.bseCode}</span>
            </span>
          </div>
        </div>
        {isOpen && hasFetched.current && !loading && !error && (
          <span className="bseSectionCount">
            {data?.rows?.length ?? 0} record{data?.rows?.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="bseCompanyContent">
          {/* Status bar */}
          <div className="bseStatusBar">
            {loading && (
              <span className="status">
                ⏳ Fetching live data from BSE — this may take 15–30 seconds…
              </span>
            )}
            {error && <span className="status error">⚠ {error}</span>}
            {!loading && !error && data && (
              <span className="status">
                Source: {fromCache ? "Cache" : "Live scrape"}&nbsp;|&nbsp;
                Scraped:{" "}
                {new Date(data.scrapedAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                &nbsp;|&nbsp;
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bseSourceLink"
                >
                  View on BSE ↗
                </a>
              </span>
            )}
          </div>

          {/* Refresh button */}
          {hasFetched.current && !loading && (
            <div className="bseRefreshRow">
              <button
                type="button"
                className="bseRefreshBtn"
                onClick={() => fetchFinancials(true)}
                disabled={loading}
              >
                ↻ Refresh
              </button>
            </div>
          )}

          {/* Table */}
          {!loading && !error && data && (
            <FinancialsTable columns={data.columns} rows={data.rows} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BsePage
// ---------------------------------------------------------------------------

export function BsePage() {
  const [companies, setCompanies] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [activeCompanyId, setActiveCompanyId] = useState(null);

  useEffect(() => {
    (async () => {
      setLoadingList(true);
      setListError("");
      try {
        const response = await fetch(`${API_BASE}/api/bse/companies`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        setCompanies(payload.companies || []);
      } catch (err) {
        setListError(err.message || "Could not load company list");
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  const handleToggle = (companyId) => {
    setActiveCompanyId((current) => (current === companyId ? null : companyId));
  };

  return (
    <div className="bsePage">
      <div className="bsePageHeader">
        <h1>BSE Integrated Filing — Finance</h1>
        <p className="bsePageSubtitle">
          Quarterly filing records sourced live from BSE India. Select a
          company to load its data.
        </p>
      </div>

      {loadingList && <div className="status">Loading company list…</div>}
      {listError && <div className="status error">Error: {listError}</div>}

      {!loadingList && !listError && (
        <div className="bseCompanyList">
          {companies.map((company) => (
            <CompanyRow
              key={company.id}
              company={company}
              isOpen={activeCompanyId === company.id}
              onToggle={() => handleToggle(company.id)}
            />
          ))}
          {!companies.length && (
            <div className="status">
              No companies configured in bse-companies.json.
            </div>
          )}
        </div>
      )}
    </div>
  );
}