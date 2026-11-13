import Spinner from '../../components/Spinner.jsx'
import DrawingApprovalChain, { buildFlowGuide } from '../drawings/DrawingApprovalChain.jsx'
import useDrawingBundle from './useDrawingBundle.js'

/**
 * Rantai persetujuan gambar + MTO usulan, ditampilkan satu kali di atas semua tab halaman usulan (hasil KKF menentukan apakah rantai diperluas ke
 * Asman Niaga + Manager UP3). Hanya menampilkan; keputusan tetap diambil di tab Gambar & Lampiran. Data dibagikan lewat `bundle` (satu pengambilan
 * per halaman); tanpa `bundle` komponen mengambil sendiri.
 */
export default function ProposalApprovalChain({ representativeApplicationId, reloadKey = 0, bundle = null }) {
  const own = useDrawingBundle(representativeApplicationId, reloadKey, !bundle)
  const state = bundle || own

  if (state.loading && !state.version) return <div className="p-4 text-center"><Spinner size="sm" label="Memuat rantai persetujuan…" /></div>
  if (!state.version) {
    return (
      <p className="p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500">
        Paket gambar teknik usulan belum dibuat, sehingga rantai persetujuan belum ada.
      </p>
    )
  }

  return <DrawingApprovalChain version={state.version} mtoPackage={state.mto} guide={buildFlowGuide(state.version, state.mto, state.canExecute)} showDecisionNotes={false} />
}
