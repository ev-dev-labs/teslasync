import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, PanelTitle, Select, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { currencyFractionDigits, formatCurrencyValue, parseCurrencyText } from '@/lib/currencyFormat';
import type { TripPacketEntry, TripPacketPurpose, TripPacketReceipt } from '@/types/tripPacket';

interface ReceiptDraft {
  key: number;
  day: string;
  reference: string;
  currency: string;
  amount: string;
}

interface Props {
  entry: TripPacketEntry;
  disabled: boolean;
  onSave: (entry: TripPacketEntry) => void;
}

export function TripPacketEntryForm({ entry, disabled, onSave }: Props) {
  const { t } = useTranslation();
  const { unitPrefs: { locale = 'en-US' } } = useUnits();
  const [purpose, setPurpose] = useState(entry.purpose);
  const [receipts, setReceipts] = useState<ReceiptDraft[]>(() => (entry.receipts ?? []).map((r, index) => {
    const digits = currencyFractionDigits(r.currency, locale);
    return { key: index, day: r.receipt_day, reference: r.reference, currency: r.currency,
      amount: formatCurrencyValue(r.amount_minor / 10 ** digits, r.currency, locale, digits) };
  }));
  const key = useRef(receipts.length);
  const choices = [
    { value: '', label: t('logbook.unclassified', 'Unclassified') },
    { value: 'business', label: t('logbook.business', 'Business') },
    { value: 'commute', label: t('logbook.commute', 'Commute') },
    { value: 'personal', label: t('logbook.personal', 'Personal') },
  ] satisfies { value: TripPacketPurpose; label: string }[];
  const normalized = purpose === 'business' ? receipts.map((draft): TripPacketReceipt | null => {
    const currency = draft.currency.trim().toUpperCase();
    const reference = draft.reference.trim();
    if (!draft.day || !reference || !/^[A-Z]{3}$/.test(currency)) return null;
    const major = parseCurrencyText(draft.amount, currency, locale);
    if (major == null) return null;
    const scaled = major * 10 ** currencyFractionDigits(currency, locale);
    const amount = Math.round(scaled);
    if (amount <= 0 || amount > 1_000_000_000 || Math.abs(scaled - amount) > 0.00001) return null;
    return { drive_id: entry.drive_id, receipt_day: draft.day, reference, currency, amount_minor: amount };
  }) : [];
  const invalid = normalized.some(value => value == null);
  const patch = (item: ReceiptDraft, update: Partial<ReceiptDraft>) => {
    setReceipts(current => current.map(r => r.key === item.key ? { ...r, ...update } : r));
  };
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (!disabled && !invalid) onSave({ drive_id: entry.drive_id, purpose, receipts: normalized.filter(value => value != null) });
  }}>
    <Select label={t('logbook.packet.purpose', 'Confirmed purpose for this drive')} disabled={disabled}
      options={choices} value={purpose}
      onChange={event => setPurpose(choices.find(option => option.value === event.target.value)?.value ?? '')} />
    {purpose === 'business' ? <>
      <PanelTitle>{t('logbook.packet.receipts', 'Matching receipt references')}</PanelTitle>
      <Text as="p" variant="caption">{t('logbook.packet.receiptHint', 'Enter only receipts you matched to this drive. Use the date on the receipt and its original currency. No files are uploaded.')}</Text>
      <ul className="space-y-3">
        {receipts.map((r, index) => <li key={r.key} className="grid gap-3 sm:grid-cols-2">
          <Input type="date" label={t('logbook.packet.receiptDay', 'Receipt {{index}} date', { index: index + 1 })}
            required disabled={disabled} value={r.day} onChange={event => patch(r, { day: event.target.value })} />
          <Input label={t('logbook.packet.reference', 'Receipt {{index}} reference', { index: index + 1 })}
            required disabled={disabled} maxLength={120} value={r.reference} onChange={event => patch(r, { reference: event.target.value })} />
          <Input label={t('logbook.packet.currency', 'Receipt {{index}} currency code', { index: index + 1 })}
            required disabled={disabled} maxLength={3} value={r.currency} onChange={event => patch(r, { currency: event.target.value })} />
          <Input inputMode="decimal" label={t('logbook.packet.amount', 'Receipt {{index}} amount', { index: index + 1 })}
            required disabled={disabled} maxLength={40} value={r.amount} onChange={event => patch(r, { amount: event.target.value })} />
          <Button type="button" className="min-h-11 justify-self-start" variant="ghost" disabled={disabled}
            onClick={() => setReceipts(current => current.filter(item => item.key !== r.key))}>
            {t('logbook.packet.removeReceipt', 'Remove receipt {{index}}', { index: index + 1 })}
          </Button>
        </li>)}
      </ul>
      <Button type="button" className="min-h-11" variant="secondary" disabled={disabled || receipts.length >= 10}
        onClick={() => {
          const item = { key: key.current++, day: '', reference: '', currency: '', amount: '' };
          setReceipts(current => [...current, item]);
        }}>
        {t('logbook.packet.addReceipt', 'Add a receipt reference')}
      </Button>
      {invalid && receipts.length > 0 && <Text as="p" variant="caption">
        {t('logbook.packet.invalidReceipt', 'Complete each receipt with a date, reference, three-letter currency and valid positive amount.')}
      </Text>}
    </> : receipts.length > 0 && <Text as="p" variant="caption">
      {t('logbook.packet.removeAssociations', 'Saving a different purpose removes this drive’s receipt references from private packets.')}
    </Text>}
    <div><Button type="submit" className="min-h-11" disabled={disabled || invalid}>
      {t('logbook.packet.saveEntry', 'Confirm purpose and receipt references')}
    </Button></div>
  </form>;
}
