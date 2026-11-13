import { useEffect, useId, useRef, useState } from 'react'
import { masterDataApi } from '../../services/api.js'
import { IconPlus, IconTrash } from '../../components/icons.jsx'

const inputCls =
  'px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'

/** Total TM / TR dihitung dari baris (hanya baca di UI; server menghitung ulang). */
export function sumLines(lines) {
  const t = { tm: 0, tr: 0 }
  for (const l of lines) {
    const q = Number(l.quantity) || 0
    if (l.pole_type === 'TM') t.tm += q
    else if (l.pole_type === 'TR') t.tr += q
  }
  return t
}

/** Saran awal saat kotak pencarian kosong: tiang beton adalah material yang lazim pada Kontrak Rinci. */
const DEFAULT_QUERY = 'tiang beton'

/**
 * Pemilih material KHS: kotak pencarian dengan daftar hasil di bawahnya (combobox). Ketik kode atau nama untuk mencari ke
 * /master-data/khs; kosong menampilkan saran tiang beton. Panah atas/bawah + Enter memilih, Esc menutup. Daftar memakai
 * posisi tetap supaya tidak terpotong tabel yang dapat digulir.
 */
function KhsSelect({ line, onPick }) {
  const selectedLabel = line.khs_item_id
    ? `${line.khs_code || line.khs_item_id}${line.khs_name ? ` — ${line.khs_name}` : ''}`
    : ''
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)
  const listId = useId()

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect()
    if (!r) return
    const vw = typeof window !== 'undefined' ? window.innerWidth : 360
    const desiredWidth = Math.min(Math.max(r.width, 280), vw - 24)
    const left = Math.max(12, Math.min(r.left, vw - desiredWidth - 12))
    setRect({ top: r.bottom + 2, left, width: desiredWidth })
  }

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoading(true)
    setError('')
    const t = setTimeout(
      async () => {
        try {
          const res = await masterDataApi.khsList({ search: q.trim() || DEFAULT_QUERY, per_page: 20 })
          if (!alive) return
          setOpts(
            (res?.data || []).map((i) => ({
              id: i.id,
              code: i.code,
              name: i.current?.name || i.draft?.name || '',
            })),
          )
          setActive(0)
        } catch (err) {
          // jangan menelan galat: "tidak ada hasil" yang palsu menyesatkan (mis. 429 karena batas permintaan, 403, jaringan)
          if (alive) {
            setOpts([])
            setError(err?.message || 'Gagal memuat daftar material.')
          }
        } finally {
          if (alive) setLoading(false)
        }
      },
      q ? 250 : 0,
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, open])

  useEffect(() => {
    if (!open) return undefined
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const choose = (o) => {
    onPick({ khs_item_id: o.id, khs_code: o.code, khs_name: o.name })
    setOpen(false)
    setQ('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, Math.max(opts.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open && opts[active]) {
      e.preventDefault()
      choose(opts[active])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      setQ('')
    }
  }

  return (
    <div className="min-w-44 sm:min-w-56">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Material tiang KHS"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? q : selectedLabel}
        placeholder={selectedLabel || 'Cari kode / nama material…'}
        onFocus={() => {
          setOpen(true)
          place()
        }}
        onBlur={() => {
          setOpen(false)
          setQ('')
        }}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className={`${inputCls} w-full font-mono`}
      />
      {open && rect && (
        <ul
          id={listId}
          role="listbox"
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 1000 }}
          className="max-h-56 overflow-auto rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-xs"
        >
          {!q.trim() && <li className="px-2 py-1 text-[10px] text-slate-400" aria-hidden="true">Saran: tiang beton. Ketik untuk mencari material lain.</li>}
          {loading && opts.length === 0 && <li className="px-2 py-2 text-slate-400">Memuat…</li>}
          {error && (
            <li role="alert" className="px-2 py-2 text-rose-600">
              Gagal memuat material: {error}
            </li>
          )}
          {!loading && !error && opts.length === 0 && <li className="px-2 py-2 text-slate-400">Tidak ada material yang cocok.</li>}
          {opts.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === line.khs_item_id}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
              onMouseEnter={() => setActive(i)}
              className={`px-2 py-1.5 cursor-pointer font-mono ${i === active ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}
            >
              <span className="font-semibold">{o.code}</span>
              {o.name ? <span className="text-slate-600 dark:text-slate-400"> — {o.name}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function KrLinesEditor({ lines, onChange }) {
  const update = (idx, patch) => onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const totals = sumLines(lines)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-700 dark:text-slate-300">Baris Material Tiang *</span>
        <button
          type="button"
          onClick={() =>
            onChange([...lines, { khs_item_id: '', khs_code: '', khs_name: '', pole_type: 'TM', quantity: '' }])
          }
          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 inline-flex items-center gap-1 cursor-pointer"
        >
          <IconPlus size={12} />
          <span>Tambah Baris</span>
        </button>
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
              <th className="py-2 px-3">Material KHS</th>
              <th className="py-2 px-3">Tipe</th>
              <th className="py-2 px-3 text-right">Jumlah (Batang)</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  Belum ada baris material.
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-2 px-3">
                    <KhsSelect line={l} onPick={(patch) => update(idx, patch)} />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={l.pole_type}
                      aria-label="Tipe tiang"
                      onChange={(e) => update(idx, { pole_type: e.target.value })}
                      className={`${inputCls} font-semibold`}
                    >
                      <option value="TM">TM</option>
                      <option value="TR">TR</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      min="1"
                      value={l.quantity}
                      aria-label="Jumlah tiang"
                      onChange={(e) => update(idx, { quantity: e.target.value })}
                      className={`${inputCls} font-mono text-right w-24`}
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      aria-label="Hapus baris"
                      onClick={() => onChange(lines.filter((_, i) => i !== idx))}
                      className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                    >
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-[11px] font-mono text-slate-600 dark:text-slate-400">
        <span>
          Total TM: <b data-testid="kr-total-tm">{totals.tm}</b> batang
        </span>
        <span>
          Total TR: <b data-testid="kr-total-tr">{totals.tr}</b> batang
        </span>
        <span className="text-slate-400">(dihitung otomatis dari baris)</span>
      </div>
    </div>
  )
}

/** Baris untuk dikirim ke API. */
export function toApiLines(lines) {
  return lines.map((l) => ({
    khs_item_id: l.khs_item_id,
    pole_type: l.pole_type,
    quantity: Number(l.quantity),
  }))
}

/** Validasi klien ringan; mengembalikan pesan atau ''. */
export function validateLines(lines) {
  for (const l of lines) {
    if (!l.khs_item_id) return 'Pilih material KHS pada setiap baris.'
    if (!(Number(l.quantity) >= 1)) return 'Jumlah tiang pada setiap baris minimal 1.'
  }
  return ''
}
