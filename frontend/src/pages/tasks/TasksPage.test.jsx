import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import TasksPage, { taskActions, formatDue } from './TasksPage.jsx'
import { tasksApi, slaApi, serviceSlaApi, unitScopeApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  tasksApi: { list: vi.fn(), summary: vi.fn(), step: vi.fn(), assignees: vi.fn(), create: vi.fn() },
  slaApi: { configurations: vi.fn(), holidays: vi.fn(), update: vi.fn(), addHoliday: vi.fn(), removeHoliday: vi.fn() },
  serviceSlaApi: { list: vi.fn(), summary: vi.fn(), forApplication: vi.fn(), addNote: vi.fn() },
  applicationApi: { list: vi.fn() },
  unitScopeApi: { get: vi.fn() },
  notificationsApi: { list: vi.fn().mockResolvedValue({ data: [] }), markRead: vi.fn(), markAllRead: vi.fn() },
}))

function renderPage({ can = { 'tasks.view': true }, userId = 'u-1' } = {}) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: userId, name: 'Teknik' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider><TasksPage /></NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const task = (over = {}) => ({
  id: 't-1', application_id: 'a-1', application_number: 'PBPD-1', task_type: 'SURVEI', type_label: 'Survei lapangan', title: 'Survei lokasi pelanggan', description: null, status: 'ASSIGNED',
  assignee_id: 'u-1', assignee_name: 'Teknik Jombang', assigned_by: 'm-1', assigned_by_name: 'Manager', due_at: '2026-12-09T16:59:59Z', is_overdue: false, is_due_soon: false, review_note: null, ...over,
})

describe('taskActions', () => {
  const as = (t, ctx) => taskActions(t, ctx).map((a) => a.step)

  it('penerima menerima, memulai, lalu mengajukan', () => {
    expect(as(task(), { userId: 'u-1', canAssign: false })).toEqual(['accept', 'start'])
    expect(as(task({ status: 'IN_PROGRESS' }), { userId: 'u-1', canAssign: false })).toEqual(['submit'])
    expect(as(task({ status: 'SUBMITTED' }), { userId: 'u-1', canAssign: false })).toEqual([])
  })

  it('pemberi tugas memeriksa tugas orang lain, tidak tugasnya sendiri', () => {
    expect(as(task({ status: 'SUBMITTED', assignee_id: 'u-9' }), { userId: 'm-1', canAssign: true })).toEqual(['complete', 'return', 'reassign', 'cancel'])
    expect(as(task({ status: 'SUBMITTED', assignee_id: 'm-1' }), { userId: 'm-1', canAssign: true })).toEqual(['reassign', 'cancel'])
  })

  it('tugas selesai atau dibatalkan tidak punya aksi', () => {
    expect(as(task({ status: 'COMPLETED' }), { userId: 'u-1', canAssign: true })).toEqual([])
    expect(as(task({ status: 'CANCELLED' }), { userId: 'm-1', canAssign: true })).toEqual([])
  })

  it('tenggat kosong ditulis jelas', () => {
    expect(formatDue(null)).toBe('Tanpa tenggat')
  })
})

describe('Halaman Tugas & SLA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tasksApi.summary.mockResolvedValue({ data: { mine_open: 1, mine_overdue: 1, awaiting_my_review: 0, unit_overdue: 2 } })
    tasksApi.list.mockResolvedValue({ data: [task({ is_overdue: true })], meta: { current_page: 1, last_page: 1, total: 1 } })
    tasksApi.step.mockResolvedValue({ message: 'Tugas dimulai.' })
    slaApi.configurations.mockResolvedValue({ data: [{ task_type: 'SURVEI', label: 'Survei lapangan', working_days: 3, is_active: true }], can: { manage: false, assign: false } })
    slaApi.holidays.mockResolvedValue({ data: [] })
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
      ulp_units: [{ id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' }, { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' }],
    })
  })

  it('filter UP3 dan ULP mengirim up3_id dan unit_id ke server dan ULP menyempit ke UP3 terpilih', async () => {
    renderPage()
    await screen.findByText('Survei lokasi pelanggan')

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Satu/ }))
    await vi.waitFor(() => expect(tasksApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1' })))

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit ULP' }))
    expect(screen.queryByRole('option', { name: /ULP Dua/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /ULP Satu/ }))
    await vi.waitFor(() => expect(tasksApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1', unit_id: 'ulp-1' })))
  })

  it('menampilkan tugas dengan penanda terlambat dan memulainya', async () => {
    renderPage()
    expect(await screen.findByText('Survei lokasi pelanggan')).toBeInTheDocument()
    expect(screen.getByText('Terlambat', { selector: 'span' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mulai' }))
    expect(tasksApi.step).toHaveBeenCalledWith('t-1', 'start', undefined)
  })

  it('hanya pemegang izin menugaskan melihat tombol Tugas baru dan tab Perlu diperiksa', async () => {
    renderPage()
    await screen.findByText('Survei lokasi pelanggan')
    expect(screen.queryByRole('button', { name: /Tugas baru/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Perlu diperiksa' })).not.toBeInTheDocument()
  })

  it('pengaturan SLA tampil hanya baca bagi yang bukan administrator', async () => {
    renderPage()
    await screen.findByText('Survei lokasi pelanggan')
    await userEvent.click(screen.getByRole('tab', { name: 'Pengaturan SLA' }))
    expect(await screen.findByText('3 hari kerja')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan' })).not.toBeInTheDocument()
  })

  it('SLA layanan menandai permohonan yang melewati SLA, menampilkan material kurang, dan menyimpan keterangan', async () => {
    serviceSlaApi.summary.mockResolvedValue({ data: { overdue: 1, due_soon: 0, on_track: 2, met_late: 0 } })
    serviceSlaApi.list.mockResolvedValue({
      data: [{ application_id: 'a-1', application_number: 'PBPD-1', customer_name: 'SITI', unit_name: 'ULP Jombang', category_label: 'Layanan: tambah tiang JTR saja', working_days: 14, status: 'OVERDUE', late_working_days: 3,
        due_at: '2026-11-10T16:59:59Z', start_basis: 'PAID', last_note: null }],
      meta: { current_page: 1, last_page: 1, total: 1 },
    })
    serviceSlaApi.forApplication.mockResolvedValue({
      data: { materials: { known: true, complete: false, shortfall: [{ khs_code: 'JTR001', khs_name: 'Kabel TIC 3x70', remaining: 120, unit_text: 'ms' }] }, notes: [] },
      can: { note: true },
    })
    serviceSlaApi.addNote.mockResolvedValue({ data: {} })
    renderPage()
    await screen.findByText('Survei lokasi pelanggan')
    await userEvent.click(screen.getByRole('tab', { name: 'SLA layanan' }))
    expect(await screen.findByText(/Melewati SLA 3 hari kerja/)).toBeInTheDocument()
    expect(screen.getByText('Belum ada keterangan keterlambatan.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Keterangan & material/ }))
    expect(await screen.findByText(/JTR001/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Tambah keterangan'), 'Kabel belum tersedia')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan keterangan' }))
    expect(serviceSlaApi.addNote).toHaveBeenCalledWith('a-1', 'Kabel belum tersedia')
  })
})
