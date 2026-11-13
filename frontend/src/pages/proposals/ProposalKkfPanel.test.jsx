import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import ProposalKkfPanel from './ProposalKkfPanel.jsx'
import { kkfRunsApi, drawingApi, mtoApi, rabRunsApi, kkoApi, applicationApi, proposalsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  proposalsApi: { kkfRuns: vi.fn() },
  kkfRunsApi: { preview: vi.fn(), run: vi.fn(), get: vi.fn() },
  drawingApi: { forApplication: vi.fn() },
  mtoApi: { forVersion: vi.fn() },
  rabRunsApi: { listForPackage: vi.fn(), run: vi.fn() },
  kkoApi: { get: vi.fn() },
  applicationApi: { get: vi.fn() },
}))

const proposal = (patch = {}) => ({ id: 'p1', status: 'OPEN', representative_application_id: 'a1', members: [{ id: 'a1' }, { id: 'a2' }], ...patch })

function setup({ mto = { id: 'm1', status: 'APPROVED' }, rab = [{ id: 'r1', run_number: 1 }], preview = { rab_run: { run_number: 1 }, blockers: [] } } = {}) {
  proposalsApi.kkfRuns.mockResolvedValue({ data: [] })
  kkfRunsApi.preview.mockResolvedValue({ data: preview })
  applicationApi.get.mockResolvedValue({ data: { id: 'a1' } })
  kkoApi.get.mockResolvedValue({ data: null })
  drawingApi.forApplication.mockResolvedValue({ data: { id: 'd1', versions: [{ id: 'v1' }] } })
  mtoApi.forVersion.mockResolvedValue({ data: mto })
  rabRunsApi.listForPackage.mockResolvedValue({ data: rab })
}

const mount = (props) => render(<NotificationProvider><ProposalKkfPanel canView {...props} /></NotificationProvider>)
const btn = (name) => screen.getByRole('button', { name })

describe('ProposalKkfPanel buttons follow status, role and prerequisites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enables every button when the MTO is approved, a RAB run exists and the user may run both', async () => {
    setup()
    mount({ proposal: proposal(), canRun: true, canRunRab: true })
    await waitFor(() => expect(rabRunsApi.listForPackage).toHaveBeenCalled())
    await waitFor(() => expect(btn(/Hitung RAB \(Dry Run\)/)).toBeEnabled())
    expect(btn(/Simpan Run RAB/)).toBeEnabled()
    expect(btn(/Hitung \(Dry Run\)/)).toBeEnabled()
    expect(btn(/Simpan Run KKF/)).toBeEnabled()
    expect(screen.queryByText(/Belum dapat dijalankan/i)).not.toBeInTheDocument()
  })

  it('blocks RAB and KKF with the reason while the MTO is not approved', async () => {
    setup({ mto: { id: 'm1', status: 'VERIFIED' }, rab: [], preview: { rab_run: null, blockers: ['Permohonan belum memiliki run RAB'] } })
    mount({ proposal: proposal(), canRun: true, canRunRab: true })
    await waitFor(() => expect(mtoApi.forVersion).toHaveBeenCalled())
    expect(await screen.findByText(/Belum dapat dijalankan/i)).toBeInTheDocument()
    expect(screen.getByText(/MTO berstatus VERIFIED/i)).toBeInTheDocument()
    expect(btn(/Hitung RAB \(Dry Run\)/)).toBeDisabled()
    expect(btn(/Simpan Run RAB/)).toBeDisabled()
    expect(btn(/Hitung \(Dry Run\)/)).toBeDisabled()
    expect(btn(/Simpan Run KKF/)).toBeDisabled()
  })

  it('needs a saved RAB run before the KKF can run, even with an approved MTO', async () => {
    setup({ rab: [], preview: { rab_run: null, blockers: ['Permohonan belum memiliki run RAB'] } })
    mount({ proposal: proposal(), canRun: true, canRunRab: true })
    await waitFor(() => expect(mtoApi.forVersion).toHaveBeenCalled())
    await waitFor(() => expect(btn(/Hitung RAB \(Dry Run\)/)).toBeEnabled())
    expect(btn(/Hitung \(Dry Run\)/)).toBeDisabled()
    expect(btn(/Simpan Run KKF/)).toBeDisabled()
    expect(screen.getByText(/Belum ada run RAB tersimpan/i)).toBeInTheDocument()
  })

  it('locks all four run buttons once drawing and MTO are fully approved, keeping the saved documents reachable', async () => {
    setup()
    const reason = 'Gambar & MTO sudah disetujui seluruhnya, sehingga RAB dan KKF dikunci.'
    mount({ proposal: proposal(), canRun: true, canRunRab: true, lockedReason: reason })
    await waitFor(() => expect(rabRunsApi.listForPackage).toHaveBeenCalled())
    for (const name of [/Hitung RAB \(Dry Run\)/, /Simpan Run RAB/, /Hitung \(Dry Run\)/, /Simpan Run KKF/]) {
      await waitFor(() => expect(btn(name)).toBeDisabled())
      expect(btn(name)).toHaveAttribute('title', expect.stringMatching(/dikunci/))
    }
    expect((await screen.findAllByText(/sehingga RAB dan KKF dikunci/)).length).toBeGreaterThan(0)
  })

  it('hides the buttons a role may not use and tells a viewer it is read-only', async () => {
    setup()
    const { unmount } = mount({ proposal: proposal(), canRun: false, canRunRab: false })
    await waitFor(() => expect(mtoApi.forVersion).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Hitung RAB/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simpan Run/ })).not.toBeInTheDocument()
    expect(screen.getByText(/hanya dapat melihat/i)).toBeInTheDocument()
    unmount()

    setup()
    mount({ proposal: proposal(), canRun: true, canRunRab: false })        // KKF only: no RAB buttons
    await waitFor(() => expect(mtoApi.forVersion).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Hitung RAB/ })).not.toBeInTheDocument()
    expect(btn(/Simpan Run KKF/)).toBeInTheDocument()
  })

  it('disables everything for a cancelled usulan', async () => {
    setup()
    mount({ proposal: proposal({ status: 'CANCELLED' }), canRun: true, canRunRab: true })
    await waitFor(() => expect(mtoApi.forVersion).toHaveBeenCalled())
    expect((await screen.findAllByText(/Usulan sudah dibatalkan/i)).length).toBeGreaterThanOrEqual(1)
    expect(btn(/Hitung RAB \(Dry Run\)/)).toBeDisabled()
    expect(btn(/Simpan Run KKF/)).toBeDisabled()
  })
})
