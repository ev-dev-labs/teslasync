//
//  UserCell.Tests.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  Pure-adapter coverage for the UserCell surface:
//    • Truthiness / email-split — the verbatim ports of the JavaScript `!value` empty-check and the
//      `email.split('@')[0]` local-part the web cell relies on.
//    • Display-name priority — the `name.trim() → email local-part → id → "Unknown user"` chain,
//      across every fallthrough (trimmed name, whitespace-only name, email-only, id-only, none).
//    • Projection — both render branches (empty vs. populated), the `showEmail` gate, and the
//      carried avatar id / image / size, mirroring the web component test suite case-for-case.
//    • Meta / accessibility — the diagnostics slug, the em-dash glyph, and the spoken label / value.
//
//  The model / source / view coverage lives in `UserCell.ModelTests.swift`. These run in the
//  TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let unknown = "Unknown user"

// MARK: - Truthiness + email local-part (verbatim JS ports)

final class UserCellIdentityPrimitiveTests: XCTestCase {
    func testIsFalsyMatchesJavaScript() {
        XCTAssertTrue(UserCellIdentity.isFalsy(nil))
        XCTAssertTrue(UserCellIdentity.isFalsy(""))
        // A whitespace-only string is non-empty → NOT falsy (the web `!user.name` runs untrimmed).
        XCTAssertFalse(UserCellIdentity.isFalsy("   "))
        XCTAssertFalse(UserCellIdentity.isFalsy("a"))
    }

    func testEmailLocalPart() {
        XCTAssertEqual(UserCellIdentity.emailLocalPart("jane.smith@example.com"), "jane.smith")
        XCTAssertEqual(UserCellIdentity.emailLocalPart("a@b@c"), "a")
        // No `@` → the whole string (web `"noat".split('@')[0]`).
        XCTAssertEqual(UserCellIdentity.emailLocalPart("noat"), "noat")
        // Leading `@` → the empty local-part (falls through in the priority chain).
        XCTAssertEqual(UserCellIdentity.emailLocalPart("@example.com"), "")
    }

    func testIsEmpty() {
        XCTAssertTrue(UserCellIdentity.isEmpty(nil))
        XCTAssertTrue(UserCellIdentity.isEmpty(UserCellUser()))
        XCTAssertTrue(UserCellIdentity.isEmpty(UserCellUser(id: "", name: "", email: "")))
        XCTAssertFalse(UserCellIdentity.isEmpty(UserCellUser(name: "Alice")))
        XCTAssertFalse(UserCellIdentity.isEmpty(UserCellUser(email: "a@b.com")))
        XCTAssertFalse(UserCellIdentity.isEmpty(UserCellUser(id: "subject-abc")))
        // A whitespace-only name is a non-empty signal, so the cell is not empty.
        XCTAssertFalse(UserCellIdentity.isEmpty(UserCellUser(name: "   ")))
    }
}

// MARK: - Display-name priority chain

final class UserCellDisplayNameTests: XCTestCase {
    func testNameWins() {
        let user = UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), "Alice Adams")
    }

    func testNameIsTrimmed() {
        let user = UserCellUser(name: "  Alice Adams  ")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), "Alice Adams")
    }

    func testFallsBackToEmailLocalPart() {
        let user = UserCellUser(email: "jane.smith@example.com")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), "jane.smith")
    }

    func testFallsBackToIdWhenNameAndEmailAbsent() {
        let user = UserCellUser(id: "subject-abc")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), "subject-abc")
    }

    func testEmailWithLeadingAtFallsThroughToId() {
        let user = UserCellUser(id: "subject-abc", email: "@example.com")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), "subject-abc")
    }

    func testWhitespaceNameWithNoOtherSignalUsesUnknownWord() {
        // Not empty (whitespace name is a signal), but the trimmed name is empty and there is no
        // email / id, so the localised "Unknown user" word is used.
        let user = UserCellUser(name: "   ")
        XCTAssertEqual(UserCellIdentity.displayName(for: user, unknownWord: unknown), unknown)
    }

    func testDisplayNameFeedsAvatarInitials() {
        // The display name is the avatar's name seed; tie the cell to the Avatar initials port.
        let user = UserCellUser(id: "u-1", name: "Alice Adams")
        let name = UserCellIdentity.displayName(for: user, unknownWord: unknown)
        XCTAssertEqual(AvatarIdentity.initials(for: name), "AA")
    }
}

// MARK: - Projection (render branches + showEmail gate)

final class UserCellProjectionTests: XCTestCase {
    func testNilUserResolvesEmpty() {
        XCTAssertEqual(UserCellProjection.resolve(UserCellDescriptor(user: nil), unknownWord: unknown), .empty)
    }

    func testNoFieldsResolvesEmpty() {
        let descriptor = UserCellDescriptor(user: UserCellUser())
        XCTAssertEqual(UserCellProjection.resolve(descriptor, unknownWord: unknown), .empty)
    }

    func testNameResolvesPopulated() {
        let descriptor = UserCellDescriptor(user: UserCellUser(id: "u-1", name: "Alice Adams"))
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.displayName, "Alice Adams")
        XCTAssertEqual(populated.avatarUserID, "u-1")
        XCTAssertNil(populated.email)
        XCTAssertEqual(populated.size, .sm)
    }

    func testEmailFallbackPopulated() {
        let descriptor = UserCellDescriptor(user: UserCellUser(email: "jane.smith@example.com"))
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.displayName, "jane.smith")
        XCTAssertNil(populated.avatarUserID)
    }

    func testIdFallbackPopulated() {
        let descriptor = UserCellDescriptor(user: UserCellUser(id: "subject-abc"))
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.displayName, "subject-abc")
        XCTAssertEqual(populated.avatarUserID, "subject-abc")
    }

    func testShowEmailRendersEmailLine() {
        let user = UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com")
        let descriptor = UserCellDescriptor(user: user, showEmail: true)
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.email, "alice@example.com")
    }

    func testEmailHiddenByDefault() {
        let user = UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com")
        let descriptor = UserCellDescriptor(user: user)
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertNil(populated.email)
    }

    func testShowEmailWithEmptyEmailHasNoEmailLine() {
        // showEmail is on but the address is empty (falsy), so no email line — and the name still
        // makes the cell populated.
        let descriptor = UserCellDescriptor(user: UserCellUser(name: "Alice", email: ""), showEmail: true)
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertNil(populated.email)
    }

    func testEmailFallbackShowsFullAddressBeneathLocalPart() {
        let descriptor = UserCellDescriptor(user: UserCellUser(email: "jane.smith@example.com"), showEmail: true)
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.displayName, "jane.smith")
        XCTAssertEqual(populated.email, "jane.smith@example.com")
    }

    func testCarriesSizeAndAvatarURL() {
        let user = UserCellUser(id: "u-1", name: "Ada", avatarURL: "https://x/y.png")
        let descriptor = UserCellDescriptor(user: user, size: .lg)
        guard case let .populated(populated) = UserCellProjection.resolve(descriptor, unknownWord: unknown) else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(populated.size, .lg)
        XCTAssertEqual(populated.avatarURL, "https://x/y.png")
    }
}

// MARK: - Meta + accessibility

final class UserCellMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(UserCellMeta.surfaceSlug, "UserCell")
        XCTAssertEqual(UserCell.surfaceSlug, "UserCell")
    }

    func testEmptyGlyphIsEmDash() {
        XCTAssertEqual(UserCellProjection.emptyGlyph, "—")
    }
}

final class UserCellAccessibilityTests: XCTestCase {
    func testLabelIsDisplayName() {
        let populated = UserCellPopulated(
            displayName: "Alice Adams",
            avatarUserID: "u-1",
            avatarURL: nil,
            email: "alice@example.com",
            size: .sm
        )
        XCTAssertEqual(UserCellAccessibility.label(for: populated), "Alice Adams")
    }

    func testValueIsEmailWhenShownElseEmpty() {
        let withEmail = UserCellPopulated(
            displayName: "Alice Adams",
            avatarUserID: "u-1",
            avatarURL: nil,
            email: "alice@example.com",
            size: .sm
        )
        XCTAssertEqual(UserCellAccessibility.value(for: withEmail), "alice@example.com")

        let withoutEmail = UserCellPopulated(
            displayName: "Alice Adams",
            avatarUserID: "u-1",
            avatarURL: nil,
            email: nil,
            size: .sm
        )
        XCTAssertEqual(UserCellAccessibility.value(for: withoutEmail), "")
    }
}
