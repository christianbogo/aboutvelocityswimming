import { useEffect, useState } from "react";
import { InventoryTable } from "./ImportsInventory";
import { importIssuesPage, importPageSize, type ImportIssueRow, type ImportIssuesPage } from "./imports-review-api";
import inventory from "./ImportsInventory.module.css";
import styles from "./ImportsReview.module.css";

const columns = ["Action", "Record", "Issue"];
const title = "Issues to resolve";

export default function ImportIssuesTable({ busy, onOpen }: {
  busy: boolean;
  onOpen: (row: ImportIssueRow) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; page?: ImportIssuesPage; error?: string }>();
  const key = `${offset}/${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    void importIssuesPage(offset, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setLoaded({ key, page });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, error: error instanceof Error ? error.message : "Import issues could not be loaded." });
      },
    );
    return () => controller.abort();
  }, [key, offset]);

  const response = loaded?.key === key ? loaded : undefined;
  const page = response?.page;

  if (response?.error) {
    return (
      <p role="alert" className={inventory.notice}>
        {response.error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      </p>
    );
  }
  if (!page?.total) return null;

  return (
    <section className={styles.section} aria-labelledby="import-issues">
      <h2 id="import-issues">{title}</h2>
      <InventoryTable label={title} columns={columns} tableClassName={styles.issuesTable} empty={page.rows.length ? undefined : "No import issues on this page."}>
        {page.rows.map((row) => (
          <tr key={row.id}>
            <td>
              <button type="button" aria-describedby={`issue-record-${row.id}`} disabled={busy} onClick={() => onOpen(row)}>
                {row.canResolveSwimmerMatch ? "Resolve swimmer match" : row.linkedMeetRow ? "Review linked meet" : "View issue"}
              </button>
            </td>
            <th id={`issue-record-${row.id}`} scope="row">
              {row.label}
              {(row.teamName || (row.meetName && row.meetName !== row.label)) && (
                <span className={styles.issueContext}>
                  {[row.teamName, row.meetName === row.label ? null : row.meetName].filter(Boolean).join(" · ")}
                </span>
              )}
            </th>
            <td>{row.blocker}</td>
          </tr>
        ))}
      </InventoryTable>
      {(offset > 0 || page.hasNext) && (
        <div className={inventory.pagination}>
          <p>{page.rows.length ? `${(offset + 1).toLocaleString()}–${(offset + page.rows.length).toLocaleString()}` : "0"} of {page.total.toLocaleString()} issues</p>
          <nav aria-label="Import issue pages">
            <button type="button" disabled={offset === 0 || busy} onClick={() => setOffset(offset - importPageSize)}>Previous</button>
            <button type="button" disabled={!page.hasNext || busy} onClick={() => setOffset(offset + importPageSize)}>Next</button>
          </nav>
        </div>
      )}
    </section>
  );
}
