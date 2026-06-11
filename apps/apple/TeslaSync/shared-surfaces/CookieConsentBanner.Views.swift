//
//  CookieConsentBanner.Views.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The presentational subviews composed by `CookieConsentBanner` when the banner is presented: the
//  header (shield badge + title + body), the underlined "Manage preferences" / "Hide details"
//  disclosure toggle (web `aria-expanded`), the two informed-consent category cards (web details
//  `<li>`s, with the strictly-necessary "Always on" pill), and the Accept all / Decline non-essential
//  action row. All copy resolves through the P1/S10 facade and all colour comes from the P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex. Every interactive control is an individually
//  focusable element with its own VoiceOver label.
//

import SwiftUI

// MARK: - Header (web shield IconBox + title + body)

/// The banner header — the shield badge, the title, and the GDPR body copy. Combined into one
/// VoiceOver element so the dialog is announced as a single coherent introduction.
struct CookieConsentHeader: View {
    private var title: String {
        CookieConsentStrings.string("consent.banner.title", "Cookies & analytics")
    }

    private var bodyText: String {
        CookieConsentStrings.string(
            "consent.banner.body",
            "TeslaSync uses strictly necessary storage to keep you signed in and to remember your "
                + "preferences. With your consent, we also collect anonymous performance and error "
                + "reports to improve the app. You can change your mind any time in Settings → Privacy."
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ConsentIconBadge()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: bodyText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Disclosure toggle (web `aria-expanded` "Manage preferences" / "Hide details")

/// The underlined inline disclosure toggle — flips the two informed-consent cards in and out without
/// leaving the banner context (web inline details, deliberately not a separate modal). Carries the
/// expanded / collapsed state as a VoiceOver value, mirroring the web `aria-expanded`.
struct CookieConsentDisclosureToggle: View {
    let expanded: Bool
    let onToggle: () -> Void

    private var title: String {
        ConsentDisclosure.title(expanded: expanded, localize: CookieConsentStrings.string)
    }

    private var stateValue: String {
        expanded
            ? CookieConsentStrings.string("consent.disclosure.expanded", "Expanded")
            : CookieConsentStrings.string("consent.disclosure.collapsed", "Collapsed")
    }

    var body: some View {
        Button(action: onToggle) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .underline()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: stateValue))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Informed-consent category card (web details `<li>`)

/// One informed-consent card — the category title (with the "Always on" pill for strictly-necessary
/// storage) and the explanatory body, on a bordered inset surface. Combined into one VoiceOver element
/// via the adapter's category summary so it is announced coherently.
struct CookieConsentCategoryCard: View {
    let category: ConsentCategory

    private var title: String {
        CookieConsentStrings.string(category.titleKey, category.titleFallback)
    }

    private var bodyText: String {
        CookieConsentStrings.string(category.bodyKey, category.bodyFallback)
    }

    private var accessibilityText: String {
        CookieConsentAdapter.categoryAccessibility(category, localize: CookieConsentStrings.string)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if category.alwaysOn {
                    AlwaysOnBadge()
                }
            }
            Text(verbatim: bodyText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

/// The expanded informed-consent list — the two category cards in order (web details `<ul>`).
struct CookieConsentCategoryList: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(ConsentCatalog.categories) { category in
                CookieConsentCategoryCard(category: category)
            }
        }
    }
}

// MARK: - Actions (web Accept all / Decline non-essential)

/// The decision row — Accept all (primary) and Decline non-essential (ghost). Wraps to a vertical
/// stack when the horizontal space is tight (large Dynamic Type) so neither label is clipped. There is
/// deliberately no dismiss control: dismissing without choosing is not consent.
struct CookieConsentActions: View {
    let onAccept: () -> Void
    let onDecline: () -> Void

    private var acceptTitle: String {
        CookieConsentStrings.string("consent.banner.accept", "Accept all")
    }

    private var declineTitle: String {
        CookieConsentStrings.string("consent.banner.decline", "Decline non-essential")
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) {
                buttons
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                buttons
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        TSButton(variant: .primary, size: .medium, action: onAccept) {
            Text(verbatim: acceptTitle)
        }
        .accessibilityLabel(Text(verbatim: acceptTitle))

        TSButton(variant: .ghost, size: .medium, action: onDecline) {
            Text(verbatim: declineTitle)
        }
        .accessibilityLabel(Text(verbatim: declineTitle))
    }
}
