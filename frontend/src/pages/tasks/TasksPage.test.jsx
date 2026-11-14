import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import TasksPage, { taskActions, formatDue } from './TasksPage.jsx'
import { tasksApi, slaApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  tasksApi: { list: vi.fn(), summary: vi.fn(), step: vi.fn(), assignees: vi.fn(), create: vi.fn() },
  slaApi: { configurations: vi.fn(), holidays: vi.fn(), update: vi.fn(), addHoliday: vi.fn(), removeHoliday: vi.fn() },
  applicationApi: { list: vi.fn() },
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
})
