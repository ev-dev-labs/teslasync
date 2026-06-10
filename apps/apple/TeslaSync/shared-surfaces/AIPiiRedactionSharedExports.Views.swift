//
//  AIPiiRedactionSharedExports.Views.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The presentational subviews composed by `AIPiiRedactionSharedExports`: the `AIFeatureCard`
//  scaffold parts (header + cyan Helix badge + description + the optional contextual hint) and
//  the export-type input (web `inputSlot` `Select`) + the universal "Ask Helix" action. All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports,
//  no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is cyan-300
//  (badge pill) → the brand cyan `Color.TS.accent`.
//
//  Input parity (ADR-002 native idiom, not literal): the web `<Select>` dropdown → a native
//  `Menu` whose trigger shows the chosen export type or the resting prompt, and whose items pick
//  one of the canonical `SHARED_EXPORT_TYPES`. Like the sibling AINLAutomationBuilder (whose web
//  `<Textarea>` became a tokenised `TextEditor`), the field is bespoke so its label, prompt, and
//  options all resolve through the per-surface i18n facade and expose the web `aria-label`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional contextual hint shown when the action cannot start (web `!canStart && emptyHint`) —
/// telling the user to pick an export type.
struct PiiRedactionExportsHeader: View {
    let hint: PiiRedactionExportsHint?

    private var title: String {
        PiiRedactionExportsStrings.string(
            "exports.aiRedaction.title", "Plan PII redactions before sharing"
        )
    }

    private var description: String {
        PiiRedactionExportsStrings.string(
            "exports.aiRedaction.description",
            """
            Ask Helix to recommend which PII classes to redact from a shared export. The \
            recommendation is catalog-based — Helix never reads the rows of your export; it \
            consults a deterministic per-export-type PII catalog and surfaces the \
            highly-recommended redactions plus the optional ones that depend on your consent. \
            Apply the recommendation by toggling the matching options in your export request.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .pickExportType:
            PiiRedactionExportsStrings.string(
                "exports.aiRedaction.noTypeHint", "Pick an export type to enable Helix."
            )
        case .none:
            nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                PiiRedactionExportsHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let hintText {
                Text(verbatim: hintText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web
/// `AIBadge`. The brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct PiiRedactionExportsHelixBadge: View {
    private var label: String {
        PiiRedactionExportsStrings.string("exports.aiRedaction.badge", "Helix")
    }

    private var tooltip: String {
        PiiRedactionExportsStrings.string(
            "helix.tooltip",
            "Helix is your AI assistant. It generates responses using your redacted fleet context."
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.label)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.10), in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1))
        .help(tooltip)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: PiiRedactionExportsStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Export-type field (web `inputSlot` Select)

/// The export-type chooser — the native parity of the web `<Select>`: a labelled `Menu` whose
/// trigger shows the chosen type's localised name (or the resting prompt when nothing is picked)
/// and whose items are the canonical `SHARED_EXPORT_TYPES`. Tokenised chrome (no raw hex); the
/// field exposes the web `aria-label` ("Export type") as its VoiceOver label and the current
/// choice as its value so the control reads correctly.
struct PiiRedactionExportsTypeField: View {
    @Binding var selection: PiiRedactionExportType?

    private var fieldLabel: String {
        PiiRedactionExportsStrings.string("exports.aiRedaction.exportTypeLabel", "Export type")
    }

    private var emptyPrompt: String {
        PiiRedactionExportsStrings.string(
            "exports.aiRedaction.exportTypePrompt", "Select an export type…"
        )
    }

    private func optionLabel(_ type: PiiRedactionExportType) -> String {
        PiiRedactionExportsStrings.string(type.labelKey, type.defaultLabel)
    }

    private var triggerText: String {
        guard let selection else { return emptyPrompt }
        return optionLabel(selection)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: fieldLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Menu {
                ForEach(PiiRedactionExportType.allCases, id: \.self) { type in
                    Button {
                        selection = type
                    } label: {
                        if selection == type {
                            Label {
                                Text(verbatim: optionLabel(type))
                            } icon: {
                                Image(systemName: "checkmark")
                            }
                        } else {
                            Text(verbatim: optionLabel(type))
                        }
                    }
                }
            } label: {
                menuTrigger
            }
            .menuStyle(.automatic)
            .tint(Color.TS.accent)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: fieldLabel))
            .accessibilityValue(Text(verbatim: triggerText))
        }
    }

    private var menuTrigger: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: triggerText)
                .font(Font.TS.body)
                .foregroundStyle(selection == nil ? Color.TS.textMuted : Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Suggest redactions") folded
/// into the accessibility label ("Ask Helix · Suggest redactions"). Disabled (computed, never
/// literal) from the export-type / stream lifecycle / connectivity. Placed on its own trailing
/// row (web `inputSlot` implies `buttonPlacement="below"`).
struct PiiRedactionExportsActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        PiiRedactionExportsStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        PiiRedactionExportsStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        PiiRedactionExportsStrings.string("exports.aiRedaction.button", "Suggest redactions")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .piiRedactionExportsSymbolPulse(active: isStreaming && !reduceMotion)
                        .accessibilityHidden(true)
                    Text(verbatim: isStreaming ? thinkingLabel : askLabel)
                        .font(Font.TS.label)
                }
            }
            .disabled(disabled)
            .help(verb)
            .accessibilityLabel(Text(verbatim: "\(askLabel) · \(verb)"))
            .accessibilityHint(Text(verbatim: verb))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
