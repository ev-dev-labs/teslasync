//
//  ClimatePanel.States.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The non-content state chrome composed by `ClimatePanel`: the initial-fetch loading skeleton,
//  the empty state (web `EmptyState`), the QueryError-equivalent failure with retry, the freshness
//  chip, and the stale / offline connectivity banner — plus the small wrapping `Layout` the badge
//  row uses (web `flex-wrap`). All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 tokens; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Loading skeleton (native chrome — initial fetch)

/// The in-flight skeleton: two temperature-card blocks over three row blocks and a fan block,
/// mirroring the resolved panel layout. Respects Reduce Motion via the shared `TSSkeleton`.
struct CabinClimatePanelLoadingContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(height: 64, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 64, cornerRadius: TSRadius.lg)
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 16, cornerRadius: TSRadius.sm)
            }
            TSSkeleton(height: 16, cornerRadius: TSRadius.sm)
        }
        .accessibilityElement()
        .accessibilityLabel(
            CabinClimatePanelStrings.text("telemetry.climate.loadingA11y", "Loading climate status")
        )
    }
}

// MARK: - Empty state (web `<EmptyState message="No climate data available" />`)

/// The friendly empty state shown when no climate snapshot is known (web `EmptyState`). Uses the
/// Apple-idiomatic `ContentUnavailableView` so the surface never reads as a blank panel.
struct CabinClimatePanelEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: CabinClimatePanelStrings.string(
                    "telemetry.noClimateData",
                    "No climate data available"
                ))
            } icon: {
                Image(systemName: "thermometer.medium.slash")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (web `QueryError`): a danger glyph, the failure title, the
/// underlying message, and a retry affordance wired to the model.
struct CabinClimatePanelErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CabinClimatePanelStrings.text("telemetry.climate.errorTitle", "Couldn't load climate data")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                CabinClimatePanelStrings.text("telemetry.climate.retry", "Retry")
            }
            .accessibilityLabel(CabinClimatePanelStrings.text("telemetry.climate.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only when the
/// source is not live, so the normal panel stays as clean as the web source.
struct CabinClimatePanelFreshnessChip: View {
    let connection: CabinClimatePanelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: CabinClimatePanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: CabinClimatePanelStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: CabinClimatePanelConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "telemetry.climate.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "telemetry.climate.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "telemetry.climate.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not live, so the
/// last-known snapshot is clearly labeled as cached. A manual refresh affordance accompanies the
/// stale state (offline has no connectivity to retry over).
struct CabinClimatePanelConnectivityBanner: View {
    let connection: CabinClimatePanelConnection
    let onRefresh: () -> Void

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(descriptor.tone)
                .accessibilityHidden(true)
            Text(verbatim: CabinClimatePanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if connection == .stale {
                TSButton(variant: .ghost, size: .small, action: onRefresh) {
                    CabinClimatePanelStrings.text("telemetry.climate.refresh", "Refresh")
                }
                .accessibilityLabel(CabinClimatePanelStrings.text("telemetry.climate.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            descriptor.tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let systemImage: String
    }

    private static func descriptor(for connection: CabinClimatePanelConnection) -> Descriptor {
        switch connection {
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "telemetry.climate.offlineBanner",
                fallback: "Offline — showing last known climate status",
                systemImage: "wifi.slash"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "telemetry.climate.staleBanner",
                fallback: "Reconnecting — climate status may be stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                key: "telemetry.climate.live",
                fallback: "Live",
                systemImage: "checkmark.circle"
            )
        }
    }
}

// MARK: - Flow layout (web `flex-wrap` for the badges)

/// A minimal wrapping layout: lays children left-to-right, wrapping to the next line when the
/// available width is exceeded (web `flex flex-wrap gap-2`). Keeps the badges from clipping under
/// large Dynamic Type sizes.
struct CabinClimatePanelFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = computeRows(maxWidth: maxWidth, subviews: subviews)
        let width = proposal.width ?? rows.map(\.width).max() ?? 0
        let height = rows.reduce(into: CGFloat(0)) { partial, row in
            partial += row.height
        } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let rows = computeRows(maxWidth: bounds.width, subviews: subviews)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func computeRows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let projected = current.width == 0 ? size.width : current.width + spacing + size.width
            if projected > maxWidth, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
                current.indices = [index]
                current.width = size.width
                current.height = size.height
            } else {
                current.indices.append(index)
                current.width = current.indices.count == 1 ? size.width : current.width + spacing + size.width
                current.height = max(current.height, size.height)
            }
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
