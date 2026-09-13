#!/usr/bin/env node
/**
 * Pull every deployed Supabase Edge Function into supabase/functions/<slug>/.
 *
 * The backend lives only as deployed artifacts: 89 functions in Supabase, none
 * in git. There is no history, no review and no rollback -- overwrite
 * sync-energov-statewide and the previous version is gone. This script is the
 * fix, and it is meant to be run repeatedly so the repo tracks what is live.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/sync-edge-functions.mjs
 *
 * The token is a personal access token from
 * https://supabase.com/dashboard/account/tokens -- it is NOT the project's
 * anon or service-role key, and it must never be committed.
 *
 * Writes are idempotent: unchanged files are left alone, so `git status` after
 * a run shows exactly what drifted since the last sync.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'bmnhxvdnvytdrpqgvxts'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const API = 'https://api.supabase.com/v1'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions')

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is required (https://supabase.com/dashboard/account/tokens)')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

/** Unchanged files are not rewritten, so git only shows real drift. */
async function writeIfChanged(path, content) {
  try {
    if (await readFile(path, 'utf8') === content) return 'unchanged'
  } catch { /* new file */ }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return 'written'
}

const list = await (await api(`/projects/${PROJECT_REF}/functions`)).json()
console.log(`${list.length} functions deployed`)

const index = []
let written = 0, unchanged = 0, failed = 0

for (const fn of list.sort((a, b) => a.slug.localeCompare(b.slug))) {
  try {
    // The body endpoint returns the bundled entrypoint as plain text.
    const body = await (await api(`/projects/${PROJECT_REF}/functions/${fn.slug}/body`)).text()
    const state = await writeIfChanged(join(ROOT, fn.slug, 'index.ts'), body)
    state === 'written' ? written++ : unchanged++
    index.push({
      slug: fn.slug,
      version: fn.version,
      verify_jwt: fn.verify_jwt,
      status: fn.status,
      updated_at: new Date(fn.updated_at).toISOString(),
      bytes: body.length,
    })
    console.log(`  ${state === 'written' ? '+' : '='} ${fn.slug}`)
  } catch (e) {
    failed++
    console.error(`  ! ${fn.slug}: ${e.message}`)
  }
}

// An inventory beside the source, so a reviewer can see what is deployed,
// which functions skip JWT verification, and when each last changed.
await writeIfChanged(
  join(ROOT, 'INVENTORY.json'),
  JSON.stringify({ project_ref: PROJECT_REF, synced_at: new Date().toISOString(), functions: index }, null, 2) + '\n',
)

console.log(`\n${written} written, ${unchanged} unchanged, ${failed} failed`)
if (failed) process.exitCode = 1
