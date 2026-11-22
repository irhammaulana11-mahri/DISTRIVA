import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { substationsApi, feedersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { SubstationDetailDrawer, SubstationEditDrawer } from './SubstationsPage.jsx'
import { SubstationMeasurementDrawer } from './SubstationMeasurementsPage.jsx'
import MaximoSyncDrawer from './MaximoSyncDrawer.jsx'

/**
 * Drawer Page untuk Detail Lengkap Master Gardu.
 * Memuat gardu berdasarkan :id dari URL dan menampilkan dalam PanelShell asPage.
 */
export function SubstationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const canManage = Boolean(can?.['substations.manage'] || isSysAdmin)
  const canViewFeeders = Boolean(can?.['feeders.view'])
  const canViewCustomers = Boolean(can?.['customers.view'])

  const [feedersList, setFeedersList] = useState([])

  useEffect(() => {
    if (canViewFeeders) {
      feedersApi
        .list({ per_page: 100 })
        .then((res) => setFeedersList(res?.data || []))
        .catch(() => setFeedersList([]))
    }
  }, [canViewFeeders])

  return (
    <SubstationDetailDrawer
      id={id}
      asPage
      canManage={canManage}
      canViewFeeders={canViewFeeders}
      canViewCustomers={canViewCustomers}
      feedersList={feedersList}
      onClose={() => navigate('/master-data/substations')}
      onChanged={() => {}}
    />
  )
}

/**
 * Drawer Page untuk Ubah Data Induk Gardu (Proses CRUD).
 * Membuka formulir pengubahan data induk gardu dalam PanelShell asPage.
 */
export function SubstationEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <SubstationEditDrawer
      id={id}
      asPage
      onClose={() => navigate(`/master-data/substations/${id}`)}
      onSuccess={() => navigate(`/master-data/substations/${id}`)}
    />
  )
}

/**
 * Drawer Page untuk Kondisi & Analisis Gardu serta Form Tambah Pembacaan (CRUD).
 * Menampilkan analisis teknis, grafik beban, riwayat, dan formulir pembacaan operasional dalam PanelShell asPage.
 */
export function SubstationMeasurementDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const canReading = Boolean(can?.['substations.reading'] || isSysAdmin)
  const canViewFeeders = Boolean(can?.['feeders.view'])

  const [feedersList, setFeedersList] = useState([])

  useEffect(() => {
    if (canViewFeeders) {
      feedersApi
        .list({ per_page: 100 })
        .then((res) => setFeedersList(res?.data || []))
        .catch(() => setFeedersList([]))
    }
  }, [canViewFeeders])

  return (
    <SubstationMeasurementDrawer
      id={id}
      asPage
      canReading={canReading}
      canViewFeeders={canViewFeeders}
      feedersList={feedersList}
      onClose={() => navigate('/master-data/substation-measurements')}
      onChanged={() => {}}
    />
  )
}

/**
 * Drawer Page untuk Sinkronisasi Maximo.
 * Menjalankan penarikan WO inspeksi Maximo dan formulir pengaturan akun dalam PanelShell asPage.
 */
export function MaximoSyncPage() {
  const navigate = useNavigate()
  return (
    <MaximoSyncDrawer
      open
      asPage
      onClose={() => navigate('/master-data/substation-measurements')}
      onSynced={() => {}}
    />
  )
}

