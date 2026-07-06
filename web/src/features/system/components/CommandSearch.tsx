import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import { Search } from 'lucide-react';

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function CommandSearch({ value, onChange }: CommandSearchProps) {
  const { t } = useTranslation();

  return (
    <Input
      type="search"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('commands.search.placeholder', 'Search commands...')}
      aria-label={t('commands.search.aria', 'Search commands')}
      icon={<Search className="h-4 w-4" aria-hidden="true" />}
      className="bg-white/[0.03] border-white/[0.06] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
    />
  );
}
