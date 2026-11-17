import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaximoSyncDrawer from './MaximoSyncDrawer.jsx'
import { maximoSyncApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  maximoSyncApi: { show: vi.fn(), save: vi.fn(), runs: vi.fn(), start: vi.fn(), run: vi.fn() },
}))

const settings = { maximo_url: 'http://10.99.10.41', maximo_username: 'petugas.mx', has_password: true, work_type: 'INST1', lookback_days: 3, auto_enabled: true, auto_time: '19:30' }
const done = { id: 'r0', trigger: 'AUTO', status: 'OK', since: '2026-11-14', all_work_orders: false, created_at: '2026-11-16T12:30:00Z', summary: { listed: 40, chosen: 12, fetched: 12, failed: 1, load: { readings_stored: 9 } } }

describe('Sinkronisasi Maximo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maximoSyncApi.show.mockResolvedValue({ data: { settings, runs: [done] } })
    maximoSyncApi.runs.mockResolvedValue({ data: [done], meta: { current_page: 1, per_page: 10, total: 1, last_page: 1 } })
  })

  it('menampilkan kartu ringkasan, otomasi, dan riwayat dengan hasilnya tanpa pernah menampilkan password', async () => {
    render(<MaximoSyncDrawer open onClose={() => {}} />)
    expect(await screen.findByText('petugas.mx')).toBeInTheDocument()
    expect(screen.getByText('Pukul 19:30 WIB')).toBeInTheDocument()
    expect(screen.getByText('WO selesai 3 hari terakhir')).toBeInTheDocument()
    expect(screen.getByTestId('run-summary')).toHaveTextContent('12/12 WO · 1 gagal · 9 pembacaan baru')
    expect(screen.getByText('Otomatis')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Rahasia')
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)                  // kolom password hanya ada di jendela Pengaturan
  })

  it('sinkron manual: tanpa pilihan dikirim kosong; dengan tanggal dan semua WO dikirim; log diikuti sampai selesai', async () => {
    maximoSyncApi.start.mockResolvedValue({ data: { id: 'r1', trigger: 'MANUAL', status: 'QUEUED', since: '2026-10-01', log: null, created_at: '2026-11-17T01:00:00Z' } })
    maximoSyncApi.run.mockResolvedValue({ data: { id: 'r1', trigger: 'MANUAL', status: 'OK', since: '2026-10-01', log: 'RINGKASAN daftar=3 dipilih=1 diambil=1 gagal=0', created_at: '2026-11-17T01:00:00Z', summary: { listed: 3, chosen: 1, fetched: 1, failed: 0 } } })
    const onSynced = vi.fn()
    render(<MaximoSyncDrawer open onClose={() => {}} onSynced={onSynced} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(maximoSyncApi.start).toHaveBeenLastCalledWith({}))
    await waitFor(() => expect(screen.getByLabelText('Log sinkronisasi')).toHaveTextContent('RINGKASAN daftar=3'), { timeout: 8000 })
    await waitFor(() => expect(onSynced).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Sejak tanggal'), { target: { value: '2026-10-01' } })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Semua WO inspeksi' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan Sekarang' }))
    await waitFor(() => expect(maximoSyncApi.start).toHaveBeenLastCalledWith({ since: '2026-10-01', all_work_orders: true }))
  }, 20000)

  it('tombol sinkron nonaktif tanpa akun; pengaturan disimpan tanpa mengirim password kosong yang berarti tetap', async () => {
    maximoSyncApi.show.mockResolvedValue({ data: { settings: { ...settings, maximo_username: null, has_password: false, auto_enabled: false }, runs: [] } })
    maximoSyncApi.runs.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 10, total: 0, last_page: 1 } })
    maximoSyncApi.save.mockResolvedValue({ data: { ...settings, maximo_username: 'baru', has_password: true } })
    render(<MaximoSyncDrawer open onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Sinkronkan Sekarang' })).toBeDisabled()
    expect(screen.getByText('Simpan user dan password Maximo terlebih dulu.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pengaturan' }))
    const dialog = (await screen.findByText('Pengaturan Sinkronisasi Maximo')).closest('[role="dialog"]')
    await userEvent.type(within(dialog).getByLabelText('User Maximo'), 'baru')
    await userEvent.type(within(dialog).getByLabelText('Password Maximo'), 'rahasia')
    await userEvent.click(within(dialog).getByRole('button', { name: /Simpan Pengaturan/ }))
    await waitFor(() => expect(maximoSyncApi.save).toHaveBeenCalledWith(expect.objectContaining({ maximo_username: 'baru', maximo_password: 'rahasia', work_type: 'INST1', lookback_days: 3 })))
    expect(await screen.findByText('Pengaturan disimpan.')).toBeInTheDocument()
  })

  it('log sebuah sesi riwayat dibuka dalam jendela dan dimuat dari server', async () => {
    maximoSyncApi.run.mockResolvedValue({ data: { ...done, log: 'Pemuatan ke pembacaan gardu: {"readings_stored":9}' } })
    render(<MaximoSyncDrawer open onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /Lihat log/ }))
    expect(await screen.findByLabelText('Isi log')).toHaveTextContent('Pemuatan ke pembacaan gardu')
    expect(maximoSyncApi.run).toHaveBeenCalledWith('r0')
  })
})
