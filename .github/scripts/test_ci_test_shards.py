import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ci_test_shards import discover, merge, partition


class PartitionTests(unittest.TestCase):
    def test_discovery_uses_race_build_constraints_and_keeps_untested_packages(self):
        package = {"ImportPath": "module/no_tests", "Dir": "."}
        with patch("ci_test_shards.subprocess.check_output", return_value=json.dumps(package)) as run:
            self.assertEqual(discover(), [("module/no_tests", 1)])
        self.assertEqual(run.call_args.args[0], ["go", "list", "-race", "-json", "./..."])

    def test_every_package_once_including_packages_without_tests(self):
        packages = [(f"module/package{i}", i * 20 + 1) for i in range(556)]
        shards = partition(packages, 8)
        self.assertEqual(shards, partition(list(reversed(packages)), 8))
        self.assertEqual(sorted(sum(shards, [])), sorted(name for name, _ in packages))
        self.assertTrue(all(shards))
        weights = dict(packages)
        loads = [sum(weights[name] for name in shard) for shard in shards]
        self.assertLessEqual(max(loads) - min(loads), max(weights.values()))

    def test_rejects_invalid_counts_and_duplicate_packages(self):
        for packages, count in [([], 1), ([("a", 1)], 0), ([("a", 1)], 2),
                                ([("a", 1), ("a", 2)], 1)]:
            with self.subTest(packages=packages, count=count), self.assertRaises(ValueError):
                partition(packages, count)


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ci-shards-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "artifacts"
        self.output = Path(self.temp.name) / "merged"
        self.expected = [["module/a", "module/no_tests"], ["module/b"]]
        for index, packages in enumerate(self.expected, 1):
            directory = self.root / f"backend-test-{index}"
            directory.mkdir(parents=True)
            (directory / "manifest.json").write_text(json.dumps({
                "index": index, "count": 2, "packages": packages,
            }))
            (directory / "test-events.json").write_text("\n".join(json.dumps({
                "Action": "skip" if package.endswith("no_tests") else "pass",
                "Package": package,
            }) for package in packages) + "\n")
            (directory / "coverage.out").write_text(
                f"mode: atomic\nmodule/file{index}.go:1.1,2.2 2 {index - 1}\n"
            )

    def test_merges_raw_blocks_without_averaging_percentages(self):
        merge(self.root, self.expected, self.output)
        self.assertEqual((self.output / "coverage.out").read_text(),
                         "mode: atomic\nmodule/file1.go:1.1,2.2 2 0\nmodule/file2.go:1.1,2.2 2 1\n")
        self.assertEqual(len((self.output / "test-events.json").read_text().splitlines()), 3)

    def test_sums_shared_block_hits_once_without_duplicating_statements(self):
        (self.root / "backend-test-2" / "coverage.out").write_text(
            "mode: atomic\nmodule/file1.go:1.1,2.2 2 7\n"
        )
        merge(self.root, self.expected, self.output)
        self.assertEqual((self.output / "coverage.out").read_text(),
                         "mode: atomic\nmodule/file1.go:1.1,2.2 2 7\n")

    def test_missing_artifact_is_not_success(self):
        (self.root / "backend-test-2").rename(self.root / "wrong-name")
        with self.assertRaisesRegex(ValueError, "missing or unexpected"):
            merge(self.root, self.expected, self.output)

    def test_duplicate_or_omitted_package_is_not_success(self):
        manifest = self.root / "backend-test-2" / "manifest.json"
        manifest.write_text(json.dumps({"index": 2, "count": 2, "packages": ["module/a"]}))
        with self.assertRaisesRegex(ValueError, "manifest differs"):
            merge(self.root, self.expected, self.output)

    def test_incomplete_failed_or_foreign_test_events_are_rejected(self):
        path = self.root / "backend-test-2" / "test-events.json"
        for event in [{"Action": "start", "Package": "module/b"},
                      {"Action": "fail", "Package": "module/b"},
                      {"Action": "pass", "Package": "module/foreign"}]:
            with self.subTest(event=event):
                path.write_text(json.dumps(event) + "\n")
                with self.assertRaises(ValueError):
                    merge(self.root, self.expected, self.output)
                self.assertFalse(self.output.exists())

    def test_invalid_or_inconsistent_coverage_is_rejected(self):
        path = self.root / "backend-test-2" / "coverage.out"
        for profile in ["", "mode: set\n", "mode: atomic\nbad block\n",
                        "mode: atomic\nmodule/file1.go:1.1,2.2 99 2\n"]:
            with self.subTest(profile=profile):
                path.write_text(profile)
                with self.assertRaises(ValueError):
                    merge(self.root, self.expected, self.output)

    def test_empty_coverage_is_rejected(self):
        for directory in self.root.iterdir():
            (directory / "coverage.out").write_text("mode: atomic\n")
        with self.assertRaisesRegex(ValueError, "empty"):
            merge(self.root, self.expected, self.output)

    def test_missing_profile_and_malformed_json_are_rejected(self):
        profile = self.root / "backend-test-2" / "coverage.out"
        profile.unlink()
        with self.assertRaises(FileNotFoundError):
            merge(self.root, self.expected, self.output)
        (self.root / "backend-test-2" / "test-events.json").write_text("{broken")
        with self.assertRaises(json.JSONDecodeError):
            merge(self.root, self.expected, self.output)


if __name__ == "__main__":
    unittest.main()
