import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

describe('Health Check Route', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({
      logger: false,
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /health returns 200 with status ok and timestamp', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });
});
