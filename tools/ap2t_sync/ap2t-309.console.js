/*
 * DISTRIVA — ambil laporan 309 (Penjualan Tenaga Listrik versi pusat TOTAL) dari AP2T, per ULP per bulan, menjadi satu ZIP.
 *
 * PAKAI
 *  1. Login ke AP2T seperti biasa (dengan program enkripsi) dan biarkan halaman AP2T terbuka. Wajib: tanpa sesi login AP2T tetap membuat Excel tetapi KOSONG.
 *     Skrip ini TIDAK login dan TIDAK menyentuh password: ia hanya memakai sesi peramban Anda yang sudah login, ke alamat AP2T yang sama (same-origin).
 *  2. Tekan F12 -> tab Console -> tempel seluruh isi berkas ini -> Enter. Isi USER ID AP2T Anda saat ditanya (hanya dipakai pada permintaan ke AP2T, tidak disimpan).
 *  3. Pertama kali berjalan dalam mode UJI (satu ULP, satu bulan). Bila berhasil dan ZIP terunduh, ubah UJI menjadi false untuk semua ULP.
 *  4. Unggah ZIP di DISTRIVA (Master Data > Laporan EIS > Unggah). Folder "ULP/BULAN" di dalam ZIP dibaca otomatis; jenis, ULP, dan bulan dikonfirmasi dari isi berkas.
 *
 * Hanya tempel skrip di konsol halaman AP2T milik Anda sendiri, dan hanya skrip yang sudah Anda baca. Skrip ini tidak mengirim apa pun ke luar AP2T: hasilnya diunduh ke komputer Anda.
 */
(async () => {
  const CONFIG = {
    UJI: true,                       // true = hanya ULP "uji" pada bulan "dari"; false = semua ULP pada rentang bulan
    uji: '51453',                    // ULP untuk mode uji
    dari: null,                      // 'YYYY-MM'; null = bulan lalu
    sampai: null,                    // 'YYYY-MM'; null = sama dengan "dari"
    up3: '51MJK', upi: '51', jenis: 'TOTAL', pembukuan: 'plus',
    minByte: 20000,                  // Excel 309 asli sekitar 45 KB; lebih kecil dari ini = kosong (biasanya sesi belum login)
    jedaMs: 1500,                    // jeda antar permintaan supaya tidak membebani AP2T
    ulp: { '51450': 'MOJOAGUNG', '51452': 'MOJOKERTO', '51453': 'JOMBANG', '51454': 'NGORO', '51455': 'PLOSO', '51456': 'MOJOSARI', '51457': 'PACET', '51458': 'KERTOSONO', '51459': 'WARUJAYENG', '51460': 'NGANJUK' },
  };
  const BASE = `${location.origin}/BillingTerpusatAP2TNew1-dr/`;
  const NAMA_BULAN = ['Januari', 'Pebruari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'Nopember', 'Desember'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const pad = (n) => String(n).padStart(2, '0');
  const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthsBetween = (from, to) => {
    const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
    return out;
  };

  // ---- ZIP tanpa kompresi (cukup untuk .xls, tanpa pustaka luar) ----
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const makeZip = (files) => {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const crc = crc32(f.data); const size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  };

  // ---- ambil satu laporan ----
  const user = (prompt('User ID AP2T Anda (hanya dipakai untuk permintaan ke AP2T, tidak disimpan):') || '').trim();
  if (!user) { console.warn('Dibatalkan: User ID kosong.'); return; }

  const fetchOne = async (ulpCode, ym) => {
    const [tahun, bulan] = ym.split('-');
    const nama = NAMA_BULAN[Number(bulan) - 1];
    const q = `query=${ulpCode};${CONFIG.up3};${CONFIG.upi};${tahun}${bulan};${CONFIG.jenis};${CONFIG.pembukuan}&usernya=${encodeURIComponent(user)}&_dc=${Date.now()}&ext-gen35=${nama}&ext-gen37=${tahun}&jenisrekap=${CONFIG.jenis}`;
    const reg = await fetch(`${BASE}getreport3071_baru.json?${q}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const body = await reg.text();
    let id;
    try { id = JSON.parse(body).list?.[0]?.idreport; } catch { /* dilaporkan di bawah */ }
    if (!reg.ok || !id) throw new Error(`pendaftaran laporan gagal (HTTP ${reg.status}): ${body.slice(0, 200)}`);
    const rep = await fetch(`${BASE}ReportServlet?jenislaporan=gettul309&report=${encodeURIComponent('report/STAND/CR_LAP_309_PUSATNEW.rpt')}&idreport=${encodeURIComponent(id)}&export_fmt=xls`, { credentials: 'same-origin' });
    const data = new Uint8Array(await rep.arrayBuffer());
    const xls = data[0] === 0xD0 && data[1] === 0xCF && data[2] === 0x11 && data[3] === 0xE0;   // Excel biner lama
    const xlsx = data[0] === 0x50 && data[1] === 0x4B;                                         // xlsx (zip)
    if (!rep.ok || !(xls || xlsx)) {
      throw new Error(`hasil bukan Excel (HTTP ${rep.status}, ${rep.headers.get('content-type')}): ${new TextDecoder().decode(data.slice(0, 200)).replace(/\s+/g, ' ')}`);
    }

    if (data.length < CONFIG.minByte) throw new Error(`berkas hanya ${data.length} byte (kemungkinan kosong): pastikan sudah login di AP2T`);

    return { data, ext: xlsx ? 'xlsx' : 'xls' };
  };

  const from = CONFIG.dari || lastMonth();
  const to = CONFIG.sampai || from;
  const ulps = CONFIG.UJI ? [CONFIG.uji] : Object.keys(CONFIG.ulp);
  const months = CONFIG.UJI ? [from] : monthsBetween(from, to);
  console.log(`Mulai: ${ulps.length} ULP x ${months.length} bulan (${from} s.d. ${to})${CONFIG.UJI ? ' [MODE UJI]' : ''}`);

  const files = []; const gagal = [];
  for (const ym of months) {
    for (const code of ulps) {
      const label = `${CONFIG.ulp[code] || code} ${ym}`;
      try {
        const { data, ext } = await fetchOne(code, ym);
        files.push({ name: `${CONFIG.ulp[code] || code}/${ym}/309.${ext}`, data });
        console.log(`OK     ${label} (${data.length} byte)`);
      } catch (e) {
        gagal.push(label);
        console.error(`GAGAL  ${label}: ${e.message}`);
      }
      await sleep(CONFIG.jedaMs);
    }
  }

  if (!files.length) { console.error('Tidak ada berkas yang berhasil; ZIP tidak dibuat.'); return; }
  const nameZip = `ap2t-309-${from}${to !== from ? `_${to}` : ''}${CONFIG.UJI ? '-uji' : ''}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files)); a.download = nameZip;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Selesai: ${files.length} berkas masuk ${nameZip}${gagal.length ? `; GAGAL ${gagal.length}: ${gagal.join(', ')}` : ''}.`);
})();
