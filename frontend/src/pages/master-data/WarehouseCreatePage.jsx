import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { warehousesApi, adminApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import UnitPicker from '../../components/UnitPicker.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { IconCheck, IconCheckCircle, IconPlus, IconUpload, IconAlertCircle } from '../../components/icons.jsx'

/** Halaman tambah gudang: manual, atau impor daftar gudang dari JSON ERP dengan pratinjau validasi (laci/dialog pada daftar tidak lagi memuat form). */
export default function WarehouseCreatePage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const goBack = () => navigate('/master-data/warehouses')
  const [units, setUnits] = useState([])
  // Unified Drawer Create / Import Warehouse
  const [warehouseDrawerMode, setWarehouseDrawerMode] = useState('manual') // 'manual' | 'upload'
  const [createCode, setCreateCode] = useState('')
  const [createName, setCreateName] = useState('')
  const [createUnitId, setCreateUnitId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Impor Daftar Gudang ERP (JSON) state inside unified drawer
  const [erpJsonText, setErpJsonText] = useState('')
  const [erpDryRunLoading, setErpDryRunLoading] = useState(false)
  const [erpDryRunResult, setErpDryRunResult] = useState(null)
  const [erpApplying, setErpApplying] = useState(false)
  const [erpError, setErpError] = useState('')

  // Load Units for dropdown
  useEffect(() => {
    adminApi
      .units()
      .then((res) => setUnits(res?.data || []))
      .catch(() => setUnits([]))
  }, [])

  // Handle Create Warehouse
  const handleCreateWarehouse = async (e) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      await warehousesApi.create({
        code: createCode.trim(),
        name: createName.trim(),
        organizational_unit_id: createUnitId,
      })
      notify({
        type: 'success',
        title: 'Gudang Berhasil Ditambahkan',
        desc: `Gudang ${createCode} (${createName}) berhasil dibuat.`,
        tag: 'GUDANG',
      })
      goBack()
      setCreateCode('')
      setCreateName('')
      setCreateUnitId('')
    } catch (err) {
      const msg = err?.message || 'Gagal menambahkan gudang.'
      setCreateError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menambahkan Gudang',
        desc: msg,
        tag: 'GUDANG',
      })
    } finally {
      setCreating(false)
    }
  }

  // Handle ERP Warehouse Import Dry Run
  const handleDryRunErpImport = async (e) => {
    e?.preventDefault?.()
    setErpDryRunLoading(true)
    setErpError('')
    try {
      let parsed
      try {
        parsed = JSON.parse(erpJsonText.trim())
      } catch {
        throw new Error('Format JSON tidak valid. Periksa sintaks JSON yang ditempel.')
      }

      const res = await warehousesApi.importErp({
        ...parsed,
        dry_run: true,
      })
      setErpDryRunResult(res)
      notify({
        type: 'info',
        title: 'Validasi Gudang ERP Selesai',
        desc: `Hasil dry run: ${res?.data?.total ?? res?.rows?.length ?? 0} gudang diperiksa.`,
        tag: 'GUDANG',
      })
    } catch (err) {
      const msg = err?.message || 'Uji validasi dry run impor gudang ERP gagal.'
      setErpError(msg)
      notify({
        type: 'error',
        title: 'Gagal Validasi Gudang ERP',
        desc: msg,
        tag: 'GUDANG',
      })
    } finally {
      setErpDryRunLoading(false)
    }
  }

  // Handle ERP Warehouse Import Commit
  const handleCommitErpImport = async () => {
    setErpApplying(true)
    setErpError('')
    try {
      const parsed = JSON.parse(erpJsonText.trim())
      const res = await warehousesApi.importErp({
        ...parsed,
        dry_run: false,
      })
      notify({
        type: 'success',
        title: 'Gudang ERP Berhasil Diterapkan',
        desc: `Berhasil memproses gudang ERP: ${res?.data?.accepted || res?.data?.created || 0} diterapkan.`,
        tag: 'GUDANG',
      })
      goBack()
      setErpJsonText('')
      setErpDryRunResult(null)
    } catch (err) {
      const msg = err?.message || 'Gagal menerapkan impor gudang ERP.'
      setErpError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menerapkan Gudang ERP',
        desc: msg,
        tag: 'GUDANG',
      })
    } finally {
      setErpApplying(false)
    }
  }


  return (
    <>
      {/* UNIFIED DRAWER: Tambah Gudang Manual / Impor Gudang ERP (JSON) */}
      <PanelShell
        asPage
        onBack={goBack}
        title="Tambah Gudang Penyimpanan"
        subtitle="Tambahkan gudang baru secara manual atau impor daftar gudang dari data JSON ERP dengan pratinjau validasi."
        footer={
          warehouseDrawerMode === 'manual' ? (
            <div className="flex items-center justify-between w-full">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => goBack()}
                disabled={creating}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={creating}
                onClick={handleCreateWarehouse}
              >
                Simpan Gudang
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => goBack()}
                disabled={erpDryRunLoading || erpApplying}
              >
                Batal
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={erpDryRunResult ? 'secondary' : 'primary'}
                  size="sm"
                  loading={erpDryRunLoading}
                  disabled={!erpJsonText.trim() || erpApplying}
                  onClick={handleDryRunErpImport}
                >
                  <IconUpload size={14} />
                  <span>Uji Validasi (Dry Run)</span>
                </Button>
                {erpDryRunResult && (erpDryRunResult.data?.rejected === 0 || erpDryRunResult.data?.rejected === undefined) && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={erpApplying}
                    onClick={handleCommitErpImport}
                  >
                    <IconCheck size={14} />
                    <span>Terapkan ({erpDryRunResult.rows?.length || erpDryRunResult.data?.total || 0} Gudang)</span>
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        <div className="space-y-5 text-xs">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setWarehouseDrawerMode('manual')}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                warehouseDrawerMode === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconPlus size={14} />
              <span>Tambah Manual</span>
            </button>
            <button
              type="button"
              onClick={() => setWarehouseDrawerMode('upload')}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                warehouseDrawerMode === 'upload'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconUpload size={14} />
              <span>Via Upload (JSON ERP)</span>
            </button>
          </div>

          {warehouseDrawerMode === 'manual' ? (
            <form onSubmit={handleCreateWarehouse} className="space-y-4 text-xs">
              {createError && <Alert kind="error">{createError}</Alert>}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kode Gudang *
                </label>
                <input
                  type="text"
                  required
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: GDG-UP3-MJK, GDG-ULP-MJO"
                  className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Gudang *
                </label>
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Contoh: Gudang Induk Distribusi Mojokerto"
                  className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Unit Organisasi Pemilik *
                </label>
                <UnitPicker
                  permission="warehouses.manage"
                  level="any"
                  value={createUnitId}
                  onChange={setCreateUnitId}
                  units={units}
                  up3AriaLabel="Unit Pemilik UP3"
                  unitAriaLabel="Unit Pemilik ULP"
                />
              </div>
            </form>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 space-y-1">
                <p className="font-bold">Format Data JSON Gudang ERP</p>
                <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                  Tempel payload JSON daftar gudang ERP (format data respons ERP <code className="font-mono">{`{"gudang":{"data":[...]}}`}</code> atau daftar item gudang dengan atribut <code className="font-mono">plant, stor_loc, stor_loc_name, unit, jenis</code>).
                </p>
              </div>

              {erpError && <Alert kind="error">{erpError}</Alert>}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Data JSON Gudang ERP <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={7}
                  value={erpJsonText}
                  onChange={(e) => {
                    setErpJsonText(e.target.value)
                    setErpDryRunResult(null)
                  }}
                  placeholder={`{\n  "gudang": {\n    "data": [\n      {\n        "plant": "5110",\n        "stor_loc": "SL01",\n        "stor_loc_name": "Gudang Area Mojokerto",\n        "unit": "51330",\n        "jenis": "GI"\n      }\n    ]\n  }\n}`}
                  className="block w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              {/* ERP Import Dry Run Result */}
              {erpDryRunResult && (
                <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Hasil Validasi Pratinjau Gudang ERP
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Total: {erpDryRunResult.data?.total ?? erpDryRunResult.rows?.length ?? 0}
                      </span>
                      {erpDryRunResult.data?.created !== undefined && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                          Baru: {erpDryRunResult.data.created}
                        </span>
                      )}
                      {erpDryRunResult.data?.updated !== undefined && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                          Perbarui: {erpDryRunResult.data.updated}
                        </span>
                      )}
                      {erpDryRunResult.data?.rejected > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                          Ditolak: {erpDryRunResult.data.rejected}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                        <tr className="border-b border-slate-200 dark:border-slate-700 font-semibold text-[10px] text-slate-600 dark:text-slate-400">
                          <th className="py-2 px-2.5">Plant</th>
                          <th className="py-2 px-2.5">Storage Loc</th>
                          <th className="py-2 px-2.5">Nama Gudang</th>
                          <th className="py-2 px-2.5">Kode Unit</th>
                          <th className="py-2 px-2.5">Jenis</th>
                          <th className="py-2 px-2.5">Status</th>
                          <th className="py-2 px-2.5">Keterangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                        {(erpDryRunResult.rows || []).map((r, idx) => (
                          <tr key={idx} className={r.status === 'REJECTED' || r.status === 'DITOLAK' ? 'bg-rose-50/60 dark:bg-rose-950/30' : ''}>
                            <td className="py-2 px-2.5">{r.plant}</td>
                            <td className="py-2 px-2.5">{r.stor_loc}</td>
                            <td className="py-2 px-2.5 font-sans font-medium">{r.stor_loc_name || r.name}</td>
                            <td className="py-2 px-2.5">{r.unit}</td>
                            <td className="py-2 px-2.5">{r.jenis || r.kind}</td>
                            <td className="py-2 px-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  r.status === 'CREATED' || r.status === 'BARU'
                                    ? 'bg-blue-100 text-blue-800'
                                    : r.status === 'UPDATED' || r.status === 'PERBARUI'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-[10px] font-sans text-slate-600 dark:text-slate-400">
                              {r.reason || r.errors?.join('; ') || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PanelShell>
    </>
  )
}
