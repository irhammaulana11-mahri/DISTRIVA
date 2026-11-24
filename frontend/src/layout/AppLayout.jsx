import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { useAccess } from '../features/admin/AccessContext.jsx'
import { useNotifications, formatRelativeTime } from '../features/notifications/NotificationContext.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import {
  IconHome,
  IconUpload,
  IconUser,
  IconKey,
  IconUsers,
  IconBuilding,
  IconLogout,
  IconMenu,
  IconX,
  IconChevronDown,
  IconShield,
  IconFolder,
  IconSun,
  IconMoon,
  IconBell,
  IconCheck,
  IconExclamation,
  IconInfo,
  IconTag,
  IconClipboard,
  IconLayers,
  IconFileText,
  IconDocument,
  IconDatabase,
  IconMail,
  IconChart,
  IconZap,
  IconCalendar,
  IconTruck,
  IconWrench,
  IconCalculator,
  IconActivity,
  IconClock,
  IconAlertCircle,
  IconRefresh,
  IconBrandWhatsapp,
} from '../components/icons.jsx'
import { MODULE_DOMAINS } from '../features/modules/moduleRegistry.js'
import { resolveMenuProfiles, visibleForProfiles } from '../features/dashboard/profiles.js'

// Icon mapping for Distribution Modules
const MODULE_ICONS = {
  admin: IconUsers,
  'master-data': IconLayers,
  'aplikasi-pb-pd': IconFileText,
  'survey-meter': IconClipboard,
  drawing: IconLayers,
  'auto-mto': IconCalculator,
  rkm: IconCalendar,
  'rab-kkf': IconChart,
  'work-order': IconWrench,
  bastp: IconCheck,
  usulan: IconUsers,
  reporting: IconChart,
  backup: IconDatabase,
}

// 1. Menu Utama
const nav = [
  { to: '/', label: 'Dashboard', icon: IconHome, end: true },
]

// 2. Pelayanan & Operasional Jaringan (PB/PD, Tugas & SLA, Survei, Usulan, Pengukuran, SPK, Gudang)
const operationsNav = [
  { to: '/permohonan', label: 'Permohonan (PB/PD)', capability: 'applications.view', icon: IconFileText },
  { to: '/tugas', label: 'Tugas & SLA', capability: 'tasks.view', icon: IconClipboard },
  { to: '/survei', label: 'Usulan Survei', capability: 'surveys.view', icon: IconClipboard },
  { to: '/usulan', label: 'Usulan Perluasan', capability: 'proposals.view', icon: IconUsers },
  { to: '/master-data/substation-measurements', label: 'Pengukuran Gardu', capability: 'substations.view', icon: IconActivity },
  { to: '/work-orders', label: 'SPK & Work Order', anyOf: ['wo.view', 'pole_wo.view', 'vendor.portal'], icon: IconWrench },
  { to: '/master-data/warehouses', label: 'Gudang & Stok Material', capability: 'master_data.view', profiles: ['konstruksi', 'executive', 'mulp'], icon: IconBuilding },
]

// 3. Perencanaan & Logistik (kosong karena dipindah ke Laporan & Operasional)
const planningNav = []

// 3. Master Data (Dikelompokkan secara logis & disaring kewenangan)
const masterDataNav = [
  // Aset Jaringan & Pelanggan
  { to: '/master-data/substations', label: 'Master Gardu', capability: 'substations.view', icon: IconZap, group: 'Aset Jaringan & Pelanggan' },
  { to: '/master-data/feeders', label: 'Master Penyulang', capability: 'feeders.view', icon: IconLayers, group: 'Aset Jaringan & Pelanggan' },
  { to: '/master-data/customers', label: 'Master Pelanggan', capability: 'customers.view', icon: IconUsers, group: 'Aset Jaringan & Pelanggan' },
  { to: '/master-data/gangguan-sinkron', label: 'Data Gangguan (Sinkron)', capability: 'outages.view', icon: IconZap, group: 'Aset Jaringan & Pelanggan' },
  { to: '/master-data/laporan-eis', label: 'Laporan EIS Bulanan', capability: 'eis_reports.view', icon: IconFileText, group: 'Aset Jaringan & Pelanggan' },

  // Standar & Konstruksi
  { to: '/master-data/constructions', label: 'Standar Konstruksi', capability: 'master_data.view', profiles: ['perencanaan', 'jaringan', 'konstruksi', 'teknik', 'mulp', 'executive'], icon: IconLayers, group: 'Standar & Konstruksi' },
  { to: '/master-data/bom', label: 'Bill of Materials (BOM)', capability: 'master_data.view', profiles: ['perencanaan', 'konstruksi', 'teknik', 'mulp', 'executive'], icon: IconDocument, group: 'Standar & Konstruksi' },

  // Material & Logistik
  { to: '/master-data/materials', label: 'Katalog Material ERP', capability: 'master_data.view', profiles: ['perencanaan', 'konstruksi', 'executive', 'mulp'], icon: IconTag, group: 'Material & Logistik' },
  { to: '/master-data/mapping', label: 'Pemetaan SKU↔KHS', capability: 'master_data.view', profiles: ['perencanaan', 'konstruksi', 'executive', 'mulp'], icon: IconTag, group: 'Material & Logistik' },
  { to: '/master-data/categories', label: 'Kategori & Satuan', capability: 'master_data.view', profiles: ['perencanaan', 'konstruksi', 'executive', 'mulp'], icon: IconFolder, group: 'Material & Logistik' },

  // Keuangan & Tarif
  { to: '/master-data/khs', label: 'Katalog Harga Satuan (KHS)', capability: 'master_data.view', profiles: ['perencanaan', 'executive', 'mulp'], icon: IconClipboard, group: 'Keuangan & Tarif' },
  { to: '/master-data/harga', label: 'Buku Harga Kontrak', capability: 'master_data.view', profiles: ['perencanaan', 'executive', 'mulp'], icon: IconTag, group: 'Keuangan & Tarif' },
  { to: '/master-data/pole-contracts', label: 'Kontrak Rinci Tiang', capability: 'master_data.view', profiles: ['perencanaan', 'konstruksi', 'executive', 'mulp'], icon: IconClipboard, group: 'Keuangan & Tarif' },
  { to: '/master-data/kkf-parameters', label: 'Parameter KKF', capability: 'master_data.view', profiles: ['perencanaan', 'executive', 'mulp'], icon: IconChart, group: 'Keuangan & Tarif' },
  { to: '/master-data/tariff-books', label: 'Buku Tarif Listrik', capability: 'master_data.view', profiles: ['perencanaan', 'executive', 'mulp'], icon: IconZap, group: 'Keuangan & Tarif' },
  { to: '/master-data/excel-import', label: 'Impor dari Excel', anyOf: ['bom.manage', 'prices.manage', 'tariffs.manage'], profiles: ['perencanaan'], icon: IconUpload, group: 'Keuangan & Tarif' },
]

// 4. Laporan & Monitoring (RKM, Forecasting, serta sub-halaman analitika)
const reportsNav = [
  { to: '/reports/overview', tabId: 'overview', label: 'Ringkasan Eksekutif', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'jaringan', 'konstruksi', 'niaga', 'admin'], icon: IconChart },
  { to: '/nko', label: 'NKO & Kinerja Unit', capability: 'nko.view', icon: IconChart },
  { to: '/rkm', label: 'RKM Distribusi', capability: 'rkm.view', profiles: ['perencanaan', 'jaringan', 'teknik', 'mulp', 'executive'], icon: IconCalendar },
  { to: '/forecast', label: 'Forecasting', capability: 'forecast.view', icon: IconChart },
  { to: '/analisis-pelanggan', label: 'Analisis Pelanggan & Daya', anyOf: ['reports.view', 'forecast.view'], icon: IconUsers },
  { to: '/analisis-gangguan', label: 'Analisis Gangguan', capability: 'outages.view', icon: IconActivity },
  { to: '/reports/pipeline', tabId: 'pipeline', label: 'Alur Pekerjaan (Funnel)', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'jaringan', 'konstruksi', 'niaga', 'admin'], icon: IconActivity },
  { to: '/reports/sla', tabId: 'sla', label: 'Siklus Waktu & SLA', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'jaringan', 'konstruksi', 'niaga', 'admin'], icon: IconClock },
  { to: '/reports/cost-variance', tabId: 'costVariance', label: 'Realisasi Biaya (RAB/SPK)', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'admin'], icon: IconCalculator },
  { to: '/reports/critical-stock', tabId: 'criticalStock', label: 'Stok Kritis & Material', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'konstruksi', 'admin'], icon: IconTruck },
  { to: '/reports/vendor-performance', tabId: 'vendorPerformance', label: 'Rapor Kinerja Vendor', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'jaringan', 'konstruksi', 'admin'], icon: IconClipboard },
  { to: '/reports/kkf-feasibility', tabId: 'kkfFeasibility', label: 'Analisis Kelayakan KKF', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'admin'], icon: IconZap },
  { to: '/reports/erp-anomalies', tabId: 'erpAnomalies', label: 'Anomali & Rekonsiliasi', capability: 'reports.view', profiles: ['executive', 'mulp', 'teknik', 'perencanaan', 'admin'], icon: IconAlertCircle },
]

// 5. Analisa & Tren Pengusahaan (Indikator Pengusahaan)
const pengusahaanNav = [
  { to: '/pengusahaan', label: 'Semua Indikator (Ikhtisar)', capability: 'pengusahaan.view', icon: IconChart, end: true },
  { to: '/pengusahaan/pelanggan', label: 'Pelanggan', capability: 'pengusahaan.view', icon: IconUsers },
  { to: '/pengusahaan/daya', label: 'Daya Tersambung', capability: 'pengusahaan.view', icon: IconZap },
  { to: '/pengusahaan/kwh-jual', label: 'kWh Jual', capability: 'pengusahaan.view', icon: IconActivity },
  { to: '/pengusahaan/pendapatan', label: 'Pendapatan', capability: 'pengusahaan.view', icon: IconCalculator },
  { to: '/pengusahaan/piutang-prabayar', label: 'Piutang Prabayar', capability: 'pengusahaan.view', icon: IconFileText },
  { to: '/pengusahaan/piutang-pascabayar', label: 'Piutang Pascabayar', capability: 'pengusahaan.view', icon: IconFileText },
  { to: '/pengusahaan/piutang-pascabayar-umur', label: 'Umur Piutang Pascabayar', capability: 'pengusahaan.view', icon: IconClock },
  { to: '/pengusahaan/rpt-rct-keluhan', label: 'RPT-RCT Keluhan', capability: 'pengusahaan.view', icon: IconAlertCircle },
  { to: '/pengusahaan/rpt-rct-gangguan', label: 'RPT-RCT Gangguan', capability: 'pengusahaan.view', icon: IconActivity },
  { to: '/pengusahaan/saidi-saifi', label: 'SAIDI & SAIFI', capability: 'pengusahaan.view', icon: IconZap },
  { to: '/pengusahaan/ens', label: 'ENS (Energi Tak Tersalur)', capability: 'pengusahaan.view', icon: IconZap },
  { to: '/pengusahaan/kwh-p2tl', label: 'kWh P2TL', capability: 'pengusahaan.view', icon: IconShield },
  { to: '/pengusahaan/gangguan', label: 'Gangguan Penyulang', capability: 'pengusahaan.view', icon: IconActivity },
  { to: '/pengusahaan/hpl-bp', label: 'HPL Biaya Penyambungan', capability: 'pengusahaan.view', icon: IconTag },
  { to: '/pengusahaan/susut', label: 'Susut Distribusi', capability: 'pengusahaan.view', icon: IconChart },
]

// 5. Administrasi (Pengguna, Unit, Mitra)
const adminNav = [
  { to: '/admin/users', label: 'Pengguna', capability: 'users.view', icon: IconUsers },
  { to: '/admin/units', label: 'Unit Organisasi', capability: 'organizational_units.view', icon: IconBuilding },
  { to: '/master-data/vendors', label: 'Mitra & Vendor', capability: 'vendors.manage', icon: IconTruck },
]

// 6. Pengaturan & Sistem (MFA, WhatsApp, Backup)
const settingsNav = [
  { to: '/pengaturan/mfa', label: 'Keamanan MFA', capability: 'mfa.manage', sysAdminOnly: true, icon: IconShield },
  { to: '/pengaturan/whatsapp', label: 'Pengaturan WhatsApp', capability: 'whatsapp.settings.manage', sysAdminOnly: true, icon: IconBrandWhatsapp },
  { to: '/sistem/backup', label: 'Backup & Pemulihan', capability: 'backups.view', icon: IconDatabase },
]

const REPORT_TITLES = {
  overview: 'Ringkasan Eksekutif & KPI',
  pipeline: 'Alur Pekerjaan per ULP (Funnel)',
  sla: 'Siklus Waktu & SLA (Lead Time)',
  costVariance: 'Realisasi Biaya (RAB vs SPK)',
  'cost-variance': 'Realisasi Biaya (RAB vs SPK)',
  vendorPerformance: 'Rapor Kinerja Mitra & Vendor',
  'vendor-performance': 'Rapor Kinerja Mitra & Vendor',
  criticalStock: 'Stok Kritis & Buffer Material',
  'critical-stock': 'Stok Kritis & Buffer Material',
  kkfFeasibility: 'Analisis Kelayakan KKF',
  'kkf-feasibility': 'Analisis Kelayakan KKF',
  erpAnomalies: 'Anomali & Rekonsiliasi ERP',
  'erp-anomalies': 'Anomali & Rekonsiliasi ERP',
}

const titles = {
  '/': 'Dashboard',
  '/profil': 'Profil & Keamanan Akun',
  '/ubah-password': 'Profil & Keamanan Akun / Ubah Password',
  '/mfa': 'Pengaturan / Autentikasi Dua Faktor (MFA)',
  '/tugas': 'Operasional / Tugas & SLA',
  '/forecast': 'Laporan & Monitoring / Forecasting',
  '/analisis-pelanggan': 'Laporan & Monitoring / Analisis Pelanggan & Daya',
  '/analisis-gangguan': 'Laporan & Monitoring / Analisis Gangguan',
  '/nko': 'Laporan & Monitoring / Nilai Kinerja Organisasi (NKO)',
  '/permohonan': 'Operasional / Permohonan (PB/PD)',
  '/permohonan/sinkronisasi-eis': 'Operasional / Sinkronisasi EIS',
  '/survei': 'Operasional / Usulan Survei',
  '/usulan': 'Operasional / Usulan Perluasan',
  '/work-orders': 'Operasional / Surat Perintah Kerja (SPK / WO)',
  '/rkm': 'Laporan & Monitoring / RKM Distribusi',
  '/master-data/warehouses': 'Operasional / Gudang & Stok Material',
  '/master-data/warehouses/tarik-mims': 'Operasional / Tarik Stok MIMS',
  '/master-data/substations': 'Master Data / Master Gardu',
  '/master-data/substation-measurements': 'Operasional / Pengukuran Gardu',
  '/master-data/substation-measurements/sinkronisasi-maximo': 'Operasional / Pengukuran Gardu / Sinkronisasi Maximo',
  '/master-data/feeders': 'Master Data / Master Penyulang',
  '/master-data/customers': 'Master Data / Master Pelanggan',
  '/master-data/gangguan-sinkron': 'Master Data / Data Gangguan (Sinkron)',
  '/master-data/laporan-eis': 'Master Data / Laporan Bulanan EIS/AP2T',
  '/master-data/materials': 'Master Data / Katalog Material ERP',
  '/master-data/khs': 'Master Data / Katalog Harga Satuan (KHS)',
  '/master-data/mapping': 'Master Data / Pemetaan SKU↔KHS',
  '/master-data/constructions': 'Master Data / Standar Konstruksi',
  '/master-data/bom': 'Master Data / Bill of Materials (BOM)',
  '/master-data/harga': 'Master Data / Buku Harga Kontrak',
  '/master-data/pole-contracts': 'Master Data / Kontrak Rinci Tiang',
  '/master-data/kkf-parameters': 'Master Data / Parameter Kelayakan Keuangan (KKF)',
  '/master-data/tariff-books': 'Master Data / Buku Tarif Listrik',
  '/master-data/excel-import': 'Master Data / Impor dari Excel',
  '/master-data/categories': 'Master Data / Kategori & Satuan',
  '/admin/users': 'Administrasi / Pengguna',
  '/admin/users/new': 'Administrasi / Pengguna / Tambah',
  '/admin/units': 'Administrasi / Unit Organisasi',
  '/admin/units/baru': 'Administrasi / Unit Organisasi / Tambah',
  '/master-data/vendors': 'Administrasi / Mitra & Vendor',
  '/reports': 'Laporan & Monitoring / Pusat Analitika Eksekutif',
  '/pengaturan/mfa': 'Pengaturan / Keamanan MFA',
  '/pengaturan/whatsapp': 'Pengaturan / Pengaturan WhatsApp',
  '/sistem/backup': 'Pengaturan / Backup & Pemulihan Sistem',
}

const titleFor = (path, search = '') => {
  if (path.startsWith('/pengusahaan')) {
    return 'Laporan & Monitoring / Analisa Pengusahaan'
  }
  if (path.startsWith('/reports')) {
    const slug = path.replace('/reports', '').replace(/^\//, '')
    const params = new URLSearchParams(search)
    const tab = slug || params.get('tab') || 'overview'
    return `Laporan & Monitoring / ${REPORT_TITLES[tab] || 'Ringkasan Eksekutif & KPI'}`
  }
  if (titles[path]) return titles[path]
  if (path.startsWith('/admin/users/')) return 'Administrasi / Pengguna / Detail'
  if (path.startsWith('/admin/units/')) return 'Administrasi / Unit Organisasi / Detail'
  if (path.startsWith('/master-data/vendors/')) return 'Administrasi / Mitra & Vendor / Profil'
  if (path.startsWith('/work-orders/')) return 'Operasional / SPK / WO / Detail Agenda'
  if (path.startsWith('/wo-tiang/')) return 'Operasional / SPK / WO / WO Tiang'
  if (path.startsWith('/bastp/')) return 'Operasional / BASTP / Berita Acara Serah Terima'
  if (path.startsWith('/permohonan/baru')) return 'Operasional / Permohonan (PB/PD) / Permohonan Baru'
  if (path.startsWith('/permohonan/impor')) return 'Operasional / Permohonan (PB/PD) / Impor Berkas'
  if (path.startsWith('/permohonan/')) return 'Operasional / Permohonan (PB/PD) / Detail Permohonan'
  if (path.startsWith('/tugas/')) return 'Operasional / Tugas & SLA / Detail Tugas'
  if (path.startsWith('/usulan/')) return 'Operasional / Usulan Perluasan / Detail'
  if (path.startsWith('/master-data/warehouses/')) return 'Operasional / Gudang / Detail & Impor Stok'
  if (path.startsWith('/master-data/materials/impor')) return 'Master Data / Katalog Material ERP / Impor'
  if (path.startsWith('/master-data/materials/')) return 'Master Data / Katalog Material ERP / Ubah'
  if (path.startsWith('/master-data/khs/impor')) return 'Master Data / Katalog Harga Satuan (KHS) / Impor'
  if (path.startsWith('/master-data/khs/')) return 'Master Data / Katalog Harga Satuan (KHS) / Koreksi'
  if (path.startsWith('/master-data/mapping/impor')) return 'Master Data / Pemetaan Material / Impor'
  if (path.startsWith('/master-data/constructions/impor')) return 'Master Data / Standar Konstruksi / Impor'
  if (path.startsWith('/master-data/bom/impor')) return 'Master Data / Bill of Materials (BOM) / Impor'
  if (path.startsWith('/master-data/bom/')) return 'Master Data / Bill of Materials (BOM) / Detail'
  if (path.startsWith('/master-data/harga/impor')) return 'Master Data / Buku Harga Kontrak / Impor'
  if (path.startsWith('/master-data/harga/')) return 'Master Data / Detail Buku Harga Kontrak'
  if (path.startsWith('/master-data/tariff-books/impor')) return 'Master Data / Buku Tarif Listrik / Impor'
  if (path.startsWith('/master-data/tariff-books/')) return 'Master Data / Detail Buku Tarif Listrik'
  if (path.startsWith('/master-data/pole-contracts/impor')) return 'Master Data / Kontrak Rinci Tiang / Impor'
  if (path.startsWith('/master-data/pole-contracts/')) return 'Master Data / Kontrak Rinci Tiang / Detail'
  if (path.startsWith('/master-data/categories/satuan/')) return 'Master Data / Kategori & Satuan / Satuan'
  if (path.startsWith('/master-data/categories/')) return 'Master Data / Kategori & Satuan / Detail'
  if (path.startsWith('/master-data/substations/impor')) return 'Master Data / Master Gardu / Impor'
  if (path.startsWith('/master-data/substations/')) return 'Master Data / Master Gardu / Detail'
  if (path.startsWith('/master-data/feeders/impor')) return 'Master Data / Master Penyulang / Impor'
  if (path.startsWith('/master-data/customers/impor')) return 'Master Data / Master Pelanggan / Impor'
  if (path === '/master-data/substation-measurements/sinkronisasi-maximo') return 'Operasional / Pengukuran Gardu / Sinkronisasi Maximo'
  if (path.startsWith('/master-data/substation-measurements/')) return 'Operasional / Pengukuran Gardu / Detail'
  if (path.startsWith('/master-data/kkf-parameters/')) return 'Master Data / Detail Parameter KKF'
  if (path.startsWith('/rkm/versions/')) return 'Laporan & Monitoring / RKM / Detail Versi'
  if (path.startsWith('/survei/')) return 'Operasional / Usulan Survei / Detail'
  if (path.startsWith('/gambar/')) return 'Operasional / Detail Gambar Teknik'
  if (path.startsWith('/mto/')) return 'Operasional / Detail MTO'
  if (path.startsWith('/modul/')) {
    const slug = path.replace('/modul/', '')
    const mod = MODULE_DOMAINS.find((m) => m.slug === slug)
    return mod ? `Modul / ${mod.name}` : 'Modul'
  }
  return '—'
}

// Helper to determine which sidebar section is active for a given pathname
const getSectionForPath = (path) => {
  if (path.startsWith('/admin') || path.startsWith('/master-data/vendors')) return 'admin'
  if (path.startsWith('/pengusahaan')) return 'pengusahaan'
  if (
    path.startsWith('/rkm') ||
    path.startsWith('/forecast') ||
    path.startsWith('/analisis-pelanggan') ||
    path.startsWith('/analisis-gangguan') ||
    path.startsWith('/nko') ||
    path.startsWith('/reports')
  ) {
    return 'reports'
  }
  if (
    path.startsWith('/master-data/warehouses') ||
    path.startsWith('/master-data/substation-measurements') ||
    path.startsWith('/permohonan') ||
    path.startsWith('/tugas') ||
    path.startsWith('/survei') ||
    path.startsWith('/usulan') ||
    path.startsWith('/work-orders') ||
    path.startsWith('/wo-tiang') ||
    path.startsWith('/bastp') ||
    path.startsWith('/gambar') ||
    path.startsWith('/mto')
  ) {
    return 'operations'
  }
  if (path.startsWith('/master-data')) return 'masterData'
  if (path.startsWith('/sistem') || path.startsWith('/pengaturan') || path === '/mfa') return 'settings'
  if (path.startsWith('/modul')) return 'modules'
  if (path === '/') return 'main'
  return null
}

export default function AppLayout() {
  const { user, logout, mustChangePassword, mfaState } = useAuth()
  const location = useLocation()
  const { pathname, search } = location
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const [open, setOpen] = useState(false)

  // Accordion state: by default active section is expanded, inactive sections collapse
  const [expandedSections, setExpandedSections] = useState(() => {
    const active = getSectionForPath(pathname)
    return {
      main: active === 'main' || !active,
      operations: active === 'operations',
      planning: active === 'planning',
      masterData: active === 'masterData',
      reports: active === 'reports',
      pengusahaan: active === 'pengusahaan',
      admin: active === 'admin',
      settings: active === 'settings',
      modules: active === 'modules',
    }
  })

  // Keep active section expanded and inactive collapsed on route change
  useEffect(() => {
    const active = getSectionForPath(pathname)
    setExpandedSections({
      main: active === 'main' || !active,
      operations: active === 'operations',
      planning: active === 'planning',
      masterData: active === 'masterData',
      reports: active === 'reports',
      pengusahaan: active === 'pengusahaan',
      admin: active === 'admin',
      settings: active === 'settings',
      modules: active === 'modules',
    })
  }, [pathname, search])

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const willBeOpen = !prev[sectionKey]
      if (willBeOpen) {
        return {
          main: sectionKey === 'main',
          operations: sectionKey === 'operations',
          planning: sectionKey === 'planning',
          masterData: sectionKey === 'masterData',
          reports: sectionKey === 'reports',
          pengusahaan: sectionKey === 'pengusahaan',
          admin: sectionKey === 'admin',
          settings: sectionKey === 'settings',
          modules: sectionKey === 'modules',
          [sectionKey]: true,
        }
      }
      return {
        ...prev,
        [sectionKey]: false,
      }
    })
  }

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Dark / Light Theme state with persistence & system preference fallback
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('distriva.theme') : null
    if (saved === 'dark' || saved === 'light') return saved
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      localStorage.setItem('distriva.theme', theme)
    } catch {
      // ignore
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Notifications state from shared NotificationContext
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)
  const {
    notifications,
    unreadCount,
    loading: notifLoading,
    error: notifError,
    markAllRead,
    markRead,
  } = useNotifications()

  // Close mobile drawer, user dropdown, and notif dropdown on route change
  useEffect(() => {
    setOpen(false)
    setDropdownOpen(false)
    setNotifOpen(false)
  }, [pathname])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close mobile drawer and dropdowns on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setDropdownOpen(false)
        setNotifOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Menu disaring menurut profil kerja (petunjuk tampilan; server tetap menegakkan izin).
  const userProfiles = resolveMenuProfiles({ can, isSysAdmin })
  const showModuleRoadmap = isSysAdmin || userProfiles.includes('admin')

  const mainItems = mustChangePassword
    ? nav.filter((n) => n.to === '/ubah-password')
    : nav

  const accessibleOperationsItems = mustChangePassword
    ? []
    : operationsNav.filter(
        (n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]) && visibleForProfiles(n, userProfiles),
      )

  const accessiblePlanningItems = mustChangePassword
    ? []
    : planningNav.filter(
        (n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]) && visibleForProfiles(n, userProfiles),
      )

  const accessibleMasterDataItems = mustChangePassword
    ? []
    : masterDataNav.filter((n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]) && visibleForProfiles(n, userProfiles))

  const accessibleReportsItems = mustChangePassword
    ? []
    : reportsNav.filter(
        (n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]) && visibleForProfiles(n, userProfiles),
      )

  const accessiblePengusahaanItems = mustChangePassword
    ? []
    : pengusahaanNav.filter(
        (n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]) && visibleForProfiles(n, userProfiles),
      )

  const accessibleAdminItems = mustChangePassword
    ? []
    : adminNav.filter((n) => (n.anyOf ? n.anyOf.some((c) => Boolean(can[c])) : can[n.capability]))

  const accessibleSettingsItems = mustChangePassword
    ? []
    : settingsNav.filter((n) => {
        if (n.to === '/pengaturan/mfa' || n.to === '/mfa') return Boolean(isSysAdmin || mfaState?.required)
        if (n.sysAdminOnly) return Boolean(isSysAdmin)
        return Boolean(can[n.capability])
      })

  const isLinkActive = (item) => {
    if (item.to.includes('?')) {
      const [targetPath, targetSearch] = item.to.split('?')
      if (pathname !== targetPath) return false
      const currentParams = new URLSearchParams(search)
      const targetParams = new URLSearchParams(targetSearch)
      const curTab = currentParams.get('tab') || 'overview'
      const targetTab = targetParams.get('tab') || 'overview'
      return curTab === targetTab
    }
    if (pathname.startsWith('/reports') && item.tabId) {
      if (pathname === item.to) return true
      const slug = pathname.replace('/reports', '').replace(/^\//, '')
      if (slug && (slug === item.tabId || slug === item.to.replace('/reports/', ''))) return true
      if (pathname === '/reports') {
        const curTab = new URLSearchParams(search).get('tab') || 'overview'
        return curTab === item.tabId
      }
    }
    return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row transition-colors duration-200">
      {/* Mobile Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm transition-opacity md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: Mobile Drawer & Desktop Fixed */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-100 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img src="/distriva-icon.png" alt="DISTRIVA" className="h-9 w-9 object-contain drop-shadow" />
            <div>
              <div className="text-base font-bold tracking-tight text-white leading-tight">DISTRIVA</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Distribution Platform</div>
            </div>
          </div>
          <button
            type="button"
            className="md:hidden rounded p-1 text-slate-400 hover:text-white"
            onClick={() => setOpen(false)}
            aria-label="Tutup menu"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Navigation items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3.5 sidebar-scroll">
          {/* 1. Main Navigation */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection('main')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              aria-expanded={expandedSections.main}
            >
              <div className="flex items-center gap-1.5 min-w-0 pr-1">
                <span className="truncate">Menu Utama</span>
                {getSectionForPath(pathname) === 'main' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                )}
              </div>
              <IconChevronDown
                size={14}
                className={`shrink-0 transform transition-transform duration-200 ${expandedSections.main ? 'rotate-180' : ''}`}
              />
            </button>
            <div
              className={`overflow-hidden transition-all duration-200 ease-in-out ${
                expandedSections.main ? 'max-h-[500px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
              }`}
            >
              <nav aria-label="Navigasi utama" className="space-y-1">
                {mainItems.map((n) => {
                  const Icon = n.icon
                  const active = isLinkActive(n)
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {Icon && <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />}
                      <span>{n.label}</span>
                    </NavLink>
                  )
                })}
              </nav>
            </div>
          </div>

          {/* 2. Operasional Navigation */}
          {accessibleOperationsItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('operations')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.operations}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Operasional</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessibleOperationsItems.length})</span>
                  {getSectionForPath(pathname) === 'operations' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.operations ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.operations ? 'max-h-[600px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi operasional" className="space-y-1">
                  {accessibleOperationsItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span>{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* 3. Perencanaan & Logistik Navigation */}
          {accessiblePlanningItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('planning')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.planning}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Perencanaan &amp; Logistik</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessiblePlanningItems.length})</span>
                  {getSectionForPath(pathname) === 'planning' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.planning ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.planning ? 'max-h-[500px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi perencanaan dan logistik" className="space-y-1">
                  {accessiblePlanningItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span>{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* 4. Master Data Navigation (Grouped Thematically) */}
          {accessibleMasterDataItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('masterData')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.masterData}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Master Data</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessibleMasterDataItems.length})</span>
                  {getSectionForPath(pathname) === 'masterData' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.masterData ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.masterData ? 'max-h-[1400px] opacity-100 mt-2 pb-2' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi master data" className="space-y-1">
                  {(() => {
                    let lastGroup = null
                    return accessibleMasterDataItems.map((n) => {
                      const Icon = n.icon
                      const showGroupHeader = n.group && n.group !== lastGroup
                      if (n.group) lastGroup = n.group
                      const active = isLinkActive(n)

                      return (
                        <div key={n.to}>
                          {showGroupHeader && (
                            <div className="pt-4 pb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-700/60 mt-7 mb-2 first:mt-1 first:pt-1 first:border-0">
                              {n.group}
                            </div>
                          )}
                          <NavLink
                            to={n.to}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-3 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
                              active
                                ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            {Icon && <Icon size={16} className={active ? 'text-white' : 'text-slate-400'} />}
                            <span className="truncate">{n.label}</span>
                          </NavLink>
                        </div>
                      )
                    })
                  })()}
                </nav>
              </div>
            </div>
          )}

          {/* 5. Laporan & Monitoring Navigation (Role-based subpages) */}
          {accessibleReportsItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('reports')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.reports}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Laporan &amp; Monitoring</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessibleReportsItems.length})</span>
                  {getSectionForPath(pathname) === 'reports' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.reports ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.reports ? 'max-h-[600px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi laporan dan monitoring" className="space-y-1">
                  {accessibleReportsItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={16} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span className="truncate">{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* 6. Analisa & Tren Pengusahaan (Label Tersendiri & Indikator Pengusahaan) */}
          {accessiblePengusahaanItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('pengusahaan')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.pengusahaan}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Analisa &amp; Tren Pengusahaan</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessiblePengusahaanItems.length})</span>
                  {getSectionForPath(pathname) === 'pengusahaan' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.pengusahaan ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.pengusahaan ? 'max-h-[800px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi analisa pengusahaan" className="space-y-1">
                  {accessiblePengusahaanItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.end}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={16} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span className="truncate">{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* 6. Administrasi Navigation (conditional on capabilities) */}
          {accessibleAdminItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('admin')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.admin}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Administrasi</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessibleAdminItems.length})</span>
                  {getSectionForPath(pathname) === 'admin' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.admin ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.admin ? 'max-h-[500px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi administrasi" className="space-y-1">
                  {accessibleAdminItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span>{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* 7. Pengaturan & Sistem Navigation */}
          {accessibleSettingsItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('settings')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.settings}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Pengaturan</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({accessibleSettingsItems.length})</span>
                  {getSectionForPath(pathname) === 'settings' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.settings ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.settings ? 'max-h-[500px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <nav aria-label="Navigasi pengaturan" className="space-y-1">
                  {accessibleSettingsItems.map((n) => {
                    const Icon = n.icon
                    const active = isLinkActive(n)
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/20'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {Icon && <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />}
                        <span>{n.label}</span>
                      </NavLink>
                    )
                  })}
                </nav>
              </div>
            </div>
          )}

          {/* Distribution Modules Roadmap (informative, collapsible) */}
          {!mustChangePassword && showModuleRoadmap && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection('modules')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                aria-expanded={expandedSections.modules}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className="truncate">Modul Distribusi</span>
                  <span className="shrink-0 text-[10px] text-slate-400 font-mono">({MODULE_DOMAINS.length - 1})</span>
                  {getSectionForPath(pathname) === 'modules' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-blue-500/30 shrink-0 ml-0.5" />
                  )}
                </div>
                <IconChevronDown
                  size={14}
                  className={`shrink-0 transform transition-transform duration-200 ${expandedSections.modules ? 'rotate-180' : ''}`}
                />
              </button>

              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  expandedSections.modules ? 'max-h-[600px] opacity-100 mt-1' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
              >
                <div className="space-y-0.5 pl-2 border-l border-slate-800 ml-3">
                  {MODULE_DOMAINS.filter((m) => m.slug !== 'admin').map((m) => {
                    const Icon = MODULE_ICONS[m.slug] || IconLayers
                    return (
                      <NavLink
                        key={m.slug}
                        to={`/modul/${m.slug}`}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center justify-between rounded px-2.5 py-1.5 text-xs transition-colors ${
                            isActive
                              ? 'bg-slate-800 text-blue-400 font-semibold'
                              : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                          }`
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon size={16} className="text-slate-400 shrink-0" />
                          <span className="truncate">{m.name}</span>
                        </div>
                        <span className="text-[10px] bg-slate-800 text-amber-400 px-1 py-0.2 rounded font-mono shrink-0 ml-1">
                          Roadmap
                        </span>
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-slate-800 p-3.5 bg-slate-950/40">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-[11px]">v0.1.0-alpha</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              API Guarded
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-4 backdrop-blur sm:px-6 shadow-xs transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-ring cursor-pointer"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <IconMenu size={20} className="mr-1" />
              <span>Menu</span>
            </button>
            <nav aria-label="Breadcrumb" className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate max-w-[130px] xs:max-w-[180px] sm:max-w-none">
              DISTRIVA / <span className="font-medium text-slate-900 dark:text-slate-100">{titleFor(pathname, search)}</span>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Scope context badge */}
            <div className="hidden lg:flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              <IconShield size={14} className="text-slate-400 dark:text-slate-500" />
              <span>Scope: <strong className="font-medium text-slate-700 dark:text-slate-200">{isSysAdmin || mfaState?.required ? 'GLOBAL' : 'SAME_UNIT'}</strong></span>
            </div>

            {/* Dark / Light Mode Switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle tema gelap/terang"
              title={theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-ring cursor-pointer shadow-2xs"
            >
              {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </button>

            {/* Notification Bell with Badge & Dropdown */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                aria-expanded={notifOpen}
                aria-haspopup="true"
                aria-label="Notifikasi"
                title={unreadCount > 0 ? `Notifikasi Sistem (${unreadCount} belum dibaca)` : 'Notifikasi Sistem'}
                className="relative flex h-11 w-11 sm:h-9 sm:w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-ring cursor-pointer shadow-2xs"
              >
                <IconBell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                {unreadCount > 0 && (
                  <span className="sr-only">({unreadCount} belum dibaca)</span>
                )}
              </button>

              {/* Notifications Dropdown Panel */}
              {notifOpen && (
                <div
                  className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm rounded-xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-700/50 border border-slate-100 dark:border-slate-800 z-50 overflow-hidden"
                  role="region"
                  aria-label="Daftar notifikasi"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                        Notifikasi
                      </span>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          {unreadCount} baru
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Tandai semua dibaca
                      </button>
                    )}
                  </div>

                  {notifError && (
                    <div className="px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800/60">
                      {notifError}
                    </div>
                  )}

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifLoading && notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        Memuat notifikasi…
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        Belum ada notifikasi
                      </div>
                    ) : (
                      notifications.map((item) => {
                        const level = item.level || item.type || 'info'
                        const isUnread = !item.read_at && item.unread !== false
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              markRead(item.id)
                              if (
                                typeof item.link === 'string' &&
                                item.link.startsWith('/') &&
                                !item.link.startsWith('//')
                              ) {
                                navigate(item.link)
                                setNotifOpen(false)
                              }
                            }}
                            className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                              isUnread
                                ? 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                                level === 'warning'
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                                  : level === 'error'
                                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                                  : level === 'success'
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                              }`}
                            >
                              {level === 'warning' || level === 'error' ? (
                                <IconExclamation size={14} />
                              ) : level === 'success' ? (
                                <IconCheck size={14} />
                              ) : (
                                <IconInfo size={14} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {isUnread && (
                                    <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                                  )}
                                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {item.title}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-mono">
                                  {formatRelativeTime(item.created_at)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                                {item.body ?? item.desc}
                              </p>
                              {item.tag && (
                                <span className="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                  {item.tag}
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>

                  <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-center">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      Notifikasi operasional otomatis tersinkronisasi
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* User Profile & Logout Dropdown */}
            {user && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen((prev) => !prev)}
                  className="flex items-center gap-2.5 rounded-lg p-1.5 sm:px-2.5 sm:py-1.5 text-left border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors focus-ring shadow-2xs cursor-pointer"
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  aria-label="Menu pengguna"
                >
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs uppercase shadow-xs">
                    {user.name ? user.name.slice(0, 2) : 'U'}
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" />
                  </div>
                  <div className="hidden sm:flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate max-w-[140px]">
                      {user.name}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                      {user.account_status === 'ACTIVE' ? 'Aktif' : user.account_status ?? 'Pengguna'}
                    </span>
                  </div>
                  <IconChevronDown
                    size={14}
                    className={`hidden sm:block text-slate-400 dark:text-slate-500 transition-transform duration-150 ${
                      dropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Floating Dropdown Panel */}
                {dropdownOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-slate-900 p-2 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-700/50 border border-slate-100 dark:border-slate-800 z-50"
                    role="menu"
                    aria-label="Menu akun"
                  >
                    <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 mb-1">
                      <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">{user.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</div>
                      {user.nip && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">NIP: {user.nip}</div>
                      )}
                      <div className="mt-2 flex items-center gap-1.5">
                        <StatusBadge status={user.account_status ?? 'ACTIVE'} />
                        <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                          SAME_UNIT
                        </span>
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <NavLink
                        to="/profil"
                        onClick={() => setDropdownOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                            isActive && !pathname.includes('tab=password')
                              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                          }`
                        }
                      >
                        <IconUser size={15} className="text-slate-400 dark:text-slate-500" />
                        <span>Profil & Keamanan Akun</span>
                      </NavLink>

                      <NavLink
                        to="/profil?tab=password"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <IconKey size={15} className="text-slate-400 dark:text-slate-500" />
                        <span>Ubah Password</span>
                      </NavLink>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800 mt-1.5 pt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDropdownOpen(false)
                          logout()
                        }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                      >
                        <IconLogout size={15} className="text-red-500 dark:text-red-400" />
                        <span>Keluar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page Content: Edge-to-Edge with clean padding matching reference image */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 w-full">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
