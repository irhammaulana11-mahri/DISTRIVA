import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import VendorsPage from './VendorsPage.jsx'
import VendorAccountsPage from './VendorAccountsPage.jsx'
import { vendorsApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  vendorsApi: { list: vi.fn(), linkAccount: vi.fn(), deactivateAccount: vi.fn(), setStatus: vi.fn() },
  adminApi: { users: vi.fn(), units: vi.fn() },
}))

const vendor = { id: 'v1', code: 'PT-LATE', name: 'PT Late', status: 'ACTIVE', work_scope: 'JARINGAN', accounts: [] }

function mount({ isSysAdmin = false } = {}) {
  return render(
    <AccessContext.Provider value={{ loading: false, can: { 'vendors.manage': true }, canWrite: {}, isSysAdmin }}>
      <NotificationProvider>
        <MemoryRouter>
          <Routes>
            <Route path="/master-data/vendors/:id/akun" element={<VendorAccountsPage />} />
            <Route path="*" element={<VendorsPage />} />
          </Routes>
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>,
  )
}

describe('Vendor: akun Pelaksana untuk vendor yang sudah ada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorsApi.list.mockResolvedValue({ data: [vendor] })
    adminApi.users.mockResolvedValue({ data: [] })
    adminApi.units.mockResolvedValue({ data: [{ id: 'u1', name: 'UP3 Jombang', unit_type: 'UP3', is_active: true }] })
    vendorsApi.linkAccount.mockResolvedValue({ data: { id: 'acc1' } })
  })

  it('membuat akun baru langsung tertaut ke vendor; SYS_ADMIN dapat memilih unit penugasan', async () => {
    mount({ isSysAdmin: true })
    await userEvent.click(await screen.findByRole('button', { name: /kelola akun/i }))
    fireEvent.change(await screen.findByLabelText('Nama petugas administrasi'), { target: { value: 'Admin Late' } })
    fireEvent.change(screen.getByLabelText('Email login akun baru'), { target: { value: 'late@pt.test' } })
    fireEvent.change(await screen.findByLabelText('Unit penugasan akun baru'), { target: { value: 'u1' } })
    await userEvent.click(screen.getByRole('button', { name: /buat & undang/i }))
    await waitFor(() => expect(vendorsApi.linkAccount).toHaveBeenCalledWith('v1', { account: { name: 'Admin Late', email: 'late@pt.test', organizational_unit_id: 'u1' } }))
  })

  it('pengguna non-admin tidak melihat pilihan unit (memakai unit penugasannya sendiri)', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /kelola akun/i }))
    await screen.findByLabelText('Nama petugas administrasi')
    expect(screen.queryByLabelText('Unit penugasan akun baru')).not.toBeInTheDocument()
  })
})
