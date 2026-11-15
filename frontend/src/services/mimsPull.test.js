import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { warehousesApi } from './api.js'

const json = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body })

describe('warehousesApi.syncStock (penarikan MIMS di latar belakang)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('memulai run, memantau sampai selesai, dan melaporkan hasil per gudang berkala', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: { id: 'r1', status: 'QUEUED', results: [] } }, 202))
      .mockResolvedValueOnce(json({ data: { id: 'r1', status: 'RUNNING', results: [{ warehouse_code: 'A', status: 'OK' }] } }))
      .mockResolvedValueOnce(json({ data: { id: 'r1', status: 'OK', results: [{ warehouse_code: 'A', status: 'OK' }, { warehouse_code: 'B', status: 'OK' }] } }))
    vi.stubGlobal('fetch', fetchMock)
    const progress = vi.fn()
    const p = warehousesApi.syncStock({ token: 'x'.repeat(12) }, progress)
    await vi.runAllTimersAsync()
    const res = await p
    expect(res.data.map((r) => r.warehouse_code)).toEqual(['A', 'B'])
    expect(progress).toHaveBeenCalledTimes(3)                                       // awal (antre), berjalan, selesai
    expect(progress.mock.calls[0][1].status).toBe('QUEUED')
    expect(fetchMock.mock.calls[0][0]).toContain('/master-data/stock-sync/runs')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(fetchMock.mock.calls[1][0]).toContain('/master-data/stock-sync/runs/r1')
  })

  it('run gagal tanpa hasil menjadi galat dengan pesan dari server; run gagal dengan hasil tetap mengembalikan hasilnya', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ data: { id: 'r2', status: 'QUEUED', results: [] } }, 202))
      .mockResolvedValueOnce(json({ data: { id: 'r2', status: 'FAILED', message: 'Token MIMS tidak tersedia', results: [] } })))
    const p = warehousesApi.syncStock({ token: 'x'.repeat(12) }).catch((e) => e)
    await vi.runAllTimersAsync()
    expect((await p).message).toBe('Token MIMS tidak tersedia')

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ data: { id: 'r3', status: 'QUEUED', results: [] } }, 202))
      .mockResolvedValueOnce(json({ data: { id: 'r3', status: 'FAILED', message: 'Token ditolak', results: [{ warehouse_code: 'A', status: 'FAILED', message: 'token ditolak' }] } })))
    const q = warehousesApi.syncStock({ token: 'x'.repeat(12) })
    await vi.runAllTimersAsync()
    expect((await q).data).toHaveLength(1)
  })
})
