import { useEffect, useState } from 'react'
import { substationsApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'

const inputCls =
  'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500'

const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))

/**
 * Isian KKO dari satu gardu master (docs/80 §7). Hanya gardu aktif milik PLN di cakupan petugas yang muncul (server menyaring dan memeriksa ulang).
 * Hasilnya hanya mengisi formulir; petugas masih dapat mengubah angka, dan yang tersimpan di KKO adalah salinan pada saat itu.
 * onPick({ substation_id, substation_code, substation_name, transformer_capacity_kva, measured_load_kva, measured_at, voltage_location_v }, notes)
 */
export default function SubstationPicker({ selectedId, onPick, onClear }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return undefined
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await substationsApi.list({ q: q.trim(), pickable: 1, per_page: 8 })
        if (!cancelled) setResults(res?.data || [])
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Gagal mencari gardu.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  const choose = (s) => {
    const r = s.reading
    setPicked(s)
    setResults([])
    setQ('')
    onPick(
      {
        substation_id: s.id,
        substation_code: s.display_code || s.code,
        substation_name: [s.code, s.name || s.area_note].filter(Boolean).join(' - '),
        transformer_capacity_kva: s.capacity_kva ?? '',
        measured_load_kva: r?.load_kva ?? '',
        measured_at: r?.measured_on ?? '',
        voltage_location_v: r?.end_voltage_v ?? '',
      },
      { stale: s.reading_status === 'STALE', none: s.reading_status === 'NONE', noLoad: Boolean(r) && r.load_kva === null, age: r?.age_days ?? null },
    )
  }

  const clear = () => {
    setPicked(null)
    onClear?.()
  }

  return (
    <div className="sm:col-span-2 space-y-2" data-testid="substation-picker">
      <label className="text-[11px] font-semibold block">
        Pilih dari master gardu
        <input aria-label="Cari gardu master" className={inputCls} placeholder="Ketik kode atau nama gardu (min. 2 huruf)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {loading && <p className="text-[11px] text-slate-500">Mencari…</p>}
      {error && <Alert kind="error">{error}</Alert>}
      {results.length > 0 && (
        <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 text-xs" role="listbox">
          {results.map((s) => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => choose(s)} className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <span className="font-mono font-bold">{s.code}</span> <span>{s.name || s.area_note || s.kelurahan || ''}</span>
                <span className="block text-[11px] text-slate-500">
                  {fmt(s.capacity_kva, 0)} kVA · pembebanan {s.reading?.loading_pct != null ? `${fmt(s.reading.loading_pct)}%` : '-'} · {s.reading_status === 'FRESH' ? 'terkini' : s.reading_status === 'STALE' ? 'kedaluwarsa' : 'belum ada pembacaan'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && q.trim().length >= 2 && results.length === 0 && !error && (
        <p className="text-[11px] text-slate-500">Tidak ada gardu PLN aktif yang cocok. Gardu pelanggan tidak dapat dipilih; isi manual bila perlu.</p>
      )}
      {(picked || selectedId) && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400" data-testid="substation-picked">
          Terhubung ke gardu master {picked?.code || ''}.{' '}
          <button type="button" className="underline cursor-pointer" onClick={clear}>
            Lepas
          </button>
        </p>
      )}
    </div>
  )
}
