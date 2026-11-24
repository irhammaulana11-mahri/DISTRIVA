import { useCallback, useEffect, useState } from 'react'
import { eisSyncApi } from '../../services/api.js'
import Modal from '../../components/Modal.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconClipboard, IconRefresh } from '../../components/icons.jsx'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}

const when = (v) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

/** Tab "Riwayat Sinkronisasi EIS" di halaman PB/PD: sesi penarikan terakhir dan lognya. */
export default function EisRunHistory() {
  const [state, setState] = useState({ loading: true, error: '', runs: [], lookback: null })
  const [selected, setSelected] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    eisSyncApi.show()
      .then((res) => setState({ loading: false, error: '', runs: res?.data?.runs || [], lookback: res?.data?.settings?.lookback_days ?? null }))
      .catch((e) => setState({ loading: false, error: e.message || 'Gagal memuat riwayat sinkronisasi.', runs: [], lookback: null }))
  }, [])

  useEffect(() => { load() }, [load])

  const openLog = async (run) => {
    try {
      const res = await eisSyncApi.run(run.id)
      setSelected(res?.data || run)
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || 'Gagal memuat log.' }))
    }
  }

  const copyLog = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* diabaikan */ }
  }

  const { runs } = state

  return (
    <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Riwayat Sinkronisasi EIS</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Catatan penarikan data permohonan dari server EIS PLN.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">{runs.length} sesi tercatat</span>
          <button type="button" onClick={load} aria-label="Muat ulang riwayat" className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <IconRefresh size={16} />
          </button>
        </div>
      </div>

      {state.error && <div className="p-5"><Alert kind="error">{state.error}</Alert></div>}
      {state.loading && <div className="p-8"><Spinner /></div>}
      {!state.loading && !state.error && runs.length === 0 && (
        <div className="py-12 text-center text-xs text-slate-500">
          <p className="font-semibold">Belum ada sinkronisasi.</p>
          <p className="text-[11px] text-slate-400 mt-1">Jalankan penarikan dari tombol &quot;Sinkronisasi EIS&quot;.</p>
        </div>
      )}
      {!state.loading && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Waktu Eksekusi</th>
                <th className="py-3 px-4">Jenis</th>
                <th className="py-3 px-4">Pemicu</th>
                <th className="py-3 px-4">Rentang / Periode</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Dijalankan Oleh</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {runs.map((r) => {
                const isPiutang = r.kind === 'piutang'
                return (
                  <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">{when(r.created_at)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        isPiutang
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                      }`}>
                        {isPiutang ? 'Saldo Piutang' : 'Permohonan'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                      {r.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}
                      {r.complete_old && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 text-[10px] font-bold" title="Dengan pelengkapan permohonan lama (maks. 180 hari sebelum rentang)">+ pelengkapan</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px]">
                      {isPiutang ? (
                        <div className="space-y-0.5">
                          <div className="font-mono font-medium">
                            {r.options?.from_month === r.options?.to_month
                              ? r.options?.to_month || '-'
                              : `${r.options?.from_month || '-'} s/d ${r.options?.to_month || '-'}`}
                          </div>
                          {r.options?.reports && (
                            <div className="text-[10px] text-slate-400">
                              {r.options.reports.join(', ')}
                            </div>
                          )}
                        </div>
                      ) : (
                        r.range_from && r.range_to
                          ? <span className="font-mono font-medium">{r.range_from} s/d {r.range_to}</span>
                          : <span className="text-slate-400">Bawaan{state.lookback ? ` (${state.lookback} hari)` : ''}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px]">
                      {r.units && r.units.length > 0 ? <span className="font-mono">{r.units.join(', ')}</span> : <span className="text-slate-400">Semua unit</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px]">{r.started_by || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS[r.status]?.[1] || 'bg-slate-100 text-slate-700'}`}>{STATUS[r.status]?.[0] || r.status}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button type="button" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer text-xs" onClick={() => openLog(r)}>Lihat log</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Modal open title={`Detail Log Sinkronisasi EIS (${selected.id})`} onClose={() => setSelected(null)} size="max-w-3xl">
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS[selected.status]?.[1]}`}>{STATUS[selected.status]?.[0] || selected.status}</span>
                <span className="text-slate-600 dark:text-slate-300 text-[11px]">Pemicu: <b>{selected.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}</b> · {when(selected.created_at)}</span>
              </div>
              {selected.log && (
                <button type="button" onClick={() => copyLog(selected.log)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                  <IconClipboard size={13} />
                  <span>{copied ? 'Tersalin!' : 'Salin Semua Log'}</span>
                </button>
              )}
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-800 dark:border-slate-700 bg-slate-900">
              <pre className="max-h-80 overflow-auto p-4 text-slate-100 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-all">{selected.log || '(Tidak ada catatan log pada sesi sinkronisasi ini)'}</pre>
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={() => setSelected(null)}>Tutup</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
