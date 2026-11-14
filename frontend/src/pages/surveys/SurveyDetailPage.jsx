import { useParams, useNavigate } from 'react-router-dom'
import SurveyDetailView from './SurveyDetailView.jsx'

export default function SurveyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <div className="w-full">
      <SurveyDetailView
        surveyId={id}
        onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/survei'))}
      />
    </div>
  )
}
