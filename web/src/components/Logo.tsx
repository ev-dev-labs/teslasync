interface LogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
}

export default function Logo({ size = 32, showWordmark = false, className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative">
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
            <linearGradient id="logo-lg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--theme-primary)" />
              <stop offset="100%" stopColor="var(--theme-accent)" />
            </linearGradient>
          </defs>
          {/* Car outline (top-down) */}
          <path
            d="M12,4 C10,4 9,5 9,6 L8,12 L7,16 L7,26 C7,27.5 8.5,28 10,28 L22,28 C23.5,28 25,27.5 25,26 L25,16 L24,12 L23,6 C23,5 22,4 20,4 Z"
            fill="none" stroke="url(#logo-lg)" strokeWidth="1.5" strokeLinejoin="round"
          />
          {/* Windshield */}
          <path d="M10,11 L12,8 L20,8 L22,11 Z" fill="var(--theme-primary)" opacity={0.2} />
          {/* Headlights */}
          <rect x="9.5" y="4.5" width="3" height="1" rx="0.5" fill="var(--theme-primary)" opacity={0.9} />
          <rect x="19.5" y="4.5" width="3" height="1" rx="0.5" fill="var(--theme-primary)" opacity={0.9} />
          {/* Signal arcs */}
          <path d="M4,8 A6,6 0 0 1 4,2" fill="none" stroke="var(--theme-primary)" strokeWidth="0.8" opacity={0.5} />
          <path d="M28,8 A6,6 0 0 0 28,2" fill="none" stroke="var(--theme-accent)" strokeWidth="0.8" opacity={0.5} />
          {/* GPS dot */}
          <circle cx="16" cy="16" r="2" fill="var(--theme-accent)" opacity={0.8} />
          <circle cx="16" cy="16" r="1" fill="#fff" opacity={0.9} />
        </svg>
      </div>
      {showWordmark && (
        <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
          TeslaSync
        </span>
      )}
    </div>
  )
}