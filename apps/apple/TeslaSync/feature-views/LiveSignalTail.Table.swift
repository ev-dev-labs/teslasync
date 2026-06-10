//
//  LiveSignalTail.Table.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  The populated tail itself: a scrolling, newest-first table that auto-scrolls to
//  the top on new events (the web `autoScroll` → `scrollTop = 0`). A columnar
//  `Grid` on macOS / regular width and a card list on compact iPhone width — the
//  native idiom for the web `DataTable` (Time / Signal / Value / Type / Freshness).
//  Relative ages refresh on a 10 s `TimelineView`, matching the shared web
//  `<FreshnessIndicator>` tick. The "No signals match filter" message mirrors the
//  web `DataTable` emptyMessage. The header chrome (stats, chip, controls, banner,
//  badge, freshness dot) lives in `LiveSignalTail.Chrome.swift`.
//

import SwiftUI

private let tailMaxHeight: CGFloat = 460

// MARK: - Populated tail (banner + scrolling table)

struct LiveSignalTailTable: View {
    let model: LiveSignalTailModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                LiveSignalTailConnectivityBanner(connection: model.connection)
            }
            tailArea
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveSignalTailStrings.tableLabel))
        .accessibilityValue(
            Text(verbatim: LiveSignalTailAccessibility.tailSummary(rowCount: model.displayedEntries.count))
        )
    }

    @ViewBuilder
    private var tailArea: some View {
        if model.isFilteredEmpty {
            Text(verbatim: LiveSignalTailStrings.noMatch)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, TSSpacing.xl)
        } else {
            TimelineView(.periodic(from: .now, by: 10)) { context in
                scrollingTable(now: context.date)
            }
            .frame(maxHeight: tailMaxHeight)
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }

    private func scrollingTable(now: Date) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                if isCompact {
                    compactRows(now: now)
                } else {
                    regularRows(now: now)
                }
            }
            .onChange(of: model.displayedEntries.first?.id) { _, newest in
                guard model.autoScroll, let newest else { return }
                withAnimation(.easeOut(duration: TSMotion.fastDuration)) {
                    proxy.scrollTo(newest, anchor: .top)
                }
            }
        }
    }
}

// MARK: - Regular (macOS / iPad) columnar rows

extension LiveSignalTailTable {
    private func regularRows(now: Date) -> some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: 0) {
            GridRow {
                columnHeader(LiveSignalTailStrings.columnTime)
                columnHeader(LiveSignalTailStrings.columnSignal)
                columnHeader(LiveSignalTailStrings.columnValue)
                columnHeader(LiveSignalTailStrings.columnType)
                columnHeader(LiveSignalTailStrings.columnFreshness)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border).gridCellColumns(5)
            ForEach(model.displayedEntries) { entry in
                GridRow {
                    timeCell(entry)
                    signalCell(entry)
                    valueCell(entry)
                    LiveSignalTailTypeBadge(kind: entry.kind)
                    freshnessCell(entry, now: now)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .id(entry.id)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: rowLabel(entry, now: now)))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(5)
            }
        }
    }

    private func columnHeader(_ title: String) -> some View {
        Text(verbatim: title)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Compact (iPhone) card rows

extension LiveSignalTailTable {
    private func compactRows(now: Date) -> some View {
        LazyVStack(spacing: TSSpacing.sm) {
            ForEach(model.displayedEntries) { entry in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        signalCell(entry)
                        Spacer(minLength: TSSpacing.sm)
                        timeCell(entry)
                    }
                    HStack(alignment: .center, spacing: TSSpacing.sm) {
                        valueCell(entry)
                        LiveSignalTailTypeBadge(kind: entry.kind)
                        Spacer(minLength: TSSpacing.sm)
                        freshnessCell(entry, now: now)
                    }
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
                )
                .id(entry.id)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: rowLabel(entry, now: now)))
            }
        }
        .padding(TSSpacing.sm)
    }
}

// MARK: - Shared cells

extension LiveSignalTailTable {
    private func timeCell(_ entry: SignalTailEntry) -> some View {
        Text(verbatim: LiveSignalTailFormat.clock(entry.timestamp, locale: .current, timeZone: .current))
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
    }

    private func signalCell(_ entry: SignalTailEntry) -> some View {
        Text(verbatim: entry.name)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func valueCell(_ entry: SignalTailEntry) -> some View {
        Text(verbatim: entry.value)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(entry.kind.tint)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private func freshnessCell(_ entry: SignalTailEntry, now: Date) -> some View {
        let freshness = LiveSignalTailFormat.freshness(for: entry, now: now)
        let bucket = LiveSignalTailFormat.ageBucket(for: entry, now: now)
        return HStack(spacing: TSSpacing.xs) {
            LiveSignalTailFreshnessDot(freshness: freshness)
            Text(verbatim: LiveSignalTailStrings.ageLabel(bucket))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
    }

    private func rowLabel(_ entry: SignalTailEntry, now: Date) -> String {
        LiveSignalTailAccessibility.rowLabel(
            LiveSignalTailRowSpeech(
                time: LiveSignalTailFormat.clock(entry.timestamp, locale: .current, timeZone: .current),
                name: entry.name,
                value: entry.value,
                kind: entry.kind,
                age: LiveSignalTailStrings.ageLabel(LiveSignalTailFormat.ageBucket(for: entry, now: now)),
                freshness: LiveSignalTailFormat.freshness(for: entry, now: now)
            )
        )
    }
}
