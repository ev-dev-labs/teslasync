//
//  SignalQueryControls.Table.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The results table — the native parity of the web `SignalDataTable`: the loading skeleton, the
//  #/Timestamp/Signal/Value/Type columns (the value cell tinted by its type, the type cell a badge),
//  the friendly empty + error leaf states, and the server-side pager footer (records count + first /
//  previous / next / last). A `Grid` gives aligned columns; a horizontal scroll absorbs overflow on
//  compact width. All copy resolves through the P1/S10 facade; chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Results table (web `SignalDataTable`)

struct SignalDataTableView: View {
    let state: SignalQueryTableState
    let rows: [SignalLogEntry]
    let pagination: SignalHistoryPagination
    let timeZone: TimeZone
    let onPageChange: (Int) -> Void
    let onRetry: () -> Void

    init(
        state: SignalQueryTableState,
        rows: [SignalLogEntry],
        pagination: SignalHistoryPagination,
        timeZone: TimeZone = .current,
        onPageChange: @escaping (Int) -> Void,
        onRetry: @escaping () -> Void
    ) {
        self.state = state
        self.rows = rows
        self.pagination = pagination
        self.timeZone = timeZone
        self.onPageChange = onPageChange
        self.onRetry = onRetry
    }

    var body: some View {
        switch state {
        case .loading:
            loadingRows
        case let .error(message):
            SignalQueryInlineError(message: message, onRetry: onRetry)
        case .empty:
            SignalQueryEmptyNote(
                text: SignalQueryControlsStrings.string("signalQuery.noResults", "No results")
            )
        case .rows:
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    grid
                }
                if SignalPaging.showsPager(totalPages: pagination.totalPages) {
                    SignalQueryPagerFooter(pagination: pagination, onPageChange: onPageChange)
                }
            }
        }
    }

    private var loadingRows: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 28, cornerRadius: TSRadius.sm)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
            "signalQuery.loadingResults", "Loading results"
        )))
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("signalQuery.colIndex", "#")
                header("signalQuery.colTimestamp", "Timestamp")
                header("signalQuery.colSignal", "Signal")
                header("signalQuery.colValue", "Value")
                header("signalQuery.colType", "Type")
            }
            Divider().overlay(Color.TS.border)
            ForEach(Array(rows.enumerated()), id: \.element.id) { item in
                dataRow(item.element, index: item.offset)
            }
        }
        .padding(TSSpacing.md)
    }

    private func header(_ key: String, _ fallback: String) -> some View {
        Text(verbatim: SignalQueryControlsStrings.string(key, fallback))
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func dataRow(_ row: SignalLogEntry, index: Int) -> some View {
        let type = SignalQueryValueFormat.valueType(of: row)
        let rowNumber = SignalPaging.rowNumber(
            index: index, page: pagination.page, perPage: pagination.perPage
        )
        let timestamp = SignalTimestamp.formatTimestampMs(row.createdAt, timeZone: timeZone)
        let value = SignalQueryValueFormat.formatValue(of: row)
        return GridRow {
            Text(verbatim: String(rowNumber))
                .font(Font.TS.bodySm)
                .monospaced()
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: timestamp)
                .font(Font.TS.bodySm)
                .monospaced()
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: row.signal)
                .font(Font.TS.bodySm)
                .monospaced()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospaced()
                .foregroundStyle(type.valueColor)
            SignalTypeBadge(type: type)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(rowNumber). \(timestamp). \(row.signal). \(value). \(type.rawValue)"))
    }
}

// MARK: - Pager footer (web server-side pagination)

/// The server-side pager — the native parity of the web `SignalDataTable` footer: the total-records
/// count + first / previous / next / last controls, each disabled at the range edges.
struct SignalQueryPagerFooter: View {
    let pagination: SignalHistoryPagination
    let onPageChange: (Int) -> Void

    private var canPrevious: Bool {
        SignalPaging.canGoPrevious(page: pagination.page)
    }

    private var canNext: Bool {
        SignalPaging.canGoNext(page: pagination.page, totalPages: pagination.totalPages)
    }

    private var recordsText: String {
        SignalQueryControlsStrings.string("signalQuery.records", "%d records")
            .replacingOccurrences(of: "%d", with: String(pagination.total))
    }

    private var pageIndicator: String {
        SignalQueryControlsStrings.string("signalQuery.pageIndicator", "Page %1$d of %2$d")
            .replacingOccurrences(of: "%1$d", with: String(pagination.page))
            .replacingOccurrences(of: "%2$d", with: String(pagination.totalPages))
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: recordsText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            pagerButton("chevron.backward.2", "signalQuery.firstPage", "First page", enabled: canPrevious) {
                onPageChange(1)
            }
            pagerButton("chevron.backward", "signalQuery.prevPage", "Previous page", enabled: canPrevious) {
                onPageChange(pagination.page - 1)
            }
            Text(verbatim: pageIndicator)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            pagerButton("chevron.forward", "signalQuery.nextPage", "Next page", enabled: canNext) {
                onPageChange(pagination.page + 1)
            }
            pagerButton("chevron.forward.2", "signalQuery.lastPage", "Last page", enabled: canNext) {
                onPageChange(pagination.totalPages)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .overlay(alignment: .top) {
            Divider().overlay(Color.TS.border.opacity(0.6))
        }
    }

    private func pagerButton(
        _ systemName: String,
        _ labelKey: String,
        _ labelFallback: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .opacity(enabled ? 1 : 0.3)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(labelKey, labelFallback)))
    }
}
