import { useCallback, useEffect, useState } from 'react'
import { srReservationsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import SrReservationDetailDrawer, { SrStatusBadge } from './SrReservationDetailDrawer.jsx'
import { IconAlertCircle, IconCheckCircle, IconLock, IconPlus, IconEye, IconX } from '../../components/icons.jsx'

export default function ApplicationSrReservationPanel({ applicationId, onChanged }) {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null)

  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [srLength, setSrLength] = useState('35')
  const [notes, setNotes] = useState('')
  const [vendors, setVendors] = useState([])
  const [creating, setCreating] = useState(false)

  // Extension finding (docs/95 #76 & #77)
  const [extOpen, setExtOpen] = useState(false)
  const [extReason, setExtReason] = useState('')
  const [extDistance, setExtDistance] = useState('')
  const [extBusy, setExtBusy] = useState(false)
  const [cancelExtOpen, setCancelExtOpen] = useState(false)
  const [cancelExtError, setCancelExtError] = useState('')

  const [detailId, setDetailId] = useState(null)

  const canPrepareUlp = Boolean(isSysAdmin || can?.['sr_reservations.prepare_ulp'])
  const canPrepareUp3 = Boolean(isSysAdmin || can?.['sr_reservations.prepare_up3'])
  const canPrepareAny = canPrepareUlp || canPrepareUp3
  const canReportExtension = Boolean(isSysAdmin || can?.['sr_reservations.report_extension'])

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true)
    setError('')
    try {
      const res = await srReservationsApi.forApplication(applicationId)
      const d = res?.data || null
      setInfo(d)
      if (d) {
        setSrLength(d.default_sr_length_m != null ? String(d.default_sr_length_m) : '35')
        const allowedWarehouses = (d.warehouses || []).filter((w) =>
          (w.level === 'ULP' && canPrepareUlp) || (w.level === 'UP3' && canPrepareUp3),
        )
        const firstWh = allowedWarehouses[0] || d.warehouses?.[0]
        if (firstWh) setWarehouseId((prev) => prev || firstWh.id)
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat informasi reservasi material SR.')
    } finally {
      setLoading(false)
    }
  }, [applicationId, canPrepareUlp, canPrepareUp3])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!info || info.phase !== 3) return
    vendorsApi.list({ status: 'ACTIVE', per_page: 200 })
      .then((res) => {
        const rows = (res?.data || []).filter((v) => !v.scope || ['JARINGAN', 'NETWORK', 'BOTH', 'KEDUANYA'].includes(String(v.scope).toUpperCase()))
        setVendors(rows)
      })
      .catch(() => setVendors([]))
  }, [info?.phase])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!warehouseId && (info?.warehouses?.length || 0) > 1) {
      notify({ type: 'error', title: 'Gudang belum dipilih', desc: 'Pilih gudang sumber material terlebih dahulu.', tag: 'Reservasi SR' })
      return
    }
    if (info?.phase === 3 && !vendorId) {
      notify({ type: 'error', title: 'Pelaksana wajib dipilih', desc: 'Untuk sambungan 3 phasa, pilih vendor pelaksana terlebih dahulu.', tag: 'Reservasi SR' })
      return
    }

    setCreating(true)
    try {
      const body = {
        application_ids: [applicationId],
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        ...(info?.phase === 3 ? { vendor_company_id: vendorId } : {}),
        ...(srLength !== '' ? { sr_length_m: Number(srLength) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
      const res = await srReservationsApi.create(body)
      const createdId = res?.data?.id
      notify({ type: 'success', title: 'Rencana reservasi dibuat', desc: 'Rencana dibuat dalam status Draf. Silakan tinjau material dan ajukan.', tag: 'Reservasi SR' })
      setNotes('')
      await load()
      onChanged?.()
      if (createdId) setDetailId(createdId)
    } catch (err) {
      notify({ type: 'error', title: 'Gagal membuat rencana', desc: err?.message || 'Periksa syarat dan penghalang (blockers).', tag: 'Reservasi SR' })
    } finally {
      setCreating(false)
    }
  }

  const handleReportExtension = async (e) => {
    e.preventDefault()
    if (!extReason.trim()) return
    setExtBusy(true)
    try {
      await srReservationsApi.reportExtension(applicationId, {
        reason: extReason.trim(),
        ...(extDistance !== '' ? { distance_m: Number(extDistance) } : {}),
      })
      notify({
        type: 'warning',
        title: 'Temuan perlu perluasan dicatat',
        desc: 'Alur survei dan KKO kini terbuka untuk permohonan ini.',
        tag: 'Reservasi SR',
      })
      setExtOpen(false)
      setExtReason('')
      setExtDistance('')
      await load()
      onChanged?.()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal mencatat temuan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Reservasi SR' })
    } finally {
      setExtBusy(false)
    }
  }

  const handleCancelExtension = async (reason) => {
    setExtBusy(true)
    setCancelExtError('')
    try {
      await srReservationsApi.cancelExtension(applicationId, { reason })
      notify({
        type: 'success',
        title: 'Tanda perlu perluasan dibatalkan',
        desc: 'Permohonan kembali ke jalur sambungan langsung tanpa survei.',
        tag: 'Reservasi SR',
      })
      setCancelExtOpen(false)
      await load()
      onChanged?.()
    } catch (err) {
      const msg = err?.message || 'Tidak dapat membatalkan tanda perluasan.'
      setCancelExtError(msg)
      notify({ type: 'error', title: 'Pembatalan ditolak', desc: msg, tag: 'Reservasi SR' })
    } finally {
      setExtBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="py-10 flex justify-center">
        <Spinner label="Memuat data reservasi SR..." />
      </div>
    )
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>
  }

  if (!info) return null

  const blockers = info.blockers || []
  const reservations = info.reservations || []
  const hasRunningPlan = reservations.some((r) => r.status !== 'CANCELLED')
  const warehouses = info.warehouses || []
  const finding = info.extension_finding || null

  return (
    <div className="space-y-4">
      {/* Ringkasan Daya & Fasa */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/40 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-800 dark:text-slate-100">
            Daya Baru: {info.power_va != null ? `${Number(info.power_va).toLocaleString('id-ID')} VA` : '-'}
          </span>
          {info.phase && (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
              {info.phase} Phasa
            </span>
          )}
          {Array.isArray(info.mims_reservation_numbers) && info.mims_reservation_numbers.length > 0 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              MIMS: {info.mims_reservation_numbers.join(', ')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {info.survey_sr_length_m != null && (
            <span className="text-slate-600 dark:text-slate-300">
              Panjang SR hasil survei: <strong>{Number(info.survey_sr_length_m).toLocaleString('id-ID')} m</strong>
            </span>
          )}
          {info.phase === 1 && canReportExtension && !finding && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setExtOpen(true)}>
              Perlu Perluasan
            </Button>
          )}
        </div>
      </div>

      {/* Temuan Perlu Perluasan (1 Phasa) */}
      {finding && (
        <Alert variant="warning">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 text-xs">
              <div className="font-bold">Temuan Lapangan: Perlu Perluasan Jaringan</div>
              <p>{finding.reason}</p>
              <p className="text-[11px] opacity-80">
                {finding.distance_m != null ? `Perkiraan jarak: ${finding.distance_m} m · ` : ''}
                Dicatat oleh {typeof finding.reported_by === 'string' ? finding.reported_by : finding.reported_by?.name || '-'}
                {finding.reported_at ? ` pada ${new Date(finding.reported_at).toLocaleString('id-ID')}` : ''}
              </p>
            </div>
            {canReportExtension && (
              <Button type="button" size="sm" variant="danger" icon={IconX} onClick={() => { setCancelExtError(''); setCancelExtOpen(true) }}>
                Batalkan Tanda Perluasan
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Blockers */}
      {blockers.length > 0 && (
        <Alert variant="warning">
          <div className="space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <IconAlertCircle className="h-4 w-4 shrink-0" />
              Belum dapat membuat rencana reservasi:
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </Alert>
      )}

      {/* Formulir Buat Rencana Reservasi */}
      {!hasRunningPlan && canPrepareAny && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Buat Rencana Reservasi Material SR</h4>
            <p className="text-xs text-slate-500">
              Pilih gudang sumber (tidak dapat diganti setelah dibuat) dan periksa pelaksana serta panjang kabel SR.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="sr-warehouse" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Gudang Sumber Material
              </label>
              <select
                id="sr-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={blockers.length > 0}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
              >
                <option value="">Pilih gudang…</option>
                {warehouses.map((w) => {
                  const allowed = (w.level === 'ULP' && canPrepareUlp) || (w.level === 'UP3' && canPrepareUp3)
                  return (
                    <option key={w.id} value={w.id} disabled={!allowed}>
                      [{w.level}] {w.code ? `${w.code} - ` : ''}{w.name}{!allowed ? ' (tanpa izin)' : ''}
                    </option>
                  )
                })}
              </select>
            </div>

            <div>
              <label htmlFor="sr-vendor" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Pelaksana {info.phase === 1 ? '(Otomatis Kontrak 1 Phasa)' : '(Pilih Pelaksana 3 Phasa)'}
              </label>
              {info.phase === 1 ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                  <IconLock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate font-semibold">
                    {info.contract?.vendor
                      ? `${info.contract.vendor.name} (${info.contract.contract_number})`
                      : 'Belum ada kontrak 1 phasa berlaku'}
                  </span>
                </div>
              ) : (
                <select
                  id="sr-vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  disabled={blockers.length > 0}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                >
                  <option value="">Pilih pelaksana…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code ? `${v.code} - ` : ''}{v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="sr-length" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Panjang Kabel SR (meter)
              </label>
              <input
                id="sr-length"
                type="number"
                step="0.1"
                min="1"
                value={srLength}
                onChange={(e) => setSrLength(e.target.value)}
                disabled={blockers.length > 0}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Bawaan {info.default_sr_length_m ?? 35} m.
                {info.survey_sr_length_m != null && ` Pembanding hasil survei: ${info.survey_sr_length_m} m.`}
              </p>
            </div>

            <div>
              <label htmlFor="sr-notes" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Catatan (Opsional)
              </label>
              <input
                id="sr-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={blockers.length > 0}
                placeholder="Catatan tambahan…"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" icon={IconPlus} loading={creating} disabled={blockers.length > 0 || (!warehouseId && warehouses.length > 1) || (info.phase === 3 && !vendorId)}>
              Buat Rencana Reservasi
            </Button>
          </div>
        </form>
      )}

      {/* Daftar Rencana Reservasi untuk Permohonan Ini */}
      {reservations.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <IconCheckCircle className="h-3.5 w-3.5 text-emerald-600" /> Rencana Reservasi ({reservations.length})
          </h4>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reservations.map((r) => (
              <li key={r.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Versi #{r.version_number || 1}</span>
                    <SrStatusBadge status={r.status} />
                    <span className="text-slate-500">Gudang {r.source_level}: {r.warehouse?.name || '-'}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Pelaksana: <strong>{r.vendor?.name || '-'}</strong> · Kabel SR: {r.sr_length_m ?? 35} m
                    {r.mims_reservation_no ? ` · No. MIMS: ${r.mims_reservation_no}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon={IconEye} onClick={() => setDetailId(r.id)}>
                  Rincian
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal Catat Temuan Perlu Perluasan */}
      <Modal
        open={extOpen}
        onClose={() => setExtOpen(false)}
        size="max-w-md"
        title="Catat Temuan Perlu Perluasan"
        subtitle="Gunakan bila sambungan 1 phasa ternyata membutuhkan perluasan jaringan. Alur survei dan KKO akan dibuka."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setExtOpen(false)}>Batal</Button>
            <Button type="submit" form="sr-ext-form" variant="primary" loading={extBusy} disabled={!extReason.trim()}>
              Simpan Temuan
            </Button>
          </>
        }
      >
        <form id="sr-ext-form" onSubmit={handleReportExtension} className="space-y-3 text-xs">
          <div>
            <label htmlFor="sr-ext-reason" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Alasan / Kondisi Lapangan <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="sr-ext-reason"
              rows={3}
              required
              value={extReason}
              onChange={(e) => setExtReason(e.target.value)}
              placeholder="Contoh: Jarak tiang terdekat 95 meter, perlu tambah 2 tiang JTR…"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
          <div>
            <label htmlFor="sr-ext-dist" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Perkiraan Jarak (meter, opsional)
            </label>
            <input
              id="sr-ext-dist"
              type="number"
              min="1"
              step="1"
              value={extDistance}
              onChange={(e) => setExtDistance(e.target.value)}
              placeholder="Mis. 95"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </form>
      </Modal>

      <ReasonDialog
        open={cancelExtOpen}
        title="Batalkan Tanda Perlu Perluasan?"
        description={
          cancelExtError ||
          'Tanda perlu perluasan hanya dapat dibatalkan bila belum ada survei, usulan, gambar, atau alokasi sesudah temuan.'
        }
        confirmLabel="Batalkan Tanda"
        variant="danger"
        loading={extBusy}
        onClose={() => setCancelExtOpen(false)}
        onConfirm={handleCancelExtension}
      />

      <SrReservationDetailDrawer
        open={Boolean(detailId)}
        reservationId={detailId}
        onClose={() => setDetailId(null)}
        onUpdated={() => {
          load()
          onChanged?.()
        }}
      />
    </div>
  )
}
