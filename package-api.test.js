'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePackage, recordFor, savePackageRequest } = require('./package-api');
const request = { requestId: '0123456789abcdef0123456789abcdef', clientName: 'Example Client',
  clientEmail: 'Example@Example.com', projectTitle: 'GC demo', projectNotes: '',
  selectedPackages: ['GB', 'GA'], redundancyMode: 'MIRRORED',
  gridMode: 'LINEAR', linearCells: 18, honeypot: '' };
test('GA and GB select 12 agents; preserve canonical package ordering', () => {
  const data = validatePackage(request);
  assert.deepEqual(data.selectedPackages, ['GA', 'GB']);
  assert.equal(data.agentsRequested, 12);
  assert.equal(data.clientEmail, 'example@example.com');
  assert.equal(recordFor(data).packageMode, 'GA+GB');
});
test('single package contains exactly six agents', () => {
  assert.equal(validatePackage({ ...request, selectedPackages: ['GA'] }).agentsRequested, 6);
});
test('reject invalid selections, grid and honeypot', () => {
  assert.throws(() => validatePackage({ ...request, selectedPackages: ['GA', 'GA'] }));
  assert.throws(() => validatePackage({ ...request, linearCells: 37 }));
  assert.throws(() => validatePackage({ ...request, honeypot: 'spam' }));
});
test('confirmed mirrored storage requires both Wix insert receipts', async () => {
  const fetchOriginal = global.fetch;
  const calls = [];
  global.fetch = async (_url, opt) => {
    const payload = JSON.parse(opt.body);
    calls.push(payload);
    return { ok: true, status: 200, json: async () => ({ dataItem: { id: payload.dataItem.id } }) };
  };
  try {
    const receipt = await savePackageRequest(request, async () => 'TEST_TOKEN');
    assert.equal(receipt.status, 'SAVED');
    assert.equal(receipt.mirrored, true);
    assert.deepEqual(calls.map(x => x.dataCollectionId), ['GCPackageRequests','GCPackageMirrors']);
  } finally { global.fetch = fetchOriginal; }
});
test('mirror storage errors never claim that mirror was saved', async () => {
  const old = global.fetch;
  let count = 0;
  global.fetch = async (_url, opt) => {
    const payload = JSON.parse(opt.body);
    count++;
    return count === 1
      ? { ok: true, status: 200, json: async () => ({ dataItem: { id: payload.dataItem.id } }) }
      : { ok: false, status: 503 };
  };
  try {
    const receipt = await savePackageRequest(request, async () => 'TEST_TOKEN');
    assert.equal(receipt.status, 'PRIMARY_ONLY');
    assert.equal(receipt.mirrored, false);
  } finally { global.fetch = old; }
});
test('duplicate matching request ID is idempotent', async () => {
  const old = global.fetch;
  const body = recordFor(validatePackage({ ...request, redundancyMode: 'PRIMARY' }));
  let count=0;
  global.fetch = async (_url, opt) => {
    count++;
    if (opt.method === 'POST') return { ok: false, status: 409 };
    return { ok: true, status: 200, json: async () => ({ dataItem: { id: request.requestId, data: body } }) };
  };
  try {
    const receipt = await savePackageRequest({ ...request, redundancyMode: 'PRIMARY' }, async () => 'TEST_TOKEN');
    assert.equal(receipt.status, 'SAVED');
    assert.equal(count,2);
  } finally { global.fetch = old; }
});
