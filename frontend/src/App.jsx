import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './features/auth/AuthContext.jsx'
import AppLayout from './layout/AppLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardRouter from './pages/dashboard/DashboardRouter.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ChangePasswordPage from './pages/ChangePasswordPage.jsx'
import ModuleStatusPage from './pages/ModuleStatusPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import OtpPage from './pages/OtpPage.jsx'
import MfaPage from './pages/MfaPage.jsx'
import Spinner from './components/Spinner.jsx'
import { AccessProvider, useAccess } from './features/admin/AccessContext.jsx'
import { NotificationProvider } from './features/notifications/NotificationContext.jsx'
import UsersPage from './pages/admin/UsersPage.jsx'
import NewUserPage from './pages/admin/NewUserPage.jsx'
import UserDetailPage from './pages/admin/UserDetailPage.jsx'
import UnitsPage from './pages/admin/UnitsPage.jsx'
import MaterialsPage from './pages/master-data/MaterialsPage.jsx'
import KhsPage from './pages/master-data/KhsPage.jsx'
import KhsMaterialMapPage from './pages/master-data/KhsMaterialMapPage.jsx'
import ConstructionsPage from './pages/master-data/ConstructionsPage.jsx'
import BomPage from './pages/master-data/BomPage.jsx'
import BomDetailPage from './pages/master-data/BomDetailPage.jsx'
import BomCalculatorPage from './pages/master-data/BomCalculatorPage.jsx'
import PriceBooksPage from './pages/master-data/PriceBooksPage.jsx'
import PriceBookDetailPage from './pages/master-data/PriceBookDetailPage.jsx'
import KkfParametersPage from './pages/master-data/KkfParametersPage.jsx'
import KkfParameterDetailPage from './pages/master-data/KkfParameterDetailPage.jsx'
import TariffBooksPage from './pages/master-data/TariffBooksPage.jsx'
import TariffBookDetailPage from './pages/master-data/TariffBookDetailPage.jsx'
import VendorsPage from './pages/master-data/VendorsPage.jsx'
import VendorFormPage from './pages/master-data/VendorFormPage.jsx'
import WorkOrdersPage from './pages/work-orders/WorkOrdersPage.jsx'
import WorkOrderAgendaPage from './pages/work-orders/WorkOrderAgendaPage.jsx'
import PoleWorkOrderFormPage from './pages/work-orders/PoleWorkOrderFormPage.jsx'
import PoleWorkOrderDetailPage from './pages/work-orders/PoleWorkOrderDetailPage.jsx'
import WarehousesPage from './pages/master-data/WarehousesPage.jsx'
import SubstationsPage from './pages/master-data/SubstationsPage.jsx'
import SubstationMeasurementsPage from './pages/master-data/SubstationMeasurementsPage.jsx'
import FeedersPage from './pages/master-data/FeedersPage.jsx'
import CustomersPage from './pages/master-data/CustomersPage.jsx'
import PoleContractsPage from './pages/master-data/PoleContractsPage.jsx'
import RkmPlansPage from './pages/rkm/RkmPlansPage.jsx'
import RkmVersionDetailPage from './pages/rkm/RkmVersionDetailPage.jsx'
import ReportsPage from './pages/reports/ReportsPage.jsx'
import CategoriesPage from './pages/master-data/CategoriesPage.jsx'
import ApplicationsPage from './pages/applications/ApplicationsPage.jsx'
import ProposalsPage from './pages/proposals/ProposalsPage.jsx'
import ProposalDetailPage from './pages/proposals/ProposalDetailPage.jsx'
import SurveyDetailPage from './pages/surveys/SurveyDetailPage.jsx'
import SurveyRequestsPage from './pages/surveys/SurveyRequestsPage.jsx'
import DrawingDetailPage from './pages/drawings/DrawingDetailPage.jsx'
import MtoDetailPage from './pages/mto/MtoDetailPage.jsx'
import BackupPage from './pages/backup/BackupPage.jsx'

// UX gate only: the server enforces authentication on every request.
function RequireAuth({ children }) {
  const { status, mustChangePassword, mfaPending } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <Spinner label="Memeriksa sesi…" />
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location }} />
  // First login of a SYS_ADMIN: both gates are active. Password change comes first (the server allows it before MFA);
  // each gate must let the other's page through, otherwise the two redirects bounce forever (/mfa <-> /ubah-password).
  if (mustChangePassword && location.pathname !== '/ubah-password') {
    return <Navigate to="/ubah-password" replace />
  }
  if (mfaPending && location.pathname !== '/mfa' && !(mustChangePassword && location.pathname === '/ubah-password')) {
    return <Navigate to="/mfa" replace state={{ from: location }} />
  }
  return children
}

// UX gate only: the server answers 403/404 regardless of what the UI shows.
function RequireCapability({ capability, anyOf, children }) {
  const { loading, can } = useAccess()
  if (loading) return <Spinner />
  const allowed = anyOf ? anyOf.some((c) => Boolean(can[c])) : Boolean(can[capability])
  return allowed ? children : <NotFoundPage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/aktivasi" element={<OtpPage purpose="activation" />} />
      <Route path="/pemulihan" element={<OtpPage purpose="recovery" />} />
      <Route path="/mfa" element={<RequireAuth><MfaPage /></RequireAuth>} />
      <Route element={<RequireAuth><AccessProvider><NotificationProvider><AppLayout /></NotificationProvider></AccessProvider></RequireAuth>}>
        <Route index element={<DashboardRouter />} />
        <Route path="profil" element={<ProfilePage />} />
        <Route path="ubah-password" element={<ChangePasswordPage />} />
        <Route path="modul/:slug" element={<ModuleStatusPage />} />
        <Route path="admin/users" element={<RequireCapability capability="users.view"><UsersPage /></RequireCapability>} />
        <Route path="admin/users/new" element={<RequireCapability capability="users.create"><NewUserPage /></RequireCapability>} />
        <Route path="admin/users/:id" element={<RequireCapability capability="users.view"><UserDetailPage /></RequireCapability>} />
        <Route path="admin/units" element={<RequireCapability capability="organizational_units.view"><UnitsPage /></RequireCapability>} />
        <Route path="master-data/materials" element={<RequireCapability capability="master_data.view"><MaterialsPage /></RequireCapability>} />
        <Route path="master-data/khs" element={<RequireCapability capability="master_data.view"><KhsPage /></RequireCapability>} />
        <Route path="master-data/mapping" element={<RequireCapability capability="master_data.view"><KhsMaterialMapPage /></RequireCapability>} />
        <Route path="master-data/constructions" element={<RequireCapability capability="master_data.view"><ConstructionsPage /></RequireCapability>} />
        <Route path="master-data/bom" element={<RequireCapability capability="master_data.view"><BomPage /></RequireCapability>} />
        <Route path="master-data/bom/:id" element={<RequireCapability capability="master_data.view"><BomDetailPage /></RequireCapability>} />
        <Route path="master-data/bom/:id/hitung" element={<RequireCapability capability="master_data.view"><BomCalculatorPage /></RequireCapability>} />
        <Route path="master-data/harga" element={<RequireCapability capability="master_data.view"><PriceBooksPage /></RequireCapability>} />
        <Route path="master-data/harga/:id" element={<RequireCapability capability="master_data.view"><PriceBookDetailPage /></RequireCapability>} />
        <Route path="master-data/kkf-parameters" element={<RequireCapability capability="master_data.view"><KkfParametersPage /></RequireCapability>} />
        <Route path="master-data/kkf-parameters/:id" element={<RequireCapability capability="master_data.view"><KkfParameterDetailPage /></RequireCapability>} />
        <Route path="master-data/tariff-books" element={<RequireCapability capability="master_data.view"><TariffBooksPage /></RequireCapability>} />
        <Route path="master-data/tariff-books/:id" element={<RequireCapability capability="master_data.view"><TariffBookDetailPage /></RequireCapability>} />
        <Route path="master-data/vendors" element={<RequireCapability capability="vendors.manage"><VendorsPage /></RequireCapability>} />
        <Route path="master-data/vendors/new" element={<RequireCapability capability="vendors.manage"><VendorFormPage /></RequireCapability>} />
        <Route path="master-data/vendors/:id/edit" element={<RequireCapability capability="vendors.manage"><VendorFormPage /></RequireCapability>} />
        <Route path="master-data/substations" element={<RequireCapability capability="substations.view"><SubstationsPage /></RequireCapability>} />
        <Route path="master-data/substation-measurements" element={<RequireCapability capability="substations.view"><SubstationMeasurementsPage /></RequireCapability>} />
        <Route path="master-data/feeders" element={<RequireCapability capability="feeders.view"><FeedersPage /></RequireCapability>} />
        <Route path="master-data/customers" element={<RequireCapability capability="customers.view"><CustomersPage /></RequireCapability>} />
        <Route path="master-data/warehouses" element={<RequireCapability capability="master_data.view"><WarehousesPage /></RequireCapability>} />
        <Route path="master-data/pole-contracts" element={<RequireCapability capability="master_data.view"><PoleContractsPage /></RequireCapability>} />
        <Route path="master-data/categories" element={<RequireCapability capability="master_data.view"><CategoriesPage /></RequireCapability>} />
        <Route path="permohonan" element={<RequireCapability capability="applications.view"><ApplicationsPage /></RequireCapability>} />
        <Route path="usulan" element={<RequireCapability capability="proposals.view"><ProposalsPage /></RequireCapability>} />
        <Route path="usulan/:id" element={<RequireCapability capability="proposals.view"><ProposalDetailPage /></RequireCapability>} />
        <Route path="survei" element={<RequireCapability capability="surveys.view"><SurveyRequestsPage /></RequireCapability>} />
        <Route path="wo-tiang" element={<Navigate to="/work-orders" replace />} />
        <Route path="wo-tiang/new" element={<RequireCapability capability="pole_wo.manage"><PoleWorkOrderFormPage /></RequireCapability>} />
        <Route path="wo-tiang/:id/revisi" element={<RequireCapability capability="pole_wo.manage"><PoleWorkOrderFormPage mode="revise" /></RequireCapability>} />
        <Route path="wo-tiang/:id/edit" element={<RequireCapability capability="pole_wo.manage"><PoleWorkOrderFormPage /></RequireCapability>} />
        <Route path="wo-tiang/:id" element={<RequireCapability anyOf={['pole_wo.view', 'vendor.portal']}><PoleWorkOrderDetailPage /></RequireCapability>} />
        <Route path="work-orders" element={<RequireCapability anyOf={['wo.view', 'pole_wo.view', 'vendor.portal']}><WorkOrdersPage /></RequireCapability>} />
        <Route path="work-orders/:applicationId" element={<RequireCapability anyOf={['wo.view', 'pole_wo.view', 'vendor.portal']}><WorkOrderAgendaPage /></RequireCapability>} />
        <Route path="material-requests" element={<Navigate to="/work-orders" replace />} />
        <Route path="rkm" element={<RequireCapability capability="rkm.view"><RkmPlansPage /></RequireCapability>} />
        <Route path="rkm/versions/:id" element={<RequireCapability capability="rkm.view"><RkmVersionDetailPage /></RequireCapability>} />
        <Route path="reports" element={<RequireCapability anyOf={['reports.view', 'rkm.view']}><ReportsPage /></RequireCapability>} />
        <Route path="reports/:reportType" element={<RequireCapability anyOf={['reports.view', 'rkm.view']}><ReportsPage /></RequireCapability>} />
        <Route path="survei/:id" element={<RequireCapability capability="surveys.view"><SurveyDetailPage /></RequireCapability>} />
        <Route path="gambar/:id" element={<RequireCapability capability="drawings.view"><DrawingDetailPage /></RequireCapability>} />
        <Route path="mto/:id" element={<RequireCapability capability="mto.view"><MtoDetailPage /></RequireCapability>} />
        <Route path="sistem/backup" element={<RequireCapability capability="backups.view"><BackupPage /></RequireCapability>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
