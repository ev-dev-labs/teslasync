//
//  UserImpersonateButton.Views.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  The composed subviews for the UserImpersonateButton surface: the action button
//  (web ghost `Button` + `UserCog` icon), the loading skeleton, the status-error
//  retry, the unavailable / offline notes (web hidden-in-open-mode → friendly
//  state), the freshness chip + stale/offline banners, and the started / failed
//  action feedback. Every user-facing string routes through the P1/S10 facade;
//  every interactive element carries a VoiceOver label.
//

import SwiftUI

// MARK: - Action state (loaded + actionable): button + feedback

struct ImpersonateActionState: View {
    let model: UserImpersonateButtonModel

    private var availability: ImpersonationAvailability {
        model.availability ?? .available
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                ImpersonateActionButton(model: model)
                if model.connection != .live {
                    ImpersonateFreshnessChip(connection: model.connection)
                }
                Spacer(minLength: 0)
            }

            if let note = ImpersonationUnavailableNote.project(availability) {
                ImpersonateInlineNote(
                    systemImage: note.systemImage,
                    key: note.messageKey,
                    fallback: note.messageFallback,
                    tone: .neutral
                )
            }

            switch model.actionPhase {
            case .started:
                ImpersonateStartedPill()
            case let .failed(message):
                ImpersonateStartFailedNote(message: message) { model.retryStart() }
            case .idle, .starting:
                EmptyView()
            }

            if model.connection == .offline {
                ImpersonateBanner(
                    tone: .neutral,
                    key: "impersonation.banner.offline",
                    fallback: "Offline — showing last known status.",
                    systemImage: "wifi.slash"
                )
            } else if model.connection == .stale {
                ImpersonateBanner(
                    tone: .warning,
                    key: "impersonation.banner.stale",
                    fallback: "Status may be out of date.",
                    systemImage: "clock.arrow.circlepath"
                )
            }
        }
    }
}

// MARK: - Action button (web ghost `Button` + `UserCog` icon)

struct ImpersonateActionButton: View {
    let model: UserImpersonateButtonModel

    var body: some View {
        let label = model.buttonLabel
        let a11yLabel = ImpersonateAccessibility.buttonLabel(
            subject: model.subject,
            format: UserImpersonateButtonStrings.format
        )
        return TSButton(
            variant: .ghost,
            size: .small,
            isLoading: model.actionPhase == .starting,
            action: { model.requestStart() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "person.badge.key.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: UserImpersonateButtonStrings.string(label.key, label.fallback))
                }
            }
        )
        .disabled(model.isButtonDisabled)
        .accessibilityLabel(Text(verbatim: a11yLabel))
        .accessibilityIdentifier(ImpersonateAccessibility.testID(subject: model.subject))
    }
}

// MARK: - Loading (skeleton button)

struct ImpersonateLoading: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 132, height: 28, cornerRadius: TSRadius.md)
            Spacer(minLength: 0)
        }
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: UserImpersonateButtonStrings.string(
                "impersonation.status.loading",
                "Checking impersonation status…"
            ))
        )
    }
}

// MARK: - Status error (web query error → retry)

struct ImpersonateStatusError: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ImpersonateInlineNote(
                systemImage: "exclamationmark.triangle.fill",
                key: "impersonation.status.error",
                fallback: "Couldn’t load impersonation status.",
                tone: .danger
            )
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: UserImpersonateButtonStrings.string("impersonation.action.retry", "Retry"))
            }
            .accessibilityLabel(
                Text(verbatim: UserImpersonateButtonStrings.string("impersonation.action.retry", "Retry"))
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Unavailable (web hidden-in-open-mode → friendly note)

struct ImpersonateUnavailableState: View {
    let note: ImpersonationUnavailableNote

    var body: some View {
        ImpersonateInlineNote(
            systemImage: note.systemImage,
            key: note.messageKey,
            fallback: note.messageFallback,
            tone: .neutral
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Offline (no connectivity, no cached status)

struct ImpersonateOfflineUnavailable: View {
    var isOffline = true

    var body: some View {
        ImpersonateInlineNote(
            systemImage: isOffline ? "wifi.slash" : "tray",
            key: isOffline ? "impersonation.banner.offline" : "impersonation.status.empty",
            fallback: isOffline ? "Offline — showing last known status." : "Impersonation status is unavailable.",
            tone: .neutral
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Started feedback (web global `ImpersonationBanner` driver)

struct ImpersonateStartedPill: View {
    var body: some View {
        let label = UserImpersonateButtonStrings.string("impersonation.start.started", "Impersonation started")
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(TSTone.success.color)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(TSTone.success.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(TSTone.success.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(TSTone.success.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Start-failed feedback (inline error + retry)

struct ImpersonateStartFailedNote: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.octagon.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TSTone.danger.color)
                    .accessibilityHidden(true)
                Text(verbatim: failureText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: UserImpersonateButtonStrings.string("impersonation.action.retry", "Retry"))
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            TSTone.danger.color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private var failureText: String {
        let prefix = UserImpersonateButtonStrings.string("impersonation.start.failed", "Couldn’t start impersonation")
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? prefix : "\(prefix). \(trimmed)"
    }
}

// MARK: - Freshness chip (live / stale / offline)

struct ImpersonateFreshnessChip: View {
    let connection: ImpersonationConnection

    var body: some View {
        let chip = ImpersonationConnectionChip.project(connection)
        let label = UserImpersonateButtonStrings.string(chip.labelKey, chip.labelFallback)
        return HStack(spacing: 4) {
            Circle()
                .fill(chip.tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Inline note (icon + message)

struct ImpersonateInlineNote: View {
    let systemImage: String
    let key: String
    let fallback: String
    let tone: TSTone

    var body: some View {
        let label = UserImpersonateButtonStrings.string(key, fallback)
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Inline banner (stale / offline)

struct ImpersonateBanner: View {
    let tone: TSTone
    let key: String
    let fallback: String
    let systemImage: String

    var body: some View {
        let label = UserImpersonateButtonStrings.string(key, fallback)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
