import { useEffect, useRef } from 'react'
import { IconX } from './icons.jsx'

export default function Modal({
  title,
  onClose,
  onCancel,
  open,
  isOpen,
  footer,
  width,
  maxWidth,
  size,
  children,
}) {
  const ref = useRef(null)
  const isModalOpen = open ?? isOpen ?? true
  const handleClose = onClose || onCancel
  const panelWidth = width || maxWidth || size || 'max-w-md'

  const handleCloseRef = useRef(handleClose)
  handleCloseRef.current = handleClose

  useEffect(() => {
    if (!isModalOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') handleCloseRef.current?.()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('input, select, textarea, button:not([data-modal-close])')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [isModalOpen])

  if (!isModalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${panelWidth} max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-2xl my-auto`}
      >
        <div className="mb-3 flex items-start justify-between gap-3 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug break-words">
            {title}
          </h3>
          {handleClose && (
            <button
              type="button"
              data-modal-close="true"
              onClick={handleClose}
              aria-label="Tutup dialog"
              title="Tutup (Esc)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
            >
              <IconX size={16} />
            </button>
          )}
        </div>
        <div className="overflow-y-auto min-h-0 flex-1 pr-0.5">
          {children}
        </div>
        {footer && (
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
