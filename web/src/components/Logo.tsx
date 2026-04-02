interface LogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
}

export default function Logo({ size = 32, showWordmark = false, className = '' }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="ts-bolt" x1="0.3" y1="0" x2="0.7" y2="1">
            <stop stopColor="#00f0ff" />
            <stop offset="0.5" stopColor="#40e8c0" />
            <stop offset="1" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="ts-car" x1="0" y1="0.3" x2="1" y2="0.7">
            <stop stopColor="#00f0ff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* Background */}
        <rect width="48" height="48" rx="10" fill="#060a14" />
        {/* Car silhouette */}
        <path d="M8 30 Q7 28 9 26 L13 23 Q17 20 24 19 Q31 20 35 23 L39 26 Q41 28 40 30 L38 31 Q32 33 24 33 Q16 33 10 31 Z" fill="none" stroke="url(#ts-car)" strokeWidth="1.5" />
        {/* Headlights */}
        <circle cx="12" cy="27" r="2" fill="#00f0ff" opacity="0.9" />
        <circle cx="36" cy="27" r="2" fill="#00f0ff" opacity="0.9" />
        {/* Lightning bolt */}
        <path d="M29 5L21 23h6L19 43l14-18h-6z" fill="url(#ts-bolt)" />
      </svg>
      {showWordmark && (
        <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
          TeslaSync
        </span>
      )}
    </div>
  )
}