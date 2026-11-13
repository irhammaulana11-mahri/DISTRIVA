import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { surveyApi, proposalsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import ProposalSelectableModal from '../proposals/ProposalSelectableModal.jsx'
import { IconClipboard, IconPlus, IconRefresh, IconSearch, IconEye, IconUser, IconUsers } from '../../components/icons.jsx'

/**
 * Usulan Survei (docs/82 §11): daftar permintaan survei, perorangan (satu pelanggan) atau kolektif (beberapa pelanggan, satu survei) beserta hasilnya.
 * Hasil: MENUNGGU → PERLU PERLUASAN (nomor usulan terbit, alur teknis berlanjut) atau TANPA PERLUASAN (langsung siap pasang, tanpa nomor usulan).
 * Survei dimulai oleh Teknik ULP sendiri (tanpa penugasan oleh Manager).
 */
const OUTCOME = {
  PENDING: { label: 'Menunggu hasil', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60' },
  EXTENSION: { label: 'Perlu perluasan', cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60' },
  NO_EXTENSION: { label: 'Tanpa perluasan · siap pasang', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' },
}
const STAGE = { ULP_MANAGER: 'Menunggu Manager ULP', UP3_REVIEW: 'Review UP3 (Perencanaan & Konstruksi)', ASMAN: 'Persetujuan Asman' }

/** Nama aksi utama baris menurut status survei dan peran: yang perlu dikerjakan bernama kerja, selebihnya "Lihat". */
export function surveyActionLabel(r, canStart) {
  if (r.status === 'CANCELLED') return 'Lihat Survei'
  if (r.status === 'ACCEPTED') return 'Lihat Hasil Survei'
  if (r.version_status === 'DRAFT') return canStart ? 'Isi Hasil Survei' : 'Lihat Survei'
  return 'Lihat Persetujuan'
}

function progress(r) {
  if (r.status === 'CANCELLED') return 'Dibatalkan'
  if (r.status === 'ACCEPTED') return 'Disetujui'
  if (r.version_status === 'DRAFT') return 'Surveyor mengisi hasil survei'
  return STAGE[r.version_stage] || r.version_status || '-'
}

export default function SurveyRequestsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // dari drawer permohonan: ?mulai=<no. permohonan> membuka dialog Tambah Survei Perorangan untuk pelanggan itu; ?cari=<kata> mengisi pencarian daftar
  const mulaiParam = searchParams.get('mulai') || ''
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const canStart = Boolean(can['surveys.execute'] || isSysAdmin)

  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [search, setSearch] = useState(searchParams.get('cari') || '')
  const [kind, setKind] = useState('')
  const [outcome, setOutcome] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [pickMode, setPickMode] = useState(mulaiParam && canStart ? 'individual' : null) // 'individual' | 'collective'
  const closePick = () => {
    setPickMode(null)
    if (searchParams.get('mulai')) {
      const p = new URLSearchParams(searchParams)
      p.delete('mulai')
      setSearchParams(p, { replace: true })
    }
  }
  const [issuingId, setIssuingId] = useState(null)
  const canIssue = Boolean(can['proposals.manage'] || isSysAdmin)

  const issue = async (r) => {
    setIssuingId(r.id)
    try {
      const res = await proposalsApi.issue(r.application?.id)
      notify({ type: 'success', title: 'Usulan Dibuat', desc: `Usulan ${res?.data?.proposal_number || ''} berhasil dibuat dari survei ${r.survey_number}.`, tag: 'Usulan' })
      load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Membuat Usulan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Usulan' })
    } finally {
      setIssuingId(null)
    }
  }

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await surveyApi.list({
        q: search.trim() || undefined,
        kind: kind || undefined,
        outcome: outcome || undefined,
        status: status || undefined,
        page,
        per_page: perPage,
      })
      setState({ loading: false, error: '', rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat daftar usulan survei.', rows: [], meta: null })
    }
  }, [search, kind, outcome, status, page, perPage])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const onStarted = (created) => {
    const surveyId = created?.survey_id || created?.id
    notify({ type: 'success', title: 'Survei Dimulai', desc: `Survei ${created?.survey_number || ''} berhasil dimulai.`.replace('  ', ' '), tag: 'Survei' })
    load()
    if (surveyId) navigate(`/survei/${surveyId}`)
  }

  const inputCls = 'px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

  return (
    <div className="space-y-5" data-testid="survey-requests">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Usulan Survei</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Survei lapangan perorangan atau kolektif. Hasil survei menentukan: perlu perluasan (nomor usulan terbit, alur teknis berlanjut) atau tanpa perluasan (langsung siap pasang).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" variant="secondary" size="sm" onClick={load} className="inline-flex items-center gap-1.5">
            <IconRefresh size={13} />
            <span>Segarkan</span>
          </Button>
          {canStart && (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickMode('individual')} className="inline-flex items-center gap-1.5">
                <IconUser size={13} />
                <span>Tambah Survei Perorangan</span>
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={() => setPickMode('collective')} className="inline-flex items-center gap-1.5">
                <IconPlus size={14} />
                <span>Tambah Survei Kolektif</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {state.error && <Alert kind="error">{state.error}</Alert>}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <IconSearch size={14} />
          </span>
          <input
            aria-label="Cari usulan survei"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Cari nomor survei, nomor permohonan, atau nama pelanggan…"
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </div>
        <select aria-label="Jenis survei" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }} className={inputCls}>
          <option value="">Semua jenis</option>
          <option value="INDIVIDUAL">Perorangan</option>
          <option value="COLLECTIVE">Kolektif</option>
        </select>
        <select aria-label="Hasil survei" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1) }} className={inputCls}>
          <option value="">Semua hasil</option>
          <option value="PENDING">Menunggu hasil</option>
          <option value="EXTENSION">Perlu perluasan</option>
          <option value="NO_EXTENSION">Tanpa perluasan</option>
        </select>
        <select aria-label="Status survei" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className={inputCls}>
          <option value="">Semua status</option>
          <option value="ACTIVE">Berjalan</option>
          <option value="ACCEPTED">Disetujui</option>
          <option value="CANCELLED">Dibatalkan</option>
        </select>
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
        {state.loading ? (
          <div className="py-12 text-center">
            <Spinner size="md" label="Memuat usulan survei…" />
          </div>
        ) : state.rows.length === 0 ? (
          <EmptyState
            icon={IconClipboard}
            title={search || kind || outcome || status ? 'Tidak ada usulan survei yang sesuai' : 'Belum ada usulan survei'}
            description={
              canStart
                ? 'Klik "Tambah Survei Perorangan" untuk satu pelanggan atau "Tambah Survei Kolektif" untuk beberapa pelanggan sekaligus.'
                : 'Survei dimulai oleh Teknik ULP. Usulan survei akan tampil di sini.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-3.5">No. Survei</th>
                  <th className="py-3 px-3.5">Jenis</th>
                  <th className="py-3 px-3.5">Pelanggan</th>
                  <th className="py-3 px-3.5">Unit</th>
                  <th className="py-3 px-3.5">Tahap</th>
                  <th className="py-3 px-3.5">Hasil Survei</th>
                  <th className="py-3 px-3.5">No. Usulan</th>
                  <th className="py-3 px-3.5">Surveyor</th>
                  <th className="py-3 px-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {state.rows.map((r) => {
                  const o = OUTCOME[r.outcome] || OUTCOME.PENDING
                  const extra = r.members_count - (r.customer_names?.length || 0)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition" data-testid="survey-request-row">
                      <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                        <Link to={`/survei/${r.id}`} className="hover:underline">{r.survey_number}</Link>
                        <span className="block text-[10px] font-normal text-slate-400">{r.created_at?.slice(0, 10)}</span>
                      </td>
                      <td className="py-3 px-3.5">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          {r.kind === 'COLLECTIVE' ? <IconUsers size={12} /> : <IconUser size={12} />}
                          {r.kind === 'COLLECTIVE' ? `Kolektif · ${r.members_count}` : 'Perorangan'}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 max-w-[16rem]">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{(r.customer_names || []).join(', ')}{extra > 0 ? ` +${extra}` : ''}</span>
                        <span className="block text-[10px] text-slate-400 font-mono">{r.application?.application_number}</span>
                      </td>
                      <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">{r.unit?.name}</td>
                      <td className="py-3 px-3.5">{progress(r)}</td>
                      <td className="py-3 px-3.5">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${o.cls}`}>{r.status === 'CANCELLED' ? 'Dibatalkan' : o.label}</span>
                      </td>
                      <td className="py-3 px-3.5 font-mono">
                        {r.proposal?.issued ? (
                          <Link to={`/usulan/${r.proposal.id}`} className="text-blue-700 dark:text-blue-400 hover:underline">{r.proposal.proposal_number}</Link>
                        ) : (
                          <span className="text-slate-400">{r.outcome === 'NO_EXTENSION' ? 'tidak diperlukan' : r.outcome === 'EXTENSION' ? 'belum dibuat' : 'belum terbit'}</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">{r.surveyor_name}</td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="xs" variant="secondary" onClick={() => navigate(`/survei/${r.id}`)} className="inline-flex items-center gap-1">
                            <IconEye size={12} />
                            <span>{surveyActionLabel(r, canStart)}</span>
                          </Button>
                          {canIssue && r.status === 'ACCEPTED' && r.outcome === 'EXTENSION' && !r.proposal?.issued && (
                            <Button size="xs" variant="primary" loading={issuingId === r.id} onClick={() => issue(r)}>
                              Buat Usulan Perluasan
                            </Button>
                          )}
                          <Button size="xs" variant="ghost" onClick={() => navigate(`/permohonan?app_id=${r.application?.id}`)} title="Lihat ringkasan permohonan (pratinjau)">
                            Lihat Permohonan
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <TableFooter
          itemCount={state.rows.length}
          total={state.meta?.total ?? state.rows.length}
          entityLabel="usulan survei"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50]}
        />
      </div>

      {pickMode && <ProposalSelectableModal open surveyMode={pickMode} initialSearch={pickMode === 'individual' ? mulaiParam : ''} onClose={closePick} onSuccess={onStarted} />}
    </div>
  )
}
