//
//  ServiceHealthSection.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  The system-status "Service Health" surface — the SwiftUI parity of
//  features/system/components/status/ServiceHealthSection.tsx. The web source is an
//  `AccordionSection` (a collapsible glass panel with a Satellite icon, a title, a
//  description, and an Enabled/Disabled + "{n} streaming" badge cluster) wrapping the
//  Fleet Telemetry body: a four-tile metric grid (Mode · Vehicles Connected · Total
//  Signals · Avg Signals/s) over a streaming-vehicles `DataTable`. This view
//  reproduces that composition + chrome, binds through `ServiceHealthModel` (P1/S8 —
//  no networking here), renders every state, and localizes through
//  `ServiceHealthStrings` (P1/S10).
//
//  States (every one renders — no hidden surface):
//    • loading — the web `<Skeleton className="h-48"/>`.
//    • content — the metric grid over the vehicle table (or the table's inline
//                "No vehicles connected" message — the section is never hidden).
//    • empty   — the web `!data` `EmptyState` ("No telemetry data available").
//    • error   — a query failure → the web `QueryError` with a retry affordance.
//    • stale / offline — the orthogonal `connection` axis → a freshness chip + banner
//                with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

/// The system-status Service Health feature view. Holds the bound
/// `ServiceHealthModel`, renders the collapsible accordion chrome, and drives the
/// metric grid + vehicle table through the resolved render phase.
public struct ServiceHealthSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ServiceHealthSurface.slug

    @State private var model: ServiceHealthModel
    @State private var isExpanded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer — inject a source-backed model (production app) or an
    /// `InMemoryServiceHealthSource`-backed one (previews / tests).
    public init(model: ServiceHealthModel, initiallyExpanded: Bool = false) {
        _model = State(initialValue: model)
        _isExpanded = State(initialValue: initiallyExpanded)
    }

    /// Convenience initializer over a bare `ServiceHealthSource`.
    public init(
        source: any ServiceHealthSource,
        telemetry: any ServiceHealthTelemetry = OSLogServiceHealthTelemetry(),
        initiallyExpanded: Bool = false
    ) {
        _model = State(initialValue: ServiceHealthModel(source: source, telemetry: telemetry))
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
                            if model.connection != .live {
                                ServiceHealthConnectivityBanner(connection: model.connection)
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
            if reduceMotion {
                isExpanded.toggle()
            } else {
                withAnimation(.easeInOut(duration: TSMotion.fastDuration)) { isExpanded.toggle() }
            }
        } label: {
            HStack(spacing: TSSpacing.md) {
                TSIconBox(systemName: "antenna.radiowaves.left.and.right", tone: .accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: ServiceHealthStrings.string("Service Health", "Service Health"))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: ServiceHealthStrings.string(
                        "Fleet Telemetry streaming status",
                        "Fleet Telemetry streaming status"
                    ))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                }
                Spacer(minLength: TSSpacing.sm)
                trailing
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .padding(TSSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: headerAccessibilityLabel))
        .accessibilityValue(Text(verbatim: isExpanded
                ? ServiceHealthStrings.string("a11y.expanded", "Expanded")
                : ServiceHealthStrings.string("a11y.collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: ServiceHealthStrings.string(
            "a11y.toggleHint",
            "Double tap to show or hide the service health details"
        )))
        .accessibilityAddTraits(.isButton)
    }

    /// The header accessory cluster: the Enabled/Disabled + "{n} streaming" badges
    /// (web `badges`, shown only when a populated snapshot is on screen) and the
    /// stale / offline freshness chip (the P4 contract, shown only when not live).
    private var trailing: some View {
        HStack(spacing: TSSpacing.sm) {
            if model.resolved.showHeaderBadges {
                ServiceHealthHeaderBadges(resolved: model.resolved)
            }
            ServiceHealthFreshnessChip(connection: model.connection)
        }
    }

    private var headerAccessibilityLabel: String {
        let title = ServiceHealthStrings.string("Service Health", "Service Health")
        let description = ServiceHealthStrings.string(
            "Fleet Telemetry streaming status",
            "Fleet Telemetry streaming status"
        )
        return ServiceHealthAccessibility.sectionSummary(
            title: "\(title). \(description)",
            enabled: ServiceHealthStrings.string(
                model.resolved.enabled ? "Enabled" : "Disabled",
                model.resolved.enabled ? "Enabled" : "Disabled"
            ),
            streamingCount: model.resolved.streamingCount,
            hasVehicles: model.resolved.hasVehicles,
            streamingLabel: ServiceHealthStrings.string("streaming", "streaming")
        )
    }

    // MARK: Content states (web body + the P4 leaf contract)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ServiceHealthLoadingView()
        case let .error(message):
            ServiceHealthErrorView(message: message) { model.refresh() }
        case .empty:
            ServiceHealthEmptyView()
        case .content:
            ServiceHealthContent(resolved: model.resolved)
        }
    }
}
