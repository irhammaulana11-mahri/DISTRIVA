import { useCallback, useEffect, useMemo, useState } from 'react'
import { srReservationsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import SrReservationDetailDrawer, { SrStatusBadge } from './SrReservationDetailDrawer.jsx'
import SrCollectiveCreateDrawer from './SrCollectiveCreateDrawer.jsx'
import SrVendorContractsTab from './SrVendorContractsTab.jsx'
import { filterSelectCls, filterSearchCls } from '../../components/filterStyles.js'
import {
  IconSearch,
  IconRefresh,
  IconPlus,
  IconEye,
  IconTruck,
  IconClock,
  IconCheckCircle,
  IconClipboard,
} from '../../components/icons.jsx'

export default function SrReservationsPage() {
  const { can, isSysAdmin } = useAccess()
  const canView = Boolean(isSysAdmin || can?.['sr_reservations.view'])
  const canContracts = Boolean(isSysAdmin || can?.['sr_vendor_contracts.manage'] || can?.['sr_reservations.view'])

  const [tab, setTab] = useState(canView ? 'pending' : 'contracts') // 'pending' | 'plans' | 'contracts'

  // Pending tab state
  const [pUp3Id, setPUp3Id] = useState('')
  const [pUnitId, setPUnitId] = useState('')
  const [pPhase, setPPhase] = useState('')
  const [pReserved, setPReserved] = useState('')
  const [pSearch, setPSearch] = useState('')
  const pDebounced = useDebounce(pSearch, 300)
  const [pPage, setPPage] = useState(1)
  const [pPerPage, setPPerPage] = useState(25)
  const [pendingState, setPendingState] = useState({ loading: false, error: '', rows: [], meta: null })

  // Multi-select collective state (1 atau banyak agenda -> POST /sr-reservations)
  const [selectedMap, setSelectedMap] = useState({}) // { [application_id]: row }
  const [collectiveAgendas, setCollectiveAgendas] = useState(null) // null | array

  // Plans tab state
  const [rUp3Id, setRUp3Id] = useState('')
  const [rUnitId, setRUnitId] = useState('')
  const [rStatus, setRStatus] = useState('')
  const [rSourceLevel, setRSourceLevel] = useState('')
  const [rSearch, setRSearch] = useState('')
  const rDebounced = useDebounce(rSearch, 300)
  const [rPage, setRPage] = useState(1)
  const [rPerPage, setRPerPage] = useState(25)
  const [plansState, setPlansState] = useState({ loading: false, error: '', rows: [], meta: null })
  const [detailId, setDetailId] = useState(null)

  const loadPending = useCallback(async () => {
    if (!canView) return
    setPendingState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await srReservationsApi.pending({
        unit_id: pUnitId || undefined,
        phase: pPhase || undefined,
        reserved: pReserved !== '' ? pReserved : undefined,
        search: pDebounced.trim() || undefined,
        page: pPage,
        per_page: pPerPage,
      })
      setPendingState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setPendingState({ loading: false, error: err?.message || 'Gagal memuat daftar menunggu reservasi.', rows: [], meta: null })
    }
  }, [canView, pUnitId, pPhase, pReserved, pDebounced, pPage, pPerPage])

  const loadPlans = useCallback(async () => {
    if (!canView) return
    setPlansState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await srReservationsApi.list({
        status: rStatus || undefined,
        source_level: rSourceLevel || undefined,
        unit_id: rUnitId || undefined,
        search: rDebounced.trim() || undefined,
        page: rPage,
        per_page: rPerPage,
      })
      setPlansState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setPlansState({ loading: false, error: err?.message || 'Gagal memuat daftar reservasi.', rows: [], meta: null })
    }
  }, [canView, rStatus, rSourceLevel, rUnitId, rDebounced, rPage, rPerPage])

  useEffect(() => {
    if (canView) loadPending()
  }, [canView, loadPending])

  useEffect(() => {
    if (canView) loadPlans()
  }, [canView, loadPlans])

  const stats = useMemo(() => {
    const pendingTotal = pendingState.meta?.total ?? pendingState.rows.length
    const plansTotal = plansState.meta?.total ?? plansState.rows.length
    const draftCount = plansState.rows.filter((r) => r.status === 'DRAFT').length
    const requestedOrSent = plansState.rows.filter((r) => ['REQUESTED', 'SAP_SENT'].includes(r.status)).length
    return { pendingTotal, plansTotal, draftCount, requestedOrSent }
  }, [pendingState, plansState])

  const selectedAgendas = useMemo(() => Object.values(selectedMap), [selectedMap])
  const selectablePendingRows = useMemo(
    () => pendingState.rows.filter((r) => !r.already_reserved),
    [pendingState.rows],
  )
  const allCurrentPageSelected =
    selectablePendingRows.length > 0 && selectablePendingRows.every((r) => Boolean(selectedMap[r.application_id]))

  const toggleSelectRow = (row) => {
    if (row.already_reserved) return
    setSelectedMap((prev) => {
      if (prev[row.application_id]) {
        const next = { ...prev }
        delete next[row.application_id]
        return next
      }
      return { ...prev, [row.application_id]: row }
    })
  }

  const toggleSelectAllPage = () => {
    setSelectedMap((prev) => {
      const next = { ...prev }
      if (allCurrentPageSelected) {
        selectablePendingRows.forEach((r) => { delete next[r.application_id] })
      } else {
        selectablePendingRows.forEach((r) => { next[r.application_id] = r })
      }
      return next
    })
  }

  const handleRefresh = () => {
    if (tab === 'pending') loadPending()
    else if (tab === 'plans') loadPlans()
    else {
      loadPending()
      loadPlans()
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero Header Modul */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs shrink-0">
              <IconTruck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Reservasi Material Sambungan (Tanpa Perluasan)
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Pelayanan &amp; Operasional
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Pilih satu atau banyak No. Agenda (satu ULP, satu phasa) menjadi satu reservasi kolektif, catat nomor permohonan MIMS, lengkapi realisasi per agenda, samakan total, lalu kirim SAP.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            icon={IconRefresh}
            onClick={handleRefresh}
            aria-label="Segarkan"
          >
            Segarkan
          </Button>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Reservasi SR */}
      {canView && (
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Menunggu Reservasi</dt>
              <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
                <IconClock className="h-4 w-4" />
              </div>
            </div>
            <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {stats.pendingTotal}
            </dd>
            <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Siap pasang belum direservasi</p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Reservasi</dt>
              <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <IconClipboard className="h-4 w-4" />
              </div>
            </div>
            <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {stats.plansTotal}
            </dd>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Reservasi kolektif terdaftar</p>
          </div>

          <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Draf</dt>
              <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                <IconTruck className="h-4 w-4" />
              </div>
            </div>
            <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {stats.draftCount}
            </dd>
            <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Menunggu nomor permohonan MIMS</p>
          </div>

          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Dimohonkan / SAP</dt>
              <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                <IconCheckCircle className="h-4 w-4" />
              </div>
            </div>
            <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {stats.requestedOrSent}
            </dd>
            <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Dimohonkan MIMS atau terkirim SAP</p>
          </div>
        </dl>
      )}

      {/* Underline Tabs */}
      <div role="tablist" aria-label="Menu Reservasi SR" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {canView && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pending'}
              onClick={() => setTab('pending')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                tab === 'pending'
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span>Menunggu Reservasi</span>
              {stats.pendingTotal > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    tab === 'pending'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {stats.pendingTotal}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'plans'}
              onClick={() => setTab('plans')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                tab === 'plans'
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span>Daftar Reservasi</span>
              {stats.plansTotal > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    tab === 'plans'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {stats.plansTotal}
                </span>
              )}
            </button>
          </>
        )}
        {canContracts && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'contracts'}
            onClick={() => setTab('contracts')}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'contracts'
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>Kontrak Pelaksana 1 Phasa</span>
          </button>
        )}
      </div>

      {/* TAB 1: Menunggu Reservasi */}
      {tab === 'pending' && canView && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-52">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <IconSearch size={15} />
              </span>
              <input
                type="search"
                value={pSearch}
                onChange={(e) => { setPSearch(e.target.value); setPPage(1) }}
                placeholder="Cari nomor permohonan atau nama pelanggan…"
                className={`w-full ${filterSearchCls}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HierarchicalUnitFilter
                permission="sr_reservations.view"
                up3Id={pUp3Id}
                onUp3Change={(v) => { setPUp3Id(v); setPPage(1) }}
                unitId={pUnitId}
                onUnitChange={(v) => { setPUnitId(v); setPPage(1) }}
              />
              <select
                aria-label="Filter fasa"
                value={pPhase}
                onChange={(e) => { setPPhase(e.target.value); setPPage(1) }}
                className={filterSelectCls}
              >
                <option value="">Semua Fasa</option>
                <option value="1">1 Phasa</option>
                <option value="3">3 Phasa</option>
              </select>
              <select
                aria-label="Filter status reservasi MIMS"
                value={pReserved}
                onChange={(e) => { setPReserved(e.target.value); setPPage(1) }}
                className={filterSelectCls}
              >
                <option value="">Semua Status MIMS</option>
                <option value="0">Belum Direservasi</option>
                <option value="1">Sudah Direservasi</option>
              </select>
            </div>
          </div>

          {/* Bilah Aksi Kolektif */}
          {selectedAgendas.length > 0 && (
            <div className="px-4 py-2.5 bg-blue-50/80 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900/60 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-blue-900 dark:text-blue-200">
                {selectedAgendas.length} No. Agenda dipilih untuk reservasi kolektif
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelectedMap({})}>
                  Kosongkan Pilihan
                </Button>
                <Button size="sm" variant="primary" icon={IconPlus} onClick={() => setCollectiveAgendas(selectedAgendas)}>
                  Buat Reservasi Kolektif ({selectedAgendas.length})
                </Button>
              </div>
            </div>
          )}

          {pendingState.error && (
            <div className="p-4">
              <Alert variant="error">{pendingState.error}</Alert>
            </div>
          )}

          {pendingState.loading ? (
            <div className="py-16 flex justify-center"><Spinner label="Memuat permohonan siap pasang..." /></div>
          ) : pendingState.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={IconTruck}
                title="Tidak ada permohonan menunggu reservasi"
                description="Semua permohonan siap pasang (tanpa perluasan) sudah memiliki reservasi berjalan."
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 pl-4 pr-2 w-8">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua agenda di halaman ini"
                          checked={allCurrentPageSelected}
                          onChange={toggleSelectAllPage}
                          className="rounded border-slate-300"
                        />
                      </th>
                      <th className="py-3 px-4">Permohonan &amp; Pelanggan</th>
                      <th className="py-3 px-4">ULP</th>
                      <th className="py-3 px-4">Daya &amp; Fasa</th>
                      <th className="py-3 px-4">Pelaksana Bawaan</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {pendingState.rows.map((row) => {
                      const isReserved = Boolean(row.already_reserved)
                      const checked = !isReserved && Boolean(selectedMap[row.application_id])
                      return (
                        <tr
                          key={row.application_id}
                          className={`transition-colors ${
                            isReserved
                              ? 'bg-slate-50/60 dark:bg-slate-850/40 opacity-85'
                              : checked
                                ? 'bg-blue-50/40 dark:bg-blue-950/20'
                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <td className="py-3 pl-4 pr-2">
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${row.application_number}`}
                              checked={checked}
                              disabled={isReserved}
                              onChange={() => toggleSelectRow(row)}
                              className="rounded border-slate-300 disabled:opacity-40"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{row.customer_name}</span>
                              {isReserved && (
                                <span className="rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-0 text-[10px] font-semibold">
                                  Sudah direservasi
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {row.application_number} · {row.application_type} · {row.status}
                            </div>
                            {isReserved && Array.isArray(row.mims_reservation_numbers) && row.mims_reservation_numbers.length > 0 && (
                              <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                                No. MIMS: {row.mims_reservation_numbers.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {row.unit?.code ? `${row.unit.code} - ` : ''}{row.unit?.name || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.power_va != null ? `${Number(row.power_va).toLocaleString('id-ID')} VA` : '-'}
                            </div>
                            <span className="text-[11px] text-slate-500">{row.phase ? `${row.phase} Phasa` : '-'}</span>
                          </td>
                          <td className="py-3 px-4">
                            {row.default_vendor ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-300">{row.default_vendor.name}</span>
                            ) : row.phase === 3 ? (
                              <span className="text-slate-500">Dipilih saat menyusun</span>
                            ) : (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">Belum ada kontrak 1 phasa</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              size="sm"
                              variant={isReserved ? 'secondary' : 'primary'}
                              icon={IconPlus}
                              disabled={isReserved}
                              onClick={() => setCollectiveAgendas([row])}
                            >
                              {isReserved ? 'Sudah Direservasi' : 'Buat Reservasi'}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {pendingState.meta && (
                <TableFooter
                  itemCount={pendingState.rows.length}
                  meta={pendingState.meta}
                  page={pPage}
                  perPage={pPerPage}
                  onPage={setPPage}
                  onPerPage={(v) => { setPPerPage(v); setPPage(1) }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: Daftar Reservasi */}
      {tab === 'plans' && canView && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-52">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <IconSearch size={15} />
              </span>
              <input
                type="search"
                value={rSearch}
                onChange={(e) => { setRSearch(e.target.value); setRPage(1) }}
                placeholder="Cari no. permohonan MIMS, agenda, atau pelanggan…"
                className={`w-full ${filterSearchCls}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HierarchicalUnitFilter
                permission="sr_reservations.view"
                up3Id={rUp3Id}
                onUp3Change={(v) => { setRUp3Id(v); setRPage(1) }}
                unitId={rUnitId}
                onUnitChange={(v) => { setRUnitId(v); setRPage(1) }}
              />
              <select
                aria-label="Filter status reservasi"
                value={rStatus}
                onChange={(e) => { setRStatus(e.target.value); setRPage(1) }}
                className={filterSelectCls}
              >
                <option value="">Semua Status</option>
                <option value="DRAFT">Draf</option>
                <option value="REQUESTED">Dimohonkan (MIMS)</option>
                <option value="SAP_SENT">Terkirim ke SAP</option>
                <option value="CANCELLED">Dibatalkan</option>
              </select>
              <select
                aria-label="Filter tingkat gudang"
                value={rSourceLevel}
                onChange={(e) => { setRSourceLevel(e.target.value); setRPage(1) }}
                className={filterSelectCls}
              >
                <option value="">Semua Gudang</option>
                <option value="ULP">Gudang ULP</option>
                <option value="UP3">Gudang UP3</option>
              </select>
            </div>
          </div>

          {plansState.error && (
            <div className="p-4">
              <Alert variant="error">{plansState.error}</Alert>
            </div>
          )}

          {plansState.loading ? (
            <div className="py-16 flex justify-center"><Spinner label="Memuat daftar reservasi..." /></div>
          ) : plansState.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={IconTruck}
                title="Belum ada reservasi"
                description="Buat reservasi kolektif dari tab Menunggu Reservasi atau dari detail permohonan siap pasang."
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Reservasi &amp; Agenda</th>
                      <th className="py-3 px-4">Gudang &amp; Pelaksana</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">No. Permohonan MIMS / SAP</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {plansState.rows.map((r) => {
                      const agendaCount = r.applications_count ?? 1
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {r.unit?.code ? `${r.unit.code} - ` : ''}{r.unit?.name || '-'}
                              </span>
                              <span className="rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0 text-[10px] font-semibold">
                                {agendaCount} Agenda
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {r.phase} Phasa · Kabel bawaan {r.sr_length_m ?? 35} m
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              [{r.source_level}] {r.warehouse?.name || '-'}
                            </div>
                            <div className="text-[11px] text-slate-500">{r.vendor?.name || '-'}</div>
                          </td>
                          <td className="py-3 px-4"><SrStatusBadge status={r.status} /></td>
                          <td className="py-3 px-4 font-mono">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">
                              {r.mims_reservation_no || '-'}
                            </div>
                            {r.sap_reference && (
                              <div className="text-[10px] text-teal-700 dark:text-teal-300">
                                SAP: {r.sap_reference}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="secondary" icon={IconEye} onClick={() => setDetailId(r.id)}>
                              Rincian
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {plansState.meta && (
                <TableFooter
                  itemCount={plansState.rows.length}
                  meta={plansState.meta}
                  page={rPage}
                  perPage={rPerPage}
                  onPage={setRPage}
                  onPerPage={(v) => { setRPerPage(v); setRPage(1) }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: Kontrak Pelaksana 1 Phasa */}
      {tab === 'contracts' && canContracts && <SrVendorContractsTab />}

      {/* Drawer Buat Reservasi Kolektif */}
      <SrCollectiveCreateDrawer
        open={Boolean(collectiveAgendas)}
        agendas={collectiveAgendas || []}
        onRemoveAgenda={(appId) => {
          setCollectiveAgendas((prev) => (prev ? prev.filter((a) => a.application_id !== appId) : null))
          setSelectedMap((prev) => {
            if (!prev[appId]) return prev
            const next = { ...prev }
            delete next[appId]
            return next
          })
        }}
        onClose={() => setCollectiveAgendas(null)}
        onCreated={(createdId) => {
          setSelectedMap({})
          setCollectiveAgendas(null)
          loadPending()
          loadPlans()
          if (createdId) setDetailId(createdId)
        }}
      />

      {/* Drawer Rincian Reservasi */}
      <SrReservationDetailDrawer
        open={Boolean(detailId)}
        reservationId={detailId}
        onClose={() => setDetailId(null)}
        onUpdated={() => {
          loadPending()
          loadPlans()
        }}
      />
    </div>
  )
}
