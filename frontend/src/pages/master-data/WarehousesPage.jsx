import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { warehousesApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { downloadCsv, STOCK_SNAPSHOT_TEMPLATE } from '../../utils/csvTemplates.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import Drawer from '../../components/Drawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import MimsMirrorTab from './MimsMirrorTab.jsx'
import {
  IconPlus,
  IconRefresh,
  IconSearch,
  IconDownload,
  IconUpload,
  IconCheck,
  IconCheckCircle,
  IconEye,
  IconBuilding,
  IconFileText,
} from '../../components/icons.jsx'

export default function WarehousesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { can } = useAccess()
  const { notify } = useNotifications()

  const canManage = Boolean(can?.['warehouses.manage'])
  const canImportStock = Boolean(can?.['stock.import'])

  const [activeTab, setActiveTab] = useState('warehouses') // 'warehouses' | 'position' | 'sync-runs'
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Pagination states
  const [whPage, setWhPage] = useState(1)
  const [whPerPage, setWhPerPage] = useState(10)
  const [posPage, setPosPage] = useState(1)
  const [posPerPage, setPosPerPage] = useState(10)
  const [syncPage, setSyncPage] = useState(1)
  const [syncPerPage, setSyncPerPage] = useState(10)

  // Warehouse Snapshots Drawer
  const [selectedWarehouse, setSelectedWarehouse] = useState(null)
  const [snapshotsDrawerOpen, setSnapshotsDrawerOpen] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)

  // Snapshot Detail Drawer
  const [selectedSnapshot, setSelectedSnapshot] = useState(null)
  const [snapshotDetailDrawerOpen, setSnapshotDetailDrawerOpen] = useState(false)
  const [snapshotDetail, setSnapshotDetail] = useState(null)
  const [loadingSnapshotDetail, setLoadingSnapshotDetail] = useState(false)
  const [snapshotLinePage, setSnapshotLinePage] = useState(1)
  const [snapshotLinePerPage, setSnapshotLinePerPage] = useState(25)

  // Drawer SKU Belum Dipetakan
  const [unmappedDrawerOpen, setUnmappedDrawerOpen] = useState(false)
  const [unmappedSnapshotId, setUnmappedSnapshotId] = useState(null)
  const [unmappedWarehouseName, setUnmappedWarehouseName] = useState('')
  const [unmappedItems, setUnmappedItems] = useState([])
  const [unmappedLoading, setUnmappedLoading] = useState(false)
  const [unmappedSearch, setUnmappedSearch] = useState('')
  const [unmappedMeta, setUnmappedMeta] = useState(null)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [unmappedPerPage, setUnmappedPerPage] = useState(25)

  // Stock Position State
  const [positionWarehouseIds, setPositionWarehouseIds] = useState([])
  const [positionDate, setPositionDate] = useState(new Date().toISOString().slice(0, 10))
  const [stockPositions, setStockPositions] = useState([])
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [positionError, setPositionError] = useState('')
  const [positionSearch, setPositionSearch] = useState('')

  // Sync Runs State
  const [syncRuns, setSyncRuns] = useState([])
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncConfigured, setSyncConfigured] = useState(true)
  const [syncWarehouseFilter, setSyncWarehouseFilter] = useState('')
  const [syncError, setSyncError] = useState('')

  // Dialog Tarik Stok MIMS
  const [mimsModalOpen, setMimsModalOpen] = useState(false)
  const [mimsToken, setMimsToken] = useState('')
  const [mimsSaved, setMimsSaved] = useState(null)        // {saved, saved_at, last_used_at, last_result} atau null bila belum dimuat
  const [mimsUseSaved, setMimsUseSaved] = useState(false)
  const [mimsAuto, setMimsAuto] = useState(null)          // {auto_enabled, auto_time, auto_user_name, last_auto_date}
  const [mimsAutoTime, setMimsAutoTime] = useState('02:00')
  const [mimsAutoSaving, setMimsAutoSaving] = useState(false)
  const [mimsSaveToken, setMimsSaveToken] = useState(false)
  const [mimsWarehouseIds, setMimsWarehouseIds] = useState([])
  const [mimsDate, setMimsDate] = useState('')
  const [mimsDryRun, setMimsDryRun] = useState(false)
  const [mimsDoStock, setMimsDoStock] = useState(true)
  const [mimsDoIssues, setMimsDoIssues] = useState(true)
  const [mimsDoReceipts, setMimsDoReceipts] = useState(true)
  const [mimsPulling, setMimsPulling] = useState(false)
  const [mimsResults, setMimsResults] = useState(null)
  const [mimsError, setMimsError] = useState('')
  const mimsResultsRef = useRef(null)

  useEffect(() => {
    if (mimsResults && typeof mimsResultsRef.current?.scrollIntoView === 'function') {
      mimsResultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [mimsResults])

  // Load Warehouses
  const loadWarehouses = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await warehousesApi.list()
      setWarehouses(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar gudang.')
    } finally {
      setLoading(false)
    }
  }, [])


  useEffect(() => {
    loadWarehouses()
  }, [loadWarehouses])

  // Load Sync Runs
  const loadSyncRuns = useCallback(async () => {
    setSyncLoading(true)
    setSyncError('')
    try {
      const res = await warehousesApi.syncRuns({
        warehouse_id: syncWarehouseFilter || undefined,
      })
      setSyncRuns(res?.data || [])
      setSyncConfigured(res?.sync_configured ?? true)
    } catch (err) {
      setSyncError(err?.message || 'Gagal memuat riwayat sinkronisasi stok.')
    } finally {
      setSyncLoading(false)
    }
  }, [syncWarehouseFilter])

  useEffect(() => {
    if (activeTab === 'sync-runs') {
      loadSyncRuns()
    }
  }, [activeTab, loadSyncRuns])

  useEffect(() => {
    if (mimsModalOpen) {
      loadMimsToken().then(() => setMimsUseSaved((v) => v))
      loadMimsAuto()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mimsModalOpen])

  // Token MIMS yang disimpan pengguna (terenkripsi di server; yang diterima hanya statusnya)
  const loadMimsToken = async () => {
    try {
      const res = await warehousesApi.mimsTokenStatus()
      const st = res?.data || null
      setMimsSaved(st)
      if (!st?.saved) setMimsUseSaved(false)
    } catch {
      setMimsSaved(null)
    }
  }

  const loadMimsAuto = async () => {
    try {
      const res = await warehousesApi.mimsAutoSettings()
      setMimsAuto(res?.data || null)
      if (res?.data?.auto_time) setMimsAutoTime(res.data.auto_time)
    } catch {
      setMimsAuto(null)
    }
  }

  const saveMimsAuto = async (enabled) => {
    setMimsAutoSaving(true)
    setMimsError('')
    try {
      const res = await warehousesApi.saveMimsAutoSettings({ auto_enabled: enabled, auto_time: mimsAutoTime })
      setMimsAuto(res?.data || null)
      notify({ type: 'success', title: enabled ? 'Tarik Otomatis Aktif' : 'Tarik Otomatis Dimatikan', desc: enabled ? `Stok MIMS ditarik setiap hari pukul ${mimsAutoTime} dengan token tersimpan Anda.` : 'Stok tidak lagi ditarik otomatis.', tag: 'MIMS' })
    } catch (err) {
      setMimsError(err?.message || 'Gagal menyimpan pengaturan tarik otomatis.')
    } finally {
      setMimsAutoSaving(false)
    }
  }

  const forgetMimsToken = async () => {
    try {
      await warehousesApi.forgetMimsToken()
      setMimsUseSaved(false)
      notify({ type: 'success', title: 'Token Dihapus', desc: 'Token MIMS tersimpan sudah dihapus dari server.', tag: 'MIMS' })
      await loadMimsToken()
    } catch (err) {
      setMimsError(err?.message || 'Gagal menghapus token tersimpan.')
    }
  }

  // Handle MIMS Pull
  const handleMimsPull = async (e) => {
    e?.preventDefault?.()
    if (!mimsDoStock && !mimsDoIssues && !mimsDoReceipts) {
      setMimsError('Pilih minimal satu: stok, pengeluaran, atau penerimaan.')
      return
    }
    if (!mimsUseSaved && !mimsToken.trim()) {
      setMimsError('Token sesi MIMS wajib diisi.')
      return
    }
    setMimsPulling(true)
    setMimsError('')
    setMimsResults(null)
    const tokenToSend = mimsToken.trim()
    // Segera bersihkan token dari state
    setMimsToken('')

    try {
      const res = await warehousesApi.syncStock({
        ...(mimsUseSaved ? { use_saved_token: true } : { token: tokenToSend, ...(mimsSaveToken && { save_token: true }) }),
        warehouse_ids: mimsWarehouseIds.length > 0 ? mimsWarehouseIds : undefined,
        date: mimsDate || undefined,
        dry_run: (mimsDryRun && mimsDoStock) || undefined,
        sync_stock: mimsDoStock,
        sync_issues: mimsDoIssues,
        sync_receipts: mimsDoReceipts,
      }, (rows) => setMimsResults(rows))
      setMimsResults(res?.data || [])
      notify({
        type: 'success',
        title: 'Penarikan Stok Selesai',
        desc: `Berhasil memproses ${res?.data?.length || 0} gudang dari MIMS.`,
        tag: 'MIMS',
      })
      loadSyncRuns()
      loadMimsToken()
    } catch (err) {
      loadMimsToken()
      const msg = err?.message || 'Gagal menarik stok dari MIMS.'
      setMimsError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menarik Stok MIMS',
        desc: msg,
        tag: 'MIMS',
      })
    } finally {
      setMimsPulling(false)
    }
  }

  // Load snapshots for selected warehouse
  const loadSnapshots = async (warehouse) => {
    setSelectedWarehouse(warehouse)
    setSnapshotsDrawerOpen(true)
    setLoadingSnapshots(true)
    try {
      const res = await warehousesApi.snapshots(warehouse.id)
      setSnapshots(res?.data || [])
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memuat Cuplikan',
        desc: err?.message || 'Tidak dapat memuat cuplikan stok gudang.',
        tag: 'STOK',
      })
    } finally {
      setLoadingSnapshots(false)
    }
  }

  // View Snapshot Detail
  const handleViewSnapshotDetail = async (snapshot) => {
    setSelectedSnapshot(snapshot)
    setSnapshotDetailDrawerOpen(true)
    setLoadingSnapshotDetail(true)
    try {
      const res = await warehousesApi.snapshotDetail(snapshot.id)
      setSnapshotDetail(res?.data || null)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memuat Rincian',
        desc: err?.message || 'Tidak dapat memuat rincian baris cuplikan stok.',
        tag: 'STOK',
      })
    } finally {
      setLoadingSnapshotDetail(false)
    }
  }

  // View Unmapped SKUs for Snapshot
  const handleOpenUnmapped = async (snapshotId, warehouseName) => {
    setUnmappedSnapshotId(snapshotId)
    setUnmappedWarehouseName(warehouseName || selectedWarehouse?.name || '')
    setUnmappedDrawerOpen(true)
    setUnmappedLoading(true)
    try {
      const res = await warehousesApi.unmapped(snapshotId, {
        search: unmappedSearch || undefined,
      })
      setUnmappedItems(res?.data || [])
      setUnmappedMeta(res?.meta || null)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memuat SKU Belum Dipetakan',
        desc: err?.message || 'Tidak dapat memuat daftar SKU yang belum terpetakan.',
        tag: 'STOK',
      })
    } finally {
      setUnmappedLoading(false)
    }
  }

  // dibuka dari halaman impor cuplikan stok: ?sku_belum_terpetakan=<id cuplikan>&gudang=<nama>
  useEffect(() => {
    const snapshotId = searchParams.get('sku_belum_terpetakan')
    if (!snapshotId) return
    handleOpenUnmapped(snapshotId, searchParams.get('gudang') || '')
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleSearchUnmapped = async (e) => {
    e?.preventDefault?.()
    if (!unmappedSnapshotId) return
    setUnmappedLoading(true)
    try {
      const res = await warehousesApi.unmapped(unmappedSnapshotId, {
        search: unmappedSearch || undefined,
      })
      setUnmappedItems(res?.data || [])
      setUnmappedMeta(res?.meta || null)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Pencarian Gagal',
        desc: err?.message || 'Gagal mencari SKU.',
        tag: 'STOK',
      })
    } finally {
      setUnmappedLoading(false)
    }
  }

  // Load Stock Positions
  const handleQueryPositions = async (e) => {
    e?.preventDefault?.()
    if (positionWarehouseIds.length === 0) {
      setPositionError('Pilih minimal satu gudang untuk melihat posisi stok.')
      return
    }
    setLoadingPositions(true)
    setPositionError('')
    try {
      const res = await warehousesApi.position({
        warehouse_ids: positionWarehouseIds,
        date: positionDate || undefined,
      })
      setStockPositions(res?.data || [])
    } catch (err) {
      setPositionError(err?.message || 'Gagal mengambil posisi stok terkonsolidasi.')
    } finally {
      setLoadingPositions(false)
    }
  }

  const toggleWarehouseForPosition = (id) => {
    setPositionWarehouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAllWarehousesForPosition = () => {
    if (positionWarehouseIds.length === warehouses.length) {
      setPositionWarehouseIds([])
    } else {
      setPositionWarehouseIds(warehouses.map((w) => w.id))
    }
  }

  const filteredPositions = stockPositions.filter((pos) => {
    if (!positionSearch) return true
    return String(pos.khs_code).toLowerCase().includes(positionSearch.toLowerCase())
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="text-xs text-slate-500 mb-1">
            <span>DISTRIVA</span>
            <span className="mx-1.5">/</span>
            <span>Operasional</span>
            <span className="mx-1.5">/</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">Gudang & Stok</span>
          </nav>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Gudang, Cuplikan Stok & Sinkronisasi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manajemen gudang ERP, impor cuplikan stok fisik (CSV / XLSX Monitoring Stock), query ketersediaan KHS, dan pemantauan sinkronisasi otomatis.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {canManage ? (
            <button
              type="button"
              aria-label="Tambah Gudang / Impor Gudang ERP"
              onClick={() => navigate('/master-data/warehouses/baru')}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Tambah Gudang</span>
            </button>
          ) : canImportStock ? (
            <button
              type="button"
              onClick={() => {
                setMimsModalOpen(true)
                setMimsToken('')
                setMimsWarehouseIds([])
                setMimsDate('')
                setMimsDryRun(false)
                setMimsResults(null)
                setMimsError('')
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconRefresh size={16} />
              <span>Tarik Stok dari MIMS</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('warehouses')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'warehouses'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Daftar Gudang ({warehouses.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('position')
              if (positionWarehouseIds.length === 0 && warehouses.length > 0) {
                setPositionWarehouseIds(warehouses.map((w) => w.id))
              }
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'position'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Posisi Stok Terkonsolidasi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sync-runs')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'sync-runs'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Riwayat Sinkronisasi
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mims-issues')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'mims-issues'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Pengeluaran MIMS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mims-receipts')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              activeTab === 'mims-receipts'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Penerimaan MIMS
          </button>
        </div>

        {canManage && canImportStock && activeTab !== 'sync-runs' && (
          <Button
            variant="secondary"
            size="sm"
            icon={IconRefresh}
            onClick={() => {
              setMimsModalOpen(true)
              setMimsToken('')
              setMimsWarehouseIds([])
              setMimsDate('')
              setMimsDryRun(false)
              setMimsResults(null)
              setMimsError('')
            }}
          >
            Tarik Stok dari MIMS
          </Button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* TAB 1: Warehouses List */}
      {activeTab === 'warehouses' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-slate-500">
              <Spinner size="lg" label="Memuat daftar gudang..." />
            </div>
          ) : warehouses.length === 0 ? (
            <EmptyState
              icon={IconBuilding}
              title="Belum ada gudang"
              description="Belum ada data gudang yang terdaftar di sistem. Klik tombol &quot;Tambah Gudang&quot; untuk menambahkan master gudang baru."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                    <th className="py-3 px-4">Kode Gudang</th>
                    <th className="py-3 px-4">Nama Gudang</th>
                    <th className="py-3 px-4">Unit Organisasi</th>
                    <th className="py-3 px-4">Plant</th>
                    <th className="py-3 px-4">Storage Loc</th>
                    <th className="py-3 px-4">Jenis (GI/GO)</th>
                    <th className="py-3 px-4">Kode Unit ERP</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                  {warehouses
                    .slice((whPage - 1) * whPerPage, whPage * whPerPage)
                    .map((w) => (
                      <tr
                        key={w.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {w.code}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                          {w.name}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                          <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 mr-1.5">
                            {w.unit?.code}
                          </span>
                          <span>{w.unit?.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                          {w.plant || '-'}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                          {w.stor_loc || '-'}
                        </td>
                        <td className="py-3 px-4">
                          {w.kind ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                w.kind === 'GI'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                              }`}
                            >
                              {w.kind}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                          {w.erp_unit_code || '-'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              w.is_active
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {w.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => loadSnapshots(w)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition cursor-pointer"
                          >
                            <IconBuilding size={14} />
                            <span>Cuplikan Stok</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <TableFooter
            itemCount={warehouses.slice((whPage - 1) * whPerPage, whPage * whPerPage).length}
            total={warehouses.length}
            entityLabel="gudang"
            page={whPage}
            perPage={whPerPage}
            onPage={setWhPage}
            onPerPage={(n) => {
              setWhPerPage(n)
              setWhPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </div>
      )}

      {/* TAB 2: Consolidated Stock Position */}
      {activeTab === 'position' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Filter Posisi Stok Terkonsolidasi
                </h3>
                <p className="text-[11px] text-slate-500">
                  Pilih gudang dan tanggal evaluasi untuk menghitung ketersediaan material KHS (tersedia = fisik − reservasi + pasokan − pengaman).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={positionDate}
                  onChange={(e) => setPositionDate(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={loadingPositions}
                  onClick={handleQueryPositions}
                  icon={IconRefresh}
                >
                  Hitung Posisi
                </Button>
              </div>
            </div>

            {/* Warehouse checkboxes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Pilih Gudang Target:
                </span>
                <button
                  type="button"
                  onClick={selectAllWarehousesForPosition}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  {positionWarehouseIds.length === warehouses.length
                    ? 'Batal Pilih Semua'
                    : 'Pilih Semua Gudang'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {warehouses.map((w) => {
                  const checked = positionWarehouseIds.includes(w.id)
                  return (
                    <label
                      key={w.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition ${
                        checked
                          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 font-medium'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWarehouseForPosition(w.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="truncate" title={w.name}>
                        <span className="font-mono font-bold mr-1">{w.code}</span>
                        <span className="text-slate-500">({w.name})</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {positionError && <Alert kind="error">{positionError}</Alert>}

          {/* Positions Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-xs">
                <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari kode KHS..."
                  value={positionSearch}
                  onChange={(e) => setPositionSearch(e.target.value)}
                  className="block w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {filteredPositions.length} item material KHS
              </span>
            </div>

            {loadingPositions ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Menghitung posisi stok..." />
              </div>
            ) : filteredPositions.length === 0 ? (
              <EmptyState
                icon={IconBuilding}
                title="Belum ada posisi stok"
                description={
                  stockPositions.length === 0
                    ? 'Klik tombol "Hitung Posisi" untuk memuat kalkulasi ketersediaan material.'
                    : 'Tidak ada kode KHS yang cocok dengan pencarian.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                      <th className="py-2.5 px-3">Kode KHS</th>
                      <th className="py-2.5 px-3 text-right">Stok Fisik (On Hand)</th>
                      <th className="py-2.5 px-3 text-right">Reservasi</th>
                      <th className="py-2.5 px-3 text-right">Pasokan Masuk</th>
                      <th className="py-2.5 px-3 text-right">Stok Pengaman</th>
                      <th className="py-2.5 px-3 text-right">Dialokasi Sesudahnya</th>
                      <th className="py-2.5 px-3 text-right" title="Pasokan tambahan dari Kontrak Rinci (KR) yang materialnya belum masuk stok ERP.">
                        Pasokan KR
                      </th>
                      <th className="py-2.5 px-3 text-right bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200">
                        Stok Tersedia (Available)
                      </th>
                      <th className="py-2.5 px-3 text-right" title="Tersedia + Pasokan KR. Tidak menggantikan kolom Available.">
                        Tersedia + KR
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                    {filteredPositions
                      .slice((posPage - 1) * posPerPage, posPage * posPerPage)
                      .map((p, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200 font-mono">
                            {p.khs_code}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                            {p.on_hand?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-amber-600">
                            {p.reserved?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-600">
                            {p.incoming?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-500">
                            {p.safety?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">
                            {p.allocated_after?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-violet-600">
                            {(p.kr_supply ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-bold bg-blue-50/40 dark:bg-blue-950/20 ${
                              p.available > 0
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-rose-600'
                            }`}
                          >
                            {p.available?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300 font-semibold">
                            {p.available_with_kr?.toLocaleString('id-ID') ?? '-'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800">
              Pasokan KR = sisa Kontrak Rinci tiang yang materialnya belum ada di stok ERP (MIMS). Tersedia + KR = Available + Pasokan KR; kolom Available tidak berubah.
            </p>

            <TableFooter
              itemCount={filteredPositions.slice((posPage - 1) * posPerPage, posPage * posPerPage).length}
              total={filteredPositions.length}
              entityLabel="posisi stok KHS"
              page={posPage}
              perPage={posPerPage}
              onPage={setPosPage}
              onPerPage={(n) => {
                setPosPerPage(n)
                setPosPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {activeTab === 'mims-issues' && <MimsMirrorTab kind="issues" warehouses={warehouses} />}
      {activeTab === 'mims-receipts' && <MimsMirrorTab kind="receipts" warehouses={warehouses} />}

      {/* TAB 3: Auto-Sync Runs */}
      {activeTab === 'sync-runs' && (
        <div className="space-y-4">
          {!syncConfigured && (
            <Alert kind="warning">
              Sinkronisasi otomatis belum dikonfigurasi di server (konfigurasi URL basis dan token MIMS belum disetel pada environment server).
            </Alert>
          )}

          {syncError && <Alert kind="error">{syncError}</Alert>}

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Riwayat Sinkronisasi Otomatis Stok ERP
              </h3>
              <p className="text-[11px] text-slate-500">
                Log penarikan berkala cuplikan data stok dari sistem ERP/MIMS.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={syncWarehouseFilter}
                onChange={(e) => setSyncWarehouseFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="">Semua Gudang</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} - {w.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                icon={IconRefresh}
                loading={syncLoading}
                onClick={loadSyncRuns}
              >
                Segarkan
              </Button>
              {canImportStock && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={IconRefresh}
                  onClick={() => {
                    setMimsModalOpen(true)
                    setMimsToken('')
                    setMimsWarehouseIds([])
                    setMimsDate('')
                    setMimsDryRun(false)
                    setMimsResults(null)
                    setMimsError('')
                  }}
                >
                  Tarik Stok dari MIMS
                </Button>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {syncLoading ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memuat riwayat sinkronisasi..." />
              </div>
            ) : syncRuns.length === 0 ? (
              <EmptyState
                icon={IconRefresh}
                title="Belum ada riwayat sinkronisasi"
                description="Belum ada catatan riwayat sinkronisasi stok otomatis dari sistem inventaris ERP."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                      <th className="py-3 px-4">Waktu Mulai</th>
                      <th className="py-3 px-4">Gudang</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Total SKU</th>
                      <th className="py-3 px-4 text-right">SKU Terpetakan</th>
                      <th className="py-3 px-4">Pesan / Hasil</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                    {syncRuns
                      .slice((syncPage - 1) * syncPerPage, syncPage * syncPerPage)
                      .map((r) => (
                        <tr
                          key={r.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                            {r.started_at ? new Date(r.started_at).toLocaleString('id-ID') : '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100 mr-1.5">
                              {r.warehouse_code}
                            </span>
                            <span className="text-slate-500 text-[11px]">({r.warehouse_name})</span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                r.status === 'OK'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : r.status === 'SKIPPED'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-800 dark:text-slate-200">
                            {r.materials_total?.toLocaleString('id-ID') || 0}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-600 font-semibold">
                            {r.materials_mapped?.toLocaleString('id-ID') || 0}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px] max-w-xs truncate" title={r.message}>
                            {r.message || '-'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {r.snapshot_id ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleViewSnapshotDetail({
                                    id: r.snapshot_id,
                                    as_of: r.started_at?.slice(0, 10),
                                    source_reference: `Sync ${r.warehouse_code}`,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 transition cursor-pointer"
                              >
                                <IconEye size={12} />
                                <span>Lihat Cuplikan</span>
                              </button>
                            ) : (
                              <span className="text-slate-400 text-[10px]">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={syncRuns.slice((syncPage - 1) * syncPerPage, syncPage * syncPerPage).length}
              total={syncRuns.length}
              entityLabel="riwayat sinkronisasi"
              page={syncPage}
              perPage={syncPerPage}
              onPage={setSyncPage}
              onPerPage={(n) => {
                setSyncPerPage(n)
                setSyncPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}


      {/* DRAWER 1: Warehouse Snapshots List */}
      {selectedWarehouse && (
        <Drawer
          isOpen={snapshotsDrawerOpen}
          onClose={() => setSnapshotsDrawerOpen(false)}
          title={`Cuplikan Stok: ${selectedWarehouse.name} (${selectedWarehouse.code})`}
          subtitle="Daftar berkas cuplikan stok fisik per tanggal yang diimpor dari ERP/logistik."
          width="max-w-2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-slate-500">
                Total {snapshots.length} cuplikan tercatat
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSnapshotsDrawerOpen(false)}
              >
                Tutup
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Riwayat Cuplikan Stok Fisik
              </span>
              {canImportStock && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={IconUpload}
                  onClick={() => navigate(`/master-data/warehouses/${selectedWarehouse.id}/impor-stok`)}
                >
                  Impor Cuplikan CSV / XLSX
                </Button>
              )}
            </div>

            {loadingSnapshots ? (
              <div className="py-12 text-center text-slate-500">
                <Spinner size="md" label="Memuat riwayat cuplikan..." />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/40 rounded-lg">
                Belum ada cuplikan stok yang diimpor untuk gudang ini.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border rounded-lg overflow-hidden">
                {snapshots.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {s.as_of}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 font-mono">
                          {s.lines} baris KHS
                        </span>
                        {s.materials_total > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono">
                            {s.materials_mapped ?? s.lines} / {s.materials_total} SKU terpetakan
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Ref: {s.source_reference || '-'} · Diimpor oleh: {s.created_by_name || '-'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {s.materials_total > s.materials_mapped && (
                        <button
                          type="button"
                          onClick={() => handleOpenUnmapped(s.id, selectedWarehouse.name)}
                          className="px-2 py-1 rounded-md text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>SKU Belum Dipetakan</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleViewSnapshotDetail(s)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <IconEye size={12} />
                        <span>Rincian</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Drawer>
      )}


      {/* DRAWER 3: Snapshot Detail Lines */}
      {selectedSnapshot && (
        <Drawer
          isOpen={snapshotDetailDrawerOpen}
          onClose={() => setSnapshotDetailDrawerOpen(false)}
          title={`Rincian Cuplikan Stok (${selectedSnapshot.as_of})`}
          subtitle={`Gudang: ${selectedWarehouse?.name || '-'} · Referensi: ${selectedSnapshot.source_reference || '-'}`}
          width="max-w-3xl"
          footer={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSnapshotDetailDrawerOpen(false)}
            >
              Tutup
            </Button>
          }
        >
          {loadingSnapshotDetail ? (
            <div className="py-12 text-center text-slate-500">
              <Spinner size="md" label="Memuat rincian baris..." />
            </div>
          ) : !snapshotDetail || (snapshotDetail.lines || []).length === 0 ? (
            <EmptyState
              icon={IconBuilding}
              title="Belum ada data cuplikan"
              description="Tidak ada data rincian baris material KHS dalam berkas cuplikan ini."
            />
          ) : (
            <div className="space-y-3 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Daftar Baris Material KHS ({snapshotDetail.lines?.length || 0} item)
              </span>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                    <tr>
                      <th className="py-2 px-3">Kode KHS</th>
                      <th className="py-2 px-3 text-right">Stok Fisik</th>
                      <th className="py-2 px-3 text-right">Reservasi</th>
                      <th className="py-2 px-3 text-right">Pasokan Masuk</th>
                      <th className="py-2 px-3 text-right">Stok Pengaman</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono text-[11px]">
                    {(snapshotDetail.lines || [])
                      .slice((snapshotLinePage - 1) * snapshotLinePerPage, snapshotLinePage * snapshotLinePerPage)
                      .map((l, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">
                          {l.khs_code}
                        </td>
                        <td className="py-2 px-3 text-right">{l.on_hand?.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right text-amber-600">{l.reserved?.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right text-emerald-600">{l.incoming?.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{l.safety_stock?.toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <TableFooter
                itemCount={
                  (snapshotDetail.lines || []).slice(
                    (snapshotLinePage - 1) * snapshotLinePerPage,
                    snapshotLinePage * snapshotLinePerPage
                  ).length
                }
                total={(snapshotDetail.lines || []).length}
                entityLabel="baris KHS"
                page={snapshotLinePage}
                perPage={snapshotLinePerPage}
                onPage={setSnapshotLinePage}
                onPerPage={(n) => {
                  setSnapshotLinePerPage(n)
                  setSnapshotLinePage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            </div>
          )}
        </Drawer>
      )}

      {/* DRAWER 4: Unmapped SKUs */}
      <Drawer
        isOpen={unmappedDrawerOpen}
        onClose={() => setUnmappedDrawerOpen(false)}
        title="Daftar SKU ERP Belum Terpetakan"
        subtitle={`Gudang: ${unmappedWarehouseName} · Daftar material dari cuplikan stok ERP yang belum dipetakan ke kode KHS.`}
        width="max-w-3xl"
        footer={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUnmappedDrawerOpen(false)}
          >
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          <form onSubmit={handleSearchUnmapped} className="flex items-center gap-2">
            <div className="relative flex-1">
              <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari nomor atau nama material ERP..."
                value={unmappedSearch}
                onChange={(e) => setUnmappedSearch(e.target.value)}
                className="block w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" loading={unmappedLoading}>
              Cari
            </Button>
          </form>

          {unmappedLoading ? (
            <div className="py-12 text-center text-slate-500">
              <Spinner size="md" label="Memuat SKU belum terpetakan..." />
            </div>
          ) : unmappedItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-lg">
              Semua SKU pada cuplikan ini telah berhasil dipetakan ke kode KHS.
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                  <tr>
                    <th className="py-2 px-3">Nomor Material (SKU)</th>
                    <th className="py-2 px-3">Nama Material ERP</th>
                    <th className="py-2 px-3">Satuan</th>
                    <th className="py-2 px-3 text-right">Stok Fisik Ready</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-[11px]">
                  {unmappedItems
                    .slice((unmappedPage - 1) * unmappedPerPage, unmappedPage * unmappedPerPage)
                    .map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100">
                        {item.material_no}
                      </td>
                      <td className="py-2 px-3 font-sans text-slate-700 dark:text-slate-300">
                        {item.name}
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-sans">
                        {item.unit}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-800 dark:text-slate-200">
                        {item.stock_ready?.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unmappedItems.length > 0 && (
            <TableFooter
              itemCount={
                unmappedItems.slice((unmappedPage - 1) * unmappedPerPage, unmappedPage * unmappedPerPage).length
              }
              total={unmappedMeta?.total || unmappedItems.length}
              entityLabel="SKU belum dipetakan"
              page={unmappedPage}
              perPage={unmappedPerPage}
              onPage={setUnmappedPage}
              onPerPage={(n) => {
                setUnmappedPerPage(n)
                setUnmappedPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          )}
        </div>
      </Drawer>

      {/* DRAWER: Tarik Stok dari MIMS */}
      <Modal
        open={mimsModalOpen}
        title="Tarik Stok dari MIMS"
        onClose={() => {
          setMimsModalOpen(false)
          setMimsToken('')
          setMimsResults(null)
          setMimsError('')
        }}
        size="max-w-3xl"
      >
        <div className="space-y-4 text-xs">
          <Alert kind="info">
            Gunakan token sesi MIMS Anda. Token yang ditempel hanya dikirim untuk permintaan ini lalu dikosongkan; bila Anda memilih menyimpannya, token disimpan terenkripsi di server hanya untuk akun Anda dan tidak pernah ditampilkan kembali.
          </Alert>

          {mimsError && (
            <Alert kind="error">
              <div>{mimsError}</div>
              {(mimsError.toLowerCase().includes('token ditolak') ||
                mimsError.toLowerCase().includes('kedaluwarsa')) && (
                <div className="mt-1 font-semibold">
                  Silakan ambil token baru dari aplikasi MIMS.
                </div>
              )}
            </Alert>
          )}

          <form onSubmit={handleMimsPull} className="space-y-4">
            {mimsSaved?.saved && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800" role="radiogroup" aria-label="Sumber token MIMS">
                <label className="flex items-start gap-2 p-3 cursor-pointer">
                  <input type="radio" name="mims-source" checked={mimsUseSaved} onChange={() => setMimsUseSaved(true)} disabled={mimsPulling} className="mt-0.5" />
                  <span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Gunakan token tersimpan</span>
                    <span className="block text-[11px] text-slate-500">
                      Disimpan {mimsSaved.saved_at ? new Date(mimsSaved.saved_at).toLocaleString('id-ID') : '-'}
                      {mimsSaved.last_used_at ? ` · terakhir dipakai ${new Date(mimsSaved.last_used_at).toLocaleString('id-ID')}` : ''}
                    </span>
                    {mimsSaved.last_result === 'REJECTED' && <span className="block text-[11px] text-amber-600 dark:text-amber-400">Pemakaian terakhir ditolak MIMS; coba lagi, atau tempel token baru bila masih ditolak.</span>}
                  </span>
                </label>
                <label className="flex items-start gap-2 p-3 cursor-pointer">
                  <input type="radio" name="mims-source" checked={!mimsUseSaved} onChange={() => setMimsUseSaved(false)} disabled={mimsPulling} className="mt-0.5" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Tempel token baru</span>
                </label>
              </div>
            )}

            {mimsSaved?.saved && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2" aria-label="Tarik otomatis">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Tarik stok otomatis harian</span>
                  <span className={`text-[11px] font-semibold ${mimsAuto?.auto_enabled ? 'text-emerald-600' : 'text-slate-500'}`}>{mimsAuto?.auto_enabled ? 'Aktif' : 'Nonaktif'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="mims-auto-time" className="text-[11px] text-slate-600 dark:text-slate-300">Jam (WIB)</label>
                  <input id="mims-auto-time" type="time" value={mimsAutoTime} onChange={(e) => setMimsAutoTime(e.target.value)} disabled={mimsAutoSaving} className="px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  <Button type="button" variant="secondary" size="sm" disabled={mimsAutoSaving} onClick={() => saveMimsAuto(true)}>{mimsAuto?.auto_enabled ? 'Simpan jam' : 'Aktifkan'}</Button>
                  {mimsAuto?.auto_enabled && <Button type="button" variant="secondary" size="sm" disabled={mimsAutoSaving} onClick={() => saveMimsAuto(false)}>Matikan</Button>}
                </div>
                <p className="text-[11px] text-slate-500">
                  Memakai token tersimpan milik {mimsAuto?.auto_enabled && mimsAuto?.auto_user_name ? mimsAuto.auto_user_name : 'Anda (yang mengaktifkan)'}.
                  {mimsAuto?.last_auto_date ? ` Terakhir berjalan ${mimsAuto.last_auto_date}.` : ''} Bila token kedaluwarsa, penarikan gagal dan pemegang izin impor stok diberi tahu; tempel token baru dan simpan lagi.
                </p>
              </div>
            )}

            {!mimsUseSaved && (
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Token Sesi MIMS *
              </label>
              <input
                type="password"
                autoComplete="off"
                required
                disabled={mimsPulling}
                value={mimsToken}
                onChange={(e) => setMimsToken(e.target.value)}
                placeholder="Tempel token sesi MIMS Anda di sini..."
                className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-hidden disabled:opacity-60"
              />
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={mimsSaveToken} onChange={(e) => setMimsSaveToken(e.target.checked)} disabled={mimsPulling} />
                Simpan token ini untuk penarikan berikutnya{mimsSaved?.saved ? ' (menggantikan token tersimpan)' : ''}
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Bila tidak dicentang, token tidak disimpan di mana pun.
              </p>
            </div>
            )}
            {mimsUseSaved && (
              <p className="text-[11px] text-slate-500">
                Token tersimpan dipakai langsung di server. <button type="button" onClick={forgetMimsToken} className="underline text-rose-600 cursor-pointer">Hapus token tersimpan</button>
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Cuplikan (Opsional)
                </label>
                <input
                  type="date"
                  disabled={mimsPulling}
                  max={new Date().toISOString().slice(0, 10)}
                  value={mimsDate}
                  onChange={(e) => setMimsDate(e.target.value)}
                  className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                />
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Kosongkan untuk menarik stok hari ini.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilihan Gudang ERP
                </label>
                <select
                  multiple
                  disabled={mimsPulling}
                  value={mimsWarehouseIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (option) => option.value)
                    setMimsWarehouseIds(selected)
                  }}
                  className="block w-full px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 h-20 disabled:opacity-60"
                >
                  {warehouses
                    .filter((w) => w.plant && w.stor_loc)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name} ({w.plant}/{w.stor_loc})
                      </option>
                    ))}
                </select>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {mimsWarehouseIds.length === 0
                    ? 'Bawaan: Semua gudang aktif dengan Plant/Storage Loc'
                    : `${mimsWarehouseIds.length} gudang dipilih (tahan Ctrl/Cmd untuk multi-pilih)`}
                </p>
              </div>
            </div>

            <fieldset className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <legend className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Data yang ditarik</legend>
              {[
                ['mims-do-stock', 'Stok gudang', mimsDoStock, setMimsDoStock],
                ['mims-do-issues', 'Pengeluaran material (riwayat pemakaian, baca-saja)', mimsDoIssues, setMimsDoIssues],
                ['mims-do-receipts', 'Penerimaan material (riwayat, baca-saja)', mimsDoReceipts, setMimsDoReceipts],
              ].map(([id, label, checked, set]) => (
                <label key={id} htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" id={id} disabled={mimsPulling} checked={checked} onChange={(e) => set(e.target.checked)} className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 disabled:opacity-60" />
                  {label}
                </label>
              ))}
            </fieldset>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="mims-dry-run"
                disabled={mimsPulling || !mimsDoStock}
                checked={mimsDryRun && mimsDoStock}
                onChange={(e) => setMimsDryRun(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
              />
              <label
                htmlFor="mims-dry-run"
                className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Uji coba tanpa menyimpan (dry run)
              </label>
            </div>

            {mimsPulling && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                <Spinner size="xs" />
                <span>Sedang menghubungi server MIMS dan menarik stok gudang… Mohon tunggu.</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mimsPulling}
                onClick={() => {
                  setMimsModalOpen(false)
                  setMimsToken('')
                  setMimsResults(null)
                  setMimsError('')
                }}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={mimsPulling}
                disabled={mimsPulling}
                icon={IconRefresh}
              >
                {mimsPulling ? 'Menarik Stok...' : 'Tarik Stok Sekarang'}
              </Button>
            </div>
          </form>

          {mimsResults && (
            <div ref={mimsResultsRef} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                  Hasil Penarikan Stok MIMS
                </h4>
                <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                  {mimsResults.length} gudang diproses
                </span>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shadow-xs">
                    <tr>
                      <th className="py-2 px-3">Gudang</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Total SKU</th>
                      <th className="py-2 px-3 text-right">Terpetakan</th>
                      <th className="py-2 px-3 text-right">Belum Dipetakan</th>
                      <th className="py-2 px-3">Keterangan</th>
                      <th className="py-2 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans text-xs">
                    {mimsResults.map((r, idx) => {
                      const total = r.total || 0
                      const mapped = r.mapped || 0
                      const unmappedCount = total - mapped
                      return (
                        <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                            <div>{r.warehouse_name || r.warehouse_code || r.warehouse_id}</div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {r.warehouse_code}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                r.status === 'OK'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : r.status === 'SKIPPED'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">
                            {total.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-600 font-semibold">
                            {mapped.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-amber-600 font-semibold">
                            {unmappedCount > 0 ? unmappedCount.toLocaleString('id-ID') : 0}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.message || '-'}
                            {r.receipts && (
                              <span className="block text-slate-500">
                                Penerimaan: {r.receipts.status === 'OK' ? (r.receipts.documents_new === 0 ? 'tidak ada dokumen baru (yang sudah tercatat tidak ditarik ulang)' : `${r.receipts.documents_new} dokumen baru, ${r.receipts.lines} baris material`) : r.receipts.message || r.receipts.status}
                              </span>
                            )}
                            {r.issues && (
                              <span className="block text-slate-500">
                                Pengeluaran: {r.issues.status === 'OK' ? (r.issues.documents_new === 0 ? 'tidak ada dokumen baru (yang sudah tercatat tidak ditarik ulang)' : `${r.issues.documents_new} dokumen baru, ${r.issues.lines} baris material, ${r.issues.matched} pelanggan cocok permohonan`) : r.issues.message || r.issues.status}
                              </span>
                            )}
                            {r.message && (r.message.includes('token ditolak') || r.message.includes('kedaluwarsa')) && (
                              <span className="block text-rose-500 font-medium">
                                Ambil token baru dari MIMS.
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {r.snapshot_id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setMimsModalOpen(false)
                                  handleOpenUnmapped(r.snapshot_id, r.warehouse_name)
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                              >
                                SKU Belum Terpetakan
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500">
                  {mimsResults.length} gudang selesai diproses.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMimsResults(null)
                      setMimsError('')
                    }}
                  >
                    Tarik Ulang
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setMimsModalOpen(false)
                      setMimsToken('')
                      setMimsResults(null)
                      setMimsError('')
                    }}
                  >
                    Tutup / Selesai
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
