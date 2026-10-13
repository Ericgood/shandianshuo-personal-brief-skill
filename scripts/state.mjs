import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safePath } from './history.mjs';

const BASE = 'outputs/personal-brief';
const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

export function canonicalUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid public URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) {
    url.hostname = 'x.com';
    url.protocol = 'https:';
    url.pathname = url.pathname.replace(/\/(photo|video)\/\d+\/?$/, '');
    const parts = url.pathname.split('/'); parts[1] = parts[1].toLowerCase(); url.pathname = parts.join('/');
    const status = url.pathname.match(/^\/(?:[^/]+|i\/web)\/status\/(\d+)\/?$/);
    if (status) {
      url.search = '';
      url.pathname = `/i/web/status/${status[1]}`;
    }
  }
  // Do not strip meaningful queries, force unrelated hosts together, or merge by title.
  return url.href;
}

export function mergeItems(existing, incoming, now = new Date().toISOString()) {
  const records = new Map(existing.map(item => [canonicalUrl(item.url), item]));
  let overlap = 0;
  for (const item of incoming) {
    if (typeof item.title !== 'string' || !item.title.trim()) throw new Error('Missing title');
    const key = canonicalUrl(item.url);
    if (records.has(key)) {
      const old = records.get(key);
      records.set(key, { ...old, last_seen_at: now,
        source_ids: [...new Set([...(old.source_ids ?? []), item.source_id].filter(Boolean))] });
      overlap++;
    } else records.set(key, {
      id: createHash('sha256').update(key).digest('hex'), url: item.url, canonical_url: key,
      title: item.title, published_at: item.published_at ?? null,
      source_ids: item.source_id ? [item.source_id] : [],
      first_seen_at: now, last_seen_at: now,
      body_read_scope: item.body_read_scope ?? 'listing_only',
      event_id: item.event_id ?? null, status: 'discovered',
      recommendations: [], user_read_status: 'unknown',
    });
  }
  return { items: [...records.values()], overlap };
}

function atomic(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function state(command, input) {
  const base = safePath(realpathSync(process.cwd()), BASE);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const ledger = safePath(base, 'content.json');
  const lock = safePath(base, '.state.lock');
  const token = randomUUID();
  writeFileSync(lock, token, { flag: 'wx', mode: 0o600 });
  try {
    const old = existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')) : { version: 1, items: [] };
    if (old.version !== 1 || !Array.isArray(old.items)) throw new Error('Unsupported ledger');
    if (command === 'status') return { items: old.items.length, recommended: old.items.filter(i => i.recommendations.length).length };
    const data = JSON.parse(readFileSync(safePath(base, input ?? ''), 'utf8'));
    if (command === 'ingest') {
      if (!Array.isArray(data.items)) throw new Error('Expected items');
      const result = mergeItems(old.items, data.items);
      atomic(ledger, { version: 1, items: result.items });
      return { items: result.items.length, overlap: result.overlap };
    }
    if (command === 'recommend') {
      if (!Array.isArray(data.urls) || data.urls.length > 5 || typeof data.run_id !== 'string' || !data.run_id.trim()) throw new Error('Invalid report receipt');
      const reportPath = safePath(base, data.report);
      const report = readFileSync(reportPath, 'utf8');
      const urls = new Set(data.urls.map(canonicalUrl));
      if (urls.size !== data.urls.length) throw new Error('Duplicate originals');
      for (const key of urls) {
        const item = old.items.find(i => canonicalUrl(i.url) === key);
        if (!item || !report.includes(item.url)) throw new Error('Save report with exact original URL before marking');
        if (item.recommendations.some(r => r.run_id !== data.run_id)) throw new Error('Original already recommended');
      }
      for (const item of old.items) if (urls.has(canonicalUrl(item.url))) {
        if (!item.recommendations.some(r => r.run_id === data.run_id)) item.recommendations.push({ run_id: data.run_id, report: data.report, saved_at: new Date().toISOString(), delivery: 'unconfirmed' });
        item.status = 'recommended';
      }
      atomic(ledger, old);
      return { reportSaved: true, recorded: urls.size, deliveryConfirmed: false, userRead: 'unknown' };
    }
    throw new Error('Unknown command');
  } finally {
    if (existsSync(lock) && readFileSync(lock, 'utf8') === token) unlinkSync(lock);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(state(...process.argv.slice(2)))}\n`); }
  catch {
    process.stderr.write('内容账处理失败；检查输入、已有推荐、报告路径或并发锁。未确认保存。\n');
    process.exitCode = 1;
  }
}
