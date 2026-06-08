//
//  PrivacySection.Views.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The presentational subviews composed by `PrivacySection`: the header (web `IconBox`
//  + title + subtitle), the two control panels (recent-pages + consent, web `rounded-xl
//  border bg-surface-2 p-4`), the consent-policy status banner (the P4 states contract),
//  the destructive clear-confirmation sheet (web `ConfirmDialog` + its silence checkbox),
//  the auto-dismissing success toast (web `useToast().success`), and the loading skeleton.
//  All consume pre-localized strings from the P1/S10 facade + the shared P1/S9 tokens and
//  the design-system `TSButton`; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Action button (web `Button` variants, surface-local disabled handling)

/// A consent / clear action button — the design-system `TSButton` wrapped with the
/// surface's facade-resolved title, an optional leading glyph, and the web disabled
/// dimming (`TSButtonStyle` is state-agnostic, so the dim is applied here).
struct PrivacyActionButton: View {
    let title: String
    var systemImage: String?
    var variant: TSButtonVariant = .primary
    var disabled: Bool = false
    var accessibilityLabelText: String?
    let action: () -> Void

    var body: some View {
        TSButton(variant: variant, size: .large, action: action) {
            HStack(spacing: TSSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 13, weight: .semibold))
                        .accessibilityHidden(true)
                }
                Text(verbatim: title)
            }
        }
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText ?? title))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Header (web `IconBox` + title + subtitle)

/// The section header — the cyan shield icon box plus the title + subtitle copy.
struct PrivacyHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 40, height: 40)
                .background(
                    Color.TS.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                PrivacyStrings.text("privacy.title", "Privacy")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                PrivacyStrings.text(
                    "privacy.subtitle",
                    "Manage local browsing history surfaces. These settings only affect this browser."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Row panel (web `rounded-xl border bg-surface-2 p-4`)

/// The inner control panel container — a tokened surface with the glass border, hosting
/// one control group (recent-pages or consent).
struct PrivacyRowPanel<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Recent-pages row (web "Recently viewed pages")

/// The recent-pages control — title + body + the count counter (or the friendly empty
/// hint when the list is empty) plus the destructive clear button (disabled at zero).
/// Adapts from a side-by-side row to a stacked column on narrow widths (web `flex-wrap`).
struct PrivacyRecentRow: View {
    let count: Int
    let onClear: () -> Void

    private var isEmpty: Bool {
        PrivacyAdapter.recentIsEmpty(count: count)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                textBlock
                Spacer(minLength: TSSpacing.lg)
                clearButton
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                textBlock
                clearButton
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var textBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            PrivacyStrings.text("recentPages.clearTitle", "Recently viewed pages")
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            PrivacyStrings.text(
                "recentPages.clearBody",
                "Wipe the list of pages used by the dashboard widget and the Recent section in the command palette."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            countOrEmpty
        }
        .frame(minWidth: 220, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: PrivacyAdapter.recentAccessibility(
            count: count,
            localize: PrivacyStrings.string
        )))
    }

    @ViewBuilder
    private var countOrEmpty: some View {
        if isEmpty {
            PrivacyStrings.text(
                "recentPages.emptyHint",
                "No recently viewed pages yet — pages you visit will appear here."
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.top, TSSpacing.xs)
        } else {
            Text(verbatim: PrivacyAdapter.recentCountText(count: count, localize: PrivacyStrings.string))
                .font(Font.TS.bodySm.monospacedDigit())
                .foregroundStyle(Color.TS.textMuted)
                .padding(.top, TSSpacing.xs)
        }
    }

    private var clearButton: some View {
        PrivacyActionButton(
            title: PrivacyStrings.string("recentPages.clearButton", "Clear recent pages"),
            systemImage: "trash",
            variant: .secondary,
            disabled: isEmpty,
            action: onClear
        )
    }
}

// MARK: - Consent row (web "Cookies & analytics consent")

/// The cookie/analytics consent control — title + body (on/off by deployment policy) +
/// the current decision label plus the accept / decline / reset buttons (each disabled
/// when its state is already active). Adapts to a stacked column on narrow widths.
struct PrivacyConsentRow: View {
    let consent: PrivacyConsentState
    let requireConsent: Bool
    let onAction: (PrivacyConsentAction) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                textBlock
                Spacer(minLength: TSSpacing.lg)
                actionRow
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                textBlock
                actionColumn
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var textBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            PrivacyStrings.text("consent.section.title", "Cookies & analytics consent")
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: PrivacyAdapter.consentBody(requireConsent: requireConsent, localize: PrivacyStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: PrivacyAdapter.consentStateLabel(consent, localize: PrivacyStrings.string))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.top, TSSpacing.xs)
        }
        .frame(minWidth: 220, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: PrivacyAdapter.consentAccessibility(consent: consent, localize: PrivacyStrings.string))
        )
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            acceptButton
            declineButton
            resetButton
        }
    }

    private var actionColumn: some View {
        VStack(spacing: TSSpacing.sm) {
            acceptButton
            declineButton
            resetButton
        }
    }

    private var acceptButton: some View {
        PrivacyActionButton(
            title: PrivacyStrings.string("consent.action.accept", "Re-grant consent"),
            variant: .primary,
            disabled: PrivacyAdapter.isConsentActionDisabled(.accept, consent: consent),
            action: { onAction(.accept) }
        )
    }

    private var declineButton: some View {
        PrivacyActionButton(
            title: PrivacyStrings.string("consent.action.decline", "Withdraw consent"),
            variant: .secondary,
            disabled: PrivacyAdapter.isConsentActionDisabled(.decline, consent: consent),
            action: { onAction(.decline) }
        )
    }

    private var resetButton: some View {
        PrivacyActionButton(
            title: PrivacyStrings.string("consent.action.reset", "Reset"),
            variant: .ghost,
            disabled: PrivacyAdapter.isConsentActionDisabled(.reset, consent: consent),
            action: { onAction(.reset) }
        )
    }
}
