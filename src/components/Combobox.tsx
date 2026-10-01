// Combobox — searchable single select.
// Tremor Raw ships no combobox; this follows the WAI-ARIA combobox pattern on
// Radix Popover and reuses the Tremor Raw Select trigger and item styling.

import * as PopoverPrimitives from '@radix-ui/react-popover';
import { RiArrowDownSLine, RiCheckLine, RiSearchLine } from '@remixicon/react';
import React from 'react';

import { cx, focusInput } from '@/lib/utils';

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
};

export const defaultComboboxFilter = (
  option: ComboboxOption,
  query: string,
) => {
  const haystack = [
    option.label,
    option.description,
    ...(option.keywords ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

interface ComboboxProps {
  id?: string;
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  filter?: (option: ComboboxOption, query: string) => boolean;
  'aria-label'?: string;
}

const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      id,
      options,
      value,
      onValueChange,
      placeholder = 'Select',
      searchPlaceholder = 'Search',
      emptyMessage = 'No matches.',
      disabled,
      className,
      filter = defaultComboboxFilter,
      'aria-label': ariaLabel,
    },
    forwardedRef,
  ) => {
    const listId = React.useId();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);
    const listRef = React.useRef<HTMLDivElement>(null);

    const selected = options.find((option) => option.value === value);
    const filtered = React.useMemo(
      () =>
        query.trim()
          ? options.filter((option) => filter(option, query.trim()))
          : options,
      [filter, options, query],
    );

    const changeOpen = (next: boolean) => {
      setOpen(next);
      if (next) {
        setQuery('');
        setActiveIndex(
          Math.max(
            0,
            options.findIndex((option) => option.value === value),
          ),
        );
      }
    };

    const choose = (option: ComboboxOption | undefined) => {
      if (!option || option.disabled) return;
      onValueChange(option.value);
      setOpen(false);
    };

    React.useEffect(() => {
      if (!open) return;
      listRef.current
        ?.querySelector(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open]);

    const move = (step: number) => {
      if (!filtered.length) return;
      let next = activeIndex;
      for (let tries = 0; tries < filtered.length; tries += 1) {
        next = (next + step + filtered.length) % filtered.length;
        if (!filtered[next].disabled) break;
      }
      setActiveIndex(next);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(Math.max(0, filtered.length - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(filtered[activeIndex]);
      }
    };

    const optionId = (index: number) => `${listId}-option-${index}`;

    return (
      <PopoverPrimitives.Root open={open} onOpenChange={changeOpen}>
        <PopoverPrimitives.Trigger asChild disabled={disabled}>
          <button
            ref={forwardedRef}
            id={id}
            type="button"
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            data-placeholder={selected ? undefined : ''}
            className={cx(
              'group/trigger flex w-full select-none items-center justify-between gap-x-2 truncate rounded-md border px-3 py-1.5 text-left text-base shadow-sm outline-none transition sm:text-sm',
              'border-gray-300 dark:border-gray-800',
              'text-gray-900 dark:text-gray-50',
              'data-[placeholder]:text-gray-400 data-[placeholder]:dark:text-gray-500',
              'bg-white dark:bg-gray-950',
              'hover:bg-gray-50 hover:dark:bg-gray-950/50',
              'disabled:bg-gray-100 disabled:text-gray-400',
              'disabled:dark:border-gray-700 disabled:dark:bg-gray-800 disabled:dark:text-gray-500',
              focusInput,
              className,
            )}
          >
            <span className="truncate">{selected?.label ?? placeholder}</span>
            <RiArrowDownSLine
              aria-hidden="true"
              className="-mr-1 size-5 shrink-0 text-gray-400 group-disabled/trigger:text-gray-300 dark:text-gray-600"
            />
          </button>
        </PopoverPrimitives.Trigger>
        <PopoverPrimitives.Portal>
          <PopoverPrimitives.Content
            sideOffset={8}
            align="start"
            collisionPadding={10}
            className={cx(
              'relative z-50 overflow-hidden rounded-md border shadow-xl shadow-black/[2.5%]',
              'w-[var(--radix-popover-trigger-width)] min-w-56 max-w-[95vw]',
              'bg-white dark:bg-gray-950',
              'text-gray-900 dark:text-gray-50',
              'border-gray-200 dark:border-gray-800',
              'will-change-[transform,opacity]',
              'data-[state=closed]:animate-hide',
              'data-[side=bottom]:animate-slideDownAndFade data-[side=top]:animate-slideUpAndFade',
            )}
          >
            <div className="flex items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
              <RiSearchLine
                aria-hidden="true"
                className="size-4 shrink-0 text-gray-400 dark:text-gray-600"
              />
              <input
                type="text"
                role="combobox"
                autoComplete="off"
                aria-label={searchPlaceholder}
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  filtered[activeIndex] ? optionId(activeIndex) : undefined
                }
                value={query}
                placeholder={searchPlaceholder}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                className="h-10 w-full border-0 bg-transparent px-0 text-base shadow-none focus:outline-none focus:ring-0 text-gray-900 outline-none placeholder:text-gray-400 sm:text-sm dark:text-gray-50 dark:placeholder:text-gray-500"
              />
            </div>
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel ?? placeholder}
              className="max-h-72 overflow-y-auto p-1"
            >
              {filtered.length ? (
                filtered.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    <div
                      key={option.value}
                      id={optionId(index)}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onMouseMove={() =>
                        !option.disabled && setActiveIndex(index)
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(option)}
                      className={cx(
                        'grid cursor-pointer grid-cols-[1fr_20px] gap-x-2 rounded px-3 py-2 sm:text-sm',
                        'text-gray-900 dark:text-gray-50',
                        index === activeIndex && 'bg-gray-100 dark:bg-gray-900',
                        isSelected && 'font-semibold',
                        option.disabled &&
                          'pointer-events-none text-gray-400 dark:text-gray-600',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs font-normal text-gray-500 dark:text-gray-400">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <RiCheckLine
                          aria-hidden="true"
                          className="size-5 shrink-0 text-gray-800 dark:text-gray-200"
                        />
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  {emptyMessage}
                </p>
              )}
            </div>
          </PopoverPrimitives.Content>
        </PopoverPrimitives.Portal>
      </PopoverPrimitives.Root>
    );
  },
);

Combobox.displayName = 'Combobox';

export { Combobox, type ComboboxProps };
