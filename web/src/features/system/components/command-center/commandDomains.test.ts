import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, COMMANDS } from '../../commands';
import { COMMAND_DOMAINS } from './commandDomains';

describe('COMMAND_DOMAINS', () => {
  it('covers every command category exactly once', () => {
    const categories = COMMAND_DOMAINS.flatMap((domain) => domain.categories);

    expect(categories).toHaveLength(CATEGORY_ORDER.length);
    expect(new Set(categories).size).toBe(categories.length);
    expect([...categories].sort()).toEqual([...CATEGORY_ORDER].sort());
  });

  it('keeps every configured command reachable through one domain', () => {
    const categories = new Set(
      COMMAND_DOMAINS.flatMap((domain) => domain.categories),
    );

    expect(COMMANDS).toHaveLength(67);
    for (const command of COMMANDS) {
      expect(categories.has(command.category)).toBe(true);
    }
  });
});
