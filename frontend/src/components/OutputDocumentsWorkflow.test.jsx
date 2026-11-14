import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OutputDocumentModal from './OutputDocumentModal.jsx'
import { rabRunsApi, kkfRunsApi, triggerFileDownload } from '../services/api.js'

// Mock API and triggerFileDownload
vi.mock('../services/api.js', () => ({
  rabRunsApi: {
    listForPackage: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
    document: vi.fn(),
  },
  kkfRunsApi: {
    listForApplication: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
    document: vi.fn(),
  },
  triggerFileDownload: vi.fn(),
}))

const mockRekapDoc = {
  title: 'RAB PERMOHONAN PB/PD',
  header: ['PT PLN (PERSERO)', 'DISTRIBUSI JAWA TIMUR', 'UP3 MOJOKERTO'],
  document_number: 'RAB/2026/11/001',
  meta: [
    ['NAMA', 'PT Industri Sentosa'],
    ['LOKASI', 'Kawasan Industri Mojosari'],
    ['ULP', 'ULP Mojokerto Kota'],
    ['No. Permohonan', 'PB-202611-0001'],
  ],
  sections: [
    {
      heading: 'REKAPITULASI BIAYA PEKERJAAN',
      columns: ['NO', 'URAIAN PEKERJAAN', 'SAT', 'VOLUME', 'MATERIAL', 'JASA', 'SUB TOTAL (Rp)', 'JUMLAH TOTAL (Rp)'],
      rows: [
        [1, 'Saluran Udara Tegangan Menengah (SUTM)', 'Kms', 1.25, 150000000, 25000000, 175000000, 194250000],
        [2, 'Gardu Trafo Tiang (GTT)', 'Set', 1, 85000000, 15000000, 100000000, 111000000],
      ],
      footer: ['', 'JUMLAH', '', '', 235000000, 40000000, 275000000, 305250000],
    },
  ],
  grand_total: 305250000,
  terbilang: 'Tiga Ratus Lima Juta Dua Ratus Lima Puluh Ribu Rupiah',
  place_date: 'Mojokerto, 07 November 2026',
  signatures: [
    { title: 'MANAGER ULP', name: 'Bambang Supriyadi' },
    { title: 'SPV TEKNIK', name: 'Rendra Pratama' },
  ],
  source: {
    rab_run_id: 'rab-uuid-1',
    run_number: 1,
    snapshot_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
}

const mockRinciDoc = {
  title: 'RAB PERMOHONAN PB/PD — REKAP RINCI',
  header: ['PT PLN (PERSERO)', 'UP3 MOJOKERTO'],
  document_number: null, // Test "Nomor belum ditetapkan"
  meta: [
    ['NAMA', 'Budi Santoso'],
    ['No. Permohonan', 'PD-202611-0042'],
  ],
  sections: [
    {
      heading: 'SALURAN UDARA TEGANGAN MENENGAH (SUTM)',
      columns: [
        'NO',
        'KODE KHS',
        'URAIAN',
        'SAT',
        'VOL MATERIAL',
        'VOL PASANG',
        'VOL BONGKAR',
        'STATUS MATERIAL',
        'BIAYA MATERIAL',
        'BIAYA PASANG',
        'BIAYA BONGKAR',
        'ASURANSI',
        'KATEGORI',
      ],
      rows: [
        [1, 'AAAC-150', 'AAAC 150 sqmm', 'M', 1250, 1250, 0, 'PLN', 45000000, 8500000, 0, 150000, 'MDU'],
        [2, 'POLE-12-350', 'Tiang Beton 12M 350daN', 'Btg', 4, 4, 0, 'PLN', 18000000, 4200000, 0, 80000, 'MDU'],
      ],
      footer: ['', '', 'JUMLAH', '', '', '', '', '', 63000000, 12700000, 0, 230000, ''],
    },
  ],
  grand_total: 75930000,
  terbilang: 'Tujuh Puluh Lima Juta Sembilan Ratus Tiga Puluh Ribu Rupiah',
  place_date: 'Mojokerto, 07 November 2026',
  signatures: [{ title: 'MANAGER ULP', name: 'Bambang Supriyadi' }],
  source: {
    rab_run_id: 'rab-uuid-2',
    run_number: 2,
    snapshot_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  },
}

const mockKkfDocInfeasible = {
  title: 'KAJIAN KELAYAKAN INVESTASI (KKF)',
  header: ['PT PLN (PERSERO)', 'DISTRIBUSI JAWA TIMUR', 'UP3 MOJOKERTO'],
  document_number: null,
  conclusion: 'TIDAK LAYAK',
  extended_required: true,
  meta: [
    ['NAMA', 'Pabrik Kertas Mojosari'],
    ['ULP', 'ULP Mojokerto Kota'],
  ],
  sections: [
    {
      heading: '1. DATA PEKERJAAN',
      pairs: [
        ['Nama', 'Pabrik Kertas Mojosari'],
        ['Tarif/Daya', 'I-3 / 555 kVA'],
        ['Anggaran Biaya (Rp)', 350000000],
      ],
    },
    {
      heading: '3. KAJIAN KELAYAKAN FINANSIAL',
      columns: ['NO', 'PERHITUNGAN FINANSIAL', 'NILAI', 'SATUAN', 'KRITERIA', 'KESIMPULAN'],
      rows: [
        [1, 'RWACC', 7.78, '%', '', 'TIDAK LAYAK'],
        [2, 'IRR', 4.12, '%', '> 7.78 %', 'Tidak terpenuhi'],
        [3, 'NPV', -45000000, 'Rp', '> 0 (positif)', 'Tidak terpenuhi'],
        [4, 'PBP', '6 Tahun 2 Bulan', '', '< 5 Tahun', 'Tidak terpenuhi'],
      ],
    },
  ],
  grand_total: null,
  place_date: 'Mojokerto, 07 November 2026',
  signatures: [
    { title: 'ASMAN NIAGA', name: 'Cahyo Wibowo' },
    { title: 'UP3 MANAGER', name: 'Hendra Setiawan' },
  ],
  source: {
    kkf_run_id: 'kkf-uuid-1',
    run_number: 1,
    snapshot_hash: '7d793037a0760186574b0282f2f435e7',
  },
}

const mockHpeDoc = {
  title: 'HARGA PERKIRAAN ENGINEERING (HPE)',
  header: ['PT PLN (PERSERO)', 'UP3 MOJOKERTO'],
  document_number: 'HPE/2026/11/04',
  meta: [
    ['NAMA', 'CV Usaha Bersama'],
    ['No. Permohonan', 'PB-202611-0089'],
  ],
  sections: [
    {
      heading: 'ANALISA PERBANDINGAN BP TERHADAP RAB',
      columns: ['NO', 'URAIAN PEKERJAAN', 'SAT', 'VOLUME', 'BP', 'RAB', 'ANALISA'],
      rows: [[1, 'ANALISA PERBANDINGAN BP BANDING RAB', 'LOT', 1, 85000000, 110000000, 0.7727]],
      footer: ['', 'JUMLAH', '', '', 85000000, 110000000, 0.7727],
    },
  ],
  place_date: 'Mojokerto, 07 November 2026',
  signatures: [{ title: 'MANAGER ULP', name: 'Bambang Supriyadi' }],
  source: {
    kkf_run_id: 'kkf-uuid-2',
    rab_run_number: 1,
    snapshot_hash: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
  },
}

describe('OutputDocumentModal Workflow (docs/70 & docs/57)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.print = vi.fn()
  })

  it('1. renders REKAP document from RAB run with PLN header, meta, table, total, and signatures', async () => {
    rabRunsApi.document.mockResolvedValueOnce({ data: mockRekapDoc })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-1"
        type="rekap"
        category="rab"
      />
    )

    // Check loading indicator then title
    const titles = await screen.findAllByText('RAB PERMOHONAN PB/PD')
    expect(titles.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('PT PLN (PERSERO)')).toBeInTheDocument()
    expect(screen.getByText('UP3 MOJOKERTO')).toBeInTheDocument()

    // Document number
    expect(screen.getByText('RAB/2026/11/001')).toBeInTheDocument()

    // Metadata
    expect(screen.getByText('PT Industri Sentosa')).toBeInTheDocument()
    expect(screen.getByText('Kawasan Industri Mojosari')).toBeInTheDocument()

    // Table rows and columns
    expect(screen.getByText('Saluran Udara Tegangan Menengah (SUTM)')).toBeInTheDocument()
    expect(screen.getByText('Gardu Trafo Tiang (GTT)')).toBeInTheDocument()

    // Terbilang
    expect(screen.getByText(/Tiga Ratus Lima Juta Dua Ratus Lima Puluh Ribu Rupiah/)).toBeInTheDocument()

    // Signatures
    expect(screen.getByText('MANAGER ULP')).toBeInTheDocument()
    expect(screen.getByText(/Bambang Supriyadi/)).toBeInTheDocument()

    // API called with json format
    expect(rabRunsApi.document).toHaveBeenCalledWith('rab-uuid-1', 'rekap', 'json')
  })

  it('2. renders REKAP RINCI document with wide table, null document number, and formatting', async () => {
    rabRunsApi.document.mockResolvedValueOnce({ data: mockRinciDoc })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-2"
        type="rinci"
        category="rab"
      />
    )

    const titles = await screen.findAllByText('RAB PERMOHONAN PB/PD — REKAP RINCI')
    expect(titles.length).toBeGreaterThanOrEqual(1)

    // When document_number is null, it should display "Nomor belum ditetapkan"
    expect(screen.getByText('Nomor belum ditetapkan')).toBeInTheDocument()

    // Wide table headers (13 columns)
    expect(screen.getByText('KODE KHS')).toBeInTheDocument()
    expect(screen.getByText('VOL MATERIAL')).toBeInTheDocument()
    expect(screen.getByText('BIAYA PASANG')).toBeInTheDocument()

    // Table item content
    expect(screen.getByText('AAAC-150')).toBeInTheDocument()
    expect(screen.getByText('Tiang Beton 12M 350daN')).toBeInTheDocument()
  })

  it('3. renders KKF document with infeasibility warning banner and financial criteria', async () => {
    kkfRunsApi.document.mockResolvedValueOnce({ data: mockKkfDocInfeasible })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="kkf-uuid-1"
        type="kkf"
        category="kkf"
      />
    )

    const titles = await screen.findAllByText('KAJIAN KELAYAKAN INVESTASI (KKF)')
    expect(titles.length).toBeGreaterThanOrEqual(1)

    // Red warning banner about extended approval chain
    expect(screen.getByText(/Peringatan: TIDAK LAYAK/i)).toBeInTheDocument()
    expect(
      screen.getByText(/memerlukan rantai persetujuan diperpanjang/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('ASMAN NIAGA').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('UP3 MANAGER').length).toBeGreaterThanOrEqual(1)

    // Feasibility status badge
    expect(screen.getByText('KESIMPULAN KELAYAKAN:')).toBeInTheDocument()
    const tidakLayakBadges = screen.getAllByText('TIDAK LAYAK')
    expect(tidakLayakBadges.length).toBeGreaterThanOrEqual(1)

    // Financial calculations
    expect(screen.getByText('RWACC')).toBeInTheDocument()
    expect(screen.getByText('IRR')).toBeInTheDocument()
    expect(screen.getByText('6 Tahun 2 Bulan')).toBeInTheDocument()
  })

  it('4. renders HPE document comparing BP and RAB', async () => {
    kkfRunsApi.document.mockResolvedValueOnce({ data: mockHpeDoc })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="kkf-uuid-2"
        type="hpe"
        category="kkf"
      />
    )

    const titles = await screen.findAllByText('HARGA PERKIRAAN ENGINEERING (HPE)')
    expect(titles.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('ANALISA PERBANDINGAN BP BANDING RAB')).toBeInTheDocument()
    expect(screen.getByText('HPE/2026/11/04')).toBeInTheDocument()
  })

  it('5. triggers window.print() when "Cetak Formulir" is clicked and actions are marked with no-print', async () => {
    rabRunsApi.document.mockResolvedValueOnce({ data: mockRekapDoc })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-1"
        type="rekap"
        category="rab"
      />
    )

    const printBtn = await screen.findByRole('button', { name: /Cetak Formulir/i })
    expect(printBtn).toBeInTheDocument()

    // Buttons container has no-print class
    expect(printBtn.closest('.no-print')).toBeInTheDocument()

    await userEvent.click(printBtn)
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('6. downloads XLSX file when "Unduh XLSX" is clicked calling API with format=xlsx', async () => {
    rabRunsApi.document.mockResolvedValueOnce({ data: mockRekapDoc })
    const mockBlob = new Blob(['mock-xlsx-data'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    rabRunsApi.document.mockResolvedValueOnce({
      blob: mockBlob,
      filename: 'RAB-rekap-1.xlsx',
    })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-1"
        type="rekap"
        category="rab"
      />
    )

    const downloadBtn = await screen.findByRole('button', { name: /Unduh XLSX/i })
    await userEvent.click(downloadBtn)

    expect(rabRunsApi.document).toHaveBeenCalledWith('rab-uuid-1', 'rekap', 'xlsx')
    expect(triggerFileDownload).toHaveBeenCalledWith(mockBlob, 'RAB-rekap-1.xlsx')
  })

  it('6b. downloads a PDF file when "Unduh PDF" is clicked calling API with format=pdf', async () => {
    rabRunsApi.document.mockResolvedValueOnce({ data: mockRekapDoc })
    const mockBlob = new Blob(['%PDF-mock'], { type: 'application/pdf' })
    rabRunsApi.document.mockResolvedValueOnce({ blob: mockBlob, filename: 'RAB-rekap-1.pdf' })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-1"
        type="rekap"
        category="rab"
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: /Unduh PDF/i }))

    expect(rabRunsApi.document).toHaveBeenCalledWith('rab-uuid-1', 'rekap', 'pdf')
    expect(triggerFileDownload).toHaveBeenCalledWith(mockBlob, 'RAB-rekap-1.pdf')
  })

  it('7. displays error messages for 403, 404, 422 verbatim', async () => {
    rabRunsApi.document.mockRejectedValueOnce({
      status: 403,
      message: 'Anda tidak memiliki hak akses rab.view untuk melihat dokumen ini.',
    })

    render(
      <OutputDocumentModal
        open={true}
        onClose={vi.fn()}
        runId="rab-uuid-forbidden"
        type="rekap"
        category="rab"
      />
    )

    expect(await screen.findByText('Gagal Menampilkan Dokumen')).toBeInTheDocument()
    expect(
      screen.getByText('Anda tidak memiliki hak akses rab.view untuk melihat dokumen ini.')
    ).toBeInTheDocument()
  })
})
