/**
 * Pure types and formatting helpers for the COGS calculator.
 * Safe to import from client components.
 * The async calculateCOGS function lives in /api/admin/settings/cogs/route.ts
 * and is called via fetch() from client components.
 */

/** One SKU's contribution to a COGS calculation */
export type SkuCogsRow = {
  sku_id:       string
  sku_name:     string
  sku_code:     string
  volume_ml:    number      // ml per unit
  dm_per_ml:    number      // SKU-specific, from standard_costs
  dl_per_ml:    number      // shared rate: DL actual ÷ total FG ml
  moh_per_ml:   number      // shared rate: MOH actual ÷ total FG ml
  total_per_ml: number
  units_sold:   number
  cogs:         number      // units_sold × volume_ml × total_per_ml
}

export type CogsResult = {
  month:           string
  total_volume_ml: number
  dl_actual:       number
  moh_actual:      number
  dl_per_ml:       number
  moh_per_ml:      number
  skus:            SkuCogsRow[]
  total_cogs:      number
}

/** Format ฿/ml with 4 decimal places */
export function fmtPerMl(n: number): string {
  return `฿${n.toFixed(4)}/ml`
}

/** Format THB with thousands separator */
export function fmtThb(n: number): string {
  return `฿${Math.round(n).toLocaleString('en-US')}`
}
