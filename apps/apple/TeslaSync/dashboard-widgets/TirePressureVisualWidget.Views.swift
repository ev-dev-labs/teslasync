//
//  TirePressureVisualWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  The presentational subviews composed by `TirePressureVisualWidget`: the
//  top-down car silhouette with four color-coded tires (a `Canvas` port of the
//  web `CarDiagram` SVG), the per-corner value cell, the All-Normal / Check
//  Pressure status chip, the live/stale/offline freshness chip, and the
//  stale/offline connectivity banner. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Status chip (web `Badge` variant success / warning / danger)

/// A capsule status chip styled with the shared badge tokens, taking a
/// pre-localized `String` (the shared `TSBadge` is `LocalizedStringKey`-only and
/// can't express our per-surface table) plus an optional leading SF Symbol.
struct TirePressureChip: View {
    let tone: TSTone
    let label: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 9, weight: .semibold))
            }
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The header freshness indicator — a tinted dot + label reflecting the bound
/// source's live-state (web `WidgetShell` freshness intent).
struct TireFreshnessChip: View {
    let connection: TirePressureConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = TirePressureStrings.string("widget.tireLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = TirePressureStrings.string("widget.tireStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = TirePressureStrings.string("widget.tireOffline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached values are clearly labeled.
struct TireConnectivityBanner: View {
    let connection: TirePressureConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.tireOfflineBanner" : "widget.tireStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known pressure"
            : "Reconnecting — pressure may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            TirePressureStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Per-corner value cell (web left/right value columns)

/// One corner's stacked label + pressure value (web `text-[10px] uppercase`
/// label over the bold tone-colored value). `alignment` flips for the left
/// (trailing) and right (leading) columns, matching the web layout.
struct TireValueCell: View {
    let reading: TireReading
    let unit: TirePressureUnit
    let locale: Locale
    let alignment: HorizontalAlignment

    var body: some View {
        let corner = TirePressureStrings.string(reading.corner.key, reading.corner.fallback)
        let value = TirePressureFormatter.format(kilopascals: reading.kilopascals, unit: unit, locale: locale)
        VStack(alignment: alignment, spacing: 1) {
            Text(verbatim: corner)
                .font(.system(size: 10, weight: .medium))
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(reading.status.tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(corner) \(value) \(unit.label)"))
    }
}

/// The two stacked cells for one side of the car (FL over RL, or FR over RR).
struct TireValueColumn: View {
    let top: TireReading
    let bottom: TireReading
    let unit: TirePressureUnit
    let locale: Locale
    let alignment: HorizontalAlignment

    var body: some View {
        VStack(alignment: alignment, spacing: 0) {
            TireValueCell(reading: top, unit: unit, locale: locale, alignment: alignment)
            Spacer(minLength: TSSpacing.sm)
            TireValueCell(reading: bottom, unit: unit, locale: locale, alignment: alignment)
        }
        .frame(maxHeight: .infinity)
        .frame(minWidth: 50)
    }
}

// MARK: - Car diagram (web `CarDiagram` SVG → SwiftUI Canvas)

/// A top-down car silhouette with four tire indicators, each filled by its
/// pressure status — the native port of the web `CarDiagram` (SVG viewBox
/// 0 0 120 180). Drawn in a `Canvas` for crisp scaling; exposed to VoiceOver via
/// the parent's combined summary (the diagram itself is decorative, matching the
/// web `aria-hidden`).
struct TireCarDiagram: View {
    let projection: TirePressureProjection

    /// Web SVG viewBox dimensions.
    private let viewBox = CGSize(width: 120, height: 180)

    /// Tire glyph geometry in viewBox units (web `<rect width=16 height=26 rx=4>`).
    private let tireSize = CGSize(width: 16, height: 26)
    private let tireRadius: CGFloat = 4

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / viewBox.width, size.height / viewBox.height)
            let drawn = CGSize(width: viewBox.width * scale, height: viewBox.height * scale)
            let originX = (size.width - drawn.width) / 2
            let originY = (size.height - drawn.height) / 2

            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: originX + x * scale, y: originY + y * scale)
            }

            drawBody(context: context, scale: scale, point: point)
            drawTires(context: context, scale: scale, point: point)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 140)
        .accessibilityHidden(true)
    }

    private func drawBody(
        context: GraphicsContext,
        scale: CGFloat,
        point: (CGFloat, CGFloat) -> CGPoint
    ) {
        // Car body outline (web rect x=30 y=16 w=60 h=148 rx=16).
        let bodyRect = CGRect(
            origin: point(30, 16),
            size: CGSize(width: 60 * scale, height: 148 * scale)
        )
        let body = Path(roundedRect: bodyRect, cornerRadius: 16 * scale, style: .continuous)
        context.stroke(body, with: .color(Color.TS.border), lineWidth: max(1, 1.5 * scale))

        // Windshield + rear-window hints (web lines at y=52 / y=132).
        for yPos in [CGFloat(52), CGFloat(132)] {
            var hint = Path()
            hint.move(to: point(36, yPos))
            hint.addLine(to: point(84, yPos))
            context.stroke(hint, with: .color(Color.TS.border.opacity(0.6)), lineWidth: max(0.5, scale))
        }
    }

    private func drawTires(
        context: GraphicsContext,
        scale: CGFloat,
        point: (CGFloat, CGFloat) -> CGPoint
    ) {
        for reading in projection.readings {
            let anchor = position(for: reading.corner)
            let rect = CGRect(
                origin: point(anchor.x, anchor.y),
                size: CGSize(width: tireSize.width * scale, height: tireSize.height * scale)
            )
            let tire = Path(roundedRect: rect, cornerRadius: tireRadius * scale, style: .continuous)
            context.fill(tire, with: .color(reading.status.diagramFill.opacity(0.85)))
        }
    }

    /// Top-left anchor (viewBox units) for each tire (web `tirePositions`).
    private func position(for corner: TireCorner) -> CGPoint {
        switch corner {
        case .frontLeft: CGPoint(x: 14, y: 28)
        case .frontRight: CGPoint(x: 90, y: 28)
        case .rearLeft: CGPoint(x: 14, y: 126)
        case .rearRight: CGPoint(x: 90, y: 126)
        }
    }
}
