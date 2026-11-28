import { useCallback, useEffect, useState } from 'react'
import { srReservationsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import {
  IconCheck,
  IconX,
  IconRefresh,
  IconAlertCircle,
  IconCheckCircle,
  IconClock,
  IconBuilding,
} from '../../components/icons.jsx'

const STATUS_META = {
  DRAFT: { label: 'Draf', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  SUBMITTED: { label: 'Diajukan', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800' },
  APPROVED: { label: 'Disetujui (Stok Ditahan)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' },
  RECORDED: { label: 'Tercatat di MIMS', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800' },
  CANCELLED: { label: 'Dibatalkan', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800' },
}

export function SrStatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status || '-', cls: STATUS_META.DRAFT.cls }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  )
}

const fmtDateTime = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

const fmtNum = (n) => {
  if (n === null || n === undefined || n === '') return '-'
  const v = Number(n)
  return Number.isNaN(v) ? String(n) : v.toLocaleString('id-ID', { maximumFractionDigits: 3 })
}

export default function SrReservationDetailDrawer({ open, reservationId, onClose, onUpdated }) {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)

  // Editable draft state
  const [srLength, setSrLength] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [edits, setEdits] = useState({}) // { [khs_code]: { quantity, reason } }
  const [vendors, setVendors] = useState([])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [approving, setApproving] = useState(false)

  // MIMS number form
  const [mimsNo, setMimsNo] = useState('')
  const [recordingMims, setRecordingMims] = useState(false)

  // Dialogs
  const [returnOpen, setReturnOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [dialogBusy, setDialogBusy] = useState(false)

  const load = useCallback(async () => {
    if (!open || !reservationId) return
    setLoading(true)
    setError('')
    try {
      const res = await srReservationsApi.get(reservationId)
      const d = res?.data || null
      setDetail(d)
      if (d) {
        setSrLength(d.sr_length_m != null ? String(d.sr_length_m) : '35')
        setVendorId(d.vendor?.id || '')
        setNotes(d.notes || '')
        setMimsNo(d.mims_reservation_no || '')
        const nextEdits = {}
        ;(d.lines || []).forEach((ln) => {
          nextEdits[ln.khs_code] = {
            quantity: ln.quantity != null ? String(ln.quantity) : '0',
            reason: ln.correction_reason || '',
          }
        })
        setEdits(nextEdits)
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat rincian reservasi material SR.')
    } finally {
      setLoading(false)
    }
  }, [open, reservationId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!open || !detail || detail.phase !== 3 || detail.status !== 'DRAFT') return
    vendorsApi.list({ status: 'ACTIVE', per_page: 200 })
      .then((res) => {
        const rows = (res?.data || []).filter((v) => !v.scope || ['JARINGAN', 'NETWORK', 'BOTH', 'KEDUANYA'].includes(String(v.scope).toUpperCase()))
        setVendors(rows)
      })
      .catch(() => setVendors([]))
  }, [open, detail?.phase, detail?.status])

  const isUlpSource = detail?.source_level === 'ULP'
  const canPrepare = Boolean(
    isSysAdmin || (isUlpSource ? can?.['sr_reservations.prepare_ulp'] : can?.['sr_reservations.prepare_up3']),
  )
  const canApprove = Boolean(
    isSysAdmin || (isUlpSource ? can?.['sr_reservations.approve_ulp'] : can?.['sr_reservations.approve_up3']),
  )
  const canRecordOrCancel = Boolean(
    isSysAdmin ||
      (isUlpSource
        ? can?.['sr_reservations.prepare_ulp'] || can?.['sr_reservations.approve_ulp']
        : can?.['sr_reservations.prepare_up3'] || can?.['sr_reservations.approve_up3']),
  )

  const handleSaveDraft = async (e) => {
    e?.preventDefault?.()
    if (!detail) return
    const corrections = []
    for (const ln of detail.lines || []) {
      const ed = edits[ln.khs_code]
      if (!ed) continue
      const qtyNum = Number(ed.quantity)
      if (Number.isNaN(qtyNum) || qtyNum < 0) {
        notify({ type: 'error', title: 'Jumlah tidak valid', desc: `Jumlah untuk ${ln.khs_code} harus angka >= 0.`, tag: 'Reservasi SR' })
        return
      }
      const origQty = Number(ln.quantity ?? 0)
      const bomQty = Number(ln.quantity_bom ?? 0)
      const changedFromOrig = qtyNum !== origQty || (ed.reason || '').trim() !== (ln.correction_reason || '').trim()
      if (changedFromOrig) {
        if (qtyNum !== bomQty && !(ed.reason || '').trim()) {
          notify({
            type: 'error',
            title: 'Alasan koreksi wajib diisi',
            desc: `Jumlah ${ln.khs_code} berbeda dari hasil BOM (${fmtNum(bomQty)}); wajib menyertakan alasan koreksi.`,
            tag: 'Reservasi SR',
          })
          return
        }
        corrections.push({
          khs_code: ln.khs_code,
          quantity: qtyNum,
          reason: (ed.reason || '').trim() || undefined,
        })
      }
    }

    setSaving(true)
    try {
      const body = {
        notes: notes.trim(),
      }
      if (srLength !== '' && Number(srLength) !== Number(detail.sr_length_m)) {
        body.sr_length_m = Number(srLength)
      }
      if (detail.phase === 3 && vendorId && vendorId !== detail.vendor?.id) {
        body.vendor_company_id = vendorId
      }
      if (corrections.length > 0) {
        body.corrections = corrections
      }
      await srReservationsApi.update(detail.id, body)
      notify({ type: 'success', title: 'Perubahan tersimpan', desc: 'Draf rencana reservasi SR diperbarui.', tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan perubahan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!detail) return
    setSubmitting(true)
    try {
      await srReservationsApi.submit(detail.id)
      notify({ type: 'success', title: 'Rencana diajukan', desc: 'Menunggu persetujuan penahanan stok.', tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mengajukan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async () => {
    if (!detail) return
    setApproving(true)
    try {
      await srReservationsApi.decide(detail.id, { decision: 'APPROVE' })
      notify({ type: 'success', title: 'Rencana disetujui', desc: 'Stok material kini ditahan; silakan input reservasi ke MIMS dan catat nomornya.', tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyetujui', desc: err?.message || 'Stok tidak mencukupi atau aturan tidak terpenuhi.', tag: 'Reservasi SR' })
    } finally {
      setApproving(false)
    }
  }

  const handleReturn = async (reason) => {
    if (!detail) return
    setDialogBusy(true)
    try {
      await srReservationsApi.decide(detail.id, { decision: 'RETURN', reason })
      notify({ type: 'warning', title: 'Rencana dikembalikan', desc: 'Rencana kembali ke status Draf untuk diperbaiki.', tag: 'Reservasi SR' })
      setReturnOpen(false)
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mengembalikan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setDialogBusy(false)
    }
  }

  const handleRecordMims = async (e) => {
    e?.preventDefault?.()
    if (!detail || !mimsNo.trim()) return
    setRecordingMims(true)
    try {
      await srReservationsApi.recordMims(detail.id, { reservation_no: mimsNo.trim() })
      notify({ type: 'success', title: 'Nomor MIMS dicatat', desc: `Nomor reservasi MIMS ${mimsNo.trim()} berhasil disimpan.`, tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mencatat nomor MIMS', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setRecordingMims(false)
    }
  }

  const handleCancel = async (reason) => {
    if (!detail) return
    setDialogBusy(true)
    try {
      await srReservationsApi.cancel(detail.id, { reason })
      notify({ type: 'warning', title: 'Rencana dibatalkan', desc: 'Stok yang ditahan (bila ada) dilepas kembali.', tag: 'Reservasi SR' })
      setCancelOpen(false)
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal membatalkan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setDialogBusy(false)
    }
  }

  return (
    <PanelShell
      open={open}
      onClose={onClose}
      title={detail ? `Reservasi SR #${detail.version_number || 1}` : 'Rincian Reservasi SR'}
      subtitle={detail?.application ? `${detail.application.number || ''} · ${detail.application.customer_name || ''}` : ''}
      size="xl"
    >
      {loading ? (
        <div className="py-16 flex justify-center">
          <Spinner label="Memuat rincian reservasi SR..." />
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : !detail ? (
        <Alert variant="info">Data reservasi tidak ditemukan.</Alert>
      ) : (
        <div className="space-y-5">
          {/* Status & Meta Header */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <SrStatusBadge status={detail.status} />
                <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  {detail.phase} Phasa · {fmtNum(detail.power_va)} VA
                </span>
                <span className="rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                  Gudang {detail.source_level}
                </span>
                {detail.bom_group && (
                  <span className="font-mono text-[11px] text-slate-500">BOM: {detail.bom_group}</span>
                )}
              </div>
              <Button size="sm" variant="secondary" icon={IconRefresh} onClick={load}>
                Segarkan
              </Button>
            </div>

            {detail.cancel_reason && (
              <Alert variant="error">
                <strong>Alasan pembatalan:</strong> {detail.cancel_reason}
              </Alert>
            )}

            {/* Info untuk Input ke MIMS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Permohonan & Agenda</span>
                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{detail.application?.customer_name || '-'}</p>
                <p className="font-mono text-[11px] text-slate-500">No: {detail.application?.number || '-'}</p>
                {detail.application?.agenda_number && (
                  <p className="font-mono text-[11px] text-slate-500">Agenda: {detail.application.agenda_number}</p>
                )}
                <p className="text-[11px] text-slate-500 mt-0.5">{detail.unit?.code} - {detail.unit?.name}</p>
              </div>

              <div className="rounded-xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-3">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  <IconBuilding className="h-3.5 w-3.5" /> Info Gudang untuk Input MIMS
                </div>
                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{detail.warehouse?.name || '-'}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[11px]">
                  <span className="rounded bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 font-semibold text-blue-800 dark:text-blue-200">
                    Plant: {detail.warehouse?.plant || '-'}
                  </span>
                  <span className="rounded bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 font-semibold text-blue-800 dark:text-blue-200">
                    SLoc: {detail.warehouse?.stor_loc || '-'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pelaksana & Nomor MIMS</span>
                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{detail.vendor?.name || '-'}</p>
                {detail.vendor?.contract_number && (
                  <p className="font-mono text-[11px] text-slate-500">Kontrak: {detail.vendor.contract_number}</p>
                )}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">No. MIMS:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                    {detail.mims_reservation_no || '-'}
                  </span>
                  {detail.mims_found_in_mirror && (
                    <span className="rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold">
                      Terverifikasi MIMS
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Form Draft / Material Lines */}
          <form onSubmit={handleSaveDraft} className="space-y-4">
            {detail.status === 'DRAFT' && canPrepare && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="sr-edit-length" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Panjang Kabel SR (m)
                  </label>
                  <input
                    id="sr-edit-length"
                    type="number"
                    step="0.1"
                    min="1"
                    value={srLength}
                    onChange={(e) => setSrLength(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus-ring"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">Mengubah panjang akan memperbarui baris kabel SR.</p>
                </div>

                {detail.phase === 3 && (
                  <div>
                    <label htmlFor="sr-edit-vendor" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Pelaksana 3 Phasa
                    </label>
                    <select
                      id="sr-edit-vendor"
                      value={vendorId}
                      onChange={(e) => setVendorId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus-ring"
                    >
                      <option value="">Pilih pelaksana…</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.code ? `${v.code} - ` : ''}{v.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={detail.phase === 3 ? '' : 'sm:col-span-2'}>
                  <label htmlFor="sr-edit-notes" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Catatan
                  </label>
                  <input
                    id="sr-edit-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Catatan opsional…"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus-ring"
                  />
                </div>
              </div>
            )}

            {/* Tabel Baris Material */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Daftar Material PLN (BOM APP)</h4>
                  <p className="text-[11px] text-slate-500">Nomor material ERP, plant, dan storage location dipakai untuk input manual ke MIMS.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500">{(detail.lines || []).length} item</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2">KHS &amp; Material</th>
                      <th className="px-3 py-2">Nomor Material ERP</th>
                      <th className="px-3 py-2 text-right">Qty BOM</th>
                      <th className="px-3 py-2 text-right">Qty Rencana</th>
                      <th className="px-3 py-2">Alasan Koreksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(detail.lines || []).map((ln) => {
                      const ed = edits[ln.khs_code] || { quantity: String(ln.quantity ?? 0), reason: ln.correction_reason || '' }
                      const isDraftEditable = detail.status === 'DRAFT' && canPrepare
                      const differsFromBom = Number(ed.quantity) !== Number(ln.quantity_bom ?? 0)
                      return (
                        <tr key={ln.khs_code} className="align-top">
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{ln.khs_name || ln.khs_code}</div>
                            <div className="font-mono text-[10px] text-slate-400">{ln.khs_code} · {ln.unit_text || '-'}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            {Array.isArray(ln.material_numbers) && ln.material_numbers.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ln.material_numbers.map((num) => (
                                  <span key={num} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                    {num}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                            {fmtNum(ln.quantity_bom)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {isDraftEditable ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Jumlah ${ln.khs_code}`}
                                value={ed.quantity}
                                onChange={(e) =>
                                  setEdits((prev) => ({ ...prev, [ln.khs_code]: { ...ed, quantity: e.target.value } }))
                                }
                                className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring"
                              />
                            ) : (
                              <span className="font-bold text-slate-900 dark:text-slate-100">{fmtNum(ln.quantity)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {isDraftEditable ? (
                              <input
                                type="text"
                                aria-label={`Alasan koreksi ${ln.khs_code}`}
                                value={ed.reason}
                                onChange={(e) =>
                                  setEdits((prev) => ({ ...prev, [ln.khs_code]: { ...ed, reason: e.target.value } }))
                                }
                                placeholder={differsFromBom ? 'Wajib diisi karena beda dari BOM' : 'Opsional'}
                                className={`w-full min-w-40 rounded-lg border px-2 py-1 text-xs focus-ring ${
                                  differsFromBom && !ed.reason.trim()
                                    ? 'border-amber-400 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20'
                                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
                                }`}
                              />
                            ) : (
                              <span className="text-slate-600 dark:text-slate-400">{ln.correction_reason || '-'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {detail.status === 'DRAFT' && canPrepare && (
                  <>
                    <Button type="submit" variant="secondary" loading={saving}>
                      Simpan Perubahan
                    </Button>
                    <Button type="button" variant="primary" icon={IconCheck} loading={submitting} onClick={handleSubmit}>
                      Ajukan Reservasi
                    </Button>
                  </>
                )}

                {detail.status === 'SUBMITTED' && canApprove && (
                  <>
                    <Button type="button" variant="primary" icon={IconCheckCircle} loading={approving} onClick={handleApprove}>
                      Setujui &amp; Tahan Stok
                    </Button>
                    <Button type="button" variant="secondary" icon={IconAlertCircle} onClick={() => setReturnOpen(true)}>
                      Kembalikan ke Draf
                    </Button>
                  </>
                )}
              </div>

              {detail.status !== 'CANCELLED' && canRecordOrCancel && (
                <Button type="button" variant="danger" icon={IconX} onClick={() => setCancelOpen(true)}>
                  Batalkan Rencana
                </Button>
              )}
            </div>
          </form>

          {/* Catat / Koreksi Nomor Reservasi MIMS */}
          {['APPROVED', 'RECORDED'].includes(detail.status) && canRecordOrCancel && (
            <form onSubmit={handleRecordMims} className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-2.5">
              <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                Catat / Koreksi Nomor Reservasi MIMS (Input Manual)
              </div>
              <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                Setelah membuat reservasi di aplikasi MIMS menggunakan nomor material ERP, Plant, dan SLoc di atas, catat nomor reservasinya di sini. Satu nomor boleh dipakai beberapa agenda.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="Nomor reservasi MIMS"
                  value={mimsNo}
                  onChange={(e) => setMimsNo(e.target.value)}
                  placeholder="Masukkan nomor reservasi MIMS…"
                  className="flex-1 min-w-56 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus-ring"
                />
                <Button type="submit" variant="primary" loading={recordingMims} disabled={!mimsNo.trim()}>
                  Simpan Nomor MIMS
                </Button>
              </div>
            </form>
          )}

          {/* Riwayat Kejadian */}
          {Array.isArray(detail.events) && detail.events.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <IconClock className="h-3.5 w-3.5" /> Riwayat Kejadian
              </h4>
              <ol className="space-y-2 text-xs">
                {detail.events.map((ev, idx) => (
                  <li key={idx} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-2 last:pb-0">
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{ev.type}</span>
                      {ev.actor && <span className="text-slate-500"> · oleh {typeof ev.actor === 'string' ? ev.actor : ev.actor.name}</span>}
                      {ev.reason && <p className="text-slate-600 dark:text-slate-400 mt-0.5">Alasan: {ev.reason}</p>}
                    </div>
                    <span className="text-[11px] text-slate-400">{fmtDateTime(ev.occurred_at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <ReasonDialog
        open={returnOpen}
        title="Kembalikan Rencana Reservasi?"
        description="Rencana akan dikembalikan ke status Draf agar penyusun dapat memperbaiki jumlah atau pelaksana."
        confirmLabel="Kembalikan"
        variant="warning"
        loading={dialogBusy}
        onClose={() => setReturnOpen(false)}
        onConfirm={handleReturn}
      />

      <ReasonDialog
        open={cancelOpen}
        title="Batalkan Rencana Reservasi SR?"
        description="Rencana ini akan dibatalkan dan penahanan stok (bila ada) dilepas kembali. Alasan pembatalan wajib diisi."
        confirmLabel="Batalkan Rencana"
        variant="danger"
        loading={dialogBusy}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancel}
      />
    </PanelShell>
  )
}
