import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { applicationApi, surveyApi, documentApi, drawingApi, proposalsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import UnitPicker from '../../components/UnitPicker.jsx'
import StatusBadge, { formatStatusLabel } from '../../components/StatusBadge.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import SurveyDetailView from '../surveys/SurveyDetailView.jsx'
import DrawingDetailView from '../drawings/DrawingDetailView.jsx'
import ApplicationKkfPanel from './ApplicationKkfPanel.jsx'
import ApplicationKkoPanel from './ApplicationKkoPanel.jsx'
import ApplicationAllocationPanel from './ApplicationAllocationPanel.jsx'
import ApplicationWorkOrdersPanel from './ApplicationWorkOrdersPanel.jsx'
import ProposalSelectableModal from '../proposals/ProposalSelectableModal.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import { filterSelectCls as sharedSelectCls, filterSearchCls } from '../../components/filterStyles.js'
import { resolveUnitScope } from '../../utils/unitScope.js'
import EisRunHistory from './EisRunHistory.jsx'
import AttentionCustomers from './AttentionCustomers.jsx'
import { AuthenticatedDocumentItem } from '../../components/DocumentGallery.jsx'
import {
  IconSearch,
  IconPlus,
  IconRefresh,
  IconEye,
  IconCheckCircle,
  IconX,
  IconFileText,
  IconBuilding,
  IconUser,
  IconTag,
  IconClock,
  IconMapPin,
  IconLock,
  IconUpload,
  IconDownload,
  IconAlertCircle,
  IconUsers,
  IconArrowRight,
  IconTrash,
} from '../../components/icons.jsx'

export function getMissingFields(app) {
  if (!app) return { hasAgenda: false, hasRegister: false, hasIdpel: false, missingAgenda: true, missingRegister: true, missingIdpel: true }

  const hasAgenda = Boolean(
    app.agenda_number ||
    app.external_references?.some((r) => r.reference_type === 'AGENDA') ||
    (!['DRAFT', 'SUBMITTED'].includes(app.status) && app.agenda_number !== null && !app.missing_agenda)
  )

  const hasRegister = Boolean(
    app.register_number ||
    app.payment_register_number ||
    app.external_references?.some((r) => r.reference_type === 'PAYMENT_REGISTER')
  )

  const hasIdpel = Boolean(
    (Array.isArray(app.customer?.idpel) && app.customer.idpel.length > 0 && (app.customer.idpel[0]?.value || app.customer.idpel[0])) ||
    (typeof app.customer?.idpel === 'string' && app.customer.idpel.trim()) ||
    app.idpel ||
    app.customer_idpel
  )

  return {
    hasAgenda,
    hasRegister,
    hasIdpel,
    missingAgenda: !hasAgenda,
    missingRegister: !hasRegister,
    missingIdpel: !hasIdpel,
  }
}

export function formatTariffPower(tariffCode, powerVal, powerUnit) {
  const hasTariff = Boolean(tariffCode)
  const hasPower = powerVal !== null && powerVal !== undefined && powerVal !== ''
  if (!hasTariff && !hasPower) return '-'

  let formattedPower = ''
  if (hasPower) {
    const num = Number(powerVal)
    const valStr = isNaN(num) ? String(powerVal) : num.toLocaleString('id-ID')
    formattedPower = `${valStr} ${powerUnit || 'VA'}`
  }

  if (hasTariff && formattedPower) {
    return `${tariffCode} · ${formattedPower}`
  }
  return tariffCode || formattedPower || '-'
}

const filterSelectCls = `block w-full ${sharedSelectCls}`

/** Satu filter dengan label kecil di atasnya; lebar mengikuti sel grid. */
function FilterField({ label, children }) {
  return (
    <div className="min-w-0 [&_input[role=combobox]]:h-10 [&_input[role=combobox]]:text-xs [&_input[role=combobox]]:sm:text-sm">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      {children}
    </div>
  )
}

export default function ApplicationsPage() {
  const { can, canWrite, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const searchInputRef = useRef(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // Table & Filters State
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [up3Filter, setUp3Filter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')   // 'YYYY-MM'
  const [tab, setTab] = useState('permohonan')           // 'permohonan' | 'eis'
  const [unitInfo, setUnitInfo] = useState({ scope: '', up3_units: [], ulp_units: [] })
  // Daya: tampilan awal hanya 3 fasa (>= 6.600 VA, keputusan pemilik 8 Nov 2026); 'all' menampilkan semua daya. Pilihan diingat per browser. Hanya mempengaruhi tampilan, bukan data yang disimpan.
  const [powerFilter, setPowerFilter] = useState(() => {
    try { return localStorage.getItem('distriva.pbpd.power') === 'all' ? 'all' : '3phase' } catch { return '3phase' }
  })
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  // Drawer & Modal States
  const [detailTarget, setDetailTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [completeTarget, setCompleteTarget] = useState(null)
  const [submittingId, setSubmittingId] = useState(null)

  // Proposals selection from rows
  const [selectedAppIds, setSelectedAppIds] = useState([])
  const [createProposalModalOpen, setCreateProposalModalOpen] = useState(false)

  // Sync searchParams for app_id
  useEffect(() => {
    const appId = searchParams.get('app_id')
    if (appId) setDetailTarget({ id: appId })
  }, [searchParams])

  // Keyboard shortcut: Press "/" to focus search box
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // UP3/ULP choices by role: global (sys admin) picks freely; others see their own unit(s) only.
  useEffect(() => {
    let live = true
    Promise.resolve(applicationApi.units()).then((d) => { if (live && d) setUnitInfo({ scope: d.scope || '', up3_units: d.up3_units || [], ulp_units: d.ulp_units || [] }) }).catch(() => {})
    return () => { live = false }
  }, [])
  const { up3Locked, up3Value, up3Options, ulpLocked, ulpValue, ulpOptions } = resolveUnitScope(unitInfo, up3Filter, unitFilter)

  // Load applications list
  const loadApplications = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    const params = {
      page,
      per_page: perPage,
      search: debouncedSearch || undefined,
      type: typeFilter || undefined,
      status: statusFilter || undefined,
      unit_id: ulpValue || undefined,
      up3_id: up3Value || undefined,
      month: monthFilter || undefined,
      listing: 'pbpd',
      min_va: powerFilter === '3phase' ? 6600 : undefined,
    }
    applicationApi.list(params)
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta }))
      .catch((e) => setState({ loading: false, error: e.message || 'Gagal memuat data permohonan.', rows: [], meta: null }))
  }, [page, perPage, debouncedSearch, typeFilter, statusFilter, ulpValue, up3Value, monthFilter, powerFilter])

  useEffect(() => {
    loadApplications()
  }, [loadApplications])

  // Handle Submit Application (DRAFT -> SUBMITTED)
  const handleSubmitApplication = async (app) => {
    if (!app || submittingId) return
    setSubmittingId(app.id)
    try {
      await applicationApi.submit(app.id)
      notify({
        type: 'success',
        title: 'Permohonan Berhasil Diajukan',
        desc: `Permohonan ${app.application_number} telah diajukan dan siap diproses ke tahap Survei Lapangan.`,
        tag: 'PB/PD',
      })
      if (detailTarget?.id === app.id) {
        setDetailTarget(null)
      }
      loadApplications()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Mengajukan Permohonan',
        desc: err.message || 'Terjadi kesalahan saat memproses permohonan.',
        tag: 'PB/PD',
      })
    } finally {
      setSubmittingId(null)
    }
  }

  // Handle Cancel Application
  const handleConfirmCancel = async (reason) => {
    if (!cancelTarget) return
    try {
      await applicationApi.cancel(cancelTarget.id, { reason })
      notify({
        type: 'warning',
        title: 'Permohonan Dibatalkan',
        desc: `Permohonan ${cancelTarget.application_number} telah dibatalkan dengan pencatatan audit log.`,
        tag: 'PB/PD',
      })
      setCancelTarget(null)
      if (detailTarget?.id === cancelTarget.id) {
        setDetailTarget(null)
      }
      loadApplications()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Membatalkan Permohonan',
        desc: err.message || 'Terjadi kesalahan saat membatalkan permohonan.',
        tag: 'PB/PD',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Modul Permohonan Pelanggan (PB/PD) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconFileText className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Permohonan Pelanggan (PB/PD)
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Pelayanan &amp; Penyambungan
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Pendaftaran agenda penyambungan Pasang Baru (PB) dan Perubahan Daya (PD) terikat unit kerja ULP dengan alur integrasi EIS / Daftung.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={loadApplications}
              icon={IconRefresh}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {can['eis_sync.manage'] && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={IconRefresh}
                onClick={() => navigate('/permohonan/sinkronisasi-eis')}
                aria-label="Sinkronisasi EIS"
              >
                Sinkronisasi EIS
              </Button>
            )}
            {can['applications.import'] && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                icon={IconUpload}
                onClick={() => navigate('/permohonan/impor')}
                aria-label="Impor Berkas EIS"
              >
                Impor Berkas
              </Button>
            )}
            {can['applications.create'] && (
              <Button
                type="button"
                variant="primary"
                size="md"
                icon={IconPlus}
                onClick={() => navigate('/permohonan/baru')}
                aria-label="Permohonan Baru"
              >
                Permohonan Baru
              </Button>
            )}
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Tampilan PB/PD" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {[['permohonan', 'Permohonan'], ['attention', 'Pelanggan Perlu Perhatian'], ...(can['eis_sync.manage'] ? [['eis', 'Riwayat Sinkronisasi EIS']] : [])].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${tab === id ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'eis' && can['eis_sync.manage'] && <EisRunHistory />}
      {tab === 'attention' && <AttentionCustomers formatPower={formatTariffPower} onOpen={(id) => setDetailTarget({ id })} unitInfo={unitInfo} FilterField={FilterField} filterSelectCls={filterSelectCls} />}
      {tab === 'permohonan' && (
      <>
        {/* Main Standardized Table Card */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Filter Toolbar: pencarian di atas, filter berlabel dalam grid sama lebar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <IconSearch size={16} />
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Cari nomor agenda, nomor permohonan, nama pelanggan, atau IDPEL…"
                className={`block w-full ${filterSearchCls} pr-14`}
              />
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">/</span>
              </span>
            </div>
            {(search || typeFilter || statusFilter || monthFilter || (!up3Locked && up3Filter) || (!ulpLocked && unitFilter)) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setTypeFilter('')
                  setStatusFilter('')
                  setUp3Filter('')
                  setUnitFilter('')
                  setMonthFilter('')
                  setPage(1)
                }}
                className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <FilterField label="Tipe">
              <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} aria-label="Filter Tipe Permohonan" className={filterSelectCls}>
                <option value="">Semua Tipe</option>
                <option value="PB">PB (Pasang Baru)</option>
                <option value="PD">PD (Ubah Daya)</option>
              </select>
            </FilterField>

            <FilterField label="Daya">
              <select
                value={powerFilter}
                onChange={(e) => {
                  setPowerFilter(e.target.value)
                  try { localStorage.setItem('distriva.pbpd.power', e.target.value) } catch { /* diabaikan */ }
                  setPage(1)
                }}
                aria-label="Filter Daya"
                className={filterSelectCls}
              >
                <option value="3phase">≥ 6.600 VA (3 fasa)</option>
                <option value="all">Semua daya</option>
              </select>
            </FilterField>

            <FilterField label="Status">
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Filter Status" className={filterSelectCls}>
                <option value="">Semua Status</option>
                <option value="DRAFT">Draf</option>
                <option value="SUBMITTED">Diajukan</option>
                <option value="APPROVED">Disetujui</option>
                <option value="PAID">Bayar</option>
                <option value="PK_PRINTED">Cetak PK</option>
                <option value="CONNECTION_IN_PROGRESS">PDL Awal</option>
                <option value="CONNECTION_DONE">Peremajaan</option>
                <option value="COMPLETED">Selesai</option>
                <option value="CANCELLED">Batal</option>
                <option value="REFUNDED">Restitusi</option>
              </select>
            </FilterField>

            {/* UP3 -> ULP: sys admin memilih bebas; role lain hanya unitnya sendiri (UP3: semua ULP di bawahnya) */}
            <FilterField label="UP3">
              <SearchSelect variant="filter"
                ariaLabel="Filter Unit UP3"
                options={up3Options}
                value={up3Value}
                disabled={up3Locked}
                onChange={(v) => { setUp3Filter(v); setUnitFilter(''); setPage(1) }}
                placeholder="Cari UP3…"
              />
            </FilterField>

            <FilterField label="ULP">
              <SearchSelect variant="filter"
                ariaLabel="Filter Unit ULP"
                options={ulpOptions}
                value={ulpValue}
                disabled={ulpLocked}
                onChange={(v) => { setUnitFilter(v); setPage(1) }}
                placeholder="Cari ULP…"
              />
            </FilterField>

            <FilterField label="Bulan & Tahun">
              <div className="flex items-center gap-1">
                <input
                  type="month"
                  value={monthFilter}
                  onChange={(e) => { setMonthFilter(e.target.value); setPage(1) }}
                  aria-label="Filter Bulan dan Tahun"
                  title="Bulan dan tahun pada kolom Tgl. Update EIS"
                  className={filterSelectCls}
                />
                {monthFilter && (
                  <button type="button" onClick={() => { setMonthFilter(''); setPage(1) }} aria-label="Hapus filter bulan" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                    <IconX size={14} />
                  </button>
                )}
              </div>
            </FilterField>
          </div>
        </div>

        {/* Table Content */}
        <div>
          {state.error && <div className="p-5"><Alert kind="error">{state.error}</Alert></div>}
          {state.loading && <div className="p-8"><Spinner /></div>}

          {!state.loading && !state.error && state.rows.length === 0 && (
            <EmptyState
              icon={IconFileText}
              title="Tidak ada permohonan"
              description="Tidak ada permohonan penyambungan (PB/PD) untuk filter yang dipilih. Sinkronisasi EIS memuat pelanggan semua daya dan semua status."

              action={
                (can['applications.create'] || can['applications.import']) ? (
                  <div className="flex items-center justify-center gap-3">
                    {can['applications.create'] && (
                      <button
                        type="button"
                        onClick={() => navigate('/permohonan/baru')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                      >
                        <IconPlus size={14} />
                        <span>Permohonan Baru</span>
                      </button>
                    )}
                  </div>
                ) : null
              }
            />
          )}

          {/* Selected Action Bar */}
          {selectedAppIds.length > 0 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                {selectedAppIds.length} permohonan dipilih
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAppIds([])}
                  className="text-xs text-slate-500 hover:underline px-2 cursor-pointer"
                >
                  Batalkan Pilihan
                </button>
                <button
                  type="button"
                  onClick={() => setCreateProposalModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                >
                  <IconPlus size={14} />
                  <span>Buat usulan dari yang dipilih</span>
                </button>
              </div>
            </div>
          )}

          {!state.loading && state.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                  <tr>
                    <th className="w-10 py-3.5 pl-4 pr-2">
                      <span className="sr-only">Pilih</span>
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      PELANGGAN
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      UNIT KERJA & ALAMAT
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      TARIF & DAYA BARU
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      SELISIH DAYA
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      STATUS
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      LAMA LAYANAN
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      SURVEI
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      SUMBER / USULAN
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      TGL. UPDATE EIS
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.rows.map((app) => {
                    const missingFields = getMissingFields(app)
                    const isEligible = ['APPROVED', 'PAID', 'PK_PRINTED'].includes(app.status) && !app.proposal_number
                    const disabledReason = ['DRAFT', 'SUBMITTED'].includes(app.status)
                      ? 'Survei dan usulan dapat dimulai setelah No. Agenda terbit.'
                      : app.proposal_number
                      ? `Sudah menjadi bagian dari usulan ${app.proposal_number}`
                      : !isEligible
                      ? 'Survei dan usulan dapat dimulai setelah No. Agenda terbit.'
                      : ''

                    return (
                    <tr key={app.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Selection Checkbox */}
                      <td className="py-3.5 pl-4 pr-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Pilih permohonan ${app.application_number}`}
                          checked={selectedAppIds.includes(app.id)}
                          disabled={!isEligible}
                          title={disabledReason || 'Pilih permohonan untuk usulan'}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAppIds((prev) => [...prev, app.id])
                            } else {
                              setSelectedAppIds((prev) => prev.filter((id) => id !== app.id))
                            }
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Pelanggan: nama, tipe, dan penanda data yang belum lengkap (nomor permohonan ada di pratinjau; di sini hanya untuk pembaca layar) */}
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {app.customer?.name || '-'}
                        </div>
                        <span className="sr-only">{app.application_number}</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`inline-block rounded px-1.5 py-0.2 text-[10px] font-bold ${
                            app.application_type === 'PB'
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200/60'
                              : 'bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200/60'
                          }`}>
                            {app.application_type}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {app.transaction_type}
                          </span>
                        </div>

                        {/* Missing Chips */}
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {missingFields.missingAgenda && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                              <span>Belum ada No. Agenda</span>
                              {can['applications.update'] && (
                                <button
                                  type="button"
                                  onClick={() => setCompleteTarget({ app, field: 'AGENDA' })}
                                  className="font-bold underline hover:text-amber-950 dark:hover:text-amber-100 cursor-pointer"
                                >
                                  Lengkapi
                                </button>
                              )}
                            </span>
                          )}
                          {missingFields.missingRegister && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              <span>Belum ada No. Register</span>
                              {can['applications.update'] && (
                                <button
                                  type="button"
                                  onClick={() => setCompleteTarget({ app, field: 'PAYMENT_REGISTER' })}
                                  className="font-bold underline hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                                >
                                  Lengkapi
                                </button>
                              )}
                            </span>
                          )}
                          {missingFields.missingIdpel && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800/80">
                              <span>Belum ada IDPEL</span>
                              {can['applications.update'] && (
                                <button
                                  type="button"
                                  onClick={() => setCompleteTarget({ app, field: 'IDPEL' })}
                                  className="font-bold underline hover:text-purple-900 dark:hover:text-purple-100 cursor-pointer"
                                >
                                  Lengkapi
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Unit & Address */}
                      <td className="py-3.5 px-6 max-w-xs">
                        <div className="font-medium text-slate-700 dark:text-slate-300 text-xs">
                          {app.unit?.code} - {app.unit?.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5" title={app.service_address}>
                          {app.service_address || '-'}
                        </div>
                      </td>

                      {/* Tarif & Daya Baru */}
                      <td className="py-3.5 px-6">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {formatTariffPower(
                            app.new_tariff_code,
                            app.new_power_value ?? app.new_power?.value,
                            app.new_power_unit ?? app.new_power?.unit
                          )}
                        </div>
                      </td>

                      {/* Selisih Daya */}
                      <td className="py-3.5 px-6">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {app.delta_power_kva !== null && app.delta_power_kva !== undefined
                            ? `Δ ${app.delta_power_kva} kVA`
                            : '-'}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-6">
                        <StatusBadge status={app.status} />
                        {app.ready_to_install && (
                          <div className="mt-1">
                            <span
                              data-testid="ready-to-install-badge"
                              title="Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 cursor-help"
                            >
                              Siap pasang
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Lama Layanan */}
                      <td className="py-3.5 px-6">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {app.service_days !== null && app.service_days !== undefined
                            ? `${app.service_days} hari kerja`
                            : '-'}
                        </div>
                      </td>

                      {/* Survei */}
                      <td className="py-3.5 px-6">
                        {app.survey_number ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {app.survey_number}
                            </span>
                            {app.survey_status && (
                              <span className="text-[11px] text-slate-600 dark:text-slate-400">
                                {app.survey_status}
                              </span>
                            )}
                            {app.survey_outcome === 'NO_EXTENSION' && (
                              <span
                                data-testid="survey-outcome-badge"
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200/60 w-fit"
                              >
                                Tanpa perluasan
                              </span>
                            )}
                            {app.survey_outcome === 'EXTENSION' && (
                              <span
                                data-testid="survey-outcome-badge"
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60 w-fit"
                              >
                                Perlu perluasan
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>

                      {/* Source & Proposal */}
                      <td className="py-3.5 px-6">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-block rounded px-1.5 py-0.2 text-[10px] font-bold w-fit ${
                            app.source_type === 'MANUAL'
                              ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/60'
                          }`}>
                            {app.source_type || 'MANUAL'}
                          </span>
                          {app.proposal_number ? (
                            <Link
                              to={`/usulan/${app.proposal_id || app.proposal_number}`}
                              className="font-mono text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline inline-flex flex-col"
                              title={`Bagian dari usulan ${app.proposal_number}`}
                            >
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-sans font-normal">Bagian dari usulan </span>
                              <span>{app.proposal_number}</span>
                            </Link>
                          ) : (
                            <span className="text-[11px] text-slate-400">-</span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-3.5 px-6 text-xs text-slate-500 dark:text-slate-400">
                        {app.eis_updated_at ? (
                          <div title="Tanggal pembaruan status permohonan di EIS">{`${app.eis_updated_at.slice(8, 10)}/${app.eis_updated_at.slice(5, 7)}/${app.eis_updated_at.slice(0, 4)}`}</div>
                        ) : (
                          <>
                            <div title="Tanggal data masuk ke DISTRIVA (belum ada tanggal update EIS)">{app.created_at ? new Date(app.created_at).toLocaleDateString('id-ID') : '-'}</div>
                            <div className="text-[10px] text-slate-400">
                              {app.created_at ? new Date(app.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-6 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setDetailTarget(app)}
                            aria-label="Lihat Detail Permohonan"
                            title="Lihat Detail Permohonan"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                          >
                            <IconEye size={13} />
                            <span>Pratinjau</span>
                          </button>

                          {app.status === 'DRAFT' && can['applications.submit'] && (
                            <button
                              type="button"
                              onClick={() => handleSubmitApplication(app)}
                              disabled={submittingId === app.id}
                              aria-label="Ajukan Permohonan"
                              title="Ajukan Permohonan ke Survei"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <IconCheckCircle size={13} />
                              <span>Ajukan ke Survei</span>
                            </button>
                          )}

                          {app.status === 'DRAFT' && can['applications.cancel'] && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(app)}
                              aria-label="Batalkan Permohonan"
                              title="Batalkan Permohonan"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                            >
                              <IconTrash size={13} />
                              <span>Batalkan</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Standardized Table Pagination Footer */}
          {state.meta && (
            <TableFooter
              itemCount={state.rows.length}
              total={state.meta.total}
              entityLabel="permohonan"
              meta={state.meta}
              page={page}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(newPerPage) => {
                setPerPage(newPerPage)
                setPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          )}
        </div>
      </div>
      </>
      )}

      {/* Drawer: Formulir Permohonan Baru */}
      {/* Laci: pratinjau Permohonan (baca-saja); pekerjaan yang mengubah data ada di halaman /permohonan/:id */}
      {detailTarget && (
        <ApplicationDetailDrawer
          preview
          applicationId={detailTarget.id}
          onSelectApplication={(id) => setDetailTarget({ id })}
          onClose={() => {
            setDetailTarget(null)
            const newParams = new URLSearchParams(searchParams)
            newParams.delete('app_id')
            newParams.delete('open')
            newParams.delete('drawer_tab')
            setSearchParams(newParams, { replace: true })
          }}
        />
      )}

      {/* Modal: Alasan Pembatalan Permohonan (Audit Trail) */}
      {cancelTarget && (
        <ReasonDialog
          title={`Batalkan Permohonan ${cancelTarget.application_number}`}
          description="Alasan pembatalan wajib dicatat dalam riwayat audit trail (docs/54, docs/62)."
          confirmLabel="Konfirmasi Pembatalan"
          onConfirm={handleConfirmCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* Modal: Lengkapi Data (IDPEL, No. Agenda, No. Register) */}
      {completeTarget && (
        <CompleteDataModal
          target={completeTarget}
          onClose={() => setCompleteTarget(null)}
          onSuccess={() => {
            setCompleteTarget(null)
            loadApplications()
          }}
        />
      )}

      {/* Modal: Buat Usulan Perluasan dari baris terpilih */}
      {createProposalModalOpen && (
        <ProposalSelectableModal
          open={createProposalModalOpen}
          initialSelectedItems={state.rows
            .filter((r) => selectedAppIds.includes(r.id))
            .map((r) => ({
              id: r.id,
              application_number: r.application_number,
              customer_name: r.customer?.name,
              new_tariff_code: r.new_tariff_code,
              new_power_value: r.new_power_value ?? r.new_power?.value ?? (r.delta_power_kva ? r.delta_power_kva * 1000 : null),
              new_power_unit: r.new_power_unit ?? r.new_power?.unit ?? 'VA',
              service_address: r.service_address,
              ulp_code: r.unit?.code,
              ulp_name: r.unit?.name,
              idpel: Array.isArray(r.customer?.idpel) ? r.customer.idpel[0]?.value : r.customer?.idpel,
            }))}
          onClose={() => setCreateProposalModalOpen(false)}
          onSuccess={() => {
            setCreateProposalModalOpen(false)
            setSelectedAppIds([])
            loadApplications()
          }}
        />
      )}
    </div>
  )
}

/**
 * Modal Lengkapi Data Singkat: No. Agenda, No. Register, IDPEL
 */
export function CompleteDataModal({ target, onClose, onSuccess }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { notify } = useNotifications()

  if (!target) return null

  const { app, field } = target

  const labels = {
    AGENDA: {
      title: 'Lengkapi Nomor Agenda',
      label: 'Nomor Agenda',
      placeholder: 'Contoh: 5145320261106001',
      help: 'Pengisian Nomor Agenda akan otomatis mengubah status permohonan menjadi Disetujui (Approved).',
    },
    PAYMENT_REGISTER: {
      title: 'Lengkapi No. Register',
      label: 'No. Register',
      placeholder: 'Contoh: 5145320261106099',
      help: 'No. Register yang diterbitkan oleh sistem AP2T.',
    },
    IDPEL: {
      title: 'Lengkapi IDPEL',
      label: 'ID Pelanggan (IDPEL)',
      placeholder: 'Contoh: 514500123456 (12 digit)',
      help: 'IDPEL dapat diisi sekali dan tidak dapat diganti setelah tersimpan.',
    },
  }

  const currentLabel = labels[field] || labels.AGENDA

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setLoading(true)
    setError('')
    try {
      if (field === 'AGENDA' || field === 'PAYMENT_REGISTER') {
        await applicationApi.addReference(app.id, {
          reference_type: field,
          reference_number: trimmed,
        })
      } else if (field === 'IDPEL') {
        await applicationApi.update(app.id, {
          customer: { idpel: trimmed },
        })
      }
      notify({
        type: 'success',
        title: `${currentLabel.label} Berhasil Disimpan`,
        desc: `Data referensi permohonan ${app.application_number} telah diperbarui.`,
        tag: 'PB/PD',
      })
      onSuccess?.()
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal menyimpan data.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {currentLabel.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
          >
            <IconX size={18} />
          </button>
        </div>

        {error && (
          <Alert kind="error">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {currentLabel.label} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={currentLabel.placeholder}
              required
              className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
            {currentLabel.help && (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {currentLabel.help}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={loading} disabled={!value.trim()}>
              Simpan
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Drawer: Formulir Pendaftaran Permohonan PB/PD Baru (docs/24, docs/57 §3c, docs/62)
 */
export function ApplicationCreateDrawer({ open, asPage = false, createUnits = [], canImport = false, onSwitchToImport, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  // Form State
  const [unitId, setUnitId] = useState(createUnits[0]?.id || '')
  const [appType, setAppType] = useState('PB') // 'PB' | 'PD'
  const [txType, setTxType] = useState('PASANG BARU')

  // Customer State
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerIdpel, setCustomerIdpel] = useState('')

  // Service Location
  const [serviceAddress, setServiceAddress] = useState('')

  // Power & Tariff
  const [newTariff, setNewTariff] = useState('R1')
  const [newPowerVal, setNewPowerVal] = useState('900')
  const [newPowerUnit, setNewPowerUnit] = useState('VA')

  // Old Power & Tariff (for PD)
  const [oldTariff, setOldTariff] = useState('')
  const [oldPowerVal, setOldPowerVal] = useState('')
  const [oldPowerUnit, setOldPowerUnit] = useState('VA')

  // Convert power to kVA automatically
  const toKva = (val, unit) => {
    if (!val || isNaN(val)) return null
    const num = Number(val)
    return unit === 'kVA' ? num : num / 1000
  }
  const newPowerKva = toKva(newPowerVal, newPowerUnit)
  const oldPowerKva = toKva(oldPowerVal, oldPowerUnit)

  // Additional technical flags & TMP
  const [sarPackage, setSarPackage] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [serviceCriteria, setServiceCriteria] = useState('05 Hari')
  const [requiresDrawing, setRequiresDrawing] = useState(false)
  const [requiresFeasibility, setRequiresFeasibility] = useState(false)
  const [requiresExtension, setRequiresExtension] = useState(false)

  // Switch default transaction type on type change
  const handleTypeChange = (type) => {
    setAppType(type)
    setTxType(type === 'PB' ? 'PASANG BARU' : 'PERUBAHAN DAYA')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setFieldErrors({})

    const payload = {
      organizational_unit_id: unitId,
      application_type: appType,
      transaction_type: txType,
      service_address: serviceAddress || undefined,
      new_tariff_code: newTariff || undefined,
      new_power_value: newPowerVal ? Number(newPowerVal) : undefined,
      new_power_unit: newPowerVal ? newPowerUnit : undefined,
      customer: {
        name: customerName,
        phone: customerPhone || undefined,
        email: customerEmail || undefined,
        idpel: customerIdpel || undefined,
      },
      sar_package: sarPackage || undefined,
      total_cost: totalCost ? Number(totalCost) : undefined,
      service_criteria: serviceCriteria || undefined,
      requires_drawing: requiresDrawing,
      requires_feasibility_study: requiresFeasibility,
      requires_network_extension: requiresExtension,
    }

    if (appType === 'PD') {
      if (oldTariff) payload.old_tariff_code = oldTariff
      if (oldPowerVal) {
        payload.old_power_value = Number(oldPowerVal)
        payload.old_power_unit = oldPowerUnit
      }
    }

    try {
      const res = await applicationApi.create(payload)
      onSuccess(res.data)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan permohonan.')
      if (err.errors) {
        setFieldErrors(err.errors)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      title="Pendaftaran Permohonan PB/PD"
      subtitle="Formulir agenda penyambungan pelanggan baru atau perubahan daya listrik."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={loading}>
            Simpan sebagai Draf
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {canImport && (
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs transition cursor-pointer"
            >
              <IconPlus size={14} />
              <span>Tambah Manual</span>
            </button>
            <button
              type="button"
              onClick={onSwitchToImport}
              className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition cursor-pointer"
            >
              <IconUpload size={14} />
              <span>Via Upload (Impor EIS)</span>
            </button>
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}

        {/* 1. Unit Organisasi & Tipe Permohonan */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            1. Unit Kerja & Jenis Permohonan
          </h4>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Unit Layanan Pelanggan (ULP) <span className="text-rose-500">*</span>
            </label>
            <UnitPicker
              permission="applications.create"
              level="ulp"
              required
              value={unitId}
              onChange={setUnitId}
              units={createUnits}
              up3AriaLabel="UP3"
              unitAriaLabel="Unit ULP"
            />
            {fieldErrors.organizational_unit_id && (
              <p className="mt-1 text-xs text-rose-500">{fieldErrors.organizational_unit_id[0]}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Tipe Layanan <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleTypeChange('PB')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
                  appType === 'PB'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span>⚡ Pasang Baru (PB)</span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange('PD')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
                  appType === 'PD'
                    ? 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span>🔄 Perubahan Daya (PD)</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Nama Jenis Transaksi
            </label>
            <input
              type="text"
              value={txType}
              onChange={(e) => setTxType(e.target.value)}
              placeholder="Contoh: PASANG BARU, TAMBAH DAYA, TURUN DAYA"
              className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </div>

        {/* 2. Data Pelanggan */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            2. Data Pelanggan & Kontak
          </h4>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Nama Lengkap Pelanggan <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Masukkan nama pemohon / nama pelanggan"
              className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
            {fieldErrors['customer.name'] && (
              <p className="mt-1 text-xs text-rose-500">{fieldErrors['customer.name'][0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Nomor Telepon / WhatsApp
              </label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="081234567890"
                className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
              <p className="mt-1 text-[11px] text-slate-400">Wajib diisi sebelum diajukan ke survei.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Email Pelanggan
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="nama@email.com"
                className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              ID Pelanggan (IDPEL) {appType === 'PD' ? <span className="text-amber-500">(Dianjurkan untuk PD)</span> : '(Jika ada)'}
            </label>
            <input
              type="text"
              value={customerIdpel}
              onChange={(e) => setCustomerIdpel(e.target.value)}
              placeholder="Contoh: 514500123456 (12 digit)"
              className="block w-full px-3.5 py-2 text-xs sm:text-sm font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </div>

        {/* 3. Lokasi Layanan */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            3. Alamat Lokasi Penyambungan
          </h4>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Alamat Lengkap Persil / Lokasi Layanan
            </label>
            <textarea
              rows={2}
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
              placeholder="Nama jalan, nomor rumah, RT/RW, desa/kelurahan, kecamatan…"
              className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </div>

        {/* 4. Daya & Tarif */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            4. Spesifikasi Daya & Tarif Listrik
          </h4>

          {appType === 'PD' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-3 border border-slate-200/60 dark:border-slate-700/60">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Daya & Tarif Lama:</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Tarif Lama</label>
                  <input
                    type="text"
                    value={oldTariff}
                    onChange={(e) => setOldTariff(e.target.value)}
                    placeholder="Contoh: R1"
                    className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Nilai Daya Lama</label>
                  <input
                    type="number"
                    value={oldPowerVal}
                    onChange={(e) => setOldPowerVal(e.target.value)}
                    placeholder="450"
                    className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Satuan</label>
                  <select
                    value={oldPowerUnit}
                    onChange={(e) => setOldPowerUnit(e.target.value)}
                    className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="VA">VA</option>
                    <option value="kVA">kVA</option>
                  </select>
                </div>
              </div>
              {oldPowerKva !== null && (
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                  Daya lama setara: <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{oldPowerKva.toLocaleString('id-ID', { maximumFractionDigits: 3 })} kVA</span>
                </div>
              )}
            </div>
          )}

          <div className="p-3.5 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl space-y-3 border border-emerald-100 dark:border-emerald-900/40">
            <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
              {appType === 'PD' ? 'Daya & Tarif Baru yang Diminta:' : 'Daya & Tarif Pasang Baru:'}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Tarif Baru <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTariff}
                  onChange={(e) => setNewTariff(e.target.value)}
                  placeholder="R1, R1M, B1, dll"
                  className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Nilai Daya Baru <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  value={newPowerVal}
                  onChange={(e) => setNewPowerVal(e.target.value)}
                  placeholder="900"
                  className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Satuan</label>
                <select
                  value={newPowerUnit}
                  onChange={(e) => setNewPowerUnit(e.target.value)}
                  className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="VA">VA</option>
                  <option value="kVA">kVA</option>
                </select>
              </div>
            </div>

            {/* Live Reactive Daya in kVA */}
            {newPowerKva !== null && (
              <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="inline-flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-medium">
                  <span>⚡ Daya otomatis ditampilkan:</span>
                  <span className="font-mono font-bold bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700">
                    {newPowerKva.toLocaleString('id-ID', { maximumFractionDigits: 3 })} kVA
                  </span>
                </div>

                {appType === 'PD' && oldPowerKva !== null && (
                  <div className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                    <span>Delta Daya:</span>
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                      {newPowerKva - oldPowerKva > 0 ? '+' : ''}
                      {(newPowerKva - oldPowerKva).toLocaleString('id-ID', { maximumFractionDigits: 3 })} kVA
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 5. Parameter Tambahan & Kebutuhan Teknis */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            5. Parameter Teknis & TMP
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kriteria TMP / Durasi Layanan
              </label>
              <input
                type="text"
                value={serviceCriteria}
                onChange={(e) => setServiceCriteria(e.target.value)}
                placeholder="05 Hari, 15 Hari"
                className="block w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Estimasi Total Biaya (Rp)
              </label>
              <input
                type="number"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                placeholder="0"
                className="block w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresDrawing}
                onChange={(e) => setRequiresDrawing(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Memerlukan Gambar / Desain Teknis (Drawing Jaringan)</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresFeasibility}
                onChange={(e) => setRequiresFeasibility(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Memerlukan Kajian Kelayakan Finansial (KKF & RAB)</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresExtension}
                onChange={(e) => setRequiresExtension(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Memerlukan Perluasan Jaringan Distribusi (JTM/JTR/Gardu Baru)</span>
            </label>
          </div>
        </div>
      </form>
    </PanelShell>
  )
}

/**
 * Drawer: Detail Permohonan & Audit Trail (docs/24, docs/57 §3c, docs/62)
 */
export function ApplicationDetailDrawer({
  applicationId,
  preview = false,
  asPage = false,
  initialTab = 'detail',
  canSubmit,
  canCancel,
  canAddRef,
  canExecuteSurvey,
  canIssueProposal,
  canViewSurvey,
  canAssignDrawing,
  canExecuteDrawing,
  canViewDrawing,
  canRunKkf,
  canViewKkf,
  canViewKko,
  canRecordKko,
  canDecideKko,
  canManageMaterials,
  canManagePoles,
  canManageAllocations,
  canViewAllocations,
  canWoView,
  canWoCreate,
  canWoIssue,
  canWoSubmitProgress,
  canWoVerifyProgress,
  canWoComplete,
  onSubmit,
  onSelectApplication,
  memberSwitcher,          // { members: [{ application_id, customer_name, application_number, status }], onSelect(id) }: survei kolektif, tiap pelanggan anggota dibuka di drawer ini
  onCancel,
  onClose,
  onReload,
  onCompleteData,
}) {
  const { notify } = useNotifications()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [app, setApp] = useState(null)
  const [error, setError] = useState('')

  const missingFields = getMissingFields(app)
  const canStartSurvey = Boolean(app && !['DRAFT', 'SUBMITTED'].includes(app.status) && missingFields.hasAgenda)

  // Usulan yang memuat permohonan ini (docs/62 §37, docs/82 §11): datang dari detail permohonan. `issued` false = masih permintaan survei kolektif (nomor usulan belum terbit).
  const proposalInfo = useMemo(() => {
    const p = app?.proposal
    if (!p) return null
    return {
      id: p.id,
      proposalNumber: p.proposal_number,
      issued: Boolean(p.issued),
      membersCount: p.members_count,
      isRepresentative: Boolean(p.is_representative),
      representativeApplicationId: p.representative_application_id,
    }
  }, [app])

  const isNonRepresentative = Boolean(proposalInfo && !proposalInfo.isRepresentative)

  // Alur teknis (gambar usulan, dokumen, KKF, alokasi, SPK) terbuka setelah USULAN dibuat (16 Nov 2026): survei berhenti di Manager ULP; bila hasilnya perlu perluasan, Teknik ULP membuat usulan.
  // Sebelum itu, dan sesudah survei tanpa perluasan, drawer hanya memuat Ringkasan dan Survei & Pengukuran (KKO bagian dari survei).
  const technicalUnlocked = Boolean(app?.proposal?.issued)
  const needsProposal = Boolean(app?.survey?.status === 'ACCEPTED' && app?.survey?.outcome === 'EXTENSION' && !app?.proposal?.issued && !isNonRepresentative)
  const [issuingProposal, setIssuingProposal] = useState(false)
  const issueProposal = async () => {
    setIssuingProposal(true)
    try {
      const res = await proposalsApi.issue(applicationId)
      notify({ type: 'success', title: 'Usulan Dibuat', desc: `Usulan ${res?.data?.proposal_number || ''} berhasil dibuat; alur teknis (gambar usulan, KKF, dst.) terbuka.`, tag: 'Usulan' })
      loadDetail()
      onReload?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Membuat Usulan', desc: err.message || 'Terjadi kesalahan.', tag: 'Usulan' })
    } finally {
      setIssuingProposal(false)
    }
  }

  // Tab Navigation: 'detail' | 'surveys' | 'drawings' | 'documents'
  const [activeTab, setActiveTab] = useState(preview ? 'detail' : initialTab || 'detail')

  useEffect(() => {
    if (initialTab && initialTab !== 'detail') {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Survey Sub-state
  const [surveys, setSurveys] = useState([])
  const [loadingSurveys, setLoadingSurveys] = useState(false)
  const [selectedSurveyId, setSelectedSurveyId] = useState(null)
  const [startingSurvey, setStartingSurvey] = useState(false)

  // Drawing Sub-state
  const [drawingPkg, setDrawingPkg] = useState(null)
  const [loadingDrawing, setLoadingDrawing] = useState(false)
  const [openingDrawing, setOpeningDrawing] = useState(false)

  // Create Drawing Modal state
  const [createDrawingOpen, setCreateDrawingOpen] = useState(false)
  const [availableAuthors, setAvailableAuthors] = useState([])
  const [loadingAuthors, setLoadingAuthors] = useState(false)
  const [createAuthorId, setCreateAuthorId] = useState('')
  const [creatingDrawing, setCreatingDrawing] = useState(false)
  const [createDrawingError, setCreateDrawingError] = useState('')

  // Documents Sub-state
  const [documents, setDocuments] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  // External reference modal/form
  const [refType, setRefType] = useState('AGENDA')
  const [refNumber, setRefNumber] = useState('')
  const [addingRef, setAddingRef] = useState(false)
  const [refError, setRefError] = useState('')

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await applicationApi.get(applicationId)
      setApp(res.data)
    } catch (err) {
      setError(err.message || 'Gagal memuat detail permohonan.')
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  const loadSurveys = useCallback(async () => {
    if (!applicationId) return
    setLoadingSurveys(true)
    try {
      const res = await surveyApi.listForApplication(applicationId)
      setSurveys(res.data || [])
    } catch {
      setSurveys([])
    } finally {
      setLoadingSurveys(false)
    }
  }, [applicationId])

  const loadDocuments = useCallback(async () => {
    if (!applicationId) return
    setLoadingDocs(true)
    try {
      const res = await documentApi.listForApplication(applicationId)
      setDocuments(res.data || [])
    } catch {
      setDocuments([])
    } finally {
      setLoadingDocs(false)
    }
  }, [applicationId])

  const loadDrawingPkg = useCallback(async () => {
    if (!applicationId) return
    setLoadingDrawing(true)
    try {
      const res = await drawingApi.forApplication(applicationId)
      setDrawingPkg(res.data)
    } catch {
      setDrawingPkg(null)
    } finally {
      setLoadingDrawing(false)
    }
  }, [applicationId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  useEffect(() => {
    if (activeTab === 'surveys') {
      loadSurveys()
    } else if (activeTab === 'drawings') {
      loadDrawingPkg()
    } else if (activeTab === 'documents') {
      loadDocuments()
    }
  }, [activeTab, loadSurveys, loadDrawingPkg, loadDocuments])

  // Sebuah tab teknis tidak boleh tetap aktif bila alur teknis belum terbuka (mis. setelah memuat ulang atau pindah permohonan).
  useEffect(() => {
    if (app && !technicalUnlocked && ['drawings', 'documents', 'kkf', 'allocations', 'work-orders'].includes(activeTab)) setActiveTab('detail')
  }, [app, technicalUnlocked, activeTab])

  const handleStartSurveySelf = async () => {
    if (!applicationId || startingSurvey) return
    setStartingSurvey(true)
    try {
      const res = await surveyApi.create(applicationId, {})
      notify({
        type: 'success',
        title: 'Survei Dimulai',
        desc: `Survei lapangan #${res.data?.survey_number || ''} berhasil dimulai.`,
        tag: 'Survei',
      })
      loadSurveys()
      if (res.data?.id) setSelectedSurveyId(res.data.id)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memulai Survei',
        desc: err.message || 'Terjadi kesalahan.',
        tag: 'Survei',
      })
    } finally {
      setStartingSurvey(false)
    }
  }

  const handleOpenDrawingSelf = async () => {
    if (!applicationId || openingDrawing) return
    setOpeningDrawing(true)
    try {
      const res = await drawingApi.create(applicationId, {})
      notify({
        type: 'success',
        title: 'Paket Gambar Berhasil Dibuka',
        desc: `Paket gambar teknik #${res.data?.drawing_number || ''} berhasil dibuka.`,
        tag: 'Gambar Teknik',
      })
      loadDrawingPkg()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Membuka Paket Gambar',
        desc: err.message || 'Terjadi kesalahan.',
        tag: 'Gambar Teknik',
      })
    } finally {
      setOpeningDrawing(false)
    }
  }

  const handleOpenCreateDrawing = async () => {
    setCreateDrawingOpen(true)
    setCreateDrawingError('')
    setLoadingAuthors(true)
    try {
      const res = await drawingApi.authors(applicationId)
      setAvailableAuthors(res.data || [])
      setCreateAuthorId(res.data?.[0]?.id || '')
    } catch (err) {
      setCreateDrawingError(err.message || 'Gagal memuat daftar penyusun gambar.')
    } finally {
      setLoadingAuthors(false)
    }
  }

  const handleConfirmCreateDrawing = async (e) => {
    e.preventDefault()
    if (!createAuthorId) return
    setCreatingDrawing(true)
    setCreateDrawingError('')
    try {
      const res = await drawingApi.create(applicationId, {
        assigned_to: createAuthorId,
      })
      notify({
        type: 'success',
        title: 'Paket Gambar Berhasil Dibuat',
        desc: `Paket gambar teknik #${res.data?.drawing_number || ''} berhasil dibuat dan ditugaskan.`,
        tag: 'Gambar Teknik',
      })
      setCreateDrawingOpen(false)
      loadDrawingPkg()
    } catch (err) {
      setCreateDrawingError(err.message || 'Gagal membuat paket gambar.')
    } finally {
      setCreatingDrawing(false)
    }
  }

  const handleAddExternalRef = async (e) => {
    e.preventDefault()
    if (!refNumber.trim()) return
    setAddingRef(true)
    setRefError('')
    try {
      await applicationApi.addReference(applicationId, {
        reference_type: refType,
        reference_number: refNumber.trim(),
      })
      notify({
        type: 'success',
        title: refType === 'AGENDA' ? 'No. Agenda Disimpan & Permohonan Disetujui' : 'Referensi Eksternal Ditambahkan',
        desc: refType === 'AGENDA'
          ? `Nomor Agenda ${refNumber} berhasil disimpan. Status permohonan kini otomatis Disetujui (Approved).`
          : `Nomor ${refType} ${refNumber} berhasil dikaitkan ke permohonan.`,
        tag: 'PB/PD',
      })
      setRefNumber('')
      loadDetail()
      onReload()
    } catch (err) {
      setRefError(err.message || 'Gagal menambahkan referensi eksternal.')
    } finally {
      setAddingRef(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={Boolean(applicationId)}
      title={app ? `Permohonan ${app.application_number}` : 'Detail Permohonan'}
      subtitle={app ? `${app.application_type} · ${app.transaction_type}` : 'Memuat data...'}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 w-full">
          <div>
            {['DRAFT', 'SUBMITTED'].includes(app?.status) && canCancel && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => onCancel(app)}
              >
                Batalkan Permohonan
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {asPage ? 'Kembali' : 'Tutup'}
            </Button>
            {preview && app && (
              <Button variant="primary" size="sm" onClick={() => navigate(`/permohonan/${app.id}`)}>
                Buka halaman lengkap
              </Button>
            )}
            {app?.status === 'DRAFT' && canSubmit && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSubmit(app)}
              >
                Ajukan ke Survei
              </Button>
            )}
          </div>
        </div>
      }
    >
      {loading && <div className="p-8 text-center"><Spinner /></div>}
      {error && <Alert kind="error">{error}</Alert>}

      {app && !loading && (
        <div className="space-y-6">
          {/* Navigation Tabs (pratinjau hanya memuat ringkasan) */}
          {!preview && (
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('detail')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'detail'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Ringkasan Permohonan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('surveys')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'surveys'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>Survei & Pengukuran</span>
              {surveys.length > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'surveys' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                  {surveys.length}
                </span>
              )}
            </button>
            {technicalUnlocked && (
            <button
              type="button"
              onClick={() => setActiveTab('drawings')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'drawings'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>Gambar Teknik</span>
              {drawingPkg && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'drawings' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                  ✓
                </span>
              )}
            </button>
            )}
            {technicalUnlocked && (
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'documents'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>Dokumen & Bukti</span>
              {documents.length > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'documents' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                  {documents.length}
                </span>
              )}
            </button>
            )}
            {canViewKkf && technicalUnlocked && (
              <button
                type="button"
                onClick={() => setActiveTab('kkf')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'kkf'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>Kajian Finansial (KKF)</span>
              </button>
            )}
            {canViewKko && (
              <button
                type="button"
                onClick={() => setActiveTab('kko')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'kko'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>Kajian Teknis (KKO)</span>
              </button>
            )}
            {canViewAllocations && technicalUnlocked && (
              <button
                type="button"
                onClick={() => setActiveTab('allocations')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'allocations'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>Alokasi Material</span>
              </button>
            )}
            {canWoView && technicalUnlocked && (
              <button
                type="button"
                onClick={() => setActiveTab('work-orders')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'work-orders'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span>SPK / Work Order</span>
              </button>
            )}
          </div>
          )}

          {/* Survei disetujui dengan hasil perlu perluasan: Teknik ULP membuat usulan */}
          {needsProposal && (
            <div data-testid="needs-proposal-banner" className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="font-bold text-xs block">Survei disetujui Manager ULP: memerlukan perluasan jaringan</span>
                <p className="text-[11px] mt-0.5 leading-relaxed">
                  Langkah berikutnya: Teknik ULP membuat usulan. Gambar SLD / CAD, KKF, alokasi, dan SPK dikerjakan pada usulan itu.
                </p>
              </div>
              {canIssueProposal && (
                <Button size="sm" variant="primary" onClick={() => navigate(`/permohonan?tab=survei&cari=${encodeURIComponent(app?.application_number || '')}`)}>
                  Buat Usulan di Usulan Survei →
                </Button>
              )}
            </div>
          )}

          {/* Survei kolektif: pindah antar pelanggan anggota tanpa menutup drawer */}
          {memberSwitcher?.members?.length > 1 && (
            <div role="tablist" aria-label="Pelanggan dalam survei kolektif" className="flex gap-1.5 overflow-x-auto pb-1">
              {memberSwitcher.members.map((m) => {
                const active = m.application_id === applicationId
                return (
                  <button
                    key={m.application_id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => !active && memberSwitcher.onSelect(m.application_id)}
                    className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-xs transition cursor-pointer ${
                      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-300'
                    }`}
                  >
                    <span className="block font-semibold max-w-48 truncate">{m.customer_name}</span>
                    <span className={`block font-mono text-[10px] ${active ? 'text-blue-100' : 'text-slate-400'}`}>{m.application_number}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Proposal Banner (Representative or Member) */}
          {proposalInfo && (
            <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 flex-wrap ${
              proposalInfo.isRepresentative
                ? 'border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
                : 'border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100'
            }`}>
              <div className="flex items-center gap-2.5">
                <span className={`p-1.5 rounded-lg shrink-0 ${proposalInfo.isRepresentative ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'}`}>
                  {proposalInfo.isRepresentative ? <IconUsers size={16} /> : <IconAlertCircle size={16} />}
                </span>
                <div>
                  <span className="font-bold text-xs block">
                    {proposalInfo.issued ? `Usulan ${proposalInfo.proposalNumber}` : 'Survei kolektif'}: {proposalInfo.membersCount} pelanggan
                    {proposalInfo.isRepresentative ? ' (Pelanggan Utama)' : ' (Anggota Non-Perwakilan)'}
                  </span>
                  <p className="text-[11px] mt-0.5 leading-relaxed">
                    {!proposalInfo.issued
                      ? proposalInfo.isRepresentative
                        ? 'Permohonan ini mewakili survei kolektif. Nomor usulan terbit bila hasil survei memerlukan perluasan jaringan; bila tidak, seluruh pelanggan langsung siap pasang.'
                        : 'Pelanggan ini ikut survei kolektif yang dikerjakan lewat pelanggan utama. Nomor usulan terbit bila hasil survei memerlukan perluasan jaringan.'
                      : proposalInfo.isRepresentative
                        ? 'Permohonan ini bertindak sebagai Pelanggan Utama (Perwakilan). Seluruh survei, gambar, MTO, RAB, alokasi, SPK, dan KKF mewakili kelompok usulan ini.'
                        : `Pelanggan ini bagian dari usulan ${proposalInfo.proposalNumber}; survey, gambar, MTO, RAB, WO dan BASTP dikerjakan lewat pelanggan utama usulan.`}
                  </p>
                </div>
              </div>

              {proposalInfo.isRepresentative ? (
                proposalInfo.issued && <Link
                  to={`/usulan/${proposalInfo.id}`}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 hover:bg-blue-50 transition inline-flex items-center gap-1 shadow-2xs"
                >
                  <span>Buka Usulan</span>
                  <IconArrowRight size={12} />
                </Link>
              ) : (
                proposalInfo.representativeApplicationId && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectApplication) {
                        onSelectApplication(proposalInfo.representativeApplicationId)
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                  >
                    <span>Buka Pelanggan Utama</span>
                    <IconArrowRight size={12} />
                  </button>
                )
              )}
            </div>
          )}

          {activeTab === 'detail' && (
            <div className="space-y-6">
              {app.status !== 'DRAFT' && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                  Hanya telepon, email, IDPEL, No. Agenda, dan No. Register yang dapat dilengkapi.
                </div>
              )}

              {/* Status Banner */}
              {(() => {
                const isReadyToInstall = Boolean(app.ready_to_install || app.survey?.ready_to_install)
                return (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status Permohonan</span>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge status={app.status} />
                        {isReadyToInstall && (
                          <span
                            data-testid="ready-to-install-badge"
                            title="Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS"
                            className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 cursor-help"
                          >
                            Siap pasang
                          </span>
                        )}
                      </div>
                      {isReadyToInstall && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
                          Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unit Pelaksana (ULP)</span>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                        {app.unit?.code} - {app.unit?.name}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Section: Pelanggan */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  Data Pelanggan
                </h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400">Nama Pelanggan:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{app.customer?.name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">No. Telepon / HP:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{app.customer?.phone || '-'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Email:</span>
                    <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">{app.customer?.email || '-'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">ID Pelanggan (IDPEL):</span>
                    <div className="mt-0.5">
                      {missingFields.hasIdpel ? (
                        <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {Array.isArray(app.customer?.idpel)
                            ? app.customer.idpel.map((i) => i.value || i).join(', ')
                            : (app.customer?.idpel || app.idpel)}
                        </p>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200">
                          <span>Belum ada IDPEL</span>
                          {canAddRef && (
                            <button
                              type="button"
                              onClick={() => onCompleteData?.(app, 'IDPEL')}
                              className="font-bold underline hover:text-purple-900 cursor-pointer"
                            >
                              Lengkapi
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Alamat Layanan:</span>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">{app.service_address || '-'}</p>
                </div>
              </div>

              {/* Section: Daya & Tarif */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  Rincian Daya & Tarif
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400">Tipe / Transaksi:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{app.application_type} ({app.transaction_type})</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Tarif Baru:</span>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">{app.new_tariff_code || '-'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Daya Baru:</span>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {app.new_power ? `${app.new_power.value} ${app.new_power.unit}` : '-'}
                    </p>
                  </div>
                  {app.application_type === 'PD' && (
                    <>
                      <div>
                        <span className="text-slate-400">Tarif Lama:</span>
                        <p className="font-medium text-slate-600 dark:text-slate-400 mt-0.5">{app.old_tariff_code || '-'}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Daya Lama:</span>
                        <p className="font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                          {app.old_power ? `${app.old_power.value} ${app.old_power.unit}` : '-'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Delta Daya:</span>
                        <p className="font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                          {app.delta_power_kva !== null ? `${app.delta_power_kva} kVA` : '-'}
                        </p>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-slate-400">Kriteria TMP:</span>
                    <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">{app.service_criteria || '-'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Estimasi Total Biaya:</span>
                    <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                      {app.total_cost ? `Rp ${app.total_cost.toLocaleString('id-ID')}` : '-'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section: Layanan & Survei */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  Layanan & Survei
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400">Lama Hari Layanan:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {app.service_days !== null && app.service_days !== undefined ? (
                        <>
                          {app.service_days} hari kerja
                          {app.service_days_observed_at ? (
                            <span className="text-slate-500 dark:text-slate-400 font-normal">
                              {' '}(per {app.service_days_observed_at})
                            </span>
                          ) : null}
                        </>
                      ) : (
                        '-'
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Nomor Survei:</span>
                    <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {app.survey?.survey_number || app.survey_number || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Status Survei:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {app.survey?.status || app.survey_status || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Hasil Survei:</span>
                    <div className="mt-0.5">
                      {(app.survey?.outcome === 'NO_EXTENSION' || app.survey_outcome === 'NO_EXTENSION') && (
                        <span data-testid="survey-outcome-badge" className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200/60">
                          Tanpa perluasan
                        </span>
                      )}
                      {(app.survey?.outcome === 'EXTENSION' || app.survey_outcome === 'EXTENSION') && (
                        <span data-testid="survey-outcome-badge" className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60">
                          Perlu perluasan
                        </span>
                      )}
                      {!app.survey?.outcome && !app.survey_outcome && (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  </div>
                  {app.survey?.accepted_at && (
                    <div>
                      <span className="text-slate-400">Survei Diterima:</span>
                      <p className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                        {app.survey.accepted_at}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Section: Referensi Eksternal (No. Agenda & Registrasi) */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  Referensi Sistem Eksternal (AP2T / EIS)
                </h4>

                {/* Missing reference chips */}
                <div className="flex flex-wrap items-center gap-2">
                  {missingFields.missingAgenda && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200">
                      <span>Belum ada No. Agenda</span>
                      {canAddRef && (
                        <button
                          type="button"
                          onClick={() => onCompleteData?.(app, 'AGENDA')}
                          className="font-bold underline hover:text-amber-950 cursor-pointer"
                        >
                          Lengkapi
                        </button>
                      )}
                    </span>
                  )}
                  {missingFields.missingRegister && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200">
                      <span>Belum ada No. Register</span>
                      {canAddRef && (
                        <button
                          type="button"
                          onClick={() => onCompleteData?.(app, 'PAYMENT_REGISTER')}
                          className="font-bold underline hover:text-slate-900 cursor-pointer"
                        >
                          Lengkapi
                        </button>
                      )}
                    </span>
                  )}
                </div>

                {!app.external_references || app.external_references.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Belum ada nomor agenda atau registrasi yang ditautkan.</p>
                ) : (
                  <div className="space-y-2">
                    {(app.external_references || []).map((r) => (
                      <div key={r.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-slate-700 dark:text-slate-200">{r.reference_type}</span>:
                          <span className="ml-1.5 font-mono font-semibold text-slate-900 dark:text-slate-100">{r.reference_number}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">Sumber: {r.external_system || 'MANUAL'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Form Tambah Referensi Eksternal */}
                {canAddRef && (
                  <form onSubmit={handleAddExternalRef} className="pt-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={refType}
                        onChange={(e) => setRefType(e.target.value)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      >
                        <option value="AGENDA">NO. AGENDA</option>
                        <option value="PAYMENT_REGISTER">NO. REGISTER</option>
                      </select>
                      <input
                        type="text"
                        value={refNumber}
                        onChange={(e) => setRefNumber(e.target.value)}
                        placeholder="Masukkan nomor referensi…"
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                      />
                      <Button type="submit" size="sm" loading={addingRef} disabled={!refNumber.trim()}>
                        Tautkan
                      </Button>
                    </div>
                    {refType === 'AGENDA' && (
                      <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        💡 Pengisian Nomor Agenda akan otomatis mengubah status permohonan menjadi <strong>Disetujui (Approved)</strong>.
                      </p>
                    )}
                    {refError && <p className="mt-1 text-xs text-rose-500">{refError}</p>}
                  </form>
                )}
              </div>

              {/* Section: Riwayat Perubahan Status (Append-Only) */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
                  Riwayat Perjalanan Permohonan (Audit Log)
                </h4>

                {!app.status_history || app.status_history.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Belum ada catatan riwayat perubahan status.</p>
                ) : (
                  <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                    {(app.status_history || []).map((h, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
                        <div className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {h.from_status ? `${formatStatusLabel(h.from_status)} → ` : ''}{formatStatusLabel(h.to_status)}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {h.changed_at ? new Date(h.changed_at).toLocaleString('id-ID') : '-'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Oleh: {h.changed_by_email || 'Sistem'}
                          </p>
                          {h.reason && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 italic mt-0.5 bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded">
                              &ldquo;{h.reason}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'surveys' && (
            <div className="space-y-4">
              {selectedSurveyId ? (
                <SurveyDetailView
                  surveyId={selectedSurveyId}
                  isEmbedded={true}
                  onBack={() => setSelectedSurveyId(null)}
                  onReloadApplication={() => {
                    loadDetail()
                    loadSurveys()
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Survei Lapangan Terkait Permohonan
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Daftar riwayat survei teknis dan pengukuran tiang/trafo.
                      </p>
                    </div>

                    {canExecuteSurvey && !surveys.some((s) => s.status === 'ACTIVE') && (
                      isNonRepresentative ? (
                        <div className="p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px]">
                          Pelanggan ini bagian dari usulan {proposalInfo?.proposalNumber}; survey, gambar, MTO, RAB, WO dan BASTP dikerjakan lewat pelanggan utama usulan.
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {(() => {
                            const hasAcceptedSurvey = surveys.some(
                              (s) => s.status === 'ACCEPTED' || s.latest_version?.status === 'ACCEPTED'
                            )
                            const isSurveyDisabled = !canStartSurvey || hasAcceptedSurvey
                            const surveyButtonTitle = hasAcceptedSurvey
                              ? 'Survei lapangan telah selesai dan disetujui (ACCEPTED).'
                              : !canStartSurvey
                              ? 'Survei dan usulan dapat dimulai setelah No. Agenda terbit.'
                              : 'Drawer ini hanya pratinjau; survei dimulai di halaman Usulan Survei'

                            return (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  loading={startingSurvey}
                                  disabled={isSurveyDisabled}
                                  title={surveyButtonTitle}
                                  onClick={() => navigate(`/permohonan?tab=survei&mulai=${encodeURIComponent(app?.application_number || '')}`)}
                                >
                                  Mulai Survei →
                                </Button>
                                {hasAcceptedSurvey && (
                                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                    ✓ Survei Selesai (Disetujui)
                                  </span>
                                )}
                                {!hasAcceptedSurvey && !canStartSurvey && (
                                  <span className="text-[11px] text-amber-700 dark:text-amber-400 italic">
                                    Survei dan usulan dapat dimulai setelah No. Agenda terbit.
                                  </span>
                                )}
                              </>
                            )
                          })()}
                        </div>
                      )
                    )}
                  </div>

                  {loadingSurveys ? (
                    <div className="p-8 text-center"><Spinner size="sm" label="Memuat data survei..." /></div>
                  ) : surveys.length === 0 ? (
                    <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Belum ada survei lapangan yang ditugaskan untuk permohonan ini.
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Survei dimulai langsung oleh Teknik ULP setelah permohonan berstatus <strong>Disetujui (Approved)</strong> dan No. Agenda terbit; tidak perlu penugasan oleh Manager.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[...surveys]
                        .sort((a, b) => {
                          if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
                          if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1
                          return 0
                        })
                        .map((s) => {
                          const isCancelled = s.status === 'CANCELLED'
                          return (
                            <div
                              key={s.id}
                              className={`p-4 rounded-xl border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                                isCancelled
                                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 opacity-80'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400'
                              }`}
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                    Survei #{s.survey_number}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isCancelled
                                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                      : s.status === 'ACTIVE'
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                                  }`}>
                                    {isCancelled ? 'Dibatalkan' : s.status}
                                  </span>
                                  {s.latest_version && (
                                    <span className="text-[10px] text-slate-400">
                                      Versi {s.latest_version.version_number} ({s.latest_version.status})
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  Surveyor: <strong className="text-slate-700 dark:text-slate-300">{s.surveyor?.name}</strong> ({s.surveyor?.email})
                                  {s.scheduled_at && ` · Jadwal: ${new Date(s.scheduled_at).toLocaleDateString('id-ID')}`}
                                </p>
                                {isCancelled && s.cancel_reason && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 italic">
                                    Alasan: {s.cancel_reason}
                                  </p>
                                )}
                              </div>

                              {!isCancelled && (
                                <div className="flex items-center gap-2">
                                  {(s.status === 'ACCEPTED' || s.latest_version?.status === 'ACCEPTED') &&
                                    (s.outcome === 'EXTENSION' || s.latest_version?.outcome === 'EXTENSION' || app?.survey?.outcome === 'EXTENSION') && (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1 shadow-xs"
                                      onClick={() => {
                                        // drawer = pratinjau: pekerjaan dilakukan di halaman usulan, atau di Usulan Survei bila usulan belum dibuat
                                        if (proposalInfo?.id && (technicalUnlocked || proposalInfo?.issued)) {
                                          navigate(`/usulan/${proposalInfo.id}?tab=drawings`)
                                        } else {
                                          navigate(`/permohonan?tab=survei&cari=${encodeURIComponent(app?.application_number || '')}`)
                                        }
                                      }}
                                    >
                                      <span>{technicalUnlocked || proposalInfo?.issued ? 'Buka Usulan Perluasan →' : 'Buat Usulan di Usulan Survei →'}</span>
                                    </Button>
                                  )}
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => navigate(`/survei/${s.id}`)}
                                  >
                                    Buka Halaman Survei →
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {activeTab === 'drawings' && (
            <div className="space-y-4">
              {loadingDrawing ? (
                <div className="p-8 text-center"><Spinner size="sm" label="Memuat paket gambar teknik..." /></div>
              ) : drawingPkg ? (
                <DrawingDetailView
                  drawingId={drawingPkg.id}
                  application={app}
                  previewOnly={true}
                  onReloadApplication={() => {
                    loadDetail()
                    loadDrawingPkg()
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Paket Desain & Gambar Teknik
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Dokumen Single Line Diagram (SLD) dan rancangan konstruksi tiang/trafo.
                      </p>
                    </div>

                    {proposalInfo?.id ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => navigate(`/usulan/${proposalInfo.id}?tab=drawings`)}
                        className="inline-flex items-center gap-1.5 shrink-0"
                      >
                        <span>Buka Halaman Usulan (Gambar &amp; MTO) →</span>
                      </Button>
                    ) : (
                      (canExecuteDrawing || canAssignDrawing) && (
                        !isNonRepresentative && (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={openingDrawing}
                            onClick={async () => {
                              setOpeningDrawing(true)
                              try {
                                const res = await drawingApi.create(applicationId, {})
                                notify({
                                  type: 'success',
                                  title: 'Paket Gambar Berhasil Dibuka',
                                  desc: `Paket gambar teknik #${res.data?.drawing_number || ''} berhasil dibuka.`,
                                  tag: 'Gambar Teknik',
                                })
                                navigate(`/gambar/${res.data.id}`)
                              } catch (err) {
                                notify({
                                  type: 'error',
                                  title: 'Gagal Membuka Paket Gambar',
                                  desc: err.message || 'Terjadi kesalahan.',
                                  tag: 'Gambar Teknik',
                                })
                              } finally {
                                setOpeningDrawing(false)
                              }
                            }}
                            className="inline-flex items-center gap-1.5 shrink-0"
                          >
                            <span>Buka Halaman Gambar Baru →</span>
                          </Button>
                        )
                      )
                    )}
                  </div>

                  <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Belum ada paket gambar teknik untuk permohonan ini.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Paket gambar dibuat setelah hasil survei menyatakan memerlukan gambar; unggah sebelum Manager ULP menyetujui survei.
                    </p>
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                      Drawer ini digunakan untuk pratinjau saja tanpa proses input data. Gunakan tombol di atas untuk membuka halaman gambar teknik penuh.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Dokumen & Berkas Terlampir ({documents.length})
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Semua berkas dan bukti foto yang telah diunggah pada permohonan ini.
                  </p>
                </div>
              </div>

              {loadingDocs ? (
                <div className="p-8 text-center"><Spinner size="sm" label="Memuat dokumen..." /></div>
              ) : documents.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Belum ada dokumen atau berkas yang diunggah untuk permohonan ini.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {documents.map((doc) => (
                    <AuthenticatedDocumentItem
                      key={doc.id}
                      doc={doc}
                      canDelete={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'kkf' && (
            <ApplicationKkfPanel
              application={{
                ...app,
                proposal_number: proposalInfo?.proposalNumber || app?.proposal_number,
                proposal_id: proposalInfo?.id || app?.proposal_id,
              }}
              canRun={canRunKkf}
              canView={canViewKkf}
            />
          )}

          {activeTab === 'kko' && (
            <ApplicationKkoPanel application={app} canRecord={canRecordKko} canDecide={canDecideKko} />
          )}

          {activeTab === 'allocations' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-blue-900 dark:text-blue-200">
                  Ini hanya pratinjau. Alokasi material &amp; tiang dibuat dan diubah pada halaman usulan, karena berlaku untuk seluruh pelanggan dalam usulan.
                </p>
                {proposalInfo?.id && (
                  <Button size="sm" variant="primary" onClick={() => navigate(`/usulan/${proposalInfo.id}?tab=alokasi`)}>
                    Buka Alokasi di Usulan →
                  </Button>
                )}
              </div>
              <ApplicationAllocationPanel
                application={app}
                canManageMaterials={false}
                canManagePoles={false}
                canManage={false}
                canView={canViewAllocations}
              />
            </div>
          )}

          {activeTab === 'work-orders' && (
            <ApplicationWorkOrdersPanel
              application={app}
              canCreate={canWoCreate}
              canIssue={canWoIssue}
              canSubmitProgress={canWoSubmitProgress}
              canVerifyProgress={canWoVerifyProgress}
              canComplete={canWoComplete}
            />
          )}
        </div>
      )}
    </PanelShell>
  )
}

/**
 * Drawer: Impor Permohonan EIS / Daftung (Stage 1B/1C - Two-Phase Staging)
 */
export function EisImportDrawer({ open, asPage = false, canCreate = false, onSwitchToCreate, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [phase, setPhase] = useState('upload') // 'upload' | 'preview'
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [batch, setBatch] = useState(null)
  const [stagingRows, setStagingRows] = useState([])
  const [stagingLoading, setStagingLoading] = useState(false)
  const [stagingPage, setStagingPage] = useState(1)
  const [stagingPerPage, setStagingPerPage] = useState(25)
  const [actionFilter, setActionFilter] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      setPhase('upload')
      setFile(null)
      setError('')
      setBatch(null)
      setStagingRows([])
      setActionFilter('')
    }
  }, [open])

  // Load staging records
  const loadStaging = useCallback(async (batchId, action) => {
    if (!batchId) return
    setStagingLoading(true)
    setError('')
    try {
      const res = await applicationApi.importBatchDetail(batchId, {
        action: action || undefined,
        per_page: 100,
      })
      setStagingRows(res.rows ?? [])
      if (res.data) setBatch(res.data)
    } catch (err) {
      setError(err.message || 'Gagal memuat pratinjau data staging impor.')
    } finally {
      setStagingLoading(false)
    }
  }, [])

  useEffect(() => {
    if (batch?.id && phase === 'preview') {
      loadStaging(batch.id, actionFilter)
      setStagingPage(1)
    }
  }, [batch?.id, phase, actionFilter, loadStaging])

  const handleUpload = async (e) => {
    e?.preventDefault()
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await applicationApi.uploadImport(file)
      setBatch(res.data)
      setPhase('preview')
      notify({
        type: 'info',
        title: 'Pratinjau Impor Disiapkan',
        desc: `File ${res.data.file_name} berhasil distaging (${res.data.total_rows} baris). Tinjau sebelum konfirmasi.`,
        tag: 'Impor EIS',
      })
    } catch (err) {
      setError(err.message || 'Gagal mengunggah berkas impor EIS.')
    } finally {
      setUploading(false)
    }
  }

  const handleConfirm = async () => {
    if (!batch?.id) return
    setConfirming(true)
    setError('')
    try {
      await applicationApi.confirmImport(batch.id)
      notify({
        type: 'success',
        title: 'Impor EIS Berhasil Dikonfirmasi',
        desc: `Data permohonan dari ${batch.file_name} telah berhasil diimpor ke sistem.`,
        tag: 'Impor EIS',
      })
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Gagal mengonfirmasi impor.')
    } finally {
      setConfirming(false)
    }
  }

  const handleDiscard = async () => {
    if (!batch?.id) {
      onClose()
      return
    }
    setDiscarding(true)
    setError('')
    try {
      await applicationApi.discardImport(batch.id)
      notify({
        type: 'warning',
        title: 'Staging Impor Dibuang',
        desc: 'Batch staging impor telah dibatalkan tanpa mengubah data permohonan.',
        tag: 'Impor EIS',
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Gagal membuang batch staging.')
    } finally {
      setDiscarding(false)
    }
  }

  const handleDownloadTemplate = () => {
    const csv = [
      'NO_AGENDA,NAMA_PELANGGAN,JENIS_TRANSAKSI,KODE_ULP,TARIF_BARU,DAYA_BARU,SATUAN_DAYA,ALAMAT_PELANGGAN',
      '5145320261106001,PT Maju Terus,PASANG BARU,51453,B1,33000,VA,"Kawasan Industri Jombang"',
      '5145320261106002,Budi Santoso,PERUBAHAN DAYA,51453,R1,2200,VA,"Jl. Merdeka No. 10, Jombang"',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'template_impor_eis_permohonan.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const counts = batch?.counts ?? {}
  const countNew = counts.NEW ?? 0
  const countMatched = counts.MATCHED ?? 0
  const countUnchanged = counts.UNCHANGED ?? 0
  const countReject = counts.REJECT ?? 0
  const countOutOfScope = counts.OUT_OF_SCOPE ?? 0
  const totalValid = countNew + countMatched + countUnchanged

  return (
    <PanelShell
      asPage={asPage}
      onBack={phase === 'preview' ? handleDiscard : onClose}
      open={open}
      title="Impor Permohonan EIS (Two-Phase Staging)"
      subtitle="Sinkronisasi agenda Pasang Baru & Perubahan Daya dari sistem EIS / Daftung"
      onClose={phase === 'preview' ? handleDiscard : onClose}
      footer={
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 w-full">
          <div>
            {phase === 'preview' ? (
              <Button
                variant="danger"
                size="sm"
                loading={discarding}
                onClick={handleDiscard}
              >
                Buang Staging
              </Button>
            ) : (
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer font-medium"
              >
                <IconDownload size={14} />
                <span>Unduh Template CSV</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={phase === 'preview' ? handleDiscard : onClose}
            >
              Batal
            </Button>
            {phase === 'upload' ? (
              <Button
                variant="primary"
                size="sm"
                loading={uploading}
                disabled={!file}
                onClick={handleUpload}
              >
                Mulai Pratinjau Staging
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={confirming}
                disabled={totalValid === 0}
                onClick={handleConfirm}
              >
                Konfirmasi Impor ({totalValid} Permohonan)
              </Button>
            )}
          </div>
        </div>
      }
    >
      {canCreate && phase === 'upload' && (
        <div className="grid grid-cols-2 gap-2 p-1 mb-5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onSwitchToCreate}
            className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <IconPlus size={14} />
            <span>Tambah Manual</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs transition cursor-pointer"
          >
            <IconUpload size={14} />
            <span>Via Upload (Impor EIS)</span>
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {phase === 'upload' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 text-xs text-blue-800 dark:text-blue-300 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5">
              <IconAlertCircle size={15} />
              <span>Prinsip Impor Staging Aman (Fail-Closed)</span>
            </div>
            <p className="leading-relaxed">
              Berkas impor diproses melalui dua fase: data dianalisis terlebih dahulu ke staging database untuk memvalidasi
              integritas Nomor Agenda, pemetaan unit ULP, dan perbandingan terhadap data yang telah ada. Data permohonan baru
              akan disimpan ke sistem setelah Anda menekan <strong>Konfirmasi Impor</strong>.
            </p>
          </div>

          <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-8 text-center bg-slate-50/50 dark:bg-slate-800/30">
            <IconUpload size={36} className="mx-auto text-slate-400 dark:text-slate-500 mb-3" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Pilih Berkas EIS / Bot Daftung
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto">
              Format yang didukung: CSV (UTF-8), TXT, Excel (.xlsx, .xls), atau file HTML export dari EIS.
            </p>

            <div className="mt-4 flex flex-col items-center">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-semibold shadow-xs cursor-pointer transition">
                <span>Pilih Berkas</span>
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls,.html,.htm"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              {file && (
                <div className="mt-3 text-xs text-slate-600 dark:text-slate-300 font-mono bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'preview' && batch && (
        <div className="space-y-5">
          {/* Batch Header Info */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <span className="text-slate-400">Berkas:</span>{' '}
              <strong className="text-slate-900 dark:text-slate-100 font-mono">{batch.file_name}</strong>
            </div>
            <div>
              <span className="text-slate-400">Total Baris:</span>{' '}
              <strong className="text-slate-900 dark:text-slate-100">{batch.total_rows}</strong>
            </div>
          </div>

          {/* Out of scope summary */}
          {countOutOfScope > 0 && (
            <div className="p-3.5 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <IconAlertCircle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{countOutOfScope} di luar cakupan</span>
              </div>
              {((counts.OUT_OF_SCOPE_STATUS ?? 0) > 0 || (counts.OUT_OF_SCOPE_POWER ?? 0) > 0) && (
                <ul className="text-[11px] text-amber-800 dark:text-amber-300 list-disc list-inside space-y-0.5">
                  {(counts.OUT_OF_SCOPE_STATUS ?? 0) > 0 && (
                    <li>{counts.OUT_OF_SCOPE_STATUS} status baru belum Bayar/Cetak PK</li>
                  )}
                  {(counts.OUT_OF_SCOPE_POWER ?? 0) > 0 && (
                    <li>{counts.OUT_OF_SCOPE_POWER} daya di bawah batas</li>
                  )}
                </ul>
              )}
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Permohonan yang sudah terdaftar pada sistem tetap diperbarui.
              </p>
            </div>
          )}

          {/* Action Filter Badges / Summary */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActionFilter('')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                actionFilter === ''
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              Semua ({batch.total_rows})
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('NEW')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                actionFilter === 'NEW'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
              }`}
            >
              Baru ({countNew})
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('MATCHED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                actionFilter === 'MATCHED'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100'
              }`}
            >
              Cocok ({countMatched})
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('UNCHANGED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                actionFilter === 'UNCHANGED'
                  ? 'bg-slate-600 text-white border-slate-600'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
              }`}
            >
              Tidak Berubah ({countUnchanged})
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('REJECT')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                actionFilter === 'REJECT'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
              }`}
            >
              Ditolak ({countReject})
            </button>
          </div>

          {/* Staging Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {stagingLoading ? (
              <div className="p-8 text-center"><Spinner /></div>
            ) : stagingRows.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Tidak ada baris staging untuk filter ini.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[440px]">
                <table className="min-w-full text-left text-xs data-table">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold text-slate-500 uppercase">Baris / Agenda</th>
                      <th className="py-2.5 px-3 font-semibold text-slate-500 uppercase">Pelanggan & ULP</th>
                      <th className="py-2.5 px-3 font-semibold text-slate-500 uppercase">Status Staging</th>
                      <th className="py-2.5 px-3 font-semibold text-slate-500 uppercase">Rincian & Alasan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stagingRows
                      .slice((stagingPage - 1) * stagingPerPage, stagingPage * stagingPerPage)
                      .map((r, idx) => {
                      const isNew = r.action === 'NEW'
                      const isMatched = r.action === 'MATCHED'
                      const isUnchanged = r.action === 'UNCHANGED'
                      const isReject = r.action === 'REJECT'

                      return (
                        <tr
                          key={idx}
                          className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 ${
                            isReject ? 'bg-rose-50/20 dark:bg-rose-950/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono">
                            <span className="text-[10px] text-slate-400 block">#{r.row}</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{r.agenda || '-'}</span>
                          </td>
                          <td className="py-2.5 px-3 max-w-[180px]">
                            <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{r.name || '-'}</div>
                            <div className="text-[10px] text-slate-400">
                              {r.type} · ULP {r.unit_code}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isNew
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : isMatched
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : isUnchanged
                                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {isNew
                                ? 'Baru'
                                : isMatched
                                ? 'Cocok'
                                : isUnchanged
                                ? 'Tidak Berubah'
                                : 'Ditolak'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-xs">
                            {/* Errors / Alasan Penolakan */}
                            {r.errors && r.errors.length > 0 && (
                              <div className="space-y-1 text-rose-600 dark:text-rose-400">
                                {r.errors.map((err, eIdx) => (
                                  <div key={eIdx} className="text-[11px] font-medium flex items-start gap-1">
                                    <span>⚠️</span>
                                    <span>{err}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Warnings */}
                            {r.warnings && r.warnings.length > 0 && (
                              <div className="space-y-1 text-amber-600 dark:text-amber-400 mt-0.5">
                                {r.warnings.map((warn, wIdx) => (
                                  <div key={wIdx} className="text-[10px] flex items-start gap-1">
                                    <span>ℹ️</span>
                                    <span>{warn}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Column changes */}
                            {r.changes && Object.keys(r.changes).length > 0 && (
                              <div className="space-y-1 mt-0.5">
                                {Object.entries(r.changes).map(([col, change], cIdx) => {
                                  const colLabel = col === 'service_days' ? 'Lama hari kerja' : col
                                  return (
                                    <div key={cIdx} className="text-[10px] text-slate-600 dark:text-slate-300 font-mono">
                                      <span className="font-semibold">{colLabel}:</span> {String(change.from || '-')} → <strong className="text-blue-600 dark:text-blue-400">{String(change.to || '-')}</strong>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {/* Unchanged note */}
                            {isUnchanged && (!r.errors || r.errors.length === 0) && (
                              <span className="text-[10px] text-slate-400 italic">Identik, tidak ada perubahan.</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {stagingRows.length > 0 && (
              <TableFooter
                itemCount={stagingRows.slice((stagingPage - 1) * stagingPerPage, stagingPage * stagingPerPage).length}
                total={stagingRows.length}
                entityLabel="baris staging"
                page={stagingPage}
                perPage={stagingPerPage}
                onPage={setStagingPage}
                onPerPage={(n) => {
                  setStagingPerPage(n)
                  setStagingPage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            )}
          </div>
        </div>
      )}
    </PanelShell>
  )
}
