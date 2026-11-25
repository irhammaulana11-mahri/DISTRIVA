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
        months: ['2026-09', '2026-10'],
        coverage: {
          units: [
            { unit_id: 'u-1', unit_name: 'ULP Jombang', months: [true, true], missing: [], missing_count: 0 },
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
    expect(screen.getByText('Rumah tangga')).toBeInTheDocument()
    expect(screen.getByText('75,0%')).toBeInTheDocument()

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
    expect(screen.getByText('PLN Mobile')).toBeInTheDocument()
    expect(screen.getByText('70,0%')).toBeInTheDocument()
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
})
