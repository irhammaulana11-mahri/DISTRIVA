import { useParams, useNavigate } from 'react-router-dom'
import DrawingDetailView from './DrawingDetailView.jsx'

export default function DrawingDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <div className="w-full">
      <DrawingDetailView
        drawingId={id}
        onBack={() => navigate('/permohonan')}
      />
    </div>
  )
}
