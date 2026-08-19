"use client";

import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { thb } from "./format";
import type { SpendPendingRequest } from "@/lib/spend";
import type { Status } from "@/lib/constants";

interface Props {
  requests: SpendPendingRequest[];
}

export default function PendingPanel({ requests }: Props) {
  return (
    <div className="mm-card">
      <div className="mm-section-label">Pending approval</div>
      {requests.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-brand-muted">
          Nothing awaiting approval in this selection.
        </p>
      ) : (
        <>
          <div className="mm-table-wrap">
            <table className="mm-table">
              <thead>
                <tr>
                  <th className="text-left">Request</th>
                  <th className="text-left">Description</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.request_id}>
                    <td className="whitespace-nowrap px-3 py-2">
                      {/* /print/[id] is this app's only deep-linkable
                          single-request view — the RequestDetailModal used by
                          the list pages opens on row click and has no URL of
                          its own. */}
                      <Link
                        href={`/print/${r.request_id}`}
                        className="font-mono text-[13px] text-brand-brown hover:text-brand-accent hover:underline"
                      >
                        {r.request_id}
                      </Link>
                    </td>
                    <td className="max-w-[420px] truncate px-3 py-2 text-brand-muted" title={r.description}>
                      {r.description}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status as Status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-brand-dark">
                      {thb(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-brand-subtle">
            Top {requests.length} by amount.
          </p>
        </>
      )}
    </div>
  );
}
