'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface Props {
  /** Visible options list. */
  options: string[];
  /** Currently selected option identifiers (must be a subset of `options`). */
  selected: string[];
  /** Called with the new selection on every change. */
  onChange: (next: string[]) => void;
  /** Text shown in the trigger when nothing is selected. */
  placeholder?: string;
  /** Show the in-panel search input when options.length exceeds this. Default 20. */
  searchThreshold?: number;
  /** Max-height (px) of the scrollable list inside the dropdown panel. Default 280. */
  maxListHeight?: number;
}

/**
 * Multi-select dropdown matching the visual pattern Binance uses on its C2C page:
 * a compact pill that summarizes the current selection, expanding on click to a
 * panel with a scrollable list of checkbox-style options.
 *
 * Visual states:
 *   - 0 selected:   shows `placeholder` text
 *   - 1-2 selected: shows the names joined by ", "
 *   - 3+ selected:  shows "{N} selected"
 *
 * The panel renders a search input above the list when options.length > searchThreshold,
 * so short pools (e.g. TND, 13 methods) skip the search box and long pools (e.g. USD, 174)
 * get it automatically.
 *
 * Accessibility: trigger is `role="combobox"`, panel is `role="listbox"` with each
 * row `role="option"`. Closes on outside click and on ESC.
 */
export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = 'All',
  searchThreshold = 20,
  maxListHeight = 280,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerId = useId();
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Mousedown (not click) so we fire before any focus shift
  // inside the panel triggers unwanted state.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on ESC.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reset search when the panel closes — prevents stale query state on re-open.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const showSearch = options.length > searchThreshold;

  const triggerText =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.join(', ')
        : `${selected.length} selected`;

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="msd-wrap" ref={wrapperRef}>
      <button
        type="button"
        id={triggerId}
        className={`msd-trigger${selected.length > 0 ? ' msd-trigger-active' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="msd-trigger-text">{triggerText}</span>
        <span className="msd-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="msd-panel" id={listboxId} role="listbox" aria-multiselectable="true">
          {showSearch ? (
            <input
              type="text"
              className="msd-search"
              placeholder={`Search ${options.length} options…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Autofocus only when we render the search — long pools.
              autoFocus
            />
          ) : null}
          <div className="msd-list" style={{ maxHeight: maxListHeight }}>
            {filteredOptions.length === 0 ? (
              <div className="msd-empty muted">No matches</div>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={`msd-option${checked ? ' msd-option-checked' : ''}`}
                    onClick={() => toggle(opt)}
                  >
                    <span className="msd-check" aria-hidden="true">
                      {checked ? '✓' : ''}
                    </span>
                    <span className="msd-option-label">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 ? (
            <button type="button" className="msd-clear" onClick={() => onChange([])}>
              Clear ({selected.length})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
