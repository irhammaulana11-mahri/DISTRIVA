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
  reportsApi: {
    customerGrowth: vi.fn().mockResolvedValue({
      data: {
        filters: { from: null, to: null, units: 1 },
        as_of: '2026-11-14',
        kpi: {
          last_full_month: '2026-10',
          l12m: { pb_count: 400, pb_kva: 1200, pd_net_kva: 90 },
          prev12m: { pb_count: 320, pb_kva: 900, pd_net_kva: 50 },
          l12m_growth_pct: 25,
          ytd: { year: 2026, months: 10, pb_count: 330, pb_kva: 1000 },
          ytd_prev: { year: 2025, months: 10, pb_count: 280, pb_kva: 800 },
          ytd_growth_pct: 17.9,
          pb_total: 1500,
          pb_kva_total: 4000,
          avg_kva_per_pb: 2.67,
        },
        monthly: [
          { month: '2026-09', partial: false, pb_count: 30, pb_kva: 80, pd_net_kva: 10, requests_pb: 35, mom_pct: 5, yoy_pct: 10 },
          { month: '2026-10', partial: false, pb_count: 40, pb_kva: 100, pd_net_kva: 15, requests_pb: 45, mom_pct: 33.3, yoy_pct: 15 },
        ],
        yearly: [
          { year: 2025, months: 12, partial: false, pb_count: 320, pb_kva: 900, pd_net_kva: 50, requests_pb: 360, cancelled: 20, refunded: 3, avg_kva_per_pb: 2.81, yoy_pct: 10, yoy_kva_pct: 12 },
          { year: 2026, months: 10, partial: true, pb_count: 330, pb_kva: 1000, pd_net_kva: 60, requests_pb: 370, cancelled: 15, refunded: 2, avg_kva_per_pb: 3.03, yoy_pct: 15, yoy_kva_pct: 18 },
        ],
        by_tariff: { groups: [{ group: 'Rumah tangga', count: 90, kva: 180, share_pct: 75, kva_share_pct: 60, avg_kva: 2 }], top_codes: [] },
        by_unit: [{ unit_id: 'u-1', unit_name: 'ULP Jombang', pb_count: 70, l12m_pb: 60, l12m_kva: 160, by_year: [] }],
        seasonality: { years: [2025], months: [] },
        anomalies: [],
        notes: [],
      },
    }),
    downloadCustomerGrowthXlsx: vi.fn(),
  },
  pengusahaanApi: {
    metrics: vi.fn(),
    metric: vi.fn(),
    inputs: vi.fn(),
    saveInputs: vi.fn(),
    forecast: vi.fn().mockResolvedValue({
      data: {
        status: 'OK',
        metric: { code: 'pelanggan', name: 'Pelanggan', polarity: 'up' },
        series: [
          {
            key: 'pelanggan',
            name: 'Jumlah Pelanggan',
            unit: 'pelanggan',
            status: 'OK',
            history_months: 24,
            history: [{ month: '2026-09', value: 1400000 }, { month: '2026-10', value: 1403000 }],
            forecast: [{ month: '2026-11', p10: 1404000, p50: 1406000, p90: 1408000 }],
            target: { month: '2027-10', p50: 1430000, change_pct: 1.9 },
            quality: { wape: 0.02, naive_wape: 0.05, gain_vs_naive_pct: 60.0 },
          },
        ],
        insights: [{ level: 'baik', text: 'Model prakiraan memiliki akurasi lebih baik 60% dibanding naif.' }],
      },
    }),
    history: vi.fn().mockResolvedValue({
      data: {
        family: '309',
        year: 2026,
        latest_month: '2026-10',
        expected_until: '2026-10',
        available_years: [2026, 2025],
        months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
        coverage: {
          due: [true, true, true, true, true, true, true, true, true, true, false, false],
          expected_total: 10,
          missing_total: 0,
          units: [
            {
              unit_id: 'u-1',
              unit_name: 'ULP Jombang',
              months: [true, true, true, true, true, true, true, true, true, true, false, false],
              missing: [],
              missing_count: 0,
            },
          ],
        },
        files: [
          { id: 'f-1', period: '2026-10', unit_name: 'ULP Jombang', original_name: '309-51453-202610.xls', status: 'AKTIF', line_count: 50, warnings_count: 0, imported_at: '2026-11-01' },
        ],
        inputs: [],
        syncs: null,
      },
    }),
    export: vi.fn().mockResolvedValue(new Blob(['excel-data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
  },
  outageApi: {
    analysis: vi.fn().mockResolvedValue({
      data: {
        coverage: { events: 10, unmatched_feeder_events: 0 },
        kpi: {
          last_full_month: '2026-03',
          l12m: { events: 10, permanent: 6, temporary: 4, ens_kwh: 1200, saifi: 0.12, saidi: 4.5 },
          prev12m: { events: 12, permanent: 8, temporary: 4, ens_kwh: 1500, saifi: 0.15, saidi: 5.2 },
          change_pct: { events: -16.7, permanent: -25.0, temporary: 0, ens_kwh: -20.0, saifi: -20.0, saidi: -13.5 },
        },
        monthly: [],
        yearly: [],
        by_cause: [],
        by_weather: [],
        by_device: [],
        by_hour: [],
        by_feeder: [],
        settings: { saidi_min_minutes: 5, saidi_only_permanent: false },
        notes: [],
      },
    }),
    downloadAnalysisXlsx: vi.fn(),
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
    // Tombol sinkronisasi kontekstual: default metrik pelanggan menampilkan "Sinkronisasi Permohonan EIS"
    expect(screen.getByRole('button', { name: /Sinkronisasi Permohonan EIS/i })).toBeInTheDocument()
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

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />)

    // Tunggu data metrik termuat pada tab default Tren
    expect(await screen.findByText(/Tren Bulanan:/i)).toBeInTheDocument()

    // Wawasan otomatis tampil di tab Tren
    expect(screen.getByText(/Wawasan & Catatan Analisa Otomatis/i)).toBeInTheDocument()
    expect(screen.getByText(/Pertumbuhan penjualan kumulatif meningkat/i)).toBeInTheDocument()

    // Beralih ke tab Rincian untuk memeriksa breakdown dan perbandingan ULP
    const rincianTab = screen.getByRole('button', { name: /^Rincian$/i })
    await user.click(rincianTab)

    expect(await screen.findByText('Perbandingan Antar ULP')).toBeInTheDocument()

    // Rincian breakdown
    expect(screen.getByText(/Kelompok Tarif/i)).toBeInTheDocument()
    expect(screen.getAllByText('Rumah tangga').length).toBeGreaterThan(0)
    expect(screen.getAllByText('75,0%').length).toBeGreaterThan(0)

    // Perbandingan antar ULP
    expect(screen.getAllByText(/ULP Jombang/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ULP Mojokerto Kota/i).length).toBeGreaterThan(0)
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
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'susut') {
        return Promise.resolve({
          ...MOCK_METRIC_DETAIL,
          data: {
            ...MOCK_METRIC_DETAIL.data,
            metric: { code: 'susut', name: 'Susut', polarity: 'down', source: '309 & Beli' },
          },
        })
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
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
    const user = userEvent.setup()
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

    // Klik tab Rincian untuk melihat matriks dan breakdown secondary
    const rincianTab = await screen.findByRole('button', { name: /^Rincian$/i })
    await user.click(rincianTab)

    // Periksa tabel matriks silang
    expect(await screen.findByText(/Matriks Silang/i)).toBeInTheDocument()
    expect(screen.getAllByText('Kogol 1 (Sosial)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kogol 2 (Rumah Tangga)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('< 30 Hari').length).toBeGreaterThan(0)
    expect(screen.getAllByText('> 90 Hari').length).toBeGreaterThan(0)
  })

  it('mendukung tab sub-analisis gangguan dan integrasi APKT saat membuka metrik gangguan penyulang', async () => {
    const user = userEvent.setup()
    const gangguanCatalog = {
      data: {
        units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null }],
        metrics: [
          {
            code: 'gangguan',
            name: 'Gangguan Penyulang',
            source: 'EIS DIFI',
            polarity: 'down',
            available: true,
            series: [{ key: 'gangguan', name: 'Kali Gangguan', unit: 'kali' }],
          },
        ],
      },
    }

    const gangguanDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'gangguan',
          name: 'Gangguan Penyulang',
          source: 'EIS DIFI',
          polarity: 'down',
        },
        months: ['2026-03'],
        from: '2026-03',
        to: '2026-03',
        latest_period: '2026-03',
        series: [{ key: 'gangguan', name: 'Kali Gangguan', unit: 'kali' }],
        series_data: {
          gangguan: { current: [12], previous: [15] },
        },
        summary: [{ key: 'gangguan', name: 'Kali Gangguan', unit: 'kali', latest: 12, yoy_pct: -20 }],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(gangguanCatalog)
    pengusahaanApi.metric.mockResolvedValue(gangguanDetail)

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/gangguan'])

    // Terdapat sub-tab untuk Tren, Rincian Gangguan (APKT), Penyulang & Gardu, Prakiraan, dan Histori
    expect(await screen.findByRole('button', { name: /^Tren$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rincian Gangguan \(APKT\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Penyulang & Gardu/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Prakiraan$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Histori Sinkronisasi$/i })).toBeInTheDocument()

    // Tombol sinkronisasi kontekstual metrik gangguan adalah "Sinkronisasi Gangguan"
    expect(screen.getByRole('button', { name: 'Sinkronisasi Gangguan' })).toBeInTheDocument()

    // Klik tab Rincian Gangguan (APKT)
    await user.click(screen.getByRole('button', { name: /Rincian Gangguan \(APKT\)/i }))

    // OutageAnalysisContent ter-render
    expect(await screen.findByText(/Gangguan 12 bln terakhir/i)).toBeInTheDocument()
  })

  it('8. menu pelanggan di bawah pengusahaan menampilkan angka resmi 309, tab rincian permohonan, data penjelas, dan rekonsiliasi', async () => {
    const pelangganDetailWithReconciliation = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'pelanggan',
          name: 'Pelanggan',
          source: '309 (baris JUMLAH)',
          polarity: 'up',
          ytd_mode: 'last',
        },
        from: '2026-01',
        to: '2026-02',
        months: ['2026-01', '2026-02'],
        units_expected: 2,
        units_reporting: [2, 2],
        series: [{ key: 'pelanggan', name: 'Jumlah Pelanggan', unit: 'pelanggan', values: [1400000, 1403000], previous_year: [1380000, 1382000] }],
        summary: [{ key: 'pelanggan', name: 'Jumlah Pelanggan', unit: 'pelanggan', latest: 1403000, yoy_pct: 1.5, ytd: 1403000, ytd_pct: 1.5 }],
        companions: {
          source: 'Permohonan Pelanggan DISTRIVA',
          series: [
            { key: 'pb', name: 'Pelanggan baru tersambung (PB)', unit: 'plg', latest: 3200, ytd: 6500 },
            { key: 'req_pb', name: 'Permohonan PB masuk', unit: 'plg', latest: 3600, ytd: 7200 },
          ],
        },
        reconciliations: [
          {
            key: 'pb',
            mode: 'net',
            unit: 'plg',
            official_name: 'Penambahan pelanggan Laporan 309',
            companion_name: 'Pelanggan baru tersambung (PB)',
            note: '309 adalah posisi akhir bulan, penambahan = selisih antar bulan. PB permohonan status PEREMAJAAN.',
            monthly: [
              { month: '2026-01', official_net: 3000, companion: 3300, difference: 300, units_compared: 2 },
              { month: '2026-02', official_net: 3000, companion: 3200, difference: 200, units_compared: 2 },
            ],
            ytd: {
              year: 2026,
              base_month: '2025-12',
              to_month: '2026-02',
              official_net: 6000,
              companion: 6500,
              difference: 500,
              units_compared: 2,
              units_expected: 2,
            },
          },
        ],
        insights: [{ level: 'info', text: 'Data rekonsiliasi menunjukkan pertumbuhan PB stabil.' }],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'pelanggan') {
        return Promise.resolve(pelangganDetailWithReconciliation)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelanggan'])

    // Header dan badge
    expect(await screen.findByText('Analisa & Tren Pelanggan')).toBeInTheDocument()
    expect(screen.getByText('Laporan 309 & Permohonan EIS')).toBeInTheDocument()

    // Susunan tab standar butir 14: Tren, Rekonsiliasi, Rincian Permohonan (EIS), Prakiraan, Histori Sinkronisasi
    expect(await screen.findByRole('button', { name: /^Rekonsiliasi$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Tren$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rincian Permohonan \(EIS\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Prakiraan$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Histori Sinkronisasi$/i })).toBeInTheDocument()

    // Beralih ke tab Rekonsiliasi
    await user.click(screen.getByRole('button', { name: /^Rekonsiliasi$/i }))

    // Data Penjelas Operasional
    expect(await screen.findByText('Data Penjelas Operasional')).toBeInTheDocument()
    expect(screen.getAllByText('Permohonan Pelanggan DISTRIVA').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pelanggan baru tersambung (PB)').length).toBeGreaterThan(0)

    // Rekonsiliasi Angka Resmi vs Penjelas
    expect(screen.getByText(/Rekonsiliasi: Penambahan pelanggan Laporan 309 vs Pelanggan baru tersambung/i)).toBeInTheDocument()
    expect(screen.getByText('Mode Saldo Bersih (Net)')).toBeInTheDocument()
    expect(screen.getAllByText(/309 adalah posisi akhir bulan/i).length).toBeGreaterThan(0)

    // Klik tab Rincian Permohonan (EIS)
    await user.click(screen.getByRole('button', { name: /Rincian Permohonan \(EIS\)/i }))

    // Komponen CustomerAnalysisContent tampil
    expect(await screen.findByText('Pelanggan baru (PB) per bulan')).toBeInTheDocument()
    expect(screen.getByText('Delta pelanggan bulanan')).toBeInTheDocument()
  })

  it('9. mendukung Butir 14: unduh Excel, tab Prakiraan, dan tab Histori Sinkronisasi', async () => {
    pengusahaanApi.metrics.mockResolvedValue(MOCK_METRICS_CATALOG)
    pengusahaanApi.metric.mockResolvedValue(MOCK_METRIC_DETAIL)

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelanggan'])

    // Tombol Unduh Excel di header
    const exportBtn = await screen.findByRole('button', { name: /Unduh Excel/i })
    expect(exportBtn).toBeInTheDocument()
    await user.click(exportBtn)
    expect(pengusahaanApi.export).toHaveBeenCalledWith('pelanggan', expect.any(Object))

    // Klik tab Prakiraan
    const forecastTabBtn = screen.getByRole('button', { name: /^Prakiraan$/i })
    await user.click(forecastTabBtn)
    expect(pengusahaanApi.forecast).toHaveBeenCalledWith('pelanggan', expect.any(Object))
    expect(await screen.findByRole('heading', { name: /Prakiraan 12 Bulan ke Depan/i })).toBeInTheDocument()

    // Klik tab Histori Sinkronisasi
    const historyTabBtn = screen.getByRole('button', { name: /^Histori Sinkronisasi$/i })
    await user.click(historyTabBtn)
    expect(pengusahaanApi.history).toHaveBeenCalledWith('pelanggan', expect.any(Object))
    expect(await screen.findByText(/Matriks Kelengkapan Laporan/i)).toBeInTheDocument()
    expect(screen.getByText(/309-51453-202610\.xls/i)).toBeInTheDocument()

    // Butir 18: Mengganti pilihan tahun memanggil ulang history dengan parameter year
    const yearSelect = screen.getByLabelText(/Filter Tahun Matriks Kelengkapan/i)
    await user.selectOptions(yearSelect, '2025')
    expect(pengusahaanApi.history).toHaveBeenCalledWith('pelanggan', expect.objectContaining({ year: 2025 }))
  })

  it('10. mendukung Butir 15: menu Anomali Gangguan dan Anomali Keluhan dengan polarity down', async () => {
    const anomaliCatalog = {
      data: {
        units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null }],
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'anomali-gangguan',
            name: 'Anomali Gangguan',
            source: 'EIS GGNBERULANG & GGNNEGATIF',
            polarity: 'down',
            available: true,
            breakdown: 'Kanal Pengaduan Masuk',
            series: [{ key: 'wo', name: 'Total Pengaduan (WO)', unit: 'laporan' }],
          },
        ],
      },
    }

    const anomaliDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'anomali-gangguan',
          name: 'Anomali Gangguan',
          source: 'EIS GGNBERULANG & GGNNEGATIF',
          polarity: 'down',
        },
        months: ['2026-10'],
        from: '2026-10',
        to: '2026-10',
        series: [
          { key: 'wo', name: 'Total Pengaduan (WO)', unit: 'laporan', values: [500] },
          { key: 'berulang', name: 'Gangguan Berulang', unit: 'laporan', values: [25] },
          { key: 'negatif', name: 'Rating Negatif', unit: 'laporan', values: [10] },
          { key: 'negatif_nonmarking', name: 'Rating Negatif Non-Marking', unit: 'laporan', values: [4] },
        ],
        summary: [
          { key: 'wo', latest: 500, mom_pct: 10, yoy_pct: 5, ytd: 4500 },
          { key: 'berulang', latest: 25, mom_pct: 5, yoy_pct: -2, ytd: 200 },
          { key: 'negatif', latest: 10, mom_pct: -1, yoy_pct: -3, ytd: 90 },
          { key: 'negatif_nonmarking', latest: 4, mom_pct: 0, yoy_pct: 0, ytd: 30 },
        ],
        breakdown: {
          dimension: 'Kanal Pengaduan Masuk',
          period: '2026-10',
          rows: [
            { key: 'PLN Mobile', value: 350, share_pct: 70, same_month_last_year: null, yoy_pct: null },
            { key: 'CC 123', value: 150, share_pct: 30, same_month_last_year: null, yoy_pct: null },
          ],
        },
        insights: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(anomaliCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'anomali-gangguan') {
        return Promise.resolve(anomaliDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/anomali-gangguan'])

    // Tunggu detail anomali-gangguan selesai dimuat
    expect(await screen.findByText(/Analisa & Tren Anomali Gangguan/i)).toBeInTheDocument()
    expect(screen.getAllByText('Anomali Gangguan').length).toBeGreaterThan(0)

    // Tab Rincian menampilkan porsi breakdown kanal
    const rincianTab = screen.getByRole('button', { name: /^Rincian$/i })
    await user.click(rincianTab)
    expect(await screen.findByText(/Rincian: Kanal Pengaduan Masuk/i)).toBeInTheDocument()
    expect(screen.getAllByText('PLN Mobile').length).toBeGreaterThan(0)
    expect(screen.getAllByText('70,0%').length).toBeGreaterThan(0)
  })

  it('11. mendukung Butir 17: Gangguan Penyulang, SAIDI/SAIFI, dan ENS tingkat penyulang lawan DIFI', async () => {
    const outageCatalog = {
      data: {
        units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null }],
        metrics: [
          {
            code: 'gangguan',
            name: 'Gangguan Penyulang',
            source: 'Spreadsheet Gangguan Penyulang & DIFI',
            polarity: 'down',
            available: true,
            series: [
              { key: 'jumlah', name: 'Total Gangguan', unit: 'kali' },
              { key: 'dihitung', name: 'Gangguan Dihitung (Lebih dari ambang)', unit: 'kali' },
            ],
          },
        ],
      },
    }

    const outageDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'gangguan',
          name: 'Gangguan Penyulang',
          source: 'Spreadsheet Gangguan Penyulang & DIFI',
          polarity: 'down',
        },
        months: ['2026-01', '2026-02'],
        from: '2026-01',
        to: '2026-02',
        series: [
          { key: 'jumlah', name: 'Total Gangguan', unit: 'kali', values: [10, 8] },
          { key: 'dihitung', name: 'Gangguan Dihitung (Lebih dari ambang)', unit: 'kali', values: [8, 6] },
        ],
        summary: [
          { key: 'jumlah', latest: 8, mom_pct: -20, yoy_pct: -10, ytd: 18 },
          { key: 'dihitung', latest: 6, mom_pct: -25, yoy_pct: -15, ytd: 14 },
        ],
        companions: {
          source: 'Laporan DIFI (Tingkat Penyulang: Gardu Induk 20 kV & Penyulang)',
          series: [
            { key: 'difi_gangguan', name: 'Gangguan Penyulang (DIFI)', unit: 'kali', latest: 8, ytd: 18 },
            { key: 'difi_pelanggan_gangguan', name: 'Pelanggan Padam Gangguan (DIFI)', unit: 'plg', latest: 500, ytd: 1200 },
            { key: 'difi_pemeliharaan', name: 'Pemeliharaan Penyulang (DIFI)', unit: 'kali', latest: 2, ytd: 4 },
            { key: 'difi_pelanggan_pemeliharaan', name: 'Pelanggan Padam Pemeliharaan (DIFI)', unit: 'plg', latest: 300, ytd: 600 },
          ],
        },
        reconciliations: [
          {
            key: 'gangguan',
            mode: 'flow',
            unit: 'kali',
            official_name: 'Gangguan Penyulang Dihitung (Spreadsheet)',
            companion_name: 'Gangguan Penyulang Laporan DIFI',
            note: 'Rekonsiliasi gangguan lebih dari ambang menit lawan gangguan penyulang DIFI.',
            monthly: [
              { month: '2026-01', official_net: 8, companion: 8, difference: 0, units_compared: 1 },
              { month: '2026-02', official_net: 6, companion: null, difference: null, units_compared: 0 },
            ],
            ytd: {
              year: 2026,
              official_net: 14,
              companion: null,
              difference: null,
              units_compared: 0,
              units_expected: 1,
            },
          },
        ],
        insights: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(outageCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'gangguan') {
        return Promise.resolve(outageDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/gangguan'])

    // Teks header hero mencantumkan spreadsheet gangguan penyulang
    expect(await screen.findByText(/Analisa & Tren Gangguan Penyulang/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Spreadsheet Gangguan Penyulang & DIFI/i).length).toBeGreaterThan(0)

    // Buka tab Rekonsiliasi
    const recTab = screen.getByRole('button', { name: /^Rekonsiliasi$/i })
    await user.click(recTab)

    // Data Penjelas Operasional menampilkan seri DIFI tingkat penyulang
    expect(await screen.findByText(/Pelanggan Padam Gangguan \(DIFI\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Pemeliharaan Penyulang \(DIFI\)/i)).toBeInTheDocument()

    // Bulan tanpa laporan DIFI menampilkan 'Belum ada' (bukan 0 atau tanda strip kosong biasa)
    expect(screen.getByText(/Belum ada/i)).toBeInTheDocument()
  })

  it('menampilkan pita peringatan DIFI belum lengkap dan penanda pada grafik/tabel (Butir 19)', async () => {
    const difiWarnDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        from: '2026-09',
        to: '2026-10',
        months: ['2026-09', '2026-10'],
        metric: {
          code: 'saidi-saifi',
          name: 'SAIDI / SAIFI',
          unit: 'jam/plg & kali/plg',
          polarity: 'down',
          source: 'Laporan DIFI',
        },
        warnings: [
          {
            code: 'difi_latest_month_incomplete',
            severity: 'warning',
            month: '2026-10',
            message: 'Laporan DIFI 2026-10 kemungkinan belum lengkap: nol gangguan tidak terencana padahal tiga bulan sebelumnya rata-rata 16.7 kejadian.',
            events_latest: 0,
            events_previous_average: 16.7,
            units_reporting: 10,
          },
        ],
        reconciliations: [
          {
            key: 'saidi_penyulang',
            title: 'Rekonsiliasi SAIDI Bagian Penyulang',
            mode: 'flow',
            unit: 'menit/plg',
            official_name: 'DIFI Total',
            companion_name: 'DIFI Bagian Penyulang',
            monthly: [
              { month: '2026-09', official_net: 0.05, companion: 0.05, difference: 0, units_compared: 1 },
              { month: '2026-10', official_net: 0.02, companion: 0.02, difference: 0, units_compared: 1 },
            ],
            ytd: {
              year: 2026,
              official_net: 0.07,
              companion: 0.07,
              difference: 0,
              units_compared: 1,
              units_expected: 1,
            },
          },
        ],
      },
    }

    const saidiCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'saidi-saifi',
            name: 'SAIDI / SAIFI',
            source: 'Laporan DIFI & Data Gangguan',
            polarity: 'down',
            available: true,
            series: [{ key: 'saidi', name: 'SAIDI', unit: 'menit/plg' }],
          },
        ],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(saidiCatalog)
    pengusahaanApi.metric.mockResolvedValue(difiWarnDetail)

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/saidi-saifi'])

    // Verifikasi pita peringatan muncul
    expect(await screen.findByText(/Laporan DIFI 2026-10 kemungkinan belum lengkap/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Bulan Okt 26/i).length).toBeGreaterThan(0)

    // Verifikasi tombol Tarik SAIDI/SAIFI APKT tersedia
    expect(screen.getByRole('button', { name: 'Tarik SAIDI/SAIFI APKT' })).toBeInTheDocument()

    // Buka tab Rekonsiliasi untuk melihat penanda belum lengkap
    const recTab = screen.getByRole('button', { name: /^Rekonsiliasi$/i })
    await user.click(recTab)
    expect(await screen.findByText(/Mode Arus Bulanan/i)).toBeInTheDocument()
    // Badge "belum lengkap" muncul di samping nama bulan pada tabel rekonsiliasi
    expect(screen.getByText('belum lengkap')).toBeInTheDocument()
  })

  it('13. mendukung menu RPT-RCT Gangguan bersumber APKT dengan 2 varian berdampingan dan peringatan bulan berjalan (Butir 25 & 26)', async () => {
    const rptCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'rpt-rct-gangguan',
            name: 'RPT-RCT Gangguan',
            source: 'APKT – Jumlah dan Durasi RPT RCT Gangguan (Semua Laporan; pembanding Laporan Tanpa Clear Temper)',
            polarity: 'down',
            available: true,
            series: [
              { key: 'rpt', name: 'RPT – Semua laporan (APKT)', unit: 'menit' },
              { key: 'rct', name: 'RCT – Semua laporan (APKT)', unit: 'menit' },
              { key: 'jumlah', name: 'Jumlah WO – Semua laporan (APKT)', unit: 'kali' },
              { key: 'rpt_tanpa_ct', name: 'RPT – Tanpa clear temper (APKT)', unit: 'menit' },
              { key: 'rct_tanpa_ct', name: 'RCT – Tanpa clear temper (APKT)', unit: 'menit' },
              { key: 'jumlah_tanpa_ct', name: 'Jumlah WO – Tanpa clear temper (APKT)', unit: 'kali' },
              { key: 'porsi_clear_temper', name: 'Porsi WO clear temper', unit: '%' },
            ],
          },
        ],
      },
    }

    const rptDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'rpt-rct-gangguan',
          name: 'RPT-RCT Gangguan',
          unit: 'menit',
          polarity: 'down',
          source: 'APKT – Jumlah dan Durasi RPT RCT Gangguan (Semua Laporan; pembanding Laporan Tanpa Clear Temper)',
        },
        from: '2026-10',
        to: '2026-10',
        months: ['2026-10'],
        available_from: '2026-01',
        available_to: '2026-10',
        summary: [
          { key: 'rpt', name: 'RPT – Semua laporan (APKT)', unit: 'menit', latest: 35.0, ytd: 35.0, mom_pct: -5.0, yoy_pct: 10.0 },
          { key: 'rct', name: 'RCT – Semua laporan (APKT)', unit: 'menit', latest: 90.0, ytd: 90.0, mom_pct: -2.0, yoy_pct: 5.0 },
          { key: 'jumlah', name: 'Jumlah WO – Semua laporan (APKT)', unit: 'kali', latest: 40, ytd: 40, mom_pct: 0, yoy_pct: 0 },
          { key: 'rpt_tanpa_ct', name: 'RPT – Tanpa clear temper (APKT)', unit: 'menit', latest: 27.1, ytd: 27.1 },
          { key: 'rct_tanpa_ct', name: 'RCT – Tanpa clear temper (APKT)', unit: 'menit', latest: 80.0, ytd: 80.0 },
          { key: 'jumlah_tanpa_ct', name: 'Jumlah WO – Tanpa clear temper (APKT)', unit: 'kali', latest: 14, ytd: 14 },
          { key: 'porsi_clear_temper', name: 'Porsi WO clear temper', unit: '%', latest: 65.0, ytd: 65.0 },
        ],
        series: [
          { key: 'rpt', name: 'RPT – Semua laporan (APKT)', unit: 'menit', values: [35.0], previous_year: [30.0] },
          { key: 'rct', name: 'RCT – Semua laporan (APKT)', unit: 'menit', values: [90.0], previous_year: [85.0] },
          { key: 'jumlah', name: 'Jumlah WO – Semua laporan (APKT)', unit: 'kali', values: [40], previous_year: [40] },
          { key: 'rpt_tanpa_ct', name: 'RPT – Tanpa clear temper (APKT)', unit: 'menit', values: [27.1], previous_year: [25.0] },
          { key: 'rct_tanpa_ct', name: 'RCT – Tanpa clear temper (APKT)', unit: 'menit', values: [80.0], previous_year: [75.0] },
          { key: 'jumlah_tanpa_ct', name: 'Jumlah WO – Tanpa clear temper (APKT)', unit: 'kali', values: [14], previous_year: [15] },
          { key: 'porsi_clear_temper', name: 'Porsi WO clear temper', unit: '%', values: [65.0], previous_year: [62.5] },
        ],
        comparison: [
          {
            unit_id: '51453',
            unit_name: 'ULP Mojokerto Kota',
            latest: 35.0,
            yoy_pct: 10.0,
            ytd: 35.0,
            jumlah: 40,
            rct: 90.0,
            rpt_tanpa_ct: 27.1,
            rct_tanpa_ct: 80.0,
            jumlah_tanpa_ct: 14,
            porsi_clear_temper: 65.0,
          },
        ],
        warnings: [
          {
            code: 'apkt_current_month_partial',
            severity: 'warning',
            month: '2026-10',
            message: 'Data RPT/RCT 2026-10 adalah data bulan berjalan dari APKT dan masih bertambah. Angka bulan ini belum final.',
            days_elapsed: 25,
            units_reporting: 1,
          },
        ],
        companions: null,
        reconciliations: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(rptCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'rpt-rct-gangguan') {
        return Promise.resolve(rptDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    const user = userEvent.setup()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/rpt-rct-gangguan'])

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'rpt-rct-gangguan',
        expect.objectContaining({ unit_id: 'up3-1' }),
      )
    })

    // Verifikasi tombol Tarik APKT (RPT/RCT) tampil, dan tombol Sinkronisasi Gangguan tidak tampil
    expect(await screen.findByRole('button', { name: 'Tarik APKT (RPT/RCT)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sinkronisasi Gangguan' })).not.toBeInTheDocument()

    // Verifikasi peringatan bulan berjalan APKT belum final (Butir 26)
    expect(await screen.findByText(/Data RPT\/RCT 2026-10 adalah data bulan berjalan dari APKT dan masih bertambah/i)).toBeInTheDocument()

    // Verifikasi kartu KPI menampilkan varian Semua Laporan vs Tanpa Clear Temper
    expect(screen.getByText('RPT (Response Time)')).toBeInTheDocument()
    expect(screen.getByText('RCT (Recovery Time)')).toBeInTheDocument()
    expect(screen.getByText('Jumlah WO Gangguan')).toBeInTheDocument()
    expect(screen.getByText('Porsi Clear Temper')).toBeInTheDocument()
    expect(screen.getAllByText('Tanpa Clear Temper:').length).toBe(3)
    expect(screen.getByText('65,0%')).toBeInTheDocument()

    // Verifikasi grafik memiliki tab ukuran RPT / RCT / Jumlah WO
    expect(screen.getByRole('button', { name: /RPT \(Response Time\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /RCT \(Recovery Time\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jumlah WO Gangguan/i })).toBeInTheDocument()
    expect(screen.getByText('Semua Laporan (Utama)')).toBeInTheDocument()
    expect(screen.getByText('Laporan Tanpa Clear Temper (Pembanding)')).toBeInTheDocument()

    // Verifikasi tab Rekonsiliasi tidak ada karena companions null & reconciliations kosong
    expect(screen.queryByRole('button', { name: /^Rekonsiliasi$/i })).not.toBeInTheDocument()
  })

  it('14. mendukung menu RPT-RCT Keluhan bersumber APKT dengan satuan jam dan tombol tarik APKT (Butir 27)', async () => {
    const keluhanCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'rpt-rct-keluhan',
            name: 'RPT-RCT Keluhan',
            source: 'APKT – Jumlah dan Durasi RPT RCT Keluhan',
            polarity: 'down',
            available: true,
            series: [
              { key: 'rpt', name: 'RPT – Response time rata-rata (APKT)', unit: 'jam' },
              { key: 'rct', name: 'RCT – Recovery time rata-rata (APKT)', unit: 'jam' },
              { key: 'jumlah', name: 'Jumlah WO keluhan (APKT)', unit: 'kali' },
            ],
          },
        ],
      },
    }

    const keluhanDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'rpt-rct-keluhan',
          name: 'RPT-RCT Keluhan',
          unit: 'jam',
          polarity: 'down',
          source: 'APKT – Jumlah dan Durasi RPT RCT Keluhan',
        },
        from: '2026-10',
        to: '2026-10',
        months: ['2026-10'],
        available_from: '2026-01',
        available_to: '2026-10',
        summary: [
          { key: 'rpt', name: 'RPT – Response time rata-rata (APKT)', unit: 'jam', latest: 0.44, ytd: 0.44 },
          { key: 'rct', name: 'RCT – Recovery time rata-rata (APKT)', unit: 'jam', latest: 6.0, ytd: 6.0 },
          { key: 'jumlah', name: 'Jumlah WO keluhan (APKT)', unit: 'kali', latest: 355, ytd: 355 },
        ],
        series: [
          { key: 'rpt', name: 'RPT – Response time rata-rata (APKT)', unit: 'jam', values: [0.44], previous_year: [0.5] },
          { key: 'rct', name: 'RCT – Recovery time rata-rata (APKT)', unit: 'jam', values: [6.0], previous_year: [7.2] },
          { key: 'jumlah', name: 'Jumlah WO keluhan (APKT)', unit: 'kali', values: [355], previous_year: [400] },
        ],
        warnings: [
          {
            code: 'apkt_current_month_partial',
            severity: 'warning',
            month: '2026-10',
            message: 'Data RPT/RCT keluhan 2026-10 adalah data bulan berjalan dari APKT dan masih bertambah.',
            days_elapsed: 25,
            units_reporting: 1,
          },
        ],
        companions: null,
        reconciliations: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(keluhanCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'rpt-rct-keluhan') {
        return Promise.resolve(keluhanDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/rpt-rct-keluhan'])

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'rpt-rct-keluhan',
        expect.objectContaining({ unit_id: 'up3-1' }),
      )
    })

    // Verifikasi tombol Tarik APKT (RPT/RCT Keluhan) tampil
    expect(await screen.findByRole('button', { name: 'Tarik APKT (RPT/RCT Keluhan)' })).toBeInTheDocument()

    // Verifikasi kartu KPI dengan satuan jam
    expect(screen.getAllByText('0,44').length).toBeGreaterThan(0)
    expect(screen.getAllByText('jam').length).toBeGreaterThan(0)
    expect(screen.getByText(/Data RPT\/RCT keluhan 2026-10 adalah data bulan berjalan/i)).toBeInTheDocument()
  })

  it('15. mendukung menu Anomali Gangguan dan Anomali Keluhan bersumber APKT dengan tombol Tarik APKT (Butir 28 & 29)', async () => {
    const anomaliCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'anomali-gangguan',
            name: 'Anomali Gangguan',
            source: 'APKT – Anomali Penanganan Pengaduan Gangguan (Berulang dan Rating Negatif)',
            polarity: 'down',
            available: true,
            series: [
              { key: 'wo', name: 'Total Pengaduan (WO)', unit: 'kali' },
              { key: 'berulang', name: 'Gangguan Berulang', unit: 'kali' },
              { key: 'negatif', name: 'Rating Negatif', unit: 'kali' },
            ],
          },
        ],
      },
    }

    const anomaliDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'anomali-gangguan',
          name: 'Anomali Gangguan',
          unit: 'kali',
          polarity: 'down',
          source: 'APKT – Anomali Penanganan Pengaduan Gangguan (Berulang dan Rating Negatif)',
        },
        from: '2026-10',
        to: '2026-10',
        months: ['2026-10'],
        available_from: '2026-01',
        available_to: '2026-10',
        summary: [
          { key: 'wo', name: 'Total Pengaduan (WO)', unit: 'kali', latest: 500, ytd: 500 },
          { key: 'berulang', name: 'Gangguan Berulang', unit: 'kali', latest: 12, ytd: 12 },
          { key: 'negatif', name: 'Rating Negatif', unit: 'kali', latest: 5, ytd: 5 },
        ],
        series: [
          { key: 'wo', name: 'Total Pengaduan (WO)', unit: 'kali', values: [500], previous_year: [450] },
          { key: 'berulang', name: 'Gangguan Berulang', unit: 'kali', values: [12], previous_year: [15] },
          { key: 'negatif', name: 'Rating Negatif', unit: 'kali', values: [5], previous_year: [6] },
        ],
        warnings: [
          {
            code: 'apkt_current_month_partial',
            severity: 'warning',
            month: '2026-10',
            message: 'Data anomali gangguan 2026-10 adalah data bulan berjalan dari APKT dan masih bertambah.',
            days_elapsed: 25,
            units_reporting: 1,
          },
        ],
        companions: null,
        reconciliations: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(anomaliCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'anomali-gangguan') {
        return Promise.resolve(anomaliDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/anomali-gangguan'])

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'anomali-gangguan',
        expect.objectContaining({ unit_id: 'up3-1' }),
      )
    })

    // Verifikasi tombol Tarik APKT (Anomali Gangguan) tampil
    expect(await screen.findByRole('button', { name: 'Tarik APKT (Anomali Gangguan)' })).toBeInTheDocument()
    // Verifikasi peringatan bulan berjalan APKT
    expect(screen.getByText(/Data anomali gangguan 2026-10 adalah data bulan berjalan dari APKT dan masih bertambah/i)).toBeInTheDocument()
  })

  it('16. mendukung menu kWh P2TL dengan tombol Tarik AP2T (Butir 30)', async () => {
    const p2tlCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'kwh-p2tl',
            name: 'kWh P2TL',
            source: 'TAGSUS',
            polarity: 'up',
            available: true,
            series: [
              { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh' },
              { key: 'rupiah', name: 'Rupiah Tagihan Susulan', unit: 'Rp' },
            ],
          },
        ],
      },
    }

    const p2tlDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'kwh-p2tl',
          name: 'kWh P2TL',
          unit: 'kWh',
          polarity: 'up',
          source: 'TAGSUS',
        },
        from: '2026-10',
        to: '2026-10',
        months: ['2026-10'],
        available_from: '2026-01',
        available_to: '2026-10',
        summary: [
          { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh', latest: 12500, ytd: 12500 },
        ],
        series: [
          { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh', values: [12500], previous_year: [10000] },
        ],
        warnings: [],
        companions: null,
        reconciliations: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(p2tlCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-p2tl') {
        return Promise.resolve(p2tlDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/kwh-p2tl'])

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'kwh-p2tl',
        expect.objectContaining({ unit_id: 'up3-1' }),
      )
    })

    // Verifikasi tombol Tarik AP2T (kWh P2TL) tampil
    expect(await screen.findByRole('button', { name: 'Tarik AP2T (kWh P2TL)' })).toBeInTheDocument()
  })

  it('17. menampilkan companion belum realisasi potret AP2T pada kWh P2TL tanpa YoY (Butir 33)', async () => {
    const p2tlCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'kwh-p2tl',
            name: 'kWh P2TL',
            source: 'TAGSUS',
            polarity: 'up',
            available: true,
            series: [
              { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh' },
            ],
          },
        ],
      },
    }

    const p2tlDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'kwh-p2tl',
          name: 'kWh P2TL',
          unit: 'kWh',
          polarity: 'up',
          source: 'TAGSUS',
        },
        from: '2026-03',
        to: '2026-04',
        months: ['2026-03', '2026-04'],
        summary: [
          { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh', latest: 10, ytd: 180 },
        ],
        series: [
          { key: 'kwh', name: 'kWh Tagihan Susulan', unit: 'kWh', values: [170, 10], previous_year: [100, 10] },
        ],
        warnings: [],
        companions: {
          source: 'AP2T – Penetapan tagihan susulan yang belum realisasi (potret per tanggal tarik: bulan lama hanya memuat sisa yang belum terealisasi saat laporan ditarik)',
          series: [
            { key: 'kwh_belum', name: 'kWh belum realisasi', unit: 'kWh', latest: 0, ytd: 35, values: [35, 0] },
            { key: 'rp_belum', name: 'Rupiah belum realisasi', unit: 'Rp', latest: 0, ytd: 350, values: [350, 0] },
            { key: 'jumlah_belum', name: 'Jumlah penetapan belum realisasi', unit: 'penetapan', latest: null, ytd: 3, values: [3, null] },
          ],
        },
        reconciliations: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(p2tlCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-p2tl') {
        return Promise.resolve(p2tlDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/kwh-p2tl'])

    // Verifikasi tab Rekonsiliasi aktif/muncul karena companions ada
    const recTab = await screen.findByRole('button', { name: 'Rekonsiliasi' })
    expect(recTab).toBeInTheDocument()
    await userEvent.click(recTab)

    // Verifikasi pesan peringatan potret tampil
    expect(await screen.findByText(/Potret per tanggal tarik: bulan lama hanya memuat sisa yang belum terealisasi; bukan angka bulan penuh dan tidak dibandingkan dengan tahun lalu/i)).toBeInTheDocument()

    // Verifikasi badge sumber AP2T
    expect(screen.getAllByText('AP2T').length).toBeGreaterThan(0)

    // Verifikasi penanganan nilai null sebagai 'Belum ditarik'
    expect(screen.getByText('Belum ditarik')).toBeInTheDocument()
  })

  it('18. mendukung tombol Tarik Kontrol 309 dan rincian Komponen Penjualan di kWh Jual (Butir 34)', async () => {
    const kwhJualCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'kwh-jual',
            name: 'kWh Jual',
            source: '309',
            polarity: 'up',
            available: true,
            series: [{ key: 'kwh', name: 'kWh Jual', unit: 'kWh' }],
          },
        ],
      },
    }

    const kwhJualDetail = {
      data: {
        ...MOCK_METRIC_DETAIL.data,
        metric: {
          code: 'kwh-jual',
          name: 'kWh Jual',
          unit: 'kWh',
          polarity: 'up',
          source: '309',
        },
        from: '2026-10',
        to: '2026-10',
        months: ['2026-10'],
        breakdown_secondary: {
          dimension: 'Komponen penjualan',
          period: '2026-10',
          rows: [
            { key: 'TUL III-07 (11)', value: 1000, share_pct: 100, same_month_last_year: 900, yoy_pct: 11.1 },
            { key: 'Pembatalan Rekening (MEMO4)', value: -10, share_pct: -1, same_month_last_year: null, yoy_pct: null },
          ],
        },
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(kwhJualCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-jual') {
        return Promise.resolve(kwhJualDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/kwh-jual'])

    // Verifikasi tombol Tarik Kontrol 309 (EIS) tampil
    expect(await screen.findByRole('button', { name: 'Tarik Kontrol 309 (EIS)' })).toBeInTheDocument()

    // Buka tab Rincian
    const rincianTab = await screen.findByRole('button', { name: 'Rincian' })
    await userEvent.click(rincianTab)

    // Verifikasi rincian Komponen Penjualan dan nilai negatif
    expect(await screen.findByText('Rincian: Komponen penjualan')).toBeInTheDocument()
    expect(screen.getAllByText('TUL III-07 (11)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pembatalan Rekening (MEMO4)').length).toBeGreaterThan(0)
  })

  it('19. mendukung menu Pelunasan PRR dan Pelunasan Ex PRR dengan tombol Tarik AP2T dan peringatan bulan berjalan (Butir 35)', async () => {
    const prrCatalog = {
      data: {
        units: [{ id: 'u-1', name: 'ULP Mojokerto Kota', unit_type: 'ULP', parent_id: null }],
        metrics: [
          {
            code: 'pelunasan-prr',
            name: 'Pelunasan PRR',
            source: 'AP2T',
            polarity: 'up',
            series: [
              { key: 'rp', name: 'Pelunasan PRR', unit: 'Rp' },
              { key: 'pelanggan', name: 'Pelanggan yang melunasi', unit: 'plg' },
              { key: 'transaksi', name: 'Jumlah pembayaran', unit: 'kali' },
            ],
          },
        ],
      },
    }

    const prrDetail = {
      data: {
        unit: { id: 'u-1', name: 'ULP Mojokerto Kota', unit_type: 'ULP' },
        metric: {
          code: 'pelunasan-prr',
          name: 'Pelunasan PRR',
          unit: 'Rp',
          polarity: 'up',
          source: 'AP2T',
        },
        from: '2026-10',
        to: '2026-11',
        months: ['2026-10', '2026-11'],
        summary: [
          { key: 'rp', name: 'Pelunasan PRR', unit: 'Rp', latest: 5000000, ytd: 15000000 },
          { key: 'pelanggan', name: 'Pelanggan yang melunasi', unit: 'plg', latest: 10, ytd: 30 },
          { key: 'transaksi', name: 'Jumlah pembayaran', unit: 'kali', latest: 12, ytd: 35 },
        ],
        series: [
          { key: 'rp', name: 'Pelunasan PRR', unit: 'Rp', values: [10000000, 5000000], previous_year: [8000000, 4000000] },
        ],
        breakdown: {
          dimension: 'Komponen pelunasan',
          period: '2026-11',
          rows: [
            { key: 'Pemakaian listrik (RPPTL)', value: 4000000, share_pct: 80 },
            { key: 'Biaya keterlambatan (BK)', value: 1000000, share_pct: 20 },
          ],
        },
        breakdown_secondary: {
          dimension: 'Bulan tagihan (BLTH)',
          period: '2026-11',
          rows: [
            { key: '2026-08', value: 3000000, share_pct: 60 },
            { key: '2026-07', value: 2000000, share_pct: 40 },
          ],
        },
        warnings: [
          {
            code: 'ap2t_current_month_partial',
            severity: 'warning',
            month: '2026-11',
            message: 'Data PRR 2026-11 hanya memuat pembayaran sampai tanggal 25 (terakhir ditarik 2026-11-25). Angka bulan ini belum penuh dan tidak sebanding dengan bulan penuh; tarik ulang setelah bulan berakhir.',
          },
        ],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(prrCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'pelunasan-prr') {
        return Promise.resolve(prrDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true, 'eis_sync.manage': true, 'eis_reports.import': true }, ['/pengusahaan/pelunasan-prr'])

    // Verifikasi tombol Tarik AP2T (PRR dan Ex PRR) tampil
    expect(await screen.findByRole('button', { name: 'Tarik AP2T (PRR dan Ex PRR)' })).toBeInTheDocument()

    // Verifikasi pita peringatan bulan berjalan muncul
    expect(await screen.findByText(/Data PRR 2026-11 hanya memuat pembayaran sampai tanggal 25/i)).toBeInTheDocument()

    // Buka tab Rincian
    const rincianTab = await screen.findByRole('button', { name: 'Rincian' })
    await userEvent.click(rincianTab)

    // Verifikasi rincian Komponen Pelunasan dan Bulan tagihan (BLTH)
    expect(await screen.findByText('Rincian: Komponen pelunasan')).toBeInTheDocument()
    expect(screen.getAllByText('Pemakaian listrik (RPPTL)').length).toBeGreaterThan(0)
    expect(screen.getByText('Rincian: Bulan tagihan (BLTH)')).toBeInTheDocument()
    expect(screen.getAllByText('2026-08').length).toBeGreaterThan(0)
  })

  it('20. mendukung Butir 36: Standar halaman tahap 1 (target NKO, laju kebutuhan, diagnosis, dan sumbangan ULP)', async () => {
    const kwhCatalog = {
      data: {
        units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null }],
        metrics: [
          {
            code: 'kwh-jual',
            name: 'kWh Jual',
            source: '309',
            polarity: 'up',
            available: true,
            series: [{ key: 'kwh', name: 'kWh Jual', unit: 'kWh' }],
          },
        ],
      },
    }

    const nkoDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'kwh-jual',
          name: 'Penjualan Tenaga Listrik',
          unit: 'kWh',
          polarity: 'up',
          source: 'Laporan 309',
        },
        from: '2025-12',
        to: '2026-01',
        months: ['2025-12', '2026-01'],
        summary: [
          { key: 'kwh', name: 'kWh Jual', unit: 'kWh', latest: 200, ytd: 200, ytd_previous_year: 150, ytd_pct: 33.3, mom_pct: 5.0, yoy_pct: 33.3 },
        ],
        series: [
          { key: 'kwh', name: 'kWh Jual', unit: 'kWh', values: [190, 200], previous_year: [140, 150] },
        ],
        targets: [
          {
            definition_code: 'penjualan-tenaga-listrik',
            name: 'Penjualan Tenaga Listrik',
            unit_label: 'kWh',
            polarity: 'up',
            series_key: 'kwh',
            combined: false,
            month: '2026-01',
            target: 250,
            realisasi: 200,
            realisasi_source: 'METRIK',
            validated: null,
            pencapaian_pct: 80.0,
            status: 'tertinggal',
            target_year_end: 3000,
            remaining_per_month: 254.5,
            current_per_month: 200.0,
          },
        ],
        diagnosis: [
          {
            level: 'kritis',
            kind: 'target',
            text: 'Realisasi kumulatif 200 kWh (80,00% capaian target NKO). Kebutuhan bulanan sisa tahun rata-rata 254,5 kWh.',
          },
          {
            level: 'info',
            kind: 'contribution',
            text: 'Penyumbang terbesar ULP Mojokerto Kota (+40 kWh, 80% dari perubahan).',
          },
        ],
        contribution: {
          series_key: 'kwh',
          unit: 'kWh',
          to: '2026-01',
          bases: {
            yoy: {
              label: 'dibanding bulan yang sama tahun lalu',
              from: '2025-01',
              total: 50,
              units_compared: 2,
              units: [
                { unit_id: 'u-1', unit_name: 'ULP Mojokerto Kota', value: 120, previous: 80, change: 40, share_pct: 80.0 },
                { unit_id: 'u-2', unit_name: 'ULP Pacet', value: 80, previous: 70, change: 10, share_pct: 20.0 },
              ],
            },
            mom: {
              label: 'dibanding bulan sebelumnya',
              from: '2025-12',
              total: 10,
              units_compared: 2,
              units: [
                { unit_id: 'u-1', unit_name: 'ULP Mojokerto Kota', value: 120, previous: 115, change: 5, share_pct: 50.0 },
                { unit_id: 'u-2', unit_name: 'ULP Pacet', value: 80, previous: 75, change: 5, share_pct: 50.0 },
              ],
            },
            ytd: {
              label: 'kumulatif tahun berjalan dibanding kumulatif tahun lalu',
              from: '2025-01',
              total: 50,
              units_compared: 2,
              units: [
                { unit_id: 'u-1', unit_name: 'ULP Mojokerto Kota', value: 120, previous: 80, change: 40, share_pct: 80.0 },
                { unit_id: 'u-2', unit_name: 'ULP Pacet', value: 80, previous: 70, change: 10, share_pct: 20.0 },
              ],
            },
          },
        },
        comparison: [
          { unit_id: 'u-1', unit_name: 'ULP Mojokerto Kota', latest: 120, yoy_pct: 50, ytd: 120 },
          { unit_id: 'u-2', unit_name: 'ULP Pacet', latest: 80, yoy_pct: 14.3, ytd: 80 },
        ],
        warnings: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(kwhCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-jual') {
        return Promise.resolve(nkoDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    // Tunggu data metrik termuat
    expect(await screen.findByText(/Tren Bulanan:/i)).toBeInTheDocument()

    // Verifikasi Kartu 2 Target NKO
    expect(screen.getByText(/Target NKO:/i)).toBeInTheDocument()
    expect(screen.getByText('tertinggal')).toBeInTheDocument()
    expect(screen.getByText('80,0% capaian')).toBeInTheDocument()
    expect(screen.getByText('METRIK')).toBeInTheDocument()

    // Verifikasi Kartu 4 Laju Kebutuhan
    expect(screen.getByText('Kebutuhan Sisa Bulan')).toBeInTheDocument()
    expect(screen.getByText(/Laju saat ini: 200/i)).toBeInTheDocument()

    // Verifikasi Diagnosis Otomatis
    expect(screen.getByText('Diagnosis & Akar Penyebab Otomatis')).toBeInTheDocument()
    expect(screen.getByText(/Realisasi kumulatif 200 kWh/i)).toBeInTheDocument()
    expect(screen.getByText(/Penyumbang terbesar ULP Mojokerto Kota/i)).toBeInTheDocument()

    // Buka tab Rincian untuk memeriksa tabel Perbandingan Antar ULP
    const rincianTab = await screen.findByRole('button', { name: 'Rincian' })
    await userEvent.click(rincianTab)

    // Verifikasi tabel Perbandingan ULP memuat kolom sumbangan dan perubahannya
    expect(await screen.findByText(/Perubahan \(YOY\)/i)).toBeInTheDocument()
    expect(screen.getAllByText('Sumbangan').length).toBeGreaterThan(0)
    expect(screen.getByText('+40,00')).toBeInTheDocument()
    expect(screen.getByText('80,0%')).toBeInTheDocument()

    // Switch ke MoM
    const momBtn = screen.getByRole('button', { name: 'mom' })
    await userEvent.click(momBtn)
    expect(await screen.findByText(/Perubahan \(MOM\)/i)).toBeInTheDocument()
    expect(screen.getAllByText('50,0%').length).toBeGreaterThan(0)
  })

  it('21. mendukung Butir 38: Uji coba keandalan tahap 2 (Pareto penyulang, gangguan berulang, komposisi, daftar pantau risiko)', async () => {
    const reliabilityCatalog = {
      data: {
        units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3', parent_id: null }],
        metrics: [
          {
            code: 'saidi-saifi',
            name: 'SAIDI & SAIFI',
            source: 'DIFI',
            polarity: 'down',
            available: true,
            series: [{ key: 'saidi', name: 'SAIDI', unit: 'menit/plg' }],
          },
        ],
      },
    }

    const reliabilityDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: {
          code: 'saidi-saifi',
          name: 'SAIDI & SAIFI',
          unit: 'menit/plg',
          polarity: 'down',
          source: 'DIFI',
        },
        from: '2026-01',
        to: '2026-10',
        months: ['2026-01', '2026-10'],
        summary: [
          { key: 'saidi', name: 'SAIDI', unit: 'menit/plg', latest: 4.5, ytd: 40.6, ytd_previous_year: 42.0, ytd_pct: -3.3, mom_pct: 1.0, yoy_pct: -2.0 },
        ],
        series: [
          { key: 'saidi', name: 'SAIDI', unit: 'menit/plg', values: [3.8, 4.5], previous_year: [4.0, 4.6] },
        ],
        detail: {
          kind: 'reliability',
          period: { from: '2026-01-01', to: '2026-10-31', partial: false },
          pareto: {
            basis: 'saidi_contribution',
            feeders_with_events: 45,
            total_saidi_contribution: 35.5,
            total_saifi_contribution: 0.85,
            total_ens_kwh: 125000,
            top_share_pct: 34.2,
            rows: [
              {
                feeder_id: 'f-101',
                code: 'FDR-SEDATI',
                name: 'Sedati',
                gi_name: 'GI Buduran',
                events: 12,
                permanent: 8,
                temporary: 4,
                minutes: 320,
                ens_kwh: 15400,
                customers: 4500,
                saidi_contribution: 4.25,
                saifi_contribution: 0.12,
                saidi_share_pct: 12.0,
                saidi_cumulative_pct: 12.0,
                trend_pct: 5.5,
              },
            ],
          },
          repeat: {
            threshold_events: 3,
            window_days: 30,
            window_from: '2026-10-01',
            window_to: '2026-10-31',
            rows: [
              {
                feeder_id: 'f-101',
                code: 'FDR-SEDATI',
                name: 'Sedati',
                gi_name: 'GI Buduran',
                events: 4,
                permanent: 3,
                minutes: 180,
                last_at: '2026-10-28 14:30',
              },
            ],
          },
          composition: {
            cause: {
              total_events: 50,
              rows: [
                {
                  key: 'Pohon / Tumbuhan',
                  events: 25,
                  events_share_pct: 50.0,
                  minutes: 400,
                  minutes_share_pct: 45.0,
                  ens_kwh: 20000,
                  ens_share_pct: 40.0,
                },
              ],
            },
            weather: {
              total_events: 50,
              rows: [
                {
                  key: 'Hujan Lebat',
                  events: 30,
                  events_share_pct: 60.0,
                  minutes: 500,
                  minutes_share_pct: 55.0,
                  ens_kwh: 30000,
                  ens_share_pct: 60.0,
                },
              ],
            },
          },
          risk: {
            available: true,
            as_of_month: '2026-10',
            target_month: '2026-11',
            season_index: 1.15,
            feeders_scored: 140,
            method: 'ewma_seasonal',
            rows: [
              {
                feeder_id: 'f-101',
                code: 'FDR-SEDATI',
                name: 'Sedati',
                gi_name: 'GI Buduran',
                owner: 'ULP Sidoarjo',
                expected_events: 2.4,
                expected_permanent: 1.6,
                last_12m_events: 18,
                last_3m_events: 6,
                last_month_events: 3,
              },
            ],
            backtest: {
              top: 10,
              months: ['2026-09', '2026-10'],
              model_capture_pct: 18.5,
              naive_capture_pct: 18.0,
              random_capture_pct: 6.2,
              description: 'Rata-rata persentase gangguan bulan berikutnya yang jatuh pada sepuluh penyulang teratas.',
            },
          },
          weather: {
            available: true,
            source: 'ERA5',
            attribution: 'Sumber data cuaca: ECMWF ERA5 via Open-Meteo',
            heavy_rain_mm: 20,
            rows: [
              {
                month: '2026-10',
                rain_mm: 120.5,
                heavy_days: 4,
                days_covered: 31,
                events: 15,
              },
            ],
          },
          early_warning: {
            available: true,
            attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
            issued_at: '2026-10-31 06:00',
            ulps: [
              {
                unit_id: 'u-1',
                unit_name: 'ULP Mojokerto Kota',
                max_level: 'waspada',
                days: [
                  { date: '2026-11-01', rain_mm: 25.0, thunderstorm: true, level: 'waspada', rate_ratio: 2.1, slots: 8 },
                ],
              },
            ],
            watchlist: [
              {
                unit_id: 'u-1',
                unit_name: 'ULP Mojokerto Kota',
                name: 'Sedati',
                events_3y: 30,
                events_on_heavy_rain_days_3y: 12,
                heavy_rain_share_pct: 40.0,
              },
            ],
          },
          notes: ['Kontribusi SAIDI dan SAIFI per penyulang adalah batas atas.'],
        },
        warnings: [],
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(reliabilityCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'saidi-saifi') {
        return Promise.resolve(reliabilityDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/saidi-saifi'])

    // Verifikasi tombol tab Penyulang & Risiko muncul
    const feederTabBtn = await screen.findByRole('button', { name: 'Penyulang & Risiko' })
    expect(feederTabBtn).toBeInTheDocument()
    await userEvent.click(feederTabBtn)

    // Verifikasi Bagian Pareto Penyulang
    expect(await screen.findByText('Pareto Penyulang Penyumbang SAIDI Terbesar')).toBeInTheDocument()
    expect(screen.getAllByText('Sedati').length).toBeGreaterThan(0)
    expect(screen.getByText('4,250')).toBeInTheDocument() // saidi_contribution
    expect(screen.getAllByText(/GI Buduran/i).length).toBeGreaterThan(0)

    // Verifikasi Bagian Gangguan Berulang (38b)
    expect(screen.getByText('Penyulang Gangguan Berulang')).toBeInTheDocument()
    expect(screen.getByText('4 kali')).toBeInTheDocument()

    // Verifikasi Daftar Pantau Risiko & Uji Mundur (38d)
    expect(screen.getByText('Daftar Pantau Risiko Bulan Depan')).toBeInTheDocument()
    expect(screen.getByText('~2,4 kejadian')).toBeInTheDocument()
    expect(screen.getByText('Evaluasi Akurasi Uji Mundur (24 Bulan):')).toBeInTheDocument()
    expect(screen.getAllByText('18,5%').length).toBeGreaterThan(0) // model_capture_pct

    // Verifikasi Komposisi Penyebab & Cuaca (38c)
    expect(screen.getByText('Komposisi Gangguan: Kejadian vs Menit Padam')).toBeInTheDocument()
    expect(screen.getByText('Pohon / Tumbuhan')).toBeInTheDocument()

    // Verifikasi Weather & Early Warning (41 & 48)
    expect(screen.getByText('Peringatan Dini Cuaca 3 Hari ke Depan')).toBeInTheDocument()
    expect(screen.getByText('Konteks Cuaca Historis 12 Bulan Terakhir')).toBeInTheDocument()
  })

  it('22. mendukung Butir 39: Uji coba piutang tahap 3 (Umur tunggakan, calon PRR, roll-rate, forecast pelanggan, repayment BLTH)', async () => {
    const receivableCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'piutang-pascabayar-umur',
            name: 'Umur Piutang Pascabayar',
            category: 'Piutang',
            unit: 'Rp',
            polarity: 'down',
            order: 4,
          },
          {
            code: 'pelunasan-prr',
            name: 'Pelunasan PRR',
            category: 'Piutang',
            unit: 'Rp',
            polarity: 'up',
            order: 5,
          },
        ],
      },
    }

    const agingDetail = {
      data: {
        code: 'piutang-pascabayar-umur',
        name: 'Umur Piutang Pascabayar',
        unit: 'Rp',
        polarity: 'down',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'receivable_aging',
          available: true,
          as_of_month: '2026-10',
          target_month: '2026-11',
          buckets: ['1 bulan', '2 bulan', '3 bulan', '4-6 bulan', '7-12 bulan', '> 12 bulan'],
          rp_total: 12500000000,
          plg_total: 15400,
          rp_over_3_months: 3750000000,
          over_3_pct: 30.0,
          snapshot: [
            { key: '1 bulan', rp: 6000000000, plg: 10000, share_pct: 48.0, same_month_last_year: 5800000000, yoy_pct: 3.4 },
            { key: '2 bulan', rp: 1750000000, plg: 2500, share_pct: 14.0, same_month_last_year: 1700000000, yoy_pct: 2.9 },
            { key: '3 bulan', rp: 1000000000, plg: 1100, share_pct: 8.0, same_month_last_year: 950000000, yoy_pct: 5.3 },
            { key: '4-6 bulan', rp: 1250000000, plg: 800, share_pct: 10.0, same_month_last_year: 1200000000, yoy_pct: 4.2 },
            { key: '7-12 bulan', rp: 1500000000, plg: 600, share_pct: 12.0, same_month_last_year: 1400000000, yoy_pct: 7.1 },
            { key: '> 12 bulan', rp: 1000000000, plg: 400, share_pct: 8.0, same_month_last_year: 900000000, yoy_pct: 11.1 },
          ],
          history: [
            { month: '2026-09', rp_total: 12000000000, rp_over_3_months: 3500000000, over_3_pct: 29.17, rates: [10200, 0.25, 0.44, 0.72, 0.75, 0.66] },
            { month: '2026-10', rp_total: 12500000000, rp_over_3_months: 3750000000, over_3_pct: 30.0, rates: [10000, 0.24, 0.42, 0.70, 0.73, 0.65] },
          ],
          rates: {
            basis: 'plg',
            transitions_averaged: 6,
            rows: [
              { key: '1 bulan', from: null, rate: 10100, rate_last: 10000, kind: 'level' },
              { key: '2 bulan', from: '1 bulan', rate: 0.245, rate_last: 0.24, kind: 'roll' },
              { key: '3 bulan', from: '2 bulan', rate: 0.43, rate_last: 0.42, kind: 'roll' },
              { key: '4-6 bulan', from: '3 bulan', rate: 0.71, rate_last: 0.70, kind: 'roll' },
              { key: '7-12 bulan', from: '4-6 bulan', rate: 0.74, rate_last: 0.73, kind: 'roll' },
              { key: '> 12 bulan', from: '7-12 bulan', rate: 0.65, rate_last: 0.65, kind: 'roll' },
            ],
          },
          forecast: {
            available: true,
            basis: 'plg',
            unit: 'pelanggan',
            month: '2026-11',
            by_bucket: [
              { key: '1 bulan', value: 10100 },
              { key: '2 bulan', value: 2450 },
              { key: '3 bulan', value: 1080 },
              { key: '4-6 bulan', value: 780 },
              { key: '7-12 bulan', value: 590 },
              { key: '> 12 bulan', value: 390 },
            ],
            total: 15390,
            over_3_months: 1760,
            over_3_change_pct: -2.2,
            reliable: true,
            reliability_note: 'Uji mundur lebih baik dari cara naif.',
            backtest: {
              months: 12,
              total_mape_pct: 22.4,
              total_naive_mape_pct: 35.1,
              over_3_mape_pct: 28.5,
              over_3_naive_mape_pct: 46.2,
            },
          },
          units: [
            { unit_id: 'ulp-1', unit_name: 'ULP Mojokerto Kota', rp_total: 7500000000, rp_over_3_months: 2400000000, over_3_pct: 32.0, over_3_yoy_pct: 8.5 },
            { unit_id: 'ulp-2', unit_name: 'ULP Mojoagung', rp_total: 5000000000, rp_over_3_months: 1350000000, over_3_pct: 27.0, over_3_yoy_pct: -1.2 },
          ],
          notes: ['Roll-rate diperkirakan dari agregat', 'Roll-rate dan prakiraan memakai jumlah pelanggan'],
        },
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(receivableCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'piutang-pascabayar-umur') {
        return Promise.resolve(agingDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/piutang-pascabayar-umur'])

    // Verifikasi tombol tab Umur & Calon PRR muncul
    const agingTabBtn = await screen.findByRole('button', { name: 'Umur & Calon PRR' })
    expect(agingTabBtn).toBeInTheDocument()
    await userEvent.click(agingTabBtn)

    // Verifikasi (a) Kartu Tunggakan > 3 Bulan (Calon PRR)
    expect(await screen.findByText('Tunggakan Lebih Dari 3 Bulan (Calon PRR)')).toBeInTheDocument()
    expect(screen.getByText('30,00% dari total')).toBeInTheDocument()
    expect(screen.getAllByText('Rp 3,75 M').length).toBeGreaterThan(0)

    // Verifikasi (b) Komposisi Umur Tunggakan & Riwayat
    expect(screen.getByText(/Komposisi Umur Tunggakan/i)).toBeInTheDocument()
    expect(screen.getByText(/Riwayat 12 Bulan: Pergerakan Porsi Tunggakan > 3 Bulan/i)).toBeInTheDocument()

    // Verifikasi (c) Tabel Roll-Rate
    expect(screen.getByText('Laju Perpindahan Umur Tunggakan (Roll-Rate Pelanggan)')).toBeInTheDocument()
    expect(screen.getAllByText('Persistensi / Laju Tua').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Laju Naik Kelas').length).toBeGreaterThan(0)

    // Verifikasi (d) Prakiraan Bulan Depan (Pelanggan) & Backtest Wajib Tampil
    expect(screen.getByText('Prakiraan Bulan Depan (Pelanggan)')).toBeInTheDocument()
    expect(screen.getByText('15.390')).toBeInTheDocument()
    expect(screen.getByText(/Calon PRR -2,2%/i)).toBeInTheDocument()
    expect(screen.getByText('Evaluasi Uji Mundur (12 bulan)')).toBeInTheDocument()
    expect(screen.getByText(/Model: 28,5%/i)).toBeInTheDocument()
    expect(screen.getByText(/Naif: 46,2%/i)).toBeInTheDocument()

    // Verifikasi (e) Peringkat ULP
    expect(screen.getByText('Peringkat ULP Berdasarkan Porsi Tunggakan > 3 Bulan')).toBeInTheDocument()
    expect(screen.getByText('ULP Mojokerto Kota')).toBeInTheDocument()
    expect(screen.getByText('32,00%')).toBeInTheDocument()
  })

  it('23. mendukung Butir 40: Uji coba kWh Jual dan Pendapatan tahap 4 (Pemecahan waterfall, tabel golongan, findings, dan penanda events)', async () => {
    const salesCatalog = {
      data: {
        ...MOCK_METRICS_CATALOG.data,
        metrics: [
          ...MOCK_METRICS_CATALOG.data.metrics,
          {
            code: 'kwh-jual',
            name: 'Penjualan Tenaga Listrik',
            category: 'Penjualan',
            unit: 'kWh',
            polarity: 'up',
            order: 2,
          },
        ],
      },
    }

    const salesDetail = {
      data: {
        code: 'kwh-jual',
        name: 'Penjualan Tenaga Listrik',
        unit: 'kWh',
        polarity: 'up',
        months: ['2026-03', '2026-04'],
        from: '2026-03',
        to: '2026-04',
        events: [
          { month: '2026-03', kind: 'idul_fitri', label: 'Idul Fitri' },
        ],
        series: [
          {
            key: 'kwh',
            name: 'kWh Jual',
            unit: 'kWh',
            values: [450000000, 480000000],
            previous_year: [430000000, 455000000],
          },
        ],
        detail: {
          kind: 'sales_decomposition',
          available: true,
          focus: 'kwh-jual',
          month: {
            month: '2026-04',
            previous: '2025-04',
            units_compared: 10,
            customers: { total: 1450000, previous: 1400000, change: 50000 },
            kwh: {
              total: 480000000,
              previous: 455000000,
              change: 25000000,
              change_pct: 5.49,
              customers: 15000000,
              mix: -2000000,
              intensity: 12000000,
              residual: 0,
            },
            rp: {
              total: 620000000000,
              previous: 580000000000,
              change: 40000000000,
              change_pct: 6.9,
              volume: 32000000000,
              mix: -1500000000,
              price: 9500000000,
              residual: 0,
            },
            groups: [
              {
                key: 'I',
                name: 'Industri',
                plg: 2500,
                plg_previous: 2400,
                kwh: 220000000,
                kwh_previous: 205000000,
                kwh_change: 15000000,
                kwh_share_of_change_pct: 60.0,
                kwh_per_plg: 88000,
                kwh_per_plg_previous: 85416.7,
                rp: 260000000000,
                rp_previous: 240000000000,
                rp_per_kwh: 1181.8,
                rp_per_kwh_previous: 1170.7,
                rp_change: 20000000000,
              },
              {
                key: 'R',
                name: 'Rumah tangga',
                plg: 1250000,
                plg_previous: 1200000,
                kwh: 180000000,
                kwh_previous: 172000000,
                kwh_change: 8000000,
                kwh_share_of_change_pct: 32.0,
                kwh_per_plg: 144,
                kwh_per_plg_previous: 143.3,
                rp: 240000000000,
                rp_previous: 225000000000,
                rp_per_kwh: 1333.3,
                rp_per_kwh_previous: 1308.1,
                rp_change: 15000000000,
              },
            ],
          },
          ytd: {
            from: '2026-01',
            to: '2026-04',
            months_compared: 4,
            months: ['2026-01', '2026-02', '2026-03', '2026-04'],
            kwh: {
              total: 1850000000,
              previous: 1760000000,
              change: 90000000,
              change_pct: 5.11,
              customers: 55000000,
              mix: -8000000,
              intensity: 43000000,
              residual: 0,
            },
            rp: {
              total: 2400000000000,
              previous: 2250000000000,
              change: 150000000000,
              change_pct: 6.67,
              volume: 115000000000,
              mix: -6000000000,
              price: 41000000000,
              residual: 0,
            },
          },
          monthly: [
            {
              month: '2026-03',
              units_compared: 10,
              kwh: { total: 450000000, previous: 430000000, change: 20000000, customers: 14000000, mix: -2000000, intensity: 8000000 },
              rp: { total: 580000000000, previous: 550000000000, change: 30000000000, volume: 25000000000, mix: -1000000000, price: 6000000000 },
            },
            {
              month: '2026-04',
              units_compared: 10,
              kwh: { total: 480000000, previous: 455000000, change: 25000000, customers: 15000000, mix: -2000000, intensity: 12000000 },
              rp: { total: 620000000000, previous: 580000000000, change: 40000000000, volume: 32000000000, mix: -1500000000, price: 9500000000 },
            },
          ],
          findings: [
            {
              level: 'perhatian',
              kind: 'base_effect',
              text: 'Efek tarif tahun berjalan 41,0 miliar, 25,0 miliar berasal dari Januari sampai Februari yang tahun lalu memiliki Rp per kWh rendah.',
            },
          ],
          notes: [
            'Pemecahan memakai laporan 309 per golongan tarif (S, R, B, I, P, T, C, L)',
            'kWh: efek pelanggan, efek campuran, efek konsumsi',
          ],
        },
      },
    }

    pengusahaanApi.metrics.mockResolvedValue(salesCatalog)
    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-jual') {
        return Promise.resolve(salesDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    // Verifikasi penanda grafik tren Idul Fitri (events[]) tampil di SVG
    expect(await screen.findByText('Idul Fitri')).toBeInTheDocument()

    // Verifikasi tombol tab Pemecahan muncul
    const decompositionTabBtn = await screen.findByRole('button', { name: 'Pemecahan' })
    expect(decompositionTabBtn).toBeInTheDocument()
    await userEvent.click(decompositionTabBtn)

    // Verifikasi (c) Catatan otomatis findings[] tampil di atas diagram
    expect(await screen.findByText(/Efek Dasar Rendah/i)).toBeInTheDocument()
    expect(screen.getByText(/Efek tarif tahun berjalan 41,0 miliar/i)).toBeInTheDocument()

    // Verifikasi (a) Waterfall diagram dan kartu komponen efek
    expect(screen.getByText('Dekomposisi Perubahan: Dari Tahun Lalu ke Tahun Ini')).toBeInTheDocument()
    expect(screen.getAllByText('Efek Pelanggan').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Efek Campuran Golongan').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Efek kWh per Pelanggan').length).toBeGreaterThan(0)

    // Verifikasi tombol toggle Bulan ini vs Tahun berjalan
    const ytdBtn = screen.getByRole('button', { name: /Tahun berjalan \(YTD\)/i })
    expect(ytdBtn).toBeInTheDocument()
    await userEvent.click(ytdBtn)
    expect(screen.getByText(/Kumulatif Thn Ini/i)).toBeInTheDocument()

    // Verifikasi (b) Tabel rincian menurut golongan tarif
    expect(screen.getByText('Rincian Menurut Golongan Tarif (Bulan Apr 26)')).toBeInTheDocument()
    expect(screen.getByText('Industri')).toBeInTheDocument()
    expect(screen.getAllByText('Rumah tangga').length).toBeGreaterThan(0)
    expect(screen.getByText('+60,0%')).toBeInTheDocument()
  })

  it('24. mendukung Butir 46, 49, 53: Analisis Susut (Estimasi kWh beli, proksi teknis gardu, dan sisa susut P2TL)', async () => {
    const susutDetail = {
      data: {
        code: 'susut',
        name: 'Susut Distribusi',
        unit: '%',
        polarity: 'down',
        months: ['2026-08', '2026-09'],
        from: '2026-08',
        to: '2026-09',
        detail: {
          kind: 'loss_estimate',
          month: '2026-09',
          partial: false,
          history: [
            { month: '2026-08', beli_net_kwh: 520000000, jual_kwh: 490000000, susut_kwh: 30000000, susut_pct: 5.77, basis: 'turunan', units: 10 },
            { month: '2026-09', beli_net_kwh: 535000000, jual_kwh: 504000000, susut_kwh: 31000000, susut_pct: 5.79, basis: 'turunan', units: 10 },
          ],
          ulps: [
            {
              unit_id: 'ulp-1',
              unit_name: 'ULP Warujayeng',
              month_susut_pct: 7.2,
              month_basis: 'turunan',
              ytd_susut_pct: 7.45,
              ytd_basis: 'turunan',
              target_pct: 5.64,
              gap_pct_points: 1.81,
            },
            {
              unit_id: 'ulp-2',
              unit_name: 'ULP Mojokerto Kota',
              month_susut_pct: 4.8,
              month_basis: 'turunan',
              ytd_susut_pct: 4.95,
              ytd_basis: 'turunan',
              target_pct: 5.5,
              gap_pct_points: -0.55,
            },
          ],
          anomalies: [
            { unit_id: 'ulp-3', unit_name: 'ULP Ploso', month: '2026-05', beli_net_kwh: 31800000, median_kwh: 46900000, deviation_pct: -32.2 },
          ],
          backtest: {
            observations: 80,
            cumulative_mape_pct: 0.62,
            monthly_mape_pct: 0.61,
            naive_mape_pct: 5.33,
          },
          technical: {
            available: true,
            readings: 5700,
            substations: 5200,
            ulps: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                substations: 520,
                capacity_mva: 105.5,
                avg_loading_pct: 68.4,
                overload_pct_of_substations: 12.5,
                unbalanced_pct_of_measured: 18.0,
                loss_index: 0.502,
              },
            ],
            correlation: {
              available: true,
              loss_index: 0.86,
              avg_loading: 0.83,
              note: 'Korelasi peringkat antar ULP, bukan sebab-akibat.',
            },
            watchlist: [
              {
                id: 'sub-1',
                code: 'WR001',
                name: 'Gardu Pasar Waru',
                feeder_code: 'WR01',
                unit_name: 'ULP Warujayeng',
                cap: 160,
                loading: 112.5,
                loading_raw: 112.5,
                unbalance: 28.5,
                index: 1.54,
                flags: ['beban_lebih', 'tidak_seimbang'],
              },
            ],
          },
          nontechnical: {
            available: true,
            ulps_count: 10,
            ulps: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                ytd_susut_pct: 7.45,
                avg_loading_pct: 68.4,
                expected_from_load_pct: 6.25,
                residual_pct_points: 1.20,
                residual_flag: 'di_atas_harapan',
                p2tl_pct_of_sales: 0.85,
                p2tl_cases_per_1000_customers: 4.2,
                p2tl_kwh_per_case: 2450,
              },
            ],
            correlation: {
              susut_vs_p2tl_pct: 0.72,
              note: 'Korelasi peringkat antar ULP, bukan sebab-akibat.',
            },
          },
          notes: ['kWh beli diestimasi dari susut kumulatif NKO'],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'susut') {
        return Promise.resolve(susutDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/susut'])

    // Verifikasi tombol tab Estimasi & Susut Teknis muncul
    const susutTabBtn = await screen.findByRole('button', { name: 'Estimasi & Susut Teknis' })
    expect(susutTabBtn).toBeInTheDocument()
    await userEvent.click(susutTabBtn)

    // Verifikasi (Butir 46): Estimasi kWh Beli
    expect(await screen.findByText('Riwayat 12 Bulan: Estimasi kWh Beli & Susut Distribusi')).toBeInTheDocument()
    expect(screen.getByText('Peringatan Anomali Data Estimasi kWh Beli:')).toBeInTheDocument()
    expect(screen.getByText(/ULP Ploso/i)).toBeInTheDocument()
    expect(screen.getByText('Perbandingan Realisasi Susut Kumulatif Antar ULP vs Target')).toBeInTheDocument()
    expect(screen.getAllByText('ULP Warujayeng').length).toBeGreaterThan(0)
    expect(screen.getByText('+1,81 poin')).toBeInTheDocument()

    // Beralih ke sub-tab Susut Teknis & Sisa Susut (Butir 49 & 53)
    const techBtn = screen.getByRole('button', { name: /Susut Teknis & Sisa Susut/i })
    expect(techBtn).toBeInTheDocument()
    await userEvent.click(techBtn)

    // Verifikasi (Butir 49): Susut Teknis
    expect(await screen.findByText('Proksi Susut Teknis Antar ULP (Pengukuran Gardu)')).toBeInTheDocument()
    expect(screen.getByText('15 Gardu Prioritas (Kontribusi Rugi Tembaga Relatif Terbesar)')).toBeInTheDocument()
    expect(screen.getByText('WR001')).toBeInTheDocument()

    // Verifikasi (Butir 53): Sisa Susut & Sandingan P2TL
    expect(screen.getByText(/Sisa Susut \(Nonteknis & Faktor Lain\) & Sandingan P2TL/i)).toBeInTheDocument()
    expect(screen.getByText('Di atas harapan')).toBeInTheDocument()
    expect(screen.getByText(/Korelasi Spearman Susut vs P2TL = 0,72/i)).toBeInTheDocument()
  })

  it('25. mendukung Butir 42 (RPT-RCT Gangguan & Keluhan) dan Butir 43 (Anomali Gangguan & Keluhan)', async () => {
    const responseDetail = {
      data: {
        code: 'rpt-rct-gangguan',
        name: 'RPT & RCT Gangguan',
        unit: 'menit',
        polarity: 'down',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'response',
          focus: 'rpt-rct-gangguan',
          unit: 'menit',
          month: '2026-10',
          partial: true,
          basis: 'tanpa_clear_temper',
          ulps: [
            {
              unit_id: 'ulp-1',
              unit_name: 'ULP Warujayeng',
              wo: 1200,
              wo_nct: 1000,
              clear_temper_share_pct: 16.7,
              rpt: 24.5,
              rct: 48.0,
              rpt_nct: 21.0,
              rct_nct: 42.0,
              rpt_rank: 1,
              rct_rank: 1,
              peer_count: 3,
              rpt_gap_to_peer_best: 0,
              rct_gap_to_peer_best: 0,
            },
            {
              unit_id: 'ulp-2',
              unit_name: 'ULP Jombang',
              wo: 1500,
              wo_nct: 1300,
              clear_temper_share_pct: 13.3,
              rpt: 29.5,
              rct: 55.0,
              rpt_nct: 26.5,
              rct_nct: 51.0,
              rpt_rank: 2,
              rct_rank: 2,
              peer_count: 3,
              rpt_gap_to_peer_best: 5.5,
              rct_gap_to_peer_best: 9.0,
            },
          ],
          history: [
            { month: '2026-09', wo: 2600, rpt: 27.0, rct: 50.0, rpt_nct: 23.5, rct_nct: 46.0, clear_temper_share_pct: 15.0 },
            { month: '2026-10', wo: 2700, rpt: 26.8, rct: 49.5, rpt_nct: 23.2, rct_nct: 45.5, clear_temper_share_pct: 15.2 },
          ],
          volume_effect: {
            available: true,
            basis: 'semua',
            ulps: 10,
            observations: 220,
            rpt_correlation: 0.061,
            rct_correlation: -0.012,
            reading: 'Tidak ada hubungan berarti antara volume WO dan waktu tanggap; keterlambatan lebih mungkin berasal dari faktor lain (jarak, kru, jenis gangguan).',
          },
          notes: [
            'Pembanding antar ULP dan jarak ke terbaik memakai laporan tanpa clear temper, sama dengan ukuran NKO; kolom lain memuat semua laporan.',
          ],
        },
      },
    }

    const anomalyDetail = {
      data: {
        code: 'anomali-gangguan',
        name: 'Anomali Gangguan',
        unit: 'kali',
        polarity: 'down',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'anomaly',
          focus: 'anomali-gangguan',
          month: '2026-10',
          partial: false,
          year: 2026,
          ytd: {
            wo: 189242,
            berulang: 40,
            negatif: 104,
            rate_per_10k_berulang: 2.11,
            rate_per_10k_negatif: 5.50,
          },
          ulps: [
            {
              unit_id: 'ulp-2',
              unit_name: 'ULP Jombang',
              months: 10,
              wo: 35000,
              wo_share_pct: 18.5,
              berulang: 6,
              berulang_per_10k: 1.71,
              berulang_expected: 7.4,
              berulang_flagged: false,
              negatif: 33,
              negatif_per_10k: 9.43,
              negatif_expected: 16.3,
              negatif_flagged: true,
              negatif_nonmarking: 28,
            },
          ],
          channels: [
            { kind: 'berulang', channel: 'PLN Mobile', count: 35 },
            { kind: 'negatif', channel: 'PLN Mobile', count: 90 },
          ],
          history: [
            { month: '2026-09', wo: 18000, berulang: 4, negatif: 9 },
            { month: '2026-10', wo: 19000, berulang: 3, negatif: 11 },
          ],
          notes: [
            'Kejadian anomali sangat jarang dibanding jumlah WO, sehingga angka satu ULP satu bulan mudah berubah karena kebetulan.',
          ],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'rpt-rct-gangguan') {
        return Promise.resolve(responseDetail)
      }
      if (code === 'anomali-gangguan') {
        return Promise.resolve(anomalyDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    // 1. Verifikasi Butir 42: Tab Perbandingan ULP pada RPT-RCT Gangguan
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/rpt-rct-gangguan'])

    const responseTabBtn = await screen.findByRole('button', { name: 'Perbandingan ULP' })
    expect(responseTabBtn).toBeInTheDocument()
    await userEvent.click(responseTabBtn)

    expect(await screen.findByText('Perbandingan Waktu Tanggap Antar ULP (2026-10)')).toBeInTheDocument()
    expect(screen.getByText('Volume dan Waktu Tanggap (Korelasi Dalam-ULP)')).toBeInTheDocument()
    expect(screen.getByText(/Tidak ada hubungan berarti antara volume WO/i)).toBeInTheDocument()
    expect(screen.getByText('Bulan berjalan belum lengkap (data bertambah)')).toBeInTheDocument()
    expect(screen.getAllByText('ULP Warujayeng').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ULP Jombang').length).toBeGreaterThan(0)
    expect(screen.getByText('+5,5 menit')).toBeInTheDocument()
    expect(screen.getByText(/Peringkat dan jarak ke ULP terbaik dihitung berdasarkan laporan tanpa clear temper/i)).toBeInTheDocument()

    unmount()

    // 2. Verifikasi Butir 43: Tab Per ULP pada Anomali Gangguan
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/anomali-gangguan'])

    const anomalyTabBtn = await screen.findByRole('button', { name: 'Per ULP' })
    expect(anomalyTabBtn).toBeInTheDocument()
    await userEvent.click(anomalyTabBtn)

    expect(await screen.findByText('Analisa Anomali Per ULP (Kejadian Jarang)')).toBeInTheDocument()
    expect(screen.getByText('Daftar ULP dan Hasil Uji Kejadian Jarang (2026)')).toBeInTheDocument()
    expect(screen.getByText('Total Volume WO (YTD)')).toBeInTheDocument()
    expect(screen.getByText('189.242')).toBeInTheDocument()
    expect(screen.getByText('Di atas harapan')).toBeInTheDocument()
    expect(screen.getByText('Komposisi Kanal Pengaduan Berulang')).toBeInTheDocument()
    expect(screen.getByText('Komposisi Kanal Rating Negatif')).toBeInTheDocument()
    expect(screen.getByText(/Kejadian anomali sangat jarang dibanding jumlah WO/i)).toBeInTheDocument()
  })

  it('26. mendukung Butir 44 (kWh P2TL: Penetapan & Realisasi) dan Butir 45 (HPL Biaya BP: Kasus Besar & Antrean)', async () => {
    const p2tlDetail = {
      data: {
        code: 'kwh-p2tl',
        name: 'kWh P2TL',
        unit: 'kWh',
        polarity: 'up',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'p2tl',
          month: '2026-10',
          partial: false,
          year: 2026,
          funnel: [
            {
              month: '2026-09',
              penetapan_kwh: 1200000,
              realisasi_kwh: 1100000,
              belum_kwh: 50000,
              realisasi_rp: 1650000000,
              penetapan_rp: 1800000000,
              ratio: 0.917,
              ratio_consistent: true,
            },
            {
              month: '2026-10',
              penetapan_kwh: 1300000,
              realisasi_kwh: 1200000,
              belum_kwh: 55000,
              realisasi_rp: 1800000000,
              penetapan_rp: 1950000000,
              ratio: 0.923,
              ratio_consistent: true,
            },
          ],
          ulps: {
            basis: 'year_to_date',
            rows: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                months: 10,
                realisasi_kwh: 950000,
                realisasi_rp: 1425000000,
                cases: 420,
                kwh_per_case: 2262,
                rp_per_kwh: 1500,
                penetapan_kwh: 1150000,
                realisasi_rate_pct: 82.6,
                belum_kwh: 12000,
                share_pct: 25.0,
              },
            ],
          },
          violations: [
            { key: 'Golongan I (P1)', kwh: 650000, share_pct: 54.2 },
            { key: 'Golongan II (P2)', kwh: 550000, share_pct: 45.8 },
          ],
          projection: {
            available: true,
            method: 'penetapan_x_rasio_kumulatif',
            month: '2026-10',
            ratio: 0.92,
            penetapan_kwh: 1300000,
            expected_realisasi_kwh: 1196000,
            actual_realisasi_kwh: 1200000,
            achieved_pct: 100.3,
            reliable: true,
            backtest: {
              months: 7,
              model_mape_pct: 3.6,
              naive_mape_pct: 23.8,
              mean3_mape_pct: 17.5,
            },
          },
          notes: [
            'Penetapan (kontrol 309) dan realisasi (TAGSUS) adalah dua sumber berbeda.',
          ],
        },
      },
    }

    const bpDetail = {
      data: {
        code: 'hpl-bp',
        name: 'Pendapatan Biaya Penyambungan (BP)',
        unit: 'Rp',
        polarity: 'up',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'connection_fee',
          month: '2026-10',
          partial: false,
          big_case_rp: 20000000,
          history: [
            {
              month: '2026-09',
              n: 1150,
              rp: 4500000000,
              rp_standard: 2000000000,
              rp_big: 2500000000,
              n_big: 15,
              big_share_pct: 55.6,
              pb_share_pct: 70.0,
              avg_rp: 3913043,
            },
            {
              month: '2026-10',
              n: 1200,
              rp: 5200000000,
              rp_standard: 2100000000,
              rp_big: 3100000000,
              n_big: 18,
              big_share_pct: 59.6,
              pb_share_pct: 72.0,
              avg_rp: 4333333,
            },
          ],
          month_detail: {
            rp: 5200000000,
            top10_share_pct: 48.5,
            top: [
              {
                application_number: 'APP-BIG-001',
                type: 'PB',
                rp: 850000000,
                unit_name: 'ULP Warujayeng',
                paid_at: '2026-10-15',
              },
            ],
            ulps: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                n: 180,
                rp: 1450000000,
                rp_big: 850000000,
                rp_standard: 600000000,
                avg_rp: 8055555,
                share_pct: 27.9,
              },
            ],
          },
          lag: {
            basis: 'dibuat_sampai_lunas',
            n: 14200,
            median_days: 1.0,
            p90_days: 4.0,
          },
          queue: {
            as_of: '2026-10-31',
            live_days: 30,
            buckets: [
              { key: '0-7', n: 420, rp: 1850000000 },
              { key: '8-30', n: 160, rp: 380000000 },
              { key: '>30', n: 457, rp: 950000000, stale: true },
            ],
            odds_by_age: [
              { age_days: 0, pay_probability_pct: 95.5, sample: 15000 },
            ],
          },
          forecast: {
            available: true,
            method: 'standar_rata3_plus_median_besar',
            month: '2026-11',
            based_on: '2026-10',
            standard: 2050000000,
            big_median: 2700000000,
            big_low: 1800000000,
            big_high: 3500000000,
            expected: 4750000000,
            low: 3850000000,
            high: 5550000000,
            reliable: true,
            backtest: {
              months: 30,
              model_mape_pct: 22.2,
              naive_mape_pct: 33.6,
              mean3_mape_pct: 27.0,
            },
          },
          notes: [
            'Rp bulanan didominasi sedikit kasus besar.',
          ],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'kwh-p2tl') {
        return Promise.resolve(p2tlDetail)
      }
      if (code === 'hpl-bp') {
        return Promise.resolve(bpDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    // 1. Verifikasi Butir 44: Tab Penetapan & Realisasi pada kWh P2TL
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-p2tl'])

    const p2tlTabBtn = await screen.findByRole('button', { name: 'Penetapan & Realisasi' })
    expect(p2tlTabBtn).toBeInTheDocument()
    await userEvent.click(p2tlTabBtn)

    expect(await screen.findByText('Corong Penetapan & Realisasi P2TL')).toBeInTheDocument()
    expect(screen.getByText('Riwayat 12 Bulan: Corong Penetapan dan Realisasi')).toBeInTheDocument()
    expect(screen.getByText('Perkiraan Realisasi Bulan Ini (2026-10)')).toBeInTheDocument()
    expect(screen.getByText('Model Andal')).toBeInTheDocument()
    expect(screen.getByText(/3,6%/i)).toBeInTheDocument()
    expect(screen.getByText('Kinerja P2TL Antar ULP (2026)')).toBeInTheDocument()
    expect(screen.getAllByText('ULP Warujayeng').length).toBeGreaterThan(0)
    expect(screen.getByText('Komposisi Golongan Pelanggaran P2TL (2026)')).toBeInTheDocument()
    expect(screen.getByText('Golongan I (P1)')).toBeInTheDocument()

    unmount()

    // 2. Verifikasi Butir 45: Tab Kasus Besar & Antrean pada HPL Biaya BP
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/hpl-bp'])

    const bpTabBtn = await screen.findByRole('button', { name: 'Kasus Besar & Antrean' })
    expect(bpTabBtn).toBeInTheDocument()
    await userEvent.click(bpTabBtn)

    expect(await screen.findByText('Analisa Kasus Besar & Antrean BP')).toBeInTheDocument()
    expect(screen.getByText('Prakiraan Pendapatan BP Bulan Depan (2026-11)')).toBeInTheDocument()
    expect(screen.getByText(/22,2%/i)).toBeInTheDocument()
    expect(screen.getByText('Kecepatan Pembayaran (Permohonan Sampai Lunas)')).toBeInTheDocument()
    expect(screen.getByText('1,0 hari')).toBeInTheDocument()
    expect(screen.getByText('4,0 hari')).toBeInTheDocument()
    expect(screen.getByText('Antrean Permohonan Disetujui Belum Lunas')).toBeInTheDocument()
    expect(screen.getByText(/Kedaluwarsa \(> 30 hari\)/i)).toBeInTheDocument()
    expect(screen.getByText('10 Permohonan BP Terbesar Bulan 2026-10')).toBeInTheDocument()
    expect(screen.getByText('APP-BIG-001')).toBeInTheDocument()
    expect(screen.getByText('Rincian Pendapatan BP Per ULP Bulan 2026-10')).toBeInTheDocument()
  })

  it('27. mendukung Butir 51 (Pelanggan & Daya: Tab Pertumbuhan) dan Butir 52 (Piutang Prabayar: Tab Tunggakan & Pelunasan)', async () => {
    const customerDetail = {
      data: {
        code: 'pelanggan',
        name: 'Jumlah Pelanggan',
        unit: 'pelanggan',
        polarity: 'up',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'customer_growth',
          focus: 'pelanggan',
          month: '2026-10',
          partial: false,
          reconciliation: [
            {
              month: '2026-10',
              official: 1450,
              official_unit: 'pelanggan',
              connected: 1620,
              pb_connected: 1620,
              residual: 170,
              residual_label: 'Pelanggan berhenti, bongkar, dan koreksi',
            },
          ],
          lead_time: {
            basis: 'bayar_sampai_sambung',
            months: 12,
            n: 18500,
            median_days: 1.0,
            p90_days: 3.5,
            within_30_days_pct: 98.8,
            ulps: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                n: 2100,
                median_days: 1.0,
                p90_days: 3.0,
                within_30_days_pct: 99.1,
              },
            ],
          },
          queue: {
            as_of: '2026-10-31',
            live_days: 30,
            live_0_7: 120,
            live_8_30: 45,
            stale: 38,
            in_network_proposal: 25,
            live_by_status: { APPROVED: 165 },
            ulps: [
              {
                unit_id: 'ulp-1',
                unit_name: 'ULP Warujayeng',
                live: 40,
                stale: 8,
                in_network_proposal: 5,
              },
            ],
          },
          month_projection: {
            month: '2026-10',
            day: 25,
            days_in_month: 31,
            connected_so_far: 1350,
            projected: 1674,
            last_month: 1580,
            method: 'laju_berjalan',
            backtest: {
              months: 18,
              runrate_mape_pct: 4.2,
              last_month_mape_pct: 12.8,
            },
            note: 'Proyeksi = sambungan sampai hari ini dibagi hari berjalan dikali hari dalam bulan',
          },
          areas: {
            period: { from: '2026-01-01', to: '2026-10-31' },
            added_total: 14200,
            rows: [
              {
                kecamatan: 'Prambon',
                customers: 42000,
                added: 1850,
                added_prev_year: 1620,
                change_pct: 14.2,
                share_pct: 13.0,
              },
            ],
          },
          gardu: {
            period: { from: '2026-01-01', to: '2026-10-31' },
            high_load_pct: 80,
            rows: [
              {
                substation_id: 'g-1',
                code: 'PRB01',
                name: 'Gardu Desa Prambon',
                feeder_code: 'PR01',
                kecamatan: 'Prambon',
                unit_name: 'ULP Warujayeng',
                added: 45,
                customers: 160,
                capacity_kva: 100,
                loading_pct: 85.5,
                measured_on: '2026-06-15',
                capacity_watch: true,
              },
            ],
          },
          power_changes: {
            period: { from: '2026-01-01', to: '2026-10-31' },
            total: 3500,
            net_kva: 4850.5,
            increase_kva: 5120.0,
            groups: [
              {
                group: 'R',
                group_name: 'Rumah Tangga',
                count: 2800,
                share_pct: 80.0,
                up: 2700,
                down: 80,
                same: 20,
                net_kva: 3500.0,
                increase_kva: 3650.0,
              },
            ],
          },
          notes: [
            'Rekonsiliasi: PB tersambung lawan selisih bulanan 309.',
          ],
        },
      },
    }

    const prepaidDetail = {
      data: {
        code: 'piutang-prabayar',
        name: 'Piutang Prabayar',
        unit: 'Rp',
        polarity: 'down',
        months: ['2026-09', '2026-10'],
        from: '2026-09',
        to: '2026-10',
        detail: {
          kind: 'prepaid_receivable',
          available: true,
          month: '2026-10',
          monthly: [
            {
              month: '2026-09',
              baru: 450000000,
              berjalan: 120000000,
              tunggakan: 850000000,
              total: 1420000000,
              lembar: 8500,
              units: 10,
              pelunasan: 380000000,
              effectiveness_pct: 26.8,
            },
            {
              month: '2026-10',
              baru: 480000000,
              baru_angsuran_bp: 470000000,
              baru_angsuran_p2tl: 1000000,
              baru_lainnya: 9000000,
              berjalan: 130000000,
              tunggakan: 860000000,
              total: 1470000000,
              lembar: 8700,
              units: 10,
              pelunasan: 410000000,
              effectiveness_pct: 28.9,
            },
          ],
          frozen: {
            arrears: 860000000,
            share_of_total_pct: 58.5,
            stable_months: 5,
            tolerance_pct: 2.0,
            frozen: true,
          },
          ulps: [
            {
              unit_id: 'ulp-1',
              unit_name: 'ULP Warujayeng',
              baru: 65000000,
              berjalan: 18000000,
              tunggakan: 120000000,
              total: 203000000,
              customers: 1200,
              arrears_change_6m_pct: 1.2,
              arrears_share_pct: 14.0,
            },
          ],
          tariffs: [
            {
              tariff: 'R1/450VA',
              tunggakan: 350000000,
              baru: 150000000,
              berjalan: 45000000,
              arrears_share_pct: 40.7,
            },
          ],
          anomalies: [
            {
              month: '2026-05',
              baru: 920000000,
              median_prev_12m: 460000000,
              direction: 'tinggi',
              top_ulp: {
                unit_id: 'ulp-2',
                unit_name: 'ULP Jombang',
                baru: 410000000,
              },
            },
          ],
          forecast: {
            available: true,
            target: 'tunggakan',
            month: '2026-11',
            method: 'nilai_terakhir',
            arrears: 860000000,
            reliable: true,
            backtest: {
              months: 18,
              naive_mape_pct: 1.8,
              mean3_mape_pct: 2.5,
            },
          },
          notes: [
            'Laporan piutang prabayar tidak memuat umur tunggakan.',
          ],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'pelanggan') {
        return Promise.resolve(customerDetail)
      }
      if (code === 'piutang-prabayar') {
        return Promise.resolve(prepaidDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    // 1. Verifikasi Butir 51: Tab Pertumbuhan pada Pelanggan
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelanggan'])

    const customerTabBtn = await screen.findByRole('button', { name: 'Pertumbuhan' })
    expect(customerTabBtn).toBeInTheDocument()
    await userEvent.click(customerTabBtn)

    expect(await screen.findByText('Pertumbuhan & Dinamika Lapangan')).toBeInTheDocument()
    expect(screen.getByText('Proyeksi Akhir Bulan Berjalan (2026-10)')).toBeInTheDocument()
    expect(screen.getByText('Hari ke-25 dari 31')).toBeInTheDocument()
    expect(screen.getByText('Kecepatan Penyambungan PB (Bayar Sampai Nyala)')).toBeInTheDocument()
    expect(screen.getByText('Antrean Permohonan PB Hari Ini')).toBeInTheDocument()
    expect(screen.getByText(/Menunggu Usulan Jaringan/i)).toBeInTheDocument()
    expect(screen.getByText('Kedaluwarsa (> 30 hari)')).toBeInTheDocument()
    expect(screen.getByText('Rekonsiliasi Bulanan: Tambahan Permohonan vs Selisih Posisi 309')).toBeInTheDocument()
    expect(screen.getByText('Kecamatan Tumbuh Terbanyak (Tahun Berjalan)')).toBeInTheDocument()
    expect(screen.getByText('Prambon')).toBeInTheDocument()
    expect(screen.getByText('Gardu Tumbuh Cepat & Beban')).toBeInTheDocument()
    expect(screen.getByText('Perlu kapasitas')).toBeInTheDocument()
    expect(screen.getByText('Dinamika Perubahan Daya (PD) Menurut Golongan Tarif')).toBeInTheDocument()

    unmount()

    // 2. Verifikasi Butir 52: Tab Tunggakan & Pelunasan pada Piutang Prabayar
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/piutang-prabayar'])

    const prepaidTabBtn = await screen.findByRole('button', { name: 'Tunggakan & Pelunasan' })
    expect(prepaidTabBtn).toBeInTheDocument()
    await userEvent.click(prepaidTabBtn)

    expect(await screen.findByText('Tunggakan & Pelunasan Piutang Prabayar')).toBeInTheDocument()
    expect(screen.getByText('Peringatan Data Anomali Piutang Baru:')).toBeInTheDocument()
    expect(screen.getByText('2026-05')).toBeInTheDocument()
    expect(screen.getByText(/menyimpang jauh tinggi dari median 12 bulan sebelumnya/i)).toBeInTheDocument()
    expect(screen.getByText('Tunggakan Beku (Tidak Bergerak)')).toBeInTheDocument()
    expect(screen.getByText('5 Bulan Statis')).toBeInTheDocument()
    expect(screen.getByText('Prakiraan Saldo Tunggakan (2026-11)')).toBeInTheDocument()
    expect(screen.getByText('Riwayat Komposisi Piutang Prabayar & Pelunasan')).toBeInTheDocument()
    expect(screen.getByText('Total Baru (Rp)')).toBeInTheDocument()
    expect(screen.getByText('Angsuran BP (Rp)')).toBeInTheDocument()
    expect(screen.getByText(/Angsuran P2TL \(Rp\)\*/)).toBeInTheDocument()
    expect(screen.getByText('Baru Lainnya (Rp)')).toBeInTheDocument()
    expect(screen.getByText('Rp 470.0 Jt')).toBeInTheDocument()
    expect(screen.getByText('Rp 1.0 Jt')).toBeInTheDocument()
    expect(screen.getAllByText(/bukan merupakan piutang baru/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Posisi Per ULP (2026-10)')).toBeInTheDocument()
    expect(screen.getByText('Tunggakan Per Golongan Tarif (2026-10)')).toBeInTheDocument()
    expect(screen.getByText('R1/450VA')).toBeInTheDocument()
  })

  it('28. mendukung Butir 55: Tingkat Pemulihan PRR dan Butir 56: Ambang Status Target 100/90', async () => {
    const prrDetail = {
      data: {
        code: 'pelunasan-prr',
        name: 'Pelunasan PRR',
        unit: 'Rp',
        polarity: 'up',
        months: ['2026-02', '2026-03'],
        series: [{ key: 'rp', name: 'Pelunasan PRR', unit: 'Rp', values: [1000000, 1500000], latest: 1500000, ytd: 2500000 }],
        targets: [
          {
            definition_code: 'pencapaian-pelunasan-prr-ex-prr-dan-piutang-prabayar',
            name: 'Pencapaian Pelunasan PRR',
            month: '2026-03',
            target: 2000000,
            realisasi: 1900000,
            pencapaian_pct: 95.0,
            status: 'waspada', // Butir 56: 95% kini berstatus waspada (90 - <100%)
            realisasi_source: 'SISTEM',
            validated: true,
            unit_label: 'Rp',
            polarity: 'up',
          },
        ],
        detail: {
          kind: 'repayment_age',
          available: true,
          period: { from: '2026-01', to: '2026-03' },
          files: 6,
          rp_total: 2500000,
          rows: [
            { key: '0 sampai 3 bulan', rp: 1500000, share_pct: 60.0 },
            { key: '4 sampai 6 bulan', rp: 1000000, share_pct: 40.0 },
          ],
          monthly: [
            { month: '2026-02', '0 sampai 3 bulan': 600000, '4 sampai 6 bulan': 400000 },
            { month: '2026-03', '0 sampai 3 bulan': 900000, '4 sampai 6 bulan': 600000 },
          ],
          recovery: {
            available: true,
            latest_month: '2026-03',
            saldo_rp: 1300000000,
            customers: 450,
            monthly: [
              {
                month: '2026-02',
                saldo_rp: 1500000000,
                customers: 460,
                opening_rp: 1700000000,
                repaid_rp: 100000000,
                recovery_pct: 5.88,
                partial: false,
              },
              {
                month: '2026-03',
                saldo_rp: 1300000000,
                customers: 450,
                opening_rp: 1500000000,
                repaid_rp: 150000000,
                recovery_pct: 10.0,
                partial: false,
              },
            ],
            ytd: {
              opening_rp: 1700000000,
              repaid_rp: 250000000,
              recovery_pct: 14.71,
            },
            by_billing_year: [
              { year: 2024, saldo_rp: 500000000, rows: 120, share_pct: 38.46, repaid_ytd_rp: 50000000 },
              { year: 2025, saldo_rp: 800000000, rows: 330, share_pct: 61.54, repaid_ytd_rp: 200000000 },
            ],
            notes: [
              'Saldo = jumlah kolom RP PRR laporan Daftar PRR AP2T.',
            ],
          },
          notes: ['Umur = selisih bulan bayar dan bulan tagihan.'],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'pelunasan-prr') {
        return Promise.resolve(prrDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelunasan-prr'])

    // Verifikasi Butir 56: Ambang status waspada pada kartu target KPI
    expect(await screen.findByText(/95,0% capaian/i)).toBeInTheDocument()
    expect(screen.getAllByText(/waspada/i).length).toBeGreaterThan(0)

    // Verifikasi tab Umur BLTH Pelunasan
    const tabBtn = await screen.findByRole('button', { name: 'Umur BLTH Pelunasan' })
    expect(tabBtn).toBeInTheDocument()
    await userEvent.click(tabBtn)

    // Verifikasi Butir 55: Komponen recovery PRR tampil
    expect(await screen.findByTestId('prr-recovery-section')).toBeInTheDocument()
    expect(screen.getByText('Saldo PRR Terakhir')).toBeInTheDocument()
    expect(screen.getByText('Pemulihan Bulan Terakhir')).toBeInTheDocument()
    expect(screen.getAllByText('10,00%').length).toBeGreaterThan(0)
    expect(screen.getByText('Pemulihan Kumulatif YTD')).toBeInTheDocument()
    expect(screen.getByText('14,71%')).toBeInTheDocument()

    // Verifikasi tabel saldo bulanan & tingkat pemulihan
    expect(screen.getByText('Saldo PRR dan Tingkat Pemulihan Bulanan')).toBeInTheDocument()
    expect(screen.getByText('Tingkat Pemulihan (%)')).toBeInTheDocument()

    // Verifikasi tabel distribusi saldo menurut tahun tagihan
    expect(screen.getByText('Distribusi Saldo PRR Menurut Tahun Tagihan (BLTH)')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('38,46%')).toBeInTheDocument()
    expect(screen.getByText('61,54%')).toBeInTheDocument()
  })

  it('29. mendukung Butir 57: Perkiraan Saldo dan Pemulihan Ex PRR', async () => {
    const exPrrDetail = {
      data: {
        code: 'pelunasan-ex-prr',
        name: 'Pelunasan Ex PRR',
        unit: 'Rp',
        polarity: 'up',
        months: ['2026-01', '2026-02'],
        series: [{ key: 'rp', name: 'Pelunasan Ex PRR', unit: 'Rp', values: [50000, 40000], latest: 40000, ytd: 90000 }],
        detail: {
          kind: 'repayment_age',
          available: true,
          period: { from: '2026-01', to: '2026-02' },
          files: 4,
          rp_total: 90000,
          rows: [
            { key: 'lebih dari 24 bulan', rp: 90000, share_pct: 100.0 },
          ],
          monthly: [
            { month: '2026-01', 'lebih dari 24 bulan': 50000 },
            { month: '2026-02', 'lebih dari 24 bulan': 40000 },
          ],
          recovery: {
            available: true,
            estimated: true,
            since_month: '2026-01',
            latest_month: '2026-02',
            estimated_balance_rp: 910000,
            cumulative_written_off_rp: 1000000,
            cumulative_repaid_rp: 90000,
            recovery_pct: 9.0,
            monthly: [
              {
                month: '2026-01',
                written_off_rp: 600000,
                written_off_customers: 20,
                repaid_rp: 50000,
                cumulative_written_off_rp: 600000,
                cumulative_repaid_rp: 50000,
                estimated_balance_rp: 550000,
                partial: false,
              },
              {
                month: '2026-02',
                written_off_rp: 400000,
                written_off_customers: 15,
                repaid_rp: 40000,
                cumulative_written_off_rp: 1000000,
                cumulative_repaid_rp: 90000,
                estimated_balance_rp: 910000,
                partial: false,
              },
            ],
            by_billing_year: [
              { year: 2018, written_off_rp: 400000 },
              { year: 2019, written_off_rp: 600000 },
            ],
            notes: [
              'Perkiraan: AP2T tidak punya laporan saldo Ex PRR. Saldo perkiraan = penghapusan PRR kumulatif dikurangi pelunasan Ex PRR kumulatif, dihitung sejak 2026-01.',
            ],
          },
          notes: ['Umur = selisih bulan bayar dan bulan tagihan.'],
        },
      },
    }

    pengusahaanApi.metric.mockImplementation((code) => {
      if (code === 'pelunasan-ex-prr') {
        return Promise.resolve(exPrrDetail)
      }
      return Promise.resolve(MOCK_METRIC_DETAIL)
    })

    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelunasan-ex-prr'])

    const tabBtn = await screen.findByRole('button', { name: 'Umur BLTH Pelunasan' })
    expect(tabBtn).toBeInTheDocument()
    await userEvent.click(tabBtn)

    // Verifikasi Butir 57: Komponen perkiraan recovery Ex PRR tampil
    expect(await screen.findByTestId('exprr-recovery-section')).toBeInTheDocument()
    expect(screen.getByText('Saldo Ex PRR')).toBeInTheDocument()
    expect(screen.getAllByText('Perkiraan').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Penghapusan Kumulatif').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pelunasan Kumulatif').length).toBeGreaterThan(0)
    expect(screen.getByText('9,00%')).toBeInTheDocument()

    // Verifikasi tabel riwayat bulanan penghapusan & perkiraan saldo
    expect(screen.getByText(/Riwayat Bulanan Penghapusan & Perkiraan Saldo Ex PRR/i)).toBeInTheDocument()
    expect(screen.getByText('Penghapusan (Bulan Ini)')).toBeInTheDocument()
    expect(screen.getByText('Perkiraan Saldo')).toBeInTheDocument()

    // Verifikasi tabel distribusi tahun tagihan penghapusan
    expect(screen.getByText('Distribusi Penghapusan PRR Menurut Tahun Tagihan (BLTH)')).toBeInTheDocument()
    expect(screen.getByText('2018')).toBeInTheDocument()
    expect(screen.getByText('2019')).toBeInTheDocument()
  })

  it('30. tab Tren mempertahankan grafik garis+area, toggle Bulanan/Kumulatif YTD, dan mode Penambahan (Δ YTD) untuk Target NKO delta', async () => {
    const kwhFlowDetail = {
      data: {
        metric: { code: 'kwh-jual', name: 'kWh Jual', unit: 'GWh', polarity: 'up', source: '309', ytd_mode: 'sum' },
        from: '2026-01',
        to: '2026-03',
        months: ['2026-01', '2026-02', '2026-03'],
        units_expected: 1,
        units_reporting: [1, 1, 1],
        series: [
          { key: 'kwh', name: 'kWh Jual', unit: 'GWh', values: [100, 110, 120], previous_year: [95, 100, 105] },
        ],
        summary: [{ key: 'kwh', latest: 120, mom_pct: 9.1, yoy_pct: 14.3 }],
        targets: [
          { name: 'Penjualan TL', month: '2026-03', target: 350, realisasi: 330, pencapaian_pct: 94.3, status: 'waspada', unit_label: 'GWh' },
        ],
      },
    }

    const pelangganPositionDetail = {
      data: {
        metric: { code: 'pelanggan', name: 'Pelanggan', unit: 'Plg', polarity: 'up', source: '309', ytd_mode: 'last' },
        from: '2026-01',
        to: '2026-03',
        months: ['2026-01', '2026-02', '2026-03'],
        units_expected: 1,
        units_reporting: [1, 1, 1],
        series: [
          { key: 'pelanggan', name: 'Pelanggan', unit: 'Plg', values: [502000, 504500, 508000], previous_year: [490000, 491500, 493000] },
        ],
        summary: [{ key: 'pelanggan', latest: 508000, mom_pct: 0.69, yoy_pct: 3.04 }],
        targets: [
          { name: 'Penambahan Pelanggan', month: '2026-03', target: 15000, realisasi: 15000, pencapaian_pct: 100, status: 'aman', unit_label: 'Plg' },
        ],
      },
    }

    pengusahaanApi.metric.mockResolvedValue(kwhFlowDetail)

    const user = userEvent.setup()
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    // Default Bulanan -> Grafik Garis Tren (Line+Area)
    expect(await screen.findByText('Grafik Garis Tren')).toBeInTheDocument()

    // Beralih ke Kumulatif (YTD) -> menampilkan garis Target NKO
    await user.click(screen.getByRole('button', { name: 'Kumulatif (YTD)' }))
    expect(await screen.findByText('Akumulasi Kumulatif Tahun Berjalan')).toBeInTheDocument()
    expect(screen.getByText(/Target NKO \(350/i)).toBeInTheDocument()

    unmount()

    // Pelanggan (posisi dengan target delta): otomatis membuka mode Penambahan (Δ YTD) agar sebanding dengan Target NKO
    pengusahaanApi.metric.mockResolvedValue(pelangganPositionDetail)
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pelanggan'])
    expect(await screen.findByText(/Penambahan Δ YTD \(Plg\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Target NKO \(15\.000/i)).toBeInTheDocument()

    // Beralih ke Posisi Total -> Target NKO delta tidak ditampilkan di skala total
    await user.click(screen.getByRole('button', { name: 'Posisi Total' }))
    expect(screen.queryByText(/Target NKO \(15\.000/i)).not.toBeInTheDocument()
  })

  it('31. tab Rincian menampilkan grafik komposisi, ringkasan konsentrasi, Δ Porsi, baris Total, sebaran rata-rata ULP, dan drill-down klik ULP', async () => {
    const rincianDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: { code: 'kwh-jual', name: 'kWh Jual', unit: 'GWh', polarity: 'up', source: '309' },
        from: '2026-01',
        to: '2026-03',
        months: ['2026-01', '2026-02', '2026-03'],
        units_expected: 2,
        units_reporting: [2, 2, 2],
        series: [{ key: 'kwh', name: 'kWh Jual', unit: 'GWh', values: [100, 110, 120], previous_year: [95, 100, 105] }],
        summary: [{ key: 'kwh', latest: 120, mom_pct: 9.1, yoy_pct: 14.3 }],
        breakdown: {
          dimension: 'Golongan Tarif',
          period: '2026-03',
          rows: [
            { key: 'Rumah tangga', value: 70, share_pct: 58.3, same_month_last_year: 60, yoy_pct: 16.7 },
            { key: 'Bisnis', value: 30, share_pct: 25.0, same_month_last_year: 25, yoy_pct: 20.0 },
            { key: 'Industri', value: 20, share_pct: 16.7, same_month_last_year: 20, yoy_pct: 0.0 },
          ],
        },
        comparison: [
          { unit_id: 'ulp-1', unit_name: 'ULP Mojokerto Kota', latest: 70, yoy_pct: 12.0, ytd: 200 },
          { unit_id: 'ulp-2', unit_name: 'ULP Jombang', latest: 50, yoy_pct: 8.0, ytd: 150 },
        ],
      },
    }
    pengusahaanApi.metric.mockResolvedValue(rincianDetail)

    const user = userEvent.setup()
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    const detailsTab = await screen.findByRole('button', { name: 'Rincian' })
    await user.click(detailsTab)

    expect(await screen.findByText(/kategori terbesar menyumbang/i)).toBeInTheDocument()
    expect(screen.getByText('Komposisi Terbesar')).toBeInTheDocument()
    expect(screen.getByText('Δ Porsi')).toBeInTheDocument()
    expect(screen.getByText(/Total \(3\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Sebaran Capaian ULP/i)).toBeInTheDocument()
    expect(screen.getByText(/Rata-rata ULP/i)).toBeInTheDocument()

    // Drill-down klik ULP dari tabel Perbandingan Antar ULP
    const ulpButtons = screen.getAllByRole('button', { name: 'ULP Mojokerto Kota' })
    await user.click(ulpButtons[0])
    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith(
        'kwh-jual',
        expect.objectContaining({ unit_id: 'ulp-1' }),
      )
    })
  })

  it('32. menu kWh Jual, Pendapatan, dan Pendapatan BP menampilkan tab Pertumbuhan beserta grafik garis vs tahun sebelumnya, kuadran ULP, dan pertumbuhan per segmen', async () => {
    const kwhGrowthDetail = {
      data: {
        unit: { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        metric: { code: 'kwh-jual', name: 'kWh Jual', unit: 'GWh', polarity: 'up', source: '309', ytd_mode: 'sum' },
        from: '2026-01',
        to: '2026-03',
        months: ['2026-01', '2026-02', '2026-03'],
        units_expected: 2,
        units_reporting: [2, 2, 2],
        series: [{ key: 'kwh', name: 'kWh Jual', unit: 'GWh', values: [100, 110, 125], previous_year: [95, 100, 105] }],
        summary: [{ key: 'kwh', latest: 125, mom_pct: 13.6, yoy_pct: 19.0 }],
        targets: [{ name: 'Penjualan TL', month: '2026-03', target: 350, realisasi: 335, pencapaian_pct: 95.7, needed_per_month: 25, unit_label: 'GWh' }],
        breakdown: {
          dimension: 'Golongan Tarif',
          period: '2026-03',
          rows: [
            { key: 'Rumah tangga', value: 75, share_pct: 60.0, same_month_last_year: 60, yoy_pct: 25.0 },
            { key: 'Industri', value: 50, share_pct: 40.0, same_month_last_year: 45, yoy_pct: 11.1 },
          ],
        },
        comparison: [
          { unit_id: 'ulp-1', unit_name: 'ULP Mojokerto Kota', latest: 75, yoy_pct: 18.0, ytd: 210 },
          { unit_id: 'ulp-2', unit_name: 'ULP Jombang', latest: 50, yoy_pct: -2.0, ytd: 140 },
        ],
      },
    }
    pengusahaanApi.metric.mockResolvedValue(kwhGrowthDetail)

    const user = userEvent.setup()
    const { unmount } = wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/kwh-jual'])

    const growthTab = await screen.findByRole('button', { name: 'Pertumbuhan' })
    await user.click(growthTab)

    expect(await screen.findByTestId('growth-analysis-section')).toBeInTheDocument()
    expect(screen.getByText('Pertumbuhan Bulanan (Δ MoM)')).toBeInTheDocument()
    expect(screen.getByText('Pertumbuhan Tahunan (Δ YoY)')).toBeInTheDocument()
    expect(screen.getByText('Pertumbuhan YTD vs Thn Lalu')).toBeInTheDocument()
    expect(screen.getByText('Laju vs Kebutuhan Target')).toBeInTheDocument()
    expect(screen.getByText(/Kuadran Pertumbuhan ULP/i)).toBeInTheDocument()
    expect(screen.getByText('Tumbuh Cepat & Besar')).toBeInTheDocument()
    expect(screen.getByText('Kontraksi')).toBeInTheDocument()
    expect(screen.getByText('Pertumbuhan per Golongan Tarif')).toBeInTheDocument()
    expect(screen.getByText(/Tren Pertumbuhan Bulanan.*vs Tahun Sebelumnya/i)).toBeInTheDocument()
    expect(screen.getByText('Tahun Sebelumnya')).toBeInTheDocument()

    // Verifikasi menu Pendapatan juga memiliki tab Pertumbuhan
    unmount()
    wrap(<BusinessAnalyticsPage />, { 'pengusahaan.view': true }, ['/pengusahaan/pendapatan'])
    expect(await screen.findByRole('button', { name: 'Pertumbuhan' })).toBeInTheDocument()
  })

  it('defaults UP3 and ULP to Semua UP3 / Semua ULP for SYS_ADMIN and loads aggregated metric data without unit_id', async () => {
    render(
      <MemoryRouter initialEntries={['/pengusahaan/pelanggan']}>
        <AuthContext.Provider value={{ user: { id: 'usr-admin', name: 'SysAdmin' }, status: 'authenticated' }}>
          <AccessContext.Provider value={{ can: { 'pengusahaan.view': true }, isSysAdmin: true, createUnits: [], loading: false }}>
            <NotificationProvider>
              <Routes>
                <Route path="/pengusahaan/:metricCode" element={<BusinessAnalyticsPage />} />
              </Routes>
            </NotificationProvider>
          </AccessContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(pengusahaanApi.metric).toHaveBeenCalledWith('pelanggan', expect.not.objectContaining({ unit_id: expect.anything() }))
    })
    expect(screen.getByDisplayValue('Semua UP3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Semua ULP')).toBeInTheDocument()
  })
})
