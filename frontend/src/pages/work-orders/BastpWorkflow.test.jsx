import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BastpDetailPage } from './BastpPages.jsx'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import BastpDetailDrawer from './BastpDetailDrawer.jsx'
import ApplicationWorkOrdersPanel from '../applications/ApplicationWorkOrdersPanel.jsx'
import { bastpApi, workOrdersApi, vendorsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  bastpApi: {
    listForWorkOrder: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    putMaterials: vi.fn(),
    putMeters: vi.fn(),
    uploadPhoto: vi.fn(),
    submit: vi.fn(),
    accept: vi.fn(),
    sign: vi.fn(),
    close: vi.fn(),
    return: vi.fn(),
    document: vi.fn(),
  },
  workOrdersApi: {
    listForApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    setVendor: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    submitProgress: vi.fn(),
    decideProgress: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    amend: vi.fn(),
  },
  vendorsApi: {
    list: vi.fn(),
  },
  triggerFileDownload: vi.fn(),
}))

function renderWithProviders(ui, { can = {}, isSysAdmin = false, user = { id: 'u-1', email: 'teknik@pln.co.id', name: 'Staf Teknik ULP' } } = {}) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user, status: 'authenticated' }}>
        <AccessContext.Provider
          value={{
            can,
            isSysAdmin,
            roles: isSysAdmin ? ['SYS_ADMIN'] : ['TEKNIK'],
            loading: false,
          }}
        >
          <NotificationProvider>
            <Routes>
              <Route path="/bastp/:bastpId" element={<BastpDetailPage />} />
              <Route path="*" element={ui} />
            </Routes>
          </NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('BASTP Workflow (docs/62 §36, docs/73 §6, docs/75 & docs/57)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorsApi.list.mockResolvedValue({ data: [] })
  })

  const mockWoInProgress = {
    id: 'wo-101',
    wo_number: 'WO-202611-0001',
    version_number: 1,
    status: 'IN_PROGRESS',
    application_id: 'app-1',
    vendor_company_id: 'vnd-comp-1',
    tasks: [
      { id: 'task-1', sequence: 1, title: 'Pemasangan Tiang & Konduktor TM', unit_text: 'KMS', volume: 1.5, verified_percent: 100 },
      { id: 'task-2', sequence: 2, title: 'Pemasangan Trafo Distribusi 50 kVA', unit_text: 'UNIT', volume: 1, verified_percent: 100 },
    ],
    application: {
      id: 'app-1',
      customer: { idpel: '515430009999', name: 'PT Surya Gemilang' },
      external_status: 'PEREMAJAAN',
    },
  }

  const mockBastpDraft = {
    id: 'bastp-101',
    work_order_id: 'wo-101',
    wo_number: 'WO-202611-0001',
    bastp_number: null,
    status: 'DRAFT',
    round: 1,
    notes: 'Pekerjaan selesai 100% sesuai standar PLN.',
    return_reason: null,
    content_hash: null,
    closed_at: null,
    materials: [
      { khs_code: 'MAT-POLE-12M', planned_qty: 2, installed_qty: null, note: null },
      { khs_code: 'MAT-TRAFO-50', planned_qty: 1, installed_qty: null, note: null },
    ],
    meters: [
      { id: 'meter-1', customer_idpel: '515430009999', meter_number: '01140023948', photo_document_ids: ['doc-foto-1'] },
    ],
    signatures: [],
    events: [
      { event_type: 'CREATED', reason: null, actor_name: 'Staf Teknik ULP', occurred_at: '2026-11-07 10:00:00' },
    ],
  }

  const mockBastpSubmitted = {
    ...mockBastpDraft,
    bastp_number: '00001/BASTP/07-11/51543/2026',
    status: 'SUBMITTED',
    content_hash: '1234567890abcdef1234567890abcdef',
    materials: [
      { khs_code: 'MAT-POLE-12M', planned_qty: 2, installed_qty: 2, note: 'Sesuai rencana' },
      { khs_code: 'MAT-TRAFO-50', planned_qty: 1, installed_qty: 1, note: null },
    ],
    signatures: [
      { round: 1, step: 'SUBMIT', signer_name: 'Mitra Vendor Utama', signer_role: 'VENDOR', signed_at: '2026-11-07 11:00:00', signature: 'abcdef1234567890aabbccddeeff0011' },
    ],
  }

  const mockBastpAccepted = {
    ...mockBastpSubmitted,
    status: 'ACCEPTED',
    signatures: [
      ...mockBastpSubmitted.signatures,
      { round: 1, step: 'ULP_MANAGER', signer_name: 'Budi Santoso', signer_role: 'MANAGER_ULP', signed_at: '2026-11-07 11:30:00', signature: '99887766554433221100aabbccddeeff' },
    ],
  }

  const mockBastpKonstruksiSigned = {
    ...mockBastpAccepted,
    status: 'KONSTRUKSI_SIGNED',
    signatures: [
      ...mockBastpAccepted.signatures,
      { round: 1, step: 'KONSTRUKSI_UP3', signer_name: 'Agus Subekti', signer_role: 'KONSTRUKSI_UP3', signed_at: '2026-11-07 12:00:00', signature: '11223344556677889900aabbccddeeff' },
    ],
  }

  const mockBastpReturnedRound2 = {
    ...mockBastpSubmitted,
    status: 'DRAFT',
    round: 2,
    return_reason: 'Foto fisik nomor seri meter pada meter 01140023948 buram/tidak terbaca.',
    signatures: mockBastpSubmitted.signatures,
  }

  const mockBastpDocument = {
    title: 'BERITA ACARA SERAH TERIMA PEKERJAAN (BASTP)',
    document_number: '00001/BASTP/07-11/51543/2026',
    header: ['PT PLN (PERSERO) UID JAWA TIMUR', 'UP3 MOJOKERTO', 'ULP MOJOKERTO KOTA'],
    meta: [
      ['Nomor BASTP', '00001/BASTP/07-11/51543/2026'],
      ['Nomor WO', 'WO-202611-0001'],
      ['Status', 'CLOSED'],
    ],
    sections: [
      {
        heading: 'URAIAN PEKERJAAN',
        columns: ['NO', 'PEKERJAAN', 'SAT', 'VOLUME', 'PROGRES TERVERIFIKASI (%)'],
        rows: [[1, 'Pemasangan Tiang & Konduktor TM', 'KMS', 1.5, 100]],
      },
      {
        heading: 'LAMPIRAN: REALISASI MATERIAL TERPASANG',
        columns: ['NO', 'KODE KHS', 'RENCANA', 'TERPASANG', 'SELISIH', 'CATATAN'],
        rows: [[1, 'MAT-POLE-12M', 2, 2, 0, 'Sesuai rencana']],
      },
      {
        heading: 'BUKTI KWH METER',
        columns: ['NO', 'ID PELANGGAN', 'NOMOR KWH METER', 'JUMLAH FOTO'],
        rows: [[1, '515430009999', '01140023948', 1]],
      },
    ],
    signatures: [
      { title: 'PELAKSANA (PIHAK KEDUA)', name: 'Mitra Vendor Utama', role: 'VENDOR', signed_at: '2026-11-07 11:00:00', signature: 'abcdef1234567890', electronic: true },
      { title: 'ASMAN KONSTRUKSI', name: 'Hendro Wijaya', role: 'ASMAN_KONSTRUKSI', signed_at: '2026-11-07 13:00:00', signature: 'fedcba0987654321', electronic: true },
    ],
    electronic_signature_note: 'Ditandatangani secara elektronik dalam sistem DISTRIVA (konfirmasi kata sandi); sidik jari tanda tangan = 16 karakter pertama HMAC atas isi beku BASTP. Bukan tanda tangan elektronik tersertifikasi.',
  }

  it('1. menampilkan tombol Buat BASTP saat WO IN_PROGRESS dan seluruh tugas 100% terverifikasi', async () => {
    const user = userEvent.setup()
    workOrdersApi.listForApplication.mockResolvedValue({ data: [mockWoInProgress] })
    workOrdersApi.get.mockResolvedValue({ data: mockWoInProgress })
    bastpApi.listForWorkOrder.mockResolvedValue({ data: [] })
    bastpApi.create.mockResolvedValue({ data: { id: 'bastp-101' } })
    bastpApi.get.mockResolvedValue({ data: mockBastpDraft })

    renderWithProviders(
      <ApplicationWorkOrdersPanel
        application={mockWoInProgress.application}
        canCreate={false}
        canIssue={false}
        canComplete={true}
        canView={true}
      />,
      { can: { 'bastp.prepare': true } }
    )

    // Wait for WO detail and Buat BASTP buttons to appear
    const buatBastpBtns = await screen.findAllByRole('button', { name: /Buat Dokumen BASTP|Buat.*BASTP/i })
    expect(buatBastpBtns.length).toBeGreaterThan(0)

    // Klik Buat BASTP
    await user.click(buatBastpBtns[0])

    expect(bastpApi.create).toHaveBeenCalledWith('wo-101')

    // halaman BASTP terbuka (form tidak lagi di laci)
    await waitFor(() => {
      expect(screen.getByText(/BELUM DITERBITKAN \(DRAFT\)/i)).toBeInTheDocument()
    })
  })

  it('2. tombol aksi berjenjang muncul sesuai status BASTP dan hak akses (fail-closed)', async () => {
    // A. Status SUBMITTED dengan izin bastp.accept (Manager ULP)
    bastpApi.get.mockResolvedValue({ data: mockBastpSubmitted })

    const { unmount } = renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.accept': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('00001/BASTP/07-11/51543/2026')).toBeInTheDocument()
    })

    // Manager ULP melihat tombol "Terima & Tanda Tangani" dan "Kembalikan"
    expect(screen.getByRole('button', { name: /Terima & Tanda Tangani/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kembalikan/i })).toBeInTheDocument()
    unmount()

    // B. Status ACCEPTED dengan izin bastp.sign_konstruksi (Konstruksi UP3)
    bastpApi.get.mockResolvedValue({ data: mockBastpAccepted })

    const { unmount: unmountAccepted } = renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.sign_konstruksi': true } }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Tanda Tangani$/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Kembalikan/i })).toBeInTheDocument()
    unmountAccepted()

    // C. Status KONSTRUKSI_SIGNED dengan izin bastp.close (Asman Konstruksi)
    bastpApi.get.mockResolvedValue({ data: mockBastpKonstruksiSigned })

    renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.close': true } }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tutup & Tanda Tangani/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Kembalikan/i })).toBeInTheDocument()
  })

  it('3. meminta kata sandi akun untuk tanda tangan elektronik dan menampilkan 403 bila kata sandi salah', async () => {
    const user = userEvent.setup()
    bastpApi.get.mockResolvedValue({ data: mockBastpDraft })
    bastpApi.submit.mockRejectedValue({
      response: {
        status: 403,
        data: { message: 'Kata sandi tanda tangan tidak sesuai.' },
      },
    })

    renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.prepare': true } }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ajukan & Tanda Tangani/i })).toBeInTheDocument()
    })

    // Klik Ajukan & Tanda Tangani
    await user.click(screen.getByRole('button', { name: /Ajukan & Tanda Tangani/i }))

    // Modal konfirmasi kata sandi muncul
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Masukkan kata sandi akun Anda/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Dengan mengajukan BASTP/i)).toBeInTheDocument()

    const passwordInput = screen.getByPlaceholderText(/Masukkan kata sandi akun Anda/i)
    await user.type(passwordInput, 'wrongpassword')

    // Submit tanda tangan pada modal (type="submit")
    const modalSignBtns = screen.getAllByRole('button', { name: /^Ajukan & Tanda Tangani$/i })
    const submitBtn = modalSignBtns.find((b) => b.getAttribute('type') === 'submit') || modalSignBtns[0]
    await user.click(submitBtn)

    expect(bastpApi.submit).toHaveBeenCalledWith('bastp-101', { password: 'wrongpassword' })

    // Pesan galat 403 ditampilkan apa adanya
    await waitFor(() => {
      expect(screen.getByText('Kata sandi tanda tangan tidak sesuai.')).toBeInTheDocument()
    })
  })

  it('4. pengembalian BASTP meminta alasan wajib, menaikkan putaran (+1), dan kembali ke status DRAFT', async () => {
    const user = userEvent.setup()
    bastpApi.get.mockResolvedValueOnce({ data: mockBastpSubmitted })
    bastpApi.return.mockResolvedValue({ message: 'BASTP dikembalikan.' })
    bastpApi.get.mockResolvedValueOnce({ data: mockBastpReturnedRound2 })

    renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.accept': true } }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Kembalikan/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Kembalikan/i }))

    // Reason dialog muncul
    await waitFor(() => {
      expect(screen.getByText('Kembalikan BASTP ke Pembuat')).toBeInTheDocument()
    })

    const reasonInput = screen.getByLabelText(/Alasan/i)
    await user.type(reasonInput, 'Foto fisik nomor seri meter pada meter 01140023948 buram/tidak terbaca.')

    await user.click(screen.getByRole('button', { name: /^Kembalikan BASTP$/i }))

    expect(bastpApi.return).toHaveBeenCalledWith('bastp-101', {
      reason: 'Foto fisik nomor seri meter pada meter 01140023948 buram/tidak terbaca.',
    })

    // Setelah reload, tampilkan putaran ke-2 dan catatan pengembalian
    await waitFor(() => {
      expect(screen.getByText(/Catatan Pengembalian \(Putaran 2\):/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Foto fisik nomor seri meter pada meter 01140023948 buram/i)).toBeInTheDocument()
  })

  it('5. dapat mengisi lampiran material terpasang dan mengunggah foto kWh meter', async () => {
    const user = userEvent.setup()
    bastpApi.get.mockResolvedValue({ data: mockBastpDraft })
    bastpApi.putMaterials.mockResolvedValue({ message: 'Lampiran material terpasang disimpan.' })
    bastpApi.uploadPhoto.mockResolvedValue({ data: { document_id: 'doc-foto-new' } })

    renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.prepare': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('MAT-POLE-12M')).toBeInTheDocument()
    })

    // Ubah jumlah terpasang pada material
    const installedInputs = screen.getAllByPlaceholderText('0')
    await user.type(installedInputs[0], '2')

    // Klik simpan material
    const saveMatBtn = screen.getByRole('button', { name: /Simpan Perubahan Material/i })
    await user.click(saveMatBtn)

    expect(bastpApi.putMaterials).toHaveBeenCalledWith('bastp-101', {
      materials: [
        { khs_code: 'MAT-POLE-12M', installed_qty: 2, note: null },
        { khs_code: 'MAT-TRAFO-50', installed_qty: 0, note: null },
      ],
      notes: 'Pekerjaan selesai 100% sesuai standar PLN.',
    })

    // Pindah ke tab Bukti kWh Meter
    await user.click(screen.getByRole('button', { name: /2\. Bukti kWh Meter/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('01140023948')).toBeInTheDocument()
    })
    expect(screen.getByText('1 Foto')).toBeInTheDocument()
  })

  it('6. membuka dokumen BASTP dengan format standar PLN dan sidik jari tanda tangan elektronik', async () => {
    const user = userEvent.setup()
    bastpApi.get.mockResolvedValue({ data: mockBastpSubmitted })
    bastpApi.document.mockResolvedValue({ data: mockBastpDocument })

    renderWithProviders(
      <BastpDetailDrawer
        bastpId="bastp-101"
        workOrder={mockWoInProgress}
        onClose={vi.fn()}
      />,
      { can: { 'bastp.view': true } }
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Dokumen BASTP/i })).toBeInTheDocument()
    })

    // Buka modal dokumen BASTP
    await user.click(screen.getByRole('button', { name: /Dokumen BASTP/i }))

    expect(bastpApi.document).toHaveBeenCalledWith('bastp-101', 'json')

    await waitFor(() => {
      expect(screen.getAllByText('BERITA ACARA SERAH TERIMA PEKERJAAN (BASTP)').length).toBeGreaterThan(0)
    })

    // Cek kop dan nomor BASTP
    expect(screen.getByText('PT PLN (PERSERO) UID JAWA TIMUR')).toBeInTheDocument()
    expect(screen.getAllByText('00001/BASTP/07-11/51543/2026').length).toBeGreaterThan(0)

    // Cek tanda tangan elektronik dan sidik jari 16-karakter
    expect(screen.getAllByText('TTE DISTRIVA').length).toBeGreaterThan(0)
    expect(screen.getByText('Sidik Jari: abcdef1234567890')).toBeInTheDocument()
    expect(screen.getByText(/Bukan tanda tangan elektronik tersertifikasi/i)).toBeInTheDocument()
  })
})
