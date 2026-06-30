import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TenantScale Portal',
  description: 'Manage your tenant — users, API keys, settings, and audit logs',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#080b18] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
