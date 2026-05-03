import { cn } from '@/lib/cn';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: { box: 'h-6 w-6', logo: 16 },
  md: { box: 'h-12 w-12', logo: 32 },
  lg: { box: 'h-20 w-20', logo: 56 },
};

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const { box, logo } = sizeMap[size];
  const id = `sp-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <div
      className={cn('flex flex-col items-center gap-3', className)}
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <div className={cn('relative flex items-center justify-center', box)}>
        {/* Spinning gradient ring */}
        <svg
          className="absolute inset-0 h-full w-full animate-spin"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--theme-primary, #00f0ff)" />
              <stop offset="1" stopColor="var(--theme-accent, #10b981)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="44" stroke={`url(#${id}-ring)`} strokeWidth="6" strokeLinecap="round" />
        </svg>
        {/* Pulsing bolt logo */}
        <svg
          width={logo}
          height={logo}
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="animate-pulse"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--theme-primary, #00f0ff)" />
              <stop offset="1" stopColor="var(--theme-accent, #10b981)" />
            </linearGradient>
          </defs>
          <rect x="8" y="8" width="184" height="184" rx="40" fill={`url(#${id}-fill)`} />
          <path d="M112 30L62 108h34L78 170l58-82h-34z" fill="currentColor" className="text-white" />
        </svg>
      </div>
      {label && <span className="text-sm text-[var(--text-secondary)]">{label}</span>}
    </div>
  );
}
