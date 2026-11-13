import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { kkfParametersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import {
  IconCheck,
  IconPencil,
  IconTrash,
  IconHistory,
  IconClock,
} from '../../components/icons.jsx'
import {
  formatPercentDisplay,
  formatRupiahPerKwh,
  KKF_FIELDS,
} from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function KkfParameterDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [set, setSet] = useState(null)

  const [dialog, setDialog] = useState(null) // { type: 'approve' | 'retire' }
  const [dialogError, setDialogError] = useState('')

  const canManage = Boolean(can['kkf_params.manage'])
  const canApprove = Boolean(can['kkf_params.approve'])

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await kkfParametersApi.get(id)
      setSet(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail set parameter KKF.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const todayStr = new Date().toISOString().slice(0, 10)
  const isCurrentActive = set && set.status === 'APPROVED' && set.valid_from <= todayStr && (!set.valid_until || set.valid_until >= todayStr)

  const handleConfirmAction = async (reason) => {
    if (!dialog) return
    setDialogError('')

    try {
      if (dialog.type === 'approve') {
        await kkfParametersApi.approve({
          set_ids: [id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Parameter KKF Disetujui',
          desc: `Set parameter "${set?.name}" berhasil disetujui.`,
          tag: 'Parameter KKF',
        })
      } else if (dialog.type === 'retire') {
        await kkfParametersApi.retire(id, { reason })
        notify({
          type: 'warning',
          title: 'Parameter KKF Dinonaktifkan',
          desc: `Set parameter "${set?.name}" dinonaktifkan.`,
          tag: 'Parameter KKF',
        })
      }
      setDialog(null)
      loadDetail()
    } catch (err) {
      setDialogError(err?.message || 'Gagal memproses aksi.')
      throw err
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat detail parameter KKF..." />
      </div>
    )
  }

  if (error || !set) {
    return (
      <div className="space-y-4">
        <Alert kind="error">{error || 'Data parameter KKF tidak ditemukan.'}</Alert>
        <Link
          to="/master-data/kkf-parameters"
          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-block"
        >
          &larr; Kembali ke Daftar Parameter KKF
        </Link>
      </div>
    )
  }

  const isDraft = set.status === 'DRAFT'
  const isApproved = set.status === 'APPROVED'

  return (
    <div className="space-y-6 w-full">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link to="/master-data/kkf-parameters" className="hover:text-blue-600 transition">
          Master Data
        </Link>
        <span>/</span>
        <Link to="/master-data/kkf-parameters" className="hover:text-blue-600 transition">
          Parameter KKF
        </Link>
        <span>/</span>
        <span className="text-slate-900 dark:text-slate-100 font-medium truncate max-w-xs">
          {set.name}
        </span>
      </div>

      {dialogError && <Alert kind="error">{dialogError}</Alert>}

      {/* Header Profile */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {set.name}
            </h1>
            <StatusBadge status={set.status} />
            {isCurrentActive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                Sedang Berlaku Aktif
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-mono">
            <span>Mulai Berlaku: <strong className="text-slate-700 dark:text-slate-200">{set.valid_from}</strong></span>
            {set.valid_until && (
              <span>s/d: <strong className="text-slate-700 dark:text-slate-200">{set.valid_until}</strong></span>
            )}
          </div>
          {set.notes && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
              {set.notes}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isDraft && canManage && (
            <button
              type="button"
              onClick={() => navigate(`/master-data/kkf-parameters/${id}/ubah`)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs shadow-xs transition-colors cursor-pointer"
            >
              <IconPencil size={14} />
              <span>Ubah Nilai Draf</span>
            </button>
          )}

          {isDraft && canApprove && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'approve' })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
            >
              <IconCheck size={14} />
              <span>Setujui Parameter</span>
            </button>
          )}

          {isApproved && canApprove && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'retire' })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
            >
              <IconTrash size={13} />
              <span>Nonaktifkan Set</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid of 9 Parameters */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Daftar 9 Nilai Parameter Kelayakan Keuangan (KKF)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {KKF_FIELDS.map((f) => {
            const rawVal = set[f.key]
            let formattedDisplay = '-'
            if (f.type === 'percent') {
              formattedDisplay = formatPercentDisplay(rawVal)
            } else if (f.key === 'bpp') {
              formattedDisplay = formatRupiahPerKwh(rawVal)
            } else {
              formattedDisplay = `${rawVal} ${f.unit || ''}`
            }

            return (
              <div
                key={f.key}
                className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-snug">
                    {f.label}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500">
                    {f.key}
                  </span>
                </div>

                <div className="pt-1">
                  <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                    {formattedDisplay}
                  </div>
                  {f.type === 'percent' && (
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      Nilai Pecahan: {Number(rawVal).toFixed(4)}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                  {f.help}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Event History / Audit Trail */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <IconHistory size={16} className="text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Riwayat Perubahan & Audit Trail
          </h3>
        </div>

        {(!set.events || set.events.length === 0) ? (
          <div className="p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-xs text-slate-400">
            Belum ada riwayat aktivitas tercatat pada set parameter ini.
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {set.events.map((ev, idx) => (
              <div key={idx} className="p-4 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                      {ev.event_type}
                    </span>
                    <span className="text-slate-400">oleh</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {ev.actor_email || 'Sistem'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                    <IconClock size={12} />
                    <span>{new Date(ev.occurred_at).toLocaleString('id-ID')}</span>
                  </div>
                </div>

                {ev.reason && (
                  <p className="text-slate-600 dark:text-slate-300 italic">
                    Alasan: &ldquo;{ev.reason}&rdquo;
                  </p>
                )}

                {ev.details && Object.keys(ev.details).length > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 font-mono text-[11px] text-slate-600 dark:text-slate-300 overflow-x-auto">
                    <pre>{JSON.stringify(ev.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Dialog with mandatory reason for Approve / Retire */}
      {dialog && (
        <ReasonDialog
          title={
            dialog.type === 'approve'
              ? `Setujui Parameter KKF: ${set.name}`
              : `Nonaktifkan Parameter KKF: ${set.name}`
          }
          description={
            dialog.type === 'approve'
              ? `Menyetujui set parameter ini akan mengubah statusnya menjadi APPROVED dan otomatis menutup set parameter aktif sebelumnya. Pembuat draf tidak dapat menyetujui set buatannya sendiri.`
              : `Menonaktifkan set parameter ini akan mengubah statusnya menjadi INACTIVE sehingga tidak lagi digunakan dalam perhitungan proyek baru.`
          }
          confirmLabel={dialog.type === 'approve' ? 'Setujui Parameter' : 'Nonaktifkan'}
          confirmVariant={dialog.type === 'approve' ? 'primary' : 'danger'}
          error={dialogError}
          onConfirm={handleConfirmAction}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}
    </div>
  )
}
