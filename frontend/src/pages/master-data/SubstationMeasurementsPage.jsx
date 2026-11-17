import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { substationsApi, feedersApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import SubstationAnalysis, { FlagChips } from './SubstationAnalysis.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import MaximoSyncDrawer from './MaximoSyncDrawer.jsx'
import { readingTime } from '../../utils/readingTime.js'
import {
  IconSearch,
  IconZap,
  IconActivity,
  IconClock,
  IconArrowUp,
  IconArrowDown,
  IconAlertCircle,
  IconInfo,
  IconUpload,
  IconRefresh,
  IconCheckCircle,
} from '../../components/icons.jsx'

const inputCls =
  'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))

const READING_STYLE = {
  FRESH: { label: 'Terkini', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  STALE: { label: 'Kedaluwarsa', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300' },
  NONE: { label: 'Belum ada', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

export function ReadingBadge({ status }) {
  const s = READING_STYLE[status] || READING_STYLE.NONE
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}>{s.label}</span>
}

export const loadingText = (r) => (r?.loading_pct === null || r?.loading_pct === undefined ? '-' : `${fmt(r.loading_pct)}%`)

export function SubstationMeasurementDrawer({ id, asPage = true, canReading, canViewFeeders, feedersList = [], onClose, onChanged }) {
  const { notify } = useNotifications()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [activeTab, setActiveTab] = useState('analysis') // 'analysis' | 'readings'

  // Tambah pembacaan form state
  const blank = {
    measured_on: new Date().toISOString().slice(0, 10),
    current_r_a: '',
    current_s_a: '',
    current_t_a: '',
    loading_pct: '',
    end_voltage_v: '',
    base_voltage_r_v: '',
    base_voltage_s_v: '',
    base_voltage_t_v: '',
  }
  const [form, setForm] = useState(blank)
  const [feederRows, setFeederRows] = useState([])
  const [savingReading, setSavingReading] = useState(false)
  const [readingError, setReadingError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await substationsApi.get(id)
      setData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail gardu.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const setFormField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAddReading = async (e) => {
    e?.preventDefault?.()
    setSavingReading(true)
    setReadingError('')
    try {
      const body = form.measured_time ? { measured_at: `${form.measured_on} ${form.measured_time}` } : { measured_on: form.measured_on }
      for (const k of [
        'current_r_a',
        'current_s_a',
        'current_t_a',
        'loading_pct',
        'end_voltage_v',
        'base_voltage_r_v',
        'base_voltage_s_v',
        'base_voltage_t_v',
      ]) {
        if (form[k] !== '') body[k] = Number(form[k])
      }
      const fe = feederRows
        .filter((f) => f.label.trim() !== '')
        .map((f) =>
          Object.fromEntries(
            Object.entries(f)
              .filter(([, v]) => v !== '')
              .map(([k, v]) => [k, k === 'label' ? v.trim() : Number(v)])
          )
        )
      if (fe.length > 0) body.feeders = fe

      await substationsApi.addReading(id, body)
      notify({
        type: 'success',
        title: 'Pembacaan Tersimpan',
        desc: 'Pembacaan operasional gardu berhasil ditambahkan.',
        tag: 'GARDU',
      })
      setForm((f) => ({ ...blank, measured_on: f.measured_on }))
      setFeederRows([])
      await load()
      onChanged?.()
    } catch (err) {
      setReadingError(err?.message || 'Gagal menyimpan pembacaan.')
    } finally {
      setSavingReading(false)
    }
  }

  const s = data?.substation
  const feeder = feedersList.find((f) => f.code === s?.feeder_code || f.id === s?.feeder_id)
  const feederText = s?.feeder_code
    ? (feeder?.name ? `${s.feeder_code} - ${feeder.name}` : s.feeder_code)
    : '-'

  const title = `Kondisi & Analisis Gardu: ${s?.code || s?.name || s?.gadis_number || id}`
  const subtitle = s?.unit_name ? `Unit: ${s.unit_name} · Kapasitas: ${fmt(s.capacity_kva, 0)} kVA · Penyulang: ${feederText}` : 'Kondisi beban, analisis teknis, dan riwayat pengukuran'

  return (
    <PanelShell
      asPage={asPage}
      isOpen={true}
      onClose={onClose}
      onBack={onClose}
      title={title}
      subtitle={subtitle}
      size="max-w-5xl"
      width="max-w-5xl"
    >
      {loading ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="py-10"><Alert kind="error">{error}</Alert></div>
      ) : !data?.substation ? null : (
        <div className="space-y-5 text-xs" data-testid="substation-measurement-detail">
          {/* Tombol ke Data Induk Gardu */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100">
                Data Induk Gardu: {s.gadis_number || s.code}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Nama Gardu: {s.code || s.name || '-'} · Kapasitas {fmt(s.capacity_kva, 0)} kVA · Unit {s.unit_name || s.unit_code} · Penyulang {feederText}
              </div>
            </div>
            <Link
              to={`/master-data/substations?open=${s.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs shadow-2xs transition cursor-pointer"
            >
              Data induk →
            </Link>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('analysis')}
              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                activeTab === 'analysis'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Analisis Gardu
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('readings')}
              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                activeTab === 'readings'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Riwayat Pembacaan ({data.readings?.length ?? 0})
            </button>
          </div>

          {activeTab === 'analysis' && <SubstationAnalysis id={id} />}

          {activeTab === 'readings' && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400">
                      <th className="py-2 px-3">Tanggal & jam</th>
                      <th className="py-2 px-3 text-right">Kapasitas (kVA)</th>
                      <th className="py-2 px-3 text-right">R / S / T (A)</th>
                      <th className="py-2 px-3 text-right">Beban (kVA)</th>
                      <th className="py-2 px-3 text-right">Pembebanan</th>
                      <th className="py-2 px-3 text-right">Tegangan R / S / T (V)</th>
                      <th className="py-2 px-3 text-right">Teg. Ujung (V)</th>
                      <th className="py-2 px-3">Sumber</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {!data.readings || data.readings.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-4 text-center text-slate-400">
                          Belum ada riwayat pembacaan operasional.
                        </td>
                      </tr>
                    ) : (
                      data.readings.map((r, i) => (
                        <tr key={`${r.measured_on}-${r.source}-${i}`}>
                          <td className="py-2 px-3 font-mono" data-testid="reading-time">{readingTime(r)}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmt(r.capacity_kva, 0)}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {r.current_r_a === null && r.current_max_a !== null
                              ? `maks ${fmt(r.current_max_a)}`
                              : `${fmt(r.current_r_a)} / ${fmt(r.current_s_a)} / ${fmt(r.current_t_a)}`}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{fmt(r.load_kva, 2)}</td>
                          <td className="py-2 px-3 text-right font-mono">{loadingText(r)}</td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{`${fmt(r.base_voltage_r_v, 0)} / ${fmt(r.base_voltage_s_v, 0)} / ${fmt(r.base_voltage_t_v, 0)}`}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmt(r.end_voltage_v)}</td>
                          <td className="py-2 px-3">{r.source}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                Nilai 0 dianggap tidak terukur dan tidak disimpan. Koreksi dilakukan dengan menambah pembacaan baru.
              </p>
            </div>
          )}

          {/* Form Tambah Pembacaan (Hanya di Drawer Page asPage = true, bebas CRUD di drawer preview) */}
          {asPage && canReading && s.pickable && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900 p-4 space-y-3 bg-blue-50/40 dark:bg-blue-950/20" data-testid="reading-form">
              <div className="font-bold text-sm text-blue-900 dark:text-blue-300">Tambah Pembacaan Operasional</div>
              {readingError && <Alert kind="error">{readingError}</Alert>}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Tanggal
                  <input
                    aria-label="Tanggal pembacaan"
                    type="date"
                    className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
                    value={form.measured_on}
                    onChange={setFormField('measured_on')}
                  />
                </label>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Jam (opsional)
                  <input aria-label="Jam pembacaan" type="time" className={`${inputCls} w-full mt-1 text-base sm:text-xs`} value={form.measured_time || ''} onChange={setFormField('measured_time')} />
                </label>
                {[
                  ['current_r_a', 'Arus R (A)'],
                  ['current_s_a', 'Arus S (A)'],
                  ['current_t_a', 'Arus T (A)'],
                  ['loading_pct', 'Pembebanan (%)'],
                  ['end_voltage_v', 'Tegangan ujung (V)'],
                  ['base_voltage_r_v', 'Tegangan pangkal R-N (V)'],
                  ['base_voltage_s_v', 'Tegangan pangkal S-N (V)'],
                  ['base_voltage_t_v', 'Tegangan pangkal T-N (V)'],
                ].map(([k, label]) => (
                  <label key={k} className="font-semibold text-slate-700 dark:text-slate-300">
                    {label}
                    <input
                      aria-label={label}
                      type="number"
                      min="0"
                      className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
                      value={form[k]}
                      onChange={setFormField(k)}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-1 pt-1" data-testid="feeder-rows">
                <div className="font-semibold text-slate-700 dark:text-slate-300">Arus per jurusan (opsional)</div>
                {feederRows.map((f, i) => (
                  <div key={i} className="grid grid-cols-6 gap-1">
                    {[
                      ['label', 'Jurusan', 'text'],
                      ['current_r_a', 'R (A)', 'number'],
                      ['current_s_a', 'S (A)', 'number'],
                      ['current_t_a', 'T (A)', 'number'],
                      ['current_n_a', 'N (A)', 'number'],
                      ['end_voltage_v', 'Ujung (V)', 'number'],
                    ].map(([k, label, type]) => (
                      <input
                        key={k}
                        aria-label={`${label} jurusan ${i + 1}`}
                        placeholder={label}
                        type={type}
                        min={type === 'number' ? '0' : undefined}
                        className={`${inputCls} text-base sm:text-xs`}
                        value={f[k]}
                        onChange={(e) =>
                          setFeederRows((all) =>
                            all.map((x, xi) => (xi === i ? { ...x, [k]: e.target.value } : x))
                          )
                        }
                      />
                    ))}
                  </div>
                ))}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    className="text-blue-700 dark:text-blue-300 underline cursor-pointer text-xs"
                    onClick={() =>
                      setFeederRows((all) => [
                        ...all,
                        {
                          label: String.fromCharCode(65 + all.length),
                          current_r_a: '',
                          current_s_a: '',
                          current_t_a: '',
                          current_n_a: '',
                          end_voltage_v: '',
                        },
                      ])
                    }
                  >
                    + Tambah jurusan
                  </button>
                  {feederRows.length > 0 && (
                    <button
                      type="button"
                      className="text-slate-500 underline cursor-pointer text-xs"
                      onClick={() => setFeederRows((all) => all.slice(0, -1))}
                    >
                      Hapus jurusan terakhir
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Bila arus R/S/T gardu dikosongkan, arus gardu dihitung dari jumlah seluruh jurusan.
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <Button size="sm" loading={savingReading} onClick={handleAddReading}>
                  Simpan pembacaan
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  )
}

/** Master Data › Pengukuran Gardu (kondisi operasional). */
export default function SubstationMeasurementsPage() {
  const { can, isSysAdmin } = useAccess()
  const navigate = useNavigate()
  const canReading = Boolean(can?.['substations.reading'] || isSysAdmin)
  const canMaximoSync = Boolean(can?.['substations.sync'] || isSysAdmin)
  const [maximoOpen, setMaximoOpen] = useState(false)
  const canSync = Boolean(can?.['substations.sync'] || can?.['substations.reading'] || can?.['substations.manage'] || can?.['substations.import'] || isSysAdmin)
  const canViewFeeders = Boolean(can?.['feeders.view'])

  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  // Filters
  const [q, setQ] = useState(searchParams.get('q') || '')
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [feederId, setFeederId] = useState(searchParams.get('feeder_id') || '')
  const [readingStatus, setReadingStatus] = useState('')
  const [loadingPreset, setLoadingPreset] = useState('') // '' | 'OVERLOAD' | 'OVER_100' | 'CUSTOM'
  const [loadingMin, setLoadingMin] = useState('')
  const [loadingMax, setLoadingMax] = useState('')
  const [alertFilter, setAlertFilter] = useState('')

  // Sorting default: sort=loading&dir=desc
  const [sort, setSort] = useState('loading')
  const [dir, setDir] = useState('desc')

  // Summary counts
  const [summary, setSummary] = useState({ freshCount: null, totalCount: null })

  const [units, setUnits] = useState([])
  const [feedersList, setFeedersList] = useState([])

  // Detail pengukuran gardu dibuka sebagai halaman sendiri (bukan drawer pratinjau); tautan lama ?open=<id> dialihkan ke sana.
  const openDetail = (id) => navigate(`/master-data/substation-measurements/${id}`)
  useEffect(() => {
    const p = searchParams.get('open')
    if (p) navigate(`/master-data/substation-measurements/${p}`, { replace: true })
  }, [searchParams, navigate])

  // Fetch summary counts: N (reading_status=FRESH) dan M (total)
  const loadSummary = useCallback(async () => {
    try {
      const [resFresh, resTotal] = await Promise.all([
        substationsApi.list({ reading_status: 'FRESH', per_page: 1 }),
        substationsApi.list({ per_page: 1 }),
      ])
      setSummary({
        freshCount: resFresh?.meta?.total ?? 0,
        totalCount: resTotal?.meta?.total ?? 0,
      })
    } catch {
      // Abaikan galat summary
    }
  }, [])

  useEffect(() => {
    loadSummary()

    adminApi
      .units()
      .then((res) => setUnits(res?.data || []))
      .catch(() => setUnits([]))

    if (canViewFeeders) {
      feedersApi
        .list({ per_page: 100 })
        .then((res) => setFeedersList(res?.data || []))
        .catch(() => setFeedersList([]))
    }
  }, [canViewFeeders, loadSummary])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let lMin = loadingMin
      let lMax = loadingMax
      if (loadingPreset === 'OVERLOAD') {
        lMin = '80'
        lMax = ''
      } else if (loadingPreset === 'OVER_100') {
        lMin = '100'
        lMax = ''
      }

      const params = {
        q: query || undefined,
        organizational_unit_id: unitId || undefined,
        feeder_id: feederId || undefined,
        reading_status: readingStatus || undefined,
        loading_min: lMin || undefined,
        loading_max: lMax || undefined,
        alert: alertFilter || undefined,
        sort: sort || undefined,
        dir: sort ? dir : undefined,
        page,
        per_page: perPage,
      }
      const res = await substationsApi.list(params)
      setRows(res?.data || [])
      setMeta(res?.meta || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar pengukuran gardu.')
    } finally {
      setLoading(false)
    }
  }, [
    query,
    unitId,
    feederId,
    readingStatus,
    loadingPreset,
    loadingMin,
    loadingMax,
    alertFilter,
    sort,
    dir,
    page,
    perPage,
  ])

  useEffect(() => {
    load()
  }, [load])

  const handleSort = (column) => {
    if (sort === column) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(column)
      setDir('desc')
    }
    setPage(1)
  }

  const handlePresetChange = (preset) => {
    setLoadingPreset(preset)
    if (preset === 'OVERLOAD') {
      setLoadingMin('80')
      setLoadingMax('')
    } else if (preset === 'OVER_100') {
      setLoadingMin('100')
      setLoadingMax('')
    } else if (preset === '') {
      setLoadingMin('')
      setLoadingMax('')
    }
    setPage(1)
  }

  const ulps = units.filter((u) => u.unit_type === 'ULP')

  return (
    <div className="space-y-6">
      {/* Header Modul Pengukuran Gardu */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-brand-600 p-2.5 text-white shadow-xs">
              <IconActivity className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Operasional</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Pengukuran Gardu</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Pengukuran Gardu
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Operasional Distribusi
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Kondisi operasional gardu distribusi: pembebanan, tegangan pangkal dan ujung, keseimbangan fasa, serta proyeksi pertumbuhan beban.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} icon={IconRefresh} aria-label="Segarkan">
              Segarkan
            </Button>
            {canMaximoSync && (
              <Button size="sm" variant="secondary" icon={IconActivity} onClick={() => setMaximoOpen(true)}>
                Sinkronisasi Maximo
              </Button>
            )}
            {canSync && (
              <Button size="sm" icon={IconUpload} onClick={() => navigate('/master-data/substation-measurements/impor')}>
                Impor Pengukuran
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Ringkasan Kondisi Data di Atas Tabel */}
      <div
        className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3"
        data-testid="data-condition-summary"
      >
        <IconInfo size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
          <div className="font-bold text-slate-900 dark:text-slate-100">
            {summary.freshCount !== null && summary.totalCount !== null
              ? `${summary.freshCount} dari ${summary.totalCount} gardu punya pembacaan terkini`
              : 'Memeriksa kekinian pembacaan gardu...'}
          </div>
          <p className="text-slate-600 dark:text-slate-400">
            Pembacaan baru datang dari survei atau sinkronisasi Maximo. Data pengukuran yang lama tetap disimpan untuk analisis tren riwayat pembebanan.
          </p>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Pengukuran Gardu */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Gardu</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {meta?.total ?? rows.length}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Gardu distribusi terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Pembacaan Terkini</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {summary.freshCount ?? '-'}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Data operasional fresh</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Overload (&gt; 80%)</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {rows.filter((r) => (r.latest_reading?.loading_pct || 0) >= 80).length}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Gardu beban kritis</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Peringatan Teknis</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconActivity className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {rows.filter((r) => (r.latest_reading?.flags?.length || 0) > 0).length}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Drop tegangan / fasa</p>
        </div>
      </dl>

      {/* Filter Bar */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setQuery(q.trim())
        }}
      >
        <div className="relative">
          <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            aria-label="Cari gardu"
            placeholder="Kode, nama, kelurahan…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${inputCls} pl-8 w-48 sm:w-56`}
          />
        </div>

        <HierarchicalUnitFilter
          permission="substations.view"
          up3Id={up3Id}
          onUp3Change={(newUp3) => {
            setPage(1)
            setUp3Id(newUp3)
          }}
          unitId={unitId}
          onUnitChange={(newUnit) => {
            setPage(1)
            setUnitId(newUnit)
          }}
          unitAriaLabel="Unit"
        />

        {canViewFeeders && (
          <select
            aria-label="Penyulang"
            value={feederId}
            onChange={(e) => {
              setPage(1)
              setFeederId(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua penyulang</option>
            {feedersList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name ? `(${f.name})` : ''}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Status pembacaan"
          value={readingStatus}
          onChange={(e) => {
            setPage(1)
            setReadingStatus(e.target.value)
          }}
          className={inputCls}
        >
          <option value="">Semua status pembacaan</option>
          <option value="FRESH">Terkini</option>
          <option value="STALE">Kedaluwarsa</option>
          <option value="NONE">Belum ada</option>
        </select>

        <select
          aria-label="Filter Pembebanan"
          value={loadingPreset}
          onChange={(e) => handlePresetChange(e.target.value)}
          className={inputCls}
        >
          <option value="">Semua pembebanan</option>
          <option value="OVERLOAD">&gt; 80 % (overload)</option>
          <option value="OVER_100">&gt; 100 %</option>
          <option value="CUSTOM">Rentang kustom…</option>
        </select>

        {loadingPreset === 'CUSTOM' && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              aria-label="Beban Min (%)"
              placeholder="Min %"
              value={loadingMin}
              onChange={(e) => {
                setPage(1)
                setLoadingMin(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
            <span className="text-slate-400">-</span>
            <input
              type="number"
              aria-label="Beban Maks (%)"
              placeholder="Maks %"
              value={loadingMax}
              onChange={(e) => {
                setPage(1)
                setLoadingMax(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
          </div>
        )}

        <select
          aria-label="Peringatan"
          value={alertFilter}
          onChange={(e) => {
            setPage(1)
            setAlertFilter(e.target.value)
          }}
          className={inputCls}
        >
          <option value="">Semua peringatan</option>
          <option value="BASE_LOW">Tegangan pangkal &lt; 231 V</option>
          <option value="END_LOW">Tegangan ujung rendah (di bawah 198 V)</option>
          <option value="PHASE_UNBALANCED">Fasa tidak seimbang</option>
          <option value="END_DROP">Drop tegangan tinggi</option>
        </select>

        <Button type="submit" variant="secondary" size="sm">
          Cari
        </Button>
      </form>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Tabel Pengukuran Gardu */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat pengukuran gardu..." />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={IconActivity}
            title="Belum ada data pengukuran"
            description="Tidak ada gardu dengan pembacaan yang cocok dengan kriteria filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">Penyulang</th>
                  <th className="py-3 px-4 text-right">Kapasitas (kVA)</th>
                  <th
                    className="py-3 px-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('loading')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Pembebanan (%)</span>
                      {sort === 'loading' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-4 text-right">Teg. Pangkal Terendah (V)</th>
                  <th className="py-3 px-4 text-right">Teg. Ujung (V)</th>
                  <th
                    className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('measured_on')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Tgl Pengukuran Terakhir</span>
                      {sort === 'measured_on' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Peringatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((s) => {
                  const r = s.reading
                  const baseLowest =
                    r?.base_voltage_min_v !== undefined && r?.base_voltage_min_v !== null
                      ? r.base_voltage_min_v
                      : (() => {
                          const bases = [r?.base_voltage_r_v, r?.base_voltage_s_v, r?.base_voltage_t_v].filter(
                            (v) => v !== null && v !== undefined
                          )
                          return bases.length > 0 ? Math.min(...bases) : null
                        })()
                  const feeder = feedersList.find((f) => f.code === s.feeder_code || f.id === s.feeder_id)
                  const feederText = s.feeder_code
                    ? (feeder?.name ? `${s.feeder_code} - ${feeder.name}` : s.feeder_code)
                    : '-'
                  const displayCode = s.gadis_number || s.code
                  const displayName = s.code || s.name || '-'

                  return (
                    <tr
                      key={s.id}
                      onClick={() => openDetail(s.id)}
                      className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      data-testid="substation-measurement-row"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{displayCode}</td>
                      <td className="py-3 px-4">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{displayName}</span>
                          {s.name && s.name !== displayName && (
                            <span className="block text-[11px] text-slate-500 truncate max-w-xs">{s.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {s.feeder_code ? (
                          canViewFeeders ? (
                            <Link
                              to={`/master-data/feeders?q=${s.feeder_code}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {feederText}
                            </Link>
                          ) : (
                            feederText
                          )
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{s.capacity_kva ? fmt(s.capacity_kva, 0) : '-'}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                        {loadingText(r)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{fmt(baseLowest)}</td>
                      <td className="py-3 px-4 text-right font-mono">{fmt(r?.end_voltage_v)}</td>
                      <td className="py-3 px-4 font-mono">
                        {r?.measured_on ? (
                          <span data-testid="latest-reading-time">
                            {readingTime(r)}
                            {r.age_days !== null && r.age_days !== undefined ? ` (${r.age_days} hr)` : ''}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <ReadingBadge status={s.reading_status} />
                      </td>
                      <td className="py-3 px-4 space-x-1">
                        <FlagChips flags={r?.flags} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <TableFooter
          itemCount={rows.length}
          total={meta?.total ?? rows.length}
          entityLabel="gardu"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>

      {canMaximoSync && <MaximoSyncDrawer open={maximoOpen} onClose={() => setMaximoOpen(false)} onSynced={() => { load(); loadSummary() }} />}
    </div>
  )
}
