import type { TFunction } from 'i18next';

export function ledgerCategoryLabel(category: string, t: TFunction): string {
  switch (category) {
    case 'payment': return t('tco.ledger.categories.payment', 'Payment');
    case 'insurance': return t('tco.ledger.categories.insurance', 'Insurance');
    case 'maintenance': return t('tco.ledger.categories.maintenance', 'Maintenance');
    case 'service': return t('tco.ledger.categories.service', 'Service');
    case 'tires': return t('tco.ledger.categories.tires', 'Tires');
    case 'accessories': return t('tco.ledger.categories.accessories', 'Accessories');
    case 'depreciation': return t('tco.ledger.categories.depreciation', 'Depreciation');
    case 'other': return t('tco.ledger.categories.other', 'Other');
    default: return category;
  }
}
