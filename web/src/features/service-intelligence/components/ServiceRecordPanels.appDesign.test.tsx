import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile,
} from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS } from '@/api/hooks/useServiceIntelligence';
import { catalogReport, serviceReport, warrantyReport } from '../pages/ServiceIntelligencePage.closure.fixtures';
import { CommunicationsCatalogPanel } from './CommunicationsCatalogPanel';
import { CommunicationsPanel } from './CommunicationsPanel';
import { EvidenceLimitationsPanel } from './EvidenceLimitationsPanel';
import { RecallFindingCard } from './RecallFindingCard';
import { SourceFreshnessPanel } from './SourceFreshnessPanel';
import { SymptomMatchesPanel } from './SymptomMatchesPanel';
import { WarrantyPanel } from './WarrantyPanel';

const controlRules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8'))
  .walkRules(rule => { controlRules.push(rule); });
const shared = { selected: true, loading: false, error: null, onRetry: vi.fn() };
const profiles = ['classic', 'blueprint', 'v2', 'v1'] as const;
let release = () => {};
let savedProfile: Array<readonly [string, string | null]>;

beforeEach(() => {
  savedProfile = Object.keys(getAppDesignAttributes('classic')).map(name => [name, document.documentElement.getAttribute(name)] as const);
  for (const [name] of savedProfile) document.documentElement.removeAttribute(name);
});
afterEach(() => {
  release();
  for (const [name, value] of savedProfile) {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  }
});

describe('service record renderers bind qualified native consumers', () => {
  it.each(profiles)('%s composes complete records, hypotheses and countdowns without changing source meaning', pack => {
    setAppDesignTestProfile(document.documentElement, pack);
    const onImport = vi.fn();
    const view = render(<>
      <ul><RecallFindingCard finding={serviceReport.recall_findings[0]} /></ul>
      <CommunicationsPanel {...shared} communications={serviceReport.communications} source={serviceReport.sources[0]} />
      <SymptomMatchesPanel {...shared} symptoms={serviceReport.ranked_symptoms} />
      <EvidenceLimitationsPanel {...shared} evidence={serviceReport.evidence} />
      <SourceFreshnessPanel {...shared} sources={serviceReport.sources} />
      <WarrantyPanel {...shared} outlook={{ ...warrantyReport, coverages: [
        warrantyReport.coverages[0],
        { ...warrantyReport.coverages[0], name: 'Measured exhausted allowance', status: 'expired', days_remaining: -1, km_remaining: 0 },
      ] }} />
      <CommunicationsCatalogPanel status={catalogReport} loading={false} error={null}
        importing={false} importingArtifactURL={null} importError={null}
        onRetry={shared.onRetry} onImport={onImport} />
    </>);
    release = observeAppDesignScopes(document.documentElement);
    const mode = APPLICATION_DESIGNS[pack].data;
    const records = view.container.querySelectorAll('[data-app-card-kind="record"]');
    expect(records).toHaveLength(16);
    for (const record of records) {
      expectAppDesignDataMode(record, mode, '[data-app-card-kind="record"]');
      const header = record.querySelector(':scope > [data-app-part~="record-header"]')!;
      const body = record.querySelector(':scope > [data-app-part~="record-body"]')!;
      expectAppDesignDataMode(header, mode, '[data-app-part~="record-header"]');
      expectAppDesignDataMode(body, mode, '[data-app-part~="record-body"]');
      expect(record.querySelector('[role="progressbar"], [data-metric-track]')).toBeNull();
    }
    for (const list of view.container.querySelectorAll('[data-app-list="records"]')) {
      expectAppDesignDataMode(list, mode, '[data-app-list="records"]');
    }
    const symptoms = screen.getByText('first_server_rank').closest('ol')!;
    expect([...symptoms.children].map(row => row.querySelector('[data-app-part~="record-title"]')?.textContent))
      .toEqual(['first_server_rank', 'second_server_rank']);
    expect(symptoms.children[0]).toHaveTextContent('20% match');
    expect(symptoms.children[1]).toHaveTextContent('90% match');
    expect(screen.getByText('Completion unknown')).toHaveAttribute('data-app-variant', 'neutral');
    expect(screen.getByText('NHTSA park-outside warning')).toHaveAttribute('data-app-variant', 'danger');
    expect(screen.getByText('TSB index needs refresh')).toBeInTheDocument();
    expect(screen.getByText(serviceReport.evidence.disclaimer)).toBeInTheDocument();
    const unavailable = screen.getByText('Maintenance evidence source').closest('li')!;
    expect(unavailable).toHaveTextContent('0 records');
    expect(unavailable).toHaveTextContent('Unavailable');
    expect(within(unavailable).getByRole('link')).not.toHaveAttribute('data-app-part', 'button');

    const coverage = screen.getByText('Measured exhausted allowance').closest('[data-app-part="list-row"]')!;
    expectAppDesignDataMode(coverage, mode, '[data-app-list="definitions"]');
    expectAppDesignDataMode(coverage.querySelector('[data-app-part~="metric-reading"]')!, mode, '[data-app-part~="metric-reading"]');
    expect(coverage).toHaveTextContent('0 days left');
    expect(coverage).toHaveTextContent('0 km remaining');
    expect(coverage).toHaveTextContent('Expired');
    expect(screen.getByText('Retained battery coverage').parentElement).not.toHaveTextContent('km remaining');
    expect(screen.getByText(warrantyReport.assumption)).toBeInTheDocument();

    const links = [
      screen.getByRole('link', { name: 'Open NHTSA campaign' }),
      screen.getByRole('link', { name: 'Open official NHTSA document' }),
      screen.getByRole('link', { name: 'Open evidence source' }),
    ];
    for (const link of links) {
      expect(link).toHaveAttribute('data-app-part', 'button');
      expect(link).toHaveAttribute('data-app-variant', 'ghost');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(controlRules.some(rule => rule.selectors.some(selector =>
        selector.includes('[data-app-part~="button"]') && link.matches(selector)))).toBe(true);
    }
    const imports = screen.getAllByRole('button', { name: /Import official NHTSA artifact/ });
    expect(imports).toHaveLength(OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS.length);
    expect(screen.getByText('Already current')).toBeInTheDocument();
    expect(screen.getByTitle(catalogReport.latest_successful!.artifact_sha256!)).toHaveTextContent('aaaaaaaaaaaa…');
    fireEvent.click(imports[0]);
    expect(onImport).toHaveBeenCalledExactlyOnceWith(OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[0].url);
  });

  it.each(profiles)('%s binds unknown-source recovery as neutral feedback while retaining returned bulletins', pack => {
    setAppDesignTestProfile(document.documentElement, pack);
    const retry = vi.fn();
    const view = render(<CommunicationsPanel {...shared} source={null}
      communications={serviceReport.communications} onRetry={retry} />);
    release = observeAppDesignScopes(document.documentElement);
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-app-tone', 'neutral');
    const feedbackRules = matchesAppDesignCss(notice, '[data-app-feedback-kind="notice"]')
      .filter(match => match.selector.includes('[data-app-feedback='));
    expect(feedbackRules.length).toBeGreaterThan(0);
    for (const match of feedbackRules) expect(match.selector).toContain(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`);
    const retryButton = within(notice).getByRole('button', { name: 'Retry' });
    expect(retryButton).toHaveAttribute('data-app-part', 'button feedback-retry');
    expect(matchesAppDesignCss(retryButton, '[data-app-part~="feedback-retry"]').length).toBeGreaterThan(0);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledOnce();
    expect(view.container.querySelector('li[data-app-card-kind="record"]')).toHaveTextContent('Returned bulletin summary.');
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
  });

  it('uses the nearest complete preview only and leaves default and incomplete trees neutral', () => {
    const view = render(<>
      <div data-testid="default"><CommunicationsPanel {...shared} source={null} communications={serviceReport.communications} /></div>
      <div data-testid="complete" data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <CommunicationsPanel {...shared} source={null} communications={serviceReport.communications} />
      </div>
      <div data-testid="incomplete" data-app-design-preview="" data-app-design-pack="v1">
        <CommunicationsPanel {...shared} source={null} communications={serviceReport.communications} />
      </div>
    </>);
    release = observeAppDesignScopes(document.documentElement);
    const complete = screen.getByTestId('complete');
    expectAppDesignDataMode(complete.querySelector('[data-app-card-kind="record"]')!, 'ledger');
    for (const name of ['default', 'incomplete']) {
      for (const record of screen.getByTestId(name).querySelectorAll('[data-app-card-kind="record"], [data-app-feedback-kind="notice"]')) {
        expect(record).not.toHaveAttribute('data-app-design-owner');
        expect(matchesAppDesignCss(record)).toHaveLength(0);
      }
    }
    expect(view.container.querySelectorAll('li')).toHaveLength(3);
  });
});
