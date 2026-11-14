import { useEffect, useRef } from 'react'
import { IconX } from './icons.jsx'

const SIZE_CLASSES = {
  'max-w-sm': 'sm:max-w-sm',
  'max-w-md': 'sm:max-w-md',
  'max-w-lg': 'sm:max-w-lg',
  'max-w-xl': 'sm:max-w-xl',
  'max-w-2xl': 'sm:max-w-2xl',
  'max-w-3xl': 'sm:max-w-3xl',
  'max-w-4xl': 'sm:max-w-4xl',
  'max-w-5xl': 'sm:max-w-5xl',
  'max-w-6xl': 'sm:max-w-6xl',
  'max-w-7xl': 'sm:max-w-7xl',
}

export default function Drawer({
  open,
  isOpen,
  onClose,
  onCancel,
  title,
  subtitle,
  eyebrow,
  children,
  footer,
  size = 'max-w-xl',
  width,
}) {
  const isDrawerOpen = Boolean(open ?? isOpen)
  const handleClose = onClose || onCancel
  const rawSize = width || size || 'max-w-xl'
  const desktopSizeClass = SIZE_CLASSES[rawSize] || rawSize

  const panelRef = useRef(null)

  // Keyboard navigation: Escape key to close and Tab/Shift+Tab focus trap
  useEffect(() => {
    if (!isDrawerOpen) return
    const prevFocused = document.activeElement

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose?.()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll(
            'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true')

        if (focusable.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    const initialTarget = panelRef.current?.querySelector('input, select, textarea, button:not([aria-label="Tutup drawer"])')
    initialTarget?.focus()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (prevFocused && typeof prevFocused.focus === 'function') {
        try { prevFocused.focus() } catch { /* ignore */ }
      }
    }
  }, [isDrawerOpen, handleClose])

  if (!isDrawerOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer Panel Container */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full justify-end pl-0 sm:pl-10 pointer-events-none">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          className={`pointer-events-auto w-full max-w-full ${desktopSizeClass} bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300 ease-in-out`}
        >
          {/* Drawer Header */}
          <div className="px-4 py-3.5 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-start justify-between gap-3 sm:gap-4 shrink-0">
            <div className="flex-1 min-w-0 pr-1">
              {eyebrow && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-0.5">
                  {eyebrow}
                </span>
              )}
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight break-words">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                  {subtitle}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label="Tutup drawer"
              title="Tutup (Esc)"
              className="p-2 sm:p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition cursor-pointer shrink-0 touch-manipulation"
            >
              <IconX size={18} />
              <span className="sr-only">Tutup drawer</span>
            </button>
          </div>

          {/* Drawer Scrollable Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4 sm:space-y-6">
            {children}
          </div>

          {/* Drawer Footer (if provided) */}
          {footer && (
            <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 shrink-0">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
