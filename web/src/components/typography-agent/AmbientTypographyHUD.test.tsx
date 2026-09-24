import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TypographyAgentProvider, __resetTypographyAgentForTests } from './TypographyAgentProvider';

function renderHUD() {
  return render(
    <TypographyAgentProvider>
      <div>app content</div>
    </TypographyAgentProvider>,
  );
}

function toggleHotkey(mod: 'ctrlKey' | 'metaKey' = 'ctrlKey') {
  fireEvent.keyDown(window, { key: 't', shiftKey: true, [mod]: true });
}

// The HUD is lazy-loaded (CLEAN-06 entry-chunk split): the first open pays a
// cold module-transform cost in jsdom (~5s on loaded runners), so every open
// awaits the chunk with a generous timeout instead of asserting synchronously.
async function openHUD() {
  await act(async () => {
    toggleHotkey();
  });
  return screen.findByLabelText('Typography agent controller', {}, { timeout: 15_000 });
}

describe('AmbientTypographyHUD', () => {
  beforeEach(() => {
    __resetTypographyAgentForTests();
    localStorage.clear();
    document.getElementById('connected-typography-layer')?.remove();
  });

  it('stays hidden until the hotkey toggles it', async () => {
    renderHUD();
    expect(screen.queryByLabelText('Typography agent controller')).toBeNull();

    expect(await openHUD()).toBeInTheDocument();

    await act(async () => {
      toggleHotkey('metaKey');
    });
    expect(screen.queryByLabelText('Typography agent controller')).toBeNull();
  });

  it('dispatches ratio changes through the shared agent store', async () => {
    renderHUD();
    await openHUD();

    expect(await screen.findByLabelText('Harmonic ratio')).toHaveValue('majorThird');
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Harmonic ratio'), { target: { value: 'goldenRatio' } });
    });
    // Dispatch resolves after verify; the store update lands async.
    await waitFor(() => {
      expect(screen.getByLabelText('Harmonic ratio')).toHaveValue('goldenRatio');
    });
  });

  it('applies the token layer and shows the verification score', async () => {
    renderHUD();
    await openHUD();

    // The actuator wrote the token layer (proves harmonize → actuate ran).
    await waitFor(() => {
      expect(document.getElementById('connected-typography-layer')?.textContent).toContain(
        '--type-size-base',
      );
    });
    // Verification ran against the live DOM (clean test tree scores 100).
    expect(await screen.findByText(/Score: 100\/100/)).toBeInTheDocument();
  });

  it('closes from the dismiss button', async () => {
    renderHUD();
    await openHUD();
    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Close'));
    });
    expect(screen.queryByLabelText('Typography agent controller')).toBeNull();
  });

  it('resets the spec to defaults from the reset button', async () => {
    renderHUD();
    await openHUD();

    await act(async () => {
      fireEvent.change(await screen.findByLabelText('Harmonic ratio'), {
        target: { value: 'goldenRatio' },
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Harmonic ratio')).toHaveValue('goldenRatio');
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Harmonic ratio')).toHaveValue('majorThird');
    });
  });

  it('closes on Escape and returns focus to the opener', async () => {
    renderHUD();
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    await openHUD();
    expect(document.activeElement?.getAttribute('id')).toBe('typography-hud-root');

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByLabelText('Typography agent controller')).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
