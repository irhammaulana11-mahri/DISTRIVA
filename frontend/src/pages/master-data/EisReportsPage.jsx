import { useCallback, useEffect, useMemo, useState } from 'react'
import { eisReportsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import {
  IconFileText,
  IconRefresh,
  IconUpload,
  IconLayers,
  IconCheckCircle,
  IconAlertCircle,
  IconEye,
  IconX,
  IconCalendar,
  IconBuilding,
  IconClock,
} from '../../components/icons.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const FAMILY_LABELS = {
  309: '309 (Penjualan Tenaga Listrik)',
  '309EIS': '309EIS (Tabel Datar Penjualan)',
  DIFI: 'DIFI (SAIDI / SAIFI / ENS)',
  GGNALL: 'GGNALL (Rekap Gangguan & SLA)',
  GGNPERJENIS: 'GGNPERJENIS (Gangguan per Jenis)',
  GGNBERULANG: 'GGNBERULANG (Gangguan Berulang)',
  GGNNEGATIF: 'GGNNEGATIF (Rating Negatif Gangguan)',
  KLHALL: 'KLHALL (Rekap Keluhan & Durasi)',
  KLHBERULANG: 'KLHBERULANG (Keluhan Berulang)',
  KLHNEGATIF: 'KLHNEGATIF (Rating Negatif Keluhan)',
  PIUTANGLPB_EIS: 'PIUTANGLPB_EIS (Piutang & Golongan)',
  AKHIRBULAN_EIS: 'AKHIRBULAN_EIS (Rekening Akhir Bulan)',
  AKHIEPERIODE_EIS: 'AKHIEPERIODE_EIS (Rekening Akhir Periode)',
  TAGSUS: 'TAGSUS (Tagihan Susulan P2TL)',
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  const isAktif = status === 'AKTIF' || status === 'BARU'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
        isAktif
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      }`}
    >
      {status}
    </span>
  )
}

/** Modal untuk mengunggah satu atau banyak berkas laporan EIS bulanan */
function UploadModal({ isOpen, onClose, onUploaded }) {
  const { notify } = useNotifications()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files || [])
    setFiles(chosen)
    setResults(null)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (files.length === 0) {
      setError('Pilih minimal satu berkas laporan.')
      return
    }

    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files[]', f))

      const res = await eisReportsApi.importFiles(fd)
      setResults(res?.data || [])
      notify({
        type: 'success',
        title: 'Impor Selesai',
        desc: res?.message || 'Proses impor berkas EIS selesai.',
        tag: 'EIS_REPORT',
      })
      onUploaded?.()
    } catch (err) {
      setError(err?.message || 'Gagal mengunggah berkas laporan EIS.')
      if (err?.data?.data) {
        setResults(err.data.data)
      }
    } finally {
      setUploading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
              <IconUpload size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Unggah Laporan EIS Bulanan
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Format penamaan wajib: <code className="font-mono text-blue-600">JENIS-KODEUNIT-BBTTTT.xls|xlsx</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
            aria-label="Tutup"
          >
            <IconX size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Petunjuk Format Berkas:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Mendukung jenis: <span className="font-mono">309, 309EIS, DIFI, GGNALL, KLHALL, PIUTANGLPB_EIS, TAGSUS, dll.</span></li>
              <li>Contoh: <span className="font-mono font-semibold">309-51453-042026.xls</span> atau <span className="font-mono font-semibold">DIFI-51453-052026.xlsx</span></li>
              <li>Unit tujuan dibaca otomatis dari kode dan isi berkas (tidak perlu dipilih manual).</li>
            </ul>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Pilih Berkas (maks. 60 berkas, 20 MB/berkas)
            </label>
            <input
              type="file"
              multiple
              accept=".xls,.xlsx"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-xs text-slate-600 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-950 dark:file:text-blue-300 cursor-pointer"
            />
            {files.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                {files.length} berkas dipilih untuk diunggah.
              </p>
            )}
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          {results && results.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Hasil Pemrosesan Berkas ({results.length})
              </h3>
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Nama Berkas</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate max-w-xs">
                          {r.name}
                        </td>
                        <td className="py-2 px-3">
                          <StatusBadge status={r.ok ? r.status : 'GAGAL'} />
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                          {r.ok ? (
                            <>
                              {r.family} · {r.period} · {r.lines ? `${r.lines} baris` : ''}
                              {r.warnings && r.warnings.length > 0 && (
                                <span className="text-amber-600 block">Peringatan: {r.warnings.join(', ')}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-rose-600">{r.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={uploading}>
              Tutup
            </Button>
            <Button type="submit" variant="primary" loading={uploading} disabled={files.length === 0}>
              Unggah Sekarang
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Drawer Pratinjau Isi Berkas Laporan EIS */
function FileLinesDrawer({ fileId, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', file: null, lines: [] })

  useEffect(() => {
    if (!fileId) return
    let active = true
    setState({ loading: true, error: '', file: null, lines: [] })

    eisReportsApi
      .lines(fileId)
      .then((res) => {
        if (!active) return
        setState({
          loading: false,
          error: '',
          file: res?.data?.file || null,
          lines: res?.data?.lines || [],
        })
      })
      .catch((err) => {
        if (!active) return
        setState({
          loading: false,
          error: err?.message || 'Gagal memuat isi laporan.',
          file: null,
          lines: [],
        })
      })

    return () => {
      active = false
    }
  }, [fileId])

  return (
    <Drawer
      isOpen={Boolean(fileId)}
      onClose={onClose}
      title={state.file ? `Isi Laporan ${state.file.original_name}` : 'Rincian Berkas Laporan'}
      size="xl"
    >
      {state.loading && (
        <div className="py-20 flex justify-center">
          <Spinner size="lg" label="Memuat baris laporan..." />
        </div>
      )}

      {state.error && <Alert kind="error">{state.error}</Alert>}

      {!state.loading && state.file && (
        <div className="space-y-5 text-xs">
          {/* Header Metadata Berkas */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {state.file.family}
                </span>
                <StatusBadge status={state.file.status} />
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                Unit: <span className="font-semibold">{state.file.unit_name}</span> · Periode:{' '}
                <span className="font-mono font-semibold">{state.file.period}</span>
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {state.lines.length} baris data
            </span>
          </div>

          {/* DIFI Summary Header jika ada */}
          {state.file.summary && (
            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl border border-blue-100 dark:border-blue-900/40 space-y-2">
              <h4 className="font-bold text-blue-900 dark:text-blue-300">Ringkasan DIFI (Kepala Laporan)</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(state.file.summary).map(([k, v]) => (
                  <div key={k} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <dt className="text-[10px] text-slate-500 uppercase">{k}</dt>
                    <dd className="font-mono font-bold text-slate-800 dark:text-slate-200">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Tabel Baris Laporan */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3 w-12 text-center">#</th>
                    <th className="py-2 px-3">Uraian / Golongan / Tarif</th>
                    <th className="py-2 px-3">Nilai Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                  {state.lines.map((l, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 text-center text-slate-400">{l.line_no}</td>
                      <td className="py-2 px-3 font-sans">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {l.label || l.code || '-'}
                        </div>
                        {l.group_label && (
                          <div className="text-[10px] text-slate-500">{l.group_label}</div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {l.values && typeof l.values === 'object' ? (
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            {Object.entries(l.values).map(([vk, vv]) => (
                              <span key={vk} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                                <span className="text-slate-500">{vk}:</span>{' '}
                                <span className="font-bold text-slate-800 dark:text-slate-200">{String(vv)}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          String(l.values || '-')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default function EisReportsPage() {
  const { can } = useAccess()
  const canImport = Boolean(can?.['eis_reports.import'])

  const [tab, setTab] = useState('files') // 'files' | 'coverage'
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [family, setFamily] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [status, setStatus] = useState('AKTIF')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  // Data state
  const [filesState, setFilesState] = useState({ loading: true, error: '', rows: [], meta: null, families: [] })
  const [covState, setCovState] = useState({ loading: false, error: '', data: null })
  const [covYear, setCovYear] = useState(new Date().getFullYear())

  // Modal / Drawer state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [previewFileId, setPreviewFileId] = useState(null)

  const loadFiles = useCallback(async () => {
    setFilesState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await eisReportsApi.list({
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
        family: family || undefined,
        from: fromMonth || undefined,
        to: toMonth || undefined,
        status: status || undefined,
        page,
        per_page: perPage,
      })
      setFilesState({
        loading: false,
        error: '',
        rows: res?.data || [],
        meta: res?.meta || null,
        families: res?.families || Object.keys(FAMILY_LABELS),
      })
    } catch (err) {
      setFilesState((s) => ({
        ...s,
        loading: false,
        error: err?.message || 'Gagal memuat daftar berkas laporan EIS.',
      }))
    }
  }, [up3Id, unitId, family, fromMonth, toMonth, status, page, perPage])

  const loadCoverage = useCallback(async () => {
    if (!unitId) return
    setCovState({ loading: true, error: '', data: null })
    try {
      const res = await eisReportsApi.coverage({ unit_id: unitId, year: covYear })
      setCovState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setCovState({
        loading: false,
        error: err?.message || 'Gagal memuat matriks kelengkapan.',
        data: null,
      })
    }
  }, [unitId, covYear])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  useEffect(() => {
    if (tab === 'coverage') {
      loadCoverage()
    }
  }, [tab, loadCoverage])

  const stats = useMemo(() => {
    const total = filesState.meta?.total ?? filesState.rows.length
    const familiesSet = new Set(filesState.rows.map((r) => r.family))
    const unitsSet = new Set(filesState.rows.map((r) => r.unit_id))
    return {
      total,
      familiesCount: familiesSet.size,
      unitsCount: unitsSet.size,
      latestPeriod: filesState.rows[0]?.period || '-',
    }
  }, [filesState])

  return (
    <div className="space-y-6 w-full">
      {/* Hero Header Card */}
      <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconFileText size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Laporan Bulanan EIS / AP2T
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Penjualan & Keandalan
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Arsip dan normalisasi laporan bulanan EIS (309, DIFI, Gangguan, Keluhan, Piutang, TAGSUS) sebagai basis data NKO dan pengusahaan.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={tab === 'files' ? loadFiles : loadCoverage}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canImport && (
              <Button
                variant="primary"
                size="md"
                icon={IconUpload}
                onClick={() => setIsUploadOpen(true)}
              >
                Unggah Laporan
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Berkas</dt>
            <span className="rounded-lg p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600"><IconFileText size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Berkas terdaftar di sistem</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Jenis Laporan</dt>
            <span className="rounded-lg p-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600"><IconLayers size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.familiesCount} jenis
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">309, DIFI, GGN, KLH, TAGSUS</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit Terlayani</dt>
            <span className="rounded-lg p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600"><IconBuilding size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-indigo-600 dark:text-indigo-400">
            {stats.unitsCount} unit
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Tingkat ULP dan UP3</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Periode Terkini</dt>
            <span className="rounded-lg p-1.5 bg-amber-50 dark:bg-amber-950/50 text-amber-600"><IconCalendar size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-amber-600 dark:text-amber-400">
            {stats.latestPeriod}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Laporan terakhir masuk</p>
        </div>
      </dl>

      {/* Underline Tabs */}
      <div role="tablist" aria-label="Tampilan Laporan EIS" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {[
          ['files', 'Daftar Berkas Laporan'],
          ['coverage', 'Matriks Kelengkapan Unit'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
              tab === id
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <HierarchicalUnitFilter
            permission="eis_reports.view"
            up3Id={up3Id}
            onUp3Change={(v) => {
              setPage(1)
              setUp3Id(v)
            }}
            unitId={unitId}
            onUnitChange={(v) => {
              setPage(1)
              setUnitId(v)
            }}
            up3AriaLabel="Filter UP3"
            unitAriaLabel="Filter ULP"
          />

          {tab === 'files' && (
            <>
              <select
                aria-label="Jenis Laporan"
                value={family}
                onChange={(e) => {
                  setPage(1)
                  setFamily(e.target.value)
                }}
                className={filterSelectCls}
              >
                <option value="">Semua Jenis Laporan</option>
                {Object.entries(FAMILY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <span>Dari</span>
                <input
                  type="month"
                  value={fromMonth}
                  onChange={(e) => {
                    setPage(1)
                    setFromMonth(e.target.value)
                  }}
                  aria-label="Dari bulan"
                  className={`${filterControlCls} w-32`}
                />
              </label>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <span>Sampai</span>
                <input
                  type="month"
                  value={toMonth}
                  onChange={(e) => {
                    setPage(1)
                    setToMonth(e.target.value)
                  }}
                  aria-label="Sampai bulan"
                  className={`${filterControlCls} w-32`}
                />
              </label>

              <select
                aria-label="Status Berkas"
                value={status}
                onChange={(e) => {
                  setPage(1)
                  setStatus(e.target.value)
                }}
                className={filterSelectCls}
              >
                <option value="AKTIF">Status: AKTIF</option>
                <option value="DIGANTIKAN">Status: DIGANTIKAN</option>
              </select>
            </>
          )}

          {tab === 'coverage' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span>Tahun</span>
              <input
                type="number"
                min="2020"
                max="2030"
                value={covYear}
                onChange={(e) => setCovYear(Number(e.target.value))}
                aria-label="Tahun kelengkapan"
                className={`${filterControlCls} w-24 tabular-nums`}
              />
            </label>
          )}
        </div>
      </div>

      {/* Konten Tab 1: Daftar Berkas */}
      {tab === 'files' && (
        <div className={`${CARD} overflow-hidden`}>
          {filesState.error && <Alert kind="error">{filesState.error}</Alert>}

          {filesState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat berkas laporan EIS..." />
            </div>
          ) : filesState.rows.length === 0 ? (
            <EmptyState
              title="Belum ada berkas laporan"
              desc="Unggah berkas laporan EIS bulanan (.xls atau .xlsx) sesuai format nama JENIS-KODEUNIT-BBTTTT."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Periode</th>
                      <th className="py-3 px-4">Unit</th>
                      <th className="py-3 px-4">Jenis Laporan</th>
                      <th className="py-3 px-4">Nama Berkas</th>
                      <th className="py-3 px-4 text-right">Jumlah Baris</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Diimpor</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filesState.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {r.period}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{r.unit_name}</div>
                          <div className="text-[10px] text-slate-400">{r.unit_type}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-blue-700 dark:text-blue-300">{r.family}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-xs" title={r.original_name}>
                          {r.original_name}
                          {r.warnings && r.warnings.length > 0 && (
                            <span className="block text-[10px] text-amber-600 font-sans">
                              {r.warnings.join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {r.line_count?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {fmtDate(r.imported_at)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={IconEye}
                            onClick={() => setPreviewFileId(r.id)}
                            aria-label={`Lihat isi ${r.original_name}`}
                          >
                            Lihat Isi
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filesState.meta && (
                <TableFooter
                  page={page}
                  perPage={perPage}
                  total={filesState.meta.total}
                  onPageChange={setPage}
                  onPerPageChange={(v) => {
                    setPage(1)
                    setPerPage(v)
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Konten Tab 2: Matriks Kelengkapan */}
      {tab === 'coverage' && (
        <div className={`${CARD} p-5 space-y-4`}>
          {!unitId ? (
            <Alert kind="info">
              Pilih satu ULP atau UP3 pada bilah filter di atas untuk melihat matriks kelengkapan berkas tahun {covYear}.
            </Alert>
          ) : covState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat matriks kelengkapan unit..." />
            </div>
          ) : covState.error ? (
            <Alert kind="error">{covState.error}</Alert>
          ) : !covState.data ? (
            <p className="text-center text-slate-500 text-xs py-10">Data tidak tersedia.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100">
                    Matriks Kelengkapan Laporan Tahun {covYear}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Memeriksa keberadaan berkas laporan bulanan aktif (Januari - Desember) untuk unit terpilih.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Jenis Laporan</th>
                      {MONTH_NAMES.map((m, idx) => (
                        <th key={idx} className="py-2.5 px-2 text-center w-12">{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {Object.keys(FAMILY_LABELS).map((fam) => {
                      const rowMonths = covState.data?.families?.[fam] || {}
                      return (
                        <tr key={fam} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {fam}
                            <span className="block text-[10px] font-normal text-slate-400">
                              {FAMILY_LABELS[fam]}
                            </span>
                          </td>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((mNum) => {
                            const isPresent = Boolean(rowMonths[mNum])
                            return (
                              <td key={mNum} className="py-2.5 px-2 text-center">
                                {isPresent ? (
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[10px]" title="Berkas aktif tersedia">
                                    ✓
                                  </span>
                                ) : (
                                  <span className="inline-block text-slate-300 dark:text-slate-600 text-[11px]" title="Belum ada berkas">
                                    —
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Unggah Berkas */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={() => {
          loadFiles()
          if (tab === 'coverage') loadCoverage()
        }}
      />

      {/* Drawer Lihat Isi Baris Berkas */}
      <FileLinesDrawer
        fileId={previewFileId}
        onClose={() => setPreviewFileId(null)}
      />
    </div>
  )
}
