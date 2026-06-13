//
//  TeslaCarViz.Shapes.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The geometry core for the illustration: the design-space → render-frame mapping (``CarCanvasMetrics``),
//  a small SVG-path interpreter (``SVGPathParser``) that turns the web silhouette path strings into SwiftUI
//  `Path`s, and the per-model silhouette data (``CarSilhouette``) ported verbatim from the web `bodies` and
//  `miniPaths` tables. Keeping the silhouettes as their original path data (rather than hand-redrawn) means
//  the native body matches the web silhouette exactly, the same way the AIThinkingIndicator surface ported
//  its HelixMark SVG. No app state here — pure geometry, unit-testable in isolation.
//

import CoreGraphics
import SwiftUI

// MARK: - Design-space mapping (web `viewBox 0 0 560 290` → render frame)

/// Maps the 560×290 design space the silhouette paths are authored in into an arbitrary render rect with an
/// aspect-fit scale + centre offset — the native peer of the SVG `viewBox` + default `preserveAspectRatio`.
struct CarCanvasMetrics {
    let scale: CGFloat
    let offset: CGSize

    init(size: CGSize) {
        let design = CGSize(width: TeslaCarVizSurface.designWidth, height: TeslaCarVizSurface.designHeight)
        let fit = min(size.width / design.width, size.height / design.height)
        scale = fit
        offset = CGSize(
            width: (size.width - design.width * fit) / 2,
            height: (size.height - design.height * fit) / 2
        )
    }

    /// A design point mapped into the render frame.
    func point(_ designX: Double, _ designY: Double) -> CGPoint {
        CGPoint(x: offset.width + designX * scale, y: offset.height + designY * scale)
    }

    /// A design-space length (radius / stroke width) mapped into the render frame.
    func length(_ designLength: Double) -> CGFloat {
        designLength * scale
    }

    /// The affine transform that maps a whole design-space `Path` into the render frame.
    var transform: CGAffineTransform {
        CGAffineTransform(translationX: offset.width, y: offset.height).scaledBy(x: scale, y: scale)
    }
}

// MARK: - SVG path interpreter (M / L / H / V / Q / C / Z, absolute + relative)

/// A minimal SVG `d` interpreter covering the commands the web silhouettes use (move, line, horizontal,
/// vertical, quadratic, cubic, close — absolute and relative). It builds a `Path` in the original design
/// coordinates; callers map it into the frame with ``CarCanvasMetrics/transform``.
enum SVGPathParser {
    /// Parses an SVG path-data string into a design-space `Path`.
    static func path(from data: String) -> Path {
        var scanner = Scanner(data)
        return scanner.parse()
    }

    private struct Scanner {
        let chars: [Character]
        var idx = 0
        var current = CGPoint.zero
        var startPoint = CGPoint.zero
        var command: Character = " "

        init(_ source: String) {
            chars = Array(source)
        }

        mutating func parse() -> Path {
            var path = Path()
            skipSeparators()
            while idx < chars.count {
                step(into: &path)
                skipSeparators()
            }
            return path
        }

        mutating func step(into path: inout Path) {
            advanceCommand()
            let relative = command.isLowercase
            let upper = command.uppercased().first ?? command
            switch upper {
            case "M": apply(move: point(relative: relative), to: &path)
            case "L": line(to: point(relative: relative), in: &path)
            case "H": line(to: horizontal(relative: relative), in: &path)
            case "V": line(to: vertical(relative: relative), in: &path)
            case "Q": quad(in: &path, relative: relative)
            case "C": cubic(in: &path, relative: relative)
            case "Z": path.closeSubpath(); current = startPoint
            default: idx += 1
            }
        }

        private mutating func apply(move target: CGPoint, to path: inout Path) {
            path.move(to: target)
            current = target
            startPoint = target
        }

        /// Reads the next command letter, or promotes a trailing move into an implicit line (SVG `M`→`L`).
        private mutating func advanceCommand() {
            if peekIsLetter() {
                command = chars[idx]
                idx += 1
            } else if command == "M" {
                command = "L"
            } else if command == "m" {
                command = "l"
            }
        }

        private mutating func line(to target: CGPoint, in path: inout Path) {
            path.addLine(to: target)
            current = target
        }

        private mutating func quad(in path: inout Path, relative: Bool) {
            let control = point(relative: relative)
            let end = point(relative: relative)
            path.addQuadCurve(to: end, control: control)
            current = end
        }

        private mutating func cubic(in path: inout Path, relative: Bool) {
            let control1 = point(relative: relative)
            let control2 = point(relative: relative)
            let end = point(relative: relative)
            path.addCurve(to: end, control1: control1, control2: control2)
            current = end
        }

        private mutating func point(relative: Bool) -> CGPoint {
            let xValue = readNumber() ?? Double(current.x)
            let yValue = readNumber() ?? Double(current.y)
            let base = relative ? current : .zero
            return CGPoint(x: base.x + xValue, y: base.y + yValue)
        }

        private mutating func horizontal(relative: Bool) -> CGPoint {
            let value = readNumber() ?? 0
            return CGPoint(x: (relative ? Double(current.x) : 0) + value, y: Double(current.y))
        }

        private mutating func vertical(relative: Bool) -> CGPoint {
            let value = readNumber() ?? 0
            return CGPoint(x: Double(current.x), y: (relative ? Double(current.y) : 0) + value)
        }

        private mutating func readNumber() -> Double? {
            skipSeparators()
            var text = ""
            if idx < chars.count, chars[idx] == "+" || chars[idx] == "-" {
                text.append(chars[idx]); idx += 1
            }
            var sawDigit = false
            while idx < chars.count, chars[idx].isNumber {
                text.append(chars[idx]); idx += 1; sawDigit = true
            }
            if idx < chars.count, chars[idx] == "." {
                text.append("."); idx += 1
                while idx < chars.count, chars[idx].isNumber {
                    text.append(chars[idx]); idx += 1; sawDigit = true
                }
            }
            return sawDigit ? Double(text) : nil
        }

        private mutating func skipSeparators() {
            while idx < chars.count, Self.isSeparator(chars[idx]) {
                idx += 1
            }
        }

        private static func isSeparator(_ character: Character) -> Bool {
            character == " " || character == "," || character == "\n" || character == "\t"
        }

        private func peekIsLetter() -> Bool {
            idx < chars.count && chars[idx].isLetter
        }
    }
}

// MARK: - Per-model silhouettes (web `bodies` + `miniPaths`, ported verbatim)

/// The body / roof (glass) / windshield path data for one model (web `bodies[model]`).
struct CarBodyPaths {
    let body: String
    let roof: String
    let wind: String
}

/// The model body / roof / windshield path strings (web `bodies[model]`) and the compact card silhouette
/// (web `miniPaths[model]`), kept as their original SVG `d` data so the native shapes reproduce the web
/// silhouette exactly. Interpreted by ``SVGPathParser`` and mapped by ``CarCanvasMetrics``.
enum CarSilhouette {
    /// The body, roof (glass), and windshield path data for a model (web `bodies[model]`).
    static func paths(for model: TeslaCarModel) -> CarBodyPaths {
        switch model {
        case .model3: CarBodyPaths(body: body3, roof: roof3, wind: wind3)
        case .modelS: CarBodyPaths(body: bodyS, roof: roofS, wind: windS)
        case .modelY: CarBodyPaths(body: bodyY, roof: roofY, wind: windY)
        case .modelX: CarBodyPaths(body: bodyX, roof: roofX, wind: windX)
        case .cybertruck: CarBodyPaths(body: bodyCT, roof: roofCT, wind: windCT)
        }
    }

    /// The compact card silhouette for a model (web `miniPaths[model]`).
    static func mini(for model: TeslaCarModel) -> String {
        switch model {
        case .model3: mini3
        case .modelS: miniS
        case .modelY: miniY
        case .modelX: miniX
        case .cybertruck: miniCT
        }
    }

    // swiftlint:disable line_length
    private static let body3 = "M 118 210 Q 104 186 122 170 L 181 166 Q 201 148 228 132 Q 263 118 304 116 L 385 116 Q 416 118 444 132 Q 467 148 483 168 Q 492 180 494 194 Q 496 202 496 210 L 118 210 Z"
    private static let roof3 = "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 381 114 Q 412 116 438 130 L 461 150 L 459 160 Q 418 164 329 164 Q 259 164 226 162 L 216 154 Z"
    private static let wind3 = "M 218 148 L 238 130 Q 265 118 298 116 L 378 116 L 436 132 L 430 138 C 414 132 386 124 356 120 C 326 118 296 119 272 124 L 222 148 Z"
    private static let bodyS = "M 112 210 Q 96 184 116 170 L 181 166 Q 201 148 228 132 Q 263 118 303 116 L 387 116 Q 418 118 446 132 Q 469 148 484 168 Q 494 180 496 194 Q 498 202 498 210 L 112 210 Z"
    private static let roofS = "M 214 144 Q 232 130 263 120 Q 296 116 337 114 L 383 114 Q 414 116 440 130 L 463 150 L 461 160 Q 420 164 329 164 Q 259 164 226 162 L 216 154 Z"
    private static let windS = "M 218 148 L 238 130 Q 265 118 298 116 L 380 116 L 438 132 L 432 138 C 416 132 388 124 358 120 C 328 118 298 119 274 124 L 222 148 Z"
    private static let bodyY = "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 261 116 300 114 L 375 114 Q 410 116 440 130 Q 465 146 481 168 Q 490 182 492 196 Q 494 204 494 210 L 118 210 Z"
    private static let roofY = "M 210 142 Q 228 128 259 118 Q 292 114 331 112 L 372 112 Q 405 114 432 128 L 455 148 L 453 158 Q 414 162 319 162 Q 249 162 220 160 L 212 150 Z"
    private static let windY = "M 214 146 L 234 128 Q 261 116 294 114 L 370 114 L 430 130 L 424 136 C 408 128 380 120 350 118 C 320 116 292 117 268 122 L 218 146 Z"
    private static let bodyX = "M 118 210 Q 104 186 122 168 L 179 164 Q 199 146 226 130 Q 259 116 298 112 L 375 112 Q 410 114 440 130 Q 463 146 479 166 Q 488 180 492 194 Q 494 202 494 210 L 118 210 Z"
    private static let roofX = "M 210 140 Q 228 126 257 118 Q 288 112 327 110 L 372 110 Q 405 112 432 126 L 455 144 L 453 156 Q 412 160 317 160 Q 247 160 218 158 L 212 150 Z"
    private static let windX = "M 214 144 L 234 126 Q 259 116 290 112 L 370 112 L 430 128 L 424 134 C 408 126 380 118 350 116 C 320 114 290 115 268 120 L 218 144 Z"
    private static let bodyCT = "M 104 210 L 109 200 L 121 186 L 170 166 L 220 152 L 434 152 L 468 164 L 483 182 L 487 200 L 488 210 L 104 210 Z"
    private static let roofCT = "M 225 156 L 259 152 L 419 152 L 439 164 L 434 178 L 234 178 L 228 168 Z"
    private static let windCT = "M 230 160 L 262 152 L 420 152 L 436 162 L 432 170 L 240 170 L 232 164 Z"
    private static let mini3 = "M8 22 C8 22 9 18 13 16 L20 12 C22 11 26 9 30 8.5 C34 8 40 7.8 44 8 C48 8.2 51 9.5 53 11 L57 14 C58.5 15 59.5 16.5 59.8 18 L60 22 L8 22 Z"
    private static let miniS = "M6 22 C6 22 7 17 11 15 L17 11 C19 10 24 8 28 7.5 C33 7 40 6.8 46 7 C50 7.2 53 8.5 55 10 L59 13 C60.5 14 61.5 15.5 61.8 17 L62 22 L6 22 Z"
    private static let miniY = "M8 23 C8 23 9 17 13 14 L19 10 C21 9 25 7 29 6.5 C33 6 40 5.8 44 6 C48 6.2 51 7.5 53 9 L57 12 C58.5 13 59.5 14.5 59.8 16 L60 23 L8 23 Z"
    private static let miniX = "M7 24 C7 24 8 17 12 14 L18 9 C20 8 24 6 28 5.5 C32 5 39 4.8 44 5 C48 5.2 51 6.5 53 8 L57 11 C58.5 12 59.5 14 59.8 16 L60 24 L7 24 Z"
    private static let miniCT = "M7 22 L7 17 L10 16 L16 12 L26 9 L34 8 L48 8 L52 8 L58 12 L60 16 L60 22 L7 22 Z"
    // swiftlint:enable line_length
}
