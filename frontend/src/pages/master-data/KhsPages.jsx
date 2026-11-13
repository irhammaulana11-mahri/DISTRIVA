import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { masterDataApi } from '../../services/api.js'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { KhsDraftEditDrawer, KhsImportDrawer } from './KhsPage.jsx'

const BACK = '/master-data/khs'

/** Halaman koreksi draf dan impor Katalog KHS (laci pada daftar hanya pratinjau). */
export function KhsDraftEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: '', item: null })
  useEffect(() => {
    masterDataApi.khsItem(id)
      .then((res) => {
        const draft = (res.data?.versions || []).find((v) => v.status === 'DRAFT') || null
        setState({ loading: false, error: draft ? '' : 'Item ini tidak punya versi draf untuk dikoreksi.', item: { id: res.data.id, code: res.data.code, draft } })
      })
      .catch((e) => setState({ loading: false, error: e.message || 'Data tidak ditemukan.', item: null }))
  }, [id])
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error) return <Alert kind="error">{state.error}</Alert>
  return <KhsDraftEditDrawer asPage item={state.item} onClose={() => navigate(BACK)} onSuccess={() => navigate(BACK)} />
}

export function KhsImportPage() {
  const navigate = useNavigate()
  return <KhsImportDrawer asPage onClose={() => navigate(BACK)} onSuccess={() => navigate(BACK)} />
}
