//
//  ComputedMetricEditor.PreviewPanel.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The live-preview panel (web preview `<GlassPanel>`) — the parity of the web
//  component's live-preview line. Renders every preview state the source has (idle
//  prompt / computing spinner / error line / settled value line) plus the stale /
//  offline freshness chrome the Apple HIG states contract requires, binding through
//  `ComputedMetricPreviewModel` (P1/S8). All strings resolve through the P1/S10
//  `CMEStrings` facade; all colors/spacing come from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Live-preview panel (web `<GlassPanel>` preview line)

/// The live-preview panel (web preview `<GlassPanel>`). Renders the idle prompt, the
/// computing spinner, the error line, and the settled value line, with the stale /
/// offline freshness chip layered on per the P4 states contract.
struct ComputedMetricPreviewPanel: View {
    let ready: Bool
    let unit: String?
    let preview: ComputedMetricPreviewModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLabel(CMEView.key(ComputedMetricEditorAdapter.Text.preview))
            Spacer(minLength: TSSpacing.sm)
            if ready, preview.phase == .success, preview.connection != .live {
                CMEFreshnessChip(freshness: preview.connection)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !ready {
            idleLine
        } else {
            switch preview.phase {
            case .idle, .computing:
                computingLine
            case .failure:
                errorLine
            case .success:
                valueLine
            }
        }
    }

    private var idleLine: some View {
        CMEView.text(ComputedMetricEditorAdapter.Text.previewIdle)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var computingLine: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            CMEView.text(ComputedMetricEditorAdapter.Text.previewLoading)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }

    private var errorLine: some View {
        Text(verbatim: preview.errorMessage ?? CMEStrings.string(ComputedMetricEditorAdapter.Text.metricsError))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var valueLine: some View {
        if let result = preview.result {
            Text(verbatim: ComputedMetricEditorAdapter.previewLine(
                template: CMEStrings.string(ComputedMetricEditorAdapter.Text.previewValue),
                result: result,
                unit: unit,
                would: CMEStrings.string(ComputedMetricEditorAdapter.Text.would),
                wouldNot: CMEStrings.string(ComputedMetricEditorAdapter.Text.wouldNot)
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            computingLine
        }
    }
}
