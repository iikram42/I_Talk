import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { inputClass } from './ui/Field';

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  available: boolean;
}

interface Props {
  id: string;
  value: string;
  onChange: (code: string) => void;
  options: LanguageOption[];
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

function label(o: LanguageOption) {
  return o.nativeName === o.name ? o.name : `${o.name} · ${o.nativeName}`;
}

/** Searchable language picker following the ARIA combobox pattern. */
export function LanguageSelect({ id, value, onChange, options, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.code === value);
  const listId = `${id}-list`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => [o.name, o.nativeName, o.code].some((s) => s.toLowerCase().includes(q)));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const index = filtered.findIndex((o) => o.code === value);
    setActive(index >= 0 ? index : 0);
  }, [open, filtered, value]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function choose(option: LanguageOption | undefined) {
    if (!option || !option.available) return;
    onChange(option.code);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (filtered.length ? (i + step + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active].code}` : undefined}
        autoComplete="off"
        className={`${inputClass} pr-9`}
        value={open ? query : selected ? label(selected) : ''}
        placeholder={open && selected ? label(selected) : 'Search languages'}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        {...aria}
      />
      <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Languages"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching languages</li>}
          {filtered.map((o, i) => (
            <li
              key={o.code}
              id={`${listId}-${o.code}`}
              data-index={i}
              role="option"
              aria-selected={o.code === value}
              aria-disabled={!o.available || undefined}
              // Prevent the input from blurring before the click registers.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? 'bg-accent-soft' : ''
              } ${o.available ? 'text-ink' : 'cursor-not-allowed text-muted'}`}
            >
              <span>{label(o)}</span>
              <span className="text-xs text-muted">{o.available ? o.code : 'Unavailable'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
