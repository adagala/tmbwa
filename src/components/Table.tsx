// Tremor Table [v1.0.0]
// Source: https://www.tremor.so/docs/ui/table (accessed 2026-08-20)
import React from 'react';
import { cx } from '@/lib/utils';

const TableRoot = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div ref={ref}>
    <div
      className={cx('w-full overflow-auto whitespace-nowrap', className)}
      {...props}
    >
      {children}
    </div>
  </div>
));
TableRoot.displayName = 'TableRoot';
const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    tremor-id="tremor-raw"
    className={cx(
      'w-full caption-bottom border-b border-gray-200 dark:border-gray-800',
      className,
    )}
    {...props}
  />
));
Table.displayName = 'Table';
const TableHead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <thead ref={ref} {...props} />);
TableHead.displayName = 'TableHead';
const TableHeaderCell = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cx(
      'border-b border-gray-200 px-4 py-3.5 text-left text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-50',
      className,
    )}
    {...props}
  />
));
TableHeaderCell.displayName = 'TableHeaderCell';
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cx('divide-y divide-gray-200 dark:divide-gray-800', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';
const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cx(
      '[&_td:last-child]:pr-4 [&_th:last-child]:pr-4 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';
const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cx('p-4 text-sm text-gray-600 dark:text-gray-400', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';
const TableFoot = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cx(
      'border-t border-gray-200 text-left font-medium text-gray-900 dark:border-gray-800 dark:text-gray-50',
      className,
    )}
    {...props}
  />
));
TableFoot.displayName = 'TableFoot';
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cx('mt-3 px-3 text-center text-sm text-gray-500', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRoot,
  TableRow,
};
