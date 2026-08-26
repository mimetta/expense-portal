'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  PLData, PLSectionData, PLGroupData, PLLineItemRow, PLCalcRowData, Amounts, MonthColumn,
} from '@/lib/budget/types'
import { ZERO, addAmounts } from '@/lib/budget/types'

// ── Collapse state ────────────────────────────────────────────────────────────

type CollapseState = {
  sections:   Record<string, boolean>
  depts:      Record<string, boolean>
  categories: Record<string, boolean>
}

// ── Formatting ────────────────────────────────────────────────────────────────

function thb(n: number) {
  if (n === 0) return '—'
  return `฿${Math.round(Math.abs(n)).toLocaleString('en-US')}`
}

function pctStr(v: number, base: number) {
  if (base === 0) return '—'
  return `${(v / base * 100).toFixed(1)}%`
}

function deltaInfo(p1: number, p2: number): { text: string; pos: boolean | null } {
  if (p1 === 0 && p2 === 0) return { text: '—', pos: null }
  if (p2 === 0) return { text: 'n/a', pos: null }
  const d = (p1 - p2) / Math.abs(p2) * 100
  return { text: `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`, pos: Math.abs(d) < 0.05 ? null : d > 0 }
}

const OPEX_ID = 'operating_expenses'
const REV_IDS = new Set(['revenue_channel', 'revenue_product'])
const num      = 'text-right tabular-nums whitespace-nowrap'

// ── P2 lookup map (comparison mode) ──────────────────────────────────────────

type P2Map = {
  items:         Record<string, Amounts>
  sectionTotals: Record<string, Amounts>
  calcRows:      Record<string, Amounts>
  grossBudget:   number
  grossActual:   number
}

function buildP2Map(data: PLData): P2Map {
  const m: P2Map = { items: {}, sectionTotals: {}, calcRows: {}, grossBudget: 0, grossActual: 0 }
  for (const s of data.sections) {
    m.sectionTotals[s.id] = s.total
    if (s.id === 'revenue_channel') { m.grossBudget = s.total.budget; m.grossActual = s.total.actual }
    for (const g of s.groups)
      for (const li of g.lineItems)
        m.items[li.lineItemId] = { budget: li.budget, actual: li.actual, variance: li.variance }
  }
  for (const r of data.calculatedRows)
    m.calcRows[r.id] = { budget: r.budget, actual: r.actual, variance: r.variance }
  return m
}

// ── Month lookup map (multi-month mode) ───────────────────────────────────────

type MonthLookup = {
  lineItems:   Map<string, Amounts>
  groups:      Map<string, Amounts>
  sections:    Map<string, Amounts>
  calcRows:    Map<string, Amounts>
  grossBudget: number
  grossActual: number
}

function buildMonthLookup(data: PLData): MonthLookup {
  const lineItems = new Map<string, Amounts>()
  const groups    = new Map<string, Amounts>()
  const sections  = new Map<string, Amounts>()
  const calcRows  = new Map<string, Amounts>()
  let grossBudget = 0, grossActual = 0
  for (const s of data.sections) {
    sections.set(s.id, { budget: s.total.budget, actual: s.total.actual, variance: s.total.variance })
    if (s.id === 'revenue_channel') { grossBudget = s.total.budget; grossActual = s.total.actual }
    for (const g of s.groups) {
      groups.set(g.departmentId, { budget: g.subtotal.budget, actual: g.subtotal.actual, variance: g.subtotal.variance })
      for (const li of g.lineItems)
        lineItems.set(li.lineItemId, { budget: li.budget, actual: li.actual, variance: li.variance })
    }
  }
  for (const r of data.calculatedRows)
    calcRows.set(r.id, { budget: r.budget, actual: r.actual, variance: r.variance })
  return { lineItems, groups, sections, calcRows, grossBudget, grossActual }
}

// ── Cell primitives ───────────────────────────────────────────────────────────

function AmtCell({ n, py = 'py-1.5' }: { n: number; py?: string }) {
  return (
    <td className={`${num} px-3 ${py} text-xs`}>
      <span className={n === 0 ? 'text-gray-300' : ''}>{thb(n)}</span>
    </td>
  )
}

function PctCell({ v, base, py = 'py-1.5', onClick }: {
  v: number; base: number; py?: string; onClick?: () => void
}) {
  return (
    <td
      className={`${num} px-2 ${py} text-[10px] ${
        onClick
          ? 'cursor-pointer text-gray-400 hover:text-indigo-600 hover:bg-indigo-50/50'
          : 'text-gray-400'
      }`}
      onClick={onClick}
      title={onClick ? 'View history' : undefined}
    >
      {pctStr(v, base)}
    </td>
  )
}

function DeltaCell({ p1, p2, revCtx, py = 'py-1.5' }: {
  p1: number; p2: number; revCtx: boolean; py?: string
}) {
  const { text, pos } = deltaInfo(p1, p2)
  const cls = pos === null ? 'text-gray-400'
    : (revCtx ? pos : !pos) ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'
  return <td className={`${num} px-3 ${py} text-[10px] ${cls}`}>{text}</td>
}

function PCols({ a, gb, ga, py = 'py-1.5' }: { a: Amounts; gb: number; ga: number; py?: string }) {
  return (
    <>
      <AmtCell n={a.budget} py={py} />
      <PctCell v={a.budget} base={gb} py={py} />
      <AmtCell n={a.actual} py={py} />
      <PctCell v={a.actual} base={ga} py={py} />
    </>
  )
}

type OwnerOptions = { people: string[]; depts: string[] }

function OwnerCell({ value, type, id, isEditable, showDash, py = 'py-1.5', suggestions = { people: [], depts: [] } }: {
  value?: string | null
  type?: 'department' | 'category' | 'line_item'
  id?: string
  isEditable?: boolean
  showDash?: boolean
  py?: string
  suggestions?: OwnerOptions
}) {
  const canEdit = isEditable && !!type && !!id
  const [editing, setEditing] = useState(false)
  const [display, setDisplay] = useState(value ?? null)
  const [flash,   setFlash]   = useState<'success' | 'error' | null>(null)

  useEffect(() => { setDisplay(value ?? null) }, [value])

  async function commit(raw: string) {
    setEditing(false)
    const newVal = raw.trim() || null
    if (newVal === display) return
    try {
      const res = await fetch('/api/budget/owner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, owner_name: newVal }),
      })
      if (!res.ok) throw new Error('save failed')
      setDisplay(newVal)
      setFlash('success')
    } catch {
      setFlash('error')
    }
    setTimeout(() => setFlash(null), 600)
  }

  if (editing) {
    const hasPeople = suggestions.people.length > 0
    return (
      <td className={`px-2 ${py}`} onClick={e => e.stopPropagation()}>
        <select
          autoFocus
          defaultValue={display ?? ''}
          style={{ width: 148, fontSize: 11 }}
          className="border border-indigo-400 rounded px-1 py-0.5 focus:outline-none bg-white"
          onChange={e => commit(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
        >
          <option value="">— clear —</option>
          {hasPeople ? (
            <>
              <optgroup label="People">
                {suggestions.people.map(p => <option key={p} value={p}>{p}</option>)}
              </optgroup>
              <optgroup label="Departments">
                {suggestions.depts.map(d => <option key={d} value={d}>{d}</option>)}
              </optgroup>
            </>
          ) : (
            <>
              <optgroup label="Departments">
                {suggestions.depts.map(d => <option key={d} value={d}>{d}</option>)}
              </optgroup>
              <optgroup label="">
                <option disabled value="">Add users in User Management to assign people as owners</option>
              </optgroup>
            </>
          )}
        </select>
      </td>
    )
  }

  return (
    <td
      className={`px-2 ${py} text-[11px] text-gray-400 whitespace-nowrap max-w-[110px] truncate relative transition-colors ${
        flash === 'success' ? 'bg-emerald-100' : flash === 'error' ? 'bg-red-100' : ''
      } ${canEdit ? 'cursor-pointer group' : ''}`}
      onClick={canEdit ? (e: React.MouseEvent) => { e.stopPropagation(); setEditing(true) } : undefined}
    >
      {display ?? (showDash ? '—' : '')}
      {canEdit && (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-0 group-hover:opacity-40 pointer-events-none">✏</span>
      )}
    </td>
  )
}

// ── Inline-editable cell (optimistic) ────────────────────────────────────────
// Updates displayVal immediately on blur/Enter, saves in background.
// On server error: reverts displayVal and shows red flash.

function InlineEditCell({
  value, py = 'py-1.5', onSave, onOptimisticChange, onRevert,
}: {
  value: number
  py?: string
  onSave: (v: number) => Promise<void>
  onOptimisticChange?: (v: number) => void
  onRevert?: () => void
}) {
  const [editing,    setEditing]    = useState(false)
  const [displayVal, setDisplayVal] = useState(value)
  const [flash,      setFlash]      = useState<'success' | 'error' | null>(null)

  useEffect(() => { setDisplayVal(value) }, [value])

  async function commit(raw: string) {
    const v = parseFloat(raw)
    setEditing(false)
    if (isNaN(v) || v === displayVal) return
    const prevVal = displayVal
    // Optimistic: update UI immediately, then save in background
    setDisplayVal(v)
    onOptimisticChange?.(v)
    try {
      await onSave(v)
      setFlash('success')
    } catch {
      // Revert on failure
      setDisplayVal(prevVal)
      onRevert?.()
      setFlash('error')
    }
    setTimeout(() => setFlash(null), 600)
  }

  if (editing) {
    return (
      <td className={`px-1 ${py}`} onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          type="number"
          defaultValue={displayVal}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-24 text-right text-xs tabular-nums border border-indigo-400 rounded px-1 py-0.5 focus:outline-none bg-white"
        />
      </td>
    )
  }

  return (
    <td
      className={`${num} px-3 ${py} text-xs cursor-pointer group relative transition-colors ${
        flash === 'success' ? 'bg-emerald-100' : flash === 'error' ? 'bg-red-100' : ''
      }`}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
    >
      <span className={displayVal === 0 ? 'text-gray-300' : ''}>{thb(displayVal)}</span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-gray-400 opacity-0 group-hover:opacity-40 pointer-events-none">✏</span>
    </td>
  )
}

// ── Export types ──────────────────────────────────────────────────────────────

export interface BudgetEditParams {
  lineItemId:   string
  departmentId: string
  year:         number
  month:        number
  amount:       number
}

export interface ActualEditParams {
  lineItemId: string
  monthDate:  string
  amount:     number
}

export interface PLTableProps {
  months?:             MonthColumn[]
  period1?:            { label: string; data: PLData }
  period2?:            { label: string; data: PLData }
  deltaLabel?:         string
  deltaSubtitle?:      string
  role?:               string
  onRowClick?:         (lineItemId: string, lineItemName: string) => void
  showCalculatedRows?: boolean
  defaultExpanded?:    'all' | string[]
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PLTable({
  months, period1, period2, deltaLabel = 'Δ%', deltaSubtitle,
  role, onRowClick,
  showCalculatedRows = true,
  defaultExpanded,
}: PLTableProps) {

  const isMultiMonth = !!(months && months.length > 0)
  const refData      = isMultiMonth
    ? months![months!.length - 1].data
    : (period1?.data ?? null)

  const [collapse, setCollapse] = useState<CollapseState>(() => {
    const refSections = refData?.sections ?? []
    if (defaultExpanded === 'all') {
      const sections: Record<string, boolean> = {}
      const depts:    Record<string, boolean> = {}
      for (const s of refSections) {
        sections[s.id] = true
        for (const g of s.groups) { if (g.departmentId) depts[g.departmentId] = true }
      }
      return { sections, depts, categories: {} }
    }
    if (Array.isArray(defaultExpanded)) {
      const sections: Record<string, boolean> = {}
      for (const id of defaultExpanded) sections[id] = true
      return { sections, depts: {}, categories: {} }
    }
    return { sections: {}, depts: {}, categories: {} }
  })

  const p2         = useMemo(() => !isMultiMonth && period2 ? buildP2Map(period2.data) : null, [isMultiMonth, period2])
  const hasPeriod2 = p2 !== null
  const canEdit    = role === 'SUPERADMIN' || role === 'CEO' || role === 'ACCOUNTING'
  const isAdmin    = role === 'SUPERADMIN' || role === 'ACCOUNTING'

  const [ownerOptions,  setOwnerOptions]  = useState<OwnerOptions>({ people: [], depts: [] })
  const [fgProduction,  setFgProduction]  = useState<Record<string, number>>({})
  const [saveError,     setSaveError]     = useState<string | null>(null)

  function handleSaveError(msg: string) {
    setSaveError(msg)
    setTimeout(() => setSaveError(null), 5000)
  }

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/budget/owner/options')
      .then(r => r.ok ? r.json() : { people: [], depts: [] })
      .then((d: OwnerOptions) => setOwnerOptions(d))
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    fetch('/api/admin/settings/fg-production')
      .then(r => r.ok ? r.json() : [])
      .then((rows: { month: string; total_volume_ml: number }[]) => {
        const map: Record<string, number> = {}
        for (const row of rows) map[String(row.month).slice(0, 10)] = row.total_volume_ml
        setFgProduction(map)
      })
      .catch(() => {})
  }, [])

  async function saveFgProduction(monthKey: string, volume: number) {
    await fetch('/api/admin/settings/fg-production', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: monthKey, total_volume_ml: volume }),
    })
    setFgProduction(prev => ({ ...prev, [monthKey]: volume }))
  }

  const [p1gb, p1ga] = useMemo(() => {
    if (isMultiMonth) return [0, 0]
    const rev = period1?.data.sections.find(s => s.id === 'revenue_channel')
    return [rev?.total.budget ?? 0, rev?.total.actual ?? 0]
  }, [isMultiMonth, period1])

  const p1Year  = period1?.data.year  ?? 0
  const p1Month = period1?.data.month ?? 0

  const monthLookups = useMemo<MonthLookup[] | null>(() => {
    if (!isMultiMonth || !months) return null
    return months.map(mc => buildMonthLookup(mc.data))
  }, [isMultiMonth, months])

  const mmN        = months?.length ?? 0
  const mmLast     = Math.max(0, mmN - 1)
  const mmPrev     = Math.max(0, mmN - 2)
  const momSubtitle = mmN >= 2 ? `${months![mmN-1].label} vs ${months![mmN-2].label}` : undefined

  const cogsDeptId = useMemo(() => {
    return refData?.sections
      .find(s => s.id === 'cost_of_goods')
      ?.groups.find(g => g.deptCode === 'COGS')
      ?.departmentId ?? ''
  }, [refData])

  // ── Optimistic overrides ────────────────────────────────────────────────────
  // Key: `${lineItemId}:${year}:${month}:${field}` → value
  // Updated immediately on cell commit; cleared on revert.

  const [overrides, setOverrides] = useState<Map<string, number>>(new Map)

  function mkKey(liId: string, y: number, m: number, f: 'budget' | 'actual') {
    return `${liId}:${y}:${m}:${f}`
  }

  function eff(liId: string, y: number, m: number, f: 'budget' | 'actual', fallback: number): number {
    return overrides.get(mkKey(liId, y, m, f)) ?? fallback
  }

  function setOv(liId: string, y: number, m: number, f: 'budget' | 'actual', v: number) {
    setOverrides(prev => { const n = new Map(prev); n.set(mkKey(liId, y, m, f), v); return n })
  }

  function delOv(liId: string, y: number, m: number, f: 'budget' | 'actual') {
    setOverrides(prev => { const n = new Map(prev); n.delete(mkKey(liId, y, m, f)); return n })
  }

  // Effective Amounts for a line item in comparison mode (period1 year/month)
  function effLICmp(li: PLLineItemRow): Amounts {
    const b = eff(li.lineItemId, p1Year, p1Month, 'budget', li.budget)
    const a = eff(li.lineItemId, p1Year, p1Month, 'actual',  li.actual)
    return { budget: b, actual: a, variance: b - a }
  }

  // Effective Amounts for a line item in multi-month column ci
  function effLIMM(liId: string, ci: number): Amounts {
    const mc   = months![ci]
    const base = monthLookups![ci].lineItems.get(liId) ?? ZERO
    const b    = eff(liId, mc.year, mc.month, 'budget', base.budget)
    const a    = eff(liId, mc.year, mc.month, 'actual',  base.actual)
    return { budget: b, actual: a, variance: b - a }
  }

  // Group total (comparison mode) — recomputed from line items with overrides
  function effGroupCmp(group: PLGroupData): Amounts {
    return group.lineItems.reduce((acc, li) => addAmounts(acc, effLICmp(li)), ZERO)
  }

  // Group total (multi-month mode column ci)
  function effGroupMM(group: PLGroupData, ci: number): Amounts {
    return group.lineItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, ci)), ZERO)
  }

  // Section total (comparison mode)
  function effSectionCmp(section: PLSectionData): Amounts {
    return section.groups.reduce((acc, g) => addAmounts(acc, effGroupCmp(g)), ZERO)
  }

  // Section total (multi-month mode column ci)
  function effSectionMM(section: PLSectionData, ci: number): Amounts {
    return section.groups.reduce((acc, g) => addAmounts(acc, effGroupMM(g, ci)), ZERO)
  }

  // ── Factory functions ───────────────────────────────────────────────────────

  function makeSave(li: PLLineItemRow, field: 'budget' | 'actual', colYear: number, colMonth: number) {
    return async (v: number) => {
      const r = await fetch('/api/budget/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_item_id: li.lineItemId, year: colYear, month: colMonth, field, value: v }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        const msg = (d.error as string | undefined) ?? `Save failed (HTTP ${r.status})`
        handleSaveError(msg)
        throw new Error(msg)
      }
    }
  }

  function makeOptimistic(liId: string, field: 'budget' | 'actual', y: number, m: number) {
    return (v: number) => setOv(liId, y, m, field, v)
  }

  function makeRevert(liId: string, field: 'budget' | 'actual', y: number, m: number) {
    return () => delOv(liId, y, m, field)
  }

  function toggleSection(id: string) {
    setCollapse(prev => ({ ...prev, sections: { ...prev.sections, [id]: !(prev.sections[id] ?? false) } }))
  }
  function toggleDept(id: string) {
    setCollapse(prev => ({ ...prev, depts: { ...prev.depts, [id]: !(prev.depts[id] ?? false) } }))
  }
  function toggleCategory(key: string) {
    setCollapse(prev => ({ ...prev, categories: { ...prev.categories, [key]: !(prev.categories[key] ?? false) } }))
  }

  // ── Comparison-mode renderers ──────────────────────────────────────────────

  function renderLineItemCmp(
    li: PLLineItemRow, group: PLGroupData, section: PLSectionData, deepIndent: boolean,
    dupeNames?: Set<string>,
  ) {
    const lia      = effLICmp(li)
    const p2a      = p2?.items[li.lineItemId] ?? ZERO
    const revCtx   = REV_IDS.has(section.id)
    const histClick = onRowClick ? () => onRowClick!(li.lineItemId, li.name) : undefined
    const subtitle = dupeNames?.has(li.name) ? li.categoryName : li.subcategoryL1
    return (
      <tr
        key={li.lineItemId}
        className="border-b border-gray-100 hover:bg-gray-50/30"
        style={deepIndent ? { borderLeft: '2px solid #d1d5db' } : undefined}
      >
        <td className={`${deepIndent ? 'pl-[48px]' : 'pl-10'} pr-3 py-1.5 text-gray-700`}>
          <div className="text-[13px]">{li.name}</div>
          {subtitle && <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>}
        </td>
        <OwnerCell value={li.ownerName || li.categoryOwnerName} showDash
          type="line_item" id={li.lineItemId}
          isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
        {canEdit ? (
          <>
            <InlineEditCell value={li.budget}
              onSave={makeSave(li, 'budget', p1Year, p1Month)}
              onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', p1Year, p1Month)}
              onRevert={makeRevert(li.lineItemId, 'budget', p1Year, p1Month)} />
            <PctCell v={lia.budget} base={p1gb} onClick={histClick} />
            <InlineEditCell value={li.actual}
              onSave={makeSave(li, 'actual', p1Year, p1Month)}
              onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', p1Year, p1Month)}
              onRevert={makeRevert(li.lineItemId, 'actual', p1Year, p1Month)} />
            <PctCell v={lia.actual} base={p1ga} onClick={histClick} />
          </>
        ) : (
          <>
            <AmtCell n={li.budget} />
            <PctCell v={li.budget} base={p1gb} onClick={histClick} />
            <AmtCell n={li.actual} />
            <PctCell v={li.actual} base={p1ga} onClick={histClick} />
          </>
        )}
        {hasPeriod2 && (
          <>
            <PCols a={p2a} gb={p2!.grossBudget} ga={p2!.grossActual} />
            <DeltaCell p1={lia.actual} p2={p2a.actual} revCtx={revCtx} />
          </>
        )}
      </tr>
    )
  }

  function renderSectionTotalCmp(section: PLSectionData) {
    const eff    = effSectionCmp(section)
    const p2a    = p2?.sectionTotals[section.id] ?? ZERO
    const revCtx = REV_IDS.has(section.id)
    return (
      <tr className="border-b-2 border-gray-300 bg-gray-200">
        <td className="px-3 py-2 text-xs font-bold text-gray-800 uppercase tracking-wide">
          {section.totalLabel}
          {section.note && <span className="ml-2 font-normal text-gray-400 normal-case">({section.note})</span>}
        </td>
        <OwnerCell py="py-2" />
        <PCols a={eff} gb={p1gb} ga={p1ga} py="py-2" />
        {hasPeriod2 && (
          <>
            <PCols a={p2a} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
            <DeltaCell p1={eff.actual} p2={p2a.actual} revCtx={revCtx} py="py-2" />
          </>
        )}
      </tr>
    )
  }

  function renderCalcRowCmp(cr: PLCalcRowData) {
    const p2a = p2?.calcRows[cr.id] ?? ZERO
    return (
      <tr key={cr.id} className="border-b-2 border-blue-200 bg-blue-50">
        <td className="px-3 py-2.5 text-sm font-bold text-blue-900 uppercase tracking-wide">{cr.label}</td>
        <OwnerCell py="py-2.5" />
        <PCols a={cr} gb={p1gb} ga={p1ga} py="py-2.5" />
        {hasPeriod2 && (
          <>
            <PCols a={p2a} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2.5" />
            <DeltaCell p1={cr.actual} p2={p2a.actual} revCtx={true} py="py-2.5" />
          </>
        )}
      </tr>
    )
  }

  function renderStdGroupCmp(group: PLGroupData, section: PLSectionData) {
    const isExpanded = collapse.depts[group.departmentId] ?? false
    const gsub   = effGroupCmp(group)
    const p2gsub = p2
      ? group.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
      : ZERO
    const revCtx = REV_IDS.has(section.id)
    const nameCounts = new Map<string, number>()
    for (const li of group.lineItems) nameCounts.set(li.name, (nameCounts.get(li.name) ?? 0) + 1)
    const dupeNames = new Set(Array.from(nameCounts.entries()).filter(([, n]) => n > 1).map(([name]) => name))
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell value={group.ownerName} py="py-2"
            type="department" id={group.departmentId}
            isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
          <PCols a={gsub} gb={p1gb} ga={p1ga} py="py-2" />
          {hasPeriod2 && (
            <>
              <PCols a={p2gsub} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
              <DeltaCell p1={gsub.actual} p2={p2gsub.actual} revCtx={revCtx} py="py-2" />
            </>
          )}
        </tr>
        {isExpanded && group.lineItems.map(li => renderLineItemCmp(li, group, section, false, dupeNames))}
      </Fragment>
    )
  }

  function renderOpexGroupCmp(group: PLGroupData, section: PLSectionData) {
    const isDeptExpanded = collapse.depts[group.departmentId] ?? false
    const gsub   = effGroupCmp(group)
    const p2gsub = p2
      ? group.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
      : ZERO
    const catMap = new Map<string, PLLineItemRow[]>()
    for (const li of group.lineItems) {
      if (!catMap.has(li.categoryName)) catMap.set(li.categoryName, [])
      catMap.get(li.categoryName)!.push(li)
    }
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isDeptExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell value={group.ownerName} py="py-2"
            type="department" id={group.departmentId}
            isEditable={isAdmin} suggestions={ownerOptions} />
          <PCols a={gsub} gb={p1gb} ga={p1ga} py="py-2" />
          {hasPeriod2 && (
            <>
              <PCols a={p2gsub} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
              <DeltaCell p1={gsub.actual} p2={p2gsub.actual} revCtx={false} py="py-2" />
            </>
          )}
        </tr>
        {isDeptExpanded && Array.from(catMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([catName, catItems]) => {
          const catKey        = `${group.departmentId}|${catName}`
          const isCatExpanded = collapse.categories[catKey] ?? false
          const catOwner      = catItems[0]?.categoryOwnerName ?? null
          // Use effective values for category total
          const catTotal   = catItems.reduce((acc: Amounts, li) => addAmounts(acc, effLICmp(li)), ZERO)
          const catP2Total = p2
            ? catItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
            : ZERO
          return (
            <Fragment key={catKey}>
              <tr className="bg-white cursor-pointer hover:bg-gray-50 transition-colors select-none"
                  style={{ borderLeft: '2px solid #d1d5db' }}
                  onClick={() => toggleCategory(catKey)}>
                <td className="pl-[34px] pr-3 py-1.5 text-xs font-medium text-gray-500">
                  <span className="mr-2 text-gray-400 text-[10px]">{isCatExpanded ? '▼' : '▶'}</span>
                  {catName}
                </td>
                <OwnerCell value={catOwner}
                  type="category" id={catItems[0]?.categoryId}
                  isEditable={isAdmin} suggestions={ownerOptions} />
                <PCols a={catTotal} gb={p1gb} ga={p1ga} />
                {hasPeriod2 && (
                  <>
                    <PCols a={catP2Total} gb={p2!.grossBudget} ga={p2!.grossActual} />
                    <DeltaCell p1={catTotal.actual} p2={catP2Total.actual} revCtx={false} />
                  </>
                )}
              </tr>
              {isCatExpanded && catItems.map(li => renderLineItemCmp(li, group, section, true))}
            </Fragment>
          )
        })}
      </Fragment>
    )
  }

  // ── CAPEX nested-group renderer (comparison mode) ─────────────────────────

  function renderCapexNestedGroupCmp(group: PLGroupData, section: PLSectionData) {
    const isDeptExpanded = collapse.depts[group.departmentId] ?? false
    const gsub   = effGroupCmp(group)
    const p2gsub = p2
      ? group.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
      : ZERO
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isDeptExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell py="py-2" />
          <PCols a={gsub} gb={p1gb} ga={p1ga} py="py-2" />
          {hasPeriod2 && (
            <>
              <PCols a={p2gsub} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
              <DeltaCell p1={gsub.actual} p2={p2gsub.actual} revCtx={false} py="py-2" />
            </>
          )}
        </tr>
        {isDeptExpanded && group.capexSubGroups!.map(sg => {
          const catKey        = `${group.departmentId}|${sg.name}`
          const isCatExpanded = collapse.categories[catKey] ?? false
          const catTotal      = sg.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, effLICmp(li)), ZERO)
          const catP2Total    = p2
            ? sg.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
            : ZERO
          return (
            <Fragment key={catKey}>
              <tr className="bg-white cursor-pointer hover:bg-gray-50 transition-colors select-none"
                  style={{ borderLeft: '2px solid #d1d5db' }}
                  onClick={() => toggleCategory(catKey)}>
                <td className="pl-[34px] pr-3 py-1.5 text-xs font-medium text-gray-500">
                  <span className="mr-2 text-gray-400 text-[10px]">{isCatExpanded ? '▼' : '▶'}</span>
                  {sg.name}
                </td>
                <OwnerCell value={sg.ownerName} type="category" id={sg.categoryId} isEditable={false} suggestions={ownerOptions} />
                <PCols a={catTotal} gb={p1gb} ga={p1ga} />
                {hasPeriod2 && (
                  <>
                    <PCols a={catP2Total} gb={p2!.grossBudget} ga={p2!.grossActual} />
                    <DeltaCell p1={catTotal.actual} p2={catP2Total.actual} revCtx={false} />
                  </>
                )}
              </tr>
              {isCatExpanded && sg.lineItems.map(li => renderLineItemCmp(li, group, section, true))}
            </Fragment>
          )
        })}
      </Fragment>
    )
  }

  // ── Multi-month renderers ─────────────────────────────────────────────────

  function renderLineItemMM(
    li: PLLineItemRow, group: PLGroupData, section: PLSectionData, deepIndent: boolean,
    dupeNames?: Set<string>,
  ) {
    const histClick = onRowClick ? () => onRowClick!(li.lineItemId, li.name) : undefined
    const revCtx    = REV_IDS.has(section.id)
    const lastA     = effLIMM(li.lineItemId, mmLast)
    const prevA     = effLIMM(li.lineItemId, mmPrev)
    const subtitle  = dupeNames?.has(li.name) ? li.categoryName : li.subcategoryL1
    return (
      <tr
        key={li.lineItemId}
        className="border-b border-gray-100 hover:bg-gray-50/30"
        style={deepIndent ? { borderLeft: '2px solid #d1d5db' } : undefined}
      >
        <td className={`${deepIndent ? 'pl-[48px]' : 'pl-10'} pr-3 py-1.5 text-gray-700`}>
          <div className="text-[13px]">{li.name}</div>
          {subtitle && <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>}
        </td>
        <OwnerCell value={li.ownerName || li.categoryOwnerName} showDash
          type="line_item" id={li.lineItemId}
          isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
        {months!.map((mc, ci) => {
          const a  = effLIMM(li.lineItemId, ci)
          const gb = monthLookups![ci].grossBudget
          const ga = monthLookups![ci].grossActual
          return (
            <Fragment key={`${mc.year}-${mc.month}`}>
              {canEdit ? (
                <InlineEditCell value={a.budget}
                  onSave={makeSave(li, 'budget', mc.year, mc.month)}
                  onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', mc.year, mc.month)}
                  onRevert={makeRevert(li.lineItemId, 'budget', mc.year, mc.month)} />
              ) : (
                <AmtCell n={a.budget} />
              )}
              <PctCell v={a.budget} base={gb} onClick={histClick} />
              {canEdit ? (
                <InlineEditCell value={a.actual}
                  onSave={makeSave(li, 'actual', mc.year, mc.month)}
                  onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', mc.year, mc.month)}
                  onRevert={makeRevert(li.lineItemId, 'actual', mc.year, mc.month)} />
              ) : (
                <AmtCell n={a.actual} />
              )}
              <PctCell v={a.actual} base={ga} onClick={histClick} />
            </Fragment>
          )
        })}
        {mmN >= 2 && <DeltaCell p1={lastA.actual} p2={prevA.actual} revCtx={revCtx} />}
      </tr>
    )
  }

  function renderSectionTotalMM(section: PLSectionData) {
    const revCtx = REV_IDS.has(section.id)
    const lastSt = effSectionMM(section, mmLast)
    const prevSt = effSectionMM(section, mmPrev)
    return (
      <tr className="border-b-2 border-gray-300 bg-gray-200">
        <td className="px-3 py-2 text-xs font-bold text-gray-800 uppercase tracking-wide">
          {section.totalLabel}
          {section.note && <span className="ml-2 font-normal text-gray-400 normal-case">({section.note})</span>}
        </td>
        <OwnerCell py="py-2" />
        {months!.map((mc, ci) => {
          const st = effSectionMM(section, ci)
          const gb = monthLookups![ci].grossBudget
          const ga = monthLookups![ci].grossActual
          return (
            <Fragment key={`${mc.year}-${mc.month}`}>
              <AmtCell n={st.budget} py="py-2" />
              <PctCell v={st.budget} base={gb} py="py-2" />
              <AmtCell n={st.actual} py="py-2" />
              <PctCell v={st.actual} base={ga} py="py-2" />
            </Fragment>
          )
        })}
        {mmN >= 2 && <DeltaCell p1={lastSt.actual} p2={prevSt.actual} revCtx={revCtx} py="py-2" />}
      </tr>
    )
  }

  function renderCalcRowMM(cr: PLCalcRowData) {
    const lastA = monthLookups![mmLast].calcRows.get(cr.id) ?? ZERO
    const prevA = monthLookups![mmPrev].calcRows.get(cr.id) ?? ZERO
    return (
      <tr key={cr.id} className="border-b-2 border-blue-200 bg-blue-50">
        <td className="px-3 py-2.5 text-sm font-bold text-blue-900 uppercase tracking-wide">{cr.label}</td>
        <OwnerCell py="py-2.5" />
        {months!.map((mc, ci) => {
          const a  = monthLookups![ci].calcRows.get(cr.id) ?? ZERO
          const gb = monthLookups![ci].grossBudget
          const ga = monthLookups![ci].grossActual
          return (
            <Fragment key={`${mc.year}-${mc.month}`}>
              <AmtCell n={a.budget} py="py-2.5" />
              <PctCell v={a.budget} base={gb} py="py-2.5" />
              <AmtCell n={a.actual} py="py-2.5" />
              <PctCell v={a.actual} base={ga} py="py-2.5" />
            </Fragment>
          )
        })}
        {mmN >= 2 && <DeltaCell p1={lastA.actual} p2={prevA.actual} revCtx={true} py="py-2.5" />}
      </tr>
    )
  }

  function renderStdGroupMM(group: PLGroupData, section: PLSectionData) {
    const isExpanded = collapse.depts[group.departmentId] ?? false
    const revCtx     = REV_IDS.has(section.id)
    const lastG      = effGroupMM(group, mmLast)
    const prevG      = effGroupMM(group, mmPrev)
    const nameCounts = new Map<string, number>()
    for (const li of group.lineItems) nameCounts.set(li.name, (nameCounts.get(li.name) ?? 0) + 1)
    const dupeNames = new Set(Array.from(nameCounts.entries()).filter(([, n]) => n > 1).map(([name]) => name))
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell value={group.ownerName} py="py-2"
            type="department" id={group.departmentId}
            isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
          {months!.map((mc, ci) => {
            const g  = effGroupMM(group, ci)
            const gb = monthLookups![ci].grossBudget
            const ga = monthLookups![ci].grossActual
            return (
              <Fragment key={`${mc.year}-${mc.month}`}>
                <AmtCell n={g.budget} py="py-2" />
                <PctCell v={g.budget} base={gb} py="py-2" />
                <AmtCell n={g.actual} py="py-2" />
                <PctCell v={g.actual} base={ga} py="py-2" />
              </Fragment>
            )
          })}
          {mmN >= 2 && <DeltaCell p1={lastG.actual} p2={prevG.actual} revCtx={revCtx} py="py-2" />}
        </tr>
        {isExpanded && group.lineItems.map(li => renderLineItemMM(li, group, section, false, dupeNames))}
      </Fragment>
    )
  }

  function renderOpexGroupMM(group: PLGroupData, section: PLSectionData) {
    const isDeptExpanded = collapse.depts[group.departmentId] ?? false
    const lastG          = effGroupMM(group, mmLast)
    const prevG          = effGroupMM(group, mmPrev)
    const catMap         = new Map<string, PLLineItemRow[]>()
    for (const li of group.lineItems) {
      if (!catMap.has(li.categoryName)) catMap.set(li.categoryName, [])
      catMap.get(li.categoryName)!.push(li)
    }
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isDeptExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell value={group.ownerName} py="py-2"
            type="department" id={group.departmentId}
            isEditable={isAdmin} suggestions={ownerOptions} />
          {months!.map((mc, ci) => {
            const g  = effGroupMM(group, ci)
            const gb = monthLookups![ci].grossBudget
            const ga = monthLookups![ci].grossActual
            return (
              <Fragment key={`${mc.year}-${mc.month}`}>
                <AmtCell n={g.budget} py="py-2" />
                <PctCell v={g.budget} base={gb} py="py-2" />
                <AmtCell n={g.actual} py="py-2" />
                <PctCell v={g.actual} base={ga} py="py-2" />
              </Fragment>
            )
          })}
          {mmN >= 2 && <DeltaCell p1={lastG.actual} p2={prevG.actual} revCtx={false} py="py-2" />}
        </tr>
        {isDeptExpanded && Array.from(catMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([catName, catItems]) => {
          const catKey        = `${group.departmentId}|${catName}`
          const isCatExpanded = collapse.categories[catKey] ?? false
          const catOwner      = catItems[0]?.categoryOwnerName ?? null
          return (
            <Fragment key={catKey}>
              <tr className="bg-white cursor-pointer hover:bg-gray-50 transition-colors select-none"
                  style={{ borderLeft: '2px solid #d1d5db' }}
                  onClick={() => toggleCategory(catKey)}>
                <td className="pl-[34px] pr-3 py-1.5 text-xs font-medium text-gray-500">
                  <span className="mr-2 text-gray-400 text-[10px]">{isCatExpanded ? '▼' : '▶'}</span>
                  {catName}
                </td>
                <OwnerCell value={catOwner}
                  type="category" id={catItems[0]?.categoryId}
                  isEditable={isAdmin} suggestions={ownerOptions} />
                {months!.map((mc, ci) => {
                  const catTotal = catItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, ci)), ZERO)
                  const gb = monthLookups![ci].grossBudget
                  const ga = monthLookups![ci].grossActual
                  return (
                    <Fragment key={`${mc.year}-${mc.month}`}>
                      <AmtCell n={catTotal.budget} />
                      <PctCell v={catTotal.budget} base={gb} />
                      <AmtCell n={catTotal.actual} />
                      <PctCell v={catTotal.actual} base={ga} />
                    </Fragment>
                  )
                })}
                {mmN >= 2 && (() => {
                  const last = catItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, mmLast)), ZERO)
                  const prev = catItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, mmPrev)), ZERO)
                  return <DeltaCell p1={last.actual} p2={prev.actual} revCtx={false} />
                })()}
              </tr>
              {isCatExpanded && catItems.map(li => renderLineItemMM(li, group, section, true))}
            </Fragment>
          )
        })}
      </Fragment>
    )
  }

  // ── CAPEX nested-group renderer (multi-month mode) ───────────────────────

  function renderCapexNestedGroupMM(group: PLGroupData, section: PLSectionData) {
    const isDeptExpanded = collapse.depts[group.departmentId] ?? false
    const lastG          = effGroupMM(group, mmLast)
    const prevG          = effGroupMM(group, mmPrev)
    return (
      <Fragment key={group.departmentId}>
        <tr className="bg-gray-100 cursor-pointer hover:bg-gray-200 transition-colors select-none"
            onClick={() => toggleDept(group.departmentId)}>
          <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
            <span className="mr-2 text-gray-400 text-[10px]">{isDeptExpanded ? '▼' : '▶'}</span>
            {group.deptFullName}
          </td>
          <OwnerCell py="py-2" />
          {months!.map((mc, ci) => {
            const g  = effGroupMM(group, ci)
            const gb = monthLookups![ci].grossBudget
            const ga = monthLookups![ci].grossActual
            return (
              <Fragment key={`${mc.year}-${mc.month}`}>
                <AmtCell n={g.budget} py="py-2" />
                <PctCell v={g.budget} base={gb} py="py-2" />
                <AmtCell n={g.actual} py="py-2" />
                <PctCell v={g.actual} base={ga} py="py-2" />
              </Fragment>
            )
          })}
          {mmN >= 2 && <DeltaCell p1={lastG.actual} p2={prevG.actual} revCtx={false} py="py-2" />}
        </tr>
        {isDeptExpanded && group.capexSubGroups!.map(sg => {
          const catKey        = `${group.departmentId}|${sg.name}`
          const isCatExpanded = collapse.categories[catKey] ?? false
          return (
            <Fragment key={catKey}>
              <tr className="bg-white cursor-pointer hover:bg-gray-50 transition-colors select-none"
                  style={{ borderLeft: '2px solid #d1d5db' }}
                  onClick={() => toggleCategory(catKey)}>
                <td className="pl-[34px] pr-3 py-1.5 text-xs font-medium text-gray-500">
                  <span className="mr-2 text-gray-400 text-[10px]">{isCatExpanded ? '▼' : '▶'}</span>
                  {sg.name}
                </td>
                <OwnerCell value={sg.ownerName} type="category" id={sg.categoryId} isEditable={false} suggestions={ownerOptions} />
                {months!.map((mc, ci) => {
                  const catAmts = sg.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, effLIMM(li.lineItemId, ci)), ZERO)
                  const gb = monthLookups![ci].grossBudget
                  const ga = monthLookups![ci].grossActual
                  return (
                    <Fragment key={`${mc.year}-${mc.month}`}>
                      <AmtCell n={catAmts.budget} />
                      <PctCell v={catAmts.budget} base={gb} />
                      <AmtCell n={catAmts.actual} />
                      <PctCell v={catAmts.actual} base={ga} />
                    </Fragment>
                  )
                })}
                {mmN >= 2 && (() => {
                  const lastC = sg.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, effLIMM(li.lineItemId, mmLast)), ZERO)
                  const prevC = sg.lineItems.reduce((acc: Amounts, li) => addAmounts(acc, effLIMM(li.lineItemId, mmPrev)), ZERO)
                  return <DeltaCell p1={lastC.actual} p2={prevC.actual} revCtx={false} />
                })()}
              </tr>
              {isCatExpanded && sg.lineItems.map(li => renderLineItemMM(li, group, section, true))}
            </Fragment>
          )
        })}
      </Fragment>
    )
  }

  // ── COGS flat row (single item, no expand arrow) ──────────────────────────

  function renderCogsFlatRowCmp(group: PLGroupData, section: PLSectionData) {
    const li = group.lineItems[0]
    if (!li) return null
    const lia = effLICmp(li)
    const p2a = p2?.items[li.lineItemId] ?? ZERO
    return (
      <tr key={group.departmentId} className="bg-gray-100 border-b border-gray-200">
        <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
          {group.deptFullName}
        </td>
        <OwnerCell value={group.ownerName} py="py-2"
          type="department" id={group.departmentId}
          isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
        {canEdit ? (
          <>
            <InlineEditCell value={li.budget} py="py-2"
              onSave={makeSave(li, 'budget', p1Year, p1Month)}
              onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', p1Year, p1Month)}
              onRevert={makeRevert(li.lineItemId, 'budget', p1Year, p1Month)} />
            <PctCell v={lia.budget} base={p1gb} py="py-2" />
            <InlineEditCell value={li.actual} py="py-2"
              onSave={makeSave(li, 'actual', p1Year, p1Month)}
              onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', p1Year, p1Month)}
              onRevert={makeRevert(li.lineItemId, 'actual', p1Year, p1Month)} />
            <PctCell v={lia.actual} base={p1ga} py="py-2" />
          </>
        ) : (
          <PCols a={effGroupCmp(group)} gb={p1gb} ga={p1ga} py="py-2" />
        )}
        {hasPeriod2 && (
          <>
            <PCols a={p2a} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
            <DeltaCell p1={lia.actual} p2={p2a.actual} revCtx={false} py="py-2" />
          </>
        )}
      </tr>
    )
  }

  function renderCogsFlatRowMM(group: PLGroupData, section: PLSectionData) {
    const li = group.lineItems[0]
    if (!li) return null
    const lastLI = effLIMM(li.lineItemId, mmLast)
    const prevLI = effLIMM(li.lineItemId, mmPrev)
    return (
      <tr key={group.departmentId} className="bg-gray-100 border-b border-gray-200">
        <td className="pl-4 pr-3 py-2 text-[13px] font-medium text-gray-700">
          {group.deptFullName}
        </td>
        <OwnerCell value={group.ownerName} py="py-2"
          type="department" id={group.departmentId}
          isEditable={isAdmin && !section.hideOwner} suggestions={ownerOptions} />
        {months!.map((mc, ci) => {
          const a  = effLIMM(li.lineItemId, ci)
          const gb = monthLookups![ci].grossBudget
          const ga = monthLookups![ci].grossActual
          return (
            <Fragment key={`${mc.year}-${mc.month}`}>
              {canEdit ? (
                <InlineEditCell value={a.budget} py="py-2"
                  onSave={makeSave(li, 'budget', mc.year, mc.month)}
                  onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', mc.year, mc.month)}
                  onRevert={makeRevert(li.lineItemId, 'budget', mc.year, mc.month)} />
              ) : (
                <AmtCell n={a.budget} py="py-2" />
              )}
              <PctCell v={a.budget} base={gb} py="py-2" />
              {canEdit ? (
                <InlineEditCell value={a.actual} py="py-2"
                  onSave={makeSave(li, 'actual', mc.year, mc.month)}
                  onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', mc.year, mc.month)}
                  onRevert={makeRevert(li.lineItemId, 'actual', mc.year, mc.month)} />
              ) : (
                <AmtCell n={a.actual} py="py-2" />
              )}
              <PctCell v={a.actual} base={ga} py="py-2" />
            </Fragment>
          )
        })}
        {mmN >= 2 && <DeltaCell p1={lastLI.actual} p2={prevLI.actual} revCtx={false} py="py-2" />}
      </tr>
    )
  }

  // ── COGM Supporting Schedule ──────────────────────────────────────────────

  function renderCogmSchedule(section: PLSectionData) {
    const COGM_BG      = '#fdf8ee'
    const COGM_TEXT    = '#7a5c10'
    const COGM_BORDER  = '#e8c96a'
    const COGM_ITEM_BG = '#fffdf5'
    const COGM_GRP_BG  = '#fdf3e0'

    const isSectionOpen = collapse.sections[section.id] ?? false
    if (section.groups.length === 0) return null

    const cogsGroup = refData!.sections
      .find(s => s.id === 'cost_of_goods')
      ?.groups.find(g => g.departmentId === cogsDeptId)

    function invText(cogmActual: number, cogsActual: number): string {
      const diff = cogmActual - cogsActual
      if (diff > 0)  return `฿${Math.round(diff).toLocaleString('en-US')} added to finished goods inventory`
      if (diff < 0)  return `฿${Math.round(-diff).toLocaleString('en-US')} drawn from finished goods inventory`
      return 'no change in inventory'
    }

    const allItems = section.groups.flatMap(g => g.lineItems)
    const COGM_SUB_GROUPS = [
      { colKey: 'cogm_DM',  cogmGroup: 'DM'  as const, label: 'Direct Materials (DM)' },
      { colKey: 'cogm_DL',  cogmGroup: 'DL'  as const, label: 'Direct Labor (DL)' },
      { colKey: 'cogm_MOH', cogmGroup: 'MOH' as const, label: 'Manufacturing Overhead (MOH)' },
    ]

    const monthKey = `${String(p1Year)}-${String(p1Month).padStart(2, '0')}-01`
    const fgVolume = fgProduction[monthKey] ?? null
    function fmtPerMl(n: number | null): string {
      if (n === null || !isFinite(n) || n === 0) return '—'
      return `฿${n.toFixed(2)}/ml`
    }

    const secEff = effSectionCmp(section)

    return (
      <Fragment key={section.id}>
        <tr style={{ borderTop: `2px dashed ${COGM_BORDER}`, backgroundColor: COGM_BG }}
            className="cursor-pointer select-none"
            onClick={() => toggleSection(section.id)}>
          <td className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider" style={{ color: COGM_TEXT }}>
            <span className="mr-2 text-[10px]" style={{ color: COGM_TEXT }}>
              {isSectionOpen ? '▼' : '▶'}
            </span>
            {section.title}
            <span className="ml-3 px-1.5 py-0.5 rounded text-[9px] font-medium border inline-block"
                  style={{ background: '#fff8e1', color: COGM_TEXT, borderColor: COGM_BORDER }}>
              reference only · not in P&L calc
            </span>
          </td>
          <OwnerCell py="py-2.5" />
          {isMultiMonth ? (
            <>
              {months!.map((mc, ci) => {
                const st = effSectionMM(section, ci)
                const gb = monthLookups![ci].grossBudget
                const ga = monthLookups![ci].grossActual
                return (
                  <Fragment key={`${mc.year}-${mc.month}`}>
                    <AmtCell n={st.budget} py="py-2.5" />
                    <PctCell v={st.budget} base={gb} py="py-2.5" />
                    <AmtCell n={st.actual} py="py-2.5" />
                    <PctCell v={st.actual} base={ga} py="py-2.5" />
                  </Fragment>
                )
              })}
              {mmN >= 2 && (() => {
                const lastSt = effSectionMM(section, mmLast)
                const prevSt = effSectionMM(section, mmPrev)
                return <DeltaCell p1={lastSt.actual} p2={prevSt.actual} revCtx={false} py="py-2.5" />
              })()}
            </>
          ) : (
            <>
              <PCols a={secEff} gb={p1gb} ga={p1ga} py="py-2.5" />
              {hasPeriod2 && (
                <>
                  <PCols a={p2?.sectionTotals[section.id] ?? ZERO} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2.5" />
                  <DeltaCell p1={secEff.actual} p2={(p2?.sectionTotals[section.id] ?? ZERO).actual} revCtx={false} py="py-2.5" />
                </>
              )}
            </>
          )}
        </tr>

        {isSectionOpen && (
          <>
            {COGM_SUB_GROUPS.map(({ colKey, cogmGroup, label }) => {
              const subItems    = allItems.filter(li => li.cogmGroup === cogmGroup)
              const isGroupOpen = collapse.depts[colKey] ?? false
              const subTotal    = subItems.reduce((acc: Amounts, li) => addAmounts(acc, effLICmp(li)), ZERO)
              const p2SubTotal  = p2
                ? subItems.reduce((acc: Amounts, li) => addAmounts(acc, p2.items[li.lineItemId] ?? ZERO), ZERO)
                : ZERO
              return (
                <Fragment key={colKey}>
                  <tr style={{ backgroundColor: COGM_GRP_BG, borderLeft: `2px solid ${COGM_BORDER}` }}
                      className="cursor-pointer select-none"
                      onClick={() => toggleDept(colKey)}>
                    <td className="pl-4 pr-3 py-2 text-xs font-semibold" style={{ color: COGM_TEXT }}>
                      <span className="mr-2 text-[10px]" style={{ color: COGM_TEXT }}>
                        {isGroupOpen ? '▼' : '▶'}
                      </span>
                      {label}
                    </td>
                    <OwnerCell py="py-2" />
                    {isMultiMonth ? (
                      <>
                        {months!.map((mc, ci) => {
                          const cgTotal = subItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, ci)), ZERO)
                          const gb = monthLookups![ci].grossBudget
                          const ga = monthLookups![ci].grossActual
                          return (
                            <Fragment key={`${mc.year}-${mc.month}`}>
                              <AmtCell n={cgTotal.budget} py="py-2" />
                              <PctCell v={cgTotal.budget} base={gb} py="py-2" />
                              <AmtCell n={cgTotal.actual} py="py-2" />
                              <PctCell v={cgTotal.actual} base={ga} py="py-2" />
                            </Fragment>
                          )
                        })}
                        {mmN >= 2 && (() => {
                          const last = subItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, mmLast)), ZERO)
                          const prev = subItems.reduce((acc, li) => addAmounts(acc, effLIMM(li.lineItemId, mmPrev)), ZERO)
                          return <DeltaCell p1={last.actual} p2={prev.actual} revCtx={false} py="py-2" />
                        })()}
                      </>
                    ) : (
                      <>
                        <PCols a={subTotal} gb={p1gb} ga={p1ga} py="py-2" />
                        {hasPeriod2 && (
                          <>
                            <PCols a={p2SubTotal} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
                            <DeltaCell p1={subTotal.actual} p2={p2SubTotal.actual} revCtx={false} py="py-2" />
                          </>
                        )}
                      </>
                    )}
                  </tr>

                  {isGroupOpen && subItems.map(li => {
                    const p2a      = p2?.items[li.lineItemId] ?? ZERO
                    const histClick = onRowClick ? () => onRowClick!(li.lineItemId, li.name) : undefined
                    const lastA    = isMultiMonth ? effLIMM(li.lineItemId, mmLast) : ZERO
                    const prevA    = isMultiMonth ? effLIMM(li.lineItemId, mmPrev) : ZERO
                    return (
                      <tr key={li.lineItemId}
                          className="border-b"
                          style={{ backgroundColor: COGM_ITEM_BG, borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: COGM_BORDER, borderBottomColor: '#f0e8d0' }}>
                        <td className="pl-10 pr-3 py-1.5 text-xs" style={{ color: COGM_TEXT }}>
                          {li.name}
                          {li.subcategoryL1 && <div className="text-[10px] opacity-70 mt-0.5">{li.subcategoryL1}</div>}
                        </td>
                        <OwnerCell value={li.ownerName || li.categoryOwnerName} showDash
                          type="line_item" id={li.lineItemId}
                          isEditable={isAdmin} suggestions={ownerOptions} />
                        {isMultiMonth ? (
                          <>
                            {months!.map((mc, ci) => {
                              const a  = effLIMM(li.lineItemId, ci)
                              const gb = monthLookups![ci].grossBudget
                              const ga = monthLookups![ci].grossActual
                              return (
                                <Fragment key={`${mc.year}-${mc.month}`}>
                                  {canEdit ? (
                                    <InlineEditCell value={a.budget}
                                      onSave={makeSave(li, 'budget', mc.year, mc.month)}
                                      onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', mc.year, mc.month)}
                                      onRevert={makeRevert(li.lineItemId, 'budget', mc.year, mc.month)} />
                                  ) : (
                                    <AmtCell n={a.budget} />
                                  )}
                                  <PctCell v={a.budget} base={gb} onClick={histClick} />
                                  {canEdit ? (
                                    <InlineEditCell value={a.actual}
                                      onSave={makeSave(li, 'actual', mc.year, mc.month)}
                                      onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', mc.year, mc.month)}
                                      onRevert={makeRevert(li.lineItemId, 'actual', mc.year, mc.month)} />
                                  ) : (
                                    <AmtCell n={a.actual} />
                                  )}
                                  <PctCell v={a.actual} base={ga} onClick={histClick} />
                                </Fragment>
                              )
                            })}
                            {mmN >= 2 && <DeltaCell p1={lastA.actual} p2={prevA.actual} revCtx={false} />}
                          </>
                        ) : (
                          <>
                            {canEdit ? (
                              <>
                                <InlineEditCell value={li.budget}
                                  onSave={makeSave(li, 'budget', p1Year, p1Month)}
                                  onOptimisticChange={makeOptimistic(li.lineItemId, 'budget', p1Year, p1Month)}
                                  onRevert={makeRevert(li.lineItemId, 'budget', p1Year, p1Month)} />
                                <PctCell v={effLICmp(li).budget} base={p1gb} onClick={histClick} />
                                <InlineEditCell value={li.actual}
                                  onSave={makeSave(li, 'actual', p1Year, p1Month)}
                                  onOptimisticChange={makeOptimistic(li.lineItemId, 'actual', p1Year, p1Month)}
                                  onRevert={makeRevert(li.lineItemId, 'actual', p1Year, p1Month)} />
                                <PctCell v={effLICmp(li).actual} base={p1ga} onClick={histClick} />
                              </>
                            ) : (
                              <>
                                <AmtCell n={li.budget} />
                                <PctCell v={li.budget} base={p1gb} onClick={histClick} />
                                <AmtCell n={li.actual} />
                                <PctCell v={li.actual} base={p1ga} onClick={histClick} />
                              </>
                            )}
                            {hasPeriod2 && (
                              <>
                                <PCols a={p2a} gb={p2!.grossBudget} ga={p2!.grossActual} />
                                <DeltaCell p1={effLICmp(li).actual} p2={p2a.actual} revCtx={false} />
                              </>
                            )}
                          </>
                        )}
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}

            {/* Total COGM row */}
            {(() => {
              const lastSt = isMultiMonth ? effSectionMM(section, mmLast) : ZERO
              const prevSt = isMultiMonth ? effSectionMM(section, mmPrev) : ZERO
              const p2sec  = p2?.sectionTotals[section.id] ?? ZERO
              return (
                <tr className="border-b" style={{ backgroundColor: COGM_BG, borderBottomColor: COGM_BORDER }}>
                  <td className="px-3 py-2 text-xs font-bold italic" style={{ color: COGM_TEXT }}>
                    {section.totalLabel}
                  </td>
                  <OwnerCell py="py-2" />
                  {isMultiMonth ? (
                    <>
                      {months!.map((mc, ci) => {
                        const st = effSectionMM(section, ci)
                        const gb = monthLookups![ci].grossBudget
                        const ga = monthLookups![ci].grossActual
                        return (
                          <Fragment key={`${mc.year}-${mc.month}`}>
                            <AmtCell n={st.budget} py="py-2" />
                            <PctCell v={st.budget} base={gb} py="py-2" />
                            <AmtCell n={st.actual} py="py-2" />
                            <PctCell v={st.actual} base={ga} py="py-2" />
                          </Fragment>
                        )
                      })}
                      {mmN >= 2 && <DeltaCell p1={lastSt.actual} p2={prevSt.actual} revCtx={false} py="py-2" />}
                    </>
                  ) : (
                    <>
                      <PCols a={secEff} gb={p1gb} ga={p1ga} py="py-2" />
                      {hasPeriod2 && (
                        <>
                          <PCols a={p2sec} gb={p2!.grossBudget} ga={p2!.grossActual} py="py-2" />
                          <DeltaCell p1={secEff.actual} p2={p2sec.actual} revCtx={false} py="py-2" />
                        </>
                      )}
                    </>
                  )}
                </tr>
              )
            })()}

            {/* Standard Cost/ml (comparison mode only) */}
            {!isMultiMonth && (
              <tr style={{ backgroundColor: COGM_BG, borderTop: `1px dashed ${COGM_BORDER}` }}>
                <td className="px-3 py-1.5 text-[11px]" style={{ color: COGM_TEXT }}>
                  <span className="font-medium">Standard Cost/ml</span>
                  {isAdmin && (
                    <span className="ml-3 text-[10px] text-amber-600">
                      FG out:&nbsp;
                      <input
                        type="number"
                        min={0}
                        defaultValue={fgVolume ?? ''}
                        onBlur={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v) && v > 0) saveFgProduction(monthKey, v)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        placeholder="0"
                        className="w-20 border border-amber-300 rounded px-1 py-0.5 text-xs bg-white focus:outline-none"
                      />
                      &nbsp;ml
                    </span>
                  )}
                </td>
                <td />
                <td className="px-3 py-1.5 text-[11px] text-right tabular-nums font-medium" style={{ color: COGM_TEXT }}>
                  {fmtPerMl(fgVolume ? secEff.budget / fgVolume : null)}
                </td>
                <td />
                <td className="px-3 py-1.5 text-[11px] text-right tabular-nums font-medium" style={{ color: COGM_TEXT }}>
                  {fmtPerMl(fgVolume ? secEff.actual / fgVolume : null)}
                </td>
                <td />
                {hasPeriod2 && <><td /><td /><td /><td /><td /></>}
              </tr>
            )}

            {/* Inventory movement */}
            {(() => {
              if (isMultiMonth) {
                return (
                  <tr style={{ backgroundColor: COGM_BG, borderTop: `1px dashed ${COGM_BORDER}` }}>
                    <td colSpan={2} className="px-3 py-1.5 text-[10px] italic" style={{ color: COGM_TEXT }}>
                      Inventory movement
                    </td>
                    {months!.map((mc, ci) => {
                      const cogmSt = effSectionMM(section, ci)
                      const cogsSt = effGroupMM(
                        refData!.sections.find(s => s.id === 'cost_of_goods')?.groups.find(g => g.departmentId === cogsDeptId) ?? { lineItems: [], departmentId: '', deptCode: '', deptFullName: '', subtotalLabel: '', ownerName: null, subtotal: ZERO },
                        ci,
                      )
                      return (
                        <td key={`${mc.year}-${mc.month}`} colSpan={4}
                            className="px-2 py-1.5 text-[10px] italic text-center"
                            style={{ color: COGM_TEXT }}>
                          {invText(cogmSt.actual, cogsSt.actual)}
                        </td>
                      )
                    })}
                    {mmN >= 2 && <td />}
                  </tr>
                )
              }
              return (
                <tr style={{ backgroundColor: COGM_BG, borderTop: `1px dashed ${COGM_BORDER}` }}>
                  <td colSpan={2 + 4 + (hasPeriod2 ? 5 : 0)}
                      className="px-3 py-1.5 text-[10px] italic"
                      style={{ color: COGM_TEXT }}>
                    {invText(secEff.actual, cogsGroup?.subtotal.actual ?? 0)}
                  </td>
                </tr>
              )
            })()}
          </>
        )}
      </Fragment>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  if (!refData) return null

  return (
    <>
    {saveError && (
      <div className="fixed bottom-5 right-5 z-50 flex items-start gap-2.5 bg-red-600 text-white text-sm px-4 py-3 rounded-lg shadow-xl max-w-sm">
        <span className="font-semibold shrink-0">Save failed:</span>
        <span className="break-words">{saveError}</span>
        <button onClick={() => setSaveError(null)} className="ml-auto shrink-0 opacity-70 hover:opacity-100 text-base leading-none">✕</button>
      </div>
    )}
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
      <table className="min-w-full border-collapse text-sm">
        <colgroup>
          <col style={{ minWidth: '280px' }} />
          <col style={{ width: '110px' }} />
          {isMultiMonth ? (
            <>
              {months!.map(mc => (
                <Fragment key={`${mc.year}-${mc.month}`}>
                  <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
                  <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
                </Fragment>
              ))}
              {mmN >= 2 && <col style={{ width: '78px' }} />}
            </>
          ) : (
            <>
              <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
              <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
              {hasPeriod2 && (
                <>
                  <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
                  <col style={{ width: '112px' }} /><col style={{ width: '62px' }} />
                  <col style={{ width: '78px' }} />
                </>
              )}
            </>
          )}
        </colgroup>

        <thead className="sticky top-0 z-10">
          {isMultiMonth ? (
            <>
              <tr className="bg-slate-800 text-white">
                <th rowSpan={2} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-600 align-bottom">
                  Line Item
                </th>
                <th rowSpan={2} className="px-2 py-2.5 text-left text-[11px] font-medium text-slate-400 border-b border-slate-600 align-bottom uppercase tracking-wider">
                  Owner
                </th>
                {months!.map(mc => (
                  <th key={`${mc.year}-${mc.month}`} colSpan={4} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border-b border-l border-slate-600">
                    {mc.label}
                  </th>
                ))}
                {mmN >= 2 && (
                  <th rowSpan={2} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border-b border-l border-slate-600 align-bottom">
                    <div>{deltaLabel}</div>
                    {momSubtitle && <div className="text-[9px] font-normal normal-case tracking-normal text-slate-400 mt-0.5">{momSubtitle}</div>}
                  </th>
                )}
              </tr>
              <tr className="bg-slate-700 text-slate-200 text-xs">
                {months!.map(mc =>
                  (['Budget', '%Rev', 'Actual', '%Rev'] as const).map((h, i) => (
                    <th key={`${mc.year}-${mc.month}-${i}`} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${i === 0 ? 'border-l border-slate-600' : ''}`}>
                      {h}
                    </th>
                  ))
                )}
              </tr>
            </>
          ) : (
            <>
              <tr className="bg-slate-800 text-white">
                <th rowSpan={2} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-600 align-bottom">
                  Line Item
                </th>
                <th rowSpan={2} className="px-2 py-2.5 text-left text-[11px] font-medium text-slate-400 border-b border-slate-600 align-bottom uppercase tracking-wider">
                  Owner
                </th>
                <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border-b border-l border-slate-600">
                  {period1!.label}
                </th>
                {hasPeriod2 && (
                  <>
                    <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border-b border-l border-slate-600">
                      {period2!.label}
                    </th>
                    <th rowSpan={2} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border-b border-l border-slate-600 align-bottom">
                      <div>{deltaLabel}</div>
                      {deltaSubtitle && <div className="text-[9px] font-normal normal-case tracking-normal text-slate-400 mt-0.5">{deltaSubtitle}</div>}
                    </th>
                  </>
                )}
              </tr>
              <tr className="bg-slate-700 text-slate-200 text-xs">
                {(['Budget', '%Rev', 'Actual', '%Rev'] as const).map((h, i) => (
                  <th key={`p1h${i}`} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${i === 0 ? 'border-l border-slate-600' : ''}`}>
                    {h}
                  </th>
                ))}
                {hasPeriod2 && (['Budget', '%Rev', 'Actual', '%Rev'] as const).map((h, i) => (
                  <th key={`p2h${i}`} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${i === 0 ? 'border-l border-slate-600' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </>
          )}
        </thead>

        <tbody className="bg-white">
          {refData.sections.map(section => {
            if (section.id === 'cogm_schedule') return renderCogmSchedule(section)
            const hasItems      = section.groups.some(g => g.lineItems.length > 0)
            if (!hasItems && section.id !== 'capex') return null
            const isSectionOpen = collapse.sections[section.id] ?? false
            const isOpex        = section.id === OPEX_ID
            const nonEmpty      = section.groups.filter(g => g.lineItems.length > 0)
            const calcRows      = showCalculatedRows
              ? refData.calculatedRows.filter(r => r.afterSectionId === section.id)
              : []
            const sectionRevCtx = REV_IDS.has(section.id)
            const p2sec         = p2?.sectionTotals[section.id] ?? ZERO
            const secEff        = isMultiMonth ? null : effSectionCmp(section)

            const isSecondarySection = section.id === 'revenue_product'
            return (
              <Fragment key={section.id}>
                <tr
                  className={`text-white cursor-pointer transition-colors select-none ${
                    isSecondarySection
                      ? 'bg-slate-600 hover:bg-slate-500'
                      : 'bg-[#1e2a3a] hover:bg-[#263548]'
                  }`}
                  onClick={() => toggleSection(section.id)}
                >
                  <td className={`px-3 tracking-wide ${isSecondarySection ? 'py-2 text-[11px] font-semibold' : 'py-2.5 text-sm font-semibold'}`}>
                    <span className="mr-2 text-slate-300 text-[10px]">{isSectionOpen ? '▼' : '▶'}</span>
                    {section.title}
                    {isSecondarySection && <span className="ml-2 text-slate-300 text-[9px] font-normal tracking-normal opacity-80">supplementary</span>}
                  </td>
                  {(() => {
                    const hpy = isSecondarySection ? 'py-2' : 'py-2.5'
                    return (
                      <>
                        <OwnerCell py={hpy} />
                        {isMultiMonth ? (
                          <>
                            {months!.map((mc, ci) => {
                              const st = effSectionMM(section, ci)
                              const gb = monthLookups![ci].grossBudget
                              const ga = monthLookups![ci].grossActual
                              return (
                                <Fragment key={`${mc.year}-${mc.month}`}>
                                  <AmtCell n={st.budget} py={hpy} />
                                  <PctCell v={st.budget} base={gb} py={hpy} />
                                  <AmtCell n={st.actual} py={hpy} />
                                  <PctCell v={st.actual} base={ga} py={hpy} />
                                </Fragment>
                              )
                            })}
                            {mmN >= 2 && (() => {
                              const lastSt = effSectionMM(section, mmLast)
                              const prevSt = effSectionMM(section, mmPrev)
                              return <DeltaCell p1={lastSt.actual} p2={prevSt.actual} revCtx={sectionRevCtx} py={hpy} />
                            })()}
                          </>
                        ) : (
                          <>
                            <PCols a={secEff!} gb={p1gb} ga={p1ga} py={hpy} />
                            {hasPeriod2 && (
                              <>
                                <PCols a={p2sec} gb={p2!.grossBudget} ga={p2!.grossActual} py={hpy} />
                                <DeltaCell p1={secEff!.actual} p2={p2sec.actual} revCtx={sectionRevCtx} py={hpy} />
                              </>
                            )}
                          </>
                        )}
                      </>
                    )
                  })()}
                </tr>
                {isSectionOpen && (
                  <>
                    {nonEmpty.map(g => {
                      if (section.id === 'cost_of_goods' && g.deptCode === 'COGS' && g.lineItems.length === 1)
                        return isMultiMonth ? renderCogsFlatRowMM(g, section) : renderCogsFlatRowCmp(g, section)
                      if (g.capexSubGroups)
                        return isMultiMonth ? renderCapexNestedGroupMM(g, section) : renderCapexNestedGroupCmp(g, section)
                      if (isMultiMonth) return isOpex ? renderOpexGroupMM(g, section) : renderStdGroupMM(g, section)
                      return isOpex ? renderOpexGroupCmp(g, section) : renderStdGroupCmp(g, section)
                    })}
                    {isMultiMonth ? renderSectionTotalMM(section) : renderSectionTotalCmp(section)}
                  </>
                )}
                {calcRows.map(cr => isMultiMonth ? renderCalcRowMM(cr) : renderCalcRowCmp(cr))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}
