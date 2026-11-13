import { useMemo } from 'react'
import { generateQrMatrix } from '../utils/qr.js'

export default function QrCode({ value, size = 180, margin = 3, className = '' }) {
  const result = useMemo(() => {
    if (!value) return null
    try {
      return generateQrMatrix(value)
    } catch {
      return null
    }
  }, [value])

  if (!result) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-xl bg-slate-100 text-slate-400 text-xs p-3 text-center border border-slate-200 ${className}`}
      >
        QR Code tidak dapat dirender
      </div>
    )
  }

  const { size: qrSize, matrix } = result
  const totalSize = qrSize + margin * 2

  // Build SVG path string for all dark modules
  let pathD = ''
  for (let r = 0; r < qrSize; r++) {
    for (let c = 0; c < qrSize; c++) {
      if (matrix[r][c] === 1) {
        pathD += `M${c + margin},${r + margin}h1v1h-1z `
      }
    }
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center p-2 rounded-2xl bg-white shadow-xs border border-slate-200/90 ${className}`}
      aria-label="QR Code Autentikasi Dua Faktor"
    >
      <svg
        viewBox={`0 0 ${totalSize} ${totalSize}`}
        className="w-full h-full"
        shapeRendering="crispEdges"
      >
        <rect width={totalSize} height={totalSize} fill="#ffffff" />
        <path d={pathD} fill="#0f172a" />
      </svg>
    </div>
  )
}
