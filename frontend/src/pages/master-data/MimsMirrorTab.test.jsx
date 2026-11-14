import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MimsMirrorTab from './MimsMirrorTab.jsx'
import { warehousesApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({ warehousesApi: { mimsMirror: vi.fn() } }))

const meta = { total: 1, current_page: 1, per_page: 25, last_page: 1 }

describe('MimsMirrorTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('menampilkan pengeluaran dan membuka baris material serta agenda', async () => {
    warehousesApi.mimsMirror.mockResolvedValue({
      meta,
      data: [{ id: '1', warehouse_name: 'Gd Ry Jombang', material_document: '5145A', reservation_no: 'R1', issued_on: '2026-11-10', work_type_name: 'PERUBAHAN DAYA',
        lines: [{ material_no: '3250050', material_name: 'MCB', quantity: 4, unit: 'BH' }], customers: [{ agenda_no: 'AG-1', matched: true }] }],
    })
    render(<MimsMirrorTab kind="issues" warehouses={[]} />)
    await screen.findByText('5145A')
    expect(warehousesApi.mimsMirror).toHaveBeenCalledWith('issues', expect.objectContaining({ page: 1 }))
    expect(screen.getByText('10-11-2026')).toBeTruthy()
    expect(screen.getByText('1 (1 cocok permohonan)')).toBeTruthy()
    fireEvent.click(screen.getByText(/1 baris/))
    expect(screen.getByText('MCB')).toBeTruthy()
    expect(screen.getByText(/AG-1 ✓/)).toBeTruthy()
  })

  it('menampilkan penerimaan dengan jumlah dikirim dan diterima', async () => {
    warehousesApi.mimsMirror.mockResolvedValue({
      meta,
      data: [{ id: '2', warehouse_name: 'Gd Ry Jombang', delivery_document: '51MJK1', request_document: 'P1', delivered_on: '2026-11-11', received_on: '2026-11-12', status: 'DITERIMA',
        lines: [{ material_no: '3110025', material_name: 'CABLE', quantity_sent: 6000, quantity_received: 5990, unit: 'M' }] }],
    })
    render(<MimsMirrorTab kind="receipts" warehouses={[]} />)
    await screen.findByText('51MJK1')
    fireEvent.click(screen.getByText(/1 baris/))
    await waitFor(() => expect(screen.getByText('CABLE')).toBeTruthy())
    expect(screen.getByText('DITERIMA')).toBeTruthy()
  })
})
