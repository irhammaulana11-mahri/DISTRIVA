import { useState, useEffect, useCallback } from 'react'
import {
  allocationsApi,
  warehousesApi,
  poleContractsApi,
} from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconPlus,
  IconRefresh,
  IconTrash,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconBuilding,
  IconClock,
} from '../../components/icons.jsx'

export default function ApplicationAllocationPanel({
  application,
  canManage = false,
  canManageMaterials = false,
  canManagePoles = false,
  canView = true,
  createBlockReason = '',
}) {
  const { notify } = useNotifications()

  const effCanManageMaterials = Boolean(canManageMaterials || canManage)
  const effCanManagePoles = Boolean(canManagePoles || canManage)
  const effCanCreateOrCancel = Boolean(effCanManageMaterials || effCanManagePoles)
  // Alokasi boleh dibuka oleh Konstruksi UP3 maupun Perencanaan; masing-masing hanya mengisi bagiannya sendiri.
  const effCanCreate = effCanCreateOrCancel
  // Satu peran satu bagian: Perencanaan hanya tiang, Konstruksi hanya material (di luar tiang). Peran lain (hanya lihat) melihat keduanya.
  const showMaterialsSection = effCanManageMaterials || !effCanManagePoles
  const showPolesSection = effCanManagePoles || !effCanManageMaterials

  const [allocations, setAllocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Active selected allocation detail
  const [selectedAllocationId, setSelectedAllocationId] = useState(null)
  const [allocationDetail, setAllocationDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Edit Lines State
  const [materials, setMaterials] = useState([])
  const [poles, setPoles] = useState([])
  const [matPage, setMatPage] = useState(1)
  const [matPerPage, setMatPerPage] = useState(10)
  const [polePage, setPolePage] = useState(1)
  const [polePerPage, setPolePerPage] = useState(10)
  const [notes, setNotes] = useState('')
  const [savingMaterials, setSavingMaterials] = useState(false)
  const [savingPoles, setSavingPoles] = useState(false)
  const [confirmingMaterials, setConfirmingMaterials] = useState(false)
  const [confirmingPoles, setConfirmingPoles] = useState(false)
  const [creating, setCreating] = useState(false)
  const [suggestions, setSuggestions] = useState({ rows: [], warehouses: [] })
  const [suggesting, setSuggesting] = useState(false)

  // Master Data Reference Options
  const [warehouses, setWarehouses] = useState([])
  const [poleContracts, setPoleContracts] = useState([])

  // Modal Cancel
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState('')

  // Load Reference Data (Warehouses & Pole Contracts)
  useEffect(() => {
    Promise.allSettled([warehousesApi.list(), poleContractsApi.list()]).then(
      ([wRes, pRes]) => {
        if (wRes.status === 'fulfilled') setWarehouses(wRes.value?.data || [])
        if (pRes.status === 'fulfilled') setPoleContracts(pRes.value?.data || [])
      }
    )
  }, [])

  // Load Allocations for Application
  const loadAllocations = useCallback(async () => {
    if (!application?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await allocationsApi.listForApplication(application.id)
      const list = res?.data || []
      setAllocations(list)
      if (list.length > 0 && !selectedAllocationId) {
        setSelectedAllocationId(list[0].id)
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat alokasi material.')
    } finally {
      setLoading(false)
    }
  }, [application?.id, selectedAllocationId])

  useEffect(() => {
    loadAllocations()
  }, [loadAllocations])

  // Load Allocation Detail
  const loadDetail = useCallback(async (allocId) => {
    if (!allocId) return
    setLoadingDetail(true)
    setActionError('')
    try {
      const res = await allocationsApi.get(allocId)
      const data = res?.data || null
      setAllocationDetail(data)
      if (data) {
        setMaterials(data.materials || [])
        setPoles(data.poles || [])
        setNotes(data.notes || '')
      }
    } catch (err) {
      setActionError(err?.message || 'Gagal memuat detail alokasi.')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (selectedAllocationId) {
      loadDetail(selectedAllocationId)
    }
  }, [selectedAllocationId, loadDetail])

  // Saran alokasi dari kebutuhan MTO (dasar RAB/KKF) + stok gudang ULP/UP3; dimuat saat draf material bisa diedit
  const loadSuggestions = useCallback(async (allocId) => {
    if (!allocId) return null
    try {
      const res = await allocationsApi.materialSuggestions(allocId)
      setSuggestions(res?.data || { rows: [], warehouses: [] })
      return res?.data || null
    } catch {
      return null
    }
  }, [])

  // Kebutuhan MTO + stok gudang untuk nama material dan info stok di tiap baris (hanya peran material, selama bagian material masih draf)
  const detailOpenForMaterials = Boolean(allocationDetail && allocationDetail.status === 'DRAFT' && !allocationDetail.materials_confirmed_at && effCanManageMaterials)
  useEffect(() => {
    if (detailOpenForMaterials) loadSuggestions(allocationDetail.id)
  }, [detailOpenForMaterials, allocationDetail?.id, loadSuggestions])

  // Handle Create Draft Allocation
  const handleCreateAllocation = async () => {
    if (!application?.id) return
    setCreating(true)
    setActionError('')
    try {
      const res = await allocationsApi.create(application.id, {
        notes: `${openingAddition ? 'Alokasi tambahan' : 'Alokasi material'} permohonan ${application.application_number}`,
      })
      notify({
        type: 'success',
        title: openingAddition ? 'Draf Alokasi Tambahan Dibuat' : 'Draf Alokasi Dibuat',
        desc: openingAddition ? 'Draf alokasi tambahan berhasil dibuat; alokasi yang sudah dikonfirmasi tetap berlaku.' : 'Draf alokasi material dan tiang berhasil dibuat.',
        tag: 'ALOKASI',
      })
      await loadAllocations()
      if (res?.data?.id) {
        setSelectedAllocationId(res.data.id)
      }
    } catch (err) {
      setActionError(err?.message || 'Gagal membuat alokasi.')
    } finally {
      setCreating(false)
    }
  }

  // Aturan owner: stok cukup untuk seluruh kebutuhan -> isi penuh; kurang/tidak ada -> 0
  const autoQuantity = (sug, warehouseId) => {
    const c = sug?.candidates?.find((x) => x.warehouse_id === warehouseId)
    return c && sug.remaining > 0 && c.available + 1e-9 >= sug.remaining ? sug.remaining : 0
  }

  // "Tambah Material": langsung memasukkan semua kebutuhan MTO (selain tiang beton) yang belum ada, lengkap dengan gudang dan jumlah
  const handleAddMaterialRow = async () => {
    setSuggesting(true)
    setActionError('')
    const data = await loadSuggestions(selectedAllocationId)
    setSuggesting(false)
    if (!data) {
      setActionError('Gagal memuat kebutuhan MTO dan stok gudang.')
      return
    }
    setMaterials((prev) => {
      const have = new Set(prev.map((m) => String(m.khs_code).trim()))
      const added = data.rows
        .filter((r) => r.remaining > 0 && !have.has(r.khs_code) && r.suggestion)
        .map((r) => ({ khs_code: r.khs_code, warehouse_id: r.suggestion.warehouse_id, quantity: r.suggestion.quantity }))
      return [...prev, ...added]
    })
  }

  // Baris kosong manual (bila perlu menambah satu baris sendiri)
  const handleAddManualRow = () => {
    setMaterials((prev) => [...prev, { khs_code: '', warehouse_id: warehouses[0]?.id || '', quantity: 0 }])
  }

  const vendorRows = suggestions.rows.filter((r) => r.supplier === 'VENDOR')
  const sugFor = (khsCode) => suggestions.rows.find((r) => r.khs_code === String(khsCode).trim())

  const changeWarehouse = (idx, warehouseId) => {
    setMaterials((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      const sug = sugFor(item.khs_code)
      return { ...item, warehouse_id: warehouseId, quantity: sug ? autoQuantity({ ...sug, remaining: sug.need }, warehouseId) : item.quantity }
    }))
  }

  // Handle Remove Material Row
  const handleRemoveMaterialRow = (idx) => {
    setMaterials((prev) => prev.filter((_, i) => i !== idx))
  }

  // Handle Add Pole Row
  const handleAddPoleRow = () => {
    setPoles((prev) => [
      ...prev,
      {
        pole_contract_id: poleContracts[0]?.id || '',
        pole_type: 'TM',
        quantity: 1,
      },
    ])
  }

  // Handle Remove Pole Row
  const handleRemovePoleRow = (idx) => {
    setPoles((prev) => prev.filter((_, i) => i !== idx))
  }

  // Handle Save Materials (PUT /allocations/{id}/materials)
  const handleSaveMaterials = async () => {
    if (!selectedAllocationId) return
    setSavingMaterials(true)
    setActionError('')
    try {
      await allocationsApi.putMaterials(selectedAllocationId, {
        materials: materials.map((m) => ({
          khs_code: String(m.khs_code).trim(),
          warehouse_id: m.warehouse_id,
          quantity: Number(m.quantity),
        })),
        notes: notes.trim() || undefined,
      })
      notify({
        type: 'success',
        title: 'Baris Material Disimpan',
        desc: 'Rincian material alokasi berhasil disimpan.',
        tag: 'ALOKASI',
      })
      loadDetail(selectedAllocationId)
    } catch (err) {
      setActionError(err?.message || 'Gagal menyimpan baris material.')
    } finally {
      setSavingMaterials(false)
    }
  }

  // Handle Confirm Materials (POST /allocations/{id}/confirm with part: 'materials')
  const handleConfirmMaterials = async () => {
    if (!selectedAllocationId) return
    setConfirmingMaterials(true)
    setActionError('')
    try {
      await allocationsApi.confirm(selectedAllocationId, 'materials')
      notify({
        type: 'success',
        title: 'Bagian Material Dikonfirmasi',
        desc: 'Bagian material alokasi berhasil dikonfirmasi.',
        tag: 'ALOKASI',
      })
      loadAllocations()
      loadDetail(selectedAllocationId)
    } catch (err) {
      setActionError(err?.message || 'Gagal mengonfirmasi material.')
    } finally {
      setConfirmingMaterials(false)
    }
  }

  // Handle Save Poles (PUT /allocations/{id}/poles)
  const handleSavePoles = async () => {
    if (!selectedAllocationId) return
    setSavingPoles(true)
    setActionError('')
    try {
      for (const p of poles) {
        const kr = poleContracts.find((c) => c.id === p.pole_contract_id)
        if ((kr?.lines || []).length > 0 && !p.khs_item_id) {
          setActionError(`Pilih material tiang untuk Kontrak Rinci ${kr.kr_number}.`)
          setSavingPoles(false)
          return
        }
      }
      await allocationsApi.putPoles(selectedAllocationId, {
        poles: poles.map((p) => {
          const kr = poleContracts.find((c) => c.id === p.pole_contract_id)
          const row = {
            pole_contract_id: p.pole_contract_id,
            pole_type: p.pole_type,
            quantity: Number(p.quantity),
          }
          if ((kr?.lines || []).length > 0) row.khs_item_id = p.khs_item_id
          if (p.warehouse_id) row.warehouse_id = p.warehouse_id
          return row
        }),
      })
      notify({
        type: 'success',
        title: 'Baris Tiang Disimpan',
        desc: 'Rincian tiang alokasi berhasil disimpan.',
        tag: 'ALOKASI',
      })
      loadDetail(selectedAllocationId)
    } catch (err) {
      setActionError(err?.message || 'Gagal menyimpan baris tiang.')
    } finally {
      setSavingPoles(false)
    }
  }

  // Handle Confirm Poles (POST /allocations/{id}/confirm with part: 'poles')
  const [acceptDebt, setAcceptDebt] = useState(false)
  const poleDebts = allocationDetail?.pole_debts || []
  const handleConfirmPoles = async () => {
    if (!selectedAllocationId) return
    setConfirmingPoles(true)
    setActionError('')
    try {
      await allocationsApi.confirm(selectedAllocationId, 'poles', { acceptDebt })
      notify({
        type: 'success',
        title: 'Bagian Tiang Dikonfirmasi',
        desc: 'Bagian tiang beton alokasi berhasil dikonfirmasi.',
        tag: 'ALOKASI',
      })
      setAcceptDebt(false)
      loadAllocations()
      loadDetail(selectedAllocationId)
    } catch (err) {
      setActionError(err?.message || 'Gagal mengonfirmasi tiang.')
    } finally {
      setConfirmingPoles(false)
    }
  }

  // Compatibility aliases
  const handleSaveLines = handleSaveMaterials
  const handleConfirm = handleConfirmMaterials

  // Handle Cancel Allocation (POST /allocations/{id}/cancel)
  const handleCancelAllocation = async (e) => {
    e.preventDefault()
    if (!selectedAllocationId) return
    setCancelling(true)
    setActionError('')
    try {
      await allocationsApi.cancel(selectedAllocationId, {
        reason: cancelReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Alokasi Dibatalkan',
        desc: 'Alokasi material berhasil dibatalkan.',
        tag: 'ALOKASI',
      })
      setCancelModalOpen(false)
      loadAllocations()
      loadDetail(selectedAllocationId)
    } catch (err) {
      setActionError(err?.message || 'Gagal membatalkan alokasi.')
    } finally {
      setCancelling(false)
    }
  }

  const materialsConfirmed = Boolean(allocationDetail?.materials_confirmed_at)
  const polesConfirmed = Boolean(allocationDetail?.poles_confirmed_at)
  const isConfirmed = Boolean(allocationDetail?.status === 'CONFIRMED' || (materialsConfirmed && polesConfirmed))
  const isCancelled = allocationDetail?.status === 'CANCELLED'
  const isDraft = !isConfirmed && !isCancelled
  // Alokasi dasar yang sudah CONFIRMED tetap berlaku; material/tiang yang datang menyusul dialokasikan lewat alokasi tambahan (tanpa membatalkan yang dasar).
  const activeBase = allocations.find((a) => !a.is_addition && a.status !== 'CANCELLED')
  const hasDraftAllocation = allocations.some((a) => a.status === 'DRAFT')
  const canOpenAllocation = effCanCreate && !hasDraftAllocation && (!activeBase || activeBase.status === 'CONFIRMED')
  const openingAddition = Boolean(activeBase)
  const canEditMaterials = !isCancelled && !materialsConfirmed && effCanManageMaterials
  const canEditPoles = !isCancelled && !polesConfirmed && effCanManagePoles

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <IconBuilding size={16} />
            <span>Alokasi Material & Tiang Proyek</span>
          </h3>
          <p className="text-[11px] text-slate-500">
            Penetapan sumber gudang material (KONSTRUKSI_UP3) dan nomor Kontrak Rinci tiang (PERENCANAAN) berdasarkan paket MTO.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canOpenAllocation && (
            <Button
              variant="primary"
              size="sm"
              icon={IconPlus}
              loading={creating}
              disabled={Boolean(createBlockReason)}
              title={createBlockReason || (openingAddition ? 'Alokasikan material/tiang yang datang menyusul tanpa membatalkan alokasi yang sudah dikonfirmasi' : 'Buka alokasi material baru dari paket MTO yang disetujui')}
              onClick={handleCreateAllocation}
            >
              {openingAddition ? 'Tambah Alokasi' : effCanManageMaterials ? 'Buat Alokasi Material' : 'Buat Alokasi'}
            </Button>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {actionError && <Alert kind="error">{actionError}</Alert>}

      {/* Allocation Versions Selector */}
      {allocations.length > 0 && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
          {allocations.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedAllocationId(a.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                selectedAllocationId === a.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>{a.is_addition ? `Tambahan v${a.version_number}` : `Alokasi v${a.version_number}`}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                  a.status === 'CONFIRMED'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                    : a.status === 'DRAFT'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                }`}
              >
                {a.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-500">
          <Spinner size="lg" label="Memuat alokasi material..." />
        </div>
      ) : allocations.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          {effCanCreate
            ? (createBlockReason || (effCanManageMaterials ? 'Belum ada alokasi material. Klik Buat Alokasi Material untuk menetapkan sumber gudang dari paket MTO.' : 'Belum ada alokasi. Klik Buat Alokasi untuk mengisi bagian tiang.'))
            : 'Belum ada alokasi untuk permohonan ini. Alokasi dibuka oleh Konstruksi UP3 atau Perencanaan setelah paket MTO disetujui.'}
        </div>
      ) : loadingDetail ? (
        <div className="py-20 text-center text-slate-500">
          <Spinner size="lg" label="Memuat rincian alokasi..." />
        </div>
      ) : !allocationDetail ? null : (
        <div className="space-y-6">
          {/* Header Status Card */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {allocationDetail.is_addition ? 'Alokasi Tambahan' : 'Alokasi Versi'} #{allocationDetail.version_number}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    isConfirmed
                      ? 'bg-emerald-100 text-emerald-800'
                      : isDraft
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {allocationDetail.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isConfirmed && `Dikonfirmasi pada: ${allocationDetail.confirmed_at || '-'}`}
                {isCancelled && `Dibatalkan: ${allocationDetail.cancel_reason || '-'}`}
                {isDraft && `Status: Material (${materialsConfirmed ? 'Terkonfirmasi' : 'Draf'}) · Tiang (${polesConfirmed ? 'Terkonfirmasi' : 'Draf'})`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {effCanCreateOrCancel && !isCancelled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCancelReason('')
                    setCancelModalOpen(true)
                  }}
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                >
                  Batalkan Alokasi
                </Button>
              )}
            </div>
          </div>

          {/* Section 1: Materials Allocation (peran Perencanaan hanya melihat bagian tiang) */}
          {showMaterialsSection && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  1. Alokasi Material KHS & Gudang Sumber
                </h4>
                <p className="text-[11px] text-slate-500">
                  Dikelola oleh KONSTRUKSI_UP3 (allocations.manage) untuk semua material selain tiang beton.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    materialsConfirmed
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                  }`}
                >
                  {materialsConfirmed
                    ? `Terkonfirmasi (${allocationDetail.materials_confirmed_at ? new Date(allocationDetail.materials_confirmed_at).toLocaleDateString('id-ID') : 'Ya'})`
                    : 'Draf'}
                </span>
                {canEditMaterials && (
                  <>
                    <button
                      type="button"
                      onClick={handleAddMaterialRow}
                      disabled={suggesting}
                      title="Masukkan otomatis semua kebutuhan MTO (selain tiang beton) dengan gudang dan jumlah sesuai stok: penuh bila stok cukup, 0 bila kurang"
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <IconPlus size={12} />
                      <span>{suggesting ? 'Memuat…' : 'Tambah Material'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddManualRow}
                      title="Tambah satu baris kosong untuk diisi manual"
                      className="px-2 py-1 text-[11px] font-semibold rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Baris manual
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={savingMaterials}
                      onClick={handleSaveMaterials}
                    >
                      Simpan Material
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={confirmingMaterials}
                      onClick={handleConfirmMaterials}
                      icon={IconCheck}
                    >
                      Konfirmasi Material
                    </Button>
                  </>
                )}
              </div>
            </div>

            {vendorRows.length > 0 && (
              <details className="rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/20 text-xs">
                <summary className="cursor-pointer px-3 py-2 font-semibold text-violet-900 dark:text-violet-200">
                  Material disediakan vendor ({vendorRows.length}): tidak dialokasikan dari gudang PLN
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[11px] text-violet-800 dark:text-violet-300">
                    Material ini dihargai pada RAB dan disediakan penyedia lewat SPK/WO, jadi tidak diambil dari gudang. Kebutuhannya mengikuti MTO.
                  </p>
                  <ul className="divide-y divide-violet-100 dark:divide-violet-900/40">
                    {vendorRows.map((r) => (
                      <li key={r.khs_code} className="py-1 flex items-center justify-between gap-3">
                        <span><span className="font-mono font-bold">{r.khs_code}</span> <span className="text-slate-600 dark:text-slate-300">{r.khs_name}</span></span>
                        <span className="font-mono shrink-0">{r.need.toLocaleString('id-ID')} {r.unit_text || ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                    <th className="py-2 px-3">Kode KHS</th>
                    <th className="py-2 px-3">Gudang Penyimpanan</th>
                    <th className="py-2 px-3 text-right">Jumlah Alokasi</th>
                    {canEditMaterials && (
                      <th className="py-2 px-3 text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400">
                        Belum ada baris alokasi material.
                      </td>
                    </tr>
                  ) : (
                    materials
                      .slice((matPage - 1) * matPerPage, matPage * matPerPage)
                      .map((m, idx) => {
                      const actualIdx = (matPage - 1) * matPerPage + idx
                      return (
                      <tr key={actualIdx} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-mono font-bold">
                          {canEditMaterials ? (
                            <input
                              type="text"
                              value={m.khs_code}
                              onChange={(e) => {
                                const val = e.target.value
                                setMaterials((prev) =>
                                  prev.map((item, i) =>
                                    i === actualIdx ? { ...item, khs_code: val } : item
                                  )
                                )
                              }}
                              placeholder="Kode KHS (misal: 1, 2, 7)"
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono w-40"
                            />
                          ) : (
                            m.khs_code
                          )}
                          {sugFor(m.khs_code) && (
                            <div className="font-sans font-normal text-[10px] text-slate-500 mt-0.5 max-w-xs">
                              {sugFor(m.khs_code).supplier === 'PLN' && <span className="mr-1 px-1 rounded bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 font-bold">PLN</span>}
                              {sugFor(m.khs_code).supplier === 'VENDOR' && <span className="mr-1 px-1 rounded bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 font-bold">VENDOR</span>}
                              {sugFor(m.khs_code).khs_name} · kebutuhan MTO {sugFor(m.khs_code).need.toLocaleString('id-ID')} {sugFor(m.khs_code).unit_text || ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {canEditMaterials ? (
                            (() => {
                              const sug = sugFor(m.khs_code)
                              const cands = sug?.candidates || warehouses.map((w) => ({ warehouse_id: w.id, warehouse_code: w.code, warehouse_name: w.name, level: null, available: null }))
                              const cur = cands.find((c) => c.warehouse_id === m.warehouse_id)
                              return (
                                <div className="space-y-1">
                                  {sug?.source_choice && (
                                    <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5" role="group" aria-label="Sumber material SR APP">
                                      {['ULP', 'UP3'].map((lv) => {
                                        const target = cands.filter((c) => c.level === lv).sort((x, y) => y.available - x.available)[0]
                                        return (
                                          <button
                                            key={lv}
                                            type="button"
                                            disabled={!target}
                                            aria-pressed={cur?.level === lv}
                                            onClick={() => target && changeWarehouse(actualIdx, target.warehouse_id)}
                                            className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${cur?.level === lv ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'} disabled:opacity-40`}
                                          >
                                            {lv}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                  <select
                                    value={m.warehouse_id}
                                    onChange={(e) => changeWarehouse(actualIdx, e.target.value)}
                                    className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 block"
                                  >
                                    {cands.map((c) => (
                                      <option key={c.warehouse_id} value={c.warehouse_id}>
                                        {c.level ? `[${c.level}] ` : ''}{c.warehouse_code} - {c.warehouse_name}{c.available !== null ? ` (stok ${c.available.toLocaleString('id-ID')})` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  {cur && cur.available !== null && sug && Number(m.quantity) === 0 && (
                                    <p className="text-[10px] text-amber-600">Stok di gudang ini kurang dari kebutuhan ({sug.need.toLocaleString('id-ID')}); jumlah 0 dan tidak disimpan.</p>
                                  )}
                                </div>
                              )
                            })()
                          ) : (
                            <span>{m.warehouse_code || m.warehouse_id}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {canEditMaterials ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={m.quantity}
                              onChange={(e) => {
                                const val = e.target.value
                                setMaterials((prev) =>
                                  prev.map((item, i) =>
                                    i === actualIdx ? { ...item, quantity: val } : item
                                  )
                                )
                              }}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-right w-28"
                            />
                          ) : (
                            m.quantity?.toLocaleString('id-ID')
                          )}
                        </td>
                        {canEditMaterials && (
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveMaterialRow(actualIdx)}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            >
                              <IconTrash size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>

            <TableFooter
              itemCount={materials.slice((matPage - 1) * matPerPage, matPage * matPerPage).length}
              total={materials.length}
              entityLabel="alokasi material gudang"
              page={matPage}
              perPage={matPerPage}
              onPage={setMatPage}
              onPerPage={(n) => {
                setMatPerPage(n)
                setMatPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>

          )}

          {/* Section 2: Poles Allocation (peran Konstruksi hanya melihat bagian material) */}
          {showPolesSection && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  2. Alokasi Tiang & Kontrak Rinci (KR)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Dikelola oleh PERENCANAAN (allocations.poles) untuk alokasi tiang TM dan TR dengan nomor Kontrak Rinci pabrikan.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    polesConfirmed
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                  }`}
                >
                  {polesConfirmed
                    ? `Terkonfirmasi (${allocationDetail.poles_confirmed_at ? new Date(allocationDetail.poles_confirmed_at).toLocaleDateString('id-ID') : 'Ya'})`
                    : 'Draf'}
                </span>
                {canEditPoles && (
                  <>
                    <button
                      type="button"
                      onClick={handleAddPoleRow}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <IconPlus size={12} />
                      <span>Tambah Tiang</span>
                    </button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={savingPoles}
                      onClick={handleSavePoles}
                    >
                      Simpan Tiang
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={confirmingPoles}
                      disabled={poleDebts.length > 0 && !acceptDebt}
                      title={poleDebts.length > 0 && !acceptDebt ? 'Setujui kelebihan sebagai utang kerja terlebih dahulu' : undefined}
                      onClick={handleConfirmPoles}
                      icon={IconCheck}
                    >
                      Konfirmasi Tiang
                    </Button>
                  </>
                )}
              </div>
            </div>

            {poleDebts.length > 0 && (
              <Alert kind="warning">
                <div className="font-semibold">Utang kerja: alokasi melebihi sisa Kontrak Rinci</div>
                <ul className="mt-1 text-[11px] font-mono list-disc ml-4">
                  {poleDebts.map((d) => (
                    <li key={`${d.kr_number}-${d.pole_type}`}>{d.kr_number} tiang {d.pole_type}: alokasi {d.quantity}, sisa {d.remaining}, kelebihan {d.over} batang</li>
                  ))}
                </ul>
                {canEditPoles && (
                  <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold cursor-pointer">
                    <input type="checkbox" checked={acceptDebt} onChange={(e) => setAcceptDebt(e.target.checked)} />
                    <span>Setujui kelebihan sebagai utang kerja (saldo KR menjadi negatif)</span>
                  </label>
                )}
              </Alert>
            )}

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                    <th className="py-2 px-3">Nomor Kontrak Rinci (KR)</th>
                    <th className="py-2 px-3">Material Tiang</th>
                    <th className="py-2 px-3">Jenis Tiang</th>
                    <th className="py-2 px-3">Keterangan gudang asal</th>
                    <th className="py-2 px-3 text-right">Jumlah Alokasi (Batang)</th>
                    {canEditPoles && (
                      <th className="py-2 px-3 text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                  {poles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        Belum ada baris alokasi tiang.
                      </td>
                    </tr>
                  ) : (
                    poles
                      .slice((polePage - 1) * polePerPage, polePage * polePerPage)
                      .map((p, idx) => {
                      const actualIdx = (polePage - 1) * polePerPage + idx
                      const krRow = poleContracts.find((c) => c.id === p.pole_contract_id)
                      const krLines = krRow?.lines || []
                      const hasLines = krLines.length > 0
                      const setPole = (patch) =>
                        setPoles((prev) =>
                          prev.map((item, i) => (i === actualIdx ? { ...item, ...patch } : item)),
                        )
                      return (
                      <tr key={actualIdx} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-mono font-bold">
                          {canEditPoles ? (
                            <select
                              value={p.pole_contract_id}
                              aria-label="Kontrak Rinci"
                              onChange={(e) => {
                                setPole({ pole_contract_id: e.target.value, khs_item_id: '' })
                              }}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                            >
                              {poleContracts.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.kr_number} (Sisa TM: {c.tm?.remaining}, TR: {c.tr?.remaining})
                                </option>
                              ))}
                            </select>
                          ) : (
                            p.kr_number || p.pole_contract_id
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {canEditPoles ? (
                            hasLines ? (
                              <select
                                value={p.khs_item_id || ''}
                                aria-label="Material tiang"
                                onChange={(e) => {
                                  const ln = krLines.find((l) => l.khs_item_id === e.target.value)
                                  setPole(
                                    ln
                                      ? { khs_item_id: ln.khs_item_id, pole_type: ln.pole_type }
                                      : { khs_item_id: '' },
                                  )
                                }}
                                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                              >
                                <option value="">— pilih material tiang —</option>
                                {krLines.map((l) => (
                                  <option key={l.khs_item_id} value={l.khs_item_id}>
                                    {l.khs_code} · {l.pole_type} (sisa {l.remaining})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )
                          ) : (
                            <span className="font-mono">{p.khs_code || '-'}</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {canEditPoles && !hasLines ? (
                            <select
                              value={p.pole_type}
                              onChange={(e) => setPole({ pole_type: e.target.value })}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                            >
                              <option value="TM">TM (Tegangan Menengah)</option>
                              <option value="TR">TR (Tegangan Rendah)</option>
                            </select>
                          ) : (
                            <span className="font-bold">Tiang {p.pole_type}</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {canEditPoles ? (
                            <select
                              value={p.warehouse_id || ''}
                              aria-label="Keterangan gudang asal"
                              onChange={(e) => setPole({ warehouse_id: e.target.value })}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                            >
                              <option value="">— tidak ditentukan —</option>
                              {warehouses.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.code} - {w.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-mono">{p.warehouse_code || '-'}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {canEditPoles ? (
                            <input
                              type="number"
                              min="1"
                              value={p.quantity}
                              onChange={(e) => {
                                const val = e.target.value
                                setPoles((prev) =>
                                  prev.map((item, i) =>
                                    i === actualIdx ? { ...item, quantity: val } : item
                                  )
                                )
                              }}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-right w-24"
                            />
                          ) : (
                            p.quantity?.toLocaleString('id-ID')
                          )}
                        </td>
                        {canEditPoles && (
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemovePoleRow(actualIdx)}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            >
                              <IconTrash size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>

            <TableFooter
              itemCount={poles.slice((polePage - 1) * polePerPage, polePage * polePerPage).length}
              total={poles.length}
              entityLabel="alokasi tiang KR"
              page={polePage}
              perPage={polePerPage}
              onPage={setPolePage}
              onPerPage={(n) => {
                setPolePerPage(n)
                setPolePage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>

          )}

          {/* Notes */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs">
            <label className="font-semibold text-slate-700 dark:text-slate-300 block">
              Catatan Alokasi
            </label>
            {canEditMaterials ? (
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan alokasi gudang / tiang..."
                className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            ) : (
              <p className="text-slate-600 dark:text-slate-400 italic">
                {allocationDetail.notes || 'Tidak ada catatan.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* DRAWER: Cancel Allocation */}
      <Drawer
        open={cancelModalOpen}
        title="Batalkan Alokasi Material"
        onClose={() => setCancelModalOpen(false)}
        size="max-w-md"
      >
        <form onSubmit={handleCancelAllocation} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Apakah Anda yakin ingin membatalkan alokasi ini? Pembatalan alokasi akan membebaskan kembali kuota tiang KR dan reservasi gudang terkait.
          </p>
          {!allocationDetail?.is_addition && allocations.some((a) => a.is_addition && a.status !== 'CANCELLED') && (
            <p className="text-amber-700 dark:text-amber-400 font-semibold">
              Alokasi tambahan yang masih berjalan ikut dibatalkan. Untuk menambah material yang datang menyusul, gunakan Tambah Alokasi, bukan membatalkan.
            </p>
          )}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Alasan Pembatalan * (Wajib untuk catatan audit)
            </label>
            <textarea
              rows={3}
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Contoh: Pembatalan permohonan oleh pelanggan atau revisi desain jaringan..."
              className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCancelModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={cancelling}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Ya, Batalkan Alokasi
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
