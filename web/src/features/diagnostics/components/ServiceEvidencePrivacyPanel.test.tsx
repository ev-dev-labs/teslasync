import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES, SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS } from '../lib/serviceEvidencePack';
import { ServiceEvidencePrivacyPanel } from './ServiceEvidencePrivacyPanel';

describe('service evidence privacy native subcards', () => {
  it.each(PACK_IDS)('%s independently owns both complete and distinct privacy lists', pack => {
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <ServiceEvidencePrivacyPanel />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const records = container.querySelectorAll('[data-app-card-kind="record"]');
      expect(records).toHaveLength(2);
      const expected = [SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS, SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES];
      records.forEach((record, index) => {
        expect(record).toHaveAttribute('data-surface-variant', 'standalone');
        expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(record.querySelector(':scope > [data-app-part~="record-body"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expect(within(record as HTMLElement).getAllByRole('listitem').map(node => node.textContent)).toEqual(expected[index]);
      });
      expect(records[0]).toHaveTextContent('Included');
      expect(records[1]).toHaveTextContent('Never included');
      expect(screen.getByText(/raw telemetry payloads are never embedded/)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { release(); }
  });
});
