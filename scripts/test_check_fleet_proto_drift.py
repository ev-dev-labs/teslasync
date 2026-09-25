"""Tests for the scheduled Fleet Telemetry schema comparison."""

import runpy
import unittest
from pathlib import Path


report = runpy.run_path(str(Path(__file__).with_name("check-fleet-proto-drift.py")))["report"]
COMMIT = "3d366a3da23c41b6fe4eb538409d071402c4884b"
OLD = b"""
enum Field { Unknown = 0; }
message Value { oneof value { string string_value = 1; } }
"""
NEW = b"""
enum Field { Unknown = 0; Cabin12vPortKeepOn = 270; Cabin48vPortKeepOn = 271; }
message Value { oneof value { string string_value = 1; CabinPortKeepOnState cabin_port_keep_on_value = 55; } }
"""


class FleetProtoDriftTests(unittest.TestCase):
    def test_equal_bytes_are_in_sync(self):
        changed, body = report(NEW, NEW, COMMIT)
        self.assertFalse(changed)
        self.assertIn("matches upstream", body)

    def test_added_fields_and_oneof_are_reported(self):
        changed, body = report(OLD, NEW, COMMIT)
        self.assertTrue(changed)
        for text in ("Cabin12vPortKeepOn", "Cabin48vPortKeepOn", "cabin_port_keep_on_value", "55"):
            self.assertIn(text, body)

    def test_renumbered_field_is_reported(self):
        changed, body = report(OLD, OLD.replace(b"Unknown = 0", b"Unknown = 3"), COMMIT)
        self.assertTrue(changed)
        self.assertIn("~ `Unknown`: 0 -> 3", body)

    def test_other_schema_changes_also_trigger_review(self):
        changed, body = report(OLD, OLD + b"\nenum Other { NewValue = 0; }\n", COMMIT)
        self.assertTrue(changed)
        self.assertIn("inspect other schema declarations", body)

    def test_rejects_unpinned_revision(self):
        with self.assertRaises(ValueError):
            report(OLD, NEW, "main")


if __name__ == "__main__":
    unittest.main()
