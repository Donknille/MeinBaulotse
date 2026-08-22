import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...rest }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}
