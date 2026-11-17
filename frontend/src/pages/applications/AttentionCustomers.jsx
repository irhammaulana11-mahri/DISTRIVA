import { useCallback, useEffect, useState } from 'react'
import { applicationApi } from '../../services/api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { IconEye, IconRefresh } from '../../components/icons.jsx'

const toggleCls = (on) => `inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl border cursor-pointer transition ${on ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`

/** Tab "Pelanggan Perlu Perhatian": belum Peremajaan, lama layanan terlama di atas. UP3: 100 data; ULP: maks 50 yang menunggu lebih dari 4 hari. */
export default function AttentionCustomers({ formatPower, onOpen }) {
  const [threePhase, setThreePhase] = useState(true)
  const [extension, setExtension] = useState(false)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    applicationApi.attention({ three_phase: threePhase ? 1 : 0, extension: extension ? 1 : undefined })
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta ?? null }))
      .catch((e) => setState({ loading: false, error: e.message || 'Gagal memuat data.', rows: [], meta: null }))
  }, [threePhase, extension])

  useEffect(() => { load() }, [load])

  const { rows, meta } = state
  const rule = meta?.level === 'ULP'
    ? `Yang belum terlayani lebih dari 4 hari, paling lama ${meta.limit} data`
    : meta ? `${meta.limit} data terlama` : ''

  return (
    <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Pelanggan Perlu Perhatian</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Belum Peremajaan, diurutkan dari lama layanan terlama. {rule}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={threePhase} onClick={() => setThreePhase((v) => !v)} className={toggleCls(threePhase)}>Hanya 3 fasa</button>
          <button type="button" aria-pressed={extension} onClick={() => setExtension((v) => !v)} className={toggleCls(extension)}>Usulan perluasan saja</button>
          <button type="button" onClick={load} aria-label="Muat ulang" className="p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <IconRefresh size={16} />
          </button>
        </div>
      </div>

      {state.error && <div className="p-5"><Alert kind="error">{state.error}</Alert></div>}
      {state.loading && <div className="p-8"><Spinner /></div>}
      {!state.loading && !state.error && rows.length === 0 && (
        <EmptyState title="Tidak ada pelanggan yang perlu perhatian" description="Semua pelanggan sudah terlayani atau tidak ada yang cocok dengan filter." />
      )}
      {!state.loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4 w-10">#</th>
                <th className="py-3 px-4">Pelanggan</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Tarif &amp; Daya</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Lama Layanan</th>
                <th className="py-3 px-4">Usulan Perluasan</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {rows.map((r, i) => (
                <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 text-slate-400 font-mono">{i + 1}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{r.customer?.name || '-'}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs" title={r.service_address}>{r.service_address || '-'}</div>
                    <span className="sr-only">{r.application_number}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{r.unit?.code} - {r.unit?.name}</td>
                  <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">{formatPower(r.new_tariff_code, r.new_power_value, r.new_power_unit)}</td>
                  <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                  <td className="py-3 px-4">
                    <span className={`font-bold ${r.days > 30 ? 'text-rose-600' : r.days > 4 ? 'text-amber-600' : 'text-slate-700 dark:text-slate-300'}`}>{r.days} hari</span>
                  </td>
                  <td className="py-3 px-4">
                    {r.proposal_number
                      ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">{r.proposal_number}</span>
                      : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button type="button" onClick={() => onOpen(r.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                      <IconEye size={13} /><span>Pratinjau</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
