// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes } from './designs';

describe('application composition contract', () => {
  it('covers every available pack with a distinct full composition, including Classic', () => {
    expect(Object.keys(APPLICATION_DESIGNS).sort()).toEqual([...PACK_IDS].sort());
    const compositions = PACK_IDS.map(id => JSON.stringify(APPLICATION_DESIGNS[id]));
    expect(new Set(compositions).size).toBe(PACK_IDS.length);
  });

  it('keeps the coordinated pack-author composition table stable', () => {
    const table = PACK_IDS.map(id => {
      const { navigation, header, content, controls, data, chart, map, feedback } = APPLICATION_DESIGNS[id];
      return `${id} ${[navigation, header, content, controls, data, chart, map, feedback].join('/')}`;
    }).join('\n');
    expect(table).toBe(`classic rail/banner/cards/outline/table/precision/framed/inline
v1 rail/instrument/workbench/outline/instrument/instrument/instrument/terminal
v2 sidebar/split/cards/filled/cards/soft/framed/callout
v3 rail/compact/ledger/underline/ledger/precision/minimal/inline
v4 sidebar/banner/cards/outline/cards/editorial/atlas/inline
v5 hybrid/masthead/canvas/filled/instrument/soft/framed/callout
v6 top/split/canvas/segmented/cards/geometric/atlas/callout
v7 rail/instrument/workbench/outline/table/geometric/instrument/terminal
motorsport hybrid/instrument/workbench/filled/instrument/instrument/instrument/callout
blueprint sidebar/instrument/workbench/outline/ledger/precision/atlas/terminal
editorial top/masthead/editorial/underline/ledger/editorial/minimal/inline
ambient sidebar/split/canvas/filled/cards/soft/minimal/callout
terminal rail/compact/ledger/outline/ledger/precision/instrument/terminal
atlas hybrid/banner/canvas/outline/cards/editorial/atlas/inline
analog sidebar/instrument/cards/filled/instrument/instrument/framed/callout
observatory rail/split/canvas/outline/instrument/precision/instrument/inline
bauhaus top/split/cards/segmented/cards/geometric/framed/callout
quiet rail/compact/editorial/underline/table/editorial/minimal/inline
warm sidebar/masthead/editorial/filled/cards/soft/atlas/callout
swiss top/compact/ledger/underline/table/precision/minimal/inline
material hybrid/banner/cards/filled/cards/soft/framed/inline
glass sidebar/split/canvas/outline/cards/soft/minimal/callout
deco top/masthead/editorial/outline/ledger/geometric/framed/callout
kinetic hybrid/instrument/workbench/segmented/instrument/geometric/instrument/inline
brutal top/banner/workbench/outline/table/geometric/framed/terminal
cyber rail/instrument/canvas/segmented/instrument/instrument/instrument/terminal
memphis hybrid/split/canvas/segmented/cards/geometric/atlas/callout`);
  });

  it.each(PACK_IDS)('exposes every composition slot as a stable DOM attribute for %s', packId => {
    const attributes = getAppDesignAttributes(packId);
    const { navigation, header, content, controls, data, chart, map, feedback } = APPLICATION_DESIGNS[packId];
    expect(attributes).toEqual({
      'data-app-design-pack': packId,
      'data-app-navigation': navigation,
      'data-app-header': header,
      'data-app-content': content,
      'data-app-controls': controls,
      'data-app-data': data,
      'data-app-chart': chart,
      'data-app-map': map,
      'data-app-feedback': feedback,
    });
  });

  it('can derive independent preview attributes without browser state or preference mutation', () => {
    const before = JSON.stringify(APPLICATION_DESIGNS);
    const first = getAppDesignAttributes('classic');
    const second = getAppDesignAttributes('classic');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(getAppDesignAttributes('terminal')['data-app-feedback']).toBe('terminal');
    expect(getAppDesignAttributes('classic')).toEqual(first);
    expect(JSON.stringify(APPLICATION_DESIGNS)).toBe(before);
  });
});
