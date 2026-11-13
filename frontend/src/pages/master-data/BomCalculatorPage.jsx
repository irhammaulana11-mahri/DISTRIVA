import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { bomApi, masterDataApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { BOM_GROUPS } from './BomPage.jsx'
import {
  IconArrowLeft,
  IconLayers,
  IconCheckCircle,
  IconRefresh,
} from '../../components/icons.jsx'

const PBPD_GROUPS = ['PBPD_6_41', 'PBPD_53_197', 'SR1PH']

export default function BomCalculatorPage() {
  const { id } = useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bom, setBom] = useState(null)

  // Construction Types for non-PBPD
  const [constructions, setConstructions] = useState([])
  const [constructionInputs, setConstructionInputs] = useState({}) // { [code]: { psg: '', bkr: '' } }

  // Parameters
  const [paramValues, setParamValues] = useState({}) // { [name]: value }

  // Calculation Results
  const [calculating, setCalculating] = useState(false)
  const [calcError, setCalcError] = useState('')
  const [calcResult, setCalcResult] = useState(null)
  const [hideZero, setHideZero] = useState(true)
  const [calcPage, setCalcPage] = useState(1)
  const [calcPerPage, setCalcPerPage] = useState(25)

  // Load BOM
  useEffect(() => {
    let isMounted = true
    const init = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await bomApi.get(id)
        const b = res?.data || null
        if (!isMounted) return
        setBom(b)

        // Initialize param defaults
        const initialParams = {}
        if (Array.isArray(b?.parameters)) {
          b.parameters.forEach((p) => {
            if (p.default !== undefined && p.default !== null) {
              initialParams[p.name] = p.default
            } else {
              initialParams[p.name] = (p.type ?? 'number') === 'text' ? '' : 0
            }
          })
        }
        setParamValues(initialParams)

        // If not PBPD, load construction types for this group
        if (b && !PBPD_GROUPS.includes(b.group)) {
          try {
            const cRes = await masterDataApi.constructionTypes({
              group: b.group,
              per_page: 100,
            })
            if (isMounted) {
              setConstructions(cRes?.data || [])
            }
          } catch (cErr) {
            // non-fatal
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err?.message || 'Gagal memuat BOM untuk kalkulator.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }
    init()
    return () => {
      isMounted = false
    }
  }, [id])

  // Update a param
  const handleParamChange = (name, val) => {
    setParamValues((prev) => ({
      ...prev,
      [name]: val,
    }))
  }

  // Update construction input
  const handleConstructionChange = (code, field, val) => {
    setConstructionInputs((prev) => ({
      ...prev,
      [code]: {
        ...prev[code],
        [field]: val,
      },
    }))
  }

  // Perform Calculation
  const handleCalculate = async (e) => {
    e?.preventDefault?.()
    if (!bom) return

    setCalculating(true)
    setCalcError('')
    setCalcResult(null)

    const isPbpd = PBPD_GROUPS.includes(bom.group)

    // Build inputs array
    let inputs = []
    if (!isPbpd) {
      Object.entries(constructionInputs).forEach(([code, vals]) => {
        const psg = Number(vals?.psg) || 0
        const bkr = Number(vals?.bkr) || 0
        if (psg > 0 || bkr > 0) {
          inputs.push({ code, psg, bkr })
        }
      })
    }

    // Clean params
    const paramsPayload = {}
    if (Array.isArray(bom.parameters)) {
      bom.parameters.forEach((p) => {
        const val = paramValues[p.name]
        const isText = (p.type ?? 'number') === 'text'
        if (isText) {
          paramsPayload[p.name] = val !== undefined && val !== null ? String(val).trim() : ''
        } else {
          paramsPayload[p.name] = Number(val) || 0
        }
      })
    }

    try {
      const res = await bomApi.calculate(id, {
        inputs,
        params: paramsPayload,
      })
      setCalcResult(res?.data || null)
    } catch (err) {
      setCalcError(
        err?.data?.errors?.inputs?.[0] ||
        err?.data?.errors?.params?.[0] ||
        err?.data?.errors?.formula?.[0] ||
        err?.message ||
        'Gagal melakukan kalkulasi BOM.'
      )
    } finally {
      setCalculating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-16 text-center">
        <Spinner label="Menyiapkan simulator kalkulator BOM..." />
      </div>
    )
  }

  if (error || !bom) {
    return (
      <div className="space-y-4">
        <Link
          to="/master-data/bom"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar BOM</span>
        </Link>
        <Alert kind="error">{error || 'Data BOM tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const isPbpd = PBPD_GROUPS.includes(bom.group)
  const groupMeta = BOM_GROUPS.find((g) => g.code === bom.group)

  // Filter lines if hideZero is checked
  const rawLines = calcResult?.lines || []
  const filteredLines = hideZero
    ? rawLines.filter((l) => {
        // Also if khs_code is null in result, server indicated it is inactive
        if (l.khs_code === null) return false
        const mat = Number(l.material) || 0
        const ins = Number(l.install) || 0
        const rem = Number(l.remove) || 0
        const ret = Number(l.return) || 0
        return mat > 0 || ins > 0 || rem > 0 || ret > 0
      })
    : rawLines

  // Format ID numbers
  const fmt = (val) => {
    if (val === null || val === undefined) return '-'
    const n = Number(val)
    if (isNaN(n)) return val
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(n)
  }

  return (
    <div className="w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to={`/master-data/bom/${bom.id}`}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
            title="Kembali ke Detail BOM"
          >
            <IconArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Kalkulator BOM
              </span>
              <span className="text-xs font-mono font-bold text-slate-500">
                {groupMeta?.name ?? bom.group} v{bom.version_number}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Uji Kalkulasi Kebutuhan Material & Jasa
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={handleCalculate}
            disabled={calculating}
            className="text-xs"
          >
            {calculating ? <Spinner size={14} label="Menghitung..." /> : 'Jalankan Perhitungan'}
          </Button>
        </div>
      </div>

      {calcError && <Alert kind="error">{calcError}</Alert>}

      {/* Main Grid: Form Left, Results Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* INPUTS COLUMN */}
        <div className="lg:col-span-5 space-y-5">
          {/* PBPD FORM */}
          {isPbpd ? (
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-5">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Parameter Pekerjaan APP (Pasang Baru & Perubahan Daya)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Kelompok PB/PD tidak menggunakan jenis konstruksi tiang, melainkan kombinasi rentang daya dan transaksi.
                </p>
              </div>

              {/* Header select parameters: PBPD:JENIS & PBPD:PEMBAYARAN */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* PBPD:JENIS */}
                {(() => {
                  const pJenis = bom.parameters?.find((p) => p.name === 'PBPD:JENIS')
                  return (
                    <div>
                      <label htmlFor="param-pbpd-jenis" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Jenis Pekerjaan (PBPD:JENIS)
                      </label>
                      <select
                        id="param-pbpd-jenis"
                        value={paramValues['PBPD:JENIS'] || ''}
                        onChange={(e) => handleParamChange('PBPD:JENIS', e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring cursor-pointer"
                      >
                        <option value="">-- Pilih Jenis --</option>
                        {pJenis?.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })()}

                {/* PBPD:PEMBAYARAN */}
                {(() => {
                  const pBayar = bom.parameters?.find((p) => p.name === 'PBPD:PEMBAYARAN')
                  return (
                    <div>
                      <label htmlFor="param-pbpd-pembayaran" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Skema Pembayaran (PBPD:PEMBAYARAN)
                      </label>
                      <select
                        id="param-pbpd-pembayaran"
                        value={paramValues['PBPD:PEMBAYARAN'] || ''}
                        onChange={(e) => handleParamChange('PBPD:PEMBAYARAN', e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring cursor-pointer"
                      >
                        <option value="">-- Pilih Skema --</option>
                        {pBayar?.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt === 'TUNAI' ? 'TUNAI (Dibeli Vendor Pelaksana)' : opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })()}
              </div>

              {/* 6 Rows of Rentang Daya + Pasang + Bongkar */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Daftar Transaksi Per Rentang Daya (Baris 1–6)
                </span>

                {[1, 2, 3, 4, 5, 6].map((i) => {
                  const rentangName = `PBPD:RENTANG_${i}`
                  const psgName = `PBPD:PSG_${i}`
                  const bkrName = `PBPD:BKR_${i}`

                  const pRentang = bom.parameters?.find((p) => p.name === rentangName)

                  return (
                    <div
                      key={i}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          Baris {i}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                        {/* Rentang Dropdown */}
                        <div className="sm:col-span-6">
                          <label htmlFor={`param-${rentangName}`} className="block text-[10px] text-slate-500 mb-0.5">Rentang Daya</label>
                          <select
                            id={`param-${rentangName}`}
                            value={paramValues[rentangName] || ''}
                            onChange={(e) => handleParamChange(rentangName, e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus-ring cursor-pointer"
                          >
                            <option value="">(Kosong / Tidak Ada)</option>
                            {pRentang?.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Pasang (psg) */}
                        <div className="sm:col-span-3">
                          <label htmlFor={`param-${psgName}`} className="block text-[10px] text-slate-500 mb-0.5">Pasang</label>
                          <input
                            id={`param-${psgName}`}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={paramValues[psgName] ?? ''}
                            onChange={(e) => handleParamChange(psgName, e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-center focus-ring"
                          />
                        </div>

                        {/* Bongkar (bkr) */}
                        <div className="sm:col-span-3">
                          <label htmlFor={`param-${bkrName}`} className="block text-[10px] text-slate-500 mb-0.5">Bongkar</label>
                          <input
                            id={`param-${bkrName}`}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={paramValues[bkrName] ?? ''}
                            onChange={(e) => handleParamChange(bkrName, e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-center focus-ring"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Other parameters if any */}
              {bom.parameters?.filter(
                (p) =>
                  !p.name.startsWith('PBPD:RENTANG_') &&
                  !p.name.startsWith('PBPD:PSG_') &&
                  !p.name.startsWith('PBPD:BKR_') &&
                  p.name !== 'PBPD:JENIS' &&
                  p.name !== 'PBPD:PEMBAYARAN'
              ).map((p) => {
                const isText = (p.type ?? 'number') === 'text'
                return (
                  <div key={p.name} className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label htmlFor={`param-${p.name}`} className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {p.name} {p.description ? `(${p.description})` : ''}
                    </label>
                    {isText ? (
                      <select
                        id={`param-${p.name}`}
                        value={paramValues[p.name] || ''}
                        onChange={(e) => handleParamChange(p.name, e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring cursor-pointer"
                      >
                        <option value="">-- Pilih --</option>
                        {p.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`param-${p.name}`}
                        type="number"
                        min="0"
                        value={paramValues[p.name] ?? ''}
                        onChange={(e) => handleParamChange(p.name, e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-ring"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* NON-PBPD FORM: Construction Types + Parameters */
            <div className="space-y-5">
              {/* Parameter Box */}
              {Array.isArray(bom.parameters) && bom.parameters.length > 0 && (
                <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-3">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
                    Parameter Kelompok ({bom.parameters.length})
                  </h3>
                  <div className="space-y-3">
                    {bom.parameters.map((p) => (
                      <div key={p.name}>
                        <label htmlFor={`param-${p.name}`} className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          {p.name} {p.description ? `(${p.description})` : ''}
                        </label>
                        <input
                          id={`param-${p.name}`}
                          type="number"
                          min="0"
                          value={paramValues[p.name] ?? ''}
                          onChange={(e) => handleParamChange(p.name, e.target.value)}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-ring"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Construction Types Table */}
              <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
                    Volume Jenis Konstruksi ({constructions.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">Kosongkan jika 0</span>
                </div>

                {constructions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Tidak ada jenis konstruksi terdaftar untuk kelompok {bom.group}.
                  </p>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 pr-1">
                    {constructions.map((c) => {
                      const inp = constructionInputs[c.code] || {}
                      return (
                        <div key={c.code} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0 pr-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate" title={c.name || c.code}>
                              {c.name || c.code}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <div>
                              <label htmlFor={`psg-${c.code}`} className="sr-only">Pasang {c.name || c.code}</label>
                              <input
                                id={`psg-${c.code}`}
                                type="number"
                                min="0"
                                placeholder="Psg"
                                title={`Pasang ${c.name || c.code}`}
                                value={inp.psg ?? ''}
                                onChange={(e) => handleConstructionChange(c.code, 'psg', e.target.value)}
                                className="w-16 px-2 py-1 text-xs text-center font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus-ring"
                              />
                            </div>
                            <div>
                              <label htmlFor={`bkr-${c.code}`} className="sr-only">Bongkar {c.name || c.code}</label>
                              <input
                                id={`bkr-${c.code}`}
                                type="number"
                                min="0"
                                placeholder="Bkr"
                                title={`Bongkar ${c.name || c.code}`}
                                value={inp.bkr ?? ''}
                                onChange={(e) => handleConstructionChange(c.code, 'bkr', e.target.value)}
                                className="w-16 px-2 py-1 text-xs text-center font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus-ring"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RESULTS COLUMN */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Hasil Perhitungan Kebutuhan Material
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {calcResult
                    ? `Menampilkan ${filteredLines.length} baris aktif dari ${rawLines.length} total formula`
                    : 'Jalankan perhitungan untuk melihat hasil formula workbook'}
                </p>
              </div>

              {calcResult && (
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={hideZero}
                    onChange={(e) => setHideZero(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Sembunyikan baris bernilai nol</span>
                </label>
              )}
            </div>

            {calculating ? (
              <div className="p-16 text-center">
                <Spinner label="Mengevaluasi formula workbook BOM..." />
              </div>
            ) : !calcResult ? (
              <EmptyState
                icon={IconLayers}
                title="Belum ada hasil kalkulasi"
                description="Isi parameter atau jenis konstruksi di sebelah kiri lalu klik tombol 'Jalankan Perhitungan'."
              />
            ) : filteredLines.length === 0 ? (
              <EmptyState
                icon={IconLayers}
                title="Tidak ada baris kebutuhan"
                description="Tidak ada baris dengan kuantitas > 0 untuk masukan parameter ini."
                action={
                  hideZero ? (
                    <button
                      type="button"
                      onClick={() => setHideZero(false)}
                      className="text-xs text-blue-600 dark:text-blue-400 font-semibold underline cursor-pointer"
                    >
                      Tampilkan semua baris nol
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10">
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-2.5 text-center w-12">No.</th>
                      <th className="py-2.5 px-3 w-40">Kode KHS</th>
                      <th className="py-2.5 px-3 min-w-[200px]">Uraian Material / Jasa</th>
                      <th className="py-2.5 px-2 text-right">Material</th>
                      <th className="py-2.5 px-2 text-right">Pasang</th>
                      <th className="py-2.5 px-2 text-right">Bongkar</th>
                      <th className="py-2.5 px-2 text-right">Retur</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredLines
                      .slice((calcPage - 1) * calcPerPage, calcPage * calcPerPage)
                      .map((l, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400 text-[11px]">
                          {l.sequence}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                          {l.khs_code || <span className="text-slate-400 italic">Non-KHS</span>}
                        </td>
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                          {l.description}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {fmt(l.material)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {fmt(l.install)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {fmt(l.remove)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-purple-600 dark:text-purple-400">
                          {fmt(l.return)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {calcResult && (
              <TableFooter
                itemCount={filteredLines.slice((calcPage - 1) * calcPerPage, calcPage * calcPerPage).length}
                total={filteredLines.length}
                entityLabel="baris hasil kalkulasi BOM"
                page={calcPage}
                perPage={calcPerPage}
                onPage={setCalcPage}
                onPerPage={(n) => {
                  setCalcPerPage(n)
                  setCalcPage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            )}

            {/* Helper Text for Rounding Truncation */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              💡 <em>Catatan:</em> Pembulatan mengikuti perilaku workbook (dipotong ke bawah / TRUNC per baris). Nilai kuantitas dihitung murni di server dan tidak disimpan ke database.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
