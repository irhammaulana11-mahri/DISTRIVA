import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import { IconArrowLeft } from '../components/icons.jsx'

export default function NotFoundPage() {
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="text-center p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 font-mono text-xl font-bold">
          404
        </div>
        <h2 className="text-lg font-bold text-slate-900">Halaman tidak ditemukan</h2>
        <p className="mt-1 text-sm text-slate-500">
          Halaman yang Anda tuju tidak tersedia atau akun Anda tidak memiliki hak akses yang diperlukan.
        </p>
        <div className="mt-5">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 underline hover:text-blue-900"
          >
            <IconArrowLeft size={16} />
            <span>Kembali ke beranda</span>
          </Link>
        </div>
      </Card>
    </div>
  )
}
