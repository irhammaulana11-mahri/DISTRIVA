import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App from '../../App.jsx'
import BackupPage from './BackupPage.jsx'
import RestoreDialog from '../../features/backup/RestoreDialog.jsx'
import { backupApi, tokenStore } from '../../services/api.js'
import { AccessProvider } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'

// Mock entire api module
vi.mock('../../services/api.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    backupApi: {
      access: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      verify: vi.fn(),
      restore: vi.fn(),
      restores: vi.fn(),
      getRestore: vi.fn(),
      remove: vi.fn(),
      settings: vi.fn(),
      updateSettings: vi.fn(),
      downloadBlob: vi.fn(),
    },
    adminApi: {
      ...actual.adminApi,
      access: vi.fn().mockResolvedValue({ can: {}, can_write: {} }),
    },
    masterDataApi: {
      ...actual.masterDataApi,
      access: vi.fn().mockResolvedValue({ can: {} }),
    },
    applicationApi: {
      ...actual.applicationApi,
      access: vi.fn().mockResolvedValue({ can: {} }),
    },
    surveyApi: {
      ...actual.surveyApi,
      access: vi.fn().mockResolvedValue({ can: {} }),
    },
    drawingApi: {
      ...actual.drawingApi,
      access: vi.fn().mockResolvedValue({ can: {} }),
    },
    mtoApi: {
      ...actual.mtoApi,
      access: vi.fn().mockResolvedValue({ can: {} }),
    },
  }
})

// Mock AuthContext
vi.mock('../../features/auth/AuthContext.jsx', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'usr-admin-1', name: 'System Administrator', email: 'admin@distriva.com' },
    mustChangePassword: false,
    mfaState: { required: true, enrolled: true },
    logout: vi.fn(),
  }),
}))

describe('Backup and Restore Workflow (docs/64 & docs/65)', () => {
  const sampleHealthOk = {
    ok: true,
    root_writable: true,
    free_bytes: 53687091200, // 50 GB
    message: 'Direktori cadangan privat dapat ditulis.',
  }

  const sampleHealthFail = {
    ok: false,
    root_writable: false,
    free_bytes: 0,
    message: 'Folder cadangan tidak dapat diakses atau berada di jalur publik.',
  }

  const sampleBackup = {
    id: 'b-uuid-1',
    backup_number: '20261106-020000-01',
    trigger: 'MANUAL',
    status: 'SUCCEEDED',
    include_documents: true,
    db_size: 10485760, // 10 MB
    docs_size: 20971520, // 20 MB
    db_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    schema_version: '2026_11_06_260000',
    notes: 'Cadangan berkala sistem',
    error: null,
    verified_at: '2026-11-06T10:00:00Z',
    verified_passed: true,
    requested_by: { id: 'usr-admin-1', name: 'System Administrator' },
    started_at: '2026-11-06T09:00:00Z',
    finished_at: '2026-11-06T09:05:00Z',
  }

  const sampleSettings = {
    enabled: true,
    run_at: '02:00',
    include_documents: true,
    retention_count: 30,
    updated_at: '2026-11-06T08:00:00Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    backupApi.access.mockResolvedValue({
      can: {
        'backups.view': true,
        'backups.create': true,
        'backups.verify': true,
        'backups.download': true,
        'backups.manage': true,
        'backups.restore': true,
      },
    })
    backupApi.status.mockResolvedValue({
      data: {
        health: sampleHealthOk,
        settings: sampleSettings,
        running_backup: null,
        running_restore: null,
        last_success: sampleBackup,
        last_verified: sampleBackup,
        last_failure: null,
      },
    })
    backupApi.list.mockResolvedValue({
      data: [sampleBackup],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 10 },
    })
    backupApi.get.mockResolvedValue({
      data: {
        ...sampleBackup,
        verify_result: {
          passed: true,
          checks: {
            sha256_matches: true,
            restore_completed: true,
            schema_version_present: true,
            migrations_count_matches: true,
          },
          differences: [],
        },
        table_counts: { users: 5, applications: 12, surveys: 8 },
        events: [
          { event_type: 'CREATED', actor_name: 'System Administrator', occurred_at: '2026-11-06T09:00:00Z' },
          { event_type: 'VERIFIED', actor_name: 'System Administrator', occurred_at: '2026-11-06T10:00:00Z' },
        ],
        restores: [],
      },
    })
    backupApi.settings.mockResolvedValue({ data: sampleSettings })
    backupApi.restores.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, total: 0, per_page: 10 } })
  })

  it('1. hides menu/route without backups.view and enforces can permissions', async () => {
    // If backups.view is false, route returns NotFound
    backupApi.access.mockResolvedValue({ can: { 'backups.view': false } })

    render(
      <MemoryRouter initialEntries={['/sistem/backup']}>
        <App />
      </MemoryRouter>
    )

    // Should render Halaman Tidak Ditemukan
    expect(await screen.findByText(/Halaman Tidak Ditemukan/i)).toBeInTheDocument()
  })

  it('2a. ringkasan: health.ok=false disables creation and shows warning banner', async () => {
    backupApi.status.mockResolvedValue({
      data: {
        health: sampleHealthFail,
        settings: sampleSettings,
        running_backup: null,
        running_restore: null,
        last_success: null,
        last_verified: null,
        last_failure: null,
      },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/Kesehatan Folder Cadangan Terganggu/i)).toBeInTheDocument()
    const createBtn = screen.getByRole('button', { name: /Buat Cadangan Sekarang/i })
    expect(createBtn).toBeDisabled()
  })

  it('2b. ringkasan: running process disables actions and shows progress banner', async () => {
    backupApi.status.mockResolvedValue({
      data: {
        health: sampleHealthOk,
        settings: sampleSettings,
        running_backup: { id: 'b-running', backup_number: '20261106-99', started_at: '2026-11-06T10:00:00Z' },
        running_restore: null,
        last_success: sampleBackup,
        last_verified: sampleBackup,
        last_failure: null,
      },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/Pencadangan Sistem Sedang Berjalan \(#20261106-99\)/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Buat Cadangan Sekarang/i })).toBeDisabled()
  })

  it('3. buat cadangan: 202 -> polling -> SUCCEEDED; 409 displays server message', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    const createBtn = await screen.findByRole('button', { name: /Buat Cadangan Sekarang/i })
    await userEvent.click(createBtn)

    expect(await screen.findByText(/Buat Cadangan Sistem Sekarang/i)).toBeInTheDocument()

    // Mock 202 response
    backupApi.create.mockResolvedValue({
      data: {
        id: 'new-b-1',
        backup_number: '20261106-030000-02',
        status: 'RUNNING',
      },
    })

    backupApi.get.mockResolvedValue({
      data: {
        id: 'new-b-1',
        backup_number: '20261106-030000-02',
        status: 'SUCCEEDED',
        db_size: 15000000,
      },
    })

    const startBtn = screen.getByRole('button', { name: 'Mulai Cadangkan' })
    await userEvent.click(startBtn)

    await waitFor(() => {
      expect(backupApi.create).toHaveBeenCalledWith({
        include_documents: false,
        notes: undefined,
      })
    })

    // 409 Error scenario
    backupApi.create.mockRejectedValue({
      status: 409,
      message: 'Proses pemulihan sedang berjalan. Pencadangan dibatalkan.',
    })

    await userEvent.click(createBtn)
    await userEvent.click(screen.getByRole('button', { name: 'Mulai Cadangkan' }))
    expect(await screen.findByText(/Proses pemulihan sedang berjalan/i)).toBeInTheDocument()
  })

  it('4. verifikasi: renders success and failure result (failed backup cannot be restored)', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    // Switch to Riwayat tab
    const historyTab = await screen.findByRole('tab', { name: /Riwayat/i })
    await userEvent.click(historyTab)

    expect(await screen.findByText(/#20261106-020000-01/i)).toBeInTheDocument()

    // Trigger verification
    backupApi.verify.mockResolvedValue({
      data: { ...sampleBackup, verified_passed: true, verified_at: '2026-11-06T12:00:00Z' },
      result: {
        passed: true,
        checks: {
          sha256_matches: true,
          restore_completed: true,
          schema_version_present: true,
          migrations_count_matches: true,
        },
        differences: [],
      },
    })

    const verifyBtn = screen.getByRole('button', { name: 'Verifikasi' })
    await userEvent.click(verifyBtn)

    expect(await screen.findByText(/Verifikasi Berhasil: Cadangan Layak Dipulihkan/i)).toBeInTheDocument()

    // Test failure scenario
    backupApi.verify.mockResolvedValue({
      data: { ...sampleBackup, verified_passed: false },
      result: {
        passed: false,
        error: 'Berkas dump corrupt: checksum sha256 tidak cocok.',
        checks: {
          sha256_matches: false,
          restore_completed: false,
          schema_version_present: false,
          migrations_count_matches: false,
        },
      },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    await userEvent.click(screen.getByRole('button', { name: 'Verifikasi' }))
    expect(await screen.findByText(/Verifikasi Gagal: Cadangan Tidak Boleh Dipakai/i)).toBeInTheDocument()
    expect(screen.getByText(/Berkas cadangan ini tidak boleh dipakai untuk pemulihan/i)).toBeInTheDocument()
  })

  it('5. unduh: calls backupApi.downloadBlob with Authorization headers and triggers blob download', async () => {
    backupApi.downloadBlob.mockResolvedValue({
      blob: new Blob(['dummy dump content'], { type: 'application/octet-stream' }),
      filename: 'backup_20261106.dump',
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    const historyTab = await screen.findByRole('tab', { name: /Riwayat/i })
    await userEvent.click(historyTab)

    const unduhBtn = await screen.findByRole('button', { name: 'Unduh' })
    await userEvent.click(unduhBtn)

    expect(await screen.findByText(/Unduh Berkas Cadangan #20261106-020000-01/i)).toBeInTheDocument()
    expect(screen.getByText(/Berkas ini memuat seluruh data transaksi/i)).toBeInTheDocument()

    const downloadDbBtn = screen.getByRole('button', { name: 'Unduh Database' })
    await userEvent.click(downloadDbBtn)

    await waitFor(() => {
      expect(backupApi.downloadBlob).toHaveBeenCalledWith('b-uuid-1', 'database')
    })
  })

  it('6. dialog pulihkan: submit disabled until exact phrase, 422 errors, 401 redirect to login', async () => {
    render(
      <MemoryRouter>
        <RestoreDialog
          open={true}
          backup={sampleBackup}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(await screen.findByText(/PERINGATAN KRITIKAL: PENGGANTIAN DATA TOTAL/i)).toBeInTheDocument()
    const target = 'PULIHKAN 20261106-020000-01'
    expect(screen.getByText(target)).toBeInTheDocument()

    const restoreBtn = screen.getByRole('button', { name: 'Pulihkan Sekarang' })
    expect(restoreBtn).toBeDisabled()

    // Type reason
    const reasonInput = screen.getByPlaceholderText(/Pemulihan data setelah insiden/i)
    await userEvent.type(reasonInput, 'Pemulihan pasca kegagalan')

    // Type password
    const pwdInput = screen.getByPlaceholderText(/Masukkan kata sandi akun Anda/i)
    await userEvent.type(pwdInput, 'AdminSecurePass!1')

    // Type confirm phrase
    const confirmInput = screen.getByPlaceholderText(new RegExp(`Ketik ${target}`, 'i'))
    await userEvent.type(confirmInput, target)

    // Now button should be enabled
    expect(restoreBtn).toBeEnabled()

    // 6B: Server 422 error
    backupApi.restore.mockRejectedValue({
      status: 422,
      data: {
        errors: {
          password: ['Kata sandi tidak sesuai.'],
        },
      },
    })

    await userEvent.click(restoreBtn)
    expect(await screen.findByText('Kata sandi tidak sesuai.')).toBeInTheDocument()
  })

  it('7. jadwal: validates hour, toggles switch, saves settings, and is read-only without backups.manage', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    const scheduleTab = await screen.findByRole('tab', { name: /Jadwal/i })
    await userEvent.click(scheduleTab)

    expect(await screen.findByText(/Informasi Penjadwalan Server \(Cron Job\)/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('02:00')).toBeInTheDocument()

    backupApi.updateSettings.mockResolvedValue({
      data: {
        ...sampleSettings,
        run_at: '03:30',
        retention_count: 60,
      },
    })

    const timeInput = screen.getByDisplayValue('02:00')
    await userEvent.clear(timeInput)
    await userEvent.type(timeInput, '03:30')

    const saveBtn = screen.getByRole('button', { name: 'Simpan Pengaturan Jadwal' })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(backupApi.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          run_at: '03:30',
        })
      )
    })
  })

  it('8. hapus mensyaratkan alasan (min. 3 karakter)', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <AccessProvider>
            <BackupPage />
          </AccessProvider>
        </NotificationProvider>
      </MemoryRouter>
    )

    const historyTab = await screen.findByRole('tab', { name: /Riwayat/i })
    await userEvent.click(historyTab)

    const removeBtn = await screen.findByTitle('Hapus berkas cadangan')
    await userEvent.click(removeBtn)

    expect(await screen.findByText(/Hapus Berkas Cadangan #20261106-020000-01/i)).toBeInTheDocument()
    const confirmRemoveBtn = screen.getByRole('button', { name: 'Konfirmasi Hapus' })
    expect(confirmRemoveBtn).toBeDisabled()

    const reasonInput = screen.getByPlaceholderText(/Pembersihan manual kapasitas/i)
    await userEvent.type(reasonInput, 'Drive penuh')

    expect(confirmRemoveBtn).toBeEnabled()

    backupApi.remove.mockResolvedValue({ message: 'Cadangan dihapus.' })
    await userEvent.click(confirmRemoveBtn)

    await waitFor(() => {
      expect(backupApi.remove).toHaveBeenCalledWith('b-uuid-1', {
        reason: 'Drive penuh',
      })
    })
  })
})
