---
description: "Add mobile bottom tab bar for quick navigation on small screens"
---

# Mobile Bottom Tab Bar

## Problem

On mobile, the only navigation is a hamburger menu that slides in a full sidebar.
This requires 2 taps to reach any page (hamburger → item). Most mobile apps use
a bottom tab bar for the 4-5 most important sections, with the sidebar for the rest.

## Current State

```
web/src/components/layout/Layout.tsx
```

- Desktop: Static 256px sidebar (always visible at `lg:` breakpoint)
- Mobile: Hamburger icon in top bar → slide-in sidebar overlay
- No bottom tab bar

## Task

### Step 1: Create BottomTabBar Component

Create `web/src/components/layout/BottomTabBar.tsx`:

```tsx
const TABS = [
  { path: '/',           icon: Home,       label: 'Home' },
  { path: '/driving',    icon: Car,        label: 'Drives' },
  { path: '/commands',   icon: Zap,        label: 'Commands' },
  { path: '/alerts',     icon: Bell,       label: 'Alerts' },
  { path: '/settings',   icon: Settings,   label: 'Settings' },
];
```

Design:
- Fixed to bottom, full width, `z-50`
- Glassmorphic background: `bg-black/80 backdrop-blur-xl border-t border-white/[0.06]`
- 5 tabs with icon + label (label hidden when not active to save space)
- Active tab has neon accent color, others are `text-white/40`
- Safe area padding: `pb-safe` for iOS notch devices
- Only visible on mobile: `lg:hidden`
- Height: 56-64px

```tsx
export function BottomTabBar() {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden
      bg-black/80 backdrop-blur-xl border-t border-white/[0.06]
      flex items-center justify-around px-2 pb-safe h-14">
      {TABS.map(tab => {
        const isActive = location.pathname === tab.path ||
          (tab.path !== '/' && location.pathname.startsWith(tab.path));
        const Icon = tab.icon;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-lg transition-colors min-w-[48px]',
              isActive ? 'text-[var(--theme-primary)]' : 'text-white/40'
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{t(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

### Step 2: Mount in Layout

In `Layout.tsx`, add the BottomTabBar after the main content area:

```tsx
<main className="... pb-16 lg:pb-0">  {/* add bottom padding on mobile */}
  {children}
</main>
<BottomTabBar />
```

The `pb-16` (64px) on mobile prevents content from being hidden behind the tab bar.
The `lg:pb-0` removes it on desktop where the tab bar is hidden.

### Step 3: Adjust Main Content Padding

Currently the main content has a top spacer for the mobile header. Add bottom
spacer for the tab bar:

```tsx
// In Layout.tsx, update the main content wrapper
className="flex-1 overflow-y-auto pb-16 lg:pb-0"
```

### Step 4: Hide Hamburger Items That Are in Tab Bar

In the mobile sidebar, the 5 tabbed items should be de-emphasized (grayed out
or hidden) since they're now accessible from the tab bar. This avoids confusing
duplicate navigation. Keep them in the sidebar for discoverability but style them
with `opacity-50` on mobile.

### Step 5: Active Indicator Animation

Add a subtle active indicator — a small dot or line under the active icon:

```tsx
{isActive && (
  <div className="absolute -bottom-0.5 h-0.5 w-4 rounded-full bg-[var(--theme-primary)]" />
)}
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Tab bar visible only on mobile (below `lg:` breakpoint)
- [ ] Tab bar hidden on desktop
- [ ] All 5 tabs navigate to correct pages
- [ ] Active tab has accent color
- [ ] Content doesn't overlap with tab bar (bottom padding)
- [ ] Tab bar respects iOS safe area (no content behind home indicator)
- [ ] 44×44px minimum touch targets on each tab

## Commit

```bash
git add -A
git commit -m "feat(web): add mobile bottom tab bar for quick navigation

- Create BottomTabBar with 5 primary sections (Home, Drives, Commands, Alerts, Settings)
- Show only on mobile (lg:hidden), glassmorphic design
- Add safe area padding for iOS notch devices
- Adjust main content padding to prevent overlap
- Active tab indicator with theme accent color"
```
