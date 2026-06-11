//
//  Avatar.Views.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  The presentational subviews composed by `Avatar`: the palette → `Color` bridge and the ink
//  tone mapping (P1/S9 tokens), the fallback disc (hashed-colour or neutral background carrying
//  the initials or the generic glyph), the remote image layer (`AsyncImage`, the platform parity
//  of the web `<img>` with its load-error fallback), the person / Helix glyphs, the presence dot,
//  the shape clip, the tooltip modifier, and the composed `AvatarContent`. All colour comes from
//  the P1/S9 tokens (or the pinned Okabe-Ito palette); no Tailwind ports, no raw hex literals in
//  the layout.
//
//  The Helix mark is named `AvatarHelixMark` (not the bare `HelixMark`) so the surface stays
//  self-contained and does not collide with another shared surface's internal mark in the single
//  app module.
//

import SwiftUI

// MARK: - Palette + ink tone → Color (P1/S9 bridge)

extension AvatarPalette {
    /// The SwiftUI swatch colour for an index — the pinned Okabe-Ito sRGB components (identical to
    /// `Color.TS.chartCategorical`) materialised as a `Color`.
    static func color(forIndex index: Int) -> Color {
        let swatch = swatch(forIndex: index)
        return Color(.sRGB, red: swatch.red, green: swatch.green, blue: swatch.blue, opacity: 1)
    }
}

extension AvatarInkTone {
    /// The rendered foreground colour — white (the web default) or the dark ink used on light
    /// swatches where white fails AA large-text contrast.
    var color: Color {
        switch self {
        case .white: .white
        case .ink: Color(.sRGB, white: 0.12, opacity: 1)
        }
    }
}

extension AvatarStatus {
    /// The presence dot hue — the semantic tokens that keep "online = good" consistent app-wide
    /// (web emerald / amber / grey).
    var tone: Color {
        switch self {
        case .online: Color.TS.statusSuccess
        case .idle: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Shape clip (web `rounded-full` / `rounded-lg`)

/// The avatar outline — a circle or an 8 pt continuous rounded rectangle, used both to clip the
/// disc + image and to fill the background so the two always agree.
struct AvatarClipShape: Shape {
    let shape: AvatarShape

    func path(in rect: CGRect) -> Path {
        switch shape {
        case .circle:
            Path(ellipseIn: rect)
        case .rounded:
            Path(roundedRect: rect, cornerRadius: TSRadius.sm, style: .continuous)
        }
    }
}

// MARK: - Initials (web `avatar-initials` span)

/// The deterministic initials drawn on the colour disc. Decorative (the identity is voiced on the
/// composed avatar element); a minimum scale factor keeps two characters inside the smallest disc.
struct AvatarInitialsLabel: View {
    let text: String
    let size: AvatarSize
    let tone: AvatarInkTone

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: size.initialsFontSize, weight: .semibold))
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .foregroundStyle(tone.color)
            .accessibilityHidden(true)
    }
}

// MARK: - Generic glyph (web `User` / `HelixMark`)

/// The no-name fallback glyph — the system person mark for `user`, the Helix brand mark for
/// `bot`. Sized to ~60% of the disc (web `glyphSize`). Decorative.
struct AvatarGlyph: View {
    let kind: AvatarKind
    let size: AvatarSize
    let tone: AvatarInkTone
    let isAttributed: Bool

    private var color: Color {
        isAttributed ? tone.color : Color.TS.textSecondary
    }

    var body: some View {
        glyph
            .frame(width: size.glyphPoints, height: size.glyphPoints)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var glyph: some View {
        switch kind {
        case .user:
            Image(systemName: "person.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(color)
        case .bot:
            AvatarHelixMark(size: size.glyphPoints, tint: color)
        }
    }
}

// MARK: - Helix brand mark (native port of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — two intertwined quadratic strands crossing at the centre with two
/// horizontal rungs, the native port of the web `HelixMark` SVG (`viewBox 0 0 24 24`).
/// Decorative; the assistant identity is voiced by the composed avatar element.
struct AvatarHelixMark: View {
    var size: CGFloat
    var tint: Color

    var body: some View {
        AvatarHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: max(1, size * (1.75 / 24)), lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path — the verbatim port of the web `HelixMark` SVG geometry, scaled from its
/// 24-unit viewBox to the requested frame: strand A `M 8 2 Q 18 7 12 12 Q 6 17 16 22`, strand B
/// (mirrored about x=12) `M 16 2 Q 6 7 12 12 Q 18 17 8 22`, and two rungs at y=7 and y=17.
struct AvatarHelixMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func point(_ pathX: CGFloat, _ pathY: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + pathX * scale, y: rect.minY + pathY * scale)
        }
        var path = Path()
        // Strand A: top-left → centre → bottom-right.
        path.move(to: point(8, 2))
        path.addQuadCurve(to: point(12, 12), control: point(18, 7))
        path.addQuadCurve(to: point(16, 22), control: point(6, 17))
        // Strand B: mirrored about x=12, crossing strand A at the centre.
        path.move(to: point(16, 2))
        path.addQuadCurve(to: point(12, 12), control: point(6, 7))
        path.addQuadCurve(to: point(8, 22), control: point(18, 17))
        // Two rungs where the strands run nearly parallel.
        path.move(to: point(10, 7))
        path.addLine(to: point(14, 7))
        path.move(to: point(10, 17))
        path.addLine(to: point(14, 17))
        return path
    }
}

// MARK: - Fallback disc (web initials / glyph background)

/// The fallback disc — a hashed-colour background (web `CHART_COLORS_CB_SAFE[colorIndex]`) when
/// the avatar is attributed, or a neutral surface for the truly-anonymous case (web
/// `--surface-2`), carrying the initials or the generic glyph. Always present, so the avatar is
/// never blank — it is what shows during image load, on image failure, and when there is no image.
struct AvatarFallbackDisc: View {
    let resolved: AvatarResolved

    private var background: Color {
        resolved.isAttributed
            ? AvatarPalette.color(forIndex: resolved.colorIndex)
            : Color.TS.textMuted.opacity(0.22)
    }

    var body: some View {
        ZStack {
            AvatarClipShape(shape: resolved.shape).fill(background)
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch resolved.fallback {
        case let .initials(text):
            AvatarInitialsLabel(text: text, size: resolved.size, tone: resolved.inkTone)
        case let .glyph(kind):
            AvatarGlyph(
                kind: kind,
                size: resolved.size,
                tone: resolved.inkTone,
                isAttributed: resolved.isAttributed
            )
        }
    }
}

// MARK: - Remote image (web `<img>` with onError fallback)

/// The remote image layer — `AsyncImage`, the platform parity of the web `<img>`. While loading
/// or on failure the phase yields nothing and the fallback disc beneath shows through (the native
/// parity of the web `onError` → initials/glyph). The fade-in honours Reduce Motion. Decorative;
/// the identity is voiced on the composed avatar element.
struct AvatarRemoteImage: View {
    let src: String?
    let reduceMotion: Bool

    private var url: URL? {
        guard let src, !src.isEmpty else { return nil }
        return URL(string: src)
    }

    var body: some View {
        AsyncImage(
            url: url,
            transaction: Transaction(animation: reduceMotion ? nil : .easeInOut(duration: 0.2))
        ) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            case .empty, .failure:
                Color.clear
            @unknown default:
                Color.clear
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Presence dot (web status dot)

/// The corner presence dot — a coloured circle with a surface-toned ring, anchored bottom-trailing.
/// Decorative: the presence is spoken through the composed avatar's accessibility value.
struct AvatarStatusDot: View {
    let status: AvatarStatus
    let size: AvatarSize

    var body: some View {
        Circle()
            .fill(status.tone)
            .frame(width: size.statusDotDiameter, height: size.statusDotDiameter)
            .overlay(
                Circle().stroke(Color.TS.surface, lineWidth: size.statusRingWidth)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Tooltip (web `<Tooltip>`)

/// Applies the pointer tooltip (web `<Tooltip content={…}>`) when a label is present. macOS shows
/// it on hover; on iOS / iPadOS it backs the long-press / pointer affordance.
struct AvatarTooltip: ViewModifier {
    let text: String?

    func body(content: Content) -> some View {
        if let text {
            content.help(Text(verbatim: text))
        } else {
            content
        }
    }
}

// MARK: - Composed avatar content

/// The composed avatar — the fallback disc (always present), the optional remote image layered
/// over it, the presence dot in the corner, the optional tooltip, and a single VoiceOver element
/// whose label is the identity and whose value is the presence. The pure render of `AvatarResolved`.
struct AvatarContent: View {
    let resolved: AvatarResolved
    let src: String?
    let identity: String
    let presence: String?
    let tooltip: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var diameter: CGFloat {
        resolved.size.points
    }

    var body: some View {
        disc
            .frame(width: diameter, height: diameter)
            .overlay(alignment: .bottomTrailing) { presenceDot }
            .modifier(AvatarTooltip(text: tooltip))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: identity))
            .accessibilityValue(Text(verbatim: presence ?? ""))
            .accessibilityAddTraits(.isImage)
    }

    private var disc: some View {
        ZStack {
            AvatarFallbackDisc(resolved: resolved)
            if resolved.hasImage {
                AvatarRemoteImage(src: src, reduceMotion: reduceMotion)
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(AvatarClipShape(shape: resolved.shape))
    }

    @ViewBuilder
    private var presenceDot: some View {
        if let status = resolved.status {
            AvatarStatusDot(status: status, size: resolved.size)
        }
    }
}
