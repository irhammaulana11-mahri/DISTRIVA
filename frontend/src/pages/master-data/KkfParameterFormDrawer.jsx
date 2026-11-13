import { useState, useEffect } from 'react'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconCheck, IconRefresh } from '../../components/icons.jsx'
import { kkfParametersApi } from '../../services/api.js'
import {
  fractionToPercent,
  percentToFraction,
  KKF_FIELDS,
  KKF_DEFAULT_FALLBACKS,
} from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'

export default function KkfParameterFormDrawer({
  open,
  asPage = false,
  onClose,
  initialData = null,
  defaults = null,
  onSuccess,
}) {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const isEdit = Boolean(initialData)

  const [name, setName] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [values, setValues] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Populate state on open or initialData change
  useEffect(() => {
    if (!open) return

    setFieldErrors({})
    setError('')
    setSubmitting(false)

    if (initialData) {
      setName(initialData.name || '')
      setValidFrom(initialData.valid_from || '')
      setNotes(initialData.notes || '')
      setReason('')

      const initVals = {}
      KKF_FIELDS.forEach((f) => {
        if (f.type === 'percent') {
          initVals[f.key] = fractionToPercent(initialData[f.key])
        } else {
          initVals[f.key] = initialData[f.key] !== undefined && initialData[f.key] !== null
            ? String(initialData[f.key])
            : ''
        }
      })
      setValues(initVals)
    } else {
      // Create mode: load defaults
      setName('')
      setValidFrom(new Date().toISOString().slice(0, 10))
      setNotes('')
      setReason('')

      const defs = defaults || KKF_DEFAULT_FALLBACKS
      const initVals = {}
      KKF_FIELDS.forEach((f) => {
        if (f.type === 'percent') {
          initVals[f.key] = fractionToPercent(defs[f.key] ?? KKF_DEFAULT_FALLBACKS[f.key])
        } else {
          initVals[f.key] = String(defs[f.key] ?? KKF_DEFAULT_FALLBACKS[f.key] ?? '')
        }
      })
      setValues(initVals)
    }
  }, [open, initialData, defaults])

  const handleValueChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }))
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFieldErrors({})
    setError('')

    if (!name.trim()) {
      setError('Nama set parameter wajib diisi.')
      return
    }
    if (!validFrom) {
      setError('Tanggal mulai berlaku wajib diisi.')
      return
    }

    setSubmitting(true)

    try {
      if (isEdit) {
        // PUT mode: send only changed fields
        const changes = {}

        if (name.trim() !== initialData.name) {
          changes.name = name.trim()
        }
        if (validFrom !== initialData.valid_from) {
          changes.valid_from = validFrom
        }
        const cleanNotes = notes.trim() || null
        const initialNotes = initialData.notes || null
        if (cleanNotes !== initialNotes) {
          changes.notes = cleanNotes
        }

        KKF_FIELDS.forEach((f) => {
          if (f.type === 'percent') {
            const newFrac = percentToFraction(values[f.key])
            const oldFrac = Number(initialData[f.key])
            if (newFrac !== null && Math.abs(newFrac - oldFrac) > 0.000001) {
              changes[f.key] = newFrac
            }
          } else {
            const newVal = values[f.key] === '' ? null : Number(values[f.key])
            const oldVal = initialData[f.key] === undefined || initialData[f.key] === null ? null : Number(initialData[f.key])
            if (newVal !== null && newVal !== oldVal) {
              changes[f.key] = newVal
            }
          }
        })

        if (reason.trim()) {
          changes.reason = reason.trim()
        }

        if (Object.keys(changes).length === 0) {
          setError('Tidak ada perubahan.')
          setSubmitting(false)
          return
        }

        await kkfParametersApi.update(initialData.id, changes)
        notify({
          type: 'success',
          title: 'Draf Diperbarui',
          desc: `Set parameter "${name}" berhasil diperbarui.`,
          tag: 'Parameter KKF',
        })
        onSuccess?.(initialData.id)
        onClose()
      } else {
        // POST mode: create new set
        const payload = {
          name: name.trim(),
          valid_from: validFrom,
        }
        if (notes.trim()) payload.notes = notes.trim()
        if (reason.trim()) payload.reason = reason.trim()

        KKF_FIELDS.forEach((f) => {
          if (f.type === 'percent') {
            const frac = percentToFraction(values[f.key])
            if (frac !== null) payload[f.key] = frac
          } else {
            if (values[f.key] !== '' && values[f.key] !== undefined) {
              payload[f.key] = Number(values[f.key])
            }
          }
        })

        const res = await kkfParametersApi.create(payload)
        notify({
          type: 'success',
          title: 'Draf Parameter Dibuat',
          desc: `Set parameter "${name}" berhasil dibuat dengan status DRAFT.`,
          tag: 'Parameter KKF',
        })
        onSuccess?.(res?.data?.id)
        onClose()
      }
    } catch (err) {
      if (err.status === 422 && err.data?.errors) {
        setFieldErrors(err.data.errors)
        setError(err.message || 'Periksa kembali isian form yang tidak valid.')
      } else {
        setError(err.message || 'Gagal menyimpan set parameter KKF.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      onClose={onClose}
      title={isEdit ? 'Ubah Draf Parameter KKF' : 'Buat Draf Parameter KKF'}
      subtitle={
        isEdit
          ? 'Perbarui nilai parameter finansial pada set draf sebelum diajukan persetujuan.'
          : 'Buat draf set parameter kelayakan keuangan (KKF) baru untuk perhitungan proyek.'
      }
      size="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            type="submit"
            form="kkf-param-form"
            variant="primary"
            disabled={submitting}
          >
            {submitting ? (
              <Spinner size={14} label="Menyimpan..." />
            ) : (
              <>
                <IconCheck size={15} />
                <span>{isEdit ? 'Simpan Perubahan Draf' : 'Buat Draf Parameter'}</span>
              </>
            )}
          </Button>
        </div>
      }
    >
      <form id="kkf-param-form" onSubmit={handleSubmit} className="space-y-6 text-xs">
        {error && <Alert kind="error">{error}</Alert>}

        {/* Section 1: Informasi Set */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-1.5">
            1. Informasi & Masa Berlaku Set
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="kkf-name" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama Set Parameter <span className="text-rose-500">*</span>
              </label>
              <input
                id="kkf-name"
                type="text"
                required
                maxLength={150}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: null }))
                }}
                placeholder="Contoh: Parameter Finansial KKF 2026 (SK GM UID Jatim)"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
              {fieldErrors.name && (
                <p className="text-[11px] text-rose-500 mt-1">{fieldErrors.name[0] || fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label htmlFor="kkf-valid-from" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tanggal Mulai Berlaku <span className="text-rose-500">*</span>
              </label>
              <input
                id="kkf-valid-from"
                type="date"
                required
                value={validFrom}
                onChange={(e) => {
                  setValidFrom(e.target.value)
                  if (fieldErrors.valid_from) setFieldErrors((prev) => ({ ...prev, valid_from: null }))
                }}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
              />
              {fieldErrors.valid_from && (
                <p className="text-[11px] text-rose-500 mt-1">{fieldErrors.valid_from[0] || fieldErrors.valid_from}</p>
              )}
              <p className="text-[11px] text-slate-400 mt-1">Set baru harus berlaku setelah tanggal set aktif.</p>
            </div>

            <div>
              <label htmlFor="kkf-notes" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Catatan / Keterangan (Opsional)
              </label>
              <input
                id="kkf-notes"
                type="text"
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="mis. Acuan penetapan suku bunga & BPP semester 1"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Parameter Finansial & Tarif */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              2. Sembilan Nilai Parameter Kelayakan (KKF)
            </h4>
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
              Tarif dimasukkan dalam persen (%)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {KKF_FIELDS.map((f) => {
              const val = values[f.key] ?? ''
              const err = fieldErrors[f.key]
              return (
                <div key={f.key} className={f.key === 'bpp' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={`kkf-field-${f.key}`} className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {f.label}
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <input
                      id={`kkf-field-${f.key}`}
                      type="text"
                      inputMode="decimal"
                      value={val}
                      onChange={(e) => handleValueChange(f.key, e.target.value)}
                      placeholder={f.type === 'percent' ? 'mis. 7.78' : 'mis. 552'}
                      className={`w-full px-3 py-2 text-xs rounded-xl border ${
                        err
                          ? 'border-rose-400 dark:border-rose-600'
                          : 'border-slate-200 dark:border-slate-700'
                      } bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono`}
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500 text-xs font-semibold">
                      {f.type === 'percent' ? '%' : f.unit || ''}
                    </div>
                  </div>
                  {err && (
                    <p className="text-[11px] text-rose-500 mt-1">{err[0] || err}</p>
                  )}
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{f.help}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Section 3: Alasan Perubahan / Audit Trail */}
        {isEdit && (
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label htmlFor="kkf-reason" className="block font-semibold text-slate-700 dark:text-slate-300">
              Alasan Perubahan Draf (Audit Trail)
            </label>
            <textarea
              id="kkf-reason"
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Koreksi nilai BPP sesuai keputusan rapat teknis..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        )}
      </form>
    </PanelShell>
  )
}
