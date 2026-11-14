import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconX } from './icons.jsx'

/**
 * Dropdown dengan pencarian (combobox). `options`: [{ value, label, description?, badge?, search? }].
 * Ketik untuk menyaring (label, deskripsi, dan `search`), panah atas/bawah + Enter memilih, Esc menutup.
 * Dengan `required`, sebuah input tersembunyi menjaga validasi bawaan form.
 */
export default function SearchSelect({ options, value, onChange, placeholder = 'Cari…', ariaLabel, disabled = false, required = false, clearable = false, emptyText = 'Tidak ada hasil.', className = '' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value) || null
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return options
    return options.filter((o) => [o.label, o.description, o.search].some((t) => t && String(t).toLowerCase().includes(needle)))
  }, [options, q])

  useEffect(() => { setActive(0) }, [q, open])

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!rootRef.current?.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  const choose = (o) => {
    onChange(o.value)
    setOpen(false)
    setQ('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (shown[active]) choose(shown[active])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      setQ('')
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={open ? q : selected?.label || ''}
          placeholder={selected?.label || placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          className={`block w-full pl-3 ${clearable && selected ? 'pr-16' : 'pr-9'} py-2 text-base sm:text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:opacity-60 transition`}
        />
        <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center gap-1 text-slate-400">
          {clearable && selected && !disabled && (
            <button type="button" aria-label="Kosongkan pilihan" onClick={() => { onChange(''); setQ('') }} className="p-0.5 rounded hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"><IconX size={14} /></button>
          )}
          <IconChevronDown size={16} className={`pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {required && <input tabIndex={-1} aria-hidden="true" required value={value || ''} onChange={() => {}} className="absolute inset-x-0 bottom-0 h-px w-full opacity-0 pointer-events-none" />}

      {open && (
        <ul id={listId} role="listbox" ref={listRef} className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1">
          {shown.length === 0 && <li className="px-3 py-3 text-xs text-slate-500 text-center">{emptyText}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2 ${i === active ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{o.label}</span>
                  {o.badge}
                </div>
                {o.description && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{o.description}</div>}
              </div>
              {o.value === value && <IconCheck size={14} className="mt-1 text-blue-600 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
