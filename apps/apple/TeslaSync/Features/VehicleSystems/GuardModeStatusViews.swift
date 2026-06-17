//
//  GuardModeStatusViews.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Shared UI + Row 1
//
//  The shared HIG furniture (the `GlassPanel` peer, section title, badge, the
//  triggered alert banner) plus Row 1's three panels: the arm/disarm toggle
//  (GlassPanel 1), the status card (GlassPanel 2) and the emergency PANIC card
//  (GlassPanel 3). Materials stand in for the web glass (ADR-005); every string
//  resolves from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel / SectionTitle / Badge)

/// The frosted card that stands in for the web `GlassPanel`.
struct GuardModeCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(.white.opacity(0.06), lineWidth: 1)
            )
    }
}

/// Uppercase section heading (web `text-sm font-semibold uppercase tracking-wider`).
struct GuardModeSectionTitle: View {
    let text: String
    var centered = false

    var body: some View {
        Text(text)
            .font(.caption)
            .fontWeight(.semibold)
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }
}

/// Small status pill (web `Badge`).
struct GuardModeBadge: View {
    let text: String
    let tone: GuardModeBadgeTone

    var body: some View {
        Text(text)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(tone.color)
            .background(tone.color.opacity(0.15), in: Capsule())
    }
}

/// The danger banner shown when the newest event is unacknowledged (web `AlertBanner`).
struct GuardModeTriggeredBanner: View {
    let event: GuardModeEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.title2)
                .foregroundStyle(.red)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(localized: "translation.guard.alertTriggered", defaultValue: "Guard Alert Triggered!"))
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.red.opacity(0.4), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        let label = GuardModeEventDisplay.label(for: event.eventType)
        let stamp = event.ts.formatted(date: .abbreviated, time: .shortened)
        return "\(label) — \(stamp)"
    }
}

// MARK: - GlassPanel 1 — Guard toggle

/// The arm/disarm hero toggle (web GlassPanel 1).
struct GuardModeTogglePanel: View {
    let armState: GuardModeArmState
    let isArmed: Bool
    let isUpdating: Bool
    let onToggle: () -> Void

    var body: some View {
        GuardModeCard {
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(armState.tint.opacity(0.18))
                        .frame(width: 84, height: 84)
                    Image(systemName: armState.symbol)
                        .font(.system(size: 38))
                        .foregroundStyle(armState.tint)
                }
                .accessibilityHidden(true)

                Text(armState.title)
                    .font(.title3)
                    .fontWeight(.bold)

                Toggle(isOn: toggleBinding) {
                    Text(String(localized: "translation.guard.enableGuard", defaultValue: "Guard Mode"))
                }
                .toggleStyle(.switch)
                .fixedSize()

                if isUpdating {
                    Text(String(localized: "translation.guard.updating", defaultValue: "Updating..."))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(armState.title))
    }

    private var toggleBinding: Binding<Bool> {
        Binding(get: { isArmed }, set: { _ in onToggle() })
    }
}

// MARK: - GlassPanel 2 — Status card

/// The live status summary (web GlassPanel 2).
struct GuardModeStatusPanel: View {
    let armedSinceText: String
    let isLocked: Bool
    let sentryActive: Bool
    let unacknowledgedSummary: String

    var body: some View {
        GuardModeCard {
            VStack(alignment: .leading, spacing: 12) {
                GuardModeSectionTitle(
                    text: String(localized: "translation.guard.status", defaultValue: "Status")
                )
                VStack(alignment: .leading, spacing: 8) {
                    GuardModeStatusRow(symbol: "clock", text: armedSinceText)
                    GuardModeStatusRow(symbol: isLocked ? "lock.fill" : "lock.open.fill", text: lockText)
                    GuardModeStatusRow(symbol: "eye.fill", text: sentryText)
                    GuardModeStatusRow(symbol: "exclamationmark.triangle", text: unacknowledgedSummary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var lockText: String {
        isLocked
            ? String(localized: "translation.guard.locked", defaultValue: "Vehicle locked")
            : String(localized: "translation.guard.unlocked", defaultValue: "Vehicle unlocked")
    }

    private var sentryText: String {
        sentryActive
            ? String(localized: "translation.guard.sentryOn", defaultValue: "Sentry mode active")
            : String(localized: "translation.guard.sentryOff", defaultValue: "Sentry mode off")
    }
}

/// One icon + label status line.
struct GuardModeStatusRow: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(width: 20)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 3 — Emergency PANIC

/// The emergency PANIC card (web GlassPanel 3).
struct GuardModePanicPanel: View {
    let isPanicking: Bool
    let isDisabled: Bool
    let onPanic: () -> Void

    var body: some View {
        GuardModeCard {
            VStack(spacing: 14) {
                Image(systemName: "light.beacon.max.fill")
                    .font(.system(size: 38))
                    .foregroundStyle(.red)
                    .accessibilityHidden(true)

                GuardModeSectionTitle(
                    text: String(localized: "translation.guard.emergency", defaultValue: "Emergency"),
                    centered: true
                )

                Button(role: .destructive, action: onPanic) {
                    Text(buttonLabel)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .controlSize(.large)
                .disabled(isPanicking || isDisabled)

                Text(String(
                    localized: "translation.guard.panicDesc",
                    defaultValue: "Flash lights, honk horn, lock doors, enable sentry, and notify all channels"
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var buttonLabel: String {
        isPanicking
            ? String(localized: "translation.guard.panicking", defaultValue: "Sending...")
            : String(localized: "translation.guard.panicButton", defaultValue: "🚨 PANIC")
    }
}
