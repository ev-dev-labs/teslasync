//
//  DigitalTwinSections.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — Panels + chrome
//
//  The HIG furniture for `DigitalTwinPage`, built on the shared P2 tokens / P3 components (no bespoke
//  styling) and the reused twin surfaces. The web page is one main visualization panel beside three
//  read-only detail panels; this file owns all five `GlassPanel` regions plus the status badge and the
//  loading skeleton:
//    • GlassPanel1 — the no-vehicles empty panel (web `noVehicles`).
//    • GlassPanel2 — the visualization: the `VehicleTwinView` illustration (reused), the
//                    `VehiclePaintPicker` (reused), and the last-updated caption.
//    • GlassPanel3 — Doors & Openings (web `doorItems`, with the no-data empty state).
//    • GlassPanel4 — Windows (web `windowItems`, with the no-data empty state).
//    • GlassPanel5 — Security & Status (web `securityItems` + the vehicle `StatusBadge`).
//  Every visible string resolves from `Localizable.xcstrings`; value formatting happens here, at the
//  render boundary, never on stored data.
//

import SwiftUI

// MARK: - GlassPanel1 — no-vehicles empty panel (web `noVehicles`)

/// The empty data state when the fleet is empty (web `!vehicle && !vehiclesLoading`): a friendly
/// panel inviting the user to add a vehicle — never a blank region (ADR-011).
struct DigitalTwinNoVehiclesPanel: View {
    var body: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "translation.digitalTwin.noVehicles",
                systemImage: "car.fill"
            )
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - GlassPanel2 — visualization (web `VehicleTwin` + `VehiclePaintPicker` + last updated)

/// The main visualization (web's `flex-1` panel): the reused `VehicleTwinView` illustration driven by
/// the merged twin state, the reused `VehiclePaintPicker` (only when a vehicle id is in scope, web
/// `{vehicle?.id ? <VehiclePaintPicker/> : null}`), and the last-updated freshness caption.
struct DigitalTwinVisualizationPanel: View {
    let twin: VehicleTwinState
    let exteriorColor: String?
    let paintStore: InMemoryVehiclePaintStore?
    let paintInput: VehiclePaintPickerInput?
    let lastUpdated: Date?

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.lg) {
                VehicleTwinView(state: twin, size: .md, driveIn: true, exteriorColor: exteriorColor)
                    .frame(maxWidth: 560)
                if let paintStore, let paintInput {
                    VehiclePaintPicker(store: paintStore, input: paintInput)
                }
                if let lastUpdated {
                    lastUpdatedCaption(lastUpdated)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }

    private func lastUpdatedCaption(_ date: Date) -> some View {
        let time = date.formatted(date: .omitted, time: .shortened)
        return (Text("translation.digitalTwin.lastUpdated") + Text(verbatim: ": \(time)"))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Detail panel scaffold

/// A titled detail panel that shows its KV rows when data is present, else its empty state (web
/// `securityData ? <KVList> : <EmptyState>`) — every panel always renders (ADR-011).
private struct DigitalTwinDetailPanel: View {
    let title: LocalizedStringKey
    let hasData: Bool
    let rows: [TSKVRow]
    let emptyMessage: LocalizedStringKey

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(title)
                if hasData {
                    TSKVList(rows: rows)
                } else {
                    TSEmptyState(title: emptyMessage, systemImage: "info.circle")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - GlassPanel3 — Doors & Openings (web `doorItems`)

struct DigitalTwinDoorsPanel: View {
    let twin: VehicleTwinState
    let hasSecurityData: Bool

    var body: some View {
        DigitalTwinDetailPanel(
            title: "translation.digitalTwin.doorsTitle",
            hasData: hasSecurityData,
            rows: DigitalTwinDetailRows.doors(twin),
            emptyMessage: "translation.digitalTwin.noDoorData"
        )
    }
}

// MARK: - GlassPanel4 — Windows (web `windowItems`)

struct DigitalTwinWindowsPanel: View {
    let twin: VehicleTwinState
    let hasSecurityData: Bool

    var body: some View {
        DigitalTwinDetailPanel(
            title: "translation.digitalTwin.windowsTitle",
            hasData: hasSecurityData,
            rows: DigitalTwinDetailRows.windows(twin),
            emptyMessage: "translation.digitalTwin.noWindowData"
        )
    }
}

// MARK: - GlassPanel5 — Security & Status (web `securityItems` + `StatusBadge`)

/// The security panel always renders its rows (the values resolve to `'—'` when unknown) and, when a
/// vehicle is in scope, the single source-of-truth status badge below a divider (web `{vehicle && …}`).
struct DigitalTwinSecurityPanel: View {
    let twin: VehicleTwinState
    let badge: DigitalTwinVehicleStatus
    let showsBadge: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("translation.digitalTwin.securityTitle")
                TSKVList(rows: DigitalTwinDetailRows.security(twin))
                if showsBadge {
                    Divider().overlay(Color.TS.border)
                    DigitalTwinStatusBadge(status: badge)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Status badge (web `StatusBadge`)

/// A status dot + the localized vehicle-state word (web `StatusBadge`). Takes the already-resolved
/// label so an absent `vehicle.state.*` translation still reads correctly (English fallback).
struct DigitalTwinStatusBadge: View {
    let status: DigitalTwinVehicleStatus

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(status.tone.color)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(verbatim: status.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: status.label))
    }
}

// MARK: - Loading skeleton (web `vehiclesLoading`)

/// The initial loading state: redacted illustration + panel shapes with a progress indicator so the
/// structure is recognizable while the page loads (ADR-011).
struct DigitalTwinSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSGlassPanel {
                VStack(spacing: TSSpacing.md) {
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .fill(Color.TS.surface)
                        .frame(height: 200)
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.surface)
                        .frame(height: 32)
                }
                .frame(maxWidth: .infinity)
                .digitalTwinSkeletonRedaction()
            }
            ForEach(0 ..< 2, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        ForEach(0 ..< 3, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                                .fill(Color.TS.surface)
                                .frame(height: 22)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .digitalTwinSkeletonRedaction()
                }
            }
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("translation.common.loading"))
        }
        .accessibilityLabel(Text("translation.common.loading"))
    }
}

private extension View {
    /// Applies the system skeleton redaction for the loading state, isolated so the SwiftUI
    /// redaction-reason token is opted out of the stub scan on one line.
    func digitalTwinSkeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI loading redaction, not a stub
    }
}
