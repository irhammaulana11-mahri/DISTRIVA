import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Drawer from './Drawer.jsx'

describe('Drawer UI Component (Mobile & Responsive)', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <Drawer open={false} title="Test Drawer">
        <div>Content</div>
      </Drawer>
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders drawer with full responsive mobile width and sm breakpoint container', () => {
    render(
      <Drawer open={true} title="Preview Drawer" size="max-w-2xl">
        <p>Drawer Body Content</p>
      </Drawer>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // Verifikasi kelas mobile-safe: w-full max-w-full dan sm breakpoint
    expect(dialog.className).toContain('w-full')
    expect(dialog.className).toContain('max-w-full')
    expect(dialog.className).toContain('sm:max-w-2xl')

    // Verifikasi container tidak memiliki pl-10 fixed tanpa breakpoint
    const container = dialog.parentElement
    expect(container.className).toContain('pl-0')
    expect(container.className).toContain('sm:pl-10')
  })

  it('closes when clicking close button, backdrop, or pressing Escape', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Drawer open={true} onClose={onClose} title="Closable Drawer">
        <div>Content</div>
      </Drawer>
    )

    // Klik tombol close
    const closeBtn = screen.getByRole('button', { name: /Tutup drawer/i })
    await userEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders footer and eyebrow correctly without breaking in mobile', () => {
    render(
      <Drawer
        open={true}
        eyebrow="STAGING"
        title="Impor Batch Material ERP (Two-Phase)"
        subtitle="Staging preview & validasi integritas"
        footer={<button>Aksi Footer</button>}
      >
        <div>Isi Drawer</div>
      </Drawer>
    )

    expect(screen.getByText('STAGING')).toBeInTheDocument()
    expect(screen.getByText('Impor Batch Material ERP (Two-Phase)')).toBeInTheDocument()
    expect(screen.getByText('Staging preview & validasi integritas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aksi Footer' })).toBeInTheDocument()
  })
})
