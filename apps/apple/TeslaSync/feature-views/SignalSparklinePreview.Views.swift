//
//  SignalSparklinePreview.Views.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  The presentational chrome composed by `SignalSparklinePreview`: the non-numeric
//  kind chip, the loading skeleton box, the "—" no-samples fallback, the compact
//  retry affordance, the trend line itself, and the stale/offline freshness dot.
//  Every state the web source renders has a peer here (plus the native error
//  envelope), so no surface is hidden. All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9); the trend maps the web `Sparkline`
//  (@/components/charts) onto the shared `TSSparkline`. No networking and no Tailwind
//  ports live here.
//

import SwiftUI

// MARK: - Non-numeric kind chip (web `<span>{valueKind}</span>`)

/// The compact `(kind)` chip shown for non-numeric signals (web string / time /
/// unknown). The token is the protocol-level kind identifier rendered verbatim (not
/// localized); the web `title` becomes a pointer `.help` and the VoiceOver summary.
struct SignalSparklineKindChip: View {
    let token: String
    let accessibilityText: String

    var body: some View {
        Text(verbatim: token.uppercased())
            .font(Font.TS.label)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .help(SignalSparklineStrings.nonNumericTitle(token))
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Loading box (web pulsing `width × height` skeleton)

/// The initial-fetch skeleton — the native parity of the web
/// `animate-pulse … style={{ width, height }}` box, via the shared `TSSkeleton`
/// (Reduce Motion respected) sized to the configured trend dimensions.
struct SignalSparklineLoadingBox: View {
    let width: CGFloat
    let height: CGFloat
    let accessibilityText: String

    var body: some View {
        TSSkeleton(width: width, height: height, cornerRadius: TSRadius.sm)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - No-samples fallback (web `—` with the "No samples in last hour" title)

/// The resolved-but-empty state: the web "—" glyph in muted text with the "No samples
/// in last hour" title (a pointer `.help` + the VoiceOver summary), plus the freshness
/// dot when the stream is not live. Never a blank box.
struct SignalSparklineEmptyDash: View {
    let connection: SignalSparklineConnection
    let accessibilityText: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "—")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .help(SignalSparklineStrings.noSamples)
            if connection != .live {
                SignalSparklineFreshnessDot(connection: connection)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Error affordance (web collapses to "—"; native adds an explicit retry)

/// The fetch-failure state with a retry affordance. The web preview has no dedicated
/// error branch (a failed query simply falls through to the "—" no-samples line); the
/// native load envelope surfaces a compact, tappable retry so the failure is
/// recoverable in place.
struct SignalSparklineErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: SignalSparklineStrings.retry)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(Color.TS.statusDanger.opacity(0.12), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(SignalSparklineStrings.errorTitle)
        .accessibilityLabel(Text(verbatim: SignalSparklineStrings.errorTitle))
        .accessibilityHint(Text(verbatim: SignalSparklineStrings.retry))
    }
}

// MARK: - Trend line (web `<Sparkline data color width height />`)

/// The populated trend — the web `Sparkline` mapped onto the shared `TSSparkline`
/// (Swift Charts), constrained to the configured width with the brand-palette color
/// index, and trailed by the freshness dot when the stream is not live.
struct SignalSparklineTrendView: View {
    let values: [Double]
    let colorIndex: Int
    let width: CGFloat
    let connection: SignalSparklineConnection
    let accessibilityText: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSSparkline(values: values, colorIndex: colorIndex)
                .frame(width: width)
            if connection != .live {
                SignalSparklineFreshnessDot(connection: connection)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Freshness dot (stale / offline)

/// A small tinted dot trailing the trend / dash when the bound source is stale
/// (warning tone) or offline (muted tone). The VoiceOver freshness is folded into the
/// surface summary, so the dot itself is decorative; the web `title` is mirrored as a
/// pointer `.help`.
struct SignalSparklineFreshnessDot: View {
    let connection: SignalSparklineConnection

    var body: some View {
        Circle()
            .fill(tone)
            .frame(width: 6, height: 6)
            .help(label)
            .accessibilityHidden(true)
    }

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var label: String {
        connection == .offline ? SignalSparklineStrings.offline : SignalSparklineStrings.stale
    }
}
