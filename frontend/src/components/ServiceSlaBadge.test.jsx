import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ServiceSlaBadge, { slaBadgeText } from './ServiceSlaBadge.jsx'
import { serviceSlaApi } from '../services/api.js'

vi.mock('../services/api.js', () => ({ serviceSlaApi: { forApplication: vi.fn() } }))

const base = { category_label: 'Layanan: tambah JTM / trafo', working_days: 24, due_at: '2026-12-10T16:59:59Z', late_working_days: 0, working_days_left: 5 }

describe('ServiceSlaBadge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('teks menurut status SLA TMP', () => {
    expect(slaBadgeText({ ...base, status: 'ON_TRACK' })).toMatch(/sisa 5 hari kerja/)
    expect(slaBadgeText({ ...base, status: 'OVERDUE', late_working_days: 3 })).toMatch(/Melewati SLA TMP 3 hari kerja/)
    expect(slaBadgeText({ ...base, status: 'NOT_STARTED' })).toBe('SLA TMP 24 hari kerja mulai setelah bayar')
    expect(slaBadgeText({ ...base, status: 'MET' })).toBe('SLA TMP terpenuhi')
  })

  it('kategori tanpa perluasan (4 hari kerja) memakai teks yang sama dari data server', () => {
    const tanpaPerluasan = { ...base, category_label: 'Layanan: tanpa perluasan jaringan', working_days: 4, working_days_left: 2 }
    expect(slaBadgeText({ ...tanpaPerluasan, status: 'ON_TRACK' })).toMatch(/SLA TMP 4 hari kerja: sisa 2 hari kerja/)
    expect(slaBadgeText({ ...tanpaPerluasan, status: 'NOT_STARTED' })).toBe('SLA TMP 4 hari kerja mulai setelah bayar')
  })

  it('menampilkan sisa waktu dan diam bila permohonan tak punya SLA layanan atau galat', async () => {
    serviceSlaApi.forApplication.mockResolvedValueOnce({ data: { ...base, status: 'DUE_SOON' } })
    const { unmount } = render(<ServiceSlaBadge applicationId="a-1" />)
    expect(await screen.findByTestId('service-sla-badge')).toHaveTextContent('sisa 5 hari kerja')
    unmount()

    serviceSlaApi.forApplication.mockResolvedValueOnce({ data: null })
    render(<ServiceSlaBadge applicationId="a-2" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('service-sla-badge')).not.toBeInTheDocument()

    serviceSlaApi.forApplication.mockRejectedValueOnce(new Error('403'))
    render(<ServiceSlaBadge applicationId="a-3" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('service-sla-badge')).not.toBeInTheDocument()
  })
})
