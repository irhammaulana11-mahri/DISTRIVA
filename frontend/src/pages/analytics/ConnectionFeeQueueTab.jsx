import React, { useMemo } from 'react'

/**
 * Tab Kasus Besar & Antrean untuk HPL Biaya Penyambungan (docs/91 §3, docs/92 §6.11, Butir 45).
 *
 * Menampilkan:
 * (a) Riwayat 12 bulan kasus standar vs kasus besar (history[]) dengan penjelasan bahwa
 *     lonjakan Rp didominasi satu atau dua kasus besar (big_share_pct) serta daftar top 10 permohonan terbesar.
 * (b) Kartu lama bayar (lag: median dan p90 hari dari dibuat sampai lunas) dan antrean disetujui belum lunas (queue.buckets),
 *     dengan kelompok stale (>30 hari) ditampilkan terpisah dan berlabel "Kedaluwarsa, bukan potensi pendapatan"
 *     serta tabel odds_by_age sebagai petunjuk peluang bayar.
 * (c) Kartu prakiraan bulan depan (forecast): expected dengan rentang low - high (bukan angka tunggal),
 *     wajib menampilkan evaluasi backtest (MAPE model vs naif vs rata3), label "petunjuk" bila reliable: false.
 * (d) Tabel rincian ULP bulan terpilih dari month_detail.ulps (n, rp, rp_big, rp_standard, avg_rp, share_pct).
 * (e) Catatan teknis dari notes[].
 */
export default function ConnectionFeeQueueTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'connection_fee') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan HPL Biaya BP belum tersedia untuk metrik ini.
      </div>
    )
  }

  const {
    month,
    partial = false,
    big_case_rp = 20000000,
    history = [],
    month_detail: monthDetail = {},
    lag = {},
    queue = {},
    forecast = {},
    notes = [],
  } = detail

  const topCases = monthDetail.top || []
  const ulpRows = monthDetail.ulps || []
  const queueBuckets = queue.buckets || []
  const oddsByAge = queue.odds_by_age || []

  // Pisahkan bucket antrean hidup vs kedaluwarsa (stale)
  const liveBuckets = queueBuckets.filter((b) => !b.stale)
  const staleBucket = queueBuckets.find((b) => b.stale)

  const liveTotalRp = liveBuckets.reduce((acc, b) => acc + (b.rp || 0), 0)
  const liveTotalN = liveBuckets.reduce((acc, b) => acc + (b.n || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header Info & Partial Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
              Analisa Kasus Besar &amp; Antrean BP
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Bulan: <strong className="text-slate-700 dark:text-slate-200">{month}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Pemisahan kasus standar vs kasus besar (&ge; Rp {(big_case_rp / 1e6).toFixed(0)} Juta) untuk membaca
            tren riil tanpa terdistorsi lonjakan satu atau dua permohonan besar.
          </p>
        </div>

        {partial && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium">
            <svg className="w-4 h-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Bulan berjalan belum lengkap</span>
          </div>
        )}
      </div>

      {/* Kartu Prakiraan Bulan Depan (forecast dengan rentang & backtest wajib) */}
      {forecast && forecast.available && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Prakiraan Pendapatan BP Bulan Depan ({forecast.month})
                </span>
                {forecast.reliable ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Model Andal
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                    Petunjuk
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Bagian standar (rata-rata 3 bulan: Rp {(forecast.standard / 1e6).toFixed(1)} Juta) ditambah median kasus besar 12 bulan (Rp {(forecast.big_median / 1e6).toFixed(1)} Juta).
              </p>
              <p className="text-xs text-slate-500 italic">
                * Disajikan sebagai rentang kemungkinan (bukan angka tunggal mutlak).
              </p>
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="text-xs text-slate-500 font-medium">Nilai Harapan (Expected):</div>
              <div className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                Rp {(forecast.expected / 1e6).toLocaleString('id-ID')} Juta
              </div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                Rentang: Rp {(forecast.low / 1e6).toFixed(1)} Jt &ndash; Rp {(forecast.high / 1e6).toFixed(1)} Jt
              </div>
            </div>
          </div>

          {/* Evaluasi Uji Mundur (Backtest Wajib) */}
          {forecast.backtest && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Uji Mundur ({forecast.backtest.months || 0} bulan):</span>
                <span className="ml-1">
                  Kesalahan model (MAPE) <strong>{forecast.backtest.model_mape_pct !== null && forecast.backtest.model_mape_pct !== undefined ? forecast.backtest.model_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong> vs Cara Naif <strong>{forecast.backtest.naive_mape_pct !== null && forecast.backtest.naive_mape_pct !== undefined ? forecast.backtest.naive_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong> vs Rata-rata 3 Bulan <strong>{forecast.backtest.mean3_mape_pct !== null && forecast.backtest.mean3_mape_pct !== undefined ? forecast.backtest.mean3_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong>.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kartu Kecepatan Pembayaran (Lag) & Antrean Disetujui Belum Lunas (Queue) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kartu Lama Bayar */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Kecepatan Pembayaran (Permohonan Sampai Lunas)
            </h4>
            <span className="text-[11px] text-slate-400">12 Bulan Terakhir</span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Median Waktu Bayar</div>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
                {lag.median_days !== null && lag.median_days !== undefined ? `${lag.median_days.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hari` : '-'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">50% pemohon membayar &le; waktu ini</div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Persentil 90 (P90)</div>
              <div className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
                {lag.p90_days !== null && lag.p90_days !== undefined ? `${lag.p90_days.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hari` : '-'}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Hampir semua membayar dlm 30 hari</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            * Dari {lag.n?.toLocaleString('id-ID') || 0} permohonan berbayar dengan tanggal buat dan lunas tercatat.
          </p>
        </div>

        {/* Kartu Antrean Disetujui Belum Lunas */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Antrean Permohonan Disetujui Belum Lunas
            </h4>
            <span className="text-[11px] text-slate-400">Potret per {queue.as_of}</span>
          </div>

          <div className="space-y-2">
            {liveBuckets.map((b) => (
              <div key={b.key} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Umur {b.key} hari</span>
                  <span className="text-slate-400 ml-2">({b.n} permohonan)</span>
                </div>
                <div className="font-mono font-bold text-slate-800 dark:text-slate-100">
                  Rp {(b.rp / 1e6).toFixed(1)} Juta
                </div>
              </div>
            ))}

            {/* Kelompok Stale (>30 hari) Ditampilkan Terpisah dan Berlabel Kedaluwarsa */}
            {staleBucket && (
              <div className="p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-rose-700 dark:text-rose-300">
                      Kedaluwarsa (&gt; {queue.live_days} hari)
                    </span>
                    <span className="text-rose-500 text-[10px]">({staleBucket.n} permohonan)</span>
                  </div>
                  <div className="font-mono font-bold text-rose-700 dark:text-rose-300">
                    Rp {(staleBucket.rp / 1e6).toFixed(1)} Juta
                  </div>
                </div>
                <p className="text-[10px] text-rose-600 dark:text-rose-400">
                  * Berlabel kedaluwarsa, bukan potensi pendapatan (peluang bayar historis mendekati nol).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Riwayat 12 Bulan (history) Kasus Standar vs Besar */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Riwayat 12 Bulan: Pemisahan Kasus Standar dan Kasus Besar
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Lonjakan Rp bulanan umumnya dipicu oleh satu atau dua permohonan besar, bukan lonjakan kegiatan operasional.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Ambang kasus besar: &ge; Rp {(big_case_rp / 1e6).toFixed(0)} Jt
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Bulan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total Permohonan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Kasus Besar (n)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Kasus Standar (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right text-indigo-600 dark:text-indigo-400">Kasus Besar (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Porsi Besar (%)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total Pendapatan BP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((row) => (
                <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                    {row.month}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {row.n?.toLocaleString('id-ID')}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {row.n_big?.toLocaleString('id-ID')}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    Rp {(row.rp_standard / 1e6).toFixed(1)} Jt
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    Rp {(row.rp_big / 1e6).toFixed(1)} Jt
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-medium">
                    {row.big_share_pct !== null && row.big_share_pct !== undefined ? (
                      <span className={row.big_share_pct >= 50 ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-600 dark:text-slate-400'}>
                        {row.big_share_pct.toFixed(1)}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                    Rp {(row.rp / 1e6).toFixed(1)} Jt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top 10 Kasus Terbesar Bulan Terpilih */}
      {topCases.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                10 Permohonan BP Terbesar Bulan {month}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Menyumbang {monthDetail.top10_share_pct !== null && monthDetail.top10_share_pct !== undefined ? `${monthDetail.top10_share_pct.toFixed(1)}%` : '-'} dari total pendapatan bulan ini
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Nomor Permohonan</th>
                  <th className="py-2 px-3 font-semibold">Jenis</th>
                  <th className="py-2 px-3 font-semibold">ULP</th>
                  <th className="py-2 px-3 font-semibold">Tanggal Lunas</th>
                  <th className="py-2 px-3 font-semibold text-right">Biaya BP (Rp)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topCases.map((c) => (
                  <tr key={c.application_number} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-mono font-medium text-slate-800 dark:text-slate-200">
                      {c.application_number}
                    </td>
                    <td className="py-2 px-3 font-semibold">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${c.type === 'PB' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                      {c.unit_name}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400">
                      {c.paid_at}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      Rp {c.rp?.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rincian ULP Bulan Terpilih (month_detail.ulps) */}
      {ulpRows.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Rincian Pendapatan BP Per ULP Bulan {month}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">ULP</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Permohonan</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Kasus Standar (Rp)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Kasus Besar (Rp)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Total Pendapatan (Rp)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Rata-rata / Kasus</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Sumbangan (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ulpRows.map((u) => (
                  <tr key={u.unit_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {u.unit_name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.n?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      Rp {(u.rp_standard / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-indigo-600 dark:text-indigo-400">
                      {u.rp_big > 0 ? `Rp ${(u.rp_big / 1e6).toFixed(1)} Jt` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      Rp {(u.rp / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      Rp {u.avg_rp?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.share_pct !== null && u.share_pct !== undefined ? `${u.share_pct.toFixed(1)}%` : '-'}
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
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Analisa Biaya Penyambungan:</div>
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
