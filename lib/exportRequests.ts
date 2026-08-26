import * as XLSX from "xlsx";
import type { ExpenseRequest, FileEntry, RequestItem } from "@/types/database";

// Raw-data export for Accounting to reconcile against paper records — every
// field captured on /submit (Basic Info, PO Required, Expense Items,
// Payment Details, Attachments), one row per request. Values are left raw
// (ISO timestamps, unformatted numbers) rather than pretty-printed, since
// this is meant to be recomputed/cross-checked in Excel, not read as a
// display table — see components/StatusBadge.tsx/lib/format.ts for the
// formatted versions used elsewhere in the app.
//
// Multi-item requests stay one row per request (not one row per item) —
// item-level detail is flattened into the "Items Detail" column instead of
// spread across dynamic columns, since item count varies per request.

function itemsDetail(items: RequestItem[]): string {
  return items
    .map((it) => {
      const path = [it.segment, it.cat_l1, it.cat_l2].filter(Boolean).join(" / ");
      return `${path || "(no segment)"}: ${it.description} | net=${it.amount_net} vat=${it.vat_rate}% wht=${it.wht_rate}%${
        it.product_code ? ` code=${it.product_code}` : ""
      }${it.product ? ` product=${it.product}` : ""}`;
    })
    .join("; ");
}

function filesDetail(files: FileEntry[]): string {
  return files.map((f) => `${f.name}${f.doc_type ? ` (${f.doc_type})` : ""}`).join("; ");
}

function travelDetail(items: { travel_by: string; distance_km: number | null }[]): string {
  return items.map((t) => `${t.travel_by}${t.distance_km ? ` - ${t.distance_km}km` : ""}`).join("; ");
}

function yesNo(v: boolean | null | undefined): string {
  return v ? "Yes" : "No";
}

export function exportRequestsToExcel(requests: ExpenseRequest[], filename: string) {
  const rows = requests.map((r) => ({
    "Request ID": r.request_id,
    "Submitted At": r.timestamp,
    "Requester Name": r.requester_name,
    "Requester Email": r.requester_email,
    Chapter: r.chapter ?? "",
    BU: r.bu,
    "Use for Company": r.use_for_company ?? "",
    Segment: r.department,
    "Expense Type": r.expense_type,
    "Urgent Reason": r.urgent_reason ?? "",
    "Budget Period": r.budget_period,
    "Product/Branch": r.product ?? "",
    "Category L1": r.cat_l1 ?? "",
    "Category L2": r.cat_l2 ?? "",
    Description: r.description ?? "",
    "Items Detail": itemsDetail(r.items_json ?? []),
    "Items Summary": r.items_summary ?? "",
    "Items Count": r.items_count,
    "Amount Net": r.amount_net,
    "VAT Rate (%)": r.vat_rate,
    "VAT Amount": r.vat_amount,
    "WHT Rate (%)": r.wht_rate,
    "WHT Amount": r.wht_amount,
    Total: r.total,
    "Requires PO": yesNo(r.requires_po),
    "PO Number": r.po_number ?? "",
    "PO Date": r.po_date ?? "",
    "PO Vendor": r.po_vendor ?? "",
    "PO Delivery Date": r.po_delivery_date ?? "",
    "PO Notes": r.po_notes ?? "",
    "PO Uploaded By": r.po_uploaded_by ?? "",
    "PO Uploaded At": r.po_uploaded_at ?? "",
    "Supplier Name": r.supplier_name ?? "",
    "Payment Method": r.pay_method ?? "",
    "Bank Name": r.bank_name ?? "",
    "Card Type": r.card_type ?? "",
    "Account No": r.account_no ?? "",
    "Credit Term (days)": r.credit_term_days ?? "",
    "Due Date": r.due_date ?? "",
    "Slip Receiver Email": r.slip_receiver_email ?? "",
    "Procurement Fills Payment": yesNo(r.procurement_fills_payment),
    "Petty Cash Holder Email": r.petty_cash_holder_email ?? "",
    "Travel Items": travelDetail(r.travel_items ?? []),
    Status: r.status,
    "Skip BO": yesNo(r.skip_bo),
    "Skip CEO": yesNo(r.skip_ceo),
    "BO Approver": r.bo_approver ?? "",
    "BO Approved At": r.bo_approved_at ?? "",
    "CEO Approver": r.ceo_approver ?? "",
    "CEO Approved At": r.ceo_approved_at ?? "",
    "CEO Signature Required": yesNo(r.ceo_signature_required),
    "Accounting User": r.accounting_user ?? "",
    "Paid At": r.paid_at ?? "",
    "Rejected By": r.rejected_by ?? "",
    "Rejected Stage": r.rejected_stage ?? "",
    "Reject Reason": r.reject_reason ?? "",
    "Rejected At": r.rejected_at ?? "",
    "Resubmit Count": r.resubmit_count,
    Files: filesDetail(r.files_json ?? []),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Requests");
  XLSX.writeFile(workbook, filename);
}
