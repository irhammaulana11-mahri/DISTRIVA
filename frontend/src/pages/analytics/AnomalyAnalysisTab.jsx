import React, { useMemo } from 'react'

/**
 * Tab Per ULP untuk Anomali Gangguan dan Keluhan (docs/91 §3, docs/92 §6.8, Butir 43).
 *
 * Menampilkan:
 * (a) Tabel per ULP tahun berjalan (YTD) dengan WO, hitungan berulang, laju per 10k WO,
 *     lencana "di atas harapan" (bila *_flagged: true, Poisson > 2 sigma), tooltip nilai harapan (*_expected).
 * (b) Komposisi kanal pengaduan masuk (channels[]) per jenis (Berulang vs Rating Negatif).
 * (c) Riwayat 12 bulan (history[]) gabungan WO, berulang, dan negatif.
 * (d) Jangan menampilkan peringkat atau warna merah berdasarkan angka bulanan satu ULP.
 * (e) Catatan dari notes[] (kejadian jarang, tidak menyiratkan hubungan dengan RCT).
 */
export default function AnomalyAnalysisTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'anomaly') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan anomali belum tersedia untuk metrik ini.
      </div>
    )
  }

  const {
    focus,
    month,
    partial = false,
    year,
    ytd = {},
    ulps = [],
    channels = [],
    history = [],
    notes = [],
  } = detail

  const isGangguan = metricCode === 'anomali-gangguan' || focus === 'anomali-gangguan'

  // Pisahkan channels per jenis
  const channelGroups = useMemo(() => {
    const berulang = channels.filter((c) => c.kind === 'berulang')
    const negatif = channels.filter((c) => c.kind === 'negatif')

    const sumBerulang = berulang.reduce((acc, c) => acc + (c.count || 0), 0)
    const sumNegatif = negatif.reduce((acc, c) => acc + (c.count || 0), 0)

    return {
      berulang: berulang.map((c) => ({
        ...c,
        pct: sumBerulang > 0 ? (c.count / sumBerulang) * 100 : 0,
      })),
      negatif: negatif.map((c) => ({
        ...c,
        pct: sumNegatif > 0 ? (c.count / sumNegatif) * 100 : 0,
      })),
    }
  }, [channels])

  return (
    <div className="space-y-6">
      {/* Header Info & Ringkasan YTD */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300">
              Analisa Anomali Per ULP (Kejadian Jarang)
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Tahun Berjalan: <strong className="text-slate-700 dark:text-slate-200">{year}</strong> (sampai {month})
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Uji Poisson menandai ULP yang kejadian anomalinya melebihi harapan menurut porsi WO (&gt; 2 sigma).
            Angka bulanan satu ULP tidak dijadikan peringkat karena fluktuasi acak kejadian jarang.
          </p>
        </div>

        {partial && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium">
            <svg className="w-4 h-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Bulan {month} berjalan belum selesai</span>
          </div>
        )}
      </div>

      {/* Kartu Ringkasan YTD Gabungan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Volume WO (YTD)</div>
          <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {ytd.wo?.toLocaleString('id-ID') || 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Gabungan seluruh ULP {year}</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Pengaduan Berulang (YTD)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-mono">
              {ytd.berulang?.toLocaleString('id-ID') || 0}
            </span>
            <span className="text-xs font-mono text-slate-500">
              ({ytd.rate_per_10k_berulang?.toFixed(2) || '0.00'} / 10k WO)
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Laju per 10.000 tiket gangguan/keluhan</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Rating Negatif (YTD)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-mono">
              {ytd.negatif?.toLocaleString('id-ID') || 0}
            </span>
            <span className="text-xs font-mono text-slate-500">
              ({ytd.rate_per_10k_negatif?.toFixed(2) || '0.00'} / 10k WO)
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Laju per 10.000 tiket pelanggan</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Porsi Kejadian Anomali</div>
          <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {ytd.wo > 0
              ? `${(((ytd.berulang + ytd.negatif) / ytd.wo) * 100).toFixed(2)}%`
              : '0.00%'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Sangat jarang dibanding total pengaduan</div>
        </div>
      </div>

      {/* Tabel Per ULP Tahun Berjalan */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Daftar ULP dan Hasil Uji Kejadian Jarang ({year})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Lencana &quot;Di atas harapan&quot; muncul jika kejadian melebihi harapan porsi WO secara statistik signifikan (&gt; 2 sigma Poisson, minimal 5 kasus).
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {ulps.length} ULP terdata
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">ULP</th>
                <th className="py-2.5 px-3 font-semibold text-right">Volume WO</th>
                <th className="py-2.5 px-3 font-semibold text-right">Porsi WO (%)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Berulang</th>
                <th className="py-2.5 px-3 font-semibold text-right">Laju / 10k WO</th>
                <th className="py-2.5 px-3 font-semibold text-center">Status Berulang</th>
                <th className="py-2.5 px-3 font-semibold text-right">Rating Negatif</th>
                {isGangguan && (
                  <th className="py-2.5 px-3 font-semibold text-right text-slate-400">Non-marking (NKO)</th>
                )}
                <th className="py-2.5 px-3 font-semibold text-right">Laju / 10k WO</th>
                <th className="py-2.5 px-3 font-semibold text-center">Status Negatif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ulps.length === 0 ? (
                <tr>
                  <td colSpan={isGangguan ? 10 : 9} className="py-8 text-center text-slate-400">
                    Tidak ada data anomali per ULP untuk tahun ini.
                  </td>
                </tr>
              ) : (
                ulps.map((u) => (
                  <tr key={u.unit_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {u.unit_name}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.wo?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.wo_share_pct !== null && u.wo_share_pct !== undefined
                        ? `${u.wo_share_pct.toFixed(1)}%`
                        : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      {u.berulang?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.berulang_per_10k !== null && u.berulang_per_10k !== undefined
                        ? u.berulang_per_10k.toFixed(2)
                        : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {u.berulang_flagged ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 cursor-help"
                          title={`Harapan menurut porsi WO: ${u.berulang_expected !== null && u.berulang_expected !== undefined ? u.berulang_expected.toFixed(1) : '-'} kejadian (uji Poisson > 2 sigma)`}
                        >
                          Di atas harapan
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-400 dark:text-slate-500 cursor-help"
                          title={`Harapan menurut porsi WO: ${u.berulang_expected !== null && u.berulang_expected !== undefined ? u.berulang_expected.toFixed(1) : '-'}`}
                        >
                          Sesuai
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      {u.negatif?.toLocaleString('id-ID')}
                    </td>
                    {isGangguan && (
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                        {u.negatif_nonmarking !== undefined ? u.negatif_nonmarking.toLocaleString('id-ID') : '-'}
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.negatif_per_10k !== null && u.negatif_per_10k !== undefined
                        ? u.negatif_per_10k.toFixed(2)
                        : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {u.negatif_flagged ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 cursor-help"
                          title={`Harapan menurut porsi WO: ${u.negatif_expected !== null && u.negatif_expected !== undefined ? u.negatif_expected.toFixed(1) : '-'} kejadian (uji Poisson > 2 sigma)`}
                        >
                          Di atas harapan
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-400 dark:text-slate-500 cursor-help"
                          title={`Harapan menurut porsi WO: ${u.negatif_expected !== null && u.negatif_expected !== undefined ? u.negatif_expected.toFixed(1) : '-'}`}
                        >
                          Sesuai
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Komposisi Kanal Pengaduan (channels) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kanal Berulang */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
            Komposisi Kanal Pengaduan Berulang
          </h4>
          {channelGroups.berulang.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">Tidak ada rincian kanal berulang.</div>
          ) : (
            <div className="space-y-2.5">
              {channelGroups.berulang.map((ch) => (
                <div key={ch.channel} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{ch.channel}</span>
                    <span className="font-mono text-slate-600 dark:text-slate-400">
                      {ch.count} ({ch.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${ch.pct}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Kanal Rating Negatif */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
            Komposisi Kanal Rating Negatif
          </h4>
          {channelGroups.negatif.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">Tidak ada rincian kanal rating negatif.</div>
          ) : (
            <div className="space-y-2.5">
              {channelGroups.negatif.map((ch) => (
                <div key={ch.channel} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{ch.channel}</span>
                    <span className="font-mono text-slate-600 dark:text-slate-400">
                      {ch.count} ({ch.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${ch.pct}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Riwayat 12 Bulan */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
            Riwayat 12 Bulan Anomali Gabungan
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Bulan</th>
                  <th className="py-2 px-3 font-semibold text-right">Volume WO</th>
                  <th className="py-2 px-3 font-semibold text-right">Pengaduan Berulang</th>
                  <th className="py-2 px-3 font-semibold text-right">Rating Negatif</th>
                  <th className="py-2 px-3 font-semibold text-right">Total Kejadian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.map((row) => (
                  <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {row.month}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {row.wo?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-amber-600 dark:text-amber-400">
                      {row.berulang?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-rose-600 dark:text-rose-400">
                      {row.negatif?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      {(row.berulang + row.negatif)?.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Penjelas dari Backend */}
      {notes && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Analisa Kejadian Jarang:</div>
          <ul className="list-disc pl-5 space-y-1">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
