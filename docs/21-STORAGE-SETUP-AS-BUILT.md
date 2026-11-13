# 21 — Konfigurasi Storage Server (As-Built)

**Tanggal pencatatan:** 5 November 2026  
**Sumber:** output terminal server Ubuntu yang diberikan pengguna.  
**Status:** mount, struktur direktori, group dan uji akses dasar berhasil; reboot dan integrasi Laravel belum diuji.

## 1. Disk dan mount permanen

| Properti | Nilai |
|---|---|
| Device | `/dev/sda1` |
| Label | `DATA` |
| UUID | `8d910585-b015-4a17-8e69-fd939c583d9f` |
| Filesystem | ext4 |
| Mount point | `/srv/distriva-data` |
| Kapasitas filesystem | 458 GB |
| Ruang tersedia saat verifikasi | sekitar 435 GB |
| Mode mount | read-write |

Entri `/etc/fstab` yang dipasang:

```fstab
UUID=8d910585-b015-4a17-8e69-fd939c583d9f /srv/distriva-data ext4 defaults,nofail 0 2
```

`sudo findmnt --verify --verbose` menghasilkan `Success, no errors or warnings detected`. `findmnt /srv/distriva-data` menunjukkan `/dev/sda1` ext4 `rw`. Uji membuat dan menghapus file berhasil. Unmount dari path lama `/run/media/adminserver/DATA` menjawab `no mount point specified`, lalu `mount -a` dan verifikasi mount baru berhasil. Reboot belum dilakukan; persistensi boot belum dibuktikan melalui reboot terencana.

Disk ini adalah disk SATA lokal kedua pada server yang sama, bukan NAS/off-site backup. Jangan menganggapnya sebagai backup terpisah dari kegagalan server.

## 2. Struktur direktori dibuat

```text
/srv/distriva-data/distriva/
├── backups/
├── documents/
│   ├── applications/
│   ├── completion/
│   ├── construction/
│   ├── drawings/
│   ├── feasibility/
│   ├── meter-installation/
│   ├── payment/
│   ├── rab-kkf/
│   ├── registration/
│   ├── survey/
│   └── work-orders/
├── exports/
├── imports/
├── logs/
└── temp/
```

## 3. Group dan permission

- Group sistem `distriva` dibuat.
- User `www-data` ditambahkan sebagai anggota group `distriva` (`id www-data` memperlihatkan supplementary group tersebut).
- Kepemilikan tree: `adminserver:distriva`.
- Direktori `documents`, `exports`, `imports`, `logs`, `temp`: mode `2770`, default ACL untuk owner/group, `other` tanpa akses.
- Direktori `backups`: mode `2750`, ACL tambahan dan default ACL dihapus; owner `adminserver`, group `distriva`.
- Direktori induk `/srv/distriva-data` memiliki mode akses yang memungkinkan traversal oleh proses `www-data`; `/srv/distriva-data/distriva` membatasi akses other.

Uji `sudo -u www-data touch .../documents/.permission-test` berhasil, `getfacl` menunjukkan owner `www-data`, group `distriva`, dan `other::---`; penghapusan file juga berhasil.

## 4. Batasan dan pekerjaan tersisa

1. Belum ada Laravel DISTRIVA pada server; integrasi `filesystems.php`, private download/preview, authorization, dan organizational scope belum diuji.
2. Proses PHP-FPM dan Supervisor yang sudah berjalan sebelum perubahan supplementary group mungkin belum memuat group baru. Belum dilakukan restart/reload layanan; jangan restart ANTRIAN-KU tanpa rencana maintenance. Saat deployment DISTRIVA, pastikan proses baru berjalan dengan group `distriva`.
3. Direktori `backups` saat ini hanya dapat ditulis owner `adminserver`; ini disengaja untuk mencegah proses aplikasi menulis backup secara bebas. Tentukan backup service khusus saat implementasi.
4. Default ACL pada direktori writable diterapkan agar group mendapat akses; tetap uji mode file hasil upload dan pastikan tidak ada akses publik.
5. Perlu uji reboot terencana, pemeriksaan SMART disk, monitoring kapasitas, backup off-site, dan restore test.
6. Jangan menggunakan `chmod 777` atau memindahkan source code aplikasi ke disk dokumen.
