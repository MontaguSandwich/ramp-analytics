'use client';

import { paymentMethodLabel } from '@/lib/format';
import CountBrowser from './count-browser';
import { PaymentChip, PaymentGlyph } from './chips';

interface Props {
  methods: string[];
  searchPlaceholder?: string;
  emptyText?: string;
}

/**
 * Thin Client-Component wrapper around CountBrowser for payment-method lists.
 * Reuses the brand-logo + first-letter-fallback chip rendering from `chips.tsx`.
 */
export default function PaymentMethodBrowser({
  methods,
  searchPlaceholder = 'search methods',
  emptyText = 'No matching method',
}: Props) {
  return (
    <CountBrowser
      items={methods}
      glyphOf={(name) => <PaymentGlyph name={name} />}
      labelOf={paymentMethodLabel}
      renderResult={(name) => <PaymentChip name={name} />}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
    />
  );
}
