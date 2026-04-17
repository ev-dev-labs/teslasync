interface LogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
}

export default function Logo({ size = 32, showWordmark = false, className = '' }: LogoProps) {
  const id = `lg-${Math.random().toString(36).slice(2, 6)}`
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--theme-primary, #00f0ff)" />
            <stop offset="1" stopColor="var(--theme-accent, #10b981)" />
          </linearGradient>
        </defs>
        {/* Rounded square filled with theme gradient */}
        <rect x="8" y="8" width="184" height="184" rx="40" fill={`url(#${id}-g)`} />
        {/* White bolt */}
        <path d="M112 30L62 108h34L78 170l58-82h-34z" fill="currentColor" />
      </svg>
      {showWordmark && (
        <span className="font-bold text-sm tracking-tight text-white/90">
          TeslaSync
        </span>
      )}
    </div>
  )
}
