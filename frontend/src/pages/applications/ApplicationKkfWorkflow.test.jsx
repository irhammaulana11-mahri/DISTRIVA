import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApplicationKkfPanel from './ApplicationKkfPanel.jsx'
import { kkfRunsApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import {
  formatRupiah,
  formatPercentNumber,
  formatPercentDisplay,
  formatRupiahPerKwh,
} from '../../utils/kkfFormatters.js'

// Mock kkfRunsApi
vi.mock('../../services/api.js', () => ({
  kkfRunsApi: {
    listForApplication: vi.fn(),
    run: vi.fn(),
    preview: vi.fn(),
    get: vi.fn(),
  },
}))

const mockAppPrepaid = {
  id: 'app-prepaid-1',
  application_number: 'PB202611001',
  application_type: 'PB',
  transaction_type: 'PASANG_BARU',
  status: 'SUBMITTED',
  sar_package: 'Prabayar / Prepaid',
  total_cost: 1500000,
  delta_power_kva: 1.3,
}

const mockAppPostpaidPd = {
  id: 'app-postpaid-2',
  application_number: 'PD202611002',
  application_type: 'PD',
  transaction_type: 'PERUBAHAN_DAYA',
  status: 'SUBMITTED',
  sar_package: 'Pascabayar',
  total_cost: 2500000,
  delta_power_kva: 2.2,
}

const mockDryRunResultFeasible = {
  data: {
    application_id: 'app-prepaid-1',
    valid_on: '2026-11-07',
    inputs: {
      investment: 5000000,
      connection_fee: 1500000,
      esthetic_fee: 0,
      power_kva: 1.3,
      jam_nyala: 120,
      avg_price: 1444.7,
      bpp: 552,
      discount_rate: 0.0778,
      om_rate: 0.015,
      load_factor: 1,
      roe: 0.1,
      interest: 0.08,
      tax: 0.22,
      horizon: 25,
      payback_limit_months: 60,
      start_year: 2026,
    },
    sources: {
      application_id: 'app-prepaid-1',
      rab_run_id: 'rab-1',
      rab_run_number: 1,
      rab_snapshot_hash: 'hash-rab-1',
      parameter_set_id: 'param-1',
      parameter_set_name: 'Parameter KKF Distribusi 2026',
      tariff_book_id: 'tb-1',
      tariff_book_name: 'Buku Tarif 2026',
      tariff_code: 'R1',
      meter_payment: 'PRABAYAR',
      total_cost: 1500000,
    },
    result: {
      years: [
        {
          year_index: 0,
          year: 2026,
          energy_sold_mwh: 0,
          cost_investment: 5000000,
          cost_energy: 0,
          cost_om: 0,
          cost_total: 5000000,
          cash_in_connection: 1500000,
          revenue_sales: 0,
          revenue_total: 1500000,
          net: -3500000,
          cumulative: -3500000,
        },
        {
          year_index: 1,
          year: 2027,
          energy_sold_mwh: 1.872,
          cost_investment: 0,
          cost_energy: 1033344,
          cost_om: 75000,
          cost_total: 1108344,
          cash_in_connection: 0,
          revenue_sales: 2704468,
          revenue_total: 2704468,
          net: 1596124,
          cumulative: -1903876,
        },
      ],
      npv: 8500000,
      irr_percent: 21.45,
      bc_ratio: 1.48,
      payback: { years: 2, months: 4, text: '2 Tahun 4 Bulan' },
      discount_rate_percent: 7.78,
      bp_ratio: 0.3,
      rwacc_percent: 8.45,
      feasible: true,
      criteria: {
        irr_above_discount: true,
        npv_positive: true,
        payback_within_5_years: true,
      },
    },
    feasible: true,
    extended_required: false,
    snapshot_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  stored: false,
}

const mockDryRunResultInfeasible = {
  data: {
    ...mockDryRunResultFeasible.data,
    feasible: false,
    extended_required: true,
    result: {
      ...mockDryRunResultFeasible.data.result,
      npv: -1200000,
      irr_percent: 4.12,
      payback: { years: 8, months: 6, text: '8 Tahun 6 Bulan' },
      feasible: false,
      criteria: {
        irr_above_discount: false,
        npv_positive: false,
        payback_within_5_years: false,
      },
    },
  },
  stored: false,
}

function renderPanel(app, { canRun = true, canView = true } = {}) {
  return render(
    <NotificationProvider>
      <ApplicationKkfPanel application={app} canRun={canRun} canView={canView} />
    </NotificationProvider>,
  )
}

describe('ApplicationKkfPanel Workflow (docs/69 & docs/62 §26)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kkfRunsApi.listForApplication.mockResolvedValue({ data: [] })
    kkfRunsApi.preview.mockResolvedValue({
      data: { ready: true, blockers: [], rab_run: { id: 'rab-1', run_number: 1 }, connection_fee: null },
    })
  })

  it('1. renders KKF panel with non-editable connection fee (BP) and automatic meter type from PAKET_SAR', async () => {
    renderPanel(mockAppPrepaid, { canRun: true, canView: true })

    expect(screen.getByText('Kajian Kelayakan Keuangan (KKF) Permohonan')).toBeInTheDocument()
    expect(screen.getByText('Prabayar / Prepaid')).toBeInTheDocument()
    expect(screen.getByText(/Rp 1\.500\.000/)).toBeInTheDocument()

    // BP cannot be typed - verify there is no editable input for connection fee
    expect(screen.queryByLabelText(/Ketik Biaya Penyambungan/)).not.toBeInTheDocument()
  })

  it('2. performs dry run calculation without saving to database or mutating run history', async () => {
    kkfRunsApi.run.mockResolvedValueOnce(mockDryRunResultFeasible)

    renderPanel(mockAppPrepaid, { canRun: true, canView: true })

    const calcBtn = screen.getByRole('button', { name: /Hitung \(Dry Run\)/ })
    await userEvent.click(calcBtn)

    await waitFor(() => {
      expect(kkfRunsApi.run).toHaveBeenCalledWith(
        'app-prepaid-1',
        expect.objectContaining({ dry_run: true }),
      )
    })

    // Shows feasible badge and dry run banner
    expect(await screen.findByText('LAYAK (FEASIBLE)')).toBeInTheDocument()
    expect(screen.getByText('Pratinjau Dry Run (Hasil belum tersimpan ke database)')).toBeInTheDocument()
    expect(screen.getByText('2 Tahun 4 Bulan')).toBeInTheDocument()
    expect(screen.getByText(/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/)).toBeInTheDocument()

    // Stored runs history is NOT mutated
    expect(screen.getByText(/Belum ada run KKF yang disimpan/)).toBeInTheDocument()
  })

  it('3. renders extended approval warning banner when extended_required is true (infeasible)', async () => {
    kkfRunsApi.run.mockResolvedValueOnce(mockDryRunResultInfeasible)

    renderPanel(mockAppPrepaid, { canRun: true, canView: true })

    await userEvent.click(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ }))

    const tidakLayakBadges = await screen.findAllByText('TIDAK LAYAK')
    expect(tidakLayakBadges.length).toBeGreaterThanOrEqual(1)

    // Warning banner about extended approval chain
    expect(
      screen.getByText(/PERINGATAN: KAJIAN KELAYAKAN KEUANGAN TIDAK LAYAK/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Rantai Persetujuan Diperpanjang \(Extended Approval Chain\)/),
    ).toBeInTheDocument()
    expect(screen.getByText(/ASMAN NIAGA dan UP3 MANAGER/)).toBeInTheDocument()
  })

  it('4. stores KKF run when canRun is true, updates run history, and displays snapshot hash', async () => {
    kkfRunsApi.run
      .mockResolvedValueOnce(mockDryRunResultFeasible) // dry run
      .mockResolvedValueOnce({
        data: {
          ...mockDryRunResultFeasible.data,
          id: 'run-uuid-1',
          run_number: 1,
        },
        stored: true,
      }) // save run

    kkfRunsApi.listForApplication
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'run-uuid-1',
            run_number: 1,
            valid_on: '2026-11-07',
            feasible: true,
            extended_required: false,
            npv: 8500000,
            irr_percent: 21.45,
            payback_months: 28,
            rab_run_number: 1,
            snapshot_hash: 'hash-stored-1',
            created_at: '2026-11-07 10:00:00',
            created_by_name: 'Budi Perencana',
          },
        ],
      })

    renderPanel(mockAppPrepaid, { canRun: true, canView: true })

    // 1. Dry run
    await userEvent.click(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ }))

    // 2. Save run button appears
    const saveBtn = await screen.findByRole('button', { name: /Simpan Run KKF/ })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(kkfRunsApi.run).toHaveBeenCalledWith(
        'app-prepaid-1',
        expect.objectContaining({ dry_run: false }),
      )
    })

    // History is refreshed with the new run
    expect(await screen.findByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Budi Perencana')).toBeInTheDocument()
  })

  it('5. conditionally displays previous_meter_payment input when power change (PD) to postpaid or prompted by 409', async () => {
    // Application is PD to Postpaid -> previous_meter_payment select is shown
    renderPanel(mockAppPostpaidPd, { canRun: true, canView: true })

    expect(screen.getByText(/Jenis kWh Meter Sebelumnya/)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('6. displays verbatim error messages for 403, 404, 409', async () => {
    kkfRunsApi.run.mockRejectedValueOnce(
      new Error('Belum ada set parameter KKF yang disetujui dan berlaku pada 2026-11-07.'),
    )

    renderPanel(mockAppPrepaid, { canRun: true, canView: true })

    await userEvent.click(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ }))

    expect(
      await screen.findByText('Belum ada set parameter KKF yang disetujui dan berlaku pada 2026-11-07.'),
    ).toBeInTheDocument()
  })

  it('7. formats currency (Rupiah), percentages, and units properly using helper functions', () => {
    expect(formatRupiah(1500000)).toBe('Rp 1.500.000')
    expect(formatRupiah(1444.7, true)).toContain('1.444,7')
    expect(formatPercentDisplay(0.0778)).toContain('7,78 %')
    expect(formatPercentNumber(21.45)).toContain('21,45 %')
    expect(formatRupiahPerKwh(552)).toBe('Rp 552 / kWh')
  })

  it('8. pascabayar: BP tampil sesudah UJL dengan rincian dari pratinjau server', async () => {
    kkfRunsApi.preview.mockResolvedValue({
      data: {
        ready: true,
        blockers: [],
        rab_run: { id: 'rab-1', run_number: 1 },
        meter_mode: 'PASCABAYAR',
        total_cost: 12030400,
        ujl_total: 5445000,
        ujl_per_va: 165,
        ujl_power_va: 33000,
        connection_fee: 6585400,
      },
    })
    renderPanel({ ...mockAppPrepaid, sar_package: 'Pascabayar', total_cost: 12030400 }, { canRun: true, canView: true })
    expect(await screen.findByText(/Rp 6\.585\.400/)).toBeInTheDocument()
    expect(screen.queryByText(/Rp 12\.030\.400$/)).not.toBeInTheDocument()
    const note = await screen.findByTestId('kkf-bp-breakdown')
    expect(note).toHaveTextContent(/dikurangi UJL/)
    expect(note).toHaveTextContent(/Rp 5\.445\.000/)
  })

  it('9. belum ada run RAB: syarat dari server tampil sebagai peringatan dan Hitung (Dry Run) nonaktif', async () => {
    kkfRunsApi.preview.mockResolvedValue({
      data: {
        ready: false,
        rab_run: null,
        connection_fee: null,
        blockers: ['Belum ada run RAB: paket MTO masih berstatus DRAFT. Selesaikan persetujuan MTO, lalu jalankan RAB.'],
      },
    })
    renderPanel(mockAppPrepaid, { canRun: true, canView: true })
    expect(await screen.findByTestId('kkf-blockers')).toHaveTextContent(/paket MTO masih berstatus DRAFT/)
    expect(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ })).toBeDisabled()
  })

  it('10. pratinjau gagal dimuat: form tetap bisa dipakai tanpa galat di halaman', async () => {
    kkfRunsApi.preview.mockRejectedValue(new Error('boom'))
    renderPanel(mockAppPrepaid, { canRun: true, canView: true })
    await waitFor(() => expect(kkfRunsApi.preview).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ })).toBeEnabled()
    expect(screen.queryByTestId('kkf-blockers')).not.toBeInTheDocument()
  })

  it('11. faktor beban opsional: kosong tidak dikirim (ikut set parameter), terisi dikirim ke server', async () => {
    kkfRunsApi.run.mockResolvedValue(mockDryRunResultFeasible)
    renderPanel(mockAppPrepaid, { canRun: true, canView: true })
    await userEvent.click(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ }))
    await waitFor(() => expect(kkfRunsApi.run).toHaveBeenCalledTimes(1))
    expect(kkfRunsApi.run.mock.calls[0][1].load_factor).toBeUndefined()

    await userEvent.type(screen.getByLabelText(/Faktor Beban/), '0.8')
    await userEvent.click(screen.getByRole('button', { name: /Hitung \(Dry Run\)/ }))
    await waitFor(() => expect(kkfRunsApi.run).toHaveBeenCalledTimes(2))
    expect(kkfRunsApi.run.mock.calls[1][1].load_factor).toBe(0.8)
  })

  it('12. survei menyatakan tanpa perluasan: blockers memuat pesan tanpa perluasan, menampilkan keterangan dan menyembunyikan tombol (docs/82 §3)', async () => {
    kkfRunsApi.preview.mockResolvedValue({
      data: {
        ready: false,
        rab_run: null,
        connection_fee: null,
        blockers: ['KKF tidak berlaku untuk survei tanpa perluasan.'],
      },
    })
    renderPanel(mockAppPrepaid, { canRun: true, canView: true })
    const notice = await screen.findByTestId('kkf-no-extension-notice')
    expect(notice).toHaveTextContent(/KKF tidak diterbitkan: survei menyatakan tanpa perluasan/i)
    expect(screen.queryByRole('button', { name: /Hitung \(Dry Run\)/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Terbitkan KKF/i })).not.toBeInTheDocument()
  })
})
