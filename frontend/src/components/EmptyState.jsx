import { IconInbox } from './icons.jsx'

/**
 * Standardized EmptyState component matching DISTRIVA Design System
 * Displays an icon in a rounded container, a bold title, contextual description, and optional action button.
 */
export default function EmptyState({
  icon: Icon = IconInbox,
  title = 'Belum ada data',
  description,
  action,
  className = '',
}) {
  return (
    <div className={`py-12 sm:py-16 text-center px-4 ${className}`}>
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-3 shadow-2xs">
        {Icon ? <Icon size={24} /> : null}
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</p>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
