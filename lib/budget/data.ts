import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { PL_SECTIONS, PL_CALCULATED_ROWS } from './structure'
import {
  ZERO, amounts, addAmounts,
  type Amounts, type PLLineItemRow, type PLGroupData, type PLCapexSubGroup,
  type PLSectionData, type PLCalcRowData, type PLData,
} from './types'

// Re-export everything so server components can import from one place
export type {
  Amounts, PLLineItemRow, PLGroupData, PLCapexSubGroup, PLSectionData, PLCalcRowData, PLData, MonthColumn,
} from './types'
export { ZERO, amounts, addAmounts } from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

function scaleAmounts(a: Amounts, sign: 1 | -1): Amounts {
  return amounts(sign * a.budget, sign * a.actual)
}

// ── Row shapes from the Supabase nested select (client is untyped) ──────────────
// Mirrors getPLData's select on cashflow_line_items → cashflow_categories →
// cashflow_departments. Relations are to-one, so typed as single objects.
type CashflowDeptRow = { id: string; code: string; full_name: string }
type CashflowCatRow = {
  id: string
  name: string
  cogm_group: 'DM' | 'DL' | 'MOH' | null
  capex_group: string | null
  owner_name: string | null
  is_hr_category: boolean
  cashflow_departments: CashflowDeptRow | null
}
type CashflowLineItemRow = {
  id: string
  name: string
  subcategory_l1: string | null
  type: 'REVENUE' | 'EXPENSE'
  owner_name: string | null
  cashflow_categories: CashflowCatRow | null
}

// ── Internal builder ──────────────────────────────────────────────────────────

function buildPLDataFromMaps({
  year, month, lineItemsData, deptsData, budgetMap, actualMap,
}: {
  year: number
  month: number
  lineItemsData: CashflowLineItemRow[]
  deptsData: { id: string; code: string; full_name: string; owner_name?: string | null }[]
  budgetMap: Record<string, number>
  actualMap: Record<string, number>
}): PLData {
  // UUID + owner lookup: `${code}|${full_name}` → id
  const deptUuidMap:  Record<string, string>         = {}
  const deptOwnerMap: Record<string, string | null>  = {}
  for (const d of deptsData) {
    const key = `${d.code}|${d.full_name}`
    deptUuidMap[key]  = d.id
    deptOwnerMap[d.id] = d.owner_name ?? null
  }

  // dept key → line items; catMap by category name; capexGroupMap for nested CAPEX sub-groups
  const deptMap: Record<string, PLLineItemRow[]> = {}
  const catMap:  Record<string, PLLineItemRow[]> = {}
  // capexGroupMap: capex_group value → { categoryName → { items, catId, ownerName } }
  const capexGroupMap = new Map<string, Map<string, { items: PLLineItemRow[]; catId: string; ownerName: string | null }>>()

  for (const li of lineItemsData) {
    const cat  = li.cashflow_categories
    const dept = cat?.cashflow_departments
    if (!cat || !dept?.code || !dept?.full_name) continue
    const deptKey  = `${dept.code}|${dept.full_name}`
    const catKey   = `${dept.code}|${cat.name}`
    const budget   = budgetMap[li.id] ?? 0
    const actual   = actualMap[li.id] ?? 0
    const subLabel: string | null = li.subcategory_l1
      ?? (dept.code === 'OEM' && cat.name !== li.name ? cat.name : null)
    const row: PLLineItemRow = {
      lineItemId:        li.id,
      name:              li.name,
      subcategoryL1:     subLabel,
      categoryId:        cat.id ?? '',
      categoryName:      cat.name ?? '',
      categoryOwnerName: cat.owner_name ?? null,
      cogmGroup:         cat.cogm_group ?? null,
      isHrCategory:      cat.is_hr_category ?? false,
      lineItemType:      li.type ?? 'EXPENSE',
      ownerName:         li.owner_name ?? null,
      ...amounts(budget, actual),
    }
    ;(deptMap[deptKey] ??= []).push(row)
    ;(catMap[catKey]   ??= []).push(row)

    // Populate capexGroupMap for categories that belong to a capex_group
    const capexGroup = cat.capex_group
    if (capexGroup) {
      if (!capexGroupMap.has(capexGroup)) capexGroupMap.set(capexGroup, new Map())
      const sgMap = capexGroupMap.get(capexGroup)!
      if (!sgMap.has(cat.name)) sgMap.set(cat.name, { items: [], catId: cat.id ?? '', ownerName: cat.owner_name ?? null })
      sgMap.get(cat.name)!.items.push(row)
    }
  }

  const totalsLookup: Record<string, Amounts> = {}

  const sections: PLSectionData[] = PL_SECTIONS.map(section => {
    const groups: PLGroupData[] = section.groups.map(group => {
      const baseDeptId = Object.entries(deptUuidMap)
        .find(([k]) => k.startsWith(`${group.deptCode}|`))?.[1] ?? ''

      // ── Nested CAPEX group (capexGroupName set) ──────────────────────────
      if (group.capexGroupName) {
        type SgEntry = { items: PLLineItemRow[]; catId: string; ownerName: string | null }
        const sgMap: Map<string, SgEntry> = capexGroupMap.get(group.capexGroupName) ?? new Map()
        const allNames     = Array.from(sgMap.keys())
        const orderedNames = group.capexSubGroupOrder
          ? [
              ...group.capexSubGroupOrder.filter(n => allNames.includes(n)),
              ...allNames.filter(n => !group.capexSubGroupOrder!.includes(n)).sort(),
            ]
          : allNames.sort()
        const capexSubGroups: PLCapexSubGroup[] = orderedNames.map(name => {
          const sg          = sgMap.get(name)!
          const sortedItems = sg.items.slice().sort((a, b) => a.name.localeCompare(b.name))
          return { name, categoryId: sg.catId, ownerName: sg.ownerName, lineItems: sortedItems, subtotal: sortedItems.reduce(addAmounts, ZERO) }
        })
        const lineItems    = capexSubGroups.flatMap(sg => sg.lineItems)
        const subtotal     = capexSubGroups.reduce((acc, sg) => addAmounts(acc, sg.subtotal), ZERO)
        const departmentId = baseDeptId ? `${baseDeptId}:${group.capexGroupName}` : `capexgrp:${group.capexGroupName}`
        return {
          deptCode: group.deptCode, deptFullName: group.deptFullName, departmentId,
          subtotalLabel: group.subtotalLabel, lineItems, subtotal,
          ownerName: group.defaultOwnerName ?? null,
          capexSubGroups,
        }
      }

      // ── Flat CAPEX group (categoryName set) ─────────────────────────────
      if (group.categoryName) {
        const ck           = `${group.deptCode}|${group.categoryName}`
        const lineItems    = (catMap[ck] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
        const subtotal     = lineItems.reduce(addAmounts, ZERO)
        const departmentId = baseDeptId ? `${baseDeptId}:${group.categoryName}` : `cat:${group.categoryName}`
        return {
          deptCode: group.deptCode, deptFullName: group.deptFullName, departmentId,
          subtotalLabel: group.subtotalLabel, lineItems, subtotal,
          ownerName: deptOwnerMap[departmentId] ?? group.defaultOwnerName ?? null,
        }
      }

      // ── Standard dept full_name lookup ───────────────────────────────────
      const dk           = `${group.deptCode}|${group.deptFullName}`
      const lineItems    = (deptMap[dk] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
      const subtotal     = lineItems.reduce(addAmounts, ZERO)
      const departmentId = deptUuidMap[dk] ?? ''
      return {
        deptCode: group.deptCode, deptFullName: group.deptFullName, departmentId,
        subtotalLabel: group.subtotalLabel, lineItems, subtotal,
        ownerName: deptOwnerMap[departmentId] ?? group.defaultOwnerName ?? null,
      }
    })
    const total = groups.reduce((acc, g) => addAmounts(acc, g.subtotal), ZERO)
    totalsLookup[section.totalId] = total
    return { id: section.id, title: section.title, totalLabel: section.totalLabel, totalId: section.totalId, note: section.note, hideOwner: section.hideOwner, groups, total }
  })

  const calculatedRows: PLCalcRowData[] = PL_CALCULATED_ROWS.map(calcRow => {
    const result = calcRow.terms.reduce((acc, term) => {
      const src = totalsLookup[term.sectionTotalId] ?? ZERO
      return addAmounts(acc, scaleAmounts(src, term.sign))
    }, ZERO)
    totalsLookup[calcRow.id] = result
    return { id: calcRow.id, label: calcRow.label, afterSectionId: calcRow.afterSectionId, ...result }
  })

  return { year, month, sections, calculatedRows }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch P&L data for a single month. */
export async function getPLData(year: number, month: number): Promise<PLData> {
  const monthDate = `${year}-${String(month).padStart(2, '0')}-01`
  const supabase  = createAdminClient()

  const nextYear      = month === 12 ? year + 1 : year
  const nextMonth     = month === 12 ? 1 : month + 1
  const nextMonthDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  const [lineItemsRes, deptsRes, budgetsRes, expensesRes] = await Promise.all([
    supabase.from('cashflow_line_items').select(`
      id, name, subcategory_l1, type, owner_name,
      cashflow_categories ( id, name, cogm_group, capex_group, owner_name, is_hr_category, cashflow_departments ( id, code, full_name ) )
    `).order('name'),
    supabase.from('cashflow_departments').select('id, code, full_name, owner_name'),
    supabase.from('cashflow_budget_submissions')
      .select('line_item_id, amount')
      .gte('month', monthDate).lt('month', nextMonthDate).eq('status', 'approved'),
    supabase.from('cashflow_actuals')
      .select('line_item_id, amount')
      .eq('month', monthDate),
  ])

  const budgetMap: Record<string, number> = {}
  for (const r of (budgetsRes.data ?? [])) {
    budgetMap[r.line_item_id] = (budgetMap[r.line_item_id] ?? 0) + Number(r.amount)
  }
  const actualMap: Record<string, number> = {}
  for (const r of (expensesRes.data ?? [])) {
    actualMap[r.line_item_id] = (actualMap[r.line_item_id] ?? 0) + Number(r.amount)
  }

  return buildPLDataFromMaps({
    year, month,
    // supabase-js infers embedded to-one relations as arrays, but at runtime
    // they come back as single objects — cast to the true runtime shape.
    lineItemsData: (lineItemsRes.data ?? []) as unknown as CashflowLineItemRow[],
    deptsData:     deptsRes.data     ?? [],
    budgetMap, actualMap,
  })
}

/** Fetch P&L data for multiple months and sum all amounts. */
export async function getPLDataAggregated(
  periods: Array<{ year: number; month: number }>
): Promise<PLData> {
  if (periods.length === 0) throw new Error('No periods specified')
  if (periods.length === 1) return getPLData(periods[0].year, periods[0].month)

  const supabase = createAdminClient()

  const monthDates = periods.map(p => `${p.year}-${String(p.month).padStart(2, '0')}-01`)

  const [lineItemsRes, deptsRes, budgetRes, expensesRes] = await Promise.all([
    supabase.from('cashflow_line_items').select(`
      id, name, subcategory_l1, type, owner_name,
      cashflow_categories ( id, name, cogm_group, capex_group, owner_name, is_hr_category, cashflow_departments ( id, code, full_name ) )
    `).order('name'),
    supabase.from('cashflow_departments').select('id, code, full_name, owner_name'),
    supabase.from('cashflow_budget_submissions')
      .select('line_item_id, amount')
      .in('month', monthDates).eq('status', 'approved'),
    supabase.from('cashflow_actuals')
      .select('line_item_id, amount')
      .in('month', monthDates),
  ])

  const budgetMap: Record<string, number> = {}
  for (const r of (budgetRes.data ?? [])) {
    budgetMap[r.line_item_id] = (budgetMap[r.line_item_id] ?? 0) + Number(r.amount)
  }
  const actualMap: Record<string, number> = {}
  for (const r of (expensesRes.data ?? [])) {
    actualMap[r.line_item_id] = (actualMap[r.line_item_id] ?? 0) + Number(r.amount)
  }

  return buildPLDataFromMaps({
    year: periods[0].year, month: periods[0].month,
    // supabase-js infers embedded to-one relations as arrays, but at runtime
    // they come back as single objects — cast to the true runtime shape.
    lineItemsData: (lineItemsRes.data ?? []) as unknown as CashflowLineItemRow[],
    deptsData:     deptsRes.data     ?? [],
    budgetMap, actualMap,
  })
}

/**
 * Fetch P&L data for each period in one batch of 4 DB queries (vs 4×N).
 * Returns one PLData per period in the same order as the input.
 */
export async function getPLDataForMonths(
  periods: Array<{ year: number; month: number }>,
): Promise<PLData[]> {
  if (periods.length === 0) return []

  const supabase   = createAdminClient()
  const monthDates = periods.map(p => `${p.year}-${String(p.month).padStart(2, '0')}-01`)

  const [lineItemsRes, deptsRes, budgetsRes, expensesRes] = await Promise.all([
    supabase.from('cashflow_line_items').select(`
      id, name, subcategory_l1, type, owner_name,
      cashflow_categories ( id, name, cogm_group, capex_group, owner_name, is_hr_category, cashflow_departments ( id, code, full_name ) )
    `).order('name'),
    supabase.from('cashflow_departments').select('id, code, full_name, owner_name'),
    supabase.from('cashflow_budget_submissions')
      .select('line_item_id, amount, month')
      .in('month', monthDates).eq('status', 'approved'),
    supabase.from('cashflow_actuals')
      .select('line_item_id, amount, month')
      .in('month', monthDates),
  ])

  return periods.map((p, i) => {
    const md = monthDates[i]
    const budgetMap: Record<string, number> = {}
    for (const r of (budgetsRes.data ?? [])) {
      if (String(r.month).slice(0, 10) === md)
        budgetMap[r.line_item_id] = (budgetMap[r.line_item_id] ?? 0) + Number(r.amount)
    }
    const actualMap: Record<string, number> = {}
    for (const r of (expensesRes.data ?? [])) {
      if (String(r.month).slice(0, 10) === md)
        actualMap[r.line_item_id] = (actualMap[r.line_item_id] ?? 0) + Number(r.amount)
    }
    return buildPLDataFromMaps({
      year:         p.year,
      month:        p.month,
      // supabase-js infers embedded to-one relations as arrays, but at runtime
    // they come back as single objects — cast to the true runtime shape.
    lineItemsData: (lineItemsRes.data ?? []) as unknown as CashflowLineItemRow[],
      deptsData:    deptsRes.data     ?? [],
      budgetMap,
      actualMap,
    })
  })
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function rebuildCalcRows(sections: PLSectionData[]): PLCalcRowData[] {
  const totalsLookup: Record<string, Amounts> = {}
  for (const s of sections) totalsLookup[s.totalId] = s.total
  return PL_CALCULATED_ROWS.map(calcRow => {
    const result = calcRow.terms.reduce((acc, term) => {
      const src = totalsLookup[term.sectionTotalId] ?? ZERO
      return addAmounts(acc, scaleAmounts(src, term.sign))
    }, ZERO)
    totalsLookup[calcRow.id] = result
    return { id: calcRow.id, label: calcRow.label, afterSectionId: calcRow.afterSectionId, ...result }
  })
}

/** Keep only the groups belonging to the given department UUID. */
export function filterPLDataByDepartment(data: PLData, departmentId: string): PLData {
  return filterPLDataByDepartments(data, [departmentId])
}

/** Keep only the groups belonging to any of the given department UUIDs. */
export function filterPLDataByDepartments(data: PLData, departmentIds: string[]): PLData {
  const idSet = new Set(departmentIds)
  const sections = data.sections
    .map(section => {
      const groups = section.groups.filter(g => idSet.has(g.departmentId))
      const total  = groups.reduce((acc, g) => addAmounts(acc, g.subtotal), ZERO)
      return { ...section, groups, total }
    })
    .filter(s => s.groups.length > 0)
  return { ...data, sections, calculatedRows: rebuildCalcRows(sections) }
}

/** Keep only line items where isHrCategory === true. */
export function filterPLDataByHRCategory(data: PLData): PLData {
  const sections = data.sections
    .map(section => {
      const groups = section.groups
        .map(group => {
          const lineItems = group.lineItems.filter(li => li.isHrCategory)
          return { ...group, lineItems, subtotal: lineItems.reduce(addAmounts, ZERO) }
        })
        .filter(g => g.lineItems.length > 0)
      const total = groups.reduce((acc, g) => addAmounts(acc, g.subtotal), ZERO)
      return { ...section, groups, total }
    })
    .filter(s => s.groups.length > 0)
  return { ...data, sections, calculatedRows: rebuildCalcRows(sections) }
}

// ── Convenience accessor ──────────────────────────────────────────────────────

export function getCalcRow(
  data: PLData,
  id: 'net_revenue' | 'gross_profit' | 'net_profit',
): PLCalcRowData | undefined {
  return data.calculatedRows.find(r => r.id === id)
}

/** Derive comparison periods from a mode string. */
export function getComparisonPeriods(
  mode: string, year: number, month: number,
): {
  p1: Array<{ year: number; month: number }>
  p2: Array<{ year: number; month: number }>
  p1Label: string
  p2Label: string
  deltaLabel: string
} {
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  if (mode === 'qoq') {
    const q  = Math.ceil(month / 3)
    const qs = (q - 1) * 3 + 1
    const p1 = [qs, qs+1, qs+2].filter(m => m <= month).map(m => ({ year, month: m }))
    let pq = q - 1, py = year
    if (pq === 0) { pq = 4; py = year - 1 }
    const pqs = (pq - 1) * 3 + 1
    const p2  = [pqs, pqs+1, pqs+2].map(m => ({ year: py, month: m }))
    return { p1, p2, p1Label: `Q${q} ${year}`, p2Label: `Q${pq} ${py}`, deltaLabel: 'QoQ Δ%' }
  }

  if (mode === 'yoy') {
    return {
      p1: [{ year, month }],
      p2: [{ year: year - 1, month }],
      p1Label:    `${MN[month-1]} ${year}`,
      p2Label:    `${MN[month-1]} ${year-1}`,
      deltaLabel: 'YoY Δ%',
    }
  }

  // Default: MoM
  const p2m = month > 1 ? { year, month: month-1 } : { year: year-1, month: 12 }
  return {
    p1: [{ year, month }],
    p2: [p2m],
    p1Label:    `${MN[month-1]} ${year}`,
    p2Label:    `${MN[p2m.month-1]} ${p2m.year}`,
    deltaLabel: 'MoM Δ%',
  }
}
