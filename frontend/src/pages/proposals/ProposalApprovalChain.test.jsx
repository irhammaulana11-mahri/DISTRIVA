import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { drawingApi, mtoApi } from '../../services/api.js'
import ProposalApprovalChain from './ProposalApprovalChain.jsx'

vi.mock('../../services/api.js', () => ({
  drawingApi: { forApplication: vi.fn(), get: vi.fn() },
  mtoApi: { forVersion: vi.fn() },
}))

const version = (patch = {}) => ({ id: 'v1', version_number: 1, status: 'SUBMITTED', stage: 'ULP_MANAGER', decisions: [], extended_approval: false, ...patch })

describe('ProposalApprovalChain (read-only chain for the KKF tab)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the drawing + MTO approval chain of the latest version', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: { id: 'd1' } })
    drawingApi.get.mockResolvedValue({ data: { id: 'd1', versions: [version({ status: 'UNDER_REVIEW', stage: 'UP3_REVIEW', decisions: [{ step: 'ULP_MANAGER', decision: 'APPROVED' }] })] } })
    mtoApi.forVersion.mockResolvedValue({ data: { id: 'm1', status: 'APPROVED' } })
    render(<ProposalApprovalChain representativeApplicationId="app-1" />)
    expect(await screen.findByText(/Rantai Persetujuan Versi 1/i)).toBeInTheDocument()
    expect(screen.getByText('Gambar Disetujui')).toBeInTheDocument()
    expect(screen.getByText('MTO Disetujui')).toBeInTheDocument()
    expect(screen.getByText(/2. Review UP3/i)).toBeInTheDocument()
  })

  it('shows the extended steps when the KKF made the approval extended', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: { id: 'd1' } })
    drawingApi.get.mockResolvedValue({ data: { id: 'd1', versions: [version({ extended_approval: true, extended_reason: 'PBP > 5 tahun' })] } })
    mtoApi.forVersion.mockResolvedValue({ data: null })
    render(<ProposalApprovalChain representativeApplicationId="app-1" />)
    expect(await screen.findByText(/4. Manager UP3/i)).toBeInTheDocument()
    expect(screen.getByText('Gambar Menunggu Keputusan')).toBeInTheDocument()
    expect(screen.getByText('MTO Belum Diverifikasi')).toBeInTheDocument()
  })

  it('says so when the usulan has no drawing package yet', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: null })
    render(<ProposalApprovalChain representativeApplicationId="app-1" />)
    expect(await screen.findByText(/belum dibuat/i)).toBeInTheDocument()
  })
  it('shows the next-step hint but leaves decision notes to the combined history tab', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: { id: 'd1' } })
    drawingApi.get.mockResolvedValue({ data: { id: 'd1', versions: [version({ status: 'UNDER_REVIEW', stage: 'UP3_REVIEW', decisions: [{ step: 'ULP_MANAGER', decision: 'APPROVED', decided_by_name: 'MULP Jombang', decided_role: 'MANAGER_ULP', notes: 'ok lanjut' }] })] } })
    mtoApi.forVersion.mockResolvedValue({ data: { id: 'm1', status: 'APPROVED' } })
    render(<ProposalApprovalChain representativeApplicationId="app-1" />)
    expect(await screen.findByText(/Menunggu review Perencanaan dan Konstruksi UP3/i)).toBeInTheDocument()
    expect(screen.queryByText(/Catatan Keputusan/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ok lanjut/)).not.toBeInTheDocument()
  })
})
