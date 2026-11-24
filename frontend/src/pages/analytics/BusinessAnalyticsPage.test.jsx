import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import BusinessAnalyticsPage from './BusinessAnalyticsPage.jsx'
import { pengusahaanApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  pengusahaanApi: {
    metrics: vi.fn(),
    metric: vi.fn(),
    inputs: vi.fn(),
    saveInputs: vi.fn(),
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

function wrap(ui, can = { 'pengusahaan.view': true }, initialEntries = ['/pengusahaan']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={{ user: { id: 'usr-1', name: 'Tester' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>
            <Routes>
              <Route path="/pengusahaan" element={ui} />
              <Route path="/pengusahaan/:metricCode" element={ui} />
            </Routes>
          </NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const MOCK_METRICS_CATALOG = {
  data: {
    metrics: [
      {
        code: 'pelanggan',
        name: 'Pelanggan',
        source: '309',
        polarity: 'up',
        available: true,
        breakdown: 'Kelompok Tarif',
        series: [{ key: 'pelanggan', name: 'Jumlah Pelanggan', unit: 'pelanggan' }],
      },
      {
        code: 'kwh-jual',
        name: 'kWh Jual',
        source: '309',
        polarity: 'up',
        available: true,
        breakdown: 'Kelompok Tarif',
        series: [{ key: 'kwh', name: 'kWh Jual', unit: 'kWh' }],
      },
      {
        code: 'susut',
        name: 'Susut',
        source: 'Belum tersedia',
        polarity: 'down',
        available: false,
        breakdown: null,
        series: [],
      },
    ],
    units: [
      { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null },
      { id: 'u-1', name: 'ULP Jombang', unit_type: 'ULP', parent_id: 'up3-1' },
      { id: 'u-2', name: 'ULP Mojokerto Kota', unit_type: 'ULP', parent_id: 'up3-1' },
    ],
  },
}

const MOCK_METRIC_DETAIL = {
  data: {
    unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
    metric: {
      code: 'kwh-jual',
      name: 'kWh Jual',
      source: '309',
      polarity: 'up',
      ytd_mode: 'sum',
    },
    from: '2026-01',
    to: '2026-02',
    months: ['2026-01', '2026-02'],
    units_expected: 2,
    units_reporting: [2, 1], // Bulan kedua baru 1 dari 2 ULP
    comparison_basis: { mom: 1, yoy: 1, ytd: 1 },
    series: [
      {
        key: 'kwh',
        name: 'kWh Jual',
        unit: 'kWh',
        values: [170000, 120000],
        previous_year: [150000, 150000],
      },
    ],
    summary: [
      {
        key: 'kwh',
        latest: 120000,
        previous_month: 170000,
        mom_pct: -29.4,
        same_month_last_year: 150000,
        yoy_pct: 20.0,
        ytd: 290000,
        ytd_previous_year: 300000,
        ytd_pct: 20.0,
      },
    ],
    breakdown: {
      dimension: 'Kelompok Tarif',
      period: '2026-02',
      rows: [
        {
          key: 'Rumah tangga',
          value: 90000,
          share_pct: 75.0,
          same_month_last_year: 80000,
          yoy_pct: 12.5,
        },
        {
          key: 'Bisnis',
          value: 30000,
          share_pct: 25.0,
          same_month_last_year: 25000,
          yoy_pct: 20.0,
        },
      ],
    },
    comparison: [
      {
        unit_id: 'u-1',
        unit_name: 'ULP Jombang',
        latest: 120000,
        yoy_pct: 20.0,
        ytd: 240000,
      },
      {
        unit_id: 'u-2',
        unit_name: 'ULP Mojokerto Kota',
        latest: 0,
        yoy_pct: null,
        ytd: 50000,
      },
    ],
    coverage: {
      months_expected: 2,
      missing: [
        {
          unit_id: 'u-2',
          unit_name: 'ULP Mojokerto Kota',
          months: ['2026-02'],
        },
      ],
    },
    insights: [
      {
        level: 'perhatian',
        text: 'Angka UP3 bulan Februari 2026 hanya mencakup 1 dari 2 ULP.',
      },
      {
        level: 'baik',
        text: 'Pertumbuhan penjualan kumulatif meningkat 20% dibandingkan periode yang sama tahun lalu.',
      },
    ],
  },
}

describe('BusinessAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan hero card dan filter unit', async () => {
    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockResolvedValue(MOCK_METRIC_DETAIL)

    wrap(<BusinessAnalyticsPage />)

    expect(await screen.findByText('Analisa & Tren Pengusahaan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sinkronisasi Data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Segarkan' })).toBeInTheDocument()
    expect(screen.getByLabelText('Pilih Unit UP3')).toBeInTheDocument()
    expect(screen.getByLabelText('Pilih Unit ULP')).toBeInTheDocument()
    expect(screen.getByLabelText('Dari bulan')).toBeInTheDocument()
    expect(screen.getByLabelText('Sampai bulan')).toBeInTheDocument()
  })

  it('2. menampilkan peringatan jika angka UP3 pada bulan terakhir belum utuh', async () => {
    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockResolvedValue(MOCK_METRIC_DETAIL)

    wrap(<BusinessAnalyticsPage />)

    expect(
      await screen.findByText(/Perhatian: Angka UP3 pada bulan .* belum utuh/i),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/1 dari 2 ULP/i).length).toBeGreaterThan(0)
  })

  it('3. menampilkan kartu ringkasan KPI, breakdown komposisi, dan perbandingan ULP', async () => {
    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockResolvedValue(MOCK_METRIC_DETAIL)

    wrap(<BusinessAnalyticsPage />)

    // Tunggu data metrik termuat
    expect(await screen.findByText('Perbandingan Antar ULP')).toBeInTheDocument()

    // Rincian breakdown
    expect(screen.getByText(/Kelompok Tarif/i)).toBeInTheDocument()
    expect(screen.getByText('Rumah tangga')).toBeInTheDocument()
    expect(screen.getByText('75,0%')).toBeInTheDocument()

    // Perbandingan antar ULP
    expect(screen.getAllByText(/ULP Jombang/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ULP Mojokerto Kota/i).length).toBeGreaterThan(0)

    // Wawasan otomatis
    expect(screen.getByText(/Wawasan & Catatan Analisa Otomatis/i)).toBeInTheDocument()
    expect(screen.getByText(/Pertumbuhan penjualan kumulatif meningkat/i)).toBeInTheDocument()
  })

  it('4. dapat memuat metrik dari parameter URL rute', async () => {
    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockResolvedValue(MOCK_METRIC_DETAIL)

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'kwh-jual',
        expect.objectContaining({ unit_id: 'up3-1' }),
      )
    })
  })

  it('5. menampilkan tab Masukan kWh Beli pada metrik Susut dan dapat menyimpan', async () => {
    const susutCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics.filter((m) => m.code !== 'susut'),
          {
            code: 'susut',
            name: 'Susut',
            source: '309 & Beli',
            polarity: 'down',
            available: true,
            breakdown: 'Unit',
            series: [{ key: 'susut', name: 'Susut Distribusi', unit: '%' }],
          },
        ],
      },
    }

    const susutInputsData = {
      data: {
        unit: { id: 'u-1', name: 'ULP Jombang' },
        year: 2026,
        can_edit: true,
        months: [
          {
            period: '2026-01',
            inputs: {
              'kwh-beli': { value: 1000, note: '' },
              'e-min': { value: 20, note: '' },
              'pssd': { value: 30, note: '' },
            },
            kwh_jual: 900,
            susut_pct: 5.26,
            susut_kumulatif_pct: 5.26,
          },
          {
            period: '2026-02',
            inputs: {
              'kwh-beli': null,
              'e-min': null,
              'pssd': null,
            },
            kwh_jual: 920,
            susut_pct: null,
            susut_kumulatif_pct: null,
          },
        ],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(susutCatalog)
    pengusahaanApi.metric.mockResolvedValue({
      ...MOCK_METRIC_DETAIL,
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: { code: 'susut', name: 'Susut', polarity: 'down', source: '309 & Beli' },
      },
    })
    pengusahaanApi.inputs.mockResolvedValue(susutInputsData)
    pengusahaanApi.saveInputs.mockResolvedValue({ message: '1 masukan berubah.', changed: 1 })

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'pengusahaan.input': true }, ['/pengusahaan/susut'])

    // Beralih ke tab "Masukan kWh Beli"
    const inputTabBtn = await screen.findByRole('button', { name: /Masukan kWh Beli/i })
    await user.click(inputTabBtn)

    // Tunggu api inputs dipanggil
    await waitFor(() => {
      expect(pengusahaanApi.inputs).toHaveBeenCalled()
    })

    // Periksa tabel masukan dan nilai kWh Beli
    expect(await screen.findByText(/Masukan Bulanan kWh Beli/i)).toBeInTheDocument()
    await waitFor(() => {
      const inputs = screen.getAllByLabelText(/^kWh Beli /i);
      expect(inputs[0]).toHaveValue(1000)
    })

    // Klik tombol Simpan Masukan
    const saveBtn = screen.getAllByRole('button', { name: /Simpan Masukan Bulanan/i })[0]
    await user.click(saveBtn)

    expect(pengusahaanApi.saveInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_id: 'u-1',
        items: expect.any(Array),
      }),
    )
  })

  it('6. menampilkan matriks umur piutang pascabayar dan rincian sekunder jika tersedia', async () => {
    const piutangCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'piutang-pascabayar-umur',
            name: 'Umur Piutang Pascabayar',
            source: 'EIS UMURPIUTANG',
            polarity: 'down',
            available: true,
            breakdown: 'Kelompok Umur',
            series: [{ key: 'lembar', name: 'Lembar Tagihan', unit: 'lbr' }],
          },
        ],
      },
    }

    const piutangDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'piutang-pascabayar-umur',
          name: 'Umur Piutang Pascabayar',
          source: 'EIS UMURPIUTANG',
          polarity: 'down',
          breakdown: 'Kelompok Umur',
          breakdown_secondary: 'Golongan Tarif (Kogol)',
        },
        months: ['2026-10'],
        from: '2026-10',
        to: '2026-10',
        latest_period: '2026-10',
        series: [{ key: 'lembar', name: 'Lembar Tagihan', unit: 'lbr' }],
        series_data: {
          lembar: { current: [150], previous: [0] },
        },
        summary: [
          { key: 'lembar', name: 'Lembar Tagihan', unit: 'lbr', latest: 150, yoy_pct: 0 }
        ],
        breakdown: {
          dimension: 'Kelompok Umur',
          period: '2026-10',
          rows: [
            { key: '< 30 Hari', value: 100, share_pct: 66.7, same_month_last_year: null, yoy_pct: null },
            { key: '> 90 Hari', value: 50, share_pct: 33.3, same_month_last_year: null, yoy_pct: null },
          ],
        },
        breakdown_secondary: {
          dimension: 'Golongan Tarif (Kogol)',
          period: '2026-10',
          rows: [
            { key: 'Kogol 1 (Sosial)', value: 40, share_pct: 26.7, same_month_last_year: null, yoy_pct: null },
            { key: 'Kogol 2 (Rumah Tangga)', value: 110, share_pct: 73.3, same_month_last_year: null, yoy_pct: null },
          ],
        },
        matrix: {
          rows_dimension: 'Kelompok Umur',
          columns_dimension: 'Golongan Tarif (Kogol)',
          period: '2026-10',
          rows: ['< 30 Hari', '> 90 Hari'],
          columns: ['Kogol 1 (Sosial)', 'Kogol 2 (Rumah Tangga)'],
          values: [
            [30, 70],
            [10, 40],
          ],
        },
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(piutangCatalog)
    pengusahaanApi.metric.mockResolvedValue(piutangDetail)

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/piutang-pascabayar-umur'])

    // Periksa tabel matriks silang
    expect(await screen.findByText(/Matriks Silang/i)).toBeInTheDocument()
    expect(screen.getAllByText('Kogol 1 (Sosial)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kogol 2 (Rumah Tangga)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('< 30 Hari').length).toBeGreaterThan(0)
    expect(screen.getAllByText('> 90 Hari').length).toBeGreaterThan(0)
  })
})
