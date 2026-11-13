import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { drawingApi, documentApi } from '../../services/api.js'
import DrawingDetailView from './DrawingDetailView.jsx'

vi.mock('../../services/api.js', () => ({
  drawingApi: {
    get: vi.fn(),
    updateDraft: vi.fn(),
    uploadDocument: vi.fn(),
    submit: vi.fn(),
    escalate: vi.fn(),
    decide: vi.fn(),
    revise: vi.fn(),
    reassign: vi.fn(),
    authors: vi.fn(),
  },
  documentApi: {
    downloadBlob: vi.fn(),
    preview: vi.fn(),
    previewPdfBlob: vi.fn(),
    remove: vi.fn(),
  },
  mtoApi: {
    forVersion: vi.fn().mockResolvedValue({ data: null }),
  },
  applicationApi: {
    get: vi.fn().mockResolvedValue({ data: null }),
  },
}))

describe('Drawing Workflow & Extended Approval (Stage 3 - docs/63 §7 (E))', () => {
  const baseDrawing = {
    id: 'drw-uuid-1',
    drawing_number: 'DRW-202611-0001',
    author: { id: 'usr-teknik-1', name: 'Bambang Drafter', email: 'bambang@pln.co.id' },
    application: {
      id: 'app-uuid-1',
      application_number: 'APP-202611-0001',
      application_type: 'PB',
      status: 'APPROVED',
    },
    can: {
      assign: true,
      execute: true,
      revise: false,
      escalate: true,
      decide: [],
    },
    versions: [
      {
        id: 'ver-drw-1',
        version_number: 1,
        status: 'DRAFT',
        stage: 'ULP_MANAGER',
        title: 'Single Line Diagram (SLD) Gardu Trafo 100 kVA',
        description: 'Rancangan penarikan jaringan SUTM 3 fasa sepanjang 35m.',
        notes: 'Tiang menggunakan tiang beton 11m/350daN.',
        extended_approval: false,
        extended_reason: null,
        required_steps: ['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN'],
        decisions: [],
        documents: [
          {
            id: 'doc-main-1',
            file_role: 'MAIN',
            title: 'SLD Gambar Utama',
            original_name: 'sld_utama.dwg',
            extension: 'dwg',
            mime_type: 'application/acad',
            size_bytes: 1048576,
          },
          {
            id: 'doc-att-1',
            file_role: 'ATTACHMENT',
            title: 'Kalkulasi Beban Saluran',
            original_name: 'kalkulasi.pdf',
            extension: 'pdf',
            mime_type: 'application/pdf',
            size_bytes: 524288,
          },
        ],
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-blob-url')
    global.URL.revokeObjectURL = vi.fn()
    documentApi.downloadBlob.mockResolvedValue(new Blob(['dwg-bytes'], { type: 'application/acad' }))
  })

  it('renders normal chain stepper (3 stages) and editable form for author on DRAFT', async () => {
    drawingApi.get.mockResolvedValueOnce({ data: baseDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Paket Gambar #DRW-202611-0001/i)).toBeInTheDocument()
      expect(screen.getByText(/Mode Penyusunan Draf \(Penyusun TEKNIK\)/i)).toBeInTheDocument()
    })

    // Guidance text for main drawing upload (docs/62 §48)
    expect(
      screen.getByText(/Unggah lembar GAMBAR Excel \(xlsx\/xls\) atau PDF hasil ekspor Excel agar kebutuhan material terbaca otomatis; DWG\/DXF\/foto sebagai lampiran, jumlah diisi manual/i)
    ).toBeInTheDocument()

    // Stepper header & 3 stages in normal chain
    expect(screen.getByText(/Rantai Persetujuan Versi 1/i)).toBeInTheDocument()
    expect(screen.getByText(/1. Manager ULP/i)).toBeInTheDocument()
    expect(screen.getByText(/2. Review UP3/i)).toBeInTheDocument()
    expect(screen.getByText(/3. Persetujuan Asman/i)).toBeInTheDocument()
    // Normal chain should NOT have step 4 Manager UP3
    expect(screen.queryByText(/4. Manager UP3/i)).not.toBeInTheDocument()

    // Form inputs and document lists
    expect(screen.getByDisplayValue(/Single Line Diagram \(SLD\) Gardu Trafo 100 kVA/i)).toBeInTheDocument()
    expect(screen.getByText('SLD Gambar Utama')).toBeInTheDocument()
    expect(screen.getByText('Kalkulasi Beban Saluran')).toBeInTheDocument()

    // Action buttons visible for author
    expect(screen.getByRole('button', { name: /Simpan Draf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ajukan Paket Gambar/i })).toBeInTheDocument()
  })

  it('renders extended chain stepper (4 stages including Asman Niaga & Manager UP3) with badge and reason', async () => {
    const extendedDrawing = {
      ...baseDrawing,
      versions: [
        {
          ...baseDrawing.versions[0],
          extended_approval: true,
          extended_reason: 'PBP melebihi 5 tahun dan investasi memerlukan kajian kelayakan lanjutan.',
          required_steps: ['ULP_MANAGER', 'UP3_REVIEW', 'ASMAN', 'UP3_MANAGER'],
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: extendedDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Persetujuan Diperluas')).toBeInTheDocument()
      expect(screen.getByText(/PBP melebihi 5 tahun dan investasi/i)).toBeInTheDocument()
    })

    // 4 stages check
    expect(screen.getByText(/1. Manager ULP/i)).toBeInTheDocument()
    expect(screen.getByText(/2. Review UP3/i)).toBeInTheDocument()
    expect(screen.getByText(/3. Persetujuan Asman/i)).toBeInTheDocument()
    expect(screen.getByText(/Niaga:/i)).toBeInTheDocument()
    expect(screen.getByText(/4. Manager UP3/i)).toBeInTheDocument()
  })

  it('locks the form read-only when drawing version is submitted or user lacks can.execute', async () => {
    const submittedDrawing = {
      ...baseDrawing,
      can: { assign: false, execute: false, revise: false, escalate: false, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseDrawing.versions[0],
          status: 'SUBMITTED',
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: submittedDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Paket Gambar #DRW-202611-0001/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Simpan Draf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajukan Paket Gambar/i })).not.toBeInTheDocument()

    // Read-only text is rendered
    expect(screen.getByText('Single Line Diagram (SLD) Gardu Trafo 100 kVA')).toBeInTheDocument()
    expect(screen.getByText(/Rancangan penarikan jaringan SUTM 3 fasa/i)).toBeInTheDocument()
  })

  it('previews an Excel main file as a table, opened automatically for the approver, without downloading', async () => {
    const user = userEvent.setup()
    documentApi.preview.mockResolvedValueOnce({
      data: { sheets: [{ name: 'RAB', rows: [['Uraian', 'Volume'], ['Tiang beton 11m', '3']], total_rows: 2, total_cols: 2, truncated: false }] },
    })
    const drawing = {
      ...baseDrawing,
      can: { assign: false, execute: false, revise: false, escalate: false, decide: ['UP3_REVIEW'] },
      versions: [{
        ...baseDrawing.versions[0],
        status: 'UNDER_REVIEW',
        stage: 'UP3_REVIEW',
        documents: [{ id: 'doc-x', file_role: 'MAIN', title: 'Gambar', original_name: 'gambar.xlsx', extension: 'xlsx', mime_type: 'x', size_bytes: 2048 }],
      }],
    }
    drawingApi.get.mockResolvedValueOnce({ data: drawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    expect(await screen.findByText('Tiang beton 11m')).toBeInTheDocument()
    expect(documentApi.preview).toHaveBeenCalledWith('doc-x')
    expect(documentApi.downloadBlob).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Tutup Pratinjau/i }))
    expect(screen.queryByText('Tiang beton 11m')).not.toBeInTheDocument()
  })

  it('shows the Excel as a rendered view when the server can render, and falls back to the table when the render fails', async () => {
    documentApi.preview.mockResolvedValueOnce({
      data: { render_available: true, sheets: [{ name: 'RAB', rows: [['Uraian'], ['Tiang beton 11m']], total_rows: 2, total_cols: 1, truncated: false }] },
    })
    documentApi.previewPdfBlob.mockRejectedValueOnce(new Error('Render gagal.'))
    drawingApi.get.mockResolvedValueOnce({ data: {
      ...baseDrawing,
      can: { assign: false, execute: false, revise: false, escalate: false, decide: ['UP3_REVIEW'] },
      versions: [{ ...baseDrawing.versions[0], status: 'UNDER_REVIEW', stage: 'UP3_REVIEW',
        documents: [{ id: 'doc-y', file_role: 'MAIN', title: 'G', original_name: 'g.xlsx', extension: 'xlsx', mime_type: 'x', size_bytes: 10 }] }],
    } })
    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )
    await waitFor(() => expect(documentApi.previewPdfBlob).toHaveBeenCalledWith('doc-y'))
    expect(await screen.findByText('Tiang beton 11m')).toBeInTheDocument()
    expect(screen.getByText(/Render gagal\. Menampilkan tabel/)).toBeInTheDocument()
  })

  it('shows decision buttons based on can.decide and requires notes on rejection', async () => {
    const user = userEvent.setup()
    const underReviewDrawing = {
      ...baseDrawing,
      can: { assign: false, execute: false, revise: false, escalate: false, decide: ['ASMAN_NIAGA'] },
      versions: [
        {
          ...baseDrawing.versions[0],
          status: 'UNDER_REVIEW',
          stage: 'ASMAN',
          extended_approval: true,
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: underReviewDrawing })
    drawingApi.decide.mockResolvedValueOnce({
      data: underReviewDrawing,
      result: { version_status: 'RETURNED', new_version_id: 'ver-drw-2' },
    })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Keputusan persetujuan Anda diperlukan/i)).toBeInTheDocument()
    })

    // Step button
    expect(screen.getAllByText(/Persetujuan Asman Niaga/i).length).toBeGreaterThan(0)
    const rejectBtn = screen.getByRole('button', { name: /Tolak/i })
    await user.click(rejectBtn)

    expect(screen.getByText(/Tolak Gambar \(Persetujuan Asman Niaga\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Berkas harus diunggah ulang pada draf baru tersebut/i)).toBeInTheDocument()

    // Submit reject without reason
    const confirmReject = screen.getByRole('button', { name: /Konfirmasi Tolak/i })
    await user.click(confirmReject)
    expect(drawingApi.decide).not.toHaveBeenCalled()

    // Fill notes
    const textarea = screen.getByPlaceholderText(/Sebutkan instruksi revisi desain/i)
    await user.type(textarea, 'Kajian tarif B2 perlu disesuaikan dengan skema tarif industri.')

    await user.click(confirmReject)

    await waitFor(() => {
      expect(drawingApi.decide).toHaveBeenCalledWith('drw-uuid-1', 'ver-drw-1', {
        step: 'ASMAN_NIAGA',
        decision: 'REJECTED',
        notes: 'Kajian tarif B2 perlu disesuaikan dengan skema tarif industri.',
      })
    })
  })

  it('allows revision post-APPROVED with information that old version remains valid', async () => {
    const user = userEvent.setup()
    const approvedDrawing = {
      ...baseDrawing,
      can: { assign: false, execute: false, revise: true, escalate: false, decide: [] },
      versions: [
        {
          ...baseDrawing.versions[0],
          status: 'APPROVED',
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: approvedDrawing })
    drawingApi.revise.mockResolvedValueOnce({ data: approvedDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Buat Revisi/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Buat Revisi/i }))

    const confirmReviseBtn = await screen.findByRole('button', { name: 'Buat Revisi Baru' })
    await user.click(confirmReviseBtn)

    await waitFor(() => {
      expect(drawingApi.revise).toHaveBeenCalledWith('drw-uuid-1')
    })
  })

  it('supports escalating to extended approval with required reason', async () => {
    const user = userEvent.setup()
    drawingApi.get.mockResolvedValueOnce({ data: baseDrawing })
    drawingApi.escalate.mockResolvedValueOnce({ data: baseDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Wajibkan Persetujuan Diperluas/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Wajibkan Persetujuan Diperluas/i }))

    expect(screen.getByText(/Tindakan ini tidak dapat dibatalkan/i)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/Hasil kajian tidak layak atau PBP > 5 tahun/i)
    await user.type(textarea, 'Investasi tiang melebihi pagu unit dan perlu izin Manager UP3.')

    const submitEscalate = screen.getByRole('button', { name: /Konfirmasi Eskalasi/i })
    await user.click(submitEscalate)

    await waitFor(() => {
      expect(drawingApi.escalate).toHaveBeenCalledWith('drw-uuid-1', 'ver-drw-1', {
        reason: 'Investasi tiang melebihi pagu unit dan perlu izin Manager UP3.',
      })
    })
  })

  it('hides decision and escalation buttons and displays banner when with_survey is true (docs/62 §48)', async () => {
    const withSurveyDrawing = {
      ...baseDrawing,
      survey_id: 'srv-uuid-123',
      can: { assign: false, execute: false, revise: false, escalate: true, decide: ['ULP_MANAGER'] },
      versions: [
        {
          ...baseDrawing.versions[0],
          status: 'SUBMITTED',
          stage: 'ULP_MANAGER',
          with_survey: true,
          survey_version_id: 'srv-ver-123',
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: withSurveyDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Gambar ini diputuskan bersama survei \(satu paket\)/i)).toBeInTheDocument()
    })

    // Decision bar and escalate button should NOT be rendered
    expect(screen.queryByText(/Keputusan persetujuan Anda diperlukan/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Wajibkan Persetujuan Diperluas/i })).not.toBeInTheDocument()

    // Link to survey should exist
    const surveyLink = screen.getByRole('link', { name: /Lihat Survei/i })
    expect(surveyLink).toBeInTheDocument()
    expect(surveyLink).toHaveAttribute('href', '/survei/srv-uuid-123')
  })

  it('renders "Dikembalikan: usulan dibatalkan" and main drawing upload guidance (docs/62 §48)', async () => {
    const cancelledDrawing = {
      ...baseDrawing,
      versions: [
        {
          ...baseDrawing.versions[0],
          status: 'RETURNED',
          returned_at_step: 'PROPOSAL_CANCELLED',
          return_reason: 'Usulan dibatalkan oleh pemohon: pelanggan mengundurkan diri',
          documents: [],
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: cancelledDrawing })

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Paket gambar ini/i)).toBeInTheDocument()
    })

    expect(screen.getAllByText(/Dikembalikan: usulan dibatalkan/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/pelanggan mengundurkan diri/i)).toBeInTheDocument()
  })

  it('automatically generates title using application agenda and customer name, replacing fallback placeholder', async () => {
    const draftDrawing = {
      ...baseDrawing,
      application: {
        id: 'app-uuid-1',
        application_number: 'PBPD-51453-2026-00326',
        application_type: 'PB',
        status: 'APPROVED',
      },
      versions: [
        {
          ...baseDrawing.versions[0],
          title: 'GBR_USULAN_PBPD-51453-2026-00326_NAMA PELANGGAN', // old fallback
        },
      ],
    }
    drawingApi.get.mockResolvedValueOnce({ data: draftDrawing })

    const appWithDetails = {
      id: 'app-uuid-1',
      application_number: 'PBPD-51453-2026-00326',
      customer: {
        name: 'SUPARMAN JAYA',
      },
      external_references: [
        { reference_type: 'AGENDA', reference_number: '514539912610278772', is_active: true },
      ],
    }

    render(
      <MemoryRouter>
        <DrawingDetailView drawingId="drw-uuid-1" application={appWithDetails} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('GBR_USULAN_514539912610278772_SUPARMAN JAYA')).toBeInTheDocument()
    })
  })
  describe('flow guidance by status', () => {
    const mount = async (drawing) => {
      drawingApi.get.mockResolvedValueOnce({ data: drawing })
      render(
        <MemoryRouter>
          <DrawingDetailView drawingId="drw-uuid-1" />
        </MemoryRouter>
      )
      await waitFor(() => expect(screen.getByText(/Paket Gambar #DRW-202611-0001/i)).toBeInTheDocument())
    }
    const withVersion = (patch, can = {}) => ({
      ...baseDrawing,
      can: { ...baseDrawing.can, ...can },
      versions: [{ ...baseDrawing.versions[0], ...patch }],
    })

    it('tells the drafter what to do and marks the review steps as waiting for submission', async () => {
      await mount(baseDrawing)
      expect(screen.getByText(/Draf masih di tangan Anda/i)).toBeInTheDocument()
      expect(screen.getAllByText('Menunggu pengajuan').length).toBeGreaterThanOrEqual(4)
    })

    it('tells other roles that a draft is not submitted yet, so nothing is reviewable', async () => {
      await mount(withVersion({}, { execute: false }))
      expect(screen.getByText(/belum diajukan, sehingga belum ada yang perlu direview/i)).toBeInTheDocument()
    })

    it('asks the unit manager first once submitted and shows "Belum" instead of the waiting label', async () => {
      await mount(withVersion({ status: 'SUBMITTED', stage: 'ULP_MANAGER' }, { execute: false }))
      expect(screen.getByText(/Gambar dan MTO diputuskan dalam satu keputusan/i)).toBeInTheDocument()
      expect(screen.queryByText('Menunggu pengajuan')).not.toBeInTheDocument()
      expect(screen.getAllByText('Belum').length).toBeGreaterThanOrEqual(4)
    })

    it('names Perencanaan and Konstruksi UP3 during the UP3 review', async () => {
      await mount(withVersion({ status: 'UNDER_REVIEW', stage: 'UP3_REVIEW' }, { execute: false }))
      expect(screen.getByText(/Menunggu review Perencanaan dan Konstruksi UP3/i)).toBeInTheDocument()
    })

    it('names the Asman during the Asman stage and adds Asman Niaga when extended', async () => {
      await mount(withVersion({ status: 'UNDER_REVIEW', stage: 'ASMAN', extended_approval: true, extended_reason: 'PBP > 5 tahun' }, { execute: false }))
      expect(screen.getByText(/Menunggu persetujuan Asman Perencanaan dan Asman Konstruksi serta Asman Niaga/i)).toBeInTheDocument()
    })

    it('says the version is in force once approved', async () => {
      await mount(withVersion({ status: 'APPROVED', stage: 'APPROVED' }, { execute: false }))
      expect(screen.getByText(/Semua tahap persetujuan selesai/i)).toBeInTheDocument()
    })

    it('keeps the approval chain above two tabs and shows the MTO only in its own tab', async () => {
      await mount(withVersion({}, { execute: false }))
      expect(screen.getByRole('tab', { name: /Gambar & Berkas/i })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText(/Rantai Persetujuan Versi 1/i)).toBeInTheDocument()
      expect(screen.queryByText(/Kalkulasi Material Take-Off/i)).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('tab', { name: /Kalkulasi MTO/i }))
      expect(screen.getByText(/Kalkulasi Material Take-Off/i)).toBeInTheDocument()
      expect(screen.getByText(/Rantai Persetujuan Versi 1/i)).toBeInTheDocument()   // still visible in the MTO tab
    })

    it('hints why the submit button is disabled while the main file is missing', async () => {
      await mount(withVersion({ documents: [] }))
      expect(screen.getByText(/Unggah berkas gambar utama untuk mengaktifkan pengajuan/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Ajukan Paket Gambar/i })).toBeDisabled()
    })
  })
})
