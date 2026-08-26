/**
 * Shared P&L types and pure helpers.
 * Safe to import from both Server and Client Components.
 * No server-only imports here.
 */

export type Amounts = {
  budget: number
  actual: number
  /** budget - actual */
  variance: number
}

export const ZERO: Amounts = { budget: 0, actual: 0, variance: 0 }

export function amounts(budget: number, actual: number): Amounts {
  return { budget, actual, variance: budget - actual }
}

export function addAmounts(a: Amounts, b: Amounts): Amounts {
  return amounts(a.budget + b.budget, a.actual + b.actual)
}

export type PLLineItemRow = {
  lineItemId: string
  name: string
  subcategoryL1: string | null
  categoryId: string
  categoryName: string
  categoryOwnerName: string | null  // categories.owner_name
  cogmGroup: 'DM' | 'DL' | 'MOH' | null
  isHrCategory: boolean
  lineItemType: 'REVENUE' | 'EXPENSE'
  ownerName: string | null          // line_items.owner_name — takes priority over categoryOwnerName
} & Amounts

export type PLCapexSubGroup = {
  name:       string
  categoryId: string
  ownerName:  string | null
  lineItems:  PLLineItemRow[]
  subtotal:   Amounts
}

export type PLGroupData = {
  deptCode: string
  deptFullName: string
  departmentId: string
  subtotalLabel: string
  lineItems: PLLineItemRow[]   // for nested CAPEX groups: flattened from all subGroups
  subtotal: Amounts
  ownerName: string | null
  capexSubGroups?: PLCapexSubGroup[]  // present only for CAPEX nested groups
}

export type PLSectionData = {
  id: string
  title: string
  totalLabel: string
  totalId: string
  note?: string
  hideOwner?: boolean
  groups: PLGroupData[]
  total: Amounts
}

export type PLCalcRowData = {
  id: string
  label: string
  afterSectionId: string
} & Amounts

export type PLData = {
  year: number
  month: number
  sections: PLSectionData[]
  calculatedRows: PLCalcRowData[]
}

export type MonthColumn = {
  year:  number
  month: number
  label: string
  data:  PLData
}
