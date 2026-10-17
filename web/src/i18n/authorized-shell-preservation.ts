import { createHash } from 'node:crypto'

// Tests-only inverse of the parent-pinned accepted shell delta, before i18n reversal.
export const acceptedShellDeltas = [
  {
    path: 'web/src/components/layout/Layout.tsx',
    predecessorSHA256: '3afab237f538c2e32c1df4f1c45ae0fc166f227c6a26918e18b55cec15dae150',
    fragments: [
      {
        current: "import { BottomTabBar } from './BottomTabBar'\nimport { activateShellOverlayGuard, focusShellOverlayEntry, getShellFocusableElements, isShellPortalActive } from './shellFocusTrap'\nimport {\n",
        predecessor: "import { BottomTabBar } from './BottomTabBar'\nimport { activateShellOverlayGuard, getShellFocusableElements, isShellPortalActive } from './shellFocusTrap'\nimport {\n",
      },
      {
        current: "      if (popoverRef.current?.contains(target)) return\n      if (document.activeElement?.closest('[role=\"dialog\"][aria-modal=\"true\"], [role=\"alertdialog\"][aria-modal=\"true\"]')) return\n      setOpen(false)\n",
        predecessor: "      if (popoverRef.current?.contains(target)) return\n      setOpen(false)\n",
      },
      {
        current: "    const onKey = (e: KeyboardEvent) => {\n      if (e.key !== 'Escape' || e.defaultPrevented) return\n      const owner = e.target instanceof Element\n        ? e.target.closest('[role=\"dialog\"], [role=\"alertdialog\"]')\n        : null\n      if (owner && owner !== popoverRef.current) return\n      e.stopPropagation()\n      setOpen(false)\n    }\n",
        predecessor: "    const onKey = (e: KeyboardEvent) => {\n      if (e.key === 'Escape') setOpen(false)\n    }\n",
      },
      {
        current: "            popoverRef={popoverRef}\n            triggerRef={triggerRef}\n            onClose={() => setOpen(false)}\n",
        predecessor: "            popoverRef={popoverRef}\n            onClose={() => setOpen(false)}\n",
      },
      {
        current: "}\n\nconst MOBILE_BRAND_CONTAINMENT = 'min-w-0 max-w-full [&>span]:min-w-0 [&>span]:truncate'\n\nexport default function Layout() {\n  const presentation = usePresentationMode()\n",
        predecessor: "}\n\nexport default function Layout() {\n  const presentation = usePresentationMode()\n",
      },
      {
        current: "  const sidebarCloseRef = useRef<HTMLButtonElement>(null)\n  const mobileHeaderRef = useRef<HTMLElement>(null)\n  const mobileHeaderSpacerRef = useRef<HTMLDivElement>(null)\n  useEffect(() => {\n    const header = mobileHeaderRef.current\n    const spacer = mobileHeaderSpacerRef.current\n    if (!header || !spacer || typeof ResizeObserver === 'undefined') return\n    const reserveHeaderHeight = () => {\n      const height = header.getBoundingClientRect().height\n      if (height > 0) spacer.style.height = `${height}px`\n    }\n    reserveHeaderHeight()\n    const observer = new ResizeObserver(reserveHeaderHeight)\n    observer.observe(header)\n    return () => {\n      observer.disconnect()\n      spacer.style.removeProperty('height')\n    }\n  }, [sidebarOpen, presentation.mode])\n  // Command Deck rail collapse. Host-owned (not deck-owned) because the\n",
        predecessor: "  const sidebarCloseRef = useRef<HTMLButtonElement>(null)\n  // Command Deck rail collapse. Host-owned (not deck-owned) because the\n",
      },
      {
        current: "    })\n    const cancelEntry = focusShellOverlayEntry(sidebarRef.current, () => sidebarCloseRef.current)\n    const onViewportChange = () => {\n",
        predecessor: "    })\n    sidebarCloseRef.current?.focus()\n    const onViewportChange = () => {\n",
      },
      {
        current: "    return () => {\n      cancelEntry()\n      desktopMedia.removeEventListener('change', onViewportChange)\n",
        predecessor: "    return () => {\n      desktopMedia.removeEventListener('change', onViewportChange)\n",
      },
      {
        current: "            // Rationale: drawer scrim \u2014 pure backdrop with no content. Pairs\n            // with the <nav> sidebar (drawer pattern), not a dialog. New\n            // interactive dialogs MUST use <Modal>.\n",
        predecessor: "            // Rationale: drawer scrim \u2014 pure backdrop with no content. Pairs\n            // with the <aside> sidebar (drawer pattern), not a dialog. New\n            // interactive dialogs MUST use <Modal>.\n",
      },
      {
        current: "      {/* Sidebar */}\n      <nav\n        ref={sidebarRef}\n",
        predecessor: "      {/* Sidebar */}\n      <aside\n        ref={sidebarRef}\n",
      },
      {
        current: "        {/* Mobile sidebar brand. Build version intentionally not rendered\n            here; canonical provenance lives in the footer <VersionSegment>.\n            Keep inherited visibility synchronous despite the universal\n            reduced-motion transition duration. */}\n        <div className=\"flex items-center gap-2 border-b border-[var(--border-default)] px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] shrink-0 transition-none xl:hidden\">\n          <PrefetchNavLink to=\"/\" className=\"min-w-0 flex flex-1 items-center gap-3 rounded-shape-md transition-colors\" onClick={() => setSidebarOpen(false)}>\n",
        predecessor: "        {/* Mobile sidebar brand. Build version intentionally not rendered\n            here; canonical provenance lives in the footer <VersionSegment>. */}\n        <div className=\"flex items-center gap-2 border-b border-[var(--border-default)] px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] shrink-0 xl:hidden\">\n          <PrefetchNavLink to=\"/\" className=\"min-w-0 flex flex-1 items-center gap-3 rounded-shape-md transition-colors\" onClick={() => setSidebarOpen(false)}>\n",
      },
      {
        current: "          <PrefetchNavLink to=\"/\" className=\"min-w-0 flex flex-1 items-center gap-3 rounded-shape-md transition-colors\" onClick={() => setSidebarOpen(false)}>\n            <Logo size={32} showWordmark className={cn(MOBILE_BRAND_CONTAINMENT, 'flex-1')} />\n          </PrefetchNavLink>\n",
        predecessor: "          <PrefetchNavLink to=\"/\" className=\"min-w-0 flex flex-1 items-center gap-3 rounded-shape-md transition-colors\" onClick={() => setSidebarOpen(false)}>\n            <Logo size={32} showWordmark />\n          </PrefetchNavLink>\n",
      },
      {
        current: "            status, ActiveVehicleSegment shows the active vehicle). */}\n      </nav>\n\n",
        predecessor: "            status, ActiveVehicleSegment shows the active vehicle). */}\n      </aside>\n\n",
      },
      {
        current: "      {presentation.mode === 'standard' && !sidebarOpen && (\n        <header ref={mobileHeaderRef} data-role=\"appbar\" role=\"banner\" aria-label={t('a11y.primaryHeader', 'Site header')} className=\"fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] bg-[var(--surface-1)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] xl:hidden [touch-action:manipulation]\">\n          <Button\n",
        predecessor: "      {presentation.mode === 'standard' && !sidebarOpen && (\n        <header data-role=\"appbar\" role=\"banner\" aria-label={t('a11y.primaryHeader', 'Site header')} className=\"fixed inset-x-0 top-0 z-[60] flex items-center border-b border-[var(--border-default)] bg-[var(--surface-1)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] xl:hidden [touch-action:manipulation]\">\n          <Button\n",
      },
      {
        current: "            aria-expanded={false}\n            className=\"relative z-10 -ms-1 h-11 w-11 shrink-0 rounded-shape-md p-0 text-[var(--text-secondary)] hover:bg-[var(--control-bg)] hover:text-[var(--text-primary)] [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]\"\n          >\n",
        predecessor: "            aria-expanded={false}\n            className=\"relative z-10 -ml-1 h-11 w-11 rounded-shape-md p-0 text-[var(--text-secondary)] hover:bg-[var(--control-bg)] hover:text-[var(--text-primary)] [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]\"\n          >\n",
      },
      {
        current: "          </Button>\n          <div className=\"flex min-w-0 flex-1 basis-16 justify-center\">\n            <Logo size={26} showWordmark className={MOBILE_BRAND_CONTAINMENT} />\n          </div>\n",
        predecessor: "          </Button>\n          <div className=\"flex-1 flex justify-center -ml-10\">\n            <Logo size={26} showWordmark />\n          </div>\n",
      },
      {
        current: "          </div>\n          <div className=\"ms-auto flex shrink-0 items-center gap-2\">\n            <NotificationBellPopover className=\"max-md:[&>button]:min-h-11 max-md:[&>button]:min-w-11\" />\n            <ThemeQuickSwitcher />\n          </div>\n        </header>\n",
        predecessor: "          </div>\n          <NotificationBellPopover className=\"ms-auto\" />\n          <ThemeQuickSwitcher />\n        </header>\n",
      },
      {
        current: "        {/* Spacer for fixed mobile header */}\n        {presentation.mode === 'standard' && <div ref={mobileHeaderSpacerRef} data-role=\"appbar-spacer\" className=\"h-[calc(4.25rem+env(safe-area-inset-top,0px))] shrink-0 xl:hidden\" />}\n        {presentation.mode === 'standard' && <Suspense fallback={<div className=\"hidden h-workspace-header shrink-0 xl:block\" />}>\n",
        predecessor: "        {/* Spacer for fixed mobile header */}\n        {presentation.mode === 'standard' && <div className=\"h-[calc(4.25rem+env(safe-area-inset-top,0px))] shrink-0 xl:hidden\" />}\n        {presentation.mode === 'standard' && <Suspense fallback={<div className=\"hidden h-workspace-header shrink-0 xl:block\" />}>\n",
      },
      {
        current: "      {presentation.mode === 'standard' && (\n        <CommandPaletteHost onOpen={() => setSidebarOpen(false)} returnFocusFallbackRef={sidebarTriggerRef} />\n      )}\n",
        predecessor: "      {presentation.mode === 'standard' && (\n        <CommandPaletteHost onOpen={() => setSidebarOpen(false)} />\n      )}\n",
      },
    ],
  },
  {
    path: 'web/src/components/ui/CommandPalette.tsx',
    predecessorSHA256: 'c157f19b1fa2693b6e7fe1ec3844c090a913c41a66311d1850e3726fa4981522',
    fragments: [
      {
        current: "import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type RefObject } from 'react'\nimport { useNavigate, useLocation } from 'react-router-dom'\n",
        predecessor: "import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'\nimport { useNavigate, useLocation } from 'react-router-dom'\n",
      },
      {
        current: "import { getRelatedRoutes, preserveWorkspaceScope } from '@/lib/contextNavigation'\nimport { activateShellOverlayGuard, restoreShellFocus } from '@/components/layout/shellFocusTrap'\nimport { useGlobalSearch } from '@/api/hooks/useSearch'\n",
        predecessor: "import { getRelatedRoutes, preserveWorkspaceScope } from '@/lib/contextNavigation'\nimport { activateShellOverlayGuard } from '@/components/layout/shellFocusTrap'\nimport { useGlobalSearch } from '@/api/hooks/useSearch'\n",
      },
      {
        current: "  initialOpen?: boolean\n  /** Live visible shell control when opening intentionally hides the original invoker. */\n  returnFocusFallbackRef?: RefObject<HTMLElement>\n}\n",
        predecessor: "  initialOpen?: boolean\n}\n",
      },
      {
        current: "\nexport function CommandPalette({ onOpen, initialOpen = false, returnFocusFallbackRef }: CommandPaletteProps) {\n  const { t } = useTranslation()\n",
        predecessor: "\nexport function CommandPalette({ onOpen, initialOpen = false }: CommandPaletteProps) {\n  const { t } = useTranslation()\n",
      },
      {
        current: "  const onOpenRef = useRef(onOpen)\n  const fallbackRef = useRef(returnFocusFallbackRef)\n  useIsomorphicLayoutEffect(() => {\n",
        predecessor: "  const onOpenRef = useRef(onOpen)\n  useIsomorphicLayoutEffect(() => {\n",
      },
      {
        current: "    onOpenRef.current = onOpen\n    fallbackRef.current = returnFocusFallbackRef\n  })\n",
        predecessor: "    onOpenRef.current = onOpen\n  })\n",
      },
      {
        current: "  const panelRef = useRef<HTMLDivElement>(null)\n  const returnFocusContainerRef = useRef<HTMLDivElement | null>(null)\n  const navigate = useNavigate()\n",
        predecessor: "  const panelRef = useRef<HTMLDivElement>(null)\n  const navigate = useNavigate()\n",
      },
      {
        current: "      focusIntentRef.current = true\n      const panel = panelRef.current\n      returnFocusContainerRef.current = panel\n      const releaseGuard = activateShellOverlayGuard({\n        focusContainer: panel,\n        isOwnRoot: (element) => element.getAttribute('data-role') === 'command-palette',\n      })\n      focusTimeoutRef.current = window.setTimeout(() => {\n",
        predecessor: "      focusIntentRef.current = true\n      focusTimeoutRef.current = window.setTimeout(() => {\n",
      },
      {
        current: "      }, PALETTE_INPUT_FOCUS_DELAY_MS)\n      return () => {\n        clearPendingInputFocus()\n        releaseGuard()\n      }\n    }\n",
        predecessor: "      }, PALETTE_INPUT_FOCUS_DELAY_MS)\n      return clearPendingInputFocus\n    }\n",
      },
      {
        current: "    returnFocusRef.current = null\n    restoreShellFocus(returnFocusContainerRef.current, target, fallbackRef.current?.current ?? null)\n    returnFocusContainerRef.current = null\n    return undefined\n",
        predecessor: "    returnFocusRef.current = null\n    if (target && target.isConnected) {\n      target.focus({ preventScroll: true })\n    }\n    return undefined\n",
      },
      {
        current: "  // it is open. The guard deliberately does NOT move or restore focus \u2014 the\n  // effect above owns both and releases the guard before restoring focus.\n  //\n",
        predecessor: "  // it is open. The guard deliberately does NOT move or restore focus \u2014 the\n  // effect above owns both, so focus return happens exactly once.\n  //\n",
      },
      {
        current: "  // click-outside-to-close gesture.\n  // Only mode transitions transfer focus; opening retains its delayed timer.\n",
        predecessor: "  // click-outside-to-close gesture.\n  useEffect(() => {\n    if (!open) return\n    const panel = panelRef.current\n    if (!panel) return\n    return activateShellOverlayGuard({\n      focusContainer: panel,\n      backgroundAnchor: panel,\n      isOwnRoot: (element) => element.getAttribute('data-role') === 'command-palette',\n    })\n  }, [open])\n\n  // Only mode transitions transfer focus; opening retains its delayed timer.\n",
      },
    ],
  },
  {
    path: 'web/src/components/layout/ThemeQuickSwitcherPopover.tsx',
    predecessorSHA256: 'c1d44325aed1ecac84db36586a79b7410825bc38d9bc8076940c089407c4731b',
    fragments: [
      {
        current: "import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'\nimport { createPortal } from 'react-dom'\nimport { useTranslation } from 'react-i18next'\nimport { Button } from '@/components/ui/runtime'\nimport { cn } from '@/lib/cn'\nimport { typography } from '@/lib/tokens'\nimport { isFocusRestorable } from '@/hooks/useDialogFocus'\nimport { getShellFocusableElements } from './shellFocusTrap'\n\nconst ThemePicker = lazy(async () => {\n  const module = await import('@/components/ui/ThemePicker')\n",
        predecessor: "import { lazy, Suspense, type RefObject } from 'react'\nimport { createPortal } from 'react-dom'\nimport { useTranslation } from 'react-i18next'\nimport { Button } from '@/components/ui/runtime'\nimport { cn } from '@/lib/cn'\nimport { typography } from '@/lib/tokens'\n\nconst ThemePicker = lazy(async () => {\n  const module = await import('@/components/ui/ThemePicker')\n",
      },
      {
        current: "interface ThemeQuickSwitcherPopoverProps {\n  coords: { top: number; left?: number; right?: number }\n  popoverRef: RefObject<HTMLDivElement>\n  triggerRef: RefObject<HTMLButtonElement>\n  onClose: () => void\n  onCustomize: () => void\n}\n\nfunction ThemePickerContent({ onClose }: { onClose: () => void }) {\n  const contentRef = useRef<HTMLDivElement>(null)\n\n  // Suspense commits this effect only after the lazy picker's controls exist.\n  useEffect(() => {\n    const content = contentRef.current\n    const dialog = content?.closest('[role=\"dialog\"]')\n    if (document.activeElement === dialog) {\n      getShellFocusableElements(content)[0]?.focus()\n    }\n  }, [])\n\n  return (\n    <div ref={contentRef}>\n      <ThemePicker compact showMode showCustom={false} onChange={onClose} onModeChange={onClose} />\n    </div>\n  )\n}\n\nexport function ThemeQuickSwitcherPopover({\n  coords,\n  popoverRef,\n  triggerRef,\n  onClose,\n  onCustomize,\n}: ThemeQuickSwitcherPopoverProps) {\n  const { t } = useTranslation()\n  const restoreFocusRef = useRef(true)\n\n  useLayoutEffect(() => {\n    const dialog = popoverRef.current\n    if (!dialog) return\n    restoreFocusRef.current = true\n    if (!document.activeElement?.closest('[aria-modal=\"true\"]')) dialog.focus()\n\n    return () => {\n      const active = document.activeElement\n      const ownsFocus = !active || active === document.body || dialog.contains(active)\n      const anotherModal = document.querySelector('[role=\"dialog\"][aria-modal=\"true\"], [role=\"alertdialog\"][aria-modal=\"true\"]')\n      const trigger = triggerRef.current\n      if (\n        restoreFocusRef.current && ownsFocus && !anotherModal &&\n        isFocusRestorable(trigger) &&\n        getShellFocusableElements(trigger.parentElement).includes(trigger)\n      ) {\n        trigger.focus()\n      }\n    }\n  }, [popoverRef, triggerRef])\n\n  return createPortal(\n    <div\n      ref={popoverRef}\n      role=\"dialog\"\n      tabIndex={-1}\n      aria-label={t('theme.openPicker', 'Open theme picker')}\n      style={{\n        top: coords.top,\n        maxHeight: `max(0px, calc(100dvh - ${coords.top}px - 0.5rem - env(safe-area-inset-bottom, 0px)))`,\n        ...(coords.left !== undefined ? { left: coords.left } : {}),\n        ...(coords.right !== undefined ? { right: coords.right } : {}),\n      }}\n      className=\"fixed z-shell-panel w-theme-switcher max-w-shell-panel-viewport overflow-y-auto rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4 shadow-e3\"\n    >\n      <Suspense\n        fallback={\n",
        predecessor: "interface ThemeQuickSwitcherPopoverProps {\n  coords: { top: number; left?: number; right?: number }\n  popoverRef: RefObject<HTMLDivElement>\n  onClose: () => void\n  onCustomize: () => void\n}\n\nexport function ThemeQuickSwitcherPopover({\n  coords,\n  popoverRef,\n  onClose,\n  onCustomize,\n}: ThemeQuickSwitcherPopoverProps) {\n  const { t } = useTranslation()\n\n  return createPortal(\n    <div\n      ref={popoverRef}\n      role=\"dialog\"\n      aria-label={t('theme.openPicker', 'Open theme picker')}\n      style={{\n        top: coords.top,\n        ...(coords.left !== undefined ? { left: coords.left } : {}),\n        ...(coords.right !== undefined ? { right: coords.right } : {}),\n      }}\n      className=\"fixed z-shell-panel w-theme-switcher max-w-shell-panel-viewport rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4 shadow-e3\"\n    >\n      <Suspense\n        fallback={\n",
      },
      {
        current: "          />\n        }\n      >\n        <ThemePickerContent onClose={onClose} />\n      </Suspense>\n      <div className=\"mt-3 flex justify-end border-t border-[var(--border-subtle)] pt-3\">\n        <Button\n",
        predecessor: "          />\n        }\n      >\n        <ThemePicker compact showMode showCustom={false} onChange={onClose} onModeChange={onClose} />\n      </Suspense>\n      <div className=\"mt-3 flex justify-end border-t border-[var(--border-subtle)] pt-3\">\n        <Button\n",
      },
      {
        current: "          variant=\"ghost\"\n          size=\"sm\"\n          wrapLabel\n          onClick={() => {\n            restoreFocusRef.current = false\n            onCustomize()\n          }}\n          className={cn(\n            typography.role.label,\n            typography.color.secondary,\n",
        predecessor: "          variant=\"ghost\"\n          size=\"sm\"\n          wrapLabel\n          onClick={onCustomize}\n          className={cn(\n            typography.role.label,\n            typography.color.secondary,\n",
      },
    ],
  },
] as const

export function restoreAcceptedShellSource(file: string, text: string): string {
  const delta = acceptedShellDeltas.find(candidate => candidate.path === file)
  if (!delta) return text
  for (const [index, fragment] of delta.fragments.entries()) {
    if (text.split(fragment.current).length !== 2 || text.includes(fragment.predecessor)) {
      throw new Error(`Accepted shell fragment ${index} changed or ambiguous: ${file}`)
    }
    text = text.replace(fragment.current, fragment.predecessor)
  }
  if (createHash('sha256').update(text).digest('hex') !== delta.predecessorSHA256) {
    throw new Error(`Accepted shell predecessor fingerprint mismatch: ${file}`)
  }
  return text
}
