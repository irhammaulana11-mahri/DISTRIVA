import { useScopedUnits, useUnitScope } from '../utils/unitScope.js'
import SearchSelect from './SearchSelect.jsx'

/**
 * Filter UP3 -> ULP dengan pencarian, seragam di semua halaman (aturan di utils/unitScope.js):
 * sys admin memilih bebas (bawaan Semua UP3 / Semua ULP, ULP menyempit ke UP3 terpilih); peran lain hanya unitnya,
 * peran UP3 melihat semua ULP di bawahnya. `permission` = izin lihat halaman (menentukan cakupan peran).
 */
export default function HierarchicalUnitFilter({
  permission,
  up3Id = '',
  onUp3Change,
  unitId = '',
  onUnitChange,
  up3AriaLabel = 'Filter Unit UP3',
  unitAriaLabel = 'Unit',
  disabled = false,
  showLabels = false,
  className = 'w-44',
}) {
  const info = useScopedUnits(permission)
  const s = useUnitScope(info, up3Id, unitId)
  const label = (text) => showLabels && <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{text}</span>

  return (
    <>
      <div className="flex items-center gap-1.5">
        {label('UP3:')}
        <SearchSelect variant="filter"
          ariaLabel={up3AriaLabel}
          options={s.up3Options}
          value={s.up3Value}
          disabled={disabled || s.up3Locked}
          onChange={(v) => { onUp3Change?.(v); onUnitChange?.('') }}
          placeholder="Cari UP3…"
          className={className}
        />
      </div>
      <div className="flex items-center gap-1.5">
        {label('ULP:')}
        <SearchSelect variant="filter"
          ariaLabel={unitAriaLabel}
          options={s.ulpOptions}
          value={s.ulpValue}
          disabled={disabled || s.ulpLocked}
          onChange={(v) => onUnitChange?.(v)}
          placeholder="Cari ULP…"
          className={className}
        />
      </div>
    </>
  )
}
