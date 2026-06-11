//
//  Avatar.Tests.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  Pure-adapter coverage for the Avatar surface:
//    • Palette — the pinned Okabe-Ito CB-safe swatches + the count tie to `Color.TS.chartCategorical`
//      (the cross-platform colour-stability contract: same modulo base as the web `% 8`).
//    • Hash — the verbatim djb2 + colorIndex parity, pinned against the web reference values.
//    • Initials / seed / attribution — the verbatim ports of `avatarInitials`, the seed, and
//      `isAttributed`, across multi-word / single-word / whitespace / empty / id-only inputs.
//    • Ink tone — the WCAG-aware foreground (white unless it fails AA-large on the swatch) + the
//      "every disc meets AA large-text contrast" invariant across all eight swatches.
//    • Projection — every render branch (image / initials / user-glyph / bot-glyph / attributed
//      vs. neutral) + the carried size / shape / status.
//    • Meta / accessibility — the diagnostics slug + the identity label + presence mapping.
//    • Size / mark geometry — pixel dimensions, glyph rounding, dot diameters, and the ported
//      HelixMark path (non-empty, within its viewBox, scaling).
//
//  The model / source / view coverage lives in `Avatar.ModelTests.swift`. These run in the
//  TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Palette (Okabe-Ito CB-safe pin + token tie)

final class AvatarPaletteTests: XCTestCase {
    func testCountIsEight() {
        XCTAssertEqual(AvatarPalette.count, 8)
    }

    func testCountTiesToChartCategoricalToken() {
        // The avatar hashes into the same palette the design token exposes; the count is the
        // modulo base the web `avatarColorIndex` uses (`% 8`), so this tie guards cross-platform
        // colour stability.
        XCTAssertEqual(AvatarPalette.count, Color.TS.chartCategorical.count)
    }

    func testSwatchesMatchOkabeIto() {
        let expected: [[Double]] = [
            [0.000, 0.447, 0.698],
            [0.902, 0.624, 0.000],
            [0.000, 0.620, 0.451],
            [0.941, 0.894, 0.259],
            [0.337, 0.706, 0.914],
            [0.835, 0.369, 0.000],
            [0.800, 0.475, 0.655],
            [0.294, 0.294, 0.294]
        ]
        for (index, swatch) in expected.enumerated() {
            let actual = AvatarPalette.components[index]
            XCTAssertEqual(actual.red, swatch[0], accuracy: 0.0005, "index \(index) red")
            XCTAssertEqual(actual.green, swatch[1], accuracy: 0.0005, "index \(index) green")
            XCTAssertEqual(actual.blue, swatch[2], accuracy: 0.0005, "index \(index) blue")
        }
    }

    func testWrappedIndexIsAlwaysPositive() {
        XCTAssertEqual(AvatarPalette.wrappedIndex(-1), 7)
        XCTAssertEqual(AvatarPalette.wrappedIndex(8), 0)
        XCTAssertEqual(AvatarPalette.wrappedIndex(3), 3)
    }
}

// MARK: - Hash (verbatim djb2 + colorIndex parity)

final class AvatarHashTests: XCTestCase {
    func testDjb2MatchesWebReference() {
        XCTAssertEqual(AvatarHash.djb2("?"), 177_562)
        XCTAssertEqual(AvatarHash.djb2("u-1"), 193_425_324)
        XCTAssertEqual(AvatarHash.djb2("u-2"), 193_425_327)
        XCTAssertEqual(AvatarHash.djb2("Ada Lovelace"), 3_121_216_570)
        XCTAssertEqual(AvatarHash.djb2("Grace Hopper"), 1_793_754_119)
        XCTAssertEqual(AvatarHash.djb2("John Doe"), 4_288_693_480)
        XCTAssertEqual(AvatarHash.djb2("X"), 177_661)
    }

    func testColorIndexMatchesWebReference() {
        XCTAssertEqual(AvatarHash.colorIndex(for: "?"), 2)
        XCTAssertEqual(AvatarHash.colorIndex(for: "u-1"), 4)
        XCTAssertEqual(AvatarHash.colorIndex(for: "u-2"), 7)
        XCTAssertEqual(AvatarHash.colorIndex(for: "Ada Lovelace"), 2)
        XCTAssertEqual(AvatarHash.colorIndex(for: "Grace Hopper"), 7)
        XCTAssertEqual(AvatarHash.colorIndex(for: "John Doe"), 0)
        XCTAssertEqual(AvatarHash.colorIndex(for: "Cher"), 1)
        XCTAssertEqual(AvatarHash.colorIndex(for: "X"), 5)
    }

    func testColorIndexIsDeterministicAndInRange() {
        XCTAssertEqual(AvatarHash.colorIndex(for: "Grace Hopper"), AvatarHash.colorIndex(for: "Grace Hopper"))
        XCTAssertTrue((0 ..< AvatarPalette.count).contains(AvatarHash.colorIndex(for: "anything")))
    }
}

// MARK: - Initials / seed / attribution

final class AvatarIdentityTests: XCTestCase {
    func testInitialsTwoWords() {
        XCTAssertEqual(AvatarIdentity.initials(for: "John Doe"), "JD")
        XCTAssertEqual(AvatarIdentity.initials(for: "Ada Lovelace"), "AL")
        XCTAssertEqual(AvatarIdentity.initials(for: "john doe"), "JD")
        XCTAssertEqual(AvatarIdentity.initials(for: "  John   Doe  "), "JD")
        XCTAssertEqual(AvatarIdentity.initials(for: "Grace Murray Hopper"), "GM")
    }

    func testInitialsSingleWord() {
        XCTAssertEqual(AvatarIdentity.initials(for: "Cher"), "CH")
        XCTAssertEqual(AvatarIdentity.initials(for: "X"), "X")
        XCTAssertEqual(AvatarIdentity.initials(for: "ada"), "AD")
    }

    func testInitialsEmptyFallsBackToQuestionMark() {
        XCTAssertEqual(AvatarIdentity.initials(for: ""), "?")
        XCTAssertEqual(AvatarIdentity.initials(for: "   "), "?")
        XCTAssertEqual(AvatarIdentity.initials(for: nil), "?")
    }

    func testSeedPrecedence() {
        XCTAssertEqual(AvatarIdentity.seed(userId: "u-1", trimmedName: "Ada"), "u-1")
        XCTAssertEqual(AvatarIdentity.seed(userId: "", trimmedName: "Ada"), "Ada")
        XCTAssertEqual(AvatarIdentity.seed(userId: nil, trimmedName: "Ada"), "Ada")
        XCTAssertEqual(AvatarIdentity.seed(userId: nil, trimmedName: ""), "?")
        XCTAssertEqual(AvatarIdentity.seed(userId: "", trimmedName: ""), "?")
    }

    func testIsAttributed() {
        XCTAssertTrue(AvatarIdentity.isAttributed(userId: nil, trimmedName: "Ada"))
        XCTAssertTrue(AvatarIdentity.isAttributed(userId: "u-1", trimmedName: ""))
        XCTAssertFalse(AvatarIdentity.isAttributed(userId: nil, trimmedName: ""))
        XCTAssertFalse(AvatarIdentity.isAttributed(userId: "", trimmedName: ""))
    }
}

// MARK: - Ink tone (WCAG-aware foreground)

final class AvatarInkToneTests: XCTestCase {
    func testUnambiguousTones() {
        XCTAssertEqual(AvatarInkTone.forIndex(0), .white) // blue
        XCTAssertEqual(AvatarInkTone.forIndex(1), .ink) // orange
        XCTAssertEqual(AvatarInkTone.forIndex(3), .ink) // yellow (white is nearly invisible)
        XCTAssertEqual(AvatarInkTone.forIndex(4), .ink) // sky blue
        XCTAssertEqual(AvatarInkTone.forIndex(7), .white) // grey
    }

    func testEveryDiscMeetsLargeTextContrast() {
        for index in 0 ..< AvatarPalette.count {
            let swatchLuminance = AvatarContrast.relativeLuminance(of: AvatarPalette.swatch(forIndex: index))
            let tone = AvatarInkTone.forIndex(index)
            let contrast = AvatarContrast.ratio(tone.luminance, swatchLuminance)
            XCTAssertGreaterThanOrEqual(contrast, AvatarContrast.largeTextMinimum, "swatch \(index)")
        }
    }
}

final class AvatarContrastTests: XCTestCase {
    func testRelativeLuminanceBounds() {
        XCTAssertEqual(AvatarContrast.relativeLuminance(red: 0, green: 0, blue: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(AvatarContrast.relativeLuminance(red: 1, green: 1, blue: 1), 1, accuracy: 0.0001)
    }

    func testRatioIsOrderIndependentAndMaximal() {
        XCTAssertEqual(AvatarContrast.ratio(1, 0), 21, accuracy: 0.001)
        XCTAssertEqual(AvatarContrast.ratio(0, 1), 21, accuracy: 0.001)
    }
}

// MARK: - Projection (render branches)

final class AvatarProjectionTests: XCTestCase {
    func testImagePresent() {
        let resolved = AvatarProjection.resolve(AvatarDescriptor(name: "Ada", src: "https://x/y.png"))
        XCTAssertTrue(resolved.hasImage)
        XCTAssertEqual(resolved.fallback, .initials("AD"))
    }

    func testInitialsBranch() {
        let resolved = AvatarProjection.resolve(AvatarDescriptor(name: "John Doe"))
        XCTAssertEqual(resolved.fallback, .initials("JD"))
        XCTAssertTrue(resolved.isAttributed)
        XCTAssertFalse(resolved.hasImage)
        XCTAssertEqual(resolved.colorIndex, 0)
    }

    func testGlyphBranches() {
        let user = AvatarProjection.resolve(AvatarDescriptor(kind: .user))
        XCTAssertEqual(user.fallback, .glyph(.user))
        XCTAssertFalse(user.isAttributed)

        let bot = AvatarProjection.resolve(AvatarDescriptor(kind: .bot))
        XCTAssertEqual(bot.fallback, .glyph(.bot))
        XCTAssertFalse(bot.isAttributed)
    }

    func testIdOnlyIsAttributedGlyph() {
        let resolved = AvatarProjection.resolve(AvatarDescriptor(userId: "u-2"))
        XCTAssertEqual(resolved.fallback, .glyph(.user))
        XCTAssertTrue(resolved.isAttributed)
        XCTAssertEqual(resolved.colorIndex, 7)
    }

    func testCarriesSizeShapeStatus() {
        let resolved = AvatarProjection.resolve(
            AvatarDescriptor(name: "Ada", size: .lg, shape: .rounded, status: .idle)
        )
        XCTAssertEqual(resolved.size, .lg)
        XCTAssertEqual(resolved.shape, .rounded)
        XCTAssertEqual(resolved.status, .idle)
    }
}

// MARK: - Meta + accessibility

final class AvatarMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AvatarMeta.surfaceSlug, "Avatar")
        XCTAssertEqual(Avatar.surfaceSlug, "Avatar")
    }
}

final class AvatarAccessibilityTests: XCTestCase {
    func testIdentityLabel() {
        XCTAssertEqual(
            AvatarAccessibility.identityLabel(trimmedName: "Ada", unknownWord: "Unknown user"),
            "Ada"
        )
        XCTAssertEqual(
            AvatarAccessibility.identityLabel(trimmedName: "", unknownWord: "Unknown user"),
            "Unknown user"
        )
    }

    func testPresenceMapping() {
        XCTAssertEqual(AvatarAccessibility.presenceKey(for: .online), "avatar.statusOnline")
        XCTAssertEqual(AvatarAccessibility.presenceKey(for: .idle), "avatar.statusIdle")
        XCTAssertEqual(AvatarAccessibility.presenceKey(for: .offline), "avatar.statusOffline")
        XCTAssertEqual(AvatarAccessibility.presenceFallback(for: .online), "Online")
        XCTAssertEqual(AvatarAccessibility.presenceFallback(for: .idle), "Idle")
        XCTAssertEqual(AvatarAccessibility.presenceFallback(for: .offline), "Offline")
    }
}

// MARK: - Size token

final class AvatarSizeTests: XCTestCase {
    func testPoints() {
        XCTAssertEqual(AvatarSize.xs.points, 16)
        XCTAssertEqual(AvatarSize.sm.points, 24)
        XCTAssertEqual(AvatarSize.md.points, 32)
        XCTAssertEqual(AvatarSize.lg.points, 48)
    }

    func testGlyphRoundingMatchesWeb() {
        XCTAssertEqual(AvatarSize.xs.glyphPoints, 10)
        XCTAssertEqual(AvatarSize.sm.glyphPoints, 14)
        XCTAssertEqual(AvatarSize.md.glyphPoints, 19)
        XCTAssertEqual(AvatarSize.lg.glyphPoints, 29)
    }

    func testStatusDotDiameters() {
        XCTAssertEqual(AvatarSize.xs.statusDotDiameter, 6)
        XCTAssertEqual(AvatarSize.sm.statusDotDiameter, 8)
        XCTAssertEqual(AvatarSize.md.statusDotDiameter, 10)
        XCTAssertEqual(AvatarSize.lg.statusDotDiameter, 12)
    }
}

// MARK: - Mark geometry (ported HelixMark path)

final class AvatarHelixMarkShapeTests: XCTestCase {
    func testPathIsNonEmptyAndWithinViewBox() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = AvatarHelixMarkShape().path(in: rect)
        XCTAssertFalse(path.isEmpty)
        let bounds = path.boundingRect
        XCTAssertGreaterThanOrEqual(bounds.minX, rect.minX - 0.001)
        XCTAssertGreaterThanOrEqual(bounds.minY, rect.minY - 0.001)
        XCTAssertLessThanOrEqual(bounds.maxX, rect.maxX + 0.001)
        XCTAssertLessThanOrEqual(bounds.maxY, rect.maxY + 0.001)
    }

    func testPathScalesWithFrame() {
        let small = AvatarHelixMarkShape().path(in: CGRect(x: 0, y: 0, width: 12, height: 12))
        XCTAssertLessThanOrEqual(small.boundingRect.maxX, 12.001)
        XCTAssertLessThanOrEqual(small.boundingRect.maxY, 12.001)
    }
}
