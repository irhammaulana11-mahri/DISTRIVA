import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import EisReportsPage from './EisReportsPage.jsx'
import { eisReportsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  eisReportsApi: {
    list: vi.fn(),
    coverage: vi.fn(),
    lines: vi.fn(),
    importFiles: vi.fn(),
  },
  unitScopeApi: {
    get: vi.fn().mockResolvedValue({
      data: {
        scope: 'GLOBAL',
        up3_units: [{ id: 'up3-1', code: '51450', name: 'UP3 Mojokerto' }],
        ulp_units: [{ id: 'u-1', code: '51453', name: 'ULP Jombang', parent_id: 'up3-1' }],
      },
    }),
  },
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}))

function wrap(ui, can = { 'eis_reports.view': true }, initialEntries = ['/master-data/laporan-eis']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={{ user: { id: 'usr-1', name: 'Tester' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const MOCK_FILES = {
  data: [
    {
      id: 'f-1',
      family: '309',
      period: '2026-04',
      unit_id: 'u-1',
      unit_name: 'ULP Jombang',
      unit_type: 'ULP',
      original_name: '309-51453-042026.xls',
      status: 'AKTIF',
      line_count: 85,
      warnings: [],
      imported_at: '2026-11-20T10:00:00Z',
    },
    {
      id: 'f-2',
      family: 'DIFI',
      period: '2026-05',
      unit_id: 'u-1',
      unit_name: 'ULP Jombang',
      unit_type: 'ULP',
      original_name: 'DIFI-51453-052026.xlsx',
      status: 'AKTIF',
      line_count: 42,
      warnings: ['kode unit dipulihkan'],
      imported_at: '2026-11-21T10:00:00Z',
    },
  ],
  meta: {
    total: 2,
    per_page: 25,
    current_page: 1,
    last_page: 1,
  },
  families: ['309', '309EIS', 'DIFI', 'GGNALL', 'TAGSUS'],
}

const MOCK_LINES = {
  data: {
    file: {
      id: 'f-2',
      family: 'DIFI',
      period: '2026-05',
      unit_name: 'ULP Jombang',
      status: 'AKTIF',
      original_name: 'DIFI-51453-052026.xlsx',
      summary: { saidi: 12.5, saifi: 0.85, ens: 350.2 },
    },
    lines: [
      {
        line_no: 1,
        group_label: 'Penyebab Gangguan Internal',
        label: 'Komponen Rusak',
        code: 'INT01',
        values: { kali: 3, menit: 120 },
      },
    ],
  },
}

describe('EisReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan daftar berkas laporan EIS dengan tombol aksi pratinjau', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)

    wrap(<EisReportsPage />)

    expect(await screen.findByText('Upload APKT/EIS/AP2T')).toBeInTheDocument()
    expect(screen.getByText('309-51453-042026.xls')).toBeInTheDocument()
    expect(screen.getByText('DIFI-51453-052026.xlsx')).toBeInTheDocument()
    expect(screen.getByText('kode unit dipulihkan')).toBeInTheDocument()
  })

  it('2. tombol unggah laporan hanya muncul jika memiliki izin eis_reports.import', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)

    // Tanpa izin import
    const { unmount } = wrap(<EisReportsPage />, { 'eis_reports.view': true })
    expect(await screen.findByText('Upload APKT/EIS/AP2T')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unggah Laporan/i })).toBeNull()
    unmount()

    // Dengan izin import
    wrap(<EisReportsPage />, { 'eis_reports.view': true, 'eis_reports.import': true })
    expect(await screen.findByRole('button', { name: /Unggah Laporan/i })).toBeInTheDocument()
  })

  it('3. membuka drawer rincian baris isi laporan saat tombol Lihat Isi diklik', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)
    eisReportsApi.lines.mockResolvedValue(MOCK_LINES)

    const user = userEvent.setup()
    wrap(<EisReportsPage />)

    const viewButtons = await screen.findAllByRole('button', { name: /Lihat Isi/i })
    await user.click(viewButtons[1])

    expect(await screen.findByText('Ringkasan DIFI (Kepala Laporan)')).toBeInTheDocument()
    expect(screen.getByText('Komponen Rusak')).toBeInTheDocument()
  })

  it('4. modal unggah mendukung berkas ZIP, nama bebas, pilihan opsional bulan dan unit, serta pengiriman bertahap', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)
    eisReportsApi.importFiles.mockResolvedValue({
      message: 'Impor berhasil',
      data: [
        {
          name: 'oktober.zip › JOMBANG/2026-10/Rekap.xls',
          ok: true,
          status: 'BARU',
          family: '309',
          unit: 'ULP Jombang',
          period: '2026-10',
          lines: 120,
          warnings: [],
        },
      ],
    })

    const user = userEvent.setup()
    wrap(<EisReportsPage />, { 'eis_reports.view': true, 'eis_reports.import': true })

    // Buka modal unggah
    const uploadBtn = await screen.findByRole('button', { name: /Unggah Laporan/i })
    await user.click(uploadBtn)

    // Periksa petunjuk nama bebas & ZIP
    expect(await screen.findByText('Unggah Laporan APKT / EIS / AP2T')).toBeInTheDocument()
    expect(screen.getAllByText(/Nama berkas bebas/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Arsip ZIP & Folder/i)).toBeInTheDocument()

    // Periksa opsi opsional Bulan dan Unit
    expect(screen.getByLabelText(/Pilihan bulan opsional/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Pilihan unit opsional/i)).toBeInTheDocument()

    // Pilih berkas simulasi
    const fileInput = screen.getByLabelText('Pilih Berkas')
    const testZip = new File(['dummy zip content'], 'oktober.zip', { type: 'application/zip' })
    await user.upload(fileInput, testZip)

    expect(screen.getByText(/1 berkas/i)).toBeInTheDocument()

    // Unggah sekarang
    await user.click(screen.getByRole('button', { name: /Unggah Sekarang/i }))

    // Periksa pemanggilan API
    await waitFor(() => {
      expect(eisReportsApi.importFiles).toHaveBeenCalledTimes(1)
    })

    // Hasil pemrosesan ditampilkan termasuk nama berkas dalam ZIP
    expect((await screen.findAllByText('JOMBANG/2026-10/Rekap.xls')).length).toBeGreaterThan(0)
    expect(screen.getByText('BARU')).toBeInTheDocument()
  })

  it('5. menampilkan matriks kelengkapan seluruh ULP saat UP3 dipilih tanpa unitId dengan katalog dataset', async () => {
    const mockUp3Coverage = {
      data: {
        up3_id: 'up3-1',
        up3_name: 'UP3 Mojokerto',
        year: 2026,
        expected_until_month: 10,
        datasets_list: [
          { code: 'AP2T.PENJUALAN_309', name: 'Penjualan Tenaga Listrik (309)', source: 'AP2T', storage: 'file', family: '309', used_by: ['pelanggan', 'daya'] },
          { code: 'APKT.SAIDI_SAIFI', name: 'Laporan SAIDI SAIFI', source: 'APKT', storage: 'file', family: 'DIFI', used_by: ['saidi-saifi'] },
          { code: 'EIS.UMUR_PIUTANG', name: 'Umur Tunggakan Pascabayar', source: 'EIS', storage: 'file', family: 'UMURPIUTANG', used_by: ['piutang-pascabayar-umur'] },
        ],
        legacy_families: ['GGNALL', 'GGNNEGATIF'],
        families_list: ['309', 'DIFI', 'UMURPIUTANG'],
        expected_total: 60,
        missing_total: 2,
        units: [
          {
            unit_id: 'u-1',
            unit_code: '51453',
            unit_name: 'ULP Jombang',
            datasets: { 'AP2T.PENJUALAN_309': { 10: true } },
            missing_count: 0,
            missing: [],
          },
          {
            unit_id: 'u-2',
            unit_code: '51454',
            unit_name: 'ULP Ngoro',
            datasets: { 'AP2T.PENJUALAN_309': { 10: false } },
            missing_count: 2,
            missing: [
              { dataset: 'AP2T.PENJUALAN_309', month: 10 },
              { dataset: 'APKT.SAIDI_SAIFI', month: 10 },
            ],
          },
        ],
      },
    }

    eisReportsApi.list.mockResolvedValue(MOCK_FILES)
    eisReportsApi.coverage.mockResolvedValue(mockUp3Coverage)

    // Buka langsung via URL search params ?tab=coverage&up3_id=up3-1&year=2026
    wrap(<EisReportsPage />, { 'eis_reports.view': true }, ['/master-data/laporan-eis?tab=coverage&up3_id=up3-1&year=2026'])

    // Verifikasi pemanggilan coverage dengan up3_id
    await waitFor(() => {
      expect(eisReportsApi.coverage).toHaveBeenCalledWith({ up3_id: 'up3-1', year: 2026 })
    })

    // Tampilan UP3 Coverage
    expect(await screen.findByText(/Kelengkapan Laporan Semua ULP — UP3 Mojokerto/i)).toBeInTheDocument()
    expect(screen.getByText(/s.d. Bulan Okt \(10\)/i)).toBeInTheDocument()
    expect(screen.getByText('2 berkas')).toBeInTheDocument()

    // Ringkasan tiap ULP dengan nama dataset dan badge sumber
    expect(screen.getByText('ULP Jombang')).toBeInTheDocument()
    expect(screen.getByText('Lengkap')).toBeInTheDocument()
    expect(screen.getByText('ULP Ngoro')).toBeInTheDocument()
    expect(screen.getByText('2 Kurang')).toBeInTheDocument()
    expect(screen.getByText(/Penjualan Tenaga Listrik \(309\) \(Okt\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Laporan SAIDI SAIFI \(Okt\)/i)).toBeInTheDocument()
  })

  it('6. mendukung tampilan matriks kelengkapan per ULP dengan dataset aktif dan bagian arsip jenis lama', async () => {
    const mockUnitCoverage = {
      data: {
        unit_id: 'u-1',
        year: 2026,
        datasets: [
          { code: 'AP2T.PENJUALAN_309', name: 'Penjualan Tenaga Listrik (309)', source: 'AP2T', storage: 'file', family: '309', used_by: ['pelanggan', 'daya'], months: { 1: true, 2: true } },
          { code: 'APKT.RPT_RCT_GANGGUAN', name: 'Jumlah dan Durasi RPT RCT Gangguan', source: 'APKT', storage: 'table', used_by: ['rpt-rct-gangguan'], months: { 1: true, 2: false } },
        ],
        legacy_families: ['GGNALL', 'GGNNEGATIF'],
        families: {
          GGNALL: { 1: true },
          GGNNEGATIF: { 1: false },
        },
      },
    }

    eisReportsApi.list.mockResolvedValue(MOCK_FILES)
    eisReportsApi.coverage.mockResolvedValue(mockUnitCoverage)

    const user = userEvent.setup()
    wrap(<EisReportsPage />, { 'eis_reports.view': true }, ['/master-data/laporan-eis?tab=coverage&unit_id=u-1&year=2026'])

    expect(await screen.findByText(/Matriks Kelengkapan Dataset Tahun 2026/i)).toBeInTheDocument()
    expect(screen.getByText('Penjualan Tenaga Listrik (309)')).toBeInTheDocument()
    expect(screen.getByText('Jumlah dan Durasi RPT RCT Gangguan')).toBeInTheDocument()
    expect(screen.getByText('AP2T.PENJUALAN_309')).toBeInTheDocument()
    expect(screen.getByText('APKT.RPT_RCT_GANGGUAN')).toBeInTheDocument()

    // Buka bagian Arsip jenis lama
    const toggleArsip = screen.getByRole('button', { name: /Lihat Arsip/i })
    await user.click(toggleArsip)

    expect(await screen.findByText('Arsip Jenis Laporan EIS Lama (Tidak Dihitung Kurang)')).toBeInTheDocument()
    expect(screen.getAllByText(/GGNALL/i).length).toBeGreaterThan(0)
  })
})
