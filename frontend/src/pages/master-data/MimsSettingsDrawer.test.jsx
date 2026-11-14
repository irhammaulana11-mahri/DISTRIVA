import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MimsSettingsDrawer from './MimsSettingsDrawer.jsx'
import { warehousesApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'

vi.mock('../../services/api.js', () => ({
  warehousesApi: {
    mimsTokenStatus: vi.fn(),
    mimsAutoSettings: vi.fn(),
    saveMimsAutoSettings: vi.fn(),
    forgetMimsToken: vi.fn(),
  },
}))

describe('MimsSettingsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('menampilkan status token tersimpan, enkripsi, dan riwayat pemakaian', async () => {
    warehousesApi.mimsTokenStatus.mockResolvedValue({
      data: {
        saved: true,
        saved_at: '2026-11-01T08:00:00Z',
        last_used_at: '2026-11-10T08:00:00Z',
        last_result: 'OK',
      },
    })
    warehousesApi.mimsAutoSettings.mockResolvedValue({
      data: {
        auto_enabled: true,
        auto_time: '02:30',
        auto_stock: true,
        auto_issues: true,
        auto_receipts: false,
        auto_user_name: 'Irham Administrator',
        last_auto_date: '2026-11-14',
      },
    })

    render(
      <NotificationProvider>
        <MimsSettingsDrawer isOpen={true} onClose={vi.fn()} />
      </NotificationProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Pengaturan Tarik Otomatis & Token MIMS')).toBeInTheDocument()
      expect(screen.getByText(/Tersimpan \(Aktif\)/i)).toBeInTheDocument()
      expect(screen.getByText(/terenkripsi AES-256/i)).toBeInTheDocument()
      expect(screen.getByText(/Irham Administrator/i)).toBeInTheDocument()
    })
  })

  it('dapat mengubah jam dan menyimpan pengaturan tarik otomatis harian', async () => {
    warehousesApi.mimsTokenStatus.mockResolvedValue({
      data: { saved: true, saved_at: '2026-11-01T08:00:00Z' },
    })
    warehousesApi.mimsAutoSettings.mockResolvedValue({
      data: {
        auto_enabled: false,
        auto_time: '02:00',
        auto_stock: true,
        auto_issues: true,
        auto_receipts: true,
      },
    })
    warehousesApi.saveMimsAutoSettings.mockResolvedValue({
      data: {
        auto_enabled: true,
        auto_time: '04:15',
        auto_stock: true,
        auto_issues: true,
        auto_receipts: true,
      },
    })

    const onSaveChanged = vi.fn()
    render(
      <NotificationProvider>
        <MimsSettingsDrawer isOpen={true} onClose={vi.fn()} onChanged={onSaveChanged} />
      </NotificationProvider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Waktu Penarikan/i)).toBeInTheDocument()
    })

    const timeInput = screen.getByLabelText(/Waktu Penarikan/i)
    fireEvent.change(timeInput, { target: { value: '04:15' } })

    const saveBtn = screen.getByRole('button', { name: /Aktifkan Tarik Otomatis/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(warehousesApi.saveMimsAutoSettings).toHaveBeenCalledWith({
        auto_enabled: true,
        auto_time: '04:15',
        auto_stock: true,
        auto_issues: true,
        auto_receipts: true,
      })
      expect(onSaveChanged).toHaveBeenCalled()
    })
  })

  it('dapat menghapus token tersimpan dari server dengan konfirmasi aman', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    warehousesApi.mimsTokenStatus.mockResolvedValue({
      data: { saved: true, saved_at: '2026-11-01T08:00:00Z' },
    })
    warehousesApi.mimsAutoSettings.mockResolvedValue({ data: {} })
    warehousesApi.forgetMimsToken.mockResolvedValue({ message: 'ok' })

    render(
      <NotificationProvider>
        <MimsSettingsDrawer isOpen={true} onClose={vi.fn()} />
      </NotificationProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hapus Token Tersimpan/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Hapus Token Tersimpan/i }))

    await waitFor(() => {
      expect(warehousesApi.forgetMimsToken).toHaveBeenCalled()
    })
  })
})
