import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { feedersApi, substationsApi, adminApi } from '../../services/api.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconSearch,
  IconPlus,
  IconLayers,
  IconUsers,
  IconZap,
  IconInfo,
  IconPencil,
  IconHistory,
  IconRefresh,
  IconCheckCircle,
  IconAlertCircle,
} from '../../components/icons.jsx'

const inputCls =
  'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

const fmt = (v, d = 1) =>
  v === null || v === undefined
    ? '-'
    : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d })

export function FeederStatusBadge({ status }) {
  const isAktif = status === 'AKTIF'
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
        isAktif
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      }`}
    >
      {status || 'AKTIF'}
    </span>
  )
}

function FeederFormModal({ isOpen, onClose, feeder, units, onSaved }) {
  const isEdit = Boolean(feeder)
  const { notify } = useNotifications()
  const [form, setForm] = useState({
    code: '',
    name: '',
    gi_code: '',
    gi_transformer_no: '',
    owner_unit_id: '',
    status: 'AKTIF',
    notes: '',
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (feeder) {
      setForm({
        code: feeder.code || '',
        name: feeder.name || '',
        gi_code: feeder.gi_code || '',
        gi_name: feeder.gi_name || '',
        gi_transformer_no: feeder.gi_transformer_no || '',
        owner_unit_id: feeder.owner_unit_id || '',
        status: feeder.status || 'AKTIF',
        notes: feeder.notes || '',
        reason: '',
      })
    } else {
      setForm({
        code: '',
        name: '',
        gi_code: '',
      gi_name: '',
        gi_transformer_no: '',
        owner_unit_id: units[0]?.id || '',
        status: 'AKTIF',
        notes: '',
        reason: '',
      })
    }
    setError('')
  }, [feeder, units, isOpen])

  const setVal = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.reason || form.reason.trim().length < 3) {
      setError('Alasan perubahan wajib diisi (minimal 3 karakter).')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await feedersApi.update(feeder.id, {
          name: form.name || null,
          gi_code: form.gi_code || null,
          gi_name: form.gi_name || null,
          gi_transformer_no: form.gi_transformer_no || null,
          owner_unit_id: form.owner_unit_id,
          status: form.status,
          notes: form.notes || null,
          reason: form.reason.trim(),
        })
        notify({
          type: 'success',
          title: 'Penyulang Diperbarui',
          desc: `Penyulang ${feeder.code} berhasil diperbarui.`,
          tag: 'FEEDER',
        })
      } else {
        await feedersApi.create({
          code: form.code.trim().toUpperCase(),
          name: form.name ? form.name.trim() : null,
          gi_code: form.gi_code ? form.gi_code.trim() : null,
          gi_name: form.gi_name ? form.gi_name.trim() : null,
          gi_transformer_no: form.gi_transformer_no ? form.gi_transformer_no.trim() : null,
          owner_unit_id: form.owner_unit_id,
          notes: form.notes ? form.notes.trim() : null,
          reason: form.reason.trim(),
        })
        notify({
          type: 'success',
          title: 'Penyulang Ditambahkan',
          desc: `Penyulang ${form.code.trim().toUpperCase()} berhasil dibuat.`,
          tag: 'FEEDER',
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan penyulang.')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {isEdit ? `Ubah Penyulang ${feeder?.code}` : 'Tambah Penyulang Baru'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          {error && (
            <div data-testid="feeder-form-error">
              <Alert kind="error">{error}</Alert>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Kode Penyulang <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={isEdit}
              placeholder="Misal: WTGLH"
              value={form.code}
              onChange={setVal('code')}
              className={`${inputCls} w-full font-mono uppercase ${
                isEdit ? 'bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed' : ''
              }`}
            />
            {isEdit && (
              <p className="text-[11px] text-slate-500 mt-1">
                Kode penyulang tidak dapat diubah setelah dibuat.
              </p>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nama Penyulang
            </label>
            <input
              type="text"
              placeholder="Nama penyulang (opsional)"
              value={form.name}
              onChange={setVal('name')}
              className={`${inputCls} w-full`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kode GI
              </label>
              <input
                type="text"
                placeholder="Misal: GI-MJK"
                value={form.gi_code}
                onChange={setVal('gi_code')}
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama GI
              </label>
              <input
                type="text"
                aria-label="Nama GI"
                placeholder="Misal: JOMBANG"
                value={form.gi_name}
                onChange={setVal('gi_name')}
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nomor Trafo GI
              </label>
              <input
                type="text"
                placeholder="Misal: 1 atau TRF-1"
                value={form.gi_transformer_no}
                onChange={setVal('gi_transformer_no')}
                className={`${inputCls} w-full`}
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Unit Pemilik <span className="text-rose-500">*</span>
            </label>
            <select
              required
              aria-label="Unit Pemilik"
              value={form.owner_unit_id}
              onChange={setVal('owner_unit_id')}
              className={`${inputCls} w-full`}
            >
              <option value="">Pilih Unit Organisasi</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} - {u.name} ({u.unit_type})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Penyulang dimiliki satu unit pengelola (UP3 atau ULP).
            </p>
          </div>

          {isEdit && (
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Status Operasional
              </label>
              <select
                aria-label="Status Operasional"
                value={form.status}
                onChange={setVal('status')}
                className={`${inputCls} w-full`}
              >
                <option value="AKTIF">AKTIF</option>
                <option value="NONAKTIF">NONAKTIF</option>
              </select>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Catatan
            </label>
            <textarea
              rows={2}
              placeholder="Catatan operasional / teknis (opsional)"
              value={form.notes}
              onChange={setVal('notes')}
              className={`${inputCls} w-full`}
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Alasan Perubahan / Pembuatan <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Tulis alasan perubahan (wajib min. 3 karakter)"
              value={form.reason}
              onChange={setVal('reason')}
              className={`${inputCls} w-full`}
            />
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {isEdit ? 'Simpan Perubahan' : 'Tambah Penyulang'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FeederDetail({ id, canManage, canViewCustomers, onEdit, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [substations, setSubstations] = useState([])
  const [loadingSubstations, setLoadingSubstations] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await feedersApi.get(id)
      setData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail penyulang.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  useEffect(() => {
    if (id) {
      setLoadingSubstations(true)
      substationsApi
        .list({ feeder_id: id, per_page: 50 })
        .then((res) => setSubstations(res?.data || []))
        .catch(() => setSubstations([]))
        .finally(() => setLoadingSubstations(false))
    }
  }, [id])

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <Spinner size="lg" label="Memuat detail penyulang..." />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="py-10" data-testid="feeder-detail-error">
        <Alert kind="error">{error || 'Data penyulang tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const { feeder, customers, served_units = [], loading: feederLoading, history = [] } = data

  return (
    <div className="space-y-6 text-xs" data-testid="feeder-detail">
      {/* Header Ringkasan */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
              {feeder.code}
            </span>
            <FeederStatusBadge status={feeder.status} />
          </div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">
            {feeder.name || 'Tanpa nama khusus'}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            icon={IconPencil}
            onClick={() => onEdit(feeder)}
          >
            Ubah Penyulang
          </Button>
        )}
      </div>

      {/* Ringkasan Parameter */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconInfo size={14} className="text-blue-500" />
          Informasi Pengelola & Gardu Induk
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
          <div>
            <dt className="text-[11px] text-slate-500">Unit</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200">
              {feeder.owner_unit_code
                ? `${feeder.owner_unit_code} - ${feeder.owner_unit_name || ''}`
                : feeder.owner_unit_name || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Gardu Induk (GI)</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200">
              {feeder.gi_name || feeder.gi_code || '-'}
              {feeder.gi_name && feeder.gi_code && <span className="font-normal text-slate-500"> ({feeder.gi_code})</span>}
              {feeder.gi_transformer_no && ` (Trafo ${feeder.gi_transformer_no})`}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Jumlah Gardu Terhubung</dt>
            <dd className="font-semibold font-mono text-slate-800 dark:text-slate-200">
              {fmt(feeder.substation_count, 0)} gardu
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Total Kapasitas Trafo Gardu</dt>
            <dd className="font-semibold font-mono text-slate-800 dark:text-slate-200">
              {fmt(feeder.capacity_kva, 0)} kVA
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-slate-500">Catatan</dt>
            <dd className="text-slate-700 dark:text-slate-300 italic">
              {feeder.notes || '-'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Pembebanan Penyulang */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconZap size={14} className="text-amber-500" />
          Pembebanan Penyulang
        </h3>
        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-slate-500">Tingkat Pembebanan</div>
            <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
              {feederLoading?.loading_pct !== null && feederLoading?.loading_pct !== undefined ? (
                <span>{fmt(feederLoading.loading_pct)}%</span>
              ) : (
                <span className="text-slate-500 text-xs font-normal">
                  belum ada beban terukur
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {feederLoading?.loading_pct !== null && feederLoading?.loading_pct !== undefined ? (
                <>
                  dari {feederLoading?.measured_substations ?? 0} gardu yang punya beban terukur
                  {feederLoading?.load_kva != null &&
                    ` (${fmt(feederLoading.load_kva, 1)} kVA dari ${fmt(
                      feederLoading.capacity_kva,
                      0
                    )} kVA terukur)`}
                </>
              ) : (
                'Tidak ada gardu pada penyulang ini yang memiliki catatan beban kVA.'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ringkasan Pelanggan */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <IconUsers size={14} className="text-emerald-500" />
            Pelanggan Terhubung
          </h3>
          {canViewCustomers && (
            <Link
              to={`/master-data/customers?feeder_id=${feeder.id}`}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
            >
              Lihat pelanggan penyulang ini →
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
            <div className="text-[11px] text-slate-500">Pelanggan Aktif</div>
            <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
              {fmt(customers?.active_customers, 0)}
            </div>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
            <div className="text-[11px] text-slate-500">Daya Tersambung</div>
            <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
              {fmt(customers?.connected_kva, 0)} kVA
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              {fmt(customers?.connected_va, 0)} VA
            </div>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
            <div className="text-[11px] text-slate-500">Pelanggan Besar (≥ 6.600 VA)</div>
            <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
              {fmt(customers?.large_customers, 0)}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 p-2.5 rounded-xl">
          <span className="font-semibold text-amber-800 dark:text-amber-300">Catatan Aturan Data (docs/81 §4): </span>
          Daya tersambung bukan beban dan tidak dibandingkan dengan kapasitas trafo karena pelanggan tidak menyala bersamaan.
        </div>
      </div>

      {/* ULP yang Dilayani */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <IconLayers size={14} className="text-indigo-500" />
            ULP yang Dilayani
          </h3>
          {served_units.length > 1 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
              Melintasi {served_units.length} ULP
            </span>
          )}
        </div>

        {served_units.length === 0 ? (
          <p className="text-slate-500 text-xs italic">
            Belum ada gardu yang terhubung ke penyulang ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400">
                  <th className="py-2.5 px-3">Kode ULP</th>
                  <th className="py-2.5 px-3">Nama ULP</th>
                  <th className="py-2.5 px-3 text-right">Jumlah Gardu</th>
                  <th className="py-2.5 px-3 text-right">Kapasitas (kVA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {served_units.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                      {u.code}
                    </td>
                    <td className="py-2 px-3">{u.name}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">
                      {fmt(u.substation_count, 0)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {fmt(u.capacity_kva, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daftar Gardu Terhubung */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <IconZap size={14} className="text-amber-500" />
            Daftar Gardu pada Penyulang Ini ({substations.length})
          </h3>
          <Link
            to={`/master-data/substations?feeder_id=${feeder.id}`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
          >
            Buka di Master Gardu →
          </Link>
        </div>

        {loadingSubstations ? (
          <div className="py-6 flex justify-center">
            <Spinner size="md" label="Memuat gardu..." />
          </div>
        ) : substations.length === 0 ? (
          <p className="text-slate-500 text-xs italic">
            Belum ada gardu yang terhubung pada penyulang ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs">
                <tr className="text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 px-3">Kode</th>
                  <th className="py-2 px-3">Nama / Lokasi</th>
                  <th className="py-2 px-3">Unit</th>
                  <th className="py-2 px-3 text-right">Kapasitas (kVA)</th>
                  <th className="py-2 px-3 text-right">Beban</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {substations.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      <Link
                        to={`/master-data/substations?q=${s.display_code || s.code}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {s.display_code || s.code}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300 truncate max-w-xs">
                      {s.name || s.area_note || '-'}
                    </td>
                    <td className="py-2 px-3 text-slate-500">{s.unit_name || s.unit_code}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(s.capacity_kva, 0)}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {s.reading?.loading_pct != null ? `${fmt(s.reading.loading_pct)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Riwayat Perubahan */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconHistory size={14} className="text-slate-500" />
          Riwayat Perubahan (maks. 20)
        </h3>

        {history.length === 0 ? (
          <p className="text-slate-500 text-xs italic">Belum ada riwayat perubahan.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div
                key={i}
                className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        h.action === 'CREATED'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          : h.action === 'AUTO'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      }`}
                    >
                      {h.action}
                    </span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {h.changed_by_name || 'Sistem'}
                    </span>
                  </div>
                  <span className="text-slate-400 font-mono">{h.created_at}</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">Alasan: </span>
                  {h.reason || '-'}
                </p>
                {h.before && (
                  <div className="text-[10px] text-slate-500 font-mono bg-white dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/60 dark:border-slate-800/60 overflow-x-auto">
                    <div>
                      <span className="text-rose-500">- Sebelum: </span>
                      {JSON.stringify(h.before)}
                    </div>
                    {h.after && (
                      <div>
                        <span className="text-emerald-500">+ Sesudah: </span>
                        {JSON.stringify(h.after)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function FeedersPage() {
  const { can } = useAccess()
  const canManage = Boolean(can?.['feeders.manage'])
  const canViewCustomers = Boolean(can?.['customers.view'])

  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filter state
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [ownerUnitId, setOwnerUnitId] = useState('')
  const [servesUnitId, setServesUnitId] = useState('')
  const [giCode, setGiCode] = useState('')
  const [status, setStatus] = useState('')

  // Reference units
  const [units, setUnits] = useState([])

  // Drawer / modal state
  const [openId, setOpenId] = useState(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingFeeder, setEditingFeeder] = useState(null)

  useEffect(() => {
    adminApi
      .units()
      .then((res) => setUnits(res?.data || []))
      .catch(() => setUnits([]))
  }, [])

  const loadFeeders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await feedersApi.list({
        q: query || undefined,
        owner_unit_id: ownerUnitId || undefined,
        serves_unit_id: servesUnitId || undefined,
        gi_code: giCode ? giCode.trim() : undefined,
        status: status || undefined,
        page,
        per_page: perPage,
      })
      setRows(res?.data || [])
      setMeta(res?.meta || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar penyulang.')
    } finally {
      setLoading(false)
    }
  }, [query, ownerUnitId, servesUnitId, giCode, status, page, perPage])

  useEffect(() => {
    loadFeeders()
  }, [loadFeeders])

  const handleOwnerUnitChange = (newOwnerId) => {
    setPage(1)
    setOwnerUnitId(newOwnerId)
  }

  const stats = useMemo(() => {
    const total = meta?.total ?? rows.length
    const activeCount = rows.filter((r) => r.status === 'AKTIF').length
    const totalGardu = rows.reduce((acc, r) => acc + (Number(r.substation_count) || 0), 0)
    const totalCapacity = rows.reduce((acc, r) => acc + (Number(r.total_capacity_kva) || 0), 0)
    return {
      total,
      activeCount,
      totalGardu,
      totalCapacity,
    }
  }, [rows, meta])

  return (
    <div className="space-y-6">
      {/* Header Modul Master Penyulang */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
              <IconLayers className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Master Data</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Penyulang</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Master Penyulang
                </h1>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Jaringan 20 kV
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Penyulang distribusi (20 kV), unit pengelola, kapasitas, dan gardu terhubung.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={loadFeeders}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canManage && (
              <Button
                icon={IconPlus}
                variant="primary"
                size="sm"
                onClick={() => setCreateModalOpen(true)}
              >
                Tambah Penyulang
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Master Penyulang */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Penyulang</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconLayers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Penyulang terdaftar di sistem</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Penyulang Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.activeCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Status operasi normal (halaman ini)</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Gardu Terhubung</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.totalGardu.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Akumulasi gardu (halaman ini)</p>
        </div>

        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 dark:bg-indigo-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Total Kapasitas</dt>
            <div className="rounded-lg p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <IconLayers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            {stats.totalCapacity.toLocaleString('id-ID')} <span className="text-sm font-semibold">kVA</span>
          </dd>
          <p className="mt-1 text-xs text-indigo-600/70 dark:text-indigo-500/70">Daya gardu tersambung (halaman ini)</p>
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
              aria-label="Cari penyulang"
              placeholder="Kode, nama, GI…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${inputCls} pl-8 w-48`}
            />
          </div>

          <HierarchicalUnitFilter
            permission="feeders.view"
            up3Id={ownerUnitId}
            onUp3Change={handleOwnerUnitChange}
            unitId={servesUnitId}
            onUnitChange={(v) => {
              setPage(1)
              setServesUnitId(v)
            }}
            up3AriaLabel="Cabang"
            unitAriaLabel="Unit"
          />

          <input
            aria-label="GI"
            placeholder="Kode GI…"
            value={giCode}
            onChange={(e) => setGiCode(e.target.value)}
            className={`${inputCls} w-28`}
          />

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

          <Button type="submit" variant="secondary" size="sm">
            Cari
          </Button>
        </form>
      </div>

      {error && (
        <div data-testid="feeders-list-error">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {/* Table Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat penyulang..." />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={IconLayers}
            title="Belum ada penyulang"
            description="Tidak ada data penyulang yang cocok dengan filter yang dipilih."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Kode</th>
                  <th className="py-3 px-4">Nama</th>
                  <th className="py-3 px-4">Gardu Induk (GI)</th>
                  <th className="py-3 px-4">Unit</th>
                  <th className="py-3 px-4 text-right">Jumlah Gardu</th>
                  <th className="py-3 px-4 text-right">Kapasitas (kVA)</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => setOpenId(f.id)}
                    className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    data-testid="feeder-row"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {f.code}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      {f.name || '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {f.gi_name || f.gi_code || '-'}
                      {f.gi_name && f.gi_code && <span className="text-[11px] text-slate-500"> ({f.gi_code})</span>}
                      {f.gi_transformer_no && ` (#${f.gi_transformer_no})`}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400" data-testid="feeder-units">
                      {/* Hanya nama unit (ULP) yang dilayani; cabang (UP3) pemilik ada pada filter dan detail */}
                      {f.served_units?.length ? f.served_units.map((u) => u.name).join(', ') : '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold">
                      {fmt(f.substation_count, 0)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {fmt(f.capacity_kva, 0)}
                    </td>
                    <td className="py-3 px-4">
                      <FeederStatusBadge status={f.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter
          itemCount={rows.length}
          total={meta?.total ?? rows.length}
          entityLabel="penyulang"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[25, 50, 100]}
        />
      </div>

      {/* Detail Drawer */}
      <Drawer
        isOpen={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Detail Penyulang"
        width="max-w-3xl"
      >
        {openId && (
          <FeederDetail
            id={openId}
            canManage={canManage}
            canViewCustomers={canViewCustomers}
            onEdit={(feederObj) => {
              setEditingFeeder(feederObj)
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </Drawer>

      {/* Create Modal */}
      <FeederFormModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        units={units}
        onSaved={loadFeeders}
      />

      {/* Edit Modal */}
      <FeederFormModal
        isOpen={Boolean(editingFeeder)}
        feeder={editingFeeder}
        onClose={() => setEditingFeeder(null)}
        units={units}
        onSaved={() => {
          loadFeeders()
          // Refresh detail if open
          if (openId) {
            setOpenId(null)
            setTimeout(() => setOpenId(editingFeeder?.id), 50)
          }
        }}
      />
    </div>
  )
}
