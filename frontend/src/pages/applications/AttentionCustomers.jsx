import { useCallback, useEffect, useState } from 'react'
import { applicationApi } from '../../services/api.js'
import { useDebounce } from '../../utils/useDebounce.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import { resolveUnitScope } from '../../utils/unitScope.js'
import TableFooter from '../../components/TableFooter.jsx'
import { IconEye, IconRefresh, IconSearch, IconX } from '../../components/icons.jsx'

const toggleCls = (on) => `inline-flex items-center gap-2 px-3 h-10 text-xs font-semibold rounded-xl border cursor-pointer transition ${on ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`

/**
 * Tab "Pelanggan Perlu Perhatian": semua permohonan berstatus Bayar / Cetak PK, hari layanan (HPL) terlama di atas.
 * Berpaginasi, dengan filter yang sama seperti tab Permohonan (unit mengikuti peran lewat unitInfo).
 */
export default function AttentionCustomers({ formatPower, onOpen, unitInfo, FilterField, filterSelectCls }) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [powerFilter, setPowerFilter] = useState('3phase')
  const [up3Filter, setUp3Filter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [extension, setExtension] = useState(false)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  const { up3Locked, up3Value, up3Options, ulpLocked, ulpValue, ulpOptions } = resolveUnitScope(unitInfo, up3Filter, unitFilter)

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    applicationApi.attention({
      page, per_page: perPage, search: debouncedSearch || undefined, type: typeFilter || undefined, status: statusFilter || undefined,
      unit_id: ulpValue || undefined, up3_id: up3Value || undefined, month: monthFilter || undefined,
      min_va: powerFilter === '3phase' ? 6600 : undefined, extension: extension ? 1 : undefined,
    })
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta ?? null }))
      .catch((e) => setState({ loading: false, error: e.message || 'Gagal memuat data.', rows: [], meta: null }))
  }, [page, perPage, debouncedSearch, typeFilter, statusFilter, ulpValue, up3Value, monthFilter, powerFilter, extension])

  useEffect(() => { load() }, [load])

  const { rows, meta } = state
  const dirty = search || typeFilter || statusFilter || monthFilter || extension || (!up3Locked && up3Filter) || (!ulpLocked && unitFilter)
  const reset = () => { setSearch(''); setTypeFilter(''); setStatusFilter(''); setUp3Filter(''); setUnitFilter(''); setMonthFilter(''); setExtension(false); setPage(1) }

  return (
    <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 space-y-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Pelanggan Perlu Perhatian</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Permohonan berstatus Bayar dan Cetak PK, diurutkan dari hari layanan (HPL) terlama.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500"><IconSearch size={16} /></span>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cari nomor agenda, nomor permohonan, nama pelanggan, atau IDPEL…"
              aria-label="Cari pelanggan"
              className="block w-full pl-10 pr-3 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none"
            />
          </div>
          {dirty && (
            <button type="button" onClick={reset} className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">Reset</button>
          )}
          <button type="button" onClick={load} aria-label="Muat ulang" className="p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <IconRefresh size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
          <FilterField label="Tipe">
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} aria-label="Filter Tipe Permohonan" className={filterSelectCls}>
              <option value="">Semua Tipe</option>
              <option value="PB">PB (Pasang Baru)</option>
              <option value="PD">PD (Ubah Daya)</option>
            </select>
          </FilterField>
          <FilterField label="Daya">
            <select value={powerFilter} onChange={(e) => { setPowerFilter(e.target.value); setPage(1) }} aria-label="Filter Daya" className={filterSelectCls}>
              <option value="3phase">≥ 6.600 VA (3 fasa)</option>
              <option value="all">Semua daya</option>
            </select>
          </FilterField>
          <FilterField label="Status">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Filter Status" className={filterSelectCls}>
              <option value="">Bayar &amp; Cetak PK</option>
              <option value="PAID">Bayar</option>
              <option value="PK_PRINTED">Cetak PK</option>
            </select>
          </FilterField>
          <FilterField label="UP3">
            <SearchSelect ariaLabel="Filter Unit UP3" options={up3Options} value={up3Value} disabled={up3Locked} onChange={(v) => { setUp3Filter(v); setUnitFilter(''); setPage(1) }} placeholder="Cari UP3…" />
          </FilterField>
          <FilterField label="ULP">
            <SearchSelect ariaLabel="Filter Unit ULP" options={ulpOptions} value={ulpValue} disabled={ulpLocked} onChange={(v) => { setUnitFilter(v); setPage(1) }} placeholder="Cari ULP…" />
          </FilterField>
          <FilterField label="Bulan & Tahun">
            <div className="flex items-center gap-1">
              <input type="month" value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setPage(1) }} aria-label="Filter Bulan dan Tahun" title="Bulan dan tahun pada tanggal update EIS" className={filterSelectCls} />
              {monthFilter && (
                <button type="button" onClick={() => { setMonthFilter(''); setPage(1) }} aria-label="Hapus filter bulan" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"><IconX size={14} /></button>
              )}
            </div>
          </FilterField>
          <FilterField label="Usulan">
            <button type="button" aria-pressed={extension} onClick={() => { setExtension((v) => !v); setPage(1) }} className={`${toggleCls(extension)} w-full justify-center`}>Usulan perluasan saja</button>
          </FilterField>
        </div>
      </div>

      {state.error && <div className="p-5"><Alert kind="error">{state.error}</Alert></div>}
      {state.loading && <div className="p-8"><Spinner /></div>}
      {!state.loading && !state.error && rows.length === 0 && (
        <EmptyState title="Tidak ada pelanggan yang perlu perhatian" description="Tidak ada permohonan Bayar atau Cetak PK yang cocok dengan filter." />
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
                  <td className="py-3 px-4 text-slate-400 font-mono">{(meta ? (meta.current_page - 1) * meta.per_page : 0) + i + 1}</td>
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
      {meta && (
        <TableFooter
          itemCount={rows.length}
          total={meta.total}
          entityLabel="permohonan"
          meta={meta}
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => { setPerPage(n); setPage(1) }}
          perPageOptions={[10, 25, 50, 100]}
        />
      )}
    </section>
  )
}
