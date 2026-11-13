export default function Spinner({ label = 'Memuat…' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-8 text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      <span className="text-sm">{label}</span>
    </div>
  )
}
