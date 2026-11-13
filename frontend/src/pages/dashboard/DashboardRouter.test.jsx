import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import DashboardRouter from './DashboardRouter.jsx'
import { reportsApi, workOrdersApi, materialRequestsApi, applicationApi } from '../../services/api.js'

vi.mock('../../features/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { name: 'Budi', email: 'budi@pln.test' } }),
}))

vi.mock('../../services/api.js', () => ({
  reportsApi: { overview: vi.fn(), pipeline: vi.fn() },
  workOrdersApi: { list: vi.fn() },
  materialRequestsApi: { list: vi.fn() },
  applicationApi: { list: vi.fn() },
}))

function renderDash(access) {
  return render(
    <MemoryRouter>
      <AccessContext.Provider value={{ loading: false, isSysAdmin: false, can: {}, ...access }}>
        <DashboardRouter />
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

const overview = {
  applications: { total: 10, by_status: { APPROVED: 4 } },
  surveys: { by_status: { ACTIVE: 1 } },
  drawings: { latest_version_by_status: { SUBMITTED: 5 } },
  mto: { by_status: { VERIFIED: 2 } },
  bastp: { by_status: { SUBMITTED: 3 } },
  work_orders: { by_status: {} },
  material_requests: { needs_followup: 0 },
}

describe('DashboardRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reportsApi.overview.mockResolvedValue({ data: overview })
    reportsApi.pipeline.mockResolvedValue({ data: [{ applications: 4, with_survey: 1 }] })
    workOrdersApi.list.mockResolvedValue({ data: [] })
    materialRequestsApi.list.mockResolvedValue({ data: [], meta: { total: 0 } })
    applicationApi.list.mockResolvedValue({ data: [] })
  })

  it('Manager ULP melihat antrean persetujuan miliknya dari endpoint laporan', async () => {
    renderDash({ can: { 'surveys.assign': true, 'reports.view': true } })

    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()
    expect(screen.getByText(/Manager ULP/)).toBeInTheDocument()
    expect(await screen.findByText('Gambar menunggu persetujuan Anda')).toBeInTheDocument()
    expect(screen.getByText('MTO menunggu persetujuan Anda')).toBeInTheDocument()
    expect(reportsApi.overview).toHaveBeenCalled()
    // vendor-only data tidak diminta
    expect(workOrdersApi.list).not.toHaveBeenCalled()
  })

  it('Vendor hanya memuat daftar SPK, bukan laporan', async () => {
    workOrdersApi.list.mockResolvedValue({
      data: [{ id: 'w1', wo_number: 'WO-9', application_number: 'APP-9', status: 'ISSUED' }],
    })
    renderDash({ can: { 'vendor.portal': true } })

    expect(await screen.findByText('SPK diterima (belum dikerjakan)')).toBeInTheDocument()
    expect(await screen.findByText('WO-9')).toBeInTheDocument()
    expect(reportsApi.overview).not.toHaveBeenCalled()
  })

  it('kegagalan satu sumber menampilkan peringatan dan angka “–”, bukan layar kosong', async () => {
    reportsApi.overview.mockRejectedValue(new Error('boom'))
    renderDash({ can: { 'surveys.execute': true, 'reports.view': true } })

    expect(await screen.findByText(/Sebagian data dasbor gagal dimuat/)).toBeInTheDocument()
    expect(screen.getByText('Survei berjalan')).toBeInTheDocument()
  })

  it('pengguna dengan dua peran dapat berpindah tampilan', async () => {
    renderDash({ can: { 'surveys.execute': true, 'applications.create': true, 'reports.view': true, 'applications.view': true } })

    const tabs = await screen.findAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(tabs[1])
    await waitFor(() => expect(screen.getByText('Draf belum diajukan')).toBeInTheDocument())
  })

  it('admin sistem memakai beranda umum (modul & alur proses)', async () => {
    renderDash({ isSysAdmin: true, can: {} })
    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()
    expect(screen.getByText(/Alur Proses Distribusi/)).toBeInTheDocument()
    expect(reportsApi.overview).not.toHaveBeenCalled()
  })
})
