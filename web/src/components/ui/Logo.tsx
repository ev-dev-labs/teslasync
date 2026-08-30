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
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect
          x="8"
          y="8"
          width="184"
          height="184"
          rx="38"
          fill="var(--surface-2)"
          stroke="var(--border-strong)"
          strokeWidth="8"
        />
        <path
          d="M112 30L62 108h34L78 170l58-82h-34z"
          fill="var(--theme-primary)"
        />
      </svg>
      {showWordmark && (
        <span className="text-sm font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
          TeslaSync
        </span>
      )}
    </div>
  )
}
