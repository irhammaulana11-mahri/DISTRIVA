import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getModuleBySlug } from '../features/modules/moduleRegistry.js'
import Card, { CardHeader } from '../components/Card.jsx'
import Alert from '../components/Alert.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import TableFooter from '../components/TableFooter.jsx'
import {
  IconArrowLeft,
  IconLock,
  IconDocument,
  IconShield,
  IconClipboard,
  IconWrench,
} from '../components/icons.jsx'

export default function ModuleStatusPage() {
  const { slug } = useParams()
  const mod = getModuleBySlug(slug)
  const [tab, setTab] = useState('kontrak') // 'kontrak' | 'lifecycle' | 'simulator' | 'otorisasi'
  const [epPage, setEpPage] = useState(1)
  const [epPerPage, setEpPerPage] = useState(10)

  if (!mod) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-900">Modul Tidak Ditemukan</h2>
        <p className="mt-1 text-sm text-slate-500">Domain modul yang diminta tidak terdaftar dalam arsitektur DISTRIVA.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 underline hover:text-blue-700">
          <IconArrowLeft size={16} /> Kembali ke Beranda
        </Link>
      </Card>
    )
  }

  const isPending = mod.status === 'PENDING_BACKEND'

  return (
    <div className="space-y-5">
      {/* Navigation header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
          <IconArrowLeft size={16} /> Kembali ke Beranda & Matriks Kesiapan
        </Link>
        <span className="text-xs text-slate-500">Kategori: <strong className="text-slate-700">{mod.category}</strong></span>
      </div>

      {/* Main Overview Card */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold text-slate-900">{mod.name}</h1>
              <StatusBadge status={mod.status} />
            </div>
            <p className="mt-2 text-sm text-slate-600">{mod.description}</p>
          </div>
        </div>

        <div className="mt-4">
          {isPending ? (
            <Alert kind="warning">
              <div className="space-y-1">
                <p className="font-semibold text-amber-900">Status Kesiapan: Menunggu Implementasi Rute API Backend</p>
                <p className="text-xs text-amber-800">
                  Sesuai prinsip <em>Fail-Closed</em> (aturan bisnis DISTRIVA dokumen 42 & 44), seluruh aksi transaksi pada modul ini dinonaktifkan di antarmuka pengguna sampai endpoint resmi Laravel API dan kebijakan otorisasi <code>ScopedAuthorizationService</code> aktif di backend.
                </p>
              </div>
            </Alert>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <div>
                <p className="font-semibold text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm">Modul Terintegrasi & Aktif di Backend</p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">Endpoint API backend telah terverifikasi dan otorisasi dikendalikan oleh server.</p>
              </div>
              <Link
                to={mod.slug === 'auto-mto' || mod.slug === 'drawing' || mod.slug === 'survey-meter' || mod.slug === 'aplikasi-pb-pd' ? '/permohonan' : '/'}
                className="inline-flex items-center justify-center px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-2xs whitespace-nowrap transition-colors"
              >
                {mod.slug === 'auto-mto'
                  ? 'Buka Permohonan & Gambar MTO →'
                  : mod.slug === 'drawing'
                  ? 'Buka Permohonan & Desain Gambar →'
                  : mod.slug === 'survey-meter'
                  ? 'Buka Permohonan & Survei →'
                  : mod.slug === 'aplikasi-pb-pd'
                  ? 'Buka Daftar Permohonan PB/PD →'
                  : 'Buka Halaman Alur Kerja →'}
              </Link>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 border-b border-slate-200">
          <nav className="flex space-x-4" aria-label="Tabs Modul">
            <button
              type="button"
              onClick={() => setTab('kontrak')}
              className={`pb-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                tab === 'kontrak'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              Kontrak API & Endpoint
            </button>
            <button
              type="button"
              onClick={() => setTab('lifecycle')}
              className={`pb-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                tab === 'lifecycle'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              Alur Siklus Hidup & SoD
            </button>
            <button
              type="button"
              onClick={() => setTab('simulator')}
              className={`pb-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                tab === 'simulator'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              Simulator Validasi Form
            </button>
            <button
              type="button"
              onClick={() => setTab('otorisasi')}
              className={`pb-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                tab === 'otorisasi'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              Aturan Scope & Dokumen
            </button>
          </nav>
        </div>
      </Card>

      {/* Tab 1: Kontrak API */}
      {tab === 'kontrak' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            <Card noPadding>
              <div className="p-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">Rancangan Kontrak API Endpoint</h2>
                <p className="text-xs text-slate-500 mt-0.5">Spesifikasi endpoint sesuai arsitektur DISTRIVA (Draft docs/13 vs implementasi aktual):</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm data-table">
                  <thead>
                    <tr>
                      <th className="py-2.5 px-4">Metode</th>
                      <th className="py-2.5 px-4">Path Endpoint</th>
                      <th className="py-2.5 px-4">Deskripsi Fungsi</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(mod.endpoints || [])
                      .slice((epPage - 1) * epPerPage, epPage * epPerPage)
                      .map((ep, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-700">{ep.method}</td>
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-900">{ep.path}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">{ep.desc}</td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${isPending ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                            {isPending ? 'Draft Kontrak' : 'Aktif'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {mod.endpoints && mod.endpoints.length > 0 && (
                <TableFooter
                  itemCount={mod.endpoints.slice((epPage - 1) * epPerPage, epPage * epPerPage).length}
                  total={mod.endpoints.length}
                  entityLabel="endpoint API"
                  page={epPage}
                  perPage={epPerPage}
                  onPage={setEpPage}
                  onPerPage={(n) => {
                    setEpPerPage(n)
                    setEpPage(1)
                  }}
                  perPageOptions={[5, 10, 20]}
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Aksi Operasional Terproteksi"
                description="Aksi alur kerja domain tunduk pada kebijakan otorisasi server-side."
              />
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-slate-200 p-2 text-slate-600">
                    <IconLock size={20} />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-800">Aksi Bisnis Ditangguhkan Sementara (Fail-Closed)</h3>
                    <p className="text-xs text-slate-600">
                      Form input, submit transaksi, dan persetujuan (approval/rejection) belum dapat dibuka pada UI untuk mencegah data fiktif atau inkonsistensi transaksi sebelum backend siap.
                    </p>
                    <div className="pt-2 flex flex-wrap gap-2">
                      <button type="button" disabled className="rounded bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed">
                        + Buat Transaksi Baru
                      </button>
                      <button type="button" disabled className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed">
                        Ekspor Laporan
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <IconShield size={18} className="text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900">Aturan Akses & Otorisasi</h2>
              </div>
              <div className="space-y-3 text-xs text-slate-600">
                <p><strong>Scope Penugasan:</strong> {mod.scopeRule}</p>
                <div className="rounded bg-slate-50 p-3 border border-slate-200 space-y-1.5">
                  <p className="font-semibold text-slate-800">Prinsip Keamanan DISTRIVA:</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-600">
                    <li>Otorisasi kanonis dievaluasi di Laravel (bukan di frontend).</li>
                    <li>Scope query diterapkan sebelum pagination, sorting, dan export.</li>
                    <li>Penetapan user mengacu ke tabel <code>user_role_assignments</code>.</li>
                    <li>Default isolasi data adalah <code>SAME_UNIT</code>.</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-3">
                <IconDocument size={18} className="text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900">Dokumen Referensi</h2>
              </div>
              <ul className="space-y-1.5 text-xs">
                {mod.docRefs.map((doc, idx) => (
                  <li key={idx} className="flex items-center gap-1.5 font-mono text-slate-600 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                    <span>📄</span>
                    <span className="truncate">{doc}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {/* Tab 2: Lifecycle & SoD */}
      {tab === 'lifecycle' && (
        <div className="space-y-5">
          <Card>
            <div className="border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-slate-900">Siklus Hidup Transaksi (Lifecycle State Machine)</h2>
              <p className="text-xs text-slate-500">Transisi status sesuai matriks alur kerja DISTRIVA dokumen 42 & dokumen domain:</p>
            </div>

            <div className="space-y-3">
              {mod.lifecycle ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {mod.lifecycle.map((st, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                          {idx + 1}
                        </span>
                        <span className="font-mono text-xs font-semibold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {st.state}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 pl-7">{st.desc}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Definisi status formal belum dikunci di dokumen teknis.</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-slate-100 pb-3 mb-3">
              <h2 className="text-base font-bold text-slate-900">Aturan Pemisahan Kewenangan (Segregation of Duties / SoD)</h2>
              <p className="text-xs text-slate-500">Kepatuhan kepatuhan audit internal PLN untuk mencegah konflik kepentingan:</p>
            </div>
            <ul className="space-y-2 text-xs text-slate-700">
              {mod.sodRules?.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-2.5 rounded-md bg-amber-50/50 border border-amber-100 p-2.5">
                  <span className="text-amber-600 font-bold">✓</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* Tab 3: Simulator Form */}
      {tab === 'simulator' && (
        <Card>
          <div className="mb-4 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                PREVIEW PENGEMBANGAN
              </span>
              <h2 className="text-base font-bold text-slate-900">Simulator Validasi Formulir</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Uji coba struktur data dan validasi client-side sebelum rute API Laravel aktif. <strong>Tidak ada data yang disimpan ke database produksi (Fail-Closed).</strong>
            </p>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-4 w-full">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Dokumen / Agenda Ref</label>
                <input
                  type="text"
                  placeholder="Contoh: AGD-2026-0001"
                  className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs shadow-xs focus-ring"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unit Organisasi Terkait (Scope)</label>
                <input
                  type="text"
                  disabled
                  value="ULP Bandung Timur (SAME_UNIT)"
                  className="block w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-500 cursor-not-allowed"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi Teknis Pekerjaan</label>
                <textarea
                  rows={2}
                  placeholder="Rincian kebutuhan pekerjaan jaringan..."
                  className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs shadow-xs focus-ring"
                />
              </div>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="font-semibold">Proteksi Integritas Data:</p>
              <p className="mt-0.5">Tombol submit dinonaktifkan secara fail-closed agar tidak mengirimkan data mock ke backend.</p>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                disabled
                className="rounded-md bg-slate-300 px-4 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
              >
                Kirim Transaksi (Dinonaktifkan)
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Tab 4: Scope & Otorisasi */}
      {tab === 'otorisasi' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Card>
            <h2 className="text-base font-bold text-slate-900 mb-2">Batas Scope & Otorisasi</h2>
            <div className="space-y-3 text-xs text-slate-600">
              <p>
                Platform DISTRIVA memberlakukan pemisahan data tingkat tinggi berdasarkan unit kerja efektif dari pengguna yang tercatat pada <code>user_role_assignments</code>.
              </p>
              <div className="rounded-md bg-slate-50 p-3 border border-slate-200 space-y-2">
                <p className="font-semibold text-slate-800">Tingkat Unit Penugasan:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>PUSAT</strong>: Pemantauan agregat nasional, standardisasi master data.</li>
                  <li><strong>UID / Wilayah</strong>: Penetapan tarif, persetujuan RKM wilayah, alokasi anggaran KKF.</li>
                  <li><strong>UP3</strong>: Penerbitan SPK/WO, pengawasan konstruksi child-ULP, persetujuan teknis perencanaan.</li>
                  <li><strong>ULP</strong>: Pendaftaran agenda PB/PD, survey lapangan, monitoring meter pelanggan.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-bold text-slate-900 mb-2">Matriks Keputusan Pemilik (Owner Register)</h2>
            <div className="space-y-2 text-xs text-slate-600">
              <p>Keputusan arsitektur yang berlaku sesuai dokumen 44 (Owner Decision Register):</p>
              <div className="space-y-2">
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="font-mono font-semibold text-slate-800">D-AUTH-001</div>
                  <div className="text-slate-600 mt-0.5">Tabel user_role_assignments adalah sumber tunggal penetapan role dan unit.</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="font-mono font-semibold text-slate-800">D-AUTH-004</div>
                  <div className="text-slate-600 mt-0.5">SAME_UNIT adalah default. SYS_ADMIN dilarang mengakses data bisnis secara implisit.</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="font-mono font-semibold text-slate-800">D-AUTH-011</div>
                  <div className="text-slate-600 mt-0.5">Scope server-side diterapkan sebelum pagination, sorting, count, dan export.</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
