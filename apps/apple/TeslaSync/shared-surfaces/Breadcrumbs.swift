//
//  Breadcrumbs.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  The public API of the breadcrumb trail — the SwiftUI parity of components/layout/Breadcrumbs.tsx:
//
//      export function Breadcrumbs({ items, homeHref = '/', homeAriaLabel }) {
//        const { t } = useTranslation();
//        if (items.length <= 1) return null;            // self-suppress for a top-level page
//        return <nav aria-label={t('a11y.breadcrumb')}> // Home link + chevron-separated chain
//      }
//
//  The native peer binds a ``BreadcrumbsModel`` (the host-supplied items, web `items`), projects it for the
//  active horizontal size class, and renders either the trail (``BreadcrumbsTrailView``) or, for a `<= 1`
//  item input, the empty slot (``BreadcrumbsEmptySlot``) — the faithful peer of the web `return null`.
//  Navigation is surfaced as callbacks (``onHome`` / ``onSelect``), the idiomatic Apple peer of the web
//  `<PrefetchLink to>`; the host routes them to its navigation stack so tapping the Home glyph or an
//  ancestor crumb navigates exactly as the web links do.
//
//  States — every branch the web component has, all rendered (no hidden surfaces):
//    • rendered   — a multi-item trail on a regular width → the full chevron-separated chain.
//    • collapsed  — the same trail on a compact width → first crumb · ellipsis · current leaf (web mobile
//                   `hidden sm:inline` + `…`).
//    • suppressed — a single-item trail (web `items.length <= 1 → null`) → the empty slot.
//    • empty      — no input items → the empty slot.
//  There are no loading / error / stale / offline branches: the web component reads no remote data (its
//  only hook is `useTranslation`; the items arrive as props). See Breadcrumbs.Adapter.swift.
//

import SwiftUI

// MARK: - Breadcrumbs (the shared surface)

/// The breadcrumb trail — the SwiftUI parity of `Breadcrumbs.tsx`. Mount one instance in a page header /
/// detail chrome and feed it the ordered trail items; it self-suppresses for a top-level page (`<= 1`
/// item) and otherwise renders the Home link + the chevron-separated chain, collapsing the middle on a
/// compact width. Tapping the Home glyph or an ancestor crumb invokes ``onHome`` / ``onSelect`` so the host
/// can navigate (web `<PrefetchLink to>`).
public struct Breadcrumbs: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BreadcrumbsSurface.slug
    }

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var model: BreadcrumbsModel
    private let onSelect: (BreadcrumbsCrumb) -> Void
    private let onHome: () -> Void

    /// Designated initializer binding a pre-built model — the host / preview / test seam. `onSelect` fires
    /// with the tapped ancestor crumb (read `crumb.href` to navigate, web `<PrefetchLink to={item.href}>`);
    /// `onHome` fires for the leading Home glyph (web `to={homeHref}`).
    public init(
        model: BreadcrumbsModel,
        onSelect: @escaping (BreadcrumbsCrumb) -> Void = { _ in },
        onHome: @escaping () -> Void = {}
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
        self.onHome = onHome
    }

    /// Convenience initializer building the model from a fixed set of items — the ergonomic spelling of
    /// mounting `<Breadcrumbs items={...} homeAriaLabel={...} />`. `homeAccessibilityLabel` overrides the
    /// localized Home label (web `homeAriaLabel`).
    public init(
        items: [BreadcrumbsItem],
        homeAccessibilityLabel: String? = nil,
        onSelect: @escaping (BreadcrumbsCrumb) -> Void = { _ in },
        onHome: @escaping () -> Void = {}
    ) {
        self.init(
            model: BreadcrumbsModel(items: items, homeAccessibilityLabel: homeAccessibilityLabel),
            onSelect: onSelect,
            onHome: onHome
        )
    }

    public var body: some View {
        let resolved = model.resolved(isCompact: isCompact)
        Group {
            if resolved.isRendered {
                BreadcrumbsTrailView(
                    resolved: resolved,
                    homeAccessibilityLabel: model.homeAccessibilityLabel,
                    onSelect: onSelect,
                    onHome: onHome
                )
            } else {
                BreadcrumbsEmptySlot()
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    /// Whether the active horizontal size class is compact (web `< sm`) — drives the middle-item collapse.
    /// On macOS the size class resolves to regular, so the full chain is shown (and horizontally scrolls).
    private var isCompact: Bool {
        horizontalSizeClass == .compact
    }
}
