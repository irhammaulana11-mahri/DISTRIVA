import { useState, useEffect, useCallback } from 'react'
import { workOrdersApi, bastpApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Drawer from '../../components/Drawer.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import BastpDetailDrawer from './BastpDetailDrawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { IconAlertCircle, IconPlus } from '../../components/icons.jsx'

/** Isi halaman rincian WO jaringan untuk vendor: identitas, tugas, material, progres, dan BASTP. */
export function VendorWorkOrderView({ workOrderId, isVendor, onUpdated }) {
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wo, setWo] = useState(null)
  const [reportTargetTask, setReportTargetTask] = useState(null)
  const [bastpList, setBastpList] = useState([])
  const [selectedBastpId, setSelectedBastpId] = useState(null)
  const [creatingBastp, setCreatingBastp] = useState(false)
  const [bastpError, setBastpError] = useState('')
  const [taskPage, setTaskPage] = useState(1)
  const [taskPerPage] = useState(10)
  const [matPage, setMatPage] = useState(1)
  const [matPerPage, setMatPerPage] = useState(10)
  const [progPage, setProgPage] = useState(1)
  const [progPerPage] = useState(10)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await workOrdersApi.get(workOrderId)
      setWo(res.data)
      bastpApi.listForWorkOrder(workOrderId)
        .then((bRes) => setBastpList(bRes?.data || []))
        .catch(() => setBastpList([]))
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat rincian WO.')
    } finally {
      setLoading(false)
    }
  }, [workOrderId])

  useEffect(() => { loadDetail() }, [loadDetail])

  const handleCreateBastp = async () => {
    setCreatingBastp(true)
    setBastpError('')
    try {
      const res = await bastpApi.create(workOrderId)
      notify({ type: 'success', title: 'BASTP Berhasil Dibuat', desc: 'Draf BASTP berhasil dibuat.', tag: 'BASTP' })
      const newId = res?.data?.id
      const bRes = await bastpApi.listForWorkOrder(workOrderId)
      setBastpList(bRes?.data || [])
      setSelectedBastpId(newId)
    } catch (err) {
      setBastpError(err?.response?.data?.message || err?.message || 'Gagal membuat BASTP.')
    } finally {
      setCreatingBastp(false)
    }
  }

  const allTasksVerified = Boolean(wo?.tasks?.length > 0 && wo.tasks.every((t) => Number(t.verified_percent) >= 100))
  const latestBastp = bastpList[0]

  return (
    <>
        <div className="space-y-5 text-xs">
          {error && <Alert kind="error">{error}</Alert>}
          {loading && <div className="py-10"><Spinner /></div>}

          {wo && (
            <>
              {/* Identity card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Surat Perintah Kerja</div>
                    <div className="font-mono font-bold text-base text-slate-900 dark:text-slate-100">{wo.wo_number}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">v{wo.version_number}</span>
                    <StatusBadge status={wo.status} />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                  {wo.application_number && (
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">No. Permohonan</div>
                      <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{wo.application_number}</div>
                    </div>
                  )}
                  {wo.vendor_name && (
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Vendor</div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{wo.vendor_name}</div>
                    </div>
                  )}
                  {wo.issued_at && (
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Diterbitkan</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">{new Date(wo.issued_at).toLocaleDateString('id-ID')}</div>
                    </div>
                  )}
                  {wo.completed_at && (
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Selesai</div>
                      <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">{new Date(wo.completed_at).toLocaleDateString('id-ID')}</div>
                    </div>
                  )}
                </div>

                {wo.return_reason && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                    <span className="font-semibold">Catatan Pengembalian: </span>{wo.return_reason}
                  </div>
                )}

                {wo.material_warning?.length > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                    <IconAlertCircle size={14} className="shrink-0" />
                    <span>Material belum lengkap — WO tetap dapat diterbitkan, namun pengadaan material perlu dipastikan.</span>
                  </div>
                )}
              </div>

              {/* BASTP section */}
              {((wo.status === 'IN_PROGRESS' && allTasksVerified) || (latestBastp && latestBastp.status !== 'CANCELLED')) && (
                <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-slate-100">
                      Berita Acara Serah Terima Pekerjaan (BASTP)
                      {latestBastp && <StatusBadge status={latestBastp.status} />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {latestBastp
                        ? `BASTP #${latestBastp.bastp_number || 'DRAFT'} (Putaran ke-${latestBastp.round}). Lengkapi realisasi material & foto kWh meter, lalu ajukan.`
                        : 'Seluruh pekerjaan telah terverifikasi 100%. Buat dan ajukan BASTP sekarang.'}
                    </p>
                    {bastpError && <p className="text-xs text-rose-600 mt-1">{bastpError}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={creatingBastp}
                    onClick={latestBastp ? () => setSelectedBastpId(latestBastp.id) : handleCreateBastp}
                  >
                    {latestBastp ? 'Kelola BASTP' : 'Buat BASTP'}
                  </Button>
                </div>
              )}

              {/* Tasks */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Daftar Pekerjaan / Tugas Lapangan ({wo.tasks?.length || 0})
                  </h4>
                  {['ISSUED', 'IN_PROGRESS'].includes(wo.status) && (
                    <Button size="sm" onClick={() => setReportTargetTask(wo.tasks?.[0] || null)} className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5">
                      <IconPlus size={12} />
                      <span>Laporkan Progres Fisik</span>
                    </Button>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">No</th>
                        <th className="py-2.5 px-3">Uraian Tugas</th>
                        <th className="py-2.5 px-3">Satuan</th>
                        <th className="py-2.5 px-3 text-right">Volume</th>
                        <th className="py-2.5 px-3 text-right">Progres</th>
                        {['ISSUED', 'IN_PROGRESS'].includes(wo.status) && <th className="py-2.5 px-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(wo.tasks || []).slice((taskPage - 1) * taskPerPage, taskPage * taskPerPage).map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 text-slate-400 font-mono">{t.sequence}</td>
                          <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100">{t.title}</td>
                          <td className="py-2.5 px-3 text-slate-500">{t.unit}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{t.volume}</td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-14 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-1.5 rounded-full ${t.verified_percent >= 100 ? 'bg-emerald-500' : t.verified_percent > 0 ? 'bg-blue-500' : 'bg-slate-300'}`}
                                  style={{ width: `${Math.min(100, t.verified_percent || 0)}%` }}
                                />
                              </div>
                              <span className={`font-mono font-bold text-xs ${t.verified_percent >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                {t.verified_percent}%
                              </span>
                            </div>
                          </td>
                          {['ISSUED', 'IN_PROGRESS'].includes(wo.status) && (
                            <td className="py-2.5 px-3 text-right">
                              <button type="button" onClick={() => setReportTargetTask(t)} className="px-2 py-1 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer">
                                Lapor
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <TableFooter
                    itemCount={(wo.tasks || []).slice((taskPage - 1) * taskPerPage, taskPage * taskPerPage).length}
                    total={wo.tasks?.length || 0}
                    entityLabel="tugas"
                    page={taskPage}
                    perPage={taskPerPage}
                    onPage={setTaskPage}
                    onPerPage={() => {}}
                    perPageOptions={[10]}
                  />
                </div>
              </div>

              {/* Materials: by name, not by KHS code */}
              {wo.materials?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Kebutuhan Material ({wo.materials.length})
                  </h4>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 font-semibold uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Material</th>
                          <th className="py-2.5 px-3">Satuan</th>
                          <th className="py-2.5 px-3 text-right">Kuantitas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {wo.materials.slice((matPage - 1) * matPerPage, matPage * matPerPage).map((m) => (
                          <tr key={m.khs_code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100">{m.khs_name}</td>
                            <td className="py-2.5 px-3 text-slate-500">{m.unit || '-'}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">{m.quantity?.toLocaleString('id-ID')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <TableFooter itemCount={wo.materials.slice((matPage - 1) * matPerPage, matPage * matPerPage).length} total={wo.materials.length} entityLabel="material" page={matPage} perPage={matPerPage}
                      onPage={setMatPage} onPerPage={(n) => { setMatPerPage(n); setMatPage(1) }} perPageOptions={[10, 25, 50, 100]} />
                  </div>
                </div>
              )}

              {/* Progress history */}
              {wo.progress?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Riwayat Pengajuan Progres ({wo.progress.length})
                  </h4>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 font-semibold uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Tugas</th>
                          <th className="py-2.5 px-3 text-right">Kumulatif</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Catatan</th>
                          <th className="py-2.5 px-3">Diajukan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {wo.progress.slice((progPage - 1) * progPerPage, progPage * progPerPage).map((p) => {
                          const task = wo.tasks?.find((t) => t.id === p.task_id)
                          return (
                            <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                              <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">{task ? `${task.sequence}. ${task.title}` : '-'}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700 dark:text-slate-300">{p.cumulative_percent}%</td>
                              <td className="py-2.5 px-3"><StatusBadge status={p.status} /></td>
                              <td className="py-2.5 px-3 text-slate-500">
                                {p.notes && <div>{p.notes}</div>}
                                {p.return_reason && <div className="text-amber-600 dark:text-amber-400 font-medium">Alasan: {p.return_reason}</div>}
                              </td>
                              <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                                {p.submitted_at ? new Date(p.submitted_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <TableFooter
                      itemCount={wo.progress.slice((progPage - 1) * progPerPage, progPage * progPerPage).length}
                      total={wo.progress.length}
                      entityLabel="progres"
                      page={progPage}
                      perPage={progPerPage}
                      onPage={setProgPage}
                      onPerPage={() => {}}
                      perPageOptions={[10]}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      {reportTargetTask && (
        <VendorProgressModal
          workOrderId={workOrderId}
          tasks={wo?.tasks || []}
          initialTaskId={reportTargetTask.id}
          onClose={() => setReportTargetTask(null)}
          onSuccess={() => { setReportTargetTask(null); loadDetail(); onUpdated?.() }}
        />
      )}

      {selectedBastpId && (
        <BastpDetailDrawer
          bastpId={selectedBastpId}
          workOrder={wo}
          isVendor={isVendor}
          onClose={() => setSelectedBastpId(null)}
          onUpdated={() => { loadDetail(); onUpdated?.() }}
        />
      )}
    </>
  )
}

function VendorProgressModal({ workOrderId, tasks, initialTaskId, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [taskId, setTaskId] = useState(initialTaskId || tasks[0]?.id || '')
  const [cumulativePercent, setCumulativePercent] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const pct = parseFloat(cumulativePercent)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setError('Persentase progres kumulatif harus antara 0 dan 100.')
      return
    }
    const submissionKey = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
    setSubmitting(true)
    try {
      const res = await workOrdersApi.submitProgress(workOrderId, { task_id: taskId, submission_key: submissionKey, cumulative_percent: pct, notes: notes.trim() || null })
      notify({ type: res.replayed ? 'info' : 'success', title: res.replayed ? 'Progres Sudah Tercatat' : 'Progres Dikirim', desc: res.replayed ? 'Pengajuan progres sudah tercatat sebelumnya.' : 'Pengajuan progres berhasil dikirim untuk verifikasi.', tag: 'WO' })
      onSuccess()
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Gagal mengajukan progres.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer open onClose={onClose} title="Laporkan Progres Fisik Lapangan" size="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && <Alert kind="error">{error}</Alert>}
        <div>
          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Pekerjaan / Tugas</label>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs">
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.sequence}. {t.title} (Saat ini: {t.verified_percent}%)</option>)}
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Progres Kumulatif (%) <span className="text-rose-500">*</span></label>
          <input type="number" min="0" max="100" step="0.01" required value={cumulativePercent} onChange={(e) => setCumulativePercent(e.target.value)} placeholder="Contoh: 45.5" className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-xs" />
          <p className="text-[11px] text-slate-400 mt-1">Angka total capaian kumulatif saat ini (0 – 100 %).</p>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Catatan Lapangan (Opsional)</label>
          <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan pengerjaan lapangan, kendala, atau rincian tiang/penyambungan..." className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Batal</Button>
          <Button type="submit" variant="primary" loading={submitting}>Kirim Pengajuan Progres</Button>
        </div>
      </form>
    </Drawer>
  )
}
