//
//  HttpStatusTool.Components.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  The presentational subviews that map the web shared components to native
//  counterparts, styled with the shared design tokens (P1/S9). They are authored
//  locally — rather than reusing the `LocalizedStringKey`-only shared components
//  (`TSBadge` / `TSTextField` / `TSDataTable`) — so every label resolves through
//  the per-surface `HttpStatusStrings` table (P1/S10) with the web `t(key,
//  default)` fallback, mirroring how the sibling widgets build their chips/rows
//  over the same tokens.
//

import SwiftUI

// MARK: - Layout metrics

/// Shared column metrics so the header and the data rows stay aligned (the web
/// `DataTable` keeps `code` / `text` / `desc` in fixed columns).
enum HttpStatusMetrics {
    /// Leading column width holding the code badge / "Status Code" header.
    static let codeColumnWidth: CGFloat = 88
}

// MARK: - Tone → color

extension HttpStatusTone {
    /// The design-token color for the tone (web `Badge` `success`/`info`/
    /// `warning`/`danger` variant colors).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Status badge (web `Badge variant={success|info|warning|danger}`)

/// A compact tonal pill holding the status code, mirroring the web `Badge`
/// (`@/components/ui`, `size="sm"`). The badge color carries the HTTP class; the
/// VoiceOver label adds the class word so the meaning is not color-only.
struct HttpStatusBadge: View {
    let row: HttpStatusRow

    var body: some View {
        Text(verbatim: row.codeText)
            .font(Font.TS.label)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(row.tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(row.tone.color.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(row.tone.color.opacity(0.28), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(row.codeText) \(HttpStatusStrings.toneLabel(row.tone))"))
    }
}

// MARK: - Search field (web `Input` with leading `Network` icon)

/// Single-line search field with a leading network glyph, mirroring the web
/// `Input` (`icon={<Network/>}`) whose prompt text is `t('Search Codes')`. The
/// prompt resolves through the per-surface string table.
struct HttpStatusSearchField: View {
    @Binding var text: String

    private var prompt: String {
        HttpStatusStrings.string("Search Codes", "Search Codes")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "network")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(text: $text, prompt: Text(verbatim: prompt)) {
                Text(verbatim: prompt)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .autocorrectionDisabled(true)
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(HttpStatusStrings.text("tool.httpStatus.searchA11y", "Search status codes"))
    }
}

// MARK: - Column header (web `DataTable` header row; `code` is sortable)

/// The table header: a sortable "Status Code" control (web `sortable` column with
/// the sort chevron) plus the "Status Text" / "Status Desc" titles, aligned to
/// the data-row columns.
struct HttpStatusColumnHeader: View {
    let sort: HttpStatusSort
    let onToggleSort: () -> Void

    private var sortSymbol: String {
        switch sort {
        case .unsorted: "chevron.up.chevron.down"
        case .ascending: "chevron.up"
        case .descending: "chevron.down"
        }
    }

    private var sortHint: String {
        switch sort {
        case .unsorted, .descending: HttpStatusStrings.string("tool.httpStatus.sortAscending", "Sort ascending")
        case .ascending: HttpStatusStrings.string("tool.httpStatus.sortDescending", "Sort descending")
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Button(action: onToggleSort) {
                HStack(spacing: TSSpacing.xs) {
                    columnTitle("Status Code")
                    Image(systemName: sortSymbol)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(sort == .unsorted ? Color.TS.textMuted : Color.TS.accent)
                }
            }
            .buttonStyle(.plain)
            .frame(width: HttpStatusMetrics.codeColumnWidth, alignment: .leading)
            .accessibilityLabel(HttpStatusStrings.text("Status Code", "Status Code"))
            .accessibilityHint(Text(verbatim: sortHint))

            columnTitle("Status Text")
                .frame(maxWidth: .infinity, alignment: .leading)
            columnTitle("Status Desc")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func columnTitle(_ key: String) -> some View {
        HttpStatusStrings.text(key, key)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(2)
    }
}

// MARK: - Data row (web `DataTable` row: code badge / text / desc)

/// One reference row: the code badge, the status text, and the description,
/// aligned to the header columns (web `columns[].render`).
struct HttpStatusRowView: View {
    let row: HttpStatusRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            HttpStatusBadge(row: row)
                .frame(width: HttpStatusMetrics.codeColumnWidth, alignment: .leading)
            Text(verbatim: row.text)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(2)
            Text(verbatim: row.desc)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(2)
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: HttpStatusAccessibility.rowLabel(for: row)))
    }
}

// MARK: - Pagination bar (web `DataTable` `pagination`)

/// The pagination footer: the displayed range / total (web `Pagination` count)
/// plus previous/next controls and the page position when more than one page
/// exists.
struct HttpStatusPaginationBar: View {
    let projection: HttpStatusProjection
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: HttpStatusStrings.pageRange(
                start: projection.rangeStart,
                end: projection.rangeEnd,
                total: projection.filteredCount
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()

            Spacer(minLength: TSSpacing.sm)

            if projection.hasPagination {
                pageControl(
                    symbol: "chevron.left",
                    label: HttpStatusStrings.string("tool.httpStatus.previousPage", "Previous page"),
                    disabled: projection.page <= 1,
                    action: onPrevious
                )
                Text(verbatim: HttpStatusStrings.pagePosition(page: projection.page, of: projection.pageCount))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .monospacedDigit()
                pageControl(
                    symbol: "chevron.right",
                    label: HttpStatusStrings.string("tool.httpStatus.nextPage", "Next page"),
                    disabled: projection.page >= projection.pageCount,
                    action: onNext
                )
            }
        }
        .padding(.top, TSSpacing.xs)
    }

    private func pageControl(
        symbol: String,
        label: String,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(disabled ? Color.TS.textMuted : Color.TS.accent)
                .frame(width: 28, height: 28)
                .background(Color.TS.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (web `DataFreshness` header indicator)

/// Live-stream freshness chip shown in the header: a tone dot + Live/Stale/
/// Offline word. Mirrors the web `DataFreshness` / `FreshnessIndicator`
/// (`@/components/data-display`).
struct HttpStatusFreshnessChip: View {
    let connection: HttpStatusConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: HttpStatusStrings.string("tool.httpStatus.live", "Live")
        case .stale: HttpStatusStrings.string("tool.httpStatus.stale", "Stale")
        case .offline: HttpStatusStrings.string("tool.httpStatus.offlineChip", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
