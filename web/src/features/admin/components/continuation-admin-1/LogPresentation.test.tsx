import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LogHighlightedText } from './LogHighlightedText';
import { LogConnectionBadge } from './LogConnectionBadge';
import { LogConnectionCard } from './LogConnectionCard';

afterEach(cleanup);

describe('live log presentation preservation', () => {
  it('retains the complete text and every case-insensitive match without duplicating or dropping unmatched runs', () => {
    const text = 'before MQTT between mqtt after';
    const { container } = render(<LogHighlightedText text={text} pattern={/mqtt/i} />);
    expect(container.textContent).toBe(text);
    expect(Array.from(container.querySelectorAll('mark'), element => element.textContent)).toEqual(['MQTT', 'mqtt']);
  });

  it('safely preserves every character for a zero-width expression', () => {
    const text = '😀 abc';
    const { container } = render(<LogHighlightedText text={text} pattern={/(?=.)/u} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('mark')).toBeNull();
  });

  it('distinguishes connected/paused from connection failure without truncating the labelled canonical metric surface', () => {
    const label = 'Connection status '.repeat(20);
    const { container, rerender } = render(
      <LogConnectionCard label={label} icon={null} color="amber">
        <LogConnectionBadge isConnected paused hasError={false} enabled />
      </LogConnectionCard>,
    );
    expect(screen.getByText('Paused (still receiving)')).toBeInTheDocument();
    expect(container.querySelector('[data-print-card]')).toHaveTextContent(label.trim());
    expect(screen.getByText(label.trim())).not.toHaveClass('truncate');
    rerender(<LogConnectionCard label={label} icon={null}>
      <LogConnectionBadge isConnected paused hasError enabled />
    </LogConnectionCard>);
    expect(screen.getByText('Connection error')).toBeInTheDocument();
    expect(screen.queryByText('Paused (still receiving)')).toBeNull();
  });
});
