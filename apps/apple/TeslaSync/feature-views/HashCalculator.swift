//
//  HashCalculator.swift
//  TeslaSync — P4 feature view · 0015 · HashCalculator (Apple)
//
//  The HashCalculator feature view — the SwiftUI parity of
//  features/admin/components/devtools/tools/HashCalculator.tsx. A red-iconed tool
//  card (web `ToolCard color="red"`) with a text editor, a "Compute Sha256" action,
//  and the resulting SHA-256 digest with a copy button. Every state renders (idle /
//  computing / result / error); the view binds through `HashCalculatorModel` and
//  performs no work of its own beyond driving the model.
//

import Foundation
import SwiftUI

// MARK: - HashCalculator (the feature surface)

/// The composable Hash Calculator devtool surface. Reproduces the web tool's data,
/// composition, and states with native primitives + the shared component library;
/// the compute runs locally (web `crypto.subtle.digest`) so the surface needs no
/// network and works fully offline.
public struct HashCalculatorView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HashCalculatorSurface.slug

    @State private var model: HashCalculatorModel

    public init(model: HashCalculatorModel = HashCalculatorModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    inputField
                    computeButton
                    resultSection
                }
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web ToolCard head: icon chip + title + description)

private extension HashCalculatorView {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HashCalculatorStrings.text("devtools.hash.title", "Hash Calculator")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                HashCalculatorStrings.text(
                    "devtools.hash.description",
                    "Compute a SHA-256 digest of any text, locally"
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// The red icon chip (web `ICON_COLOR_MAP.red`: tinted fill + ring).
    var iconChip: some View {
        Image(systemName: "number")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.statusDanger)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.statusDanger.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Input (web label + Textarea)

private extension HashCalculatorView {
    var inputField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HashCalculatorStrings.text("devtools.hash.inputLabel", "Hash Input")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TSTextArea(text: $model.input, minHeight: 64)
                .overlay(alignment: .topLeading) { inputPrompt }
                .accessibilityLabel(HashCalculatorStrings.text("devtools.hash.inputLabel", "Hash Input"))
                .accessibilityHint(HashCalculatorStrings.text(
                    "devtools.hash.inputHint",
                    "Enter text to compute its SHA-256 hash"
                ))
        }
    }

    /// The prompt hint shown while the editor is empty (web Textarea empty hint).
    /// Non hit-testing + a11y-hidden so it never blocks input or repeats the label.
    @ViewBuilder
    var inputPrompt: some View {
        if model.input.isEmpty {
            HashCalculatorStrings.text("devtools.hash.inputPrompt", "Paste text to hash")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.leading, TSSpacing.sm + 5)
                .padding(.top, TSSpacing.sm + 8)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Compute action (web primary Button with loading + Hash icon)

private extension HashCalculatorView {
    var computeButton: some View {
        TSButton(
            variant: .primary,
            size: .small,
            isLoading: model.phase == .computing,
            action: { Task { await model.compute() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "number").font(.system(size: 12, weight: .semibold))
                    HashCalculatorStrings.text("devtools.utils.computeSha256", "Compute Sha256")
                }
            }
        )
        .disabled(!model.canCompute)
    }
}

// MARK: - Result states (idle / computing / result / error — all render)

private extension HashCalculatorView {
    @ViewBuilder
    var resultSection: some View {
        switch model.phase {
        case .idle:
            emptyResult
        case .computing:
            computingResult
        case let .result(hex):
            digestResult(hex)
        case .failed:
            failedResult
        }
    }

    /// Idle hint — never a blank box (web hides the chip; we surface a hint instead).
    var emptyResult: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "number")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
            HashCalculatorStrings.text("devtools.hash.emptyResult", "Your SHA-256 digest will appear here")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.textMuted.opacity(0.1), in: resultShape)
        .overlay(resultBorder)
        .accessibilityElement(children: .combine)
    }

    /// Visible loading state while the digest computes (web `computing`).
    var computingResult: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            HashCalculatorStrings.text("devtools.hash.computing", "Computing…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.textMuted.opacity(0.1), in: resultShape)
        .overlay(resultBorder)
        .accessibilityElement(children: .combine)
    }

    /// The finished digest chip with a copy button (web mono `<code>` + `CopyButton`).
    func digestResult(_ hex: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Text(verbatim: hex)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.statusDanger)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(HashCalculatorStrings.text("devtools.hash.resultLabel", "SHA-256 digest"))
                .accessibilityValue(Text(verbatim: hex))
            TSCopyButton(value: hex)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.textMuted.opacity(0.1), in: resultShape)
        .overlay(resultBorder)
    }

    /// Error state with a retry affordance (web `Hash Error`; template `QueryError`).
    var failedResult: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
            HashCalculatorStrings.text("devtools.hash.error", "Hash Error")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TSButton(
                variant: .secondary,
                size: .small,
                action: { Task { await model.compute() } },
                label: { HashCalculatorStrings.text("devtools.hash.retry", "Try again") }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.statusDanger.opacity(0.1), in: resultShape)
        .overlay(resultShape.strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Shared result chrome

private extension HashCalculatorView {
    var resultShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
    }

    var resultBorder: some View {
        resultShape.strokeBorder(Color.TS.border, lineWidth: 1)
    }
}
