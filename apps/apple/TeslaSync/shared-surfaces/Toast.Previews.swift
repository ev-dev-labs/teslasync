//
//  Toast.Previews.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  Xcode previews for each branch the web source has: the four severity kinds, a toast with / without a
//  message, the navigation- and callback-action affordances, the stacked overlay (capped to five), and the
//  empty resting layer. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope. Previews use the deterministic ``ManualToastScheduler`` so a seeded toast does not auto-dismiss
//  mid-preview.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewCenter(_ seed: @MainActor (ToastCenter) -> Void) -> ToastCenter {
        let center = ToastCenter(scheduler: ManualToastScheduler())
        seed(center)
        center.start()
        return center
    }

    @MainActor
    private func card(_ item: ToastItem) -> some View {
        ToastRowView(item: item, onDismiss: {})
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Success") {
        card(ToastItem(
            id: "s",
            kind: .success,
            title: "Settings saved",
            message: "Your changes are live."
        ))
    }

    #Preview("Error") {
        card(ToastItem(
            id: "e",
            kind: .error,
            title: "Couldn't save settings",
            message: "HTTP 500: internal server error"
        ))
    }

    #Preview("Info — no message") {
        card(ToastItem(id: "i", kind: .info, title: "A new version is available"))
    }

    #Preview("Warning") {
        card(ToastItem(
            id: "w",
            kind: .warning,
            title: "Battery low",
            message: "12% remaining — find a charger soon."
        ))
    }

    #Preview("Navigation action") {
        card(ToastItem(
            id: "n",
            kind: .info,
            title: "Charge complete",
            message: "Your vehicle finished charging.",
            action: .navigate("View", to: "/charging?vehicle_id=1")
        ))
    }

    #Preview("Callback action") {
        card(ToastItem(
            id: "c",
            kind: .success,
            title: "Rule deleted",
            message: "The automation rule was removed.",
            action: .callback("Undo", perform: {})
        ))
    }

    #Preview("Stacked — capped to five") {
        ToastOverlay(center: previewCenter { center in
            center.success("Settings saved", message: "Your changes are live.")
            center.warning("Battery low", message: "12% remaining.")
            center.post(
                kind: .info,
                title: "Update available",
                action: .navigate("View", to: "/changelog")
            )
            center.error("Couldn't save settings", message: "HTTP 500: internal server error")
        })
        .frame(width: 440, height: 460)
        .background(Color.TS.bg)
    }

    #Preview("Empty resting layer") {
        ToastOverlay(center: previewCenter { _ in })
            .frame(width: 440, height: 200)
            .background(Color.TS.bg)
    }
#endif
