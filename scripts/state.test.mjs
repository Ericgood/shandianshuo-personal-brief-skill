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


test('repeats require latest exposure, evidence and report disclosure; history survives and retry is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-repeat-')); const previous = process.cwd();
  try {
    process.chdir(root); mkdirSync('outputs/personal-brief/reports', { recursive: true });
    const base = 'outputs/personal-brief/'; const url = 'https://example.org/old-but-useful';
    writeFileSync(base + 'input.json', JSON.stringify({ items: [{ title: 'Evergreen', url }] })); state('ingest', 'input.json');
    writeFileSync(base + 'reports/first.md', url);
    writeFileSync(base + 'receipt.json', JSON.stringify({ run_id: 'first', report: 'reports/first.md', urls: [url] })); state('recommend', 'receipt.json');
    const firstLedger = readFileSync(base + 'content.json', 'utf8');
    const first = JSON.parse(firstLedger).items[0].recommendations[0];
    const repeat = { url, previous_run_id: 'first', reason: 'renewed_context', rationale: 'New task needs the previously explained method', evidence: 'Confirmed new task today', disclosure: 'Revisit: previously recommended in first; new task changes its value today.' };
    const receipt = { run_id: 'second', report: 'reports/second.md', urls: [url], repeats: [repeat] };
    writeFileSync(base + 'reports/second.md', url);
    writeFileSync(base + 'receipt.json', JSON.stringify(receipt));
    assert.throws(() => state('recommend', 'receipt.json'), /visible disclosure/);
    assert.equal(readFileSync(base + 'content.json', 'utf8'), firstLedger);
    writeFileSync(base + 'reports/second.md', url + '\n' + repeat.disclosure);
    for (const bad of [{ ...repeat, evidence: '' }, { ...repeat, previous_run_id: 'stale' }, { ...repeat, reason: 'not_clicked' }]) {
      writeFileSync(base + 'receipt.json', JSON.stringify({ ...receipt, repeats: [bad] }));
      assert.throws(() => state('recommend', 'receipt.json'));
      assert.equal(readFileSync(base + 'content.json', 'utf8'), firstLedger);
    }
    writeFileSync(base + 'receipt.json', JSON.stringify(receipt));
    state('recommend', 'receipt.json'); state('recommend', 'receipt.json');
    const item = JSON.parse(readFileSync(base + 'content.json')).items[0];
    assert.equal(item.recommendations.length, 2);
    assert.deepEqual(item.recommendations[0], first);
    assert.equal(item.recommendations[1].repeat.previous_run_id, 'first');
    assert.equal(item.user_read_status, 'unknown');
    writeFileSync(base + 'receipt.json', JSON.stringify({ ...receipt, run_id: 'third' }));
    assert.throws(() => state('recommend', 'receipt.json'), /latest exposure/);
    assert.equal(JSON.parse(readFileSync(base + 'content.json')).items[0].recommendations.length, 2);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});
