import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberedEmail, rememberEmail } from '../../web/src/lib/remembered-login.js';

const legacyKey = 'autovoyage-remembered-login';
const accountKey = 'autovoyage-remembered-account';

function storageFixture(initial: Record<string, string>, work: (values: Map<string, string>) => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try { work(values); }
  finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}

test('upgrading a remembered login removes the persisted password and retains only the account name', () => {
  const secret = 'test-only-legacy-password';
  storageFixture({ [legacyKey]: JSON.stringify({ email: 'owner@example.test', password: secret }) }, values => {
    assert.equal(rememberedEmail(), 'owner@example.test');
    assert.equal(values.has(legacyKey), false);
    assert.deepEqual(JSON.parse(values.get(accountKey)!), { email: 'owner@example.test' });
    assert(![...values.values()].some(value => value.includes(secret)));
    rememberEmail(null);
    assert.equal(rememberedEmail(), null);
    assert.equal(values.has(accountKey), false);
  });
});

test('malformed legacy values are discarded and unavailable storage never prevents authentication', () => {
  storageFixture({ [legacyKey]: '{bad json' }, values => {
    assert.equal(rememberedEmail(), null);
    assert.equal(values.has(legacyKey), false);
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
  try {
    assert.equal(rememberedEmail(), null);
    assert.doesNotThrow(() => rememberEmail('owner@example.test'));
    assert.doesNotThrow(() => rememberEmail(null));
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
