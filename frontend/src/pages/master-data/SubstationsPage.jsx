import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { substationsApi, feedersApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import {
  IconUpload,
  IconSearch,
  IconZap,
  IconUsers,
  IconPencil,
  IconHistory,
  IconMapPin,
  IconArrowUp,
  IconArrowDown,
  IconRefresh,
  IconAlertCircle,
  IconCheckCircle,
} from '../../components/icons.jsx'

const inputCls =
  'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))

/**
 * Formulir pengubahan data induk gardu aset (CRUD).
 * Dipakai pada Drawer Page (/master-data/substations/:id/ubah).
 */
export function SubstationEditDrawer({ id, asPage = false, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    area_note: '',
    latitude: '',
    longitude: '',
    capacity_kva: '',
    ownership: 'PLN',
    usage: '',
    type_code: '',
    feeder_code: '',
    status: 'AKTIF',
    needs_review: false,
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await substationsApi.get(id)
      const d = res?.data || null
      setData(d)
      if (d?.substation) {
        const s = d.substation
        setForm({
          name: s.name || '',
          area_note: s.area_note || '',
          latitude: s.latitude !== null && s.latitude !== undefined ? String(s.latitude) : '',
          longitude: s.longitude !== null && s.longitude !== undefined ? String(s.longitude) : '',
          capacity_kva: s.capacity_kva !== null && s.capacity_kva !== undefined ? String(s.capacity_kva) : '',
          ownership: s.ownership || 'PLN',
          usage: s.usage || '',
          type_code: s.type_code || '',
          feeder_code: s.feeder_code || '',
          status: s.status || 'AKTIF',
          needs_review: Boolean(s.needs_review),
          reason: '',
        })
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat gardu.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!form.reason || form.reason.trim().length < 3) {
      setSaveError('Alasan perubahan wajib diisi (minimal 3 karakter).')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        name: form.name.trim() || null,
        area_note: form.area_note.trim() || null,
        latitude: form.latitude !== '' ? Number(form.latitude) : null,
        longitude: form.longitude !== '' ? Number(form.longitude) : null,
        capacity_kva: form.capacity_kva !== '' ? Number(form.capacity_kva) : null,
        ownership: form.ownership,
        usage: form.usage || null,
        type_code: form.type_code.trim() || null,
        feeder_code: form.feeder_code.trim() || null,
        status: form.status,
        needs_review: form.needs_review,
        reason: form.reason.trim(),
      }

      await substationsApi.update(id, payload)
      notify({
        type: 'success',
        title: 'Data Gardu Diperbarui',
        desc: `Perubahan gardu ${data?.substation?.code || ''} berhasil disimpan.`,
        tag: 'GARDU',
      })
      onSuccess?.()
    } catch (err) {
      setSaveError(err?.message || 'Gagal memperbarui data gardu.')
    } finally {
      setSaving(false)
    }
  }

  const s = data?.substation
  const title = `Ubah Data Induk: ${s?.code || s?.name || id}`
  const subtitle = s?.unit_name ? `Unit: ${s.unit_name} · Kapasitas: ${fmt(s.capacity_kva, 0)} kVA` : 'Perubahan data induk gardu aset distribusi'

  return (
    <PanelShell
      asPage={asPage}
      isOpen={true}
      onClose={onClose}
      onBack={onClose}
      title={title}
      subtitle={subtitle}
      size="max-w-3xl"
      width="max-w-3xl"
    >
      {loading ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="py-10"><Alert kind="error">{error}</Alert></div>
      ) : (
        <form onSubmit={handleUpdate} className="space-y-4" data-testid="edit-substation-form">
          {saveError && <div data-testid="edit-substation-error"><Alert kind="error">{saveError}</Alert></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Nama Gardu
              <input
                type="text"
                aria-label="Nama Gardu"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Catatan Lokasi
              <input
                type="text"
                aria-label="Catatan Lokasi"
                value={form.area_note}
                onChange={(e) => setForm((f) => ({ ...f, area_note: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Lintang (Latitude)
              <input
                type="number"
                step="any"
                aria-label="Lintang"
                value={form.latitude}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Bujur (Longitude)
              <input
                type="number"
                step="any"
                aria-label="Bujur"
                value={form.longitude}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Kapasitas (kVA)
              <input
                type="number"
                min="1"
                aria-label="Kapasitas"
                value={form.capacity_kva}
                onChange={(e) => setForm((f) => ({ ...f, capacity_kva: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Kepemilikan
              <select
                aria-label="Kepemilikan Form"
                value={form.ownership}
                onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              >
                <option value="PLN">PLN</option>
                <option value="PELANGGAN">PELANGGAN</option>
              </select>
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Peruntukan
              <select
                aria-label="Peruntukan"
                value={form.usage}
                onChange={(e) => setForm((f) => ({ ...f, usage: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              >
                <option value="">- Belum dipilih -</option>
                <option value="UMUM">UMUM</option>
                <option value="KHUSUS">KHUSUS</option>
                <option value="CAMPURAN">CAMPURAN</option>
              </select>
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Tipe Gardu
              <input
                type="text"
                aria-label="Tipe Gardu"
                value={form.type_code}
                onChange={(e) => setForm((f) => ({ ...f, type_code: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Kode Penyulang
              <input
                type="text"
                aria-label="Kode Penyulang"
                value={form.feeder_code}
                onChange={(e) => setForm((f) => ({ ...f, feeder_code: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              />
            </label>

            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Status Operasi
              <select
                aria-label="Status Operasi"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
              >
                <option value="AKTIF">AKTIF</option>
                <option value="NONAKTIF">NONAKTIF</option>
              </select>
            </label>
          </div>

          <div className="pt-1">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                aria-label="Perlu Ditinjau Form"
                checked={form.needs_review}
                onChange={(e) => setForm((f) => ({ ...f, needs_review: e.target.checked }))}
              />
              Perlu ditinjau (hilang dari berkas penuh / anomali)
            </label>
          </div>

          <label className="block font-semibold text-xs text-slate-700 dark:text-slate-300 pt-1">
            Alasan Perubahan <span className="text-rose-500">*</span>
            <textarea
              aria-label="Alasan Perubahan"
              rows={2}
              placeholder="Tuliskan alasan perubahan data induk gardu (min. 3 karakter)..."
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className={`${inputCls} w-full mt-1 text-base sm:text-xs`}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Simpan Perubahan
            </Button>
          </div>
        </form>
      )}
    </PanelShell>
  )
}

/**
 * Panel Detail Master Gardu (Read-Only di Drawer Preview, atau Full-Page di Drawer Page).
 */
export function SubstationDetailDrawer({
  id,
  asPage = false,
  canManage,
  canViewFeeders,
  canViewCustomers,
  feedersList = [],
  onClose,
  onChanged,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await substationsApi.get(id)
      setData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat gardu.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const s = data?.substation
  const title = `Detail Master Gardu: ${s?.code || s?.name || id}`
  const subtitle = s?.unit_name ? `Unit: ${s.unit_name} · Kapasitas: ${fmt(s.capacity_kva, 0)} kVA` : 'Data induk dan aset teknis gardu distribusi'

  return (
    <PanelShell
      asPage={asPage}
      isOpen={true}
      onClose={onClose}
      onBack={onClose}
      title={title}
      subtitle={subtitle}
      size="max-w-3xl"
      width="max-w-3xl"
    >
      {loading ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : error ? (
        <div className="py-10"><Alert kind="error">{error}</Alert></div>
      ) : !data?.substation ? null : (
        <div className="space-y-5 text-xs" data-testid="substation-detail">
          {/* Banner Pratinjau / Navigasi Halaman */}
          {!asPage && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200">Pratinjau Data Gardu</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Drawer ini hanya menampilkan data aset (read-only). Untuk mengubah data induk, buka halaman ubah.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/master-data/substations/${s.id}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs shadow-2xs transition cursor-pointer"
                >
                  Halaman Lengkap →
                </Link>
                {canManage && (
                  <Link
                    to={`/master-data/substations/${s.id}/ubah`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
                  >
                    <IconPencil size={12} />
                    Buka Form Ubah →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Tombol ke Pengukuran Gardu */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900">
            <div>
              <div className="font-bold text-blue-950 dark:text-blue-100">Kondisi & Pembacaan Operasional</div>
              <div className="text-[11px] text-blue-700 dark:text-blue-300">
                Lihat pembebanan, tegangan ujung, keseimbangan fasa, dan riwayat analisis gardu ini.
              </div>
            </div>
            <Link
              to={`/master-data/substation-measurements?open=${s.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
            >
              Lihat pengukuran →
            </Link>
          </div>

          {s.needs_review && (
            <Alert kind="warning">
              Gardu ini tidak ada pada berkas lengkap terakhir. Periksa apakah masih beroperasi.
            </Alert>
          )}
          {!s.pickable && (
            <Alert kind="info">
              {s.ownership !== 'PLN'
                ? 'Gardu milik pelanggan: tersimpan, tidak dapat dipilih pada KKO.'
                : 'Gardu nonaktif: tidak dapat dipilih pada KKO.'}
            </Alert>
          )}

          {/* Ringkasan Data Induk */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Data Induk Aset</h3>
              {canManage && (
                <Link
                  to={`/master-data/substations/${s.id}/ubah`}
                  role="button"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                >
                  <IconPencil size={13} />
                  Ubah Data Induk
                </Link>
              )}
            </div>

            {(() => {
              const feeder = feedersList.find((f) => f.code === s.feeder_code || f.id === s.feeder_id)
              const feederText = s.feeder_code
                ? (feeder?.name ? `${s.feeder_code} - ${feeder.name}` : s.feeder_code)
                : '-'

              return (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {[
                    ['Kode Gardu', s.gadis_number || s.code],
                    ['Nama Gardu', s.code || s.name || '-'],
                    ['Lokasi', s.name || s.area_note || '-'],
                    ['Alamat', s.address || '-'],
                    ['Catatan Lokasi', s.area_note || '-'],
                    ['Unit', `${s.unit_code || ''} ${s.unit_name || ''}`.trim() || '-'],
                    [
                      'Penyulang',
                      s.feeder_code ? (
                        canViewFeeders ? (
                          <Link
                            to={`/master-data/feeders?q=${s.feeder_code}`}
                            className="text-blue-600 dark:text-blue-400 font-mono font-bold hover:underline"
                          >
                            {feederText}
                          </Link>
                        ) : (
                          <span className="font-mono font-bold">{feederText}</span>
                        )
                      ) : (
                        '-'
                      ),
                    ],
                    ['Tipe', s.type_code || '-'],
                    ['Peruntukan', s.usage || '-'],
                    ['Kapasitas', s.capacity_kva ? `${fmt(s.capacity_kva, 0)} kVA (${s.transformer_count ?? 1} trafo)` : '-'],
                    ['Kepemilikan', s.ownership || '-'],
                    ['Wilayah', [s.kelurahan, s.kecamatan, s.kabupaten].filter(Boolean).join(', ') || '-'],
                    [
                      'Koordinat',
                      s.latitude !== null && s.longitude !== null ? (
                        <span className="inline-flex items-center gap-1 font-mono">
                          {s.latitude}, {s.longitude}
                          <a
                            href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 font-sans hover:underline ml-1"
                          >
                            (peta)
                          </a>
                        </span>
                      ) : (
                        '-'
                      ),
                    ],
                    ['No. Aset', s.asset_number || '-'],
                    ['Kode Lokasi', s.location_code || '-'],
                    ['No. GADIS', s.gadis_number || '-'],
                    ['Status', s.status || '-'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] text-slate-500">{k}</dt>
                      <dd className="font-semibold text-slate-800 dark:text-slate-200">{v}</dd>
                    </div>
                  ))}
                </dl>
              )
            })()}
          </div>

          {/* Kartu Pelanggan Terhubung (docs/81) */}
          {canViewCustomers && data.customers && (
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-800 space-y-2" data-testid="substation-customers-card">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <IconUsers size={14} className="text-emerald-500" />
                  Pelanggan Terhubung
                </h3>
                <Link
                  to={`/master-data/customers?substation_id=${s.id}`}
                  className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                >
                  Lihat pelanggan gardu ini →
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Pelanggan Aktif</div>
                  <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
                    {fmt(data.customers.active_customers, 0)}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Daya Tersambung</div>
                  <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
                    {fmt(data.customers.connected_kva, 0)} kVA
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono">
                    {fmt(data.customers.connected_va, 0)} VA
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500">Pelanggan Besar (≥ 6.600 VA)</div>
                  <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
                    {fmt(data.customers.large_customers, 0)}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 pt-1">
                * Catatan: Daya tersambung adalah total kontrak pelanggan, bukan beban gardu dan tidak dibandingkan dengan kapasitas trafo.
              </p>
            </div>
          )}

          {/* Daftar Trafo */}
          <div>
            <h3 className="font-bold mb-1 text-slate-900 dark:text-slate-100">Daftar Trafo</h3>
            {!data.transformers || data.transformers.length === 0 ? (
              <p className="text-slate-500">Belum ada data trafo.</p>
            ) : (
              <ul className="space-y-1">
                {data.transformers.map((t) => (
                  <li
                    key={t.slot}
                    className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 font-mono text-slate-800 dark:text-slate-200"
                  >
                    <span className="font-bold">Slot #{t.slot}</span> · {fmt(t.capacity_kva, 0)} kVA{' '}
                    {t.brand ? `· ${t.brand}` : ''} {t.year_made ? `· Tahun ${t.year_made}` : ''}{' '}
                    {t.serial_number ? `· No. Seri ${t.serial_number}` : ''}{' '}
                    {t.phase_count ? `· ${t.phase_count} Fasa` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Riwayat Perubahan Data Induk */}
          <div className="space-y-2">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <IconHistory size={14} className="text-slate-500" />
              Riwayat Perubahan Data Induk
            </h3>
            {!data.history || data.history.length === 0 ? (
              <p className="text-slate-500">Belum ada riwayat perubahan data induk tercatat.</p>
            ) : (
              <div className="space-y-2" data-testid="substation-history-list">
                {data.history.map((h, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{h.action}</span>
                      <span className="text-[11px] text-slate-400 font-mono">{h.created_at}</span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Oleh:</span> {h.changed_by_name || '-'}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Alasan:</span> {h.reason}
                    </div>
                    {h.after && (
                      <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 font-mono">
                        Perubahan: {Object.keys(h.after).map((k) => `${k}: ${h.before?.[k] ?? '-'} → ${h.after[k]}`).join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  )
}

/** Master Data › Master Gardu (aset). Cakupan unit dan hak tulis ditentukan server. */
export default function SubstationsPage() {
  const { can, isSysAdmin } = useAccess()
  const navigate = useNavigate()
  const canImport = Boolean(can?.['substations.import'] || isSysAdmin)
  const canManage = Boolean(can?.['substations.manage'] || isSysAdmin)
  const canViewFeeders = Boolean(can?.['feeders.view'])
  const canViewCustomers = Boolean(can?.['customers.view'])

  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  // Filters
  const [q, setQ] = useState(searchParams.get('q') || '')
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [feederId, setFeederId] = useState(searchParams.get('feeder_id') || '')
  const [brand, setBrand] = useState('')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [capacityMin, setCapacityMin] = useState('')
  const [capacityMax, setCapacityMax] = useState('')
  const [kecamatan, setKecamatan] = useState('')
  const [ownership, setOwnership] = useState('')
  const [status, setStatus] = useState('')
  const [hasCoordinates, setHasCoordinates] = useState(false) // if true -> has_coordinates = 0
  const [needsReview, setNeedsReview] = useState(false)

  // Sorting: code | name | capacity | year
  const [sort, setSort] = useState('')
  const [dir, setDir] = useState('asc')

  const [units, setUnits] = useState([])
  const [feedersList, setFeedersList] = useState([])
  const [openId, setOpenId] = useState(searchParams.get('open') || null)

  // Sync openId with URL
  useEffect(() => {
    const p = searchParams.get('open')
    if (p && p !== openId) {
      setOpenId(p)
    }
  }, [searchParams])

  const handleOpenDrawer = (id) => {
    setOpenId(id)
    const next = new URLSearchParams(searchParams)
    next.set('open', id)
    setSearchParams(next, { replace: true })
  }

  const handleCloseDrawer = () => {
    setOpenId(null)
    if (searchParams.has('open')) {
      const next = new URLSearchParams(searchParams)
      next.delete('open')
      setSearchParams(next, { replace: true })
    }
  }

  useEffect(() => {
    adminApi
      .units()
      .then((res) => setUnits(res?.data || []))
      .catch(() => setUnits([]))

    if (canViewFeeders) {
      feedersApi
        .list({ per_page: 100 })
        .then((res) => setFeedersList(res?.data || []))
        .catch(() => setFeedersList([]))
    }
  }, [canViewFeeders])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        q: query || undefined,
        organizational_unit_id: unitId || undefined,
        feeder_id: feederId || undefined,
        brand: brand || undefined,
        year_from: yearFrom || undefined,
        year_to: yearTo || undefined,
        capacity_min: capacityMin || undefined,
        capacity_max: capacityMax || undefined,
        kecamatan: kecamatan || undefined,
        ownership: ownership || undefined,
        status: status || undefined,
        has_coordinates: hasCoordinates ? 0 : undefined,
        needs_review: needsReview ? 1 : undefined,
        sort: sort || undefined,
        dir: sort ? dir : undefined,
        page,
        per_page: perPage,
      }
      const res = await substationsApi.list(params)
      setRows(res?.data || [])
      setMeta(res?.meta || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar gardu.')
    } finally {
      setLoading(false)
    }
  }, [
    query,
    unitId,
    feederId,
    brand,
    yearFrom,
    yearTo,
    capacityMin,
    capacityMax,
    kecamatan,
    ownership,
    status,
    hasCoordinates,
    needsReview,
    sort,
    dir,
    page,
    perPage,
  ])

  useEffect(() => {
    load()
  }, [load])

  const handleSort = (column) => {
    if (sort === column) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(column)
      setDir('asc')
    }
    setPage(1)
  }

  const ulps = units.filter((u) => u.unit_type === 'ULP')

  const stats = useMemo(() => {
    const total = meta?.total ?? rows.length
    const activeCount = rows.filter((r) => r.status === 'AKTIF').length
    const totalCapacity = rows.reduce((acc, r) => acc + (Number(r.capacity_kva) || 0), 0)
    const reviewOrNoCoords = rows.filter((r) => r.needs_review || r.latitude === null || r.longitude === null).length
    return {
      total,
      activeCount,
      totalCapacity,
      reviewOrNoCoords,
    }
  }, [rows, meta])

  return (
    <div className="space-y-6">
      {/* Header Modul Master Gardu */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-amber-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-amber-500 p-2.5 text-white shadow-xs">
              <IconZap className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Master Data</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Master Gardu</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Master Gardu
                </h1>
                <span className="rounded-full bg-amber-100 dark:bg-amber-950 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Aset Distribusi
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Data induk aset gardu distribusi (kapasitas, trafo, lokasi, penyulang) yang dikelola oleh Perencanaan &amp; Enjiniring.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={load}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canImport && (
              <Button icon={IconUpload} size="sm" onClick={() => navigate('/master-data/substations/impor')}>
                Impor Gardu
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Master Gardu */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Gardu</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Aset terdaftar di sistem</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Gardu Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.activeCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Operasional normal (halaman ini)</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Kapasitas Terpasang</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.totalCapacity.toLocaleString('id-ID')} <span className="text-sm font-semibold">kVA</span>
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Akumulasi daya trafo (halaman ini)</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Perhatian / Lokasi</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.reviewOrNoCoords.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu tinjau / tanpa koordinat</p>
        </div>
      </dl>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQuery(q.trim())
          }}
        >
          <div className="relative">
            <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              aria-label="Cari gardu"
              placeholder="Kode, nama, lokasi…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${inputCls} pl-8 w-48 sm:w-56`}
            />
          </div>

          <HierarchicalUnitFilter
            permission="substations.view"
            up3Id={up3Id}
            onUp3Change={(newUp3) => {
              setPage(1)
              setUp3Id(newUp3)
            }}
            unitId={unitId}
            onUnitChange={(newUnit) => {
              setPage(1)
              setUnitId(newUnit)
            }}
            unitAriaLabel="Unit"
          />

          {canViewFeeders && (
            <select
              aria-label="Penyulang"
              value={feederId}
              onChange={(e) => {
                setPage(1)
                setFeederId(e.target.value)
              }}
              className={inputCls}
            >
              <option value="">Semua penyulang</option>
              {feedersList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} {f.name ? `(${f.name})` : ''}
                </option>
              ))}
            </select>
          )}

          <input
            aria-label="Merk Trafo"
            placeholder="Merk trafo…"
            value={brand}
            onChange={(e) => {
              setPage(1)
              setBrand(e.target.value)
            }}
            className={`${inputCls} w-28`}
          />

          <div className="flex items-center gap-1">
            <input
              type="number"
              aria-label="Tahun Dari"
              placeholder="Thn dari"
              value={yearFrom}
              onChange={(e) => {
                setPage(1)
                setYearFrom(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
            <span className="text-slate-400">-</span>
            <input
              type="number"
              aria-label="Tahun Sampai"
              placeholder="Thn s/d"
              value={yearTo}
              onChange={(e) => {
                setPage(1)
                setYearTo(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
          </div>

          <div className="flex items-center gap-1">
            <input
              type="number"
              aria-label="Kapasitas Min"
              placeholder="kVA min"
              value={capacityMin}
              onChange={(e) => {
                setPage(1)
                setCapacityMin(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
            <span className="text-slate-400">-</span>
            <input
              type="number"
              aria-label="Kapasitas Maks"
              placeholder="kVA maks"
              value={capacityMax}
              onChange={(e) => {
                setPage(1)
                setCapacityMax(e.target.value)
              }}
              className={`${inputCls} w-20`}
            />
          </div>

          <input
            aria-label="Kecamatan"
            placeholder="Kecamatan…"
            value={kecamatan}
            onChange={(e) => {
              setPage(1)
              setKecamatan(e.target.value)
            }}
            className={`${inputCls} w-28`}
          />

          <select
            aria-label="Kepemilikan"
            value={ownership}
            onChange={(e) => {
              setPage(1)
              setOwnership(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua kepemilikan</option>
            <option value="PLN">PLN</option>
            <option value="PELANGGAN">Pelanggan</option>
          </select>

          <select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua status</option>
            <option value="AKTIF">AKTIF</option>
            <option value="NONAKTIF">NONAKTIF</option>
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
            <input
              aria-label="Tanpa koordinat"
              type="checkbox"
              checked={hasCoordinates}
              onChange={(e) => {
                setPage(1)
                setHasCoordinates(e.target.checked)
              }}
            />
            Tanpa koordinat
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
            <input
              aria-label="Perlu ditinjau"
              type="checkbox"
              checked={needsReview}
              onChange={(e) => {
                setPage(1)
                setNeedsReview(e.target.checked)
              }}
            />
            Perlu ditinjau
          </label>

          <Button type="submit" variant="secondary" size="sm">
            Cari
          </Button>
        </form>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Tabel Data Induk Gardu */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat gardu..." />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={IconZap}
            title="Belum ada gardu"
            description="Tidak ada gardu yang cocok. Impor berkas gardu atau ubah filter pencarian."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th
                    className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('code')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Kode</span>
                      {sort === 'code' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th
                    className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Nama / Lokasi</span>
                      {sort === 'name' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-4">Alamat</th>
                  <th className="py-3 px-4">Unit</th>
                  <th className="py-3 px-4">Penyulang</th>
                  <th
                    className="py-3 px-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('capacity')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Kapasitas (kVA)</span>
                      {sort === 'capacity' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-4">Merk Trafo</th>
                  <th
                    className="py-3 px-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    onClick={() => handleSort('year')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Tahun (Umur)</span>
                      {sort === 'year' && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-4">Koordinat</th>
                  <th className="py-3 px-4">Kepemilikan</th>
                  <th className="py-3 px-4">Status & Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((s) => {
                  const feeder = feedersList.find((f) => f.code === s.feeder_code || f.id === s.feeder_id)
                  const feederText = s.feeder_code
                    ? (feeder?.name ? `${s.feeder_code} - ${feeder.name}` : s.feeder_code)
                    : '-'
                  const displayCode = s.gadis_number || s.code
                  const displayName = s.code || s.name || '-'

                  return (
                    <tr
                      key={s.id}
                      onClick={() => handleOpenDrawer(s.id)}
                      className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      data-testid="substation-row"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{displayCode}</td>
                      <td className="py-3 px-4">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{displayName}</span>
                          {s.name && s.name !== displayName && (
                            <span className="block text-[11px] text-slate-500 truncate max-w-xs">{s.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={s.address || '-'}>
                        {s.address || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{s.unit_name || s.unit_code || '-'}</td>
                      <td className="py-3 px-4 font-mono">
                        {s.feeder_code ? (
                          canViewFeeders ? (
                            <Link
                              to={`/master-data/feeders?q=${s.feeder_code}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {feederText}
                            </Link>
                          ) : (
                            feederText
                          )
                        ) : (
                          '-'
                        )}
                      </td>
                    <td className="py-3 px-4 text-right font-mono">{s.capacity_kva ? fmt(s.capacity_kva, 0) : '-'}</td>
                    <td className="py-3 px-4">{s.transformer_brand || '-'}</td>
                    <td className="py-3 px-4 font-mono">
                      {s.transformer_year
                        ? `${s.transformer_year}${s.transformer_age_years !== null && s.transformer_age_years !== undefined ? ` (${s.transformer_age_years} th)` : ''}`
                        : '-'}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {s.latitude !== null && s.longitude !== null ? (
                        <span>
                          {s.latitude}, {s.longitude}
                          <a
                            href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="ml-1 text-blue-600 dark:text-blue-400 hover:underline font-sans"
                          >
                            peta
                          </a>
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 px-4">{s.ownership || '-'}</td>
                    <td className="py-3 px-4 space-x-1">
                      {s.ownership !== 'PLN' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-800">
                          Pelanggan
                        </span>
                      )}
                      {s.status !== 'AKTIF' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                          Nonaktif
                        </span>
                      )}
                      {s.needs_review && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                          Perlu ditinjau
                        </span>
                      )}
                      {(s.latitude === null || s.longitude === null) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                          tanpa koordinat
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              </tbody>
            </table>
          </div>
        )}
        <TableFooter
          itemCount={rows.length}
          total={meta?.total ?? rows.length}
          entityLabel="gardu"
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

      {openId && (
        <SubstationDetailDrawer
          id={openId}
          asPage={false}
          canManage={canManage}
          canViewFeeders={canViewFeeders}
          canViewCustomers={canViewCustomers}
          feedersList={feedersList}
          onClose={handleCloseDrawer}
          onChanged={load}
        />
      )}
    </div>
  )
}
