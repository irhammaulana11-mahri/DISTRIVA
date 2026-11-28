import { useCallback, useEffect, useMemo, useState } from 'react'
import { srReservationsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import {
  IconX,
  IconRefresh,
  IconAlertCircle,
  IconClock,
  IconBuilding,
  IconSend,
  IconTrash,
  IconCheck,
} from '../../components/icons.jsx'

const STATUS_META = {
  DRAFT: { label: 'Draf', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  REQUESTED: { label: 'Dimohonkan MIMS (Stok Ditahan)', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800' },
  SAP_SENT: { label: 'Terkirim ke SAP', cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800' },
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

  // Editable draft / requested total state
  const [srLength, setSrLength] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [edits, setEdits] = useState({}) // { [khs_code]: { quantity, reason } }
  const [materialEdits, setMaterialEdits] = useState({}) // { [khs_code]: { [material_no]: quantityStr } }
  const [vendors, setVendors] = useState([])
  const [saving, setSaving] = useState(false)

  // MIMS request number form (DRAFT -> REQUESTED, or edit during REQUESTED)
  const [mimsNo, setMimsNo] = useState('')
  const [requestingMims, setRequestingMims] = useState(false)

  // Realization per Agenda: { [appId]: { cable_m, sealsText, serials: { [khs_code]: { serial_number, material_no } } } }
  const [agendaInputs, setAgendaInputs] = useState({})
  const [savingRealization, setSavingRealization] = useState(false)
  const [matching, setMatching] = useState(false)
  const [sapRef, setSapRef] = useState('')
  const [sapConfirmOpen, setSapConfirmOpen] = useState(false)
  const [sendingSap, setSendingSap] = useState(false)

  // Dialogs
  const [removeTarget, setRemoveTarget] = useState(null) // { application_id, label }
  const [cancelOpen, setCancelOpen] = useState(false)
  const [dialogBusy, setDialogBusy] = useState(false)

  const applications = useMemo(() => detail?.applications || [], [detail])
  const activeApplications = useMemo(
    () => applications.filter((a) => !a.released_at),
    [applications],
  )

  const linesByCode = useMemo(
    () => Object.fromEntries((detail?.lines || []).map((l) => [l.khs_code, l])),
    [detail],
  )

  const serialKhsCodes = useMemo(() => {
    const kwh = Array.isArray(detail?.serial_codes?.kwh) ? detail.serial_codes.kwh : []
    const mcb = Array.isArray(detail?.serial_codes?.mcb) ? detail.serial_codes.mcb : []
    const list = []
    kwh.forEach((code) => list.push({ khs_code: code, group: 'kWh Meter', label: linesByCode[code]?.khs_name || code }))
    mcb.forEach((code) => list.push({ khs_code: code, group: 'MCB / MCCB', label: linesByCode[code]?.khs_name || code }))
    return list
  }, [detail, linesByCode])

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
        setSapRef(d.sap_reference || '')

        const nextEdits = {}
        const nextMatEdits = {}
        ;(d.lines || []).forEach((ln) => {
          nextEdits[ln.khs_code] = {
            quantity: ln.quantity != null ? String(ln.quantity) : '0',
            reason: ln.correction_reason || '',
          }
          const matMap = {}
          const opts = ln.material_options || []
          if (Array.isArray(ln.materials) && ln.materials.length > 0) {
            ln.materials.forEach((m) => {
              if (m?.material_no) matMap[m.material_no] = m.quantity != null ? String(m.quantity) : '0'
            })
          } else if (opts.length === 1 && opts[0]?.material_no) {
            matMap[opts[0].material_no] = ln.quantity != null ? String(ln.quantity) : '0'
          }
          nextMatEdits[ln.khs_code] = matMap
        })
        setEdits(nextEdits)
        setMaterialEdits(nextMatEdits)

        const nextInputs = {}
        ;(d.applications || []).forEach((ag) => {
          const serialMap = {}
          ;(ag.serials || []).forEach((s) => {
            if (s?.khs_code) {
              serialMap[s.khs_code] = {
                serial_number: s.serial_number || '',
                material_no: s.material_no || '',
              }
            }
          })
          nextInputs[ag.application_id] = {
            cable_m: ag.cable_m != null ? String(ag.cable_m) : (d.sr_length_m != null ? String(d.sr_length_m) : '35'),
            sealsText: Array.isArray(ag.seals) ? ag.seals.join(', ') : '',
            serials: serialMap,
          }
        })
        setAgendaInputs(nextInputs)
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
  const canOperate = Boolean(
    isSysAdmin || (isUlpSource ? can?.['sr_reservations.prepare_ulp'] : can?.['sr_reservations.prepare_up3']),
  )
  const canEditLines = Boolean(canOperate && ['DRAFT', 'REQUESTED'].includes(detail?.status))

  const handleSaveTotals = async (e) => {
    e?.preventDefault?.()
    if (!detail) return
    const corrections = []
    const materialsPayload = []

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

      const opts = ln.material_options || []
      if (opts.length === 1 && opts[0]?.material_no) {
        materialsPayload.push({
          khs_code: ln.khs_code,
          items: [{ material_no: opts[0].material_no, quantity: qtyNum }],
        })
      } else if (opts.length > 1) {
        const matMap = materialEdits[ln.khs_code] || {}
        const items = opts
          .map((o) => ({ material_no: o.material_no, quantity: Number(matMap[o.material_no] || 0) }))
          .filter((it) => !Number.isNaN(it.quantity) && it.quantity > 0)
        if (items.length > 0) {
          const sumMat = items.reduce((s, it) => s + it.quantity, 0)
          if (Math.abs(sumMat - qtyNum) > 1e-6) {
            notify({
              type: 'error',
              title: 'Jumlah nomor material belum cocok',
              desc: `Total pilihan nomor material untuk ${ln.khs_code} (${fmtNum(sumMat)}) harus sama dengan total baris (${fmtNum(qtyNum)}).`,
              tag: 'Reservasi SR',
            })
            return
          }
          materialsPayload.push({ khs_code: ln.khs_code, items })
        }
      }
    }

    setSaving(true)
    try {
      const body = { notes: notes.trim() }
      if (detail.status === 'DRAFT') {
        if (srLength !== '' && Number(srLength) !== Number(detail.sr_length_m)) {
          body.sr_length_m = Number(srLength)
        }
        if (detail.phase === 3 && vendorId && vendorId !== detail.vendor?.id) {
          body.vendor_company_id = vendorId
        }
      }
      if (corrections.length > 0) {
        body.corrections = corrections
      }
      if (materialsPayload.length > 0) {
        body.materials = materialsPayload
      }
      await srReservationsApi.update(detail.id, body)
      notify({ type: 'success', title: 'Perubahan tersimpan', desc: 'Total material, pilihan nomor material SAP, dan catatan diperbarui.', tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan perubahan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setSaving(false)
    }
  }

  const handleRequestMims = async (e) => {
    e?.preventDefault?.()
    if (!detail || !mimsNo.trim()) return
    setRequestingMims(true)
    try {
      await srReservationsApi.requestMims(detail.id, { reservation_no: mimsNo.trim() })
      notify({
        type: 'success',
        title: 'Nomor permohonan MIMS dicatat',
        desc: `Nomor ${mimsNo.trim()} disimpan dan stok material kini ditahan.`,
        tag: 'Reservasi SR',
      })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mencatat nomor MIMS', desc: err?.message || 'Stok tidak mencukupi atau pilihan nomor material belum lengkap.', tag: 'Reservasi SR' })
    } finally {
      setRequestingMims(false)
    }
  }

  const handleSaveRealization = async (e) => {
    e?.preventDefault?.()
    if (!detail) return
    const items = activeApplications.map((ag) => {
      const entry = agendaInputs[ag.application_id] || { cable_m: '35', sealsText: '', serials: {} }
      const seals = (entry.sealsText || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const serials = Object.entries(entry.serials || {})
        .filter(([, val]) => String(val?.serial_number || '').trim() !== '')
        .map(([khs_code, val]) => {
          const activeMats = (linesByCode[khs_code]?.materials || []).filter((m) => Number(m.quantity) > 0)
          const matNo = (val?.material_no || '').trim() || (activeMats.length === 1 ? activeMats[0].material_no : '')
          return {
            khs_code,
            serial_number: String(val.serial_number).trim(),
            ...(matNo ? { material_no: matNo } : {}),
          }
        })
      return {
        application_id: ag.application_id,
        ...(entry.cable_m !== '' ? { cable_m: Number(entry.cable_m) } : {}),
        seals,
        serials,
      }
    })

    setSavingRealization(true)
    try {
      await srReservationsApi.saveRealization(detail.id, { items })
      notify({ type: 'success', title: 'Realisasi tersimpan', desc: 'Nomor seri, panjang kabel, dan nomor segel per agenda berhasil disimpan.', tag: 'Reservasi SR' })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan realisasi', desc: err?.message || 'Periksa duplikasi nomor seri atau segel.', tag: 'Reservasi SR' })
    } finally {
      setSavingRealization(false)
    }
  }

  const handleMatchTotals = async () => {
    if (!detail) return
    setMatching(true)
    try {
      await srReservationsApi.match(detail.id)
      notify({
        type: 'success',
        title: 'Total disamakan dengan realisasi',
        desc: 'Total kabel, material bernomor seri, dan segel kini sesuai realisasi. Pastikan MIMS juga disesuaikan.',
        tag: 'Reservasi SR',
      })
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyamakan total', desc: err?.message || 'Stok tidak mencukupi atau aturan tidak terpenuhi.', tag: 'Reservasi SR' })
    } finally {
      setMatching(false)
    }
  }

  const handleSendSap = async () => {
    if (!detail) return
    setSendingSap(true)
    try {
      await srReservationsApi.sendSap(detail.id, sapRef.trim() ? { sap_reference: sapRef.trim() } : {})
      notify({ type: 'success', title: 'Terkirim ke SAP', desc: 'Reservasi kolektif SR telah ditandai terkirim ke SAP.', tag: 'Reservasi SR' })
      setSapConfirmOpen(false)
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Kirim SAP', desc: err?.message || 'Pastikan tidak ada penghalang SAP tersisa.', tag: 'Reservasi SR' })
    } finally {
      setSendingSap(false)
    }
  }

  const handleRemoveAgenda = async (reason) => {
    if (!detail || !removeTarget) return
    setDialogBusy(true)
    try {
      await srReservationsApi.removeApplication(detail.id, removeTarget.application_id, { reason })
      notify({ type: 'warning', title: 'Agenda dikeluarkan', desc: `${removeTarget.label} dikeluarkan dari reservasi.`, tag: 'Reservasi SR' })
      setRemoveTarget(null)
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mengeluarkan agenda', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setDialogBusy(false)
    }
  }

  const handleCancel = async (reason) => {
    if (!detail) return
    setDialogBusy(true)
    try {
      await srReservationsApi.cancel(detail.id, { reason })
      notify({ type: 'warning', title: 'Reservasi dibatalkan', desc: 'Stok yang ditahan (bila ada) dilepas kembali.', tag: 'Reservasi SR' })
      setCancelOpen(false)
      await load()
      onUpdated?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal membatalkan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setDialogBusy(false)
    }
  }

  const materialBlockers = detail?.material_blockers || []
  const sapBlockers = detail?.sap_blockers || []

  return (
    <PanelShell
      open={open}
      onClose={onClose}
      title={detail ? `Reservasi Kolektif SR (${detail.applications_count ?? activeApplications.length} Agenda)` : 'Rincian Reservasi SR'}
      subtitle={detail?.unit ? `${detail.unit.code || ''} ${detail.unit.name || ''} · ${detail.phase} Phasa` : ''}
      size="max-w-5xl"
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
                  {detail.phase} Phasa
                </span>
                <span className="rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                  Gudang {detail.source_level}
                </span>
                <span className="rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                  {activeApplications.length} Agenda Aktif
                </span>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unit &amp; Kabel Bawaan</span>
                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{detail.unit?.code} - {detail.unit?.name}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Kabel SR bawaan: {detail.sr_length_m ?? 35} m / agenda</p>
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
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pelaksana &amp; Nomor MIMS</span>
                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{detail.vendor?.name || '-'}</p>
                {detail.vendor?.contract_number && (
                  <p className="font-mono text-[11px] text-slate-500">Kontrak: {detail.vendor.contract_number}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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

          {materialBlockers.length > 0 && (
            <Alert variant="warning">
              <div className="space-y-1 text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <IconAlertCircle className="h-4 w-4 shrink-0" />
                  Pilihan Nomor Material SAP Belum Lengkap:
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {materialBlockers.map((b, idx) => <li key={idx}>{b}</li>)}
                </ul>
              </div>
            </Alert>
          )}

          {/* Langkah 1: Total Material PLN (BOM) & Pilihan Nomor Material SAP */}
          <form onSubmit={handleSaveTotals} className="space-y-4">
            {canEditLines && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {detail.status === 'DRAFT' && (
                  <div>
                    <label htmlFor="sr-edit-length" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Panjang Kabel SR Bawaan (m)
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
                  </div>
                )}

                {detail.status === 'DRAFT' && detail.phase === 3 && (
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

                <div className={detail.status === 'DRAFT' ? (detail.phase === 3 ? '' : 'sm:col-span-2') : 'sm:col-span-3'}>
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

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Total Material PLN (BOM Kolektif)</h4>
                  <p className="text-[11px] text-slate-500">Pilih nomor material ERP beserta jumlahnya per baris (harus sama dengan Total Rencana) sebelum mencatat nomor permohonan MIMS.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500">{(detail.lines || []).length} item</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2">KHS &amp; Material</th>
                      <th className="px-3 py-2 min-w-64">Nomor Material ERP</th>
                      <th className="px-3 py-2 text-right">Qty BOM</th>
                      <th className="px-3 py-2 text-right">Total Rencana</th>
                      <th className="px-3 py-2 text-right">Realisasi</th>
                      <th className="px-3 py-2">Alasan Koreksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(detail.lines || []).map((ln) => {
                      const ed = edits[ln.khs_code] || { quantity: String(ln.quantity ?? 0), reason: ln.correction_reason || '' }
                      const targetQty = Number(ed.quantity || 0)
                      const differsFromBom = targetQty !== Number(ln.quantity_bom ?? 0)
                      const opts = ln.material_options || []
                      const matMap = materialEdits[ln.khs_code] || {}
                      const sumMat = opts.reduce((s, o) => s + (Number(matMap[o.material_no] || 0) || 0), 0)
                      const matMatched = opts.length <= 1 || Math.abs(sumMat - targetQty) <= 1e-6

                      return (
                        <tr key={ln.khs_code} className="align-top">
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{ln.khs_name || ln.khs_code}</div>
                            <div className="font-mono text-[10px] text-slate-400">{ln.khs_code} · {ln.unit_text || '-'}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            {opts.length === 0 ? (
                              Array.isArray(ln.material_numbers) && ln.material_numbers.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {ln.material_numbers.map((num) => (
                                    <span key={num} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                      {num}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">belum dipetakan</span>
                              )
                            ) : opts.length === 1 ? (
                              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-2.5 py-1.5 space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">{opts[0].material_no}</span>
                                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    Otomatis: {fmtNum(targetQty)} {opts[0].unit_text || ln.unit_text || ''}
                                  </span>
                                </div>
                                {opts[0].name && <div className="text-[10px] text-slate-500">{opts[0].name}</div>}
                                <div className="text-[10px] text-slate-500">
                                  Stok tersedia: <strong>{fmtNum(opts[0].available ?? opts[0].stock_ready)}</strong> {opts[0].unit_text || ln.unit_text || ''}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {opts.map((opt) => {
                                  const stockVal = opt.available ?? opt.stock_ready
                                  const savedQty = (ln.materials || []).find((m) => m.material_no === opt.material_no)?.quantity ?? 0
                                  return (
                                    <div key={opt.material_no} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2 py-1.5">
                                      <div className="min-w-0">
                                        <div className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">{opt.material_no}</div>
                                        {opt.name && <div className="text-[10px] text-slate-500 truncate max-w-44" title={opt.name}>{opt.name}</div>}
                                        <div className="text-[10px] text-slate-500">
                                          Stok: <strong>{fmtNum(stockVal)}</strong> {opt.unit_text || ln.unit_text || ''}
                                        </div>
                                      </div>
                                      {canEditLines ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          aria-label={`Qty ${opt.material_no} ${ln.khs_code}`}
                                          value={matMap[opt.material_no] ?? ''}
                                          onChange={(e) =>
                                            setMaterialEdits((prev) => ({
                                              ...prev,
                                              [ln.khs_code]: { ...(prev[ln.khs_code] || {}), [opt.material_no]: e.target.value },
                                            }))
                                          }
                                          placeholder="0"
                                          className="w-20 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-right text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring"
                                        />
                                      ) : (
                                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                                          {fmtNum(savedQty)}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })}
                                {canEditLines && (
                                  <div className={`text-[10px] font-semibold text-right ${matMatched ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                    Terpilih: {fmtNum(sumMat)} / {fmtNum(targetQty)}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                            {fmtNum(ln.quantity_bom)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {canEditLines ? (
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
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300">
                            {ln.realised != null ? fmtNum(ln.realised) : '-'}
                          </td>
                          <td className="px-3 py-2.5">
                            {canEditLines ? (
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

            {canEditLines && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-4">
                <Button type="submit" variant="secondary" loading={saving}>
                  Simpan Perubahan Total
                </Button>
                <Button type="button" variant="danger" icon={IconX} onClick={() => setCancelOpen(true)}>
                  Batalkan Reservasi
                </Button>
              </div>
            )}
          </form>

          {/* Langkah 2: Catat / Koreksi Nomor Permohonan MIMS */}
          {['DRAFT', 'REQUESTED'].includes(detail.status) && canOperate && (
            <form onSubmit={handleRequestMims} className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-2.5">
              <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                {detail.status === 'DRAFT' ? 'Catat Nomor Permohonan MIMS (Tahan Stok)' : 'Koreksi Nomor Permohonan MIMS'}
              </div>
              <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                Setelah memilih nomor material SAP dan mengirim total pemakaian material di MIMS, catat nomor permohonan MIMS di sini untuk menahan stok dan membuka isian realisasi per agenda.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="Nomor permohonan MIMS"
                  value={mimsNo}
                  onChange={(e) => setMimsNo(e.target.value)}
                  placeholder="Masukkan nomor permohonan MIMS…"
                  className="flex-1 min-w-56 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus-ring"
                />
                <Button type="submit" variant="primary" loading={requestingMims} disabled={!mimsNo.trim()}>
                  Simpan No. Permohonan MIMS
                </Button>
              </div>
            </form>
          )}

          {/* Langkah 3: Realisasi per Agenda (Serial Number + material_no, Panjang Kabel, Segel, Keluarkan Agenda) */}
          {applications.length > 0 && (
            <form onSubmit={handleSaveRealization} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-850/40">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Realisasi per No. Agenda ({activeApplications.length} aktif)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Isi nomor seri kWh meter &amp; MCB (beserta pilihan nomor material bila dibagi ke beberapa nomor), panjang kabel SR aktual (m), dan nomor segel. Dapat disimpan bertahap.
                  </p>
                </div>
                {detail.status === 'REQUESTED' && canOperate && (
                  <Button type="submit" size="sm" variant="secondary" loading={savingRealization}>
                    Simpan Realisasi
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2.5">No. Agenda &amp; Pelanggan</th>
                      {serialKhsCodes.map((m) => (
                        <th key={m.khs_code} className="px-3 py-2.5">
                          <div>{m.group}</div>
                          <div className="text-[10px] font-normal normal-case text-slate-400 truncate max-w-36">{m.khs_code}</div>
                        </th>
                      ))}
                      <th className="px-3 py-2.5">Panjang Kabel (m)</th>
                      <th className="px-3 py-2.5">Nomor Segel (koma)</th>
                      {['DRAFT', 'REQUESTED'].includes(detail.status) && canOperate && (
                        <th className="px-3 py-2.5 text-right">Aksi</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {applications.map((ag) => {
                      const entry = agendaInputs[ag.application_id] || { cable_m: '35', sealsText: '', serials: {} }
                      const isReleased = Boolean(ag.released_at)
                      const readOnly = detail.status !== 'REQUESTED' || !canOperate || isReleased
                      const neededCodes = Array.isArray(ag.needs) && ag.needs.length > 0
                        ? new Set(ag.needs.map((n) => n.khs_code))
                        : null
                      const agendaLabel = ag.agenda_number || ag.application_number || ag.application_id
                      return (
                        <tr key={ag.application_id} className={`align-top ${isReleased ? 'bg-slate-50/70 dark:bg-slate-850/40 opacity-65' : ''}`}>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{ag.customer_name || '-'}</div>
                            <div className="font-mono text-[11px] text-slate-500">{agendaLabel}</div>
                            {ag.power_va != null && (
                              <div className="text-[10px] text-slate-400">{fmtNum(ag.power_va)} VA</div>
                            )}
                            {isReleased && (
                              <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-400 font-semibold">
                                Dikeluarkan: {ag.release_reason || '-'}
                              </div>
                            )}
                          </td>
                          {serialKhsCodes.map((m) => {
                            const usesMaterial = !neededCodes || neededCodes.has(m.khs_code)
                            const ln = linesByCode[m.khs_code]
                            const activeMats = (ln?.materials || []).filter((mt) => Number(mt.quantity) > 0)
                            const snEntry = entry.serials?.[m.khs_code] || { serial_number: '', material_no: '' }
                            return (
                              <td key={m.khs_code} className="px-3 py-2.5 space-y-1">
                                {usesMaterial ? (
                                  <>
                                    <input
                                      type="text"
                                      aria-label={`SN ${m.khs_code} ${agendaLabel}`}
                                      disabled={readOnly}
                                      value={snEntry.serial_number || ''}
                                      onChange={(e) =>
                                        setAgendaInputs((prev) => ({
                                          ...prev,
                                          [ag.application_id]: {
                                            ...entry,
                                            serials: {
                                              ...(entry.serials || {}),
                                              [m.khs_code]: { ...snEntry, serial_number: e.target.value },
                                            },
                                          },
                                        }))
                                      }
                                      placeholder="Nomor seri…"
                                      className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                                    />
                                    {activeMats.length > 1 && (
                                      <select
                                        aria-label={`Material ${m.khs_code} ${agendaLabel}`}
                                        disabled={readOnly}
                                        value={snEntry.material_no || ''}
                                        onChange={(e) =>
                                          setAgendaInputs((prev) => ({
                                            ...prev,
                                            [ag.application_id]: {
                                              ...entry,
                                              serials: {
                                                ...(entry.serials || {}),
                                                [m.khs_code]: { ...snEntry, material_no: e.target.value },
                                              },
                                            },
                                          }))
                                        }
                                        className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-mono text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                                      >
                                        <option value="">Pilih no. material…</option>
                                        {activeMats.map((mt) => (
                                          <option key={mt.material_no} value={mt.material_no}>
                                            {mt.material_no}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-400 text-[11px]">Tidak pakai</span>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              aria-label={`Panjang kabel ${agendaLabel}`}
                              disabled={readOnly}
                              value={entry.cable_m}
                              onChange={(e) =>
                                setAgendaInputs((prev) => ({
                                  ...prev,
                                  [ag.application_id]: { ...entry, cable_m: e.target.value },
                                }))
                              }
                              className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              aria-label={`Nomor segel ${agendaLabel}`}
                              disabled={readOnly}
                              value={entry.sealsText}
                              onChange={(e) =>
                                setAgendaInputs((prev) => ({
                                  ...prev,
                                  [ag.application_id]: { ...entry, sealsText: e.target.value },
                                }))
                              }
                              placeholder="Mis. SGL01, SGL02"
                              className="w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                            />
                          </td>
                          {['DRAFT', 'REQUESTED'].includes(detail.status) && canOperate && (
                            <td className="px-3 py-2.5 text-right">
                              {!isReleased && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  icon={IconTrash}
                                  onClick={() => setRemoveTarget({ application_id: ag.application_id, label: agendaLabel })}
                                >
                                  Keluarkan
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Langkah 4: Penghalang SAP, Samakan Total, & Kirim SAP */}
              {detail.status === 'REQUESTED' && canOperate && (
                <div className="px-4 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-teal-50/40 dark:bg-teal-950/20 space-y-3">
                  {sapBlockers.length > 0 && (
                    <Alert variant="warning">
                      <div className="space-y-1 text-xs">
                        <div className="font-bold flex items-center gap-1.5">
                          <IconAlertCircle className="h-4 w-4 shrink-0" />
                          Belum siap kirim SAP:
                        </div>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {sapBlockers.map((b, idx) => <li key={idx}>{b}</li>)}
                        </ul>
                      </div>
                    </Alert>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" variant="secondary" icon={IconCheck} loading={matching} onClick={handleMatchTotals}>
                        Samakan total
                      </Button>
                      <input
                        type="text"
                        aria-label="Referensi SAP (opsional)"
                        value={sapRef}
                        onChange={(e) => setSapRef(e.target.value)}
                        placeholder="Referensi SAP (opsional)…"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus-ring w-48"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      icon={IconSend}
                      disabled={sapBlockers.length > 0}
                      onClick={() => setSapConfirmOpen(true)}
                    >
                      Kirim SAP
                    </Button>
                  </div>
                </div>
              )}
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

      <ConfirmationModal
        open={sapConfirmOpen}
        variant="info"
        title="Kirim Reservasi ke SAP?"
        description="Pastikan seluruh nomor seri kWh meter & MCB, panjang kabel SR, dan nomor segel sudah tersimpan serta total telah disamakan."
        confirmLabel="Kirim SAP"
        loading={sendingSap}
        onClose={() => setSapConfirmOpen(false)}
        onConfirm={handleSendSap}
      />

      <ReasonDialog
        open={Boolean(removeTarget)}
        title={`Keluarkan Agenda ${removeTarget?.label || ''}?`}
        description="Realisasi pada agenda ini akan dibuang dan total material disesuaikan. Bila ini agenda terakhir, reservasi akan dibatalkan."
        confirmLabel="Keluarkan Agenda"
        variant="warning"
        loading={dialogBusy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveAgenda}
      />

      <ReasonDialog
        open={cancelOpen}
        title="Batalkan Reservasi SR?"
        description="Reservasi ini akan dibatalkan dan stok yang ditahan (bila ada) dilepas kembali. Alasan pembatalan wajib diisi."
        confirmLabel="Batalkan Reservasi"
        variant="danger"
        loading={dialogBusy}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancel}
      />
    </PanelShell>
  )
}
