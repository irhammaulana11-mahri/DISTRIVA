import { useState, useEffect } from 'react'
import Modal from './Modal.jsx'
import Alert from './Alert.jsx'
import Button from './Button.jsx'
import { useNotifications } from '../features/notifications/NotificationContext.jsx'

// Confirmation for important actions; the reason is required and sent to the audit trail.
export default function ReasonDialog({
  open,
  isOpen,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  confirmVariant = 'primary',
  error: externalError,
  loading: externalLoading = false,
  onConfirm,
  onClose,
  onCancel,
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useNotifications()

  const isDialogOpen = open ?? isOpen ?? true
  const handleClose = onClose || onCancel
  const isBusy = Boolean(busy || externalLoading)
  const displayError = externalError || error

  useEffect(() => {
    if (isDialogOpen) {
      setError('')
      setBusy(false)
    }
  }, [isDialogOpen, title])

  if (!isDialogOpen) return null

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Alasan wajib diisi.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
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

  return (
    <Modal title={title} onClose={handleClose} open={isDialogOpen}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {description && (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {description}
          </p>
        )}
        {displayError && <Alert kind="error">{displayError}</Alert>}
        <div>
          <label
            htmlFor="reason"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Alasan
          </label>
          <textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Masukkan alasan tindakan ini..."
            className="mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-ring"
          />
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => handleClose?.()}
            disabled={isBusy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={confirmVariant}
            size="sm"
            disabled={isBusy}
          >
            {isBusy ? 'Memproses…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
