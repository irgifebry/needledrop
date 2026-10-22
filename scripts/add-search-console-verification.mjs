#!/usr/bin/env node
/**
 * Add a Google Search Console verification file to `public/`.
 *
 * Search Console offers two ways to prove a domain is yours: a DNS TXT
 * record, or a file at the site root. The DNS route is closed for
 * `*.vercel.app` — Vercel refuses DNS records for those subdomains — so the
 * HTML file is the way through, and the file has to be served from the root
 * with an exact name.
 *
 * Usage:
 *   npm run verify:sc -- google1a2b3c4d5e6f.html 1a2b3c4d5e6f7890
 *
 * The filename and the token come from Search Console: add the property,
 * choose the "HTML file" method, and download the file. Its name is the
 * first argument and the token inside it is the second.
 *
 * The file is committed, so the proof is in the history and a fresh deploy
 * cannot lose it.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [filename, token] = process.argv.slice(2)

if (!filename || !token) {
  console.error('Usage: npm run verify:sc -- <googleXXXX.html> <token>')
  process.exit(1)
}

// Google names the file google<hash>.html. Anything else is a typo, and a
// stray file at the site root is worse than no file at all.
if (!/^google[a-zA-Z0-9_-]+\.html$/.test(filename)) {
  console.error(`\`${filename}\` is not a Google verification filename (expected googleXXXX.html).`)
  process.exit(1)
}

// The token is the value after the colon in the file Google hands out.
if (!/^[a-zA-Z0-9_-]{20,}$/.test(token)) {
  console.error('The token looks wrong — it should be a long alphanumeric string.')
  process.exit(1)
}

const target = join(process.cwd(), 'public', filename)
const body = `google-site-verification: ${token}\n`

await writeFile(target, body, 'utf8')

console.log(`Wrote public/${filename}`)
console.log(`  https://${process.env.NEXT_PUBLIC_APP_URL ?? 'localhost:3000'}/${filename}`)
console.log('')
console.log('Next: commit it and let the deploy finish, then press Verify in Search Console.')
