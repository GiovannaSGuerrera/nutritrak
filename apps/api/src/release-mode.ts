// Explicit operator choice; an omitted setting preserves the verified-email release.
export function emailEnabled() {
  return process.env.EMAIL_ENABLED !== 'false';
}
export function verificationRequired() {
  return process.env.NODE_ENV === 'production' && emailEnabled();
}
export function legalDocumentsRequired() {
  return process.env.LEGAL_DOCUMENTS_REQUIRED !== 'false';
}
