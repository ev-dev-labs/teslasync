//
//  LiveTelemetry.Views.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The presentational subviews composed by `LiveTelemetry`: the six telemetry panels
//  (drivetrain, climate, security, tyre pressure, media, navigation), the shared
//  telemetry row, the fan / volume progress bars, the mode / location chips, the
//  per-panel skeleton, and the section's loading / empty / error chrome. All consume
//  the P1/S10 facade and the shared P1/S9 tokens + shared components (TSGlassPanel,
//  TSBadge, TSSkeleton) — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web lucide glyphs map to SF
//  Symbols and the web text colours / Badge variants map to the design status tokens
//  via `LiveTelemetryTone`. The cyan→purple fan gradient and purple→cyan volume
//  gradient use the brand accent + power-series tokens.
//

import SwiftUI

// MARK: - Tone mapping (web text colour / Badge variant → design tokens)

extension LiveTelemetryTone {
    /// The status-token colour for value text (web `text-emerald-300`, …).
    var color: Color {
        switch self {
        case .neutral: Color.TS.textPrimary
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .muted: Color.TS.textMuted
        }
    }

    /// The shared `TSBadge` tone (web `Badge variant`).
    var badgeTone: TSTone {
        switch self {
        case .neutral, .muted: .neutral
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        }
    }
}

// MARK: - Shared row / skeleton (web `TelemetryRow` / `SkeletonRows`)

/// A label-left / value-right telemetry row (web `TelemetryRow`).
struct LiveTelemetryRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.bodySm.weight(.bold))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(label: label, value: value)))
    }
}

/// Four shimmer rows shown while a panel's snapshot is pending (web `SkeletonRows`).
struct LiveTelemetrySkeletonRows: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 18)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: LiveTelemetryStrings.string(
            "liveTelemetry.loadingA11y",
            "Loading live telemetry"
        )))
    }
}

// MARK: - Shared bar / chip primitives (web fan/volume bars + mode/location pills)

/// A thin proportional bar (web fan / volume track + gradient fill).
struct LiveTelemetryBar: View {
    let fraction: Double
    let gradient: [Color]

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                Capsule()
                    .fill(LinearGradient(colors: gradient, startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(0, min(1, fraction)) * proxy.size.width)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// A small tinted pill with a leading SF Symbol (web mode / location chip).
struct LiveTelemetryChip: View {
    let icon: String
    let text: String
    let tone: LiveTelemetryTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

/// The muted "no modes" / "no saved location" caption (web muted text branch).
struct LiveTelemetryMutedNote: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Panel chrome (web `GlassPanel` + header + skeleton fallback)

/// A telemetry panel shell — the glass surface, the icon + title header, and the
/// content-or-skeleton swap (web per-panel `data ? rows : <SkeletonRows/>`).
struct LiveTelemetryPanel<Content: View>: View {
    let icon: String
    let tint: Color
    let title: String
    let showsContent: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if showsContent {
                    content()
                } else {
                    LiveTelemetrySkeletonRows()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: title.uppercased())
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

// MARK: - Section grid (web responsive `grid-cols-1 sm:2 lg:3`)

/// The responsive panel grid — the native equivalent of the web 1/2/3-column grid.
struct LiveTelemetryGrid: View {
    let resolved: LiveTelemetryResolved

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            LiveDrivetrainPanel(projection: resolved.drivetrain)
            LiveClimatePanel(projection: resolved.climate)
            LiveSecurityPanel(projection: resolved.security)
            LiveTirePressurePanel(projection: resolved.tire)
            LiveMediaPanel(projection: resolved.media)
            LiveNavigationPanel(projection: resolved.navigation)
        }
    }
}

// MARK: - Section chrome (P4 leaf empty / error states)

/// The empty render (resolved, no telemetry at all): a friendly state, never a blank
/// section.
struct LiveTelemetryEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: LiveTelemetryStrings.string("liveTelemetry.empty", "No live telemetry yet."))
            } icon: {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct LiveTelemetryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: LiveTelemetryStrings.string("liveTelemetry.errorTitle", "Couldn't load live telemetry"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: LiveTelemetryStrings.string("liveTelemetry.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: LiveTelemetryStrings.string("liveTelemetry.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
