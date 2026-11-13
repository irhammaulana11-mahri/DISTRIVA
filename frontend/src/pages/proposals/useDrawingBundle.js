import { useEffect, useState } from 'react'
import { drawingApi, mtoApi } from '../../services/api.js'

const EMPTY = { loading: false, drawing: null, version: null, mto: null, canExecute: false }

/**
 * Paket gambar usulan (+ versi terbaru + MTO-nya) diambil SEKALI per halaman dan dibagikan ke rantai persetujuan, linimasa riwayat,
 * dan tab Gambar, supaya satu halaman tidak menembak endpoint yang sama berulang kali. `reloadKey` memaksa muat ulang (mis. setelah keputusan).
 */
export default function useDrawingBundle(representativeApplicationId, reloadKey = 0, enabled = true) {
  const [state, setState] = useState({ ...EMPTY, loading: Boolean(enabled && representativeApplicationId) })

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    if (!representativeApplicationId) {
      setState(EMPTY)
      return undefined
    }
    setState((s) => ({ ...s, loading: true }))
    ;(async () => {
      try {
        const pkg = (await drawingApi.forApplication(representativeApplicationId))?.data
        if (!pkg) throw new Error('none')
        const drawing = (await drawingApi.get(pkg.id))?.data || pkg
        const version = drawing.versions?.[drawing.versions.length - 1] || null
        let mto = null
        if (version) {
          try { mto = (await mtoApi.forVersion(drawing.id, version.id))?.data || null } catch { mto = null }
        }
        if (alive) setState({ loading: false, drawing, version, mto, canExecute: Boolean(drawing.can?.execute && version?.status === 'DRAFT') })
      } catch {
        if (alive) setState(EMPTY)
      }
    })()
    return () => { alive = false }
  }, [representativeApplicationId, reloadKey, enabled])

  return state
}
