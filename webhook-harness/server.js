#!/usr/bin/env node
/**
 * Tiny webhook test harness for the office-hours demo.
 *
 * - POST  /events                 accept JSON push from a workflow job
 * - POST  /github                 accept a raw GitHub webhook (verifies sig)
 * - GET   /stream                 Server-Sent Events feed of every event
 * - GET   /                       live dashboard (public/index.html)
 * - GET   /api/events             flat JSON of everything we've seen
 * - GET   /healthz                liveness
 *
 * No external dependencies - just the Node standard library so it runs
 * straight from a clone with `node webhook-harness/server.js`.
 */
'use strict';

const http   = require('node:http');
const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');

const PORT          = Number(process.env.PORT || 4317);
const HOST          = process.env.HOST || '0.0.0.0';
const DEMO_TOKEN    = process.env.WEBHOOK_TOKEN  || 'office-hours-demo';
const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const MAX_EVENTS    = Number(process.env.MAX_EVENTS || 500);
const PUBLIC_DIR    = path.join(__dirname, 'public');

// In-memory ring buffer. The dashboard reads the last N on connect and then
// follows the SSE stream for new arrivals. No persistence on purpose - the
// harness is meant to be ephemeral.
const events = [];
const clients = new Set();   // active SSE response objects

function pushEvent(ev) {
  ev.id = crypto.randomUUID();
  ev.receivedAt = new Date().toISOString();
  events.push(ev);
  if (events.length > MAX_EVENTS) events.shift();
  const line = `id: ${ev.id}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { /* client gone, swept on close */ }
  }
  log(`event ${ev.kind} from ${ev.source} -> ${clients.size} listener(s)`);
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// ---- request helpers ------------------------------------------------------

function readBody(req, limit = 1024 * 256) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyGitHubSignature(rawBody, header) {
  if (!GITHUB_SECRET) return { ok: false, reason: 'GITHUB_WEBHOOK_SECRET not set' };
  if (!header || !header.startsWith('sha256=')) return { ok: false, reason: 'missing or malformed signature' };
  const expected = 'sha256=' + crypto.createHmac('sha256', GITHUB_SECRET).update(rawBody).digest('hex');
  return timingSafeEq(header, expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

// ---- static dashboard -----------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe = path.normalize(reqPath).replace(/^([/\\.]+)+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---- routes ---------------------------------------------------------------

async function handleDemoEvent(req, res) {
  const token = req.headers['x-demo-token'];
  if (!token || !timingSafeEq(String(token), DEMO_TOKEN)) {
    return json(res, 401, { error: 'bad or missing x-demo-token' });
  }
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.status || 400, { error: e.message }); }
  let payload;
  try { payload = JSON.parse(body.toString('utf8') || '{}'); }
  catch { return json(res, 400, { error: 'invalid json' }); }

  pushEvent({
    source: 'workflow',
    kind: payload.demo || 'workflow',
    runId: payload.run_id || null,
    sha:   payload.sha || null,
    jobs:  payload.jobs || {},
    raw:   payload,
  });
  json(res, 202, { accepted: true });
}

async function handleGithubWebhook(req, res) {
  const raw = await readBody(req).catch((e) => { json(res, e.status || 400, { error: e.message }); return null; });
  if (!raw) return;
  const sig = req.headers['x-hub-signature-256'];
  const evt = req.headers['x-github-event'] || 'unknown';
  const delivery = req.headers['x-github-delivery'] || null;
  const verdict = verifyGitHubSignature(raw, sig);
  if (!verdict.ok) {
    log(`rejected github webhook: ${verdict.reason}`);
    return json(res, 401, { error: verdict.reason });
  }
  let parsed = {};
  try { parsed = JSON.parse(raw.toString('utf8') || '{}'); } catch {}
  pushEvent({
    source: 'github',
    kind: String(evt),
    delivery,
    action: parsed.action || null,
    repo: parsed.repository?.full_name || null,
    sender: parsed.sender?.login || null,
    raw: parsed,
  });
  json(res, 202, { accepted: true });
}

function handleStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 5000\n`);
  // replay the buffer so a late-joining dashboard catches up
  for (const ev of events) {
    res.write(`id: ${ev.id}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`);
  }
  clients.add(res);
  log(`SSE client connected (${clients.size} total)`);
  const hb = setInterval(() => { try { res.write(`: keep-alive\n\n`); } catch {} }, 15000);
  req.on('close', () => {
    clearInterval(hb);
    clients.delete(res);
    log(`SSE client disconnected (${clients.size} remaining)`);
  });
}

// ---- top-level router -----------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET'  && u.pathname === '/healthz')      return json(res, 200, { ok: true, events: events.length, listeners: clients.size });
  if (req.method === 'GET'  && u.pathname === '/api/events')   return json(res, 200, { events });
  if (req.method === 'GET'  && u.pathname === '/stream')       return handleStream(req, res);
  if (req.method === 'POST' && u.pathname === '/events')       return handleDemoEvent(req, res);
  if (req.method === 'POST' && u.pathname === '/github')       return handleGithubWebhook(req, res);
  if (req.method === 'POST' && u.pathname === '/reset') {
    events.length = 0;
    return json(res, 200, { reset: true });
  }
  if (req.method === 'GET') return serveStatic(req, res);

  json(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, HOST, () => {
  log(`harness listening on http://${HOST}:${PORT}`);
  log(`  dashboard           GET  /`);
  log(`  workflow webhook    POST /events       (header x-demo-token)`);
  log(`  github webhook      POST /github       (header x-hub-signature-256)`);
  log(`  live stream         GET  /stream       (text/event-stream)`);
});

module.exports = { server, pushEvent, _events: events };
