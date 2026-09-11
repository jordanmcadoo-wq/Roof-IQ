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
import { createReadStream } from 'node:fs'
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
  // A PMTiles basemap is read by byte range, never whole; see the range
  // handling below, without which MapLibre would refetch the entire archive
  // for every tile.
  '.pmtiles': 'application/vnd.pmtiles',
}

/** Files large enough that reading them into memory per request is not sane. */
const STREAM_OVER_BYTES = 4 * 1024 * 1024

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

async function statIfFile(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? info : null
  } catch {
    return null
  }
}

async function readIfFile(path) {
  const info = await statIfFile(path)
  return info ? await readFile(path) : null
}

/**
 * Parse a single-range `Range: bytes=a-b` header against a known size.
 * Multi-range requests are not worth supporting here - PMTiles asks for one
 * range at a time - so anything else falls through to a normal 200.
 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null
  let start, end
  if (rawStart === '') {
    // Suffix form: the last N bytes. PMTiles uses this to find its footer.
    const n = Number(rawEnd)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
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

  let ext = extname(path)
  const info = await statIfFile(path)

  const isAsset = path.startsWith(join(ROOT, 'assets'))
  // /basemap/ is excluded from the SPA fallback alongside /assets/. The app
  // probes for the basemap archive and switches canvases on the answer, so a
  // missing file has to 404 rather than come back as index.html with a 200.
  const isBasemap = path.startsWith(join(ROOT, 'basemap'))

  if (info) {
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': isAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, must-revalidate',
      ...SECURITY_HEADERS,
    }

    const range = parseRange(req.headers.range, info.size)
    if (range) {
      const { start, end } = range
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': end - start + 1,
      })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(path, { start, end }).pipe(res)
    }

    // An unsatisfiable range must say so rather than quietly serving the file.
    if (req.headers.range && !range) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` })
      return res.end()
    }

    res.writeHead(200, { ...headers, 'Content-Length': info.size })
    if (req.method === 'HEAD') return res.end()
    if (info.size > STREAM_OVER_BYTES) return createReadStream(path).pipe(res)
    return res.end(await readFile(path))
  }

  if (isAsset || isBasemap) {
    res.writeHead(404, SECURITY_HEADERS)
    return res.end('Not Found')
  }

  // SPA fallback: anything that is not a real file is a client-side route, so
  // hand back the shell with 200.
  const shell = await readIfFile(join(ROOT, 'index.html'))
  if (!shell) {
    res.writeHead(404, SECURITY_HEADERS)
    return res.end('Not Found')
  }
  res.writeHead(200, {
    'Content-Type': MIME['.html'],
    'Content-Length': shell.length,
    'Cache-Control': 'no-cache, must-revalidate',
    ...SECURITY_HEADERS,
  })
  res.end(req.method === 'HEAD' ? undefined : shell)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RoofIQ field app serving ${ROOT} on :${PORT}`)
})
