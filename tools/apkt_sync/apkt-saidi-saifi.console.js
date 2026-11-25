/*
 * DISTRIVA — ambil "Laporan SAIDI SAIFI SE004" (bulanan, bukan Kumulatif) dari APKT (new-apktss.pln.co.id), per ULP per bulan, menjadi satu ZIP.
 * Hasil berjenis DIFI: sumber SAIDI/SAIFI/ENS NKO dan pembanding menu Gangguan Penyulang.
 *
 * PAKAI
 *  1. Login ke APKT seperti biasa dan buka menu Saidi Saifi > Laporan Saidi Saifi > Laporan SAIDI SAIFI SE004 (BUKAN yang Kumulatif: itu akumulasi sejak Januari). Biarkan halaman terbuka.
 *  2. F12 -> tab Console -> tempel seluruh isi berkas ini -> Enter.
 *  3. Klik "Lihat Laporan" SATU KALI di halaman itu. Skrip meminjam tanda masuk (Authorization) dari permintaan yang dikirim aplikasi sendiri;
 *     skrip TIDAK meminta atau menyimpan kata sandi dan token tidak ditulis ke mana pun. Tanpa klik itu skrip menunggu.
 *  4. Mode UJI (satu ULP, satu bulan) berjalan lebih dulu. Bila ZIP terunduh, ubah UJI menjadi false untuk semua ULP dan atur rentang bulan.
 *  5. Hasilnya satu ZIP per tahun (peramban mungkin meminta izin unduhan ganda). Unggah semuanya di DISTRIVA (Master Data > Laporan EIS > Unggah). Folder "ULP/BULAN" di dalam ZIP dibaca otomatis; jenis, ULP, dan bulan dikonfirmasi dari isi berkas.
 *
 * Skrip ini hanya memanggil API laporan APKT yang sama dengan tombol "Lihat Laporan", lalu membuat berkas Excel di komputer Anda.
 * Tempel hanya di konsol APKT milik Anda sendiri dan hanya skrip yang sudah Anda baca.
 */
(() => {
  const CONFIG = {
    UJI: true,                        // true = hanya ULP "uji" pada bulan "dari"; false = semua ULP pada rentang bulan
    uji: '51453',                     // ULP untuk mode uji
    dari: null,                       // 'YYYY-MM'; null = bulan lalu
    sampai: null,                     // 'YYYY-MM'; null = sama dengan "dari"
    idUid: 103,                       // Unit Induk (51 DISTRIBUSI JAWA TIMUR)
    idUp3: 149,                       // UP3 MOJOKERTO (51450)
    namaUid: 'DISTRIBUSI JAWA TIMUR', namaUp3: 'UP3 MOJOKERTO',
    jedaMs: 1500,                     // jeda antar permintaan
    tungguTokenMs: 180000,            // lama menunggu klik "Lihat Laporan"
    ulp: { '51450': 'MOJOAGUNG', '51452': 'MOJOKERTO', '51453': 'JOMBANG', '51454': 'NGORO', '51455': 'PLOSO', '51456': 'MOJOSARI', '51457': 'PACET', '51458': 'KERTOSONO', '51459': 'WARUJAYENG', '51460': 'NGANJUK' },
  };

  const NAMA_BULAN = ['Januari', 'Pebruari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'Nopember', 'Desember'];
  const pad = (n) => String(n).padStart(2, '0');
  const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthsBetween = (from, to) => {
    const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
    return out;
  };

  const QUERY = `query get($cmd: LaporanSaidiSaifiSE004CmdInput) {
  getLaporanSaidiSaifiSE004(cmd: $cmd) {
    status message
    data {
      kelompok { id nama totalKelompok_jumlahPelangganPadam totalKelompok_jumlahTotalPelanggan totalKelompok_jamXJumlahPelangganPadam totalKelompok_saidi totalKelompok_saidiPelanggan totalKelompok_saifi totalKelompok_jumlahGangguan totalKelompok_lamaPadam totalKelompok_kwhLoss
        subKelompok { id nama totalSubKelompok_jumlahPelangganPadam totalSubKelompok_jumlahTotalPelanggan totalSubKelompok_jamXJumlahPelangganPadam totalSubKelompok_saidi totalSubKelompok_saidiPelanggan totalSubKelompok_saifi totalSubKelompok_jumlahGangguan totalSubKelompok_lamaPadam totalSubKelompok_kwhLoss
          fasilitas { id nama totalFasilitas_jumlahPelangganPadam totalFasilitas_jumlahTotalPelanggan totalFasilitas_jamXJumlahPelangganPadam totalFasilitas_saidi totalFasilitas_saidiPelanggan totalFasilitas_saifi totalFasilitas_jumlahGangguan totalFasilitas_lamaPadam totalFasilitas_kwhLoss
            subFasilitas { id nama totalSubFasilitas_jumlahPelangganPadam totalSubFasilitas_jumlahTotalPelanggan totalSubFasilitas_jamXJumlahPelangganPadam totalSubFasilitas_saidi totalSubFasilitas_saidiPelanggan totalSubFasilitas_saifi totalSubFasilitas_jumlahGangguan totalSubFasilitas_lamaPadam totalSubFasilitas_kwhLoss
              equipment { id nama jumlahPelangganPadam jumlahTotalPelanggan jamXJumlahPelangganPadam saidi saidiPelanggan saifi jumlahGangguan lamaPadam kwhLoss } } } } }
      totalKeseluruhan { jumlahPelangganPadam jumlahTotalPelanggan jamXJumlahPelangganPadam saidi saidiPelanggan saifi jumlahGangguan lamaPadam kwhLoss } } } }`;

  // ---- ubah pohon GraphQL menjadi baris tabel seperti Excel APKT: kolom A..I ----
  const DASH = ['-', '-', '-', '-', '-', '-', '-'];
  const nilai = (o, p) => [o[`${p}jumlahPelangganPadam`], o[`${p}jamXJumlahPelangganPadam`], o[`${p}saidi`], o[`${p}saifi`], o[`${p}jumlahGangguan`], o[`${p}lamaPadam`], o[`${p}kwhLoss`]].map((v) => (v === null || v === undefined ? 0 : v));
  const idRow = (kode, label) => [kode, label, ...DASH];
  const totalRow = (label, values) => [null, label, ...values];

  const tableRows = (data) => {
    const rows = [];
    for (const k of data.kelompok || []) {
      rows.push(idRow(k.id, `KELOMPOK ${k.nama}`));
      for (const s of k.subKelompok || []) {
        rows.push(idRow(s.id, `SUB KELOMPOK ${s.nama}`));
        for (const f of s.fasilitas || []) {
          rows.push(idRow(f.id, `FASILITAS ${f.nama}`));
          for (const sf of f.subFasilitas || []) {
            rows.push(idRow(sf.id, `SUB FASILITAS ${sf.nama}`));
            for (const e of sf.equipment || []) rows.push([e.id, e.nama, ...nilai(e, '')]);
            rows.push(totalRow(`SUB TOTAL SUB FASILITAS ${sf.nama}`, nilai(sf, 'totalSubFasilitas_')));
          }
          rows.push(totalRow(`SUB TOTAL FASILITAS ${f.nama}`, nilai(f, 'totalFasilitas_')));
        }
        rows.push(totalRow(`TOTAL SUB KELOMPOK ${s.nama}`, nilai(s, 'totalSubKelompok_')));
      }
      rows.push(totalRow(`TOTAL KELOMPOK ${k.nama}`, nilai(k, 'totalKelompok_')));
    }
    const t = data.totalKeseluruhan;
    if (t) rows.push(totalRow('TOTAL KESELURUHAN', nilai(t, '')));
    return rows;
  };

  // angka format Indonesia pada kepala laporan: titik ribuan, koma desimal
  const idNum = (v, dec) => {
    const n = Number(v) || 0;
    const [i, d] = n.toFixed(dec).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? `,${d}` : '');
  };

  const sheetRows = (data, ctx) => {
    const t = data.totalKeseluruhan || {};
    const head = [
      ['PT. PLN (PERSERO)'], [], [`UNIT INDUK : ${ctx.namaUid}`], [`UNIT PELAKSANA PELAYANAN PELANGGAN : ${ctx.namaUp3}`], [`UNIT LAYANAN PELANGGAN : ULP ${ctx.namaUlp}`], [],
      ['LAPORAN SAIDI SAIFI'], [`${NAMA_BULAN[ctx.bulan - 1]} ${ctx.tahun}`], [],
      ['Jumlah Pelanggan : ', idNum(t.jumlahTotalPelanggan, 0), '(Plg)'], [],
      ['SAIDI : ', idNum(t.saidi, 4), '(Jam/Plg)', idNum(t.saidiPelanggan, 4), '(Menit/Plg)'],
      ['SAIFI : ', idNum(t.saifi, 4), '(Kali/Plg)'], [],
      [],
      ['NO. KODE\n(a)', 'PENYEBAB GANGGUAN\n(b)', 'JML PLG PADAM\n(c)', 'JAM X JML PELANGGAN PADAM\n(d)', 'SAIDI (JAM)\n(e)=(d)/(plg)', 'SAIFI (KALI)\n(f)=(c)/(plg)', 'JUMLAH GANGGUAN (KALI)\n(h)', 'LAMA PADAM (JAM)\n(i)', 'KWH TAK TERSALURKAN\n(j)'],
    ];
    return head.concat(tableRows(data));
  };

  // ---- ZIP tanpa kompresi (dipakai untuk .xlsx dan untuk ZIP hasil; tanpa pustaka luar, tanggal tetap supaya isi sama = hash sama) ----
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const zipBytes = (files) => {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const crc = crc32(f.data); const size = f.data.length;
      const body = f.packed || f.data; const method = f.packed ? 8 : 0; const csize = body.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, csize, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, csize, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + csize;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0)); let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  };

  // ---- berkas .xlsx minimal (teks sebagai inlineStr, angka sebagai angka) ----
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => String.fromCharCode(65 + i);
  const sheetXml = (rows) => {
    const body = rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = `${colName(ci)}${ri + 1}`;
        return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }).join('');
      return cells ? `<row r="${ri + 1}">${cells}</row>` : '';
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const xlsxBytes = (rows) => {
    const enc = new TextEncoder(); const f = (name, text) => ({ name, data: enc.encode(text) });
    return zipBytes([
      f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
      f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      f('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="LAPORAN SAIDI SAIFI" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      f('xl/worksheets/sheet1.xml', sheetXml(rows)),
    ]);
  };

  const buildReport = (data, ctx) => xlsxBytes(sheetRows(data, ctx));

  // dipakai uji otomatis (node); di peramban bagian di bawah yang berjalan
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { sheetRows, buildReport, zipBytes, idNum, QUERY, CONFIG };
    return;
  }

  (async () => {
    // ---- pinjam tanda masuk dari permintaan GraphQL aplikasi sendiri ----
    const captured = {};
    const take = (url, auth) => { if (/graphql/i.test(String(url)) && auth && /^Bearer\s+\S+/i.test(auth)) { captured.url = String(url); captured.auth = auth; } };
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input && input.url;
        const h = (init && init.headers) || (input && input.headers);
        const auth = h && (typeof h.get === 'function' ? h.get('Authorization') : h.Authorization || h.authorization);
        take(url, auth);
      } catch { /* abaikan */ }
      return origFetch.apply(this, arguments);
    };
    const xOpen = XMLHttpRequest.prototype.open; const xSet = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, url) { this.__apkt = String(url); return xOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (/^authorization$/i.test(k)) take(this.__apkt, v); return xSet.apply(this, arguments); };

    console.log('Klik "Lihat Laporan" satu kali di halaman APKT agar skrip bisa meminjam tanda masuk. Menunggu...');
    const t0 = Date.now();
    while (!captured.auth && Date.now() - t0 < CONFIG.tungguTokenMs) await new Promise((r) => setTimeout(r, 500));
    window.fetch = origFetch; XMLHttpRequest.prototype.open = xOpen; XMLHttpRequest.prototype.setRequestHeader = xSet;
    if (!captured.auth) { console.error('Dibatalkan: tidak ada permintaan GraphQL ber-Authorization terdeteksi. Pastikan sudah login, lalu jalankan ulang dan klik "Lihat Laporan".'); return; }
    console.log('Tanda masuk terdeteksi; mulai mengambil laporan.');

    const fetchOne = async (ulpCode, ym) => {
      const [tahun, bulan] = ym.split('-').map(Number);
      const res = await fetch(captured.url, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': captured.auth, 'X-Client-UTC': 'UTC+07:00' },
        body: JSON.stringify({ query: QUERY, variables: { cmd: { idUid: [CONFIG.idUid], idUp3: [CONFIG.idUp3], idUlp: [Number(ulpCode)], bulan, tahun, idEquipment: 0 } } }),
      });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { /* dilaporkan di bawah */ }
      const out = json && json.data && json.data.getLaporanSaidiSaifiSE004;
      if (!res.ok || !out || out.status !== true || !out.data) {
        throw new Error(`HTTP ${res.status}: ${(json && ((json.errors && json.errors[0] && json.errors[0].message) || (out && out.message))) || text.slice(0, 200)}`);
      }
      const d = out.data;
      if (!d.totalKeseluruhan || !(d.kelompok || []).length) throw new Error('laporan kosong (tidak ada kelompok / total keseluruhan)');

      return buildReport(d, { bulan, tahun, namaUid: CONFIG.namaUid, namaUp3: CONFIG.namaUp3, namaUlp: CONFIG.ulp[ulpCode] || ulpCode });
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
          const data = await fetchOne(code, ym);
          files.push({ name: `${CONFIG.ulp[code] || code}/${ym}/DIFI-${code}-${ym.slice(5)}${ym.slice(0, 4)}.xlsx`, data });
          console.log(`OK     ${label} (${data.length} byte)`);
        } catch (e) {
          gagal.push(label);
          console.error(`GAGAL  ${label}: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, CONFIG.jedaMs));
      }
    }

    if (!files.length) { console.error('Tidak ada berkas yang berhasil; ZIP tidak dibuat.'); return; }
    // ZIP dipecah per tahun (batas impor 400 berkas per ZIP dan batas ukuran unggah) dan dikompresi bila peramban mendukung
    const pack = async (u8) => (typeof CompressionStream === 'undefined' ? null : new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()));
    const years = [...new Set(files.map((f) => f.name.split('/')[1].slice(0, 4)))].sort();
    for (const y of years) {
      const part = files.filter((f) => f.name.split('/')[1].startsWith(y));
      for (const f of part) f.packed = await pack(f.data);
      const nameZip = `apkt-saidi-saifi-${y}${CONFIG.UJI ? '-uji' : ''}.zip`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zipBytes(part)], { type: 'application/zip' })); a.download = nameZip;
      document.body.appendChild(a); a.click(); a.remove();
      console.log(`ZIP ${nameZip}: ${part.length} berkas`);
      await new Promise((r) => setTimeout(r, 800));
    }
    console.log(`Selesai: ${files.length} berkas dalam ${years.length} ZIP (${from} s.d. ${to})${gagal.length ? `; GAGAL ${gagal.length}: ${gagal.join(', ')}` : ''}. Bila peramban menanyakan unduhan ganda, izinkan.`);
  })();
})();
