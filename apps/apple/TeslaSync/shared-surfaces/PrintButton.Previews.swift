//
//  PrintButton.Previews.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  Xcode previews for each branch the web source renders: the resting "Print" button, the icon-only
//  dense variant, a custom-label variant (web `label`), the disabled state, and a live demo wired to
//  an in-memory presenter + a `beforePrint` hook (so the print request count + the awaited setup hook
//  are visible in the canvas without the real print server). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux page-header toolbar row hosting the button on its trailing edge, so the control reads in
    /// context (its production home: the `PageContainer` actions slot).
    private struct PrintButtonPreviewRow<Trailing: View>: View {
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

    #Preview("Resting (Print)") {
        PrintButtonPreviewRow(title: "Battery report") {
            PrintButton(presenter: InMemoryPrintPresenter())
        }
    }

    #Preview("Icon only") {
        PrintButtonPreviewRow(title: "Drive summary") {
            PrintButton(presenter: InMemoryPrintPresenter(), iconOnly: true)
        }
    }

    #Preview("Custom label") {
        PrintButtonPreviewRow(title: "Charging history") {
            PrintButton(presenter: InMemoryPrintPresenter(), label: "Print snapshot")
        }
    }

    #Preview("Disabled (loading)") {
        PrintButtonPreviewRow(title: "Loading report") {
            PrintButton(presenter: InMemoryPrintPresenter(), disabled: true)
        }
    }

    #Preview("Print demo (live presenter)") {
        @Previewable @State var presenter = InMemoryPrintPresenter()
        VStack(spacing: TSSpacing.md) {
            PrintButtonPreviewRow(title: "Trip log") {
                PrintButton(
                    beforePrint: { try? await Task.sleep(for: .milliseconds(50)) },
                    presenter: presenter
                )
            }
            Text(verbatim: "prints requested: \(presenter.presentCount)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .background(Color.TS.bg)
    }
#endif
