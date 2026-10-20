import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

const app = createApp({ CLIENT_ORIGIN: 'http://localhost:5173' });

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('unknown routes return the standard error envelope', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });
});

describe('env', () => {
  it('rejects a missing MONGODB_URI', () => {
    expect(() => loadEnv({ JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv)).toThrow(/MONGODB_URI/);
  });

  it('applies defaults and keeps the paid-ride flag off', () => {
    const env = loadEnv({ MONGODB_URI: 'mongodb://x/y', JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(4000);
    expect(env.ENABLE_PAID_PRIVATE_RIDES).toBe(false);
  });
});
