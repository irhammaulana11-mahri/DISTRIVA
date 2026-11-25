import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EisSyncDrawer from './EisSyncDrawer.jsx'
import { eisSyncApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  eisSyncApi: {
    show: vi.fn(),
    save: vi.fn(),
    start: vi.fn(),
    run: vi.fn(),
    apktTokenStatus: vi.fn().mockResolvedValue({ data: { saved: false, saved_at: null, last_result: null, last_used_at: null } }),
    deleteApktToken: vi.fn().mockResolvedValue({ data: { ok: true } }),
  },
}))
vi.mock('../../features/admin/AccessContext.jsx', () => ({
  useAccess: () => ({
    can: {
      'eis_sync.manage': true,
      'eis_reports.import': true,
    },
    isSysAdmin: true,
  }),
}))

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

    const apktTabBtn = screen.getByRole('button', { name: 'SAIDI/SAIFI APKT (DIFI)' })
    expect(apktTabBtn).toBeInTheDocument()
    await userEvent.click(apktTabBtn)
    expect(screen.getByRole('heading', { level: 3, name: 'Tarik SAIDI/SAIFI APKT (DIFI)' })).toBeInTheDocument()
    expect(screen.queryByText('Tarik Laporan Piutang')).not.toBeInTheDocument()
  })

  it('kartu Tarik SAIDI/SAIFI APKT (DIFI) mengirim token, mengosongkannya setelah submit, dan menampilkan badge jenis apkt', async () => {
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r3',
        kind: 'apkt',
        status: 'QUEUED',
        log: null,
        created_at: '2026-11-25T10:00:00Z',
      },
    })
    eisSyncApi.run.mockResolvedValue({
      data: {
        id: 'r3',
        kind: 'apkt',
        status: 'OK',
        log: '=== Bulan 2026-10 ===\nOK DIFI 51453 2026-10 BARU',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="apkt" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik SAIDI/SAIFI APKT (DIFI)' })).toBeInTheDocument()
    const tokenInput = screen.getByLabelText('Token APKT')
    expect(tokenInput).toHaveAttribute('type', 'password')

    const toInput = screen.getByLabelText('Bulan akhir APKT')
    const fromInput = screen.getByLabelText('Bulan awal APKT')
    fireEvent.change(toInput, { target: { value: '2026-10' } })
    fireEvent.change(fromInput, { target: { value: '2026-09' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik SAIDI/SAIFI APKT' })
    expect(submitBtn).toBeDisabled() // belum ada token

    fireEvent.change(tokenInput, { target: { value: 'secret-apkt-token-xyz' } })
    const saveTokenBox = screen.getByLabelText('Simpan token APKT untuk penarikan berikutnya')
    await userEvent.click(saveTokenBox)
    expect(submitBtn).toBeEnabled()

    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'apkt',
        dataset: 'saidi-saifi',
        to_month: '2026-10',
        from_month: '2026-09',
        apkt_token: 'secret-apkt-token-xyz',
        save_token: true,
      })
    })

    // Token harus segera dikosongkan dari input setelah pengiriman
    expect(tokenInput).toHaveValue('')

    expect(await screen.findByText('Hasil Sinkronisasi EIS')).toBeInTheDocument()
    expect(screen.getByText('SAIDI/SAIFI APKT (DIFI)')).toBeInTheDocument()
  })

  it('dapat menggunakan token APKT tersimpan tanpa perlu menempelkan token ulang', async () => {
    eisSyncApi.apktTokenStatus.mockResolvedValue({
      data: {
        saved: true,
        saved_at: '2026-11-25T08:00:00Z',
        last_used_at: '2026-11-25T08:30:00Z',
        last_result: 'OK',
      },
    })
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r4',
        kind: 'apkt',
        status: 'QUEUED',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="apkt" onClose={() => {}} />)

    expect(await screen.findByText(/Gunakan Token APKT Tersimpan/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Token APKT')).not.toBeInTheDocument() // input token disembunyikan jika pakai tersimpan

    const toInput = screen.getByLabelText('Bulan akhir APKT')
    fireEvent.change(toInput, { target: { value: '2026-11' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik SAIDI/SAIFI APKT' })
    expect(submitBtn).toBeEnabled()

    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'apkt',
        dataset: 'saidi-saifi',
        to_month: '2026-11',
        from_month: '2026-11',
        use_saved_token: true,
      })
    })
  })

  it('menampilkan peringatan jika run log APKT memuat token ditolak', async () => {
    eisSyncApi.apktTokenStatus.mockResolvedValue({
      data: { saved: false, saved_at: null, last_used_at: null, last_result: null },
    })
    eisSyncApi.show.mockResolvedValue({
      data: {
        settings,
        runs: [
          {
            id: 'r-fail',
            kind: 'apkt',
            status: 'FAILED',
            log: 'Terjadi galat: token APKT ditolak oleh server APKT (401)',
            created_at: '2026-11-25T10:00:00Z',
          },
        ],
      },
    })

    const failedRun = {
      id: 'r-fail',
      kind: 'apkt',
      status: 'FAILED',
      log: 'Terjadi galat: token APKT ditolak oleh server APKT (401)',
      created_at: '2026-11-25T10:00:00Z',
    }
    eisSyncApi.start.mockResolvedValue({ data: failedRun })
    eisSyncApi.run.mockResolvedValue({ data: failedRun })

    render(<EisSyncDrawer open mode="apkt" onClose={() => {}} />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik SAIDI/SAIFI APKT (DIFI)' })).toBeInTheDocument()

    const tokenInput = await screen.findByLabelText('Token APKT')
    fireEvent.change(tokenInput, { target: { value: 'expired-token' } })
    await userEvent.click(screen.getByRole('button', { name: 'Tarik SAIDI/SAIFI APKT' }))

    expect(await screen.findByText(/Token APKT Ditolak atau Kedaluwarsa/)).toBeInTheDocument()
  })

  it('dapat memilih dataset RPT/RCT WO Gangguan dan mengirim parameter dataset rpt-rct-gangguan', async () => {
    eisSyncApi.apktTokenStatus.mockResolvedValue({
      data: { saved: false, saved_at: null, last_used_at: null, last_result: null },
    })
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-rpt-rct',
        kind: 'apkt',
        options: { dataset: 'rpt-rct-gangguan', from_month: '2026-10', to_month: '2026-10' },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="apkt" onClose={() => {}} />)

    // Klik tombol dataset RPT/RCT WO Gangguan
    const rptRctBtn = await screen.findByRole('button', { name: 'RPT/RCT WO Gangguan' })
    await userEvent.click(rptRctBtn)

    expect(screen.getByRole('heading', { level: 3, name: 'Tarik RPT/RCT WO Gangguan APKT' })).toBeInTheDocument()
    const tokenInput = screen.getByLabelText('Token APKT')
    fireEvent.change(tokenInput, { target: { value: 'secret-rpt-rct-token' } })

    const toInput = screen.getByLabelText('Bulan akhir APKT')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik RPT/RCT Gangguan' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'apkt',
        dataset: 'rpt-rct-gangguan',
        to_month: '2026-10',
        from_month: '2026-10',
        apkt_token: 'secret-rpt-rct-token',
      })
    })

    expect(await screen.findByText('RPT/RCT Gangguan (APKT)')).toBeInTheDocument()
  })

  it('dapat memilih dataset RPT/RCT WO Keluhan dan mengirim parameter dataset rpt-rct-keluhan (Butir 27)', async () => {
    eisSyncApi.apktTokenStatus.mockResolvedValue({
      data: { saved: false, saved_at: null, last_used_at: null, last_result: null },
    })
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-rpt-rct-keluhan',
        kind: 'apkt',
        options: { dataset: 'rpt-rct-keluhan', from_month: '2026-10', to_month: '2026-10' },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="apkt" initialDataset="rpt-rct-keluhan" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik RPT/RCT WO Keluhan APKT' })).toBeInTheDocument()
    const tokenInput = screen.getByLabelText('Token APKT')
    fireEvent.change(tokenInput, { target: { value: 'secret-keluhan-token' } })

    const toInput = screen.getByLabelText('Bulan akhir APKT')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik RPT/RCT Keluhan' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'apkt',
        dataset: 'rpt-rct-keluhan',
        to_month: '2026-10',
        from_month: '2026-10',
        apkt_token: 'secret-keluhan-token',
      })
    })

    expect(await screen.findByText('RPT/RCT Keluhan (APKT)')).toBeInTheDocument()
  })

  it('dapat memilih dataset anomali-gangguan dan anomali-keluhan dan mengirim parameternya (Butir 28 & 29)', async () => {
    eisSyncApi.apktTokenStatus.mockResolvedValue({
      data: { saved: false, saved_at: null, last_used_at: null, last_result: null },
    })
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-anomali-ggn',
        kind: 'apkt',
        options: { dataset: 'anomali-gangguan', from_month: '2026-10', to_month: '2026-10' },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="apkt" initialDataset="anomali-gangguan" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik Anomali Gangguan APKT' })).toBeInTheDocument()
    const tokenInput = screen.getByLabelText('Token APKT')
    fireEvent.change(tokenInput, { target: { value: 'secret-anomali-token' } })

    const toInput = screen.getByLabelText('Bulan akhir APKT')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik Anomali Gangguan' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'apkt',
        dataset: 'anomali-gangguan',
        to_month: '2026-10',
        from_month: '2026-10',
        apkt_token: 'secret-anomali-token',
      })
    })

    expect(await screen.findByText('Anomali Gangguan (APKT)')).toBeInTheDocument()
  })

  it('dapat menjalankan penarikan TAGSUS AP2T tanpa token otorisasi (Butir 30)', async () => {
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-ap2t-tagsus',
        kind: 'ap2t',
        options: { dataset: 'tagsus', from_month: '2026-10', to_month: '2026-10' },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="ap2t" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik TAGSUS AP2T (kWh P2TL)' })).toBeInTheDocument()
    // Pastikan tidak ada kolom Token APKT
    expect(screen.queryByLabelText('Token APKT')).not.toBeInTheDocument()

    const toInput = screen.getByLabelText('Bulan akhir AP2T')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik TAGSUS AP2T' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'ap2t',
        to_month: '2026-10',
        from_month: '2026-10',
        reports: ['realisasi', 'belum_realisasi'],
      })
    })

    expect(await screen.findByText('TAGSUS P2TL (AP2T)')).toBeInTheDocument()
  })

  it('dapat memilih opsi laporan AP2T realisasi dan belum realisasi (Butir 32)', async () => {
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-ap2t-tagsus-custom',
        kind: 'ap2t',
        options: { dataset: 'tagsus', from_month: '2026-10', to_month: '2026-10', reports: ['realisasi'] },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="ap2t" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik TAGSUS AP2T (kWh P2TL)' })).toBeInTheDocument()

    // Verifikasi checkbox laporan realisasi & belum_realisasi
    const cbRealisasi = screen.getByLabelText('Laporan Realisasi')
    const cbBelum = screen.getByLabelText('Laporan Belum realisasi')
    expect(cbRealisasi).toBeChecked()
    expect(cbBelum).toBeChecked()

    // Hapus centang belum realisasi
    await userEvent.click(cbBelum)
    expect(cbBelum).not.toBeChecked()

    const toInput = screen.getByLabelText('Bulan akhir AP2T')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik TAGSUS AP2T' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'ap2t',
        to_month: '2026-10',
        from_month: '2026-10',
        reports: ['realisasi'],
      })
    })
  })

  it('dapat memilih opsi laporan Kontrol Penjualan 309 (Butir 34)', async () => {
    eisSyncApi.start.mockResolvedValue({
      data: {
        id: 'r-piutang-k309',
        kind: 'piutang',
        options: { from_month: '2026-10', to_month: '2026-10', reports: ['KONTROL309'] },
        status: 'OK',
        created_at: '2026-11-25T10:00:00Z',
      },
    })

    render(<EisSyncDrawer open mode="piutang" initialReports={['KONTROL309']} onClose={() => {}} />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Tarik Laporan Piutang' })).toBeInTheDocument()

    // Verifikasi checkbox Kontrol Penjualan 309 tercentang
    const cbK309 = screen.getByLabelText('Laporan Kontrol Penjualan 309')
    expect(cbK309).toBeChecked()

    const toInput = screen.getByLabelText('Bulan akhir piutang')
    fireEvent.change(toInput, { target: { value: '2026-10' } })

    const submitBtn = screen.getByRole('button', { name: 'Tarik Piutang' })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(eisSyncApi.start).toHaveBeenCalledWith({
        kind: 'piutang',
        to_month: '2026-10',
        from_month: '2026-10',
        reports: ['KONTROL309'],
      })
    })

    expect(await screen.findByText('Tarik Kontrol 309')).toBeInTheDocument()
  })
})
