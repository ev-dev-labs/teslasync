import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import './card-layout.css';

export const CardLayoutContext = createContext<HTMLElement | null>(null);
export const CardSlotContext = createContext<'body' | 'summary' | 'delegate' | 'column' | null>(null);
const registrations = new WeakMap<HTMLElement, Set<HTMLElement>>();
const nativeOwners = new WeakMap<HTMLElement, { role: string | null; styles: [string, string][] }>();
const columns = new WeakMap<HTMLElement, Set<HTMLElement>>();
const stretchOwners = new WeakMap<HTMLElement, { previous: string | null; owners: Map<symbol, string> }>();
const physicalSurface = '[data-surface-variant="standalone"],figure[data-chart-variant="panel"]';
const layoutAttributes = ['data-card-layout', 'data-card-layout-aligned', 'data-card-layout-cell'] as const;

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value == null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function hasText(element: HTMLElement) {
  return Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
}

function registerStretchRoles(entries: [HTMLElement, string][]) {
  const token = Symbol();
  for (const [element, role] of entries) {
    if (role === 'surface') {
      let parent = element.parentElement;
      while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
      if (!parent || !/grid|flex/.test(getComputedStyle(parent).display)) continue;
    }
    const active = stretchOwners.get(element) ?? { previous: element.getAttribute('data-card-stretch'), owners: new Map<symbol, string>() };
    active.owners.set(token, role);
    stretchOwners.set(element, active);
    element.setAttribute('data-card-stretch', role);
  }
  return () => {
    for (const [element] of entries) {
      const active = stretchOwners.get(element);
      if (!active?.owners.delete(token)) continue;
      const role = [...active.owners.values()].pop() ?? active.previous;
      restoreAttribute(element, 'data-card-stretch', role);
      if (active.owners.size === 0) stretchOwners.delete(element);
    }
  };
}

function transparent(element: HTMLElement) {
  return element.children.length === 1 && !hasText(element);
}

/** An empty source owns remaining space inside its native grid column. */
export function useCardColumnRegistration(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const source = ref.current;
    if (!enabled || !source) return;
    const relays: [HTMLElement, string][] = [];
    for (let parent = source.parentElement; parent && !parent.matches('main,body'); parent = parent.parentElement) {
      if (columns.has(parent)) break;
      if (parent.matches('[data-card-slot="body"],[data-card-slot="plot"],[data-card-slot="column"]')) {
        return registerStretchRoles(relays);
      }
      if (parent.matches('[data-surface-variant]') || !transparent(parent)) break;
      relays.push([parent, 'empty']);
    }
    const column = source.parentElement;
    const owner = column?.parentElement;
    if (!column || !owner || column.hasAttribute('data-card-layout-opt-in')) return;
    if (column.hasAttribute('data-card-slot') && !columns.has(column)) return;
    const css = getComputedStyle(column);
    if (!getComputedStyle(owner).display.includes('grid') || css.display.includes('grid')
      || css.display.includes('flex') && css.flexDirection === 'row') return;
    const active = columns.get(column) ?? new Set<HTMLElement>();
    active.add(source);
    columns.set(column, active);
    column.setAttribute('data-card-slot', 'column');
    return () => {
      active.delete(source);
      if (active.size === 0) {
        column.removeAttribute('data-card-slot');
        columns.delete(column);
      }
    };
  }, [enabled, ref]);
}

/** Register ownership, not pixel geometry. CSS subgrid sizes the named slots. */
export function useCardLayoutRegistration(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const sharedOwner = useContext(CardLayoutContext);
  useLayoutEffect(() => {
    const surface = ref.current;
    if (!enabled || !surface) return;
    const relays: HTMLElement[] = [];
    let owner: HTMLElement | null = null;
    for (let parent = surface.parentElement; parent && !parent.matches('main,body'); parent = parent.parentElement) {
      if (parent === sharedOwner || parent.matches('[data-card-layout="grid"]')
        || parent.children.length > 1 && getComputedStyle(parent).display.includes('grid')) {
        owner = parent;
        break;
      }
      // A wrapper carrying other content is not a transparent single-card relay.
      if (!transparent(parent)) return;
      relays.push(parent);
    }
    if (!owner) return;
    if (owner !== sharedOwner && !owner.matches('[data-card-layout="grid"]') && !nativeOwners.has(owner)) {
      const optedIn = (element: Element): boolean => element.hasAttribute('data-card-layout-opt-in')
        || element instanceof HTMLElement && transparent(element) && optedIn(element.children[0]);
      if (!Array.from(owner.children).every(optedIn)) return;
      const css = getComputedStyle(owner);
      nativeOwners.set(owner, {
        role: owner.getAttribute('data-card-layout'),
        styles: ['--card-layout-gutter', '--card-layout-margin-end', 'row-gap']
          .map(property => [property, owner!.style.getPropertyValue(property)]),
      });
      owner.style.setProperty('--card-layout-gutter', css.rowGap === 'normal' ? '0px' : css.rowGap || '0px');
      owner.style.setProperty('--card-layout-margin-end', css.marginBlockEnd || css.marginBottom || '0px');
      owner.style.setProperty('row-gap', '0px');
      owner.setAttribute('data-card-layout', 'grid');
    }
    const previous = [surface, ...relays].map(element => ({
      element, attributes: layoutAttributes.map(name => [name, element.getAttribute(name)] as const),
    }));
    const active = registrations.get(owner) ?? new Set<HTMLElement>();
    active.add(surface);
    registrations.set(owner, active);
    owner.setAttribute('data-card-layout-aligned', 'true');
    surface.setAttribute('data-card-layout', 'surface');
    surface.setAttribute('data-card-layout-aligned', 'true');
    (relays[relays.length - 1] ?? surface).setAttribute('data-card-layout-cell', 'true');
    for (const relay of relays) {
      relay.setAttribute('data-card-layout', relay.parentElement === owner ? 'item' : 'relay');
      relay.setAttribute('data-card-layout-aligned', 'true');
    }
    return () => {
      active.delete(surface);
      if (active.size === 0) {
        owner.removeAttribute('data-card-layout-aligned');
        const native = nativeOwners.get(owner);
        if (native) {
          restoreAttribute(owner, 'data-card-layout', native.role);
          for (const [property, value] of native.styles) {
            if (value) owner.style.setProperty(property, value);
            else owner.style.removeProperty(property);
          }
          nativeOwners.delete(owner);
        }
      }
      for (const { element, attributes } of previous) {
        for (const [name, value] of attributes) restoreAttribute(element, name, value);
      }
    };
  }, [enabled, sharedOwner, ref]);
}

/** Bridge legacy native grid wrappers without inventing anatomy or measuring height. */
export function useCardStretchRegistration(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const grid = useContext(CardLayoutContext);
  useLayoutEffect(() => {
    const surface = ref.current;
    if (!enabled || !surface || surface.hasAttribute('data-card-layout-aligned')) return;
    const relays: [HTMLElement, string][] = [];
    for (let parent = surface.parentElement; parent && !parent.matches('main,body'); parent = parent.parentElement) {
      if (parent.matches('[data-surface-variant]')) return;
      const css = getComputedStyle(parent);
      if (parent === grid || css.display.includes('grid')
        || css.display.includes('flex') && css.flexDirection === 'row') {
        // Apply relays before deciding whether native percentage fill can be replaced.
        return registerStretchRoles([...relays, [surface, 'surface']]);
      }
      if (!transparent(parent)) {
        if (hasText(parent)) return;
        const surfaces = Array.from(parent.querySelectorAll(physicalSurface))
          .filter(candidate => {
            const enclosing = candidate.parentElement?.closest(physicalSurface);
            return !enclosing || !parent!.contains(enclosing);
          });
        if (surfaces.length !== 1 || surfaces[0] !== surface) return;
      }
      relays.push([parent, transparent(parent) ? 'relay' : 'column']);
    }
  }, [enabled, grid, ref]);
}
