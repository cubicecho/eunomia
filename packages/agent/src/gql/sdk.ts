/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
class DocumentString extends String {}
/**
 * Runtime value is a String subclass; typed as `string` so the document
 * constants below flow into the string-typed Requester.
 */
const TypedDocumentString = DocumentString as unknown as new (value: string) => string;

/** A stateless report of what a device looked like at one instant. */
export type PingInput = {
  app?: string | null | undefined;
  capturedAt: string;
  context?: string | null | undefined;
  idleSeconds: number;
  title?: string | null | undefined;
};

export type RecordPingsMutationVariables = Exact<{
  pings: Array<PingInput> | PingInput;
}>;


export type RecordPingsMutation = { recordPings: number };

export type RequestMagicLinkMutationVariables = Exact<{
  email: string;
}>;


export type RequestMagicLinkMutation = { requestMagicLink: { token: string | null } };

export type VerifyMagicLinkMutationVariables = Exact<{
  token: string;
}>;


export type VerifyMagicLinkMutation = { verifyMagicLink: { token: string } };

export type RegisterDeviceMutationVariables = Exact<{
  name: string;
  platform: string;
}>;


export type RegisterDeviceMutation = { registerDevice: { apiKey: string, device: { id: string } } };

export type RotateDeviceKeyMutationVariables = Exact<{
  id: string;
}>;


export type RotateDeviceKeyMutation = { rotateDeviceKey: { apiKey: string, device: { id: string } } };

export type RenameDeviceMutationVariables = Exact<{
  id: string;
  name: string;
}>;


export type RenameDeviceMutation = { renameDevice: { id: string, name: string } };

export type SignOutMutationVariables = Exact<{ [key: string]: never; }>;


export type SignOutMutation = { signOut: boolean };

export type SessionFromDeviceKeyMutationVariables = Exact<{ [key: string]: never; }>;


export type SessionFromDeviceKeyMutation = { sessionFromDeviceKey: { token: string, userId: string } };


export const RecordPingsDocument = new TypedDocumentString(`
    mutation RecordPings($pings: [PingInput!]!) {
  recordPings(pings: $pings)
}
    `);
export const RequestMagicLinkDocument = new TypedDocumentString(`
    mutation RequestMagicLink($email: String!) {
  requestMagicLink(email: $email) {
    token
  }
}
    `);
export const VerifyMagicLinkDocument = new TypedDocumentString(`
    mutation VerifyMagicLink($token: String!) {
  verifyMagicLink(token: $token) {
    token
  }
}
    `);
export const RegisterDeviceDocument = new TypedDocumentString(`
    mutation RegisterDevice($name: String!, $platform: String!) {
  registerDevice(name: $name, platform: $platform) {
    device {
      id
    }
    apiKey
  }
}
    `);
export const RotateDeviceKeyDocument = new TypedDocumentString(`
    mutation RotateDeviceKey($id: String!) {
  rotateDeviceKey(id: $id) {
    device {
      id
    }
    apiKey
  }
}
    `);
export const RenameDeviceDocument = new TypedDocumentString(`
    mutation RenameDevice($id: String!, $name: String!) {
  renameDevice(id: $id, name: $name) {
    id
    name
  }
}
    `);
export const SignOutDocument = new TypedDocumentString(`
    mutation SignOut {
  signOut
}
    `);
export const SessionFromDeviceKeyDocument = new TypedDocumentString(`
    mutation SessionFromDeviceKey {
  sessionFromDeviceKey {
    token
    userId
  }
}
    `);
export type Requester<C = {}> = <R, V>(doc: string, vars?: V, options?: C) => Promise<R> | AsyncIterable<R>
export function getSdk<C>(requester: Requester<C>) {
  return {
    RecordPings(variables: RecordPingsMutationVariables, options?: C): Promise<RecordPingsMutation> {
      return requester<RecordPingsMutation, RecordPingsMutationVariables>(RecordPingsDocument, variables, options) as Promise<RecordPingsMutation>;
    },
    RequestMagicLink(variables: RequestMagicLinkMutationVariables, options?: C): Promise<RequestMagicLinkMutation> {
      return requester<RequestMagicLinkMutation, RequestMagicLinkMutationVariables>(RequestMagicLinkDocument, variables, options) as Promise<RequestMagicLinkMutation>;
    },
    VerifyMagicLink(variables: VerifyMagicLinkMutationVariables, options?: C): Promise<VerifyMagicLinkMutation> {
      return requester<VerifyMagicLinkMutation, VerifyMagicLinkMutationVariables>(VerifyMagicLinkDocument, variables, options) as Promise<VerifyMagicLinkMutation>;
    },
    RegisterDevice(variables: RegisterDeviceMutationVariables, options?: C): Promise<RegisterDeviceMutation> {
      return requester<RegisterDeviceMutation, RegisterDeviceMutationVariables>(RegisterDeviceDocument, variables, options) as Promise<RegisterDeviceMutation>;
    },
    RotateDeviceKey(variables: RotateDeviceKeyMutationVariables, options?: C): Promise<RotateDeviceKeyMutation> {
      return requester<RotateDeviceKeyMutation, RotateDeviceKeyMutationVariables>(RotateDeviceKeyDocument, variables, options) as Promise<RotateDeviceKeyMutation>;
    },
    RenameDevice(variables: RenameDeviceMutationVariables, options?: C): Promise<RenameDeviceMutation> {
      return requester<RenameDeviceMutation, RenameDeviceMutationVariables>(RenameDeviceDocument, variables, options) as Promise<RenameDeviceMutation>;
    },
    SignOut(variables?: SignOutMutationVariables, options?: C): Promise<SignOutMutation> {
      return requester<SignOutMutation, SignOutMutationVariables>(SignOutDocument, variables, options) as Promise<SignOutMutation>;
    },
    SessionFromDeviceKey(variables?: SessionFromDeviceKeyMutationVariables, options?: C): Promise<SessionFromDeviceKeyMutation> {
      return requester<SessionFromDeviceKeyMutation, SessionFromDeviceKeyMutationVariables>(SessionFromDeviceKeyDocument, variables, options) as Promise<SessionFromDeviceKeyMutation>;
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;