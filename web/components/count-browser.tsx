'use client';

import { useMemo, useState, type ReactNode } from 'react';

interface CountBrowserProps<T> {
  /** Items to summarize. Item count determines the badge number. */
  items: T[];
  /**
   * Small visual representation for the popover grid — emoji string or a JSX node
   * (e.g. a logo `<img>`). The glyph appears alone in the popover (no labels).
   */
  glyphOf: (item: T) => ReactNode;
  /** Lowercase substring matching key for the search input. */
  labelOf: (item: T) => string;
  /**
   * Optional rich rendering for search-result rows. Defaults to glyph + label.
   * Use this to pass a fully-styled chip (FiatChip, PaymentChip, etc.) per match.
   */
  renderResult?: (item: T) => ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Max search results shown inline before "…+N more" is rendered. */
  maxResults?: number;
}

const DEFAULT_MAX_RESULTS = 20;

/**
 * Compact "count + browse + search" affordance for collections that are too long to
 * render as a flat chip grid (binance_p2p coverage has 99 fiats and 733 payment methods).
 *
 * UX:
 *   - Always visible: count badge + info button + search input
 *   - Click the info button: reveal a glyph-only grid below (flags / logos, no labels)
 *   - Type in the search input: replace the grid with filtered result chips
 *   - Cleared search: grid returns (if the info toggle is still open)
 *
 * Modular by design — the same component handles fiats (flag emoji glyphs), payment
 * methods (brand logo glyphs), settlement assets (crypto logo glyphs), or anything else
 * with a small visual + searchable label. Caller controls per-item rendering via
 * `glyphOf` / `renderResult`.
 */
export default function CountBrowser<T>({
  items,
  glyphOf,
  labelOf,
  renderResult,
  searchPlaceholder = 'search…',
  emptyText = 'No matches',
  maxResults = DEFAULT_MAX_RESULTS,
}: CountBrowserProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((it) => labelOf(it).toLowerCase().includes(q));
  }, [items, query, labelOf]);

  const isEmpty = items.length === 0;
  const showSearchResults = query.trim().length > 0;
  // When the user is typing, the search results are the primary content — hide the
  // glyph grid so we don't fight over screen real estate.
  const showGridPopover = open && !showSearchResults;

  return (
    <div className="count-browser">
      <div className="count-browser-row">
        <span className="count-browser-count">{items.length}</span>
        <button
          type="button"
          className={`count-browser-info${open ? ' count-browser-info-active' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Show all ${items.length} items`}
          disabled={isEmpty}
        >
          ⓘ
        </button>
        <input
          type="text"
          className="count-browser-search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isEmpty}
          aria-label={searchPlaceholder}
        />
      </div>

      {showGridPopover ? (
        <div className="count-browser-popover" role="region" aria-label="All items">
          <div className="count-browser-glyphs">
            {items.map((it, i) => (
              <span key={i} className="count-browser-glyph">
                {glyphOf(it)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showSearchResults ? (
        filtered.length > 0 ? (
          <div className="count-browser-results" role="region" aria-label="Search results">
            {filtered.slice(0, maxResults).map((it, i) => (
              <div key={i} className="count-browser-result">
                {renderResult ? (
                  renderResult(it)
                ) : (
                  <>
                    <span className="count-browser-result-glyph">{glyphOf(it)}</span>
                    <span>{labelOf(it)}</span>
                  </>
                )}
              </div>
            ))}
            {filtered.length > maxResults ? (
              <div className="count-browser-empty muted">
                …+{filtered.length - maxResults} more matches
              </div>
            ) : null}
          </div>
        ) : (
          <div className="count-browser-empty muted">{emptyText}</div>
        )
      ) : null}
    </div>
  );
}
