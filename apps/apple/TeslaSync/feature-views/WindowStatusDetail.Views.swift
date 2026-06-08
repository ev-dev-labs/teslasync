//
//  WindowStatusDetail.Views.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  The presentational subviews composed by `WindowStatusDetail`: the per-window status
//  card (web `GlassPanel` tinted by `windowColor` / `windowTextClass`), the responsive
//  grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), the header freshness chip +
//  connectivity banner (ADR-013 live-state), the closed/open summary chip (web
//  `windowSummary`), and the loading / error / empty states the Apple HIG states
//  contract requires. All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - State → tone (web `windowColor` / `windowTextClass`)

extension WindowState {
    /// The semantic tone driving the card tint, border, and value color — the native
    /// mapping of web `windowColor` (Closed=green, Venting=amber, Open=red, Unknown=gray).
    var tone: TSTone {
        switch self {
        case .closed: .success
        case .venting: .warning
        case .open: .danger
        case .unknown: .neutral
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The surface header: the web `<h2>Window Status Detail</h2>` title paired with the
/// live-state freshness chip (ADR-013).
struct WindowStatusHeader: View {
    let title: String
    let connection: WindowStatusConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            WindowStatusFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct WindowStatusFreshnessChip: View {
    let connection: WindowStatusConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: WindowStatusStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WindowStatusStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: WindowStatusConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "admin.security.window.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "admin.security.window.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "admin.security.window.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so
/// the cached snapshot is clearly labeled (web `DataFreshness` indicator intent).
struct WindowStatusConnectivityBanner: View {
    let connection: WindowStatusConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.security.window.offlineBanner" : "admin.security.window.staleBanner"
        let fallback = offline
            ? "Offline — showing last known window status"
            : "Reconnecting — window status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: WindowStatusStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary chip (web `windowSummary`)

/// The closed/open summary pill (web `windowSummary`): "All Closed" when every window is
/// shut, otherwise "{n} Open/Venting".
struct WindowStatusSummaryChip: View {
    let allClosed: Bool
    let notClosedCount: Int

    var body: some View {
        let tone: TSTone = allClosed ? .success : .warning
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }

    private var label: String {
        if allClosed {
            return WindowStatusStrings.string("admin.security.window.allClosed", "All Closed")
        }
        let word = WindowStatusStrings.string("admin.security.window.openVenting", "Open/Venting")
        return "\(notClosedCount) \(word)"
    }
}

// MARK: - Window card (web `GlassPanel` tinted by state)

/// One window's status card — the native parity of the web `GlassPanel` with the
/// `windowColor` tint/border and the `windowTextClass` value color. The label is muted;
/// the state word carries the semantic tone.
struct WindowPaneCard: View {
    let cell: WindowCell

    var body: some View {
        let tone = cell.state.tone
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: positionLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: stateLabel)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(tone.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(tone.color.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(tone.color.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var positionLabel: String {
        WindowStatusStrings.string(cell.position.labelKey, cell.position.labelFallback)
    }

    private var stateLabel: String {
        WindowStatusStrings.string("admin.security.windowState.\(cell.state.slug)", cell.state.fallback)
    }

    private var accessibilityLabel: String {
        WindowStatusAccessibility.cellSummary(positionLabel: positionLabel, stateLabel: stateLabel)
    }
}

// MARK: - Responsive grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`)

/// The adaptive window grid — one column on compact width, flowing to two/four on wider
/// idioms (web responsive grid). Each cell is a `WindowPaneCard`.
struct WindowStatusGrid: View {
    let cells: [WindowCell]

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: .infinity), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(cells) { cell in
                WindowPaneCard(cell: cell)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading grid (web `<Skeleton />`)

/// The initial-fetch skeleton grid (web loading branch), respecting Reduce Motion via
/// the shared `TSSkeleton`.
struct WindowStatusLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150, maximum: .infinity), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(WindowPosition.allCases) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 96, height: 10)
                    TSSkeleton(width: 64, height: 18)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.lg)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WindowStatusStrings.string(
            "admin.security.window.loadingA11y", "Loading window status"
        )))
    }
}

// MARK: - Error state (native `QueryError` equivalent + retry)

/// The failure box (web hook error surfaced by the parent) with the retry affordance the
/// P4 states contract's `QueryError`-equivalent requires.
struct WindowStatusErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Label {
                Text(verbatim: WindowStatusStrings.string("admin.security.window.error", "Couldn't load window status"))
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onRetry) {
                Text(verbatim: WindowStatusStrings.string("admin.security.window.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: WindowStatusStrings.string("admin.security.window.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Empty note (friendly, never a blank box)

/// The muted note shown under the grid when no snapshot has arrived yet — so the empty
/// state still renders the four cards plus a friendly explanation rather than a blank box.
struct WindowStatusEmptyNote: View {
    var body: some View {
        Text(verbatim: WindowStatusStrings.string(
            "admin.security.window.empty", "No recent window telemetry for this vehicle."
        ))
        .font(Font.TS.bodySm)
        .foregroundStyle(Color.TS.textMuted)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
