import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mtoApi, masterDataApi, drawingApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import MtoPackageDetailView from './MtoPackageDetailView.jsx'
import DrawingDetailView from '../drawings/DrawingDetailView.jsx'

vi.mock('../../services/api.js', () => ({
  mtoApi: {
    access: vi.fn(),
    forVersion: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    updateItems: vi.fn(),
    extract: vi.fn(),
    calculate: vi.fn(),
    verify: vi.fn(),
    decide: vi.fn(),
  },
  masterDataApi: {
    constructionTypes: vi.fn(),
  },
  drawingApi: {
    get: vi.fn(),
    decide: vi.fn(),
    authors: vi.fn(),
    reassign: vi.fn(),
    revise: vi.fn(),
    updateDraft: vi.fn(),
    uploadDocument: vi.fn(),
    submit: vi.fn(),
    escalate: vi.fn(),
  },
  documentApi: {
    downloadBlob: vi.fn(),
    remove: vi.fn(),
  },
  applicationApi: {
    get: vi.fn().mockResolvedValue({ data: null }),
  },
}))

describe('MTO Workflow (Stage 4A & 4B - docs/63 §F)', () => {
  const sampleMto = {
    id: 'mto-pkg-1',
    package_number: 'MTO-202611-0001',
    status: 'DRAFT',
    valid_on: null,
    snapshot_hash: null,
    params: { 'COMMISSIONING:SUTM': 5 },
    declared_params: [
      { name: 'COMMISSIONING:SUTM', description: 'Volume commissioning SUTM (kms)', default: 0, group: 'SUTM' },
    ],
    drawing_version: {
      id: 'dv-1',
      drawing_id: 'drw-1',
      version_number: 1,
      status: 'DRAFT',
      stage: 'ULP_MANAGER',
    },
    application: { id: 'app-1', application_number: 'APP-202611-0001' },
    created_by: { id: 'u-teknik-1', name: 'Teknik Surveyor', email: 'teknik@pln.co.id' },
    verified_by: null,
    verified_at: null,
    approved_by: null,
    approved_at: null,
    items: [
      {
        construction_type_id: 'ct-1',
        group: 'SUTM',
        construction_code: 'TM-1',
        construction_label: 'Tiang Penyangga SUTM 1 Phasa',
        psg: 4,
        bkr: 0,
        note: 'Tiang utama persil',
        source: 'EXTRACTED',
        detected_psg: 5,
        detected_bkr: 0,
      },
    ],
    events: [
      { event_type: 'CREATED', reason: null, actor_name: 'Teknik Surveyor', actor_email: 'teknik@pln.co.id', occurred_at: '2026-11-06T10:00:00Z' },
    ],
    can: {
      edit: true,
      verify: true,
      decide: false,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mtoApi.get.mockResolvedValue({ data: sampleMto })
    mtoApi.forVersion.mockResolvedValue({ data: sampleMto })
    masterDataApi.constructionTypes.mockResolvedValue({
      data: [
        { id: 'ct-2', code: 'TM-2', group_code: 'SUTM', active_version: { name: 'Tiang Sudut SUTM' } },
        { id: 'ct-3', code: 'TR-1', group_code: 'SUTR', active_version: { name: 'Tiang Penyangga SUTR' } },
      ],
    })
  })

  it('1. renders MTO package details, construction items table, and detected difference badge', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/Paket MTO #MTO-202611-0001/i)).toBeInTheDocument()
    expect(screen.getByText('Uraian Konstruksi')).toBeInTheDocument()
    expect(screen.getByText('Tiang Penyangga SUTM 1 Phasa')).toBeInTheDocument()
    expect(screen.queryByText('TM-1')).not.toBeInTheDocument()
    expect(screen.getByText('Dari berkas')).toBeInTheDocument()
    expect(screen.getByText('Terbaca: 5')).toBeInTheDocument() // detected_psg difference
    expect(screen.getByText('COMMISSIONING:SUTM (SUTM)')).toBeInTheDocument()
  })

  it('2. adds new construction type from master data and requires reason when saving items', async () => {
    mtoApi.updateItems.mockResolvedValue({
      data: {
        ...sampleMto,
        items: [
          ...sampleMto.items,
          {
            construction_type_id: 'ct-2',
            group: 'SUTM',
            construction_code: 'TM-2',
            construction_label: 'Tiang Sudut SUTM',
            psg: 2,
            bkr: 0,
            note: '',
            source: 'MANUAL',
            detected_psg: null,
            detected_bkr: null,
          },
        ],
      },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    await screen.findByText(/Paket MTO #MTO-202611-0001/i)

    // Open add construction type modal
    const addBtn = screen.getByRole('button', { name: /Tambah Jenis Konstruksi/i })
    await userEvent.click(addBtn)

    expect(await screen.findByText('Tiang Sudut SUTM')).toBeInTheDocument()
    expect(screen.queryByText('TM-2')).not.toBeInTheDocument()
    const tambahButtons = screen.getAllByRole('button', { name: '+ Tambah' })
    await userEvent.click(tambahButtons[0]) // Adds Tiang Sudut SUTM

    // Now Tiang Sudut SUTM is in the table (uraian konstruksi)
    expect(screen.getByText('Tiang Sudut SUTM')).toBeInTheDocument()

    // Try saving without reason -> validation error
    const saveBtn = screen.getByRole('button', { name: 'Simpan Draf MTO' })
    await userEvent.click(saveBtn)
    expect(screen.getByText(/Alasan perubahan wajib diisi/i)).toBeInTheDocument()

    // Fill reason and save successfully
    const reasonInput = screen.getByPlaceholderText(/Wajib diisi: contoh revisi tiang/i)
    await userEvent.type(reasonInput, 'Penambahan tiang sudut TM-2 sesuai survei lapangan.')

    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(mtoApi.updateItems).toHaveBeenCalledWith(
        'mto-pkg-1',
        expect.objectContaining({
          reason: 'Penambahan tiang sudut TM-2 sesuai survei lapangan.',
          items: expect.arrayContaining([
            expect.objectContaining({ construction_code: 'TM-1' }),
            expect.objectContaining({ construction_code: 'TM-2' }),
          ]),
        })
      )
    })
  })

  it('3. runs automated Excel extraction and displays matched/unmatched report', async () => {
    mtoApi.extract.mockResolvedValue({
      data: sampleMto,
      extraction: {
        matched: [{ group: 'SUTM', label: 'Tiang Penyangga', construction_code: 'TM-1', psg: 4, bkr: 0 }],
        unmatched: [{ group: 'SUTM', label: 'Tiang Khusus Non-Standar', cell_psg: 'D12', reason: 'UNKNOWN_CONSTRUCTION' }],
        warnings: [{ cell: 'E15', code: 'OUT_OF_RANGE', message: 'Jumlah bongkar melebihi batas wajar.' }],
        file: { name: 'Gambar_Teknik_v1.xlsx', sha256: 'abcdef1234567890' },
      },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    await screen.findByText(/Paket MTO #MTO-202611-0001/i)

    const extractBtn = screen.getByRole('button', { name: /Isi dari Berkas Gambar/i })
    await userEvent.click(extractBtn)

    expect(await screen.findByText(/Ekstraksi Jumlah dari Berkas Gambar/i)).toBeInTheDocument()

    // Provide reason if needed and trigger extraction
    const reasonInput = screen.getByPlaceholderText(/Contoh: Ekstraksi ulang/i)
    await userEvent.type(reasonInput, 'Ekstraksi otomatis lembar GAMBAR Excel.')

    const startExtractBtn = screen.getByRole('button', { name: 'Mulai Ekstraksi' })
    await userEvent.click(startExtractBtn)

    await waitFor(() => {
      expect(mtoApi.extract).toHaveBeenCalledWith('mto-pkg-1', {
        reason: 'Ekstraksi otomatis lembar GAMBAR Excel.',
      })
    })

    expect(await screen.findByText(/1 item jenis konstruksi berhasil dicocokkan/i)).toBeInTheDocument()
    expect(screen.getByText(/Tiang Khusus Non-Standar/i)).toBeInTheDocument()
    expect(screen.getByText('UNKNOWN_CONSTRUCTION')).toBeInTheDocument()
    expect(screen.getByText(/Jumlah bongkar melebihi batas wajar/i)).toBeInTheDocument()
  })

  it('4. previews KHS material requirements calculation from BOM engine', async () => {
    mtoApi.calculate.mockResolvedValue({
      data: {
        valid_on: '2026-11-06',
        frozen: false,
        totals: [
          { khs_code: '1', khs_name: 'AAAC - 70 sqmm', unit_text: 'M', material: 250, install: 250, remove: 0, return: 0 },
          { khs_code: '20', khs_name: 'BC 50 MM (Bare Conductor)', unit_text: 'M', material: 35, install: 35, remove: 0, return: 0 },
        ],
        lines: [],
      },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    await screen.findByText(/Paket MTO #MTO-202611-0001/i)

    const calcBtn = screen.getByRole('button', { name: /Hitung Kebutuhan KHS/i })
    await userEvent.click(calcBtn)

    expect(await screen.findByText(/Pratinjau Kebutuhan Material KHS/i)).toBeInTheDocument()
    expect(screen.getByText('AAAC - 70 sqmm')).toBeInTheDocument()
    expect(screen.getByText('BC 50 MM (Bare Conductor)')).toBeInTheDocument()
    expect(screen.getAllByText('250').length).toBeGreaterThan(0)
    expect(screen.getAllByText('35').length).toBeGreaterThan(0)
  })

  it('5. verifies MTO by author, and allows Manager ULP to approve or reject with audit notes', async () => {
    // 5A: Verification by author
    mtoApi.verify.mockResolvedValue({
      data: {
        ...sampleMto,
        status: 'VERIFIED',
        snapshot_hash: '9f8b3c2a1e0d',
        valid_on: '2026-11-06',
        can: { edit: false, verify: false, decide: true },
      },
    })

    // Mock confirm dialog
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    await screen.findByText(/Paket MTO #MTO-202611-0001/i)

    const verifyBtn = screen.getByRole('button', { name: /^Verifikasi MTO$/i })
    await userEvent.click(verifyBtn)

    const confirmVerifyBtn = await screen.findByRole('button', { name: 'Verifikasi Sekarang' })
    await userEvent.click(confirmVerifyBtn)

    await waitFor(() => {
      expect(mtoApi.verify).toHaveBeenCalledWith('mto-pkg-1')
    })

    // 5B: Decision by Manager ULP
    const verifiedMto = {
      ...sampleMto,
      status: 'VERIFIED',
      can: { edit: false, verify: false, decide: true },
    }
    mtoApi.get.mockResolvedValue({ data: verifiedMto })
    mtoApi.decide.mockResolvedValue({
      data: { ...verifiedMto, status: 'APPROVED' },
      result: { status: 'APPROVED' },
    })

    const { rerender } = render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByRole('button', { name: /Setujui MTO/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tolak MTO/i })).toBeInTheDocument()

    // Test Rejection requiring notes
    const tolakBtn = screen.getByRole('button', { name: /Tolak MTO/i })
    await userEvent.click(tolakBtn)

    expect(await screen.findByText('Penolakan Paket MTO')).toBeInTheDocument()
    const confirmTolakBtn = screen.getByRole('button', { name: 'Konfirmasi Tolak' })
    await userEvent.click(confirmTolakBtn)
    expect(screen.getByText(/Alasan penolakan wajib diisi/i)).toBeInTheDocument()

    const notesInput = screen.getByPlaceholderText(/Tuliskan alasan penolakan/i)
    await userEvent.type(notesInput, 'Jumlah tiang TM-1 belum sesuai single line diagram.')

    mtoApi.decide.mockResolvedValue({
      data: { ...verifiedMto, status: 'DRAFT' },
      result: { status: 'DRAFT' },
    })

    await userEvent.click(confirmTolakBtn)

    await waitFor(() => {
      expect(mtoApi.decide).toHaveBeenCalledWith('mto-pkg-1', {
        decision: 'REJECTED',
        notes: 'Jumlah tiang TM-1 belum sesuai single line diagram.',
      })
    })
  })

  it('6. enforces MTO approval gate on drawing approval step (ULP_MANAGER 409 guard)', async () => {
    const drawingSample = {
      id: 'drw-uuid-1',
      drawing_number: 'DRW-202611-0001',
      application: { id: 'app-uuid-1', application_number: 'APP-202611-0001' },
      author: { id: 'u-teknik-1', name: 'Teknik Surveyor', email: 'teknik@pln.co.id' },
      can: {
        execute: false,
        assign: false,
        revise: false,
        escalate: false,
        decide: ['ULP_MANAGER'],
      },
      versions: [
        {
          id: 'dv-uuid-1',
          version_number: 1,
          status: 'SUBMITTED',
          stage: 'ULP_MANAGER',
          title: 'Desain Penyambungan Gardu',
          required_steps: ['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN'],
          decisions: [],
          documents: [
            { id: 'doc-1', file_role: 'MAIN', original_name: 'Desain.pdf', size_bytes: 1048576, extension: 'pdf' },
          ],
        },
      ],
    }

    drawingApi.get.mockResolvedValue({ data: drawingSample })
    // MTO is still DRAFT (not approved)
    mtoApi.forVersion.mockResolvedValue({ data: { ...sampleMto, status: 'DRAFT' } })

    // When manager ULP tries to approve drawing before MTO is approved, backend returns 409
    drawingApi.decide.mockRejectedValue({
      status: 409,
      message: 'MTO paket MTO-202611-0001 belum disetujui. MTO yang disetujui adalah prasyarat persetujuan gambar.',
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <DrawingDetailView drawingId="drw-uuid-1" />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText('Paket Gambar #DRW-202611-0001')).toBeInTheDocument()
    expect(screen.getByText(/MTO Belum Diverifikasi/i)).toBeInTheDocument()

    // Click Setujui on step ULP_MANAGER
    const approveBtn = screen.getByRole('button', { name: 'Setujui' })
    await userEvent.click(approveBtn)

    expect(await screen.findByText(/Setujui Gambar/i)).toBeInTheDocument()
    const confirmApproveBtn = screen.getByRole('button', { name: 'Konfirmasi Setujui' })
    await userEvent.click(confirmApproveBtn)

    // Verify 409 error message and direct navigation helper to MTO package
    expect(await screen.findByText(/MTO paket MTO-202611-0001 belum disetujui/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Buka & Kelola Paket MTO/i })).toBeInTheDocument()
  })

  it('7. renders PB/PD dropdown parameters and displays PB/PD extraction feedback', async () => {
    const pbpdMto = {
      ...sampleMto,
      id: 'mto-pkg-pbpd',
      package_number: 'MTO-202611-PBPD',
      params: {
        'PBPD:JENIS': 'PBPD',
        'PBPD:PEMBAYARAN': 'PLN',
        'PBPD:RENTANG_1': '450-5500 VA',
        'PBPD:PSG_1': 3,
        'PBPD:BKR_1': 0,
      },
      declared_params: [
        {
          name: 'PBPD:JENIS',
          description: 'Jenis transaksi permohonan',
          default: 'PBPD',
          group: 'PBPD_6_41',
          type: 'text',
          options: ['PBPD', 'PD 6,6-23 KVA', 'PD 6,6-41,5', 'PD 33-41,5 KVA'],
        },
      ],
    }

    mtoApi.get.mockResolvedValue({ data: pbpdMto })
    mtoApi.updateItems.mockResolvedValue({ data: pbpdMto })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MtoPackageDetailView packageId="mto-pkg-pbpd" />
        </NotificationProvider>
      </MemoryRouter>
    )

    await screen.findByText(/Paket MTO #MTO-202611-PBPD/i)

    // Check declared param with options is rendered as a select
    const jenisSelect = screen.getByRole('combobox', { name: /PBPD:JENIS/i })
    expect(jenisSelect).toBeInTheDocument()
    expect(jenisSelect.value).toBe('PBPD')

    // Change option
    await userEvent.selectOptions(jenisSelect, 'PD 6,6-23 KVA')
    expect(jenisSelect.value).toBe('PD 6,6-23 KVA')

    // Check PB/PD extra parameters section
    expect(screen.getByText(/Parameter Sambungan Standar PB\/PD/i)).toBeInTheDocument()
    expect(screen.getByText(/Skema Pembayaran \(PBPD:PEMBAYARAN\)/i)).toBeInTheDocument()
  })
})
