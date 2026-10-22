import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong disabled:bg-accent/50',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas disabled:text-muted',
  ghost: 'text-ink hover:bg-black/5 disabled:text-muted',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50',
};
const SIZES: Record<Size, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}
