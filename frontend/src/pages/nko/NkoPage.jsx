import { useCallback, useEffect, useMemo, useState } from 'react'
import { nkoApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import { useScopedUnits, useUnitScope } from '../../utils/unitScope.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import {
  IconChart,
  IconRefresh,
  IconCalculator,
  IconLayers,
  IconCheckCircle,
  IconAlertCircle,
  IconCalendar,
  IconBuilding,
  IconClock,
  IconX,
  IconInfo,
} from '../../components/icons.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const POLARITY_LABELS = {
  1: { label: 'Min (Makin Kecil)', cls: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300' },
  2: { label: 'Rentang', cls: 'text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300' },
  3: { label: 'Maks (Makin Besar)', cls: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300' },
}

const fmt = (v, digits = 2) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtDate = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(d)
  }
}

function SourceBadge({ source }) {
  if (!source) return <span className="text-slate-400">-</span>
  const isSystem = source === 'SISTEM'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
        isSystem
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
          : 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
      }`}
    >
      {source}
    </span>
  )
}

/** Modal Hitung NKO */
function CalculateModal({ isOpen, onClose, year, month, unitId, up3Id, onCalculated }) {
  const { notify } = useNotifications()
  const [scopeType, setScopeType] = useState(unitId ? 'unit' : 'up3')
  const [calculating, setCalculating] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setScopeType(unitId ? 'unit' : 'up3')
    setResults(null)
    setError('')
  }, [unitId, up3Id, isOpen])

  const handleCalculate = async () => {
    setCalculating(true)
    setError('')
    try {
      const payload = {
        year,
        month,
      }
      if (scopeType === 'unit' && unitId) {
        payload.unit_id = unitId
      } else if (up3Id) {
        payload.up3_id = up3Id
      } else {
        payload.unit_id = unitId
      }

      const res = await nkoApi.calculate(payload)
      setResults(res?.data || [])
      notify({
        type: 'success',
        title: 'Perhitungan Selesai',
        desc: res?.message || 'Nilai NKO berhasil dihitung.',
        tag: 'NKO',
      })
      onCalculated?.()
    } catch (err) {
      setError(err?.message || 'Gagal menghitung NKO.')
      if (err?.data?.data) {
        setResults(err.data.data)
      }
    } finally {
      setCalculating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 rounded-xl">
              <IconCalculator size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Hitung Nilai Kinerja Organisasi (NKO)
              </h2>
              <p className="text-xs text-slate-500">
                Periode: {MONTH_NAMES[month - 1]} {year}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <IconX size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Ketentuan Perhitungan:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Realisasi kumulatif dihitung dari Januari s/d {MONTH_NAMES[month - 1]} {year}.</li>
              <li>Realisasi SAIDI, SAIFI, dan ENS diambil otomatis bila laporan DIFI tersedia lengkap.</li>
              <li>Realisasi penambahan pelanggan & daya diambil dari laporan 309.</li>
              <li>Peringkat ULP otomatis diperbarui setelah proses perhitungan selesai.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Cakupan Unit yang Dihitung
            </label>
            <div className="space-y-2">
              {unitId && (
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="scopeType"
                    value="unit"
                    checked={scopeType === 'unit'}
                    onChange={() => setScopeType('unit')}
                    className="text-indigo-600"
                  />
                  <span>Hanya Unit Terpilih ({unitId})</span>
                </label>
              )}
              {up3Id && (
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="scopeType"
                    value="up3"
                    checked={scopeType === 'up3'}
                    onChange={() => setScopeType('up3')}
                    className="text-indigo-600"
                  />
                  <span>Seluruh Unit di Bawah UP3 Terpilih (UP3 dan seluruh ULP)</span>
                </label>
              )}
            </div>
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          {results && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Hasil Perhitungan ({results.length} unit):</h4>
              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-3 text-right">NKO Akhir</th>
                      <th className="py-2 px-3 text-right">Peringkat</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{r.unit_name || r.unit_id}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-indigo-600">{r.ok ? fmt(r.nko) : '-'}</td>
                        <td className="py-2 px-3 text-right font-mono">{r.ok && r.rank ? `#${r.rank}` : '-'}</td>
                        <td className="py-2 px-3 text-[11px]">
                          {r.ok ? (
                            <span className="text-emerald-600 font-semibold">Berhasil</span>
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
            <Button type="button" variant="ghost" onClick={onClose} disabled={calculating}>
              Tutup
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={IconCalculator}
              loading={calculating}
              onClick={handleCalculate}
            >
              Mulai Hitung
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NkoPage() {
  const { can } = useAccess()
  const canCalculate = Boolean(can?.['nko.calculate'])
  const canInput = Boolean(can?.['nko.input'])

  const [tab, setTab] = useState('details') // 'details' | 'ranking' | 'inputs'
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  const unitInfo = useScopedUnits('nko.view')
  const unitScope = useUnitScope(unitInfo, up3Id, unitId)

  // Default up3Id dan unitId dari unitScope / unitInfo
  useEffect(() => {
    if (!up3Id && unitScope.up3Value) {
      setUp3Id(unitScope.up3Value)
    } else if (!up3Id && unitInfo.up3_units?.length > 0) {
      setUp3Id(unitInfo.up3_units[0].id)
    }
  }, [unitInfo, unitScope.up3Value, up3Id])

  useEffect(() => {
    if (!unitId && unitScope.ulpValue) {
      setUnitId(unitScope.ulpValue)
    } else if (!unitId && unitScope.ulpChoices?.length > 0) {
      setUnitId(unitScope.ulpChoices[0].id)
    }
  }, [unitScope.ulpValue, unitScope.ulpChoices, unitId])

  const targetUp3 = up3Id || unitScope.up3Value || unitInfo.up3_units?.[0]?.id || ''
  const targetUnit = unitId || unitScope.ulpValue || unitScope.up3Value || unitInfo.up3_units?.[0]?.id || ''

  // Snapshot detail state
  const [snapshotState, setSnapshotState] = useState({ loading: true, error: '', data: null })
  // Ranking state
  const [rankingState, setRankingState] = useState({ loading: false, error: '', data: null })
  // Manual inputs state
  const [inputsState, setInputsState] = useState({ loading: false, error: '', data: null })
  const [inputsDraft, setInputsDraft] = useState({})
  const [savingInputs, setSavingInputs] = useState(false)

  // Modal calculate
  const [isCalculateOpen, setIsCalculateOpen] = useState(false)

  // 1. Load Snapshot (for active unit & period)
  const loadSnapshot = useCallback(async () => {
    if (!targetUnit) {
      setSnapshotState({ loading: false, error: '', data: null })
      return
    }
    setSnapshotState((s) => ({ ...s, loading: true, error: '' }))
    try {
      // Cari snapshot id dari summary list
      const resList = await nkoApi.snapshots({
        year,
        month,
        unit_id: targetUnit,
      })
      const found = resList?.data?.[0]
      if (!found) {
        setSnapshotState({
          loading: false,
          error: '',
          data: null,
        })
        return
      }

      // Ambil detail rincian nilai
      const resDetail = await nkoApi.snapshot(found.id)
      setSnapshotState({
        loading: false,
        error: '',
        data: resDetail?.data || null,
      })
    } catch (err) {
      setSnapshotState({
        loading: false,
        error: err?.message || 'Gagal memuat rincian NKO.',
        data: null,
      })
    }
  }, [targetUnit, year, month])

  // 2. Load Ranking (for UP3 & period)
  const loadRanking = useCallback(async () => {
    if (!targetUp3) return
    setRankingState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.ranking({
        year,
        month,
        up3_id: targetUp3,
      })
      setRankingState({
        loading: false,
        error: '',
        data: res?.data || null,
      })
    } catch (err) {
      setRankingState({
        loading: false,
        error: err?.message || 'Gagal memuat peringkat NKO.',
        data: null,
      })
    }
  }, [targetUp3, year, month])

  // 3. Load Inputs (for manual entry)
  const loadInputs = useCallback(async () => {
    if (!unitId) return
    setInputsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.inputs({
        unit_id: unitId,
        year,
        month,
      })
      const items = res?.data?.items || []
      setInputsState({
        loading: false,
        error: '',
        data: res?.data || null,
      })
      // Inisialisasi draft input
      const initial = {}
      items.forEach((it) => {
        initial[it.code] = {
          value: it.manual !== null && it.manual !== undefined ? String(it.manual) : '',
          note: it.note || '',
        }
      })
      setInputsDraft(initial)
    } catch (err) {
      setInputsState({
        loading: false,
        error: err?.message || 'Gagal memuat daftar masukan manual.',
        data: null,
      })
    }
  }, [unitId, year, month])

  useEffect(() => {
    loadSnapshot()
  }, [loadSnapshot])

  useEffect(() => {
    if (tab === 'ranking') {
      loadRanking()
    } else if (tab === 'inputs') {
      loadInputs()
    }
  }, [tab, loadRanking, loadInputs])

  const handleSaveInputs = async (e) => {
    e.preventDefault()
    if (!unitId) return
    setSavingInputs(true)
    try {
      const items = Object.entries(inputsDraft)
        .filter(([code]) => {
          const itemMeta = inputsState.data?.items?.find((it) => it.code === code)
          return itemMeta?.editable
        })
        .map(([code, draft]) => ({
          code,
          value: draft.value !== '' ? Number(draft.value) : null,
          note: draft.note || null,
        }))

      // Validasi client-side: koreksi atas nilai otomatis wajib disertai alasan (note)
      const missingNotes = items.filter((it) => {
        if (it.value === null) return false
        const meta = inputsState.data?.items?.find((x) => x.code === it.code)
        return meta?.system != null && !it.note?.trim()
      })
      if (missingNotes.length > 0) {
        setInputsState((s) => ({
          ...s,
          error: `Koreksi atas nilai otomatis wajib disertai alasan (note): ${missingNotes.map((it) => it.code).join(', ')}.`,
        }))
        setSavingInputs(false)
        return
      }

      await nkoApi.saveInputs({
        unit_id: unitId,
        year,
        month,
        items,
      })

      // Muat ulang inputs
      await loadInputs()
    } catch (err) {
      setInputsState((s) => ({ ...s, error: err?.message || 'Gagal menyimpan masukan manual.' }))
    } finally {
      setSavingInputs(false)
    }
  }

  const d = snapshotState.data

  return (
    <div className="space-y-6 w-full">
      {/* Hero Header Card */}
      <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
              <IconChart size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Nilai Kinerja Organisasi (NKO)
                </h1>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Kinerja & Evaluasi
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Perhitungan pencapaian, nilai, total, dan NKO akhir per unit (UP3 & ULP) serta peringkat berbasis formula workbook resmi PLN.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={() => {
                loadSnapshot()
                if (tab === 'ranking') loadRanking()
                if (tab === 'inputs') loadInputs()
              }}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canCalculate && (
              <Button
                variant="primary"
                size="md"
                icon={IconCalculator}
                onClick={() => setIsCalculateOpen(true)}
              >
                Hitung NKO
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">NKO Akhir</dt>
            <span className="rounded-lg p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600"><IconChart size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {d?.nko != null ? fmt(d.nko) : '-'}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {d?.complete ? 'Semua indikator lengkap' : d ? `${d.missing_count} belum lengkap` : 'Pilih unit & hitung'}
          </p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Peringkat ULP</dt>
            <span className="rounded-lg p-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600"><IconCheckCircle size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
            {d?.rank ? `#${d.rank}` : '-'}
            {d?.rank_of ? <span className="text-sm font-normal text-slate-400"> / {d.rank_of} ULP</span> : ''}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Peringkat di UP3 terpilih</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Nilai</dt>
            <span className="rounded-lg p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600"><IconLayers size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-blue-600 dark:text-blue-400">
            {d?.total_nilai != null ? fmt(d.total_nilai) : '-'}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Akumulasi bobot × pencapaian</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Periode Evaluasi</dt>
            <span className="rounded-lg p-1.5 bg-amber-50 dark:bg-amber-950/50 text-amber-600"><IconCalendar size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {MONTH_NAMES[month - 1]} {year}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {d?.calculated_at ? `Dihitung: ${fmtDate(d.calculated_at)}` : 'Realisasi kumulatif YTD'}
          </p>
        </div>
      </dl>

      {/* Filter Bar */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <HierarchicalUnitFilter
            permission="nko.view"
            up3Id={up3Id}
            onUp3Change={(v) => setUp3Id(v)}
            unitId={unitId}
            onUnitChange={(v) => setUnitId(v)}
            up3AriaLabel="Filter UP3"
            unitAriaLabel="Filter ULP"
          />

          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span>Tahun</span>
            <input
              type="number"
              min="2020"
              max="2030"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Tahun NKO"
              className={`${filterControlCls} w-24 tabular-nums`}
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <span>Bulan</span>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="Bulan NKO"
              className={filterSelectCls}
            >
              {MONTH_NAMES.map((m, idx) => (
                <option key={idx + 1} value={idx + 1}>{m}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Underline Tabs */}
      <div role="tablist" aria-label="Tampilan NKO" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {[
          ['details', 'Rincian Indikator & Nilai'],
          ['ranking', 'Peringkat ULP'],
          ['inputs', 'Masukan Realisasi Manual'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
              tab === id
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Rincian Indikator & Nilai */}
      {tab === 'details' && (
        <div className={`${CARD} overflow-hidden`}>
          {!unitId ? (
            <div className="p-8">
              <Alert kind="info">Pilih satu unit (ULP atau UP3) pada bilah filter di atas untuk melihat rincian NKO.</Alert>
            </div>
          ) : snapshotState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat rincian indikator NKO..." />
            </div>
          ) : snapshotState.error ? (
            <div className="p-5">
              <Alert kind="error">{snapshotState.error}</Alert>
            </div>
          ) : !d ? (
            <div className="p-8">
              <EmptyState
                title="NKO Belum Dihitung"
                desc={`Snapshot NKO untuk unit ini pada periode ${MONTH_NAMES[month - 1]} ${year} belum tersedia. Klik tombol Hitung NKO untuk memproses.`}
              />
            </div>
          ) : (
            <div>
              {d.missing && d.missing.length > 0 && (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <IconAlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold">Perhatian: {d.missing.length} indikator belum lengkap</span>
                    <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                      Indikator tanpa realisasi dihitung bernilai 0: {d.missing.map((m) => m.name).join(', ')}.
                    </p>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4 w-12 text-center">No</th>
                      <th className="py-3 px-4">Indikator Kinerja</th>
                      <th className="py-3 px-3">Polaritas</th>
                      <th className="py-3 px-3 text-right">Bobot</th>
                      <th className="py-3 px-3 text-right">Target Kumulatif</th>
                      <th className="py-3 px-3 text-right">Realisasi</th>
                      <th className="py-3 px-3 text-center">Sumber</th>
                      <th className="py-3 px-3 text-right">Pencapaian (%)</th>
                      <th className="py-3 px-4 text-right">Nilai Akhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {d.values.map((v, idx) => {
                      const isGroup = v.level === 0
                      const polarityInfo = POLARITY_LABELS[v.polarity]

                      return (
                        <tr
                          key={v.code || idx}
                          className={`${
                            isGroup
                              ? 'bg-slate-50/90 dark:bg-slate-800/70 font-bold text-slate-900 dark:text-slate-100'
                              : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="py-2.5 px-4 text-center font-mono text-[11px] text-slate-400">
                            {v.number || '-'}
                          </td>
                          <td className={`py-2.5 px-4 ${v.level === 2 ? 'pl-8' : v.level === 1 ? 'pl-6' : ''}`}>
                            <div className={isGroup ? 'text-xs text-indigo-950 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-200'}>
                              {v.name}
                            </div>
                            {v.unit_label && (
                              <span className="text-[10px] font-normal text-slate-400">
                                Satuan: {v.unit_label}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {polarityInfo && (
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${polarityInfo.cls}`}>
                                {polarityInfo.label}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {v.weight != null ? fmt(v.weight, 2) : v.weight_note || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {typeof v.target === 'number' ? fmt(v.target) : v.target || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {v.realisasi != null ? fmt(v.realisasi) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <SourceBadge source={v.source} />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                            {v.pencapaian != null ? `${fmt(v.pencapaian)}%` : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-indigo-700 dark:text-indigo-300">
                            {v.nilai != null ? fmt(v.nilai) : '-'}
                          </td>
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

      {/* Tab 2: Peringkat ULP */}
      {tab === 'ranking' && (
        <div className={`${CARD} p-5 space-y-4`}>
          {!targetUp3 ? (
            <Alert kind="info">Pilih satu UP3 pada bilah filter di atas untuk melihat peringkat ULP.</Alert>
          ) : rankingState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat peringkat ULP..." />
            </div>
          ) : rankingState.error ? (
            <Alert kind="error">{rankingState.error}</Alert>
          ) : !rankingState.data?.ulp?.length ? (
            <EmptyState
              title="Belum Ada Peringkat"
              desc={`Peringkat ULP untuk periode ${MONTH_NAMES[month - 1]} ${year} belum dihitung. Klik Hitung NKO.`}
            />
          ) : (
            <div className="space-y-4">
              {/* Highlight NKO UP3 */}
              {rankingState.data.up3 && (
                <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Capaian UP3</span>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{rankingState.data.up3.unit_name}</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">NKO UP3:</span>{' '}
                    <span className="text-xl font-bold font-mono text-indigo-700 dark:text-indigo-300">
                      {fmt(rankingState.data.up3.nko)}
                    </span>
                  </div>
                </div>
              )}

              {/* Tabel Peringkat ULP */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4 w-16 text-center">Peringkat</th>
                      <th className="py-3 px-4">Unit Layanan Pelanggan (ULP)</th>
                      <th className="py-3 px-4 text-right">Nilai NKO Akhir</th>
                      <th className="py-3 px-4 text-right">Total Nilai</th>
                      <th className="py-3 px-4 text-center">Kelengkapan Data</th>
                      <th className="py-3 px-4">Waktu Perhitungan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rankingState.data.ulp.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-bold font-mono text-xs ${
                              r.rank === 1
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : r.rank <= 3
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            #{r.rank}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          {r.unit_name}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-base text-indigo-700 dark:text-indigo-300">
                          {fmt(r.nko)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {fmt(r.total_nilai)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {r.complete ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                              Lengkap
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              {r.missing_count} Belum Lengkap
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {fmtDate(r.calculated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Masukan Realisasi Manual */}
      {tab === 'inputs' && (
        <div className={`${CARD} p-5 space-y-4`}>
          {!unitId ? (
            <Alert kind="info">Pilih satu unit (ULP atau UP3) pada bilah filter di atas untuk mengelola masukan manual.</Alert>
          ) : inputsState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat daftar masukan manual..." />
            </div>
          ) : inputsState.error ? (
            <Alert kind="error">{inputsState.error}</Alert>
          ) : !inputsState.data?.items?.length ? (
            <EmptyState
              title="Tidak Ada Indikator Masukan"
              desc="Definisi NKO belum diimpor atau tidak memiliki indikator masukan pada periode ini."
            />
          ) : (
            <form onSubmit={handleSaveInputs} className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100">
                    Masukan Realisasi Kumulatif (YTD)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Nilai realisasi kumulatif dari Januari s/d {MONTH_NAMES[month - 1]} {year}. Sumber SISTEM otomatis terisi dari DIFI / 309 jika berkas tersedia.
                  </p>
                </div>
                {canInput && (
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={savingInputs}
                  >
                    Simpan Masukan
                  </Button>
                )}
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/40 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <IconInfo size={16} className="mt-0.5 shrink-0 text-blue-600" />
                <span>
                  Menyimpan masukan manual tidak langsung mengubah skor NKO. Jalankan <strong>Hitung NKO</strong> setelah menyimpan perubahan agar snapshot diperbarui.
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Indikator Kinerja</th>
                      <th className="py-2.5 px-3">Grup / Kelompok</th>
                      <th className="py-2.5 px-3 text-right">Target</th>
                      <th className="py-2.5 px-3 text-right">Nilai Sistem</th>
                      <th className="py-2.5 px-3 text-center">Sumber Aktif</th>
                      <th className="py-2.5 px-3 w-40">Nilai Manual</th>
                      <th className="py-2.5 px-3 w-48">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inputsState.data.items.map((it) => {
                      const draft = inputsDraft[it.code] || { value: '', note: '' }
                      const isEditable = it.editable && canInput

                      return (
                        <tr key={it.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{it.name}</span>
                              {it.system_source && it.system_validated === false && (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                  title="Nilai sistem dimuat otomatis tetapi belum tervalidasi terhadap workbook (dapat dikoreksi manual dengan alasan)"
                                >
                                  Perlu Validasi
                                </span>
                              )}
                            </div>
                            {it.unit_label && (
                              <span className="block text-[10px] font-normal text-slate-400">Satuan: {it.unit_label}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">{it.group || '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {typeof it.target === 'number' ? fmt(it.target) : it.target || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {it.system != null ? fmt(it.system) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <SourceBadge source={it.source} />
                          </td>
                          <td className="py-2 px-3">
                            {isEditable ? (
                              <input
                                type="number"
                                step="any"
                                value={draft.value}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setInputsDraft((prev) => ({
                                    ...prev,
                                    [it.code]: { ...prev[it.code], value: val },
                                  }))
                                }}
                                placeholder={it.system != null ? String(it.system) : 'Isi manual…'}
                                className={`${filterControlCls} w-full font-mono tabular-nums`}
                              />
                            ) : (
                              <span className="font-mono text-slate-400 text-xs">
                                {it.value != null ? fmt(it.value) : 'Tetap (100)'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {isEditable ? (
                              <input
                                type="text"
                                value={draft.note}
                                onChange={(e) => {
                                  const n = e.target.value
                                  setInputsDraft((prev) => ({
                                    ...prev,
                                    [it.code]: { ...prev[it.code], note: n },
                                  }))
                                }}
                                placeholder={it.system != null ? 'Alasan koreksi (wajib jika ubah sistem)' : 'Catatan masukan'}
                                className={`${filterControlCls} w-full`}
                              />
                            ) : (
                              <span className="text-slate-400 text-xs">{it.note || '-'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Modal Calculate */}
      <CalculateModal
        isOpen={isCalculateOpen}
        onClose={() => setIsCalculateOpen(false)}
        year={year}
        month={month}
        unitId={unitId}
        up3Id={up3Id}
        onCalculated={() => {
          loadSnapshot()
          if (tab === 'ranking') loadRanking()
        }}
      />
    </div>
  )
}
