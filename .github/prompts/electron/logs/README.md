# Per-unit logs and screenshots

`electron-loop.ps1` writes one log per iteration here (`<phase>-<unitId>.log`) containing the
PREFLIGHT / SURVEY / REASONING / CHANGES / GATE / PARITY (/ VISUAL) sections required by the
methodology. E2 visual-gate screenshots are written to `logs/shots/<unitId>.png`.
