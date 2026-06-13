//
//  Pagination.Previews.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  Xcode previews for every REAL branch of the table pagination controls: the first page of many (with the
//  rows-per-page selector), a middle page (all four navigation buttons enabled), the last page, a single
//  page (`total <= pageSize` → all buttons disabled), the empty data set (`total == 0` → "Showing 0–0 of 0"
//  / "1 / 1"), the no-selector variant (web `onPageSizeChange` omitted), and a caller-supplied
//  `pageSizeOptions`. Each preview wraps the control in a tiny controlled host (`PaginationPreviewHost`) that
//  owns the page / page-size state and re-feeds it on the callbacks, mirroring a real controlled call site,
//  so the buttons and the selector actually navigate. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A controlled host mirroring a real call site — it owns the `page` / `pageSize` state and re-feeds it
    /// through the callbacks, so the previewed control navigates exactly as it would inside a table view.
    @MainActor
    private struct PaginationPreviewHost: View {
        @State private var page: Int
        @State private var pageSize: Int
        private let total: Int
        private let options: [Int]
        private let withSelector: Bool

        init(
            page: Int,
            total: Int,
            pageSize: Int = 25,
            options: [Int] = PaginationDefaults.pageSizeOptions,
            withSelector: Bool = true
        ) {
            _page = State(initialValue: page)
            _pageSize = State(initialValue: pageSize)
            self.total = total
            self.options = options
            self.withSelector = withSelector
        }

        var body: some View {
            PaginationView(
                controller: PaginationController(
                    page: page,
                    pageSize: pageSize,
                    total: total,
                    pageSizeOptions: options,
                    onPageChange: { page = $0 },
                    onPageSizeChange: withSelector ? { newSize in
                        pageSize = newSize
                        page = 1
                    } : nil
                )
            )
        }
    }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .tsGlassPanel()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("First page · with selector") {
        staged("first page of many — first/prev disabled, next/last enabled, rows-per-page selector") {
            PaginationPreviewHost(page: 1, total: 248)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Middle page") {
        staged("a middle page — all four navigation buttons enabled") {
            PaginationPreviewHost(page: 4, total: 248)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Last page") {
        staged("the last page — next/last disabled, first/prev enabled") {
            PaginationPreviewHost(page: 10, total: 248)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Single page") {
        staged("one page only (total ≤ pageSize) — every navigation button disabled") {
            PaginationPreviewHost(page: 1, total: 12)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Empty") {
        staged("no rows (total = 0) — friendly 'Showing 0–0 of 0' / '1 / 1', all disabled, never blank") {
            PaginationPreviewHost(page: 1, total: 0)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Without selector") {
        staged("no onPageSizeChange — the rows-per-page selector is omitted (web `onPageSizeChange &&`)") {
            PaginationPreviewHost(page: 2, total: 248, withSelector: false)
                .padding(TSSpacing.md)
        }
    }

    #Preview("Custom page sizes") {
        staged("caller-supplied pageSizeOptions [10, 20, 50]") {
            PaginationPreviewHost(page: 1, total: 248, pageSize: 20, options: [10, 20, 50])
                .padding(TSSpacing.md)
        }
    }
#endif
