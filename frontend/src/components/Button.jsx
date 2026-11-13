// Shared button component with consistent styling across the application.
// Variants: primary, secondary, outline, danger, warning, success, ghost. Sizes: xs, sm, md, lg.

const base = 'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'

const variants = {
  primary:   'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-xs',
  secondary: 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/70 active:bg-slate-100',
  outline:   'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/70 active:bg-slate-100',
  danger:    'border border-red-300 dark:border-red-800 bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-xs',
  warning:   'border border-amber-300 dark:border-amber-800 bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800 shadow-xs',
  success:   'border border-emerald-500 dark:border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-xs',
  ghost:     'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 active:bg-slate-200',
}

const sizes = {
  xs: 'rounded-lg px-2.5 py-1 text-xs',
  sm: 'rounded-lg px-3 py-1.5 text-xs',
  md: 'rounded-lg px-3.5 py-2 text-sm',
  lg: 'rounded-xl px-5 py-2.5 text-sm',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  loading = false,
  icon: IconComponent,
  children,
  className = '',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={loading || props.disabled}
      className={`${base} ${variants[variant] ?? variants.primary} ${sizes[size] ?? sizes.md} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : IconComponent ? (
        <IconComponent size={size === 'xs' || size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
      ) : null}
      {children}
    </button>
  )
}
