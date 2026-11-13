import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import SubstationMeasurementsPage from './SubstationMeasurementsPage.jsx'
import { substationsApi, feedersApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  substationsApi: {
    list: vi.fn(),
    get: vi.fn(),
    analysis: vi.fn(),
    addReading: vi.fn(),
    bulkReadings: vi.fn(),
  },
  feedersApi: { list: vi.fn() },
  adminApi: { units: vi.fn() },
}))

const row = (over = {}) => ({
  id: 's1',
  code: 'HD0001',
  name: 'Gardu Satu',
  unit_name: 'ULP Jombang',
  unit_code: '51453',
  feeder_code: 'JBG01',
  capacity_kva: 200,
  ownership: 'PLN',
  status: 'AKTIF',
  needs_review: false,
  pickable: true,
  reading_status: 'FRESH',
  reading: {
    measured_on: '2026-11-01',
    age_days: 9,
    load_kva: 120,
    loading_pct: 60,
    base_voltage_r_v: 233,
    base_voltage_s_v: 232,
    base_voltage_t_v: 230,
    base_voltage_min_v: 230,
    end_voltage_v: 215,
    flags: ['BASE_LOW'],
  },
  ...over,
})

const analysisMock = (over = {}) => ({
  data: {
    substation: { id: 's1', code: 'HD0001', name: 'Gardu Satu', capacity_kva: 200 },
    limits: {
      base_voltage_min_v: 231,
      end_voltage_min_v: 200,
      imbalance_max_pct: 20,
      feeder_imbalance_max_pct: 30,
      drop_max_pct: 10,
    },
    history: [
      {
        measured_on: '2026-09-01',
        source: 'IMPORT',
        loading_pct: 50,
        load_kva: 100,
        current_r_a: 100,
        current_s_a: 90,
        current_t_a: 80,
        base_voltage_min_v: 233,
        end_voltage_v: 215,
        flags: [],
      },
      {
        measured_on: '2026-10-01',
        source: 'SYNC',
        loading_pct: 62,
        load_kva: 124,
        current_r_a: 150,
        current_s_a: 100,
        current_t_a: 50,
        base_voltage_min_v: 228,
        end_voltage_v: 190,
        flags: ['BASE_LOW', 'PHASE_UNBALANCED', 'END_LOW', 'END_DROP'],
      },
    ],
    latest: {
      measured_on: '2026-10-01',
      loading_pct: 62,
      current_r_a: 150,
      current_s_a: 100,
      current_t_a: 50,
      current_n_a: 30,
      phase_imbalance_pct: 33.33,
      neutral_ratio_pct: 30,
      feeder_imbalance_pct: 53.85,
      base_voltage_min_v: 228,
      end_voltage_min_v: 190,
      drop_v: 38,
      drop_pct: 16.67,
      flags: ['BASE_LOW', 'PHASE_UNBALANCED', 'FEEDER_UNBALANCED', 'END_LOW', 'END_DROP'],
      feeders: [
        { label: 'A', current_r_a: 100, current_s_a: 60, current_t_a: 40, current_n_a: null, end_voltage_v: 190, total_a: 200, share_pct: 76.9 },
        { label: 'B', current_r_a: 50, current_s_a: 40, current_t_a: 10, current_n_a: null, end_voltage_v: null, total_a: 100, share_pct: 23.1 },
      ],
    },
    forecast: {
      available: true,
      notes: [],
      base: { measured_on: '2026-10-01', load_kva: 124, connected_since_kva: 8 },
      growth_kva_per_month: 2,
      growth_overridden: false,
      over_normal_on: '2027-03',
      over_100_on: null,
      months: [
        { month: '2026-11', load_kva: 132, loading_pct: 66, class: 'NORMAL' },
        { month: '2027-03', load_kva: 164, loading_pct: 82, class: 'OVERLOAD' },
      ],
      additions: { pipeline_kva: 16, pipeline_count: 1, avg_monthly_kva: 2, realized: [], monthly: [{ month: '2026-10', count: 2, kva: 8 }] },
    },
    ...over,
  },
})

function renderPage(
  can = {
    'substations.view': true,
    'substations.reading': true,
    'feeders.view': true,
  },
  initialEntries = ['/master-data/substation-measurements']
) {
  return render(
    <AccessContext.Provider value={{ loading: false, can, canWrite: {}, isSysAdmin: false }}>
      <NotificationProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <SubstationMeasurementsPage />
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>
  )
}

describe('Pengukuran Gardu — SubstationMeasurementsPage (docs/80 §15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({
      data: [{ id: 'u1', code: '51453', name: 'ULP Jombang', unit_type: 'ULP' }],
    })
    feedersApi.list.mockResolvedValue({
      data: [{ id: 'f1', code: 'JBG01', name: 'Jombang 01' }],
    })
    substationsApi.list.mockImplementation((params = {}) => {
      if (params.reading_status === 'FRESH' && params.per_page === 1) {
        return Promise.resolve({ data: [row()], meta: { total: 14 } })
      }
      if (params.per_page === 1) {
        return Promise.resolve({ data: [row()], meta: { total: 971 } })
      }
      return Promise.resolve({
        data: [
          row(),
          row({
            id: 's2',
            code: 'HD0002',
            name: 'Gardu Dua',
            capacity_kva: 100,
            reading_status: 'NONE',
            reading: null,
          }),
        ],
        meta: { total: 2, current_page: 1, last_page: 1, per_page: 25 },
      })
    })
  })

  it('1. menampilkan kolom pengukuran: pembebanan, tegangan pangkal terendah, tegangan ujung, tanggal/usia pembacaan, status, dan penanda peringatan; gardu tanpa pembacaan tetap muncul', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('substation-measurement-row')
    expect(rows).toHaveLength(2)

    // Baris 1: dengan pembacaan
    expect(rows[0]).toHaveTextContent('HD0001')
    expect(rows[0]).toHaveTextContent('60%')
    expect(rows[0]).toHaveTextContent('230') // base_voltage_min_v
    expect(rows[0]).toHaveTextContent('215') // end_voltage_v
    expect(rows[0]).toHaveTextContent('2026-11-01 (9 hr)')
    expect(rows[0]).toHaveTextContent('Terkini')
    expect(rows[0]).toHaveTextContent('Tegangan pangkal rendah')

    // Baris 2: tanpa pembacaan tetap tampil dengan "-"
    expect(rows[1]).toHaveTextContent('HD0002')
    expect(rows[1]).toHaveTextContent('Belum ada')
    expect(rows[1]).toHaveTextContent('-')
  })

  it('2. ringkasan kondisi data di atas tabel menampilkan "N dari M gardu punya pembacaan terkini"', async () => {
    renderPage()
    const summary = await screen.findByTestId('data-condition-summary')
    expect(summary).toHaveTextContent('14 dari 971 gardu punya pembacaan terkini')
    expect(summary).toHaveTextContent('Pembacaan baru datang dari survei atau sinkronisasi Maximo')
  })

  it('3. filter reading_status, alert, loading_min/max, dan urutan default sort=loading&dir=desc dikirim ke server', async () => {
    renderPage()
    await screen.findAllByTestId('substation-measurement-row')

    // Verifikasi urutan default
    expect(substationsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'loading',
        dir: 'desc',
      })
    )

    // Filter status pembacaan
    await userEvent.selectOptions(screen.getByLabelText('Status pembacaan'), 'STALE')
    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ reading_status: 'STALE' })
      )
    })

    // Filter pembebanan pintasan "> 80 % (overload)"
    await userEvent.selectOptions(screen.getByLabelText('Filter Pembebanan'), 'OVERLOAD')
    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ loading_min: '80' })
      )
    })

    // Filter peringatan tegangan pangkal
    await userEvent.selectOptions(screen.getByLabelText('Peringatan'), 'BASE_LOW')
    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ alert: 'BASE_LOW' })
      )
    })
  })

  it('4. detail gardu: tombol "Data induk" mengarah ke /master-data/substations?open=s1 dan riwayat 12 pembacaan tampil', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453' }),
        transformers: [],
        readings: [
          {
            measured_on: '2026-11-01',
            source: 'IMPORT',
            current_r_a: 100,
            current_s_a: 90,
            current_t_a: 80,
            current_max_a: null,
            load_kva: 59.4,
            loading_pct: 29.7,
            end_voltage_v: 215,
          },
        ],
      },
    })
    substationsApi.analysis.mockResolvedValue(analysisMock())

    renderPage()
    const rows = await screen.findAllByTestId('substation-measurement-row')
    await userEvent.click(rows[0])

    const detail = await screen.findByTestId('substation-measurement-detail')
    expect(detail).toBeInTheDocument()

    // Tombol kembali ke Data Induk
    const linkDataInduk = screen.getByRole('link', { name: /Data induk/i })
    expect(linkDataInduk).toBeInTheDocument()
    expect(linkDataInduk).toHaveAttribute('href', '/master-data/substations?open=s1')

    // Buka tab Riwayat Pembacaan
    await userEvent.click(screen.getByRole('button', { name: /Riwayat Pembacaan/i }))
    expect(screen.getByText('100 / 90 / 80')).toBeInTheDocument()
    expect(screen.getByText('29,7%')).toBeInTheDocument()
  })

  it('5. analisis gardu: peringatan, riwayat grafik, keseimbangan fasa & jurusan, tegangan', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453' }),
        transformers: [],
        readings: [],
      },
    })
    substationsApi.analysis.mockResolvedValue(analysisMock())

    renderPage()
    await userEvent.click((await screen.findAllByTestId('substation-measurement-row'))[0])

    await waitFor(() => {
      expect(screen.getByTestId('substation-analysis')).toBeInTheDocument()
    })

    const flagsContainer = screen.getByTestId('analysis-flags')
    for (const f of ['BASE_LOW', 'PHASE_UNBALANCED', 'END_LOW', 'END_DROP']) {
      expect(within(flagsContainer).getByTestId(`flag-${f}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('chart-history')).toBeInTheDocument()

    // Keseimbangan
    await userEvent.click(screen.getByRole('button', { name: 'Keseimbangan' }))
    expect(screen.getByTestId('phase-imbalance')).toHaveTextContent('33,3%')
    expect(screen.getByTestId('feeder-imbalance')).toHaveTextContent('53,9%')
    expect(screen.getByText('76,9%')).toBeInTheDocument()

    // Tegangan
    await userEvent.click(screen.getByRole('button', { name: 'Tegangan' }))
    expect(screen.getByTestId('voltage')).toHaveTextContent('228')
    expect(screen.getByTestId('voltage')).toHaveTextContent('38')
    expect(screen.getByTestId('chart-voltage')).toBeInTheDocument()
  })

  it('6. proyeksi beban: bulan melewati batas dan simulasi growth_kva menanyakan ulang ke server', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453' }),
        transformers: [],
        readings: [],
      },
    })
    substationsApi.analysis.mockResolvedValue(analysisMock())

    renderPage()
    await userEvent.click((await screen.findAllByTestId('substation-measurement-row'))[0])

    await screen.findByTestId('substation-analysis')
    await userEvent.click(screen.getByRole('button', { name: 'Proyeksi' }))

    expect(screen.getByTestId('forecast-crossing')).toHaveTextContent('Melewati 80% (overload) pada 2027-03')
    expect(screen.getByTestId('forecast-crossing')).toHaveTextContent('Tidak melewati 100%')

    await userEvent.type(screen.getByLabelText('Simulasi pertumbuhan'), '25')
    await waitFor(() => {
      expect(substationsApi.analysis).toHaveBeenLastCalledWith('s1', { growth_kva: '25' })
    })
  })

  it('7. form tambah pembacaan: tegangan pangkal dan jurusan dikirim, hanya bila substations.reading dan gardu pickable', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453', pickable: true }),
        transformers: [],
        readings: [],
      },
    })
    substationsApi.analysis.mockResolvedValue(analysisMock())
    substationsApi.addReading.mockResolvedValue({ data: {} })

    // Tanpa izin substations.reading
    const { unmount } = renderPage({ 'substations.view': true, 'substations.reading': false })
    await userEvent.click((await screen.findAllByTestId('substation-measurement-row'))[0])
    expect(await screen.findByTestId('substation-measurement-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('reading-form')).not.toBeInTheDocument()
    unmount()

    // Dengan izin substations.reading
    renderPage({ 'substations.view': true, 'substations.reading': true })
    await userEvent.click((await screen.findAllByTestId('substation-measurement-row'))[0])
    expect(await screen.findByTestId('reading-form')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Tegangan pangkal R-N (V)'), '228')
    await userEvent.click(screen.getByRole('button', { name: '+ Tambah jurusan' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Tambah jurusan' }))
    await userEvent.type(screen.getByLabelText('R (A) jurusan 1'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan pembacaan' }))

    await waitFor(() => {
      expect(substationsApi.addReading).toHaveBeenCalled()
    })
    const body = substationsApi.addReading.mock.calls[0][1]
    expect(body.base_voltage_r_v).toBe(228)
    expect(body.feeders).toEqual([{ label: 'A', current_r_a: 100 }, { label: 'B' }])
  })

  it('8. parameter ?open=<id> otomatis membuka Drawer saat dimuat', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ id: 's1', code: 'HD0001' }),
        transformers: [],
        readings: [],
      },
    })
    substationsApi.analysis.mockResolvedValue(analysisMock())

    renderPage(
      { 'substations.view': true, 'substations.reading': true },
      ['/master-data/substation-measurements?open=s1']
    )

    expect(await screen.findByTestId('substation-measurement-detail')).toBeInTheDocument()
    expect(substationsApi.get).toHaveBeenCalledWith('s1')
  })

  it('9. menampilkan GD514530146 sebagai Kode, HD0022 sebagai Nama, kombinasi kode dan nama penyulang, serta header Tgl Pengukuran Terakhir', async () => {
    substationsApi.list.mockImplementation((params = {}) => {
      if (params.per_page === 1) return Promise.resolve({ data: [row()], meta: { total: 1 } })
      return Promise.resolve({
        data: [
          row({
            id: 's-custom',
            code: 'HD0022',
            gadis_number: 'GD514530146',
            name: 'Gardu Induk Mojokerto',
            feeder_code: 'JBG01',
          }),
        ],
        meta: { total: 1, current_page: 1, last_page: 1, per_page: 25 },
      })
    })

    renderPage()
    const rows = await screen.findAllByTestId('substation-measurement-row')
    expect(rows).toHaveLength(1)

    // Header harus bertuliskan "Tgl Pengukuran Terakhir"
    expect(screen.getByText('Tgl Pengukuran Terakhir')).toBeInTheDocument()

    // 1. GD514530146 menjadi kode gardu
    expect(rows[0]).toHaveTextContent('GD514530146')

    // 2. HD0022 menjadi nama gardu
    expect(rows[0]).toHaveTextContent('HD0022')

    // 3. Penyulang menampilkan kode dan nama penyulang (JBG01 - Jombang 01)
    expect(rows[0]).toHaveTextContent('JBG01 - Jombang 01')
  })

  it('10. tombol Impor Pengukuran membuka drawer impor lengkap dengan tombol Unduh Template CSV', async () => {
    renderPage({
      'substations.view': true,
      'substations.reading': true,
      'substations.sync': true,
      'feeders.view': true,
    })

    const importBtn = await screen.findByRole('button', { name: /Impor Pengukuran/i })
    expect(importBtn).toBeInTheDocument()

    await userEvent.click(importBtn)

    expect(await screen.findByTestId('readings-import-drawer')).toBeInTheDocument()
    expect(screen.getByText('Format Berkas CSV Pengukuran Gardu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unduh Template CSV/i })).toBeInTheDocument()
  })

  it('9. waktu pengukuran tampil dengan jam; riwayat memuat kapasitas saat itu dan penanda manajemen trafo; jam manual dikirim sebagai measured_at', async () => {
    const base = analysisMock().data
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453', pickable: true }),
        transformers: [],
        readings: [{ measured_on: '2026-10-05', measured_at: '2026-10-05T08:15:30+07:00', capacity_kva: 100, source: 'SYNC', load_kva: 60, loading_pct: 60, current_r_a: 90, current_s_a: 80, current_t_a: 70 }],
      },
    })
    substationsApi.analysis.mockResolvedValue({
      data: {
        ...base,
        history: [
          { ...base.history[0], measured_on: '2026-09-01', measured_at: '2026-09-01T17:19:15+07:00', capacity_kva: 100, capacity_change: null },
          { ...base.history[1], measured_on: '2026-10-01', measured_at: '2026-10-01T09:05:00+07:00', capacity_kva: 200, capacity_change: { from: 100, to: 200 } },
        ],
      },
    })
    substationsApi.addReading.mockResolvedValue({ data: {} })
    renderPage({ 'substations.view': true, 'substations.reading': true })
    await userEvent.click((await screen.findAllByTestId('substation-measurement-row'))[0])
    const times = await screen.findAllByTestId('history-time')
    expect(times.map((t) => t.textContent)).toEqual(['2026-10-01 09:05', '2026-09-01 17:19'])             // newest first, with the time of day
    const caps = screen.getAllByTestId('history-capacity')
    expect(caps[0]).toHaveTextContent('200')
    expect(caps[0]).toHaveTextContent('dari 100')                                                           // transformer management marker
    expect(caps[1]).not.toHaveTextContent('dari')

    await userEvent.click(screen.getByRole('button', { name: /Riwayat Pembacaan/ }))
    expect((await screen.findAllByTestId('reading-time'))[0]).toHaveTextContent('2026-10-05 08:15')
    await userEvent.type(screen.getByLabelText('Jam pembacaan'), '14:30')
    await userEvent.type(screen.getByLabelText('Tegangan pangkal R-N (V)'), '228')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan pembacaan' }))
    await waitFor(() => expect(substationsApi.addReading).toHaveBeenCalled())
    const body = substationsApi.addReading.mock.calls[0][1]
    expect(body.measured_at).toMatch(/^\d{4}-\d{2}-\d{2} 14:30$/)
    expect(body.measured_on).toBeUndefined()
  })

})
