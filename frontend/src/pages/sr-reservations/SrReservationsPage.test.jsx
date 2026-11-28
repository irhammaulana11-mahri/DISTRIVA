import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import { srReservationsApi, srVendorContractsApi, vendorsApi, unitScopeApi } from '../../services/api.js'
import SrReservationsPage from './SrReservationsPage.jsx'
import ApplicationSrReservationPanel from './ApplicationSrReservationPanel.jsx'

vi.mock('../../services/api.js', () => ({
  srReservationsApi: {
    pending: vi.fn(),
    list: vi.fn(),
    forApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    removeApplication: vi.fn(),
    requestMims: vi.fn(),
    saveRealization: vi.fn(),
    match: vi.fn(),
    sendSap: vi.fn(),
    cancel: vi.fn(),
    reportExtension: vi.fn(),
    cancelExtension: vi.fn(),
  },
  srVendorContractsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  vendorsApi: {
    list: vi.fn(),
  },
  unitScopeApi: {
    get: vi.fn(),
  },
}))

const ALL_CAN = {
  'sr_reservations.view': true,
  'sr_reservations.prepare_ulp': true,
  'sr_reservations.prepare_up3': true,
  'sr_vendor_contracts.manage': true,
  'sr_reservations.report_extension': true,
}

function wrap(ui, can = ALL_CAN, isSysAdmin = false) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u-1', name: 'Petugas Niaga' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('SrReservationsPage (docs/95 #79 kolektif)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: '51MJK', name: 'UP3 Mojokerto', unit_type: 'UP3' }],
      ulp_units: [{ id: 'ulp-1', code: '51453', name: 'ULP Jombang', unit_type: 'ULP', parent_id: 'up3-1' }],
    })
    srReservationsApi.pending.mockResolvedValue({
      data: [
        {
          application_id: 'app-1',
          application_number: 'PB-2026-001',
          application_type: 'PB',
          status: 'PAID',
          customer_name: 'Budi Santoso',
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          power_va: 2200,
          phase: 1,
          default_vendor: { id: 'v-1', name: 'PT Pelaksana 1Ph' },
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 25 },
    })
    srReservationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'res-1',
          status: 'DRAFT',
          phase: 1,
          source_level: 'ULP',
          applications_count: 2,
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: null,
          sap_reference: null,
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 25 },
    })
    srReservationsApi.forApplication.mockResolvedValue({
      data: {
        power_va: 2200,
        phase: 1,
        blockers: [],
        default_sr_length_m: 35,
        survey_sr_length_m: null,
        contract: { id: 'c-1', contract_number: 'KTR-001', vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph' } },
        warehouses: [{ id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', level: 'ULP' }],
        reservations: [],
      },
    })
    srReservationsApi.get.mockResolvedValue({
      data: {
        id: 'res-1',
        status: 'DRAFT',
        phase: 1,
        source_level: 'ULP',
        applications_count: 1,
        unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
        warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
        vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
        sr_length_m: 35,
        mims_reservation_no: null,
        sap_reference: null,
        lines: [
          {
            khs_code: 'SR-01',
            khs_name: 'Kabel SR 2x10 mm2',
            unit_text: 'm',
            material_numbers: ['3110025'],
            quantity_bom: 35,
            quantity: 35,
            correction_reason: null,
            realised: 0,
          },
        ],
        applications: [
          {
            application_id: 'app-1',
            application_number: 'PB-2026-001',
            agenda_number: 'AG-001',
            customer_name: 'Budi Santoso',
            power_va: 2200,
            needs: [{ khs_code: 'KWH-1PH', quantity: 1 }],
            cable_m: 35,
            seals: [],
            serials: [],
          },
        ],
        serial_codes: { kwh: ['KWH-1PH'], mcb: [] },
        cable_codes: ['SR-01'],
        seal_codes: [],
        sap_blockers: [],
        events: [{ type: 'CREATED', actor: 'Petugas Niaga', reason: null, occurred_at: '2026-11-28T08:00:00Z' }],
      },
    })
    srVendorContractsApi.list.mockResolvedValue({
      data: [
        {
          id: 'c-1',
          contract_number: 'KTR-001',
          valid_from: '2026-01-01',
          valid_until: '2026-12-31',
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', status: 'ACTIVE' },
        },
      ],
    })
    vendorsApi.list.mockResolvedValue({ data: [{ id: 'v-2', code: 'V02', name: 'PT Jaringan 3Ph', scope: 'JARINGAN' }] })
  })

  it('membuat reservasi dari satu atau banyak agenda melalui POST /sr-reservations', async () => {
    srReservationsApi.pending.mockResolvedValue({
      data: [
        {
          application_id: 'app-1',
          application_number: 'PB-2026-001',
          application_type: 'PB',
          status: 'PAID',
          customer_name: 'Budi Santoso',
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          power_va: 2200,
          phase: 1,
          default_vendor: { id: 'v-1', name: 'PT Pelaksana 1Ph' },
        },
        {
          application_id: 'app-2',
          application_number: 'PB-2026-002',
          application_type: 'PB',
          status: 'PAID',
          customer_name: 'Siti Aminah',
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          power_va: 1300,
          phase: 1,
          default_vendor: { id: 'v-1', name: 'PT Pelaksana 1Ph' },
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 2, per_page: 25 },
    })
    srReservationsApi.create.mockResolvedValue({ data: { id: 'res-1' } })

    wrap(<SrReservationsPage />)

    expect(await screen.findByText('Budi Santoso')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Pilih PB-2026-001'))
    await userEvent.click(screen.getByLabelText('Pilih PB-2026-002'))

    await userEvent.click(screen.getByRole('button', { name: /Buat Reservasi Kolektif \(2\)/i }))
    expect(await screen.findByText(/Daftar No\. Agenda Terpilih \(2\)/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Buat Reservasi \(2 Agenda\)/i }))

    await waitFor(() => {
      expect(srReservationsApi.create).toHaveBeenCalledWith(expect.objectContaining({
        application_ids: ['app-1', 'app-2'],
        warehouse_id: 'wh-1',
        sr_length_m: 35,
      }))
    })
  })

  it('dapat mencatat nomor permohonan MIMS dan mengoreksi total material beralasan', async () => {
    srReservationsApi.update.mockResolvedValue({ data: { id: 'res-1' } })
    srReservationsApi.requestMims.mockResolvedValue({ data: { id: 'res-1' } })

    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Reservasi/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))

    expect(await screen.findByText(/Plant: 5118/i)).toBeInTheDocument()
    expect(screen.getByText(/SLoc: 2810/i)).toBeInTheDocument()
    expect(screen.getByText('3110025')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Jumlah SR-01'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Alasan koreksi SR-01'), { target: { value: 'Cadangan lapangan' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan Total/i }))

    await waitFor(() => {
      expect(srReservationsApi.update).toHaveBeenCalledWith('res-1', expect.objectContaining({
        corrections: [{ khs_code: 'SR-01', quantity: 40, reason: 'Cadangan lapangan' }],
      }))
    })

    fireEvent.change(screen.getByLabelText(/Nomor permohonan MIMS/i), { target: { value: 'RSV-2026-889' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan No\. Permohonan MIMS/i }))

    await waitFor(() => {
      expect(srReservationsApi.requestMims).toHaveBeenCalledWith('res-1', { reservation_no: 'RSV-2026-889' })
    })
  })

  it('mendukung realisasi per agenda, penghalang SAP, Samakan total, dan Kirim SAP pada status REQUESTED', async () => {
    srReservationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'res-1',
          status: 'REQUESTED',
          phase: 1,
          source_level: 'ULP',
          applications_count: 1,
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: 'RSV-2026-889',
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 25 },
    })
    srReservationsApi.get
      .mockResolvedValueOnce({
        data: {
          id: 'res-1',
          status: 'REQUESTED',
          phase: 1,
          source_level: 'ULP',
          applications_count: 1,
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: 'RSV-2026-889',
          lines: [
            { khs_code: 'SR-01', khs_name: 'Kabel SR 2x10 mm2', unit_text: 'm', material_numbers: ['3110025'], quantity_bom: 35, quantity: 35, realised: 35 },
          ],
          applications: [
            {
              application_id: 'app-1',
              application_number: 'PB-2026-001',
              agenda_number: 'AG-001',
              customer_name: 'Budi Santoso',
              power_va: 2200,
              needs: [{ khs_code: 'KWH-1PH', quantity: 1 }],
              cable_m: 35,
              seals: [],
              serials: [],
            },
          ],
          serial_codes: { kwh: ['KWH-1PH'], mcb: [] },
          sap_blockers: ['Total kabel berbeda dengan realisasi'],
          events: [],
        },
      })
      .mockResolvedValue({
        data: {
          id: 'res-1',
          status: 'REQUESTED',
          phase: 1,
          source_level: 'ULP',
          applications_count: 1,
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: 'RSV-2026-889',
          lines: [
            { khs_code: 'SR-01', khs_name: 'Kabel SR 2x10 mm2', unit_text: 'm', material_numbers: ['3110025'], quantity_bom: 35, quantity: 42, realised: 42 },
          ],
          applications: [
            {
              application_id: 'app-1',
              application_number: 'PB-2026-001',
              agenda_number: 'AG-001',
              customer_name: 'Budi Santoso',
              power_va: 2200,
              needs: [{ khs_code: 'KWH-1PH', quantity: 1 }],
              cable_m: 42,
              seals: ['SGL-01', 'SGL-02'],
              serials: [{ khs_code: 'KWH-1PH', serial_number: 'SN-KWH-001' }],
            },
          ],
          serial_codes: { kwh: ['KWH-1PH'], mcb: [] },
          sap_blockers: [],
          events: [],
        },
      })
    srReservationsApi.saveRealization.mockResolvedValue({ data: { ok: true } })
    srReservationsApi.match.mockResolvedValue({ data: { ok: true } })
    srReservationsApi.sendSap.mockResolvedValue({ data: { ok: true } })

    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Reservasi/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))

    expect(await screen.findByText(/Total kabel berbeda dengan realisasi/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Kirim SAP$/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('SN KWH-1PH AG-001'), { target: { value: 'SN-KWH-001' } })
    fireEvent.change(screen.getByLabelText('Panjang kabel AG-001'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Nomor segel AG-001'), { target: { value: 'SGL-01, SGL-02' } })

    await userEvent.click(screen.getByRole('button', { name: /Simpan Realisasi/i }))
    await waitFor(() => {
      expect(srReservationsApi.saveRealization).toHaveBeenCalledWith('res-1', {
        items: [
          {
            application_id: 'app-1',
            cable_m: 42,
            seals: ['SGL-01', 'SGL-02'],
            serials: [{ khs_code: 'KWH-1PH', serial_number: 'SN-KWH-001' }],
          },
        ],
      })
    })

    await userEvent.click(screen.getByRole('button', { name: /Samakan total/i }))
    await waitFor(() => {
      expect(srReservationsApi.match).toHaveBeenCalledWith('res-1')
    })

    fireEvent.change(screen.getByLabelText(/Referensi SAP/i), { target: { value: 'SAP-2026-01' } })
    await userEvent.click(screen.getByRole('button', { name: /^Kirim SAP$/i }))
    await screen.findByText('Kirim Reservasi ke SAP?')
    const confirmBtns = screen.getAllByRole('button', { name: /^Kirim SAP$/i })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => {
      expect(srReservationsApi.sendSap).toHaveBeenCalledWith('res-1', { sap_reference: 'SAP-2026-01' })
    })
  })

  it('dapat mengeluarkan agenda dari reservasi dengan alasan wajib', async () => {
    srReservationsApi.removeApplication.mockResolvedValue({ data: { ok: true } })

    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Reservasi/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))

    await userEvent.click(await screen.findByRole('button', { name: /Keluarkan/i }))
    expect(await screen.findByText(/Keluarkan Agenda AG-001/i)).toBeInTheDocument()
    const reasonInputs = screen.getAllByLabelText(/Alasan/i)
    fireEvent.change(reasonInputs[reasonInputs.length - 1], { target: { value: 'Pelanggan menunda pemasangan' } })
    await userEvent.click(screen.getByRole('button', { name: /Keluarkan Agenda/i }))

    await waitFor(() => {
      expect(srReservationsApi.removeApplication).toHaveBeenCalledWith('res-1', 'app-1', {
        reason: 'Pelanggan menunda pemasangan',
      })
    })
  })

  it('menandai baris already_reserved dan mendukung filter phase serta reserved', async () => {
    srReservationsApi.pending.mockResolvedValue({
      data: [
        {
          application_id: 'app-res',
          application_number: 'PB-2026-099',
          application_type: 'PB',
          status: 'PAID',
          customer_name: 'Pelanggan Sudah MIMS',
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          power_va: 2200,
          phase: 1,
          already_reserved: true,
          mims_reservation_numbers: ['514532611196444'],
          default_vendor: { id: 'v-1', name: 'PT Pelaksana 1Ph' },
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 25 },
    })

    wrap(<SrReservationsPage />)

    expect(await screen.findByText('Sudah direservasi')).toBeInTheDocument()
    expect(screen.getByText(/No\. MIMS: 514532611196444/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Pilih PB-2026-099')).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Filter fasa'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Filter status reservasi MIMS'), '0')
    await waitFor(() => {
      expect(srReservationsApi.pending).toHaveBeenCalledWith(expect.objectContaining({ phase: '1', reserved: '0' }))
    })
  })

  it('menampilkan tab Kontrak Pelaksana 1 Phasa per ULP dan mendukung laporan perlu perluasan pada ApplicationSrReservationPanel', async () => {
    srReservationsApi.reportExtension.mockResolvedValue({ data: { ok: true } })

    const { unmount } = wrap(<SrReservationsPage />)
    await userEvent.click(screen.getByRole('tab', { name: /Kontrak Pelaksana 1 Phasa/i }))
    expect(await screen.findByText('KTR-001')).toBeInTheDocument()
    expect(screen.getByText(/51453 - ULP Jombang/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tambah Kontrak 1 Phasa/i })).toBeInTheDocument()
    unmount()

    wrap(<ApplicationSrReservationPanel applicationId="app-1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Perlu Perluasan/i }))
    fireEvent.change(screen.getByLabelText(/Alasan \/ Kondisi Lapangan/i), { target: { value: 'Jarak tiang 95 m' } })
    fireEvent.change(screen.getByLabelText(/Perkiraan Jarak/i), { target: { value: '95' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Temuan/i }))

    await waitFor(() => {
      expect(srReservationsApi.reportExtension).toHaveBeenCalledWith('app-1', { reason: 'Jarak tiang 95 m', distance_m: 95 })
    })
  })
})
