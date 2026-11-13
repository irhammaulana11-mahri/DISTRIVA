import { useEffect, useState } from 'react'
import { adminApi } from '../../services/api.js'

/** Unit penugasan yang dapat dipilih untuk akun vendor baru; hanya dimuat untuk SYS_ADMIN (pengguna lain memakai unit penugasannya sendiri). */
export default function useAccountUnits(enabled) {
  const [units, setUnits] = useState([])
  useEffect(() => {
    if (!enabled || typeof adminApi?.units !== 'function') return
    let alive = true
    Promise.resolve(adminApi.units({ per_page: 100 }))
      .then((d) => alive && setUnits((d?.data ?? []).filter((u) => u.is_active)))
      .catch(() => alive && setUnits([]))
    return () => { alive = false }
  }, [enabled])
  return units
}
