import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bootstrap } from "@autovoyage/shared";
import { createClientId } from "../../web/src/lib/client-id.js";
import ManualTableEntry from "../../web/src/admin/ManualTableEntry.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function withCrypto(value: unknown, check: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value });
  try { check(); }
  finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
}

test("client identities use native UUID when the browser provides it", () => {
  const expected = "00000000-0000-4000-8000-000000000001";
  withCrypto({ randomUUID: () => expected }, () => assert.equal(createClientId(), expected));
});

test("HTTP browser without randomUUID can create multiple valid row and request identities", () => {
  withCrypto({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, () => {
    const values = Array.from({ length: 1024 }, () => createClientId());
    assert(values.every(value => uuid.test(value)));
    assert.equal(new Set(values).size, values.length);
  });
});

test("a restricted browser without Crypto can still create distinct non-secret client identities", () => {
  withCrypto(undefined, () => {
    const values = Array.from({ length: 1024 }, () => createClientId());
    assert(values.every(value => uuid.test(value)));
    assert.equal(new Set(values).size, values.length);
  });
});

test("the actual manual-entry component renders its first row in an HTTP browser without randomUUID", () => {
  withCrypto({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, () => {
    // The API test runner uses classic JSX; Vite uses the automatic runtime.
    const original = Object.getOwnPropertyDescriptor(globalThis, "React");
    Object.defineProperty(globalThis, "React", { configurable: true, value: React });
    try {
      const html = renderToStaticMarkup(React.createElement(ManualTableEntry, {
        data: { models: [{ id: "test-model", brand: "测试品牌", name: "测试车型" }] } as unknown as Bootstrap,
        modelId: "test-model", onCreated: () => undefined, onCancel: () => undefined,
      }));
      assert.match(html, /项目 1/);
      assert.match(html, /保养项目名称/);
      assert.match(html, /保存为待核对草稿/);
    } finally {
      if (original) Object.defineProperty(globalThis, "React", original);
      else Reflect.deleteProperty(globalThis, "React");
    }
  });
});
