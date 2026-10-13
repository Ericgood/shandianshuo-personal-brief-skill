import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildBatches, validateNote, annualHistory } from './history.mjs';

const end = 1791800000;
const day = 86400;
test('all records and distinct text versions survive, including errors and long Unicode content', () => {
  const long = '我在做产品😀\n'.repeat(5000);
  const rows = [
    { id: 'same', timestamp: end, original_text: long, text: long, normalized_text: '修正结果', status: 'success' },
    { id: 'same', timestamp: end - 31 * day, voice_instruction: '解释原理', text: '生成内容', record_type: 'voice_assistant' },
    { timestamp: end - 91 * day, original_text: '失败但有原始内容', status: 'error' },
    { timestamp: end - 365 * day, status: 'empty' },
    { text: '无日期内容', status: 'cancelled' },
    { timestamp: end - 365 * day - 1, text: '范围之外' },
    { timestamp: end + 1, text: '未来' },
  ];
  const result = buildBatches(rows, end);
  assert.equal(result.records.length, 5);
  assert.deepEqual(result.tiers, { recent: 1, medium: 1, long: 2, undated: 1 });
  assert.deepEqual(result.excluded, { olderThanWindow: 1, future: 1, unchanged: 0, undated: 0 });
  const entries = result.batches.flat();
  assert.equal(new Set(entries.map(e => e[0])).size, entries.length);
  for (const [index, row] of rows.slice(0, 5).entries()) {
    const own = entries.filter(e => e[0].startsWith(`r${index}p`));
    for (const [field, value] of Object.entries(row)) {
      if (!['original_text', 'text', 'normalized_text', 'voice_instruction'].includes(field)) continue;
      assert.equal(own.flatMap(e => e[5]).filter(fragment => fragment[0] & (1 << ['original_text', 'voice_instruction', 'text', 'normalized_text', 'ai_corrected_text'].indexOf(field))).map(fragment => fragment[1]).join(''), value);
    }
  }
  assert.ok(result.batches.length > 1);
  assert.ok(result.batches.every(batch => JSON.stringify(batch).length <= 18000));
});

test('a note needs a complete payload marker, semantic assessment, and evidence from its own batch', () => {
  const entries = [['r0p0']];
  const note = { hash: 'hash', endMarker: 'independent-tail', coverage: 'complete', assessment: '只有任务证据，不能判断长期兴趣。',
    readings: [{ part: 'r0p0', kind: 'task', gist: '处理语音交互的工作任务。' }],
    themes: [{ statement: '关注语音交互的工作任务', evidence: ['r0p0'] }],
    selfStatements: [], currentNeeds: [], conflicts: [], excludedObservations: [] };
  assert.doesNotThrow(() => validateNote(note, entries, 'hash', 'independent-tail'));
  assert.throws(() => validateNote({ ...note, endMarker: 'hash' }, entries, 'hash', 'independent-tail'));
  assert.throws(() => validateNote({ ...note, assessment: '' }, entries, 'hash', 'independent-tail'));
  assert.throws(() => validateNote({ ...note, themes: [{ statement: '臆测', evidence: ['r99p0'] }] }, entries, 'hash', 'independent-tail'));
  assert.throws(() => validateNote(note, [...entries, ['r1p0']], 'hash', 'independent-tail'), /逐片段/);
  assert.throws(() => validateNote({ ...note, readings: [...note.readings, ...note.readings] }, [...entries, ['r1p0']], 'hash', 'independent-tail'), /每个片段/);
});

test('immutable snapshot, resume, and completion depend on accepted semantic notes; symlinks rejected', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'annual-history-test-'));
  const previous = process.cwd();
  try {
    process.chdir(root);
    mkdirSync('history');
    const history = { records: [{ timestamp: Date.now() / 1000 - 10, original_text: '我的工作是开发产品。' }] };
    writeFileSync('history/transcriptions.json', JSON.stringify(history));
    const prepared = annualHistory('prepare');
    assert.equal(annualHistory('status', prepared.run).complete, false);
    const batch = annualHistory('next', prepared.run);
    history.records[0].original_text = '后来发生更改';
    writeFileSync('history/transcriptions.json', JSON.stringify(history));
    assert.equal(annualHistory('next', prepared.run).entries[0][5][0][1], '我的工作是开发产品。');
    const note = { hash: batch.hash, endMarker: batch.END_OF_BATCH, coverage: 'complete', assessment: '本人陈述了工作领域。',
      readings: [{ part: batch.entries[0][0], kind: 'self', gist: '本人说从事产品开发。' }],
      themes: [], selfStatements: [{ statement: '从事产品开发', evidence: [batch.entries[0][0]] }],
      currentNeeds: [], conflicts: [], excludedObservations: [] };
    writeFileSync('response.json', JSON.stringify(note));
    assert.equal(annualHistory('accept', prepared.run, '1', 'response.json').complete, true);
    assert.equal(annualHistory('next', prepared.run).complete, true);
    assert.throws(() => annualHistory('accept', prepared.run, '1', 'response.json'));
    const file = resolve(prepared.directory, 'batch-1.json');
    writeFileSync(file, JSON.stringify([['篡改']]));
    assert.throws(() => annualHistory('status', prepared.run), /改变/);
    symlinkSync(resolve(root, 'history/transcriptions.json'), 'response-link.json');
    assert.throws(() => annualHistory('accept', prepared.run, '1', 'response-link.json'));
    assert.ok(readdirSync(prepared.directory).includes('note-1.json'));
    assert.equal(JSON.parse(readFileSync(resolve(prepared.directory, 'manifest.json'))).records.length, 1);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});

test('custom window and incremental runs preserve edits, duplicate IDs, deletions and empty deltas', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'brief-delta-test-')); const previous = process.cwd();
  function accept(run) {
    while (!annualHistory('status', run).complete) {
      const batch = annualHistory('next', run);
      const note = { hash: batch.hash, endMarker: batch.END_OF_BATCH, coverage: 'complete',
        assessment: 'Synthetic fixture; structural validation only, not real semantic analysis.',
        readings: batch.entries.map(entry => ({ part: entry[0], kind: 'task', gist: 'Synthetic task fixture.' })),
        themes: [], selfStatements: [], currentNeeds: [], conflicts: [], excludedObservations: [] };
      writeFileSync('response.json', JSON.stringify(note));
      annualHistory('accept', run, String(batch.batch), 'response.json');
    }
  }
  try {
    process.chdir(root); mkdirSync('history');
    const anchor = Date.now() / 1000 - 60; const ending = new Date(anchor * 1000).toISOString();
    const rows = [
      { id: 'duplicate', timestamp: anchor - day, original_text: 'First original' },
      { id: 'duplicate', timestamp: anchor - day, original_text: 'Second original' },
      { id: 'old', timestamp: anchor - 60 * day, text: 'Outside chosen month' },
      { id: 'removed', timestamp: anchor - day, text: 'Will be removed' },
    ];
    writeFileSync('history/transcriptions.json', JSON.stringify({ records: rows }));
    const initial = annualHistory('prepare', '--days', '30', '--end', ending);
    assert.equal(initial.records, 3);
    assert.throws(() => annualHistory('prepare', '--days', '30', '--end', ending, '--since', initial.run), /尚未完成/);
    accept(initial.run);
    rows[1].original_text = 'Changed original'; rows.pop();
    rows.push({ id: 'new', timestamp: anchor - 1, voice_instruction: 'New instruction', ai_corrected_text: 'New correction' });
    writeFileSync('history/transcriptions.json', JSON.stringify({ records: rows }));
    const delta = annualHistory('prepare', '--days', '30', '--end', ending, '--since', initial.run);
    assert.equal(delta.records, 2);
    assert.equal(delta.corpusRecordCount, 3);
    assert.equal(delta.removedOrOutsideWindow.length, 2);
    const text = annualHistory('next', delta.run).entries.flatMap(e => e[5]).map(f => f[1]);
    assert.deepEqual(text, ['Changed original', 'New instruction', 'New correction']);
    accept(delta.run);
    const empty = annualHistory('prepare', '--days', '30', '--end', ending, '--since', delta.run);
    assert.equal(empty.records, 0); assert.equal(annualHistory('status', empty.run).noNewText, true);
    assert.equal(annualHistory('status', empty.run).complete, true);
    assert.throws(() => annualHistory('inventory', '--days', '366'));
    assert.throws(() => annualHistory('inventory', '--end', '2026-01-01'));
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});

test('undated private text is excluded from CLI snapshots unless explicitly selected', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'brief-undated-test-')); const previous = process.cwd();
  try {
    process.chdir(root); mkdirSync('history');
    writeFileSync('history/transcriptions.json', JSON.stringify({ records: [{ id: 'undated', text: 'Synthetic unknown-date text' }] }));
    const excluded = annualHistory('prepare');
    assert.equal(excluded.records, 0); assert.equal(excluded.excluded.undated, 1);
    const included = annualHistory('prepare', '--undated', 'include');
    assert.equal(included.records, 1); assert.equal(included.tiers.undated, 1);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});
