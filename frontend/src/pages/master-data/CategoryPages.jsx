import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { masterDataApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { CreateCategoryDrawer, CreateUnitDrawer, EditCategoryDrawer, EditUnitDrawer } from './CategoriesPage.jsx'

const BACK = '/master-data/categories'

/** Memuat kategori dan satuan sekali, lalu menyerahkannya ke formulir (laci pada daftar hanya pratinjau; tambah/ubah dilakukan di halaman ini). */
function useReference() {
  const [state, setState] = useState({ loading: true, error: '', categories: [], units: [] })
  useEffect(() => {
    Promise.all([masterDataApi.categories(), masterDataApi.units()])
      .then(([c, u]) => setState({ loading: false, error: '', categories: c.data ?? [], units: u.data ?? [] }))
      .catch((e) => setState({ loading: false, error: e.message || 'Gagal memuat referensi.', categories: [], units: [] }))
  }, [])
  return state
}

function Gate({ state, children }) {
  if (state.loading) return <div className="p-8 text-center"><Spinner /></div>
  if (state.error) return <Alert kind="error">{state.error}</Alert>
  return children
}

export function CategoryCreatePage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const [params] = useSearchParams()
  const ref = useReference()
  const parent = useMemo(() => ref.categories.find((c) => c.id === params.get('induk')) || null, [ref.categories, params])
  return (
    <Gate state={ref}>
      <CreateCategoryDrawer
        asPage
        parentCategory={parent}
        existingCategories={ref.categories}
        onClose={() => navigate(BACK)}
        onSuccess={(summaryDesc) => {
          notify({
            type: 'success',
            title: parent ? 'Subkategori Dibuat' : summaryDesc ? 'Impor Kategori Berhasil' : 'Kategori Dibuat',
            desc: parent ? `Subkategori berhasil ditambahkan di bawah ${parent.name}.` : summaryDesc || 'Kategori baru berhasil ditambahkan.',
            tag: 'KATEGORI',
          })
          navigate(BACK)
        }}
      />
    </Gate>
  )
}

export function CategoryEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const ref = useReference()
  const categoryMap = useMemo(() => new Map(ref.categories.map((c) => [c.id, c])), [ref.categories])
  const category = categoryMap.get(id)
  return (
    <Gate state={ref}>
      {category ? (
        <EditCategoryDrawer
          asPage
          category={category}
          categoryMap={categoryMap}
          onClose={() => navigate(BACK)}
          onSuccess={() => {
            notify({ type: 'success', title: 'Kategori Diperbarui', desc: 'Data kategori berhasil disimpan.', tag: 'KATEGORI' })
            navigate(BACK)
          }}
        />
      ) : <Alert kind="error">Kategori tidak ditemukan.</Alert>}
    </Gate>
  )
}

export function UomCreatePage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const ref = useReference()
  return (
    <Gate state={ref}>
      <CreateUnitDrawer
        asPage
        existingUnits={ref.units}
        onClose={() => navigate(BACK)}
        onSuccess={(summaryDesc) => {
          notify({ type: 'success', title: summaryDesc ? 'Impor Satuan Berhasil' : 'Satuan Dibuat', desc: summaryDesc || 'Satuan pengukuran baru berhasil ditambahkan.', tag: 'SATUAN' })
          navigate(BACK)
        }}
      />
    </Gate>
  )
}

export function UomEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const ref = useReference()
  const unit = ref.units.find((u) => u.id === id)
  return (
    <Gate state={ref}>
      {unit ? (
        <EditUnitDrawer
          asPage
          unit={unit}
          onClose={() => navigate(BACK)}
          onSuccess={() => {
            notify({ type: 'success', title: 'Satuan Diperbarui', desc: 'Data satuan pengukuran berhasil disimpan.', tag: 'SATUAN' })
            navigate(BACK)
          }}
        />
      ) : <Alert kind="error">Satuan tidak ditemukan.</Alert>}
    </Gate>
  )
}
