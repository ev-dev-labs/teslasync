//
//  LiveSignalsWidget.Sections.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  The four-quadrant signal grid that the surface composes: the shared 2-column
//  grid, the per-quadrant section scaffold (icon + localized heading), the concrete
//  Motor / Climate / Tires / Security sections, and the label→value row + security
//  badge primitives. All chrome resolves through the P1/S10 facade and P1/S9 tokens.
//

import SwiftUI

// MARK: - Quadrant identity (icon + heading shared by skeleton + content)

/// One quadrant of the signal grid. Carries the SF Symbol, the localization key,
/// and the tinted icon tone so the loading scaffold and the populated section
/// render an identical heading (web `<h4><Icon /> {t(...)}</h4>`).
enum LiveSignalsSection: String, CaseIterable, Identifiable {
    case motor
    case climate
    case tires
    case security

    var id: String {
        rawValue
    }

    var systemImage: String {
        switch self {
        case .motor: "gearshape.fill"
        case .climate: "thermometer.medium"
        case .tires: "circle.circle.fill"
        case .security: "shield.fill"
        }
    }

    var titleKey: String {
        switch self {
        case .motor: "widget.motor"
        case .climate: "widget.climate"
        case .tires: "widget.tires"
        case .security: "widget.security"
        }
    }

    var titleFallback: String {
        switch self {
        case .motor: "Motor"
        case .climate: "Climate"
        case .tires: "Tires"
        case .security: "Security"
        }
    }

    var iconTone: Color {
        switch self {
        case .motor: Color.TS.chartSeriesPower
        case .climate: Color.TS.accent
        case .tires: Color.TS.accent
        case .security: Color.TS.statusInfo
        }
    }
}

// MARK: - Grid + section scaffold

/// The two-column quadrant grid (web `grid grid-cols-2 gap-4 h-full`).
struct LiveSignalsGrid<Content: View>: View {
    @ViewBuilder var content: Content

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
        GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A single quadrant: the icon + uppercase heading, then the supplied body (rows or
/// a skeleton). Mirrors the web `<div className="space-y-1.5">` column.
struct LiveSignalsSectionScaffold<Content: View>: View {
    let section: LiveSignalsSection
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: 4) {
                Image(systemName: section.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(section.iconTone)
                    .accessibilityHidden(true)
                Text(verbatim: LiveSignalsStrings.string(section.titleKey, section.titleFallback))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Concrete sections (rows when loaded, skeleton while the DTO is pending)

/// Drivetrain quadrant: Torque / Temp / Gear (web Motor column).
struct LiveSignalsMotorSection: View {
    let rows: LiveSignalsMotorRows?

    var body: some View {
        LiveSignalsSectionScaffold(section: .motor) {
            if let rows {
                VStack(spacing: TSSpacing.xs) {
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.torque", "Torque"), value: rows.torque)
                    LiveSignalsRow(
                        label: LiveSignalsStrings.string("widget.motorTemp", "Temp"),
                        value: rows.temperature
                    )
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.gear", "Gear"), value: rows.gear)
                }
            } else {
                LiveSignalsSectionSkeleton()
            }
        }
    }
}

/// Climate quadrant: Cabin / Outside / HVAC (web Climate column).
struct LiveSignalsClimateSection: View {
    let rows: LiveSignalsClimateRows?

    var body: some View {
        LiveSignalsSectionScaffold(section: .climate) {
            if let rows {
                VStack(spacing: TSSpacing.xs) {
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.cabin", "Cabin"), value: rows.cabin)
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.outside", "Outside"), value: rows.outside)
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.hvac", "HVAC"), value: rows.hvac)
                }
            } else {
                LiveSignalsSectionSkeleton()
            }
        }
    }
}

/// Tire-pressure quadrant: FL / FR / RL / RR (web Tires column).
struct LiveSignalsTiresSection: View {
    let rows: LiveSignalsTireRows?

    var body: some View {
        LiveSignalsSectionScaffold(section: .tires) {
            if let rows {
                VStack(spacing: TSSpacing.xs) {
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.tire.fl", "FL"), value: rows.frontLeft)
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.tire.fr", "FR"), value: rows.frontRight)
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.tire.rl", "RL"), value: rows.rearLeft)
                    LiveSignalsRow(label: LiveSignalsStrings.string("widget.tire.rr", "RR"), value: rows.rearRight)
                }
            } else {
                LiveSignalsSectionSkeleton()
            }
        }
    }
}

/// Security quadrant: Lock + Sentry badges (web Security column).
struct LiveSignalsSecuritySection: View {
    let rows: LiveSignalsSecurityRows?

    var body: some View {
        LiveSignalsSectionScaffold(section: .security) {
            if let rows {
                VStack(spacing: TSSpacing.xs) {
                    securityRow(
                        label: LiveSignalsStrings.string("widget.lock", "Lock"),
                        badge: rows.locked
                            ? LiveSignalsStrings.string("widget.locked", "Locked")
                            : LiveSignalsStrings.string("widget.unlocked", "Unlocked"),
                        tone: rows.locked ? .success : .danger
                    )
                    securityRow(
                        label: LiveSignalsStrings.string("widget.sentry", "Sentry"),
                        badge: rows.sentryActive
                            ? LiveSignalsStrings.string("widget.active", "Active")
                            : LiveSignalsStrings.string("widget.off", "Off"),
                        tone: rows.sentryActive ? .success : .neutral
                    )
                }
            } else {
                LiveSignalsSectionSkeleton()
            }
        }
    }

    private func securityRow(label: String, badge: String, tone: TSTone) -> some View {
        HStack {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.xs)
            LiveSignalsBadge(tone: tone, label: badge)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label), \(badge)"))
    }
}

// MARK: - Row + badge primitives

/// One label→value row (web `Row`): muted caption label, bold truncated value.
struct LiveSignalsRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.xs)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label), \(value)"))
    }
}

/// A capsule status chip styled with the shared badge tokens, taking a
/// pre-localized string (web `Badge` with success/danger/neutral variants).
struct LiveSignalsBadge: View {
    let tone: TSTone
    let label: String

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// The per-section redacted skeleton shown until that quadrant's DTO arrives
/// (web `<Skeleton className="h-12" />`).
struct LiveSignalsSectionSkeleton: View {
    var body: some View {
        TSSkeleton(height: 48, cornerRadius: TSRadius.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
