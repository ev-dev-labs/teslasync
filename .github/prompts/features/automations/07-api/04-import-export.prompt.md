---
description: "Automation API: import/export automations as JSON for sharing"
---

# API: Import / Export

## Endpoints
```
GET  /api/v1/automations/{id}/export          — Export single automation as JSON
POST /api/v1/automations/export               — Export multiple (body: {ids: [1,2,3]})
POST /api/v1/automations/import               — Import automation(s) from JSON
```

## Implementation
Export strips `id`, `vehicle_id`, timestamps, and execution counters. Import validates schema, assigns new IDs, and sets `enabled = false` by default (user must review and enable). Support both single and batch import/export. The JSON format should be human-readable for community sharing.
