import { useEffect, useMemo, useState } from 'react'
import * as api from '../services/api.js'

const unitLabel = (u) => (u.code ? `${u.code} - ${u.name}` : u.name)

/**
 * Aturan filter UP3 / ULP di semua halaman:
 * - UP3: sys admin (GLOBAL) memilih bebas dengan pencarian, bawaan "Semua UP3"; peran lain hanya UP3 unitnya (terkunci bila hanya satu).
 * - ULP: sys admin bawaan "Semua ULP"; bila UP3 dipilih, hanya ULP di bawahnya. Peran ULP hanya ULP unitnya (terkunci bila satu); peran UP3 semua ULP di bawah UP3-nya.
 * `info` = jawaban /scoped-units: { scope, up3_units, ulp_units }.
 */
export function resolveUnitScope(info, up3Filter = '', unitFilter = '') {
  const up3Units = info?.up3_units || []
  const ulpUnits = info?.ulp_units || []
  const isGlobal = info?.scope === 'GLOBAL'
  const up3Locked = !isGlobal && up3Units.length === 1
  const up3Value = up3Locked ? up3Units[0].id : up3Filter
  const ulpChoices = ulpUnits.filter((u) => !up3Value || String(u.parent_id) === String(up3Value))
  const ulpLocked = !isGlobal && info?.scope === 'ULP' && ulpChoices.length === 1
  const ulpValue = ulpLocked ? ulpChoices[0].id : unitFilter
  return {
    isGlobal,
    up3Locked,
    up3Value,
    up3Options: [...(up3Locked ? [] : [{ value: '', label: 'Semua UP3' }]), ...up3Units.map((u) => ({ value: u.id, label: unitLabel(u) }))],
    ulpLocked,
    ulpValue,
    ulpChoices,
    ulpOptions: [...(ulpLocked ? [] : [{ value: '', label: 'Semua ULP' }]), ...ulpChoices.map((u) => ({ value: u.id, label: unitLabel(u) }))],
  }
}

/** Memuat pilihan UP3 / ULP sesuai peran untuk izin halaman; bila gagal, daftar unit umum dipakai sebagai cadangan. */
export function useScopedUnits(permission) {
  const [info, setInfo] = useState({ scope: '', up3_units: [], ulp_units: [] })
  useEffect(() => {
    let live = true
    const call = (name, fn) => { try { return api[name]?.[fn]?.() } catch { return undefined } }   // sebuah modul api tiruan boleh tidak memuatnya
    const fallback = () => Promise.resolve(call('adminApi', 'units'))
      .then((d) => {
        const all = d?.data || []
        if (live && all.length > 0) setInfo({ scope: 'GLOBAL', up3_units: all.filter((u) => u.unit_type === 'UP3'), ulp_units: all.filter((u) => u.unit_type === 'ULP') })
      })
      .catch(() => {})
    let first
    try { first = api.unitScopeApi?.get?.(permission) } catch { first = undefined }
    Promise.resolve(first)
      .then((res) => {
        if (!live) return
        const d = res?.data?.scope ? res.data : res
        if (d && d.scope) setInfo({ scope: d.scope, up3_units: d.up3_units || [], ulp_units: d.ulp_units || [], default_up3_id: d.default_up3_id, default_unit_id: d.default_unit_id })
        else fallback()
      })
      .catch(fallback)
    return () => { live = false }
  }, [permission])
  return info
}

/** Hasil resolveUnitScope yang diingat untuk satu set pilihan. */
export function useUnitScope(info, up3Filter, unitFilter) {
  return useMemo(() => resolveUnitScope(info, up3Filter, unitFilter), [info, up3Filter, unitFilter])
}
