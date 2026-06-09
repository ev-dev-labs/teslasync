//
//  OperationsSection.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  The system-status Operations surface — the SwiftUI parity of
//  features/system/components/status/OperationsSection.tsx. The web source is an
//  `AccordionSection` (a collapsible glass panel with an icon, title, description, and a
//  success-rate badge) wrapping two regions: the Notification Delivery block (four
//  metric cards + a success radial gauge + the recent-notifications table, or its empty
//  state) and the Audit Log block (the audit table, or its empty state). This view
//  reproduces that composition + chrome, binds through `OperationsModel` (P1/S8 — no
//  networking here), renders every state, and localizes through `OperationsStrings`
//  (P1/S10).
//
//  States (every one renders — no hidden surface):
//    • loading — any of the three queries loading → the web two-skeleton chrome.
//    • ready   — the delivery block (stats + gauge + table, or its empty state, the
//                section is never hidden) + the audit block (table or the web
//                `EmptyState`).
//    • error   — a query failure → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner with
//                a one-shot auto-refresh on the stale transition.
//

import SwiftUI

/// The system-status Operations feature view. Holds the bound `OperationsModel`, renders
/// the collapsible accordion chrome, and drives the delivery + audit regions through
/// their resolved view-state.
public struct OperationsSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OperationsSection"

    @State private var model: OperationsModel
    @State private var isExpanded: Bool

    /// Designated initializer — inject a source-backed model (production app) or an
    /// `InMemoryOperationsSource`-backed one (previews/tests).
    public init(model: OperationsModel, initiallyExpanded: Bool = false) {
        _model = State(initialValue: model)
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    /// Convenience initializer over a bare `OperationsSource`.
    public init(
        source: any OperationsSource,
        telemetry: any OperationsTelemetry = OSLogOperationsTelemetry(),
        initiallyExpanded: Bool = false
    ) {
        _model = State(initialValue: OperationsModel(source: source, telemetry: telemetry))
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                header
                if isExpanded {
                    TSFadeIn {
                        VStack(alignment: .leading, spacing: TSSpacing.lg) {
                            Divider().overlay(Color.TS.border)
                            toolbar
                            if model.connection != .live {
                                OperationsConnectivityBanner(connection: model.connection)
                            }
                            content
                        }
                        .padding(.top, TSSpacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Accordion header (web `AccordionSection` header row)

    private var header: some View {
        Button {
            withAnimation(.easeInOut(duration: TSMotion.fastDuration)) { isExpanded.toggle() }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "bell.badge")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: OperationsStrings.string("Operations", "Operations"))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: OperationsStrings.string(
                        "operations.description",
                        "Notification delivery and audit trail"
                    ))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: TSSpacing.sm)
                OperationsHeaderBadge(resolved: model.resolved)
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: headerAccessibilityLabel))
        .accessibilityValue(Text(verbatim: isExpanded
                ? OperationsStrings.string("a11y.expanded", "Expanded")
                : OperationsStrings.string("a11y.collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: OperationsStrings.string(
            "a11y.toggleHint",
            "Double tap to show or hide the operations details"
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var headerAccessibilityLabel: String {
        OperationsStrings.string("Operations", "Operations")
            + ", "
            + OperationsStrings.string("operations.description", "Notification delivery and audit trail")
    }

    // MARK: Freshness toolbar (native P4 leaf chrome)

    private var toolbar: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            OperationsFreshnessChip(connection: model.connection)
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: OperationsStrings.string("operations.refresh", "Refresh")))
        .accessibilityHint(Text(verbatim: OperationsStrings.string(
            "operations.refreshHint",
            "Reloads notification stats, recent notifications, and the audit log"
        )))
    }

    // MARK: Content states (web shell + the P4 leaf contract)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            OperationsLoadingView()
        case let .error(message):
            OperationsErrorView(message: message) { model.refresh() }
        case .ready:
            OperationsReadyContent(resolved: model.resolved)
        }
    }
}
