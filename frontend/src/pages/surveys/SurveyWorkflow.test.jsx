import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { surveyApi, documentApi, kkoApi, substationsApi } from '../../services/api.js'
import SurveyDetailView from './SurveyDetailView.jsx'
import DocumentGallery, { AuthenticatedDocumentItem } from '../../components/DocumentGallery.jsx'

vi.mock('../../services/api.js', () => ({
  surveyApi: {
    get: vi.fn(),
    updateDraft: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    reassign: vi.fn(),
    cancel: vi.fn(),
    surveyors: vi.fn(),
  },
  documentApi: {
    downloadBlob: vi.fn(),
    uploadToSurvey: vi.fn(),
    remove: vi.fn(),
  },
  kkoApi: {
    get: vi.fn().mockResolvedValue({ data: null }),
    record: vi.fn().mockResolvedValue({ data: null }),
    decide: vi.fn().mockResolvedValue({ data: null }),
    baseline: vi.fn(),
  },
  substationsApi: { list: vi.fn() },
}))

describe('Survey Workflow & Documents (Stage 2 - docs/63 §7)', () => {
  const baseSurvey = {
    id: 'srv-uuid-1',
    survey_number: 'SRV-202611-0001',
    sequence_number: 1,
    status: 'ACTIVE',
    scheduled_at: '2026-11-07',
    surveyor: { id: 'usr-teknik-1', name: 'Ahmad Surveyor', email: 'ahmad@pln.co.id' },
    application: {
      id: 'app-uuid-1',
      application_number: 'APP-202611-0001',
      application_type: 'PB',
      status: 'APPROVED',
    },
    can: {
      assign: true,
      execute: true,
      decide: [],
    },
    versions: [
      {
        id: 'ver-uuid-1',
        version_number: 1,
        status: 'DRAFT',
        stage: 'ULP_MANAGER',
        survey_date: '2026-11-06',
        findings: 'Tiang beton terdekat berjarak 35 meter dari persil pelanggan.',
        technical_recommendation: 'Tarik kabel SUTR 2x16 mm2 sepanjang 35m.',
        requires_drawing: false,
        requires_network_extension: false,
        requires_feasibility_study: false,
        latitude: -7.54,
        longitude: 112.23,
        network_distance_m: 35,
        network_type: 'SUTR',
        transformer_capacity_kva: 100,
        network_condition: 'Kondisi tiang dan saluran baik.',
        notes: 'Tidak ada halangan pohon.',
        measurements: [{ name: 'Tegangan Ujung', value: '221', unit: 'V' }],
        decisions: [],
        documents: [
          {
            id: 'doc-1',
            title: 'Foto Tiang Eksisting',
            original_name: 'tiang.jpg',
            mime_type: 'image/jpeg',
            size_bytes: 204800,
          },
        ],
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-blob-url')
    global.URL.revokeObjectURL = vi.fn()
    documentApi.downloadBlob.mockResolvedValue(new Blob(['img'], { type: 'image/jpeg' }))
  })

  it('renders stepper and displays editable form for surveyor in DRAFT status', async () => {
    surveyApi.get.mockResolvedValueOnce({ data: baseSurvey })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    expect(screen.getByText(/Memuat data survei/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Survei #SRV-202611-0001/i)).toBeInTheDocument()
      expect(screen.getByText(/Mode Pengisian \(Draf Surveyor\)/i)).toBeInTheDocument()
    })

    // Stepper header check
    expect(screen.getByText(/Rantai Persetujuan Versi 1/i)).toBeInTheDocument()
    expect(screen.getByText(/1. Surveyor/i)).toBeInTheDocument()
    expect(screen.getByText(/2. Manager ULP/i)).toBeInTheDocument()

    // Form inputs check
    expect(screen.getByLabelText('Jarak bangunan dari tiang eksisting')).toHaveValue(35)
    expect(screen.getByLabelText('Panjang SR yang dibutuhkan')).toBeInTheDocument()
    // fields removed on 16 Nov 2026
    for (const gone of ['Tanggal Survei', 'Latitude', 'Longitude', 'Temuan Lapangan', 'Rekomendasi Teknis', 'Jenis Jaringan', 'Kapasitas Trafo (kVA)', 'Kondisi Jaringan Eksisting', 'Catatan Tambahan', 'Pengukuran Dinamis Lapangan']) {
      expect(screen.queryByText(new RegExp(gone.replace(/[()]/g, '\\$&'), 'i'))).not.toBeInTheDocument()
    }

    // Action buttons visible for surveyor
    expect(screen.getByRole('button', { name: /Simpan Draf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ajukan Hasil Survei/i })).toBeInTheDocument()
  })

  it('locks the form read-only when survey version is submitted or surveyor lacks can.execute', async () => {
    const submittedSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'SUBMITTED',
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: submittedSurvey })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Survei #SRV-202611-0001/i)).toBeInTheDocument()
    })

    // Check that editable inputs and buttons are NOT rendered
    expect(screen.queryByRole('button', { name: /Simpan Draf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajukan Hasil Survei/i })).not.toBeInTheDocument()

    // Check read-only representation is displayed
    expect(screen.getByText(/Tiang beton terdekat berjarak 35 meter/i)).toBeInTheDocument()
    expect(screen.getByText('35 meter')).toBeInTheDocument()
    expect(screen.getByText(/100 kVA/i)).toBeInTheDocument()
  })

  it('shows decision buttons based on can.decide and requires notes on rejection', async () => {
    const user = userEvent.setup()
    const underReviewSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'SUBMITTED',
          stage: 'ULP_MANAGER',
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: underReviewSurvey })
    surveyApi.decide.mockResolvedValueOnce({
      data: underReviewSurvey,
      result: { version_status: 'RETURNED', new_version_id: 'ver-uuid-2' },
    })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Keputusan Anda Diperlukan/i)).toBeInTheDocument()
    })

    // Step button exists
    expect(screen.getByRole('button', { name: /Setujui/i })).toBeInTheDocument()
    const rejectBtn = screen.getByRole('button', { name: /Tolak/i })
    expect(rejectBtn).toBeInTheDocument()

    // Click Tolak
    await user.click(rejectBtn)

    expect(screen.getByText(/Tolak Survei \(Persetujuan Manager ULP\)/i)).toBeInTheDocument()

    // Try submitting without reason
    const confirmRejectBtn = screen.getByRole('button', { name: /Konfirmasi Tolak/i })
    await user.click(confirmRejectBtn)

    // Validation prevents submission
    expect(surveyApi.decide).not.toHaveBeenCalled()

    // Fill rejection reason
    const textarea = screen.getByPlaceholderText(/Sebutkan alasan penolakan/i)
    await user.type(textarea, 'Kapasitas trafo perlu diverifikasi kembali dengan pengukuran beban puncak.')

    await user.click(confirmRejectBtn)

    await waitFor(() => {
      expect(surveyApi.decide).toHaveBeenCalledWith('srv-uuid-1', 'ver-uuid-1', {
        step: 'ULP_MANAGER',
        decision: 'REJECTED',
        notes: 'Kapasitas trafo perlu diverifikasi kembali dengan pengukuran beban puncak.',
      })
    })
  })

  it('renders authenticated image thumbnail with Bearer fetch and ObjectURL', async () => {
    const mockBlob = new Blob(['image-bytes'], { type: 'image/jpeg' })
    documentApi.downloadBlob.mockResolvedValueOnce(mockBlob)

    render(
      <AuthenticatedDocumentItem
        doc={{
          id: 'doc-uuid-1',
          title: 'Bukti Tiang Sambungan',
          original_name: 'tiang.jpg',
          mime_type: 'image/jpeg',
          size_bytes: 102400,
        }}
        canDelete={false}
      />
    )

    await waitFor(() => {
      expect(documentApi.downloadBlob).toHaveBeenCalledWith('doc-uuid-1', { inline: true })
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob)
    })

    const img = screen.getByRole('img', { name: /Bukti Tiang Sambungan/i })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'blob:http://localhost/mock-blob-url')
  })

  it('displays delete confirmation with honest audit trail explanation and calls remove', async () => {
    const user = userEvent.setup()
    documentApi.remove.mockResolvedValueOnce({ message: 'Dokumen dihapus dari tampilan' })
    const onDeleted = vi.fn()

    render(
      <AuthenticatedDocumentItem
        doc={{
          id: 'doc-uuid-1',
          title: 'Bukti Tiang',
          original_name: 'tiang.jpg',
          mime_type: 'image/jpeg',
          size_bytes: 102400,
        }}
        canDelete={true}
        onDeleted={onDeleted}
      />
    )

    const deleteBtn = screen.getByTitle(/Hapus Dokumen/i)
    await user.click(deleteBtn)

    // Check honest modal text
    expect(screen.getByText(/Hapus Dokumen Ini\?/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Berkas dan riwayat unggahan tetap tersimpan di server untuk kelengkapan audit trail/i)
    ).toBeInTheDocument()

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: /Ya, Sembunyikan Dokumen/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(documentApi.remove).toHaveBeenCalledWith('doc-uuid-1')
      expect(onDeleted).toHaveBeenCalledWith('doc-uuid-1')
    })
  })

  it('supports uploading multiple files and displays progress', async () => {
    const onAdded = vi.fn()
    documentApi.uploadToSurvey.mockResolvedValue({
      data: { id: 'new-doc-1', title: 'test', size_bytes: 500 },
    })

    render(
      <DocumentGallery
        documents={[]}
        surveyId="srv-uuid-1"
        versionNumber="ver-uuid-1"
        canUpload={true}
        onDocumentAdded={onAdded}
      />
    )

    const file1 = new File(['content1'], 'foto1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['content2'], 'foto2.png', { type: 'image/png' })

    const input = screen.getByLabelText(/Unggah Berkas/i, { selector: 'input' })
    fireEvent.change(input, { target: { files: [file1, file2] } })

    await waitFor(() => {
      expect(documentApi.uploadToSurvey).toHaveBeenCalledTimes(2)
      expect(onAdded).toHaveBeenCalledTimes(2)
    })
  })

  it('submits survey with current form payload, displays 422/409 error verbatim, and resets loading state', async () => {
    const user = userEvent.setup()
    surveyApi.get.mockResolvedValueOnce({ data: baseSurvey })
    surveyApi.submit.mockRejectedValueOnce(
      new Error('Hasil survey belum lengkap; lengkapi: tanggal survey, temuan, koordinat')
    )

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Mode Pengisian \(Draf Surveyor\)/i)).toBeInTheDocument()
    })

    const submitBtn = screen.getByRole('button', { name: /Ajukan Hasil Survei/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(surveyApi.submit).toHaveBeenCalledWith(
        'srv-uuid-1',
        'ver-uuid-1',
        expect.objectContaining({
          network_distance_m: 35,
        })
      )
      expect(screen.getByText(/Hasil survey belum lengkap; lengkapi: tanggal survey, temuan, koordinat/i)).toBeInTheDocument()
    })

    // Simpan Draf button is not stuck loading
    const saveDraftBtn = screen.getByRole('button', { name: /Simpan Draf/i })
    expect(saveDraftBtn).not.toBeDisabled()
  })

  it('submits survey successfully with form payload and calls reload', async () => {
    const user = userEvent.setup()
    const onReloadApp = vi.fn()
    surveyApi.get.mockResolvedValue({ data: baseSurvey })
    surveyApi.submit.mockResolvedValueOnce({ data: { ...baseSurvey.versions[0], status: 'SUBMITTED' } })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" onReloadApplication={onReloadApp} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Mode Pengisian \(Draf Surveyor\)/i)).toBeInTheDocument()
    })

    const submitBtn = screen.getByRole('button', { name: /Ajukan Hasil Survei/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(surveyApi.submit).toHaveBeenCalledWith(
        'srv-uuid-1',
        'ver-uuid-1',
        expect.objectContaining({
          survey_date: '2026-11-06',
        })
      )
      expect(onReloadApp).toHaveBeenCalled()
    })
  })

  it('rantai persetujuan survei hanya sampai Manager ULP (16 Nov 2026), tanpa Review UP3 dan Asman', async () => {
    const acceptedSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: [] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'ACCEPTED',
          stage: null,
          decisions: [
            { step: 'ULP_MANAGER', decision: 'APPROVED', decided_at: '2026-11-07', decided_by_name: 'MULP', decided_role: 'MANAGER_ULP' },
            { step: 'REVIEW_PERENCANAAN', decision: 'APPROVED', decided_at: '2026-11-07', decided_by_name: 'Rev Ren', decided_role: 'REVIEW_PERENCANAAN' },
            { step: 'REVIEW_KONSTRUKSI', decision: 'APPROVED', decided_at: '2026-11-07', decided_by_name: 'Rev Kon', decided_role: 'REVIEW_KONSTRUKSI' },
            { step: 'ASMAN_PERENCANAAN', decision: 'APPROVED', decided_at: '2026-11-08', decided_by_name: 'Asman Ren', decided_role: 'ASMAN_PERENCANAAN' },
            { step: 'ASMAN_KONSTRUKSI', decision: 'APPROVED', decided_at: '2026-11-08', decided_by_name: 'Asman Kon', decided_role: 'ASMAN_KONSTRUKSI' },
          ],
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: acceptedSurvey })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('2. Manager ULP')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Manager UP3/i)).not.toBeInTheDocument()
    expect(screen.queryByText('3. Review UP3')).not.toBeInTheDocument()
    expect(screen.queryByText('4. Asman UP3')).not.toBeInTheDocument()
    expect(screen.getAllByText('Diterima').length).toBeGreaterThan(0)
  })

  it('displays MULP gate checklist and handles 409 error verbatim (docs/62 §48)', async () => {
    const user = userEvent.setup()
    const mulpPendingSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'SUBMITTED',
          stage: 'ULP_MANAGER',
          requires_drawing: true,
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: mulpPendingSurvey })
    surveyApi.decide.mockRejectedValueOnce(
      new Error('Survey ini memerlukan gambar teknik: Teknik ULP harus mengunggah dan mengajukan paket gambar lebih dulu sebelum Manager ULP menyetujui.')
    )

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Daftar Periksa Persetujuan Manager ULP \(Satu Paket Survei & Gambar\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Gambar teknik diajukan\?/i)).toBeInTheDocument()
      expect(screen.getByText(/MTO disetujui\?/i)).toBeInTheDocument()
    })

    // Click Setujui
    const approveBtn = screen.getByRole('button', { name: /Setujui/i })
    await user.click(approveBtn)

    expect(screen.getByText(/Setujui Survei \(Persetujuan Manager ULP\)/i)).toBeInTheDocument()
    const confirmApproveBtn = screen.getByRole('button', { name: /Konfirmasi Setujui/i })
    await user.click(confirmApproveBtn)

    // Verify 409 error is displayed verbatim
    await waitFor(() => {
      expect(screen.getByText(/Survey ini memerlukan gambar teknik: Teknik ULP harus mengunggah dan mengajukan paket gambar lebih dulu sebelum Manager ULP menyetujui/i)).toBeInTheDocument()
    })
  })

  it('renders explicit Ya/Tidak radio choices for Memerlukan Perluasan Jaringan with guidance note', async () => {
    surveyApi.get.mockResolvedValueOnce({ data: baseSurvey })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Memerlukan Perluasan Jaringan')).toBeInTheDocument()
    })

    expect(screen.getByText(/pelanggan siap pasang/i)).toBeInTheDocument()
    const radioYa = screen.getByRole('radio', { name: /Ya \(Memerlukan penambahan tiang, trafo, atau JTM\/JTR\)/i })
    const radioTidak = screen.getByRole('radio', { name: /Tidak/i })
    expect(radioYa).toBeInTheDocument()
    expect(radioTidak).toBeInTheDocument()
    expect(radioTidak).toBeChecked()
  })

  it('displays toast when survey decision returns result.proposal_closed', async () => {
    const user = userEvent.setup()
    const asmanSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: ['ASMAN_KONSTRUKSI'] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'UNDER_REVIEW',
          stage: 'ASMAN',
          requires_network_extension: false,
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: asmanSurvey })
    surveyApi.decide.mockResolvedValueOnce({
      result: {
        proposal_closed: 'USL-202611-0005',
      },
    })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Keputusan Anda Diperlukan/i)).toBeInTheDocument()
    })

    const approveBtn = screen.getByRole('button', { name: /Setujui/i })
    await user.click(approveBtn)

    const confirmBtn = screen.getByRole('button', { name: /Konfirmasi Setujui/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(surveyApi.decide).toHaveBeenCalledWith('srv-uuid-1', 'ver-uuid-1', {
        step: 'ASMAN_KONSTRUKSI',
        decision: 'APPROVED',
        notes: undefined,
      })
    })
  })

  it('13. formulir survei mengirim 3 penanda yang benar untuk Tanpa perluasan dan Perlu perluasan serta no_extension_reason (docs/82 §3)', async () => {
    const user = userEvent.setup()
    surveyApi.get.mockResolvedValue({ data: baseSurvey })
    surveyApi.submit.mockResolvedValue({ data: { ...baseSurvey.versions[0], status: 'SUBMITTED' } })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Memerlukan Perluasan Jaringan')).toBeInTheDocument()
    })

    // 1. Pilih "Tanpa perluasan" -> textarea alasan muncul, isi alasan
    const radioTidak = screen.getByRole('radio', { name: /Tidak/i })
    await user.click(radioTidak)
    const reasonInput = screen.getByPlaceholderText(/Tuliskan alasan teknis tanpa perluasan/i)
    expect(reasonInput).toBeInTheDocument()
    await user.type(reasonInput, 'Kapasitas trafo mencukupi dan drop tegangan aman')

    const submitBtn = screen.getByRole('button', { name: /Ajukan Hasil Survei/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(surveyApi.submit).toHaveBeenCalledWith(
        'srv-uuid-1',
        'ver-uuid-1',
        expect.objectContaining({
          requires_network_extension: false,
          requires_drawing: false,
          requires_feasibility_study: false,
          no_extension_reason: 'Kapasitas trafo mencukupi dan drop tegangan aman',
        })
      )
    })
  })

  it('14. galat 409 server (KKO belum dicatat, kombinasi tidak sah, alasan wajib) tampil apa adanya dan form tidak kehilangan isiannya (docs/82 §3)', async () => {
    const user = userEvent.setup()
    surveyApi.get.mockResolvedValue({ data: baseSurvey })
    surveyApi.submit.mockRejectedValue({
      response: {
        data: {
          message: 'KKO menunjukkan pembebanan > 100 %: penanda "tanpa perluasan" memerlukan alasan tertulis.',
        },
      },
    })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Memerlukan Perluasan Jaringan')).toBeInTheDocument()
    })

    const reasonInput = screen.getByPlaceholderText(/Tuliskan alasan teknis tanpa perluasan/i)
    await user.type(reasonInput, 'Alasan awal')

    const submitBtn = screen.getByRole('button', { name: /Ajukan Hasil Survei/i })
    await user.click(submitBtn)

    expect(
      await screen.findByText(/KKO menunjukkan pembebanan > 100 %: penanda "tanpa perluasan" memerlukan alasan tertulis\./i)
    ).toBeInTheDocument()
    // Form retains its state
    expect(reasonInput).toHaveValue('Alasan awal')
  })

  it('15. stepper selalu 2 langkah (Surveyor, Manager ULP), apa pun hasil survei (16 Nov 2026)', async () => {
    const shortChainSurvey = {
      ...baseSurvey,
      versions: [
        {
          ...baseSurvey.versions[0],
          short_chain: true,
          outcome: 'NO_EXTENSION',
        },
      ],
    }
    surveyApi.get.mockResolvedValueOnce({ data: shortChainSurvey })

    const { unmount } = render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('1. Surveyor')).toBeInTheDocument()
      expect(screen.getByText('2. Manager ULP')).toBeInTheDocument()
    })
    // Review UP3 and Asman UP3 should NOT be present
    expect(screen.queryByText('3. Review UP3')).not.toBeInTheDocument()
    expect(screen.queryByText('4. Asman UP3')).not.toBeInTheDocument()
    unmount()

    // a survey that needs an extension has the same two steps
    const extSurvey = { ...baseSurvey, id: 'srv-uuid-2', versions: [{ ...baseSurvey.versions[0], short_chain: true, outcome: 'EXTENSION' }] }
    surveyApi.get.mockResolvedValueOnce({ data: extSurvey })
    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-2" />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('2. Manager ULP')).toBeInTheDocument())
    expect(screen.queryByText('3. Review UP3')).not.toBeInTheDocument()
  })

  it('16. keputusan Manager ULP pada short chain menghasilkan ACCEPTED dan menampilkan lencana Siap Pasang (docs/82 §3)', async () => {
    const user = userEvent.setup()
    const mulpSurvey = {
      ...baseSurvey,
      can: { assign: false, execute: false, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseSurvey.versions[0],
          status: 'UNDER_REVIEW',
          stage: 'ULP_MANAGER',
          short_chain: true,
          outcome: 'NO_EXTENSION',
        },
      ],
    }
    const acceptedSurvey = {
      ...mulpSurvey,
      status: 'ACTIVE',
      ready_to_install: true,
      can: { assign: false, execute: false, decide: [] },
      versions: [
        {
          ...mulpSurvey.versions[0],
          status: 'ACCEPTED',
          stage: null,
          short_chain: true,
          outcome: 'NO_EXTENSION',
        },
      ],
    }

    surveyApi.get.mockResolvedValueOnce({ data: mulpSurvey })
    surveyApi.decide.mockResolvedValueOnce({
      result: { survey_status: 'ACCEPTED', version_status: 'ACCEPTED' },
    })
    surveyApi.get.mockResolvedValueOnce({ data: acceptedSurvey })

    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Keputusan Anda Diperlukan/i)).toBeInTheDocument()
    })

    const approveBtn = screen.getByRole('button', { name: /Setujui/i })
    await user.click(approveBtn)

    const confirmBtn = screen.getByRole('button', { name: /Konfirmasi Setujui/i })
    await user.click(confirmBtn)

    expect(await screen.findByTestId('ready-to-install-badge')).toHaveTextContent('Siap pasang')
  })

  it('17. tanggal survei otomatis hari berjalan, panjang SR dan jarak bangunan tampil, dan keduanya dikirim', async () => {
    const draft = { ...baseSurvey, versions: [{ ...baseSurvey.versions[0], survey_date: null, sr_length_m: null, network_distance_m: null }] }
    surveyApi.get.mockResolvedValueOnce({ data: draft })
    surveyApi.updateDraft.mockResolvedValueOnce({})
    surveyApi.get.mockResolvedValue({ data: draft })
    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )
    const today = new Date().toISOString().slice(0, 10)
    await screen.findByLabelText('Panjang SR yang dibutuhkan')
    await userEvent.type(screen.getByLabelText('Panjang SR yang dibutuhkan'), '25')
    await userEvent.type(screen.getByLabelText('Jarak bangunan dari tiang eksisting'), '38')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Draf/i }))
    await waitFor(() => expect(surveyApi.updateDraft).toHaveBeenCalled())
    const body = surveyApi.updateDraft.mock.calls[0][2]
    expect(body.sr_length_m).toBe(25)
    expect(body.network_distance_m).toBe(38)
    expect(body.survey_date).toBe(today)
  })

  it('18. foto dan dokumentasi berada di atas tombol simpan/ajukan; unggah tidak menghapus isian yang belum disimpan', async () => {
    surveyApi.get.mockResolvedValue({ data: baseSurvey })
    documentApi.uploadToSurvey.mockResolvedValue({ data: { id: 'd-new' } })
    const { container } = render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )
    const findings = await screen.findByLabelText('Panjang SR yang dibutuhkan')
    const evidence = screen.getByTestId('survey-evidence')
    const saveBtn = screen.getByRole('button', { name: /Simpan Draf/i })
    expect(evidence.compareDocumentPosition(saveBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()      // the evidence comes before the buttons
    await userEvent.clear(findings)
    await userEvent.type(findings, '77')
    const calls = surveyApi.get.mock.calls.length
    const input = container.querySelector('input[type="file"]')
    await userEvent.upload(input, new File(['x'], 'foto.png', { type: 'image/png' }))
    await waitFor(() => expect(documentApi.uploadToSurvey).toHaveBeenCalled())
    await waitFor(() => expect(surveyApi.get.mock.calls.length).toBeGreaterThan(calls))      // the list was refreshed...
    expect(screen.getByLabelText('Panjang SR yang dibutuhkan')).toHaveValue(77)      // ...and the unsaved value stayed
  })

  it('19. rekomendasi otomatis: data KKO per fasa normal dan jarak ≤ 40 m memilih Tidak; jarak lebih jauh memilih Ya dengan alasan', async () => {
    const { kkoApi } = await import('../../services/api.js')
    const pd = { load: { r: 199, s: 200, t: 235 }, added: { r: 0, s: 50, t: 0 }, base_voltage: { r: 235, s: 236, t: 236 }, existing_voltage: { r: 209, s: 209, t: 208 } }
    kkoApi.get.mockResolvedValue({ data: { status: 'RECORDED', context: {}, record: { transformer_capacity_kva: 250, phase_detail: pd }, events: [] } })
    const draft = { ...baseSurvey, versions: [{ ...baseSurvey.versions[0], requires_network_extension: true, network_distance_m: 30 }] }
    surveyApi.get.mockResolvedValue({ data: draft })
    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('extension-recommendation')).toHaveTextContent(/tidak memerlukan perluasan/i))
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Tidak$/ })).toBeChecked())
    const dist = screen.getByLabelText('Jarak bangunan dari tiang eksisting')
    await userEvent.clear(dist)
    await userEvent.type(dist, '55')
    await waitFor(() => expect(screen.getByTestId('extension-recommendation')).toHaveTextContent(/memerlukan perluasan — jarak 55 m/i))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Ya \(Memerlukan/ })).toBeChecked())
    // the surveyor's own choice is respected afterwards
    await userEvent.click(screen.getByRole('radio', { name: /^Tidak$/ }))
    await userEvent.clear(dist)
    await userEvent.type(dist, '70')
    expect(screen.getByRole('radio', { name: /^Tidak$/ })).toBeChecked()
    kkoApi.get.mockResolvedValue({ data: null })
  })


  it('20. data gardu read-only dari pembacaan terakhir; hanya tegangan hasil ukur survei yang diisi; KKO tersimpan bersama Simpan Draf (tanpa tombol KKO sendiri)', async () => {
    surveyApi.get.mockResolvedValue({ data: baseSurvey })
    surveyApi.updateDraft.mockResolvedValue({})
    kkoApi.get.mockResolvedValue({ data: { status: 'NOT_RECORDED', context: { thresholds: {} }, record: null, events: [] } })
    kkoApi.record.mockResolvedValue({ data: { status: 'RECORDED', context: {}, record: { transformer_capacity_kva: 250, phase_detail: null }, events: [] } })
    substationsApi.list.mockResolvedValue({
      data: [{ id: 'g1', code: 'HD0200', name: 'DS TENGARAN', capacity_kva: 250, reading_status: 'FRESH', reading: { measured_on: '2026-10-01', age_days: 40, load_kva: 166, loading_pct: 66.5, end_voltage_v: 220 } }],
    })
    kkoApi.baseline.mockResolvedValue({
      data: {
        substation: { id: 'g1', code: 'HD0200', name: 'DS TENGARAN', capacity_kva: 250 },
        reading: { current_r_a: 199, current_s_a: 200, current_t_a: 235, base_voltage_r_v: 235, base_voltage_s_v: 236, base_voltage_t_v: 236, feeders: [{ label: 'A', current_r_a: 1, current_s_a: 1, current_t_a: 1 }, { label: 'B', current_r_a: 1, current_s_a: 1, current_t_a: 1 }] },
        suggested_added: { r: 0, s: 50, t: 0 },
      },
    })
    render(
      <MemoryRouter>
        <SurveyDetailView surveyId="srv-uuid-1" />
      </MemoryRouter>
    )
    await userEvent.type(await screen.findByLabelText('Cari gardu master'), 'HD02')
    await userEvent.click(await screen.findByRole('option', { name: /HD0200/ }))
    await waitFor(() => expect(screen.getByTestId('kko-load-t')).toHaveTextContent('235'))
    // read-only: no input for the gardu data, no stand-alone KKO save button
    expect(screen.getByTestId('kko-load-t').tagName).toBe('SPAN')
    expect(screen.getByTestId('kko-base-s')).toHaveTextContent('236')
    expect(screen.queryByLabelText('Kapasitas trafo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simpan Hasil Survei KKO/i })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('kko-embedded')).getByText(/66,55 %/)).toBeInTheDocument()
    // the manual voltages
    for (const [k, v] of [['R', '209'], ['S', '209'], ['T', '208']]) await userEvent.type(screen.getByLabelText(`Tegangan survei ${k}`), v)
    await userEvent.click(screen.getByRole('button', { name: /Simpan Draf/i }))
    await waitFor(() => expect(surveyApi.updateDraft).toHaveBeenCalled())
    expect(kkoApi.record).toHaveBeenCalledTimes(1)
    const body = kkoApi.record.mock.calls[0][1]
    expect(body.substation_id).toBe('g1')
    expect(body.phase_detail.existing_voltage).toEqual({ r: 209, s: 209, t: 208 })
    expect(body.phase_detail.base_voltage.s).toBe(236)
    expect(kkoApi.record.mock.invocationCallOrder[0]).toBeLessThan(surveyApi.updateDraft.mock.invocationCallOrder[0])      // KKO first, then the draft
    kkoApi.get.mockResolvedValue({ data: null })
  })

})
