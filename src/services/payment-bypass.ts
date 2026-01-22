/**
 * Payment Bypass
 * Permite cobrar R$ 1,00 para emails de teste definidos.
 */

const DEFAULT_BYPASS_EMAILS = ["guiduck02@gmail.com"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getBypassEmails(): string[] {
  const raw = process.env.PAYMENTS_BYPASS_EMAILS;
  if (!raw) {
    return DEFAULT_BYPASS_EMAILS;
  }

  return raw
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

/**
 * Resolve o valor a cobrar considerando o bypass.
 */
export function resolvePaymentAmount(
  originalAmount: number,
  email: string
): { amount: number; bypassApplied: boolean; originalAmount: number } {
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return { amount: originalAmount, bypassApplied: false, originalAmount };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { amount: originalAmount, bypassApplied: false, originalAmount };
  }

  const bypassEmails = getBypassEmails();
  if (!bypassEmails.includes(normalizedEmail)) {
    return { amount: originalAmount, bypassApplied: false, originalAmount };
  }

  return { amount: 1, bypassApplied: true, originalAmount };
}
