// Hasil per unit dari log sinkronisasi EIS (alat di tools/eis_sync mencetak penanda per unit); dipakai untuk kartu ringkasan dan tabel hasil.
const HEADER = /^=== Unit (\d+)\/(\d+): (\S+)(?: (.*?))? ===$/
const DONE = /^Unit (\S+) selesai \((\d+) berkas\)/
const FAILED = /^Unit (\S+) GAGAL: (.*)$/
const COUNTS = /baru (\d+), cocok (\d+), tak berubah (\d+), ditolak (\d+)(?:, di luar cakupan (\d+))?/

const blank = (code, name) => ({ code, name: name || '', state: 'QUEUED', files: 0, baru: 0, cocok: 0, tak: 0, ditolak: 0, luar: 0, message: '', applied: false })

function addCounts(row, line) {
  const m = COUNTS.exec(line)
  if (!m) return
  row.baru += +m[1]; row.cocok += +m[2]; row.tak += +m[3]; row.ditolak += +m[4]; row.luar += +(m[5] || 0)
}

/**
 * @param {string|null} log
 * @param {Array<{code:string,name:string}>} units  semua unit EIS (untuk nama)
 * @param {string[]|null} chosen kode unit run ini (null = semua)
 * @param {string} status status run (QUEUED|RUNNING|OK|FAILED)
 */
export function parseEisRun(log, units = [], chosen = null, status = 'RUNNING') {
  const names = Object.fromEntries(units.map((u) => [u.code, u.name]))
  const rows = []
  const total = blank('', '')            // seluruh run, termasuk run tanpa penanda unit
  let cur = null
  let planned = 0
  for (const raw of String(log || '').split('\n')) {
    const line = raw.trim()
    const h = HEADER.exec(line)
    if (h) {
      cur = blank(h[3], h[4] || names[h[3]])
      cur.state = 'RUNNING'
      planned = +h[2]
      rows.push(cur)
      continue
    }
    const d = DONE.exec(line)
    if (d) {
      const r = rows.find((x) => x.code === d[1])
      if (r) { r.state = 'OK'; r.files = +d[2] }
      continue
    }
    const f = FAILED.exec(line)
    if (f) {
      const r = rows.find((x) => x.code === f[1])
      if (r) { r.state = 'FAILED'; r.message = f[2] }
      continue
    }
    if (/^(Diterapkan|Tersimpan sementara)/.test(line) && COUNTS.test(line)) {
      const applied = line.startsWith('Diterapkan')
      const target = cur || total
      if (applied || !target.applied) {
        if (applied && !target.applied) { target.baru = target.cocok = target.tak = target.ditolak = target.luar = 0 }
        target.applied = target.applied || applied
        addCounts(target, line)
      }
    }
  }
  const wanted = (chosen && chosen.length ? chosen : units.map((u) => u.code))
  const seen = new Set(rows.map((r) => r.code))
  const pending = planned > 0 || rows.length > 0
    ? wanted.filter((c) => !seen.has(c)).map((c) => blank(c, names[c]))
    : []
  const live = ['QUEUED', 'RUNNING'].includes(status)
  const all = [...rows, ...pending].map((r) => (r.state === 'RUNNING' && !live ? { ...r, state: status === 'OK' ? 'OK' : 'FAILED' } : r))
  const sum = (key) => (rows.length ? all.reduce((a, r) => a + r[key], 0) : total[key])
  return {
    perUnit: all.length > 0,
    rows: all,
    totalUnits: Math.max(planned, all.length),
    doneUnits: all.filter((r) => r.state === 'OK').length,
    failedUnits: all.filter((r) => r.state === 'FAILED').length,
    position: rows.length,
    baru: sum('baru'), cocok: sum('cocok'), ditolak: sum('ditolak'), luar: sum('luar'),
  }
}
