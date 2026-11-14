import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { masterDataApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import {
  downloadCsv,
  CATEGORIES_TEMPLATE,
  UNITS_TEMPLATE,
} from '../../utils/csvTemplates.js'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconPlus,
  IconPencil,
  IconUpload,
  IconDownload,
  IconCheck,
  IconTrash,
  IconChevronDown,
  IconSearch,
  IconRefresh,
  IconFolder,
  IconTag,
} from '../../components/icons.jsx'

function readFileText(file) {
  if (typeof file?.text === 'function') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Gagal membaca berkas CSV.'))
    reader.readAsText(file)
  })
}

function parseCsvLine(line, delimiter = ',') {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseCsvContent(rawText) {
  const cleaned = String(rawText || '').replace(/^\uFEFF/, '')
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }

  const firstLine = lines[0]
  const delimiter =
    firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  const headers = parseCsvLine(firstLine, delimiter).map((h) =>
    h.toLowerCase().replace(/\s+/g, '_').replace(/^["']|["']$/g, '')
  )

  const rows = lines.slice(1).map((line, idx) => {
    const values = parseCsvLine(line, delimiter)
    const record = {}
    headers.forEach((h, colIdx) => {
      record[h] = values[colIdx] !== undefined ? values[colIdx] : ''
    })
    return { rowNumber: idx + 2, record, rawValues: values }
  })

  return { headers, rows }
}

export default function CategoriesPage() {
  const navigate = useNavigate()
  const { can, loading: accessLoading } = useAccess()
  const { notify } = useNotifications()
  const [tab, setTab] = useState('categories') // 'categories' | 'units'

  // Access check:
  // If AccessContext was loaded with explicit permissions, check 'material_categories.manage'.
  // If running in raw test harness without AccessProvider, default to true.
  const canManage = accessLoading && Object.keys(can || {}).length === 0
    ? true
    : Boolean(can?.['material_categories.manage'])

  // Data
  const [categories, setCategories] = useState([])
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Search & Filter state for categories
  const [searchCategory, setSearchCategory] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())

  // Pagination
  const [catPage, setCatPage] = useState(1)
  const [catPerPage, setCatPerPage] = useState(10)
  const [unitPage, setUnitPage] = useState(1)
  const [unitPerPage, setUnitPerPage] = useState(10)

  // Unified Create/Import & Edit Drawers
  const [deactivateCategoryTarget, setDeactivateCategoryTarget] = useState(null)

  const [deactivateUnitTarget, setDeactivateUnitTarget] = useState(null)

  const loadData = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      masterDataApi.categories(),
      masterDataApi.units(),
    ])
      .then(([catRes, unitRes]) => {
        setCategories(catRes.data ?? [])
        setUnits(unitRes.data ?? [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Gagal memuat referensi.')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDeactivateCategory = async () => {
    if (!deactivateCategoryTarget) return
    try {
      await masterDataApi.updateCategory(deactivateCategoryTarget.id, {
        name: deactivateCategoryTarget.name,
        description: deactivateCategoryTarget.description || null,
        is_active: false,
      })
      setDeactivateCategoryTarget(null)
      loadData()
      notify({
        type: 'warning',
        title: 'Kategori Dinonaktifkan',
        desc: `Kategori ${deactivateCategoryTarget.code} (${deactivateCategoryTarget.name}) telah dinonaktifkan.`,
        tag: 'KATEGORI',
      })
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Menonaktifkan Kategori',
        desc: err.message || 'Gagal menonaktifkan kategori.',
        tag: 'KATEGORI',
      })
    }
  }

  const handleDeactivateUnit = async () => {
    if (!deactivateUnitTarget) return
    try {
      await masterDataApi.updateUnit(deactivateUnitTarget.id, {
        name: deactivateUnitTarget.name,
        symbol: deactivateUnitTarget.symbol,
        is_active: false,
      })
      setDeactivateUnitTarget(null)
      loadData()
      notify({
        type: 'warning',
        title: 'Satuan Dinonaktifkan',
        desc: `Satuan ${deactivateUnitTarget.code} (${deactivateUnitTarget.name}) telah dinonaktifkan.`,
        tag: 'SATUAN',
      })
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Menonaktifkan Satuan',
        desc: err.message || 'Gagal menonaktifkan satuan.',
        tag: 'SATUAN',
      })
    }
  }

  // Hierarchy mapping for Categories
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const { activeCategoriesCount, activeSubcategoriesCount, filteredParents } = useMemo(() => {
    let actCatCount = 0
    let actSubCount = 0

    const rawParents = []
    const childrenByParent = new Map()

    categories.forEach((c) => {
      const isParent = !c.parent_id || c.level === 1
      if (isParent) {
        if (c.is_active) actCatCount += 1
        rawParents.push(c)
      } else {
        if (c.is_active) actSubCount += 1
        const pid = c.parent_id
        if (!childrenByParent.has(pid)) {
          childrenByParent.set(pid, [])
        }
        childrenByParent.get(pid).push(c)
      }
    })

    const q = searchCategory.trim().toLowerCase()

    const processedParents = []

    rawParents.forEach((parent) => {
      let children = childrenByParent.get(parent.id) || []

      // Inactive filtering for children
      if (!showInactive) {
        children = children.filter((child) => child.is_active)
      } else {
        // Sort active subcategories first, inactive at bottom
        children.sort((a, b) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
          return String(a.code).localeCompare(String(b.code))
        })
      }

      // Check inactive parent filtering
      if (!showInactive && !parent.is_active) {
        return
      }

      // Search filtering
      if (q) {
        const parentMatches =
          String(parent.code).toLowerCase().includes(q) ||
          String(parent.name).toLowerCase().includes(q)

        const matchingChildren = children.filter(
          (child) =>
            String(child.code).toLowerCase().includes(q) ||
            String(child.name).toLowerCase().includes(q)
        )

        // Keep parent if parent matches or any child matches
        if (parentMatches || matchingChildren.length > 0) {
          processedParents.push({
            ...parent,
            children: parentMatches ? children : matchingChildren,
            matchedViaChild: !parentMatches && matchingChildren.length > 0,
          })
        }
      } else {
        processedParents.push({
          ...parent,
          children,
          matchedViaChild: false,
        })
      }
    })

    // Sort parents: active first, inactive at bottom
    processedParents.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      return String(a.code).localeCompare(String(b.code))
    })

    return {
      activeCategoriesCount: actCatCount,
      activeSubcategoriesCount: actSubCount,
      filteredParents: processedParents,
    }
  }, [categories, searchCategory, showInactive])

  const isSearchActive = searchCategory.trim().length > 0

  const toggleParentCollapse = (parentId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) {
        next.delete(parentId)
      } else {
        next.add(parentId)
      }
      return next
    })
  }

  const pagedParents = filteredParents.slice((catPage - 1) * catPerPage, catPage * catPerPage)
  const pagedUnits = units.slice((unitPage - 1) * unitPerPage, unitPage * unitPerPage)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            DISTRIVA / MASTER DATA
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Kategori & Satuan Pengukuran
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Referensi struktur kategori material dua tingkat (kategori & subkategori) standar PLN ERP dan satuan pengukuran logistik (UoM).
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {tab === 'categories' ? (
            canManage && (
              <button
                type="button"
                onClick={() => navigate('/master-data/categories/baru')}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
              >
                <IconPlus size={16} />
                <span>Tambah Kategori</span>
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => navigate('/master-data/categories/satuan/baru')}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Tambah Satuan</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setTab('categories')}
          className={`pb-3 border-b-2 transition cursor-pointer ${
            tab === 'categories'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Kategori Material ({categories.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('units')}
          className={`pb-3 border-b-2 transition cursor-pointer ${
            tab === 'units'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Satuan Pengukuran / UoM ({units.length})
        </button>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && <Spinner />}

      {/* Table Card */}
      {!loading && !error && (
        <>
          {tab === 'categories' ? (
            <div className="space-y-4">
              {/* Summary KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Kategori Aktif</span>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {activeCategoriesCount}
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200/60 dark:border-blue-800/60">
                    Tingkat 1
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Subkategori Aktif</span>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {activeSubcategoriesCount}
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200/60 dark:border-emerald-800/60">
                    Tingkat 2
                  </span>
                </div>
              </div>

              {/* Main Categories Tree Card */}
              <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                {/* Search & Inactive Toolbar */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <IconSearch size={16} />
                    </span>
                    <input
                      type="text"
                      value={searchCategory}
                      onChange={(e) => {
                        setSearchCategory(e.target.value)
                        setCatPage(1)
                      }}
                      placeholder="Cari kode atau nama kategori…"
                      className="block w-full pl-10 pr-4 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300 select-none">
                      <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => {
                          setShowInactive(e.target.checked)
                          setCatPage(1)
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>Tampilkan nonaktif</span>
                    </label>

                    {(searchCategory || showInactive) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchCategory('')
                          setShowInactive(false)
                          setCatPage(1)
                        }}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline px-1 cursor-pointer"
                      >
                        Reset
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={loadData}
                      title="Muat Ulang Data"
                      aria-label="Muat Ulang"
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <IconRefresh size={16} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm data-table">
                    <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                      <tr>
                        <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          KODE KATEGORI
                        </th>
                        <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          NAMA KATEGORI
                        </th>
                        <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          SUBKATEGORI
                        </th>
                        <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          JUMLAH MATERIAL
                        </th>
                        <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          STATUS
                        </th>
                        {canManage && (
                          <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                            AKSI
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {pagedParents.length === 0 ? (
                        <tr>
                          <td colSpan={canManage ? 6 : 5} className="py-8 text-center text-xs text-slate-400">
                            Tidak ada kategori yang ditemukan.
                          </td>
                        </tr>
                      ) : (
                        pagedParents.map((parent) => {
                          const hasChildren = parent.children && parent.children.length > 0
                          const isExpanded = isSearchActive || expandedIds.has(parent.id)
                          const totalMaterials = parent.materials_count ?? '-'

                          return (
                            <ParentCategoryRows
                              key={parent.id}
                              parent={parent}
                              hasChildren={hasChildren}
                              isExpanded={isExpanded}
                              totalMaterials={totalMaterials}
                              canManage={canManage}
                              onToggle={() => toggleParentCollapse(parent.id)}
                              onAddSubcategory={() => navigate(`/master-data/categories/baru?induk=${parent.id}`)}
                              onEdit={(item) => navigate(`/master-data/categories/${item.id}/ubah`)}
                              onDeactivate={(item) => setDeactivateCategoryTarget(item)}
                            />
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <TableFooter
                  itemCount={pagedParents.length}
                  total={filteredParents.length}
                  entityLabel="kategori"
                  page={catPage}
                  perPage={catPerPage}
                  onPage={setCatPage}
                  onPerPage={(newPerPage) => {
                    setCatPerPage(newPerPage)
                    setCatPage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm data-table">
                  <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                    <tr>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">KODE SATUAN</th>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">NAMA LENGKAP</th>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">SIMBOL</th>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">STATUS</th>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">AKSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {units.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                          Belum ada satuan terdaftar.
                        </td>
                      </tr>
                    ) : (
                      pagedUnits.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-6 font-mono font-bold text-slate-900 dark:text-slate-100">{u.code}</td>
                          <td className="py-3.5 px-6 font-semibold text-slate-800 dark:text-slate-200">{u.name}</td>
                          <td className="py-3.5 px-6 font-medium text-slate-600 dark:text-slate-300">{u.symbol || '-'}</td>
                          <td className="py-3.5 px-6">
                            <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => navigate(`/master-data/categories/satuan/${u.id}/ubah`)}
                                aria-label="Edit Satuan"
                                title="Ubah Nama & Simbol Satuan"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                              >
                                <IconPencil size={13} />
                                <span>Ubah</span>
                              </button>
                              {u.is_active && (
                                <button
                                  type="button"
                                  onClick={() => setDeactivateUnitTarget(u)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                                >
                                  <IconTrash size={13} />
                                  <span>Nonaktifkan</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <TableFooter
                itemCount={pagedUnits.length}
                total={units.length}
                entityLabel="satuan"
                page={unitPage}
                perPage={unitPerPage}
                onPage={setUnitPage}
                onPerPage={(newPerPage) => {
                  setUnitPerPage(newPerPage)
                  setUnitPage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            </div>
          )}
        </>
      )}

      {/* Deactivate Category Modal */}
      <ConfirmationModal
        open={Boolean(deactivateCategoryTarget)}
        title={deactivateCategoryTarget ? `Nonaktifkan Kategori: ${deactivateCategoryTarget.name}` : 'Nonaktifkan Kategori'}
        description="Kategori yang dinonaktifkan tidak akan muncul pada pilihan pemetaan baru namun histori tetap tersimpan."
        confirmLabel="Nonaktifkan"
        variant="danger"
        onConfirm={handleDeactivateCategory}
        onCancel={() => setDeactivateCategoryTarget(null)}
      />

      {/* Deactivate Unit Modal */}
      <ConfirmationModal
        open={Boolean(deactivateUnitTarget)}
        title={deactivateUnitTarget ? `Nonaktifkan Satuan: ${deactivateUnitTarget.name}` : 'Nonaktifkan Satuan'}
        description="Satuan pengukuran yang dinonaktifkan tidak dapat dipilih pada material baru."
        confirmLabel="Nonaktifkan"
        variant="danger"
        onConfirm={handleDeactivateUnit}
        onCancel={() => setDeactivateUnitTarget(null)}
      />
    </div>
  )
}

function ParentCategoryRows({
  parent,
  hasChildren,
  isExpanded,
  totalMaterials,
  canManage,
  onToggle,
  onAddSubcategory,
  onEdit,
  onDeactivate,
}) {
  const children = parent.children || []

  return (
    <>
      <tr
        className={`transition-colors ${
          hasChildren
            ? 'bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
            : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
        }`}
      >
        <td className="py-3.5 px-6">
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                onClick={onToggle}
                title={isExpanded ? 'Sembunyikan Subkategori' : 'Tampilkan Subkategori'}
                aria-label={isExpanded ? 'Tutup subkategori' : 'Buka subkategori'}
                aria-expanded={isExpanded}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition cursor-pointer"
              >
                <IconChevronDown
                  size={16}
                  className={`transform transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                />
              </button>
            ) : (
              <div className="w-6 shrink-0" />
            )}
            <span
              onClick={hasChildren ? onToggle : undefined}
              className={`font-mono font-bold text-slate-900 dark:text-slate-100 ${
                hasChildren ? 'cursor-pointer select-none' : ''
              }`}
            >
              {parent.code}
            </span>
          </div>
        </td>
        <td className="py-3.5 px-6">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">{parent.name}</span>
            {hasChildren && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                {children.length} Subkategori
              </span>
            )}
          </div>
          {parent.description && (
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-1">
              {parent.description}
            </div>
          )}
        </td>
        <td className="py-3.5 px-6 font-semibold text-xs text-slate-600 dark:text-slate-300">
          {hasChildren ? `${children.length} Subkategori` : '-'}
        </td>
        <td className="py-3.5 px-6 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
          {totalMaterials}
        </td>
        <td className="py-3.5 px-6">
          <StatusBadge status={parent.is_active ? 'ACTIVE' : 'INACTIVE'} />
        </td>
        {canManage && (
          <td className="py-3.5 px-6 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={onAddSubcategory}
                aria-label="Tambah Subkategori"
                title="Tambah Subkategori di bawah kategori ini"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/40 hover:bg-blue-100 text-blue-700 dark:text-blue-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                <IconPlus size={13} />
                <span>Subkategori</span>
              </button>
              <button
                type="button"
                onClick={() => onEdit(parent)}
                aria-label="Edit Kategori"
                title="Ubah Nama & Deskripsi Kategori"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                <IconPencil size={13} />
                <span>Ubah</span>
              </button>
              {parent.is_active && (
                <button
                  type="button"
                  onClick={() => onDeactivate(parent)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <IconTrash size={13} />
                  <span>Nonaktifkan</span>
                </button>
              )}
            </div>
          </td>
        )}
      </tr>

      {/* Subcategory Rows when expanded */}
      {hasChildren &&
        isExpanded &&
        children.map((child, idx) => {
          const isLastChild = idx === children.length - 1
          return (
            <tr
              key={child.id}
              className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
            >
              <td className="py-3 px-6">
                <div className="flex items-center gap-2 pl-7 sm:pl-9">
                  <span className="text-slate-400 dark:text-slate-500 font-mono text-xs select-none">
                    {isLastChild ? '└─' : '├─'}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {child.code}
                  </span>
                </div>
              </td>
              <td className="py-3 px-6">
                <div className="font-medium text-slate-800 dark:text-slate-200 text-xs">
                  {child.name}
                </div>
                {child.description && (
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 line-clamp-1">
                    {child.description}
                  </div>
                )}
              </td>
              <td className="py-3 px-6 text-xs text-slate-400">
                -
              </td>
              <td className="py-3 px-6 font-mono text-xs text-slate-600 dark:text-slate-400">
                {child.materials_count ?? '-'}
              </td>
              <td className="py-3 px-6">
                <StatusBadge status={child.is_active ? 'ACTIVE' : 'INACTIVE'} />
              </td>
              {canManage && (
                <td className="py-3 px-6 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(child)}
                      aria-label="Edit Subkategori"
                      title="Ubah Subkategori"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors cursor-pointer"
                    >
                      <IconPencil size={12} />
                      <span>Ubah</span>
                    </button>
                    {child.is_active && (
                      <button
                        type="button"
                        onClick={() => onDeactivate(child)}
                        title="Nonaktifkan Subkategori"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-medium text-xs transition-colors cursor-pointer"
                      >
                        <IconTrash size={12} />
                        <span>Nonaktifkan</span>
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          )
        })}
    </>
  )
}

export function CreateCategoryDrawer({ asPage = false, parentCategory, existingCategories, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const isSubcategory = Boolean(parentCategory)

  const [mode, setMode] = useState('manual') // 'manual' | 'upload'

  // Manual state
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Upload state
  const fileInputRef = useRef(null)
  const [importFile, setImportFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [importError, setImportError] = useState('')
  const [dryRunResult, setDryRunResult] = useState(null)

  const handleManualSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
      }
      if (isSubcategory) {
        payload.parent_id = parentCategory.id
      }
      await masterDataApi.createCategory(payload)
      onSuccess()
    } catch (err) {
      const msg = err.message || (isSubcategory ? 'Gagal menambahkan subkategori.' : 'Gagal menambahkan kategori.')
      setError(msg)
      notify({
        type: 'error',
        title: isSubcategory ? 'Gagal Menambah Subkategori' : 'Gagal Menambah Kategori',
        desc: msg,
        tag: 'KATEGORI',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDryRun = async (e) => {
    if (e) e.preventDefault()
    if (!importFile) return
    setDryRunLoading(true)
    setImportError('')
    setDryRunResult(null)

    try {
      const text = await readFileText(importFile)
      const { headers, rows } = parseCsvContent(text)

      if (rows.length === 0) {
        throw new Error('Berkas CSV kosong atau tidak memiliki baris data.')
      }

      const hasCodeCol = headers.some((h) => ['code', 'kode', 'kode_kategori', 'category_code'].includes(h))
      const hasNameCol = headers.some((h) => ['name', 'nama', 'nama_kategori', 'category_name'].includes(h))
      if (!hasCodeCol || !hasNameCol) {
        throw new Error('Header CSV wajib memuat kolom code,name (atau kode,nama).')
      }

      const existingByCode = new Map(
        (existingCategories || []).map((c) => [String(c.code).toUpperCase(), c])
      )
      const seenCodes = new Set()

      const evaluatedRows = rows.map(({ rowNumber, record }) => {
        const rawCode = record.code || record.kode || record.kode_kategori || record.category_code || ''
        const rCode = String(rawCode).trim().toUpperCase()
        const rName = String(record.name || record.nama || record.nama_kategori || record.category_name || '').trim()
        const rDesc = String(record.description || record.deskripsi || record.uraian || '').trim()

        const errors = []
        if (!rCode) {
          errors.push('Kode kategori wajib diisi.')
        } else {
          if (rCode.length > 30) errors.push('Kode kategori maksimal 30 karakter.')
          if (!/^[A-Z0-9_]+$/.test(rCode)) {
            errors.push('Kode kategori hanya huruf besar, angka, dan garis bawah.')
          }
          if (seenCodes.has(rCode)) {
            errors.push(`Kode kategori "${rCode}" duplikat di dalam berkas CSV.`)
          }
          seenCodes.add(rCode)
        }

        if (!rName) {
          errors.push('Nama kategori wajib diisi.')
        } else if (rName.length > 100) {
          errors.push('Nama kategori maksimal 100 karakter.')
        }

        if (rDesc.length > 1000) {
          errors.push('Deskripsi maksimal 1000 karakter.')
        }

        const existing = rCode ? existingByCode.get(rCode) : null
        const action = existing ? 'PERBARUI' : 'BARU'
        const status = errors.length === 0 ? 'OK' : 'REJECTED'

        return {
          row: rowNumber,
          code: rCode || '-',
          name: rName || '-',
          description: rDesc,
          existingId: existing?.id || null,
          action,
          status,
          errors,
        }
      })

      const accepted = evaluatedRows.filter((r) => r.status === 'OK').length
      const rejected = evaluatedRows.filter((r) => r.status === 'REJECTED').length
      const createdCount = evaluatedRows.filter((r) => r.status === 'OK' && r.action === 'BARU').length
      const updatedCount = evaluatedRows.filter((r) => r.status === 'OK' && r.action === 'PERBARUI').length

      setDryRunResult({
        total: evaluatedRows.length,
        accepted,
        rejected,
        createdCount,
        updatedCount,
        rows: evaluatedRows,
      })

      if (rejected > 0) {
        notify({
          type: 'warning',
          title: 'Pratinjau Selesai dengan Catatan',
          desc: `${accepted} baris valid, ${rejected} baris ditolak. Periksa tabel pratinjau.`,
          tag: 'KATEGORI',
        })
      } else {
        notify({
          type: 'info',
          title: 'Validasi Pratinjau Berhasil',
          desc: `Seluruh ${accepted} baris kategori valid (${createdCount} baru, ${updatedCount} diperbarui).`,
          tag: 'KATEGORI',
        })
      }
    } catch (err) {
      const msg = err?.message || 'Gagal memproses berkas CSV kategori.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Validasi CSV Gagal',
        desc: msg,
        tag: 'KATEGORI',
      })
    } finally {
      setDryRunLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!dryRunResult || dryRunResult.accepted === 0) return
    setApplying(true)
    setImportError('')

    try {
      const validRows = dryRunResult.rows.filter((r) => r.status === 'OK')
      let created = 0
      let updated = 0

      for (const r of validRows) {
        if (r.existingId) {
          await masterDataApi.updateCategory(r.existingId, {
            name: r.name,
            description: r.description || null,
            is_active: true,
          })
          updated += 1
        } else {
          await masterDataApi.createCategory({
            code: r.code,
            name: r.name,
            description: r.description || undefined,
          })
          created += 1
        }
      }

      onSuccess(`${created} kategori baru ditambahkan, ${updated} kategori diperbarui.`)
    } catch (err) {
      const msg = err?.message || 'Gagal menerapkan impor kategori.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Impor Kategori Gagal',
        desc: msg,
        tag: 'KATEGORI',
      })
    } finally {
      setApplying(false)
    }
  }

  const drawerTitle = isSubcategory
    ? 'Tambah Subkategori Material'
    : 'Tambah Kategori Material'

  const drawerSubtitle = isSubcategory
    ? `Kategori Induk: ${parentCategory.code} - ${parentCategory.name}`
    : 'Tambahkan kategori secara manual atau unggah berkas CSV dengan pratinjau validasi.'

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={true}
      onClose={onClose}
      title={drawerTitle}
      subtitle={drawerSubtitle}
      width={isSubcategory ? 'max-w-md' : 'max-w-3xl'}
      footer={
        mode === 'manual' || isSubcategory ? (
          <div className="flex items-center justify-between w-full">
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Batal
            </Button>
            <Button variant="primary" onClick={handleManualSubmit} disabled={loading}>
              {loading
                ? 'Menyimpan…'
                : isSubcategory
                ? 'Simpan Subkategori'
                : 'Simpan Kategori'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={dryRunLoading || applying}
            >
              Batal
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={dryRunResult ? 'secondary' : 'primary'}
                size="sm"
                loading={dryRunLoading}
                disabled={!importFile || applying}
                onClick={handleDryRun}
              >
                <IconUpload size={14} />
                <span>Uji Validasi (Dry Run)</span>
              </Button>
              {dryRunResult && dryRunResult.accepted > 0 && dryRunResult.rejected === 0 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={applying}
                  onClick={handleCommit}
                >
                  <IconCheck size={14} />
                  <span>Terapkan & Simpan Kategori ({dryRunResult.accepted} Baris)</span>
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="space-y-5 text-sm">
        {/* If creating root category, offer switcher between manual and upload */}
        {!isSubcategory && (
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                mode === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconPlus size={14} />
              <span>Tambah Manual</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                mode === 'upload'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconUpload size={14} />
              <span>Via Upload (CSV)</span>
            </button>
          </div>
        )}

        {mode === 'manual' || isSubcategory ? (
          <form onSubmit={handleManualSubmit} className="space-y-4 text-sm">
            {error && <Alert>{error}</Alert>}

            {/* If Subcategory: Fixed Parent Info */}
            {isSubcategory && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kategori Induk
                </label>
                <div className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium select-none">
                  {parentCategory.code} - {parentCategory.name}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isSubcategory ? 'Kode Subkategori' : 'Kode Kategori'} (Huruf Besar & Angka) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={isSubcategory ? 'Contoh: TRF_1PH' : 'Contoh: TRAFO_DISTRIBUSI'}
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none uppercase font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isSubcategory ? 'Nama Subkategori' : 'Nama Kategori'} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isSubcategory ? 'Contoh: Trafo 1 Fasa' : 'Contoh: Trafo Distribusi 20 kV'}
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Deskripsi
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
              />
            </div>
          </form>
        ) : (
          <div className="space-y-5 text-xs">
            {/* Format Guide Banner */}
            <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-bold text-blue-900 dark:text-blue-200 text-xs">
                    Format Berkas CSV Kategori Material
                  </h4>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                    Baris header wajib memuat kolom berikut:
                  </p>
                  <code className="inline-block px-2.5 py-1 bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-800 font-mono text-[11px] text-blue-700 dark:text-blue-300">
                    code,name,description
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    downloadCsv('template_kategori_material.csv', CATEGORIES_TEMPLATE)
                    notify({
                      type: 'info',
                      title: 'Templat CSV Diunduh',
                      desc: 'Berkas template_kategori_material.csv berhasil diunduh.',
                      tag: 'KATEGORI',
                    })
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 font-semibold text-xs shadow-xs transition cursor-pointer"
                >
                  <IconDownload size={14} />
                  <span>Unduh Templat CSV</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-blue-200/50 dark:border-blue-900/40">
                Mendukung juga alias header <code className="font-mono">kode,nama,deskripsi</code>. Kode kategori menggunakan huruf besar, angka, dan garis bawah (contoh: <code className="font-mono">TRAFO</code>, <code className="font-mono">MCB_1_PHASE</code>). Jika kode sudah terdaftar, data akan diperbarui.
              </p>
            </div>

            {importError && <Alert kind="error">{importError}</Alert>}

            {/* Styled File Upload Dropzone */}
            <form onSubmit={handleDryRun} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Berkas CSV Kategori <span className="text-rose-500">*</span>
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    const f = e.dataTransfer?.files?.[0]
                    if (f) {
                      setImportFile(f)
                      setDryRunResult(null)
                      setImportError('')
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : importFile
                      ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Berkas CSV Kategori"
                    required
                    accept=".csv,text/csv,text/plain"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] || null)
                      setDryRunResult(null)
                      setImportError('')
                    }}
                    className="sr-only"
                  />
                  <IconUpload
                    size={28}
                    className={`mx-auto mb-2 ${
                      importFile ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  {importFile ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {importFile.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(importFile.size / 1024).toFixed(1)} KB — Klik atau seret berkas untuk mengganti
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Klik untuk memilih berkas CSV atau seret ke area ini
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Format berkas .csv (maksimal 5 MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </form>

            {/* Dry Run Result Preview */}
            {dryRunResult && (
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                    Hasil Validasi Pratinjau Kategori
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Baru: {dryRunResult.createdCount} · Perbarui: {dryRunResult.updatedCount}
                  </span>
                </div>

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                    <span className="block text-[11px] font-semibold text-slate-500">Total Baris</span>
                    <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                      {dryRunResult.total}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Diterima</span>
                    <span className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-300">
                      {dryRunResult.accepted}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center">
                    <span className="block text-[11px] font-semibold text-rose-600 dark:text-rose-400">Ditolak</span>
                    <span className="text-base font-bold font-mono text-rose-700 dark:text-rose-300">
                      {dryRunResult.rejected}
                    </span>
                  </div>
                </div>

                {/* Preview Table */}
                <div className="overflow-x-auto max-h-60 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 sticky top-0">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Baris</th>
                        <th className="py-2 px-3 font-semibold">Kode</th>
                        <th className="py-2 px-3 font-semibold">Nama</th>
                        <th className="py-2 px-3 font-semibold">Deskripsi</th>
                        <th className="py-2 px-3 font-semibold">Aksi</th>
                        <th className="py-2 px-3 font-semibold">Status</th>
                        <th className="py-2 px-3 font-semibold">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {dryRunResult.rows.map((r, idx) => (
                        <tr
                          key={idx}
                          className={
                            r.status === 'REJECTED'
                              ? 'bg-rose-50/60 dark:bg-rose-950/30'
                              : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-2 px-3 font-mono">{r.row}</td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{r.code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{r.name}</td>
                          <td className="py-2 px-3 text-slate-500 max-w-xs truncate">{r.description || '-'}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.action === 'BARU'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {r.action}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.status === 'OK'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-rose-600 dark:text-rose-400">
                            {(r.errors || []).join('; ') || '-'}
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
      </div>
    </PanelShell>
  )
}

export function EditCategoryDrawer({ asPage = false, category, categoryMap, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [name, setName] = useState(category.name || '')
  const [description, setDescription] = useState(category.description || '')
  const [isActive, setIsActive] = useState(Boolean(category.is_active))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isSubcategory = Boolean(category.parent_id || category.parent_code || category.level === 2)
  const parentCategory = category.parent_id ? categoryMap?.get(category.parent_id) : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await masterDataApi.updateCategory(category.id, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
      })
      onSuccess()
    } catch (err) {
      const msg = err.message || 'Gagal memperbarui kategori.'
      setError(msg)
      notify({ type: 'error', title: 'Gagal Memperbarui Kategori', desc: msg, tag: 'KATEGORI' })
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
      title={isSubcategory ? 'Ubah Subkategori Material' : 'Ubah Kategori Material'}
      subtitle={`Kode: ${category.code}`}
      width="max-w-md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {error && <Alert>{error}</Alert>}

        {/* Read-only Code */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Kode {isSubcategory ? 'Subkategori' : 'Kategori'}
          </label>
          <div className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold select-none">
            {category.code}
          </div>
        </div>

        {/* Read-only Parent info for subcategories */}
        {isSubcategory && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Kategori Induk
            </label>
            <div className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium select-none">
              {category.parent_code || parentCategory?.code || '-'}{' '}
              {parentCategory?.name ? `(${parentCategory.name})` : ''}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nama {isSubcategory ? 'Subkategori' : 'Kategori'} <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Deskripsi
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
          />
        </div>
        <div className="pt-2">
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span>Status Aktif</span>
          </label>
        </div>
      </form>
    </PanelShell>
  )
}

export function CreateUnitDrawer({ asPage = false, existingUnits, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [mode, setMode] = useState('manual') // 'manual' | 'upload'

  // Manual state
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Upload state
  const fileInputRef = useRef(null)
  const [importFile, setImportFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [importError, setImportError] = useState('')
  const [dryRunResult, setDryRunResult] = useState(null)

  const handleManualSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await masterDataApi.createUnit({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        symbol: symbol.trim() || undefined,
      })
      onSuccess()
    } catch (err) {
      const msg = err.message || 'Gagal menambahkan satuan.'
      setError(msg)
      notify({ type: 'error', title: 'Gagal Menambah Satuan', desc: msg, tag: 'SATUAN' })
    } finally {
      setLoading(false)
    }
  }

  const handleDryRun = async (e) => {
    if (e) e.preventDefault()
    if (!importFile) return
    setDryRunLoading(true)
    setImportError('')
    setDryRunResult(null)

    try {
      const text = await readFileText(importFile)
      const { headers, rows } = parseCsvContent(text)

      if (rows.length === 0) {
        throw new Error('Berkas CSV kosong atau tidak memiliki baris data.')
      }

      const hasCodeCol = headers.some((h) => ['code', 'kode', 'kode_satuan', 'unit_code'].includes(h))
      const hasNameCol = headers.some((h) => ['name', 'nama', 'nama_satuan', 'unit_name'].includes(h))
      if (!hasCodeCol || !hasNameCol) {
        throw new Error('Header CSV wajib memuat kolom code,name (atau kode,nama).')
      }

      const existingByCode = new Map(
        (existingUnits || []).map((u) => [String(u.code).toUpperCase(), u])
      )
      const seenCodes = new Set()

      const evaluatedRows = rows.map(({ rowNumber, record }) => {
        const rawCode = record.code || record.kode || record.kode_satuan || record.unit_code || ''
        const rCode = String(rawCode).trim().toUpperCase()
        const rName = String(record.name || record.nama || record.nama_satuan || record.unit_name || '').trim()
        const rSymbol = String(record.symbol || record.simbol || record.satuan || '').trim()

        const errors = []
        if (!rCode) {
          errors.push('Kode satuan wajib diisi.')
        } else {
          if (rCode.length > 20) errors.push('Kode satuan maksimal 20 karakter.')
          if (!/^[A-Z0-9_]+$/.test(rCode)) {
            errors.push('Kode satuan hanya huruf besar, angka, dan garis bawah.')
          }
          if (seenCodes.has(rCode)) {
            errors.push(`Kode satuan "${rCode}" duplikat di dalam berkas CSV.`)
          }
          seenCodes.add(rCode)
        }

        if (!rName) {
          errors.push('Nama satuan wajib diisi.')
        } else if (rName.length > 100) {
          errors.push('Nama satuan maksimal 100 karakter.')
        }

        if (rSymbol.length > 20) {
          errors.push('Simbol maksimal 20 karakter.')
        }

        const existing = rCode ? existingByCode.get(rCode) : null
        const action = existing ? 'PERBARUI' : 'BARU'
        const status = errors.length === 0 ? 'OK' : 'REJECTED'

        return {
          row: rowNumber,
          code: rCode || '-',
          name: rName || '-',
          symbol: rSymbol,
          existingId: existing?.id || null,
          action,
          status,
          errors,
        }
      })

      const accepted = evaluatedRows.filter((r) => r.status === 'OK').length
      const rejected = evaluatedRows.filter((r) => r.status === 'REJECTED').length
      const createdCount = evaluatedRows.filter((r) => r.status === 'OK' && r.action === 'BARU').length
      const updatedCount = evaluatedRows.filter((r) => r.status === 'OK' && r.action === 'PERBARUI').length

      setDryRunResult({
        total: evaluatedRows.length,
        accepted,
        rejected,
        createdCount,
        updatedCount,
        rows: evaluatedRows,
      })

      if (rejected > 0) {
        notify({
          type: 'warning',
          title: 'Pratinjau Selesai dengan Catatan',
          desc: `${accepted} baris valid, ${rejected} baris ditolak. Periksa tabel pratinjau.`,
          tag: 'SATUAN',
        })
      } else {
        notify({
          type: 'info',
          title: 'Validasi Pratinjau Berhasil',
          desc: `Seluruh ${accepted} baris satuan valid (${createdCount} baru, ${updatedCount} diperbarui).`,
          tag: 'SATUAN',
        })
      }
    } catch (err) {
      const msg = err?.message || 'Gagal memproses berkas CSV satuan.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Validasi CSV Gagal',
        desc: msg,
        tag: 'SATUAN',
      })
    } finally {
      setDryRunLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!dryRunResult || dryRunResult.accepted === 0) return
    setApplying(true)
    setImportError('')

    try {
      const validRows = dryRunResult.rows.filter((r) => r.status === 'OK')
      let created = 0
      let updated = 0

      for (const r of validRows) {
        if (r.existingId) {
          await masterDataApi.updateUnit(r.existingId, {
            name: r.name,
            symbol: r.symbol || null,
            is_active: true,
          })
          updated += 1
        } else {
          await masterDataApi.createUnit({
            code: r.code,
            name: r.name,
            symbol: r.symbol || undefined,
          })
          created += 1
        }
      }

      onSuccess(`${created} satuan baru ditambahkan, ${updated} satuan diperbarui.`)
    } catch (err) {
      const msg = err?.message || 'Gagal menerapkan impor satuan.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Impor Satuan Gagal',
        desc: msg,
        tag: 'SATUAN',
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={true}
      onClose={onClose}
      title="Tambah Satuan Pengukuran (UoM)"
      subtitle="Tambahkan satuan secara manual atau unggah berkas CSV dengan pratinjau validasi."
      width="max-w-3xl"
      footer={
        mode === 'manual' ? (
          <div className="flex items-center justify-between w-full">
            <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
            <Button variant="primary" onClick={handleManualSubmit} disabled={loading}>
              {loading ? 'Menyimpan…' : 'Simpan Satuan'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={dryRunLoading || applying}
            >
              Batal
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={dryRunResult ? 'secondary' : 'primary'}
                size="sm"
                loading={dryRunLoading}
                disabled={!importFile || applying}
                onClick={handleDryRun}
              >
                <IconUpload size={14} />
                <span>Uji Validasi (Dry Run)</span>
              </Button>
              {dryRunResult && dryRunResult.accepted > 0 && dryRunResult.rejected === 0 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={applying}
                  onClick={handleCommit}
                >
                  <IconCheck size={14} />
                  <span>Terapkan & Simpan Satuan ({dryRunResult.accepted} Baris)</span>
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="space-y-5 text-sm">
        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'manual'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <IconPlus size={14} />
            <span>Tambah Manual</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'upload'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <IconUpload size={14} />
            <span>Via Upload (CSV)</span>
          </button>
        </div>

        {mode === 'manual' ? (
          <form onSubmit={handleManualSubmit} className="space-y-4 text-sm">
            {error && <Alert>{error}</Alert>}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kode Satuan (Huruf Besar & Angka) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Contoh: MTR"
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none uppercase font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama Lengkap Satuan <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Meter"
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Simbol Satuan (Opsional)
              </label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="Contoh: m"
                className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
              />
            </div>
          </form>
        ) : (
          <div className="space-y-5 text-xs">
            {/* Format Guide Banner */}
            <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-bold text-blue-900 dark:text-blue-200 text-xs">
                    Format Berkas CSV Satuan Pengukuran (UoM)
                  </h4>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                    Baris header wajib memuat kolom berikut:
                  </p>
                  <code className="inline-block px-2.5 py-1 bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-800 font-mono text-[11px] text-blue-700 dark:text-blue-300">
                    code,name,symbol
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    downloadCsv('template_satuan_pengukuran.csv', UNITS_TEMPLATE)
                    notify({
                      type: 'info',
                      title: 'Templat CSV Diunduh',
                      desc: 'Berkas template_satuan_pengukuran.csv berhasil diunduh.',
                      tag: 'SATUAN',
                    })
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 font-semibold text-xs shadow-xs transition cursor-pointer"
                >
                  <IconDownload size={14} />
                  <span>Unduh Templat CSV</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-blue-200/50 dark:border-blue-900/40">
                Mendukung juga alias header <code className="font-mono">kode,nama,simbol</code> atau <code className="font-mono">satuan</code>. Kode satuan menggunakan huruf besar, angka, dan garis bawah (contoh: <code className="font-mono">MTR</code>, <code className="font-mono">SET</code>, <code className="font-mono">BH</code>). Jika kode sudah terdaftar, data akan diperbarui.
              </p>
            </div>

            {importError && <Alert kind="error">{importError}</Alert>}

            {/* Styled File Upload Dropzone */}
            <form onSubmit={handleDryRun} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Berkas CSV Satuan <span className="text-rose-500">*</span>
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    const f = e.dataTransfer?.files?.[0]
                    if (f) {
                      setImportFile(f)
                      setDryRunResult(null)
                      setImportError('')
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : importFile
                      ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Berkas CSV Satuan"
                    required
                    accept=".csv,text/csv,text/plain"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] || null)
                      setDryRunResult(null)
                      setImportError('')
                    }}
                    className="sr-only"
                  />
                  <IconUpload
                    size={28}
                    className={`mx-auto mb-2 ${
                      importFile ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  {importFile ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {importFile.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(importFile.size / 1024).toFixed(1)} KB — Klik atau seret berkas untuk mengganti
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Klik untuk memilih berkas CSV atau seret ke area ini
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Format berkas .csv (maksimal 5 MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </form>

            {/* Dry Run Result Preview */}
            {dryRunResult && (
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                    Hasil Validasi Pratinjau Satuan (UoM)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Baru: {dryRunResult.createdCount} · Perbarui: {dryRunResult.updatedCount}
                  </span>
                </div>

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                    <span className="block text-[11px] font-semibold text-slate-500">Total Baris</span>
                    <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                      {dryRunResult.total}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Diterima</span>
                    <span className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-300">
                      {dryRunResult.accepted}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center">
                    <span className="block text-[11px] font-semibold text-rose-600 dark:text-rose-400">Ditolak</span>
                    <span className="text-base font-bold font-mono text-rose-700 dark:text-rose-300">
                      {dryRunResult.rejected}
                    </span>
                  </div>
                </div>

                {/* Preview Table */}
                <div className="overflow-x-auto max-h-60 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 sticky top-0">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Baris</th>
                        <th className="py-2 px-3 font-semibold">Kode</th>
                        <th className="py-2 px-3 font-semibold">Nama</th>
                        <th className="py-2 px-3 font-semibold">Simbol</th>
                        <th className="py-2 px-3 font-semibold">Aksi</th>
                        <th className="py-2 px-3 font-semibold">Status</th>
                        <th className="py-2 px-3 font-semibold">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {dryRunResult.rows.map((r, idx) => (
                        <tr
                          key={idx}
                          className={
                            r.status === 'REJECTED'
                              ? 'bg-rose-50/60 dark:bg-rose-950/30'
                              : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-2 px-3 font-mono">{r.row}</td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{r.code}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{r.name}</td>
                          <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-300">{r.symbol || '-'}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.action === 'BARU'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {r.action}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                r.status === 'OK'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-rose-600 dark:text-rose-400">
                            {(r.errors || []).join('; ') || '-'}
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
      </div>
    </PanelShell>
  )
}

export function EditUnitDrawer({ asPage = false, unit, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [name, setName] = useState(unit.name || '')
  const [symbol, setSymbol] = useState(unit.symbol || '')
  const [isActive, setIsActive] = useState(Boolean(unit.is_active))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await masterDataApi.updateUnit(unit.id, {
        name: name.trim(),
        symbol: symbol.trim() || null,
        is_active: isActive,
      })
      onSuccess()
    } catch (err) {
      const msg = err.message || 'Gagal memperbarui satuan.'
      setError(msg)
      notify({ type: 'error', title: 'Gagal Memperbarui Satuan', desc: msg, tag: 'SATUAN' })
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
      title="Ubah Satuan Pengukuran"
      subtitle={`Kode: ${unit.code}`}
      width="max-w-md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Kode Satuan
          </label>
          <div className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold select-none">
            {unit.code}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nama Lengkap Satuan <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Simbol Satuan
          </label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full px-3 py-2 text-base sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
          />
        </div>
        <div className="pt-2">
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span>Status Aktif</span>
          </label>
        </div>
      </form>
    </PanelShell>
  )
}
