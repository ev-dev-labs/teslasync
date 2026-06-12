//
//  CopyButton.Previews.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  Xcode previews for each branch the web source renders: the resting "Copy" button, the transient
//  "Copied" confirmation, the icon-only dense variant, a custom-label variant, the disabled state, and
//  a live copy demo wired to a sample toast presenter (so the success announcement is visible in the
//  canvas without a real toast surface). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A sample toast presenter for previews — records the latest announcement so the copy outcome is
    /// visible in the canvas without a real toast surface.
    @MainActor
    @Observable
    private final class CopyButtonSampleToast: CopyButtonToastPresenter {
        var lastSeverity: CopyButtonToastSeverity?
        var lastMessage: String?

        func presentToast(severity: CopyButtonToastSeverity, message: String) {
            lastSeverity = severity
            lastMessage = message
        }
    }

    /// A faux dense row hosting the button on its trailing edge, so the control reads in context.
    private struct CopyButtonPreviewRow<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.body)
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

    #Preview("Resting (Copy)") {
        CopyButtonPreviewRow(title: "API token") {
            CopyButton(text: "sk-teslasync-EXAMPLE-0000")
        }
    }

    #Preview("Copied confirmation") {
        let model = CopyButtonModel(
            textProvider: StaticCopyButtonTextSource("VIN 5YJ3E1EA7KF000000"),
            clipboard: InMemoryCopyButtonClipboard()
        )
        // Drive the transient confirmation for the canvas without waiting on a tap.
        model.copyText()
        return CopyButtonPreviewRow(title: "VIN") {
            CopyButton(model: model)
        }
    }

    #Preview("Icon only (dense)") {
        CopyButtonPreviewRow(title: "Share URL") {
            CopyButton(text: "https://teslasync.app/drives/42", iconOnly: true)
        }
    }

    #Preview("Custom label") {
        CopyButtonPreviewRow(title: "Deep link") {
            CopyButton(text: "https://teslasync.app/map?z=12", label: "Copy link")
        }
    }

    #Preview("Disabled (text not ready)") {
        CopyButtonPreviewRow(title: "Export id") {
            CopyButton(text: "", disabled: true)
        }
    }

    #Preview("Copy demo (toast wired)") {
        @Previewable @State var toast = CopyButtonSampleToast()
        VStack(spacing: TSSpacing.md) {
            CopyButtonPreviewRow(title: "Diagnostics bundle") {
                CopyButton(
                    text: "teslasync-diagnostics-2026-06-12.json",
                    withToast: true,
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
#endif
