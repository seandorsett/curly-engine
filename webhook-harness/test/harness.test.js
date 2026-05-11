/**
 * Self-test for the harness. Run with `node webhook-harness/test/harness.test.js`.
 *
 * Boots the server on an ephemeral port, then:
 *   1. opens an SSE listener
 *   2. POSTs a workflow event with the right token (expect 202 + delivered)
 *   3. POSTs a workflow event with a bad token  (expect 401)
 *   4. POSTs a github event with the right HMAC (expect 202 + delivered)
 *   5. POSTs a github event with a bad HMAC     (expect 401)
 *
 * Exits non-zero on the first failed assertion so it slots into CI.
 */
'use strict';

const http     = require('node:http');
const crypto   = require('node:crypto');
const assert   = require('node:assert/strict');

process.env.PORT = '0';
process.env.WEBHOOK_TOKEN = 'test-token';
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';

const { server } = require('../server.js');

function request(method, port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end',  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function streamOnce(port) {
  return new Promise((resolve, reject) => {
    const got = [];
    const req = http.request({
      host: '127.0.0.1', port, path: '/stream', method: 'GET',
      headers: { accept: 'text/event-stream' },
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error('stream status ' + res.statusCode));
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith(':')) continue; // keep-alive
          got.push(frame);
        }
      });
      // resolve after 250ms of quiet so we capture replay + first push
      let timer;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { req.destroy(); resolve(got); }, 250); };
      res.on('data', arm);
      arm();
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  let failures = 0;

  const check = async (label, fn) => {
    try { await fn(); process.stdout.write(`  ok   ${label}\n`); }
    catch (e) { failures += 1; process.stdout.write(`  FAIL ${label}\n       ${e.message}\n`); }
  };

  await check('healthz returns ok', async () => {
    const r = await request('GET', port, '/healthz', {});
    assert.equal(r.status, 200);
    assert.match(r.body, /"ok":true/);
  });

  await check('workflow event with valid token is accepted', async () => {
    const r = await request('POST', port, '/events',
      { 'content-type': 'application/json', 'x-demo-token': 'test-token' },
      JSON.stringify({ demo: 'service-container-overrides', run_id: '123', sha: 'deadbeef',
                       jobs: { before: 'success', after: 'success' } }));
    assert.equal(r.status, 202);
  });

  await check('workflow event with bad token is rejected', async () => {
    const r = await request('POST', port, '/events',
      { 'content-type': 'application/json', 'x-demo-token': 'nope' },
      JSON.stringify({ demo: 'x' }));
    assert.equal(r.status, 401);
  });

  await check('github event with valid signature is accepted', async () => {
    const body = JSON.stringify({ action: 'created', repository: { full_name: 'a/b' }, sender: { login: 'octocat' } });
    const sig  = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
    const r = await request('POST', port, '/github',
      { 'content-type': 'application/json',
        'x-github-event': 'deployment',
        'x-hub-signature-256': sig },
      body);
    assert.equal(r.status, 202);
  });

  await check('github event with bad signature is rejected', async () => {
    const body = JSON.stringify({ action: 'created' });
    const r = await request('POST', port, '/github',
      { 'content-type': 'application/json',
        'x-github-event': 'deployment',
        'x-hub-signature-256': 'sha256=cafefeed' },
      body);
    assert.equal(r.status, 401);
  });

  await check('SSE replays previously-recorded events', async () => {
    const frames = await streamOnce(port);
    // Expect at least 2 delivered events from steps above (workflow + github).
    const dataFrames = frames.filter((f) => f.includes('data:'));
    assert.ok(dataFrames.length >= 2, `expected >=2 data frames, got ${dataFrames.length}`);
    const joined = dataFrames.join('\n');
    assert.match(joined, /service-container-overrides/);
    assert.match(joined, /"source":"github"/);
  });

  await check('api/events returns the recorded events', async () => {
    const r = await request('GET', port, '/api/events', {});
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.ok(Array.isArray(parsed.events));
    assert.ok(parsed.events.length >= 2);
  });

  server.close();
  if (failures) {
    process.stdout.write(`\n${failures} failure(s)\n`);
    process.exit(1);
  } else {
    process.stdout.write(`\nall good\n`);
    process.exit(0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
