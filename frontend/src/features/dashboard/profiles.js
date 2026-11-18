/**
 * Profil dasbor / menu per peran kerja.
 *
 * Frontend tidak menerima nama role dari `/me`; yang tersedia adalah peta kapabilitas `can` dari endpoint
 * endpoint access (admin, master-data, applications, dst.). Profil ditentukan dari kapabilitas "pembeda" tiap peran (docs/03, config/distriva_permissions.php).
 * Ini hanya petunjuk tampilan: hak akses sebenarnya tetap diputuskan server.
 */

export const PROFILE_LABEL = {
  executive: 'Pimpinan UP3 / Asman',
  mulp: 'Manager ULP',
  teknik: 'Teknik ULP',
  niaga: 'Niaga / Pelayanan',
  perencanaan: 'Perencanaan & Enjiniring',
  konstruksi: 'Konstruksi & Logistik',
  vendor: 'Mitra / Vendor',
  viewer: 'Pemantau (baca saja)',
  admin: 'Administrasi Sistem',
  general: 'Beranda',
}

// Urutan = prioritas profil utama bila satu pengguna memegang beberapa peran.
const FINGERPRINTS = [
  [
    'executive',
    [
      'rkm.approve',
      'wo.issue',
      'bastp.close',
      'surveys.approve_asman_perencanaan',
      'surveys.approve_asman_konstruksi',
      'drawings.approve_asman_niaga',
      'drawings.approve_up3_manager',
      'surveys.approve_up3_manager',
      'khs.approve',
    ],
  ],
  ['mulp', ['surveys.assign', 'rkm.submit', 'mto.approve', 'drawings.approve_ulp', 'bastp.accept']],
  ['teknik', ['surveys.execute', 'rkm.prepare', 'mto.execute', 'kko.decide', 'bastp.prepare']],
  ['niaga', ['applications.create', 'applications.import', 'applications.submit']],
  ['perencanaan', ['rkm.plan', 'poles.manage', 'kkf.run', 'rab.run', 'khs.manage', 'prices.manage']],
  [
    'konstruksi',
    ['wo.create', 'material_requests.manage', 'stock.import', 'warehouses.manage', 'wo.progress_verify', 'bastp.sign_konstruksi'],
  ],
]

const holdsAny = (can, keys) => keys.some((k) => Boolean(can?.[k]))

/** Daftar profil yang berlaku untuk pengguna (profil pertama = utama). Tidak pernah kosong. */
export function resolveProfiles({ can = {}, isSysAdmin = false } = {}) {
  if (isSysAdmin) return ['admin']

  // Akun mitra: hanya portal vendor (tidak memegang kunci SPK internal).
  if (can['vendor.portal'] && !can['wo.view']) return ['vendor']

  const out = []
  for (const [id, keys] of FINGERPRINTS) {
    if (holdsAny(can, keys)) out.push(id)
  }
  if (can['vendor.portal']) out.push('vendor')
  // UP3_ADMIN: kelola pengguna/unit tanpa kunci operasional.
  if (can['users.view'] && !can['reports.view'] && !can['wo.view']) out.push('admin')
  if (out.length === 0) out.push(can['reports.view'] || can['master_data.view'] ? 'viewer' : 'general')
  return out
}

/**
 * Apakah item menu boleh tampil untuk profil-profil ini?
 * `profiles` tidak diisi = semua profil (tetap disaring kapabilitas). Admin & pemantau melihat semua yang diizinkan server.
 */
export function visibleForProfiles(item, userProfiles) {
  if (!item.profiles) return true
  if (userProfiles.includes('admin') || userProfiles.includes('viewer') || userProfiles.includes('general')) return true
  return item.profiles.some((p) => userProfiles.includes(p))
}

/**
 * Profil khusus penyaring menu (bukan dasbor). Asman Jaringan memegang hak harga/KHS yang sama dengan Perencanaan di server, tetapi
 * bidang kerjanya jaringan, gardu, penyulang, dan vendor: tanpa hak khas Perencanaan (tiang, KKF, RAB) ia diberi profil `jaringan`
 * sehingga menu harga, tarif, dan KKF tidak ditampilkan. Dasbor tetap memakai `resolveProfiles`. Hanya tampilan; server tetap memutuskan.
 */
export function resolveMenuProfiles(args = {}) {
  const base = resolveProfiles(args)
  const can = args.can || {}
  if (base.includes('perencanaan') && !holdsAny(can, ['poles.manage', 'kkf.run', 'rab.run'])) {
    return base.map((p) => (p === 'perencanaan' ? 'jaringan' : p))
  }
  return base
}
