//
//  SwipeRow.Previews.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  Xcode previews for every presentation form the web source supports plus the P4 leaf states: the
//  swipe-enabled row (both edge actions / danger + default tones), the pass-through row (fine pointer
//  → no gesture, web `!active`), the loading skeleton row, the empty state, the error row, and the
//  stale / offline freshness chip + banner. Staged on the app background. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A representative wrapped row (a notification-style list item) for the previews.
    private struct SwipeRowPreviewRow: View {
        var body: some View {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "bolt.car.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 36, height: 36)
                    .background(Color.TS.accent.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "Charging complete")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "Model Y reached 80% at Home")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        }
    }

    private enum SwipeRowPreviewData {
        static var archive: SwipeAction {
            SwipeAction(label: "Archive", tone: .default, systemImage: "archivebox") {}
        }

        static var delete: SwipeAction {
            SwipeAction(label: "Delete", tone: .danger, systemImage: "trash") {}
        }
    }

    @MainActor
    private func previewModel(_ input: SwipeRowInput) -> SwipeRowModel {
        let source = InMemorySwipeRowSource(initial: input)
        let model = SwipeRowModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 520, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Content — both actions") {
        staged(SwipeRow(
            model: previewModel(SwipeRowInput(isCoarsePointer: true)),
            leftAction: SwipeRowPreviewData.archive,
            rightAction: SwipeRowPreviewData.delete
        ) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Content — delete only") {
        staged(SwipeRow(
            model: previewModel(SwipeRowInput(isCoarsePointer: true)),
            rightAction: SwipeRowPreviewData.delete
        ) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Pass-through (fine pointer)") {
        staged(SwipeRow(
            model: previewModel(SwipeRowInput(isCoarsePointer: false)),
            leftAction: SwipeRowPreviewData.archive,
            rightAction: SwipeRowPreviewData.delete
        ) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Loading") {
        staged(SwipeRow(model: previewModel(SwipeRowInput(isLoading: true))) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Empty") {
        staged(SwipeRow(model: previewModel(SwipeRowInput(hasContent: false))) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Error") {
        staged(SwipeRow(model: previewModel(SwipeRowInput(errorMessage: "Could not load notifications"))) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Stale") {
        staged(SwipeRow(
            model: previewModel(SwipeRowInput(isCoarsePointer: true, connection: .stale)),
            rightAction: SwipeRowPreviewData.delete
        ) {
            SwipeRowPreviewRow()
        })
    }

    #Preview("Offline") {
        staged(SwipeRow(
            model: previewModel(SwipeRowInput(isCoarsePointer: true, connection: .offline)),
            rightAction: SwipeRowPreviewData.delete
        ) {
            SwipeRowPreviewRow()
        })
    }
#endif
