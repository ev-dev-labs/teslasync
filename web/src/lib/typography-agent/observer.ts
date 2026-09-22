import type { NodeAnomaly } from './types';

/**
 * Scans the live document for typography regressions: inline styles that
 * bypass the token system, unintentionally clipped text, and prose that
 * exceeds the ergonomic line-length baseline.
 *
 * The scan root and DOM accessors are injectable so the traversal logic
 * stays testable; in production they default to the live document. The
 * observer never mutates the DOM — it only reports breadcrumbs.
 */
export class TypographyObserver {
  /**
   * @param root Subtree to scan (defaults to document.body).
   * @param exclude Extra element ids to skip (the HUD root is always skipped).
   */
  public observe(root?: HTMLElement | null, exclude: ReadonlyArray<string> = []): NodeAnomaly[] {
    const scope = root ?? (typeof document === 'undefined' ? null : document.body);
    if (!scope || typeof document === 'undefined' || typeof window === 'undefined') return [];
    const anomalies: NodeAnomaly[] = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);

    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
      if (!this.isExcluded(node, exclude)) {
        this.inspect(node, anomalies);
      }
      node = walker.nextNode() as HTMLElement | null;
    }
    return anomalies;
  }

  private inspect(node: HTMLElement, anomalies: NodeAnomaly[]): void {
    const hasText = Array.from(node.childNodes).some(
      (child) => child.nodeType === Node.TEXT_NODE && (child.textContent?.trim().length ?? 0) > 0,
    );
    if (!hasText) return;
    const selector = breadcrumb(node);

    // 1. Hardcoded values bypassing system variables (var(--*) is compliant).
    const inline = node.getAttribute('style') ?? '';
    if (inline.includes('font-size') && !inline.includes('var(--')) {
      anomalies.push({
        selector,
        type: 'HARDCODED_LEAK',
        severity: 'warning',
        details: `Element defines raw inline style: ${inline.slice(0, 120)}`,
      });
    }

    const style = window.getComputedStyle(node);

    // 2. Horizontal scroll truncation under overflow hidden.
    const text = node.innerText ?? '';
    if (node.scrollWidth > node.clientWidth + 1 && style.overflow === 'hidden') {
      anomalies.push({
        selector,
        type: 'TEXT_OVERFLOW',
        severity: 'critical',
        details: `Text cropped unintentionally: "${text.slice(0, 24)}..."`,
      });
    }

    // 3. Line-length ergonomics: long prose in very wide containers.
    if (text.length > 90 && node.tagName === 'P' && parseFloat(style.width) > 800) {
      anomalies.push({
        selector,
        type: 'LINE_LENGTH_EXCESS',
        severity: 'info',
        details: `Line length exceeds ergonomic reading baseline (${text.length} characters)`,
      });
    }
  }

  private isExcluded(el: HTMLElement, extra: ReadonlyArray<string>): boolean {
    // Exclusions cover whole subtrees: the walker still descends into
    // skipped elements, so any ancestor match excludes the node.
    let node: HTMLElement | null = el;
    while (node) {
      if (node.id === 'typography-hud-root') return true;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return true;
      if (node.id !== '' && extra.includes(node.id)) return true;
      node = node.parentElement;
    }
    return false;
  }
}

/** Stable-ish breadcrumb (tag + id/class + nth-of-type) for a live element. */
export function breadcrumb(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
    } else if (typeof node.className === 'string' && node.className.trim() !== '') {
      part += `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}
