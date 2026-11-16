import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import SurveyRequestsPage, { surveyActionLabel } from './SurveyRequestsPage.jsx'
import { ApplicationDetailDrawer } from '../applications/ApplicationsPage.jsx'
import { surveyApi, proposalsApi, applicationApi, drawingApi, documentApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  surveyApi: { list: vi.fn(), create: vi.fn(), listForApplication: vi.fn(), access: vi.fn(), get: vi.fn() },
  proposalsApi: { selectable: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), issue: vi.fn() },
  applicationApi: { get: vi.fn(), list: vi.fn(), access: vi.fn() },
  drawingApi: { forApplication: vi.fn() },
  documentApi: { listForApplication: vi.fn() },
  triggerFileDownload: vi.fn(),
}))

function renderWith(ui, { can = {}, route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={{ user: { id: 'u-1', email: 't@pln.co.id', name: 'Teknik' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const rows = [
  {
    id: 's-1', survey_number: 'SRV-PBPD-1-1', status: 'ACTIVE', outcome: 'PENDING', kind: 'INDIVIDUAL', members_count: 1, customer_names: ['SUHELMI'],
    version_status: 'DRAFT', version_stage: null, application: { id: 'a-1', application_number: 'PBPD-1', customer_name: 'SUHELMI' }, proposal: null, unit: { code: '51453', name: 'ULP Jombang' },
    surveyor_name: 'teknik jombang', created_at: '2026-11-10T01:00:00Z',
  },
  {
    id: 's-2', survey_number: 'SRV-PBPD-2-1', status: 'ACCEPTED', outcome: 'EXTENSION', kind: 'COLLECTIVE', members_count: 3, customer_names: ['CV A', 'CV B'],
    version_status: 'ACCEPTED', version_stage: null, application: { id: 'a-2', application_number: 'PBPD-2', customer_name: 'CV A' },
    proposal: { id: 'p-1', proposal_number: '00001/USULAN-PBPD/10-11/51453/2026', issued: true }, unit: { code: '51453', name: 'ULP Jombang' }, surveyor_name: 'teknik jombang', created_at: '2026-11-10T01:00:00Z',
    members: [
      { application_id: 'a-2', application_number: 'PBPD-2', status: 'APPROVED', new_tariff_code: 'R3', new_power_value: 6600, new_power_unit: 'VA', customer_name: 'CV A' },
      { application_id: 'a-5', application_number: 'PBPD-5', status: 'PAID', new_tariff_code: 'R1', new_power_value: 2200, new_power_unit: 'VA', customer_name: 'CV B' },
      { application_id: 'a-6', application_number: 'PBPD-6', status: 'PK_PRINTED', new_tariff_code: 'R1', new_power_value: 1300, new_power_unit: 'VA', customer_name: 'CV C' },
    ],
  },
  {
    id: 's-3', survey_number: 'SRV-PBPD-3-1', status: 'ACCEPTED', outcome: 'NO_EXTENSION', kind: 'INDIVIDUAL', members_count: 1, customer_names: ['PP HASBULLAH'],
    version_status: 'ACCEPTED', version_stage: null, application: { id: 'a-3', application_number: 'PBPD-3', customer_name: 'PP HASBULLAH' }, proposal: null, unit: { code: '51453', name: 'ULP Jombang' },
    surveyor_name: 'teknik jombang', created_at: '2026-11-10T01:00:00Z',
  },
]

describe('Usulan Survei', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    surveyApi.list.mockResolvedValue({ data: rows, meta: { current_page: 1, per_page: 10, total: 3, last_page: 1 } })
    proposalsApi.selectable.mockResolvedValue({ data: [], meta: { total: 0, current_page: 1, last_page: 1 } })
  })

  it('menampilkan jenis, hasil survei, dan nomor usulan hanya bila terbit', async () => {
    renderWith(<SurveyRequestsPage />, { can: { 'surveys.view': true, 'surveys.execute': true } })
    expect(await screen.findByText('SRV-PBPD-1-1')).toBeInTheDocument()
    const body = within(screen.getAllByTestId('survey-request-row')[0].closest('tbody'))
    expect(body.getByText('Menunggu hasil')).toBeInTheDocument()
    expect(body.getByText('Perlu perluasan')).toBeInTheDocument()
    expect(body.getByText(/Tanpa perluasan · siap pasang/)).toBeInTheDocument()
    expect(screen.getByText('Kolektif · 3')).toBeInTheDocument()
    expect(screen.getByText('00001/USULAN-PBPD/10-11/51453/2026')).toBeInTheDocument()
    expect(screen.getByText('tidak diperlukan')).toBeInTheDocument()
    expect(screen.getByText('belum terbit')).toBeInTheDocument()
    expect(screen.getByText('CV A, CV B +1')).toBeInTheDocument()
  })

  it('tombol tambah survei hanya untuk Teknik (surveys.execute) dan filter hasil dikirim ke server', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWith(<SurveyRequestsPage />, { can: { 'surveys.view': true } })
    await screen.findByText('SRV-PBPD-1-1')
    expect(screen.queryByRole('button', { name: /Tambah Survei/i })).not.toBeInTheDocument()
    unmount()

    renderWith(<SurveyRequestsPage />, { can: { 'surveys.view': true, 'surveys.execute': true } })
    await screen.findByText('SRV-PBPD-1-1')
    expect(screen.getByRole('button', { name: /Tambah Survei Perorangan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tambah Survei Kolektif/i })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Hasil survei'), 'NO_EXTENSION')
    await waitFor(() => expect(surveyApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'NO_EXTENSION' })))
  })

  it('survei kolektif memanggil POST /proposals dengan start_survey dan butuh minimal dua pelanggan', async () => {
    const user = userEvent.setup()
    const cust = (n) => ({ id: `a-${n}`, application_number: `PBPD-${n}`, application_type: 'PB', customer_name: `Pelanggan ${n}`, idpel: null, new_tariff_code: 'B2', new_power_value: 6600, new_power_unit: 'VA', service_address: 'Jl', ulp_name: 'ULP Jombang' })
    proposalsApi.selectable.mockResolvedValue({ data: [cust(1), cust(2)], meta: { total: 2, current_page: 1, last_page: 1, per_page: 10 } })
    proposalsApi.create.mockResolvedValue({ data: { id: 'p-9', survey_id: 's-9', survey_number: 'SRV-9' } })
    renderWith(<SurveyRequestsPage />, { can: { 'surveys.view': true, 'surveys.execute': true } })
    await user.click(await screen.findByRole('button', { name: /Tambah Survei Kolektif/i }))
    expect(proposalsApi.selectable).toHaveBeenCalledWith(expect.objectContaining({ for_survey: 1 }))
    const boxes = await screen.findAllByRole('checkbox')
    await user.click(boxes[0])
    await user.click(screen.getByRole('button', { name: /Mulai Survei \(1\)/i }))
    expect(await screen.findByText(/minimal dua pelanggan/i)).toBeInTheDocument()
    expect(proposalsApi.create).not.toHaveBeenCalled()
    await user.click(boxes[1])
    await user.click(screen.getByRole('button', { name: /Mulai Survei \(2\)/i }))
    await waitFor(() => expect(proposalsApi.create).toHaveBeenCalledWith({ application_ids: ['a-1', 'a-2'], title: undefined, start_survey: true }))
  })
})

describe('Drawer permohonan: tab mengikuti hasil survei (docs/82 §11)', () => {
  const base = { id: 'app-1', application_number: 'PBPD-1', application_type: 'PD', transaction_type: 'PERUBAHAN DAYA', status: 'APPROVED', customer: { name: 'X' }, unit: { id: 'u', code: '1', name: 'ULP' }, status_history: [] }
  beforeEach(() => {
    vi.clearAllMocks()
    surveyApi.listForApplication.mockResolvedValue({ data: [] })
    drawingApi.forApplication.mockResolvedValue({ data: null })
    documentApi.listForApplication.mockResolvedValue({ data: [] })
  })
  const open = (can = {}) =>
    renderWith(<ApplicationDetailDrawer applicationId="app-1" canViewSurvey canViewDrawing canViewKkf canViewAllocations canWoView canExecuteSurvey onClose={vi.fn()} />, { can })

  it('sebelum survei hanya Ringkasan dan Survei & Pengukuran; tombol Tugaskan Survei tidak ada', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: null, proposal: null } })
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'Ringkasan Permohonan' })
    expect(screen.getByRole('button', { name: /Survei & Pengukuran/i })).toBeInTheDocument()
    for (const n of [/Gambar Teknik/i, /Dokumen & Bukti/i, /Kajian Finansial/i, /Alokasi Material/i, /SPK \/ Work Order/i]) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Survei & Pengukuran/i }))
    expect(screen.queryByRole('button', { name: /Tugaskan Survei/i })).not.toBeInTheDocument()
  })

  it('survei tanpa perluasan tidak membuka alur teknis', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: { status: 'ACCEPTED', outcome: 'NO_EXTENSION', ready_to_install: true }, proposal: null } })
    open()
    await screen.findByRole('button', { name: 'Ringkasan Permohonan' })
    expect(screen.queryByRole('button', { name: /Gambar Teknik/i })).not.toBeInTheDocument()
  })

  it('survei kolektif yang belum terbit menampilkan banner tanpa nomor usulan dan tanpa tab teknis', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: { status: 'ACTIVE', outcome: null }, proposal: { id: 'p', proposal_number: null, issued: false, members_count: 2, is_representative: true, representative_application_id: 'app-1' } } })
    open()
    expect(await screen.findByText(/Survei kolektif: 2 pelanggan/)).toBeInTheDocument()
    expect(screen.getByText(/Nomor usulan terbit bila hasil survei memerlukan perluasan/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gambar Teknik/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Buka Usulan/)).not.toBeInTheDocument()
  })

  it('survei disetujui perlu perluasan tetapi usulan belum dibuat: alur teknis tertutup dan Teknik dapat Buat Usulan', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: { status: 'ACCEPTED', outcome: 'EXTENSION' }, proposal: null } })
    proposalsApi.issue.mockResolvedValue({ data: { id: 'p', proposal_number: '00001/USULAN-PBPD/10-11/51453/2026' } })
    const user = userEvent.setup()
    renderWith(<ApplicationDetailDrawer applicationId="app-1" canViewSurvey canViewDrawing canViewKkf canIssueProposal onClose={vi.fn()} />, { can: {} })
    expect(await screen.findByTestId('needs-proposal-banner')).toHaveTextContent(/Teknik ULP membuat usulan/)
    expect(screen.queryByRole('button', { name: /Gambar Teknik/i })).not.toBeInTheDocument()
    // drawer = pratinjau: tombol mengarahkan ke Usulan Survei, tidak membuat usulan dari drawer
    await user.click(screen.getByRole('button', { name: /Buat Usulan di Usulan Survei/ }))
    expect(proposalsApi.issue).not.toHaveBeenCalled()
  })

  it('tanpa izin membuat usulan tombol tidak tampil', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: { status: 'ACCEPTED', outcome: 'EXTENSION' }, proposal: null } })
    renderWith(<ApplicationDetailDrawer applicationId="app-1" canViewSurvey onClose={vi.fn()} />, { can: {} })
    expect(await screen.findByTestId('needs-proposal-banner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat Usulan/ })).not.toBeInTheDocument()
  })

  it('survei disetujui perlu perluasan: alur teknis terbuka dan banner usulan terbit tampil', async () => {
    applicationApi.get.mockResolvedValue({ data: { ...base, survey: { status: 'ACCEPTED', outcome: 'EXTENSION' }, proposal: { id: 'p', proposal_number: '00001/USULAN-PBPD/10-11/51453/2026', issued: true, members_count: 1, is_representative: true, representative_application_id: 'app-1' } } })
    open()
    expect(await screen.findByText(/Usulan 00001\/USULAN-PBPD\/10-11\/51453\/2026: 1 pelanggan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gambar Teknik/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dokumen & Bukti/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kajian Finansial/i })).toBeInTheDocument()
  })
})

describe('Aksi pada daftar Usulan Survei dan arahan dari drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    surveyApi.list.mockResolvedValue({ data: rows, meta: { total: rows.length } })
    proposalsApi.selectable.mockResolvedValue({ data: [], meta: { total: 0 } })
  })

  it('nama aksi mengikuti status survei dan peran', () => {
    expect(surveyActionLabel({ status: 'ACTIVE', version_status: 'DRAFT' }, true)).toBe('Isi Hasil Survei')
    expect(surveyActionLabel({ status: 'ACTIVE', version_status: 'DRAFT' }, false)).toBe('Lihat Survei')
    expect(surveyActionLabel({ status: 'ACTIVE', version_status: 'SUBMITTED' }, true)).toBe('Lihat Persetujuan')
    expect(surveyActionLabel({ status: 'ACCEPTED', version_status: 'ACCEPTED' }, true)).toBe('Lihat Hasil Survei')
    expect(surveyActionLabel({ status: 'CANCELLED' }, true)).toBe('Lihat Survei')
  })

  it('baris memakai nama aksi baru dan tombol permohonan menjadi Lihat Permohonan', async () => {
    renderWith(<SurveyRequestsPage />, { can: { 'surveys.execute': true } })
    await screen.findAllByTestId('survey-request-row')
    expect(screen.getByRole('button', { name: 'Isi Hasil Survei' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Lihat Hasil Survei' }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Lihat Permohonan' }).length).toBe(2)                  // perorangan
    expect(screen.getByRole('button', { name: 'Lihat Permohonan (3)' })).toBeInTheDocument()            // kolektif: jumlah anggota
    expect(screen.queryByRole('button', { name: 'Buka Survei' })).not.toBeInTheDocument()
  })

  it('Lihat Permohonan membuka datanya di halaman ini (tanpa pindah ke Permohonan PB/PD), perorangan langsung dan kolektif per pelanggan anggota', async () => {
    const detail = (id, name) => ({ data: { id, application_number: `PBPD-${id}`, application_type: 'PB', transaction_type: 'PASANG BARU', status: 'APPROVED', customer: { name }, unit: { id: 'u', code: '51453', name: 'ULP Jombang' }, survey: null, proposal: null } })
    surveyApi.listForApplication.mockResolvedValue({ data: [] })
    drawingApi.forApplication.mockResolvedValue({ data: null })
    documentApi.listForApplication.mockResolvedValue({ data: [] })
    applicationApi.get.mockImplementation((id) => Promise.resolve(detail(id, id === 'a-5' ? 'CV B' : 'SUHELMI')))
    const user = userEvent.setup()
    renderWith(<SurveyRequestsPage />, { can: { 'surveys.view': true } })
    await screen.findAllByTestId('survey-request-row')

    await user.click(screen.getAllByRole('button', { name: 'Lihat Permohonan' })[0])                      // perorangan
    await waitFor(() => expect(applicationApi.get).toHaveBeenCalledWith('a-1'))
    expect((await screen.findAllByText(/PBPD-a-1/)).length).toBeGreaterThan(0)                              // data permohonan tampil
    expect(screen.getByText('SRV-PBPD-1-1')).toBeInTheDocument()                                          // dan halaman Usulan Survei tetap di belakangnya

    await user.click(screen.getAllByRole('button', { name: /Tutup/i })[0])
    await user.click(screen.getByRole('button', { name: 'Lihat Permohonan (3)' }))                        // kolektif: pilih pelanggan anggota
    expect(await screen.findByText('Pelanggan dalam survei kolektif SRV-PBPD-2-1')).toBeInTheDocument()
    expect(screen.getByText('CV B')).toBeInTheDocument()
    expect(screen.getByText('Pelanggan utama')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lihat permohonan CV B' }))
    await waitFor(() => expect(applicationApi.get).toHaveBeenCalledWith('a-5'))
    expect((await screen.findAllByText(/PBPD-a-5/)).length).toBeGreaterThan(0)
  })

  it('?mulai=<no. permohonan> dari drawer langsung membuka dialog survei perorangan yang tersaring ke pelanggan itu', async () => {
    renderWith(<SurveyRequestsPage />, { can: { 'surveys.execute': true }, route: '/permohonan?tab=survei&mulai=PBPD-1' })
    await waitFor(() => expect(proposalsApi.selectable).toHaveBeenCalled())
    expect(proposalsApi.selectable.mock.calls.some(([q]) => JSON.stringify(q).includes('PBPD-1'))).toBe(true)
  })

  it('?mulai= tidak membuka dialog bagi peran yang tidak boleh memulai survei', async () => {
    renderWith(<SurveyRequestsPage />, { can: {}, route: '/permohonan?tab=survei&mulai=PBPD-1' })
    await screen.findAllByTestId('survey-request-row')
    expect(proposalsApi.selectable).not.toHaveBeenCalled()
  })
})
