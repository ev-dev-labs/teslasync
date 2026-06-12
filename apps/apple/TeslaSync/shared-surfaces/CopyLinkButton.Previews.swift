//
//  CopyLinkButton.Previews.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  Xcode previews for each branch the web source renders: the resting "Copy link" button, the
//  transient "Copied" confirmation, a live copy demo wired to a sample toast presenter (so the
//  success / error announcement is visible in the canvas without a real toast surface), and the
//  native graceful inert state when no shareable URL is available. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A sample toast presenter for previews — records the latest announcement so the copy outcome
    /// is visible in the canvas without a real toast surface.
    @MainActor
    @Observable
    private final class CopyLinkButtonSampleToast: CopyLinkButtonToastPresenter {
        var lastSeverity: CopyLinkButtonToastSeverity?
        var lastMessage: String?

        func presentToast(severity: CopyLinkButtonToastSeverity, message: String) {
            lastSeverity = severity
            lastMessage = message
        }
    }

    /// A faux page header action area hosting the button, so the control reads in context.
    private struct CopyLinkButtonPreviewBar<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer()
                trailing
            }
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .padding()
            .background(Color.TS.bg)
        }
    }

    #Preview("Resting (Copy link)") {
        CopyLinkButtonPreviewBar(title: "Notifications") {
            CopyLinkButton(url: { "https://teslasync.app/notifications?unread=1" })
        }
    }

    #Preview("Copied confirmation") {
        let model = CopyLinkButtonModel(
            urlProvider: StaticCopyLinkURLSource("https://teslasync.app/drives?range=30d"),
            clipboard: InMemoryCopyLinkClipboard()
        )
        // Drive the transient confirmation for the canvas without waiting on a tap.
        model.copyLink()
        return CopyLinkButtonPreviewBar(title: "Drives") {
            CopyLinkButton(model: model)
        }
    }

    #Preview("Copy demo (toast wired)") {
        @Previewable @State var toast = CopyLinkButtonSampleToast()
        VStack(spacing: TSSpacing.md) {
            CopyLinkButtonPreviewBar(title: "Map view") {
                CopyLinkButton(
                    urlProvider: StaticCopyLinkURLSource("https://teslasync.app/map?lat=37.4&lng=-122.1"),
                    clipboard: InMemoryCopyLinkClipboard(),
                    toast: toast
                )
            }
            if let message = toast.lastMessage {
                Text(verbatim: "[\(toast.lastSeverity?.rawValue ?? "")] \(message)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .background(Color.TS.bg)
    }

    #Preview("Unavailable (no URL)") {
        CopyLinkButtonPreviewBar(title: "Dashboard") {
            CopyLinkButton(urlProvider: StaticCopyLinkURLSource(""))
        }
    }
#endif
