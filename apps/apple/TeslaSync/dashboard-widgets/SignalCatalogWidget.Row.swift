//
//  SignalCatalogWidget.Row.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  The leaf SwiftUI components the catalog surface composes: the search field
//  (port of the web `Input`), the unit badge (port of the web neutral `Badge`),
//  one catalog row, a sticky category header, the compact big-number summary, and
//  the tappable freshness chip (port of the web `DataFreshness` chip). All are
//  surface-local and token-driven so the surface stays self-contained.
//

import SwiftUI

// MARK: - SignalCatalogSearchField (port of the web `Input`)

/// The catalog search box — a magnifying glass, a plain text field bound to the
/// query, and a clear button, on the shared field surface. Mirrors the shared
/// `TSSearchInput` chrome while resolving its prompt + a11y through this surface's
/// i18n table.
struct SignalCatalogSearchField: View {
    @Binding var text: String

    /// The i18n key mirrors the web source key (the web search `Input` prompt).
    private static let promptKey = "widget.signalCatalog.searchPlaceholder" // parity:allow web i18n key parity

    private var prompt: String {
        SignalCatalogStrings.string(Self.promptKey, "Search signals…")
    }

    private var fieldLabel: String {
        SignalCatalogStrings.string("widget.signalCatalog.searchA11y", "Search signals")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(text: $text, prompt: Text(verbatim: prompt)) {
                Text(verbatim: fieldLabel)
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityLabel(Text(verbatim: fieldLabel))
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    SignalCatalogStrings.text("widget.signalCatalog.clear", "Clear search")
                )
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - SignalCatalogUnitBadge (port of the web neutral `Badge`)

/// A neutral capsule badge for a signal's unit. Mirrors the shared `TSBadge(.neutral)`
/// styling but renders the dynamic unit verbatim (units are not localized).
struct SignalCatalogUnitBadge: View {
    let unit: String

    var body: some View {
        Text(verbatim: unit)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - SignalCatalogRowView (port of the web signal row)

/// One catalog row: the monospaced signal name (truncating), an optional unit
/// badge, and the right-aligned observation count. The row is a single VoiceOver
/// element speaking name + unit + count.
struct SignalCatalogRowView: View {
    let row: SignalCatalogRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.name)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let unit = row.unit, !unit.isEmpty {
                SignalCatalogUnitBadge(unit: unit)
            }
            Text(verbatim: SignalCatalogBuilder.formatInt(row.observationCount))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .frame(minWidth: 36, alignment: .trailing)
        }
        .frame(minHeight: 32)
        .padding(.horizontal, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SignalCatalogAccessibility.rowLabel(for: row)))
    }
}

// MARK: - SignalCatalogGroupHeader (port of the web sticky category header)

/// A sticky category section header: the uppercase category label and its signal
/// count. One VoiceOver element speaking "category, N signals".
struct SignalCatalogGroupHeader: View {
    let group: SignalCatalogGroup

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: group.category)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: "(\(SignalCatalogBuilder.formatInt(group.count)))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SignalCatalogAccessibility.groupLabel(for: group)))
    }
}

// MARK: - SignalCatalogCountSummary (port of the web compact 1-col layout)

/// The compact (single-column) layout: the catalog size as a big number over the
/// "signals available" caption. Reproduced from the web `isCompact` branch; the
/// shared two-column min size keeps it a defensive layout on both platforms.
struct SignalCatalogCountSummary: View {
    let total: Int

    private var summaryLabel: String {
        SignalCatalogStrings.count("widget.signalCatalog.countSummaryA11y", "%lld signals available", total)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: SignalCatalogBuilder.formatInt(total))
                .font(.system(size: 28, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            SignalCatalogStrings.text("widget.signalCatalog.signalsAvailable", "signals available")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summaryLabel))
    }
}

// MARK: - SignalCatalogFreshnessChip (port of the web `DataFreshness` chip)

/// A tappable freshness chip: a status dot + connectivity glyph + relative-time /
/// status label. Tapping refreshes (the web chip is the refresh control). The
/// fetching glyph spins unless Reduce Motion is on.
struct SignalCatalogFreshnessChip: View {
    let freshness: CatalogFreshness
    var updatedAt: Date?
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(isSpinning ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .monospacedDigit()
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = freshness == .fetching }
        .onChange(of: freshness) { _, newValue in spin = newValue == .fetching }
        .accessibilityLabel(SignalCatalogStrings.text("widget.signalCatalog.freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: SignalCatalogAccessibility.freshnessLabel(freshness)))
    }

    private var isSpinning: Bool {
        freshness == .fetching && !reduceMotion && spin
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }

    private var tone: Color {
        switch freshness {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error, .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .fetching:
            return SignalCatalogStrings.string("widget.signalCatalog.freshness.updating", "updating…")
        case .error:
            return SignalCatalogStrings.string("widget.signalCatalog.freshness.errorShort", "error")
        case .offline:
            return SignalCatalogStrings.string("widget.signalCatalog.freshness.offline", "Offline")
        case .fresh, .stale:
            if let updatedAt {
                return SignalCatalogBuilder.relativeTime(since: updatedAt)
            }
            return SignalCatalogAccessibility.freshnessLabel(freshness)
        }
    }
}
