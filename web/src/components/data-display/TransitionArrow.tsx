export function TransitionArrow({ from, to }: { from: string; to: string }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-[var(--text-secondary)]">{from}</span>
      <span className="text-[var(--text-muted)] mx-1">→</span>
      <span className="text-[var(--text-primary)]">{to}</span>
    </span>
  );
}
