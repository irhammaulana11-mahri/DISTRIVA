import React, { useState } from 'react'
import {
  IconAlertCircle,
  IconClock,
  IconCalendar,
  IconInfo,
  IconArrowUp,
  IconArrowDown,
  IconCheck,
  IconUsers,
  IconZap,
} from '../../components/icons.jsx'

const fmtFloat = (v, digits = 1) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtInt = (v) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID')
}

const fmtRp = (v) => {
  if (v === null || v === undefined) return '-'
  const num = Number(v)
  if (Math.abs(num) >= 1e9) {
    return `Rp ${fmtFloat(num / 1e9, 2)} M`
  }
  if (Math.abs(num) >= 1e6) {
    return `Rp ${fmtFloat(num / 1e6, 2)} jt`
  }
  return `Rp ${fmtInt(num)}`
}

const fmtKwh = (v) => {
  if (v === null || v === undefined) return '-'
  const num = Number(v)
  if (Math.abs(num) >= 1e6) {
    return `${fmtFloat(num / 1e6, 2)} GWh`
  }
  if (Math.abs(num) >= 1e3) {
    return `${fmtFloat(num / 1e3, 1)} MWh`
  }
  return `${fmtFloat(num, 0)} kWh`
}

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmtFloat(v, 1)}%`
}

const fmtMonth = (m) => {
  if (!m) return '-'
  const [y, mon] = m.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const idx = parseInt(mon, 10) - 1
  return `${months[idx] || mon} ${y?.slice(-2) || ''}`
}

/**
 * Komponen Tab "Pemecahan" (docs/92 §6.2, §6.3, §7, Butir 40):
 * Pemecahan perubahan tahunan kWh Jual dan Pendapatan menurut golongan tarif.
 */
export default function SalesDecompositionTab({ detail, metricCode }) {
  const [periodMode, setPeriodMode] = useState('month') // 'month' | 'ytd'

  if (!detail) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
        Data pemecahan penjualan belum tersedia untuk periode atau unit yang dipilih.
      </div>
    )
  }

  if (detail.kind !== 'sales_decomposition') {
    return null
  }

  if (detail.available === false) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-6 text-amber-900 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <IconAlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">Pemecahan Penjualan Tidak Tersedia</h4>
            <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-1">
              {detail.reason || 'Belum ada laporan 309 per golongan pada bulan itu dan bulan yang sama tahun lalu.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const isKwh = metricCode === 'kwh-jual' || detail.focus === 'kwh-jual'
  const isRp = metricCode === 'pendapatan' || detail.focus === 'pendapatan'

  const {
    month: monthData,
    ytd: ytdData,
    monthly = [],
    findings = [],
    notes = [],
  } = detail

  // Pilih dataset aktif berdasarkan periodMode ('month' vs 'ytd')
  const activeDataset = periodMode === 'month' ? monthData : ytdData
  const activeEffects = isKwh
    ? activeDataset?.kwh
    : activeDataset?.rp

  // Label efek dan penjelasannya
  const effectsConfig = isKwh
    ? [
        {
          key: 'customers',
          label: 'Efek Pelanggan',
          desc: 'Perubahan jumlah pelanggan × kWh/pelanggan tahun lalu',
          color: 'blue',
          val: activeEffects?.customers,
        },
        {
          key: 'mix',
          label: 'Efek Campuran Golongan',
          desc: 'Pergeseran proporsi pelanggan antar golongan',
          color: 'indigo',
          val: activeEffects?.mix,
        },
        {
          key: 'intensity',
          label: 'Efek kWh per Pelanggan',
          desc: 'Perubahan konsumsi tiap pelanggan dalam golongannya',
          color: 'purple',
          val: activeEffects?.intensity,
        },
      ]
    : [
        {
          key: 'volume',
          label: 'Efek Volume (kWh)',
          desc: 'Perubahan kWh × harga rata-rata tahun lalu',
          color: 'blue',
          val: activeEffects?.volume,
        },
        {
          key: 'mix',
          label: 'Efek Campuran Golongan',
          desc: 'Pergeseran proporsi kWh antar golongan',
          color: 'indigo',
          val: activeEffects?.mix,
        },
        {
          key: 'price',
          label: 'Efek Tarif (Rp/kWh)',
          desc: 'Perubahan Rp per kWh dalam golongan (tarif & subsidi)',
          color: 'purple',
          val: activeEffects?.price,
        },
      ]

  const totalBefore = activeEffects?.previous || 0
  const totalAfter = activeEffects?.total || 0
  const totalChange = activeEffects?.change || 0
  const changePct = activeEffects?.change_pct

  const formatVal = isKwh ? fmtKwh : fmtRp

  return (
    <div className="space-y-6" data-testid="sales-decomposition-tab">
      {/* (c) Temuan Otomatis findings[] di atas diagram (Wajib Tampil) */}
      {findings.length > 0 && (
        <div className="space-y-2">
          {findings.map((f, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
                f.level === 'kritis'
                  ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-200'
              }`}
            >
              <IconAlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 leading-relaxed">
                <span className="font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.2 rounded bg-amber-200/60 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 mr-2">
                  {f.kind === 'base_effect' ? 'Efek Dasar Rendah' : f.kind === 'group_shift' ? 'Pergeseran Golongan' : 'Catatan'}
                </span>
                <span>{f.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Switcher & Header Periode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          <IconCalendar className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Dasar Pemecahan: <strong className="text-slate-900 dark:text-white">{isKwh ? 'Penjualan kWh' : 'Pendapatan Penjualan'}</strong>
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {periodMode === 'month'
              ? `Bulan ${fmtMonth(monthData?.month)} vs ${fmtMonth(monthData?.previous)}`
              : `Tahun Berjalan (${ytdData?.from} s.d. ${ytdData?.to}, ${ytdData?.months_compared} bulan)`}
          </span>
        </div>

        {/* Toggle Bulan ini vs Tahun berjalan */}
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setPeriodMode('month')}
            disabled={!monthData}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              periodMode === 'month'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Bulan ini
          </button>
          <button
            type="button"
            onClick={() => setPeriodMode('ytd')}
            disabled={!ytdData}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
              periodMode === 'ytd'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Tahun berjalan (YTD)
          </button>
        </div>
      </div>

      {/* (a) Diagram Air Terjun (Waterfall) Pemecahan Efek */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Dekomposisi Perubahan: Dari Tahun Lalu ke Tahun Ini
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pemecahan matematis perubahan {isKwh ? 'kWh Jual' : 'Pendapatan'} menjadi tiga komponen efek pendorong utama.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Total Perubahan:</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${totalChange >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'}`}>
              {totalChange >= 0 ? '+' : ''}{formatVal(totalChange)} ({fmtPct(changePct)})
            </span>
          </div>
        </div>

        {/* Visual Waterfall Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {/* Kolom 1: Titik Awal (Tahun Lalu) */}
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {periodMode === 'month' ? 'Realisasi Tahun Lalu' : 'Kumulatif Thn Lalu'}
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                {formatVal(totalBefore)}
              </div>
            </div>
            <div className="text-[10px] text-slate-400 mt-2">Titik Awal (Baseline)</div>
          </div>

          {/* Kolom 2, 3, 4: Tiga Efek Dekomposisi */}
          {effectsConfig.map((ef) => {
            const isPos = (ef.val || 0) >= 0
            return (
              <div
                key={ef.key}
                className="p-3 rounded-lg bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700/80 shadow-xs flex flex-col justify-between relative overflow-hidden"
              >
                <div
                  className={`absolute top-0 left-0 right-0 h-1 ${
                    isPos ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                />
                <div>
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate" title={ef.label}>
                    {ef.label}
                  </div>
                  <div className={`text-sm font-extrabold mt-1 ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {ef.val !== null && ef.val !== undefined ? `${isPos ? '+' : ''}${formatVal(ef.val)}` : '-'}
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
                  {ef.desc}
                </div>
              </div>
            )
          })}

          {/* Kolom 5: Titik Akhir (Tahun Ini) */}
          <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                {periodMode === 'month' ? 'Realisasi Tahun Ini' : 'Kumulatif Thn Ini'}
              </div>
              <div className="text-sm font-bold text-blue-900 dark:text-blue-100 mt-1">
                {formatVal(totalAfter)}
              </div>
            </div>
            <div className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold mt-2">
              Hasil Akhir ({fmtPct(changePct)})
            </div>
          </div>
        </div>

        {/* Batang Efek Bulanan (monthly[]) */}
        {monthly.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Rincian Efek Bulanan ({monthly.length} Bulan Terakhir)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Bulan</th>
                    <th className="py-2 px-3 font-semibold text-right">Tahun Ini</th>
                    <th className="py-2 px-3 font-semibold text-right">Tahun Lalu</th>
                    <th className="py-2 px-3 font-semibold text-right">Perubahan</th>
                    <th className="py-2 px-3 font-semibold text-right">{isKwh ? 'Efek Pelanggan' : 'Efek Volume'}</th>
                    <th className="py-2 px-3 font-semibold text-right">Efek Campuran</th>
                    <th className="py-2 pl-3 font-semibold text-right">{isKwh ? 'Efek kWh/Plg' : 'Efek Tarif'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                  {monthly.map((m) => {
                    const rowData = isKwh ? m.kwh : m.rp
                    const ef1 = isKwh ? rowData?.customers : rowData?.volume
                    const ef2 = rowData?.mix
                    const ef3 = isKwh ? rowData?.intensity : rowData?.price
                    return (
                      <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-1.5 pr-3 font-sans font-medium text-slate-900 dark:text-white whitespace-nowrap">
                          {fmtMonth(m.month)}
                        </td>
                        <td className="py-1.5 px-3 text-right">{formatVal(rowData?.total)}</td>
                        <td className="py-1.5 px-3 text-right text-slate-400">{formatVal(rowData?.previous)}</td>
                        <td className={`py-1.5 px-3 text-right font-semibold ${rowData?.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {rowData?.change >= 0 ? '+' : ''}{formatVal(rowData?.change)}
                        </td>
                        <td className={`py-1.5 px-3 text-right ${ef1 >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500'}`}>
                          {ef1 !== null && ef1 !== undefined ? `${ef1 >= 0 ? '+' : ''}${formatVal(ef1)}` : '-'}
                        </td>
                        <td className={`py-1.5 px-3 text-right ${ef2 >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500'}`}>
                          {ef2 !== null && ef2 !== undefined ? `${ef2 >= 0 ? '+' : ''}${formatVal(ef2)}` : '-'}
                        </td>
                        <td className={`py-1.5 pl-3 text-right ${ef3 >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500'}`}>
                          {ef3 !== null && ef3 !== undefined ? `${ef3 >= 0 ? '+' : ''}${formatVal(ef3)}` : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* (b) Tabel Golongan dari month.groups (Pelanggan, kWh, kWh/Plg, Rp/kWh, Sumbangan Perubahan) */}
      {monthData?.groups && monthData.groups.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Rincian Menurut Golongan Tarif (Bulan {fmtMonth(monthData.month)})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Perbandingan jumlah pelanggan, kWh, intensitas pemakaian, dan pendapatan per golongan tarif.
              </p>
            </div>
            <span className="text-xs text-slate-400">
              Diurutkan dari dampak perubahan kWh terbesar
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">Golongan</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Pelanggan</th>
                  <th className="py-2.5 px-3 font-semibold text-right">kWh Jual</th>
                  <th className="py-2.5 px-3 font-semibold text-right">kWh / Plg</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Rp / kWh</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Pendapatan</th>
                  <th className="py-2 pl-3 font-semibold text-right">Sumbangan Perubahan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                {monthData.groups.map((g) => (
                  <tr key={g.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      <span>{g.name}</span> <span className="text-slate-400 font-normal">({g.key})</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div>{fmtInt(g.plg)}</div>
                      <div className="text-[10px] text-slate-400">th lalu: {fmtInt(g.plg_previous)}</div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div>{fmtKwh(g.kwh)}</div>
                      <div className="text-[10px] text-slate-400">th lalu: {fmtKwh(g.kwh_previous)}</div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div>{fmtFloat(g.kwh_per_plg, 1)}</div>
                      <div className="text-[10px] text-slate-400">th lalu: {fmtFloat(g.kwh_per_plg_previous, 1)}</div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div>{fmtRp(g.rp_per_kwh)}</div>
                      <div className="text-[10px] text-slate-400">th lalu: {fmtRp(g.rp_per_kwh_previous)}</div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div>{fmtRp(g.rp)}</div>
                      <div className="text-[10px] text-slate-400">th lalu: {fmtRp(g.rp_previous)}</div>
                    </td>
                    <td className="py-2 pl-3 text-right whitespace-nowrap font-sans font-semibold">
                      {g.kwh_share_of_change_pct !== null && g.kwh_share_of_change_pct !== undefined ? (
                        <span className={`px-2 py-0.5 rounded text-[11px] ${
                          g.kwh_share_of_change_pct > 0
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                        }`}>
                          {fmtPct(g.kwh_share_of_change_pct)}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Keterangan Arti Efek (notes[]) */}
      {notes.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <IconInfo className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Keterangan Definisi Dekomposisi Efek:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed pl-1">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
