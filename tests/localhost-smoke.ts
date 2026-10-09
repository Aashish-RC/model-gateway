import { buildServer } from '../src/server.js';

async function main() {
  console.log('--- Starting Localhost Live Smoke Test ---');
  let server: any = null;
  let baseUrl = 'http://127.0.0.1:8080';

  try {
    const probe = await fetch(`${baseUrl}/health`);
    if (probe.ok) {
      console.log(`[INFO] Existing server detected on ${baseUrl}, running smoke tests against live instance.`);
    } else {
      throw new Error('Not running');
    }
  } catch {
    server = await buildServer({ logger: false });
    const address = await server.listen({ host: '127.0.0.1', port: 8080 });
    console.log(`[PASS] Server listening at: ${address}`);
  }

  // Test 1: Health check
  console.log('\n[TEST 1] Querying GET /health...');
  const healthRes = await fetch('http://127.0.0.1:8080/health');
  const healthJson = await healthRes.json();
  console.log(`Status Code: ${healthRes.status}`);
  console.log('Response Body:', healthJson);
  if (healthRes.status !== 200 || healthJson.status !== 'ok') {
    throw new Error('Health check failed!');
  }
  console.log('[PASS] GET /health verified.');

  // Test 2: Validation on invalid payload
  console.log('\n[TEST 2] Testing 400 Bad Request on invalid payload...');
  const badReq = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
  });
  const badReqJson = await badReq.json();
  console.log(`Status Code: ${badReq.status}`);
  console.log('Error Body:', badReqJson);
  if (badReq.status !== 400) {
    throw new Error('Validation error handling failed!');
  }
  console.log('[PASS] Validation failure caught properly.');

  // Test 4: Feature 4 Resilience & Circuit Breaker inspection
  console.log('\n[TEST 4] Querying GET /api/resilience...');
  const resilienceRes = await fetch('http://127.0.0.1:8080/api/resilience');
  const resilienceJson = await resilienceRes.json() as any;
  console.log(`Status Code: ${resilienceRes.status}`);
  console.log('Breaker Metrics:', Object.keys(resilienceJson.breakers || {}));
  if (resilienceRes.status !== 200 || !resilienceJson.breakers) {
    throw new Error('Resilience endpoint verification failed!');
  }
  console.log('[PASS] GET /api/resilience verified.');

  // Test 5: Feature 5 Prometheus Metrics
  console.log('\n[TEST 5] Querying GET /metrics (Prometheus)...');
  const metricsRes = await fetch('http://127.0.0.1:8080/metrics');
  const metricsText = await metricsRes.text();
  console.log(`Status Code: ${metricsRes.status}, Content-Type: ${metricsRes.headers.get('content-type')}`);
  console.log('Metrics Snippet:\n' + metricsText.split('\n').slice(0, 5).join('\n'));
  if (metricsRes.status !== 200 || !metricsText.includes('gateway_requests_total')) {
    throw new Error('Prometheus metrics export verification failed!');
  }
  console.log('[PASS] GET /metrics verified.');

  // Test 6: Feature 5 Telemetry KPIs & Pricing
  console.log('\n[TEST 6] Querying GET /api/telemetry/stats & /api/pricing...');
  const statsRes = await fetch('http://127.0.0.1:8080/api/telemetry/stats');
  const statsJson = await statsRes.json() as any;
  const pricingRes = await fetch('http://127.0.0.1:8080/api/pricing');
  const pricingJson = await pricingRes.json() as any;

  if (statsRes.status !== 200 || !statsJson.kpis) {
    throw new Error('Telemetry stats endpoint failed!');
  }
  if (pricingRes.status !== 200 || !pricingJson.pricing || !pricingJson.pricing['gpt-4o']) {
    throw new Error('Pricing catalog endpoint failed!');
  }
  console.log('[PASS] Telemetry KPIs & Model Pricing Catalog verified.');

  // Test 7: Feature 6 Virtual Keys & Rate Limit Quota
  console.log('\n[TEST 7] Querying GET /api/virtual-keys & verifying rate limits...');
  const vkRes = await fetch('http://127.0.0.1:8080/api/virtual-keys');
  const vkJson = await vkRes.json() as any;
  if (vkRes.status !== 200 || !Array.isArray(vkJson.keys)) {
    throw new Error('Virtual keys endpoint failed!');
  }
  console.log(`Discovered ${vkJson.keys.length} virtual keys in database.`);

  // Test rate limit rejection on exhausted virtual key
  const exhaustedRes = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-gw-demo-exhausted',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    }),
  });
  if (exhaustedRes.status !== 429) {
    throw new Error(`Expected 429 on exhausted key, got ${exhaustedRes.status}`);
  }
  console.log('[PASS] Feature 6 Virtual Key budget cap & rate limiting verified.');

  if (server) {
    await server.close();
  }
  console.log('\n[PASS] All localhost smoke tests passed (F1-F6 verified)!\n');
}

main().catch((err) => {
  console.error('[FAIL] Localhost smoke test failed:', err);
  process.exit(1);
});
