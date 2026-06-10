//
//  AIInboxAutoCategorization.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  Pure-adapter coverage for the AIInboxAutoCategorization surface: the JSON value accessors and
//  the `tool_result` → `[InboxCategoryBucket]` decode (the web `handleEvent` walk — the tool-name
//  / ok / `status === 'ok'` / `Array.isArray(categories)` gate, the per-bucket `category` +
//  `count` guards, the positive-only `rule_ids` filter, and the non-empty `sample_titles` filter).
//  No network, no SwiftUI — these run in the XCTest targets and the Foundation verification harness.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class InboxCategoryJSONValueTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(InboxCategoryJSONValue.string("hi").stringValue, "hi")
        XCTAssertNil(InboxCategoryJSONValue.number(3).stringValue)
        XCTAssertNil(InboxCategoryJSONValue.bool(true).stringValue)
        XCTAssertNil(InboxCategoryJSONValue.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(InboxCategoryJSONValue.number(42).numberValue, 42)
        XCTAssertNil(InboxCategoryJSONValue.string("42").numberValue)
        XCTAssertNil(InboxCategoryJSONValue.bool(false).numberValue)
    }

    func testObjectAndArrayAccessors() {
        XCTAssertEqual(InboxCategoryJSONValue.array([.number(1)]).arrayValue?.count, 1)
        XCTAssertNil(InboxCategoryJSONValue.string("x").arrayValue)
        XCTAssertEqual(InboxCategoryJSONValue.object(["a": .number(1)]).objectValue?.count, 1)
        XCTAssertNil(InboxCategoryJSONValue.number(1).objectValue)
    }
}

// MARK: - Bucket decode (web `handleEvent` walk)

@MainActor final class InboxCategoryDecodeTests: XCTestCase {
    private func result(
        name: String = InboxCategoryBucket.toolName,
        ok: Bool = true,
        data: [String: InboxCategoryJSONValue]?
    ) -> InboxCategoryToolResult {
        InboxCategoryToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    private func okData(_ categories: [InboxCategoryJSONValue]) -> [String: InboxCategoryJSONValue] {
        ["status": .string("ok"), "categories": .array(categories)]
    }

    private func bucketObject(
        category: InboxCategoryJSONValue = .string("Battery & charging"),
        count: InboxCategoryJSONValue? = .number(14),
        extra: [String: InboxCategoryJSONValue] = [:]
    ) -> InboxCategoryJSONValue {
        var fields: [String: InboxCategoryJSONValue] = ["category": category]
        if let count { fields["count"] = count }
        for (key, value) in extra {
            fields[key] = value
        }
        return .object(fields)
    }

    func testDecodesFullBucketWithAllFields() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([
            bucketObject(extra: [
                "rule_ids": .array([.number(11), .number(12)]),
                "sample_titles": .array([.string("Charge interrupted"), .string("Battery low")])
            ])
        ])))
        XCTAssertEqual(buckets?.count, 1)
        let bucket = buckets?.first
        XCTAssertEqual(bucket?.category, "Battery & charging")
        XCTAssertEqual(bucket?.count, 14)
        XCTAssertEqual(bucket?.ruleIDs, [11, 12])
        XCTAssertEqual(bucket?.sampleTitles, ["Charge interrupted", "Battery low"])
    }

    func testDecodesMinimalBucketDefaultsOptionalsNil() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([bucketObject()])))
        let bucket = buckets?.first
        XCTAssertEqual(bucket?.category, "Battery & charging")
        XCTAssertEqual(bucket?.count, 14)
        XCTAssertNil(bucket?.ruleIDs)
        XCTAssertNil(bucket?.sampleTitles)
    }

    func testCountZeroIsAccepted() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([
            bucketObject(count: .number(0))
        ])))
        XCTAssertEqual(buckets?.first?.count, 0)
    }

    func testEmptyCategoriesArrayIsResolvedNotRejected() {
        // Web: status ok + categories is an (empty) array → the resolved-but-empty capture (distinct
        // from nil). The native leaf renders the friendly "no categories" box.
        let buckets = InboxCategoryBucket.list(from: result(data: okData([])))
        XCTAssertEqual(buckets, [])
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(InboxCategoryBucket.list(from: result(name: "summarize", data: okData([]))))
    }

    func testRejectsNotOK() {
        XCTAssertNil(InboxCategoryBucket.list(from: result(ok: false, data: okData([]))))
    }

    func testRejectsNilData() {
        XCTAssertNil(InboxCategoryBucket.list(from: result(data: nil)))
    }

    func testRejectsStatusNotOK() {
        // Web `data.status !== 'ok'` → early return.
        XCTAssertNil(InboxCategoryBucket.list(from: result(data: [
            "status": .string("error"), "categories": .array([])
        ])))
        // Missing status is also rejected.
        XCTAssertNil(InboxCategoryBucket.list(from: result(data: ["categories": .array([])])))
    }

    func testRejectsMissingOrNonArrayCategories() {
        XCTAssertNil(InboxCategoryBucket.list(from: result(data: ["status": .string("ok")])))
        // A non-array `categories` is also rejected (web `Array.isArray`).
        XCTAssertNil(InboxCategoryBucket.list(from: result(data: [
            "status": .string("ok"), "categories": .string("none")
        ])))
    }

    func testSkipsMalformedElementsButKeepsValidOnes() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([
            .null, // not an object → skip
            .string("nope"), // not an object → skip
            bucketObject(category: .string("")), // empty category → skip
            bucketObject(category: .number(1)), // category not a string → skip
            bucketObject(count: nil), // missing count → skip
            bucketObject(count: .number(-1)), // negative count → skip
            bucketObject(count: .string("5")), // count not a number → skip
            bucketObject(category: .string("Security"), count: .number(3)) // valid → kept
        ])))
        XCTAssertEqual(buckets?.count, 1)
        XCTAssertEqual(buckets?.first?.category, "Security")
        XCTAssertEqual(buckets?.first?.count, 3)
    }

    func testRuleIDsKeepPositiveOnlyAndCollapseEmptyToNil() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([
            bucketObject(extra: ["rule_ids": .array([.number(11), .number(0), .number(-3), .number(12)])]),
            bucketObject(category: .string("Tire"), extra: ["rule_ids": .array([.number(0), .number(-1)])]),
            bucketObject(category: .string("Climate"), extra: ["rule_ids": .string("not-array")])
        ])))
        XCTAssertEqual(buckets?.count, 3)
        XCTAssertEqual(buckets?[0].ruleIDs, [11, 12])
        XCTAssertNil(buckets?[1].ruleIDs) // all non-positive → nil
        XCTAssertNil(buckets?[2].ruleIDs) // non-array → nil
    }

    func testSampleTitlesKeepNonEmptyOnlyAndCollapseEmptyToNil() {
        let buckets = InboxCategoryBucket.list(from: result(data: okData([
            bucketObject(extra: ["sample_titles": .array([.string("A"), .string(""), .string("B")])]),
            bucketObject(category: .string("Tire"), extra: ["sample_titles": .array([.string("")])])
        ])))
        XCTAssertEqual(buckets?[0].sampleTitles, ["A", "B"])
        XCTAssertNil(buckets?[1].sampleTitles) // all empty → nil
    }

    func testStableIdentityIsCategory() {
        let bucket = InboxCategoryBucket(category: "Security", count: 3)
        XCTAssertEqual(bucket.id, "Security")
    }

    func testToolNameMatchesBackend() {
        XCTAssertEqual(InboxCategoryBucket.toolName, "draft_alert_categories")
    }
}
