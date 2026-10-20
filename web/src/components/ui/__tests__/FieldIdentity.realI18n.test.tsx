import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { Input } from '../Input';
import { Textarea } from '../Textarea';

// Reset before imports so renderer, primitives and real i18next share one
// fresh module graph, rather than resetting React underneath a live renderer.
vi.hoisted(() => vi.resetModules());
vi.unmock('react-i18next');
vi.unmock('i18next');
vi.unmock('@/i18n');
vi.unmock('@/i18n/index');

afterEach(cleanup);

it('cold real i18n resolves canonical field-help text, not only a mocked fallback', async () => {
  const previousUrl = window.location.pathname + window.location.search + window.location.hash;
  const previousLang = document.documentElement.lang;
  const previousDir = document.documentElement.dir;
  window.history.replaceState(null, '', '/__field-identity-cold__');
  const runtime = await import('@/i18n');
  const i18n = runtime.default;
  const previousLanguage = i18n.language;
  try {
    await i18n.changeLanguage('en');
    await runtime.loadEnglishNamespace('a11y');
    expect(i18n.getResource('en', 'translation', 'a11y.helpFor')).toBe('Help for {{field}}');
    expect(i18n.t('a11y.helpFor', { field: 'Canonical field', defaultValue: '__MISSING_CANONICAL_HELP__' }))
      .toBe('Help for Canonical field');
    const { container, rerender } = render(
      <I18nextProvider i18n={i18n}>
        <Input label="Canonical input" help={{ content: 'Input explanation' }} error="Input error" />
        <Textarea label="Canonical textarea" help={{ content: 'Textarea explanation' }} hint="Textarea hint" />
      </I18nextProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Canonical input' });
    const textarea = screen.getByRole('textbox', { name: 'Canonical textarea' });
    const inputId = input.id;
    const textareaId = textarea.id;
    expect(within(container).getByRole('button', { name: 'Help for Canonical input' }))
      .toHaveAttribute('data-help-for', inputId);
    expect(within(container).getByRole('button', { name: 'Help for Canonical textarea' }))
      .toHaveAttribute('data-help-for', textareaId);
    await act(async () => { await i18n.changeLanguage('he'); });
    rerender(
      <I18nextProvider i18n={i18n}>
        <Input label="שם" help={{ content: 'Input explanation' }} error="Input error" />
        <Textarea label="הערות" help={{ content: 'Textarea explanation' }} hint="Textarea hint" />
      </I18nextProvider>,
    );
    expect(i18n.language).toBe('he');
    expect(screen.getByRole('textbox', { name: 'שם' })).toBe(input);
    expect(screen.getByRole('textbox', { name: 'הערות' })).toBe(textarea);
    expect(input.id).toBe(inputId);
    expect(textarea.id).toBe(textareaId);
    expect(input).toHaveAttribute('aria-describedby', `${inputId}-error`);
    expect(textarea).toHaveAttribute('aria-describedby', `${textareaId}-hint`);
    expect(document.getElementById(`${inputId}-error`)).toHaveTextContent('Input error');
    expect(document.getElementById(`${textareaId}-hint`)).toHaveTextContent('Textarea hint');
    expect(screen.getByRole('button', { name: 'Help for שם' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help for הערות' })).toBeInTheDocument();
  } finally {
    cleanup();
    await i18n.changeLanguage(previousLanguage);
    runtime.flushPendingEnglishResourcesForTest();
    window.history.replaceState(null, '', previousUrl);
    document.documentElement.lang = previousLang;
    document.documentElement.dir = previousDir;
  }
});
