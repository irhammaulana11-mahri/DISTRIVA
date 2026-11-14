import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { khsMaterialMapApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import { downloadCsv, KHS_MATERIAL_MAP_TEMPLATE } from '../../utils/csvTemplates.js'
import {
  IconSearch,
  IconRefresh,
  IconUpload,
  IconTrash,
  IconCheck,
  IconCheckCircle,
  IconAlertCircle,
  IconTag,
  IconClipboard,
  IconDownload,
  IconPlus,
  IconX,
  IconInfo,
} from '../../components/icons.jsx'

const SUPPLY_HINT_STORAGE_KEY = 'distriva.khs_map.hide_supply_hint.v1'

function formatServerError(err, fallback) {
  if (err?.response?.data?.message) return err.response.data.message
  if (err?.message) return err.message
  if (err?.errors && typeof err.errors === 'object') {
    const first = Object.values(err.errors).find((v) => Array.isArray(v) && v.length > 0)
    if (first) return String(first[0])
  }
  return fallback
}

function SupplyStatusBadge({ status }) {
  if (status === 'PLN') {
    return (
      <span
        title="Material disediakan PLN — butuh SKU ERP"
        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 whitespace-nowrap"
      >
        PLN · Butuh SKU
      </span>
    )
  }
  if (status === 'PRICED') {
    return (
      <span
        title="Material dibeli vendor — tidak butuh SKU ERP"
        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap"
      >
        PRICED · Tidak butuh SKU ERP
      </span>
    )
  }
  return null
}

export default function KhsMaterialMapPage() {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['khs.manage'])

  // Workbench Left Panel State
  const [filter, setFilter] = useState('unmapped') // 'unmapped' | 'mapped' | 'all'
  const [usedOnly, setUsedOnly] = useState(true)
  const [supplyPlnOnly, setSupplyPlnOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [khsList, setKhsList] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState('')
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [showSupplyHint, setShowSupplyHint] = useState(() => {
    try {
      return window.localStorage.getItem(SUPPLY_HINT_STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })
  const workbenchReqSeqRef = useRef(0)

  const handleDismissSupplyHint = () => {
    setShowSupplyHint(false)
    try {
      window.localStorage.setItem(SUPPLY_HINT_STORAGE_KEY, '1')
    } catch {
      // Abaikan kegagalan localStorage (mode privat / storage diblokir)
    }
  }

  // Selected KHS
  const [selectedKhs, setSelectedKhs] = useState(null)

  // Right Panel: Suggestions & Active Mappings
  const [suggestions, setSuggestions] = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [choosingSku, setChoosingSku] = useState(null)

  // Manual Mapping Form
  const [manualSku, setManualSku] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [mappingError, setMappingError] = useState('')

  // Exemption Dialog States
  const [exemptTarget, setExemptTarget] = useState(null)
  const [liftTarget, setLiftTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Coverage Stats
  const [coverage, setCoverage] = useState(null)
  const [loadingCoverage, setLoadingCoverage] = useState(false)

  // Load Coverage Stats
  const loadCoverage = useCallback(async () => {
    setLoadingCoverage(true)
    try {
      const res = await khsMaterialMapApi.coverage()
      setCoverage(res?.data || null)
    } catch {
      // Non-critical, ignore
    } finally {
      setLoadingCoverage(false)
    }
  }, [])

  // Load KHS Workbench List
  const loadWorkbench = useCallback(async () => {
    const reqSeq = ++workbenchReqSeqRef.current
    setLoadingList(true)
    setListError('')
    try {
      const params = {
        filter: filter === 'exempt' ? 'unmapped' : filter,
        used: usedOnly ? 1 : 0,
        page,
        per_page: perPage,
      }
      if (supplyPlnOnly && filter !== 'exempt') {
        params.supply = 'pln'
      }
      if (search.trim()) {
        params.search = search.trim()
      }

      const res = await khsMaterialMapApi.workbench(params)
      if (reqSeq !== workbenchReqSeqRef.current) return

      let items = res?.data || []
      if (filter === 'exempt') {
        items = items.filter((i) => Boolean(i.sku_exempt))
      }
      setKhsList(items)
      setMeta(
        filter === 'exempt'
          ? { ...(res?.meta || {}), total: items.length }
          : res?.meta || null
      )

      // Auto-select first item if current selection not in list or null
      if (items.length > 0) {
        setSelectedKhs((prev) => {
          if (!prev) return items[0]
          const existing = items.find((i) => i.khs_code === prev.khs_code)
          return existing || items[0]
        })
      } else {
        setSelectedKhs(null)
      }
    } catch (err) {
      if (reqSeq !== workbenchReqSeqRef.current) return
      setListError(formatServerError(err, 'Gagal memuat meja kerja pemetaan material.'))
    } finally {
      if (reqSeq === workbenchReqSeqRef.current) {
        setLoadingList(false)
      }
    }
  }, [filter, usedOnly, supplyPlnOnly, search, page, perPage])

  useEffect(() => {
    loadCoverage()
  }, [loadCoverage])

  useEffect(() => {
    loadWorkbench()
  }, [loadWorkbench])

  // Load Suggestions when Selected KHS changes
  useEffect(() => {
    if (!selectedKhs?.khs_code) {
      setSuggestions([])
      return
    }
    let live = true
    setLoadingSuggestions(true)
    setSuggestionError('')
    setMappingError('')

    khsMaterialMapApi
      .suggestions(selectedKhs.khs_code, 10)
      .then((res) => {
        if (!live) return
        setSuggestions(res?.data || [])
      })
      .catch((err) => {
        if (!live) return
        setSuggestionError(formatServerError(err, 'Gagal memuat saran kecocokan SKU.'))
      })
      .finally(() => {
        if (live) setLoadingSuggestions(false)
      })

    return () => {
      live = false
    }
  }, [selectedKhs?.khs_code])

  // Handle Choose Suggestion or Create Map
  const handleMapSku = async (materialNo, note = '') => {
    if (!selectedKhs?.khs_code || !materialNo) return
    setChoosingSku(materialNo)
    setMappingError('')
    try {
      await khsMaterialMapApi.create({
        khs_code: selectedKhs.khs_code,
        material_no: materialNo.trim(),
        note: note ? note.trim() : undefined,
      })
      notify({
        type: 'success',
        title: 'Pemetaan Berhasil Disimpan',
        desc: `Material ERP ${materialNo} berhasil dipetakan ke KHS ${selectedKhs.khs_code}.`,
        tag: 'PEMETAAN',
      })
      setManualSku('')
      setManualNote('')
      loadWorkbench()
      loadCoverage()
    } catch (err) {
      const msg = formatServerError(err, 'Gagal menyimpan pemetaan material.')
      setMappingError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menyimpan Pemetaan',
        desc: msg,
        tag: 'PEMETAAN',
      })
    } finally {
      setChoosingSku(null)
    }
  }

  // Handle Delete Mapping
  const handleDeleteMap = (mapId, materialNo) => {
    setDeleteTarget({ id: mapId, materialNo })
  }

  const handleConfirmDeleteMap = async () => {
    if (!deleteTarget) return
    try {
      await khsMaterialMapApi.delete(deleteTarget.id)
      notify({
        type: 'success',
        title: 'Pemetaan Dihapus',
        desc: `Pemetaan untuk ${deleteTarget.materialNo} telah dihapus.`,
        tag: 'PEMETAAN',
      })
      setDeleteTarget(null)
      loadWorkbench()
      loadCoverage()
    } catch (err) {
      const msg = err?.message || 'Gagal menghapus pemetaan.'
      setMappingError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menghapus Pemetaan',
        desc: msg,
        tag: 'PEMETAAN',
      })
    }
  }

  // Handle Exempt KHS Item
  const handleConfirmExempt = async (reason) => {
    if (!exemptTarget?.khs_code) return
    try {
      await khsMaterialMapApi.exempt({
        khs_code: exemptTarget.khs_code,
        reason: reason.trim(),
      })
      notify({
        type: 'success',
        title: 'Pengecualian Berhasil Disimpan',
        desc: `KHS ${exemptTarget.khs_code} berhasil dikecualikan dari pemetaan.`,
        tag: 'PEMETAAN',
      })
      setExemptTarget(null)
      loadWorkbench()
      loadCoverage()
    } catch (err) {
      const msg = formatServerError(err, 'Gagal mengecualikan KHS dari pemetaan.')
      throw new Error(msg)
    }
  }

  // Handle Lift Exemption
  const handleConfirmLift = async (reason) => {
    if (!liftTarget?.khs_code) return
    try {
      await khsMaterialMapApi.liftExempt(liftTarget.khs_code, {
        reason: reason.trim(),
      })
      notify({
        type: 'success',
        title: 'Pengecualian Berhasil Dicabut',
        desc: `Pengecualian KHS ${liftTarget.khs_code} berhasil dicabut.`,
        tag: 'PEMETAAN',
      })
      setLiftTarget(null)
      loadWorkbench()
      loadCoverage()
    } catch (err) {
      const msg = formatServerError(err, 'Gagal mencabut pengecualian KHS.')
      throw new Error(msg)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header Modul Pemetaan Material ERP ke KHS */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconClipboard className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Master Data</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Pemetaan Material (SKU↔KHS)</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Meja Kerja Pemetaan Material ERP ke KHS
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Sinkronisasi SKU ↔ KHS
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Menghubungkan nomor material logistik ERP (SKU) dengan kode item standar KHS yang dipakai pada BOM dan MTO.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={() => {
                loadCoverage()
                loadWorkbench()
              }}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canManage && (
              <button
                type="button"
                onClick={() => navigate('/master-data/mapping/impor')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-3.5 py-2 text-xs shadow-xs transition focus-ring cursor-pointer"
              >
                <IconUpload size={14} />
                <span>Impor CSV Pemetaan</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Coverage KPI Widget */}
      {coverage && (() => {
        const skuNeededTotal = Number(coverage.sku_needed_total ?? 0) || 0
        const skuNeededMapped = skuNeededTotal === 0 ? 0 : (Number(coverage.sku_needed_mapped ?? 0) || 0)
        const skuNeededPercent =
          skuNeededTotal === 0
            ? 0
            : Number.isFinite(Number(coverage.sku_needed_percent))
            ? Number(coverage.sku_needed_percent)
            : Number(((skuNeededMapped * 100) / skuNeededTotal).toFixed(1))

        const khsUsedTotal = Number(coverage.khs_used_total ?? coverage.khs_used_total_count ?? 0) || 0
        const khsUsedMapped =
          khsUsedTotal === 0
            ? 0
            : (Number(coverage.khs_used_mapped ?? coverage.khs_used_mapped_count ?? 0) || 0)
        const khsUsedPercent =
          khsUsedTotal === 0
            ? 0
            : Number.isFinite(Number(coverage.khs_used_percent))
            ? Number(coverage.khs_used_percent)
            : Number.isFinite(Number(coverage.khs_used_coverage_percent))
            ? Number(coverage.khs_used_coverage_percent)
            : Number.isFinite(Number(coverage.coverage_percent))
            ? Number(coverage.coverage_percent)
            : Number(((khsUsedMapped * 100) / khsUsedTotal).toFixed(1))

        const snapshotMapped =
          coverage.last_snapshot_mapped_skus ??
          (Array.isArray(coverage.latest_snapshots)
            ? coverage.latest_snapshots.reduce((sum, s) => sum + Number(s.materials_mapped || 0), 0)
            : 0)
        const snapshotTotal =
          coverage.last_snapshot_total_skus ??
          (Array.isArray(coverage.latest_snapshots)
            ? coverage.latest_snapshots.reduce((sum, s) => sum + Number(s.materials_total || 0), 0)
            : 0)

        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                KHS PLN terpetakan
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {skuNeededMapped} dari {skuNeededTotal}
                </span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  ({skuNeededPercent}%)
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                Semua KHS dipakai BOM: {khsUsedMapped} dari {khsUsedTotal} ({khsUsedPercent}%)
              </p>
            </div>

            <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Total KHS Terpetakan
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {coverage.khs_mapped_count ?? khsUsedMapped}
                </span>
                <span className="text-xs text-slate-500">
                  / {coverage.khs_total_count ?? khsUsedTotal} seluruh KHS
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                {coverage.total_mappings ?? khsUsedMapped} tautan pasangan SKU↔KHS aktif.
              </p>
            </div>

            <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                SKU Terpetakan Cuplikan Terakhir
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {snapshotMapped}
                </span>
                <span className="text-xs text-slate-500">
                  / {snapshotTotal} item material fisik
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Berdasarkan cuplikan stok logistik ERP terbaru.
              </p>
            </div>
          </div>
        )
      })()}

      {listError && <Alert kind="error">{listError}</Alert>}

      {/* Two-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT PANEL: KHS Items to Map (cols 7) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          {/* Panel Filter Bar */}
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Status:
                  </span>
                  <select
                    aria-label="Filter status pemetaan"
                    value={filter}
                    onChange={(e) => {
                      const val = e.target.value
                      setFilter(val)
                      if (val === 'exempt') {
                        setSupplyPlnOnly(false)
                      }
                      setPage(1)
                    }}
                    className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="unmapped">Belum Dipetakan</option>
                    <option value="mapped">Sudah Dipetakan</option>
                    <option value="exempt">Tampilkan yang dikecualikan</option>
                    <option value="all">Semua KHS</option>
                  </select>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={usedOnly}
                    onChange={(e) => {
                      setUsedOnly(e.target.checked)
                      setPage(1)
                    }}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Dipakai BOM Saja</span>
                </label>

                <label className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supplyPlnOnly}
                    onChange={(e) => {
                      setSupplyPlnOnly(e.target.checked)
                      if (e.target.checked && filter === 'exempt') {
                        setFilter('unmapped')
                      }
                      setPage(1)
                    }}
                    className="rounded border-blue-300 text-blue-600"
                  />
                  <span>Butuh SKU (material PLN)</span>
                </label>

                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filter === 'exempt'}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFilter('exempt')
                        setSupplyPlnOnly(false)
                      } else {
                        setFilter('unmapped')
                      }
                      setPage(1)
                    }}
                    className="rounded border-slate-300 text-amber-600"
                  />
                  <span>Tampilkan yang dikecualikan</span>
                </label>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {meta && (
                  <span className="text-[11px] text-slate-500 font-mono">
                    Total {meta.total ?? khsList.length} item
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    loadWorkbench()
                    loadCoverage()
                  }}
                  title="Segarkan Data"
                  aria-label="Segarkan"
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <IconRefresh size={14} />
                </button>
              </div>
            </div>

            <div className="relative">
              <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari kode atau uraian KHS..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="block w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          </div>

          {/* Dismissible Supply Helper Text */}
          {showSupplyHint && (
            <div
              role="status"
              className="px-3.5 py-2.5 bg-blue-50/70 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/50 flex items-start justify-between gap-2 text-[11px] text-blue-900 dark:text-blue-200"
            >
              <div className="flex items-start gap-2">
                <IconInfo size={14} className="shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                <span>
                  Hanya material berstatus PLN yang perlu SKU ERP. Material vendor (PRICED) tidak keluar dari gudang PLN.
                </span>
              </div>
              <button
                type="button"
                onClick={handleDismissSupplyHint}
                aria-label="Tutup teks bantuan"
                title="Tutup bantuan"
                className="shrink-0 p-0.5 rounded text-blue-500 hover:text-blue-800 dark:hover:text-blue-100 hover:bg-blue-100/70 dark:hover:bg-blue-900/40 transition cursor-pointer"
              >
                <IconX size={14} />
              </button>
            </div>
          )}

          {/* Workbench Table */}
          {(() => {
            const displayedKhsList = khsList

            if (loadingList) {
              return (
                <div className="py-20 text-center text-slate-500">
                  <Spinner size="lg" label="Memuat meja kerja KHS..." />
                </div>
              )
            }

            if (khsList.length === 0) {
              return (
                <>
                  <EmptyState
                    icon={IconTag}
                    title="Belum ada pemetaan material"
                    description="Tidak ada data item KHS yang cocok dengan kriteria filter pencarian."
                  />
                  <TableFooter
                    itemCount={0}
                    total={meta?.total ?? 0}
                    entityLabel="item KHS"
                    page={page}
                    perPage={perPage}
                    onPage={setPage}
                    onPerPage={(n) => {
                      setPerPage(n)
                      setPage(1)
                    }}
                    perPageOptions={[10, 25, 50, 100]}
                  />
                </>
              )
            }

            return (
              <>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 sticky top-0 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3">Kode KHS</th>
                        <th className="py-2.5 px-3">Uraian Material</th>
                        <th className="py-2.5 px-3">Pasokan</th>
                        <th className="py-2.5 px-3">Satuan</th>
                        <th className="py-2.5 px-3">SKU Terpetakan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                      {displayedKhsList.map((k) => {
                        const isSelected = selectedKhs?.khs_code === k.khs_code
                        return (
                          <tr
                            key={k.khs_code}
                            onClick={() => setSelectedKhs(k)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-blue-50/90 dark:bg-blue-950/50 border-l-4 border-l-blue-600'
                                : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                              <div className="flex items-center gap-1.5">
                                <span>{k.khs_code}</span>
                                {k.used_in_bom && (
                                  <span
                                    title="Dipakai dalam BOM Standar Konstruksi"
                                    className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800"
                                  >
                                    BOM
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 font-medium">
                              {k.name}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap items-center gap-1">
                                <SupplyStatusBadge status={k.material_status} />
                                {k.sku_exempt && (
                                  <span
                                    title={k.exempt_reason ? `Dikecualikan: ${k.exempt_reason}` : 'Dikecualikan dari pemetaan'}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 whitespace-nowrap"
                                  >
                                    Dikecualikan
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                              {k.unit}
                            </td>
                            <td className="py-2.5 px-3">
                              {k.sku_exempt ? (
                                <div className="space-y-1">
                                  <span className="text-amber-700 dark:text-amber-400 text-[10px] italic block">
                                    {k.exempt_reason ? `Dikecualikan: ${k.exempt_reason}` : 'Dikecualikan dari pemetaan'}
                                  </span>
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setLiftTarget(k)
                                      }}
                                      className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
                                    >
                                      Cabut pengecualian
                                    </button>
                                  )}
                                </div>
                              ) : k.mapped && k.mapped.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {k.mapped.map((m, idx) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                    >
                                      {m.material_no}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[10px] italic">Belum dipetakan</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <TableFooter
                  itemCount={displayedKhsList.length}
                  total={meta?.total ?? khsList.length}
                  entityLabel="item KHS"
                  page={page}
                  perPage={perPage}
                  onPage={setPage}
                  onPerPage={(n) => {
                    setPerPage(n)
                    setPage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              </>
            )
          })()}
        </div>

        {/* RIGHT PANEL: SKU Suggestions & Mapping Actions (cols 5) */}
        <div className="lg:col-span-5 space-y-4">
          {!selectedKhs ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
              Pilih satu baris KHS pada panel sebelah kiri untuk melihat saran SKU ERP dan melakukan pemetaan.
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs p-4 space-y-4">
              {/* Selected KHS Details */}
              <div className="pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md font-mono font-bold text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                      {selectedKhs.khs_code}
                    </span>
                    {selectedKhs.used_in_bom && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        Dipakai BOM
                      </span>
                    )}
                    <SupplyStatusBadge status={selectedKhs.material_status} />
                    {selectedKhs.sku_exempt && (
                      <span
                        title={selectedKhs.exempt_reason ? `Dikecualikan: ${selectedKhs.exempt_reason}` : 'Dikecualikan dari pemetaan'}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 whitespace-nowrap"
                      >
                        Dikecualikan
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {canManage && !selectedKhs.sku_exempt && (!selectedKhs.mapped || selectedKhs.mapped.length === 0) && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setExemptTarget(selectedKhs)}
                        className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      >
                        Kecualikan dari pemetaan
                      </Button>
                    )}
                    {canManage && selectedKhs.sku_exempt && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setLiftTarget(selectedKhs)}
                        className="text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        Cabut pengecualian
                      </Button>
                    )}
                  </div>
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  {selectedKhs.name}
                </h3>
                <p className="text-xs text-slate-500">Satuan KHS: <strong className="font-mono text-slate-700 dark:text-slate-300">{selectedKhs.unit}</strong></p>
              </div>

              {selectedKhs.sku_exempt && (
                <div
                  role="alert"
                  className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-xs space-y-1 text-amber-900 dark:text-amber-200"
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <IconAlertCircle size={14} className="shrink-0 text-amber-600" />
                    <span>Item Ini Dikecualikan dari Pemetaan</span>
                  </div>
                  {selectedKhs.exempt_reason && (
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      <strong>Alasan:</strong> {selectedKhs.exempt_reason}
                    </p>
                  )}
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 italic">
                    Material ini sengaja tidak dipetakan ke SKU ERP. Untuk memetakannya kembali, klik tombol "Cabut pengecualian" di atas.
                  </p>
                </div>
              )}

              {mappingError && <Alert kind="error">{mappingError}</Alert>}

              {selectedKhs.material_status === 'PRICED' && (
                <div
                  role="note"
                  className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2"
                >
                  <IconInfo size={14} className="shrink-0 text-slate-500 dark:text-slate-400 mt-0.5" />
                  <span>Material ini dibeli vendor; pemetaan SKU biasanya tidak diperlukan.</span>
                </div>
              )}

              {/* Disclaimer Banner */}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <IconAlertCircle size={14} className="shrink-0 text-amber-600" />
                  <span>Pemeriksaan Spesifikasi Wajib</span>
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  Saran kecocokan hanyalah usulan sistem berdasarkan kemiripan nama material. Pengguna wajib memeriksa kesesuaian spesifikasi teknik sebelum memilih.
                </p>
              </div>

              {/* Existing Active Mappings */}
              {selectedKhs.mapped && selectedKhs.mapped.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Pemetaan Aktif Saat Ini ({selectedKhs.mapped.length})
                  </h4>
                  <div className="divide-y border rounded-lg overflow-hidden">
                    {selectedKhs.mapped.map((m) => (
                      <div
                        key={m.id || m.material_no}
                        className="p-2.5 flex items-center justify-between text-xs bg-emerald-50/40 dark:bg-emerald-950/20"
                      >
                        <div>
                          <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                            {m.material_no}
                          </span>
                          {m.note && (
                            <p className="text-[11px] text-slate-500 italic mt-0.5">{m.note}</p>
                          )}
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMap(m.id, m.material_no)}
                            className="p-1 rounded text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="Hapus Pemetaan"
                          >
                            <IconTrash size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Saran Material ERP (Kandidat SKU)
                  </h4>
                  {loadingSuggestions && <Spinner size="xs" label="" />}
                </div>

                {suggestionError && <Alert kind="error">{suggestionError}</Alert>}

                {loadingSuggestions ? (
                  <div className="py-6 text-center text-slate-400 text-xs">
                    Menganalisis kemiripan katalog material ERP...
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/40 rounded-lg">
                    Tidak ditemukan saran kecocokan otomatis untuk kode KHS ini. Gunakan kolom pemetaan manual di bawah.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {suggestions.map((s, idx) => {
                      const isAlreadyMapped = selectedKhs.mapped?.some((m) => m.material_no === s.material_no)
                      return (
                        <div
                          key={idx}
                          className="p-2.5 border rounded-xl hover:border-blue-300 transition space-y-1.5 bg-slate-50/50 dark:bg-slate-800/30"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                                  {s.material_no}
                                </span>
                                {s.score !== undefined && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">
                                    Skor: {Math.round(s.score * 100)}%
                                  </span>
                                )}
                                {s.unit && (
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    ({s.unit})
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                                {s.name || s.material_name}
                              </p>
                              {s.source && (
                                <p className="text-[10px] text-slate-400">Sumber: {s.source}</p>
                              )}
                            </div>

                            {canManage && (
                              <Button
                                variant="primary"
                                size="xs"
                                disabled={isAlreadyMapped}
                                loading={choosingSku === s.material_no}
                                onClick={() => handleMapSku(s.material_no)}
                              >
                                {isAlreadyMapped ? 'Sudah Dipilih' : 'Pilih SKU'}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Manual Mapping Input */}
              {canManage && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Pemetaan Manual Bebas
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Ketik nomor material ERP (SKU) secara langsung jika tidak terdapat dalam daftar saran di atas.
                  </p>

                  <div className="space-y-2">
                    <div>
                      <input
                        type="text"
                        placeholder="Nomor Material ERP (SKU) *"
                        value={manualSku}
                        onChange={(e) => setManualSku(e.target.value)}
                        className="block w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Catatan alasan pemetaan (opsional)"
                        value={manualNote}
                        onChange={(e) => setManualNote(e.target.value)}
                        className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!manualSku.trim()}
                        loading={choosingSku === manualSku}
                        onClick={() => handleMapSku(manualSku, manualNote)}
                      >
                        Petakan Manual
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>


      {/* Exemption Reason Dialog */}
      {exemptTarget && (
        <ReasonDialog
          open={Boolean(exemptTarget)}
          title={`Kecualikan KHS ${exemptTarget.khs_code} dari Pemetaan`}
          description={`Item KHS "${exemptTarget.name}" akan dikecualikan dari kewajiban pemetaan SKU ERP (mis. kubikel paket yang diminta setelah bayar). Masukkan alasan pengecualian.`}
          confirmLabel="Kecualikan"
          confirmVariant="primary"
          onConfirm={handleConfirmExempt}
          onClose={() => setExemptTarget(null)}
        />
      )}

      {/* Lift Exemption Reason Dialog */}
      {liftTarget && (
        <ReasonDialog
          open={Boolean(liftTarget)}
          title={`Cabut Pengecualian KHS ${liftTarget.khs_code}`}
          description={`Pengecualian untuk item KHS "${liftTarget.name}" akan dicabut sehingga membutuhkan pemetaan SKU ERP kembali. Masukkan alasan pencabutan.`}
          confirmLabel="Cabut Pengecualian"
          confirmVariant="danger"
          onConfirm={handleConfirmLift}
          onClose={() => setLiftTarget(null)}
        />
      )}

      {/* Delete Mapping Confirmation Modal */}
      <ConfirmationModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDeleteMap}
        title="Hapus Pemetaan Material ERP"
        description={`Apakah Anda yakin ingin menghapus pemetaan material ERP ${deleteTarget?.materialNo || ''} dari kode KHS ini?`}
        confirmLabel="Hapus Pemetaan"
        variant="danger"
      />
    </div>
  )
}
