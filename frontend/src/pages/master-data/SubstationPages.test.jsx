import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubstationDetailPage, SubstationEditPage, SubstationMeasurementDetailPage } from './SubstationPages.jsx'
import { substationsApi, feedersApi, adminApi } from '../../services/api.js'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'

vi.mock('../../services/api.js', () => ({
  substationsApi: {
    get: vi.fn(),
    update: vi.fn(),
    analysis: vi.fn(),
    addReading: vi.fn(),
  },
  feedersApi: {
    list: vi.fn(),
  },
  adminApi: {
    units: vi.fn(),
  },
}))

const mockSubstation = {
  id: 'sub-123',
  code: 'HL0257',
  name: 'Gardu HL0257',
  unit_code: '51453',
  unit_name: 'ULP Nganjuk',
  feeder_code: 'GNDNG',
  capacity_kva: 25,
  ownership: 'PLN',
  status: 'AKTIF',
  pickable: true,
  needs_review: false,
}

describe('SubstationPages — Dedicated Drawer Pages (PanelShell asPage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    feedersApi.list.mockResolvedValue({
      data: [{ id: 'f-1', code: 'GNDNG', name: 'GONDANG' }],
    })
    substationsApi.get.mockResolvedValue({
      data: {
        substation: mockSubstation,
        transformers: [{ slot: 1, capacity_kva: 25, brand: 'TRAFINDO', year_made: 2020, serial_number: 'SN-1122', phase_count: 3 }],
        customers: { active_customers: 50, connected_kva: 45, connected_va: 45000, large_customers: 2 },
        history: [],
        readings: [],
      },
    })
    substationsApi.analysis.mockResolvedValue({
      data: {
        summary: {
          load_status: 'NORMAL',
          latest_loading_pct: 45,
          voltage_status: 'NORMAL',
          lowest_end_voltage_v: 220,
          phase_balance_status: 'BALANCED',
          feeder_balance_status: 'BALANCED',
        },
        history: [],
      },
    })
  })

  it('1. SubstationDetailPage merender halaman detail gardu penuh dengan tombol kembali dan aksi ubah', async () => {
    render(
      <MemoryRouter initialEntries={['/master-data/substations/sub-123']}>
        <AccessContext.Provider value={{ can: { 'substations.view': true, 'substations.manage': true, 'feeders.view': true, 'customers.view': true }, isSysAdmin: false }}>
          <NotificationProvider>
            <Routes>
              <Route path="/master-data/substations/:id" element={<SubstationDetailPage />} />
            </Routes>
          </NotificationProvider>
        </AccessContext.Provider>
      </MemoryRouter>
    )

    expect(await screen.findByTestId('substation-detail')).toBeInTheDocument()
    expect(screen.getAllByText(/HL0257/).length).toBeGreaterThan(0)
    expect(screen.getByText('← Kembali')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ubah Data Induk/i })).toBeInTheDocument()
  })

  it('2. SubstationEditPage merender halaman formulir edit gardu penuh dengan input dan tombol simpan', async () => {
    render(
      <MemoryRouter initialEntries={['/master-data/substations/sub-123/ubah']}>
        <AccessContext.Provider value={{ can: { 'substations.manage': true }, isSysAdmin: false }}>
          <NotificationProvider>
            <Routes>
              <Route path="/master-data/substations/:id/ubah" element={<SubstationEditPage />} />
            </Routes>
          </NotificationProvider>
        </AccessContext.Provider>
      </MemoryRouter>
    )

    expect(await screen.findByTestId('edit-substation-form')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Gardu HL0257')).toBeInTheDocument()
    expect(screen.getByLabelText(/Alasan Perubahan/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simpan Perubahan/i })).toBeInTheDocument()
  })

  it('3. SubstationMeasurementDetailPage merender halaman kondisi & analisis gardu beserta formulir pembacaan operasional', async () => {
    render(
      <MemoryRouter initialEntries={['/master-data/substation-measurements/sub-123']}>
        <AccessContext.Provider value={{ can: { 'substations.view': true, 'substations.reading': true, 'feeders.view': true }, isSysAdmin: false }}>
          <NotificationProvider>
            <Routes>
              <Route path="/master-data/substation-measurements/:id" element={<SubstationMeasurementDetailPage />} />
            </Routes>
          </NotificationProvider>
        </AccessContext.Provider>
      </MemoryRouter>
    )

    expect(await screen.findByTestId('substation-measurement-detail')).toBeInTheDocument()
    expect(screen.getByText('← Kembali')).toBeInTheDocument()
    expect(screen.getByTestId('reading-form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simpan pembacaan/i })).toBeInTheDocument()
  })
})
