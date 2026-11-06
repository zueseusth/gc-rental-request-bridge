'use strict';
// GC ONNESIS package submission module. No keys or client PII in logs.
const PRIMARY = 'GCPackageRequests';
const MIRROR = 'GCPackageMirrors';
const MAX_BYTES = 16000;
const buckets = new Map();

function fail(message, code = 400) {
  return Object.assign(new Error(message), { code });
}
function requiredText(v, label, max) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    throw fail('Invalid ' + label);
  return v.trim();
}
function validatePackage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('Invalid request');
  if (raw.honeypot) throw fail('Request rejected');
  const requestId = requiredText(raw.requestId, 'request ID', 32);
  if (!/^[0-9a-f]{32}$/.test(requestId)) throw fail('Invalid request ID');
  const clientName = requiredText(raw.clientName, 'client name', 100);
  const clientEmail = requiredText(raw.clientEmail, 'client email', 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw fail('Invalid client email');
  const projectTitle = requiredText(raw.projectTitle, 'project title', 120);
  const projectNotes = typeof raw.projectNotes === 'string' && raw.projectNotes.length <= 1200
    ? raw.projectNotes.trim() : (() => { throw fail('Invalid project notes'); })();
  const incoming = raw.selectedPackages;
  if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 2 ||
      new Set(incoming).size !== incoming.length || incoming.some(x => !['GA', 'GB'].includes(x)))
    throw fail('Select G[A], G[B], or both');
  const selectedPackages = ['GA', 'GB'].filter(x => incoming.includes(x));
  if (!['PRIMARY', 'MIRRORED'].includes(raw.redundancyMode)) throw fail('Invalid redundancy mode');
  if (raw.gridMode !== 'LINEAR' || !Number.isInteger(raw.linearCells) ||
      raw.linearCells < 1 || raw.linearCells > 36) throw fail('Invalid linear grid size');
  return { requestId, clientName, clientEmail, projectTitle, projectNotes,
    selectedPackages, redundancyMode: raw.redundancyMode, gridMode: 'LINEAR',
    linearCells: raw.linearCells, agentsRequested: selectedPackages.length * 6 };
}
function recordFor(data, mirror = false) {
  return {
    title: mirror ? 'MIRROR / ' + data.projectTitle : data.projectTitle,
    clientName: data.clientName, clientEmail: data.clientEmail,
    projectTitle: data.projectTitle,
    packageMode: data.selectedPackages.join('+'),
    redundancyMode: data.redundancyMode,
    agentsRequested: data.agentsRequested,
    linearCells: data.linearCells,
    status: 'PENDING_REVIEW',
    payloadJson: JSON.stringify(data)
  };
}
function limited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (buckets.size > 5000) for (const [key, value] of buckets)
    if (value.until < now) buckets.delete(key);
  let b = buckets.get(ip);
  if (!b || b.until < now) b = { until: now + 3600000, count: 0 };
  b.count++;
  buckets.set(ip, b);
  return b.count > 12;
}
async function wixFetch(url, options, getToken) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: await getToken() },
      signal: AbortSignal.timeout(15000)
    });
  } catch (_) {
    throw fail('Wix package storage unavailable', 502);
  }
  return response;
}
async function insertOnce(collection, data, getToken) {
  const base = 'https://www.wixapis.com/wix-data/v2/items';
  const created = await wixFetch(base, {
    method: 'POST',
    body: JSON.stringify({ dataCollectionId: collection,
      dataItem: { id: data.requestId, data: recordFor(data, collection === MIRROR) } })
  }, getToken);
  if (created.status === 409) {
    const url = base + '/' + encodeURIComponent(data.requestId) +
      '?dataCollectionId=' + encodeURIComponent(collection) + '&consistentRead=true';
    const existing = await wixFetch(url, { method: 'GET' }, getToken);
    if (!existing.ok) throw fail('Request reference conflict or storage unavailable', 409);
    const body = await existing.json();
    if (body.dataItem?.data?.payloadJson !== JSON.stringify(data))
      throw fail('Request reference conflict', 409);
    return data.requestId;
  }
  if (!created.ok) {
    console.error('GC package Wix insert failed', collection, 'HTTP', created.status);
    throw fail('Wix package storage unavailable', 502);
  }
  let body;
  try { body = await created.json(); }
  catch (_) { throw fail('Wix storage receipt unavailable', 502); }
  if (body.dataItem?.id !== data.requestId)
    throw fail('Wix did not confirm package request ID', 502);
  return body.dataItem.id;
}
async function savePackageRequest(raw, getToken) {
  const data = validatePackage(raw);
  await insertOnce(PRIMARY, data, getToken);
  if (data.redundancyMode === 'MIRRORED') {
    try {
      await insertOnce(MIRROR, data, getToken);
      return { status: 'SAVED', mirrored: true, requestId: data.requestId };
    } catch (_) {
      console.error('GC package mirror unavailable for reference', data.requestId);
      return { status: 'PRIMARY_ONLY', mirrored: false, requestId: data.requestId };
    }
  }
  return { status: 'SAVED', mirrored: false, requestId: data.requestId };
}
async function handlePackages(req, res, { send, getToken, publicOrigin, credentialsReady }) {
  const origin = req.headers.origin || '';
  // The client HTML is served by Render; its POST therefore uses this same origin.
  if (origin !== publicOrigin) return send(res, 403, { error: 'Origin not authorized' }, origin);
  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, origin);
  if (!credentialsReady) return send(res, 503, { error: 'GC package storage is not configured' }, origin);
  if (limited(req)) return send(res, 429, { error: 'Too many requests. Contact GC.' }, origin);
  if (Number(req.headers['content-length'] || 0) > MAX_BYTES)
    return send(res, 413, { error: 'Request too large' }, origin);
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw fail('Request too large', 413);
    }
    const incoming = JSON.parse(raw);
    const stored = await savePackageRequest(incoming, getToken);
    return send(res, stored.status === 'SAVED' ? 201 : 207,
      { ok: true, ...stored }, origin);
  } catch (e) {
    const code = e instanceof SyntaxError ? 400 : e.code || 502;
    if (code >= 500) console.error('GC package submission error:', e.message);
    return send(res, code, { error: code >= 500
      ? 'No confirmed GC receipt. Contact GC before submitting again.'
      : code === 409 ? 'Request ID conflict. Contact GC.' : e.message }, origin);
  }
}
module.exports = { validatePackage, recordFor, savePackageRequest, handlePackages };
