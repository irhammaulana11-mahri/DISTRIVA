import { useState } from 'react'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import BackupSummaryTab from '../../features/backup/BackupSummaryTab.jsx'
import BackupHistoryTab from '../../features/backup/BackupHistoryTab.jsx'
import BackupSettingsTab from '../../features/backup/BackupSettingsTab.jsx'
import BackupRestoresTab from '../../features/backup/BackupRestoresTab.jsx'
import { IconDatabase, IconClipboard, IconCog, IconRefresh, IconShield } from '../../components/icons.jsx'

const TABS = [
  { id: 'summary', label: 'Ringkasan', icon: IconDatabase },
  { id: 'history', label: 'Riwayat', icon: IconClipboard },
  { id: 'schedule', label: 'Jadwal', icon: IconCog },
  { id: 'restores', label: 'Pemulihan', icon: IconRefresh },
]

export default function BackupPage() {
  const { can } = useAccess()
  const [activeTab, setActiveTab] = useState('summary')
  const [summaryKey, setSummaryKey] = useState(0)

  const reloadSummary = () => {
    setSummaryKey((k) => k + 1)
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wider uppercase text-blue-300">
              <span>DISTRIVA</span>
              <span className="opacity-40">/</span>
              <span>PENGATURAN</span>
              <span className="opacity-40">/</span>
              <span className="text-white">BACKUP &amp; PEMULIHAN SISTEM</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md text-white border border-white/20 shadow-inner">
                <IconDatabase size={24} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Backup &amp; Pemulihan Sistem
                </h1>
                <p className="text-xs sm:text-sm text-blue-200/80 max-w-2xl mt-0.5">
                  Pengelolaan cadangan database PostgreSQL, verifikasi checksum SHA-256, simulasi restorasi snapshot, dan penjadwalan retensi berkas privat.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur-md px-3.5 py-2 text-xs text-blue-200 border border-white/10 shadow-xs">
              <IconShield size={14} className="text-blue-300" />
              <span>Otoritas: <strong className="text-white font-semibold">SYS_ADMIN</strong></span>
            </div>

            <button
              type="button"
              onClick={reloadSummary}
              title="Segarkan Ringkasan"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3.5 py-2 text-xs sm:text-sm font-semibold transition border border-white/15 cursor-pointer"
            >
              <IconRefresh size={15} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav
          className="flex space-x-2 sm:space-x-4 overflow-x-auto"
          role="tablist"
          aria-label="Tab navigasi backup dan pemulihan"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 font-bold'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab Panels */}
      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="outline-none"
      >
        {activeTab === 'summary' && (
          <BackupSummaryTab
            key={summaryKey}
            can={can}
            onSwitchTab={(tabId) => setActiveTab(tabId)}
          />
        )}
        {activeTab === 'history' && (
          <BackupHistoryTab can={can} onReloadSummary={reloadSummary} />
        )}
        {activeTab === 'schedule' && <BackupSettingsTab can={can} />}
        {activeTab === 'restores' && <BackupRestoresTab />}
      </div>
    </div>
  )
}
