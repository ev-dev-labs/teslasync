//
//  Pagination.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The public API of the table pagination controls — the SwiftUI parity of `components/ui/Pagination.tsx`.
//  The web source is a controlled `<nav aria-label="Pagination">` that pairs a visible-window summary (+ an
//  optional rows-per-page `<select>`) on the leading edge with a first / previous / page-indicator / next /
//  last button cluster on the trailing edge, stacking vertically on narrow widths and sitting in a row on
//  wider ones (`flex-col sm:flex-row`). The native peer is ``PaginationView``: it binds to the
//  ``PaginationController`` (P1/S8), composes the ``PaginationShowingLabel`` / ``PaginationPageSizeMenu`` /
//  ``PaginationButton`` / ``PaginationPageIndicator`` subviews, and reproduces the responsive layout with a
//  `ViewThatFits` (single row when it fits, stacked otherwise). The whole control is a VoiceOver navigation
//  container named by the resolved nav label; the "showing X–Y of Z" copy is re-announced politely on change
//  (the web `aria-live="polite"`). The surface binds through the controller for the once-only `view.opened`
//  telemetry (P1/S11). No networking, no Tailwind ports.
//

import SwiftUI

// MARK: - PaginationView (web component root)

/// The table pagination controls — the SwiftUI parity of the web `<Pagination>`. It renders the
/// visible-window summary (and, when the controller carries a page-size callback, the rows-per-page
/// selector) beside the first / previous / page-indicator / next / last button cluster, laid out as a single
/// row when the width allows and stacked otherwise (the web `flex-col sm:flex-row`). Emits `view.opened`
/// once on first appear.
@MainActor
public struct PaginationView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        PaginationSurface.slug
    }

    private let controller: PaginationController

    public init(controller: PaginationController) {
        self.controller = controller
    }

    public var body: some View {
        ViewThatFits(in: .horizontal) {
            singleRowLayout
            stackedLayout
        }
        .padding(.top, PaginationLayout.topPadding)
        .onChange(of: controller.showingText) { _, updated in
            AccessibilityNotification.Announcement(updated).post()
        }
        .onAppear { controller.start() }
        .onDisappear { controller.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: controller.navAccessibilityLabel))
    }

    // MARK: layouts (web `flex-col sm:flex-row`)

    /// The wide layout — leading copy group, flexible gap, trailing button cluster (web `sm:flex-row`).
    private var singleRowLayout: some View {
        HStack(alignment: .center, spacing: PaginationLayout.sectionSpacing) {
            leadingGroup
            Spacer(minLength: PaginationLayout.sectionSpacing)
            buttonCluster
        }
    }

    /// The narrow layout — copy group stacked above the button cluster, the cluster trailing-aligned (web
    /// `flex-col` + the cluster's `self-end`).
    private var stackedLayout: some View {
        VStack(alignment: .leading, spacing: PaginationLayout.sectionSpacing) {
            leadingGroup
            buttonCluster
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: groups

    /// The leading copy group — the visible-window summary and, when present, the rows-per-page selector
    /// (web the first `<div>` with the `<span aria-live>` + optional `<select>`).
    private var leadingGroup: some View {
        HStack(spacing: PaginationLayout.sectionSpacing) {
            PaginationShowingLabel(text: controller.showingText)
            if controller.showsPageSizeSelector {
                PaginationPageSizeMenu(
                    selected: controller.pageSize,
                    options: controller.pageSizeOptions,
                    accessibilityLabel: controller.pageSizeAccessibilityLabel,
                    optionLabel: controller.perPageLabel,
                    onSelect: controller.selectPageSize
                )
            }
        }
    }

    /// The trailing button cluster — first / previous / page-indicator / next / last (web the second
    /// `<div>`). Each button's enabled state mirrors the web disabled predicates carried by the projection.
    private var buttonCluster: some View {
        let proj = controller.projection
        return HStack(spacing: PaginationLayout.controlSpacing) {
            PaginationButton(
                symbol: PaginationSymbol.first,
                label: controller.firstAccessibilityLabel,
                isEnabled: proj.canGoToFirst,
                action: controller.goToFirst
            )
            PaginationButton(
                symbol: PaginationSymbol.previous,
                label: controller.previousAccessibilityLabel,
                isEnabled: proj.canGoToPrevious,
                action: controller.goToPrevious
            )
            PaginationPageIndicator(
                text: controller.pageIndicatorText,
                accessibilityLabel: controller.currentPageAccessibilityLabel
            )
            PaginationButton(
                symbol: PaginationSymbol.next,
                label: controller.nextAccessibilityLabel,
                isEnabled: proj.canGoToNext,
                action: controller.goToNext
            )
            PaginationButton(
                symbol: PaginationSymbol.last,
                label: controller.lastAccessibilityLabel,
                isEnabled: proj.canGoToLast,
                action: controller.goToLast
            )
        }
    }
}
