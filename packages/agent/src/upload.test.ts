import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from './api.ts';
import { Outbox, type OutboxStore } from './outbox.ts';
import type { Ping } from './ping.ts';
import { classifyResponse, createUploader } from './upload.ts';

// A GraphQL server answers 200 with nulls in `data` for auth failures, so
// "the request succeeded" says nothing about whether the pings landed. Getting
// this wrong silently discarded every ping a revoked device key uploaded.

const ping = (n: number): Ping => ({
  capturedAt: new Date(n).toISOString(),
  app: `app${n}`,
  title: null,
  context: null,
  idleSeconds: 0,
});

function memoryStore(): OutboxStore {
  let contents: string | null = null;
  return {
    read: () => contents,
    append: (data) => {
      contents = (contents ?? '') + data;
    },
    write: (data) => {
      contents = data;
    },
  };
}

const config: AgentConfig = { serverUrl: 'http://server.test', apiKey: 'k' };

describe('classifyResponse', () => {
  it('keeps a batch the server refused wholesale', () => {
    expect(
      classifyResponse({
        data: { p0: null, p1: null },
        errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    ).toEqual({ accepted: false, error: 'Not authenticated' });
  });

  it('keeps a batch when the server errored before running anything', () => {
    expect(classifyResponse({ data: null, errors: [{ message: 'Syntax Error' }] })).toEqual({
      accepted: false,
      error: 'Syntax Error',
    });
  });

  it('accepts a batch that landed', () => {
    expect(classifyResponse({ data: { p0: { id: 'a' }, p1: { id: 'b' } } })).toEqual({
      accepted: true,
      error: null,
    });
  });

  it('accepts a batch the server had nothing to record for', () => {
    // recordPing answers null for an idle ping — a whole batch of them is an
    // hour away from the keyboard, not a failure. Keeping it wedged the outbox:
    // the same batch went up forever and everything queued behind it.
    expect(classifyResponse({ data: { p0: null, p1: null } })).toEqual({
      accepted: true,
      error: null,
    });
  });

  it('accepts a partial success — re-sending would double-count folded time', () => {
    expect(
      classifyResponse({
        data: { p0: { id: 'a' }, p1: null },
        errors: [{ message: 'Invalid capturedAt', extensions: { code: 'BAD_USER_INPUT' } }],
      }),
    ).toEqual({ accepted: true, error: null });
  });

  it('drops a batch every ping of which is unfixably malformed', () => {
    // Otherwise one bad ping wedges the outbox forever.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      classifyResponse({
        data: { p0: null },
        errors: [{ message: 'Invalid capturedAt', extensions: { code: 'BAD_USER_INPUT' } }],
      }),
    ).toEqual({ accepted: true, error: null });
  });

  it('keeps a batch whose failure it cannot classify', () => {
    // Unknown code, older server, anything unexpected: an outbox that grows is
    // recoverable, a dropped ping is not.
    expect(classifyResponse({ data: { p0: null }, errors: [{ message: 'weird' }] })).toEqual({
      accepted: false,
      error: 'weird',
    });
  });
});

describe('createUploader', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('leaves rejected pings in the outbox and reports why', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = respond({
      data: { p0: null, p1: null },
      errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const outbox = new Outbox(memoryStore());
    outbox.pushMany([ping(1), ping(2)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(2);
    expect(uploader.status()).toEqual({
      pending: 2,
      error: 'Not authenticated',
      lastUploadAt: null,
    });

    // And it keeps trying: the next tick re-sends the same batch.
    await uploader.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outbox.size).toBe(2);
  });

  it('drains and clears the error once the server accepts again', async () => {
    vi.stubGlobal('fetch', respond({ data: { p0: { id: 'a' }, p1: { id: 'b' } } }));

    const outbox = new Outbox(memoryStore());
    outbox.pushMany([ping(1), ping(2)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(0);
    expect(uploader.status().error).toBeNull();
    expect(uploader.status().lastUploadAt).not.toBeNull();
  });

  it('drains a batch the server recorded nothing for', async () => {
    // Idle pings: without this the outbox never gets past them, and every
    // later ping waits behind a batch that will never be accepted.
    vi.stubGlobal('fetch', respond({ data: { p0: null, p1: null } }));

    const outbox = new Outbox(memoryStore());
    outbox.pushMany([ping(1), ping(2)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(0);
    expect(uploader.status().error).toBeNull();
  });

  it('keeps the batch when the server is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const outbox = new Outbox(memoryStore());
    outbox.pushMany([ping(1)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(1);
    expect(uploader.status().error).toBe('ECONNREFUSED');
  });
});
