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
          className="absolute inset-0 rounded-full blur-md opacity-30 animate-logo-pulse"
          style={{ background: 'var(--theme-primary)' }}
        />
        <svg
          width={size}
          height={size}
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative"
        >
          <defs>
            <linearGradient id="logo-lg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f0ff" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <filter id="logo-glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          {/* Background */}
          <circle cx="100" cy="100" r="96" fill="#060610" />
          {/* Orbital rings */}
          <ellipse cx="100" cy="100" rx="75" ry="20" fill="none" stroke="#00f0ff" strokeWidth="1.2" opacity={0.22} transform="rotate(-15 100 100)"/>
          <ellipse cx="100" cy="100" rx="75" ry="20" fill="none" stroke="#10b981" strokeWidth="1.2" opacity={0.22} transform="rotate(20 100 100)"/>
          <ellipse cx="100" cy="100" rx="75" ry="20" fill="none" stroke="#a855f7" strokeWidth="0.8" opacity={0.15} transform="rotate(55 100 100)"/>
          {/* Particles */}
          <circle cx="173" cy="95" r="4" fill="#00f0ff" opacity={0.8} filter="url(#logo-glow)"/>
          <circle cx="38" cy="115" r="3.5" fill="#10b981" opacity={0.7} filter="url(#logo-glow)"/>
          <circle cx="125" cy="68" r="3" fill="#a855f7" opacity={0.6} filter="url(#logo-glow)"/>
          {/* Central sphere */}
          <circle cx="100" cy="100" r="28" fill="#080814" stroke="url(#logo-lg)" strokeWidth="2.5"/>
          <circle cx="100" cy="100" r="34" fill="none" stroke="url(#logo-lg)" strokeWidth="0.6" opacity={0.3}/>
          <circle cx="100" cy="100" r="18" fill="#00f0ff" opacity={0.06} filter="url(#logo-glow)"/>
          {/* Bolt */}
          <path d="M105 86l-10 16h8l-6 14 15-18h-8z" fill="url(#logo-lg)" filter="url(#logo-glow)"/>
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