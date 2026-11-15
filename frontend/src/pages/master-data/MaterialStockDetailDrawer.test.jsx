import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MaterialStockDetailDrawer from './MaterialStockDetailDrawer.jsx'
import { warehousesApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  warehousesApi: {
    materialDetail: vi.fn(),
  },
}))

describe('MaterialStockDetailDrawer', () => {
  const mockSummary = {
    khs_code: 'A129',
    khs_name: 'Baut mata 5/8" x 12"',
    unit: 'S',
    on_hand: 500,
    reserved: 50,
    incoming: 100,
    safety: 20,
    allocated_after: 0,
    kr_supply: 0,
    available: 450,
    available_with_kr: 450,
  }

  const mockDetailData = {
    material: {
      id: 'khs-item-1',
      khs_code: 'A129',
      khs_name: 'Baut mata 5/8" x 12"',
      unit: 'S',
      category: 'Aksesori Tiang',
      description: 'Baut mata galvanis hot dip standar PLN',
      version_number: 1,
      status: 'APPROVED',
      source_reference: 'KHS-2025-UP3-01',
      is_exempt: false,
      mapped_skus: [
        { id: 'sku-1', material_no: '10002345', note: 'ERP SAP SKU Utama', created_at: '2026-01-01' },
      ],
    },
    position: {
      on_hand: 500,
      reserved: 50,
      incoming: 100,
      safety: 20,
      allocated_after: 0,
      kr_supply: 0,
      available: 450,
      available_with_kr: 450,
    },
    warehouse_breakdown: [
      {
        warehouse_id: 'wh-1',
        warehouse_code: '5118-2080',
        warehouse_name: 'PLN Area Mojokerto',
        unit_name: 'UP3 Mojokerto',
        on_hand: 300,
        reserved: 30,
        incoming: 60,
        safety: 10,
        available: 270,
      },
      {
        warehouse_id: 'wh-2',
        warehouse_code: '5118-2810',
        warehouse_name: 'Gd Ry Jombang',
        unit_name: 'ULP Jombang',
        on_hand: 200,
        reserved: 20,
        incoming: 40,
        safety: 10,
        available: 180,
      },
    ],
    movements: {
      monthly: [
        {
          period_key: '2026-10',
          period_label: 'Okt 2026',
          start_date: '2026-10-01',
          end_date: '2026-10-31',
          qty_in: 150,
          qty_out: 80,
          net_change: 70,
          receipt_docs_count: 2,
          issue_docs_count: 5,
        },
        {
          period_key: '2026-11',
          period_label: 'Nov 2026',
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          qty_in: 200,
          qty_out: 120,
          net_change: 80,
          receipt_docs_count: 3,
          issue_docs_count: 7,
        },
      ],
      weekly: [
        {
          period_key: '2026-W44',
          period_label: 'M-44 (27/10–02/11)',
          start_date: '2026-10-27',
          end_date: '2026-11-02',
          qty_in: 50,
          qty_out: 30,
          net_change: 20,
          receipt_docs_count: 1,
          issue_docs_count: 2,
        },
        {
          period_key: '2026-W45',
          period_label: 'M-45 (03/11–09/11)',
          start_date: '2026-11-03',
          end_date: '2026-11-09',
          qty_in: 100,
          qty_out: 40,
          net_change: 60,
          receipt_docs_count: 2,
          issue_docs_count: 3,
        },
      ],
      summary: {
        total_in: 350,
        total_out: 200,
        net_total: 150,
        avg_monthly_out: 100,
        avg_weekly_out: 35,
      },
    },
    recent_transactions: {
      receipts: [
        {
          delivery_document: 'DEL-2026-001',
          receipt_document: 'REC-2026-001',
          date: '2026-11-10',
          material_no: '10002345',
          quantity: 100,
          unit: 'S',
          origin_name: 'Gudang Induk Pasuruan',
          status: 'DITERIMA',
          warehouse_code: '5118-2080',
          warehouse_name: 'PLN Area Mojokerto',
        },
      ],
      issues: [
        {
          material_document: 'ISS-2026-009',
          reservation_no: 'RES-8871',
          issued_on: '2026-11-12',
          material_no: '10002345',
          quantity: 25,
          unit: 'S',
          text: 'Pekerjaan PB Pelanggan',
          work_type_name: 'Pasang Baru',
          warehouse_code: '5118-2810',
          warehouse_name: 'Gd Ry Jombang',
        },
      ],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    warehousesApi.materialDetail.mockResolvedValue({ data: mockDetailData })
  })

  it('memuat data material lengkap dan menampilkan ringkasan stok KPI saat dibuka', async () => {
    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
          warehouseIds={['wh-1', 'wh-2']}
        />
      </MemoryRouter>
    )

    // Header info
    expect(screen.getByText('A129')).toBeInTheDocument()
    expect(screen.getAllByText(/Baut mata/i).length).toBeGreaterThan(0)

    // KPI Cards
    expect(screen.getByText('Stok Fisik')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('Reservasi')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('Pasokan Masuk')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Stok Tersedia')).toBeInTheDocument()
    expect(screen.getByText('450')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('1 SKU ERP Terpetakan')).toBeInTheDocument()
      expect(warehousesApi.materialDetail).toHaveBeenCalledWith('A129', ['wh-1', 'wh-2'], expect.any(Object))
    })
  })

  it('menampilkan grafik visual dan dapat berpindah ke tabel rincian mutasi', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
          warehouseIds={['wh-1']}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Grafik Komparasi Penerimaan vs Pengeluaran/i)).toBeInTheDocument()
    })

    // Beralih ke Tabel Rincian
    const tableBtn = screen.getByRole('button', { name: 'Tabel Rincian' })
    await user.click(tableBtn)

    // Tabel mutasi harus menampilkan kolom dan baris data
    expect(screen.getByText('Rentang Tanggal')).toBeInTheDocument()
    expect(screen.getByText('Okt 2026')).toBeInTheDocument()
    expect(screen.getByText('Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('Total Seluruh Periode')).toBeInTheDocument()
  })

  it('dapat beralih antara agregasi Per Bulan dan Per Minggu', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Per Minggu (16 Minggu)' })).toBeInTheDocument()
    })

    // Klik tombol agregasi per minggu
    const weeklyBtn = screen.getByRole('button', { name: 'Per Minggu (16 Minggu)' })
    await user.click(weeklyBtn)

    // Beralih ke Tabel Rincian untuk memeriksa label mingguan
    const tableBtn = screen.getByRole('button', { name: 'Tabel Rincian' })
    await user.click(tableBtn)

    expect(screen.getByText(/M-44/i)).toBeInTheDocument()
    expect(screen.getByText(/M-45/i)).toBeInTheDocument()
  })

  it('dapat membuka tab Stok per Gudang dan menampilkan sebaran gudang', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stok per Gudang/i })).toBeInTheDocument()
    })

    const whTab = screen.getByRole('button', { name: /Stok per Gudang/i })
    await user.click(whTab)

    expect(screen.getByText('PLN Area Mojokerto')).toBeInTheDocument()
    expect(screen.getByText('Gd Ry Jombang')).toBeInTheDocument()
    expect(screen.getByText('5118-2080')).toBeInTheDocument()
  })

  it('dapat membuka tab Dokumen Transaksi MIMS dan Spesifikasi & SKU ERP', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Dokumen Transaksi MIMS/i })).toBeInTheDocument()
    })

    // Buka tab Dokumen Transaksi
    const docTab = screen.getByRole('button', { name: /Dokumen Transaksi MIMS/i })
    await user.click(docTab)

    expect(screen.getByText('ISS-2026-009')).toBeInTheDocument()
    expect(screen.getByText(/Pemesanan: RES-8871/i)).toBeInTheDocument()

    // Buka tab Spesifikasi & SKU ERP
    const specTab = screen.getByRole('button', { name: /Spesifikasi & SKU ERP/i })
    await user.click(specTab)

    expect(screen.getByText('10002345')).toBeInTheDocument()
    expect(screen.getByText(/Baut mata galvanis hot dip/i)).toBeInTheDocument()
    expect(screen.getByText('Buka Meja Kerja Pemetaan →')).toHaveAttribute('href', '/master-data/pemetaan-sku')
  })

  it('dapat menampilkan tab Proyeksi Kebutuhan (Forecast) beserta grafik dan tabel forecasting', async () => {
    const user = userEvent.setup()
    const mockForecast = {
      totals: {
        '3': { p10: 30, p50: 45, p90: 60 },
        '6': { p10: 65, p50: 90, p90: 120 },
        '12': { p10: 130, p50: 180, p90: 240 },
      },
      months: [
        { month: '2026-12', p10: 10, p50: 15, p90: 20 },
        { month: '2027-01', p10: 11, p50: 16, p90: 22 },
        { month: '2027-02', p10: 9, p50: 14, p90: 18 },
      ],
      history_months: 24,
      last_12_months: 150,
    }

    render(
      <MemoryRouter>
        <MaterialStockDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          materialSummary={mockSummary}
          initialTab="forecast"
          forecastData={mockForecast}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Proyeksi 3 Bulan \(p50\)/i)).toBeInTheDocument()
    })

    // Memverifikasi KPI Card Proyeksi
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.getByText('180')).toBeInTheDocument()
    expect(screen.getByText(/Kecukupan Stok \(Runway\)/i)).toBeInTheDocument()

    // Memverifikasi keberadaan Grafik SVG
    expect(screen.getByRole('img', { name: /Grafik Proyeksi Kebutuhan Material 12 Bulan/i })).toBeInTheDocument()

    // Berpindah ke mode Tabel Rincian Proyeksi
    const tableToggle = screen.getByRole('button', { name: /Tabel Rincian/i })
    await user.click(tableToggle)

    // Memverifikasi isi tabel
    expect(screen.getByText(/Kebutuhan Kumulatif/i)).toBeInTheDocument()
    expect(screen.getByText(/Estimasi Sisa Stok/i)).toBeInTheDocument()
    expect(screen.getByText('Total Proyeksi 12 Bulan')).toBeInTheDocument()
  })
})
