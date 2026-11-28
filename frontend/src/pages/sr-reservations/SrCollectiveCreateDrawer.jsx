import { useEffect, useMemo, useState } from 'react'
import { srReservationsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconAlertCircle,
  IconCheckCircle,
  IconLock,
  IconPlus,
  IconTrash,
  IconX,
} from '../../components/icons.jsx'

export default function SrCollectiveCreateDrawer({
  open,
  agendas = [],
  onRemoveAgenda,
  onClose,
  onCreated,
}) {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const canPrepareUlp = Boolean(isSysAdmin || can?.['sr_reservations.prepare_ulp'])
  const canPrepareUp3 = Boolean(isSysAdmin || can?.['sr_reservations.prepare_up3'])

  const [loading, setLoading] = useState(false)
  const [perAppInfo, setPerAppInfo] = useState({}) // { [appId]: data }
  const [vendors, setVendors] = useState([])
  const [warehouseId, setWarehouseId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [srLength, setSrLength] = useState('35')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const agendaIdsKey = agendas.map((a) => a.application_id).join(',')
  const firstAppId = agendas[0]?.application_id || ''

  const distinctUnits = useMemo(
    () => Array.from(new Set(agendas.map((a) => a.unit?.id).filter(Boolean))),
    [agendas],
  )
  const distinctPhases = useMemo(
    () => Array.from(new Set(agendas.map((a) => a.phase).filter((p) => p != null))),
    [agendas],
  )

  const ruleViolations = useMemo(() => {
    const msgs = []
    if (agendas.length > 100) {
      msgs.push(`Maksimal 100 agenda per reservasi (terpilih ${agendas.length}).`)
    }
    if (distinctUnits.length > 1) {
      msgs.push('Satu reservasi hanya boleh untuk satu ULP yang sama.')
    }
    if (distinctPhases.length > 1) {
      msgs.push('Satu reservasi hanya boleh untuk satu jumlah phasa (1 Phasa atau 3 Phasa saja).')
    }
    return msgs
  }, [agendas.length, distinctUnits.length, distinctPhases.length])

  useEffect(() => {
    if (!open || agendas.length === 0) return
    let live = true
    setLoading(true)
    setSubmitError('')
    Promise.all(
      agendas.map((a) =>
        srReservationsApi
          .forApplication(a.application_id)
          .then((res) => [a.application_id, res?.data || null])
          .catch(() => [a.application_id, null]),
      ),
    )
      .then((entries) => {
        if (!live) return
        const map = Object.fromEntries(entries)
        setPerAppInfo(map)
        const firstData = map[firstAppId]
        if (firstData) {
          setSrLength((prev) => prev || (firstData.default_sr_length_m != null ? String(firstData.default_sr_length_m) : '35'))
          const allowedWh = (firstData.warehouses || []).filter(
            (w) => (w.level === 'ULP' && canPrepareUlp) || (w.level === 'UP3' && canPrepareUp3),
          )
          const firstWh = allowedWh[0] || firstData.warehouses?.[0]
          if (firstWh) setWarehouseId((prev) => prev || firstWh.id)
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => { live = false }
  }, [open, agendaIdsKey, firstAppId, canPrepareUlp, canPrepareUp3])

  const info = perAppInfo[firstAppId] || null
  const batchPhase = distinctPhases.length === 1 ? distinctPhases[0] : info?.phase ?? 1

  useEffect(() => {
    if (!open || batchPhase !== 3) return
    vendorsApi.list({ status: 'ACTIVE', per_page: 200 })
      .then((res) => {
        const rows = (res?.data || []).filter(
          (v) => !v.scope || ['JARINGAN', 'NETWORK', 'BOTH', 'KEDUANYA'].includes(String(v.scope).toUpperCase()),
        )
        setVendors(rows)
      })
      .catch(() => setVendors([]))
  }, [open, batchPhase])

  const vendorOptions = useMemo(
    () => [
      { value: '', label: 'Pilih pelaksana 3 phasa…' },
      ...vendors.map((v) => ({ value: v.id, label: `${v.code ? `${v.code} - ` : ''}${v.name}` })),
    ],
    [vendors],
  )

  const blockedAgendas = useMemo(
    () => agendas.filter((a) => (perAppInfo[a.application_id]?.blockers?.length || 0) > 0),
    [agendas, perAppInfo],
  )
  const readyCount = agendas.length - blockedAgendas.length
  const totalPowerVa = useMemo(
    () => agendas.reduce((sum, a) => sum + (Number(a.power_va) || 0), 0),
    [agendas],
  )
  const estCableM = Number(srLength || 35) * agendas.length
  const warehouses = info?.warehouses || []
  const warehouseRequired = warehouses.length > 1

  const handleRemoveBlocked = () => {
    if (!onRemoveAgenda) return
    blockedAgendas.forEach((a) => onRemoveAgenda(a.application_id))
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (agendas.length === 0 || blockedAgendas.length > 0 || ruleViolations.length > 0) return
    if (warehouseRequired && !warehouseId) {
      notify({ type: 'error', title: 'Gudang belum dipilih', desc: 'Pilih gudang sumber material terlebih dahulu.', tag: 'Reservasi SR' })
      return
    }
    if (batchPhase === 3 && !vendorId) {
      notify({ type: 'error', title: 'Pelaksana wajib dipilih', desc: 'Pilih vendor pelaksana untuk sambungan 3 phasa.', tag: 'Reservasi SR' })
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await srReservationsApi.create({
        application_ids: agendas.map((a) => a.application_id),
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        ...(batchPhase === 3 ? { vendor_company_id: vendorId } : {}),
        ...(srLength !== '' ? { sr_length_m: Number(srLength) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      notify({
        type: 'success',
        title: 'Reservasi kolektif dibuat',
        desc: `Draf reservasi untuk ${agendas.length} agenda berhasil dibuat.`,
        tag: 'Reservasi SR',
      })
      onCreated?.(res?.data?.id)
      onClose?.()
    } catch (err) {
      const msg = err?.message || 'Gagal membuat reservasi kolektif.'
      setSubmitError(msg)
      notify({ type: 'error', title: 'Gagal membuat reservasi', desc: msg, tag: 'Reservasi SR' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      open={open}
      onClose={onClose}
      title={`Buat Reservasi Kolektif (${agendas.length} Agenda)`}
      subtitle="Satu reservasi untuk banyak agenda (satu ULP, satu phasa) tanpa persetujuan. Total material dihitung otomatis dari BOM."
      size="max-w-4xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            form="sr-collective-form"
            variant="primary"
            icon={IconPlus}
            loading={submitting}
            disabled={
              loading ||
              agendas.length === 0 ||
              blockedAgendas.length > 0 ||
              ruleViolations.length > 0 ||
              (warehouseRequired && !warehouseId) ||
              (batchPhase === 3 && !vendorId)
            }
          >
            Buat Reservasi ({agendas.length} Agenda)
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="py-16 flex justify-center"><Spinner label="Memeriksa kelayakan agenda, gudang, dan pelaksana..." /></div>
      ) : (
        <form id="sr-collective-form" onSubmit={handleSubmit} className="space-y-5 text-xs">
          {/* Strip Ringkasan Eksekutif */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-3">
              <dt className="text-[11px] font-medium text-slate-500">Jumlah Agenda</dt>
              <dd className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{agendas.length} Agenda</dd>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-3">
              <dt className="text-[11px] font-medium text-slate-500">Total Daya</dt>
              <dd className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{totalPowerVa.toLocaleString('id-ID')} VA</dd>
            </div>
            <div className="rounded-xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-3">
              <dt className="text-[11px] font-medium text-blue-700 dark:text-blue-300">Estimasi Kabel SR</dt>
              <dd className="mt-1 text-lg font-bold text-blue-700 dark:text-blue-300">{estCableM.toLocaleString('id-ID')} m</dd>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                blockedAgendas.length > 0 || ruleViolations.length > 0
                  ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20'
                  : 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
              }`}
            >
              <dt className={`text-[11px] font-medium ${blockedAgendas.length > 0 || ruleViolations.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                Kesiapan Batch
              </dt>
              <dd className={`mt-1 text-lg font-bold ${blockedAgendas.length > 0 || ruleViolations.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {blockedAgendas.length > 0 ? `${readyCount} Siap · ${blockedAgendas.length} Terhalang` : `${readyCount} Siap Semua`}
              </dd>
            </div>
          </dl>

          {ruleViolations.length > 0 && (
            <Alert variant="error">
              <ul className="list-disc pl-4 space-y-0.5">
                {ruleViolations.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </Alert>
          )}

          {submitError && (
            <Alert variant="error">{submitError}</Alert>
          )}

          {/* Layout 2 Kolom Seimbang */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Kolom Kiri (7/12): Tabel Daftar No. Agenda Terpilih */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-850/40">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Daftar No. Agenda Terpilih ({agendas.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">Pastikan seluruh agenda berstatus Siap sebelum membuat reservasi.</p>
                </div>
                {blockedAgendas.length > 0 && agendas.length > blockedAgendas.length && onRemoveAgenda && (
                  <Button type="button" size="sm" variant="secondary" icon={IconTrash} onClick={handleRemoveBlocked}>
                    Keluarkan Agenda Terhalang ({blockedAgendas.length})
                  </Button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3.5">Pelanggan &amp; No. Agenda</th>
                      <th className="py-2.5 px-3.5">ULP &amp; Daya</th>
                      <th className="py-2.5 px-3.5">Kelayakan</th>
                      <th className="py-2.5 px-2 text-right"><span className="sr-only">Hapus</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {agendas.map((a) => {
                      const blockers = perAppInfo[a.application_id]?.blockers || []
                      const hasBlocker = blockers.length > 0
                      return (
                        <tr key={a.application_id} className={hasBlocker ? 'bg-amber-50/40 dark:bg-amber-950/10' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'}>
                          <td className="py-2.5 px-3.5">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{a.customer_name}</div>
                            <div className="font-mono text-[11px] text-slate-500">{a.application_number}</div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            <div className="text-slate-700 dark:text-slate-300">{a.unit?.name || '-'}</div>
                            <div className="text-[11px] text-slate-500">
                              {a.power_va ? `${Number(a.power_va).toLocaleString('id-ID')} VA` : '-'} · {a.phase}Ph
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5">
                            {hasBlocker ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                                  <IconAlertCircle className="h-3 w-3" /> Terhalang
                                </span>
                                <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-snug max-w-52">
                                  {blockers[0]}
                                </p>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <IconCheckCircle className="h-3 w-3" /> Siap
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            {agendas.length > 1 && onRemoveAgenda && (
                              <button
                                type="button"
                                onClick={() => onRemoveAgenda(a.application_id)}
                                aria-label={`Keluarkan ${a.application_number}`}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 cursor-pointer"
                              >
                                <IconX className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Kolom Kanan (5/12): Konfigurasi Reservasi */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Konfigurasi Reservasi</h3>
                <p className="text-[11px] text-slate-500">Gudang sumber tidak dapat diganti setelah reservasi dibuat.</p>
              </div>

              <div>
                <label htmlFor="col-warehouse" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gudang Sumber Material
                </label>
                <select
                  id="col-warehouse"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
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
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pelaksana {batchPhase === 1 ? '(Otomatis Kontrak 1 Phasa)' : '(Pilih Pelaksana 3 Phasa)'}
                </label>
                {batchPhase === 1 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                    <IconLock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate font-semibold">
                      {info?.contract?.vendor
                        ? `${info.contract.vendor.name} (${info.contract.contract_number})`
                        : 'Belum ada kontrak 1 phasa berlaku'}
                    </span>
                  </div>
                ) : (
                  <SearchSelect
                    ariaLabel="Pelaksana kolektif 3 phasa"
                    options={vendorOptions}
                    value={vendorId}
                    onChange={setVendorId}
                    placeholder="Ketik nama vendor…"
                  />
                )}
              </div>

              <div>
                <label htmlFor="col-length" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Panjang Kabel SR Bawaan per Agenda (m)
                </label>
                <input
                  id="col-length"
                  type="number"
                  step="0.1"
                  min="1"
                  value={srLength}
                  onChange={(e) => setSrLength(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Panjang aktual per agenda dapat disesuaikan setelah nomor permohonan MIMS dicatat.
                </p>
              </div>

              <div>
                <label htmlFor="col-notes" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan (Opsional)
                </label>
                <textarea
                  id="col-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Mis. Reservasi SR gelombang 1…"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </div>
          </div>
        </form>
      )}
    </PanelShell>
  )
}
