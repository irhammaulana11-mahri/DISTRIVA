import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IconAlertCircle,
  IconClock,
  IconArrowUp,
  IconArrowDown,
  IconActivity,
  IconInfo,
} from '../../components/icons.jsx'

// Helper Icon ExternalLink & CloudRain bila belum ada di icons.jsx
const IconExternalLink = ({ size = 14, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

const IconCloudRain = ({ size = 20, className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
  </svg>
)

const CARD = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs'

function fmtNum(v, d = 1) {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtInt(v) {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID')
}

export default function ReliabilityFeederTab({ detail, metricCode }) {
  const [activeCompKey, setActiveCompKey] = useState('cause') // 'cause' | 'weather' | 'device'
  const [activeCompMetric, setActiveCompMetric] = useState('events') // 'events' | 'minutes'

  if (!detail || detail.kind !== 'reliability') {
    return (
      <div className={`${CARD} p-8 text-center text-slate-500`}>
        Data detail penyulang dan keandalan belum tersedia untuk periode atau unit ini.
      </div>
    )
  }

  const { pareto, repeat, composition, risk, weather, early_warning, period, notes } = detail

  const compData = composition?.[activeCompKey] || { total_events: 0, rows: [] }

  return (
    <div className="space-y-6 pt-2">
      {/* 1. KARTU PERINGATAN DINI 3 HARI BMKG (Bila tersedia, docs/92 §8.2 / Butir 48) */}
      {early_warning && early_warning.available !== false && (
        <div className={`${CARD} p-5 border-l-4 border-l-amber-500 space-y-4`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
                <IconCloudRain size={22} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>Peringatan Dini Cuaca 3 Hari ke Depan</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    BMKG
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Potensi cuaca ekstrem dan dampaknya terhadap riwayat gangguan penyulang
                </p>
              </div>
            </div>
            {early_warning.issued_at && (
              <span className="text-[11px] text-slate-400 font-mono">
                Dianalisis: {early_warning.issued_at}
              </span>
            )}
          </div>

          {/* Grid ULP x Hari */}
          {Array.isArray(early_warning.ulps) && early_warning.ulps.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3 font-semibold">Unit Layanan (ULP)</th>
                    <th className="py-2 px-3 text-center">Status</th>
                    {early_warning.ulps[0]?.days?.map((d, i) => (
                      <th key={i} className="py-2 px-3 text-center">
                        {d.date}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {early_warning.ulps.map((u) => {
                    const statusBadge =
                      u.max_level === 'tinggi'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-200'
                        : u.max_level === 'waspada'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-200'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200'

                    return (
                      <tr key={u.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {u.unit_name}
                          {u.location?.kecamatan && (
                            <span className="block text-[10px] text-slate-400 font-normal">
                              {u.location.kecamatan}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusBadge}`}>
                            {u.max_level || 'normal'}
                          </span>
                        </td>
                        {u.days?.map((day, idx) => {
                          const levelCls =
                            day.level === 'tinggi'
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200'
                              : day.level === 'waspada'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200'
                              : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200'

                          return (
                            <td key={idx} className="py-2.5 px-3 text-center">
                              <div
                                className={`inline-block p-1.5 rounded-lg border text-[11px] ${levelCls}`}
                                title={`Curah hujan: ${day.rain_mm} mm${day.thunderstorm ? ', Ada petir' : ''}${day.rate_ratio ? ` · Gangguan historis ~${day.rate_ratio}x hari kering` : ''}`}
                              >
                                <div className="font-bold">{day.rain_mm} mm</div>
                                {day.rate_ratio && (
                                  <div className="text-[10px] opacity-80 font-mono">
                                    ~{day.rate_ratio}x kering
                                  </div>
                                )}
                                {day.slots < 8 && (
                                  <span className="text-[9px] text-amber-600 dark:text-amber-400 block">
                                    (data parsial)
                                  </span>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Watchlist Penyulang Rawan Hujan Lebat */}
          {Array.isArray(early_warning.watchlist) && early_warning.watchlist.length > 0 && (
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                Penyulang Sering Terganggu Saat Hujan Lebat (3 Tahun Terakhir):
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {early_warning.watchlist.map((w, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 text-xs"
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                      <span>{w.name || w.code}</span>
                      <span className="text-[10px] text-amber-700 dark:text-amber-400 font-bold">
                        {fmtNum(w.heavy_rain_share_pct, 1)}% saat hujan
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {w.gi_name || w.unit_name} &bull; {w.events_on_heavy_rain_days_3y} dari {w.events_3y} gangguan
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1">
            <span>{early_warning.attribution || 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'}</span>
            <span className="italic">Catatan: Peringatan dini bukan prakiraan jumlah pasti gangguan.</span>
          </div>
        </div>
      )}

      {/* 2. TABEL PARETO PENYULANG PENYUMBANG SAIDI TERBESAR (Butir 38a) */}
      <div className={`${CARD} p-5 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Pareto Penyulang Penyumbang SAIDI Terbesar</span>
              {period?.from && (
                <span className="text-xs font-normal text-slate-400">
                  (Akumulasi {period.from.slice(0, 4)} s.d. {period.to})
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sepuluh penyulang dengan kontribusi SAIDI terbesar tahun berjalan
              {pareto?.top_share_pct !== null && (
                <strong className="text-slate-700 dark:text-slate-200 ml-1">
                  (menyumbang {fmtNum(pareto.top_share_pct, 1)}% dari total SAIDI penyulang)
                </strong>
              )}
            </p>
          </div>
          {pareto?.feeders_with_events !== undefined && (
            <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg self-start sm:self-auto font-mono">
              {pareto.feeders_with_events} penyulang terganggu
            </span>
          )}
        </div>

        {pareto?.rows?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[140px]">Penyulang</th>
                  <th className="py-2.5 px-2.5 text-right">Kejadian</th>
                  <th className="py-2.5 px-2.5 text-right">Permanen</th>
                  <th className="py-2.5 px-2.5 text-right">Durasi (Mnt)</th>
                  <th className="py-2.5 px-2.5 text-right">ENS (kWh)</th>
                  <th className="py-2.5 px-3 text-right font-semibold text-rose-600 dark:text-rose-400">
                    Kontribusi SAIDI
                  </th>
                  <th className="py-2.5 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                    Kontribusi SAIFI
                  </th>
                  <th className="py-2.5 px-3 text-right">Tren 12 Bulan</th>
                  <th className="py-2.5 px-3 w-36">Kumulatif SAIDI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pareto.rows.map((r, idx) => (
                  <tr key={r.feeder_id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 text-center font-mono text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 font-semibold text-blue-600 dark:text-blue-400">
                        {r.feeder_id ? (
                          <Link
                            to={`/outages/analysis/feeders/${r.feeder_id}`}
                            className="hover:underline flex items-center gap-1"
                            title="Buka rincian analisis penyulang"
                          >
                            <span>{r.name || r.code}</span>
                            <IconExternalLink size={12} className="opacity-70" />
                          </Link>
                        ) : (
                          <span>{r.name || r.code}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {r.unit_name ? (
                          <span className="font-medium text-slate-600 dark:text-slate-300">{r.unit_name} &bull; </span>
                        ) : null}
                        {r.gi_name || '-'} &bull; {fmtInt(r.customers)} plg
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                      {fmtInt(r.events)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-500">
                      {fmtInt(r.permanent)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                      {fmtNum(r.minutes, 0)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                      {fmtInt(r.ens_kwh)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      {fmtNum(r.saidi_contribution, 3)}
                      <span className="block text-[10px] font-normal text-slate-400">
                        {fmtNum(r.saidi_share_pct, 1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                      {fmtNum(r.saifi_contribution, 4)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {r.trend_pct !== null && r.trend_pct !== undefined ? (
                        <span
                          className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${
                            r.trend_pct > 0 ? 'text-rose-600' : r.trend_pct < 0 ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        >
                          {r.trend_pct > 0 ? <IconArrowUp size={12} /> : r.trend_pct < 0 ? <IconArrowDown size={12} /> : null}
                          {r.trend_pct > 0 ? '+' : ''}{fmtNum(r.trend_pct, 1)}%
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-slate-500">Kum:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {fmtNum(r.saidi_cumulative_pct, 1)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-rose-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, r.saidi_cumulative_pct || 0))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4 text-center">Belum ada data Pareto penyulang.</p>
        )}

        <p className="text-[11px] text-slate-400 italic">
          Catatan: Kontribusi SAIDI dan SAIFI per penyulang merupakan batas atas, terutama untuk gangguan yang melibatkan koordinasi recloser.
        </p>
      </div>

      {/* 3. DUA KOLOM: GANGGUAN BERULANG (38b) & DAFTAR PANTAU BULAN DEPAN (38d) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* KARTU GANGGUAN BERULANG (38b) */}
        <div className={`${CARD} p-5 space-y-3 flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <IconAlertCircle size={18} className="text-amber-500" />
                  <span>Penyulang Gangguan Berulang</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Penyulang dengan &ge; 3 kali gangguan dalam 30 hari terakhir
                  {repeat?.window_from && repeat?.window_to && (
                    <span className="font-mono text-[10px] ml-1">
                      ({repeat.window_from} s.d. {repeat.window_to})
                    </span>
                  )}
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-bold">
                {repeat?.rows?.length || 0} Penyulang
              </span>
            </div>

            {repeat?.rows?.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2 max-h-[360px] overflow-y-auto">
                {repeat.rows.map((rp, i) => (
                  <div key={rp.feeder_id || i} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {rp.feeder_id ? (
                          <Link
                            to={`/outages/analysis/feeders/${rp.feeder_id}`}
                            className="hover:underline text-blue-600 dark:text-blue-400"
                          >
                            {rp.name || rp.code}
                          </Link>
                        ) : (
                          <span>{rp.name || rp.code}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {rp.unit_name ? (
                          <span className="font-medium text-slate-600 dark:text-slate-300">{rp.unit_name} &bull; </span>
                        ) : null}
                        {rp.gi_name || '-'} &bull; Terakhir: {rp.last_at || '-'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-mono font-bold">
                        {rp.events} kali
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {rp.permanent} perm &bull; {fmtNum(rp.minutes, 0)} mnt
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400 space-y-1">
                <IconActivity size={28} className="mx-auto opacity-30" />
                <p>Tidak ada penyulang dengan &ge; 3 gangguan dalam 30 hari terakhir.</p>
              </div>
            )}
          </div>

          <div className="pt-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
            Jendela evaluasi: 30 hari kalender hingga tanggal laporan aktif.
          </div>
        </div>

        {/* DAFTAR PANTAU RISIKO BULAN DEPAN (38d) */}
        <div className={`${CARD} p-5 space-y-3 flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <IconClock size={18} className="text-indigo-500" />
                  <span>Daftar Pantau Risiko Bulan Depan</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Penyulang dengan perkiraan laju gangguan tertinggi (model EWMA musiman)
                </p>
              </div>
              {risk?.target_month && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-bold">
                  Bulan {risk.target_month}
                </span>
              )}
            </div>

            {risk && risk.available !== false && risk.rows?.length > 0 ? (
              <div className="space-y-3 mt-2">
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[280px] overflow-y-auto">
                  {risk.rows.map((rk, idx) => (
                    <div key={rk.feeder_id || idx} className="py-2 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {rk.feeder_id ? (
                            <Link
                              to={`/outages/analysis/feeders/${rk.feeder_id}`}
                              className="hover:underline text-blue-600 dark:text-blue-400"
                            >
                              {rk.name || rk.code}
                            </Link>
                          ) : (
                            <span>{rk.name || rk.code}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {rk.owner ? (
                            <span className="font-medium text-slate-600 dark:text-slate-300">{rk.owner} &bull; </span>
                          ) : null}
                          {rk.gi_name || '-'} &bull; 12 bln: {rk.last_12m_events} | 3 bln: {rk.last_3m_events}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          ~{fmtNum(rk.expected_events, 1)} kejadian
                        </span>
                        <div className="text-[10px] text-slate-400">
                          Est. perm: ~{fmtNum(rk.expected_permanent, 1)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Uji Mundur (Backtest Wajib Tampil, docs/92 §6.6 / Butir 38d) */}
                {risk.backtest && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5">
                    <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Evaluasi Akurasi Uji Mundur (24 Bulan):</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                        Model: {fmtNum(risk.backtest.model_capture_pct, 1)}%
                      </span>
                    </div>
                    <p className="text-slate-500 leading-relaxed text-[10px]">
                      {risk.backtest.description || 'Persentase gangguan bulan berikutnya yang berhasil ditangkap pada 10 penyulang teratas.'}
                    </p>
                    <div className="flex items-center gap-3 pt-1 text-[10px] font-mono text-slate-500">
                      <span>Model: <strong>{fmtNum(risk.backtest.model_capture_pct, 1)}%</strong></span>
                      <span>&bull;</span>
                      <span>Naif (12 bln): <strong>{fmtNum(risk.backtest.naive_capture_pct, 1)}%</strong></span>
                      <span>&bull;</span>
                      <span>Acak: <strong>{fmtNum(risk.backtest.random_capture_pct, 1)}%</strong></span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                {risk?.reason || 'Data skor risiko gangguan belum tersedia.'}
              </div>
            )}
          </div>

          <div className="pt-2 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span>Metode: EWMA Musiman</span>
            {period?.partial && <span className="text-amber-600 font-semibold">&bull; Bulan berjalan (parsial)</span>}
          </div>
        </div>
      </div>

      {/* 4. DIAGRAM KOMPOSISI PENYEBAB & CUACA (38c: Perbandingan Kejadian vs Menit Padam) */}
      <div className={`${CARD} p-5 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Komposisi Gangguan: Kejadian vs Menit Padam
            </h3>
            <p className="text-xs text-slate-500">
              Perbandingan porsi jumlah kejadian gangguan dengan porsi menit padam
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
              {[
                ['cause', 'Penyebab'],
                ['weather', 'Cuaca'],
                ['device', 'Perangkat'],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveCompKey(k)}
                  className={`px-3 py-1 rounded-md font-semibold transition cursor-pointer ${
                    activeCompKey === k
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {compData.rows?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-[11px]">
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3 text-right">Kejadian</th>
                  <th className="py-2.5 px-3 w-40">Porsi Kejadian (%)</th>
                  <th className="py-2.5 px-3 text-right">Menit Padam</th>
                  <th className="py-2.5 px-3 w-40">Porsi Menit Padam (%)</th>
                  <th className="py-2.5 px-3 text-right">ENS (kWh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {compData.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {row.key}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {fmtInt(row.events)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, row.events_share_pct || 0))}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums font-medium text-[11px]">
                          {fmtNum(row.events_share_pct, 1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {fmtNum(row.minutes, 0)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-rose-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, row.minutes_share_pct || 0))}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400 text-[11px]">
                          {fmtNum(row.minutes_share_pct, 1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                      {fmtInt(row.ens_kwh)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-6 text-center">Belum ada rincian komposisi gangguan.</p>
        )}
      </div>

      {/* 5. KONTEKS CUACA HISTORIS BULANAN (Butir 41 / docs/92 §8.1 bila tersedia) */}
      {weather && weather.available !== false && Array.isArray(weather.rows) && weather.rows.length > 0 && (
        <div className={`${CARD} p-5 space-y-3`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <IconCloudRain size={18} className="text-blue-500" />
                <span>Konteks Cuaca Historis 12 Bulan Terakhir</span>
              </h3>
              <p className="text-xs text-slate-500">
                Hubungan curah hujan bulanan dengan kejadian gangguan penyulang
              </p>
            </div>
            {weather.attribution && (
              <span className="text-[10px] text-slate-400 font-mono">
                {weather.attribution}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-[11px]">
                  <th className="py-2 px-3">Bulan</th>
                  <th className="py-2 px-3 text-right">Curah Hujan (mm)</th>
                  <th className="py-2 px-3 text-right">Hari Hujan Lebat (&ge; {weather.heavy_rain_mm || 20}mm)</th>
                  <th className="py-2 px-3 text-right">Jumlah Gangguan</th>
                  <th className="py-2 px-3 text-right">Hari Tercakup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {weather.rows.map((wr, idx) => (
                  <tr key={wr.month || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {wr.month}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {fmtNum(wr.rain_mm, 1)} mm
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {fmtNum(wr.heavy_days, 1)} hari
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {fmtInt(wr.events)} kali
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-400">
                      {wr.days_covered} hari
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Kaki Metodologi */}
      {Array.isArray(notes) && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs text-slate-500">
          <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <IconInfo size={14} className="text-slate-400" />
            <span>Catatan Metodologi & Penjelasan Teknis:</span>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-[11px] leading-relaxed">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
