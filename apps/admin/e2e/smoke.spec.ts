// ──────────────────────────────────────────────────────
// TenantScale Admin — Playwright smoke tests
// ──────────────────────────────────────────────────────
//
// Run: ADMIN_URL=http://localhost:3002 pnpm test:e2e
// Requires the admin dashboard to be running.

import { test, expect } from '@playwright/test'

test.describe('Admin Dashboard', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login')

    // Should show the login form
    await expect(page.locator('h1')).toContainText('TenantScale')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/tenants')

    // Should redirect to login since no session
    await page.waitForURL('**/login')
    await expect(page.locator('h1')).toContainText('TenantScale')
  })

  test('shows error on invalid login', async ({ page }) => {
    await page.goto('/login')

    await page.fill('input[type="email"]', 'bad@example.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // Should show an error message (or stay on login page)
    await expect(page).toHaveURL(/\/login/)
  })
})
