import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { kkfParametersApi } from '../../services/api.js'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import KkfParameterFormDrawer from './KkfParameterFormDrawer.jsx'
import { ConstructionImportDrawer } from './ConstructionsPage.jsx'

/** Halaman buat/ubah draf Parameter KKF dan impor Standar Konstruksi (laci pada daftar hanya pratinjau). */
export function KkfParameterCreatePage() {
  const navigate = useNavigate()
  const [defaults, setDefaults] = useState(undefined)
  useEffect(() => {
    kkfParametersApi.list({ per_page: 1 }).then((res) => setDefaults(res?.defaults || null)).catch(() => setDefaults(null))
  }, [])
  if (defaults === undefined) return <div className="p-8 text-center"><Spinner /></div>
  return <KkfParameterFormDrawer open asPage defaults={defaults} onClose={() => navigate('/master-data/kkf-parameters')} onSuccess={() => {}} />
}

export function KkfParameterEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, error: '', set: null })
  useEffect(() => {
    kkfParametersApi.get(id).then((res) => setState({ loading: false, error: '', set: res?.data || null })).catch((e) => setState({ loading: false, error: e.message || 'Set parameter tidak ditemukan.', set: null }))
  }, [id])
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error || !state.set) return <Alert kind="error">{state.error || 'Set parameter tidak ditemukan.'}</Alert>
  return <KkfParameterFormDrawer open asPage initialData={state.set} onClose={() => navigate(`/master-data/kkf-parameters/${id}`)} onSuccess={() => {}} />
}

export function ConstructionImportPage() {
  const navigate = useNavigate()
  return <ConstructionImportDrawer asPage onClose={() => navigate('/master-data/constructions')} onSuccess={() => navigate('/master-data/constructions')} />
}
