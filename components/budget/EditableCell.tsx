'use client'

import { useState, useRef, useEffect } from 'react'

function thb(n: number) {
  return `฿${Math.round(n).toLocaleString('en-US')}`
}

interface Props {
  value: number
  onSave: (v: number) => Promise<void>
}

export default function EditableCell({ value, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEdit() {
    setDraft(String(Math.round(value)))
    setEditing(true)
  }

  async function commit() {
    const parsed = Number(draft.replace(/[^0-9.-]/g, ''))
    if (isNaN(parsed) || parsed === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        disabled={saving}
        className="w-24 text-right text-sm border border-indigo-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className={`text-right tabular-nums w-full ${
        value === 0
          ? 'text-gray-300 hover:text-gray-500'
          : 'text-gray-900 hover:text-indigo-700'
      } group`}
    >
      <span className="group-hover:underline">
        {value === 0 ? '—' : thb(value)}
      </span>
    </button>
  )
}
