import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManualDownloadBuffer } from '../src/manual-download-buffer.js';

const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

test('known-length downloads preserve exact bytes across arbitrary chunk boundaries and expose only the completed allocation', () => {
  const source = Buffer.from([0, 1, 127, 128, 255, 5, 6, 7]);
  for (const split of [0, 1, 3, source.length]) {
    const body = createManualDownloadBuffer(String(source.length), source.length);
    body.append(source.subarray(0, split));
    body.append(Buffer.alloc(0));
    body.append(source.subarray(split));
    const result = body.finish();
    assert.deepEqual(result, source);
    assert.equal(result.length, source.length);
    assert.strictEqual(body.finish(), result);
    assert.throws(() => body.append(Buffer.from([1])), /already complete/);
  }
  const leadingZeros = createManualDownloadBuffer('0003', 3);
  leadingZeros.append(Buffer.from('abc'));
  assert.equal(leadingZeros.finish().toString(), 'abc');
});

test('a declared zero length only accepts an empty body and cannot return unexpected bytes', () => {
  assert.deepEqual(createManualDownloadBuffer('0', 10).finish(), Buffer.alloc(0));
  const body = createManualDownloadBuffer('0', 10);
  assert.throws(() => body.append(Buffer.from('unexpected')), code('MANUAL_SOURCE_UNAVAILABLE'));
  assert.throws(() => body.finish(), code('MANUAL_SOURCE_UNAVAILABLE'));
});

test('invalid, negative, fractional, unsafe and oversized declared lengths are rejected before allocation', () => {
  for (const declaration of ['', '-1', '1.5', '+1', ' 1', '1 ', 'NaN', 'Infinity', '1e3', '1junk', '9007199254740993']) {
    assert.throws(() => createManualDownloadBuffer(declaration, 32), code('MANUAL_SOURCE_UNAVAILABLE'), declaration);
  }
  assert.throws(() => createManualDownloadBuffer('33', 32), code('MANUAL_TOO_LARGE'));
  assert.throws(() => createManualDownloadBuffer('999999999999999999999999999', 32), code('MANUAL_SOURCE_UNAVAILABLE'));
  for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createManualDownloadBuffer(undefined, limit), RangeError);
});

test('missing Content-Length keeps bounded chunk accumulation and handles empty responses', () => {
  const body = createManualDownloadBuffer(undefined, 6);
  body.append(Buffer.from('ab'));
  body.append(Buffer.alloc(0));
  body.append(Buffer.from('cdef'));
  assert.equal(body.finish().toString(), 'abcdef');
  assert.equal(createManualDownloadBuffer(undefined, 6).finish().length, 0);
});

test('late overflow and excess declared bytes permanently invalidate the response', () => {
  for (const declared of [undefined, '4']) {
    const body = createManualDownloadBuffer(declared, 4);
    body.append(Buffer.from('abc'));
    assert.throws(() => body.append(Buffer.from('de')), code('MANUAL_TOO_LARGE'));
    assert.throws(() => body.finish(), code('MANUAL_TOO_LARGE'));
    assert.throws(() => body.append(Buffer.alloc(0)), code('MANUAL_TOO_LARGE'));
  }
  const mismatch = createManualDownloadBuffer('3', 10);
  mismatch.append(Buffer.from('ab'));
  assert.throws(() => mismatch.append(Buffer.from('cd')), code('MANUAL_SOURCE_UNAVAILABLE'));
  assert.throws(() => mismatch.finish(), code('MANUAL_SOURCE_UNAVAILABLE'));
});

test('early termination never returns unfilled or previously allocated memory and cannot be resumed after failure', () => {
  for (const prefix of ['', 'a', 'abc']) {
    const body = createManualDownloadBuffer('8', 8);
    body.append(Buffer.from(prefix));
    assert.throws(() => body.finish(), code('MANUAL_SOURCE_UNAVAILABLE'));
    assert.throws(() => body.finish(), code('MANUAL_SOURCE_UNAVAILABLE'));
    assert.throws(() => body.append(Buffer.from('defgh')), code('MANUAL_SOURCE_UNAVAILABLE'));
  }
});
