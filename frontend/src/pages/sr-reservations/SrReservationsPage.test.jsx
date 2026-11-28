import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import { srReservationsApi, srVendorContractsApi, vendorsApi, unitScopeApi } from '../../services/api.js'
import SrReservationsPage from './SrReservationsPage.jsx'

vi.mock('../../services/api.js', () => ({
  srReservationsApi: {
    pending: vi.fn(),
    list: vi.fn(),
    forApplication: vi.fn(),
    create: vi.fn(),
    createBatch: vi.fn(),
    batchActions: vi.fn(),
    reportExtension: vi.fn(),
    cancelExtension: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    recordMims: vi.fn(),
    saveSerials: vi.fn(),
    sendSap: vi.fn(),
    cancel: vi.fn(),
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
  'sr_reservations.approve_ulp': true,
  'sr_reservations.prepare_up3': true,
  'sr_reservations.approve_up3': true,
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

describe('SrReservationsPage (docs/95)', () => {
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
          version_number: 1,
          status: 'APPROVED',
          phase: 1,
          power_va: 2200,
          source_level: 'ULP',
          application: { id: 'app-1', number: 'PB-2026-001', agenda_number: 'AG-001', customer_name: 'Budi Santoso' },
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: null,
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
        survey_sr_length_m: 28,
        contract: { id: 'c-1', contract_number: 'KTR-001', vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph' } },
        warehouses: [{ id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', level: 'ULP' }],
        reservations: [],
      },
    })
    srReservationsApi.get.mockResolvedValue({
      data: {
        id: 'res-1',
        version_number: 1,
        status: 'APPROVED',
        phase: 1,
        power_va: 2200,
        source_level: 'ULP',
        bom_group: 'SR1PH',
        application: { id: 'app-1', number: 'PB-2026-001', agenda_number: 'AG-001', customer_name: 'Budi Santoso' },
        unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
        warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
        vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
        sr_length_m: 35,
        mims_reservation_no: null,
        lines: [
          {
            khs_code: 'SR-01',
            khs_name: 'Kabel SR 2x10 mm2',
            unit_text: 'm',
            material_numbers: ['3110025'],
            quantity_bom: 35,
            quantity: 35,
            correction_reason: null,
          },
        ],
        events: [{ type: 'APPROVED', actor: 'Petugas Niaga', reason: null, occurred_at: '2026-11-28T08:00:00Z' }],
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

  it('menampilkan daftar menunggu reservasi dan membuka form rencana 1 phasa terkunci dengan pembanding panjang survei', async () => {
    wrap(<SrReservationsPage />)

    expect(await screen.findByText('Budi Santoso')).toBeInTheDocument()
    expect(screen.getByText('PT Pelaksana 1Ph')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Buat Rencana/i }))

    expect(await screen.findByText(/PT Pelaksana 1Ph \(KTR-001\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Pembanding hasil survei: 28 m/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Panjang Kabel SR/i)).toHaveValue(35)

    srReservationsApi.create.mockResolvedValue({ data: { id: 'res-1' } })
    await userEvent.click(screen.getByRole('button', { name: /Buat Rencana Reservasi/i }))

    await waitFor(() => {
      expect(srReservationsApi.create).toHaveBeenCalledWith('app-1', expect.objectContaining({
        warehouse_id: 'wh-1',
        sr_length_m: 35,
      }))
    })
  })

  it('menampilkan daftar rencana, rincian Plant/SLoc/ERP material, dan dapat mencatat nomor reservasi MIMS', async () => {
    srReservationsApi.recordMims.mockResolvedValue({ data: { id: 'res-1' } })
    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Rencana Reservasi/i }))
    expect(await screen.findByText('Budi Santoso')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Rincian/i }))
    expect(await screen.findByText(/Plant: 5118/i)).toBeInTheDocument()
    expect(screen.getByText(/SLoc: 2810/i)).toBeInTheDocument()
    expect(screen.getByText('3110025')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Nomor reservasi MIMS/i), { target: { value: 'RSV-2026-889' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Nomor MIMS/i }))

    await waitFor(() => {
      expect(srReservationsApi.recordMims).toHaveBeenCalledWith('res-1', { reservation_no: 'RSV-2026-889' })
    })
  })

  it('menampilkan tab Kontrak Pelaksana 1 Phasa per ULP dan tombol tambah kontrak bagi pengelola', async () => {
    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Kontrak Pelaksana 1 Phasa/i }))
    expect(await screen.findByText('KTR-001')).toBeInTheDocument()
    expect(screen.getByText(/51453 - ULP Jombang/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tambah Kontrak 1 Phasa/i })).toBeInTheDocument()
  })

  it('mendukung pemilihan kolektif beberapa agenda dan membuat reservasi kolektif', async () => {
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
    srReservationsApi.createBatch.mockResolvedValue({ data: { id: 'res-batch-1' } })

    wrap(<SrReservationsPage />)

    expect(await screen.findByText('Budi Santoso')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Pilih PB-2026-001'))
    await userEvent.click(screen.getByLabelText('Pilih PB-2026-002'))

    await userEvent.click(screen.getByRole('button', { name: /Buat Reservasi Kolektif \(2\)/i }))
    expect(await screen.findByText(/Daftar No\. Agenda Terpilih \(2\)/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Buat Reservasi Kolektif \(2 Agenda\)/i }))

    await waitFor(() => {
      expect(srReservationsApi.createBatch).toHaveBeenCalledWith(expect.objectContaining({
        application_ids: ['app-1', 'app-2'],
        warehouse_id: 'wh-1',
        sr_length_m: 35,
      }))
    })
  })

  it('dapat mengisi Serial Number, panjang kabel, dan segel per agenda lalu Kirim SAP pada status RECORDED', async () => {
    srReservationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'res-1',
          version_number: 1,
          status: 'RECORDED',
          phase: 1,
          power_va: 2200,
          source_level: 'ULP',
          applications_count: 1,
          application: { id: 'app-1', number: 'PB-2026-001', agenda_number: 'AG-001', customer_name: 'Budi Santoso' },
          unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
          warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
          vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
          sr_length_m: 35,
          mims_reservation_no: 'RSV-2026-889',
        },
      ],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 25 },
    })
    srReservationsApi.get.mockResolvedValue({
      data: {
        id: 'res-1',
        version_number: 1,
        status: 'RECORDED',
        phase: 1,
        power_va: 2200,
        source_level: 'ULP',
        bom_group: 'SR1PH',
        application: { id: 'app-1', number: 'PB-2026-001', agenda_number: 'AG-001', customer_name: 'Budi Santoso' },
        agendas: [
          { application_id: 'app-1', number: 'PB-2026-001', agenda_number: 'AG-001', customer_name: 'Budi Santoso', sr_length_m: 35, seal_no: '', serials: {} },
        ],
        unit: { id: 'ulp-1', code: '51453', name: 'ULP Jombang' },
        warehouse: { id: 'wh-1', code: 'GD-51453', name: 'Gudang ULP Jombang', plant: '5118', stor_loc: '2810' },
        vendor: { id: 'v-1', code: 'V01', name: 'PT Pelaksana 1Ph', contract_number: 'KTR-001' },
        sr_length_m: 35,
        mims_reservation_no: 'RSV-2026-889',
        lines: [
          { khs_code: 'SR-01', khs_name: 'Kabel SR 2x10 mm2', unit_text: 'm', material_numbers: ['3110025'], quantity_bom: 35, quantity: 35, correction_reason: null },
        ],
        events: [],
      },
    })
    srReservationsApi.saveSerials.mockResolvedValue({ data: { ok: true } })
    srReservationsApi.sendSap.mockResolvedValue({ data: { ok: true } })

    wrap(<SrReservationsPage />)

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Rencana Reservasi/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))

    expect(await screen.findByText(/Serial Number, Panjang Kabel SR & Segel per No\. Agenda/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('SN 3110025 PB-2026-001'), { target: { value: 'SN-MTR-9988' } })
    fireEvent.change(screen.getByLabelText('Panjang kabel PB-2026-001'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Nomor segel PB-2026-001'), { target: { value: 'SGL-12345' } })

    await userEvent.click(screen.getByRole('button', { name: /Simpan SN, Kabel & Segel/i }))
    await waitFor(() => {
      expect(srReservationsApi.saveSerials).toHaveBeenCalledWith('res-1', {
        items: [
          {
            application_id: 'app-1',
            sr_length_m: 42,
            seal_no: 'SGL-12345',
            serials: { 3110025: 'SN-MTR-9988' },
          },
        ],
      })
    })

    await userEvent.click(screen.getByRole('button', { name: /^Kirim SAP$/i }))
    await screen.findByText('Kirim Reservasi ke SAP?')
    const confirmBtns = screen.getAllByRole('button', { name: /^Kirim SAP$/i })
    await userEvent.click(confirmBtns[confirmBtns.length - 1])

    await waitFor(() => {
      expect(srReservationsApi.sendSap).toHaveBeenCalledWith('res-1')
    })
  })

  it('menandai baris already_reserved dan menonaktifkan pilihannya, serta mendukung filter phase/reserved dan aksi massal daftar rencana (#76)', async () => {
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
    srReservationsApi.batchActions.mockResolvedValue({
      data: [{ id: 'res-1', ok: true }],
      summary: { succeeded: 1, failed: 0 },
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

    await userEvent.click(screen.getByRole('tab', { name: /Daftar Rencana Reservasi/i }))
    await userEvent.click(await screen.findByLabelText('Pilih rencana PB-2026-001'))
    await userEvent.click(screen.getByRole('button', { name: /Setujui Sekaligus/i }))

    await waitFor(() => {
      expect(srReservationsApi.batchActions).toHaveBeenCalledWith({ ids: ['res-1'], action: 'approve' })
    })
    expect(await screen.findByText(/Hasil aksi massal: 1 berhasil, 0 gagal/i)).toBeInTheDocument()
  })

  it('mendukung catat temuan Perlu Perluasan dan Batalkan Tanda Perluasan untuk Teknik ULP (#76 & #77)', async () => {
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
    srReservationsApi.reportExtension.mockResolvedValue({ data: { ok: true } })

    wrap(<SrReservationsPage />)
    await userEvent.click(await screen.findByRole('button', { name: /Buat Rencana/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Perlu Perluasan/i }))

    fireEvent.change(screen.getByLabelText(/Alasan \/ Kondisi Lapangan/i), { target: { value: 'Jarak tiang 95 m' } })
    fireEvent.change(screen.getByLabelText(/Perkiraan Jarak/i), { target: { value: '95' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Temuan/i }))

    await waitFor(() => {
      expect(srReservationsApi.reportExtension).toHaveBeenCalledWith('app-1', { reason: 'Jarak tiang 95 m', distance_m: 95 })
    })
  })
})
