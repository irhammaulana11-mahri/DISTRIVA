import { useState } from 'react'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import BackupSummaryTab from '../../features/backup/BackupSummaryTab.jsx'
import BackupHistoryTab from '../../features/backup/BackupHistoryTab.jsx'
import BackupSettingsTab from '../../features/backup/BackupSettingsTab.jsx'
import BackupRestoresTab from '../../features/backup/BackupRestoresTab.jsx'
import { IconDatabase, IconClipboard, IconCog, IconRefresh } from '../../components/icons.jsx'

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
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <IconDatabase size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Backup & Pemulihan Sistem
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pengelolaan cadangan database PostgreSQL dan arsip dokumen fisik secara privat, terverifikasi, dan terjadwal.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Kewenangan SYS_ADMIN
          </span>
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
                className={`flex items-center gap-2 py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer shrink-0 ${
                  isActive
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
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
