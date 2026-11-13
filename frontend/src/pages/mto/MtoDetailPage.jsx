import { useParams, useNavigate } from 'react-router-dom'
import MtoPackageDetailView from './MtoPackageDetailView.jsx'

export default function MtoDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <div className="w-full">
      <MtoPackageDetailView
        packageId={id}
        onBack={() => navigate(-1)}
        onReload={() => {}}
      />
    </div>
  )
}
