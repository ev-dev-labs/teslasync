import { useTranslation } from 'react-i18next';
import { Button, Input, Select } from '@/components/ui';
import type { TcoLedgerCategory } from '@/types/analytics';

interface TrueCostLedgerFormProps {
  categories: readonly TcoLedgerCategory[];
  category: TcoLedgerCategory;
  setCategory: (value: TcoLedgerCategory) => void;
  amount: string;
  setAmount: (value: string) => void;
  incurredOn: string;
  setIncurredOn: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  canSubmit: boolean;
  isPending: boolean;
  onAdd: () => void;
}

/** Business state, date defaults, consent and submission remain ledger-owned. */
export function TrueCostLedgerForm({
  categories, category, setCategory, amount, setAmount,
  incurredOn, setIncurredOn, note, setNote, canSubmit, isPending, onAdd,
}: TrueCostLedgerFormProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Select
        label={t('tco.ledger.category', 'Category')}
        options={categories.map((c) => ({ value: c, label: c }))}
        value={category}
        onChange={(e) => setCategory(e.target.value as TcoLedgerCategory)}
      />
      <Input
        label={t('tco.ledger.amount', 'Amount')}
        type="number"
        min={0}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Input
        label={t('tco.ledger.date', 'Date')}
        type="date"
        value={incurredOn}
        onChange={(e) => setIncurredOn(e.target.value)}
      />
      <Input
        label={t('tco.ledger.note', 'Note')}
        value={note}
        maxLength={280}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-end">
        <Button
          onClick={onAdd}
          disabled={!canSubmit || isPending}
          loading={isPending}
          className="w-full"
        >
          {t('tco.ledger.add', 'Record cost')}
        </Button>
      </div>
    </div>
  );
}
