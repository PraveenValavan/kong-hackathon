'use strict';

jest.mock('http');

const http = require('http');
const { fetchJson, loadData, threshInfo, simTick, LIMIT, MODELS, MOCK } = require('../src/lib');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockHttpGet(statusCode, body) {
  const res = {
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(typeof body === 'string' ? body : JSON.stringify(body));
      if (event === 'end')  cb();
      return res;
    }),
  };
  const req = { on: jest.fn().mockReturnThis() };
  http.get.mockImplementation((url, cb) => { cb(res); return req; });
}

function mockHttpError(message) {
  const req = {
    on: jest.fn((event, cb) => {
      if (event === 'error') cb(new Error(message));
      return req;
    }),
  };
  http.get.mockImplementation(() => req);
}

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

describe('fetchJson', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves with parsed JSON on success', async () => {
    const payload = { ok: true, value: 42 };
    mockHttpGet(200, payload);
    await expect(fetchJson('http://localhost:8002/test')).resolves.toEqual(payload);
  });

  it('rejects when JSON is malformed', async () => {
    const res = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb('not-json!!!');
        if (event === 'end')  cb();
        return res;
      }),
    };
    const req = { on: jest.fn().mockReturnThis() };
    http.get.mockImplementation((url, cb) => { cb(res); return req; });
    await expect(fetchJson('http://localhost:8002/test')).rejects.toThrow();
  });

  it('rejects on network error', async () => {
    mockHttpError('ECONNREFUSED');
    await expect(fetchJson('http://localhost:8002/test')).rejects.toThrow('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// loadData
// ---------------------------------------------------------------------------

describe('loadData', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when backend is unreachable', async () => {
    mockHttpError('ECONNREFUSED');
    await expect(loadData('test-user')).resolves.toBeNull();
  });

  it('computes pct and remaining from hourly_tokens_used', async () => {
    const hourly = 250000;
    const dashboard = { hourly_tokens_used: hourly, current_model: 'gpt-4o', dept_breakdown: [] };
    const session   = [{ prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.05, request_count: 3 }];

    let call = 0;
    const res1 = { on: jest.fn((e, cb) => { if (e === 'data') cb(JSON.stringify(dashboard)); if (e === 'end') cb(); return res1; }) };
    const res2 = { on: jest.fn((e, cb) => { if (e === 'data') cb(JSON.stringify(session));   if (e === 'end') cb(); return res2; }) };
    const req  = { on: jest.fn().mockReturnThis() };
    http.get.mockImplementation((url, cb) => { cb(call++ === 0 ? res1 : res2); return req; });

    const data = await loadData('test-user');
    expect(data.live).toBe(true);
    expect(data.tokensUsed).toBe(hourly);
    expect(data.remaining).toBe(LIMIT - hourly);
    expect(data.pct).toBe('50.0');
    expect(data.currentModel).toBe('gpt-4o');
  });

  it('uses defaults when dashboard fields are absent', async () => {
    const dashboard = {};
    const session   = [];
    let call = 0;
    const makeRes = (body) => ({ on: jest.fn((e, cb) => { if (e === 'data') cb(JSON.stringify(body)); if (e === 'end') cb(); return makeRes(body); }) });
    const res1 = makeRes(dashboard);
    const res2 = makeRes(session);
    const req  = { on: jest.fn().mockReturnThis() };
    http.get.mockImplementation((url, cb) => { cb(call++ === 0 ? res1 : res2); return req; });

    const data = await loadData('test-user');
    expect(data.tokensUsed).toBe(0);
    expect(data.currentModel).toBe('claude-sonnet-4-6');
    expect(data.sessionPrompt).toBe(0);
    expect(data.deptRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// threshInfo
// ---------------------------------------------------------------------------

describe('threshInfo', () => {
  const cases = [
    [95,  'critical'],
    [90,  'critical'],
    [85,  'danger'],
    [80,  'danger'],
    [65,  'caution'],
    [60,  'caution'],
    [45,  'warn'],
    [40,  'warn'],
    [20,  'safe'],
    [0,   'safe'],
  ];

  test.each(cases)('pct=%i → cls=%s', (pct, expected) => {
    expect(threshInfo(pct).cls).toBe(expected);
  });

  it('returns an alert message for danger and above', () => {
    expect(threshInfo(80).alert).toBeTruthy();
    expect(threshInfo(90).alert).toBeTruthy();
  });

  it('returns empty alert for safe zone', () => {
    expect(threshInfo(10).alert).toBe('');
  });
});

// ---------------------------------------------------------------------------
// simTick
// ---------------------------------------------------------------------------

describe('simTick', () => {
  it('increases token count', () => {
    const before = 100000;
    const after  = simTick(before);
    expect(after).toBeGreaterThan(before);
  });

  it('never exceeds LIMIT - 1', () => {
    const nearLimit = LIMIT - 1;
    for (let i = 0; i < 50; i++) {
      expect(simTick(nearLimit)).toBeLessThan(LIMIT);
    }
  });

  it('caps at LIMIT - 1 even when starting at LIMIT', () => {
    expect(simTick(LIMIT)).toBe(LIMIT - 1);
  });
});

// ---------------------------------------------------------------------------
// MODELS constant
// ---------------------------------------------------------------------------

describe('MODELS', () => {
  it('contains all expected model keys', () => {
    const keys = ['gemini-2.5-flash', 'claude-haiku-4-5', 'gpt-4o', 'claude-sonnet-4-6', 'claude-opus-4-7'];
    const modelKeys = Object.keys(MODELS);
    keys.forEach(k => expect(modelKeys).toContain(k));
  });

  it('has positive rates for every model', () => {
    Object.values(MODELS).forEach(({ inRate, outRate }) => {
      expect(inRate).toBeGreaterThan(0);
      expect(outRate).toBeGreaterThan(0);
    });
  });

  it('orders premium models above budget models by output rate', () => {
    expect(MODELS['claude-opus-4-7'].outRate).toBeGreaterThan(MODELS['gemini-2.5-flash'].outRate);
  });
});

// ---------------------------------------------------------------------------
// MOCK data integrity
// ---------------------------------------------------------------------------

describe('MOCK data', () => {
  it('remaining === LIMIT - tokensUsed', () => {
    expect(MOCK.remaining).toBe(LIMIT - MOCK.tokensUsed);
  });

  it('pct reflects tokensUsed', () => {
    const computed = ((MOCK.tokensUsed / LIMIT) * 100).toFixed(1);
    expect(MOCK.pct).toBe(computed);
  });

  it('deptRows has a highlighted "You" entry', () => {
    const you = MOCK.deptRows.find(r => r.highlight);
    expect(you).toBeDefined();
    expect(you.pct).toBe(MOCK.deptPct);
  });
});
