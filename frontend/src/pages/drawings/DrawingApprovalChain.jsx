import { useState } from 'react'
import { IconCheck, IconAlertCircle, IconChevronDown } from '../../components/icons.jsx'

export const DRAWING_STAGE_LABELS = {
  ULP_MANAGER: 'Manager ULP',
  UP3_REVIEW: 'Review UP3 (Perencanaan & Konstruksi)',
  ASMAN: 'Persetujuan Asman',
  UP3_MANAGER: 'Persetujuan Manager UP3',
}

export const DRAWING_STEP_LABELS = {
  ULP_MANAGER: 'Persetujuan Manager ULP',
  REVIEW_PERENCANAAN: 'Review Perencanaan UP3',
  REVIEW_KONSTRUKSI: 'Review Konstruksi UP3',
  ASMAN_PERENCANAAN: 'Persetujuan Asman Perencanaan',
  ASMAN_NIAGA: 'Persetujuan Asman Niaga',
  ASMAN_KONSTRUKSI: 'Persetujuan Asman Konstruksi',
  UP3_MANAGER: 'Persetujuan Manager UP3',
  PROPOSAL_CANCELLED: 'Usulan Dibatalkan',
}

export function buildFlowGuide(version, mtoPackage, canExecute) {
    const v = version
    if (!v) return null
    const mainDocument = v.documents?.find((d) => d.file_role === 'MAIN')
    if (v.status === 'DRAFT') {
      return {
        tone: 'amber',
        text: canExecute
          ? `Draf masih di tangan Anda. ${mainDocument ? '' : 'Unggah berkas gambar utama, '}${v.title ? '' : 'isi judul gambar, '}${mtoPackage ? 'lengkapi MTO, ' : 'buat paket MTO, '}lalu klik "Ajukan Paket Gambar": gambar dan MTO diajukan bersama (MTO diverifikasi otomatis) dan disetujui Manager ULP dalam satu keputusan.`
          : 'Gambar masih berupa draf Teknik ULP dan belum diajukan, sehingga belum ada yang perlu direview. Review UP3 dan persetujuan Asman baru muncul setelah Teknik ULP mengajukan gambar beserta MTO dan Manager ULP menyetujuinya.',
      }
    }
    if (v.status === 'SUBMITTED' || (v.status === 'UNDER_REVIEW' && v.stage === 'ULP_MANAGER')) {
      return {
        tone: 'blue',
        text: 'Menunggu persetujuan Manager ULP. Gambar dan MTO diputuskan dalam satu keputusan; setelah disetujui, keduanya diteruskan ke review UP3 (Perencanaan dan Konstruksi).',
      }
    }
    if (v.status === 'UNDER_REVIEW' && v.stage === 'UP3_REVIEW') {
      return { tone: 'blue', text: 'Menunggu review Perencanaan dan Konstruksi UP3. Keduanya harus menyetujui sebelum diteruskan ke Asman.' }
    }
    if (v.status === 'UNDER_REVIEW' && v.stage === 'ASMAN') {
      return { tone: 'blue', text: 'Menunggu persetujuan Asman Perencanaan dan Asman Konstruksi' + (v.extended_approval ? ' serta Asman Niaga.' : '.') }
    }
    if (v.status === 'UNDER_REVIEW' && v.stage === 'UP3_MANAGER') {
      return { tone: 'blue', text: 'Menunggu persetujuan akhir Manager UP3 (persetujuan diperluas).' }
    }
    if (v.status === 'RETURNED') {
      return { tone: 'rose', text: 'Versi ini dikembalikan. Teknik ULP menyusun versi baru dari draf yang tersedia, lalu rantai dimulai dari awal.' }
    }
    if (v.status === 'APPROVED') {
      return { tone: 'emerald', text: 'Semua tahap persetujuan selesai. Gambar ini berlaku.' }
    }
    return null
  }

/**
 * Rantai persetujuan satu versi gambar (Manager ULP -> Review UP3 -> Asman [-> Manager UP3 bila diperluas]); hanya menampilkan, tidak memproses.
 * Dipakai di tab Gambar & Lampiran dan di tab Kelayakan Finansial usulan.
 */
export default function DrawingApprovalChain({ version: latestVersion, mtoPackage, guide: flowGuide, showDecisionNotes = true }) {
  const [showDecisions, setShowDecisions] = useState(false)
  if (!latestVersion) return null
  const pendingLabel = latestVersion.status === 'DRAFT' ? 'Menunggu pengajuan' : 'Belum'

  return (
  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Rantai Persetujuan Versi {latestVersion.version_number}
        </h4>
        {latestVersion.status === 'APPROVED' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            Berlaku
          </span>
        )}
      </div>
      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
        latestVersion.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
        latestVersion.status === 'RETURNED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' :
        latestVersion.status === 'DRAFT' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
        'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
      }`}>
        {latestVersion.status === 'DRAFT' ? 'Draf Penyusun' :
         latestVersion.status === 'SUBMITTED' ? 'Diajukan' :
         latestVersion.status === 'UNDER_REVIEW' ? `Dalam Review (${DRAWING_STAGE_LABELS[latestVersion.stage] || latestVersion.stage})` :
         latestVersion.status === 'APPROVED' ? 'Disetujui' :
         latestVersion.status === 'RETURNED' ? (latestVersion.returned_at_step === 'PROPOSAL_CANCELLED' ? 'Dikembalikan: usulan dibatalkan' : 'Dikembalikan') : latestVersion.status}
      </span>
    </div>

    {flowGuide && (
      <div className={`p-2.5 rounded-lg border text-xs ${
        { amber: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300',
          blue: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300',
          rose: 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300',
          emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300' }[flowGuide.tone]
      }`}>
        {flowGuide.text}
      </div>
    )}

    {latestVersion.extended_approval && (
      <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
        <strong>Persetujuan Diperluas:</strong> {latestVersion.extended_reason || 'Diwajibkan persetujuan Asman Niaga dan Manager UP3.'}
      </div>
    )}

    {/* Stepper Timeline Grid */}
    <div className={`grid grid-cols-1 sm:grid-cols-${latestVersion.extended_approval ? '4' : '3'} gap-2 pt-2 text-xs`}>
      {/* Step 1: Manager ULP */}
      <div className={`p-3 rounded-lg border ${
        latestVersion.stage === 'ULP_MANAGER'
          ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20 font-bold'
          : latestVersion.decisions?.some((d) => d.step === 'ULP_MANAGER')
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 opacity-70'
      }`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-200">1. Manager ULP</span>
          {latestVersion.decisions?.some((d) => d.step === 'ULP_MANAGER') && <IconCheck size={14} className="text-emerald-600" />}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Persetujuan Tingkat Unit</p>

        {/* MTO Gate Badge (docs/63 §F butir 5) */}
        <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60 flex flex-wrap gap-1.5">
          {(() => {
            const chip = (ok, wait, text) => (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                ok ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800'
                  : wait ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800'
                  : 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800'
              }`}>
                {ok ? <IconCheck size={11} /> : <IconAlertCircle size={11} />} {text}
              </span>
            )
            const drawingOk = latestVersion.decisions?.some((d) => d.step === 'ULP_MANAGER' && d.decision === 'APPROVED')
            const drawingWait = latestVersion.status === 'SUBMITTED' || (latestVersion.status === 'UNDER_REVIEW' && latestVersion.stage === 'ULP_MANAGER')
            const mtoOk = mtoPackage?.status === 'APPROVED'
            const mtoWait = mtoPackage?.status === 'VERIFIED'
            return (
              <>
                {chip(drawingOk, drawingWait, drawingOk ? 'Gambar Disetujui' : drawingWait ? 'Gambar Menunggu Keputusan' : 'Gambar Belum Diajukan')}
                {chip(mtoOk, mtoWait, mtoOk ? 'MTO Disetujui' : mtoWait ? 'MTO Terverifikasi (disetujui bersama gambar)' : 'MTO Belum Diverifikasi')}
              </>
            )
          })()}
        </div>
      </div>

      {/* Step 2: Review UP3 */}
      <div className={`p-3 rounded-lg border ${
        latestVersion.stage === 'UP3_REVIEW'
          ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20 font-bold'
          : (latestVersion.decisions?.some((d) => d.step === 'REVIEW_PERENCANAAN') &&
             latestVersion.decisions?.some((d) => d.step === 'REVIEW_KONSTRUKSI'))
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 opacity-70'
      }`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-200">2. Review UP3</span>
          {(latestVersion.decisions?.some((d) => d.step === 'REVIEW_PERENCANAAN') &&
            latestVersion.decisions?.some((d) => d.step === 'REVIEW_KONSTRUKSI')) && <IconCheck size={14} className="text-emerald-600" />}
        </div>
        <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
          <div className="flex items-center justify-between">
            <span>Perencanaan:</span>
            <span className={latestVersion.decisions?.some((d) => d.step === 'REVIEW_PERENCANAAN') ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
              {latestVersion.decisions?.some((d) => d.step === 'REVIEW_PERENCANAAN') ? 'Selesai' : pendingLabel}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Konstruksi:</span>
            <span className={latestVersion.decisions?.some((d) => d.step === 'REVIEW_KONSTRUKSI') ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
              {latestVersion.decisions?.some((d) => d.step === 'REVIEW_KONSTRUKSI') ? 'Selesai' : pendingLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Step 3: Persetujuan Asman */}
      <div className={`p-3 rounded-lg border ${
        latestVersion.stage === 'ASMAN'
          ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20 font-bold'
          : (latestVersion.decisions?.some((d) => d.step === 'ASMAN_PERENCANAAN') &&
             latestVersion.decisions?.some((d) => d.step === 'ASMAN_KONSTRUKSI') &&
             (!latestVersion.extended_approval || latestVersion.decisions?.some((d) => d.step === 'ASMAN_NIAGA')))
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 opacity-70'
      }`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            3. Persetujuan Asman
          </span>
          {(latestVersion.decisions?.some((d) => d.step === 'ASMAN_PERENCANAAN') &&
            latestVersion.decisions?.some((d) => d.step === 'ASMAN_KONSTRUKSI') &&
            (!latestVersion.extended_approval || latestVersion.decisions?.some((d) => d.step === 'ASMAN_NIAGA'))) && (
            <IconCheck size={14} className="text-emerald-600" />
          )}
        </div>
        <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
          <div className="flex items-center justify-between">
            <span>Perencanaan:</span>
            <span className={latestVersion.decisions?.some((d) => d.step === 'ASMAN_PERENCANAAN') ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
              {latestVersion.decisions?.some((d) => d.step === 'ASMAN_PERENCANAAN') ? 'Selesai' : pendingLabel}
            </span>
          </div>
          {latestVersion.extended_approval && (
            <div className="flex items-center justify-between">
              <span>Niaga:</span>
              <span className={latestVersion.decisions?.some((d) => d.step === 'ASMAN_NIAGA') ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                {latestVersion.decisions?.some((d) => d.step === 'ASMAN_NIAGA') ? 'Selesai' : pendingLabel}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span>Konstruksi:</span>
            <span className={latestVersion.decisions?.some((d) => d.step === 'ASMAN_KONSTRUKSI') ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
              {latestVersion.decisions?.some((d) => d.step === 'ASMAN_KONSTRUKSI') ? 'Selesai' : pendingLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Step 4: Persetujuan Manager UP3 (Only for extended approval) */}
      {latestVersion.extended_approval && (
        <div className={`p-3 rounded-lg border ${
          latestVersion.stage === 'UP3_MANAGER'
            ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20 font-bold'
            : latestVersion.decisions?.some((d) => d.step === 'UP3_MANAGER')
            ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 opacity-70'
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 dark:text-slate-200">4. Manager UP3</span>
            {latestVersion.decisions?.some((d) => d.step === 'UP3_MANAGER') && <IconCheck size={14} className="text-emerald-600" />}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Persetujuan Akhir Diperluas</p>
        </div>
      )}
    </div>

    {/* Decisions List */}
    {showDecisionNotes && latestVersion.decisions?.length > 0 && (
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShowDecisions((v) => !v)}
          aria-expanded={showDecisions}
          className="w-full flex items-center justify-between text-left cursor-pointer"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Catatan Keputusan ({latestVersion.decisions.length})
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
            {showDecisions ? 'Ciutkan' : 'Tampilkan'}
            <IconChevronDown size={14} className={`transform transition-transform ${showDecisions ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {showDecisions && (
        <div className="mt-2 space-y-2">
          {latestVersion.decisions.map((d, i) => (
            <div key={i} className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    d.decision === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                  }`}>
                    {d.decision === 'APPROVED' ? 'SETUJU' : 'TOLAK'}
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {DRAWING_STEP_LABELS[d.step] || d.step}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {d.decided_at ? new Date(d.decided_at).toLocaleString('id-ID') : '-'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Oleh: <span className="font-medium text-slate-700 dark:text-slate-300">{d.decided_by_name}</span> ({d.decided_role})
              </p>
              {d.notes && (
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded">
                  &ldquo;{d.notes}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
        )}
      </div>
    )}
  </div>

  )
}
