//
//  TOTPEnrollmentSection.Views.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The status-surface subviews composed by `TOTPEnrollmentSection`: the loading
//  panel (web `Spinner`), the open-mode / empty notice (web
//  `data-testid="totp-section-open-mode"`), the QueryError-equivalent failure
//  state with retry, the resolved status panel (web GlassPanel header + the
//  not-enrolled / activated bodies), and the freshness chip + stale/offline
//  banner. All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 design tokens + components — no networking, no Tailwind ports.
//  The modal contents live in `TOTPEnrollmentSection.Modals`.
//

import SwiftUI

// MARK: - Status pill (web `Badge` — runtime string the LocalizedStringKey-only TSBadge can't take)

/// The Active / Not-enrolled pill (web `Badge variant={activated ? 'success' :
/// 'neutral'}`). Mirrors the shared `TSBadge` tokens but takes the runtime,
/// already-localized status string the `LocalizedStringKey`-only `TSBadge`
/// cannot express.
struct TOTPStatusPill: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Loading panel (web `<Spinner size="sm" /> + Loading…`)

/// The in-flight panel: a small spinner beside the "Loading two-factor settings…"
/// label, on a glass panel (web `status.isLoading` branch).
struct TOTPLoadingPanel: View {
    var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                HStack(spacing: TSSpacing.md) {
                    ProgressView().controlSize(.small)
                    TOTPEnrollmentStrings.text("totp.loading", "Loading two-factor settings…")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Open-mode / empty notice (web `totp-section-open-mode`)

/// The "feature requires authenticated mode" notice (web open-mode branch),
/// which doubles as the resolved-empty surface so the section never renders
/// blank: an amber icon box, the title, and the forward-auth helper text.
struct TOTPOpenModePanel: View {
    var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.md) {
                        TSIconBox(systemName: "exclamationmark.triangle.fill", tone: .warning)
                        TOTPEnrollmentStrings.text("totp.title", "Two-factor authentication")
                            .font(Font.TS.panel)
                            .foregroundStyle(Color.TS.textPrimary)
                            .accessibilityAddTraits(.isHeader)
                    }
                    TOTPEnrollmentStrings.text(
                        "totp.openMode.message",
                        """
                        Per-user TOTP requires forward-auth mode. Configure your reverse proxy \
                        to inject X-Forwarded-User then reload.
                        """
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error panel (web `QueryError` equivalent + retry)

/// The no-cached-status failure state: a danger glyph, the failure title, the
/// underlying message, and a retry affordance wired to the model. The Apple HIG
/// states contract requires this where the web silently collapses a failed
/// status into the open-mode notice.
struct TOTPErrorPanel: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityHidden(true)
                    TOTPEnrollmentStrings.text(
                        "totp.cards.errorTitle", "Couldn't load two-factor settings"
                    )
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                    if !message.isEmpty {
                        Text(verbatim: message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    TSButton(variant: .secondary, size: .small, action: onRetry) {
                        TOTPEnrollmentStrings.text("totp.cards.retry", "Retry")
                    }
                    .accessibilityLabel(TOTPEnrollmentStrings.text("totp.cards.retry", "Retry"))
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Resolved status panel (web GlassPanel header + body)

/// The resolved status panel for the not-enrolled / activated phases. Renders the
/// web header (tinted shield icon box + title + subtitle + status pill) over the
/// phase body, topped with the freshness chip + cached-status banner when the
/// bound source is not live.
struct TOTPStatusPanel: View {
    @Bindable var model: TOTPEnrollmentModel
    let isActivated: Bool

    var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    if model.connection != .live {
                        HStack(spacing: TSSpacing.sm) {
                            Spacer(minLength: 0)
                            TOTPFreshnessChip(connection: model.connection)
                        }
                        TOTPConnectivityBanner(connection: model.connection)
                    }
                    header
                    if isActivated {
                        TOTPActivatedBody(model: model)
                    } else {
                        TOTPNotEnrolledBody(model: model)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(
                    systemName: "checkmark.shield.fill",
                    tone: isActivated ? .success : .info
                )
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TOTPEnrollmentStrings.text("totp.title", "Two-factor authentication")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    TOTPEnrollmentStrings.text(
                        "totp.subtitle",
                        """
                        TOTP codes from your authenticator app are required for the sudo \
                        step-up before destructive admin actions.
                        """
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            TOTPStatusPill(
                text: isActivated
                    ? TOTPEnrollmentStrings.string("totp.status.active", "Active")
                    : TOTPEnrollmentStrings.string("totp.status.notEnrolled", "Not enrolled"),
                tone: isActivated ? .success : .neutral
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.headerAccessibilityLabel))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Activated body (web `last_used_at` + remaining + regenerate/disable)

/// The active-credential body: the last-used + backup-codes-remaining fields and
/// the Regenerate / Disable actions (web `activated` branch).
struct TOTPActivatedBody: View {
    @Bindable var model: TOTPEnrollmentModel

    private let columns = [
        GridItem(.flexible(), alignment: .topLeading),
        GridItem(.flexible(), alignment: .topLeading)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                TOTPLabeledField(
                    label: TOTPEnrollmentStrings.string("totp.lastUsed.label", "Last used"),
                    value: model.statusModel.lastUsedText
                )
                TOTPLabeledField(
                    label: TOTPEnrollmentStrings.string(
                        "totp.backupCodesRemaining.label", "Backup codes remaining"
                    ),
                    value: String(model.statusModel.backupCodesRemaining)
                )
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: model.activatedAccessibilityLabel))

            HStack(spacing: TSSpacing.sm) {
                TSButton(variant: .ghost, isLoading: model.regeneratePending) {
                    model.regenerate()
                } label: {
                    Label {
                        TOTPEnrollmentStrings.text("totp.actions.regenerate", "Regenerate backup codes")
                    } icon: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .accessibilityLabel(
                    TOTPEnrollmentStrings.text("totp.actions.regenerate", "Regenerate backup codes")
                )
                TSButton(variant: .destructive) {
                    model.openDisableConfirm()
                } label: {
                    Label {
                        TOTPEnrollmentStrings.text("totp.actions.disable", "Disable")
                    } icon: {
                        Image(systemName: "trash")
                    }
                }
                .accessibilityLabel(TOTPEnrollmentStrings.text("totp.actions.disable", "Disable"))
            }
        }
    }
}

// MARK: - Not-enrolled body (web Enroll button + hint)

/// The not-enrolled body: the Enable-TOTP action and the authenticator-app hint
/// (web `!activated` branch).
struct TOTPNotEnrolledBody: View {
    @Bindable var model: TOTPEnrollmentModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSButton(variant: .primary, isLoading: model.enrollPending) {
                model.enroll()
            } label: {
                Label {
                    TOTPEnrollmentStrings.text("totp.actions.enroll", "Enable TOTP")
                } icon: {
                    Image(systemName: "key.fill")
                }
            }
            .accessibilityLabel(TOTPEnrollmentStrings.text("totp.actions.enroll", "Enable TOTP"))
            TOTPEnrollmentStrings.text(
                "totp.actions.enrollHint",
                """
                Compatible with Google Authenticator, 1Password, Bitwarden, Authy and other \
                RFC 6238 clients.
                """
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Labeled field (web label + value pair)

/// One labeled value in the activated grid (web `Text variant="label"` + value).
struct TOTPLabeledField: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown
/// only when the source is not live, so the normal panel stays as clean as the
/// web source.
struct TOTPFreshnessChip: View {
    let connection: TOTPConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TOTPEnrollmentStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TOTPEnrollmentStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: TOTPConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "totp.cards.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "totp.cards.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "totp.cards.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the panel when the bound source is not
/// live, so the last-known status is clearly labeled as cached.
struct TOTPConnectivityBanner: View {
    let connection: TOTPConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "totp.cards.offlineBanner" : "totp.cards.staleBanner"
        let fallback = offline
            ? "Offline — showing last known two-factor status"
            : "Reconnecting — two-factor status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            TOTPEnrollmentStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
