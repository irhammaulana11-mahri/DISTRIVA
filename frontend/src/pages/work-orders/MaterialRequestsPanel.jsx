import { useState, useEffect, useCallback } from 'react'
import { materialRequestsApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import HandoverForm from './HandoverForm.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconRefresh,
  IconDownload,
  IconCheck,
  IconX,
  IconEye,
  IconAlertCircle,
  IconTruck,
  IconCheckCircle,
  IconFileText,
} from '../../components/icons.jsx'

/** Outbox kebutuhan material dari WO jaringan sebuah agenda, untuk diserahkan ke aplikasi logistik (ERP/MIMS). Ditanam sebagai tab di halaman agenda SPK / WO. */
export default function MaterialRequestsPanel({ applicationId }) {
  const { can } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['material_requests.manage'])

  // Filter & List State
  const [statusFilter, setStatusFilter] = useState('')
  const [followupFilter, setFollowupFilter] = useState(false)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Detail Drawer State
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Actions State
  const [exporting, setExporting] = useState(false)
  const [markSentModalOpen, setMarkSentModalOpen] = useState(false)
  const [sentReference, setSentReference] = useState('')
  const [submittingSent, setSubmittingSent] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [submittingCancel, setSubmittingCancel] = useState(false)
  const [actionError, setActionError] = useState('')
  const [formSequence, setFormSequence] = useState(null)

  // Load Requests List
  const loadRequests = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await materialRequestsApi.list({
        status: statusFilter || undefined,
        followup: followupFilter || undefined,
        application_id: applicationId || undefined,
        page,
        per_page: perPage,
      })
      setRequests(res?.data || [])
      setMeta(res?.meta || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar permintaan material outbox.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, followupFilter, applicationId, page, perPage])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  // Open Detail Drawer
  const handleOpenDetail = async (id) => {
    setSelectedId(id)
    setDrawerOpen(true)
    setLoadingDetail(true)
    setActionError('')
    try {
      const res = await materialRequestsApi.get(id)
      setDetail(res?.data || null)
    } catch (err) {
      setActionError(err?.message || 'Gagal memuat detail permintaan material.')
    } finally {
      setLoadingDetail(false)
    }
  }

  // Reload Detail
  const reloadDetail = async (id) => {
    if (!id) return
    try {
      const res = await materialRequestsApi.get(id)
      setDetail(res?.data || null)
      loadRequests()
      return res?.data || null
    } catch {
      return null
    }
  }

  // Handle Export File
  const handleExport = async (format) => {
    if (!selectedId) return
    setExporting(true)
    setActionError('')
    try {
      if (format === 'json') {
        const res = await materialRequestsApi.export(selectedId, 'json')
        const jsonStr = JSON.stringify(res?.data || res, null, 2)
        const blob = new Blob([jsonStr], { type: 'application/json' })
        triggerFileDownload(blob, `KEBUTUHAN-MATERIAL-${detail?.idempotency_key || selectedId}.json`)
      } else {
        const { blob, filename } = await materialRequestsApi.export(selectedId, format)
        triggerFileDownload(blob, filename)
      }
      notify({
        type: 'success',
        title: 'Ekspor Berhasil',
        desc: `Kebutuhan material berhasil diekspor (${format.toUpperCase()}). Status diperbarui ke EXPORTED.`,
        tag: 'OUTBOX',
      })
      reloadDetail(selectedId)
    } catch (err) {
      setActionError(err?.message || 'Gagal mengekspor data kebutuhan material.')
    } finally {
      setExporting(false)
    }
  }

  // Handle Mark Sent
  const handleMarkSent = async (e) => {
    e.preventDefault()
    if (!selectedId || !sentReference.trim()) return
    setSubmittingSent(true)
    setActionError('')
    try {
      const res = await materialRequestsApi.markSent(selectedId, {
        reference: sentReference.trim(),
      })
      notify({
        type: 'success',
        title: 'Ditandai Diserahkan',
        desc: res?.message || 'Penyerahan material dicatat.',
        tag: 'OUTBOX',
      })
      setMarkSentModalOpen(false)
      setSentReference('')
      const fresh = await reloadDetail(selectedId)
      if (fresh?.shipments?.some((x) => x.sequence === res?.data?.sequence)) setFormSequence(res.data.sequence)
    } catch (err) {
      setActionError(err?.message || 'Gagal menandai permintaan diserahkan.')
    } finally {
      setSubmittingSent(false)
    }
  }

  // Handle Cancel
  const handleCancel = async (e) => {
    e.preventDefault()
    if (!selectedId || !cancelReason.trim()) return
    setSubmittingCancel(true)
    setActionError('')
    try {
      await materialRequestsApi.cancel(selectedId, {
        reason: cancelReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Permintaan Dibatalkan',
        desc: 'Permintaan material outbox telah dibatalkan.',
        tag: 'OUTBOX',
      })
      setCancelModalOpen(false)
      setCancelReason('')
      reloadDetail(selectedId)
    } catch (err) {
      setActionError(err?.message || 'Gagal membatalkan permintaan material.')
    } finally {
      setSubmittingCancel(false)
    }
  }

  const payload = detail?.payload || {}
  const position = detail?.position || null
  const materials = position?.materials || []
  const readyRows = materials.filter((m) => m.ready > 0)
  const poles = payload?.poles || []
  const qty = (n) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Permintaan material (Outbox)</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Paket kebutuhan material dari WO jaringan yang diterbitkan, untuk diserahkan ke aplikasi logistik material (ERP/MIMS). Ekspor, catat nomor referensinya, lalu tandai diserahkan.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={IconRefresh} loading={loading} onClick={loadRequests}>
          Segarkan
        </Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Filter Bar */}
      <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="">Semua Status</option>
                <option value="PENDING">PENDING</option>
                <option value="EXPORTED">EXPORTED</option>
                <option value="SENT">SENT</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="SUPERSEDED">SUPERSEDED</option>
              </select>
            </div>

            <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={followupFilter}
                onChange={(e) => setFollowupFilter(e.target.checked)}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="font-semibold text-rose-700 dark:text-rose-400">
                Perlu Tindak Lanjut Saja
              </span>
            </label>
          </div>

          {meta && (
            <span className="text-xs text-slate-500 font-mono">
              Total {meta.total} permintaan
            </span>
          )}
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat outbox kebutuhan material..." />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={IconTruck}
            title="Belum ada permintaan material"
            description="Permintaan material dibuat otomatis saat WO jaringan agenda ini diterbitkan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">No. SPK / WO</th>
                  <th className="py-3 px-4">No. Permohonan</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Tindak Lanjut</th>
                  <th className="py-3 px-4">Referensi Eksternal</th>
                  <th className="py-3 px-4">Tanggal Ekspor</th>
                  <th className="py-3 px-4">Tanggal Serah</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                {requests.map((r) => {
                  const isSentFollowup = r.status === 'SENT' && (r.needs_followup || r.oversent)
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors ${
                        isSentFollowup
                          ? 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                        {r.wo_number || '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                        {r.application_number || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.status === 'SENT'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : r.status === 'EXPORTED'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : r.status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {r.status}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.fulfilment === 'PARTIAL' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">Diserahkan sebagian</span>}
                          {r.fulfilment === 'COMPLETE' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Diserahkan lengkap</span>}
                          {r.ready_to_send && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">Siap serah</span>}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {r.needs_followup || r.oversent ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 animate-pulse">
                            <IconAlertCircle size={10} />
                            <span>PERLU TINDAK LANJUT</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                        {r.external_reference || '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {r.exported_at ? new Date(r.exported_at).toLocaleDateString('id-ID') : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {r.sent_at ? new Date(r.sent_at).toLocaleDateString('id-ID') : '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(r.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 transition cursor-pointer"
                        >
                          <IconEye size={12} />
                          <span>Rincian</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter
          meta={meta}
          itemCount={requests.length}
          total={meta?.total ?? requests.length}
          entityLabel="permintaan material"
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

      {/* DETAIL DRAWER */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={
          detail ? (
            <div className="flex items-center gap-2">
              <span>Kebutuhan Material: {payload?.wo_number || detail.idempotency_key}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  detail.status === 'SENT'
                    ? 'bg-emerald-100 text-emerald-800'
                    : detail.status === 'EXPORTED'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {detail.status}
              </span>
            </div>
          ) : (
            'Rincian Permintaan Material'
          )
        }
        subtitle="Rincian paket alokasi material, tiang, status penyerahan eksternal, dan riwayat peristiwa."
        width="max-w-3xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>
              Tutup
            </Button>

            {detail && canManage && detail.status !== 'CANCELLED' && detail.status !== 'SUPERSEDED' && (
              <div className="flex items-center gap-2">
                {/* Export actions */}
                <div className="inline-flex rounded-lg shadow-2xs border border-blue-300 dark:border-blue-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleExport('xlsx')}
                    disabled={exporting}
                    className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 border-r"
                  >
                    Ekspor XLSX
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('csv')}
                    disabled={exporting}
                    className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 border-r"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('json')}
                    disabled={exporting}
                    className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50"
                  >
                    JSON
                  </button>
                </div>

                {/* Mark Sent action: records a shipment of what is allocated and not yet sent */}
                <Button
                  variant="primary"
                  size="sm"
                  icon={IconCheck}
                  disabled={!position?.ready_to_send}
                  title={position?.ready_to_send ? 'Catat penyerahan material yang sudah teralokasi dan belum diserahkan' : 'Belum ada material teralokasi yang belum diserahkan'}
                  onClick={() => {
                    setMarkSentModalOpen(true)
                    setSentReference('')
                    setActionError('')
                  }}
                >
                  Tandai Diserahkan
                </Button>

                {/* Cancel action: only while nothing has been sent */}
                {(detail.shipments || []).length === 0 && detail.status !== 'SENT' && <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:bg-rose-50"
                  icon={IconX}
                  onClick={() => {
                    setCancelModalOpen(true)
                    setCancelReason('')
                    setActionError('')
                  }}
                >
                  Batalkan
                </Button>}
              </div>
            )}
          </div>
        }
      >
        {loadingDetail ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat rincian paket..." />
          </div>
        ) : !detail ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Data permintaan material tidak ditemukan.
          </div>
        ) : (
          <div className="space-y-5 text-xs">
            {actionError && <Alert kind="error">{actionError}</Alert>}

            {/* Needs followup banner */}
            {detail.needs_followup && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg flex items-start gap-2.5">
                <IconAlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-900 dark:text-rose-200">
                    Perhatian: Paket Memerlukan Tindak Lanjut
                  </p>
                  <p className="text-[11px] text-rose-800 dark:text-rose-300 mt-0.5">
                    Permintaan telah berstatus SENT tetapi terdeteksi perubahan alur atau amandemen yang mewajibkan konfirmasi ulang penyerahan fisik.
                  </p>
                </div>
              </div>
            )}

            {/* Oversent: the latest MTO needs less than was already sent */}
            {position?.oversent && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg space-y-1">
                <p className="font-bold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                  <IconAlertCircle size={15} className="text-rose-600 shrink-0" />
                  <span>Kelebihan Diserahkan</span>
                </p>
                <p className="text-[11px] text-rose-800 dark:text-rose-300">
                  Kebutuhan pada MTO terbaru lebih kecil daripada yang sudah diserahkan. Sesuaikan di aplikasi material (ERP/MIMS):
                </p>
                <ul className="text-[11px] text-rose-900 dark:text-rose-200 list-disc ml-4">
                  {materials.filter((m) => m.oversent > 0).map((m) => (
                    <li key={m.khs_item_id}>{m.name || m.khs_code}: kelebihan {qty(m.oversent)} {m.unit}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* The need follows the latest approved MTO; the WO is not amended for it */}
            {position?.package_id && position?.wo_package_id && position.package_id !== position.wo_package_id && (
              <div className="p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 rounded-lg text-[11px] text-sky-900 dark:text-sky-200">
                Kebutuhan mengikuti MTO terbaru yang disetujui. WO tidak diamandemen untuk perubahan material PLN; perubahan pekerjaan atau material vendor tetap lewat amandemen WO.
              </div>
            )}

            {/* Unmapped KHS Warning Banner */}
            {detail.unmapped_khs && detail.unmapped_khs.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg space-y-1">
                <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <IconAlertCircle size={15} className="text-amber-600 shrink-0" />
                  <span>KHS Belum Terpetakan ke Nomor Material ERP (SKU)</span>
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  Terdapat {detail.unmapped_khs.length} material PLN dalam WO ini yang belum memiliki pemetaan SKU (material vendor tidak memerlukannya):
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {detail.unmapped_khs.map((code, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-200/80 text-amber-900"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Header Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border">
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">No. SPK / WO</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{payload?.wo_number || '-'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">No. Permohonan</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{payload?.application_number || '-'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Referensi Eksternal</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{detail.external_reference || '-'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Waktu Dibuat</span>
                <span className="font-mono text-[11px] text-slate-600">{detail.created_at ? new Date(detail.created_at).toLocaleString('id-ID') : '-'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Waktu Ekspor</span>
                <span className="font-mono text-[11px] text-slate-600">{detail.exported_at ? new Date(detail.exported_at).toLocaleString('id-ID') : '-'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Waktu Serah</span>
                <span className="font-mono text-[11px] text-slate-600">{detail.sent_at ? new Date(detail.sent_at).toLocaleString('id-ID') : '-'}</span>
              </div>
            </div>

            {/* Material position: only PLN material; vendor-supplied material is not part of the request */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">
                Material PLN ({materials.length} item)
                {position && (
                  <span className="ml-2 font-normal text-[11px] text-slate-500">
                    {position.vendor_count} material vendor tidak termasuk (disediakan vendor pelaksana)
                  </span>
                )}
              </span>

              <div className="border rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 font-semibold text-[10px] text-slate-600 dark:text-slate-400 border-b">
                    <tr>
                      <th className="py-2 px-3">Kode KHS</th>
                      <th className="py-2 px-3">Uraian Material</th>
                      <th className="py-2 px-3">Satuan</th>
                      <th className="py-2 px-3">No. Material ERP (SKU)</th>
                      <th className="py-2 px-3 text-right">Kebutuhan</th>
                      <th className="py-2 px-3 text-right">Teralokasi</th>
                      <th className="py-2 px-3 text-right">Diserahkan</th>
                      <th className="py-2 px-3 text-right">Siap serah</th>
                      <th className="py-2 px-3">Gudang</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono text-[11px]">
                    {materials.length === 0 && (
                      <tr><td colSpan={10} className="py-4 px-3 text-center font-sans text-slate-400">Tidak ada material PLN pada paket ini.</td></tr>
                    )}
                    {materials.map((m) => (
                      <tr key={m.khs_item_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">{m.khs_code}</td>
                        <td className="py-2 px-3 font-sans text-slate-700 dark:text-slate-300">{m.name || '-'}</td>
                        <td className="py-2 px-3 text-slate-500 font-sans">{m.unit}</td>
                        <td className="py-2 px-3">
                          {m.skus && m.skus.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {m.skus.map((sku, sIdx) => (
                                <span key={sIdx} className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">{sku}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-amber-700 font-sans text-[10px] italic">Belum terpetakan</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-bold">{qty(m.need)}</td>
                        <td className="py-2 px-3 text-right">{qty(m.allocated)}</td>
                        <td className="py-2 px-3 text-right">{qty(m.shipped)}</td>
                        <td className={`py-2 px-3 text-right font-bold ${m.ready > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-slate-400'}`}>{qty(m.ready)}</td>
                        <td className="py-2 px-3 font-sans text-slate-600">
                          {m.allocation?.length > 0
                            ? (
                              <ul className="space-y-0.5">
                                {m.allocation.map((a) => (
                                  <li key={a.warehouse_id} className="text-[11px]">{a.warehouse}<span className="font-mono text-slate-500"> × {qty(a.allocated)}</span></li>
                                ))}
                              </ul>
                            )
                            : '-'}
                        </td>
                        <td className="py-2 px-3 font-sans">
                          {m.status === 'SENT' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">Diserahkan</span>}
                          {m.status === 'READY' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">Siap serah</span>}
                          {m.status === 'READY' && m.waiting > 0 && <div className="text-[10px] text-amber-700 mt-0.5">+ menunggu {qty(m.waiting)}</div>}
                          {m.status === 'WAITING' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">{m.waiting > 0 ? `Menunggu ${qty(m.waiting)}` : 'Menunggu'}</span>}
                          {m.status === 'OVERSENT' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">Kelebihan</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Shipment history */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">Riwayat Penyerahan ({(detail.shipments || []).length})</span>
              {(detail.shipments || []).length === 0 ? (
                <p className="text-slate-400 italic">Belum ada penyerahan. Tiap &quot;Tandai Diserahkan&quot; mencatat satu penyerahan: material teralokasi yang belum pernah diserahkan.</p>
              ) : (
                <div className="divide-y border rounded-xl overflow-hidden">
                  {detail.shipments.map((sh) => (
                    <details key={sh.sequence} className="bg-white dark:bg-slate-900">
                      <summary className="p-3 cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-bold text-slate-800 dark:text-slate-200">Penyerahan ke-{sh.sequence}</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">{sh.reference}</span>
                        <span className="text-[11px] text-slate-500">{sh.sent_at ? new Date(sh.sent_at).toLocaleString('id-ID') : '-'} · {sh.sent_by_name} · {sh.lines.length} baris</span>
                      </summary>
                      <ul className="px-4 pb-3 divide-y divide-slate-100 dark:divide-slate-800">
                        {sh.lines.map((l, i) => (
                          <li key={i} className="py-1.5 flex items-center justify-between gap-3 text-[11px]">
                            <span className="text-slate-800 dark:text-slate-200">{l.name || l.khs_code}<span className="text-slate-400"> · {l.warehouse}</span></span>
                            <span className="font-mono whitespace-nowrap">{qty(l.quantity)} {l.unit}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="px-4 pb-3">
                        <Button size="sm" variant="secondary" onClick={() => setFormSequence(sh.sequence)}>
                          <IconFileText className="w-3.5 h-3.5 mr-1" />
                          Cetak Form Penyerahan (TUG 7)
                        </Button>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {/* Poles Section (if any) */}
            {poles.length > 0 && (
              <div className="space-y-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">
                  Tiang Beton & Kontrak Rinci ({poles.length} item)
                </span>
                <div className="border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800 font-semibold text-[10px] text-slate-600 border-b">
                      <tr>
                        <th className="py-2 px-3">No. Kontrak Rinci (KR)</th>
                        <th className="py-2 px-3">Tegangan (TM/TR)</th>
                        <th className="py-2 px-3 text-right">Volume</th>
                        <th className="py-2 px-3">Pemasok</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono text-[11px]">
                      {poles.map((p, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-bold">{p.contract_number || p.kr_number}</td>
                          <td className="py-2 px-3">{p.kind || p.voltage}</td>
                          <td className="py-2 px-3 text-right">{p.qty || p.volume}</td>
                          <td className="py-2 px-3 font-sans text-slate-600">{p.vendor_name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Audit Events Timeline */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">
                Riwayat Peristiwa & Audit Trail
              </span>
              <div className="divide-y border rounded-xl overflow-hidden">
                {(detail.events || []).map((e, idx) => (
                  <div key={idx} className="p-3 text-xs flex items-start justify-between gap-3 bg-white dark:bg-slate-900">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {e.event_type}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {e.occurred_at ? new Date(e.occurred_at).toLocaleString('id-ID') : '-'}
                        </span>
                      </div>
                      {e.reason && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                          Alasan: {e.reason}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {e.actor_name || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* DRAWER: Tandai Diserahkan */}
      <Modal
        open={markSentModalOpen}
        title="Tandai Permintaan Material Diserahkan"
        onClose={() => setMarkSentModalOpen(false)}
        size="max-w-md"
      >
        <form onSubmit={handleMarkSent} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Yang dicatat diserahkan hanya material PLN yang sudah teralokasi dan belum pernah diserahkan. Masukkan nomor Perintah Penyerahan Barang (TUG 7) atau nomor transaksi aplikasi material logistik MIMS untuk penyerahan ini. Setelah disimpan, form TUG 7 siap dicetak atau disimpan sebagai PDF.
          </p>

          <div className="border rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto" aria-label="Isi penyerahan">
            {readyRows.map((m) => (
              <div key={m.khs_item_id} className="px-3 py-1.5 flex items-center justify-between gap-3">
                <span className="text-slate-800 dark:text-slate-200">{m.name || m.khs_code}</span>
                <span className="font-mono whitespace-nowrap">{qty(m.ready)} {m.unit}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{readyRows.length} material akan dicatat sebagai penyerahan ke-{(detail?.shipments || []).length + 1}.</p>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nomor Referensi Eksternal (Wajib) *
            </label>
            <input
              type="text"
              required
              value={sentReference}
              onChange={(e) => setSentReference(e.target.value)}
              placeholder="Contoh: ND-LOG-2026/XI/0091 atau MIMS-GI-981273"
              className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMarkSentModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submittingSent}
              disabled={!sentReference.trim()}
            >
              Simpan & Tandai Diserahkan
            </Button>
          </div>
        </form>
      </Modal>

      {/* DRAWER: Batalkan Permintaan */}
      <Modal
        open={cancelModalOpen}
        title="Batalkan Permintaan Material"
        onClose={() => setCancelModalOpen(false)}
        size="max-w-md"
      >
        <form onSubmit={handleCancel} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Permintaan kebutuhan material yang dibatalkan tidak dapat dikirim ulang kecuali melalui amandemen SPK/WO baru. Masukkan alasan audit trail.
          </p>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Alasan Pembatalan (Wajib) *
            </label>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Jelaskan alasan pembatalan permintaan material ini..."
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
              variant="danger"
              size="sm"
              loading={submittingCancel}
              disabled={!cancelReason.trim()}
            >
              Batalkan Permintaan
            </Button>
          </div>
        </form>
      </Modal>

      {formSequence != null && detail?.handover_form && detail.shipments?.find((x) => x.sequence === formSequence) && (
        <HandoverForm form={detail.handover_form} shipment={detail.shipments.find((x) => x.sequence === formSequence)} onClose={() => setFormSequence(null)} />
      )}
    </div>
  )
}
