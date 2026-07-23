/**
 * Build script: bundle the Hono API for Vercel serverless function.
 * Outputs a single ESM file at api/bundle.js that Vercel can deploy
 * without needing cross-file module resolution.
 */
import * as esbuild from 'esbuild'

const isDev = process.argv.includes('--dev')

async function main() {
  console.log('Building Vercel bundle...')

  const result = await esbuild.build({
    entryPoints: ['api/index.ts'],
    bundle: true,
    outfile: 'api/bundle.js',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev,
    logLevel: 'info',
    // These are external because they come from npm in the serverless environment
    external: [
      '@sentry/node',
      '@supabase/supabase-js',
      '@tenantscale/sdk',
      'hono',
      'hono/*',
      'pino',
      'pino/*',
      'stripe',
      'zod',
    ],
    // pino uses worker_threads internally - bundle to avoid runtime issues
    packages: 'external',
    treeShaking: true,
  })

  if (result.errors.length > 0) {
    console.error('Build failed:', result.errors)
    process.exit(1)
  }

  console.log(`Bundle written to api/bundle.js (${result.outputFiles ? result.outputFiles[0].text.length : 'unknown'} bytes)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
