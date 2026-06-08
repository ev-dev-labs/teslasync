//
//  TeslaApiRefTool.Views.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  The leaf SwiftUI components the tool composes: the ToolCard header (port of the web
//  `ToolCard` icon + title + description), the search field (port of the web `Input`),
//  the method badge (port of the web info/warning `Badge`), the column header + endpoint
//  row (port of the web `DataTable` columns), the result-count caption, and the tappable
//  freshness chip. All are surface-local and token-driven so the surface stays
//  self-contained, reusing the shared `TSIconBox` + `TSCopyButton` atoms.
//

import SwiftUI

// MARK: - Table column metrics (shared by the header + rows so they align)

/// Fixed column widths for the endpoint table, shared between the header and the rows
/// so the Method / Path / Endpoint Desc / copy columns line up across both.
enum ApiRefTableMetrics {
    static let methodColumn: CGFloat = 56
    static let descColumn: CGFloat = 128
    static let copyColumn: CGFloat = 28
}

// MARK: - TeslaApiRefHeader (port of the web `ToolCard` chrome)

/// The tool header: a cyan book icon box, the title + description, and the tappable
/// freshness chip. Mirrors the web `ToolCard` (icon + `h3` title + `p` description) with
/// the native freshness/refresh affordance added for the surface's state matrix.
struct TeslaApiRefHeader: View {
    let freshness: ApiRefFreshness
    var updatedAt: Date?
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "book", tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                TeslaApiRefStrings.text("Tesla Api Ref", "Tesla Api Ref")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                TeslaApiRefStrings.text("Tesla Api Ref Desc", "Tesla Api Ref Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: TSSpacing.sm)
            TeslaApiRefFreshnessChip(freshness: freshness, updatedAt: updatedAt, onRefresh: onRefresh)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - TeslaApiRefSearchField (port of the web `Input`)

/// The endpoint search box — a magnifying glass, a plain text field bound to the query,
/// and a clear button, on the shared field surface. Resolves its prompt + a11y through
/// this surface's i18n table (the web search `Input` prompt key `Search Endpoints`).
struct TeslaApiRefSearchField: View {
    @Binding var text: String

    private var prompt: String {
        TeslaApiRefStrings.string("Search Endpoints", "Search Endpoints")
    }

    private var fieldLabel: String {
        TeslaApiRefStrings.string("apiRef.search.a11y", "Search endpoints")
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
                .accessibilityLabel(TeslaApiRefStrings.text("apiRef.search.clear", "Clear search"))
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

// MARK: - TeslaApiRefMethodBadge (port of the web info/warning `Badge`)

/// A tinted capsule for an HTTP method. Mirrors the shared `TSBadge` styling but renders
/// the verb verbatim (methods are not localized) and tones it by the web rule
/// (`GET` → info, any mutating verb → warning).
struct TeslaApiRefMethodBadge: View {
    let method: String

    private var tone: Color {
        TeslaApiRefBuilder.methodTone(for: method) == .info ? Color.TS.statusInfo : Color.TS.statusWarning
    }

    var body: some View {
        Text(verbatim: method)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - TeslaApiRefColumnHeader (port of the web `DataTable` headers)

/// The table column header strip: the localized Method / Path / Endpoint Desc labels
/// aligned to the row columns. Hidden from VoiceOver (each row speaks its own combined
/// label), so the header is purely visual structure.
struct TeslaApiRefColumnHeader: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            label("Method", "Method")
                .frame(width: ApiRefTableMetrics.methodColumn, alignment: .leading)
            label("Path", "Path")
                .frame(maxWidth: .infinity, alignment: .leading)
            label("Endpoint Desc", "Endpoint Desc")
                .frame(width: ApiRefTableMetrics.descColumn, alignment: .leading)
            Color.clear.frame(width: ApiRefTableMetrics.copyColumn, height: 1)
        }
        .padding(.horizontal, TSSpacing.xs)
        .accessibilityHidden(true)
    }

    private func label(_ key: String, _ fallback: String) -> some View {
        TeslaApiRefStrings.text(key, fallback)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
    }
}

// MARK: - TeslaApiRefEndpointRow (port of the web `DataTable` row)

/// One endpoint row: the method badge, the monospaced path, the description, and a copy
/// button for the path (port of the web `CopyButton`). The first three columns are a
/// single VoiceOver element speaking method + path + description; the copy button stays a
/// separate, independently actionable element.
struct TeslaApiRefEndpointRow: View {
    let endpoint: TeslaApiEndpoint

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TeslaApiRefMethodBadge(method: endpoint.method)
                    .frame(width: ApiRefTableMetrics.methodColumn, alignment: .leading)
                Text(verbatim: endpoint.path)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: endpoint.desc)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
                    .frame(width: ApiRefTableMetrics.descColumn, alignment: .leading)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: TeslaApiRefAccessibility.rowLabel(for: endpoint)))

            TSCopyButton(value: endpoint.path)
                .frame(width: ApiRefTableMetrics.copyColumn)
                .accessibilityLabel(TeslaApiRefStrings.text("apiRef.copyPath", "Copy path"))
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.xs)
        .frame(minHeight: 36)
    }
}

// MARK: - TeslaApiRefResultsCount

/// A muted caption summarizing how many endpoints are shown (the bare total, or the
/// filtered "N of M" when searching) — the native counterpart of the web table's row
/// count / pagination summary.
struct TeslaApiRefResultsCount: View {
    let shown: Int
    let total: Int

    private var label: String {
        TeslaApiRefBuilder.resultsLabel(shown: shown, total: total)
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - TeslaApiRefFreshnessChip

/// A tappable freshness chip: a status dot + connectivity glyph + relative-time / status
/// label. Tapping refreshes. The fetching glyph spins unless Reduce Motion is on.
struct TeslaApiRefFreshnessChip: View {
    let freshness: ApiRefFreshness
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
        .accessibilityLabel(TeslaApiRefStrings.text("apiRef.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: TeslaApiRefAccessibility.freshnessLabel(freshness)))
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
            return TeslaApiRefStrings.string("apiRef.freshness.updating", "Updating…")
        case .error:
            return TeslaApiRefStrings.string("apiRef.freshness.errorShort", "error")
        case .offline:
            return TeslaApiRefStrings.string("apiRef.freshness.offline", "Offline")
        case .fresh, .stale:
            if let updatedAt {
                return TeslaApiRefBuilder.relativeTime(since: updatedAt)
            }
            return TeslaApiRefAccessibility.freshnessLabel(freshness)
        }
    }
}
