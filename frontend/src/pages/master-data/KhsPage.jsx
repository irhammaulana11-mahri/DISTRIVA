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
import { useNavigate } from 'react-router-dom'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import { downloadCsv, KHS_CATALOG_TEMPLATE } from '../../utils/csvTemplates.js'
import { useDebounce } from '../../utils/useDebounce.js'
import {
  IconSearch,
  IconRefresh,
  IconEye,
  IconPencil,
  IconUpload,
  IconDownload,
  IconCheck,
  IconClipboard,
  IconCheckCircle,
  IconAlertCircle,
  IconHistory,
  IconClock,
} from '../../components/icons.jsx'

export default function KhsPage() {
  const navigate = useNavigate()
  const { can, canWrite } = useAccess()
  const { notify } = useNotifications()
  const searchInputRef = useRef(null)

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [hasDraftOnly, setHasDraftOnly] = useState(false)

  // Drawers and Modals
  const [detailTarget, setDetailTarget] = useState(null)
  const [approveTarget, setApproveTarget] = useState(null)
  const [editDraftTarget, setEditDraftTarget] = useState(null)

  // Bulk approval: ids of draft versions ticked by the user (server accepts up to 1000 per request).
  const BULK_MAX = 1000
  const [selected, setSelected] = useState(() => new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const canApprove = can?.['khs.approve'] !== false
  const draftId = (k) => k.draft?.id || k.version_id

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

  const loadKhs = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    const params = {
      page,
      per_page: perPage,
      search: debouncedSearch || undefined,
      has_draft: hasDraftOnly ? '1' : undefined,
    }
    masterDataApi.khsList(params)
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta }))
      .catch((e) => setState({ loading: false, error: e.message, rows: [], meta: null }))
  }, [page, perPage, debouncedSearch, hasDraftOnly])

  useEffect(() => {
    loadKhs()
  }, [loadKhs])

  const draftRows = state.rows.filter((k) => k.has_draft && draftId(k))
  const pageDraftIds = draftRows.map(draftId)
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

  // Every pending draft that matches the current search, across all pages (the list endpoint caps a page at 100).
  const selectAllPending = async () => {
    setSelectingAll(true)
    setBulkError('')
    try {
      const ids = new Set()
      let current = 1
      let last = 1
      do {
        const d = await masterDataApi.khsList({ page: current, per_page: 100, search: search || undefined, has_draft: '1' })
        ;(d.data ?? []).filter((k) => k.has_draft && draftId(k)).forEach((k) => ids.add(draftId(k)))
        last = d.meta?.last_page ?? 1
        current += 1
      } while (current <= last && ids.size < BULK_MAX)
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
    await masterDataApi.approveKhs({ version_ids: ids, reason })
    notify({
      type: 'success',
      title: 'Versi KHS Disetujui',
      desc: `${ids.length} versi draf KHS telah disetujui dan berstatus aktif (immutable).`,
      tag: 'KHS',
    })
    setSelected(new Set())
    setBulkOpen(false)
    loadKhs()
  }

  const handleApproveDraft = async (reason) => {
    if (!approveTarget) return
    const versionId = approveTarget.draft?.id || approveTarget.version_id
    await masterDataApi.approveKhs({
      version_ids: [versionId],
      reason,
    })
    notify({
      type: 'success',
      title: 'Versi KHS Disetujui',
      desc: `Versi resmi KHS untuk ${approveTarget.code} telah disetujui dan berstatus aktif (immutable).`,
      tag: 'KHS',
    })
    setApproveTarget(null)
    loadKhs()
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconClipboard className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Katalog Harga Satuan (KHS)
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  518 Item Standar PLN
                </span>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  SoD Manager
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Katalog referensi harga satuan berversi. Versi aktif bersifat immutable dan memerlukan persetujuan Manager (SoD).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadKhs}
              icon={IconRefresh}
              aria-label="Segarkan data KHS"
            >
              Segarkan
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadCsv(KHS_CATALOG_TEMPLATE.filename, KHS_CATALOG_TEMPLATE.headers)}
              icon={IconDownload}
              aria-label="Unduh format template CSV KHS"
            >
              Template CSV
            </Button>
            <button
              type="button"
              onClick={() => navigate('/master-data/khs/impor')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-3 py-1.5 text-xs shadow-xs transition focus-ring cursor-pointer"
            >
              <IconUpload className="h-4 w-4" />
              <span>Impor KHS (CSV)</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik KHS */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Item Terdaftar</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconClipboard className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {(state.meta?.total ?? state.rows.length).toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">518 SKU standar PLN</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Versi Aktif Terpublikasi</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {state.rows.filter((k) => k.current).length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Immutable & resmi berlaku</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Draf Tertunda Verifikasi</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {draftRows.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Butuh verifikasi Manager UP3</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Draf Terpilih Massal</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconCheck className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {selected.size.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Siap disetujui satu klik</p>
        </div>
      </dl>

      {/* Main Standardized Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Filter Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch size={16} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cari kode (1..518) atau uraian KHS…"
              className="block w-full pl-10 pr-14 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none"
            />
            <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                /
              </span>
            </span>
          </div>

          {/* Has Draft Toggle */}
          <button
            type="button"
            onClick={() => { setHasDraftOnly((prev) => !prev); setPage(1) }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              hasDraftOnly
                ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
            }`}
          >
            <IconClock size={14} />
            <span>Hanya Draf Tertunda</span>
          </button>

          {/* Reset & Refresh */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {(search || hasDraftOnly) && (
              <button
                type="button"
                onClick={() => { setSearch(''); setHasDraftOnly(false); setPage(1) }}
                className="text-xs text-slate-500 hover:text-slate-800 underline px-1 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
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
              icon={IconClipboard}
              title="Belum ada data KHS"
              description="Katalog KHS dapat diimpor dari file CSV master atau workbook harga satuan."
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
                      KODE & URAIAN KHS
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      SATUAN & SUMBER
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      VERSI AKTIF
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      STATUS DRAF
                    </th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.rows.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      {canApprove && (
                        <td className="py-3.5 pl-6 pr-0 w-8">
                          {k.has_draft && draftId(k) ? (
                            <input type="checkbox" aria-label={`Pilih draf KHS ${k.code}`} checked={selected.has(draftId(k))}
                              onChange={() => toggleOne(draftId(k))} className="h-4 w-4 cursor-pointer" />
                          ) : null}
                        </td>
                      )}
                      <td className="py-3.5 px-6">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {k.current?.name ?? k.draft?.name ?? `Item KHS #${k.code}`}
                        </div>
                        <div className="font-mono text-xs text-slate-400 mt-0.5">Kode: {k.code}</div>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {k.current?.unit_text ?? k.draft?.unit_text ?? '-'}
                          </span>
                          {(k.current?.category ?? k.draft?.category) && (
                            <span className="text-xs text-slate-400">
                              · {k.current?.category ?? k.draft?.category}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        {k.current ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              v{k.current.version_number} (Aktif)
                            </span>
                            <div className="text-[11px] text-slate-400">
                              Mulai: {k.current.valid_from}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Belum disetujui</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6">
                        {k.has_draft ? (
                          <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-800/60">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            <span>Menunggu Approval (v{k.draft?.version_number ?? 'Draft'})</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailTarget(k)}
                            aria-label="Detail KHS"
                            title="Lihat Detail & Riwayat Versi"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <IconEye size={17} />
                          </button>

                          {k.has_draft && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditDraftTarget({ id: k.id, code: k.code, draft: k.draft })}
                                aria-label="Koreksi Draf"
                                title="Koreksi Draf KHS"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              >
                                <IconPencil size={17} />
                              </button>

                              <button
                                type="button"
                                onClick={() => setApproveTarget(k)}
                                aria-label="Setujui Versi"
                                title="Setujui Versi Aktif (UP3 Manager)"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                              >
                                <IconCheckCircle size={17} />
                              </button>
                            </>
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
              entityLabel="item KHS"
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
        <KhsDetailDrawer
          item={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Approval Confirmation Modal */}
      {approveTarget && (
        <ConfirmationModal
          open={true}
          title="Persetujuan Versi KHS"
          description={`Anda akan menyetujui versi draft KHS #${approveTarget.code} menjadi versi resmi aktif. Sesuai prinsip SoD, pembuat draft tidak dapat menyetujui versinya sendiri.`}
          confirmText="Setujui & Publikasikan"
          variant="info"
          requiresReason={true}
          reasonPrompt="Alasan persetujuan versi (SK / Surat Penetapan)"
          onConfirm={handleApproveDraft}
          onCancel={() => setApproveTarget(null)}
        />
      )}

      {/* Koreksi Draf KHS Drawer */}
      {editDraftTarget && (
        <KhsDraftEditDrawer
          asPage={false}
          item={editDraftTarget}
          onClose={() => setEditDraftTarget(null)}
          onSuccess={() => {
            setEditDraftTarget(null)
            loadKhs()
            notify({
              type: 'success',
              title: 'Draf KHS Diperbarui',
              desc: `Perubahan draf untuk item #${editDraftTarget.code} berhasil disimpan.`,
              tag: 'KHS',
            })
          }}
        />
      )}

      {/* Bulk approval confirmation */}
      {bulkOpen && (
        <ConfirmationModal
          open={true}
          title="Persetujuan Massal Versi KHS"
          description={`Anda akan menyetujui ${selected.size} versi draf KHS sekaligus menjadi versi resmi aktif. Satu alasan berlaku untuk semuanya dan dicatat pada riwayat tiap versi. Bila ada satu versi yang tidak boleh Anda setujui (misalnya Anda sendiri pembuat draf), seluruh persetujuan ditolak dan tidak ada yang berubah.`}
          confirmText={`Setujui ${selected.size} Versi`}
          variant="info"
          requiresReason={true}
          reasonPrompt="Alasan persetujuan (SK / Surat Penetapan)"
          onConfirm={handleBulkApprove}
          onCancel={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

function KhsDetailDrawer({ item, onClose }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(item)

  useEffect(() => {
    masterDataApi.khsItem(item.id)
      .then((res) => {
        setData(res.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [item.id])

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title="Detail & Versi Katalog KHS"
      subtitle={`Kode Referensi #${data.code}`}
      width="max-w-2xl"
      footer={
        <div className="flex justify-end w-full">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        {loading && <Spinner />}

        {data.versions && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Riwayat Versi KHS ({data.versions.length} Versi)
            </h4>

            {data.versions.map((v) => (
              <div key={v.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/40 dark:bg-slate-800/30">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-slate-400">Versi {v.version_number}</span>
                    <h5 className="font-bold text-slate-900 dark:text-slate-100">{v.name}</h5>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    v.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                    v.status === 'DRAFT' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {v.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <span className="text-slate-400 block">Satuan (unit_text)</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{v.unit_text}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Kategori</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{v.category || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Berlaku Dari</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{v.valid_from}</span>
                  </div>
                </div>

                {v.events && v.events.length > 0 && (
                  <div className="pt-2 text-xs border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Timeline Peristiwa</span>
                    {v.events.map((e, idx) => (
                      <div key={idx} className="text-slate-500 text-[11px]">
                        • <strong>{e.event_type}</strong>: {e.reason || '-'} ({new Date(e.occurred_at).toLocaleString('id-ID')})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}

export function KhsDraftEditDrawer({ asPage = false, item, onClose, onSuccess }) {
  const draft = item.draft
  const [name, setName] = useState(draft?.name || '')
  const [unitText, setUnitText] = useState(draft?.unit_text || '')
  const [category, setCategory] = useState(draft?.category || '')
  const [validFrom, setValidFrom] = useState(draft?.valid_from || '')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Alasan perubahan draf wajib diisi.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await masterDataApi.updateKhsDraft(draft.id, {
        name: name.trim(),
        unit_text: unitText.trim(),
        category: category.trim() || null,
        valid_from: validFrom || undefined,
        reason: reason.trim(),
      })
      onSuccess()
    } catch (err) {
      setError(err.message || 'Gagal memperbarui draf KHS.')
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
      title="Koreksi Draf KHS"
      subtitle={`Kode #${item.code} (Versi Draf: ${draft?.version_number ?? 'DRAFT'})`}
      width="max-w-xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Batal</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Menyimpan…' : 'Simpan Draf'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {error && <Alert>{error}</Alert>}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Uraian Item KHS <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Satuan (unit_text) <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={unitText}
              onChange={(e) => setUnitText(e.target.value)}
              placeholder="Contoh: B, S, M, Ls"
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Kategori Sumber
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="MDU / DPT / PLN"
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Mulai Berlaku (valid_from)
          </label>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
          />
        </div>

        <div>
          <label htmlFor="khs-edit-reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Koreksi Draf (Audit Trail) <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="khs-edit-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan perbaikan deskripsi atau tanggal mulai berlaku..."
            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            required
          />
        </div>
      </form>
    </PanelShell>
  )
}

export function KhsImportDrawer({ asPage = false, onClose, onSuccess }) {
  const [file, setFile] = useState(null)
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [dryRun, setDryRun] = useState(true)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Pilih berkas CSV KHS terlebih dahulu.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('valid_from', validFrom)
      if (dryRun) formData.append('dry_run', '1')

      const res = await masterDataApi.importKhs(formData)
      setResult(res.data)
      if (!dryRun) {
        onSuccess()
      }
    } catch (err) {
      setError(err.message || 'Gagal mengimpor berkas KHS.')
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
      title="Impor Katalog KHS (518 Item)"
      subtitle="Membuat versi DRAFT KHS dari berkas CSV"
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Tutup</Button>
          <Button variant="primary" onClick={handleImport} disabled={loading || !file}>
            {loading ? 'Memproses…' : dryRun ? 'Uji Coba (Dry Run)' : 'Terapkan Draf KHS'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleImport} className="space-y-5 text-sm">
        {error && <Alert>{error}</Alert>}

        {/* Download Template Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
          <div className="space-y-0.5">
            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
              Format Berkas CSV Katalog KHS
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Unduh template resmi berisi header 518 item KHS standar PLN.
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => downloadCsv('template-katalog-khs.csv', KHS_CATALOG_TEMPLATE)}
            className="text-xs py-1.5 px-3 shrink-0"
          >
            <IconDownload size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span>Unduh Template CSV</span>
          </Button>
        </div>

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

        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-6 text-center">
          <IconUpload size={32} className="mx-auto text-slate-400 mb-2" />
          <label htmlFor="khs-csv-upload" className="block text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
            Pilih Berkas CSV KHS
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Kolom: <code>code, name (atau uraian), unit (atau satuan)</code>. Opsional: <code>category (sumber)</code>.
          </p>
          <input
            id="khs-csv-upload"
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
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>Total: <strong>{result.total}</strong></div>
              <div>Item Baru: <strong>{result.new_items}</strong></div>
              <div>Versi Baru: <strong>{result.new_versions}</strong></div>
              <div>Sama: <strong>{result.unchanged}</strong></div>
              <div>Ditolak: <strong>{result.rejected}</strong></div>
            </div>
          </div>
        )}
      </form>
    </PanelShell>
  )
}
