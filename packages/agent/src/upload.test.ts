import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphQLRequestError } from './api.ts';
import { createTokenSource } from './credential.ts';
import { memoryLogStore } from './memory-store.ts';
import { Outbox } from './outbox.ts';
import type { Ping } from './ping.ts';
import { classifyFailure, createUploader, type UploadTarget } from './upload.ts';

// A GraphQL server answers 200 with the error in the body, so "the request
// succeeded" says nothing about whether the pings landed. Getting this wrong
// silently discarded every ping a refused agent uploaded.

const ping = (n: number): Ping => ({
  capturedAt: new Date(n).toISOString(),
  app: `app${n}`,
  title: null,
  context: null,
  idleSeconds: 0,
});

const config: UploadTarget = {
  serverUrl: 'http://server.test',
  deviceId: 'dev_1',
  tokens: createTokenSource({ kind: 'session', token: 'session' }),
};

describe('classifyFailure', () => {
  it('keeps a batch the server refused, and says to sign in again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      classifyFailure(new GraphQLRequestError('Not authenticated', 'UNAUTHENTICATED')),
    ).toEqual({
      accepted: false,
      error: 'Signed out. Open setup and sign in again.',
      signedOut: true,
    });
  });

  it('drops a batch that is unfixably malformed', () => {
    // Otherwise one bad ping wedges the outbox forever.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      classifyFailure(new GraphQLRequestError('Invalid capturedAt', 'BAD_USER_INPUT')),
    ).toEqual({ accepted: true, error: null });
  });

  it('keeps a batch whose failure it cannot classify', () => {
    // Unknown code, older server, anything unexpected: an outbox that grows is
    // recoverable, a dropped ping is not.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(classifyFailure(new GraphQLRequestError('weird'))).toEqual({
      accepted: false,
      error: 'weird',
    });
  });

  it('keeps a batch the transport never delivered', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(classifyFailure(new Error('ECONNREFUSED'))).toEqual({
      accepted: false,
      error: 'ECONNREFUSED',
    });
  });
});

describe('createUploader', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The `init` parameter is unused but typed: it is what makes
  // fetchMock.mock.calls[n][1].body readable without a cast.
  const respond = (body: unknown) =>
    vi.fn(
      async (_url: unknown, _init: { body: string; headers: Record<string, string> }) =>
        new Response(JSON.stringify(body), { status: 200 }),
    );

  it('leaves rejected pings in the outbox and reports why', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = respond({
      data: null,
      errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const outbox = new Outbox(memoryLogStore());
    outbox.pushMany([ping(1), ping(2)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(2);
    expect(uploader.status()).toEqual({
      pending: 2,
      error: 'Signed out. Open setup and sign in again.',
      lastUploadAt: null,
      signedOut: true,
    });

    // And it keeps trying: the next tick re-sends the same batch.
    await uploader.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outbox.size).toBe(2);
  });

  it('sends the whole batch as one recordPings call', async () => {
    const fetchMock = respond({ data: { recordPings: 2 } });
    vi.stubGlobal('fetch', fetchMock);

    const outbox = new Outbox(memoryLogStore());
    outbox.pushMany([ping(1), ping(2)]);
    await createUploader(config, outbox).flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.query).toContain('recordPings');
    expect(body.variables).toEqual({ deviceId: 'dev_1', pings: [ping(1), ping(2)] });
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer session');
    expect(outbox.size).toBe(0);
  });

  it('drains and clears the error once the server accepts again', async () => {
    vi.stubGlobal('fetch', respond({ data: { recordPings: 2 } }));

    const outbox = new Outbox(memoryLogStore());
    outbox.pushMany([ping(1), ping(2)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(0);
    expect(uploader.status().error).toBeNull();
    expect(uploader.status().lastUploadAt).not.toBeNull();
  });

  it('drains a batch the server recorded nothing for', async () => {
    // A batch of idle pings folds into nothing and comes back 0 — an hour away
    // from the keyboard, not a failure. Reading it as one wedged the outbox:
    // the same batch went up forever and everything queued behind it.
    vi.stubGlobal('fetch', respond({ data: { recordPings: 0 } }));

    const outbox = new Outbox(memoryLogStore());
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

    const outbox = new Outbox(memoryLogStore());
    outbox.pushMany([ping(1)]);
    const uploader = createUploader(config, outbox);
    await uploader.flush();

    expect(outbox.size).toBe(1);
    expect(uploader.status().error).toBe('ECONNREFUSED');
  });
});
