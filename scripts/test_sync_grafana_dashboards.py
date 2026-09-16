import contextlib
import io
import json
import unittest
from unittest.mock import patch

import sync_grafana_dashboards as sync


class SyncTests(unittest.TestCase):
    def test_offline_dry_run(self):
        with patch.object(sync, "_request", side_effect=AssertionError("network")), \
                patch("sys.argv", ["sync", "--dry-run"]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(sync.main(), 0)

    def test_import_requires_confirmed_success(self):
        path = sync.REPO_ROOT / "grafana" / "dashboards" / "system" / "physics-ledger.json"
        for status, body, expected in [
            (412, b'{"status":"version-mismatch"}', False),
            (200, b"not-json", False),
            (200, b'{"message":"unexpected"}', False),
            (200, json.dumps({"status": "success", "uid": "ledger", "version": 2}).encode(), True),
        ]:
            with self.subTest(status=status, body=body), patch.object(sync, "_request", return_value=(status, body)):
                success, _ = sync.push_dashboard("http://unused", {}, "system", path)
                self.assertEqual(success, expected)


if __name__ == "__main__":
    unittest.main()
