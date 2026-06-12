//
//  SignalQueryControls.Chrome.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The shared chrome pieces the surface composes: the selected-signal chips (web flex-wrap pills +
//  remove), the inline fetch-error row with retry (web `QueryError` peer), the friendly empty note,
//  the P4 leaf freshness chip + connectivity banner, and the typed-value styling + type badge (web
//  `TYPE_BADGE_COLOR` / `TYPE_VALUE_COLOR`). All consume the P1/S10 facade + the shared P1/S9 tokens —
//  no networking, no raw hex.
//

import SwiftUI

// MARK: - Flow layout (web flex-wrap)

/// A minimal wrapping layout — the native equivalent of the web `flex flex-wrap` chip row. Lays
/// subviews left-to-right, wrapping to a new line when the proposed width is exceeded.
struct SignalQueryFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth, rowWidth > 0 {
                totalHeight += rowHeight + spacing
                totalWidth = max(totalWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        totalWidth = max(totalWidth, rowWidth - spacing)
        return CGSize(width: min(totalWidth, maxWidth), height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var pointX = bounds.minX
        var pointY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if pointX + size.width > bounds.minX + bounds.width, pointX > bounds.minX {
                pointX = bounds.minX
                pointY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: pointX, y: pointY), proposal: ProposedViewSize(size))
            pointX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Selected chips (web selected pills)

/// The selected-signal chips — the native parity of the web flex-wrap pill row: each chip shows the
/// mono signal name + a remove control (web `aria-label="Remove …"`), tinted with the brand accent.
struct SignalQueryFlowChips: View {
    let signals: [String]
    let onRemove: (String) -> Void

    var body: some View {
        SignalQueryFlowLayout(spacing: TSSpacing.xs) {
            ForEach(signals, id: \.self) { signal in
                SignalQueryChip(signal: signal, onRemove: onRemove)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One selected-signal chip with its remove control.
struct SignalQueryChip: View {
    let signal: String
    let onRemove: (String) -> Void

    private var removeLabel: String {
        SignalQueryControlsStrings.string("signalQuery.removeSignal", "Remove") + " \(signal)"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: signal)
                .font(Font.TS.caption)
                .monospaced()
                .foregroundStyle(Color.TS.accent)
            Button {
                onRemove(signal)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: removeLabel))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Inline error + empty note (web `QueryError` peer / empty)

/// The inline fetch-failure row with a retry affordance — the native peer of the web `QueryError`,
/// reused by the available-signals fetch and the results table.
struct SignalQueryInlineError: View {
    let message: String
    let onRetry: () -> Void

    private var title: String {
        SignalQueryControlsStrings.string("signalQuery.errorTitle", "Couldn't load")
    }

    private var retry: String {
        SignalQueryControlsStrings.string("signalQuery.retry", "Retry")
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
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
                Text(verbatim: retry)
            }
            .accessibilityLabel(Text(verbatim: retry))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// A friendly muted note — the native parity of an empty dropdown / "No results" surface, never a
/// blank box.
struct SignalQueryEmptyNote: View {
    let text: String
    var systemImage = "tray"

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Freshness chip + connectivity banner (P4 leaf)

/// The freshness chip — a state dot + label for the available-signals feed (web parity of the live /
/// stale / offline freshness affordance).
struct SignalQueryFreshnessChip: View {
    let connection: SignalQueryConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: SignalQueryControlsStrings.string("signalQuery.live", "Live")
        case .stale: SignalQueryControlsStrings.string("signalQuery.stale", "Stale")
        case .offline: SignalQueryControlsStrings.string("signalQuery.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// The connectivity banner shown when the feed is not live — the stale / offline leaf surface with a
/// one-shot auto-refresh (driven by the model) on the stale transition.
struct SignalQueryConnectivityBanner: View {
    let connection: SignalQueryConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? SignalQueryControlsStrings.string(
                "signalQuery.offlineBanner", "Offline — showing last known data"
            )
            : SignalQueryControlsStrings.string(
                "signalQuery.staleBanner", "Reconnecting — data may be stale"
            )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(isOffline ? Color.TS.textMuted : Color.TS.statusWarning)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            (isOffline ? Color.TS.textMuted : Color.TS.statusWarning).opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Typed-value styling (web `TYPE_BADGE_COLOR` / `TYPE_VALUE_COLOR`)

extension SignalQueryValueType {
    /// Web `TYPE_BADGE_COLOR`: num → cyan, str → green, bool → amber, null → neutral.
    var badgeTone: TSTone {
        switch self {
        case .num: .accent
        case .str: .success
        case .bool: .warning
        case .null: .neutral
        }
    }

    /// Web `TYPE_VALUE_COLOR` (toned-down body cell): num → cyan, str → emerald, bool → amber,
    /// null → muted.
    var valueColor: Color {
        switch self {
        case .num: Color.TS.accent
        case .str: Color.TS.statusSuccess
        case .bool: Color.TS.statusWarning
        case .null: Color.TS.textMuted
        }
    }
}

/// The typed-value badge (web `<Badge color>{vt}</Badge>`) — a tinted capsule carrying the type token.
struct SignalTypeBadge: View {
    let type: SignalQueryValueType

    var body: some View {
        Text(verbatim: type.rawValue)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(type.badgeTone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(type.badgeTone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(type.badgeTone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: type.rawValue))
    }
}
