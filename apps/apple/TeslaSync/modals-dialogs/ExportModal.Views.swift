//
//  ExportModal.Views.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The populated content for `ExportModal` (web `Modal` body): the summary block (a mini grid preview +
//  the dashboard name + a widget-count / JSON-size chip pair + the "Updated {date}" line), the export
//  options (the primary "Download JSON File" plus the "Copy to Clipboard" / "Copy Shareable URL" ghost
//  rows, the latter disabled when the share URL is over-length), and the over-length warning banner (web
//  `AlertBanner variant="warning"`). All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). Binds through `ExportModel` (P1/S8). The connectivity / inline-error / freshness
//  chrome lives in ExportModal.States.swift.
//

import SwiftUI

// MARK: - Populated panel (web populated modal body)

/// The export panel: an optional connectivity / inline-error banner, the dashboard summary, the export
/// options, and the over-length share warning (web `space-y-5`).
struct ExportPopulatedView: View {
    @Bindable var model: ExportModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                if model.connection != .live {
                    ExportConnectivityBanner(connection: model.connection)
                }
                if let message = model.inlineErrorMessage {
                    ExportInlineErrorBanner(message: message)
                }
                ExportSummaryView(model: model)
                ExportOptionsView(model: model)
                if let warning = model.shareWarningMessage {
                    ExportWarningBanner(message: warning)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Summary (web mini grid + name + badges + updated)

/// The dashboard summary (web summary row): the mini grid preview beside the name, the widget-count /
/// size chips, and the "Updated {date}" line.
struct ExportSummaryView: View {
    @Bindable var model: ExportModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ExportMiniGridView(grid: model.miniGrid)
                .frame(width: 120)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: model.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                chips
                Text(verbatim: model.updatedText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summaryLabel))
    }

    private var chips: some View {
        HStack(spacing: TSSpacing.sm) {
            ExportSummaryChip(systemImage: "shippingbox", text: model.widgetCountText)
            ExportSummaryChip(systemImage: nil, text: model.jsonSizeText)
        }
    }

    private var summaryLabel: String {
        "\(model.summaryAccessibilityLabel), \(model.updatedText)"
    }
}

/// One neutral summary chip (web `Badge variant="neutral"`): an optional leading glyph + verbatim value
/// over a tinted capsule. The value is operator data / a computed size, rendered verbatim.
struct ExportSummaryChip: View {
    let systemImage: String?
    let text: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(verbatim: text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.textMuted.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Mini grid preview (web `MiniGridPreview`)

/// The mini grid preview (web `MiniGridPreview`): the `lg` layout laid out in a fixed-aspect container,
/// each placed cell positioned by its fractions. Decorative — the summary's text conveys the same
/// information to VoiceOver, so the grid is hidden from the accessibility tree.
struct ExportMiniGridView: View {
    let grid: ExportMiniGrid

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                ForEach(grid.cells) { cell in
                    cellView(cell, in: geo.size)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .aspectRatio(grid.aspectRatio, contentMode: .fit)
        .background(Color.TS.surfaceGlass.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityHidden(true)
    }

    private func cellView(_ cell: ExportMiniGridCell, in size: CGSize) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 0.5)
            )
            .overlay(glyph(for: cell))
            .padding(1)
            .frame(width: size.width * cell.widthFraction, height: size.height * cell.heightFraction)
            .offset(x: size.width * cell.leftFraction, y: size.height * cell.topFraction)
    }

    @ViewBuilder
    private func glyph(for cell: ExportMiniGridCell) -> some View {
        if cell.hasWidget {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 8, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Export options (web download + two copy buttons)

/// The export options (web option list): the primary download action and the two copy actions.
struct ExportOptionsView: View {
    @Bindable var model: ExportModel

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ExportDownloadButton(
                label: model.localize("export.downloadFile", "Download JSON File"),
                action: model.requestDownload
            )
            ExportCopyRow(
                systemImage: "doc.on.doc",
                label: model.localize("export.copyClipboard", "Copy to Clipboard"),
                isDisabled: false,
                onCopy: model.copyJSON
            )
            ExportCopyRow(
                systemImage: "link",
                label: model.localize("export.copyShareUrl", "Copy Shareable URL"),
                isDisabled: model.shareURLTooLong,
                onCopy: model.copyShareURL
            )
        }
    }
}

/// The primary "Download JSON File" action (web `Button variant="primary" className="w-full
/// justify-start"`): a full-width, leading-aligned primary button with a download glyph.
struct ExportDownloadButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        TSButton(variant: .primary, size: .medium, action: action) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 14, weight: .semibold))
                Text(verbatim: label)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// One full-width, leading-aligned copy action (web `CopyButton variant="ghost" className="w-full
/// justify-start"`): the copy itself is performed by the injected model command (clipboard seam); this
/// view reflects the brief Copy → Copied confirmation and honors the disabled (over-length) state.
struct ExportCopyRow: View {
    let systemImage: String
    let label: String
    let isDisabled: Bool
    let onCopy: () -> Void
    @State private var didCopy = false

    var body: some View {
        TSButton(variant: .ghost, size: .medium, action: copy) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: didCopy ? "checkmark.circle.fill" : systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.accent)
                Text(verbatim: didCopy ? copiedLabel : label)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: didCopy ? copiedLabel : label))
        .accessibilityHint(Text(verbatim: label))
    }

    private var copiedLabel: String {
        ExportStrings.string("export.copied", "Copied")
    }

    private func copy() {
        guard !isDisabled else { return }
        onCopy()
        didCopy = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopy = false
        }
    }
}

// MARK: - Over-length warning (web `AlertBanner variant="warning"`)

/// The share-URL-too-long warning (web `AlertBanner variant="warning"` with the `AlertTriangle` icon):
/// a tinted warning box carrying the dynamic over-length message verbatim.
struct ExportWarningBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
