import { useCallback, useEffect, useState } from 'react'
import { srReservationsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import SrReservationDetailDrawer, { SrStatusBadge } from './SrReservationDetailDrawer.jsx'
import ApplicationSrReservationPanel from './ApplicationSrReservationPanel.jsx'
import SrVendorContractsTab from './SrVendorContractsTab.jsx'
import { filterSelectCls, filterSearchCls } from '../../components/filterStyles.js'
import { IconSearch, IconRefresh, IconPlus, IconEye, IconTruck } from '../../components/icons.jsx'

export default function SrReservationsPage() {
  const { can, isSysAdmin } = useAccess()
  const canView = Boolean(isSysAdmin || can?.['sr_reservations.view'])
  const canContracts = Boolean(isSysAdmin || can?.['sr_vendor_contracts.manage'] || can?.['sr_reservations.view'])

  const [tab, setTab] = useState(canView ? 'pending' : 'contracts') // 'pending' | 'plans' | 'contracts'

  // Pending tab state
  const [pUp3Id, setPUp3Id] = useState('')
  const [pUnitId, setPUnitId] = useState('')
  const [pSearch, setPSearch] = useState('')
  const pDebounced = useDebounce(pSearch, 300)
  const [pPage, setPPage] = useState(1)
  const [pPerPage, setPPerPage] = useState(25)
  const [pendingState, setPendingState] = useState({ loading: false, error: '', rows: [], meta: null })
  const [planAppTarget, setPlanAppTarget] = useState(null)

  // Plans tab state
  const [rUp3Id, setRUp3Id] = useState('')
  const [rUnitId, setRUnitId] = useState('')
  const [rStatus, setRStatus] = useState('')
  const [rSourceLevel, setRSourceLevel] = useState('')
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
        search: pDebounced.trim() || undefined,
        page: pPage,
        per_page: pPerPage,
      })
      setPendingState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setPendingState({ loading: false, error: err?.message || 'Gagal memuat daftar menunggu reservasi.', rows: [], meta: null })
    }
  }, [canView, pUnitId, pDebounced, pPage, pPerPage])

  const loadPlans = useCallback(async () => {
    if (!canView) return
    setPlansState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await srReservationsApi.list({
        status: rStatus || undefined,
        source_level: rSourceLevel || undefined,
        unit_id: rUnitId || undefined,
        page: rPage,
        per_page: rPerPage,
      })
      setPlansState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setPlansState({ loading: false, error: err?.message || 'Gagal memuat daftar rencana reservasi.', rows: [], meta: null })
    }
  }, [canView, rStatus, rSourceLevel, rUnitId, rPage, rPerPage])

  useEffect(() => {
    if (tab === 'pending') loadPending()
  }, [tab, loadPending])

  useEffect(() => {
    if (tab === 'plans') loadPlans()
  }, [tab, loadPlans])

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20 p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Reservasi Material Sambungan (Tanpa Perluasan)
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl">
              Penetapan pelaksana dan rencana reservasi material SR dari BOM APP untuk permohonan siap pasang tanpa perluasan jaringan, penahanan stok, hingga pencatatan nomor reservasi MIMS.
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div role="tablist" aria-label="Menu Reservasi SR" className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {canView && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pending'}
              onClick={() => setTab('pending')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
                tab === 'pending'
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Menunggu Reservasi
              {pendingState.meta?.total != null && (
                <span className="ml-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px]">
                  {pendingState.meta.total}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'plans'}
              onClick={() => setTab('plans')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
                tab === 'plans'
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Daftar Rencana Reservasi
            </button>
          </>
        )}
        {canContracts && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'contracts'}
            onClick={() => setTab('contracts')}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
              tab === 'contracts'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Kontrak Pelaksana 1 Phasa
          </button>
        )}
      </div>

      {/* TAB 1: Menunggu Reservasi */}
      {tab === 'pending' && canView && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
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
            <HierarchicalUnitFilter
              permission="sr_reservations.view"
              up3Id={pUp3Id}
              onUp3Change={(v) => { setPUp3Id(v); setPPage(1) }}
              unitId={pUnitId}
              onUnitChange={(v) => { setPUnitId(v); setPPage(1) }}
              showLabels
            />
            <Button size="sm" variant="secondary" icon={IconRefresh} onClick={loadPending}>
              Segarkan
            </Button>
          </div>

          {pendingState.error && <Alert variant="error">{pendingState.error}</Alert>}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            {pendingState.loading ? (
              <div className="py-12 flex justify-center"><Spinner label="Memuat permohonan siap pasang..." /></div>
            ) : pendingState.rows.length === 0 ? (
              <EmptyState
                icon={IconTruck}
                title="Tidak ada permohonan menunggu reservasi"
                description="Semua permohonan siap pasang (tanpa perluasan) sudah memiliki rencana reservasi berjalan."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Permohonan &amp; Pelanggan</th>
                        <th className="px-4 py-3">ULP</th>
                        <th className="px-4 py-3">Daya &amp; Fasa</th>
                        <th className="px-4 py-3">Pelaksana Bawaan</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {pendingState.rows.map((row) => (
                        <tr key={row.application_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{row.customer_name}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {row.application_number} · {row.application_type} · {row.status}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {row.unit?.code ? `${row.unit.code} - ` : ''}{row.unit?.name || '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.power_va != null ? `${Number(row.power_va).toLocaleString('id-ID')} VA` : '-'}
                            </div>
                            <span className="text-[11px] text-slate-500">{row.phase ? `${row.phase} Phasa` : '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.default_vendor ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-300">{row.default_vendor.name}</span>
                            ) : row.phase === 3 ? (
                              <span className="text-slate-500">Dipilih saat menyusun</span>
                            ) : (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">Belum ada kontrak 1 phasa</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="primary" icon={IconPlus} onClick={() => setPlanAppTarget(row)}>
                              Buat Rencana
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pendingState.meta && (
                  <TableFooter
                    meta={pendingState.meta}
                    page={pPage}
                    perPage={pPerPage}
                    onPageChange={setPPage}
                    onPerPageChange={(v) => { setPPerPage(v); setPPage(1) }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Daftar Rencana Reservasi */}
      {tab === 'plans' && canView && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
            <HierarchicalUnitFilter
              permission="sr_reservations.view"
              up3Id={rUp3Id}
              onUp3Change={(v) => { setRUp3Id(v); setRPage(1) }}
              unitId={rUnitId}
              onUnitChange={(v) => { setRUnitId(v); setRPage(1) }}
              showLabels
            />
            <select
              aria-label="Filter status reservasi"
              value={rStatus}
              onChange={(e) => { setRStatus(e.target.value); setRPage(1) }}
              className={filterSelectCls}
            >
              <option value="">Semua Status</option>
              <option value="DRAFT">Draf</option>
              <option value="SUBMITTED">Diajukan</option>
              <option value="APPROVED">Disetujui</option>
              <option value="RECORDED">Tercatat di MIMS</option>
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
            <Button size="sm" variant="secondary" icon={IconRefresh} onClick={loadPlans}>
              Segarkan
            </Button>
          </div>

          {plansState.error && <Alert variant="error">{plansState.error}</Alert>}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            {plansState.loading ? (
              <div className="py-12 flex justify-center"><Spinner label="Memuat daftar rencana reservasi..." /></div>
            ) : plansState.rows.length === 0 ? (
              <EmptyState
                icon={IconTruck}
                title="Belum ada rencana reservasi"
                description="Buat rencana reservasi dari tab Menunggu Reservasi atau dari detail permohonan siap pasang."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Permohonan &amp; Pelanggan</th>
                        <th className="px-4 py-3">Gudang &amp; Pelaksana</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">No. MIMS</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {plansState.rows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{r.application?.customer_name || '-'}</div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {r.application?.number || '-'} · {r.phase}Ph · {r.power_va != null ? `${Number(r.power_va).toLocaleString('id-ID')} VA` : '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              [{r.source_level}] {r.warehouse?.name || '-'}
                            </div>
                            <div className="text-[11px] text-slate-500">{r.vendor?.name || '-'}</div>
                          </td>
                          <td className="px-4 py-3"><SrStatusBadge status={r.status} /></td>
                          <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-200">
                            {r.mims_reservation_no || '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="secondary" icon={IconEye} onClick={() => setDetailId(r.id)}>
                              Rincian
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {plansState.meta && (
                  <TableFooter
                    meta={plansState.meta}
                    page={rPage}
                    perPage={rPerPage}
                    onPageChange={setRPage}
                    onPerPageChange={(v) => { setRPerPage(v); setRPage(1) }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Kontrak Pelaksana 1 Phasa */}
      {tab === 'contracts' && canContracts && <SrVendorContractsTab />}

      {/* Drawer Buat Rencana dari Tab Pending */}
      <PanelShell
        open={Boolean(planAppTarget)}
        onClose={() => setPlanAppTarget(null)}
        title="Rencana Reservasi Material SR"
        subtitle={planAppTarget ? `${planAppTarget.application_number} · ${planAppTarget.customer_name}` : ''}
        size="lg"
      >
        {planAppTarget && (
          <ApplicationSrReservationPanel
            applicationId={planAppTarget.application_id}
            onChanged={() => {
              loadPending()
              loadPlans()
            }}
          />
        )}
      </PanelShell>

      {/* Drawer Rincian Rencana */}
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
