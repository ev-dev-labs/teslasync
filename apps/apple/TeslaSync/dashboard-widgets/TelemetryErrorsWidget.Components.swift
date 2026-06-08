//
//  TelemetryErrorsWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  The small presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (the same tokens the
//  shared `TSStatusBadge` / `TSBadge` / `TSFreshnessIndicator` use). They are
//  authored locally — rather than reusing the `LocalizedStringKey`-only shared
//  components — so every label resolves through the per-surface
//  `TelemetryErrorsStrings` table (P1/S10) with the web `t(key, default)`
//  fallback, mirroring how the sibling `MQTTStatusWidget` builds its chips over
//  the same tokens.
//

import SwiftUI

// MARK: - Status badge (web `<Badge variant={statusBadge}>{statusLabel}</Badge>`)

/// The Errors/Healthy verdict pill: a tone-colored word inside a tonal, bordered
/// capsule. Mirrors the web `Badge` (`@/components/ui`) `danger` (red) /
/// `success` (green) variants used for the fleet-health badge.
struct TelemetryStatusBadge: View {
    let status: TelemetryErrorsStatus
    var emphasized = false

    private var tone: Color {
        switch status {
        case .errors: Color.TS.statusDanger
        case .healthy: Color.TS.statusSuccess
        }
    }

    var body: some View {
        Text(verbatim: status.label)
            .font(emphasized ? Font.TS.caption : Font.TS.label)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, emphasized ? 4 : 2)
            .background(tone.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .frame(minHeight: emphasized ? 28 : 0)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: status.label))
    }
}

// MARK: - "recent" badge (web `<Badge variant="danger" size="sm" dot>recent</Badge>`)

/// The small red "recent" chip with a leading dot, flagging rows whose last
/// sighting is inside the one-hour window. Mirrors the web danger `Badge` with
/// the `dot` + `size="sm"` props.
struct TelemetryRecentBadge: View {
    private var tone: Color {
        Color.TS.statusDanger
    }

    var body: some View {
        HStack(spacing: 3) {
            Circle().fill(tone).frame(width: 5, height: 5)
            TelemetryErrorsStrings.text("widget.telemetryErrors.recent", "recent")
                .font(Font.TS.label)
                .fontWeight(.medium)
                .foregroundStyle(tone)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(tone.opacity(0.16), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (web `<DataFreshness>` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + SF-symbol +
/// relative-time word, tappable to refresh. A native port of the web
/// `DataFreshness` (`@/components/data-display`) four states plus an explicit
/// `offline` case. Hides its text in `compact` mode (web `compact` = title-less
/// widget), exactly like the web chip.
struct TelemetryFreshnessChip: View {
    let freshness: TelemetryErrorsFreshness
    let updatedAt: Date?
    var compact = false
    var onRefresh: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    private var tone: Color {
        switch freshness {
        case .live: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .live, .stale: "wifi"
        case .fetching: "arrow.clockwise"
        case .error, .offline: "wifi.slash"
        }
    }

    /// The relative-time / status word (web `relativeTime`): the relative
    /// timestamp when live/stale, "updating…" while fetching, "error" on error,
    /// and "Offline" when disconnected.
    private var label: String {
        switch freshness {
        case .fetching:
            TelemetryErrorsStrings.string("widget.telemetryErrors.updating", "updating…")
        case .error:
            TelemetryErrorsStrings.string("widget.telemetryErrors.errorChip", "error")
        case .offline:
            TelemetryErrorsStrings.string("widget.telemetryErrors.offline", "Offline")
        case .live, .stale:
            TelemetryErrorsWidgetFormat.relativeText(for: updatedAt)
        }
    }

    private var isSpinning: Bool {
        freshness == .fetching && !reduceMotion
    }

    var body: some View {
        let chip = HStack(spacing: compact ? 3 : 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Image(systemName: symbol)
                .font(.system(size: compact ? 9 : 10, weight: .semibold))
                .rotationEffect(.degrees(isSpinning && spin ? 360 : 0))
            if !compact {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .monospacedDigit()
            }
        }
        .foregroundStyle(tone)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .onAppear { startSpinIfNeeded() }
        .onChange(of: freshness) { _, _ in startSpinIfNeeded() }

        if let onRefresh {
            Button(action: onRefresh) { chip }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isButton)
        } else {
            chip
        }
    }

    private var accessibilityLabel: String {
        onRefresh != nil
            ? TelemetryErrorsStrings.string("widget.telemetryErrors.refresh", "Refresh")
            : label
    }

    private func startSpinIfNeeded() {
        guard isSpinning else {
            spin = false
            return
        }
        spin = false
        withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { spin = true }
    }
}

// MARK: - Feed row (web aggregated error row)

/// One aggregated error entry: the VIN (monospaced), an optional "recent" badge,
/// the error code, the ×count, and the relative last-seen time. Mirrors the web
/// row (`flex items-center gap-2 rounded-lg bg-white/[0.03] …`).
struct TelemetryErrorFeedRow: View {
    let aggregate: TelemetryErrorAggregate
    var now = Date()

    private var isRecent: Bool {
        TelemetryErrorsWidgetProjection.isRecent(aggregate.lastSeen, now: now)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: aggregate.vin)
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if isRecent { TelemetryRecentBadge() }
                }
                Text(verbatim: aggregate.errorCode)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: "×\(TelemetryErrorsWidgetFormat.int(aggregate.count))")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: TelemetryErrorsWidgetFormat.relativeText(for: aggregate.lastSeen, now: now))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            .layoutPriority(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TelemetryErrorsWidgetAccessibility.rowLabel(
            for: aggregate,
            isRecent: isRecent,
            now: now
        )))
    }
}

// MARK: - Error feed (web scrollable error feed)

/// The scrollable aggregated-error feed. Renders the friendly "No errors
/// recorded" line when the aggregation is empty (web `aggregated.length === 0`),
/// never a blank panel.
struct TelemetryErrorFeed: View {
    let aggregates: [TelemetryErrorAggregate]
    var now = Date()

    var body: some View {
        if aggregates.isEmpty {
            VStack {
                Spacer(minLength: 0)
                TelemetryErrorsStrings.text("widget.telemetryErrors.noErrors", "No errors recorded")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
        } else {
            ScrollView {
                LazyVStack(spacing: TSSpacing.xs) {
                    ForEach(Array(aggregates.enumerated()), id: \.offset) { _, aggregate in
                        TelemetryErrorFeedRow(aggregate: aggregate, now: now)
                    }
                }
            }
        }
    }
}

// MARK: - Empty state (web `<EmptyState message="No telemetry error data" />`)

/// The full-size "no telemetry error data" empty view shown when both source
/// lists are empty (web `!hasData`). Never a blank panel.
struct TelemetryErrorsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TelemetryErrorsStrings.text("widget.telemetryErrors.noData", "No telemetry error data")
            } icon: {
                Image(systemName: "exclamationmark.circle")
            }
        } description: {
            TelemetryErrorsStrings.text("widget.telemetryErrors.emptyHint", "Waiting for Fleet Telemetry data.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
