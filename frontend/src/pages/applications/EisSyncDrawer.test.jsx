import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EisSyncDrawer from './EisSyncDrawer.jsx'
import { eisSyncApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({ eisSyncApi: { show: vi.fn(), save: vi.fn(), start: vi.fn(), run: vi.fn() } }))

const settings = { eis_username: 'petugas.eis', has_password: true, power_min: 0, power_max: 99999999, lookback_days: 180, auto_enabled: false, auto_time: '18:13' }

describe('Sinkronisasi EIS dari DISTRIVA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eisSyncApi.show.mockResolvedValue({ data: { settings, runs: [{ id: 'r0', trigger: 'AUTO', status: 'OK', started_by: 'niaga@pln.test', created_at: '2026-11-12T11:13:00Z' }] } })
  })

  it('menyimpan akun EIS, rentang daya, dan jadwal otomatis; password kosong tidak dikirim sebagai isian baru', async () => {
    eisSyncApi.save.mockResolvedValue({ data: { ...settings, power_max: 6600, auto_enabled: true } })
    render(<EisSyncDrawer open onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Pengaturan' }))              // pengaturan ada di jendela terpisah, seperti MIMS
    expect(await screen.findByLabelText('User EIS')).toHaveValue('petugas.eis')
    expect(screen.getByLabelText('Password EIS')).toHaveValue('')                       // password tersimpan tidak pernah ditampilkan
    fireEvent.change(screen.getByLabelText('Daya maksimum'), { target: { value: '6600' } })
    await userEvent.click(screen.getByLabelText(/Jalankan otomatis setiap hari/))
    fireEvent.change(screen.getByLabelText('Jam sinkronisasi otomatis'), { target: { value: '19:30' } })
    await userEvent.click(screen.getByRole('button', { name: 'Simpan Pengaturan' }))
    await waitFor(() => expect(eisSyncApi.save).toHaveBeenCalledWith({ eis_username: 'petugas.eis', eis_password: '', power_min: 0, power_max: 6600, lookback_days: 180, auto_enabled: true, auto_time: '19:30' }))
    expect(await screen.findByText('Pengaturan disimpan.')).toBeInTheDocument()
    expect(screen.queryByText('Riwayat Sinkronisasi')).not.toBeInTheDocument()            // riwayat sesi pindah ke tab di halaman PB/PD
  })

  it('tombol Sinkronkan Sekarang memulai proses, mengikuti log sampai selesai, lalu menyegarkan daftar', async () => {
    eisSyncApi.start.mockResolvedValue({ data: { id: 'r1', status: 'QUEUED', log: null, created_at: '2026-11-13T01:00:00Z' } })
    eisSyncApi.run.mockResolvedValue({ data: { id: 'r1', status: 'OK', log: 'Diterapkan: batch B1 baru 3', created_at: '2026-11-13T01:00:00Z' } })
    const onSynced = vi.fn()
    render(<EisSyncDrawer open onClose={() => {}} onSynced={onSynced} />)
    fireEvent.change(await screen.findByLabelText('Dari tanggal'), { target: { value: '2026-10-01' } })
    expect(screen.getByRole('button', { name: 'Sinkronkan Sekarang' })).toBeDisabled()          // satu tanggal saja tidak cukup
    fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-11-10' } })
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(eisSyncApi.start).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-11-10' }))
    expect(await screen.findByLabelText('Log sinkronisasi', {}, { timeout: 6000 })).toHaveTextContent('Diterapkan: batch B1 baru 3')
    await waitFor(() => expect(onSynced).toHaveBeenCalled())
  }, 15000)

  it('pelengkapan permohonan lama tidak ikut secara bawaan; dikirim hanya bila pengguna mencentangnya', async () => {
    eisSyncApi.start.mockResolvedValue({ data: { id: 'r1', status: 'QUEUED', log: null, created_at: '2026-11-17T01:00:00Z' } })
    eisSyncApi.run.mockResolvedValue({ data: { id: 'r1', status: 'OK', log: 'ok', created_at: '2026-11-17T01:00:00Z' } })
    render(<EisSyncDrawer open onClose={() => {}} onSynced={() => {}} />)
    const box = await screen.findByRole('checkbox', { name: 'Lengkapi permohonan lama' })
    expect(box).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(eisSyncApi.start).toHaveBeenLastCalledWith({}))
    await screen.findByLabelText('Log sinkronisasi', {}, { timeout: 6000 })
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(eisSyncApi.start).toHaveBeenLastCalledWith({ complete_old: true }))
  }, 20000)

  it('menampilkan unit yang akan disinkronkan: semua secara bawaan, bisa satu dua unit, dan tanpa unit tombol nonaktif', async () => {
    const units = [{ code: '51450', name: 'ULP Mojoagung' }, { code: '51453', name: 'ULP Jombang' }, { code: '51454', name: 'ULP Ngoro' }]
    eisSyncApi.show.mockResolvedValue({ data: { settings, units, runs: [{ id: 'r9', trigger: 'MANUAL', status: 'OK', units: ['51453', '51454'], started_by: 'a@b.c', created_at: '2026-11-13T01:00:00Z' }] } })
    eisSyncApi.start.mockResolvedValue({ data: { id: 'r1', status: 'QUEUED', log: null, created_at: '2026-11-16T01:00:00Z' } })
    eisSyncApi.run.mockResolvedValue({ data: { id: 'r1', status: 'RUNNING', log: '=== Unit 1/2: 51453 ===', created_at: '2026-11-16T01:00:00Z' } })
    render(<EisSyncDrawer open onClose={() => {}} />)
    const group = await screen.findByRole('group', { name: 'Unit yang disinkronkan' })
    expect(group).toHaveTextContent('(3 dari 3, diproses berurutan dari atas)')
    expect(screen.getByLabelText('Sinkronkan 51453 ULP Jombang')).toBeChecked()               // semua unit dipilih bawaan

    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan' }))
    expect(screen.getByRole('button', { name: 'Sinkronkan Sekarang' })).toBeDisabled()          // tanpa unit tidak ada yang disinkronkan
    await userEvent.click(screen.getByLabelText('Sinkronkan 51454 ULP Ngoro'))
    await userEvent.click(screen.getByLabelText('Sinkronkan 51453 ULP Jombang'))
    expect(group).toHaveTextContent('(2 dari 3')
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(eisSyncApi.start).toHaveBeenCalledWith({ units: ['51453', '51454'] }))   // urutan EIS (dari atas), bukan urutan klik
  })

  it('tanpa akun EIS tersimpan tombol sinkronkan dinonaktifkan', async () => {
    eisSyncApi.show.mockResolvedValue({ data: { settings: { ...settings, eis_username: null, has_password: false }, runs: [] } })
    render(<EisSyncDrawer open mode="permohonan" onClose={() => {}} />)
    expect(await screen.findByText(/Simpan user dan password EIS terlebih dulu/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sinkronkan Sekarang' })).toBeDisabled()
  })

  it('kartu Tarik Laporan Piutang mengirim parameter kind piutang, periode bulan, dan jenis laporan', async () => {
    eisSyncApi.start.mockResolvedValue({ data: { id: 'r2', kind: 'piutang', status: 'QUEUED', log: null, created_at: '2026-11-24T12:00:00Z' } })
    eisSyncApi.run.mockResolvedValue({ data: { id: 'r2', kind: 'piutang', status: 'OK', log: '=== Bulan 2026-10 ===\nOK GOLONGAN JOMBANG 2026-10 (4500 byte)', created_at: '2026-11-24T12:00:00Z' } })
    render(<EisSyncDrawer open mode="piutang" onClose={() => {}} />)

    expect(await screen.findByText('Tarik Laporan Piutang')).toBeInTheDocument()
    expect(screen.getByText('Sinkronisasi Saldo Piutang EIS')).toBeInTheDocument()
    const toInput = screen.getByLabelText('Bulan akhir piutang')
    const fromInput = screen.getByLabelText('Bulan awal piutang')
    fireEvent.change(toInput, { target: { value: '2026-10' } })
    fireEvent.change(fromInput, { target: { value: '2026-08' } })

    // Uncheck Kogol & Saldo Prabayar
    const kogolBox = screen.getByLabelText('Laporan Kogol')
    expect(kogolBox).toBeChecked()
    await userEvent.click(kogolBox)
    expect(kogolBox).not.toBeChecked()

    const prabayarBox = screen.getByLabelText('Laporan Saldo Prabayar')
    expect(prabayarBox).toBeChecked()
    await userEvent.click(prabayarBox)
    expect(prabayarBox).not.toBeChecked()

    const submitBtn = screen.getByRole('button', { name: 'Tarik Piutang' })
    expect(submitBtn).toBeEnabled()
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'piutang',
        to_month: '2026-10',
        from_month: '2026-08',
        reports: ['GOLONGAN', 'LEMBAR'],
      })
    })

    expect(await screen.findByText('Hasil Sinkronisasi EIS')).toBeInTheDocument()
    expect(screen.getByText('Saldo Piutang')).toBeInTheDocument()
  })

  it('dapat beralih tab antara Permohonan Pelanggan dan Laporan Saldo Piutang jika mode umum', async () => {
    render(<EisSyncDrawer open onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Permohonan Pelanggan' })).toBeInTheDocument()
    const piutangTabBtn = screen.getByRole('button', { name: 'Laporan Saldo Piutang' })
    expect(piutangTabBtn).toBeInTheDocument()
    expect(screen.getByText('Tarik Permohonan dari EIS Langsung')).toBeInTheDocument()
    expect(screen.queryByText('Tarik Laporan Piutang')).not.toBeInTheDocument()

    await userEvent.click(piutangTabBtn)
    expect(await screen.findByText('Tarik Laporan Piutang')).toBeInTheDocument()
    expect(screen.queryByText('Tarik Permohonan dari EIS Langsung')).not.toBeInTheDocument()
  })
})
