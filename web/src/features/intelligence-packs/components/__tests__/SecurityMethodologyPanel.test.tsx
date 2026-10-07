import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SecurityMethodologyPanel } from '../SecurityMethodologyPanel';
import { PACK_CAPABILITY_CATALOG } from '../../lib/manifestTypes';

describe('SecurityMethodologyPanel', () => {
  it('renders the guarantees and non-guarantees sections', () => {
    render(<SecurityMethodologyPanel />);
    expect(screen.getByText('Guarantees')).toBeInTheDocument();
    expect(screen.getByText('Explicit non-guarantees')).toBeInTheDocument();
    expect(screen.getByText(/never eval, new Function, dynamic import/i)).toBeInTheDocument();
    expect(screen.getByText(/does NOT vouch for a publisher/i)).toBeInTheDocument();
  });

  it('lists every capability in the fixed allowlist catalog', () => {
    render(<SecurityMethodologyPanel />);
    for (const cap of PACK_CAPABILITY_CATALOG) {
      expect(screen.getByText(cap.id)).toBeInTheDocument();
    }
  });

  it('shows the resource-ceiling/budget table and browser-support caveat', () => {
    render(<SecurityMethodologyPanel />);
    expect(screen.getByText('Resource ceilings & budgets in this build')).toBeInTheDocument();
    expect(screen.getByText(/secure context/i)).toBeInTheDocument();
  });
});
