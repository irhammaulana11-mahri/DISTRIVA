import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { vendorsApi, adminApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Drawer from '../../components/Drawer.jsx'
import Modal from '../../components/Modal.jsx'
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
  IconCheckCircle,
  IconShield,
  IconUsers,
} from '../../components/icons.jsx'
import { filterSearchCls } from '../../components/filterStyles.js'

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

  const totalVendors = vendors.length
  const activeVendors = vendors.filter((v) => v.status === 'ACTIVE').length
  const totalAccounts = vendors.reduce((acc, v) => acc + (v.accounts?.length || 0), 0)
  const networkScopeCount = vendors.filter((v) => ['JARINGAN', 'KEDUANYA'].includes(v.work_scope || v.profile?.work_scope)).length

  return (
    <div className="space-y-6">
      {/* Hero Banner Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wider uppercase text-blue-300">
              <span>DISTRIVA</span>
              <span className="opacity-40">/</span>
              <span>ADMINISTRASI</span>
              <span className="opacity-40">/</span>
              <span className="text-white">MITRA &amp; VENDOR</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md text-white border border-white/20 shadow-inner">
                <IconTruck size={24} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Mitra Konstruksi &amp; Perusahaan Vendor
                </h1>
                <p className="text-xs sm:text-sm text-blue-200/80 max-w-2xl mt-0.5">
                  Direktori penyedia jasa konstruksi, penugasan lingkup tiang &amp; jaringan, pemantauan status operasional, serta integrasi penautan akun pengguna vendor.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur-md px-3.5 py-2 text-xs text-blue-200 border border-white/10 shadow-xs">
              <IconShield size={14} className="text-blue-300" />
              <span>Kewenangan: <strong className="text-white font-semibold">vendors.manage</strong></span>
            </div>

            <button
              type="button"
              onClick={loadVendors}
              disabled={loading}
              title="Segarkan Data Vendor"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3 py-1.5 text-xs font-semibold transition border border-white/15 cursor-pointer disabled:opacity-50"
            >
              <IconRefresh size={15} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>

            {canManage && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs shadow-md transition cursor-pointer"
              >
                <IconPlus size={16} />
                <span>Tambah Vendor</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Statistic Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Mitra</span>
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <IconTruck size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {totalVendors}
          </div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Perusahaan vendor terdaftar</span>
        </div>

        <div className="p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/20 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Vendor Aktif</span>
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
            {activeVendors}
          </div>
          <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5 block">Dapat menerima SPK &amp; WO</span>
        </div>

        <div className="p-4 rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-xs">
          <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Lingkup Jaringan</span>
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400">
              <IconTruck size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-indigo-700 dark:text-indigo-300">
            {networkScopeCount}
          </div>
          <span className="text-[11px] text-indigo-600/80 dark:text-indigo-400/80 mt-0.5 block">Mencakup pekerjaan jaringan</span>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Akun Pelaksana</span>
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <IconUsers size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {totalAccounts}
          </div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Akun petugas vendor tertaut</span>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Main Table Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari kode atau nama vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${filterSearchCls} w-full`}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-mono">{filtered.length} Perusahaan Vendor</span>
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
                          <IconAction label="Kelola akun" onClick={() => navigate(`/master-data/vendors/${v.id}/akun`)} icon={IconUser} />
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
    </div>
  )
}
