'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...rest }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-sm font-medium', className)} {...rest} />;
}
