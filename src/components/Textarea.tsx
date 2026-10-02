// Tremor Raw Textarea [v0.0.1]

import React from 'react';

import { cx, focusInput, hasErrorInput } from '@/lib/utils';

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, hasError, ...props }: TextareaProps, forwardedRef) => {
    return (
      <textarea
        ref={forwardedRef}
        className={cx(
          // base
          'flex min-h-[4rem] w-full rounded-md border px-2.5 py-1.5 shadow-sm outline-none transition sm:text-sm',
          // text color
          'text-gray-900 dark:text-gray-50',
          // border color
          'border-gray-300 dark:border-gray-800',
          // background color
          'bg-white dark:bg-gray-950',
          // placeholder color
          'placeholder-gray-400 dark:placeholder-gray-500',
          // disabled
          'disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400',
          'disabled:dark:border-gray-700 disabled:dark:bg-gray-800 disabled:dark:text-gray-500',
          // focus
          focusInput,
          // error
          hasError ? hasErrorInput : '',
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = 'Textarea';

export { Textarea, type TextareaProps };
