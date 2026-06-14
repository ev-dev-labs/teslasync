//
//  Tabs.Previews.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  Xcode previews for every real branch of the tab strip: a populated strip (with the middle tab active), a
//  strip carrying a disabled tab (skipped by keyboard navigation + dimmed), and the empty-state message. A
//  small stateful harness owns the `activeTab` so tapping / arrowing actually moves the selection in the
//  canvas (the web is controlled; the parent owns the state). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A controlled host for the previews — owns `activeTab` and feeds it back through `onChange`, exactly as
    /// a real parent does, so the canvas reflects taps + keyboard moves.
    @MainActor
    private struct TabsPreviewHarness: View {
        let tabs: [TabItem]
        @State private var active: String

        init(tabs: [TabItem], initial: String) {
            self.tabs = tabs
            _active = State(initialValue: initial)
        }

        var body: some View {
            Tabs(tabs: tabs, activeTab: active, ariaLabel: "Demo sections") { active = $0 }
        }
    }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Populated — middle active") {
        staged("overview · battery · charging · trips") {
            TabsPreviewHarness(
                tabs: [
                    TabItem(key: "overview", label: "Overview"),
                    TabItem(key: "battery", label: "Battery"),
                    TabItem(key: "charging", label: "Charging"),
                    TabItem(key: "trips", label: "Trips")
                ],
                initial: "battery"
            )
        }
    }

    #Preview("With a disabled tab") {
        staged("the 'sharing' tab is disabled → skipped by arrows + dimmed") {
            TabsPreviewHarness(
                tabs: [
                    TabItem(key: "overview", label: "Overview"),
                    TabItem(key: "sharing", label: "Sharing", disabled: true),
                    TabItem(key: "trips", label: "Trips")
                ],
                initial: "overview"
            )
        }
    }

    #Preview("Empty — friendly message, never a blank box") {
        staged("no tabs → friendly localized empty-state message") {
            TabsPreviewHarness(tabs: [], initial: "")
        }
    }
#endif
