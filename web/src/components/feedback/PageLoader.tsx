/** Full-page spinning loader, suitable as a React Suspense fallback. */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="relative">
        <div className="h-16 w-16 rounded-full border-2 border-white/[0.06]" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-2 border-t-neon-cyan border-r-transparent border-b-transparent border-l-transparent animate-spin" style={{ filter: 'drop-shadow(0 0 8px rgba(0,240,255,0.4))' }} />
        <div className="absolute inset-2 h-12 w-12 rounded-full border-2 border-t-transparent border-r-neon-purple border-b-transparent border-l-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s', filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.3))' }} />
      </div>
    </div>
  )
}
