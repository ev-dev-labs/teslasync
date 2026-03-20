interface LogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
}

export default function Logo({ size = 32, showWordmark = false, className = '' }: LogoProps) {
  const id = `logo-${size}`

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative">
        {/* Glow backdrop */}
        <div
          className="absolute inset-0 rounded-lg blur-md opacity-40 animate-logo-pulse"
          style={{ background: 'var(--theme-primary)' }}
        />
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative"
        >
          <defs>
            {/* Neon glow filter */}
            <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id={`${id}-glow-strong`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            {/* Gradient using theme color */}
            <linearGradient id={`${id}-grad`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="var(--theme-primary)" />
              <stop offset="100%" stopColor="var(--theme-accent)" />
            </linearGradient>
          </defs>

          {/* Background hexagonal shape */}
          <rect
            x="1" y="1" width="30" height="30" rx="6"
            fill="var(--surface-1)"
            stroke="var(--theme-primary)"
            strokeWidth="0.75"
            strokeOpacity="0.3"
          />

          {/* Circuit traces - decorative tech lines */}
          <g stroke="var(--theme-primary)" strokeWidth="0.5" strokeOpacity="0.25">
            {/* Top left corner circuit */}
            <path d="M4 1 L4 4 L1 4" />
            <circle cx="4" cy="4" r="0.75" fill="var(--theme-primary)" fillOpacity="0.3" />
            {/* Top right corner circuit */}
            <path d="M28 1 L28 4 L31 4" />
            <circle cx="28" cy="4" r="0.75" fill="var(--theme-primary)" fillOpacity="0.3" />
            {/* Bottom left corner circuit */}
            <path d="M4 31 L4 28 L1 28" />
            <circle cx="4" cy="28" r="0.75" fill="var(--theme-primary)" fillOpacity="0.3" />
            {/* Bottom right corner circuit */}
            <path d="M28 31 L28 28 L31 28" />
            <circle cx="28" cy="28" r="0.75" fill="var(--theme-primary)" fillOpacity="0.3" />
            {/* Horizontal trace lines */}
            <path d="M7 8 L10 8" />
            <path d="M22 24 L25 24" />
          </g>

          {/* Stylized "TS" monogram with lightning aesthetic */}
          <g filter={`url(#${id}-glow)`}>
            {/* T - top bar */}
            <path
              d="M8 9 L24 9"
              stroke={`url(#${id}-grad)`}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* T - vertical stroke (shifts right to merge with S) */}
            <path
              d="M16 9 L16 16"
              stroke={`url(#${id}-grad)`}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* S - flowing from T's stem with lightning bolt energy */}
            <path
              d="M22 14 L12 14 L12 17.5 L22 17.5 L22 21 L10 21"
              stroke={`url(#${id}-grad)`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* Lightning accent bolt - small energy spark */}
          <g filter={`url(#${id}-glow-strong)`}>
            <path
              d="M24 12 L26 10 L25 13.5 L27 11.5"
              stroke="var(--theme-primary)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity="0.7"
            />
          </g>

          {/* Bottom data stream dots */}
          <g fill="var(--theme-primary)">
            <circle cx="10" cy="26" r="0.75" opacity="0.6" />
            <circle cx="13" cy="26" r="0.75" opacity="0.4" />
            <circle cx="16" cy="26" r="0.75" opacity="0.8" />
            <circle cx="19" cy="26" r="0.75" opacity="0.4" />
            <circle cx="22" cy="26" r="0.75" opacity="0.6" />
          </g>
        </svg>
      </div>

      {showWordmark && (
        <div className="flex flex-col">
          <span
            className="text-lg font-bold tracking-tight leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            TeslaSync
          </span>
          <span
            className="text-[8px] font-semibold uppercase tracking-[0.2em] leading-none"
            style={{ color: 'var(--theme-primary)', opacity: 0.7 }}
          >
            Command Center
          </span>
        </div>
      )}

      <style>{`
        @keyframes logo-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.08); }
        }
        .animate-logo-pulse {
          animation: logo-pulse 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
