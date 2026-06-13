//
//  SearchInput.Previews.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  Xcode previews for every real branch of the debounced search field: the empty history-less field, the
//  filled field (trailing clear), the history-enabled empty field, the focused recent-searches dropdown
//  (populated, keyboard-highlighted, and via a live controlled binding), and the empty-history leaf.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// A focused, history-enabled model seeded with recent searches so the dropdown renders in previews.
    @MainActor
    private func focusedHistoryModel(active: Int = -1) -> SearchInputModel {
        let store = InMemorySearchInputHistoryStore(
            scope: "drives",
            queries: ["Supercharger detour", "Home", "Work commute", "Coastal loop"]
        )
        let model = SearchInputModel(
            input: SearchInputInput(value: "", historyScope: "drives", maxHistory: 8),
            store: store
        )
        model.setFocused(true)
        for _ in 0 ..< (active + 1) {
            model.moveActiveDown()
        }
        return model
    }

    #Preview("Empty — history-less") {
        @Previewable @State var value = ""
        return staged("idle · no clear · no history") {
            SearchInput(value: value, onChange: { value = $0 }, prompt: "Search drives")
        }
    }

    #Preview("Filled — trailing clear") {
        @Previewable @State var value = "Supercharger"
        return staged("value present · clear button shown") {
            SearchInput(value: value, onChange: { value = $0 }, prompt: "Search drives")
        }
    }

    #Preview("History-enabled — empty field") {
        @Previewable @State var value = ""
        return staged("scope set · focus to reveal recent searches") {
            SearchInput(
                value: value,
                onChange: { value = $0 },
                prompt: "Search drives",
                historyScope: "drives"
            )
        }
    }

    #Preview("Recent searches — populated") {
        staged("focused · empty · entries > 0") {
            SearchInput(model: focusedHistoryModel())
        }
    }

    #Preview("Recent searches — keyboard highlight") {
        staged("focused · second row highlighted (aria-selected)") {
            SearchInput(model: focusedHistoryModel(active: 1))
        }
    }

    #Preview("Empty-history leaf") {
        staged("history dropdown · nothing to reveal · never a blank box") {
            SearchInputHistoryEmpty(
                title: SearchInputStrings.emptyTitle,
                message: SearchInputStrings.emptyMessage
            )
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.md)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }
#endif
