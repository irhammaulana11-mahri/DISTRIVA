import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { CreateUnitDrawer, EditUnitDrawer } from './UnitsPage.jsx'

/** Halaman tambah dan ubah Unit Organisasi (laci pada daftar hanya pratinjau). */
export function UnitCreatePage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const [up3, setUp3] = useState(null)
  useEffect(() => {
    adminApi.units({ per_page: 100 }).then((res) => setUp3((res?.data || []).filter((u) => u.unit_type === 'UP3' && u.is_active))).catch(() => setUp3([]))
  }, [])
  if (up3 === null) return <div className="p-8 text-center"><Spinner /></div>
  return (
    <CreateUnitDrawer
      open
      asPage
      activeUp3List={up3}
      onClose={() => navigate('/admin/units')}
      onSuccess={(unit) => {
        notify({ type: 'success', title: 'Unit Berhasil Dibuat', desc: `Unit ${unit.code} - ${unit.name} berhasil dibuat.`, tag: 'Unit' })
        navigate('/admin/units')
      }}
    />
  )
}

export function UnitEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', unit: null })
  useEffect(() => {
    adminApi.unit(id).then((res) => setState({ loading: false, error: '', unit: res?.data })).catch((e) => setState({ loading: false, error: e.message, unit: null }))
  }, [id])
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error || !state.unit) return <Alert kind="error">{state.error || 'Unit tidak ditemukan.'}</Alert>
  return (
    <EditUnitDrawer
      asPage
      unit={state.unit}
      onClose={() => navigate('/admin/units')}
      onSuccess={(unit) => {
        notify({ type: 'success', title: 'Unit Berhasil Diperbarui', desc: `Data unit ${unit.code} - ${unit.name} berhasil diperbarui.`, tag: 'Unit' })
        navigate('/admin/units')
      }}
    />
  )
}
