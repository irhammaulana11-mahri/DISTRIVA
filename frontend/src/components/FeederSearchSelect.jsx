import { useEffect, useMemo, useState } from 'react'
import { feedersApi } from '../services/api.js'
import { useScopedUnits, useUnitScope } from '../utils/unitScope.js'
import SearchSelect from './SearchSelect.jsx'

/**
 * Filter dropdown pencarian penyulang (Feeder SearchSelect):
 * - Tampil sesuai role:
 *   - Role ULP: hanya penyulang di ULP tersebut (terkunci ke ULP aktor).
 *   - Role UP3: semua penyulang di UP3 tersebut; bila ULP tertentu dipilih, menyempit ke penyulang di ULP itu.
 *   - Role SYS_ADMIN (GLOBAL): bisa pilih Semua UP3 & Semua ULP. Bila UP3 dipilih, hanya penyulang di UP3 itu;
 *     bila ditambah pilihan ULP, menyempit ke penyulang di ULP tersebut.
 * - Dilengkapi input pencarian teks di dalam dropdown (combobox).
 */
export default function FeederSearchSelect({
  permission = 'substations.view',
  up3Id = '',
  unitId = '',
  value = '',
  onChange,
  disabled = false,
  className = 'w-52',
  ariaLabel = 'Penyulang',
  placeholder = 'Cari penyulang…',
  onFeedersLoaded,
  feedersList: externalFeeders,
}) {
  const info = useScopedUnits(permission)
  const s = useUnitScope(info, up3Id, unitId)
  const [feeders, setFeeders] = useState(externalFeeders || [])
  const [loading, setLoading] = useState(false)

  // Nilai UP3 & ULP efektif sesuai cakupan peran pengguna
  const effectiveUp3 = s.up3Value || ''
  const effectiveUlp = s.ulpValue || ''

  useEffect(() => {
    let active = true
    setLoading(true)

    const params = {
      per_page: 500,
    }
    if (effectiveUlp) {
      params.serves_unit_id = effectiveUlp
    } else if (effectiveUp3) {
      params.up3_id = effectiveUp3
    }

    feedersApi
      .list(params)
      .then((res) => {
        if (!active) return
        const list = res?.data || []
        setFeeders(list)
        onFeedersLoaded?.(list)

        // Bila nilai saat ini tidak ada di daftar baru, kembalikan ke kosong (Semua penyulang)
        if (value && !list.some((f) => f.id === value || f.code === value)) {
          onChange?.('')
        }
      })
      .catch(() => {
        if (!active) return
        setFeeders([])
        onFeedersLoaded?.([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [effectiveUp3, effectiveUlp])

  // Filter client-side bila data memuat served_units / owner_unit_id
  const filtered = useMemo(() => {
    if (!Array.isArray(feeders)) return []
    return feeders.filter((f) => {
      if (effectiveUlp) {
        if (f.owner_unit_id === effectiveUlp) return true
        if (Array.isArray(f.served_units) && f.served_units.length > 0) {
          return f.served_units.some((u) => u.id === effectiveUlp || u.code === effectiveUlp)
        }
        return true
      }
      if (effectiveUp3) {
        if (f.owner_unit_id === effectiveUp3) return true
        if (Array.isArray(f.served_units) && f.served_units.length > 0) {
          const ulpIds = new Set((s.ulpChoices || []).map((u) => u.id))
          return f.served_units.some((u) => ulpIds.has(u.id))
        }
        return true
      }
      return true
    })
  }, [feeders, effectiveUp3, effectiveUlp, s.ulpChoices])

  const options = useMemo(() => {
    const list = [
      { value: '', label: 'Semua penyulang' },
      ...filtered.map((f) => ({
        value: f.id,
        label: `${f.code}${f.name ? ` (${f.name})` : ''}`,
        search: `${f.code} ${f.name || ''} ${f.gi_code || ''} ${f.gi_name || ''}`,
      })),
    ]
    return list
  }, [filtered])

  return (
    <SearchSelect
      variant="filter"
      ariaLabel={ariaLabel}
      options={options}
      value={value}
      disabled={disabled || loading}
      onChange={(v) => onChange?.(v)}
      placeholder={loading ? 'Memuat penyulang…' : placeholder}
      className={className}
    />
  )
}
