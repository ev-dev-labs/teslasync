//
//  selectedVehicle.Views.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The presentation primitives the surface composes: the header (title + freshness chip), the
//  resolved-selection card (the focused vehicle's name + id + persistence note + "Clear
//  selection"), the empty state (no selection / empty fleet, with the "select the first
//  vehicle" action when one exists), the error notice (failed fleet read → retry), the loading
//  skeleton, and the freshness chip + connectivity banner the native state matrix adds. All
//  render over the shared design tokens (P1/S9) — no hardcoded colors, no English literals
//  (copy via P1/S10).
//

import SwiftUI

// MARK: - Header (title + freshness)

/// The surface header: the title with a freshness chip interposed on the trailing edge when
/// the bound feed is not live.
struct SelectedVehicleStoreHeader: View {
    let title: String
    let connection: SelectedVehicleStoreConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            if connection != .live {
                SelectedVehicleStoreFreshnessChip(connection: connection)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Resolved selection (content — the focused vehicle)

/// The content phase: a vehicle is resolved (URL > store > first). Shows the focused vehicle's
/// name + id and where the selection is stored, with a "Clear selection" action (web
/// `setVehicleId(null)`). Never a blank box.
struct SelectedVehicleStoreSelectedView: View {
    let vehicleName: String
    let bodyText: String
    let idLabel: String
    let vehicleId: Int?
    let persistenceNote: String
    let persistence: SelectedVehicleStorePersistence
    let clearLabel: String
    let onClear: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "car.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: vehicleName)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if let vehicleId {
                Text(verbatim: "\(idLabel) \(vehicleId)")
                    .font(Font.TS.bodySm.monospacedDigit())
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text(verbatim: bodyText)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            SelectedVehicleStorePersistenceNote(note: persistenceNote, persistence: persistence)
            TSButton(variant: .secondary, size: .small, action: onClear) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "xmark.circle")
                        .accessibilityHidden(true)
                    Text(verbatim: clearLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: clearLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Persistence note (where the selection is stored)

/// The small note under the resolved selection describing where it is stored — durable,
/// in-session only, or untracked — with a matching glyph + tone.
struct SelectedVehicleStorePersistenceNote: View {
    let note: String
    let persistence: SelectedVehicleStorePersistence

    var body: some View {
        let descriptor = Self.descriptor(for: persistence)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.symbol)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: note)
                .font(Font.TS.caption)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let symbol: String
        let tone: Color
    }

    private static func descriptor(for persistence: SelectedVehicleStorePersistence) -> Descriptor {
        switch persistence {
        case .persisted:
            Descriptor(symbol: "checkmark.circle.fill", tone: Color.TS.statusSuccess)
        case .ephemeral:
            Descriptor(symbol: "clock.badge.exclamationmark", tone: Color.TS.statusWarning)
        case .disconnected:
            Descriptor(symbol: "icloud.slash", tone: Color.TS.textMuted)
        }
    }
}

// MARK: - Empty state (no selection / empty fleet)

/// The empty state — no vehicle is resolved (the fleet is empty, or the saved selection is no
/// longer in the fleet). Renders over the shared `TSEmptyState`; offers a "select the first
/// vehicle" action when a candidate exists (web `setVehicleId(firstVehicle.id)`).
struct SelectedVehicleStoreEmptyView: View {
    let title: String
    let message: String
    let candidateName: String?
    let selectLabel: String
    let onSelectCandidate: () -> Void

    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(title),
            message: LocalizedStringKey(message),
            systemImage: "car.fill"
        ) {
            if candidateName != nil {
                TSButton(variant: .primary, size: .medium, action: onSelectCandidate) {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "checkmark.circle.fill")
                            .accessibilityHidden(true)
                        Text(verbatim: selectLabel)
                    }
                }
                .accessibilityLabel(Text(verbatim: selectLabel))
                .accessibilityHint(Text(verbatim: message))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error notice (failed fleet read → retry)

/// The fleet-read failure state with a retry affordance (web `QueryError`). Never a blank box.
struct SelectedVehicleStoreErrorView: View {
    let title: String
    let message: String
    let retryLabel: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
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
                Text(verbatim: retryLabel)
            }
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-paint loading state: a redacted stand-in for the resolved-selection card so the
/// panel doesn't reflow when the fleet resolves.
struct SelectedVehicleStoreLoadingView: View {
    let label: String

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 56, height: 56, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 200, height: 16)
            TSSkeleton(width: 260, height: 12)
            TSSkeleton(width: 150, height: 24, cornerRadius: TSRadius.md)
            TSSkeleton(width: 140, height: 32, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SelectedVehicleStoreFreshnessChip: View {
    let connection: SelectedVehicleStoreConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }

    private struct Descriptor {
        let tone: Color
        let label: String
    }

    private static func descriptor(for connection: SelectedVehicleStoreConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, label: SelectedVehicleStoreStrings.string(
                "selectedVehicle.live", "Live"
            ))
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, label: SelectedVehicleStoreStrings.string(
                "selectedVehicle.stale", "Stale"
            ))
        case .offline:
            Descriptor(tone: Color.TS.textMuted, label: SelectedVehicleStoreStrings.string(
                "selectedVehicle.offline", "Offline"
            ))
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the panel when the bound source is not live, so a cached
/// selection is clearly labeled (ADR-013).
struct SelectedVehicleStoreConnectivityBanner: View {
    let connection: SelectedVehicleStoreConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "selectedVehicle.offlineBanner" : "selectedVehicle.staleBanner"
        let fallback = offline
            ? "Offline — showing your last saved selection"
            : "Reconnecting — this may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: SelectedVehicleStoreStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
