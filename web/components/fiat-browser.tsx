'use client';

import { fiatFlagEmoji } from '@/lib/format';
import CountBrowser from './count-browser';
import { FiatChip } from './chips';

interface Props {
  codes: string[];
  /** Optional ISO→flag emoji map (e.g. Peerlytics-sourced for zkp2p). Falls back to programmatic. */
  flags?: Record<string, string>;
  searchPlaceholder?: string;
  emptyText?: string;
}

/**
 * Thin Client-Component wrapper around CountBrowser for fiat lists. Owns the
 * function props (glyphOf / renderResult) so they don't have to cross the
 * Server→Client boundary from the caller.
 */
export default function FiatBrowser({
  codes,
  flags,
  searchPlaceholder = 'search currencies',
  emptyText = 'No matching currency',
}: Props) {
  return (
    <CountBrowser
      items={codes}
      glyphOf={(code) => flags?.[code] ?? fiatFlagEmoji(code)}
      labelOf={(code) => code}
      renderResult={(code) => <FiatChip code={code} flag={flags?.[code]} />}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
    />
  );
}
