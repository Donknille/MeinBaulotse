import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const plakettenStile = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium leading-5',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        kontur: 'border-border bg-transparent text-foreground',
        ruhig: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof plakettenStile>) {
  return <span className={cn(plakettenStile({ variant }), className)} {...rest} />;
}
