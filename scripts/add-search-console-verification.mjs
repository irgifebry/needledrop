#!/usr/bin/env node
/**
 * Put a Google Search Console verification file at the site root.
 *
 * Search Console offers two ways to prove a domain is yours: a DNS TXT
 * record, or a file at the site root. The DNS route is closed for
 * `*.vercel.app` — Vercel refuses DNS records for those subdomains — so the
 * HTML file is the way through, and the file has to be served from the root
 * under the exact name Google chose.
 *
 * Usage:
 *   npm run verify:sc -- path/to/googleXXXX.html
 *
 * The file is copied byte for byte. It is not regenerated from the token:
 * the token in these files is not always a bare string — some of them carry
 * the file extension — and the file Google hands out has no trailing
 * newline. Verifying is an exact comparison, so rewriting it is a way to
 * fail for no reason.
 *
 * The copy is committed, so the proof is in the history and a redeploy
 * cannot lose it.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const [source] = process.argv.slice(2)

if (!source) {
  console.error('Usage: npm run verify:sc -- <path/to/googleXXXX.html>')
  process.exit(1)
}

// Google names the file google<hash>.html. Anything else is a typo, and a
// stray file at the site root is worse than no file at all.
const name = basename(source)
if (!/^google[a-zA-Z0-9_.-]+\.html$/.test(name)) {
  console.error(`\`${name}\` is not a Google verification filename (expected googleXXXX.html).`)
  process.exit(1)
}

const body = await readFile(source, 'utf8')

// The body is one line: `google-site-verification: <token>`. Checking the
// shape catches a file that was truncated in transit, or an HTML error page
// that was saved under the verification name.
if (!/^google-site-verification:\s*\S+\s*$/.test(body.trim())) {
  console.error('That file does not look like a Search Console verification file.')
  console.error('Expected a single line: google-site-verification: <token>')
  process.exit(1)
}

const target = join(process.cwd(), 'public', name)
await writeFile(target, body, 'utf8')
await copyFile(source, target)

const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
console.log(`Wrote public/${name} (${Buffer.byteLength(body)} bytes, verbatim)`)
console.log(`  ${origin.replace(/\/$/, '')}/${name}`)
console.log('')
console.log('Next: commit it, let the deploy finish, then press Verify in Search Console.')
