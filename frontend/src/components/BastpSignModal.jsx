import { useState } from 'react'
import Modal from './Modal.jsx'
import Alert from './Alert.jsx'
import Button from './Button.jsx'
import { IconShield, IconLock } from './icons.jsx'

/**
 * BastpSignModal (docs/62 §36, docs/73 §6 & docs/57)
 * Re-confirms the signer's account password to generate an electronic signature.
 * Password is NEVER saved or persisted in client state.
 */
export default function BastpSignModal({
  open = false,
  onClose,
  title = 'Tanda Tangan Elektronik BASTP',
  description = 'Konfirmasikan kata sandi akun Anda untuk membubuhkan tanda tangan elektronik pada dokumen BASTP ini.',
  confirmLabel = 'Tanda Tangani',
  onConfirm,
  loading = false,
  error = '',
}) {
  const [password, setPassword] = useState('')
  const [validationError, setValidationError] = useState('')

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!password) {
      setValidationError('Kata sandi akun wajib diisi.')
      return
    }
    setValidationError('')
    await onConfirm(password)
  }

  const handleClose = () => {
    setPassword('')
    setValidationError('')
    onClose?.()
  }

  return (
    <Modal
      open={true}
      onClose={handleClose}
      title={title}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {description && (
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        )}

        {(error || validationError) && (
          <Alert variant="danger">
            {error || validationError}
          </Alert>
        )}

        <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-2.5">
          <IconShield size={16} className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div>
            <span className="font-bold block">Tanda Tangan Elektronik Terproteksi</span>
            <span>
              Sistem akan memverifikasi kata sandi akun Anda dan menghasilkan sidik jari HMAC 16-karakter atas dokumen BASTP.
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="bastp-sign-password"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Kata Sandi Akun
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <IconLock size={14} />
            </span>
            <input
              id="bastp-sign-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan kata sandi akun Anda"
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Batal
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
