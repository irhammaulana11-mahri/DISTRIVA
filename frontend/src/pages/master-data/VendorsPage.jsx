import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { vendorsApi, adminApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import useAccountUnits from './useAccountUnits.js'
import Drawer from '../../components/Drawer.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTruck,
  IconUser,
  IconTrash,
  IconPower,
  IconEye,
  IconPencil,
} from '../../components/icons.jsx'

const DASH = <span className="text-slate-400">-</span>
const SCOPE_LABEL = { JARINGAN: 'Pekerjaan jaringan', TIANG: 'Pekerjaan tiang', KEDUANYA: 'Jaringan dan tiang' }

/** Tombol aksi tabel berbentuk ikon (nama aksi muncul sebagai tooltip dan label aksesibilitas). */
function IconAction({ label, onClick, icon: Icon, tone = 'neutral', disabled = false }) {
  const tones = {
    neutral: 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50',
    success: 'border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50',
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-white dark:bg-slate-900 transition-colors cursor-pointer disabled:opacity-50 ${tones[tone]}`}
    >
      <Icon size={15} />
    </button>
  )
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-800 dark:text-slate-200 break-words">{children || DASH}</dd>
    </div>
  )
}

function PreviewSection({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">{title}</h4>
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">{children}</dl>
    </section>
  )
}

/** Tampilan baca-saja profil vendor untuk drawer pratinjau. */
function VendorProfilePreview({ vendor }) {
  const p = vendor.profile || {}
  const today = new Date().toISOString().slice(0, 10)
  const validity = (until) =>
    until && (
      <span
        className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          until < today
            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
        }`}
      >
        {until < today ? 'Sudah berakhir' : 'Masih berlaku'}
      </span>
    )
  const place = [p.city, p.province, p.postal_code].filter(Boolean).join(', ')
  return (
    <div className="space-y-3 text-xs">
      <PreviewSection title="Identitas perusahaan">
        <Row label="Lingkup pekerjaan">{SCOPE_LABEL[p.work_scope] || SCOPE_LABEL.KEDUANYA}</Row>
        <Row label="NPWP">{p.npwp}</Row>
        <Row label="NIB">{p.nib}</Row>
      </PreviewSection>
      <PreviewSection title="Alamat & kontak">
        <Row label="Alamat">{p.address}</Row>
        <Row label="Kota / provinsi">{place}</Row>
        <Row label="Telepon">{p.phone}</Row>
        <Row label="Email">{p.email}</Row>
        <Row label="Situs web">{p.website}</Row>
      </PreviewSection>
      <PreviewSection title="Penanggung jawab (PIC)">
        <Row label="Nama">{p.pic_name}</Row>
        <Row label="Jabatan">{p.pic_position}</Row>
        <Row label="Telepon">{p.pic_phone}</Row>
        <Row label="Email">{p.pic_email}</Row>
      </PreviewSection>
      <PreviewSection title="Kualifikasi usaha (SBU)">
        <Row label="Bidang">{p.sbu_classification}</Row>
        <Row label="Nomor">{p.sbu_number}</Row>
        <Row label="Berlaku sampai">{p.sbu_valid_until && <>{p.sbu_valid_until}{validity(p.sbu_valid_until)}</>}</Row>
      </PreviewSection>
      <PreviewSection title="Kontrak / SPK">
        <Row label="Nomor">{p.contract_number}</Row>
        <Row label="Masa berlaku">
          {(p.contract_valid_from || p.contract_valid_until) && (
            <>{p.contract_valid_from || '…'} s.d. {p.contract_valid_until || '…'}{validity(p.contract_valid_until)}</>
          )}
        </Row>
      </PreviewSection>
      <PreviewSection title="Rekening pembayaran">
        <Row label="Bank">{p.bank_name}</Row>
        <Row label="Nomor rekening">{p.bank_account_number}</Row>
        <Row label="Atas nama">{p.bank_account_name}</Row>
      </PreviewSection>
      {p.notes && (
        <PreviewSection title="Catatan">
          <Row label="Catatan">{p.notes}</Row>
        </PreviewSection>
      )}
    </div>
  )
}

export default function VendorsPage() {
  const { can, isSysAdmin } = useAccess()
  const canManage = Boolean(can?.['vendors.manage'] || isSysAdmin)
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Drawer Pratinjau Profil Vendor (hanya lihat; tambah/ubah lewat halaman tersendiri)
  const [previewVendor, setPreviewVendor] = useState(null)

  // Drawer Kelola Akun Vendor
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false)
  const [candidateUsers, setCandidateUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [linkingAccount, setLinkingAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ name: '', email: '', phone: '', unit: '' })
  const accountUnits = useAccountUnits(isSysAdmin)
  const [drawerError, setDrawerError] = useState('')

  // Status Change State
  const [statusChangingId, setStatusChangingId] = useState(null)

  const loadVendors = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await vendorsApi.list()
      setVendors(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar perusahaan vendor.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVendors()
  }, [loadVendors])

  // Load candidate users when opening drawer
  const loadCandidateUsers = useCallback(async () => {
    try {
      const res = await adminApi.users({ per_page: 100 })
      setCandidateUsers(res?.data || [])
    } catch {
      setCandidateUsers([])
    }
  }, [])

  const handleOpenAccountDrawer = (vendor) => {
    setSelectedVendor(vendor)
    setSelectedUserId('')
    setDrawerError('')
    setAccountDrawerOpen(true)
    loadCandidateUsers()
  }

  const openCreate = () => navigate('/master-data/vendors/new')
  const openEdit = (vendor) => navigate(`/master-data/vendors/${vendor.id}/edit`)

  // Handle Set Company Status (ACTIVE <-> SUSPENDED)
  const handleToggleStatus = async (vendor) => {
    const nextStatus = vendor.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    setStatusChangingId(vendor.id)
    try {
      await vendorsApi.setStatus(vendor.id, nextStatus)
      notify({
        type: 'success',
        title: 'Status Vendor Diperbarui',
        desc: `Perusahaan ${vendor.name} berhasil diubah menjadi ${nextStatus}.`,
        tag: 'VENDOR',
      })
      loadVendors()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Mengubah Status',
        desc: err?.message || 'Tidak dapat memperbarui status vendor.',
        tag: 'VENDOR',
      })
    } finally {
      setStatusChangingId(null)
    }
  }

  // Buat akun Pelaksana baru (undangan aktivasi) untuk vendor yang sudah ada, langsung tertaut
  const handleCreateAccount = async (e) => {
    e.preventDefault()
    if (!selectedVendor) return
    setLinkingAccount(true)
    setDrawerError('')
    try {
      await vendorsApi.linkAccount(selectedVendor.id, {
        account: { name: newAccount.name.trim(), email: newAccount.email.trim(), ...(newAccount.phone.trim() && { phone: newAccount.phone.trim() }), ...(newAccount.unit && { organizational_unit_id: newAccount.unit }) },
      })
      notify({ type: 'success', title: 'Akun Pelaksana Dibuat', desc: `Undangan aktivasi dikirim ke ${newAccount.email.trim()}; akun tertaut ke vendor.`, tag: 'VENDOR' })
      setNewAccount({ name: '', email: '', phone: '', unit: '' })
      const res = await vendorsApi.list()
      const updatedList = res?.data || []
      setVendors(updatedList)
      const current = updatedList.find((v) => v.id === selectedVendor.id)
      if (current) setSelectedVendor(current)
    } catch (err) {
      setDrawerError(err?.message || 'Gagal membuat akun Pelaksana.')
    } finally {
      setLinkingAccount(false)
    }
  }

  // Handle Link Account
  const handleLinkAccount = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !selectedVendor) return
    setLinkingAccount(true)
    setDrawerError('')
    try {
      await vendorsApi.linkAccount(selectedVendor.id, selectedUserId)
      notify({
        type: 'success',
        title: 'Akun Vendor Ditautkan',
        desc: 'Pengguna berhasil ditautkan ke perusahaan vendor.',
        tag: 'VENDOR',
      })
      setSelectedUserId('')
      const res = await vendorsApi.list()
      const updatedList = res?.data || []
      setVendors(updatedList)
      const current = updatedList.find((v) => v.id === selectedVendor.id)
      if (current) setSelectedVendor(current)
    } catch (err) {
      setDrawerError(err?.message || 'Gagal menautkan akun vendor.')
    } finally {
      setLinkingAccount(false)
    }
  }

  // Handle Deactivate Account Link
  const handleDeactivateAccount = async (accountId) => {
    setDrawerError('')
    try {
      await vendorsApi.deactivateAccount(accountId)
      notify({
        type: 'success',
        title: 'Akun Vendor Dinonaktifkan',
        desc: 'Tautan akun vendor berhasil dinonaktifkan.',
        tag: 'VENDOR',
      })
      const res = await vendorsApi.list()
      const updatedList = res?.data || []
      setVendors(updatedList)
      const current = updatedList.find((v) => v.id === selectedVendor.id)
      if (current) setSelectedVendor(current)
    } catch (err) {
      setDrawerError(err?.message || 'Gagal menonaktifkan akun vendor.')
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return vendors
    const q = search.toLowerCase()
    return vendors.filter(
      (v) =>
        v.code?.toLowerCase().includes(q) ||
        v.name?.toLowerCase().includes(q) ||
        v.accounts?.some((a) => a.email?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
    )
  }, [vendors, search])

  const pageRows = filtered.slice((page - 1) * perPage, page * perPage)
  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="text-xs text-slate-500 mb-1">
            <span>DISTRIVA</span>
            <span className="mx-1.5">/</span>
            <span>Master Data</span>
            <span className="mx-1.5">/</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">Mitra & Vendor</span>
          </nav>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Mitra & Perusahaan Vendor</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pengelolaan mitra penyedia konstruksi, status operasional perusahaan vendor, dan penautan akun pengguna vendor (docs/62 §32).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Tambah Vendor</span>
            </button>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Main Table Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Cari kode atau nama vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">{filtered.length} Perusahaan Vendor</span>
            <button
              type="button"
              onClick={loadVendors}
              title="Segarkan Data Vendor"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition cursor-pointer"
            >
              <IconRefresh size={13} className={loading ? 'animate-spin' : ''} />
              <span>Segarkan</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat data vendor..." />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={IconTruck}
            title={search ? 'Tidak ada vendor yang cocok' : 'Belum ada perusahaan vendor'}
            description={
              search
                ? 'Coba sesuaikan kata kunci pencarian kode atau nama vendor.'
                : 'Belum ada data perusahaan vendor terdaftar di sistem.'
            }
            action={
              canManage && !search ? (
                <Button size="sm" variant="primary" onClick={openCreate} className="inline-flex items-center gap-1.5">
                  <IconPlus size={14} />
                  <span>Tambah Vendor</span>
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Kode Vendor</th>
                  <th className="py-3 px-4">Nama Perusahaan</th>
                  <th className="py-3 px-4">Kontak (PIC) &amp; Kontrak</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Akun Vendor Tertaut</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                {pageRows.map((v) => {
                  const activeAccounts = (v.accounts || []).filter((a) => a.is_active)
                  const p = v.profile || {}
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{v.code}</td>
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                        <div>{v.name}</div>
                        {p.work_scope && p.work_scope !== 'KEDUANYA' && (
                          <div className="text-[10px] font-normal text-slate-500">{SCOPE_LABEL[p.work_scope]}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                        {p.pic_name || p.pic_phone || p.phone ? (
                          <div>{[p.pic_name, p.pic_phone || p.phone].filter(Boolean).join(' · ')}</div>
                        ) : (
                          <div className="text-slate-400">Profil belum dilengkapi</div>
                        )}
                        {p.contract_number && (
                          <div className="font-mono">
                            {p.contract_number}
                            {p.contract_valid_until && (
                              <span
                                className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold ${
                                  p.contract_valid_until < todayIso
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                }`}
                              >
                                s.d. {p.contract_valid_until}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            v.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                              activeAccounts.length > 0
                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                            }`}
                          >
                            {activeAccounts.length} Akun Aktif
                          </span>
                          {activeAccounts.length > 0 && (
                            <span className="text-[11px] text-slate-500 truncate max-w-xs">
                              ({activeAccounts.map((a) => a.name || a.email).join(', ')})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <IconAction label="Lihat profil" onClick={() => setPreviewVendor(v)} icon={IconEye} />
                          {canManage && <IconAction label="Ubah profil" onClick={() => openEdit(v)} icon={IconPencil} />}
                          <IconAction label="Kelola akun" onClick={() => handleOpenAccountDrawer(v)} icon={IconUser} />
                          {canManage && (
                            <IconAction
                              label={v.status === 'ACTIVE' ? 'Tangguhkan' : 'Aktifkan'}
                              onClick={() => handleToggleStatus(v)}
                              disabled={statusChangingId === v.id}
                              icon={v.status === 'ACTIVE' ? IconTrash : IconPower}
                              tone={v.status === 'ACTIVE' ? 'danger' : 'success'}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter
          itemCount={pageRows.length}
          total={filtered.length}
          entityLabel="perusahaan vendor"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>

      {/* DRAWER: Pratinjau Profil Vendor (hanya lihat) */}
      <Drawer
        open={Boolean(previewVendor)}
        title={previewVendor?.name || 'Profil Vendor'}
        subtitle={previewVendor ? `Kode: ${previewVendor.code} · Status: ${previewVendor.status}` : ''}
        onClose={() => setPreviewVendor(null)}
        size="max-w-xl"
        footer={
          <div className="flex justify-between w-full">
            <Button variant="ghost" size="sm" onClick={() => setPreviewVendor(null)}>
              Tutup
            </Button>
            {canManage && previewVendor && (
              <Button variant="primary" size="sm" icon={IconPencil} onClick={() => openEdit(previewVendor)}>
                Ubah Profil
              </Button>
            )}
          </div>
        }
      >
        {previewVendor && <VendorProfilePreview vendor={previewVendor} />}
      </Drawer>

      {/* DRAWER: Kelola Akun Vendor */}
      {selectedVendor && (
        <Drawer
          isOpen={accountDrawerOpen}
          onClose={() => setAccountDrawerOpen(false)}
          title={`Akun Vendor: ${selectedVendor.name}`}
          subtitle={`Kode: ${selectedVendor.code} · Status: ${selectedVendor.status}`}
          width="max-w-xl"
          footer={
            <div className="flex justify-end w-full">
              <Button variant="ghost" size="sm" onClick={() => setAccountDrawerOpen(false)}>
                Tutup
              </Button>
            </div>
          }
        >
          <div className="space-y-6 text-xs">
            {drawerError && <Alert kind="error">{drawerError}</Alert>}

            {/* Section Tautkan Akun Baru */}
            {canManage && selectedVendor.status === 'ACTIVE' && (
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 space-y-3">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Tautkan Pengguna Vendor</h4>
                  <p className="text-[11px] text-slate-500">
                    Pilih pengguna terdaftar untuk diberi akses portal vendor mewakili perusahaan ini (satu akun hanya dapat terhubung ke satu perusahaan).
                  </p>
                </div>

                <form onSubmit={handleLinkAccount} className="flex gap-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="">-- Pilih Pengguna Vendor --</option>
                    {candidateUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>

                  <Button type="submit" variant="primary" size="sm" loading={linkingAccount} disabled={!selectedUserId} icon={IconPlus}>
                    Tautkan
                  </Button>
                </form>
              </div>
            )}

            {canManage && selectedVendor.status === 'ACTIVE' && (
              <form onSubmit={handleCreateAccount} className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 space-y-3" aria-label="Buat akun Pelaksana baru">
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Buat Akun Pelaksana Baru</h4>
                  <p className="text-[11px] text-slate-500">Untuk petugas administrasi vendor yang belum punya akun. Undangan aktivasi dikirim ke email; akun otomatis tertaut ke perusahaan ini.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input required placeholder="Nama petugas administrasi" aria-label="Nama petugas administrasi" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  <input required type="email" placeholder="Email login" aria-label="Email login akun baru" value={newAccount.email} onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  <input type="tel" placeholder="Telepon / WhatsApp (opsional)" aria-label="Telepon akun baru" value={newAccount.phone} onChange={(e) => setNewAccount({ ...newAccount, phone: e.target.value })} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  {isSysAdmin && (
                    <select aria-label="Unit penugasan akun baru" value={newAccount.unit} onChange={(e) => setNewAccount({ ...newAccount, unit: e.target.value })} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                      <option value="">-- Unit saya --</option>
                      {accountUnits.map((u) => <option key={u.id} value={u.id}>{u.name}{u.unit_type ? ` (${u.unit_type})` : ''}</option>)}
                    </select>
                  )}
                </div>
                <Button type="submit" variant="primary" size="sm" loading={linkingAccount} icon={IconPlus}>Buat & Undang</Button>
              </form>
            )}

            {/* Tabel Akun Terdaftar */}
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">Daftar Akun Vendor Terhubung</h4>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-2.5 px-3">Nama Pengguna</th>
                      <th className="py-2.5 px-3">Email Akun</th>
                      <th className="py-2.5 px-3">Status Tautan</th>
                      {canManage && <th className="py-2.5 px-3 text-right">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {(selectedVendor.accounts || []).length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 4 : 3} className="py-8 text-center text-slate-400">
                          Belum ada akun pengguna yang ditautkan ke perusahaan ini.
                        </td>
                      </tr>
                    ) : (
                      selectedVendor.accounts.map((acc) => (
                        <tr key={acc.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">{acc.name || '-'}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{acc.email}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                acc.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {acc.is_active ? 'Aktif' : 'Nonaktif'}
                            </span>
                          </td>
                          {canManage && (
                            <td className="py-2.5 px-3 text-right">
                              {acc.is_active && (
                                <button
                                  type="button"
                                  onClick={() => handleDeactivateAccount(acc.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                                >
                                  <IconTrash size={13} />
                                  <span>Nonaktifkan</span>
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  )
}
