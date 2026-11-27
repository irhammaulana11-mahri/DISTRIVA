import { useCallback, useEffect, useState } from 'react'
import { syncApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'

export default function SyncUlpAccountsPanel({ source, up3Id, title = 'Akun Khusus per ULP' }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [editingUnitId, setEditingUnitId] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!source || !syncApi?.accounts) return
    setLoading(true)
    setError('')
    try {
      const res = await syncApi.accounts({ source, ...(up3Id ? { up3_id: up3Id } : {}) })
      setRows(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar akun ULP.')
    } finally {
      setLoading(false)
    }
  }, [source, up3Id])

  useEffect(() => {
    load()
  }, [load])

  const startEdit = (row) => {
    setEditingUnitId(row.unit_id)
    setUsername(row.username || '')
    setPassword('')
    setError('')
    setMsg('')
  }

  const handleSave = async (row) => {
    if (!username.trim()) {
      setError('Username wajib diisi.')
      return
    }
    if (!row.has_own_account && !password.trim()) {
      setError('Password wajib diisi untuk akun ULP baru.')
      return
    }
    setSaving(true)
    setError('')
    setMsg('')
    try {
      const payload = {
        source,
        unit_id: row.unit_id,
        username: username.trim(),
      }
      if (password.trim()) payload.password = password
      await syncApi.saveAccount(payload)
      setEditingUnitId(null)
      setPassword('')
      setMsg(`Akun ULP ${row.name} berhasil disimpan.`)
      await load()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan akun ULP.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row) => {
    setSaving(true)
    setError('')
    setMsg('')
    try {
      await syncApi.deleteAccount(source, row.unit_id)
      if (editingUnitId === row.unit_id) setEditingUnitId(null)
      setMsg(`Akun ULP ${row.name} dikembalikan memakai akun UP3.`)
      await load()
    } catch (err) {
      setError(err?.message || 'Gagal menghapus akun ULP.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            ULP yang memiliki akun sendiri berjalan paralel memakai akunnya; ULP tanpa akun sendiri memakai akun UP3.
          </p>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {msg && <Alert type="success">{msg}</Alert>}

      {loading ? (
        <p className="text-xs text-slate-500 py-2">Memuat daftar ULP…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">Tidak ada ULP yang dapat dikelola pada cakupan ini.</p>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          {rows.map((row) => {
            const isEditing = editingUnitId === row.unit_id
            return (
              <div key={row.unit_id} className="p-2.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {row.code ? `${row.code} - ` : ''}{row.name}
                    </span>
                    {row.has_own_account ? (
                      <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                        Akun Sendiri: {row.username}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                        Ikut Akun UP3
                      </span>
                    )}
                    {row.updated_by && (
                      <span className="text-[10px] text-slate-400">oleh {row.updated_by}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isEditing && (
                      <Button type="button" size="xs" variant="secondary" onClick={() => startEdit(row)}>
                        {row.has_own_account ? 'Ubah' : 'Atur Akun'}
                      </Button>
                    )}
                    {row.has_own_account && !isEditing && (
                      <Button type="button" size="xs" variant="secondary" disabled={saving} onClick={() => handleDelete(row)}>
                        Hapus
                      </Button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <input
                      type="text"
                      aria-label={`Username ULP ${row.name}`}
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="password"
                      aria-label={`Password ULP ${row.name}`}
                      placeholder={row.has_own_account ? 'Password baru (opsional)' : 'Password wajib'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <div className="flex items-center gap-1.5">
                      <Button type="button" size="xs" variant="primary" loading={saving} onClick={() => handleSave(row)}>
                        Simpan
                      </Button>
                      <Button type="button" size="xs" variant="secondary" disabled={saving} onClick={() => setEditingUnitId(null)}>
                        Batal
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
