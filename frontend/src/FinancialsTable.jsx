/**
 * FinancialsTable.jsx
 *
 * Renders the BSE Integrated Filing (Finance) rows.
 * Expects rows shaped as:
 *   { Year, Quarter, Status, "Filing Date Time",
 *     "Revised Filing Date Time", "Revision Reason",
 *     "XBRL Link": { text, href } }
 */

const COLUMNS = [
  "Year",
  "Quarter",
  "Status",
  "Filing Date Time",
  "Revised Filing Date Time",
  "Revision Reason",
  "XBRL Link",
];

export function FinancialsTable({ columns, rows }) {
  const displayColumns = columns?.length ? columns : COLUMNS;

  if (!rows?.length) {
    return <p className="status">No filing records found.</p>;
  }

  return (
    <div className="bseTableWrap">
      <table className="bseTable">
        <thead>
          <tr>
            {displayColumns.map((col) => (
              <th key={col} className="bseColHeader">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="bseRowData">
              {displayColumns.map((col) => {
                const value = row[col];

                // XBRL Link is an object { text, href }
                if (col === "XBRL Link") {
                  return (
                    <td key={col} className="bseCellValue bseCellLink">
                      {value?.href ? (
                        <a
                          href={value.href}
                          target="_blank"
                          rel="noreferrer"
                          className="bseXbrlLink"
                        >
                          {value.text || "View"}
                        </a>
                      ) : (
                        value?.text || "—"
                      )}
                    </td>
                  );
                }

                return (
                  <td key={col} className="bseCellValue">
                    {value || "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}