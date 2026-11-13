// Waktu pengukuran gardu: tanggal DAN jam (16 Nov 2026). Server mengirim `measured_at` berzona WIB (mis. 2026-11-09T19:59:05+07:00);
// pembacaan lama yang hanya mengenal tanggal tampil tanggalnya saja.
export function readingTime(r) {
  if (r?.measured_at) return `${r.measured_at.slice(0, 10)} ${r.measured_at.slice(11, 16)}`
  return r?.measured_on || '-'
}
