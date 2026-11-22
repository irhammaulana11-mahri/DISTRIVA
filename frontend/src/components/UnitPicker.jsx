import { useEffect, useMemo, useState } from 'react'
import { resolveUnitScope, useScopedUnits } from '../utils/unitScope.js'
import SearchSelect from './SearchSelect.jsx'

const unitLabel = (u) => (u.code ? `${u.code} - ${u.name}` : u.name)

/**
 * Pilihan unit untuk form isian: UP3 lalu ULP, keduanya dropdown dengan pencarian (SYS_ADMIN memilih bebas; peran lain hanya unit dalam cakupannya, terkunci bila hanya satu).
 * `level="ulp"`: nilai selalu sebuah ULP (UP3 hanya menyempitkan pilihan ULP). `level="any"`: nilai boleh UP3 atau ULP (ULP dibiarkan kosong = tingkat UP3).
 * `clearable`: isian opsional (ULP boleh dikosongkan). `onChange(id, unit)` juga memberi objek unitnya. `permission` = izin aksi form (menentukan cakupan peran); `units` = daftar datar cadangan { id, code, name, unit_type?, parent_id? } bila cakupan gagal dimuat.
 */
export default function UnitPicker({
  permission,
  value = '',
  onChange,
  level = 'ulp',
  units = [],
  required = false,
  clearable = false,
  disabled = false,
  up3AriaLabel = 'UP3',
  unitAriaLabel = 'ULP',
  className = '',
}) {
  const info = useScopedUnits(permission)
  const eff = useMemo(() => {
    if ((info.up3_units?.length || 0) + (info.ulp_units?.length || 0) > 0) return info
    return { scope: 'GLOBAL', up3_units: units.filter((u) => u.unit_type === 'UP3'), ulp_units: units.filter((u) => u.unit_type !== 'UP3') }
  }, [info, units])
  const up3Ids = useMemo(() => new Set(eff.up3_units.map((u) => u.id)), [eff])
  const known = useMemo(() => [...eff.ulp_units, ...eff.up3_units].find((u) => u.id === value) || null, [eff, value])
  const [up3, setUp3] = useState('')

  useEffect(() => {
    if (known) setUp3(up3Ids.has(known.id) ? known.id : known.parent_id || '')
  }, [known, up3Ids])

  const ulpPicked = value && !up3Ids.has(value) ? value : ''
  const s = resolveUnitScope(eff, up3, ulpPicked)

  useEffect(() => {
    if (level === 'ulp' && s.ulpLocked && value !== s.ulpValue) onChange?.(s.ulpValue)
  }, [level, s.ulpLocked, s.ulpValue, value, onChange])

  const up3Options = s.up3Options.filter((o) => o.value !== '')
  const ulpOptions = [
    ...(level === 'any' ? [{ value: '', label: 'Tingkat UP3 (tanpa ULP)' }] : []),
    ...s.ulpChoices.map((u) => ({ value: u.id, label: unitLabel(u) })),
  ]

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      <SearchSelect
        ariaLabel={up3AriaLabel}
        options={up3Options}
        value={s.up3Value}
        disabled={disabled || s.up3Locked}
        placeholder="Cari UP3…"
        onChange={(v) => {
          setUp3(v)
          if (level === 'any') onChange?.(v, eff.up3_units.find((u) => u.id === v))
          else if (ulpPicked && !s.ulpChoices.some((u) => u.id === ulpPicked && String(u.parent_id) === String(v))) onChange?.('')
        }}
      />
      <SearchSelect
        ariaLabel={unitAriaLabel}
        options={ulpOptions}
        value={s.ulpLocked ? s.ulpValue : ulpPicked}
        disabled={disabled || s.ulpLocked}
        required={required && level === 'ulp'}
        clearable={clearable && level === 'ulp'}
        placeholder="Cari ULP…"
        onChange={(v) => (level === 'any' && !v ? onChange?.(s.up3Value, eff.up3_units.find((u) => u.id === s.up3Value)) : onChange?.(v, eff.ulp_units.find((u) => u.id === v)))}
      />
    </div>
  )
}
