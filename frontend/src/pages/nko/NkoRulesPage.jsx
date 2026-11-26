import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { nkoApi } from '../../services/api.js'
import NkoWorkbookTab from './NkoWorkbookTab.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import {
  IconAlertCircle,
  IconChart,
  IconCheckCircle,
  IconRefresh,
  IconX,
} from '../../components/icons.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const MODE_LABELS = {
  SISTEM_BOLEH_KOREKSI: {
    label: 'SISTEM_BOLEH_KOREKSI',
    desc: 'Nilai sistem otomatis; boleh dikoreksi manual dengan alasan',
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  SISTEM: {
    label: 'SISTEM',
    desc: 'Nilai sistem otomatis; masukan manual ditolak',
    cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  },
  MANUAL: {
    label: 'MANUAL',
    desc: 'Diisi manual tanpa rumus sistem',
    cls: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
}

const PROPOSAL_STATUS_CLS = {
  MENUNGGU: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  DISETUJUI: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  DITOLAK: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  DIBATALKAN: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
}

const fmt = (v, digits = 2) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtDate = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(d)
  }
}

function ModeBadge({ mode }) {
  if (!mode) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        Tanpa Aturan (Manual)
      </span>
    )
  }
  const info = MODE_LABELS[mode] || { label: mode, cls: 'bg-slate-100 text-slate-700 border-slate-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${info.cls}`} title={info.desc}>
      {info.label}
    </span>
  )
}

/** Modal Penyusun Rumus, Pratinjau Workbook, dan Pengajuan Usulan Aturan */
function RuleProposalModal({ isOpen, onClose, initialData, catalog, year, month, onSubmitted }) {
  const { notify } = useNotifications()
  const [definitionCode, setDefinitionCode] = useState('')
  const [definitionName, setDefinitionName] = useState('')
  const [mode, setMode] = useState('SISTEM_BOLEH_KOREKSI')
  const [formula, setFormula] = useState('')
  const [inputs, setInputs] = useState([])
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [replacesCode, setReplacesCode] = useState('')
  const [isValidated, setIsValidated] = useState(false)
  const [flagWhenNegative, setFlagWhenNegative] = useState(false)
  const [reason, setReason] = useState('')

  const [previewToMonth, setPreviewToMonth] = useState(month)
  const [previewState, setPreviewState] = useState({ loading: false, error: '', data: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!isOpen || !initialData) return
    const padMonth = String(month).padStart(2, '0')
    setDefinitionCode(initialData.definition_code || '')
    setDefinitionName(initialData.name || initialData.definition_code || '')
    setMode(initialData.mode || 'SISTEM_BOLEH_KOREKSI')
    setFormula(initialData.formula || '')
    setInputs(Array.isArray(initialData.inputs) ? initialData.inputs.map((x) => ({ ...x })) : [])
    setEffectiveFrom(
      initialData.effective_from && initialData.effective_from !== '2000-01'
        ? initialData.effective_from
        : `${year}-${padMonth}`,
    )
    setReplacesCode(initialData.replaces_code || '')
    setIsValidated(Boolean(initialData.is_validated))
    setFlagWhenNegative(Boolean(initialData.flag_when_negative))
    setReason('')
    setPreviewToMonth(month)
    setPreviewState({ loading: false, error: '', data: null })
    setSubmitError('')
  }, [isOpen, initialData, year, month])

  if (!isOpen) return null

  const insertToken = (token) => {
    setFormula((prev) => (prev ? `${prev} ${token}` : token))
  }

  const addInputRow = () => {
    setInputs((prev) => [...prev, { code: '', name: '', unit_label: '' }])
  }

  const updateInputRow = (idx, field, val) => {
    setInputs((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row)))
  }

  const removeInputRow = (idx) => {
    setInputs((prev) => prev.filter((_, i) => i !== idx))
  }

  const handlePreview = async () => {
    if (!formula.trim()) {
      setPreviewState({ loading: false, error: 'Masukkan rumus terlebih dahulu untuk pratinjau.', data: null })
      return
    }
    setPreviewState({ loading: true, error: '', data: null })
    try {
      const res = await nkoApi.previewRule({
        definition_code: definitionCode,
        formula: formula.trim(),
        inputs: inputs.filter((i) => i.code.trim() || i.name.trim()),
        year,
        to_month: Number(previewToMonth) || month,
      })
      setPreviewState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setPreviewState({ loading: false, error: err?.message || 'Gagal menjalankan pratinjau rumus.', data: null })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError('')
    if (!reason.trim()) {
      setSubmitError('Alasan pengajuan wajib diisi.')
      return
    }
    if (mode !== 'MANUAL' && !formula.trim()) {
      setSubmitError('Rumus wajib diisi untuk mode SISTEM atau SISTEM_BOLEH_KOREKSI.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        definition_code: definitionCode,
        mode,
        formula: mode === 'MANUAL' ? null : formula.trim(),
        inputs: mode === 'MANUAL' ? [] : inputs.filter((i) => i.code.trim() || i.name.trim()),
        effective_from: effectiveFrom,
        is_validated: mode === 'MANUAL' ? false : isValidated,
        flag_when_negative: mode === 'MANUAL' ? false : flagWhenNegative,
        replaces_code: replacesCode.trim() || null,
        reason: reason.trim(),
      }
      const res = await nkoApi.proposeRule(payload)
      notify({
        type: 'success',
        title: 'Usulan Aturan Diajukan',
        desc: res?.message || 'Usulan tersimpan dan menunggu persetujuan ASMAN_PERENCANAAN.',
        tag: 'NKO',
      })
      onSubmitted?.()
      onClose()
    } catch (err) {
      setSubmitError(err?.message || 'Gagal mengajukan usulan aturan.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Usulkan Aturan Realisasi NKO
            </h2>
            <p className="text-xs text-slate-500">
              Indikator: <strong className="text-slate-700 dark:text-slate-300">{definitionName}</strong>{' '}
              (<code className="font-mono">{definitionCode}</code>)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal usulan"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <IconX size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Mode Realisasi</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                aria-label="Mode Realisasi"
                className={`${filterSelectCls} w-full`}
              >
                {(catalog?.modes || ['SISTEM_BOLEH_KOREKSI', 'SISTEM', 'MANUAL']).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Berlaku Mulai (YYYY-MM)</span>
              <input
                type="month"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                aria-label="Berlaku Mulai"
                required
                className={`${filterControlCls} w-full font-mono`}
              />
            </label>

            <label className="block text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Menggantikan Kode Lama (Opsional)</span>
              <input
                type="text"
                value={replacesCode}
                onChange={(e) => setReplacesCode(e.target.value)}
                placeholder="mis. kode-indikator-lama"
                aria-label="Menggantikan Kode Lama"
                className={`${filterControlCls} w-full font-mono`}
              />
            </label>
          </div>

          {mode !== 'MANUAL' && (
            <>
              {/* Katalog Besaran & Fungsi */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Katalog Besaran (klik untuk sisipkan ke rumus)
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {(catalog?.quantities || []).map((q) => (
                      <button
                        key={q.name}
                        type="button"
                        onClick={() => insertToken(q.name)}
                        title={`${q.label} (${q.unit_label || '-'}, UP3: ${q.up3_aggregation})`}
                        className="px-2 py-1 rounded-lg text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer transition"
                      >
                        {q.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                  <span className="text-[11px] font-semibold text-slate-500">Fungsi & Operator:</span>
                  {(catalog?.functions || []).map((fn) => (
                    <button
                      key={fn.name}
                      type="button"
                      onClick={() => insertToken(fn.name === 'atau' ? 'atau(, 0)' : `${fn.name}()`)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer"
                    >
                      {fn.name}()
                    </button>
                  ))}
                  {(catalog?.operators || ['+', '-', '*', '/', '(', ')']).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => insertToken(op)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
                    >
                      {op}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor Rumus */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Rumus Realisasi (maksimal 500 karakter)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  placeholder="Contoh: (kwh_jual - kwh_jual_tahun_lalu) / 1000000"
                  aria-label="Rumus Realisasi"
                  className={`${filterControlCls} w-full font-mono text-xs py-2`}
                />
              </div>

              {/* Masukan Manual Baru (Opsional) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Masukan Manual Pembantu Baru (Opsional)
                  </span>
                  <Button type="button" variant="secondary" size="sm" onClick={addInputRow}>
                    + Tambah Masukan
                  </Button>
                </div>
                {inputs.map((inp, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      value={inp.code}
                      onChange={(e) => updateInputRow(idx, 'code', e.target.value)}
                      placeholder="kode_masukan"
                      className={`${filterControlCls} sm:col-span-4 font-mono text-xs`}
                    />
                    <input
                      type="text"
                      value={inp.name}
                      onChange={(e) => updateInputRow(idx, 'name', e.target.value)}
                      placeholder="Nama tampilan"
                      className={`${filterControlCls} sm:col-span-5 text-xs`}
                    />
                    <input
                      type="text"
                      value={inp.unit_label || ''}
                      onChange={(e) => updateInputRow(idx, 'unit_label', e.target.value)}
                      placeholder="Satuan"
                      className={`${filterControlCls} sm:col-span-2 text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => removeInputRow(idx)}
                      className="sm:col-span-1 text-rose-600 hover:text-rose-700 text-xs font-semibold py-1"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>

              {/* Opsi Validasi & Penanda Negatif */}
              <div className="flex flex-wrap gap-5 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isValidated}
                    onChange={(e) => setIsValidated(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Sudah tervalidasi terhadap workbook (`is_validated`)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagWhenNegative}
                    onChange={(e) => setFlagWhenNegative(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Tandai NEGATIF bila bernilai minus (`flag_when_negative`)</span>
                </label>
              </div>

              {/* Pratinjau Banding Workbook */}
              <div className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                      Pratinjau Banding Workbook ({year})
                    </div>
                    <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80">
                      Membandingkan hasil rumus usulan dengan aturan saat ini dan angka acuan workbook (memerlukan 4–15 detik).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={previewToMonth}
                      onChange={(e) => setPreviewToMonth(Number(e.target.value))}
                      aria-label="Sampai bulan pratinjau"
                      className={`${filterSelectCls} text-xs`}
                    >
                      {MONTH_NAMES.map((m, idx) => (
                        <option key={idx + 1} value={idx + 1}>s/d {m}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={previewState.loading}
                      onClick={handlePreview}
                    >
                      Pratinjau Banding Workbook
                    </Button>
                  </div>
                </div>

                {previewState.loading && (
                  <div className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300 py-2">
                    <Spinner size="sm" />
                    <span>Menghitung pratinjau terhadap workbook (4–15 detik)...</span>
                  </div>
                )}

                {previewState.error && <Alert kind="error">{previewState.error}</Alert>}

                {previewState.data && (
                  <div className="space-y-2">
                    {previewState.data.summary && (
                      <div className="flex flex-wrap gap-3 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        <span>Terisi: {previewState.data.summary.with_value ?? 0}</span>
                        <span>Dibandingkan: {previewState.data.summary.compared ?? 0}</span>
                        <span className="text-emerald-700 dark:text-emerald-300">
                          Cocok: {previewState.data.summary.matched ?? 0} (toleransi {previewState.data.summary.tolerance_pct ?? 0.5}%)
                        </span>
                      </div>
                    )}
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-1.5 px-2.5">Unit</th>
                            <th className="py-1.5 px-2.5 text-center">Bulan</th>
                            <th className="py-1.5 px-2.5 text-right">Usulan</th>
                            <th className="py-1.5 px-2.5 text-right">Saat Ini</th>
                            <th className="py-1.5 px-2.5 text-right">Acuan Workbook</th>
                            <th className="py-1.5 px-2.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {(previewState.data.rows || []).map((r, i) => (
                            <tr key={`${r.unit_id}-${r.month}-${i}`}>
                              <td className="py-1.5 px-2.5 font-medium text-slate-800 dark:text-slate-200">
                                {r.unit_name} <span className="text-[10px] text-slate-400">({r.unit_type})</span>
                              </td>
                              <td className="py-1.5 px-2.5 text-center font-mono">{r.month}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono">{fmt(r.proposed)}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono text-slate-500">{fmt(r.current)}</td>
                              <td className="py-1.5 px-2.5 text-right font-mono">{fmt(r.reference)}</td>
                              <td className="py-1.5 px-2.5 text-center">
                                {r.matches === true ? (
                                  <span className="text-emerald-600 font-bold">Cocok</span>
                                ) : r.matches === false ? (
                                  <span className="text-rose-600 font-bold">Beda</span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Alasan Usulan */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Alasan Pengajuan <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={2}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan alasan perubahan aturan atau penyesuaian rumus..."
              aria-label="Alasan Pengajuan"
              className={`${filterControlCls} w-full text-xs py-2`}
            />
          </div>

          {submitError && <Alert kind="error">{submitError}</Alert>}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              Ajukan Usulan
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Modal Keputusan Persetujuan / Penolakan Usulan */
function DecisionModal({ proposal, mode, onClose, onDecided }) {
  const { notify } = useNotifications()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setNote('')
    setError('')
  }, [proposal, mode])

  if (!proposal) return null

  const isReject = mode === 'reject'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isReject && !note.trim()) {
      setError('Alasan penolakan wajib diisi.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await nkoApi.decideRuleProposal(proposal.id, {
        decision: mode,
        note: note.trim() || null,
      })
      notify({
        type: 'success',
        title: isReject ? 'Usulan Ditolak' : 'Usulan Disetujui',
        desc: res?.message || (isReject ? 'Usulan berhasil ditolak.' : 'Usulan disetujui dan aturan berlaku.'),
        tag: 'NKO',
      })
      onDecided?.()
      onClose()
    } catch (err) {
      setError(err?.message || 'Gagal memproses keputusan usulan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {isReject ? 'Tolak Usulan Aturan NKO' : 'Setujui Usulan Aturan NKO'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <IconX size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <p>
              Indikator: <strong>{proposal.definition_name || proposal.definition_code}</strong>
            </p>
            <p>
              Mode: <strong>{proposal.mode}</strong> | Berlaku mulai: <span className="font-mono">{proposal.effective_from}</span>
            </p>
            {proposal.formula && (
              <p className="font-mono text-[11px] bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                {proposal.formula}
              </p>
            )}
          </div>

          <label className="block text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              {isReject ? 'Alasan Penolakan (Wajib)' : 'Catatan Persetujuan (Opsional)'}
              {isReject && <span className="text-rose-600"> *</span>}
            </span>
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isReject ? 'Jelaskan alasan penolakan usulan...' : 'Catatan tambahan (opsional)...'}
              aria-label="Catatan Keputusan"
              className={`${filterControlCls} w-full text-xs py-2`}
            />
          </label>

          {error && <Alert kind="error">{error}</Alert>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" variant={isReject ? 'danger' : 'primary'} loading={saving}>
              {isReject ? 'Tolak Usulan' : 'Setujui Usulan'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function NkoRulesPage() {
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()

  const canPropose = Boolean(can?.['nko.rules.propose'])
  const canApprove = Boolean(can?.['nko.rules.approve'])

  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [tab, setTab] = useState('rules') // 'rules' | 'proposals' | 'changes' | 'workbooks'

  const [rulesState, setRulesState] = useState({ loading: true, error: '', data: null })
  const [catalogState, setCatalogState] = useState({ loading: false, data: null })
  const [mappingState, setMappingState] = useState({ loading: false, error: '', data: null })
  const [proposalsState, setProposalsState] = useState({ loading: false, error: '', data: [] })
  const [setsState, setSetsState] = useState({ loading: false, error: '', data: [] })
  const [uploadsState, setUploadsState] = useState({ loading: false, error: '', data: [] })

  const [ruleFilter, setRuleFilter] = useState('ALL') // 'ALL' | 'WITH_RULE' | 'NO_RULE'
  const [searchQuery, setSearchQuery] = useState('')
  const [proposalStatusFilter, setProposalStatusFilter] = useState('')
  const [uploadStatusFilter, setUploadStatusFilter] = useState('')

  const [proposalModal, setProposalModal] = useState({ isOpen: false, initialData: null })
  const [decisionModal, setDecisionModal] = useState({ proposal: null, mode: 'approve' })

  const loadRules = useCallback(async () => {
    setRulesState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.rules({ year, month })
      setRulesState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setRulesState({ loading: false, error: err?.message || 'Gagal memuat daftar aturan NKO.', data: null })
    }
  }, [year, month])

  const loadCatalog = useCallback(async () => {
    setCatalogState((s) => ({ ...s, loading: true }))
    try {
      const res = await nkoApi.rulesCatalog()
      setCatalogState({ loading: false, data: res?.data || null })
    } catch {
      setCatalogState((s) => ({ ...s, loading: false }))
    }
  }, [])

  const loadMapping = useCallback(async () => {
    setMappingState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.rulesMapping({ year })
      setMappingState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setMappingState({ loading: false, error: err?.message || 'Gagal memeriksa pencocokan definisi.', data: null })
    }
  }, [year])

  const loadProposals = useCallback(async () => {
    setProposalsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.ruleProposals(proposalStatusFilter ? { status: proposalStatusFilter } : {})
      setProposalsState({ loading: false, error: '', data: res?.data || [] })
    } catch (err) {
      setProposalsState({ loading: false, error: err?.message || 'Gagal memuat daftar usulan.', data: [] })
    }
  }, [proposalStatusFilter])

  const loadSets = useCallback(async () => {
    setSetsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.definitionSets({ year })
      setSetsState({ loading: false, error: '', data: res?.data || [] })
    } catch (err) {
      setSetsState({ loading: false, error: err?.message || 'Gagal memuat versi workbook.', data: [] })
    }
  }, [year])

  const loadUploads = useCallback(async () => {
    setUploadsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.definitionUploads(uploadStatusFilter ? { status: uploadStatusFilter } : {})
      setUploadsState({ loading: false, error: '', data: res?.data || [] })
    } catch (err) {
      setUploadsState({ loading: false, error: err?.message || 'Gagal memuat daftar unggahan.', data: [] })
    }
  }, [uploadStatusFilter])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    loadRules()
    loadMapping()
    loadSets()
  }, [loadRules, loadMapping, loadSets])

  useEffect(() => {
    loadProposals()
  }, [loadProposals])

  useEffect(() => {
    loadUploads()
  }, [loadUploads])

  const filteredItems = useMemo(() => {
    const items = rulesState.data?.items || []
    const q = searchQuery.trim().toLowerCase()
    return items.filter((it) => {
      if (ruleFilter === 'WITH_RULE' && !it.has_rule) return false
      if (ruleFilter === 'NO_RULE' && it.has_rule) return false
      if (q) {
        const hay = `${it.name || ''} ${it.definition_code || ''} ${it.formula || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rulesState.data, ruleFilter, searchQuery])

  const pendingProposalsCount = useMemo(
    () => (proposalsState.data || []).filter((p) => p.status === 'MENUNGGU').length,
    [proposalsState.data],
  )

  const pendingUploadsCount = useMemo(
    () => (uploadsState.data || []).filter((u) => u.status === 'MENUNGGU').length,
    [uploadsState.data],
  )

  const handleCancelProposal = async (proposalId) => {
    try {
      const res = await nkoApi.cancelRuleProposal(proposalId)
      notify({
        type: 'success',
        title: 'Usulan Dibatalkan',
        desc: res?.message || 'Usulan berhasil dibatalkan.',
        tag: 'NKO',
      })
      loadProposals()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Membatalkan',
        desc: err?.message || 'Tidak dapat membatalkan usulan.',
        tag: 'NKO',
      })
    }
  }

  const orphaned = mappingState.data?.orphaned || []
  const unmapped = mappingState.data?.unmapped || []

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
              <IconChart size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Pengaturan Aturan Realisasi NKO
                </h1>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Tanpa Ubah Kode
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Kelola rumus realisasi indikator NKO, pratinjau perbandingan terhadap workbook, dan persetujuan berjenjang (PERENCANAAN mengusulkan, ASMAN_PERENCANAAN memutus).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/nko"
              className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              Kembali ke NKO
            </Link>
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={() => {
                loadRules()
                loadMapping()
                loadProposals()
                loadSets()
                loadUploads()
              }}
            >
              Segarkan
            </Button>
          </div>
        </div>
      </div>

      {/* Period Filter */}
      <div className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <span>Tahun</span>
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Tahun Aturan"
            className={`${filterControlCls} w-24 tabular-nums`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <span>Bulan</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            aria-label="Bulan Aturan"
            className={filterSelectCls}
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={idx + 1} value={idx + 1}>{m}</option>
            ))}
          </select>
        </label>
        <div className="text-xs text-slate-500 ml-auto">
          Menampilkan aturan berlaku untuk periode <strong>{MONTH_NAMES[month - 1]} {year}</strong>
        </div>
      </div>

      {/* Peringatan Pencocokan Definisi (Orphaned / Item Berganti Nama) */}
      {orphaned.length > 0 && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <IconAlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Peringatan Item Berganti Nama / Aturan Tanpa Item ({orphaned.length})
              </h2>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Aturan berikut menunjuk kode indikator yang tidak ditemukan pada definisi aktif tahun {year}. Pilih saran pengganti untuk menyalin masukan manual dan memindahkan target menu pengusahaan.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {orphaned.map((o) => (
              <div
                key={o.code}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {o.name || o.code} <code className="font-mono text-[11px] text-slate-500">({o.code})</code>
                  </div>
                  {o.formula && (
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      Rumus lama: {o.formula}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500">
                    Masukan manual tersimpan: <strong>{o.manual_inputs ?? 0}</strong>
                    {o.linked_menus?.length > 0 && (
                      <> | Menu terkait: <strong>{o.linked_menus.join(', ')}</strong></>
                    )}
                  </div>
                </div>

                {o.suggestions?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {o.suggestions.map((sug) => (
                      <Button
                        key={sug.code}
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canPropose}
                        onClick={() =>
                          setProposalModal({
                            isOpen: true,
                            initialData: {
                              definition_code: sug.code,
                              name: sug.name,
                              formula: o.formula || '',
                              replaces_code: o.code,
                              mode: 'SISTEM_BOLEH_KOREKSI',
                            },
                          })
                        }
                      >
                        Pakai: {sug.name} ({Math.round((sug.score || 0) * 100)}%)
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Pengaturan Aturan NKO" className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rules'}
          onClick={() => setTab('rules')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
            tab === 'rules'
              ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Daftar Aturan & Indikator ({rulesState.data?.items?.length ?? 0})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proposals'}
          onClick={() => setTab('proposals')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
            tab === 'proposals'
              ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>Daftar Usulan</span>
          {pendingProposalsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              {pendingProposalsCount}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'changes'}
          onClick={() => setTab('changes')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
            tab === 'changes'
              ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>Perubahan Item</span>
          {(orphaned.length + unmapped.length) > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              {orphaned.length + unmapped.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workbooks'}
          onClick={() => setTab('workbooks')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
            tab === 'workbooks'
              ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>Versi Workbook</span>
          {pendingUploadsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              {pendingUploadsCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab: Perubahan Item (hasil rules/mapping) */}
      {tab === 'changes' && (
        <div className="space-y-6">
          <div className={`${CARD} p-5 space-y-4`}>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Item Baru Tanpa Aturan Realisasi ({unmapped.length})
              </h3>
              <p className="text-xs text-slate-500">
                Indikator yang membutuhkan realisasi pada definisi aktif tahun {year}, namun belum memiliki aturan rumus (saat ini diisi manual).
              </p>
            </div>
            {mappingState.loading ? (
              <div className="py-10 flex justify-center"><Spinner size="md" label="Memeriksa pencocokan item..." /></div>
            ) : mappingState.error ? (
              <Alert kind="error">{mappingState.error}</Alert>
            ) : unmapped.length === 0 ? (
              <EmptyState title="Semua Item Sudah Memiliki Aturan" desc="Tidak ada indikator aktif tanpa aturan realisasi." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Indikator</th>
                      <th className="py-2.5 px-3">Kode</th>
                      <th className="py-2.5 px-3">Tingkat</th>
                      {canPropose && <th className="py-2.5 px-3 text-right">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {unmapped.map((item) => (
                      <tr key={item.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">{item.name}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{item.code}</td>
                        <td className="py-2.5 px-3 text-[11px]">{(item.levels || []).join(', ') || '-'}</td>
                        {canPropose && (
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setProposalModal({
                                  isOpen: true,
                                  initialData: {
                                    definition_code: item.code,
                                    name: item.name,
                                    mode: 'SISTEM_BOLEH_KOREKSI',
                                  },
                                })
                              }
                            >
                              Usulkan Aturan
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={`${CARD} p-5 space-y-4`}>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Aturan Tanpa Item / Kemungkinan Berganti Nama ({orphaned.length})
              </h3>
              <p className="text-xs text-slate-500">
                Aturan lama yang kodenya tidak lagi ditemukan pada definisi aktif tahun {year}. Gunakan saran untuk memindahkan rumus dan menyalin masukan manual.
              </p>
            </div>
            {orphaned.length === 0 ? (
              <EmptyState title="Tidak Ada Aturan Tanpa Item" desc="Seluruh aturan aktif cocok dengan definisi indikator tahun ini." />
            ) : (
              <div className="space-y-2">
                {orphaned.map((o) => (
                  <div
                    key={o.code}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {o.name || o.code} <code className="font-mono text-[11px] text-slate-500">({o.code})</code>
                      </div>
                      {o.formula && <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">Rumus lama: {o.formula}</div>}
                    </div>
                    {o.suggestions?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {o.suggestions.map((sug) => (
                          <Button
                            key={sug.code}
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!canPropose}
                            onClick={() =>
                              setProposalModal({
                                isOpen: true,
                                initialData: {
                                  definition_code: sug.code,
                                  name: sug.name,
                                  formula: o.formula || '',
                                  replaces_code: o.code,
                                  mode: 'SISTEM_BOLEH_KOREKSI',
                                },
                              })
                            }
                          >
                            Usulkan Pengganti: {sug.name} ({Math.round((sug.score || 0) * 100)}%)
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Versi Workbook */}
      {tab === 'workbooks' && (
        <NkoWorkbookTab
          year={year}
          canPropose={canPropose}
          canApprove={canApprove}
          currentUserId={user?.id}
          setsState={setsState}
          uploadsState={uploadsState}
          uploadStatusFilter={uploadStatusFilter}
          onUploadStatusFilterChange={setUploadStatusFilter}
          onRefresh={() => {
            loadSets()
            loadUploads()
          }}
          onApproved={(mappingData) => {
            if (mappingData) {
              setMappingState({ loading: false, error: '', data: mappingData })
            } else {
              loadMapping()
            }
            loadRules()
            loadSets()
            loadUploads()
            setTab('changes')
          }}
        />
      )}

      {/* Tab 1: Daftar Aturan */}
      {tab === 'rules' && (
        <div className={`${CARD} p-5 space-y-4`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                ['ALL', 'Semua'],
                ['WITH_RULE', 'Sudah Ada Aturan'],
                ['NO_RULE', `Tanpa Aturan (${unmapped.length})`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRuleFilter(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    ruleFilter === id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, kode, atau rumus..."
              aria-label="Cari aturan indikator"
              className={`${filterControlCls} w-full sm:w-64 text-xs`}
            />
          </div>

          {rulesState.loading ? (
            <div className="py-16 flex justify-center">
              <Spinner size="lg" label="Memuat daftar aturan NKO..." />
            </div>
          ) : rulesState.error ? (
            <Alert kind="error">{rulesState.error}</Alert>
          ) : filteredItems.length === 0 ? (
            <EmptyState title="Tidak Ada Indikator" desc="Tidak ditemukan indikator yang sesuai dengan filter." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Indikator</th>
                    <th className="py-2.5 px-3">Mode</th>
                    <th className="py-2.5 px-3">Rumus & Masukan</th>
                    <th className="py-2.5 px-3 text-center">Berlaku</th>
                    <th className="py-2.5 px-3 text-center">Validasi</th>
                    {canPropose && <th className="py-2.5 px-3 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredItems.map((it) => (
                    <tr key={it.definition_code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{it.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {it.definition_code}
                          {it.unit_label ? ` • ${it.unit_label}` : ''}
                          {it.levels?.length ? ` • ${it.levels.join(', ')}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <ModeBadge mode={it.mode} />
                      </td>
                      <td className="py-2.5 px-3">
                        {it.formula ? (
                          <code className="text-[11px] font-mono text-slate-800 dark:text-slate-200 break-all">
                            {it.formula}
                          </code>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                        {it.inputs?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {it.inputs.map((inp) => (
                              <span
                                key={inp.code}
                                className="px-1.5 py-0.2 rounded text-[10px] bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                              >
                                +{inp.code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {it.effective_from || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {it.has_rule ? (
                          <div className="flex flex-col items-center gap-1">
                            {it.is_validated ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                <IconCheckCircle size={12} /> Tervalidasi
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                Belum Valid
                              </span>
                            )}
                            {it.flag_when_negative && (
                              <span className="text-[10px] px-1 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                                Tandai Minus
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      {canPropose && (
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setProposalModal({ isOpen: true, initialData: it })}
                          >
                            {it.has_rule ? 'Usulkan Ubah' : 'Buat Aturan'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Daftar Usulan */}
      {tab === 'proposals' && (
        <div className={`${CARD} p-5 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Riwayat & Antrean Usulan Perubahan Aturan
            </h3>
            <select
              value={proposalStatusFilter}
              onChange={(e) => setProposalStatusFilter(e.target.value)}
              aria-label="Filter Status Usulan"
              className={filterSelectCls}
            >
              <option value="">Semua Status</option>
              <option value="MENUNGGU">MENUNGGU</option>
              <option value="DISETUJUI">DISETUJUI</option>
              <option value="DITOLAK">DITOLAK</option>
              <option value="DIBATALKAN">DIBATALKAN</option>
            </select>
          </div>

          {proposalsState.loading ? (
            <div className="py-16 flex justify-center">
              <Spinner size="lg" label="Memuat daftar usulan..." />
            </div>
          ) : proposalsState.error ? (
            <Alert kind="error">{proposalsState.error}</Alert>
          ) : proposalsState.data.length === 0 ? (
            <EmptyState title="Belum Ada Usulan" desc="Belum ada usulan perubahan aturan NKO." />
          ) : (
            <div className="space-y-3">
              {proposalsState.data.map((p) => {
                const isOwn = Boolean(user?.id && p.proposed_by?.id === user.id)
                const isPending = p.status === 'MENUNGGU'

                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {p.definition_name || p.definition_code}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              PROPOSAL_STATUS_CLS[p.status] || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {p.status}
                          </span>
                          <ModeBadge mode={p.mode} />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Kode: <code className="font-mono">{p.definition_code}</code> • Berlaku mulai:{' '}
                          <span className="font-mono">{p.effective_from}</span>
                          {p.replaces_code && (
                            <> • Menggantikan: <code className="font-mono">{p.replaces_code}</code></>
                          )}
                        </div>
                      </div>

                      {isPending && (
                        <div className="flex flex-wrap items-center gap-2">
                          {canPropose && isOwn && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelProposal(p.id)}
                            >
                              Batalkan
                            </Button>
                          )}
                          {canApprove && !isOwn && (
                            <>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={() => setDecisionModal({ proposal: p, mode: 'approve' })}
                              >
                                Setujui
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => setDecisionModal({ proposal: p, mode: 'reject' })}
                              >
                                Tolak
                              </Button>
                            </>
                          )}
                          {canApprove && isOwn && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                              Pengusul tidak dapat memutus usulannya sendiri
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {p.formula && (
                      <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-800 dark:text-slate-200">
                        {p.formula}
                      </div>
                    )}

                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">Alasan:</span> {p.reason}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>Diusulkan oleh: <strong>{p.proposed_by?.name || '-'}</strong> ({fmtDate(p.proposed_at)})</span>
                      {p.decided_by && (
                        <span>
                          Diputus oleh: <strong>{p.decided_by.name}</strong> ({fmtDate(p.decided_at)})
                          {p.decision_note ? ` — "${p.decision_note}"` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <RuleProposalModal
        isOpen={proposalModal.isOpen}
        onClose={() => setProposalModal({ isOpen: false, initialData: null })}
        initialData={proposalModal.initialData}
        catalog={catalogState.data}
        year={year}
        month={month}
        onSubmitted={() => {
          loadProposals()
          setTab('proposals')
        }}
      />

      <DecisionModal
        proposal={decisionModal.proposal}
        mode={decisionModal.mode}
        onClose={() => setDecisionModal({ proposal: null, mode: 'approve' })}
        onDecided={() => {
          loadProposals()
          loadRules()
          loadMapping()
        }}
      />
    </div>
  )
}
