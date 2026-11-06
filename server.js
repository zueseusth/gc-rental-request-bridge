
'use strict';
// GC Rental submission bridge. Node 20+, no npm dependencies.
// Private credentials are read ONLY from environment variables.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { handlePackages } = require('./package-api');
const PORT = Number(process.env.PORT || 8877);
const CLIENT_ID = process.env.WIX_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WIX_CLIENT_SECRET || '';
const COLLECTION = 'GCRentalRequest';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(x => x.trim()).filter(Boolean);

const RATES = Object.freeze({
  base7: 35000,
  installation: 10000,
  vatPct: 7
});
const ZONES = new Set([
  'CAFE', 'RECEPTION', 'E', 'F', 'C', 'D', 'A', 'B'
]);
const TYPES = new Set([
  'Exhibition', 'Art installation', 'Workshop',
  'Event', 'Filming / production', 'Meeting', 'Other'
]);
const rateBuckets = new Map();
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const error = (msg, code = 400) =>
  Object.assign(new Error(msg), { code });

function text(v, label, max, min = 0) {
  if (typeof v !== 'string') throw error(`Invalid ${label}`);
  const s = v.trim();
  if (s.length < min || s.length > max)
    throw error(`Invalid ${label}`);
  return s;
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw error('Invalid payload');
  if (input.website) throw error('Request rejected');
  if (input.accepted !== true) throw error('Consent required');

  const applicantName = text(input.applicant_name, 'client name', 140, 2);
  const organization = text(input.organization, 'organization', 140);
  const email = text(input.email, 'email', 200, 4);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw error('Invalid email');

  const phone = text(input.phone, 'phone', 60, 4);
  const eventTitle = text(input.event_title, 'event title', 160, 2);
  const eventType = text(input.event_type, 'event type', 60, 1);

  if (!TYPES.has(eventType))
    throw error('Invalid event type');

  const equipment = text(input.equipment, 'equipment', 300);
  const notes = text(input.notes, 'description', 3000, 10);
  const attendees = Number(input.attendees);
  const h = Number(input.duration_hours);

  if (!Number.isSafeInteger(attendees) ||
      attendees < 1 || attendees > 100000)
    throw error('Invalid attendees');

  if (!Number.isSafeInteger(h) || h < 1 || h > 8760)
    throw error('Invalid duration');

  const zones = input.zones;
  if (!Array.isArray(zones) ||
      zones.length < 1 ||
      zones.length > 8 ||
      zones.some(z => !ZONES.has(z)) ||
      new Set(zones).size !== zones.length)
    throw error('Invalid zones');

  const startAtLocal = text(input.start_at, 'start date', 16, 16);

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAtLocal))
    throw error('Invalid start date');

  const startMs = Date.parse(startAtLocal + ':00+07:00');

  if (!Number.isFinite(startMs) || startMs <= Date.now())
    throw error('Start date must be in the future');

  const normalized =
    new Date(startMs + 7 * 3600 * 1000).toISOString().slice(0, 16);

  if (normalized !== startAtLocal)
    throw error('Invalid start date');

  const endMs = startMs + h * 3600 * 1000;
  const endAtLocal =
    new Date(endMs + 7 * 3600 * 1000).toISOString().slice(0, 16);

  const rentalRaw = RATES.base7 * h / 168;
  const subtotal = rentalRaw + RATES.installation;
  const totalRaw = subtotal * (1 + RATES.vatPct / 100);
  const now = new Date().toISOString();

  return {
    title: eventTitle,
    applicantName,
    organization,
    email,
    phone,
    startAtLocal,
    endAtLocal,
    startUtc: { $date: new Date(startMs).toISOString() },
    endUtc: { $date: new Date(endMs).toISOString() },
    durationHours: h,
    durationDays: round2(h / 24),
    zones: zones.join(', '),
    eventTitle,
    eventType,
    attendees,
    equipment,
    notes,
    rental: round2(rentalRaw),
    installation: RATES.installation,
    vat: round2(subtotal * RATES.vatPct / 100),
    grandTotal: round2(totalRaw),
    difference7d: round2(
      totalRaw - (RATES.base7 + RATES.installation) * 1.07
    ),
    base7Snapshot: RATES.base7,
    vatPctSnapshot: RATES.vatPct,
    recordStatus: 'NEW',
    submittedAt: { $date: now }
  };
}

// WIX OAUTH AUTHENTICATION + SAFE DIAGNOSTICS

let token = '';
let expiry = 0;
let tokenPending = null;

async function getToken() {
  if (token && Date.now() < expiry - 300000)
    return token;

  if (tokenPending)
    return tokenPending;

  tokenPending = (async () => {
    let response;

    try {
      response = await fetch('https://www.wixapis.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        }),
        signal: AbortSignal.timeout(12000)
      });
    } catch (e) {
      const kind = e?.name === 'TimeoutError'
        ? 'timeout'
        : 'network_error';

      console.error(`GC Wix OAuth failed: ${kind}`);
      throw error('Wix authorization unavailable', 502);
    }

    let body;

    try {
      body = await response.json();
    } catch {
      console.error(
        `GC Wix OAuth failed: HTTP ${response.status}; code=invalid_json`
      );
      throw error('Wix authorization unavailable', 502);
    }

    if (!response.ok || !body?.access_token) {
      const allowedCodes = new Set([
        'invalid_client',
        'invalid_grant',
        'invalid_request',
        'unauthorized_client',
        'unsupported_grant_type',
        'temporarily_unavailable'
      ]);

      const oauthCode = allowedCodes.has(body?.error)
        ? body.error
        : (response.ok ? 'missing_access_token' : 'unknown');

      console.error(
        `GC Wix OAuth failed: HTTP ${response.status}; code=${oauthCode}`
      );

      throw error('Wix authorization unavailable', 502);
    }

    token = body.access_token;
    expiry = Date.now() +
      (Number(body.expires_in) || 3600) * 1000;

    return token;
  })();

  try {
    return await tokenPending;
  } finally {
    tokenPending = null;
  }
}

// WIX CMS INSERT

async function storeInWix(record, id) {
  const accessToken = await getToken();

  const response = await fetch(
    'https://www.wixapis.com/wix-data/v2/items',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': accessToken
      },
      body: JSON.stringify({
        dataCollectionId: COLLECTION,
        dataItem: {
          id,
          data: record
        }
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (response.status === 409)
    throw error(
      'Duplicate request; please contact GC with your request reference',
      409
    );

  if (!response.ok) {
    // Do not log response bodies or private application data.
    console.error(
      `GC Wix CMS insert failed: HTTP ${response.status}`
    );
    throw error('Unable to store request in GC CMS', 502);
  }

  const body = await response.json();

  if (!body.dataItem?.id)
    throw error('Wix did not confirm the stored request', 502);

  return body.dataItem.id;
}

// HTTP RESPONSE + CORS

function send(res, status, value, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] =
      'POST, GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type';
  }

  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
}

function allowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (rateBuckets.size > 10000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.reset < now)
        rateBuckets.delete(key);
    }
  }

  const bucket = rateBuckets.get(ip) || {
    reset: now + 3600000,
    count: 0
  };

  if (bucket.reset < now) {
    bucket.reset = now + 3600000;
    bucket.count = 0;
  }

  bucket.count++;
  rateBuckets.set(ip, bucket);

  return bucket.count > 12;
}

// SERVER ROUTES

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const pathname =
    new URL(req.url, 'http://localhost').pathname;

  // Hosted rental form
  if ((pathname === '/' || pathname === '/rental') &&
      req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(
      fs.readFileSync(path.join(__dirname, 'index.html'))
    );
    return;
  }

  // Health status
  if (pathname === '/health' && req.method === 'GET') {
    return send(res, 200, {
      status: 'configured',
      collection: COLLECTION,
      credentialConfigured: !!CLIENT_ID && !!CLIENT_SECRET,
      originsConfigured: ALLOWED_ORIGINS.length > 0
    }, origin);
  }

  // GC ONNESIS package selector, hosted on Render and embedded into Wix by URL.
  if (pathname === '/packages' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'self' https://www.groundbangkok.com https://groundbangkok.com"
    });
    res.end(fs.readFileSync(path.join(__dirname, 'package.html')));
    return;
  }
  if (pathname === '/api/packages') {
    return handlePackages(req, res, {
      send,
      getToken,
      publicOrigin: process.env.PACKAGE_PUBLIC_ORIGIN || 'https://ground-bangkok-gc-rental.onrender.com',
      credentialsReady: !!CLIENT_ID && !!CLIENT_SECRET
    });
  }

  // Submission route
  if (pathname !== '/api/rental')
    return send(res, 404, { error: 'Not found' }, origin);

  if (!allowed(req))
    return send(res, 403, {
      error: 'Origin not authorized'
    }, origin);

  if (req.method === 'OPTIONS')
    return send(res, 204, {}, origin);

  if (req.method !== 'POST')
    return send(res, 405, {
      error: 'Method not allowed'
    }, origin);

  if (!CLIENT_ID || !CLIENT_SECRET)
    return send(res, 503, {
      error: 'GC submission is not yet configured'
    }, origin);

  if (rateLimited(req))
    return send(res, 429, {
      error: 'Too many requests. Please contact GC.'
    }, origin);

  if (Number(req.headers['content-length'] || 0) > 16000)
    return send(res, 413, {
      error: 'Request too large'
    }, origin);

  try {
    let raw = '';

    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 16000)
        throw error('Request too large', 413);
    }

    const value = JSON.parse(raw);
    const record = validate(value.payload);

    const id = text(
      value.requestId,
      'request reference',
      36,
      36
    );

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw error('Invalid request reference');

    const storedId = await storeInWix(record, id);

    send(res, 201, {
      ok: true,
      id: storedId,
      total: record.grandTotal,
      status: 'NEW'
    }, origin);

  } catch (e) {
    if (e instanceof SyntaxError)
      return send(res, 400, {
        error: 'Invalid JSON'
      }, origin);

    const code = e.code || 502;

    if (code >= 500)
      console.error('GC submission error:', e.message);

    send(res, code, {
      error: code >= 500
        ? 'GC submission unavailable. Please contact GC to confirm whether the application was received.'
        : e.message
    }, origin);
  }
});

if (require.main === module) {
  server.listen(
    PORT,
    '0.0.0.0',
    () => console.log(`GC bridge listening on ${PORT}`)
  );
}

module.exports = { validate, server };
