import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { drawingApi } from '../../services/api.js'
import ProposalHistoryTimeline, { buildTimeline } from './ProposalHistoryTimeline.jsx'

vi.mock('../../services/api.js', () => ({ drawingApi: { forApplication: vi.fn(), get: vi.fn() } }))

const events = [
  { event_type: 'CREATED', actor_name: 'teknik jombang', reason: 'Dibuat otomatis', occurred_at: '2026-11-11 12:13:50+00' },
  { event_type: 'MEMBER_ADDED', actor_name: 'MULP Jombang', reason: 'satu lokasi', occurred_at: '2026-11-11 12:18:09+00' },
]
const drawing = {
  versions: [
    { id: 'v1', version_number: 1, status: 'RETURNED', returned_at_step: 'REVIEW_KONSTRUKSI', submitted_at: '2026-11-12T05:00:00Z',
      decisions: [
        { step: 'ULP_MANAGER', decision: 'APPROVED', decided_by_name: 'MULP Jombang', decided_role: 'MANAGER_ULP', notes: 'ok', decided_at: '2026-11-12T05:16:00Z' },
        { step: 'REVIEW_KONSTRUKSI', decision: 'REJECTED', decided_by_name: 'Konstruksi', decided_role: 'KONSTRUKSI_UP3', notes: 'Tiang kurang', decided_at: '2026-11-12T05:54:00Z' },
      ] },
    { id: 'v2', version_number: 2, status: 'SUBMITTED', submitted_at: '2026-11-12T06:30:00Z', decisions: [] },
  ],
}

describe('ProposalHistoryTimeline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('merges proposal events, submissions, decisions and rejections newest first', () => {
    const items = buildTimeline(events, drawing)
    expect(items.map((i) => i.title)).toEqual([
      'Gambar & MTO diajukan untuk persetujuan',
      expect.stringContaining('Review Konstruksi'),
      expect.stringContaining('Persetujuan Manager ULP'),
      'Gambar & MTO diajukan untuk persetujuan',
      'Anggota ditambahkan',
      'Usulan dibuat',
    ])
    expect(items[1].tone).toBe('bad')
    expect(items[1].after).toMatch(/dikembalikan/)
  })

  it('renders one list with notes and filters rejections only', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: { id: 'd1' } })
    drawingApi.get.mockResolvedValue({ data: drawing })
    render(<ProposalHistoryTimeline events={events} representativeApplicationId="app-1" />)
    expect(await screen.findByText(/Tiang kurang/)).toBeInTheDocument()
    expect(screen.getByText('Anggota ditambahkan')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Penolakan \(1\)/ }))
    expect(screen.getByText(/Tiang kurang/)).toBeInTheDocument()
    expect(screen.queryByText('Anggota ditambahkan')).not.toBeInTheDocument()
  })

  it('still lists the proposal events when there is no drawing package', async () => {
    drawingApi.forApplication.mockResolvedValue({ data: null })
    render(<ProposalHistoryTimeline events={events} representativeApplicationId="app-1" />)
    expect(await screen.findByText('Usulan dibuat')).toBeInTheDocument()
  })
})
