import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { vendorsApi, adminApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import useAccountUnits from './useAccountUnits.js'
import { IconPlus, IconTrash } from '../../components/icons.jsx'

/** Halaman akun Pelaksana sebuah vendor: tautkan pengguna, buat akun baru (undangan aktivasi), nonaktifkan tautan. Laci pada daftar vendor hanya pratinjau profil. */
export default function VendorAccountsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['vendors.manage'] || isSysAdmin)
  const [vendor, setVendor] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [candidateUsers, setCandidateUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [linkingAccount, setLinkingAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ name: '', email: '', phone: '', unit: '' })
  const accountUnits = useAccountUnits(isSysAdmin)
  const [drawerError, setDrawerError] = useState('')

  const refresh = useCallback(async () => {
    const res = await vendorsApi.list()
    const found = (res?.data || []).find((v) => v.id === id)
    if (found) setVendor(found)
    else setLoadError('Vendor tidak ditemukan.')
  }, [id])

  useEffect(() => {
    refresh().catch((e) => setLoadError(e?.message || 'Gagal memuat vendor.'))
    adminApi.users({ per_page: 100 }).then((res) => setCandidateUsers(res?.data || [])).catch(() => setCandidateUsers([]))
  }, [refresh])

  const handleCreateAccount = async (e) => {
    e.preventDefault()
    if (!vendor) return
    setLinkingAccount(true)
    setDrawerError('')
    try {
      await vendorsApi.linkAccount(vendor.id, {
        account: { name: newAccount.name.trim(), email: newAccount.email.trim(), ...(newAccount.phone.trim() && { phone: newAccount.phone.trim() }), ...(newAccount.unit && { organizational_unit_id: newAccount.unit }) },
      })
      notify({ type: 'success', title: 'Akun Pelaksana Dibuat', desc: `Undangan aktivasi dikirim ke ${newAccount.email.trim()}; akun tertaut ke vendor.`, tag: 'VENDOR' })
      setNewAccount({ name: '', email: '', phone: '', unit: '' })
      await refresh()
    } catch (err) {
      setDrawerError(err?.message || 'Gagal membuat akun Pelaksana.')
    } finally {
      setLinkingAccount(false)
    }
  }

  // Handle Link Account
  const handleLinkAccount = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !vendor) return
    setLinkingAccount(true)
    setDrawerError('')
    try {
      await vendorsApi.linkAccount(vendor.id, selectedUserId)
      notify({
        type: 'success',
        title: 'Akun Vendor Ditautkan',
        desc: 'Pengguna berhasil ditautkan ke perusahaan vendor.',
        tag: 'VENDOR',
      })
      setSelectedUserId('')
      await refresh()
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
      await refresh()
    } catch (err) {
      setDrawerError(err?.message || 'Gagal menonaktifkan akun vendor.')
    }
  }

  if (loadError) return <Alert kind="error">{loadError}</Alert>
  if (!vendor) return <div className="p-8 text-center"><Spinner /></div>

  return (
    <PanelShell
      asPage
      onBack={() => navigate('/master-data/vendors')}
      title={`Akun Vendor: ${vendor.name}`}
      subtitle={`Kode: ${vendor.code} · Status: ${vendor.status}`}
      footer={<Button variant="ghost" size="sm" onClick={() => navigate('/master-data/vendors')}>Kembali ke daftar vendor</Button>}
    >
      <div className="space-y-6 text-xs">
        {drawerError && <Alert kind="error">{drawerError}</Alert>}

    {/* Section Tautkan Akun Baru */}
    {canManage && vendor.status === 'ACTIVE' && (
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

    {canManage && vendor.status === 'ACTIVE' && (
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
            {(vendor.accounts || []).length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="py-8 text-center text-slate-400">
                  Belum ada akun pengguna yang ditautkan ke perusahaan ini.
                </td>
              </tr>
            ) : (
              vendor.accounts.map((acc) => (
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
    </PanelShell>
  )
}
