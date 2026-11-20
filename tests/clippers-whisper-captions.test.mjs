import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { wordsFromWhisperJson, whisperArgs, renderVerticalClip, CAPTION_MAX_WORD_SECONDS } from '../script/clippers-streamer-cloud-render.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/whisper-clip-es.json', import.meta.url), 'utf8'));

test('word timing from a whisper.cpp transcript fixture (28 s cut)', () => {
  const words = wordsFromWhisperJson(fixture, { duration: 28 });
  // Non-speech tags and empty segments are dropped; words after the clip end are dropped.
  assert.deepEqual(words.map(w => w.text), ['¿QUÉ', 'ACABA', 'DE', 'PASAR?', '¡NO!', 'INCREÍBLE']);
  for (let i = 0; i < words.length; i++) {
    assert.ok(words[i].to > words[i].from, `word ${i} has a positive window`);
    assert.ok(words[i].to - words[i].from <= CAPTION_MAX_WORD_SECONDS + 1e-9, `word ${i} capped at 1.2 s`);
    if (i) assert.ok(words[i].from >= words[i - 1].to, `word ${i} never overlaps the previous one`);
    assert.ok(words[i].to <= 28);
  }
  assert.deepEqual(words[1], { text: 'ACABA', from: 0.98, to: 1.25 }); // trimmed to the next word's start
  assert.deepEqual(words[3], { text: 'PASAR?', from: 1.5, to: 2.7 }); // 3.4 s segment capped
  assert.deepEqual(words[4], { text: '¡NO!', from: 5, to: 5.15 }); // minimum visible time
  assert.deepEqual(words[5], { text: 'INCREÍBLE', from: 27.8, to: 28 }); // clipped at the cut end
});

test('segment offset: a transcript of a longer file is shifted to the cut', () => {
  const words = wordsFromWhisperJson(fixture, { start: 1.5, duration: 3 });
  assert.deepEqual(words, [{ text: 'PASAR?', from: 0, to: 1.2 }]);
  assert.ok(words.every(w => w.from >= 0 && w.to <= 3));
});

test('whisper args: per-account language, one word per segment, JSON out', () => {
  const es = whisperArgs({ model: '/m/ggml-base.bin', wav: '/w/speech.wav', outBase: '/w/speech', language: 'es' });
  assert.deepEqual(es.slice(es.indexOf('-l'), es.indexOf('-l') + 2), ['-l', 'es']);
  for (const flag of ['-ml', '-sow', '-oj', '-np', '-of']) assert.ok(es.includes(flag), flag);
  assert.equal(es[es.indexOf('-ml') + 1], '1');
  assert.equal(whisperArgs({ model: 'm', wav: 'w', outBase: 'o', language: 'en; rm -rf' }).at(es.indexOf('-l') + 1), 'auto');
  assert.equal(whisperArgs({ model: 'm', wav: 'w', outBase: 'o', threads: 99 })[whisperArgs({ model: 'm', wav: 'w', outBase: 'o' }).indexOf('-t') + 1], '8');
});

async function fakeRender(t, { whisper }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'whisper-render-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const runner = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'ffprobe') return { stdout: JSON.stringify(args.includes(path.join(dir, 'render.mp4'))
      ? { streams: [{ codec_type: 'video', width: 1080, height: 1920 }, { codec_type: 'audio' }], format: { duration: '28.0' } }
      : { streams: [{ codec_type: 'video' }, { codec_type: 'audio' }], format: { duration: '28.0' } }) };
    if (cmd === 'whisper-cli') return whisper(args, dir);
    if (cmd === 'ffmpeg' && args.includes('-filter_complex')) await writeFile(path.join(dir, 'render.mp4'), 'mp4');
    return { stdout: '', stderr: '' };
  };
  const result = await renderVerticalClip({ sourceFile: path.join(dir, 'src.mp4'), workDir: dir, duration: 28, hook: 'NO SE LO ESPERABA', credit: 'Fuente', runner, language: 'es',
    env: { CLIPPERS_WHISPER_BIN: 'whisper-cli', CLIPPERS_WHISPER_MODEL: '/m/ggml-base.bin' } });
  const graph = calls.find(([c, a]) => c === 'ffmpeg' && a.includes('-filter_complex'))[1];
  return { result, calls, graph: graph[graph.indexOf('-filter_complex') + 1] };
}

test('render burns word captions in the account language when whisper works', async t => {
  const { result, calls, graph } = await fakeRender(t, { whisper: async (args, dir) => { await writeFile(path.join(dir, 'speech.json'), JSON.stringify(fixture)); return { stdout: '' }; } });
  assert.equal(result.captions, 'word_by_word');
  assert.equal(result.captionLanguage, 'es');
  const w = calls.find(([c]) => c === 'whisper-cli')[1];
  assert.equal(w[w.indexOf('-l') + 1], 'es');
  const wav = calls.find(([c, a]) => c === 'ffmpeg' && a.includes('16000'))[1];
  assert.equal(wav[wav.indexOf('-t') + 1], '28.00', 'only the cut is transcribed');
  assert.equal((graph.match(/enable='between/g) ?? []).length, 6);
});

test('whisper failure: still renders, without word captions, and says so in evidence', async t => {
  const { result, graph } = await fakeRender(t, { whisper: async () => { const e = new Error('WHISPER_EXIT_1'); throw e; } });
  assert.equal(result.captions, 'transcription_failed');
  assert.equal(result.captionsError, 'WHISPER_EXIT_1');
  assert.equal(result.captionLanguage, null);
  assert.doesNotMatch(graph, /enable='between/);
  const corrupt = await fakeRender(t, { whisper: async (args, dir) => { await writeFile(path.join(dir, 'speech.json'), '{bad'); return { stdout: '' }; } });
  assert.equal(corrupt.result.captions, 'transcription_failed');
});
