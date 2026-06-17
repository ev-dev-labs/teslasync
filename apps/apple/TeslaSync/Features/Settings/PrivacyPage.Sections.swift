//
//  PrivacyPage.Sections.swift
//  TeslaSync — P4-APPLE P7 · page:settings/Privacy (Apple) — Sections
//
//  The regions of the web `PrivacySection` (one `GlassPanel` with an `IconBox` header and two
//  inset sub-cards), reproduced natively in the same data + grouping + order:
//    1. the header (web `ShieldCheck` `IconBox` + title + subtitle),
//    2. "Recently viewed pages" — body + stored-count + the silence-aware Clear control,
//    3. "Cookies & analytics consent" (always rendered) — switched body copy + current-state label
//       + the Re-grant / Withdraw / Reset controls.
//  Every visible literal resolves from `Localizable.xcstrings` under the web key names; every
//  control binds through the `@Observable` `PrivacyPageModel`.
//

import SwiftUI

// MARK: - Privacy card (web `GlassPanel`)

/// The single frosted panel framing the privacy header and its two inset regions (web `GlassPanel
/// className="p-5"` with `rounded-xl` sub-cards). `onRequestClear` bubbles the Clear press up to the
/// page, which owns the confirmation flow (web `<ConfirmDialog>`); the consent controls mutate the
/// model directly (web's inline handlers).
struct PrivacySectionCard: View {
    let model: PrivacyPageModel
    let isCompact: Bool
    let onRequestClear: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                PrivacySectionHeader()
                RecentPagesRegion(
                    model: model,
                    isCompact: isCompact,
                    onRequestClear: onRequestClear
                )
                ConsentRegion(model: model, isCompact: isCompact)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `IconBox` + title + subtitle)

/// The privacy header (web `flex items-start gap-4` row: a cyan `ShieldCheck` `IconBox`, the
/// section title, and the "only affects this browser" subtitle).
struct PrivacySectionHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "checkmark.shield.fill", tone: .info)
            VStack(alignment: .leading, spacing: 2) {
                TSPanelTitle("translation.privacy.title")
                TSCaption("translation.privacy.subtitle")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Region 1 — recently viewed pages (web "Recently viewed pages")

/// The recent-pages region (web `getRecentPages`): the title + body, the live stored-count, and the
/// Clear control, disabled when nothing is stored (web `disabled={count === 0}`).
struct RecentPagesRegion: View {
    let model: PrivacyPageModel
    let isCompact: Bool
    let onRequestClear: () -> Void

    var body: some View {
        PrivacyRegion(isCompact: isCompact) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSText("translation.recentPages.clearTitle")
                    .fontWeight(.medium)
                TSCaption("translation.recentPages.clearBody")
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: storedCountText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityLabel(Text(verbatim: storedCountText))
            }
        } trailing: {
            TSButton(
                variant: .secondary,
                action: onRequestClear,
                label: {
                    Label("translation.recentPages.clearButton", systemImage: "trash")
                }
            )
            .disabled(!model.hasRecentPages)
            .accessibilityLabel(Text("translation.recentPages.clearButton"))
        }
    }

    /// Web `t('recentPages.storedCount', { count })` — the pluralized "N entries stored" caption,
    /// resolved through the catalog's plural variation at the display boundary.
    private var storedCountText: String {
        String.localizedStringWithFormat(
            NSLocalizedString("translation.recentPages.storedCount", comment: ""),
            model.recentPagesCount
        )
    }
}

// MARK: - Region 2 — cookies & analytics consent (web "Cookies & analytics consent")

/// The consent region (web `getConsent`): always rendered (even when consent is gated off) so
/// operators can preview the flow. Shows the switched body copy, the current-state label, and the
/// Re-grant / Withdraw / Reset controls, each disabled when already in that state.
struct ConsentRegion: View {
    let model: PrivacyPageModel
    let isCompact: Bool

    var body: some View {
        PrivacyRegion(isCompact: isCompact) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSText("translation.consent.section.title")
                    .fontWeight(.medium)
                TSCaption(model.consentBodyKey)
                    .fixedSize(horizontal: false, vertical: true)
                Text(model.consentStateLabelKey)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(model.consentStateLabelKey))
            }
        } trailing: {
            consentActions
        }
        .accessibilityElement(children: .contain)
    }

    private var consentActions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton("translation.consent.action.accept", variant: .primary) {
                model.acceptConsent()
            }
            .disabled(model.consent == .accepted)
            TSButton("translation.consent.action.decline", variant: .secondary) {
                model.declineConsent()
            }
            .disabled(model.consent == .declined)
            TSButton("translation.consent.action.reset", variant: .ghost) {
                model.resetConsent()
            }
            .disabled(model.consent == .unknown)
        }
    }
}

// MARK: - Shared region container (web inset `rounded-xl border bg-surface-2 p-4` sub-card)

/// One inset sub-card with a leading title block and a trailing action group, laid out side by side
/// on regular width and stacked on compact (web `flex … justify-between … flex-wrap`).
struct PrivacyRegion<Leading: View, Trailing: View>: View {
    private let isCompact: Bool
    private let leading: () -> Leading
    private let trailing: () -> Trailing

    init(
        isCompact: Bool,
        @ViewBuilder leading: @escaping () -> Leading,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.isCompact = isCompact
        self.leading = leading
        self.trailing = trailing
    }

    var body: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    leading()
                    trailing().frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    leading()
                    Spacer(minLength: TSSpacing.sm)
                    trailing()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}
