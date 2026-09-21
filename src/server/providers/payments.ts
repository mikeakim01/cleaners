import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';

/** Payment providers supported by the financial service layer. */
export const PAYMENT_PROVIDER_IDS = [
  'cash',
  'bank_transfer',
  'mobile_money',
  'payment_link',
  'stripe',
] as const;

export type PaymentProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

export type ProviderPaymentStatus = 'PENDING' | 'CONFIRMED';

export interface RecordPaymentInput {
  tenantId: string;
  invoiceId: string;
  /** Integer minor units (cents). Must be > 0. */
  amountMinor: number;
  /** Provider reference (e.g. M-Pesa transaction code). */
  providerRef?: string;
  notes?: string;
}

export interface ProviderPaymentContext {
  userId: string;
}

export interface ProviderPaymentResult {
  providerRef: string;
  status: ProviderPaymentStatus;
}

export interface PaymentProvider {
  id: PaymentProviderId;
  label: string;
  recordPayment(
    input: RecordPaymentInput,
    ctx: ProviderPaymentContext,
  ): Promise<ProviderPaymentResult>;
}

const RecordPaymentInputSchema = z.object({
  tenantId: z.uuid('tenantId must be a valid UUID'),
  invoiceId: z.uuid('invoiceId must be a valid UUID'),
  amountMinor: z
    .number('amountMinor must be a number')
    .int('Payment amount must be a whole number of cents.')
    .positive('Payment amount must be greater than zero.'),
  providerRef: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(500).optional(),
});

const ProviderIdSchema = z.enum(PAYMENT_PROVIDER_IDS, {
  message: 'Unknown payment method. Please choose a valid payment method.',
});

/** M-Pesa transaction codes are 8–16 uppercase alphanumerics (e.g. QA12B3C4D5). */
const MPESA_REF_PATTERN = /^[A-Z0-9]{8,16}$/;

function randomSuffix(length: number): string {
  return globalThis.crypto
    .randomUUID()
    .replace(/-/g, '')
    .slice(0, length)
    .toUpperCase();
}

const cashProvider: PaymentProvider = {
  id: 'cash',
  label: 'Cash',
  async recordPayment(input) {
    return {
      providerRef: input.providerRef ?? `CASH-${randomSuffix(8)}`,
      status: 'CONFIRMED',
    };
  },
};

const bankTransferProvider: PaymentProvider = {
  id: 'bank_transfer',
  label: 'Bank transfer',
  async recordPayment(input) {
    return {
      providerRef: input.providerRef ?? `BANK-${randomSuffix(8)}`,
      status: 'CONFIRMED',
    };
  },
};

const mobileMoneyProvider: PaymentProvider = {
  id: 'mobile_money',
  label: 'Mobile money (M-Pesa)',
  async recordPayment(input) {
    const ref = (input.providerRef ?? '').trim().toUpperCase();
    if (!MPESA_REF_PATTERN.test(ref)) {
      throw new AppError(
        'Enter the M-Pesa transaction code (e.g. QA12B3C4D5).',
      );
    }
    return {
      providerRef: ref,
      status:
        process.env.MPESA_AUTO_CONFIRM === 'true' ? 'CONFIRMED' : 'PENDING',
    };
  },
};

const paymentLinkProvider: PaymentProvider = {
  id: 'payment_link',
  label: 'Payment link',
  async recordPayment() {
    return {
      providerRef: `LINK-${randomSuffix(12)}`,
      status: 'PENDING',
    };
  },
};

const stripeProvider: PaymentProvider = {
  id: 'stripe',
  label: 'Card (Stripe)',
  async recordPayment() {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError(
        'Card payments are not configured for this business yet.',
      );
    }
    // Honest stub: the key exists but no charge API is wired up, so never
    // fabricate a charge — direct the user to a supported method instead.
    throw new AppError(
      'Card payments are not available yet. Please use cash, bank transfer, or mobile money.',
    );
  },
};

export const PAYMENT_PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  cash: cashProvider,
  bank_transfer: bankTransferProvider,
  mobile_money: mobileMoneyProvider,
  payment_link: paymentLinkProvider,
  stripe: stripeProvider,
};

/**
 * Validates input and dispatches to the matching payment provider.
 * Pure except for env reads — providers never write to the database;
 * the caller (financial service) persists the payment record.
 *
 * @throws AppError with a human-readable message on invalid input or an
 *         unknown provider id.
 */
export async function recordProviderPayment(
  providerId: string,
  rawInput: RecordPaymentInput,
  ctx: ProviderPaymentContext,
): Promise<ProviderPaymentResult> {
  const parsedProvider = ProviderIdSchema.safeParse(providerId);
  if (!parsedProvider.success) {
    throw new AppError(
      'Unknown payment method. Please choose a valid payment method.',
    );
  }

  const parsedInput = RecordPaymentInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new AppError(
      parsedInput.error.issues[0]?.message ?? 'Invalid payment details.',
    );
  }

  return PAYMENT_PROVIDERS[parsedProvider.data].recordPayment(
    parsedInput.data,
    ctx,
  );
}
