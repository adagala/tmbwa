import * as React from 'react';
import * as PopoverPrimitives from '@radix-ui/react-popover';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendar2Fill,
} from '@remixicon/react';

import { cx } from '@/lib/utils';

import { Button } from './Button';

const MONTH_VALUE_PATTERN = /^(\d{4})-(\d{2})$/;
const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en-KE', { month: 'short' }).format(
    new Date(2000, month, 1),
  ),
);

const yearFromValue = (value: string | undefined) => {
  const match = value?.match(MONTH_VALUE_PATTERN);
  return match ? Number(match[1]) : undefined;
};

const formatMonth = (value: string) => {
  const match = value.match(MONTH_VALUE_PATTERN);
  if (!match) return value;
  return new Intl.DateTimeFormat('en-KE', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
};

interface MonthPickerProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  fromMonth?: string;
  toMonth?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  align?: 'start' | 'center' | 'end';
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

const MonthPicker = ({
  id,
  value = '',
  onChange,
  fromMonth,
  toMonth,
  placeholder = 'Select month',
  disabled,
  className,
  align = 'start',
  ...ariaProps
}: MonthPickerProps) => {
  const [open, setOpen] = React.useState(false);
  const minimumYear = yearFromValue(fromMonth);
  const maximumYear = yearFromValue(toMonth);
  const initialYear =
    yearFromValue(value) ??
    minimumYear ??
    maximumYear ??
    new Date().getFullYear();
  const [year, setYear] = React.useState(initialYear);

  React.useEffect(() => {
    const nextYear = yearFromValue(value);
    if (nextYear !== undefined) setYear(nextYear);
  }, [value]);

  React.useEffect(() => {
    setYear((current) =>
      Math.min(
        Math.max(current, minimumYear ?? current),
        maximumYear ?? current,
      ),
    );
  }, [minimumYear, maximumYear]);

  const selectMonth = (month: number) => {
    const nextValue = `${year}-${String(month + 1).padStart(2, '0')}`;
    onChange?.(nextValue);
    setOpen(false);
  };

  return (
    <PopoverPrimitives.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitives.Trigger asChild>
        <Button
          id={id}
          type="button"
          variant="secondary"
          disabled={disabled}
          className={cx(
            'w-full justify-start gap-2 px-3 py-2 font-normal',
            className,
          )}
          {...ariaProps}
        >
          <RiCalendar2Fill
            className="size-5 shrink-0 text-gray-400 dark:text-gray-600"
            aria-hidden="true"
          />
          <span
            className={cx('truncate', {
              'text-gray-400 dark:text-gray-600': !value,
            })}
          >
            {value ? formatMonth(value) : placeholder}
          </span>
        </Button>
      </PopoverPrimitives.Trigger>
      <PopoverPrimitives.Portal>
        <PopoverPrimitives.Content
          sideOffset={10}
          align={align}
          avoidCollisions
          className={cx(
            'relative z-50 w-72 rounded-md border border-gray-300 bg-white p-3 text-sm shadow-xl shadow-black/[2.5%]',
            'dark:border-gray-800 dark:bg-gray-950',
            'data-[state=closed]:animate-hide data-[state=open]:data-[side=bottom]:animate-slideDownAndFade',
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              className="size-8 p-0"
              aria-label="Previous year"
              disabled={minimumYear !== undefined && year <= minimumYear}
              onClick={() => setYear((current) => current - 1)}
            >
              <RiArrowLeftSLine className="size-5" aria-hidden="true" />
            </Button>
            <p className="font-semibold text-gray-900 dark:text-gray-50">
              {year}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="size-8 p-0"
              aria-label="Next year"
              disabled={maximumYear !== undefined && year >= maximumYear}
              onClick={() => setYear((current) => current + 1)}
            >
              <RiArrowRightSLine className="size-5" aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2" role="grid">
            {MONTHS.map((label, month) => {
              const monthValue = `${year}-${String(month + 1).padStart(2, '0')}`;
              const isSelected = monthValue === value;
              const isDisabled =
                (fromMonth !== undefined && monthValue < fromMonth) ||
                (toMonth !== undefined && monthValue > toMonth);

              return (
                <Button
                  key={monthValue}
                  type="button"
                  variant={isSelected ? 'primary' : 'ghost'}
                  className="h-9 px-2 shadow-none"
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  onClick={() => selectMonth(month)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {value ? (
            <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800">
              <Button
                type="button"
                variant="secondary"
                className="h-8 w-full"
                onClick={() => {
                  onChange?.('');
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverPrimitives.Content>
      </PopoverPrimitives.Portal>
    </PopoverPrimitives.Root>
  );
};

MonthPicker.displayName = 'MonthPicker';

export { MonthPicker, type MonthPickerProps };
