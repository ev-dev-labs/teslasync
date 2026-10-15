import { Text } from '@/components/ui';

export function JourneyEvidenceList({ evidence }: { evidence: readonly string[] }) {
  if (evidence.length === 0) return null;

  return (
    <ul className="min-w-0 space-y-1">
      {evidence.map((line) => (
        <Text as="li" key={line} variant="caption" className="break-words [overflow-wrap:anywhere]">
          · {line}
        </Text>
      ))}
    </ul>
  );
}
