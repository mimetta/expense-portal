'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const MN    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MODES = [
  { id: '3month', label: '3-Month' },
  { id: 'qoq',    label: 'QoQ' },
  { id: 'yoy',    label: 'YoY' },
]

interface Props {
  mode:   string
  anchor: string  // 'YYYY-MM'
}

function shiftAnchor(anchor: string, delta: number): string {
  const [y, m] = anchor.split('-').map(Number)
  let nm = m + delta, ny = y
  while (nm <= 0) { nm += 12; ny-- }
  while (nm > 12) { nm -= 12; ny++ }
  return `${ny}-${String(nm).padStart(2, '0')}`
}

function rangeLabel(anchor: string): string {
  const start = shiftAnchor(anchor, -2)
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = anchor.split('-').map(Number)
  return `${MN[sm - 1]} ${sy} — ${MN[em - 1]} ${ey}`
}

function isPastMaxMonth(anchor: string): boolean {
  // Allow forward navigation up to December of next year
  const now    = new Date()
  const maxStr = `${now.getFullYear() + 1}-12`
  return anchor >= maxStr
}

export default function MonthRangeNavigator({ mode, anchor }: Props) {
  const router = useRouter()
  const sp     = useSearchParams()

  function navigate(newMode: string, newAnchor?: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('mode', newMode)
    if (newAnchor) params.set('anchor', newAnchor)
    else params.delete('anchor')
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => navigate(m.id, anchor)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m.id
                ? 'bg-[#1e2a3a] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === '3month' && (
        <div className="flex items-center gap-1 text-sm">
          <button
            onClick={() => navigate('3month', shiftAnchor(anchor, -1))}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            ← Prev
          </button>
          <span className="px-3 py-1 text-gray-700 font-medium min-w-[190px] text-center text-xs">
            {rangeLabel(anchor)}
          </span>
          <button
            onClick={() => navigate('3month', shiftAnchor(anchor, 1))}
            disabled={isPastMaxMonth(anchor)}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
