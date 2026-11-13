import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificationProvider, useNotifications } from './NotificationContext.jsx'
import { AccessContext } from '../admin/AccessContext.jsx'
import AppLayout from '../../layout/AppLayout.jsx'
import { notificationsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  notificationsApi: {
    list: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}))

const mockAuthState = vi.hoisted(() => ({
  current: {
    status: 'authenticated',
    user: { id: 'u-1', name: 'Manager UP3', email: 'manager@distriva.id', account_status: 'ACTIVE' },
    mustChangePassword: false,
    mfaState: { required: false },
    logout: vi.fn(),
  },
}))

vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => mockAuthState.current,
}))

function LocationProbe() {
  const location = useLocation()
  const { notify } = useNotifications()
  return (
    <div>
      <div data-testid="current-path">{location.pathname}</div>
      <button
        type="button"
        onClick={() =>
          notify({
            type: 'success',
            title: 'Aksi Lokal Berhasil',
            desc: 'Data disimpan.',
            tag: 'Lokal',
          })
        }
      >
        Picu Toast Lokal
      </button>
    </div>
  )
}

function renderWithLayout(pollIntervalMs = 60000) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AccessContext.Provider value={{ loading: false, can: { 'master_data.view': true }, isSysAdmin: false }}>
        <NotificationProvider pollIntervalMs={pollIntervalMs}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<LocationProbe />} />
            </Route>
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

describe('Server Notifications & Bell Inbox (docs/62 §44)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockAuthState.current = {
      status: 'authenticated',
      user: { id: 'u-1', name: 'Manager UP3', email: 'manager@distriva.id', account_status: 'ACTIVE' },
      mustChangePassword: false,
      mfaState: { required: false },
      logout: vi.fn(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1. memuat GET /notifications dan menampilkan unread_count dari server (bukan hitungan lokal)', async () => {
    notificationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'n-1',
          level: 'warning',
          title: '4 draf KHS menunggu persetujuan',
          body: '4 draf KHS baru diimpor oleh Perencanaan.',
          tag: 'KHS',
          link: '/master-data/khs',
          read_at: null,
          created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
      ],
      meta: {
        current_page: 1,
        per_page: 30,
        total: 12,
        last_page: 1,
        unread_count: 9,
      },
    })

    renderWithLayout()

    await waitFor(() => {
      expect(notificationsApi.list).toHaveBeenCalledTimes(1)
    })

    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    // Shows 9 from meta.unread_count, even though data array has 1 item
    expect(await within(bellBtn).findByText('9')).toBeInTheDocument()

    await userEvent.click(bellBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    expect(within(panel).getByText('9 baru')).toBeInTheDocument()
    expect(within(panel).getByText('4 draf KHS menunggu persetujuan')).toBeInTheDocument()
    expect(within(panel).getByText('4 draf KHS baru diimpor oleh Perencanaan.')).toBeInTheDocument()
    expect(within(panel).getByText('5 mnt lalu')).toBeInTheDocument()
  })

  it('2. mengklik notifikasi memanggil markRead(id) lalu navigasi ke link; link tanpa awalan / tidak dinavigasi', async () => {
    notificationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'n-valid-link',
          level: 'warning',
          title: 'Draf BOM Menunggu',
          body: 'Silakan tinjau draf BOM.',
          tag: 'BOM',
          link: '/master-data/bom',
          read_at: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 'n-invalid-link',
          level: 'info',
          title: 'Tautan Eksternal Ditolak',
          body: 'Tautan tidak diawali garis miring.',
          tag: 'Info',
          link: 'https://evil.example.com/phish',
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      meta: { current_page: 1, per_page: 30, total: 2, last_page: 1, unread_count: 2 },
    })
    notificationsApi.markRead.mockResolvedValue({ data: { id: 'n-valid-link', read: true } })

    renderWithLayout()

    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    expect(await within(bellBtn).findByText('2')).toBeInTheDocument()

    // Click notification with invalid link (does not start with '/')
    await userEvent.click(bellBtn)
    await userEvent.click(screen.getByText('Tautan Eksternal Ditolak'))

    await waitFor(() => {
      expect(notificationsApi.markRead).toHaveBeenCalledWith('n-invalid-link')
    })
    expect(screen.getByTestId('current-path')).toHaveTextContent('/')
    expect(within(bellBtn).getByText('1')).toBeInTheDocument()

    // Click notification with valid internal link ('/master-data/bom')
    await userEvent.click(screen.getByText('Draf BOM Menunggu'))
    await waitFor(() => {
      expect(notificationsApi.markRead).toHaveBeenCalledWith('n-valid-link')
    })
    expect(screen.getByTestId('current-path')).toHaveTextContent('/master-data/bom')
  })

  it('3. tombol "Tandai semua dibaca" memanggil markAllRead dan menurunkan hitungan ke 0', async () => {
    notificationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'n-1',
          level: 'warning',
          title: 'Draf Buku Harga',
          body: 'Menunggu persetujuan.',
          tag: 'Harga',
          link: '/master-data/harga',
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      meta: { current_page: 1, per_page: 30, total: 1, last_page: 1, unread_count: 3 },
    })
    notificationsApi.markAllRead.mockResolvedValue({ data: { marked: 3 } })

    renderWithLayout()

    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    expect(await within(bellBtn).findByText('3')).toBeInTheDocument()

    await userEvent.click(bellBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    const markAllBtn = within(panel).getByRole('button', { name: 'Tandai semua dibaca' })
    await userEvent.click(markAllBtn)

    await waitFor(() => {
      expect(notificationsApi.markAllRead).toHaveBeenCalledTimes(1)
    })
    expect(within(panel).queryByText(/baru/)).not.toBeInTheDocument()
    expect(within(bellBtn).queryByText('3')).not.toBeInTheDocument()
  })

  it('4. tidak ada notifikasi contoh (seed-*) dan tidak ada pembacaan/penulisan localStorage distriva.notifications.v1 setelah dimuat', async () => {
    localStorage.setItem('distriva.notifications.v1', JSON.stringify([{ id: 'seed-1', title: 'Unit Kerja Terdaftar' }]))
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    notificationsApi.list.mockResolvedValue({
      data: [],
      meta: { current_page: 1, per_page: 30, total: 0, last_page: 1, unread_count: 0 },
    })

    renderWithLayout()

    await waitFor(() => {
      expect(notificationsApi.list).toHaveBeenCalledTimes(1)
    })

    // Legacy key removed once
    expect(localStorage.getItem('distriva.notifications.v1')).toBeNull()
    // Never read or written by NotificationContext
    const notifReads = getItemSpy.mock.calls.filter(([k]) => k === 'distriva.notifications.v1')
    // Only the explicit expect(localStorage.getItem(...)) above read it
    expect(notifReads.length).toBe(1)
    const notifWrites = setItemSpy.mock.calls.filter(([k]) => k === 'distriva.notifications.v1')
    expect(notifWrites.length).toBe(0)

    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    await userEvent.click(bellBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    expect(within(panel).getByText('Belum ada notifikasi')).toBeInTheDocument()
    expect(within(panel).queryByText('Unit Kerja Terdaftar')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Keamanan Kredensial')).not.toBeInTheDocument()

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('5. notify() hanya menampilkan toast dan tidak menambah baris di daftar lonceng', async () => {
    notificationsApi.list.mockResolvedValue({
      data: [],
      meta: { current_page: 1, per_page: 30, total: 0, last_page: 1, unread_count: 0 },
    })

    renderWithLayout()
    await waitFor(() => expect(notificationsApi.list).toHaveBeenCalledTimes(1))

    // Trigger local toast via notify()
    await userEvent.click(screen.getByRole('button', { name: 'Picu Toast Lokal' }))

    // Toast appears
    const toast = await screen.findByRole('status')
    expect(within(toast).getByText('Aksi Lokal Berhasil')).toBeInTheDocument()
    expect(within(toast).getByText('Data disimpan.')).toBeInTheDocument()

    // Bell unread count remains 0 and dropdown list remains empty
    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    expect(within(bellBtn).queryByText('1')).not.toBeInTheDocument()
    await userEvent.click(bellBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    expect(within(panel).getByText('Belum ada notifikasi')).toBeInTheDocument()
    expect(within(panel).queryByText('Aksi Lokal Berhasil')).not.toBeInTheDocument()
  })

  it('6. polling: panggilan ulang terjadi sesuai interval (fake timers) dan berhenti saat unmount', async () => {
    vi.useFakeTimers()
    notificationsApi.list
      .mockResolvedValueOnce({
        data: [],
        meta: { current_page: 1, per_page: 30, total: 0, last_page: 1, unread_count: 0 },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'n-poll-2',
            level: 'success',
            title: 'KHS Disetujui pada Polling',
            body: 'Disetujui oleh Manager.',
            tag: 'KHS',
            link: '/master-data/khs',
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 1, last_page: 1, unread_count: 1 },
      })

    const { unmount } = renderWithLayout(10000)

    await act(async () => {
      await Promise.resolve()
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(1)

    // Advance 10 seconds for next poll
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(2)
    expect(screen.getByText('KHS Disetujui pada Polling')).toBeInTheDocument()

    // Unmount stops polling
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(30000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(2)
  })

  it('7. galat API: lonceng tidak crash, daftar terakhir dipertahankan, dan menampilkan pesan server apa adanya', async () => {
    vi.useFakeTimers()
    notificationsApi.list
      .mockResolvedValueOnce({
        data: [
          {
            id: 'n-keep-1',
            level: 'info',
            title: 'Notifikasi Tersimpan Sebelumnya',
            body: 'Tetap terlihat saat gangguan jaringan.',
            tag: 'Sistem',
            link: null,
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 1, last_page: 1, unread_count: 1 },
      })
      .mockRejectedValueOnce(new Error('Layanan notifikasi sedang dalam pemeliharaan.'))

    renderWithLayout(10000)

    await act(async () => {
      await Promise.resolve()
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(1)

    // Second poll fails with server error
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(2)

    // No error toast spammed on polling failure
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    vi.useRealTimers()
    const bellBtn = screen.getByRole('button', { name: 'Notifikasi' })
    expect(within(bellBtn).getByText('1')).toBeInTheDocument()

    await userEvent.click(bellBtn)
    const panel = screen.getByRole('region', { name: 'Daftar notifikasi' })
    // Server error message shown verbatim inside bell panel
    expect(within(panel).getByText('Layanan notifikasi sedang dalam pemeliharaan.')).toBeInTheDocument()
    // Previous list preserved
    expect(within(panel).getByText('Notifikasi Tersimpan Sebelumnya')).toBeInTheDocument()
  })

  it('8. dedup toast polling: tidak menampilkan toast pada pemuatan awal maupun saat id sama diperbarui (stok menipis)', async () => {
    vi.useFakeTimers()
    notificationsApi.list
      // Initial load: has unread low-stock notification -> NO toast
      .mockResolvedValueOnce({
        data: [
          {
            id: 'n-stock-gd1',
            level: 'warning',
            title: 'Stok menipis di Gudang Utama',
            body: '2 item berada di bawah batas aman.',
            tag: 'Stok',
            link: '/master-data/warehouses',
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 1, last_page: 1, unread_count: 1 },
      })
      // Poll 2: same id refreshed by server (refreshOrCreate) -> NO duplicate toast
      .mockResolvedValueOnce({
        data: [
          {
            id: 'n-stock-gd1',
            level: 'warning',
            title: 'Stok menipis di Gudang Utama',
            body: '4 item berada di bawah batas aman.',
            tag: 'Stok',
            link: '/master-data/warehouses',
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 1, last_page: 1, unread_count: 1 },
      })
      // Poll 3: brand new id arrives -> toast IS shown
      .mockResolvedValueOnce({
        data: [
          {
            id: 'n-rkm-rejected',
            level: 'error',
            title: 'RKM Ditolak',
            body: 'Revisi volume tiang diperlukan.',
            tag: 'RKM',
            link: '/rkm/versions/v-1',
            read_at: null,
            created_at: new Date().toISOString(),
          },
          {
            id: 'n-stock-gd1',
            level: 'warning',
            title: 'Stok menipis di Gudang Utama',
            body: '4 item berada di bawah batas aman.',
            tag: 'Stok',
            link: '/master-data/warehouses',
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { current_page: 1, per_page: 30, total: 2, last_page: 1, unread_count: 2 },
      })

    renderWithLayout(10000)

    await act(async () => {
      await Promise.resolve()
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Poll 2 (same id n-stock-gd1 refreshed) -> still no toast
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Poll 3 (new id n-rkm-rejected) -> shows toast once
    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(3)
    const toast = screen.getByRole('status')
    expect(within(toast).getByText('RKM Ditolak')).toBeInTheDocument()
  })

  it('9. menghentikan polling saat tab tersembunyi dan tidak memanggil API saat pengguna belum login (guest)', async () => {
    vi.useFakeTimers()
    mockAuthState.current = {
      status: 'guest',
      user: null,
      mustChangePassword: false,
      mfaState: null,
      logout: vi.fn(),
    }

    const { unmount } = renderWithLayout(10000)
    await act(async () => {
      vi.advanceTimersByTime(20000)
    })
    expect(notificationsApi.list).not.toHaveBeenCalled()
    unmount()

    // Authenticated user, then tab becomes hidden
    mockAuthState.current = {
      status: 'authenticated',
      user: { id: 'u-2', name: 'Perencanaan', email: 'plan@distriva.id', account_status: 'ACTIVE' },
      mustChangePassword: false,
      mfaState: { required: false },
      logout: vi.fn(),
    }
    notificationsApi.list.mockResolvedValue({
      data: [],
      meta: { current_page: 1, per_page: 30, total: 0, last_page: 1, unread_count: 0 },
    })

    const visibilityGetter = vi.spyOn(document, 'visibilityState', 'get')
    visibilityGetter.mockReturnValue('visible')

    renderWithLayout(10000)
    await act(async () => {
      await Promise.resolve()
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(1)

    // Hide tab -> interval ticks should NOT trigger fetch
    visibilityGetter.mockReturnValue('hidden')
    await act(async () => {
      vi.advanceTimersByTime(20000)
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(1)

    // Tab becomes visible again -> triggers immediate refresh
    visibilityGetter.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(notificationsApi.list).toHaveBeenCalledTimes(2)

    visibilityGetter.mockRestore()
  })
})
