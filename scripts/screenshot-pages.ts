import { chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3099'
const OUT_DIR = path.join(process.cwd(), 'screenshots')

const PAGES = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/dashboard/orders', name: 'orders' },
  { path: '/dashboard/inventory', name: 'inventory' },
  { path: '/dashboard/integrations', name: 'integrations' },
  { path: '/dashboard/events', name: 'events' },
  { path: '/dashboard/failed', name: 'failed' },
  { path: '/dashboard/mappings', name: 'mappings' },
  { path: '/dashboard/settings', name: 'settings' },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
]

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    })
    const page = await context.newPage()

    for (const pg of PAGES) {
      const url = `${BASE_URL}${pg.path}`
      console.log(`[${viewport.name}] ${pg.name} → ${url}`)

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
        // Wait extra for client components to hydrate
        await page.waitForTimeout(1500)

        const filename = `${pg.name}-${viewport.name}.png`
        await page.screenshot({
          path: path.join(OUT_DIR, filename),
          fullPage: true,
        })
        console.log(`  ✓ saved ${filename}`)
      } catch (err: any) {
        console.error(`  ✗ ${pg.name} failed: ${err.message}`)
      }
    }

    await context.close()
  }

  await browser.close()
  console.log(`\nDone! Screenshots saved to ${OUT_DIR}`)
}

main().catch(console.error)
