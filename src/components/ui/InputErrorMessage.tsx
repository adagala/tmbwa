import { cx } from '@/lib/utils';
import React from 'react';

interface InputErrorMessageProps extends React.ComponentPropsWithoutRef<'div'> {
  message?: string;
}

const InputErrorMessage = React.forwardRef<
  HTMLDivElement,
  InputErrorMessageProps
>(({ message, className, ...props }: InputErrorMessageProps, ref) => {
  return (
    <>
      {message ? (
        <div
          className={cx('text-xs text-red-500 dark:text-red-500', className)}
          {...props}
          ref={ref}
        >
          {message}
        </div>
      ) : null}
    </>
  );
});

InputErrorMessage.displayName = 'InputErrorMessage';

export { InputErrorMessage };
