import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { bastpApi, workOrdersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import BastpDetailDrawer from './BastpDetailDrawer.jsx'

/** Halaman BASTP: isi material dan meter, unggah foto, ajukan, terima, tandatangani, tutup, kembalikan (laci pada panel SPK tidak lagi memuat form). */
export function BastpDetailPage() {
  const { bastpId } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const [state, setState] = useState({ loading: true, error: '', workOrder: null })
  useEffect(() => {
    bastpApi.get(bastpId)
      .then((b) => workOrdersApi.get(b?.data?.work_order_id).then((w) => setState({ loading: false, error: '', workOrder: w?.data || null })).catch(() => setState({ loading: false, error: '', workOrder: null })))
      .catch((e) => setState({ loading: false, error: e?.message || 'BASTP tidak ditemukan.', workOrder: null }))
  }, [bastpId])
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error) return <Alert kind="error">{state.error}</Alert>
  return <BastpDetailDrawer asPage bastpId={bastpId} workOrder={state.workOrder} isVendor={Boolean(can['vendor.portal'])} onClose={() => navigate(-1)} onUpdated={() => {}} />
}
