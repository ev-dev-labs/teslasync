import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSavedViewUrl } from '../useSavedViewUrl';

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/page" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useSavedViewUrl — currentQuery derivation', () => {
  it('returns an empty string when the URL has no query', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page'),
    });
    expect(result.current.currentQuery).toBe('');
  });

  it('treats a bare "?" as no query (empty string)', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?'),
    });
    expect(result.current.currentQuery).toBe('');
  });

  it('strips the leading "?" and exposes the raw params', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?severity=critical'),
    });
    expect(result.current.currentQuery).toBe('severity=critical');
  });

  it('preserves multiple params and their order', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?severity=critical&type=warn'),
    });
    expect(result.current.currentQuery).toBe('severity=critical&type=warn');
  });

  it('canonicalises encoding so %20 and + collapse to one string', () => {
    // This is the active-detection bug fix: a saved view stored as
    // `tag=a+b` must still match a deep link that arrived as `tag=a%20b`.
    const percent = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?tag=a%20b'),
    });
    const plus = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?tag=a+b'),
    });
    expect(percent.result.current.currentQuery).toBe('tag=a+b');
    expect(plus.result.current.currentQuery).toBe('tag=a+b');
    expect(percent.result.current.currentQuery).toBe(
      plus.result.current.currentQuery,
    );
  });

  it('canonicalises a valueless key to "key="', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?flag'),
    });
    expect(result.current.currentQuery).toBe('flag=');
  });
});

describe('useSavedViewUrl — apply', () => {
  it('writes a querystring into the URL', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page'),
    });
    act(() => result.current.apply('foo=bar'));
    expect(result.current.currentQuery).toBe('foo=bar');
  });

  it('clears every param when applied with an empty string', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?severity=critical&type=warn'),
    });
    expect(result.current.currentQuery).toBe('severity=critical&type=warn');
    act(() => result.current.apply(''));
    expect(result.current.currentQuery).toBe('');
  });

  it('tolerates a leading "?" on the applied query', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page'),
    });
    act(() => result.current.apply('?foo=bar'));
    expect(result.current.currentQuery).toBe('foo=bar');
  });

  it('replaces all params rather than merging into existing ones', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?a=1'),
    });
    act(() => result.current.apply('b=2'));
    // `a` must be gone — applying a saved view swaps the whole filter set.
    expect(result.current.currentQuery).toBe('b=2');
  });

  it('round-trips a multi-param canonical query', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page'),
    });
    act(() => result.current.apply('severity=critical&type=warn'));
    expect(result.current.currentQuery).toBe('severity=critical&type=warn');
  });
});

describe('useSavedViewUrl — history + stability', () => {
  it('pushes a new history entry so applying is reversible', () => {
    function Probe() {
      const { currentQuery, apply } = useSavedViewUrl();
      const navigate = useNavigate();
      return (
        <>
          <span data-testid="q">{currentQuery}</span>
          <button type="button" onClick={() => apply('a=1')}>
            apply
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            back
          </button>
        </>
      );
    }

    const { getByText, getByTestId } = render(
      <MemoryRouter initialEntries={['/page']}>
        <Routes>
          <Route path="/page" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(getByTestId('q').textContent).toBe('');
    fireEvent.click(getByText('apply'));
    expect(getByTestId('q').textContent).toBe('a=1');
    // replace:false means the pre-apply URL is still on the stack.
    fireEvent.click(getByText('back'));
    expect(getByTestId('q').textContent).toBe('');
  });

  it('keeps the apply callback referentially stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?a=1'),
    });
    const firstApply = result.current.apply;
    rerender();
    expect(result.current.apply).toBe(firstApply);
  });

  it('keeps the returned object referentially stable when the URL is unchanged', () => {
    const { result, rerender } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page?a=1'),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('produces a new object identity after the query changes', () => {
    const { result } = renderHook(() => useSavedViewUrl(), {
      wrapper: wrapperWith('/page'),
    });
    const before = result.current;
    act(() => result.current.apply('a=1'));
    expect(result.current).not.toBe(before);
    expect(result.current.currentQuery).toBe('a=1');
  });
});
