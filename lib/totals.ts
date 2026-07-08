import type { RequestItem } from "@/types/database";

export interface ComputedTotals {
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  wht_rate: number;
  wht_amount: number;
  total: number;
  items_summary: string;
  items_count: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Aggregates a multi-item request into the flat summary fields stored
// alongside items_json. vat_rate/wht_rate are only meaningful as a single
// number when every item shares the same rate; otherwise they're reported
// as 0 ("mixed") and the per-item rates in items_json are authoritative.
export function computeTotals(items: RequestItem[]): ComputedTotals {
  if (items.length === 0) {
    throw new Error("At least one item is required");
  }

  let amount_net = 0;
  let vat_amount = 0;
  let wht_amount = 0;

  for (const item of items) {
    const itemVat = round2((item.amount_net * item.vat_rate) / 100);
    const itemWht = round2((item.amount_net * item.wht_rate) / 100);
    amount_net += item.amount_net;
    vat_amount += itemVat;
    wht_amount += itemWht;
  }

  const uniformVatRate = items.every((i) => i.vat_rate === items[0].vat_rate)
    ? items[0].vat_rate
    : 0;
  const uniformWhtRate = items.every((i) => i.wht_rate === items[0].wht_rate)
    ? items[0].wht_rate
    : 0;

  const total = round2(amount_net + vat_amount - wht_amount);

  return {
    amount_net: round2(amount_net),
    vat_rate: uniformVatRate,
    vat_amount: round2(vat_amount),
    wht_rate: uniformWhtRate,
    wht_amount: round2(wht_amount),
    total,
    items_summary:
      items.length === 1
        ? items[0].description
        : `${items.length} items: ${items.map((i) => i.description).join(", ")}`,
    items_count: items.length,
  };
}
