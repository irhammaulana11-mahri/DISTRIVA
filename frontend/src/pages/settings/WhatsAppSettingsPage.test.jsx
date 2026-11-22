import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WhatsAppSettingsPage from './WhatsAppSettingsPage.jsx'
import { whatsappSettingsApi } from '../../services/api.js'

vi.mock('../../services/api.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, whatsappSettingsApi: { show: vi.fn(), save: vi.fn(), test: vi.fn() } }
})
vi.mock('../../features/notifications/NotificationContext.jsx', () => ({ useNotifications: () => ({ notify: vi.fn() }) }))

const SETTINGS = {
  source: 'ENV', driver: 'http', url: 'https://wa.example.test/send', method: 'POST', auth_header: 'Authorization', auth_prefix: '', has_token: true,
  body_format: 'json', body: '{"target":"{phone}","message":"{message}"}', success_path: 'status', success_value: 'true', timeout: 10, default_country_code: '62',
  updated_at: null, updated_by_email: null,
}

describe('Pengaturan WhatsApp', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    whatsappSettingsApi.show.mockResolvedValue({ data: SETTINGS, events: [] })
  })

  it('tidak menampilkan token, memberi tahu sumber .env, dan menyimpan tanpa token bila kolom kosong', async () => {
    whatsappSettingsApi.save.mockResolvedValue({ data: { ...SETTINGS, source: 'WEB', updated_by_email: 'admin@x.test' }, events: [] })
    render(<WhatsAppSettingsPage />)
    expect(await screen.findByText(/masih memakai nilai dari berkas \.env/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Token API')).toHaveValue('')
    expect(screen.getByText(/Token sudah tersimpan/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Simpan pengaturan/i }))
    await waitFor(() => expect(whatsappSettingsApi.save).toHaveBeenCalledTimes(1))
    const sent = whatsappSettingsApi.save.mock.calls[0][0]
    expect(sent.token).toBeUndefined()
    expect(sent.url).toBe('https://wa.example.test/send')
    expect(await screen.findByText(/Memakai pengaturan dari halaman ini/i)).toBeInTheDocument()
  })

  it('mengirim token baru hanya bila diisi dan menampilkan hasil uji kirim', async () => {
    whatsappSettingsApi.save.mockResolvedValue({ data: { ...SETTINGS, source: 'WEB' }, events: [] })
    whatsappSettingsApi.test.mockResolvedValue({ data: { status: 'OK', message: 'Pesan uji dikirim; periksa WhatsApp penerima.' }, events: [] })
    render(<WhatsAppSettingsPage />)
    await userEvent.type(await screen.findByLabelText('Token API'), 'TOKEN-BARU')
    await userEvent.click(screen.getByRole('button', { name: /Simpan pengaturan/i }))
    await waitFor(() => expect(whatsappSettingsApi.save).toHaveBeenCalled())
    expect(whatsappSettingsApi.save.mock.calls[0][0].token).toBe('TOKEN-BARU')

    await userEvent.click(screen.getByRole('tab', { name: /Uji Kirim Pesan/i }))
    await userEvent.type(screen.getByLabelText('Nomor tujuan'), '081234567890')
    await userEvent.click(screen.getByRole('button', { name: /Kirim pesan uji/i }))
    expect(await screen.findByText(/Pesan uji dikirim/i)).toBeInTheDocument()
    expect(whatsappSettingsApi.test).toHaveBeenCalledWith({ phone: '081234567890' })
  })

  it('menampilkan alasan bila bukan SYS_ADMIN (403)', async () => {
    whatsappSettingsApi.show.mockRejectedValue({ status: 403, message: 'Tidak berwenang.' })
    render(<WhatsAppSettingsPage />)
    expect(await screen.findByText(/hanya untuk SYS_ADMIN/i)).toBeInTheDocument()
  })
})
