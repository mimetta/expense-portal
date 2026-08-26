'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const VIEWS = [
  { id: '3month',    label: '3-Month' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yoy',       label: 'Year-over-Year' },
  { id: 'annual',    label: 'Annual' },
] as const

const YEARS = [2025, 2026, 2027]

const QUARTERS = [
  { label: 'Q1', month: '01' },
  { label: 'Q2', month: '04' },
  { label: 'Q3', month: '07' },
  { label: 'Q4', month: '10' },
]

function defaultAnchorFor(mode: string): string {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = now.getMonth() + 1
  if (mode === 'annual') return `${y}-01`
  if (mode === 'quarterly') {
    const qm = m <= 3 ? '01' : m <= 6 ? '04' : m <= 9 ? '07' : '10'
    return `${y}-${qm}`
  }
  return `${y}-${String(m).padStart(2, '0')}`
}

function parseAnchor(anchor: string) {
  const parts = anchor.split('-').map(Number)
  const now   = new Date()
  return { y: parts[0] || now.getFullYear(), m: parts[1] || now.getMonth() + 1 }
}

const selectCls = "text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-[#1e2a3a]/20 cursor-pointer"

export default function PeriodFilter({ mode, anchor }: { mode: string; anchor: string }) {
  const router = useRouter()
  const sp     = useSearchParams()
  const { y, m } = parseAnchor(anchor)

  function navigate(newMode: string, newAnchor: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('mode', newMode)
    params.set('anchor', newAnchor)
    router.push(`?${params.toString()}`)
  }

  function setYear(newY: number) {
    navigate(mode, `${newY}-${String(m).padStart(2, '0')}`)
  }

  function setMonth(newM: number) {
    navigate(mode, `${y}-${String(newM).padStart(2, '0')}`)
  }

  function setQuarterMonth(qm: string) {
    navigate(mode, `${y}-${qm}`)
  }

  // For quarterly: snap displayed value to nearest quarter start
  const displayQM = m <= 3 ? '01' : m <= 6 ? '04' : m <= 9 ? '07' : '10'

  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-4 py-2 border border-gray-200 flex-wrap">
      <span className="text-xs font-medium text-gray-500 shrink-0">View</span>
      <div className="flex gap-1">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => navigate(v.id, defaultAnchorFor(v.id))}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              mode === v.id
                ? 'bg-[#1e2a3a] text-white'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-gray-300 shrink-0" />

      {/* Year selector — always visible */}
      <select
        value={y}
        onChange={e => setYear(Number(e.target.value))}
        className={selectCls}
        aria-label="Year"
      >
        {YEARS.map(yr => <option key={yr} value={yr}>{yr}</option>)}
      </select>

      {/* Month selector (3-Month / YoY) */}
      {(mode === '3month' || mode === 'yoy') && (
        <select
          value={m}
          onChange={e => setMonth(Number(e.target.value))}
          className={selectCls}
          aria-label="Month"
        >
          {MN.map((mn, i) => (
            <option key={mn} value={i + 1}>{mn}</option>
          ))}
        </select>
      )}

      {/* Quarter selector (Quarterly) */}
      {mode === 'quarterly' && (
        <select
          value={displayQM}
          onChange={e => setQuarterMonth(e.target.value)}
          className={selectCls}
          aria-label="Quarter"
        >
          {QUARTERS.map(q => (
            <option key={q.month} value={q.month}>{q.label}</option>
          ))}
        </select>
      )}

      {/* Annual: Year only, no extra selector */}
    </div>
  )
}
