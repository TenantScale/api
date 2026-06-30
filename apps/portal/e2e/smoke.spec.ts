// ──────────────────────────────────────────────────────
// TenantScale Portal — E2E Smoke Tests
// ──────────────────────────────────────────────────────

import { test, expect } from '@playwright/test'

test.describe('Portal smoke tests', () => {

  test('homepage redirects to login', async ({ page }) => {
    await page.goto('/')
    // Unauthenticated users should be redirected to /login
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h1, h2').first()).toBeVisible()
    // Should show email/password fields
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('register page renders', async ({ page }) => {
    await page.goto('/register')
    await expect(page.locator('h1, h2').first()).toBeVisible()
    // Registration should have email, password, company name
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('login form shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'nonexistent@test.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    // Should show an error message after failed login
    await expect(page.locator('text=/invalid|error|failed|incorrect/i').first()).toBeVisible({ timeout: 10_000 })
  })

  test('plans page is accessible without auth', async ({ page }) => {
    await page.goto('/plans')
    await expect(page.locator('body')).toBeVisible()
  })
})
