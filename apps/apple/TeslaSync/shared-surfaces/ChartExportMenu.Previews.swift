//
//  ChartExportMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  Xcode previews for each branch the web source renders: the default menu (with the CSV lead
//  item), the menu without CSV, the disabled trigger, the busy gating of the snapshot-dependent
//  items, and a copy demo wired to a sample toast presenter. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A sample toast presenter for previews — records the latest announcement so the copy outcome
    /// is visible in the canvas without a real toast surface.
    @MainActor
    @Observable
    private final class ChartExportMenuSampleToast: ChartExportMenuToastPresenter {
        var lastSeverity: ChartExportToastSeverity?
        var lastMessage: String?

        func presentToast(severity: ChartExportToastSeverity, message: String) {
            lastSeverity = severity
            lastMessage = message
        }
    }

    /// A faux chart title bar hosting the menu in its action area, so the trigger reads in context.
    private struct ChartExportMenuPreviewBar<Trailing: View>: View {
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

    #Preview("Default (with CSV)") {
        ChartExportMenuPreviewBar(title: "Battery degradation") {
            ChartExportMenu(
                onExportPNG: {},
                onExportSVG: {},
                onCopyImage: { .copied },
                onExportCsv: {}
            )
        }
    }

    #Preview("Without CSV") {
        ChartExportMenuPreviewBar(title: "Speed profile") {
            ChartExportMenu(
                onExportPNG: {},
                onExportSVG: {},
                onCopyImage: { .copied }
            )
        }
    }

    #Preview("Disabled trigger") {
        ChartExportMenuPreviewBar(title: "No data yet") {
            ChartExportMenu(
                onExportPNG: {},
                onExportSVG: {},
                onCopyImage: { .copied },
                onExportCsv: {},
                disabled: true
            )
        }
    }

    #Preview("Busy (capture in flight)") {
        ChartExportMenuPreviewBar(title: "Regen breakdown") {
            ChartExportMenu(
                onExportPNG: {},
                onExportSVG: {},
                onCopyImage: { .copied },
                onExportCsv: {},
                busy: true
            )
        }
    }

    #Preview("Copy demo (toast wired)") {
        @Previewable @State var toast = ChartExportMenuSampleToast()
        VStack(spacing: TSSpacing.md) {
            ChartExportMenuPreviewBar(title: "Temperature impact") {
                ChartExportMenu(
                    onExportPNG: {},
                    onExportSVG: {},
                    onCopyImage: { .fallback },
                    onExportCsv: {},
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
