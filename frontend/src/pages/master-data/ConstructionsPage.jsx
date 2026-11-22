import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
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
import Modal from '../../components/Modal.jsx'
import { useNavigate } from 'react-router-dom'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import { downloadCsv, CONSTRUCTION_TYPES_TEMPLATE, CONSTRUCTION_BOM_TEMPLATE } from '../../utils/csvTemplates.js'
import { useDebounce } from '../../utils/useDebounce.js'
import {
  IconSearch,
  IconRefresh,
  IconEye,
  IconCheckCircle,
  IconLayers,
  IconUpload,
  IconDownload,
  IconClock,
  IconPencil,
  IconAlertCircle,
  IconZap,
} from '../../components/icons.jsx'
import { filterSearchCls } from '../../components/filterStyles.js'

const CONSTRUCTION_GROUPS = [
  { code: '', label: 'Semua Kelompok' },
  { code: 'SUTM', label: 'SUTM' },
  { code: 'MVTIC', label: 'MVTIC' },
  { code: 'SUTR', label: 'SUTR' },
  { code: 'SKTM', label: 'SKTM' },
  { code: 'KUBIKEL', label: 'Kubikel' },
  { code: 'GTT_UMUM', label: 'GTT Umum' },
  { code: 'GTT_KHUSUS', label: 'GTT Khusus' },
  { code: 'ESTETIKA', label: 'Estetika' },
  { code: 'PBPD', label: 'PBPD' },
]

export default function ConstructionsPage() {
  const navigate = useNavigate()
  const { can, canWrite } = useAccess()
  const { notify } = useNotifications()
  const searchInputRef = useRef(null)

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [group, setGroup] = useState('')
  const [hasDraft, setHasDraft] = useState(false)

  // Drawer / modal
  const [detailTarget, setDetailTarget] = useState(null)
  const [approveTarget, setApproveTarget] = useState(null)
  const [editDraftTarget, setEditDraftTarget] = useState(null)

  // Bulk approval: ids of draft versions ticked by the user (server accepts up to 500 per request).
  const BULK_MAX = 500
  const [selected, setSelected] = useState(() => new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const canApprove = can?.['construction_types.approve'] !== false

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

  const loadConstructions = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    const params = {
      page,
      per_page: perPage,
      search: debouncedSearch || undefined,
      group: group || undefined,
      has_draft: hasDraft ? '1' : undefined,
    }
    masterDataApi.constructionTypes(params)
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta }))
      .catch((e) => setState({ loading: false, error: e.message, rows: [], meta: null }))
  }, [page, perPage, debouncedSearch, group, hasDraft])

  useEffect(() => {
    loadConstructions()
  }, [loadConstructions])

  const draftRows = state.rows.filter((t) => t.draft?.id)
  const pageDraftIds = draftRows.map((t) => t.draft.id)
  const allOnPageSelected = pageDraftIds.length > 0 && pageDraftIds.every((id) => selected.has(id))

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev)
    if (allOnPageSelected) pageDraftIds.forEach((id) => next.delete(id)); else pageDraftIds.forEach((id) => next.add(id))
    return next
  })

  // Every pending draft matching the current search and group, across all pages (a page is capped at 100).
  const selectAllPending = async () => {
    setSelectingAll(true)
    setBulkError('')
    try {
      const ids = new Set()
      let current = 1
      let last = 1
      do {
        const d = await masterDataApi.constructionTypes({
          page: current, per_page: 100, search: search || undefined, group: group || undefined, has_draft: '1',
        })
        ;(d.data ?? []).filter((t) => t.draft?.id).forEach((t) => ids.add(t.draft.id))
        last = d.meta?.last_page ?? 1
        current += 1
      } while (current <= last && ids.size <= BULK_MAX)
      if (ids.size > BULK_MAX) setBulkError(`Dipilih ${BULK_MAX} pertama; sisanya dapat disetujui pada putaran berikutnya.`)
      setSelected(new Set([...ids].slice(0, BULK_MAX)))
    } catch (e) {
      setBulkError(e.message || 'Gagal memuat seluruh draf tertunda.')
    } finally {
      setSelectingAll(false)
    }
  }

  const handleBulkApprove = async (reason) => {
    const ids = [...selected]
    await masterDataApi.approveConstructionTypes({ version_ids: ids, reason })
    notify({
      type: 'success',
      title: 'Versi Standar Konstruksi Disetujui',
      desc: `${ids.length} versi draf standar konstruksi telah disetujui dan kini mengikat kalkulasi MTO/BOM.`,
      tag: 'Konstruksi',
    })
    setSelected(new Set())
    setBulkOpen(false)
    loadConstructions()
  }

  const handleApprove = async (reason) => {
    if (!approveTarget) return
    const versionId = approveTarget.draft?.id
    await masterDataApi.approveConstructionTypes({
      version_ids: [versionId],
      reason,
    })
    notify({
      type: 'success',
      title: 'Versi Standar Konstruksi Disetujui',
      desc: `Standar konstruksi ${approveTarget.code} kini aktif dan mengikat kalkulasi MTO/BOM.`,
      tag: 'Konstruksi',
    })
    setApproveTarget(null)
    loadConstructions()
  }

  const stats = useMemo(() => {
    const total = state.meta?.total ?? state.rows.length
    const activeCount = state.rows.filter((r) => r.current).length
    const draftCount = state.rows.filter((r) => r.draft?.id).length
    const groupsCount = CONSTRUCTION_GROUPS.filter((g) => g.code !== '').length
    return {
      total,
      activeCount,
      draftCount,
      groupsCount,
    }
  }, [state.rows, state.meta])

  return (
    <div className="space-y-6">
      {/* Header Modul Standar Konstruksi */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconLayers className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Standar Konstruksi Distribusi &amp; BOM
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Standar Enjiniring PLN
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Standar tipe konstruksi tiang, trafo, SUTM/SUTR, dan matriks pemetaan koefisien kebutuhan material KHS rujukan.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={loadConstructions}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={IconUpload}
              onClick={() => navigate('/master-data/constructions/impor')}
            >
              Impor Standar (CSV)
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Standar Konstruksi */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Konstruksi</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconLayers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Tipe konstruksi terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Versi Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.activeCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Status APPROVED mengikat</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Draf Tertunda</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.draftCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu ditinjau / disetujui</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Kelompok Jaringan</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.groupsCount}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">SUTM, SUTR, GTT, dsb</p>
        </div>
      </dl>

      {/* Group Tabs */}
      <div role="tablist" aria-label="Kelompok Standar Konstruksi" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {CONSTRUCTION_GROUPS.map((g) => {
          const isActive = group === g.code
          return (
            <button
              key={g.code}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => { setGroup(g.code); setPage(1) }}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>

      {/* Main Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cari kode konstruksi atau nama…"
              className={`${filterSearchCls} w-full`}
            />
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                /
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => { setHasDraft((prev) => !prev); setPage(1) }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              hasDraft
                ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            <IconClock size={14} />
            <span>Hanya Draf</span>
          </button>

        </div>

        {/* Bulk approval bar */}
        {canApprove && (selected.size > 0 || draftRows.length > 0) && (
          <div className="px-4 sm:px-5 py-2.5 border-b border-slate-100 dark:border-slate-800/80 bg-amber-50/60 dark:bg-amber-950/20 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-200" aria-live="polite">
              {selected.size > 0 ? `${selected.size} draf dipilih` : `${draftRows.length} draf tertunda di halaman ini`}
            </span>
            <button type="button" onClick={selectAllPending} disabled={selectingAll}
              className="font-semibold text-blue-700 dark:text-blue-300 hover:underline disabled:opacity-50 cursor-pointer">
              {selectingAll ? 'Memuat…' : 'Pilih semua draf tertunda (semua halaman)'}
            </button>
            {selected.size > 0 && (
              <>
                <button type="button" onClick={() => { setSelected(new Set()); setBulkError('') }}
                  className="text-slate-500 hover:text-slate-800 underline cursor-pointer">
                  Kosongkan pilihan
                </button>
                <button type="button" onClick={() => setBulkOpen(true)}
                  className="ml-auto rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 cursor-pointer">
                  Setujui {selected.size} terpilih
                </button>
              </>
            )}
            {bulkError && <span className="basis-full text-rose-600">{bulkError}</span>}
          </div>
        )}

        {/* Table Content */}
        <div>
          {state.error && <div className="p-5"><Alert>{state.error}</Alert></div>}
          {state.loading && <div className="p-8"><Spinner /></div>}

          {!state.loading && !state.error && state.rows.length === 0 && (
            <EmptyState
              icon={IconLayers}
              title="Belum ada tipe konstruksi"
              description="Data standar tipe konstruksi dapat diunggah dari file referensi atau katalog standar."
            />
          )}

          {!state.loading && state.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60">
                  <tr>
                    {canApprove && (
                      <th className="py-3.5 pl-6 pr-0 w-8">
                        <input type="checkbox" aria-label="Pilih semua draf di halaman ini" checked={allOnPageSelected}
                          disabled={pageDraftIds.length === 0} onChange={togglePage} className="h-4 w-4 cursor-pointer" />
                      </th>
                    )}
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      KELOMPOK
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      NAMA TIPE KONSTRUKSI
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      KOMPONEN KHS (BOM)
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      VERSI AKTIF
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.rows.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      {canApprove && (
                        <td className="py-3.5 pl-6 pr-0 w-8">
                          {t.draft?.id ? (
                            <input type="checkbox" aria-label={`Pilih draf konstruksi ${t.code}`} checked={selected.has(t.draft.id)}
                              onChange={() => toggleOne(t.draft.id)} className="h-4 w-4 cursor-pointer" />
                          ) : null}
                        </td>
                      )}
                      <td className="py-3.5 px-6">
                        <span className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {t.group}
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {t.name ?? t.code}
                        </div>
                        <div className="font-mono text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          <span>Kode: </span>
                          <span>{t.code}</span>
                          {t.external_code && <span> · Ref: {t.external_code}</span>}
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
                          <IconLayers size={13} />
                          <span>{(t.current?.mappings_count ?? t.draft?.mappings_count ?? 0)} Komponen KHS</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        {t.current ? (
                          <div className="space-y-0.5">
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              v{t.current.version_number} (Aktif)
                            </span>
                            <div className="text-[11px] text-slate-400">Sejak: {t.current.valid_from}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-500 font-medium">Draf v{t.draft?.version_number ?? 1}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailTarget(t)}
                            aria-label="Detail Konstruksi & BOM"
                            title="Lihat Detail & Pemetaan KHS (BOM)"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <IconEye size={17} />
                          </button>

                          {t.draft && (
                            <button
                              type="button"
                              onClick={() => setEditDraftTarget(t)}
                              aria-label="Ubah Draf Standar"
                              title="Ubah Rincian Draf Standar Konstruksi"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                            >
                              <IconPencil size={17} />
                            </button>
                          )}

                          {t.draft && (
                            <button
                              type="button"
                              onClick={() => setApproveTarget(t)}
                              aria-label="Setujui Versi"
                              title="Setujui Versi Aktif"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                            >
                              <IconCheckCircle size={17} />
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
              entityLabel="tipe konstruksi"
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

      {/* Detail / BOM Preview Drawer */}
      {detailTarget && (
        <ConstructionDetailDrawer
          construction={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Edit Draft Modal */}
      {editDraftTarget && (
        <ConstructionEditDraftModal
          open={Boolean(editDraftTarget)}
          target={editDraftTarget}
          onClose={() => setEditDraftTarget(null)}
          onSaved={loadConstructions}
        />
      )}

      {/* Approval Modal */}
      {approveTarget && (
        <ConfirmationModal
          open={true}
          title="Persetujuan Standar Konstruksi"
          description={`Anda akan menyetujui versi draf standar konstruksi ${approveTarget.code} - ${approveTarget.name}.`}
          confirmText="Setujui Versi"
          variant="info"
          requiresReason={true}
          reasonPrompt="Nomor SK / Penetapan Standar Konstruksi"
          onConfirm={handleApprove}
          onCancel={() => setApproveTarget(null)}
        />
      )}

      {/* Bulk approval confirmation */}
      {bulkOpen && (
        <ConfirmationModal
          open={true}
          title="Persetujuan Massal Standar Konstruksi"
          description={`Anda akan menyetujui ${selected.size} versi draf standar konstruksi sekaligus menjadi versi resmi aktif. Satu alasan berlaku untuk semuanya dan dicatat pada riwayat tiap versi. Bila ada satu versi yang tidak boleh Anda setujui (misalnya Anda sendiri pembuat draf), seluruh persetujuan ditolak dan tidak ada yang berubah.`}
          confirmText={`Setujui ${selected.size} Versi`}
          variant="info"
          requiresReason={true}
          reasonPrompt="Nomor SK / Penetapan Standar Konstruksi"
          onConfirm={handleBulkApprove}
          onCancel={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

function ConstructionEditDraftModal({ open, target, onClose, onSaved }) {
  const { notify } = useNotifications()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [referenceSymbol, setReferenceSymbol] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (target?.draft) {
      setName(target.draft.name || target.name || '')
      setDescription(target.draft.description || '')
      setReferenceSymbol(target.draft.reference_symbol || '')
      setValidFrom(target.draft.valid_from ? target.draft.valid_from.slice(0, 10) : new Date().toISOString().slice(0, 10))
      setReason('')
      setError('')
    }
  }, [target, open])

  if (!open || !target?.draft) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Alasan perubahan draf standar konstruksi wajib diisi.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await masterDataApi.updateConstructionDraft(target.draft.id, {
        name: name.trim() || undefined,
        description: description.trim() || null,
        reference_symbol: referenceSymbol.trim() || null,
        valid_from: validFrom || undefined,
        reason: reason.trim(),
      })
      notify({
        type: 'success',
        title: 'Draf Standar Konstruksi Diperbarui',
        desc: `Perubahan draf standar ${target.code} berhasil disimpan.`,
        tag: 'Konstruksi',
      })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan perubahan draf standar konstruksi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ubah Draf Standar Konstruksi: ${target.code}`}
      subtitle={`Versi Draf v${target.draft.version_number ?? 1} · Kelompok ${target.group}`}
      width="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nama Tipe Konstruksi
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nama tipe standar konstruksi"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Simbol / Rujukan
            </label>
            <input
              type="text"
              value={referenceSymbol}
              onChange={(e) => setReferenceSymbol(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Misal: TM-1, TR-2"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tanggal Berlaku
            </label>
            <input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Deskripsi / Catatan Enjiniring
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Uraian spesifikasi teknis dan peruntukan konstruksi..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Perubahan <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Misal: Penyesuaian nama tipe sesuai Kepdir Enjiniring 2026"
            required
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ConstructionDetailDrawer({ construction, onClose }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(construction)
  const [mappings, setMappings] = useState([])
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [mapPage, setMapPage] = useState(1)
  const [mapPerPage, setMapPerPage] = useState(10)

  useEffect(() => {
    masterDataApi.constructionType(construction.id)
      .then((res) => {
        const activeVer = res.data?.versions?.find((v) => v.status === 'APPROVED') || res.data?.versions?.[0]
        setData({
          ...res.data,
          name: activeVer?.name || construction?.name || res.data?.name,
          group: res.data?.group || res.data?.group_code || construction?.group,
        })
        setLoading(false)
        if (activeVer) {
          loadMappings(activeVer.id)
        }
      })
      .catch(() => setLoading(false))
  }, [construction.id, construction.name, construction.group])

  const loadMappings = (versionId) => {
    setLoadingMappings(true)
    masterDataApi.constructionMappings(versionId)
      .then((res) => {
        setMappings(res.data ?? [])
        setLoadingMappings(false)
      })
      .catch(() => setLoadingMappings(false))
  }

  const activeVer = data?.versions?.find((v) => v.status === 'APPROVED') || data?.versions?.[0]
  const displayName = data?.name || activeVer?.name || construction?.name || data?.code

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title="Standar Konstruksi & Pemetaan KHS (BOM)"
      subtitle={`${displayName} · Kelompok ${data?.group || data?.group_code || ''}`}
      width="max-w-3xl"
      footer={
        <div className="flex justify-end w-full">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        {loading && <Spinner />}

        {/* Identity */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Nama Tipe Konstruksi</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">{displayName}</h3>
              <div className="flex items-center gap-2 font-mono text-xs text-slate-400 dark:text-slate-500 mt-1">
                <span>Kode: </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{data?.code}</span>
                {data?.external_code && <span> · Ref: {data.external_code}</span>}
              </div>
            </div>
            <StatusBadge status={data?.is_active ? 'ACTIVE' : 'INACTIVE'} />
          </div>
        </div>

        {/* Mappings Table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Matriks Kebutuhan Komponen KHS ({mappings.length} Item)
            </h4>
          </div>

          {loadingMappings ? (
            <Spinner />
          ) : mappings.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Belum ada pemetaan komponen KHS pada versi ini.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold text-slate-500">NO</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-500">KODE KHS</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-500">URAIAN MATERIAL / JASA</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-500">SATUAN</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-500">RELASI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {mappings
                    .slice((mapPage - 1) * mapPerPage, mapPage * mapPerPage)
                    .map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{m.sequence ?? idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">{m.khs_code}</td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{m.khs_name ?? '-'}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-400">{m.khs_unit ?? '-'}</td>
                      <td className="py-2.5 px-3">
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {m.relation}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <TableFooter
                itemCount={mappings.slice((mapPage - 1) * mapPerPage, mapPage * mapPerPage).length}
                total={mappings.length}
                entityLabel="komponen KHS"
                page={mapPage}
                perPage={mapPerPage}
                onPage={setMapPage}
                onPerPage={(n) => {
                  setMapPerPage(n)
                  setMapPage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

export function ConstructionImportDrawer({ asPage = false, onClose, onSuccess }) {
  const [tab, setTab] = useState('types') // 'types' | 'bom'
  const [file, setFile] = useState(null)
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [dryRun, setDryRun] = useState(true)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Pilih berkas CSV terlebih dahulu.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (dryRun) formData.append('dry_run', '1')

      let res
      if (tab === 'types') {
        formData.append('valid_from', validFrom)
        res = await masterDataApi.importConstructionTypes(formData)
      } else {
        res = await masterDataApi.importConstructionMappings(formData)
      }
      setResult(res.data)
      if (!dryRun) {
        onSuccess()
      }
    } catch (err) {
      setError(err.message || 'Gagal mengimpor berkas.')
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
      title="Impor Standar Konstruksi & BOM"
      subtitle="Unggah master data standar konstruksi PLN atau pemetaan komponen KHS"
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Tutup</Button>
          <Button variant="primary" onClick={handleImport} disabled={loading || !file}>
            {loading ? 'Memproses…' : dryRun ? 'Uji Coba (Dry Run)' : 'Terapkan Impor'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        {/* Tab Switcher */}
        <div role="tablist" aria-label="Tab Impor Standar Konstruksi" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'types'}
            onClick={() => { setTab('types'); setFile(null); setResult(null); setError('') }}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
              tab === 'types'
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            1. Tipe Standar Konstruksi
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bom'}
            onClick={() => { setTab('bom'); setFile(null); setResult(null); setError('') }}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
              tab === 'bom'
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            2. Matriks BOM (Pemetaan KHS)
          </button>
        </div>

        {error && <Alert>{error}</Alert>}

        {/* Download Template Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="space-y-0.5">
            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
              Format Berkas CSV {tab === 'types' ? 'Tipe Konstruksi' : 'Matriks BOM KHS'}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Unduh template resmi berisi nama header kolom standar untuk mencegah galat validasi.
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              downloadCsv(
                tab === 'types' ? 'template-standar-konstruksi.csv' : 'template-bom-konstruksi.csv',
                tab === 'types' ? CONSTRUCTION_TYPES_TEMPLATE : CONSTRUCTION_BOM_TEMPLATE
              )
            }
            className="text-xs py-1.5 px-3 shrink-0"
          >
            <IconDownload size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span>Unduh Template CSV</span>
          </Button>
        </div>

        <form onSubmit={handleImport} className="space-y-4">
          {tab === 'types' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tanggal Mulai Berlaku (valid_from) <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                required
              />
            </div>
          )}

          <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-6 text-center">
            <IconUpload size={32} className="mx-auto text-slate-400 mb-2" />
            <label htmlFor="const-csv-upload" className="block text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
              Pilih Berkas CSV {tab === 'types' ? 'Tipe Konstruksi' : 'Matriks BOM KHS'}
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {tab === 'types'
                ? 'Kolom wajib: group, label. Kolom opsional: code, description, reference_symbol, source_reference.'
                : 'Kolom wajib: khs_code. Kolom rujukan: group, code, label, relation, note.'}
            </p>
            <input
              id="const-csv-upload"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => setFile(e.target.files[0] || null)}
              className="mt-4 text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Mode Uji Coba (Dry Run) — Pratinjau validasi tanpa menyimpan ke database</span>
            </label>
          </div>

          {result && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
              <div className="font-bold text-emerald-900 dark:text-emerald-200 text-xs">
                Hasil {result.dry_run ? 'Uji Coba (Dry Run)' : 'Impor Berhasil'}:
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {Object.entries(result.summary || result).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-slate-500 capitalize">{k.replace('_', ' ')}:</span> <strong>{String(v)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </PanelShell>
  )
}
