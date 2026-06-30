import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a date for display — respects browser locale by default
 */
export function formatDate(date: string | Date, locale?: string) {
  return new Intl.DateTimeFormat(locale ?? undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date))
}

/**
 * Format a date relative to now (e.g. "2 hours ago")
 */
export function timeAgo(date: string | Date) {
  const now = new Date()
  const d = new Date(date)
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(date)
}

/**
 * Truncate a UUID for display
 */
export function truncateId(id: string, chars = 8) {
  return id.length > chars ? `${id.slice(0, chars)}...` : id
}

/**
 * Role badge color mapping
 */
export function roleBadgeColor(role: string) {
  const colors: Record<string, string> = {
    owner: 'bg-amber-900/50 text-amber-400',
    admin: 'bg-blue-900/50 text-blue-400',
    member: 'bg-gray-800 text-gray-300',
    viewer: 'bg-gray-800/50 text-gray-500',
  }
  return colors[role] ?? 'bg-gray-800 text-gray-300'
}

/** Admin-level roles for tenant management operations */
export const ADMIN_ROLES = ['owner', 'admin'] as const

/** Check if a role has tenant admin/owner privileges */
export function isTenantAdmin(role: string | null | undefined): boolean {
  return role ? ADMIN_ROLES.includes(role as typeof ADMIN_ROLES[number]) : false
}

export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
