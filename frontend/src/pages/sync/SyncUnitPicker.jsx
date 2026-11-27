const TONE = {
  blue: {
    selected: 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30',
    link: 'text-blue-600 dark:text-blue-400',
  },
  emerald: {
    selected: 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30',
    link: 'text-emerald-600 dark:text-emerald-400',
  },
  purple: {
    selected: 'border-purple-300 bg-purple-50/60 dark:border-purple-800 dark:bg-purple-950/30',
    link: 'text-purple-600 dark:text-purple-400',
  },
  amber: {
    selected: 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30',
    link: 'text-amber-600 dark:text-amber-400',
  },
}

/**
 * Pemilih ULP seragam untuk tab Pusat Sinkronisasi Data.
 * Menampilkan badge "Akun Sendiri" vs "Ikut UP3" (bila tersedia) dan menyaring berdasarkan UP3 terpilih.
 */
export default function SyncUnitPicker({
  units = [],
  selected = [],
  onToggle,
  onSelectAll,
  onClear,
  disabled = false,
  up3Name = '',
  ulpAccounts = [],
  tone = 'blue',
  checkboxAriaPrefix = 'Sinkronkan',
  hint = '',
}) {
  if (!Array.isArray(units) || units.length === 0) return null

  const theme = TONE[tone] || TONE.blue
  const accountByKey = new Map()
  for (const acc of ulpAccounts) {
    if (acc.unit_id) accountByKey.set(acc.unit_id, acc)
    if (acc.code) accountByKey.set(acc.code, acc)
  }

  return (
    <fieldset aria-label="Unit yang disinkronkan" className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/40 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          ULP yang disinkronkan{up3Name ? ` · ${up3Name}` : ''}{' '}
          <span className="font-normal text-slate-500">
            ({selected.length} dari {units.length} dipilih)
          </span>
        </legend>
        {units.length > 1 && (
          <div className={`flex gap-3 text-[11px] font-semibold ${theme.link}`}>
            <button type="button" className="cursor-pointer hover:underline disabled:opacity-50" onClick={onSelectAll} disabled={disabled}>
              Pilih semua
            </button>
            <button type="button" className="cursor-pointer hover:underline disabled:opacity-50" onClick={onClear} disabled={disabled}>
              Kosongkan
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
        {units.map((u) => {
          const code = u.code || u.id
          const isChecked = selected.includes(code)
          const acc = accountByKey.get(u.id) || accountByKey.get(u.code)
          return (
            <label
              key={code}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition ${
                isChecked
                  ? theme.selected
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(code)}
                  disabled={disabled}
                  aria-label={`${checkboxAriaPrefix} ${u.code ? `${u.code} ` : ''}${u.name}`}
                />
                {u.code && <span className="font-mono text-[11px] text-slate-500 shrink-0">{u.code}</span>}
                <span className="truncate font-medium text-slate-800 dark:text-slate-200">{u.name}</span>
              </span>
              {acc && (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                    acc.has_own_account
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {acc.has_own_account ? 'Akun Sendiri' : 'Ikut UP3'}
                </span>
              )}
            </label>
          )
        })}
      </div>

      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </fieldset>
  )
}
