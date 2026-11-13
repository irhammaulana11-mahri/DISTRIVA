import { useState, useEffect } from 'react'
import Modal from './Modal.jsx'
import Alert from './Alert.jsx'
import Button from './Button.jsx'
import { IconExclamation, IconTrash, IconPower } from './icons.jsx'
import { useNotifications } from '../features/notifications/NotificationContext.jsx'

/**
 * Reusable Confirmation Modal
 * Supports 'danger' (destructive deletion) and 'warning' (status deactivation with audit reason)
 * Can be reused across any page in the application.
 */
export default function ConfirmationModal({
  open = true,
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmText,
  cancelLabel = 'Batal',
  variant = 'danger', // 'danger' | 'warning' | 'info'
  requireReason = false,
  requiresReason = false,
  reasonLabel,
  reasonPrompt,
  reasonPlaceholder = 'Masukkan alasan tindakan ini untuk pencatatan riwayat audit…',
  itemName,
  error: externalError,
  loading: externalLoading = false,
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useNotifications()

  const isModalOpen = Boolean(open ?? isOpen ?? true)
  const handleClose = onClose || onCancel
  const resolvedConfirmLabel = confirmLabel || confirmText || 'Konfirmasi'
  const resolvedRequireReason = Boolean(requireReason || requiresReason)
  const resolvedReasonLabel = reasonLabel || reasonPrompt || 'Alasan Tindakan (Audit Log)'
  const isBusy = Boolean(busy || externalLoading)
  const displayError = externalError || error

  useEffect(() => {
    if (isModalOpen) {
      setReason('')
      setError('')
      setBusy(false)
    }
  }, [isModalOpen, title])

  if (!isModalOpen) return null

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    setError('')

    if (resolvedRequireReason && !reason.trim()) {
      setError('Alasan tindakan wajib diisi untuk kepatuhan audit log.')
      return
    }

    setBusy(true)
    try {
      await onConfirm(reason.trim())
      handleClose?.()
    } catch (err) {
      const msg = err?.message || 'Terjadi kesalahan saat memproses tindakan.'
      setError(msg)
      notify({
        type: 'error',
        title: 'Proses Gagal',
        desc: msg,
        tag: 'Sistem',
      })
    } finally {
      setBusy(false)
    }
  }

  const isDanger = variant === 'danger'
  const isWarning = variant === 'warning'

  return (
    <Modal title={title} onClose={handleClose} open={isModalOpen}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {displayError && <Alert kind="error">{displayError}</Alert>}

        {/* Visual Callout Box with Variant Icon */}
        <div
          className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs leading-relaxed ${
            isDanger
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300'
              : isWarning
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-800 dark:text-blue-300'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {isDanger ? (
              <IconTrash size={18} className="text-rose-600 dark:text-rose-400" />
            ) : isWarning ? (
              <IconPower size={18} className="text-amber-600 dark:text-amber-400" />
            ) : (
              <IconExclamation size={18} className="text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <div>
            {itemName && (
              <p className="font-bold mb-1 text-slate-900 dark:text-slate-100">
                {itemName}
              </p>
            )}
            <p>{description}</p>
          </div>
        </div>

        {/* Reason Input (Audit Log) if required */}
        {resolvedRequireReason && (
          <div>
            <label
              htmlFor="reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              {resolvedReasonLabel}
            </label>
            <textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              className="block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus-ring"
            />
          </div>
        )}

        {/* Footer Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => handleClose?.()}
            disabled={isBusy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={isDanger ? 'danger' : isWarning ? 'warning' : 'primary'}
            size="sm"
            type="submit"
            loading={isBusy}
          >
            {resolvedConfirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
