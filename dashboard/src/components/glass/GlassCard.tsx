import { type ReactNode, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'inset' | 'accent';
  glow?: boolean;
  hover3d?: boolean;
  noPadding?: boolean;
}

export function GlassCard({
  children,
  variant = 'default',
  glow = false,
  hover3d = false,
  noPadding = false,
  className,
  ...props
}: GlassCardProps) {
  const variants = {
    default: 'glass-card',
    elevated: 'glass-card glass-elevated',
    inset: 'glass-card-inset',
    accent: 'glass-card glass-accent',
  };

  return (
    <div
      className={clsx(
        variants[variant],
        glow && 'glass-glow',
        hover3d && 'glass-hover-3d',
        !noPadding && 'p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function GlassPanel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={clsx('glass-panel flex flex-col', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function GlassBadge({
  children,
  variant = 'default',
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
}) {
  const colors = {
    default: 'bg-white/10 text-white/70',
    success: 'bg-emerald-500/15 text-emerald-400',
    warning: 'bg-amber-500/15 text-amber-400',
    error: 'bg-red-500/15 text-red-400',
    info: 'bg-cyan-500/15 text-cyan-400',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm',
        colors[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
