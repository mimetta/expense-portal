'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const MODES = [
  { id: 'mom', label: 'MoM' },
  { id: 'qoq', label: 'QoQ' },
  { id: 'yoy', label: 'YoY' },
]

interface Props {
  current: string
}

export default function PeriodSelector({ current }: Props) {
  const router = useRouter()
  const sp     = useSearchParams()

  function select(mode: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('mode', mode)
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
      {MODES.map(m => (
        <button
          key={m.id}
          onClick={() => select(m.id)}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            current === m.id
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
