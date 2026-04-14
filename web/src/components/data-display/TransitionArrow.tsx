export function TransitionArrow({ from, to }: { from: string; to: string }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-white/50">{from}</span>
      <span className="text-white/30 mx-1">→</span>
      <span className="text-white/90">{to}</span>
    </span>
  );
}
