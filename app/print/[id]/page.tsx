"use client";

import { useEffect, useState } from "react";
import PrintSignaturePad from "@/components/shared/PrintSignaturePad";
import { computeTotals } from "@/lib/totals";
import { formatCurrency, formatDate } from "@/lib/format";
import { PETTY_CASH_LABEL } from "@/lib/constants";
import type { CompanyRow, ExpenseRequest, FileEntry } from "@/types/database";

type SignatureBox = "requester" | "approver" | "accounting";

function findSignature(files: FileEntry[], box: SignatureBox): FileEntry | undefined {
  return files.find((f) => f.doc_type === "Signature" && f.name.includes(`signature_${box}`));
}

function SignatureBoxView({
  label,
  name,
  files,
  boxKey,
  onSigned,
}: {
  label: string;
  name: string | null;
  files: FileEntry[];
  boxKey: SignatureBox;
  onSigned: (entry: FileEntry) => Promise<void>;
}) {
  const [signing, setSigning] = useState(false);
  const signature = findSignature(files, boxKey);

  return (
    <div className="flex-1 rounded-md border border-brand-border p-3 text-xs">
      <p className="mb-2 font-semibold text-brand-dark">{label}</p>
      <p className="mb-1 text-brand-dark">{name ?? "-"}</p>
      <p className="mb-2 text-brand-subtle">Date: _______________</p>
      {signature ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={signature.url} alt={`${label} signature`} style={{ height: 60, width: 120, objectFit: "contain" }} />
      ) : (
        <div
          className="flex items-center justify-center text-brand-subtle"
          style={{ height: 60, width: 120, border: "1px dashed #D8CBB0" }}
        >
          sign here
        </div>
      )}
      {!signature && !signing && (
        <button type="button" onClick={() => setSigning(true)} className="mt-1.5 text-brand-brown print:hidden">
          ✍️ Sign document
        </button>
      )}
      {signing && !signature && (
        <PrintSignaturePad
          boxKey={boxKey}
          onSaved={async (entry) => {
            await onSigned(entry);
            setSigning(false);
          }}
        />
      )}
    </div>
  );
}

export default function PrintRequestPage({ params }: { params: { id: string } }) {
  const [request, setRequest] = useState<ExpenseRequest | null>(null);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load request");
        }
        return res.json();
      })
      .then((data) => setRequest(data.request))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load request"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [params.id]);

  useEffect(() => {
    if (!request?.use_for_company) return;
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => {
        const match = (data.companies ?? []).find((c: CompanyRow) => c.bu === request.use_for_company);
        setCompany(match ?? null);
      });
  }, [request?.use_for_company]);

  const attachSignature = async (entry: FileEntry) => {
    if (!request) return;
    const nextFiles = [...request.files_json, entry];
    const res = await fetch(`/api/requests/${request.request_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attach_signature: true, files_json: nextFiles }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to attach signature");
    }
    setRequest({ ...request, files_json: nextFiles });
  };

  if (loading) return <p className="p-6 text-sm text-brand-muted">Loading...</p>;
  if (error || !request) return <p className="p-6 text-sm text-red-600">{error ?? "Request not found"}</p>;

  const items = request.items_json;
  const totals = computeTotals(items.length > 0 ? items : request.items_json);
  const isPettyCash = request.expense_type === PETTY_CASH_LABEL;
  const approverLabel = isPettyCash ? "Petty Cash Holder" : "Approved by BO";
  const approverName = isPettyCash ? request.petty_cash_holder_email : request.bo_approver;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-brand-dark print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <button type="button" onClick={() => window.print()} className="mm-btn-primary mm-btn-sm">
          🖨️ Print / Save PDF
        </button>
      </div>

      {/* Header */}
      <div className="mb-4 border-b border-brand-border pb-4 text-center">
        {company ? (
          <>
            <p className="text-base font-bold">{company.name_en}</p>
            {company.name_th && <p className="text-sm">{company.name_th}</p>}
            <p className="mt-1 text-xs text-brand-muted">{company.address}</p>
          </>
        ) : (
          <p className="text-base font-bold">{request.use_for_company ?? "-"}</p>
        )}
        <p className="mt-3 text-lg font-bold uppercase tracking-wide">Expense Request Form</p>
        <p className="mt-1 text-xs text-brand-muted">
          {request.request_id} — Submitted {formatDate(request.timestamp)}
        </p>
      </div>

      {/* Basic Info */}
      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-brand-border pb-4">
        <div>Requester: {request.requester_name}</div>
        <div>Chapter: {request.chapter ?? "-"}</div>
        <div>Segment: {request.department}</div>
        <div>Budget Period: {request.budget_period}</div>
        <div>Expense Type: {request.expense_type}</div>
        <div>Use for company: {request.use_for_company ?? "-"}</div>
        <div>Status: {request.status}</div>
      </div>

      {/* Expense Items */}
      <div className="mb-4 border-b border-brand-border pb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-brand-border text-left">
              <th className="py-1">Segment</th>
              <th className="py-1">Cat L1</th>
              <th className="py-1">Cat L2</th>
              <th className="py-1">Description</th>
              <th className="py-1 text-right">Net</th>
              <th className="py-1 text-right">VAT</th>
              <th className="py-1 text-right">WHT</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const vatAmount = (item.amount_net * item.vat_rate) / 100;
              const whtAmount = (item.amount_net * item.wht_rate) / 100;
              const lineTotal = item.amount_net + vatAmount - whtAmount;
              return (
                <tr key={idx} className="border-b border-[#F0EAE0]">
                  <td className="py-1">{item.segment || "-"}</td>
                  <td className="py-1">{item.cat_l1 || "-"}</td>
                  <td className="py-1">{item.cat_l2 || "-"}</td>
                  <td className="py-1">
                    {item.description}
                    {item.travel_by && (
                      <span className="text-brand-subtle">
                        {" "}
                        ({item.travel_by}
                        {item.distance_km ? `, ${item.distance_km} km` : ""})
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right">{formatCurrency(item.amount_net)}</td>
                  <td className="py-1 text-right">{formatCurrency(vatAmount)}</td>
                  <td className="py-1 text-right">{formatCurrency(whtAmount)}</td>
                  <td className="py-1 text-right">{formatCurrency(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-bold">
            <tr>
              <td colSpan={4} className="py-1 text-right">
                Totals
              </td>
              <td className="py-1 text-right">{formatCurrency(totals.amount_net)}</td>
              <td className="py-1 text-right">{formatCurrency(totals.vat_amount)}</td>
              <td className="py-1 text-right">{formatCurrency(totals.wht_amount)}</td>
              <td className="py-1 text-right">{formatCurrency(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment Details */}
      {!isPettyCash && (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-brand-border pb-4">
          <div>Supplier: {request.supplier_name ?? "-"}</div>
          <div>Payment Method: {request.pay_method ?? "-"}</div>
          <div>Bank: {request.bank_name ?? "-"}</div>
          <div>Account No: {request.account_no ?? "-"}</div>
          <div>Due Date: {request.due_date ? formatDate(request.due_date) : "-"}</div>
          <div>Credit Term: {request.credit_term_days ?? "-"}</div>
          <div>Slip Receiver: {request.slip_receiver_email ?? "-"}</div>
        </div>
      )}

      {/* Attachments */}
      <div className="mb-4 border-b border-brand-border pb-4">
        <p className="mb-1 font-semibold">Attachments</p>
        {request.files_json.filter((f) => f.doc_type !== "Signature").length === 0 ? (
          <p className="text-brand-subtle">No attachments.</p>
        ) : (
          <ul className="space-y-0.5">
            {request.files_json
              .filter((f) => f.doc_type !== "Signature")
              .map((f, idx) => (
                <li key={idx}>
                  {f.name} — <span className="text-brand-subtle">{f.doc_type || "Other"}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* Signatures */}
      <div className="flex gap-3">
        <SignatureBoxView
          label="Requester"
          name={request.requester_name}
          files={request.files_json}
          boxKey="requester"
          onSigned={attachSignature}
        />
        <SignatureBoxView
          label={approverLabel}
          name={approverName}
          files={request.files_json}
          boxKey="approver"
          onSigned={attachSignature}
        />
        <SignatureBoxView
          label="Accounting"
          name={request.accounting_user}
          files={request.files_json}
          boxKey="accounting"
          onSigned={attachSignature}
        />
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 16mm;
          }
        }
      `}</style>
    </div>
  );
}
