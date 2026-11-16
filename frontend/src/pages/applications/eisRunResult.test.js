import { describe, it, expect } from 'vitest'
import { parseEisRun } from './eisRunResult.js'

const units = [{ code: '51450', name: 'ULP Mojoagung' }, { code: '51453', name: 'ULP Jombang' }, { code: '51454', name: 'ULP Ngoro' }]
const log = [
  '=== Unit 1/3: 51450 ULP Mojoagung ===',
  'Diterapkan: batch b1 [CONFIRMED] 406 baris: baru 396, cocok 0, tak berubah 0, ditolak 10, di luar cakupan 2',
  'Diterapkan: batch b2 [CONFIRMED] 100 baris: baru 90, cocok 5, tak berubah 1, ditolak 4, di luar cakupan 0',
  'Unit 51450 selesai (2 berkas).',
  '=== Unit 2/3: 51453 ULP Jombang ===',
  'Unit 51453 GAGAL: sesi habis',
  '=== Unit 3/3: 51454 ULP Ngoro ===',
  'Diterapkan: batch b3 [CONFIRMED] 10 baris: baru 10, cocok 0, tak berubah 0, ditolak 0, di luar cakupan 0',
].join('\n')

describe('hasil sinkronisasi EIS per unit', () => {
  it('menjumlahkan batch tiap unit dan menandai selesai, gagal, dan berjalan', () => {
    const r = parseEisRun(log, units, null, 'RUNNING')
    expect(r.rows.map((x) => [x.code, x.state])).toEqual([['51450', 'OK'], ['51453', 'FAILED'], ['51454', 'RUNNING']])
    expect(r.rows[0]).toMatchObject({ baru: 486, cocok: 5, ditolak: 14, luar: 2, files: 2 })
    expect(r.rows[1].message).toBe('sesi habis')
    expect(r).toMatchObject({ totalUnits: 3, doneUnits: 1, failedUnits: 1, baru: 496 })
  })

  it('unit yang belum dimulai menunggu, dan run selesai tidak menyisakan unit berjalan', () => {
    const r = parseEisRun('=== Unit 1/3: 51450 ===', units, null, 'RUNNING')
    expect(r.rows.map((x) => x.state)).toEqual(['RUNNING', 'QUEUED', 'QUEUED'])
    expect(parseEisRun('=== Unit 1/1: 51450 ===', units, ['51450'], 'FAILED').rows[0].state).toBe('FAILED')
  })

  it('run tanpa penanda unit hanya memberi total', () => {
    const r = parseEisRun('Diterapkan: batch x 5 baris: baru 4, cocok 1, tak berubah 0, ditolak 0, di luar cakupan 0', units, null, 'OK')
    expect(r.perUnit).toBe(false)
    expect(r).toMatchObject({ baru: 4, cocok: 1 })
  })
})
