import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { AuthProvider } from './features/auth/AuthContext.jsx'

const user = { id: 'u1', name: 'Budi', email: 'budi@example.com', account_status: 'ACTIVE', must_change_password: false }
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const noAccess = { can: {}, can_write: {} }

/**
 * URL-routed fetch mock. `routes` maps "METHOD /path" (query ignored) to a body, a [status, body] pair,
 * or a function (req) => same. Unlisted routes reject like a network failure.
 */
function mockApi(routes) {
  const calls = []
  fetch.mockImplementation((url, init = {}) => {
    const method = init.method ?? 'GET'
    const path = String(url).replace(/^\/api/, '').split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body, url: String(url) })
    const handler = routes[`${method} ${path}`]
    if (handler === undefined) return Promise.reject(new Error(`unmocked ${method} ${path}`))
    const out = typeof handler === 'function' ? handler({ body, url: String(url) }) : handler
    return Array.isArray(out) ? json(out[0], out[1]) : json(200, out)
  })
  return calls
}

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.unstubAllGlobals() })

const session = () => sessionStorage.setItem('distriva.token', 'tok')

describe('auth UI', () => {
  it('redirects guests to the login page', async () => {
    mockApi({})
    renderAt('/profil')
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('logs in, shows the home page and stores the token only for the session', async () => {
    mockApi({ 'POST /auth/login': { token: 'tok', must_change_password: false, user }, 'GET /admin/access': noAccess })
    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'budi@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))

    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()
    expect(sessionStorage.getItem('distriva.token')).toBe('tok')
    expect(localStorage.getItem('distriva.token')).toBeNull()
  })

  it('shows the generic server message on a failed login', async () => {
    mockApi({ 'POST /auth/login': [401, { message: 'Email atau password salah, akun tidak aktif, atau akun terkunci sementara.' }] })
    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'x@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'bad')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email atau password salah')
  })

  it('shows backend validation errors under the fields', async () => {
    mockApi({ 'POST /auth/login': [422, { message: 'x', errors: { email: ['The email field is required.'] } }] })
    renderAt('/login')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByText('The email field is required.')).toBeInTheDocument()
  })

  it('drops the session when a stored token is rejected', async () => {
    session()
    mockApi({ 'GET /me': [401, { message: 'Unauthenticated.' }] })
    renderAt('/')
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeInTheDocument()
    expect(sessionStorage.getItem('distriva.token')).toBeNull()
  })

  it('forces users with must_change_password to the change-password page and does not load admin access', async () => {
    session()
    const calls = mockApi({ 'GET /me': { user: { ...user, must_change_password: true } } })
    renderAt('/profil')
    expect(await screen.findByText(/harus mengubah password/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Profil' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/admin/access')).toBe(false)
  })

  it('logs out and clears the token even if the server call fails', async () => {
    session()
    mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Menu pengguna' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keluar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument())
    expect(sessionStorage.getItem('distriva.token')).toBeNull()
  })

  it('changes the password and reports success', async () => {
    session()
    const calls = mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess, 'POST /me/password': { message: 'ok' } })
    renderAt('/ubah-password')
    await userEvent.type(await screen.findByLabelText('Password saat ini'), 'old')
    await userEvent.type(screen.getByLabelText('Password baru'), 'Baru-Kuat#2026')
    await userEvent.type(screen.getByLabelText('Konfirmasi password baru'), 'Baru-Kuat#2026')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText(/Password berhasil diubah/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/me/password').body.password_confirmation).toBe('Baru-Kuat#2026')
  })

  it('first login of a SYS_ADMIN (password change + MFA both pending): shows the password form, then moves on to MFA without looping', async () => {
    const mfaPending = { required: true, enrolled: false, verified: false }
    const admin = { ...user, name: 'Admin', email: 'admin@example.com', must_change_password: true }
    const calls = mockApi({
      'POST /auth/login': { token: 'tok', must_change_password: true, mfa: mfaPending, user: admin },
      'POST /me/password': { message: 'ok' },
      'GET /auth/mfa': { mfa: mfaPending },
      'POST /auth/mfa/enroll': [200, { secret: 'ABC', otpauth_url: 'otpauth://x', mfa: mfaPending }],
      'GET /admin/access': noAccess,
    })
    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Sementara#2026')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    // lands on the password form (the old code bounced between /mfa and /ubah-password and rendered nothing)
    await userEvent.type(await screen.findByLabelText('Password saat ini'), 'Sementara#2026')
    await userEvent.type(screen.getByLabelText('Password baru'), 'Baru-Kuat#2026')
    await userEvent.type(screen.getByLabelText('Konfirmasi password baru'), 'Baru-Kuat#2026')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/me/password')).toBe(true))
    // password is changed -> MFA is the next gate
    expect(await screen.findByRole('heading', { name: 'Pendaftaran Authenticator (TOTP)' })).toBeInTheDocument()
  })

  it('lists the password rules and shows every server-side violation', async () => {
    session()
    mockApi({
      'GET /me': { user }, 'GET /admin/access': noAccess,
      'POST /me/password': [422, { message: 'x', errors: { password: ['Password harus memuat angka.', 'Password harus memuat simbol.'] } }],
    })
    renderAt('/ubah-password')
    expect(await screen.findByLabelText('Aturan password')).toHaveTextContent('huruf besar, huruf kecil, angka, dan simbol')
    await userEvent.type(screen.getByLabelText('Password saat ini'), 'old')
    await userEvent.type(screen.getByLabelText('Password baru'), 'Abcdefgh')
    await userEvent.type(screen.getByLabelText('Konfirmasi password baru'), 'Abcdefgh')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText(/harus memuat angka/)).toHaveTextContent('harus memuat simbol')
  })

  it('displays unified profile page with tabs for profile details and change password', async () => {
    session()
    mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    renderAt('/profil')
    expect(await screen.findByText('Detail Akun Pengguna')).toBeInTheDocument()
    expect(screen.getAllByText('budi@example.com')[0]).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Ubah Password & Keamanan/ }))
    expect(screen.getByLabelText('Password saat ini')).toBeInTheDocument()
    expect(screen.getByLabelText('Password baru')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Informasi Profil/ }))
    expect(screen.getByText('Detail Akun Pengguna')).toBeInTheDocument()
  })

  it('opens header user dropdown and provides navigation to profile and logout', async () => {
    session()
    mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    renderAt('/')
    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()

    // Sidebar should only have Dashboard under Menu Utama
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Profil' })).not.toBeInTheDocument()

    // Open user dropdown in header
    await userEvent.click(screen.getByRole('button', { name: 'Menu pengguna' }))
    const menu = screen.getByRole('menu', { name: 'Menu akun' })
    expect(within(menu).getByText('Profil & Keamanan Akun')).toBeInTheDocument()
    expect(within(menu).getByText('Ubah Password')).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Keluar' })).toBeInTheDocument()
  })

  it('toggles dark mode theme and persists preference in localStorage', async () => {
    session()
    localStorage.removeItem('distriva.theme')
    mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    renderAt('/')
    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()

    const themeBtn = screen.getByRole('button', { name: 'Toggle tema gelap/terang' })
    expect(themeBtn).toBeInTheDocument()

    // Initially light
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // Toggle to dark
    await userEvent.click(themeBtn)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('distriva.theme')).toBe('dark')

    // Toggle back to light
    await userEvent.click(themeBtn)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('distriva.theme')).toBe('light')
  })

  it('opens notifications dropdown panel and marks notifications as read', async () => {
    session()
    localStorage.setItem('distriva.notifications.v1', JSON.stringify([{ id: 'seed-1', title: 'Unit Kerja Terdaftar' }]))
    const calls = mockApi({
      'GET /me': { user },
      'GET /admin/access': noAccess,
      'GET /notifications': {
        data: [
          {
            id: 'notif-srv-1',
            level: 'warning',
            title: '3 draf KHS menunggu persetujuan',
            body: 'Terdapat 3 draf KHS yang diimpor oleh Perencanaan.',
            tag: 'KHS',
            link: '/master-data/khs',
            read_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: 'notif-srv-2',
            level: 'success',
            title: 'Buku Harga Disetujui',
            body: 'Disetujui oleh Manager UP3. Alasan: Sesuai SK.',
            tag: 'Buku Harga',
            link: null,
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 2, last_page: 1, unread_count: 5 },
      },
      'POST /notifications/read-all': { data: { marked: 5 } },
    })
    renderAt('/')
    expect(await screen.findByText(/Selamat datang, Budi/)).toBeInTheDocument()

    // Cleans up legacy localStorage key
    expect(localStorage.getItem('distriva.notifications.v1')).toBeNull()

    const notifBtn = screen.getByRole('button', { name: 'Notifikasi' })
    expect(notifBtn).toBeInTheDocument()

    // Shows unread_count from server meta (5, not local count 2)
    expect(await within(notifBtn).findByText('5')).toBeInTheDocument()

    // Click notif button to open dropdown panel
    await userEvent.click(notifBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    expect(within(panel).getByText('5 baru')).toBeInTheDocument()
    expect(within(panel).getByText('3 draf KHS menunggu persetujuan')).toBeInTheDocument()
    expect(within(panel).getByText('Buku Harga Disetujui')).toBeInTheDocument()
    expect(within(panel).queryByText('Unit Kerja Terdaftar')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Keamanan Kredensial')).not.toBeInTheDocument()

    // Click mark all as read
    const markAllBtn = within(panel).getByRole('button', { name: 'Tandai semua dibaca' })
    await userEvent.click(markAllBtn)
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/notifications/read-all')).toBe(true))
    expect(within(panel).queryByText(/baru/)).not.toBeInTheDocument()
    expect(within(notifBtn).queryByText('5')).not.toBeInTheDocument()
  })
})

const adminAccess = {
  can: {
    'users.view': true,
    'users.create': true,
    'organizational_units.view': true,
    'organizational_units.create': true,
    'organizational_units.update': true,
    'role_assignments.view': true,
    'role_assignments.assign': true,
    'role_assignments.end': true,
    'users.change_status': true,
  },
  can_write: {
    'users.view': true,
    'users.create': true,
    'organizational_units.view': true,
    'organizational_units.create': true,
    'organizational_units.update': true,
    'role_assignments.view': true,
    'role_assignments.assign': true,
    'role_assignments.end': true,
    'users.change_status': true,
  },
}
const rows = [
  { id: 'a1', name: 'Ani', email: 'ani@example.com', account_status: 'ACTIVE' },
  { id: 'b2', name: 'Budi Staf', email: 'budi.staf@example.com', account_status: 'SUSPENDED' },
]
const usersPage = (page = 1) => ({ data: rows, meta: { current_page: page, per_page: 2, total: 4, last_page: 2 } })

describe('admin UI', () => {
  it('shows admin menus only when the server reports the capability', async () => {
    session()
    mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    const { unmount } = renderAt('/')
    expect(await screen.findByText(/Selamat datang/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pengguna' })).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /me': { user }, 'GET /admin/access': adminAccess })
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'Pengguna' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Unit organisasi' })).toBeInTheDocument()
  })

  it('opens master-data action pages only for the capability the server asks for, not for read access alone', async () => {
    session()
    const readOnly = { can: { 'master_data.view': true, 'substations.view': true } }
    for (const path of ['/master-data/excel-import', '/master-data/materials/m1/ubah', '/master-data/kkf-parameters/baru', '/master-data/categories/baru', '/master-data/warehouses/baru', '/master-data/substation-measurements/impor']) {
      mockApi({ 'GET /me': { user }, 'GET /master-data/access': readOnly, 'GET /admin/access': noAccess })
      const { unmount } = renderAt(path)
      expect(await screen.findByText('Halaman tidak ditemukan')).toBeInTheDocument()
      unmount()
    }
  })

  it('shows "not found" for admin URLs the user has no capability for', async () => {
    session()
    const calls = mockApi({ 'GET /me': { user }, 'GET /admin/access': noAccess })
    renderAt('/admin/users')
    expect(await screen.findByText('Halaman tidak ditemukan')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/admin/users')).toBe(false)
  })

  it('lists users, applies filters and paginates through server-side params', async () => {
    session()
    const calls = mockApi({ 'GET /me': { user }, 'GET /admin/access': adminAccess, 'GET /admin/users': ({ url }) => usersPage(Number(new URL(url, 'http://x').searchParams.get('page') ?? 1)) })
    renderAt('/admin/users')

    expect(await screen.findByRole('link', { name: 'Ani' })).toHaveAttribute('href', '/admin/users/a1')
    expect(within(screen.getByRole('table')).getByText('Ditangguhkan')).toBeInTheDocument()
    expect(screen.getByText(/Halaman 1 dari 2 · 4 data/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => expect(calls.at(-1).url).toContain('page=2'))

    await userEvent.type(screen.getByLabelText('Cari nama / email'), 'budi')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'SUSPENDED')
    await userEvent.click(screen.getByRole('button', { name: 'Terapkan' }))
    await waitFor(() => expect(calls.at(-1).url).toMatch(/search=budi.*status=SUSPENDED|status=SUSPENDED.*search=budi/))
    expect(calls.at(-1).url).toContain('page=1')
  })

  it('shows an empty state and a server error state', async () => {
    session()
    mockApi({ 'GET /me': { user }, 'GET /admin/access': adminAccess, 'GET /admin/users': { data: [], meta: { current_page: 1, per_page: 15, total: 0, last_page: 1 } } })
    const { unmount } = renderAt('/admin/users')
    expect(await screen.findByText(/Tidak ada pengguna pada cakupan Anda/)).toBeInTheDocument()
    unmount()

    mockApi({ 'GET /me': { user }, 'GET /admin/access': adminAccess, 'GET /admin/users': [403, { message: 'Tidak berwenang.' }] })
    renderAt('/admin/users')
    expect(await screen.findByRole('alert')).toHaveTextContent('Tidak berwenang.')
  })

  const detailRoutes = (extra = {}) => ({
    'GET /me': { user }, 'GET /admin/access': adminAccess,
    'GET /admin/users/a1': { data: rows[0] },
    'GET /admin/users/a1/assignments': { data: [
      { id: 'as1', role: 'TEKNIK', unit_code: 'ULP-1', valid_from: '2026-01-01', valid_until: null, is_active: true },
      { id: 'as2', role: 'VIEWER', unit_code: 'ULP-1', valid_from: '2025-01-01', valid_until: '2025-12-31', is_active: false },
    ] },
    'GET /admin/roles': { data: [{ id: 5, name: 'TEKNIK' }] },
    'GET /admin/organizational-units': { data: [{ id: 'u9', code: 'ULP-1', name: 'ULP Satu', unit_type: 'ULP', is_active: true }], meta: { current_page: 1, per_page: 100, total: 1, last_page: 1 } },
    ...extra,
  })

  it('ends an assignment only after a reason is given, then reloads', async () => {
    session()
    const calls = mockApi(detailRoutes({ 'POST /admin/role-assignments/as1/end': { data: {} } }))
    renderAt('/admin/users/a1')

    await userEvent.click(await screen.findByRole('button', { name: 'Akhiri' }))
    const dialog = screen.getByRole('dialog', { name: 'Akhiri penugasan' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Akhiri penugasan' }))
    expect(within(dialog).getByText('Alasan wajib diisi.')).toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('/end'))).toBe(false)

    await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Mutasi keluar')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Akhiri penugasan' }))
    expect(await screen.findByText('Penugasan diakhiri.')).toBeInTheDocument()
    expect(calls.find((c) => c.path.endsWith('/end')).body).toEqual({ reason: 'Mutasi keluar' })
    expect(calls.filter((c) => c.path === '/admin/users/a1/assignments').length).toBe(2)
  })

  it('shows server errors inside the dialog and keeps it open', async () => {
    session()
    mockApi(detailRoutes({ 'POST /admin/role-assignments/as1/end': [409, { message: 'Tidak dapat menghapus/menonaktifkan UP3_ADMIN terakhir pada unit ini.' }] }))
    renderAt('/admin/users/a1')
    await userEvent.click(await screen.findByRole('button', { name: 'Akhiri' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Alasan'), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Akhiri penugasan' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('UP3_ADMIN terakhir')
  })

  it('changes the account status with a reason', async () => {
    session()
    const calls = mockApi(detailRoutes({ 'POST /admin/users/a1/status': { data: { ...rows[0], account_status: 'SUSPENDED' } } }))
    renderAt('/admin/users/a1')
    await userEvent.selectOptions(await screen.findByLabelText('Ubah status menjadi'), 'SUSPENDED')
    await userEvent.click(screen.getByRole('button', { name: 'Ubah status…' }))
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Alasan'), 'Cuti panjang')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ubah status' }))
    expect(await screen.findByText('Status akun diperbarui.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/admin/users/a1/status').body).toEqual({ status: 'SUSPENDED', reason: 'Cuti panjang' })
  })

  it('adds an assignment and shows field errors from the server', async () => {
    session()
    let attempt = 0
    const calls = mockApi(detailRoutes({
      'POST /admin/role-assignments': () => (++attempt === 1
        ? [422, { message: 'x', errors: { assignment_document: ['The assignment document field is required.'] } }]
        : [201, { data: {} }]),
    }))
    renderAt('/admin/users/a1')

    await screen.findByRole('option', { name: 'TEKNIK' }) // options load asynchronously
    await screen.findByRole('option', { name: /ULP-1 — ULP Satu/ })
    await userEvent.selectOptions(screen.getByLabelText('Role'), '5')
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'u9')
    await userEvent.type(screen.getByLabelText('Berlaku mulai'), '2026-11-06')
    await userEvent.type(screen.getByLabelText('Alasan', { selector: '#assign_reason' }), 'Mutasi')
    await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }))
    expect(await screen.findByText('The assignment document field is required.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Dokumen penugasan'), 'SK-123')
    await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }))
    expect(await screen.findByText('Penugasan ditambahkan.')).toBeInTheDocument()
    const sent = calls.filter((c) => c.method === 'POST' && c.path === '/admin/role-assignments').at(-1).body
    expect(sent).toMatchObject({ user_id: 'a1', role_id: '5', organizational_unit_id: 'u9', valid_from: '2026-11-06', valid_until: null, assignment_document: 'SK-123' })
  })

  it('hides write controls when the user can only read', async () => {
    session()
    const readOnly = { can: adminAccess.can, can_write: Object.fromEntries(Object.keys(adminAccess.can).map((k) => [k, false])) }
    mockApi(detailRoutes({ 'GET /admin/access': readOnly }))
    renderAt('/admin/users/a1')
    expect(await screen.findByText('TEKNIK')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Akhiri' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tambah penugasan' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ubah status menjadi')).not.toBeInTheDocument()
  })

  it('lists organizational units', async () => {
    session()
    mockApi({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/organizational-units': { data: [{ id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', is_active: true }], meta: { current_page: 1, per_page: 15, total: 1, last_page: 1 } },
    })
    renderAt('/admin/units')
    expect(await screen.findByText('UP3-A')).toBeInTheDocument()
  })

  it('creates an organizational unit and records audit reason', async () => {
    session()
    const calls = mockApi({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/organizational-units': {
        data: [{ id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', is_active: true }],
        meta: { current_page: 1, per_page: 15, total: 1, last_page: 1 },
      },
      'POST /admin/organizational-units': {
        data: { id: 'u2', code: 'ULP-1', name: 'ULP Satu', unit_type: 'ULP', parent_id: 'u1', is_active: true },
      },
    })
    renderAt('/admin/units')
    expect(await screen.findByText('UP3-A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Tambah Unit/ }))
    const modal = (await screen.findByRole('heading', { name: 'Tambah Unit Organisasi Baru' })).closest('div.space-y-4')   // halaman tambah unit (bukan laci)
    expect(within(modal).getByText('Tambah Unit Organisasi Baru')).toBeInTheDocument()

    await userEvent.type(within(modal).getByLabelText(/Kode Unit/), 'ULP-1')
    await userEvent.type(within(modal).getByLabelText(/Nama Unit/), 'ULP Satu')
    await userEvent.selectOptions(within(modal).getByLabelText(/Unit Induk UP3/), 'u1')
    await userEvent.type(within(modal).getByLabelText(/Alasan Pembuatan Unit/), 'Penambahan kantor ULP baru')
    await userEvent.click(within(modal).getByRole('button', { name: 'Simpan Unit' }))

    expect(await screen.findByText(/Unit ULP-1 - ULP Satu berhasil dibuat/)).toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.path === '/admin/organizational-units')
    expect(postCall.body).toMatchObject({
      code: 'ULP-1',
      name: 'ULP Satu',
      unit_type: 'ULP',
      parent_id: 'u1',
      reason: 'Penambahan kantor ULP baru',
    })
  })

  it('edits an organizational unit and shows immutable fields notice', async () => {
    session()
    const calls = mockApi({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/organizational-units': {
        data: [{ id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', address: 'Jl. Pemuda', is_active: true }],
        meta: { current_page: 1, per_page: 15, total: 1, last_page: 1 },
      },
      'GET /admin/organizational-units/u1': { data: { id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', address: 'Jl. Pemuda', is_active: true } },
      'POST /admin/organizational-units/u1': {
        data: { id: 'u1', code: 'UP3-A', name: 'UP3 Mojokerto Baru', unit_type: 'UP3', address: 'Jl. Baru No. 1', is_active: true },
      },
    })
    renderAt('/admin/units')
    expect(await screen.findByText('UP3-A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const modal = (await screen.findByRole('heading', { name: /Ubah Data Unit: UP3-A/ })).closest('div.space-y-4')   // halaman ubah unit (bukan laci)
    expect(within(modal).getByText(/Ubah Data Unit: UP3-A/)).toBeInTheDocument()
    expect(within(modal).getByText(/Kode unit, tipe, dan unit induk bersifat permanen/)).toBeInTheDocument()

    const nameInput = within(modal).getByLabelText(/Nama Unit/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'UP3 Mojokerto Baru')
    await userEvent.type(within(modal).getByLabelText(/Alasan Perubahan/), 'Penyesuaian nama resmi wilayah')
    await userEvent.click(within(modal).getByRole('button', { name: 'Simpan Perubahan' }))

    expect(await screen.findByText(/berhasil diperbarui/)).toBeInTheDocument()
    const updateCall = calls.find((c) => c.method === 'POST' && c.path === '/admin/organizational-units/u1')
    expect(updateCall.body).toMatchObject({
      name: 'UP3 Mojokerto Baru',
      reason: 'Penyesuaian nama resmi wilayah',
    })
  })

  it('views unit detail and audit history trail', async () => {
    session()
    mockApi({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/organizational-units': {
        data: [{ id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', is_active: true }],
        meta: { current_page: 1, per_page: 15, total: 1, last_page: 1 },
      },
      'GET /admin/organizational-units/u1': {
        data: {
          id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', address: 'Jl. Majapahit 10', is_active: true,
          children: [{ id: 'c1', code: 'ULP-1', name: 'ULP Kota', unit_type: 'ULP', is_active: true }],
          histories: [{
            id: 'h1', old_name: 'UP3 Lama', new_name: 'UP3 A', reason: 'Penyesuaian SK Direksi',
            changed_by_name: 'Admin Irham', changed_at: '2026-11-06T08:00:00Z',
          }],
        },
      },
    })
    renderAt('/admin/units')
    expect(await screen.findByText('UP3-A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Detail' }))
    const modal = screen.getByRole('dialog')
    expect(await within(modal).findByText('Jl. Majapahit 10')).toBeInTheDocument()
    expect(within(modal).getByText('ULP Kota')).toBeInTheDocument()
    expect(within(modal).getByText(/Penyesuaian SK Direksi/)).toBeInTheDocument()
    expect(within(modal).getByText('Admin Irham')).toBeInTheDocument()

    await userEvent.click(within(modal).getByRole('button', { name: 'Tutup' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deactivates an active unit through ReasonDialog with audit reason', async () => {
    session()
    const calls = mockApi({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/organizational-units': {
        data: [{ id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', is_active: true }],
        meta: { current_page: 1, per_page: 15, total: 1, last_page: 1 },
      },
      'POST /admin/organizational-units/u1': {
        data: { id: 'u1', code: 'UP3-A', name: 'UP3 A', unit_type: 'UP3', is_active: false },
      },
    })
    renderAt('/admin/units')
    expect(await screen.findByText('UP3-A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Nonaktifkan Unit Organisasi')).toBeInTheDocument()
    expect(within(dialog).getByText(/penghapusan fisik \(hard delete\) dilarang/)).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Penutupan operasional unit sesuai SK')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan Unit' }))

    expect(await screen.findByText(/berhasil diubah menjadi Nonaktif/)).toBeInTheDocument()
    const toggleCall = calls.find((c) => c.method === 'POST' && c.path === '/admin/organizational-units/u1')
    expect(toggleCall.body).toMatchObject({
      is_active: false,
      reason: 'Penutupan operasional unit sesuai SK',
    })
  })

  describe('creating users and inviting them', () => {
    const newUserRoutes = (post) => ({
      'GET /me': { user }, 'GET /admin/access': adminAccess,
      'GET /admin/roles': { data: [{ id: 5, name: 'TEKNIK' }] },
      'GET /admin/organizational-units': { data: [{ id: 'u9', code: 'ULP-1', name: 'ULP Satu', unit_type: 'ULP', is_active: true }], meta: { current_page: 1, per_page: 100, total: 1, last_page: 1 } },
      'POST /admin/users': post,
    })

    async function fillNewUser() {
      await screen.findByRole('option', { name: 'TEKNIK' })
      await screen.findByRole('option', { name: /ULP-1 — ULP Satu/ })
      await userEvent.type(screen.getByLabelText('Nama lengkap'), 'Siti Aminah')
      await userEvent.type(screen.getByLabelText('Email'), 'siti@example.com')
      await userEvent.type(screen.getByLabelText('Nomor WhatsApp (opsional)'), '0812-3456-7890')
      await userEvent.selectOptions(screen.getByLabelText('Role'), '5')
      await userEvent.selectOptions(screen.getByLabelText('Unit'), 'u9')
      await userEvent.type(screen.getByLabelText('Berlaku mulai'), '2026-11-06')
      await userEvent.type(screen.getByLabelText('Dokumen penugasan'), 'SK-1')
      await userEvent.type(screen.getByLabelText('Alasan'), 'Pegawai baru')
    }

    it('shows the add button only to users who may create, and the form only to them', async () => {
      session()
      mockApi({ 'GET /me': { user }, 'GET /admin/access': { can: { ...adminAccess.can, 'users.create': false }, can_write: { ...adminAccess.can_write, 'users.create': false } }, 'GET /admin/users': usersPage() })
      const { unmount } = renderAt('/admin/users')
      await screen.findByRole('link', { name: 'Ani' })
      expect(screen.queryByRole('link', { name: 'Tambah pengguna' })).not.toBeInTheDocument()
      unmount()

      mockApi({ 'GET /me': { user }, 'GET /admin/access': { can: { ...adminAccess.can, 'users.create': false }, can_write: {} } })
      renderAt('/admin/users/new')
      expect(await screen.findByText('Halaman tidak ditemukan')).toBeInTheDocument()
    })

    it('creates a pending user, reports the invitation per channel and never shows or asks for a password', async () => {
      session()
      const calls = mockApi(newUserRoutes({ data: { id: 'n1', name: 'Siti Aminah', account_status: 'PENDING_ACTIVATION' }, assignment: {}, delivery: { delivered: ['mail', 'whatsapp'], failed: [], skipped: {} } }))
      renderAt('/admin/users/new')
      expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument() // admins never set or see a password
      await fillNewUser()
      await userEvent.click(screen.getByRole('button', { name: 'Buat pengguna' }))

      const ok = await screen.findByText(/Undangan aktivasi terkirim/)
      expect(ok).toHaveTextContent('Terkirim lewat Email dan WhatsApp')
      expect(ok).toHaveTextContent('menunggu aktivasi')
      expect(ok).toHaveTextContent('kode OTP')
      expect(screen.getByRole('link', { name: 'Siti Aminah' })).toHaveAttribute('href', '/admin/users/n1')
      expect(document.body.textContent).not.toMatch(/Password sementara/i)
      const sent = calls.find((c) => c.method === 'POST' && c.path === '/admin/users').body
      expect(sent).toMatchObject({ name: 'Siti Aminah', email: 'siti@example.com', phone: '0812-3456-7890', role_id: '5', organizational_unit_id: 'u9', nip: null, valid_until: null })
      expect(Object.keys(sent).some((k) => /password/i.test(k))).toBe(false)
    })

    it('warns clearly when the invitation could not be delivered although the user was created', async () => {
      session()
      mockApi(newUserRoutes({ data: { id: 'n1', name: 'Siti Aminah' }, assignment: {}, delivery: { delivered: [], failed: [], skipped: { mail: 'mailer_not_deliverable', whatsapp: 'no_provider_configured' } } }))
      renderAt('/admin/users/new')
      await fillNewUser()
      await userEvent.click(screen.getByRole('button', { name: 'Buat pengguna' }))
      const warn = await screen.findByText(/Undangan TIDAK terkirim/)
      expect(warn).toHaveTextContent('Pengguna tetap dibuat')
      expect(warn).toHaveTextContent('Email (email belum dikonfigurasi)')
      expect(warn).toHaveTextContent('kirim ulang undangan')
    })

    it('shows field errors from the server', async () => {
      session()
      mockApi(newUserRoutes([422, { message: 'x', errors: { email: ['The email has already been taken.'] } }]))
      renderAt('/admin/users/new')
      await fillNewUser()
      await userEvent.click(screen.getByRole('button', { name: 'Buat pengguna' }))
      expect(await screen.findByText('The email has already been taken.')).toBeInTheDocument()
    })

    it('offers to resend the invitation only for accounts waiting for activation, with a required reason', async () => {
      session()
      const pending = { ...rows[0], account_status: 'PENDING_ACTIVATION', must_change_password: true }
      const calls = mockApi(detailRoutes({
        'GET /admin/users/a1': { data: pending },
        'POST /admin/users/a1/resend-invitation': { delivery: { delivered: ['mail'], failed: ['whatsapp'], skipped: {} } },
      }))
      renderAt('/admin/users/a1')

      await userEvent.click(await screen.findByRole('button', { name: /Kirim ulang undangan aktivasi/ }))
      const dialog = screen.getByRole('dialog', { name: 'Kirim ulang undangan aktivasi' })
      expect(dialog).toHaveTextContent('tidak berisi password atau kode')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Kirim ulang' }))
      expect(within(dialog).getByText('Alasan wajib diisi.')).toBeInTheDocument()
      await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Email lama tidak terbaca')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Kirim ulang' }))

      expect(await screen.findByText(/Undangan aktivasi dikirim ulang\. Terkirim lewat Email\. Gagal: WhatsApp/)).toBeInTheDocument()
      expect(calls.find((c) => c.path.endsWith('/resend-invitation')).body).toEqual({ reason: 'Email lama tidak terbaca' })
    })

    it('does not offer an invitation for activated accounts (even if they must still change a password)', async () => {
      session()
      mockApi(detailRoutes({ 'GET /admin/users/a1': { data: { ...rows[0], account_status: 'ACTIVE', must_change_password: true } } }))
      renderAt('/admin/users/a1')
      expect(await screen.findByText('TEKNIK')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Kirim ulang undangan/ })).not.toBeInTheDocument()
    })
  })
})

describe('activation and recovery with OTP (public pages)', () => {
  const GOOD = 'Kunci-Baru#2026b'

  async function askForCode(path, email = 'siti@example.com') {
    await userEvent.type(screen.getByLabelText('Email'), email)
    await userEvent.click(screen.getByRole('button', { name: 'Kirim kode OTP' }))
    return screen.findByLabelText(/Kode OTP/)
  }

  async function fillCode(otp = '123456', password = GOOD) {
    await userEvent.type(screen.getByLabelText(/Kode OTP/), otp)
    await userEvent.type(screen.getByLabelText('Password baru'), password)
    await userEvent.type(screen.getByLabelText('Konfirmasi password baru'), password)
  }

  it('is reachable without signing in and linked from the login page', async () => {
    mockApi({})
    renderAt('/login')
    expect(await screen.findByRole('link', { name: 'Aktivasi akun baru' })).toHaveAttribute('href', '/aktivasi')
    expect(screen.getByRole('link', { name: /Lupa password \/ akun terkunci/ })).toHaveAttribute('href', '/pemulihan')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('activates an account: asks for a code, then verifies it together with a new password', async () => {
    const calls = mockApi({
      'POST /auth/otp/request': [202, { message: 'Jika akun memenuhi syarat, kode OTP telah dikirim lewat email/WhatsApp yang terdaftar. Kode berlaku 10 menit.' }],
      'POST /auth/otp/verify': { message: 'Akun berhasil diaktifkan. Silakan masuk.' },
    })
    renderAt('/aktivasi')
    expect(screen.getByRole('heading', { name: 'Aktivasi akun' })).toBeInTheDocument()

    await askForCode('/aktivasi')
    expect(screen.getByText(/Jika akun memenuhi syarat/)).toBeInTheDocument() // same neutral wording for any e-mail
    expect(screen.getByLabelText('Aturan password')).toHaveTextContent('huruf besar, huruf kecil, angka, dan simbol')
    expect(calls.find((c) => c.path === '/auth/otp/request').body).toEqual({ email: 'siti@example.com', purpose: 'activation' })

    await fillCode()
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan akun' }))
    expect(await screen.findByText('Akun berhasil diaktifkan. Silakan masuk.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/auth/otp/verify').body).toEqual({
      email: 'siti@example.com', purpose: 'activation', otp: '123456', password: GOOD, password_confirmation: GOOD,
    })
    expect(screen.getByRole('link', { name: 'Ke halaman masuk' })).toHaveAttribute('href', '/login')
    expect(sessionStorage.getItem('distriva.token')).toBeNull() // activation does not sign anyone in
  })

  it('recovery (locked or forgotten password) uses the same flow with its own purpose and texts', async () => {
    const calls = mockApi({
      'POST /auth/otp/request': [202, { message: 'Jika akun memenuhi syarat, kode OTP telah dikirim.' }],
      'POST /auth/otp/verify': { message: 'Password berhasil diubah. Silakan masuk.' },
    })
    renderAt('/pemulihan')
    expect(screen.getByRole('heading', { name: 'Pemulihan akses' })).toBeInTheDocument()
    expect(screen.getByText(/akun terkunci/)).toBeInTheDocument()

    await askForCode('/pemulihan')
    await fillCode()
    await userEvent.click(screen.getByRole('button', { name: 'Atur password baru' }))
    expect(await screen.findByText('Password berhasil diubah. Silakan masuk.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/auth/otp/verify').body.purpose).toBe('recovery')
  })

  it('shows the generic wrong/expired code message and lets the user retry', async () => {
    let n = 0
    mockApi({
      'POST /auth/otp/request': [202, { message: 'ok' }],
      'POST /auth/otp/verify': () => (++n === 1 ? [422, { message: 'Kode OTP salah atau sudah kedaluwarsa.' }] : { message: 'Akun berhasil diaktifkan. Silakan masuk.' }),
    })
    renderAt('/aktivasi')
    await askForCode('/aktivasi')
    await fillCode('000000')
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan akun' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kode OTP salah atau sudah kedaluwarsa.')

    await userEvent.clear(screen.getByLabelText(/Kode OTP/))
    await userEvent.type(screen.getByLabelText(/Kode OTP/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan akun' }))
    expect(await screen.findByText('Akun berhasil diaktifkan. Silakan masuk.')).toBeInTheDocument()
  })

  it('lists every password problem returned after a correct code', async () => {
    mockApi({
      'POST /auth/otp/request': [202, { message: 'ok' }],
      'POST /auth/otp/verify': [422, { message: 'x', errors: { password: ['Password harus memuat angka.', 'Password harus memuat simbol.'] } }],
    })
    renderAt('/aktivasi')
    await askForCode('/aktivasi')
    await fillCode('123456', 'Abcdefgh')
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan akun' }))
    expect(await screen.findByText(/harus memuat angka/)).toHaveTextContent('harus memuat simbol')
    expect(screen.getByLabelText(/Kode OTP/)).toHaveValue('123456') // the user does not have to ask for a new code
  })

  it('shows the rate-limit message and keeps a resend cooldown', async () => {
    mockApi({ 'POST /auth/otp/request': [429, { message: 'Terlalu banyak permintaan kode. Coba lagi nanti.' }] })
    renderAt('/aktivasi')
    await userEvent.type(screen.getByLabelText('Email'), 'siti@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Kirim kode OTP' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Terlalu banyak permintaan kode')
    expect(screen.queryByLabelText(/Kode OTP/)).not.toBeInTheDocument() // still on the e-mail step

    mockApi({ 'POST /auth/otp/request': [202, { message: 'ok' }] })
    await userEvent.click(screen.getByRole('button', { name: 'Kirim kode OTP' }))
    await screen.findByLabelText(/Kode OTP/)
    expect(screen.getByRole('button', { name: /Kirim ulang kode \(\d+ dtk\)/ })).toBeDisabled()
  })

  it('lets the user go back and change the e-mail address', async () => {
    mockApi({ 'POST /auth/otp/request': [202, { message: 'ok' }] })
    renderAt('/pemulihan')
    await askForCode('/pemulihan')
    await userEvent.click(screen.getByRole('button', { name: 'Ganti email' }))
    expect(screen.getByRole('button', { name: 'Kirim kode OTP' })).toBeInTheDocument()
  })
})

describe('MFA flow (enrolment, verification and recovery codes)', () => {
  const sysUser = { id: 'u-sys', name: 'System Admin', email: 'sys@distriva.com', account_status: 'ACTIVE', must_change_password: false }

  it('does NOT force non-SYS_ADMIN to MFA and redirects them to / if /mfa is opened', async () => {
    session()
    const up3User = { id: 'u-up3', name: 'UP3 User', email: 'up3@distriva.com', account_status: 'ACTIVE', must_change_password: false }
    const calls = mockApi({
      'GET /me': { user: up3User },
      'GET /auth/mfa': { mfa: { required: false, enrolled: false, verified: true } },
      'GET /admin/access': noAccess,
    })
    renderAt('/mfa')
    expect(await screen.findByText(/Selamat datang, UP3 User/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/mfa/enroll')).toBe(false)
  })

  it('redirects SYS_ADMIN with unverified MFA from protected pages to /mfa', async () => {
    session()
    mockApi({
      'GET /me': { user: sysUser },
      'GET /auth/mfa': { mfa: { required: true, enrolled: false, verified: false } },
      'POST /auth/mfa/enroll': { data: { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/DISTRIVA:sys?secret=JBSWY3DPEHPK3PXP' } },
    })
    renderAt('/')
    expect(await screen.findByText('Pendaftaran Authenticator (TOTP)')).toBeInTheDocument()
    expect(await screen.findByLabelText(/6 Digit Kode/i)).toBeInTheDocument()
  })

  it('enrolls MFA: loads secret & QR, submits 6-digit code, and renders 8 recovery codes once', async () => {
    const recoveryCodesList = [
      'REC01-11111', 'REC02-22222', 'REC03-33333', 'REC04-44444',
      'REC05-55555', 'REC06-66666', 'REC07-77777', 'REC08-88888',
    ]

    const calls = mockApi({
      'POST /auth/login': {
        token: 'tok-sys',
        must_change_password: false,
        mfa: { required: true, enrolled: false, verified: false },
        user: sysUser,
      },
      'POST /auth/mfa/enroll': {
        data: { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/DISTRIVA:sys?secret=JBSWY3DPEHPK3PXP' },
      },
      'POST /auth/mfa/confirm': (req) => {
        expect(req.body.code).toBe('123456')
        return {
          message: 'MFA aktif.',
          recovery_codes: recoveryCodesList,
          mfa: { required: true, enrolled: true, verified: true },
        }
      },
      'GET /admin/access': noAccess,
    })

    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'sys@distriva.com')
    await userEvent.type(screen.getByLabelText('Password'), 'adminpw')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))

    // Redirected to /mfa
    expect(await screen.findByText('Pendaftaran Authenticator (TOTP)')).toBeInTheDocument()
    expect(await screen.findByText(/JBSW Y3DP/)).toBeInTheDocument()

    // Enter 6-digit code and confirm
    await userEvent.type(screen.getByLabelText(/6 Digit Kode/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /Konfirmasi & Aktifkan MFA/i }))

    // Displays 8 recovery codes
    expect(await screen.findByText('Simpan Kode Pemulihan Darurat')).toBeInTheDocument()
    expect(screen.getByText('REC01-11111')).toBeInTheDocument()
    expect(screen.getByText('REC08-88888')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Salin Semua Kode/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unduh File/i })).toBeInTheDocument()

    // Click finish button
    await userEvent.click(screen.getByRole('button', { name: /Saya Telah Menyimpan Kode/i }))

    // Arrives at home page
    expect(await screen.findByText(/Selamat datang, System Admin/)).toBeInTheDocument()
  })

  it('verifies existing MFA with 6-digit code and handles wrong code 422', async () => {
    mockApi({
      'POST /auth/login': {
        token: 'tok-sys',
        must_change_password: false,
        mfa: { required: true, enrolled: true, verified: false },
        user: sysUser,
      },
      'POST /auth/mfa/verify': (req) => {
        if (req.body.code === '999999') {
          return { message: 'Verifikasi MFA berhasil.', mfa: { required: true, enrolled: true, verified: true } }
        }
        return [422, { message: 'Kode salah.' }]
      },
      'GET /admin/access': noAccess,
    })

    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'sys@distriva.com')
    await userEvent.type(screen.getByLabelText('Password'), 'adminpw')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))

    // Lands on verification prompt
    expect(await screen.findByText('Verifikasi Identitas Anda')).toBeInTheDocument()

    // Try wrong code
    await userEvent.type(screen.getByLabelText(/Kode 6 Digit/i), '000000')
    await userEvent.click(screen.getByRole('button', { name: /Verifikasi & Lanjutkan/i }))
    expect(await screen.findByText('Kode salah.')).toBeInTheDocument()

    // Enter correct code
    await userEvent.clear(screen.getByLabelText(/Kode 6 Digit/i))
    await userEvent.type(screen.getByLabelText(/Kode 6 Digit/i), '999999')
    await userEvent.click(screen.getByRole('button', { name: /Verifikasi & Lanjutkan/i }))

    // Successfully verified and redirected
    expect(await screen.findByText(/Selamat datang, System Admin/)).toBeInTheDocument()
  })

  it('supports recovery code mode during verification', async () => {
    mockApi({
      'POST /auth/login': {
        token: 'tok-sys',
        must_change_password: false,
        mfa: { required: true, enrolled: true, verified: false },
        user: sysUser,
      },
      'POST /auth/mfa/verify': (req) => {
        if (req.body.code === 'ABCDE-12345') {
          return { message: 'Verifikasi MFA berhasil.', mfa: { required: true, enrolled: true, verified: true } }
        }
        return [422, { message: 'Kode salah.' }]
      },
      'GET /admin/access': noAccess,
    })

    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'sys@distriva.com')
    await userEvent.type(screen.getByLabelText('Password'), 'adminpw')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))

    expect(await screen.findByText('Verifikasi Identitas Anda')).toBeInTheDocument()

    // Switch to recovery code mode
    await userEvent.click(screen.getByRole('button', { name: /Gunakan Kode Pemulihan Darurat/i }))
    expect(await screen.findByLabelText(/Kode Pemulihan Darurat/i)).toBeInTheDocument()

    // Enter recovery code
    await userEvent.type(screen.getByLabelText(/Kode Pemulihan Darurat/i), 'ABCDE-12345')
    await userEvent.click(screen.getByRole('button', { name: /Verifikasi & Lanjutkan/i }))

    expect(await screen.findByText(/Selamat datang, System Admin/)).toBeInTheDocument()
  })

  it('handles 409 lockout error gracefully', async () => {
    mockApi({
      'POST /auth/login': {
        token: 'tok-sys',
        must_change_password: false,
        mfa: { required: true, enrolled: true, verified: false },
        user: sysUser,
      },
      'POST /auth/mfa/verify': [409, { message: 'Terlalu banyak percobaan salah. Coba lagi nanti.' }],
    })

    renderAt('/login')
    await userEvent.type(screen.getByLabelText('Email'), 'sys@distriva.com')
    await userEvent.type(screen.getByLabelText('Password'), 'adminpw')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))

    expect(await screen.findByText('Verifikasi Identitas Anda')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Kode 6 Digit/i), '111111')
    await userEvent.click(screen.getByRole('button', { name: /Verifikasi & Lanjutkan/i }))

    expect(await screen.findByText('Terlalu banyak percobaan salah. Coba lagi nanti.')).toBeInTheDocument()
  })
})
