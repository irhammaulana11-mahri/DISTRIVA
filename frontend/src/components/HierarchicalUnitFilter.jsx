import { useEffect, useState, useMemo } from 'react'
import * as api from '../services/api.js'

/**
 * Reusable Hierarchical UP3 -> ULP Dropdown Filter
 * 
 * Sesuai aturan wewenang DISTRIVA:
 * - sys_admin / role global: bisa melihat seluruh UP3 dan seluruh Unit (ULP)
 *   melalui filter berjenjang: Pilih UP3 -> Dropdown ULP otomatis disaring hanya untuk UP3 tsb.
 * - ULP dependent: dropdown ULP hanya menampilkan unit di bawah UP3 yang dipilih.
 */
export default function HierarchicalUnitFilter({
  units: externalUnits,
  up3Id = '',
  onUp3Change,
  unitId = '',
  onUnitChange,
  allUp3Label = 'Semua UP3',
  allUnitLabel = 'Semua unit',
  up3AriaLabel = 'Filter Unit UP3',
  unitAriaLabel = 'Unit',
  selectClassName = 'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100',
  disabled = false,
  showLabels = false,
}) {
  const [internalUnits, setInternalUnits] = useState([])

  useEffect(() => {
    if (externalUnits && Array.isArray(externalUnits) && externalUnits.length > 0) {
      setInternalUnits(externalUnits)
      return
    }
    let active = true
    let adminUnitsFn = null
    try {
      if (api && 'adminApi' in api && api.adminApi && typeof api.adminApi.units === 'function') {
        adminUnitsFn = api.adminApi.units
      }
    } catch {
      adminUnitsFn = null
    }
    if (adminUnitsFn) {
      try {
        const res = adminUnitsFn()
        if (res && typeof res.then === 'function') {
          res
            .then((data) => {
              if (!active) return
              setInternalUnits(data?.data || [])
            })
            .catch(() => {})
        } else if (res && Array.isArray(res?.data)) {
          setInternalUnits(res.data)
        }
      } catch {}
    }
    return () => {
      active = false
    }
  }, [externalUnits])

  const units = (externalUnits && externalUnits.length > 0) ? externalUnits : internalUnits

  const up3Units = useMemo(() => {
    const list = units.filter((u) => u.unit_type === 'UP3' || (!u.unit_type && !u.parent_id))
    return list.length > 0 ? list : units
  }, [units])

  const ulpUnits = useMemo(() => {
    const list = units.filter((u) => u.unit_type === 'ULP' || (!u.unit_type && Boolean(u.parent_id)))
    return list.length > 0 ? list : units
  }, [units])

  // Filter ULP berdasarkan UP3 yang sedang dipilih
  const availableUlps = useMemo(() => {
    if (up3Id) {
      const matched = ulpUnits.filter((u) => u.parent_id && String(u.parent_id) === String(up3Id))
      return matched.length > 0 ? matched : ulpUnits
    }
    return ulpUnits
  }, [ulpUnits, up3Id])

  const selectedUp3 = useMemo(() => {
    return up3Units.find((u) => String(u.id) === String(up3Id)) || null
  }, [up3Units, up3Id])

  const handleUp3Select = (newUp3) => {
    if (onUp3Change) onUp3Change(newUp3)
    if (!newUp3) {
      if (onUnitChange) onUnitChange('')
    } else {
      // Jika unitId yang sedang aktif tidak berada di bawah UP3 yang baru dipilih, reset
      const isStillChild = ulpUnits.some(
        (u) => String(u.id) === String(unitId) && (!u.parent_id || String(u.parent_id) === String(newUp3))
      )
      if (!isStillChild && onUnitChange) {
        onUnitChange('')
      }
    }
  }

  return (
    <>
      {/* 1. Dropdown Filter UP3 */}
      <div className="flex items-center gap-1.5">
        {showLabels && <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">UP3:</span>}
        <select
          aria-label={up3AriaLabel}
          value={up3Id}
          disabled={disabled}
          onChange={(e) => handleUp3Select(e.target.value)}
          className={`${selectClassName} ${disabled ? 'opacity-80 cursor-not-allowed bg-slate-100 dark:bg-slate-800/60' : ''}`}
        >
          <option value="">{allUp3Label}</option>
          {up3Units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code ? `${u.code} - ${u.name}` : u.name}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Dropdown Filter Unit (ULP) */}
      <div className="flex items-center gap-1.5">
        {showLabels && <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Unit:</span>}
        <select
          aria-label={unitAriaLabel}
          value={unitId}
          disabled={disabled}
          onChange={(e) => onUnitChange && onUnitChange(e.target.value)}
          className={`${selectClassName} ${disabled ? 'opacity-80 cursor-not-allowed bg-slate-100 dark:bg-slate-800/60' : ''}`}
        >
          <option value="">
            {up3Id
              ? `Semua Unit di ${selectedUp3 ? selectedUp3.name : 'UP3 Terpilih'}`
              : allUnitLabel}
          </option>
          {availableUlps.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code ? `${u.code} - ${u.name}` : u.name}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
