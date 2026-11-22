import { useCallback, useEffect, useState } from 'react'
import { warehousesApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { IconEye, IconRefresh } from '../../components/icons.jsx'
import { filterSelectCls } from '../../components/filterStyles.js'

const selectCls = filterSelectCls

const TRIGGER = {
  AUTO: { label: 'Otomatis', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' },
  MANUAL: { label: 'Manual', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' },
  CLI: { label: 'Perintah server', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  FILE: { label: 'Berkas', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300' },
}

const KINDS = [
  { key: 'stock', label: 'Stok', noun: 'cuplikan stok' },
  { key: 'issues', label: 'Pengeluaran Material', noun: 'pengeluaran' },
  { key: 'receipts', label: 'Penerimaan Material', noun: 'penerimaan' },
  { key: 'reservations', label: 'Reservasi Material', noun: 'reservasi' },
]

const monthNow = () => new Date().toISOString().slice(0, 7)
const dateText = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

/** Cakupan: satu baris per gudang, satu kolom per hari; hijau = cuplikan ada, merah = sudah jatuh tempo tetapi belum diambil, kosong = belum waktunya. */
function Coverage({ kind, month, onMonth, refreshKey }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: '' }))
    warehousesApi.stockCoverage(month, kind)
      .then((d) => live && setState({ loading: false, error: '', data: d }))
      .catch((e) => live && setState({ loading: false, error: e.message || 'Gagal memuat cakupan cuplikan.', data: null }))
    return () => { live = false }
  }, [kind, month, refreshKey])
  const d = state.data
  const days = d ? Array.from({ length: d.days_in_month }, (_, i) => i + 1) : []
  const missingTotal = d ? d.data.reduce((n, w) => n + w.days_missing.length, 0) : 0
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden" data-testid="stock-coverage">
      <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Cakupan Data per Hari: {KINDS.find((k) => k.key === kind)?.label}</h3>
          <p className="text-[11px] text-slate-500">
            {d && <><b data-testid="coverage-missing-total">{missingTotal}</b> hari belum diambil pada bulan ini. </>}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400" aria-label="Arti warna">
            <li className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />{kind === 'stock' ? 'Cuplikan stok hari itu sudah ada' : 'Sudah ditarik: tanggal itu masuk rentang penarikan yang berhasil (angka = jumlah dokumen)'}</li>
            {kind !== 'stock' && <li className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-900/60" />Sudah ada dokumennya, atau masuk rentang perkiraan penarikan lama (rentangnya tidak tercatat)</li>}
            <li className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-rose-400" />Belum diambil: tanggal sudah lewat, tetapi belum ada penarikan{kind === 'stock' ? '' : ' maupun dokumen'}</li>
            <li className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-slate-200 dark:bg-slate-700" />Belum waktunya, atau gudang tidak ditarik dari ERP</li>
          </ul>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
          Bulan
          <input type="month" value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} aria-label="Bulan cakupan" className={selectCls} />
        </label>
      </div>
      {state.error && <div className="p-4"><Alert kind="error">{state.error}</Alert></div>}
      {state.loading && <div className="p-6"><Spinner /></div>}
      {d && !state.loading && (
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                <th className="py-2 px-3 text-left font-semibold sticky left-0 bg-slate-50 dark:bg-slate-800">Gudang</th>
                {days.map((day) => <th key={day} className="py-2 px-0.5 w-6 text-center font-mono font-medium">{day}</th>)}
                <th className="py-2 px-3 text-right font-semibold">Belum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.data.map((w) => (
                <tr key={w.id} data-testid="coverage-row">
                  <td className="py-1.5 px-3 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{w.code}</span>
                    <span className="ml-1.5 text-slate-500">{w.name}</span>
                    {!w.configured && <span className="ml-1.5 text-slate-400">(tanpa plant/lokasi ERP)</span>}
                  </td>
                  {days.map((day) => {
                    const taken = w.days_taken.includes(day)
                    const guess = (w.days_estimated || []).includes(day)
                    const missing = w.days_missing.includes(day)
                    const docs = w.docs_per_day?.[day]
                    const state = taken ? 'taken' : guess ? 'estimated' : missing ? 'missing' : 'none'
                    const what = taken ? (kind === 'stock' ? 'cuplikan ada' : 'sudah ditarik') : guess ? 'sudah ditarik (rentang perkiraan)' : missing ? 'belum diambil' : w.configured ? 'belum waktunya' : 'tidak ditarik dari ERP'
                    const label = `${dateText(`${d.month}-${String(day).padStart(2, '0')}`)}: ${what}${docs ? `, ${docs} dokumen` : ''}`
                    return (
                      <td key={day} className="py-1 px-0.5 text-center" title={label} data-day-state={state}>
                        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[8px] font-bold ${taken ? 'bg-emerald-500 text-white' : guess ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200' : missing ? 'bg-rose-400' : 'bg-slate-100 dark:bg-slate-800'}`} aria-label={label}>{docs || ''}</span>
                      </td>
                    )
                  })}
                  <td className={`py-1.5 px-3 text-right font-mono font-bold ${w.days_missing.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{w.configured ? w.days_missing.length : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Riwayat semua penarikan stok ERP: otomatis (jadwal), manual (pengguna), perintah server, dan berkas yang diunggah, lengkap dengan tanggal cuplikannya, ditambah cakupan harian per gudang. */
export default function StockSyncHistory({ warehouses, onViewSnapshot, onTotal, refreshKey = 0 }) {
  const [kind, setKind] = useState('stock')
  const [warehouseId, setWarehouseId] = useState('')
  const [trigger, setTrigger] = useState('')
  const [status, setStatus] = useState('')
  const [month, setMonth] = useState('')
  const [coverageMonth, setCoverageMonth] = useState(monthNow())
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null, configured: true })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await warehousesApi.syncRuns({ kind, warehouse_id: warehouseId, trigger, status, month, page, per_page: perPage })
      setState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null, configured: res?.sync_configured ?? true })
      onTotal?.(res?.meta?.total ?? (res?.data || []).length)
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err?.message || 'Gagal memuat riwayat sinkronisasi stok.', rows: [], meta: null }))
    }
  }, [kind, warehouseId, trigger, status, month, page, perPage, onTotal, refreshKey])

  useEffect(() => { load() }, [load])

  const filtered = warehouseId || trigger || status || month
  const reset = () => { setWarehouseId(''); setTrigger(''); setStatus(''); setMonth(''); setPage(1) }
  const set = (fn) => (e) => { fn(e.target.value); setPage(1) }
  const stock = kind === 'stock'
  const kindInfo = KINDS.find((k) => k.key === kind)
  const pickKind = (k) => { setKind(k); setTrigger(''); setPage(1) }                       // pemicu Berkas hanya ada pada stok

  return (
    <div className="space-y-4">
      {!state.configured && (
        <Alert kind="warning">Penarikan MIMS otomatis belum dikonfigurasi di server (URL basis dan token MIMS belum disetel pada environment server).</Alert>
      )}
      <div role="tablist" aria-label="Jenis data MIMS" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => pickKind(k.key)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px cursor-pointer transition whitespace-nowrap ${
              kind === k.key
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <Coverage kind={kind} month={coverageMonth} onMonth={setCoverageMonth} refreshKey={refreshKey} />
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Riwayat Sinkronisasi MIMS: {kindInfo.label}</h3>
            <p className="text-[11px] text-slate-500">
              {stock
                ? 'Semua penarikan cuplikan stok: otomatis (jadwal harian), manual, perintah server, dan berkas yang diunggah. Kolom Tgl. Cuplikan adalah tanggal data yang diambil.'
                : `Semua penarikan ${kindInfo.noun}: otomatis (jadwal harian) dan manual. Kolom Rentang Data adalah rentang tanggal yang diminta ke MIMS; tanda ≈ berarti rentang perkiraan untuk penarikan lama yang rentangnya tidak tercatat.`}
            </p>
          </div>
          <Button variant="secondary" size="sm" icon={IconRefresh} loading={state.loading} onClick={load} aria-label="Segarkan riwayat sinkronisasi">Segarkan</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={warehouseId} onChange={set(setWarehouseId)} aria-label="Filter gudang" className={selectCls}>
            <option value="">Semua Gudang</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
          </select>
          <select value={trigger} onChange={set(setTrigger)} aria-label="Filter pemicu" className={selectCls}>
            <option value="">Semua Pemicu</option>
            {Object.entries(TRIGGER).filter(([k]) => stock || (k !== 'FILE' && k !== 'CLI')).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={status} onChange={set(setStatus)} aria-label="Filter status" className={selectCls}>
            <option value="">Semua Status</option>
            <option value="OK">OK</option>
            <option value="SKIPPED">SKIPPED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            {stock ? 'Tgl. cuplikan' : 'Rentang data'}
            <input type="month" value={month} onChange={set(setMonth)} aria-label="Filter bulan cuplikan" className={selectCls} />
          </label>
          {filtered && <button type="button" onClick={reset} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">Reset</button>}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {state.loading ? (
          <div className="py-20 text-center text-slate-500"><Spinner size="lg" label="Memuat riwayat sinkronisasi..." /></div>
        ) : state.rows.length === 0 ? (
          <EmptyState icon={IconRefresh} title="Belum ada riwayat sinkronisasi" description={filtered ? 'Tidak ada riwayat yang cocok dengan filter.' : `Belum ada catatan penarikan ${kindInfo.noun}.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Waktu Mulai</th>
                  <th className="py-3 px-4">{stock ? 'Tgl. Cuplikan' : 'Rentang Data'}</th>
                  <th className="py-3 px-4">Pemicu</th>
                  <th className="py-3 px-4">Gudang</th>
                  <th className="py-3 px-4">Status</th>
                  {stock ? (
                    <>
                      <th className="py-3 px-4 text-right">Total SKU</th>
                      <th className="py-3 px-4 text-right">SKU Terpetakan</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-4 text-right">Dokumen Baru</th>
                      <th className="py-3 px-4 text-right">{kind === 'reservations' ? 'Terkait Permohonan' : kind === 'receipts' ? 'Baris' : 'Baris / Terkait'}</th>
                    </>
                  )}
                  <th className="py-3 px-4">Pesan / Hasil</th>
                  {stock && <th className="py-3 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {state.rows.map((r) => {
                  const t = TRIGGER[r.trigger]
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700 dark:text-slate-300">{r.started_at ? new Date(r.started_at).toLocaleString('id-ID') : '-'}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700 dark:text-slate-300" data-testid="run-as-of">
                        {stock ? dateText(r.as_of) : r.range_from ? <span title={r.range_estimated ? 'Rentang perkiraan: rentang penarikan lama tidak tercatat' : undefined}>{r.range_estimated ? '≈ ' : ''}{dateText(r.range_from)} s/d {dateText(r.range_to)}</span> : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {t ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.cls}`} data-testid="run-trigger">{t.label}</span> : <span className="text-slate-400">-</span>}
                        {r.triggered_by_name && r.trigger !== 'AUTO' && <div className="text-[10px] text-slate-500 mt-0.5">{r.triggered_by_name}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100 mr-1.5">{r.warehouse_code}</span>
                        <span className="text-slate-500 text-[11px]">({r.warehouse_name})</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'OK' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : r.status === 'SKIPPED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'}`}>{r.status}</span>
                      </td>
                      {stock ? (
                        <>
                          <td className="py-3 px-4 text-right font-mono text-slate-800 dark:text-slate-200">{r.materials_total?.toLocaleString('id-ID') || 0}</td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-600 font-semibold">{r.materials_mapped?.toLocaleString('id-ID') || 0}</td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 px-4 text-right font-mono text-slate-800 dark:text-slate-200" data-testid="run-docs">{(r.documents_new ?? 0).toLocaleString('id-ID')}</td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-600 font-semibold">{[r.lines, r.matched].filter((v) => v !== null && v !== undefined).map((v) => v.toLocaleString('id-ID')).join(' / ') || '-'}</td>
                        </>
                      )}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px] max-w-xs truncate" title={r.message}>{r.message || '-'}</td>
                      {stock && <td className="py-3 px-4 text-right">
                        {r.snapshot_id ? (
                          <button
                            type="button"
                            onClick={() => onViewSnapshot({ id: r.snapshot_id, as_of: r.as_of || r.started_at?.slice(0, 10), source_reference: `Sync ${r.warehouse_code}` })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 transition cursor-pointer"
                          >
                            <IconEye size={12} /><span>Lihat Cuplikan</span>
                          </button>
                        ) : <span className="text-slate-400 text-[10px]">-</span>}
                      </td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {state.meta && (
          <TableFooter
            itemCount={state.rows.length}
            total={state.meta.total}
            entityLabel={`riwayat ${kindInfo.noun}`}
            meta={state.meta}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(n) => { setPerPage(n); setPage(1) }}
            perPageOptions={[10, 25, 50, 100]}
          />
        )}
      </div>
    </div>
  )
}
