const CHANNEL = { mail: 'Email', whatsapp: 'WhatsApp' }
const REASON = {
  mailer_not_deliverable: 'email belum dikonfigurasi',
  no_valid_email: 'alamat email tidak valid',
  no_provider_configured: 'penyedia WhatsApp belum dikonfigurasi',
  provider_not_configured: 'konfigurasi WhatsApp belum lengkap',
  no_valid_phone: 'nomor WhatsApp kosong/tidak valid',
}

export const channelName = (c) => CHANNEL[c] ?? c

// Human summary of the server's delivery report. It carries channel names and reasons only.
export function describeDelivery(d = {}) {
  const parts = []
  if (d.delivered?.length) parts.push(`Terkirim lewat ${d.delivered.map(channelName).join(' dan ')}.`)
  if (d.failed?.length) parts.push(`Gagal: ${d.failed.map(channelName).join(', ')}.`)
  const skipped = Object.entries(d.skipped ?? {})
  if (skipped.length) parts.push(`Dilewati: ${skipped.map(([c, r]) => `${channelName(c)} (${REASON[r] ?? r})`).join(', ')}.`)
  return parts.join(' ')
}
