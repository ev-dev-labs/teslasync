//
//  JourneyDetailsPanel.Views.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  The presentational chrome composed by `JourneyDetailsPanel`: the "Journey Details" header, the
//  responsive Start/Destination endpoint grid, the freshness chip, the stale/offline banner, the
//  loading skeleton, and the inline empty / error states. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Header (web `<h3>` Navigation glyph + "Journey Details")

/// The panel header: the cyan navigation glyph + the localized "Journey Details" title, with the
/// freshness chip trailing when the bound source is fetching or not live. Marked as an accessibility
/// header so VoiceOver can jump to it.
struct JourneyDetailsHeader: View {
    let connection: JourneyConnection
    let isFetching: Bool
    let updatedAt: Date?
    let showsChip: Bool

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "location.north.fill")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            JourneyDetailsStrings.text("driveDetail.journeyDetails", "Journey Details")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsChip {
                JourneyDetailsFreshnessChip(
                    connection: connection,
                    isFetching: isFetching,
                    updatedAt: updatedAt
                )
            }
        }
    }
}

// MARK: - Content (web `grid grid-cols-1 sm:grid-cols-2`)

/// The resolved journey grid: the Start + Destination columns, laid out one-per-row on a compact
/// width and side-by-side once there is room (the web `grid-cols-1 sm:grid-cols-2`).
struct JourneyDetailsContent: View {
    let projection: JourneyDetailsProjection

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .topLeading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            JourneyEndpointColumn(endpoint: projection.start)
            JourneyEndpointColumn(endpoint: projection.destination)
        }
    }
}

// MARK: - Endpoint column (web Start / Destination `<div>`)

/// One endpoint column: a tinted icon + label, the bold primary location line (monospaced for a
/// coordinate, the web `font-mono`), the muted vehicle-local timestamp, and the secondary battery
/// line. The whole column is one VoiceOver element reading the composed summary.
struct JourneyEndpointColumn: View {
    let endpoint: JourneyEndpoint

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: iconName)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                Text(verbatim: JourneyDetailsStrings.string(endpoint.labelKey, endpoint.labelFallback))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(tint)
            }
            Text(verbatim: endpoint.primaryText)
                .font(primaryFont)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: endpoint.timestampText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: batteryLine)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: JourneyDetailsAccessibility.summary(for: endpoint)))
    }

    private var iconName: String {
        switch endpoint.tone {
        case .start: "mappin.circle.fill"
        case .destination: "flag.fill"
        }
    }

    private var tint: Color {
        switch endpoint.tone {
        case .start: Color.TS.statusSuccess
        case .destination: Color.TS.statusDanger
        }
    }

    /// Bold body type, switched to a monospaced face for coordinate lines (web `font-mono`).
    private var primaryFont: Font {
        endpoint.isCoordinate ? Font.TS.body.monospaced() : Font.TS.body
    }

    /// "Battery: 82%" — the localized label + the projected value + the web-hardcoded "%".
    private var batteryLine: String {
        let label = JourneyDetailsStrings.string("driveDetail.battery", "Battery")
        return "\(label): \(endpoint.batteryValue)%"
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a localized
/// label, and an optional relative "updated" stamp. Shown only while fetching or when not live.
struct JourneyDetailsFreshnessChip: View {
    let connection: JourneyConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return JourneyDetailsStrings.string("driveDetail.updating", "Updating")
        }
        switch connection {
        case .live: return JourneyDetailsStrings.string("driveDetail.live", "Live")
        case .stale: return JourneyDetailsStrings.string("driveDetail.stale", "Stale")
        case .offline: return JourneyDetailsStrings.string("driveDetail.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (cached journey shown stale / offline)

/// A slim banner above cached content when the bound source is stale or offline, so the displayed
/// journey is never mistaken for a live read.
struct JourneyConnectivityBanner: View {
    let connection: JourneyConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: iconName)
                .font(Font.TS.caption)
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.vertical, TSSpacing.xs)
        .padding(.horizontal, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var iconName: String {
        connection == .offline ? "wifi.slash" : "clock.arrow.circlepath"
    }

    private var message: String {
        connection == .offline
            ? JourneyDetailsStrings.string("driveDetail.offlineBanner", "Offline — showing the last saved journey")
            : JourneyDetailsStrings.string("driveDetail.staleBanner", "Showing a cached journey while refreshing")
    }
}

// MARK: - Loading skeleton (web shell skeleton chrome)

/// The initial-fetch skeleton: two endpoint silhouettes (label + primary + timestamp + battery bars)
/// in the same responsive grid as the resolved content. Reduce-Motion safe via the shared
/// `TSSkeleton`.
struct JourneyDetailsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .topLeading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            column
            column
        }
        .accessibilityElement()
        .accessibilityLabel(JourneyDetailsStrings.text("driveDetail.loading", "Loading journey details"))
    }

    private var column: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSkeleton(width: 90, height: 12)
            TSSkeleton(width: 180, height: 16)
            TSSkeleton(width: 130, height: 10)
            TSSkeleton(width: 70, height: 10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Empty (journey unavailable — never a blank box)

/// The empty branch (no drive resolved): a friendly glyph + caption so the panel is never a blank box.
struct JourneyDetailsEmpty: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "map")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: JourneyDetailsStrings.string("driveDetail.unavailable", "Journey details unavailable"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` equivalent with retry)

/// The error branch: a danger glyph, the failure copy + the underlying message, and a Retry control
/// wired to `model.refresh()` — the panel parity of the web `QueryError`.
struct JourneyDetailsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: JourneyDetailsStrings.string(
                    "driveDetail.errorTitle",
                    "Couldn't load journey details"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            retryButton
        }
    }

    private var retryButton: some View {
        let title = JourneyDetailsStrings.string("driveDetail.retry", "Retry")
        return TSButton(variant: .secondary, size: .small, action: onRetry) {
            Text(verbatim: title).lineLimit(1)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}
