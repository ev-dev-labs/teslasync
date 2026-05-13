#!/usr/bin/env python3
"""Push all repo dashboards to a target Grafana instance.

The Helm chart's Grafana deployment doesn't ship the system/infra
dashboards (only SLOs are baked into a ConfigMap). Production
dashboards live in the Grafana PVC and drift from the repo over
time. This script re-syncs them on demand.

Idempotent: Grafana matches on dashboard UID and overwrites by default.

Usage:
    # Local docker (default)
    python scripts/sync_grafana_dashboards.py

    # Production (Grafana service-account token)
    GRAFANA_URL=https://grafana.cyphers.app \\
    GRAFANA_TOKEN=glsa_xxxxxxxxxxxxxxxx \\
    python scripts/sync_grafana_dashboards.py

    # Production via basic auth
    GRAFANA_URL=https://grafana.example.com \\
    GRAFANA_USER=admin GRAFANA_PASSWORD=... \\
    python scripts/sync_grafana_dashboards.py

    # Dry run — list what would be pushed, change nothing
    python scripts/sync_grafana_dashboards.py --dry-run

    # Limit to a subset
    python scripts/sync_grafana_dashboards.py --only vehicle-overview tire-pressure

Folder mapping mirrors local provisioning (grafana/provisioning/dashboards/dashboards.yml):
    grafana/dashboards/system/*.json -> Grafana folder "TeslaSync - System"
    grafana/dashboards/infra/*.json  -> Grafana folder "TeslaSync - Infra"
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DASH_ROOTS = {
    "TeslaSync - System": REPO_ROOT / "grafana" / "dashboards" / "system",
    "TeslaSync - Infra":  REPO_ROOT / "grafana" / "dashboards" / "infra",
}

DEFAULT_URL = "http://localhost:3001"


def _auth_header() -> dict[str, str]:
    token = os.environ.get("GRAFANA_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}
    user = os.environ.get("GRAFANA_USER", "admin")
    password = os.environ.get("GRAFANA_PASSWORD")
    if not password:
        # Fall back to local docker default
        password = os.environ.get("GF_SECURITY_ADMIN_PASSWORD", "admin")
    creds = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {creds}"}


def _request(method: str, url: str, headers: dict[str, str] | None = None,
             body: bytes | None = None, timeout: int = 30):
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        return 0, str(e).encode()


def ensure_folder(base_url: str, headers: dict[str, str], title: str) -> str | None:
    """Return folder UID, creating it if missing. None for 'General' (no folder)."""
    if title in (None, "", "General"):
        return None
    status, raw = _request("GET", f"{base_url}/api/folders", headers=headers)
    if status != 200:
        print(f"  ! Cannot list folders ({status}): {raw[:200].decode(errors='replace')}", file=sys.stderr)
        return None
    folders = json.loads(raw)
    for f in folders:
        if f.get("title") == title:
            return f.get("uid")
    # Create
    payload = json.dumps({"title": title}).encode()
    h = {**headers, "Content-Type": "application/json"}
    status, raw = _request("POST", f"{base_url}/api/folders", headers=h, body=payload)
    if status not in (200, 201):
        print(f"  ! Cannot create folder '{title}' ({status}): {raw[:200].decode(errors='replace')}",
              file=sys.stderr)
        return None
    return json.loads(raw).get("uid")


def push_dashboard(base_url: str, headers: dict[str, str], folder_uid: str | None,
                   path: Path) -> tuple[bool, str]:
    try:
        dash = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return False, f"invalid JSON: {e}"
    # Strip the dashboard 'id' field (must be null on import to let Grafana assign one
    # locally; the UID is what makes the dashboard idempotent across instances).
    dash["id"] = None
    payload = {
        "dashboard": dash,
        "overwrite": True,
        "message": f"Sync from repo: {path.relative_to(REPO_ROOT).as_posix()}",
    }
    if folder_uid:
        payload["folderUid"] = folder_uid
    body = json.dumps(payload).encode()
    h = {**headers, "Content-Type": "application/json"}
    status, raw = _request("POST", f"{base_url}/api/dashboards/db", headers=h, body=body)
    if status in (200, 412):
        try:
            data = json.loads(raw)
            return True, f"version={data.get('version', '?')} uid={data.get('uid', '?')}"
        except json.JSONDecodeError:
            return True, "ok"
    return False, f"HTTP {status}: {raw[:200].decode(errors='replace')}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("GRAFANA_URL", DEFAULT_URL),
                    help="Grafana base URL (default: %(default)s; env GRAFANA_URL)")
    ap.add_argument("--dry-run", action="store_true", help="List what would be pushed; don't push")
    ap.add_argument("--only", nargs="*", default=None,
                    help="Push only dashboards whose filename stem matches one of these")
    args = ap.parse_args()

    base_url = args.url.rstrip("/")
    headers = _auth_header()

    # Health check
    status, raw = _request("GET", f"{base_url}/api/health", headers=headers)
    if status != 200:
        print(f"FAILED: {base_url}/api/health returned {status}", file=sys.stderr)
        if raw:
            print(raw[:300].decode(errors="replace"), file=sys.stderr)
        return 1
    print(f"Target: {base_url}  (auth: {'token' if 'GRAFANA_TOKEN' in os.environ else 'basic'})")
    if args.dry_run:
        print("DRY RUN — nothing will be modified")

    # Plan
    plan: list[tuple[str, Path]] = []
    only_set = set(args.only) if args.only else None
    for folder_title, root in DASH_ROOTS.items():
        if not root.is_dir():
            print(f"  ! Skipping missing dir: {root}", file=sys.stderr)
            continue
        for path in sorted(root.glob("*.json")):
            if only_set and path.stem not in only_set:
                continue
            plan.append((folder_title, path))

    if not plan:
        print("Nothing to push.")
        return 0

    print(f"Planning to push {len(plan)} dashboard(s)")

    if args.dry_run:
        for folder_title, path in plan:
            print(f"  [dry] {folder_title} <- {path.name}")
        return 0

    # Ensure folders exist
    folder_uids: dict[str, str | None] = {}
    for folder_title in {ft for ft, _ in plan}:
        folder_uids[folder_title] = ensure_folder(base_url, headers, folder_title)
        print(f"  folder '{folder_title}' -> uid={folder_uids[folder_title] or '(General)'}")

    # Push
    ok = 0
    failed: list[tuple[Path, str]] = []
    for folder_title, path in plan:
        ok_flag, msg = push_dashboard(base_url, headers, folder_uids[folder_title], path)
        marker = "  ✓" if ok_flag else "  ✗"
        print(f"{marker} {folder_title}/{path.name}  {msg}")
        if ok_flag:
            ok += 1
        else:
            failed.append((path, msg))

    print(f"\nResult: {ok}/{len(plan)} pushed successfully")
    if failed:
        print(f"Failed ({len(failed)}):")
        for path, msg in failed:
            print(f"  - {path.name}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
