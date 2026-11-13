/**
 * Utility functions for Backup & Restore operations in Indonesian formatting
 */

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '-'
  const num = Number(bytes)
  if (num === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(num) / Math.log(k))
  const val = num / Math.pow(k, i)
  return `${val.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${sizes[i]}`
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return dateStr
  }
}

export function formatTriggerLabel(trigger) {
  switch (trigger) {
    case 'MANUAL':
      return 'Manual'
    case 'SCHEDULED':
      return 'Terjadwal'
    case 'PRE_RESTORE':
      return 'Pengaman Sebelum Pemulihan'
    default:
      return trigger || '-'
  }
}

export function isOlderThanHours(dateStr, hours = 36) {
  if (!dateStr) return true
  try {
    const time = new Date(dateStr).getTime()
    if (isNaN(time)) return true
    const now = Date.now()
    const diffHours = (now - time) / (1000 * 60 * 60)
    return diffHours > hours
  } catch {
    return true
  }
}
