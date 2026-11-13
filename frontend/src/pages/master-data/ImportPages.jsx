import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../../services/api.js'
import BomImportModal from './BomImportModal.jsx'
import PriceBookImportModal from './PriceBookImportModal.jsx'
import TariffBookImportModal from './TariffBookImportModal.jsx'
import SubstationImportModal from './SubstationImportModal.jsx'
import SubstationReadingsImportModal from './SubstationReadingsImportModal.jsx'

/** Halaman impor Master Data: laci pada daftar hanya pratinjau, unggah dan terapkan dilakukan di halaman ini. Selesai/batal kembali ke daftar. */
export function BomImportPage() {
  const navigate = useNavigate()
  return <BomImportModal open asPage onClose={() => navigate('/master-data/bom')} onSuccess={() => {}} />
}

export function PriceBookImportPage() {
  const navigate = useNavigate()
  return <PriceBookImportModal isOpen asPage onClose={() => navigate('/master-data/harga')} onSuccess={() => {}} />
}

export function TariffBookImportPage() {
  const navigate = useNavigate()
  return <TariffBookImportModal isOpen asPage onClose={() => navigate('/master-data/tariff-books')} onSuccess={() => {}} />
}

export function SubstationImportPage() {
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  useEffect(() => {
    adminApi.units().then((res) => setUnits(res?.data || [])).catch(() => setUnits([]))
  }, [])
  return <SubstationImportModal open asPage units={units} onClose={() => navigate('/master-data/substations')} onApplied={() => {}} />
}

export function SubstationReadingsImportPage() {
  const navigate = useNavigate()
  return <SubstationReadingsImportModal isOpen asPage onClose={() => navigate('/master-data/substation-measurements')} onSuccess={() => {}} />
}
