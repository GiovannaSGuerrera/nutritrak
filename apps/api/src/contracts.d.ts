import type { IncomingMessage, ServerResponse } from 'node:http';
export interface DataRecord {
  id: string;
  workspaceId?: string;
  patientId?: string;
  email?: string;
}
export interface User extends DataRecord {
  mfaPending?: { encrypted: EncryptedMessage; expiresAt: number };
  mfaSecret?: EncryptedMessage;
  mfaLastCounter?: number;
  mfaRecoveryHashes?: string[];
  name: string;
  email: string;
  salt: string;
  hash: string;
  emailVerified?: boolean;
  createdAt: string;
}
export interface AuthToken extends DataRecord {
  userId: string;
  purpose: string;
  tokenHash: string;
  expiresAt: number;
}
export interface EncryptedMessage {
  iv: string;
  tag: string;
  data: string;
}
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface MailItem extends DataRecord {
  userId?: string;
  encrypted: EncryptedMessage;
  expiresAt: number;
  attempts: number;
  nextAt: number;
}
export interface Membership extends DataRecord {
  userId: string;
  workspaceId: string;
  roles: string[];
  status: string;
}
export interface Patient extends DataRecord {
  userId: string;
}
export interface PrivacyRequest extends DataRecord {
  userId: string;
  type: string;
  status: string;
  createdAt: string;
}
export interface Store {
  users: User[];
  authTokens: AuthToken[];
  mailOutbox: MailItem[];
  privacyRequests: PrivacyRequest[];
  memberships: Membership[];
  patients: Patient[];
}
export interface Session {
  subjectId: string;
  expiresAt: number;
}
export interface AccountContext {
  req: IncomingMessage;
  res: ServerResponse;
  store: Store;
  sessions: Map<string, Session>;
  user: User | null;
  body(req: IncomingMessage): Promise<Record<string, unknown>>;
  json(res: ServerResponse, status: number, body: object): void;
  persist(): Promise<void>;
  audit(userId: string, action: string, type: string, id: string): void;
}
