import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Alert from './Alert.jsx'
import Button from './Button.jsx'
import Card, { CardHeader } from './Card.jsx'
import StatusBadge from './StatusBadge.jsx'
import TableFooter, { useTablePagination } from './TableFooter.jsx'
import EmptyState from './EmptyState.jsx'
import ReasonDialog from './ReasonDialog.jsx'
import ConfirmationModal from './ConfirmationModal.jsx'
import ModuleStatusPage from '../pages/ModuleStatusPage.jsx'

describe('Shared UI Components', () => {
  describe('StatusBadge', () => {
    it('renders correct labels and tones for each status', () => {
      const { rerender } = render(<StatusBadge status="ACTIVE" />)
      expect(screen.getByText('Aktif')).toBeInTheDocument()

      rerender(<StatusBadge status="SUSPENDED" />)
      expect(screen.getByText('Ditangguhkan')).toBeInTheDocument()

      rerender(<StatusBadge status="PENDING_ACTIVATION" />)
      expect(screen.getByText('Menunggu aktivasi')).toBeInTheDocument()

      rerender(<StatusBadge status="INACTIVE" />)
      expect(screen.getByText('Nonaktif')).toBeInTheDocument()

      rerender(<StatusBadge status="PENDING_BACKEND" />)
      expect(screen.getByText('Menunggu Backend')).toBeInTheDocument()

      // EIS Lifecycle Statuses (docs/57 §3c & user requirements)
      rerender(<StatusBadge status="APPROVED" />)
      expect(screen.getByText('Disetujui')).toBeInTheDocument()

      rerender(<StatusBadge status="PAID" />)
      expect(screen.getByText('Bayar')).toBeInTheDocument()

      rerender(<StatusBadge status="PK_PRINTED" />)
      expect(screen.getByText('Cetak PK')).toBeInTheDocument()

      rerender(<StatusBadge status="CONNECTION_IN_PROGRESS" />)
      expect(screen.getByText('PDL Awal')).toBeInTheDocument()

      rerender(<StatusBadge status="CONNECTION_DONE" />)
      expect(screen.getByText('Peremajaan')).toBeInTheDocument()

      rerender(<StatusBadge status="CANCELLED" />)
      expect(screen.getByText('Batal')).toBeInTheDocument()

      rerender(<StatusBadge status="REFUNDED" />)
      expect(screen.getByText('Restitusi')).toBeInTheDocument()

      // Raw EIS strings support
      rerender(<StatusBadge status="PEREMAJAAN" />)
      expect(screen.getByText('Peremajaan')).toBeInTheDocument()

      rerender(<StatusBadge status="CETAK PK" />)
      expect(screen.getByText('Cetak PK')).toBeInTheDocument()
    })
  })

  describe('Alert', () => {
    it('renders with role="alert" for error and role="status" for others', () => {
      const { rerender } = render(<Alert kind="error">Terjadi kegagalan.</Alert>)
      expect(screen.getByRole('alert')).toHaveTextContent('Terjadi kegagalan.')

      rerender(<Alert kind="success">Operasi berhasil.</Alert>)
      expect(screen.getByRole('status')).toHaveTextContent('Operasi berhasil.')

      rerender(<Alert kind="warning">Peringatan sistem.</Alert>)
      expect(screen.getByRole('status')).toHaveTextContent('Peringatan sistem.')

      rerender(<Alert kind="info">Informasi pembaruan.</Alert>)
      expect(screen.getByRole('status')).toHaveTextContent('Informasi pembaruan.')
    })
  })

  describe('Button', () => {
    it('supports variants, loading state and click events', async () => {
      let clicked = false
      const { rerender } = render(
        <Button variant="primary" onClick={() => { clicked = true }}>
          Simpan Data
        </Button>,
      )

      const btn = screen.getByRole('button', { name: 'Simpan Data' })
      expect(btn).toBeInTheDocument()
      await userEvent.click(btn)
      expect(clicked).toBe(true)

      rerender(<Button loading>Proses</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  describe('Card', () => {
    it('renders card and header with title and actions', () => {
      render(
        <Card>
          <CardHeader
            title="Judul Kartu"
            description="Deskripsi kartu"
            actions={<button type="button">Aksi</button>}
          />
          <p>Konten Kartu</p>
        </Card>,
      )
      expect(screen.getByText('Judul Kartu')).toBeInTheDocument()
      expect(screen.getByText('Deskripsi kartu')).toBeInTheDocument()
      expect(screen.getByText('Konten Kartu')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Aksi' })).toBeInTheDocument()
    })
  })

  describe('TableFooter', () => {
    it('renders standardized table footer with item summary and pagination controls', async () => {
      let page = 1
      let perPage = 10
      const { rerender } = render(
        <TableFooter
          itemCount={9}
          total={9}
          entityLabel="kategori"
          page={page}
          perPage={perPage}
          onPage={(p) => { page = p }}
          onPerPage={(pp) => { perPage = pp }}
          perPageOptions={[10, 25, 50]}
        />
      )

      expect(screen.getByText('Menampilkan 9 dari 9 kategori')).toBeInTheDocument()
      expect(screen.getByText('Menampilkan 1–9 dari 9')).toBeInTheDocument()
      expect(screen.getByText('Per halaman')).toBeInTheDocument()
      expect(screen.getByText('Hal. 1/1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled()

      // Change per page dropdown triggers onPerPage callback
      const select = screen.getByRole('none', { name: 'Jumlah per halaman' }) || screen.getByLabelText('Jumlah per halaman')
      await userEvent.selectOptions(select, '25')
      expect(perPage).toBe(25)
    })

    it('renders empty state summary and disabled pagination controls matching design snapshot when total is 0', () => {
      render(
        <TableFooter
          itemCount={0}
          total={0}
          entityLabel="material"
          page={1}
          perPage={25}
          onPage={() => {}}
          onPerPage={() => {}}
          perPageOptions={[10, 25, 50, 100]}
        />
      )

      expect(screen.getByText('Menampilkan 0 dari 0 material')).toBeInTheDocument()
      expect(screen.getByText('Menampilkan 0–0 dari 0')).toBeInTheDocument()
      expect(screen.getByText('Per halaman')).toBeInTheDocument()
      expect(screen.getByText('Hal. 1/1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled()
    })

    it('renders only summary count without dead pagination controls for static tables', () => {
      render(
        <TableFooter
          itemCount={5}
          total={5}
          entityLabel="zona UP3"
        />
      )

      expect(screen.getByText('Menampilkan 5 dari 5 zona UP3')).toBeInTheDocument()
      expect(screen.queryByText('Per halaman')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Sebelumnya' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Berikutnya' })).not.toBeInTheDocument()
    })
  })

  describe('EmptyState Component', () => {
    it('renders icon, title, description, and optional action button', () => {
      render(
        <EmptyState
          title="Belum ada material"
          description="Katalog material masih kosong."
          action={<button type="button">Impor Batch ERP</button>}
        />
      )

      expect(screen.getByText('Belum ada material')).toBeInTheDocument()
      expect(screen.getByText('Katalog material masih kosong.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Impor Batch ERP' })).toBeInTheDocument()
    })
  })

  describe('ReasonDialog & ConfirmationModal', () => {
    it('resets busy state and displays external error in ReasonDialog, and Batal closes dialog', async () => {
      let closed = false
      const { rerender } = render(
        <ReasonDialog
          title="Persetujuan Buku Harga"
          description="Konfirmasi persetujuan"
          confirmLabel="Setujui Sekarang"
          error=""
          onConfirm={async () => {
            // Simulates caller catching error internally and setting error prop
          }}
          onClose={() => {
            closed = true
          }}
        />,
      )

      await userEvent.type(screen.getByLabelText('Alasan'), 'ok')
      await userEvent.click(screen.getByRole('button', { name: 'Setujui Sekarang' }))

      // Button must not stay stuck on "Memproses…"
      expect(screen.getByRole('button', { name: 'Setujui Sekarang' })).not.toBeDisabled()

      // External error prop renders alert with GAGAL badge
      rerender(
        <ReasonDialog
          title="Persetujuan Buku Harga"
          description="Konfirmasi persetujuan"
          confirmLabel="Setujui Sekarang"
          error="504 kode KHS pada buku harga belum terdaftar."
          onConfirm={async () => {}}
          onClose={() => {
            closed = true
          }}
        />,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('504 kode KHS pada buku harga belum terdaftar.')

      // Clicking Batal triggers onClose
      await userEvent.click(screen.getByRole('button', { name: 'Batal' }))
      expect(closed).toBe(true)
    })

    it('supports onCancel, requiresReason, and confirmText aliases in ConfirmationModal', async () => {
      let cancelled = false
      render(
        <ConfirmationModal
          title="Setujui Semua Draf"
          description="Setujui item draf"
          confirmText="Setujui Draf"
          requiresReason={true}
          reasonPrompt="Alasan Persetujuan"
          onConfirm={async () => {}}
          onCancel={() => {
            cancelled = true
          }}
        />,
      )

      expect(screen.getByLabelText('Alasan Persetujuan')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Batal' }))
      expect(cancelled).toBe(true)
    })
  })

  describe('ModuleStatusPage', () => {
    it('renders module contract endpoints and active state for rab-kkf module', async () => {
      render(
        <MemoryRouter initialEntries={['/modul/rab-kkf']}>
          <Routes>
            <Route path="modul/:slug" element={<ModuleStatusPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.getByText('RAB & Kajian Kelayakan Finansial (KKF)')).toBeInTheDocument()
      expect(screen.getByText(/Modul Terintegrasi & Aktif di Backend/)).toBeInTheDocument()
      expect(screen.getAllByText('/api/mto/{package}/rab-runs').length).toBeGreaterThan(0)

      // Test tab switching
      await userEvent.click(screen.getByRole('button', { name: 'Alur Siklus Hidup & SoD' }))
      expect(screen.getByText('Siklus Hidup Transaksi (Lifecycle State Machine)')).toBeInTheDocument()
      expect(screen.getByText('DRAFT_CALC')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Simulator Validasi Form' }))
      expect(screen.getByText('Simulator Validasi Formulir')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Kirim Transaksi (Dinonaktifkan)' })).toBeDisabled()
    })

    it('renders active module status for verified modules like survey-meter and drawing', () => {
      render(
        <MemoryRouter initialEntries={['/modul/drawing']}>
          <Routes>
            <Route path="modul/:slug" element={<ModuleStatusPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.getByText('Drawing & Desain Teknis Jaringan')).toBeInTheDocument()
      expect(screen.getAllByText(/Aktif/i).length).toBeGreaterThan(0)
      expect(screen.getByText('/api/drawings/{id}')).toBeInTheDocument()
    })

    it('renders not found for unknown slug', () => {
      render(
        <MemoryRouter initialEntries={['/modul/unknown-slug']}>
          <Routes>
            <Route path="modul/:slug" element={<ModuleStatusPage />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.getByText('Modul Tidak Ditemukan')).toBeInTheDocument()
    })
  })
})
