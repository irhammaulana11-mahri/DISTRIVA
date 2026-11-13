import { useState, useEffect } from 'react'
import { backupApi } from '../../services/api.js'
import { formatDateTime } from './backupUtils.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { IconRefresh, IconShield } from '../../components/icons.jsx'

export default function BackupRestoresTab() {
  const [restores, setRestores] = useState([])
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 10 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailRestore, setDetailRestore] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState('')

  const loadRestores = async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const res = await backupApi.restores({ page, per_page: perPage })
      setRestores(res.data || [])
      if (res.meta) setMeta(res.meta)
    } catch (err) {
      setError(err.message || 'Gagal memuat riwayat pemulihan.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadRestores()
  }, [page, perPage])

  const handleOpenDetail = async (id) => {
    setDetailModalOpen(true)
    setLoadingDetail(true)
    setDetailError('')
    setDetailRestore(null)
    try {
      const res = await backupApi.getRestore(id)
      setDetailRestore(res.data)
    } catch (err) {
      setDetailError(err.message || 'Gagal memuat rincian riwayat pemulihan.')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex items-center justify-between text-xs">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-slate-100">
            Riwayat Pemulihan Database (Audit Trail)
          </h4>
          <p className="text-slate-500 mt-0.5">
            Setiap aksi pemulihan dicatat secara permanen dan tidak dapat dimundurkan.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => loadRestores()}>
          <IconRefresh size={14} className="mr-1" />
          Segarkan
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs data-table">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-4">Cadangan Sumber</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Pelaku (SYS_ADMIN)</th>
                <th className="py-2.5 px-4">Alasan Pemulihan</th>
                <th className="py-2.5 px-4">Cadangan Pengaman</th>
                <th className="py-2.5 px-4">Waktu Mulai</th>
                <th className="py-2.5 px-4 text-right">Rincian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <Spinner label="Memuat riwayat pemulihan..." />
                  </td>
                </tr>
              ) : restores.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={IconShield}
                      title="Belum ada riwayat pemulihan"
                      description="Belum ada catatan transaksi pemulihan database sistem."
                    />
                  </td>
                </tr>
              ) : (
                restores.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                      #{r.backup_number}
                    </td>

                    <td className="py-2.5 px-4">
                      <StatusBadge status={r.status} />
                    </td>

                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      {r.requested_by?.name || '-'}
                    </td>

                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={r.reason}>
                      {r.reason}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {r.safety_backup_id ? (
                        <span title={`Cadangan Pengaman ID: ${r.safety_backup_id}`}>
                          {r.safety_backup_id.slice(0, 8)}…
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">
                      {formatDateTime(r.started_at)}
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleOpenDetail(r.id)}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Standardized Table Footer */}
        <TableFooter
          meta={meta}
          itemCount={restores.length}
          total={meta?.total ?? restores.length}
          entityLabel="proses pemulihan"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>

      {/* Detail Drawer */}
      <Drawer
        open={detailModalOpen}
        title="Rincian Transaksi Pemulihan Database"
        onClose={() => setDetailModalOpen(false)}
        size="max-w-xl"
        footer={
          <Button variant="ghost" onClick={() => setDetailModalOpen(false)}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          {loadingDetail && (
            <div className="p-8 text-center">
              <Spinner label="Memuat rincian pemulihan..." />
            </div>
          )}

          {detailError && <Alert kind="error">{detailError}</Alert>}

          {detailRestore && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Cadangan Sumber:</span>
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    #{detailRestore.backup_number}
                  </strong>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Status Eksekusi:</span>
                  <StatusBadge status={detailRestore.status} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Pelaku Otorisasi:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {detailRestore.requested_by?.name || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Dokumen Fisik Ikut Dipulihkan:</span>
                  <span className="font-semibold">{detailRestore.restore_documents ? 'Ya' : 'Tidak'}</span>
                </div>

                {detailRestore.safety_backup_id && (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                    <span className="text-slate-400">Cadangan Pengaman Otomatis:</span>
                    <code className="font-mono text-[11px] bg-white dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                      {detailRestore.safety_backup_id}
                    </code>
                  </div>
                )}
              </div>

              <div>
                <span className="text-slate-400 block mb-1">Alasan Pemulihan Resmi:</span>
                <p className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 italic text-slate-700 dark:text-slate-300">
                  &ldquo;{detailRestore.reason}&rdquo;
                </p>
              </div>

              {detailRestore.error && (
                <div className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200">
                  <strong className="block mb-0.5">Pesan Kesalahan:</strong>
                  <span>{detailRestore.error}</span>
                </div>
              )}

              {/* Events Audit Trail */}
              {detailRestore.events?.length > 0 && (
                <div>
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                    Linimasa Peristiwa (Audit Trail)
                  </h5>
                  <div className="space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                    {detailRestore.events.map((ev, idx) => (
                      <div key={idx} className="text-[11px]">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {ev.event_type}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatDateTime(ev.occurred_at)} · {ev.actor_name || 'Sistem'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  )
}
