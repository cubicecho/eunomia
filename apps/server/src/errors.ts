import { GraphQLError } from 'graphql';

// Errors the caller is meant to read. Yoga masks anything that reaches it as a
// plain Error into "Unexpected error." with code INTERNAL_SERVER_ERROR, so a
// `throw new Error('Unknown device')` in a resolver is invisible to clients and
// noisy in the server log. Only a GraphQLError survives, and only the code —
// not the wording — is a contract: agents and the dashboard branch on
// extensions.code, never on the message.
//
// Anything NOT built here stays masked on purpose: an unexpected failure is the
// server's problem and its details are not the client's business.

const withCode =
  (code: string) =>
  (message: string): GraphQLError =>
    new GraphQLError(message, { extensions: { code } });

/** Authenticated but malformed — arguments the caller can fix. */
export const badInput = withCode('BAD_USER_INPUT');

/**
 * The row does not exist, or exists but belongs to someone else. Deliberately
 * one code for both: telling them apart would leak other users' ids.
 */
export const notFound = withCode('NOT_FOUND');

/** Too many attempts; the caller should back off. */
export const rateLimited = withCode('RATE_LIMITED');

/**
 * No session, or an expired one. Clients treat this code as "sign in again" —
 * the dashboard clears its stored token, agents keep their outbox and retry.
 */
export const unauthenticated = (message = 'Not authenticated'): GraphQLError =>
  new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED' } });

/** The caller is known but not allowed to do this at all. */
export const forbidden = withCode('FORBIDDEN');
