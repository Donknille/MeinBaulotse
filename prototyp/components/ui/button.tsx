'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Auf der Baustelle wird mit dem Daumen bedient, oft im Stehen. Die
 * Mindesthöhe von 44 Pixeln ist deshalb keine Geschmacksfrage.
 */
const knopfStile = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-55 aria-disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'min-h-11 px-4 py-2',
        sm: 'min-h-9 rounded-md px-3 text-sm',
        lg: 'min-h-12 rounded-md px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof knopfStile> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...rest }: ButtonProps) {
  const Komponente = asChild ? Slot : 'button';
  return <Komponente className={cn(knopfStile({ variant, size }), className)} {...rest} />;
}

export { knopfStile };
