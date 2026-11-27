import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import { syncApi } from '../../services/api.js'
import SyncCenterPage from './SyncCenterPage.jsx'

vi.mock('../../services/api.js', () => ({
  syncApi: {
    active: vi.fn().mockResolvedValue({ data: [] }),
  },
}))

vi.mock('../applications/EisSyncDrawer.jsx', () => ({
  default: ({ asPage, mode, initialDataset, initialReports }) => (
    <div data-testid="mock-eis-sync">
      EIS FullPage={String(Boolean(asPage))} mode={mode || 'none'} dataset={initialDataset} reports={(initialReports || []).join(',')}
    </div>
  ),
}))
vi.mock('../master-data/EisReportsPage.jsx', () => ({
  default: () => <div data-testid="mock-eis-reports">Matriks Kelengkapan</div>,
}))
vi.mock('../outages/OutageSyncPage.jsx', () => ({
  default: () => <div data-testid="mock-outage-sync">Data Gangguan</div>,
}))
vi.mock('../master-data/DilSyncDrawer.jsx', () => ({
  default: ({ asPage }) => <div data-testid="mock-dil-sync">DIL FullPage={String(Boolean(asPage))}</div>,
}))
vi.mock('../master-data/MaximoSyncDrawer.jsx', () => ({
  default: ({ asPage }) => <div data-testid="mock-maximo-sync">Maximo FullPage={String(Boolean(asPage))}</div>,
}))
vi.mock('../master-data/MimsStockPullPage.jsx', () => ({
  default: () => <div data-testid="mock-mims-sync">Stok MIMS</div>,
}))

function wrap(ui, can = {}, initialEntries = ['/sinkronisasi']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={{ user: { id: 'u-1', name: 'Admin UP3' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('SyncCenterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan header Pusat Sinkronisasi, tombol Kembali, dan tab sesuai hak akses', async () => {
    const can = {
      'eis_reports.view': true,
      'outages.view': true,
      'customers.view': true,
      'substations.sync': true,
      'stock.import': true,
    }
    const user = userEvent.setup()
    wrap(<SyncCenterPage />, can)

    expect(await screen.findByText('Pusat Sinkronisasi Data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kembali/i })).toBeInTheDocument()
    const tabLabels = screen.getAllByRole('tab').map((el) => el.textContent)
    expect(tabLabels).toEqual([
      'EIS / APKT / AP2T',
      'Data Gangguan',
      'DIL Pelanggan',
      'Pengukuran Maximo',
      'Stok MIMS',
      'Matriks & Upload Manual',
    ])

    // Berpindah tab ke DIL Pelanggan (asPage=true)
    await user.click(screen.getByRole('tab', { name: 'DIL Pelanggan' }))
    expect(await screen.findByTestId('mock-dil-sync')).toHaveTextContent('DIL FullPage=true')
  })

  it('2. meneruskan parameter URL tab, mode, dataset, dan reports ke tab aktif', async () => {
    wrap(
      <SyncCenterPage />,
      { 'eis_reports.view': true, 'outages.view': true },
      ['/sinkronisasi?tab=eis&mode=ap2t&reports=pelunasan_prr,saldo_prr'],
    )

    const eis = await screen.findByTestId('mock-eis-sync')
    expect(eis).toHaveTextContent('EIS FullPage=true')
    expect(eis).toHaveTextContent('mode=ap2t')
    expect(eis).toHaveTextContent('reports=pelunasan_prr,saldo_prr')
  })

  it('3. menampilkan Live Status Bar dari GET /sync/active beserta antrean, pemicu, dan progres unit', async () => {
    syncApi.active.mockResolvedValue({
      data: [
        {
          id: 'run-q-1',
          source: 'eis',
          dataset: 'permohonan',
          state: 'QUEUED',
          status: 'QUEUED',
          queue_position: 2,
          up3: { id: 'up3-1', name: 'UP3 Mojokerto' },
          scope: { id: 'ulp-1', name: 'ULP Mojoagung', type: 'ULP' },
          account: { id: 'ulp-1', name: 'ULP Mojoagung', type: 'ULP' },
          triggered_by: { id: 'u-1', name: 'Admin Mojokerto' },
          progress: { done_units: 1, total_units: 4 },
        },
      ],
    })

    wrap(<SyncCenterPage />, { 'eis_reports.view': true })

    expect(await screen.findByText(/Sedang Antre \/ Berjalan \(1 proses\)/i)).toBeInTheDocument()
    expect(screen.getByText('Antre (#2)')).toBeInTheDocument()
    expect(screen.getByText('UP3 Mojokerto')).toBeInTheDocument()
    expect(screen.getByText(/Pemicu: Admin Mojokerto/i)).toBeInTheDocument()
    expect(screen.getByText('1/4')).toBeInTheDocument()
  })
})
