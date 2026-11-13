import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { masterDataApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { MaterialEditDrawer, MaterialImportDrawer } from './MaterialsPage.jsx'

const BACK = '/master-data/materials'

/** Halaman ubah pemetaan material dan impor batch material (laci pada daftar hanya pratinjau). */
export function MaterialEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', material: null, categories: [] })
  useEffect(() => {
    Promise.all([masterDataApi.material(id), masterDataApi.categories()])
      .then(([m, c]) => setState({ loading: false, error: '', material: m.data, categories: c.data ?? [] }))
      .catch((e) => setState({ loading: false, error: e.message || 'Material tidak ditemukan.', material: null, categories: [] }))
  }, [id])
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error) return <Alert kind="error">{state.error}</Alert>
  return (
    <MaterialEditDrawer
      asPage
      material={state.material}
      categories={state.categories}
      onClose={() => navigate(BACK)}
      onSuccess={(updated) => {
        notify({ type: 'success', title: 'Material Diperbarui', desc: `Data material ${updated.code} - ${updated.name} berhasil diperbarui.`, tag: 'Material' })
        navigate(BACK)
      }}
    />
  )
}

export function MaterialImportPage() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState(null)
  useEffect(() => {
    masterDataApi.categories().then((c) => setCategories(c.data ?? [])).catch(() => setCategories([]))
  }, [])
  if (categories === null) return <div className="p-8 text-center"><Spinner /></div>
  return <MaterialImportDrawer asPage categories={categories} onClose={() => navigate(BACK)} onSuccess={() => navigate(BACK)} />
}
