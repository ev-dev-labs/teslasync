import Shared
import XCTest

/// Proves the KMP shared core (`Shared.xcframework`, ADR-004) is linked and
/// callable from Swift on every Apple target.
///
/// The core exposes a single `Platform` seam (`io.teslasync.shared.core.platform`)
/// whose `name` returns the host OS version string on Apple. Reading a non-blank
/// value end-to-end confirms commonMain ↔ appleMain `expect/actual` wiring
/// survived the XCFramework packaging.
@MainActor
final class SharedCoreReachableTests: XCTestCase {
    func testPlatformNameIsReachableAndNonBlank() {
        let name = Shared.Platform.shared.name
        XCTAssertFalse(
            name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "Shared core Platform.name must be non-blank — proves the xcframework is linked"
        )
    }
}
