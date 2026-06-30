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
