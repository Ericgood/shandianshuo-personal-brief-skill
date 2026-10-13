import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalUrl, mergeItems, state } from './state.mjs';

test('URL dedup preserves meaningful parameters and does not equate different articles', () => {
  assert.equal(canonicalUrl('https://twitter.com/Author/status/123/photo/1?utm_source=x#top'), 'https://x.com/i/web/status/123');
  assert.equal(canonicalUrl('https://x.com/Author/status/123/?s=20&t=tracking'), 'https://x.com/i/web/status/123');
  assert.equal(canonicalUrl('https://x.com/i/web/status/123'), canonicalUrl('https://x.com/Author/status/123'));
  assert.equal(mergeItems([], [
    { url: 'https://x.com/Author/status/123', title: 'Native original' },
    { url: 'https://x.com/i/web/status/123?s=20', title: 'Embedded original' },
  ]).items.length, 1);
  assert.notEqual(canonicalUrl('https://example.org/read?id=1'), canonicalUrl('https://example.org/read?id=2'));
  assert.throws(() => canonicalUrl('file:///private/data'));
  assert.throws(() => canonicalUrl('https://user:secret@example.org/a'));
  const old = mergeItems([], [{ url: 'https://example.org/a', title: 'first', source_id: 'S1' }]).items;
  old[0].recommendations.push({ run_id: 'saved' });
  const merged = mergeItems(old, [{ url: 'https://example.org/a?utm_source=x', title: 'retitled', source_id: 'S2' }]);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.overlap, 1);
  assert.equal(merged.items[0].recommendations[0].run_id, 'saved');
  assert.deepEqual(merged.items[0].source_ids, ['S1', 'S2']);
});

test('recommend only after saved report, retries idempotent, unread stays unknown and lock prevents races', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-state-')); const previous = process.cwd();
  try {
    process.chdir(root); mkdirSync('outputs/personal-brief/reports', { recursive: true });
    const base = 'outputs/personal-brief/';
    writeFileSync(base + 'input.json', JSON.stringify({ items: [{ title: 'Example', url: 'https://example.org/a' }] }));
    state('ingest', 'input.json');
    writeFileSync(base + 'receipt.json', JSON.stringify({ run_id: 'day1', report: 'reports/day1.md', urls: ['https://example.org/a'] }));
    assert.throws(() => state('recommend', 'receipt.json'));
    writeFileSync(base + 'reports/day1.md', '[Read](https://example.org/a)');
    assert.equal(state('recommend', 'receipt.json').recorded, 1);
    assert.equal(state('recommend', 'receipt.json').recorded, 1);
    let ledger = JSON.parse(readFileSync(base + 'content.json'));
    assert.equal(ledger.items[0].recommendations.length, 1);
    assert.equal(ledger.items[0].user_read_status, 'unknown');
    writeFileSync(base + 'receipt.json', JSON.stringify({ run_id: 'day2', report: 'reports/day1.md', urls: ['https://example.org/a'] }));
    assert.throws(() => state('recommend', 'receipt.json'), /already/);
    writeFileSync(base + '.state.lock', 'other-run');
    assert.throws(() => state('ingest', 'input.json'));
    rmSync(base + '.state.lock');
    symlinkSync(join(root, base + 'input.json'), base + 'linked.json');
    assert.throws(() => state('ingest', 'linked.json'));
    assert.throws(() => state('ingest', '../../../outside.json'));
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});

test('ten distinct recommendations are accepted, eleven are rejected without mutating the ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-capacity-')); const previous = process.cwd();
  try {
    process.chdir(root); mkdirSync('outputs/personal-brief/reports', { recursive: true });
    const base = 'outputs/personal-brief/';
    const items = Array.from({ length: 11 }, (_, i) => ({ title: `Article ${i}`, url: `https://example.org/article/${i}` }));
    writeFileSync(base + 'input.json', JSON.stringify({ items })); state('ingest', 'input.json');
    writeFileSync(base + 'reports/day.md', items.map(i => `[Read](${i.url})`).join('\n'));
    const before = readFileSync(base + 'content.json', 'utf8');
    writeFileSync(base + 'receipt.json', JSON.stringify({ run_id: 'day', report: 'reports/day.md', urls: items.map(i => i.url) }));
    assert.throws(() => state('recommend', 'receipt.json'), /Invalid report receipt/);
    assert.equal(readFileSync(base + 'content.json', 'utf8'), before);
    writeFileSync(base + 'receipt.json', JSON.stringify({ run_id: 'day', report: 'reports/day.md', urls: items.slice(0, 10).map(i => i.url) }));
    assert.equal(state('recommend', 'receipt.json').recorded, 10);
    assert.equal(state('status').recommended, 10);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});
