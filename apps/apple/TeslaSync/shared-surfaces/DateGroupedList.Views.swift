//
//  DateGroupedList.Views.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  The presentational subviews composed by `DateGroupedList`, reproducing the web
//  `components/data-display/DateGroupedList.tsx` body: the per-group divider header (the semibold
//  date label, the optional muted relative label after a middot, the flexible hairline rule, and the
//  optional right-aligned tabular summary), the items rendered through the caller's row builder (the
//  `renderItem` parity), and the P4 friendly empty state. All copy arrives pre-localized through the
//  resolved model (P1/S10); all colour + spacing come from the P1/S9 tokens (no Tailwind ports, no
//  raw hex / magic numbers); the shared `TSFadeIn` primitive frames the populated list. No
//  networking lives here.
//

import SwiftUI

// MARK: - Keyed item (web `itemKey` render key)

/// One item paired with its stable key + zero-based index — the native carrier for the web
/// `itemKey(item, index)` / `renderItem(item, index)` contract. `id` defaults to the index when the
/// caller supplies no key extractor (the web `itemKey ? … : index` fallback).
private struct DateGroupedListKeyedItem<Item>: Identifiable {
    let id: AnyHashable
    let index: Int
    let item: Item
}

// MARK: - Divider header (web `<header>` row)

/// One group's divider header — the semibold date label, the optional muted relative label (after
/// the middot separator), the flexible hairline rule, and the optional right-aligned summary in
/// tabular figures. Reads as a single VoiceOver heading (the composed section label); the rule is
/// decorative and hidden from assistive tech.
struct DateGroupedListDividerHeader: View {
    let header: DateGroupedListResolvedHeader

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: header.dateLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if let relativeLabel = header.relativeLabel, !relativeLabel.isEmpty {
                    Text(verbatim: "\(DateGroupedListMeta.relativeSeparator) \(relativeLabel)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .fixedSize(horizontal: true, vertical: false)

            Rectangle()
                .fill(Color.TS.border)
                .opacity(0.5)
                .frame(height: 1)
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)

            if let summary = header.summary, !summary.isEmpty {
                Text(verbatim: summary)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: header.accessibilityLabel))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Group section (web `<section>`)

/// One group section — the divider header over its items, each rendered through the caller's row
/// builder (the `renderItem` parity) and keyed by the caller's `itemKey`. The section contains its
/// children for VoiceOver so the date heading and the rows are navigated as one group (web
/// `aria-labelledby`).
struct DateGroupedListGroupSection<Item, Row: View>: View {
    let header: DateGroupedListResolvedHeader
    let items: [Item]
    let itemSpacing: CGFloat
    let itemKey: (Item, Int) -> AnyHashable
    @ViewBuilder let rowContent: (Item, Int) -> Row

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            DateGroupedListDividerHeader(header: header)
            VStack(alignment: .leading, spacing: itemSpacing) {
                ForEach(keyedItems) { entry in
                    rowContent(entry.item, entry.index)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var keyedItems: [DateGroupedListKeyedItem<Item>] {
        items.enumerated().map { offset, element in
            DateGroupedListKeyedItem(id: itemKey(element, offset), index: offset, item: element)
        }
    }
}

// MARK: - Populated (web rendered list)

/// The populated list — the ordered group sections separated by the group spacing. The native parity
/// of the web rendered `DateGroupedList`; the resolved headers are matched back to their generic
/// groups by `dateKey` so the localized header text and the caller's items render together.
struct DateGroupedListContent<Item, Row: View>: View {
    let headers: [DateGroupedListResolvedHeader]
    let groups: [DateGroupedListGroup<Item>]
    let itemSpacing: CGFloat
    let groupSpacing: CGFloat
    let itemKey: (Item, Int) -> AnyHashable
    @ViewBuilder let rowContent: (Item, Int) -> Row

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: groupSpacing) {
                ForEach(groups) { group in
                    if let header = headersByKey[group.dateKey] {
                        DateGroupedListGroupSection(
                            header: header,
                            items: group.items,
                            itemSpacing: itemSpacing,
                            itemKey: itemKey,
                            rowContent: rowContent
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var headersByKey: [String: DateGroupedListResolvedHeader] {
        Dictionary(headers.map { ($0.dateKey, $0) }, uniquingKeysWith: { first, _ in first })
    }
}

// MARK: - Empty (P4 "never a blank box")

/// The friendly empty state shown when there are no groups — the P4 upgrade of the web blank
/// container, so the standalone surface is never a bare box.
struct DateGroupedListEmptyView: View {
    let content: DateGroupedListEmpty

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: content.title)
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            Text(verbatim: content.message)
        }
    }
}
