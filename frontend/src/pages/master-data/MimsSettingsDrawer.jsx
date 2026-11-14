import { useEffect, useState } from 'react'
import { warehousesApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import { IconCheck, IconZap, IconHistory } from '../../components/icons.jsx'

/**
 * Form Pengaturan Tarik Otomatis & Token Sesi MIMS.
 * Terpisah dari proses interaktif penarikan stok agar fokus dan tidak bercampur.
 */
export default function MimsSettingsDrawer({ isOpen, onClose, onChanged }) {
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // State Token Tersimpan
  const [tokenStatus, setTokenStatus] = useState(null)
  const [forgettingToken, setForgettingToken] = useState(false)

  // State Tarik Otomatis Harian
  const [autoSettings, setAutoSettings] = useState(null)
  const [autoTime, setAutoTime] = useState('02:00')
  const [autoWhat, setAutoWhat] = useState({ stock: true, issues: true, receipts: true })
  const [savingAuto, setSavingAuto] = useState(false)

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const [tokenRes, autoRes] = await Promise.all([
        warehousesApi.mimsTokenStatus(),
        warehousesApi.mimsAutoSettings(),
      ])
      const tok = tokenRes?.data || null
      const aut = autoRes?.data || null

      setTokenStatus(tok)
      setAutoSettings(aut)
      if (aut?.auto_time) setAutoTime(aut.auto_time)
      if (aut) {
        setAutoWhat({
          stock: aut.auto_stock !== false,
          issues: aut.auto_issues !== false,
          receipts: aut.auto_receipts !== false,
        })
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat pengaturan MIMS.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  const handleSaveAuto = async (enabled) => {
    if (enabled && !autoWhat.stock && !autoWhat.issues && !autoWhat.receipts) {
      setError('Pilih minimal satu data untuk ditarik otomatis (Stok, Pengeluaran, atau Penerimaan).')
      return
    }

    setSavingAuto(true)
    setError('')
    try {
      const res = await warehousesApi.saveMimsAutoSettings({
        auto_enabled: enabled,
        auto_time: autoTime,
        auto_stock: autoWhat.stock,
        auto_issues: autoWhat.issues,
        auto_receipts: autoWhat.receipts,
      })
      setAutoSettings(res?.data || null)
      notify({
        type: 'success',
        title: enabled ? 'Tarik Otomatis Diaktifkan' : 'Tarik Otomatis Dimatikan',
        desc: enabled
          ? `Data MIMS akan ditarik secara otomatis setiap hari pada pukul ${autoTime} WIB.`
          : 'Jadwal penarikan otomatis harian MIMS telah dinonaktifkan.',
        tag: 'MIMS',
      })
      onChanged?.()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan pengaturan tarik otomatis.')
    } finally {
      setSavingAuto(false)
    }
  }

  const handleForgetToken = async () => {
    if (!window.confirm('Yakin ingin menghapus token tersimpan? Anda harus menempel token baru untuk penarikan berikutnya.')) {
      return
    }

    setForgettingToken(true)
    setError('')
    try {
      await warehousesApi.forgetMimsToken()
      notify({
        type: 'success',
        title: 'Token Dihapus',
        desc: 'Token sesi MIMS tersimpan telah dihapus dari server.',
        tag: 'MIMS',
      })
      await loadSettings()
      onChanged?.()
    } catch (err) {
      setError(err?.message || 'Gagal menghapus token tersimpan.')
    } finally {
      setForgettingToken(false)
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Pengaturan Tarik Otomatis & Token MIMS"
      width="max-w-2xl"
    >
      <div className="space-y-6 text-xs p-1">
        {loading ? (
          <div className="py-12 flex justify-center items-center">
            <Spinner size="md" />
          </div>
        ) : (
          <>
            {error && <Alert kind="error">{error}</Alert>}

            {/* Bagian 1: Status Token Tersimpan */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Token Sesi MIMS Tersimpan
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        tokenStatus?.saved
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {tokenStatus?.saved ? 'Tersimpan (Aktif)' : 'Belum Ada Token'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Token disimpan secara terenkripsi AES-256 pada server dan hanya dapat diakses oleh akun Anda untuk penarikan otomatis atau manual.
                  </p>
                </div>
              </div>

              {tokenStatus?.saved ? (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div>
                      <dt className="text-[10px] text-slate-400 uppercase font-semibold">Waktu Disimpan</dt>
                      <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                        {tokenStatus.saved_at
                          ? new Date(tokenStatus.saved_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                          : '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-slate-400 uppercase font-semibold">Terakhir Digunakan</dt>
                      <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                        {tokenStatus.last_used_at
                          ? new Date(tokenStatus.last_used_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                          : 'Belum pernah digunakan'}
                      </dd>
                    </div>
                  </dl>

                  {tokenStatus.last_result === 'REJECTED' && (
                    <Alert kind="warning">
                      Pemakaian terakhir ditolak oleh MIMS (token kedaluwarsa). Silakan simpan token baru saat melakukan penarikan stok.
                    </Alert>
                  )}

                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={forgettingToken}
                      onClick={handleForgetToken}
                    >
                      Hapus Token Tersimpan
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-500 text-center">
                  Belum ada token sesi MIMS yang disimpan. Anda dapat mencentang &quot;Simpan token ini untuk penarikan berikutnya&quot; saat melakukan penarikan stok di Halaman Tarik Stok MIMS.
                </div>
              )}
            </div>

            {/* Bagian 2: Penjadwalan Tarik Otomatis Harian */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <IconZap size={15} className="text-amber-500" />
                      Penjadwalan Tarik Otomatis Harian
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        autoSettings?.auto_enabled
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {autoSettings?.auto_enabled ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Sistem menjalankan penarikan stok secara otomatis setiap hari menggunakan token tersimpan.
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                {/* Waktu Eksekusi */}
                <div className="flex flex-wrap items-center gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <label htmlFor="mims-drawer-auto-time" className="font-semibold text-slate-700 dark:text-slate-300">
                    Waktu Penarikan (WIB):
                  </label>
                  <input
                    id="mims-drawer-auto-time"
                    type="time"
                    value={autoTime}
                    onChange={(e) => setAutoTime(e.target.value)}
                    disabled={savingAuto}
                    className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-slate-500">
                    Disarankan dini hari (misal pukul 02:00 WIB) saat lalu lintas server MIMS stabil.
                  </span>
                </div>

                {/* Jenis Data yang Ditarik Otomatis */}
                <div className="space-y-2">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                    Cakupan Data yang Ditarik Otomatis:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      ['stock', 'Stok Gudang', 'Saldo stok fisik seluruh gudang'],
                      ['issues', 'Pengeluaran Material', 'Mutasi pengeluaran material'],
                      ['receipts', 'Penerimaan Material', 'Mutasi penerimaan material'],
                    ].map(([key, label, desc]) => (
                      <label
                        key={key}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                          autoWhat[key]
                            ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
                            : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={autoWhat[key]}
                          onChange={(e) => setAutoWhat((prev) => ({ ...prev, [key]: e.target.checked }))}
                          disabled={savingAuto}
                          className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <div>
                          <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">{label}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Informasi Status Penjadwal */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <div>
                    <span className="font-semibold">Pemilik Kredensial:</span>{' '}
                    {autoSettings?.auto_user_name || 'Akun Anda saat mengaktifkan'}
                  </div>
                  {autoSettings?.last_auto_date && (
                    <div>
                      <span className="font-semibold">Penarikan Otomatis Terakhir:</span>{' '}
                      <span className="font-mono">{autoSettings.last_auto_date}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 pt-1">
                    * Catatan: Jika token kedaluwarsa, penarikan otomatis akan gagal dan notifikasi peringatan akan dikirimkan ke pemegang izin impor stok.
                  </p>
                </div>

                {/* Tombol Aksi Simpan & Toggle */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {autoSettings?.auto_enabled ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={savingAuto}
                        onClick={() => handleSaveAuto(false)}
                      >
                        Matikan Tarik Otomatis
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={savingAuto}
                        onClick={() => handleSaveAuto(true)}
                      >
                        Simpan Perubahan
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={savingAuto}
                      disabled={!tokenStatus?.saved}
                      onClick={() => handleSaveAuto(true)}
                    >
                      {tokenStatus?.saved ? 'Aktifkan Tarik Otomatis' : 'Perlu Simpan Token Dahulu'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
