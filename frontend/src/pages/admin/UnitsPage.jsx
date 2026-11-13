import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { adminApi } from '../../services/api.js'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Card from '../../components/Card.jsx'
import Modal from '../../components/Modal.jsx'
import Drawer from '../../components/Drawer.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconBuilding,
  IconShield,
  IconPlus,
  IconPencil,
  IconPower,
  IconTrash,
  IconEye,
  IconRefresh,
  IconHistory,
  IconSearch,
  IconChevronDown,
} from '../../components/icons.jsx'

export default function UnitsPage() {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [access, setAccess] = useState({ canCreate: true, canUpdate: true })
  const { notify } = useNotifications() // badge notification toast and bell count

  // Modal dialog states
  const navigate = useNavigate()
  const [statusTarget, setStatusTarget] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)

  // Load access rights once
  useEffect(() => {
    adminApi.access()
      .then((d) => {
        const canView = Boolean(d?.can?.['organizational_units.view'] ?? true)
        setAccess({
          canCreate: Boolean(d?.can_write?.['organizational_units.create']) || canView,
          canUpdate: Boolean(d?.can_write?.['organizational_units.update']) || canView,
        })
      })
      .catch(() => {
        setAccess({ canCreate: true, canUpdate: true })
      })
  }, [])

  // Load units list: initial view (no search, no typeFilter) fetches UP3 branches only
  const [expandedParents, setExpandedParents] = useState({})
  const [childrenByParent, setChildrenByParent] = useState({})
  const [cachedUp3List, setCachedUp3List] = useState([])

  const fetchChildrenForParent = useCallback(async (parentUnit) => {
    const parentId = typeof parentUnit === 'string' ? parentUnit : parentUnit?.id
    if (!parentId) return
    setChildrenByParent((prev) => ({
      ...prev,
      [parentId]: {
        loading: true,
        error: '',
        loaded: Boolean(prev[parentId]?.loaded),
        data: prev[parentId]?.data ?? [],
      },
    }))
    try {
      const res = await adminApi.unit(parentId)
      const detail = res?.data ?? {}
      const parentName = detail.name ?? parentUnit?.name ?? null
      const parentCode = detail.code ?? parentUnit?.code ?? null
      const rawChildren = Array.isArray(detail.children) ? detail.children : []
      const enrichedChildren = rawChildren
        .map((c) => ({
          ...c,
          parent_id: c.parent_id ?? parentId,
          parent_name: c.parent_name ?? parentName,
          parent_code: c.parent_code ?? parentCode,
        }))
        .sort((a, b) => (a.code || '').localeCompare(b.code || ''))

      setChildrenByParent((prev) => ({
        ...prev,
        [parentId]: {
          loading: false,
          error: '',
          loaded: true,
          data: enrichedChildren,
        },
      }))
    } catch (err) {
      setChildrenByParent((prev) => ({
        ...prev,
        [parentId]: {
          loading: false,
          error: err?.message || 'Gagal memuat daftar unit.',
          loaded: false,
          data: [],
        },
      }))
    }
  }, [])

  const unitsReqSeqRef = useRef(0)

  const loadUnits = useCallback(() => {
    const reqSeq = ++unitsReqSeqRef.current
    setState((s) => ({ ...s, loading: true, error: '' }))
    const effectiveTypeFilter = typeFilter || (search.trim() ? '' : 'UP3')
    Promise.resolve(
      adminApi.units({
        page,
        per_page: perPage,
        search: search.trim(),
        unit_type: effectiveTypeFilter,
      })
    )
      .then((d) => {
        if (reqSeq !== unitsReqSeqRef.current) return
        const rows = d?.data ?? []
        setState({ loading: false, error: '', rows, meta: d?.meta ?? null })
        const up3Rows = rows.filter((u) => u.unit_type === 'UP3' && u.is_active)
        if (effectiveTypeFilter === 'UP3' && !search.trim()) {
          setCachedUp3List(up3Rows)
        } else if (up3Rows.length > 0) {
          setCachedUp3List((prev) => (prev.length > 0 ? prev : up3Rows))
        }
      })
      .catch((e) => {
        if (reqSeq !== unitsReqSeqRef.current) return
        setState({ loading: false, error: e?.message || 'Gagal memuat unit.', rows: [], meta: null })
      })
  }, [page, perPage, search, typeFilter])

  useEffect(() => {
    loadUnits()
  }, [loadUnits])

  const reloadAll = useCallback(() => {
    loadUnits()
    // Refresh any expanded UP3 branches whose children were already opened
    setExpandedParents((currentExpanded) => {
      Object.entries(currentExpanded).forEach(([parentId, isExpanded]) => {
        if (isExpanded) {
          fetchChildrenForParent(parentId)
        }
      })
      return currentExpanded
    })
  }, [loadUnits, fetchChildrenForParent])

  const toggleParentCollapse = (parentUnit, currentIsCollapsed) => {
    const parentId = parentUnit.id
    if (currentIsCollapsed) {
      setExpandedParents((prev) => ({ ...prev, [parentId]: true }))
      const existing = childrenByParent[parentId]
      if (!existing || (!existing.loaded && !existing.loading)) {
        fetchChildrenForParent(parentUnit)
      }
    } else {
      setExpandedParents((prev) => ({ ...prev, [parentId]: false }))
    }
  }

  // Filter client-side fallback if search/filter applied locally
  const filteredRows = useMemo(() => {
    if (!search && !typeFilter) return state.rows

    const searchLower = search.toLowerCase()
    const directlyMatchedIds = new Set()

    state.rows.forEach((u) => {
      const matchSearch =
        !search ||
        (u.name && u.name.toLowerCase().includes(searchLower)) ||
        (u.code && u.code.toLowerCase().includes(searchLower))
      const matchType = !typeFilter || u.unit_type === typeFilter
      if (matchSearch && matchType) {
        directlyMatchedIds.add(u.id)
      }
    })

    // If searching, also include parent UP3 if child ULP matched so tree context is preserved
    if (search && !typeFilter) {
      state.rows.forEach((u) => {
        if (directlyMatchedIds.has(u.id) && u.parent_id) {
          directlyMatchedIds.add(u.parent_id)
        }
      })
    }

    return state.rows.filter((u) => directlyMatchedIds.has(u.id))
  }, [state.rows, search, typeFilter])

  // Hierarchical Tree View: UP3 parents at top level (default collapsed) with child ULPs fetched on expand
  const treeRows = useMemo(() => {
    // If filtering specifically by unit_type (e.g. only ULP or only UP3), show flat list
    if (typeFilter) {
      return filteredRows.map((u) => ({
        unit: u,
        isParent: u.unit_type === 'UP3',
        isChild: u.unit_type === 'ULP',
        childrenCount: 0,
        hasParent: Boolean(u.parent_id),
        flatMode: true,
      }))
    }

    const parents = []
    const inlineChildrenByParent = {}
    const rowIds = new Set(filteredRows.map((u) => u.id))

    filteredRows.forEach((u) => {
      if (u.unit_type === 'UP3' || !u.parent_id) {
        parents.push(u)
      } else {
        if (!inlineChildrenByParent[u.parent_id]) {
          inlineChildrenByParent[u.parent_id] = []
        }
        inlineChildrenByParent[u.parent_id].push(u)
      }
    })

    // Sort parents by code
    parents.sort((a, b) => (a.code || '').localeCompare(b.code || ''))

    const result = []

    parents.forEach((parent) => {
      const lazyInfo = childrenByParent[parent.id]
      const inlineChildren = inlineChildrenByParent[parent.id] || []
      const children =
        lazyInfo?.loaded && !search.trim()
          ? lazyInfo.data
          : inlineChildren.length > 0
          ? [...inlineChildren].sort((a, b) => (a.code || '').localeCompare(b.code || ''))
          : lazyInfo?.data ?? []

      const isCollapsed =
        expandedParents[parent.id] !== undefined
          ? !expandedParents[parent.id]
          : !search.trim()

      result.push({
        unit: parent,
        isParent: true,
        isChild: false,
        canExpand: parent.unit_type === 'UP3',
        childrenCount: lazyInfo?.loaded ? children.length : inlineChildren.length > 0 ? inlineChildren.length : null,
        isCollapsed,
      })

      if (!isCollapsed) {
        if (lazyInfo?.loading) {
          result.push({
            id: `loading-${parent.id}`,
            isChildrenLoading: true,
            parent,
          })
        } else if (lazyInfo?.error) {
          result.push({
            id: `error-${parent.id}`,
            isChildrenError: true,
            error: lazyInfo.error,
            parent,
          })
        } else if (lazyInfo?.loaded && children.length === 0) {
          result.push({
            id: `empty-${parent.id}`,
            isChildrenEmpty: true,
            parent,
          })
        } else {
          children.forEach((child, idx) => {
            result.push({
              unit: child,
              isParent: false,
              isChild: true,
              isLastChild: idx === children.length - 1,
              parent,
            })
          })
        }
      }
    })

    // Orphan units (e.g. matching ULP search results whose parent UP3 wasn't returned)
    filteredRows.forEach((u) => {
      if (u.parent_id && !rowIds.has(u.parent_id)) {
        result.push({
          unit: u,
          isParent: false,
          isChild: true,
          isOrphan: true,
          childrenCount: 0,
        })
      }
    })

    return result
  }, [filteredRows, expandedParents, childrenByParent, typeFilter, search])

  // Available UP3 units for selecting parent in ULP creation
  const activeUp3Units = useMemo(() => {
    const fromRows = state.rows.filter((u) => u.unit_type === 'UP3' && u.is_active)
    return fromRows.length > 0 ? fromRows : cachedUp3List
  }, [state.rows, cachedUp3List])

  // Handle status toggle (deactivate / reactivate)
  const handleToggleStatus = async (reason) => {
    if (!statusTarget) return
    const nextStatus = !statusTarget.is_active
    await adminApi.updateUnit(statusTarget.id, {
      is_active: nextStatus,
      reason,
    })
    const msg = `Status unit ${statusTarget.code} - ${statusTarget.name} berhasil diubah menjadi ${nextStatus ? 'Aktif' : 'Nonaktif'}.`
    notify({
      type: nextStatus ? 'success' : 'warning',
      title: nextStatus ? 'Unit Diaktifkan' : 'Unit Dinonaktifkan',
      desc: msg,
      tag: 'Unit',
    })
    setStatusTarget(null)
    setChildrenByParent({})
    reloadAll()
  }

  return (
    <div className="space-y-6">
      {/* Standard Page Header (Above card, matching reference layout) */}

      {/* Standard Page Header (Above card, matching reference layout) */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            DISTRIVA / ADMINISTRASI
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Unit organisasi
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Kelola hierarki unit kerja PLN (Pusat, UID, UP3, ULP). Struktur penugasan menentukan boundary otoritas data operasional SAME_UNIT.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden lg:inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <IconShield size={14} className="text-slate-400 dark:text-slate-500" />
            <span>Scope: <strong>user_role_assignments</strong></span>
          </div>

          {access.canCreate && (
            <button
              type="button"
              onClick={() => navigate('/admin/units/baru')}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Tambah Unit</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Standardized Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Filter & Search Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Input with Icon */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch size={16} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cari kode atau nama unit…"
              className="block w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none"
            />
          </div>

          {/* Type Filter Select */}
          <div className="min-w-[150px]">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
              aria-label="Filter Tipe Unit"
              className="block w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none cursor-pointer"
            >
              <option value="">Semua Tipe</option>
              <option value="UP3">UP3</option>
              <option value="ULP">ULP</option>
            </select>
          </div>

          {/* Reset & Refresh */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {(search || typeFilter) && (
              <button
                type="button"
                onClick={() => { setSearch(''); setTypeFilter(''); setPage(1) }}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline px-1 cursor-pointer"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={reloadAll}
              title="Muat Ulang Data"
              aria-label="Muat Ulang"
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <IconRefresh size={16} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div>
          {state.error && <div className="p-5"><Alert>{state.error}</Alert></div>}
          {state.loading && <div className="p-8"><Spinner /></div>}

          {!state.loading && !state.error && (state.rows.length === 0 || filteredRows.length === 0) && (
            <EmptyState
              icon={IconBuilding}
              title="Belum ada unit organisasi"
              description="Tidak ada unit organisasi yang terdaftar atau cocok dengan filter pencarian."
            />
          )}

          {!state.loading && filteredRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                  <tr>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      UNIT / KODE ↑
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      ALAMAT / KONTAK
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      DATA / TIPE
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      STATUS ↕
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {treeRows.map((row) => {
                    if (row.isChildrenLoading) {
                      return (
                        <tr key={row.id} className="bg-slate-50/30 dark:bg-slate-800/20">
                          <td colSpan={5} className="py-3 px-6 pl-14 text-xs text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-2" role="status">
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                              <span>Memuat unit ULP untuk {row.parent.name}…</span>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    if (row.isChildrenError) {
                      return (
                        <tr key={row.id} className="bg-rose-50/40 dark:bg-rose-950/20">
                          <td colSpan={5} className="py-3 px-6 pl-14 text-xs text-rose-700 dark:text-rose-300">
                            <div className="flex items-center justify-between gap-3">
                              <span>{row.error}</span>
                              <button
                                type="button"
                                onClick={() => fetchChildrenForParent(row.parent)}
                                className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 font-semibold hover:bg-rose-50 cursor-pointer"
                              >
                                Coba Lagi
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    if (row.isChildrenEmpty) {
                      return (
                        <tr key={row.id}>
                          <td colSpan={5} className="py-3 px-6 pl-14 text-xs italic text-slate-400 dark:text-slate-500">
                            Belum ada unit ULP terdaftar di bawah {row.parent.name}.
                          </td>
                        </tr>
                      )
                    }

                    const { unit: u, isParent, isChild, isLastChild, canExpand, childrenCount, isCollapsed, flatMode } = row
                    return (
                    <tr
                      key={u.id}
                      className={`transition-colors ${
                        isParent
                          ? 'bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-100/80 dark:hover:bg-slate-800/70'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3.5 px-6">
                        {isParent && !flatMode ? (
                          <div className="flex items-center gap-2">
                            {canExpand ? (
                              <button
                                type="button"
                                onClick={() => toggleParentCollapse(u, isCollapsed)}
                                title={isCollapsed ? 'Tampilkan ULP' : 'Sembunyikan ULP'}
                                aria-label={isCollapsed ? 'Buka cabang unit' : 'Tutup cabang unit'}
                                aria-expanded={!isCollapsed}
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition cursor-pointer"
                              >
                                <IconChevronDown
                                  size={16}
                                  className={`transform transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                                />
                              </button>
                            ) : (
                              <div className="w-6 shrink-0" />
                            )}
                            <div
                              onClick={canExpand ? () => toggleParentCollapse(u, isCollapsed) : undefined}
                              className={canExpand ? 'cursor-pointer select-none' : undefined}
                            >
                              <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                <span>{u.name}</span>
                                {childrenCount !== null && childrenCount !== undefined && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                    {childrenCount} ULP
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-xs text-slate-400 dark:text-slate-500 mt-0.5">{u.code}</div>
                            </div>
                          </div>
                        ) : isChild ? (
                          <div className="flex items-center gap-2.5 pl-7 sm:pl-9">
                            <span className="text-slate-400 dark:text-slate-500 font-mono text-xs select-none">
                              {isLastChild ? '└─' : '├─'}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-800 dark:text-slate-200">{u.name}</div>
                              <div className="font-mono text-xs text-slate-400 dark:text-slate-500 mt-0.5">{u.code}</div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100">{u.name}</div>
                            <div className="font-mono text-xs text-slate-400 dark:text-slate-500 mt-0.5">{u.code}</div>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-xs text-slate-600 dark:text-slate-400 max-w-sm">
                        {u.address ? (
                          <div className="line-clamp-2 leading-relaxed">{u.address}</div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold border ${
                            u.unit_type === 'UP3'
                              ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200/60 dark:border-purple-800'
                              : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800'
                          }`}>
                            {u.unit_type}
                          </span>
                          {u.parent_name && (
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[150px]" title={`Induk: ${u.parent_name} (${u.parent_code ?? '-'})`}>
                              · Induk: {u.parent_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setDetailTarget(u)}
                            aria-label="Detail"
                            title="Lihat Detail & Riwayat Audit"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                          >
                            <IconEye size={13} />
                            <span>Detail</span>
                          </button>

                          {access.canUpdate && (
                            <>
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/units/${u.id}/ubah`)}
                                aria-label="Edit"
                                title="Ubah Nama/Alamat Unit"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                              >
                                <IconPencil size={13} />
                                <span>Ubah</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setStatusTarget(u)}
                                aria-label={u.is_active ? "Nonaktifkan" : "Aktifkan"}
                                title={u.is_active ? "Nonaktifkan Unit" : "Aktifkan Kembali Unit"}
                                className={
                                  u.is_active
                                    ? "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                                    : "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 font-semibold text-xs transition-colors cursor-pointer"
                                }
                              >
                                {u.is_active ? <IconTrash size={13} /> : <IconPower size={13} />}
                                <span>{u.is_active ? "Nonaktifkan" : "Aktifkan"}</span>
                              </button>
                            </>
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
              itemCount={filteredRows.length}
              total={state.meta.total}
              entityLabel="unit"
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

      {/* Modal Konfirmasi: Nonaktifkan / Aktifkan Unit */}
      {statusTarget && (
        <ConfirmationModal
          open={Boolean(statusTarget)}
          variant={statusTarget.is_active ? 'warning' : 'info'}
          title={statusTarget.is_active ? 'Nonaktifkan Unit Organisasi' : 'Aktifkan Kembali Unit Organisasi'}
          itemName={`${statusTarget.code} - ${statusTarget.name}`}
          description={
            statusTarget.is_active
              ? 'Anda akan menonaktifkan unit ini. Sesuai prinsip append-only (O-030 & doc 54), penghapusan fisik (hard delete) dilarang dan seluruh perubahan dicatat dalam audit log.'
              : 'Anda akan mengaktifkan kembali unit kerja ini ke status operasional aktif.'
          }
          confirmLabel={statusTarget.is_active ? 'Nonaktifkan Unit' : 'Aktifkan Unit'}
          requireReason
          reasonLabel="Alasan"
          reasonPlaceholder="Masukkan alasan penonaktifan unit kerja…"
          onConfirm={handleToggleStatus}
          onClose={() => setStatusTarget(null)}
        />
      )}

      {/* Modal: Detail & Riwayat Audit Unit */}
      {detailTarget && (
        <UnitDetailDrawer
          unitId={detailTarget.id}
          fallbackUnit={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// Sub-components: Modals for Create, Edit, and Detail/Audit Trail
// -------------------------------------------------------------------------------------------------

export function CreateUnitDrawer({ open, asPage = false, activeUp3List, onClose, onSuccess }) {
  const [form, setForm] = useState({
    unit_type: 'ULP',
    parent_id: activeUp3List.length === 1 ? activeUp3List[0].id : '',
    code: '',
    name: '',
    address: '',
    reason: '',
  })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    setError('')
    setFieldErrors({})

    if (!form.code.trim()) {
      setFieldErrors((f) => ({ ...f, code: 'Kode unit wajib diisi.' }))
      return
    }
    if (!form.name.trim()) {
      setFieldErrors((f) => ({ ...f, name: 'Nama unit wajib diisi.' }))
      return
    }
    if (form.unit_type === 'ULP' && !form.parent_id) {
      setFieldErrors((f) => ({ ...f, parent_id: 'Unit induk UP3 wajib dipilih untuk unit ULP.' }))
      return
    }
    if (!form.reason.trim()) {
      setFieldErrors((f) => ({ ...f, reason: 'Alasan penambahan unit wajib diisi untuk audit log.' }))
      return
    }

    setBusy(true)
    try {
      const payload = {
        unit_type: form.unit_type,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        address: form.address.trim() || null,
        reason: form.reason.trim(),
        parent_id: form.unit_type === 'ULP' ? form.parent_id : null,
      }
      const res = await adminApi.createUnit(payload)
      onSuccess(res.data)
    } catch (err) {
      setError(err.message)
      if (err.errors) setFieldErrors(err.errors)
      setBusy(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      onClose={onClose}
      eyebrow="DRAWER TAMBAH UNIT"
      title="Tambah Unit Organisasi Baru"
      subtitle="Pendaftaran hierarki unit kerja PLN (UP3 / ULP) baru"
      size="max-w-xl"
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" size="sm" type="button" onClick={handleSubmit} loading={busy}>
            Simpan Unit
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3.5 border border-slate-200 dark:border-slate-700/60 text-xs">
          <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">Tipe Unit</label>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="unit_type"
                value="ULP"
                checked={form.unit_type === 'ULP'}
                onChange={() => setForm((f) => ({ ...f, unit_type: 'ULP' }))}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              <span>ULP (Unit Layanan Pelanggan)</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="unit_type"
                value="UP3"
                checked={form.unit_type === 'UP3'}
                onChange={() => setForm((f) => ({ ...f, unit_type: 'UP3', parent_id: '' }))}
                className="text-emerald-600 focus:ring-emerald-500"
              />
              <span>UP3 (Pelaksana Pelayanan)</span>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {form.unit_type === 'UP3'
              ? 'Catatan: Pembuatan unit tingkat UP3 memerlukan otorisasi tingkat sistem (SYS_ADMIN).'
              : 'Unit ULP berada di bawah naungan unit induk UP3.'}
          </p>
        </div>

        {form.unit_type === 'ULP' && (
          <div>
            <label htmlFor="parent_id" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Unit Induk UP3 <span className="text-red-500">*</span>
            </label>
            <select
              id="parent_id"
              value={form.parent_id}
              onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
              className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs focus-ring bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="">Pilih Unit Induk UP3…</option>
              {activeUp3List.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
            {fieldErrors.parent_id && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.parent_id}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="unit_code" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Kode Unit <span className="text-red-500">*</span>
            </label>
            <input
              id="unit_code"
              type="text"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="Contoh: 51451"
              className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-mono uppercase bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
            {fieldErrors.code && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.code}</p>}
          </div>

          <div>
            <label htmlFor="unit_name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nama Unit <span className="text-red-500">*</span>
            </label>
            <input
              id="unit_name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: ULP Mojokerto Kota"
              className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
            {fieldErrors.name && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.name}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="unit_address" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alamat Kantor (Opsional)
          </label>
          <textarea
            id="unit_address"
            rows={2}
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Alamat fisik kantor unit kerja…"
            className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
          />
        </div>

        <div>
          <label htmlFor="create_reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Pembuatan Unit <span className="text-red-500">*</span>
          </label>
          <textarea
            id="create_reason"
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Alasan penambahan unit (wajib dicatat pada organizational_unit_histories)…"
            className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
          />
          {fieldErrors.reason && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.reason}</p>}
        </div>
      </form>
    </PanelShell>
  )
}

export function EditUnitDrawer({ unit, asPage = false, onClose, onSuccess }) {
  const [form, setForm] = useState({
    name: unit?.name ?? '',
    address: unit?.address ?? '',
    reason: '',
  })
  const addressTouchedRef = useRef(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    addressTouchedRef.current = false
    if (!unit?.id || unit.address !== undefined) return undefined
    let active = true
    adminApi
      .unit(unit.id)
      .then((res) => {
        if (!active || !res?.data) return
        setForm((prev) => ({
          ...prev,
          address: addressTouchedRef.current ? prev.address : (res.data.address ?? ''),
        }))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [unit?.id, unit?.address])

  if (!unit) return null

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    setError('')
    setFieldErrors({})

    if (!form.name.trim()) {
      setFieldErrors((f) => ({ ...f, name: 'Nama unit wajib diisi.' }))
      return
    }
    if (!form.reason.trim()) {
      setFieldErrors((f) => ({ ...f, reason: 'Alasan perubahan unit wajib diisi untuk audit log.' }))
      return
    }

    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        reason: form.reason.trim(),
      }
      const res = await adminApi.updateUnit(unit.id, payload)
      onSuccess(res.data)
    } catch (err) {
      setError(err.message)
      if (err.errors) setFieldErrors(err.errors)
      setBusy(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={Boolean(unit)}
      onClose={onClose}
      eyebrow="DRAWER EDIT UNIT"
      title={`Ubah Data Unit: ${unit.code}`}
      subtitle={`Perubahan nama dan alamat unit kerja dicatat pada riwayat audit`}
      size="max-w-xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" size="sm" type="button" onClick={handleSubmit} loading={busy}>
            Simpan Perubahan
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3.5 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
          <strong>Perhatian (O-030):</strong> Kode unit, tipe, dan unit induk bersifat permanen/immutable dan tidak dapat diubah setelah dibuat.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Kode Unit</label>
            <input
              type="text"
              disabled
              value={unit.code}
              className="block w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 px-3 py-2 text-xs font-mono text-slate-500 dark:text-slate-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Tipe Unit</label>
            <input
              type="text"
              disabled
              value={unit.unit_type}
              className="block w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 cursor-not-allowed"
            />
          </div>
        </div>

        <div>
          <label htmlFor="edit_unit_name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nama Unit <span className="text-red-500">*</span>
          </label>
          <input
            id="edit_unit_name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
          />
          {fieldErrors.name && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.name}</p>}
        </div>

        <div>
          <label htmlFor="edit_unit_address" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alamat Kantor
          </label>
          <textarea
            id="edit_unit_address"
            rows={2}
            value={form.address}
            onChange={(e) => {
              addressTouchedRef.current = true
              setForm((f) => ({ ...f, address: e.target.value }))
            }}
            className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
          />
        </div>

        <div>
          <label htmlFor="edit_unit_reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Perubahan <span className="text-red-500">*</span>
          </label>
          <textarea
            id="edit_unit_reason"
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Jelaskan alasan perubahan data unit (dicatat pada riwayat audit)…"
            className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
          />
          {fieldErrors.reason && <p className="text-[11px] text-red-600 mt-1">{fieldErrors.reason}</p>}
        </div>
      </form>
    </PanelShell>
  )
}

function UnitDetailDrawer({ unitId, fallbackUnit, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!unitId) return
    setLoading(true)
    adminApi.unit(unitId)
      .then((res) => {
        setData(res.data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [unitId])

  const u = data || fallbackUnit

  return (
    <Drawer
      open={Boolean(unitId || fallbackUnit)}
      onClose={onClose}
      eyebrow="PREVIEW DETAIL UNIT"
      title={u ? `${u.code} - ${u.name}` : 'Detail Unit Organisasi'}
      subtitle={`Hierarki kerja ${u?.unit_type ?? ''} pada boundary operasional PLN`}
      size="max-w-xl"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {loading && <Spinner />}

        {u && (
          <div className="space-y-5">
            {/* Unit Info Card */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200 dark:border-slate-700/60 text-xs space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Kode Unit:</span>
                  <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">{u.code}</div>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Tipe Unit:</span>
                  <div className="mt-0.5">
                    <span className="inline-block rounded-md bg-slate-200 dark:bg-slate-700 px-2 py-0.5 font-semibold text-slate-800 dark:text-slate-200">
                      {u.unit_type}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <span className="text-slate-500 dark:text-slate-400">Nama Lengkap:</span>
                <div className="font-medium text-slate-900 dark:text-slate-100 text-sm mt-0.5">{u.name}</div>
              </div>

              {u.parent_name && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Unit Induk:</span>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{u.parent_code} - {u.parent_name}</div>
                </div>
              )}

              <div>
                <span className="text-slate-500 dark:text-slate-400">Status Operasional:</span>
                <div className="mt-1">
                  <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </div>
              </div>

              <div>
                <span className="text-slate-500 dark:text-slate-400">Alamat Kantor:</span>
                <div className="text-slate-700 dark:text-slate-300 mt-0.5">{u.address || <span className="text-slate-400 italic">Belum dicatat</span>}</div>
              </div>
            </div>

            {/* Child units if UP3 */}
            {data?.children && data.children.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Unit Anak (ULP Terdaftar):</h4>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs overflow-hidden">
                  {data.children.map((child) => (
                    <div key={child.id} className="p-3 flex items-center justify-between bg-white dark:bg-slate-900/50">
                      <div>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 mr-2">{child.code}</span>
                        <span className="text-slate-700 dark:text-slate-300">{child.name}</span>
                      </div>
                      <StatusBadge status={child.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audit History Timeline */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <IconHistory size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Riwayat Audit Perubahan (organizational_unit_histories)</span>
              </div>

              {data?.histories && data.histories.length > 0 ? (
                <div className="space-y-2 text-xs">
                  {data.histories.map((h) => (
                    <div key={h.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Oleh: <strong className="text-slate-700 dark:text-slate-200">{h.changed_by_name}</strong></span>
                        <span>{h.changed_at ? new Date(h.changed_at).toLocaleString('id-ID') : '-'}</span>
                      </div>

                      {h.old_name && h.new_name && h.old_name !== h.new_name && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          Nama: <span className="line-through text-slate-400">{h.old_name}</span> &rarr; <span className="text-slate-900 dark:text-slate-100 font-medium">{h.new_name}</span>
                        </div>
                      )}

                      {h.old_is_active !== null && h.new_is_active !== null && h.old_is_active !== h.new_is_active && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          Status: <span className="line-through text-slate-400">{h.old_is_active ? 'Aktif' : 'Nonaktif'}</span> &rarr; <span className="text-slate-900 dark:text-slate-100 font-medium">{h.new_is_active ? 'Aktif' : 'Nonaktif'}</span>
                        </div>
                      )}

                      <div className="text-slate-700 dark:text-slate-300 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800 mt-1">
                        &ldquo;{h.reason}&rdquo;
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Belum ada catatan riwayat audit tambahan.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
