//
//  DataTableBulkBar.Previews.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  Xcode previews for every real branch of the selection toolbar: the bar with a bulk-action slot, a
//  single selection, a large selection, the bar with no actions (count + clear only), the hidden state
//  (no selection → renders nothing), and the wrapping fallback at a constrained width. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    @MainActor
    private func sampleAction(_ title: String, systemImage: String) -> some View {
        Button {} label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: title)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    #Preview("Selected — with bulk actions") {
        staged("3 selected · Export + Delete in the slot") {
            DataTableBulkBar(count: 3, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer(), actions: {
                sampleAction("Export", systemImage: "square.and.arrow.up")
                sampleAction("Delete", systemImage: "trash")
            })
        }
    }

    #Preview("Single selection") {
        staged("1 selected · no actions, count + clear only") {
            DataTableBulkBar(count: 1, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer())
        }
    }

    #Preview("Large selection") {
        staged("128 selected · no grouping separator (web i18next)") {
            DataTableBulkBar(count: 128, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer(), actions: {
                sampleAction("Archive", systemImage: "archivebox")
            })
        }
    }

    #Preview("Hidden — no selection") {
        staged("count 0 · renders nothing (web count <= 0 → null)") {
            DataTableBulkBar(count: 0, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer())
            Text(verbatim: "↑ the toolbar is intentionally absent")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    #Preview("Wrapping — constrained width") {
        staged("controls drop to their own line (web flex-wrap)") {
            DataTableBulkBar(count: 12, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer(), actions: {
                sampleAction("Export", systemImage: "square.and.arrow.up")
                sampleAction("Delete", systemImage: "trash")
            })
            .frame(width: 240)
        }
    }
#endif
