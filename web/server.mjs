// Static server for Railway.
//
// Railway runs containers rather than serving static files, so the built SPA
// needs something in front of it. This is deliberately dependency-free: the
// whole job is reading files out of dist/ and setting the right headers, and
// pulling in a server framework to do that would add supply-chain surface for
// no benefit.
//
// It reproduces what public/_headers and wrangler.jsonc give us on Cloudflare:
// the same Content-Security-Policy, immutable caching for fingerprinted
// assets, no-cache on the shell, and index.html served for unknown paths so a
// deep link survives a refresh.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, 'dist')
const PORT = Number(process.env.PORT) || 8080
const SUPABASE = 'https://bmnhxvdnvytdrpqgvxts.supabase.co'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Origin serving the map basemap, when one is hosted off this domain.
 *
 * A self-hosted .pmtiles file needs nothing here -- it is same-origin and
 * already covered by 'self', which is the reason to prefer it. This exists so a
 * hosted style (MapTiler, Stadia, a CDN) can be allowed without editing the
 * policy by hand, and so the allowance is one named origin rather than a
 * wildcard.
 */
const BASEMAP_ORIGIN = (() => {
  const raw = (process.env.BASEMAP_ORIGIN ?? '').trim()
  if (!raw) return ''
  try {
    // Parsed rather than interpolated: a malformed value would otherwise inject
    // directives into the policy.
    return new URL(raw).origin
  } catch {
    console.warn(`BASEMAP_ORIGIN is not a valid URL, ignoring: ${raw}`)
    return ''
  }
})()

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), geolocation=(self)',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    // Inline styles are needed because progress bars set width via a style attribute.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${BASEMAP_ORIGIN}`.trim(),
    "font-src 'self'",
    // MapLibre runs its tile parsing in workers created from blob: URLs, so
    // without worker-src the map fails with no visible error.
    "worker-src 'self' blob:",
    `connect-src 'self' ${SUPABASE} ${SUPABASE.replace('https://', 'wss://')} ${BASEMAP_ORIGIN}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
}

/** Resolve a URL path to a file inside dist/, or null if it escapes the root. */
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = resolve(join(ROOT, normalize(decoded)))
  // normalize() alone does not stop `../` once symlinks or encoding are involved;
  // the prefix check is what actually confines reads to dist/.
  return candidate === ROOT || candidate.startsWith(ROOT + '/') ? candidate : null
}

async function readIfFile(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? await readFile(path) : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS })
    return res.end('Method Not Allowed')
  }

  const path = safePath(req.url || '/')
  if (!path) {
    res.writeHead(403, SECURITY_HEADERS)
    return res.end('Forbidden')
  }

  let body = await readIfFile(path)
  let ext = extname(path)

  // SPA fallback: anything that is not a real file is a client-side route, so
  // hand back the shell with 200. Asset paths are excluded - a missing bundle
  // should 404 loudly rather than return HTML that silently fails to parse.
  if (!body && !path.startsWith(join(ROOT, 'assets'))) {
    body = await readIfFile(join(ROOT, 'index.html'))
    ext = '.html'
  }

  if (!body) {
    res.writeHead(404, SECURITY_HEADERS)
    return res.end('Not Found')
  }

  const immutable = path.startsWith(join(ROOT, 'assets'))
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, must-revalidate',
    ...SECURITY_HEADERS,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RoofIQ field app serving ${ROOT} on :${PORT}`)
})
