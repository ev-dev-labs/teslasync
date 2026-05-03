import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { SettingsSearch } from '../SettingsSearch';
import { fuzzyMatch, searchSettings, getSettingsIndex } from '../../searchIndex';

// jsdom doesn't implement scrollIntoView; the search component falls
// back to it so callers always reach the section even when the URL
// hash didn't change.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.hash}
    </div>
  );
}

function renderSearch(initial: string[] = ['/settings']) {
  return render(
    <MemoryRouter initialEntries={initial}>
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <SettingsSearch />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('fuzzyMatch', () => {
  it('matches every needle character in order', () => {
    expect(fuzzyMatch('lng', 'Language')).toBe(true);
    expect(fuzzyMatch('thm', 'Theme')).toBe(true);
    expect(fuzzyMatch('cur', 'Currency')).toBe(true);
  });

  it('rejects when characters are out of order', () => {
    expect(fuzzyMatch('eag', 'Language')).toBe(false);
  });

  it('rejects when a character is missing', () => {
    expect(fuzzyMatch('xyz', 'Language')).toBe(false);
  });

  it('returns false on an empty needle (callers short-circuit)', () => {
    expect(fuzzyMatch('', 'Anything')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('LNG', 'Language')).toBe(true);
    expect(fuzzyMatch('lng', 'LANGUAGE')).toBe(true);
  });
});

describe('searchSettings', () => {
  // Use the real index so a regression in entry wording (or the
  // omission of the Language entry) trips the test. The dummy `t`
  // returns the fallback so the index is fully populated even though
  // no namespace is loaded.
  const tStub = ((_k: string, d: string) => d) as never;
  const index = getSettingsIndex(tStub);

  it('returns no entries on an empty query', () => {
    expect(searchSettings(index, '')).toHaveLength(0);
    expect(searchSettings(index, '   ')).toHaveLength(0);
  });

  it('substring-matches "theme" → Theme entry first', () => {
    const results = searchSettings(index, 'theme');
    expect(results[0]?.title.toLowerCase()).toContain('theme');
  });

  it('fuzzy-matches "lng" → Language', () => {
    const results = searchSettings(index, 'lng');
    expect(results.some((r) => r.title === 'Language')).toBe(true);
  });

  it('keyword-matches "psi" → Tire pressure unit', () => {
    const results = searchSettings(index, 'psi');
    expect(results.some((r) => r.id === 'general.units.pressure')).toBe(true);
  });

  it('ranks the exact-title hit "Theme" first', () => {
    const results = searchSettings(index, 'theme');
    expect(results[0]?.id).toBe('appearance.theme');
  });
});

describe('SettingsSearch', () => {
  it('renders no listbox when the query is empty', () => {
    renderSearch();
    expect(screen.getByPlaceholderText('Search settings…')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('typing "theme" surfaces the Theme entry in the listbox', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search settings…');

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'theme' } });
    });

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(within(listbox).getByText('Theme')).toBeInTheDocument();
  });

  it('typing "lng" surfaces "Language" via fuzzy subsequence', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search settings…');

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'lng' } });
    });

    expect(within(screen.getByRole('listbox')).getByText('Language')).toBeInTheDocument();
  });

  it('clicking a result navigates to the entry href and clears the input', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search settings…') as HTMLInputElement;

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'theme' } });
    });

    const themeOption = within(screen.getByRole('listbox')).getByRole('option', { name: /theme/i });
    act(() => {
      fireEvent.click(themeOption);
    });

    expect(screen.getByTestId('location').textContent).toBe('/settings#appearance');
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the dropdown without navigating', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search settings…');

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'theme' } });
    });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/settings');
  });

  it('ArrowDown + Enter selects the next result', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search settings…');

    act(() => {
      fireEvent.focus(input);
      // "color" should match multiple appearance entries via
      // description / keywords, giving us > 1 row to navigate.
      fireEvent.change(input, { target: { value: 'color' } });
    });

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);

    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // Both color-related entries deep-link to #appearance, which is
    // the user-visible promise we care about.
    expect(screen.getByTestId('location').textContent).toBe('/settings#appearance');
  });
});
