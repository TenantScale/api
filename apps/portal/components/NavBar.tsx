'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface NavBarProps {
  email?: string
  isSuperAdmin?: boolean
}

export default function NavBar({ email, isSuperAdmin }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const baseItems = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Users', href: '/users' },
    { label: 'API Keys', href: '/api-keys' },
    { label: 'Audit Log', href: '/audit' },
    { label: 'Settings', href: '/settings' },
  ]

  const adminItems = [
    { label: 'Tenants', href: '/tenants' },
    { label: 'Plans', href: '/plans' },
  ]

  const allItems = isSuperAdmin
    ? [...baseItems.slice(0, 1), ...adminItems, ...baseItems.slice(1)]
    : baseItems

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L30 10V22L16 30L2 22V10L16 2Z" fill="#6366f1" opacity="0.2"/>
            <path d="M16 6L24 10.5V19.5L16 24L8 19.5V10.5L16 6Z" fill="#00E5D1" opacity="0.6"/>
            <circle cx="16" cy="15" r="3" fill="#00E5D1"/>
          </svg>
          <h1 className="text-lg font-semibold">
            <span className="text-gray-300">Tenant</span><span className="text-[#00E5D1]">Scale</span>
          </h1>
        </div>

        <nav className="flex items-center gap-6 text-sm">
          {allItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200'}
              >
                {item.label}
                {item.label === 'Tenants' && isSuperAdmin ? (
                  <span className="ml-1.5 rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] text-indigo-400">SA</span>
                ) : null}
                {item.label === 'Plans' && isSuperAdmin ? (
                  <span className="ml-1.5 rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] text-indigo-400">SA</span>
                ) : null}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-4">
          {email && <span className="text-sm text-gray-400 hidden sm:inline">{email}</span>}
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-300">
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
