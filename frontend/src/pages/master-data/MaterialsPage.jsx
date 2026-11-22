import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { masterDataApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Drawer from '../../components/Drawer.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { useNavigate } from 'react-router-dom'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import { downloadCsv, MATERIAL_ERP_TEMPLATE } from '../../utils/csvTemplates.js'
import { useDebounce } from '../../utils/useDebounce.js'
import {
  IconSearch,
  IconRefresh,
  IconEye,
  IconPencil,
  IconUpload,
  IconDownload,
  IconTag,
  IconPlus,
  IconAlertCircle,
  IconCheckCircle,
  IconHistory,
  IconTrash,
} from '../../components/icons.jsx'
import { filterSelectCls, filterSearchCls } from '../../components/filterStyles.js'

export default function MaterialsPage() {
  const navigate = useNavigate()
  const { can, canWrite } = useAccess()
  const { notify } = useNotifications()
  const searchInputRef = useRef(null)

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [unmappedOnly, setUnmappedOnly] = useState(false)
  const [categories, setCategories] = useState([])

  // Drawer & Modal states
  const [detailTarget, setDetailTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)

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

  // Load categories for filter
  useEffect(() => {
    masterDataApi.categories()
      .then((res) => setCategories(res.data ?? []))
      .catch(() => {})
  }, [])

  // Hierarchy mapping for Categories
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const activeParentCategories = useMemo(() => {
    const parents = []
    const childrenMap = new Map()

    categories.forEach((c) => {
      if (!c.is_active) return
      if (!c.parent_id || c.level === 1) {
        parents.push(c)
      } else {
        if (!childrenMap.has(c.parent_id)) {
          childrenMap.set(c.parent_id, [])
        }
        childrenMap.get(c.parent_id).push(c)
      }
    })

    parents.sort((a, b) => String(a.code).localeCompare(String(b.code)))

    return parents.map((p) => {
      const children = childrenMap.get(p.id) || []
      children.sort((a, b) => String(a.code).localeCompare(String(b.code)))
      return {
        ...p,
        children,
      }
    })
  }, [categories])

  // Load materials list
  const loadMaterials = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    const params = {
      page,
      per_page: perPage,
      search: debouncedSearch || undefined,
      category_id: selectedCategory || undefined,
      is_active: activeFilter !== '' ? activeFilter : undefined,
      unmapped: unmappedOnly ? '1' : undefined,
    }
    masterDataApi.materials(params)
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta }))
      .catch((e) => setState({ loading: false, error: e.message, rows: [], meta: null }))
  }, [page, perPage, debouncedSearch, selectedCategory, activeFilter, unmappedOnly])

  useEffect(() => {
    loadMaterials()
  }, [loadMaterials])

  const handleDeactivateMaterial = async (reason) => {
    if (!deactivateTarget) return
    try {
      await masterDataApi.updateMaterial(deactivateTarget.id, {
        category_id: deactivateTarget.category?.id || null,
        is_active: false,
        reason: reason || 'Nonaktifkan material melalui katalog',
      })
      setDeactivateTarget(null)
      notify({
        type: 'warning',
        title: 'Material Dinonaktifkan',
        desc: `Material ${deactivateTarget.code} (${deactivateTarget.name}) berhasil dinonaktifkan.`,
        tag: 'Material',
      })
      loadMaterials()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Menonaktifkan Material',
        desc: err.message || 'Gagal menonaktifkan material.',
        tag: 'Material',
      })
    }
  }

  const stats = useMemo(() => {
    const total = state.meta?.total ?? state.rows.length
    const activeCount = state.rows.filter((r) => r.is_active).length
    const mappedCount = state.rows.filter((r) => r.category).length
    const unmappedCount = state.rows.filter((r) => !r.category).length
    return {
      total,
      activeCount,
      mappedCount,
      unmappedCount,
    }
  }, [state.rows, state.meta])

  return (
    <div className="space-y-6">
      {/* Header Modul Katalog Material ERP */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconTag className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Katalog Material ERP
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Master SKU Logistik PLN
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Master SKU material distribusi PLN yang tersinkronisasi dari sistem ERP/Gudang. Kode, nama, dan satuan dikelola terpusat.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={loadMaterials}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={IconUpload}
              onClick={() => navigate('/master-data/materials/impor')}
            >
              Impor Batch ERP
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Material */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Material SKU</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconTag className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Item SKU ERP di katalog</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Material Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.activeCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Siap alokasi &amp; transaksi</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Terpetakan Kategori</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.mappedCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Terkategori secara hierarkis</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Belum Terpetakan</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.unmappedCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu penetapan kategori</p>
        </div>
      </dl>

      {/* Main Standardized Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Filter Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cari kode SKU atau nama material…"
              className={`${filterSearchCls} w-full`}
            />
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                /
              </span>
            </span>
          </div>

          {/* Category Filter */}
          <div className="min-w-[190px]">
            <select
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setPage(1) }}
              aria-label="Filter Kategori Material"
              className={`${filterSelectCls} w-full`}
            >
              <option value="">Semua Kategori</option>
              {activeParentCategories.map((parent) => (
                <optgroup key={parent.id} label={`${parent.code} - ${parent.name}`}>
                  <option value={parent.id}>-- Semua di {parent.name} --</option>
                  {parent.children.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.code} - {sub.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Active Status Filter */}
          <div className="min-w-[130px]">
            <select
              value={activeFilter}
              onChange={(e) => { setActiveFilter(e.target.value); setPage(1) }}
              aria-label="Filter Status Material"
              className={`${filterSelectCls} w-full`}
            >
              <option value="">Semua Status</option>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </select>
          </div>

          {/* Unmapped Filter Button */}
          <button
            type="button"
            onClick={() => { setUnmappedOnly((prev) => !prev); setPage(1) }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              unmappedOnly
                ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
            }`}
          >
            <IconTag size={14} />
            <span>Belum Terpetakan</span>
          </button>

          {/* Reset & Refresh */}
          <div className="flex items-center gap-2 self-end lg:self-auto">
            {(search || selectedCategory || activeFilter !== '' || unmappedOnly) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setSelectedCategory('')
                  setActiveFilter('')
                  setUnmappedOnly(false)
                  setPage(1)
                }}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline px-1 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div>
          {state.error && <div className="p-5"><Alert>{state.error}</Alert></div>}
          {state.loading && <div className="p-8"><Spinner /></div>}

          {!state.loading && !state.error && state.rows.length === 0 && (
            <EmptyState
              icon={IconTag}
              title="Belum ada material"
              description="Katalog material masih kosong. Klik tombol &quot;Impor Batch ERP&quot; untuk mengunggah master SKU dari sistem inventaris."
            />
          )}

          {!state.loading && state.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                  <tr>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      KODE & NAMA MATERIAL
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      KATEGORI
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      SATUAN & SPESIFIKASI
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      STATUS
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.rows.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="font-bold text-slate-900 dark:text-slate-100">{m.name}</div>
                        <div className="font-mono text-xs text-slate-400 dark:text-slate-500 mt-0.5">{m.code}</div>
                      </td>
                      <td className="py-3.5 px-6">
                        {m.category ? (
                          <div className="flex flex-col">
                            {(() => {
                              const catMeta = categoryMap.get(m.category.id)
                              const parentCat = catMeta?.parent_id ? categoryMap.get(catMeta.parent_id) : null
                              const parentName = parentCat?.name || (catMeta?.parent_code ? catMeta.parent_code : null)
                              return (
                                <>
                                  {parentName && (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-tight">
                                      {parentName} ›
                                    </span>
                                  )}
                                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                    {m.category.name}
                                  </span>
                                </>
                              )
                            })()}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
                            Belum Terpetakan
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {m.unit}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={m.spec ?? '-'}>
                            {m.spec || '-'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <StatusBadge status={m.is_active ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailTarget(m)}
                            aria-label="Detail"
                            title="Lihat Detail & Riwayat Audit"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                          >
                            <IconEye size={13} />
                            <span>Detail</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/master-data/materials/${m.id}/ubah`)}
                            aria-label="Edit"
                            title="Ubah Pemetaan Kategori & Status"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                          >
                            <IconPencil size={13} />
                            <span>Ubah</span>
                          </button>

                          {m.is_active && (
                            <button
                              type="button"
                              onClick={() => setDeactivateTarget(m)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                            >
                              <IconTrash size={13} />
                              <span>Nonaktifkan</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Standardized Table Pagination Footer */}
          {state.meta && (
            <TableFooter
              itemCount={state.rows.length}
              total={state.meta.total}
              entityLabel="material"
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

      {/* Detail Drawer */}
      {detailTarget && (
        <MaterialDetailDrawer
          material={detailTarget}
          categoryMap={categoryMap}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            const t = detailTarget
            setDetailTarget(null)
            navigate(`/master-data/materials/${t.id}/ubah`)
          }}
        />
      )}

      {/* Deactivate Confirmation Modal */}
      <ConfirmationModal
        open={Boolean(deactivateTarget)}
        title={deactivateTarget ? `Nonaktifkan Material: ${deactivateTarget.code}` : 'Nonaktifkan Material'}
        description={
          deactivateTarget
            ? `Nonaktifkan material "${deactivateTarget.name}" (${deactivateTarget.code})?`
            : ''
        }
        confirmLabel="Nonaktifkan"
        variant="danger"
        requireInput={true}
        inputLabel="Alasan Nonaktifkan (Audit Trail)"
        inputPlaceholder="Contoh: Material tidak lagi digunakan pada katalog aktif..."
        onConfirm={handleDeactivateMaterial}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  )
}

function MaterialDetailDrawer({ material, categoryMap, onClose, onEdit }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(material)

  useEffect(() => {
    masterDataApi.material(material.id)
      .then((res) => {
        setData(res.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [material.id])

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title="Detail Material ERP"
      subtitle={`${data.code} · Sumber: ${data.source_system ?? 'ERP'}`}
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          <Button variant="primary" onClick={onEdit}>Ubah Kategori / Status</Button>
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        {loading && <Spinner />}

        {/* Identity Card */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Nama SKU</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{data.name}</h3>
            </div>
            <StatusBadge status={data.is_active ? 'ACTIVE' : 'INACTIVE'} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/70 dark:border-slate-700/60 text-xs">
            <div>
              <span className="text-slate-400 block">Kode Material</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{data.code}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Satuan (UoM)</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{data.unit}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Kategori</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {(() => {
                  if (!data.category) return 'Belum Terpetakan'
                  const catMeta = categoryMap?.get(data.category.id)
                  const parentCat = catMeta?.parent_id ? categoryMap?.get(catMeta.parent_id) : null
                  const parentName = parentCat?.name || catMeta?.parent_code
                  return parentName ? `${parentName} › ${data.category.name}` : data.category.name
                })()}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <span className="text-slate-400 block">Spesifikasi</span>
              <span className="text-slate-700 dark:text-slate-300">{data.spec || 'Tidak ada catatan spesifikasi teknis.'}</span>
            </div>
          </div>
        </div>

        {/* Immutable Notice */}
        <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <strong>Perhatian:</strong> Kode SKU, Nama, Satuan, dan Spesifikasi dikontrol oleh sistem ERP/Gudang terpusat dan tidak dapat diubah sembarangan dari DISTRIVA untuk mencegah ketidaksesuaian logistik.
        </div>

        {/* Change Logs Audit Timeline */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <IconHistory size={16} className="text-slate-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Riwayat Perubahan & Audit Trail
            </h4>
          </div>

          {(!data.change_logs || data.change_logs.length === 0) ? (
            <p className="text-xs text-slate-400 italic">Belum ada riwayat perubahan manual pada material ini.</p>
          ) : (
            <div className="space-y-2.5">
              {data.change_logs.map((log, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{log.change_type}</span>
                    <span className="text-slate-400 text-[11px]">{new Date(log.changed_at).toLocaleString('id-ID')}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">Alasan: {log.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

export function MaterialEditDrawer({ asPage = false, material, categories, onClose, onSuccess }) {
  const [categoryId, setCategoryId] = useState(material.category?.id || '')
  const [isActive, setIsActive] = useState(Boolean(material.is_active))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectableGroups = useMemo(() => {
    const parents = []
    const childrenMap = new Map()

    categories.forEach((c) => {
      if (!c.is_active) return
      if (!c.parent_id || c.level === 1) {
        parents.push(c)
      } else {
        if (!childrenMap.has(c.parent_id)) {
          childrenMap.set(c.parent_id, [])
        }
        childrenMap.get(c.parent_id).push(c)
      }
    })

    parents.sort((a, b) => String(a.code).localeCompare(String(b.code)))

    return parents.map((p) => {
      const children = childrenMap.get(p.id) || []
      children.sort((a, b) => String(a.code).localeCompare(String(b.code)))
      return { ...p, children }
    })
  }, [categories])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Alasan perubahan audit wajib diisi.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await masterDataApi.updateMaterial(material.id, {
        category_id: categoryId || null,
        is_active: isActive,
        reason: reason.trim(),
      })
      onSuccess(res.data)
    } catch (err) {
      setError(err.message || 'Gagal memperbarui material.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={true}
      onClose={onClose}
      title="Ubah Pemetaan Material"
      subtitle={`${material.code} - ${material.name}`}
      width="max-w-xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Menyimpan…' : 'Simpan Perubahan'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-sm">
        {error && <Alert>{error}</Alert>}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Kategori Material Standar
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="Kategori Material Standar"
            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:border-emerald-500 outline-none"
          >
            <option value="">-- Tanpa Kategori (Belum Terpetakan) --</option>
            {selectableGroups.map((group) => {
              if (group.children.length === 0) {
                return (
                  <option key={group.id} value={group.id}>
                    {group.code} - {group.name}
                  </option>
                )
              }
              return (
                <optgroup key={group.id} label={`${group.code} - ${group.name}`}>
                  {group.children.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.code} - {sub.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Status Operasional
          </label>
          <div className="flex items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs sm:text-sm text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="status"
                checked={isActive}
                onChange={() => setIsActive(true)}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              <span>Aktif</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs sm:text-sm text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="status"
                checked={!isActive}
                onChange={() => setIsActive(false)}
                className="text-rose-600 focus:ring-rose-500"
              />
              <span>Nonaktif</span>
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="material-edit-reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Perubahan (Audit Trail) <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="material-edit-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Pemetaan ulang kategori trafo distribusi sesuai katalog ERP 2026..."
            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-emerald-500 outline-none"
            required
          />
        </div>
      </form>
    </PanelShell>
  )
}

export function MaterialImportDrawer({ asPage = false, categories = [], onClose, onSuccess }) {
  const [mode, setMode] = useState('upload') // 'upload' | 'manual'
  const [file, setFile] = useState(null)
  const [manualCode, setManualCode] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualUnit, setManualUnit] = useState('')
  const [manualCategoryCode, setManualCategoryCode] = useState('')
  const [manualSpec, setManualSpec] = useState('')

  const selectableGroups = useMemo(() => {
    const parents = []
    const childrenMap = new Map()

    categories.forEach((c) => {
      if (!c.is_active) return
      if (!c.parent_id || c.level === 1) {
        parents.push(c)
      } else {
        if (!childrenMap.has(c.parent_id)) {
          childrenMap.set(c.parent_id, [])
        }
        childrenMap.get(c.parent_id).push(c)
      }
    })

    parents.sort((a, b) => String(a.code).localeCompare(String(b.code)))

    return parents.map((p) => {
      const children = childrenMap.get(p.id) || []
      children.sort((a, b) => String(a.code).localeCompare(String(b.code)))
      return { ...p, children }
    })
  }, [categories])

  const [stagingData, setStagingData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [approveUnitChanges, setApproveUnitChanges] = useState(false)

  const handleStage = async (e) => {
    if (e) e.preventDefault()
    let targetFile = file

    if (mode === 'manual') {
      if (!manualCode.trim() || !manualName.trim() || !manualUnit.trim()) {
        setError('Kode SKU, Nama Material, dan Satuan wajib diisi.')
        return
      }
      const csvRow = [
        `"${manualCode.trim().replace(/"/g, '""')}"`,
        `"${manualName.trim().replace(/"/g, '""')}"`,
        `"${manualUnit.trim().replace(/"/g, '""')}"`,
        `"${manualSpec.trim().replace(/"/g, '""')}"`,
        `"${manualCategoryCode.trim().replace(/"/g, '""')}"`,
      ].join(',')
      const csvContent = `code,name,unit,spec,category_code\n${csvRow}\n`
      targetFile = new File([csvContent], 'manual-material.csv', { type: 'text/csv' })
    } else if (!targetFile) {
      setError('Pilih berkas CSV material terlebih dahulu.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', targetFile)
      const res = await masterDataApi.stageMaterialImport(formData)
      setStagingData(res.data)
    } catch (err) {
      setError(err.message || 'Gagal memproses pratinjau staging.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!stagingData) return
    setConfirming(true)
    setError('')
    try {
      await masterDataApi.confirmMaterialImport(stagingData.id, {
        approve_unit_changes: approveUnitChanges,
      })
      onSuccess()
    } catch (err) {
      setError(err.message || 'Gagal mengonfirmasi impor material.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={true}
      onClose={onClose}
      title="Impor Batch Material ERP (Two-Phase)"
      subtitle="Staging preview & validasi integritas sebelum commit ke master"
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading || confirming}>Batal</Button>
          {stagingData ? (
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={confirming || stagingData.inserted + stagingData.updated === 0}
            >
              {confirming ? 'Menerapkan ke Master…' : `Konfirmasi Komit (${stagingData.inserted + stagingData.updated} Item)`}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleStage}
              disabled={loading || (mode === 'upload' ? !file : !manualCode.trim() || !manualName.trim() || !manualUnit.trim())}
            >
              {loading ? 'Memvalidasi…' : 'Mulai Pratinjau Staging'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => {
              setMode('upload')
              setStagingData(null)
              setError('')
            }}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'upload'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <IconUpload size={14} />
            <span>Via Upload (CSV)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('manual')
              setStagingData(null)
              setError('')
            }}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'manual'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <IconPlus size={14} />
            <span>Tambah Manual</span>
          </button>
        </div>

        {error && <Alert>{error}</Alert>}

        {!stagingData ? (
          mode === 'upload' ? (
            <form onSubmit={handleStage} className="space-y-4">
              {/* Download Template Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="space-y-0.5">
                  <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
                    Format Berkas CSV Material ERP
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Unduh template resmi berisi nama header kolom standar untuk mencegah galat validasi.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => downloadCsv('template-material-erp.csv', MATERIAL_ERP_TEMPLATE)}
                  className="text-xs py-1.5 px-3 shrink-0"
                >
                  <IconDownload size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span>Unduh Template CSV</span>
                </Button>
              </div>

              <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-6 text-center hover:border-emerald-500 transition-colors">
                <IconUpload size={32} className="mx-auto text-slate-400 mb-2" />
                <label htmlFor="csv-upload" className="block text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                  Pilih Berkas CSV Material ERP
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Format UTF-8, kolom wajib: <code>code, name, unit</code>. Kolom opsional: <code>spec, category_code</code>.
                </p>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                  className="mt-4 text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
              </div>
            </form>
          ) : (
            <form onSubmit={handleStage} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kode SKU Material <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Contoh: 1002389"
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Satuan (UoM) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={manualUnit}
                    onChange={(e) => setManualUnit(e.target.value)}
                    placeholder="Contoh: U, M, BH"
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Material <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Contoh: TRF DIS;;20kV/231V;1P;25kVA;;OD"
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kategori Material (Opsional)
                </label>
                <select
                  value={manualCategoryCode}
                  onChange={(e) => setManualCategoryCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                >
                  <option value="">-- Pilih Kategori --</option>
                  {selectableGroups.map((group) => {
                    if (group.children.length === 0) {
                      return (
                        <option key={group.id} value={group.code}>
                          {group.code} - {group.name}
                        </option>
                      )
                    }
                    return (
                      <optgroup key={group.id} label={`${group.code} - ${group.name}`}>
                        {group.children.map((sub) => (
                          <option key={sub.id} value={sub.code}>
                            {sub.code} - {sub.name}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Spesifikasi (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={manualSpec}
                  onChange={(e) => setManualSpec(e.target.value)}
                  placeholder="Catatan spesifikasi teknis..."
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>
            </form>
          )
        ) : (
          <div className="space-y-5">
            {/* Staging Summary Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                <span className="text-xs text-emerald-600 dark:text-emerald-400 block font-medium">Baru (Insert)</span>
                <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{stagingData.inserted}</span>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center">
                <span className="text-xs text-blue-600 dark:text-blue-400 block font-medium">Update</span>
                <span className="text-xl font-bold text-blue-700 dark:text-blue-300">{stagingData.updated}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                <span className="text-xs text-slate-500 block font-medium">Sama</span>
                <span className="text-xl font-bold text-slate-700 dark:text-slate-300">{stagingData.unchanged}</span>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center">
                <span className="text-xs text-rose-600 dark:text-rose-400 block font-medium">Ditolak</span>
                <span className="text-xl font-bold text-rose-700 dark:text-rose-300">{stagingData.rejected}</span>
              </div>
            </div>

            {stagingData.unit_changes > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-xs">
                  <IconAlertCircle size={16} />
                  <span>Ditemukan {stagingData.unit_changes} perubahan satuan (UoM)</span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Perubahan satuan pada master data dapat memengaruhi kalkulasi MTO. Anda wajib memberikan konfirmasi izin khusus:
                </p>
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-amber-900 dark:text-amber-200 pt-1">
                  <input
                    type="checkbox"
                    checked={approveUnitChanges}
                    onChange={(e) => setApproveUnitChanges(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <span>Saya memahami dan menyetujui perubahan satuan pada batch ini</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </PanelShell>
  )
}
