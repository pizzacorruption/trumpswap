// Run with: node tests/demo.test.js. No credentials or external services are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const samples = require('../config/demo-results.json');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
assert.ok(samples.length > 0, 'The demo needs at least one example');
assert.equal(new Set(samples.map(sample => sample.id)).size, samples.length, 'Sample IDs must be unique');
for (const sample of samples) {
  assert.match(sample.id, /^[a-z0-9_]+$/);
  assert.ok(sample.label && sample.scene && sample.filename);
  for (const url of [sample.imageUrl, sample.scene]) {
    assert.ok(url.startsWith('/') && !url.includes('..') && !url.includes('?'));
    const asset = path.resolve(publicDir, '.' + url);
    assert.ok(asset.startsWith(publicDir + path.sep));
    assert.ok(fs.statSync(asset).isFile(), `Missing demo asset: ${url}`);
  }
}

const apiNames = ['generate', 'create-checkout', 'buy-credits', 'buy-watermark-removal'];
const allowedImports = new Set([
  ...apiNames.map(name => '../api/' + name),
  '../services/demo',
  '../config/demo-results.json'
]);
const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalEnvironment = process.env.NODE_ENV;

function invoke(handler, overrides = {}) {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://pimpmyepstein.lol' },
    body: { sampleId: samples[0].id },
    ...overrides
  };
  handler(req, response);
  return response;
}

try {
  process.env.NODE_ENV = 'production';
  global.fetch = () => { throw new Error('Demo paths must not make network requests'); };
  Module._load = function(request, ...args) {
    assert.ok(allowedImports.has(request), `Unexpected service dependency: ${request}`);
    return originalLoad.call(this, request, ...args);
  };
  const handlers = Object.fromEntries(apiNames.map(name => [name, require('../api/' + name)]));
  const demo = require('../services/demo');
  assert.equal(handlers.generate, demo.generate);

  for (const sample of samples) {
    for (const body of [{ sampleId: sample.id }, JSON.stringify({ sampleId: sample.id })]) {
      const res = invoke(handlers.generate, { body });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, {
        success: true, demo: true, imageUrl: sample.imageUrl,
        sampleLabel: sample.label, modelType: 'demo'
      });
      assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://pimpmyepstein.lol');
    }
  }

  for (const body of [
    { sampleId: 'unknown' }, { sampleId: '../../.env' }, { sampleId: '__proto__' },
    { sampleId: 'constructor' }, { sampleId: null }, {}, [], null, '{invalid',
    { sampleId: samples[0].id, userPhoto: 'private-photo' },
    { sampleId: samples[0].id, modelType: 'premium' }
  ]) assert.equal(invoke(handlers.generate, { body }).statusCode, 400);

  assert.equal(invoke(handlers.generate, { file: { buffer: Buffer.from('photo') } }).statusCode, 400);
  assert.equal(invoke(handlers.generate, {
    headers: { 'content-type': 'multipart/form-data; boundary=demo' }
  }).statusCode, 415);
  assert.equal(invoke(handlers.generate, { method: 'GET' }).statusCode, 405);
  assert.equal(invoke(handlers.generate, { method: 'OPTIONS' }).statusCode, 200);
  assert.equal(invoke(handlers.generate, {
    headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' }
  }).headers['Access-Control-Allow-Origin'], undefined);

  for (const name of apiNames.slice(1)) {
    assert.equal(handlers[name], demo.purchasesUnavailable);
    const res = invoke(handlers[name], {
      headers: { authorization: 'Bearer must-not-be-verified' },
      body: { plan: 'base', userId: 'must-not-be-used' }
    });
    assert.equal(res.statusCode, 410);
    assert.match(res.body.message, /free demo/);
    assert.equal(res.body.checkoutUrl, undefined);
    assert.equal(res.body.upgradeUrl, undefined);
  }
} finally {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
}

// Verify the real Express registration cannot reach auth or quota middleware first.
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const authPosition = server.indexOf('app.use(authMiddleware)');
assert.ok(authPosition > 0);
for (const name of apiNames) {
  const handler = name === 'generate' ? 'generate' : 'purchasesUnavailable';
  const registration = `app.post('/api/${name}', demo.${handler});`;
  const position = server.indexOf(registration);
  assert.ok(position >= 0 && position < authPosition, `${name} must bypass auth/quota/upload middleware`);
  assert.equal(server.split(`app.post('/api/${name}'`).length - 1, 1, `${name} must have no alternative live handler`);
}
assert.doesNotMatch(server, /GoogleGenerativeAI|generateContent\s*\(/);
console.log(`PASS: ${samples.length} canned assets, JSON input validation, upload rejection, CORS, disabled sales, and shared pre-auth Express routes. No AI, database, Stripe, or network dependencies invoked.`);
