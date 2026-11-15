/**
 * Hasil satu gudang pada penarikan MIMS: gabungan stok (bila dipilih), pengeluaran, penerimaan, dan reservasi.
 * `r.status` hanya status stok; bila stok tidak dipilih nilainya SKIPPED walaupun dokumen lain berhasil ditarik.
 * @returns {'OK'|'PARTIAL'|'FAILED'|'SKIPPED'}
 */
export function warehouseOutcome(r) {
  const parts = [r.status === 'SKIPPED' ? null : r, r.issues, r.receipts, r.reservations].filter(Boolean)
  const ok = parts.filter((p) => p.status === 'OK').length
  const failed = parts.filter((p) => p.status !== 'OK' && p.status !== 'SKIPPED').length
  if (failed === 0) return ok > 0 ? 'OK' : 'SKIPPED'
  return ok > 0 ? 'PARTIAL' : 'FAILED'
}

export const OUTCOME_LABEL = { OK: 'SELESAI', PARTIAL: 'SEBAGIAN', FAILED: 'GAGAL', SKIPPED: 'DILEWATI' }
