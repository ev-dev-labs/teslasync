//
//  PinButton.Previews.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  Xcode previews for every branch of the shared pin affordance: the unpinned + pinned glyphs, the
//  icon-plus-label variant, both sizes, the in-flight (busy) beat, the cold-load spinner, and the P4
//  freshness axis (stale / offline / error badges). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
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
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// Builds a model over an in-memory store whose snapshot reproduces a specific state (incl. the
    /// in-flight beat the prop initializer cannot express).
    @MainActor
    private func model(
        itemID: String = "1",
        size: PinButtonSize = .small,
        showLabel: Bool = false,
        snapshot: PinnedSnapshot
    ) -> PinButtonModel {
        let input = PinButtonInput(itemType: .vehicle, itemID: itemID, size: size, showLabel: showLabel)
        return PinButtonModel(input: input, store: InMemoryPinnedStore(snapshot: snapshot))
    }

    #Preview("Pinned / unpinned") {
        staged("idle states · small") {
            HStack(spacing: TSSpacing.lg) {
                PinButton(itemType: .vehicle, itemID: "1", pinned: false)
                PinButton(itemType: .vehicle, itemID: "2", pinned: true)
            }
        }
    }

    #Preview("With label · both sizes") {
        staged("showLabel · small + medium") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                PinButton(itemType: .widget, itemID: "3", size: .small, showLabel: true, pinned: false)
                PinButton(itemType: .widget, itemID: "4", size: .small, showLabel: true, pinned: true)
                PinButton(itemType: .widget, itemID: "5", size: .medium, showLabel: true, pinned: true)
            }
        }
    }

    #Preview("Busy (toggle pending)") {
        staged("mutation in flight · disabled + dimmed") {
            PinButton(model: model(
                snapshot: PinnedSnapshot(
                    status: .loaded,
                    pinnedIDs: ["1"],
                    pendingItemIDs: ["1"],
                    hasLoaded: true
                )
            ))
        }
    }

    #Preview("Cold load (spinner)") {
        staged("first fetch · no cached set") {
            PinButton(itemType: .vehicle, itemID: "1", showLabel: true, status: .loading)
        }
    }

    #Preview("Stale (refreshing badge)") {
        staged("cached pins kept · refreshing") {
            PinButton(itemType: .vehicle, itemID: "1", pinned: true, freshness: .stale)
        }
    }

    #Preview("Offline (cached badge)") {
        staged("cached pins kept · offline") {
            PinButton(itemType: .vehicle, itemID: "1", showLabel: true, pinned: true, freshness: .offline)
        }
    }

    #Preview("Error (retry badge)") {
        staged("set failed to load · retryable") {
            PinButton(model: model(
                snapshot: PinnedSnapshot(status: .failed("network"), pinnedIDs: [], hasLoaded: false)
            ))
        }
    }
#endif
