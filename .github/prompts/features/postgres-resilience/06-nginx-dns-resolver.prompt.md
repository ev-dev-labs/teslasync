---
description: "Nginx DNS resolver retry to prevent web pod crash loops on API startup delay"
---

# Nginx DNS Resolver Retry

## Problem

When the `teslasync-web` pod starts before the `teslasync-api` service is fully
registered in Kubernetes DNS, Nginx resolves `teslasync-api` at config load time
and fails if the DNS entry doesn't exist yet. This causes the web pod to crash
and restart, creating unnecessary churn during cluster startup or node recovery.

Nginx resolves `proxy_pass` hostnames **once at startup** by default. If the
upstream hostname isn't in DNS at that exact moment, Nginx exits with:
```
[emerg] host not found in upstream "teslasync-api" in /etc/nginx/conf.d/default.conf
```

## Current State

### Docker Compose Nginx (web/nginx.conf)
```nginx
location /api/ {
    proxy_pass http://teslasync-api:8080;
    # ← DNS resolved once at startup — fails if teslasync-api not up yet
}
```

### Helm Nginx ConfigMap (helm/teslasync/templates/configmap-nginx.yaml)
```nginx
location /api/ {
    proxy_pass {{ $apiBackend }};
    # ← Same issue — hostname resolved once at startup
}
```

Both have the same problem: Nginx resolves the upstream hostname at config load
time, not per-request.

## Task

### Step 1: Add DNS Resolver to Helm Nginx ConfigMap

In `helm/teslasync/templates/configmap-nginx.yaml`, add a `resolver` directive
and convert `proxy_pass` to use a variable (forces runtime resolution):

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Kubernetes DNS resolver — re-resolves every 10s instead of once at startup.
    # This prevents Nginx from crashing if the API service isn't registered yet.
    resolver kube-dns.kube-system.svc.cluster.local valid=10s ipv6=off;
    resolver_timeout 5s;

    # ... sub_filter, location / ...

    location /api/ {
        # Variable forces Nginx to use the resolver for every request
        set $backend "{{ $apiBackend }}";
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
    }

    location /healthz {
        set $backend "{{ $apiBackend }}";
        proxy_pass $backend;
    }

    location /readyz {
        set $backend "{{ $apiBackend }}";
        proxy_pass $backend;
    }

    location /.well-known/ {
        set $backend "{{ $apiBackend }}";
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /metrics {
        set $backend "{{ $apiBackend }}";
        proxy_pass $backend;
    }

    # ... rest of config unchanged ...
}
```

**Key changes:**
1. `resolver kube-dns.kube-system.svc.cluster.local valid=10s ipv6=off;` — tells Nginx
   to use kube-dns and cache results for 10 seconds
2. `resolver_timeout 5s;` — don't hang forever on DNS lookup
3. `set $backend "..."; proxy_pass $backend;` — using a variable forces Nginx to resolve
   the hostname at request time instead of config load time. Without the variable,
   Nginx resolves `proxy_pass` hostnames once at startup and caches forever.

### Step 2: Update Docker Compose Nginx (web/nginx.conf)

For local dev (Docker Compose), use Docker's embedded DNS at `127.0.0.11`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Docker embedded DNS — re-resolves on each request
    resolver 127.0.0.11 valid=10s ipv6=off;
    resolver_timeout 5s;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
    }

    location /api/ {
        set $backend "http://teslasync-api:8080";
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /healthz {
        set $backend "http://teslasync-api:8080";
        proxy_pass $backend;
    }

    location /readyz {
        set $backend "http://teslasync-api:8080";
        proxy_pass $backend;
    }

    # ... rest unchanged ...
}
```

### Step 3: Verify Nginx Starts Without API

After applying, verify Nginx starts even when the API pod isn't running:

```bash
# In k8s: scale API to 0, then restart web
kubectl -n teslasync scale deploy teslasync-api --replicas=0
kubectl -n teslasync rollout restart deploy teslasync-web
# Web pod should start successfully (502 on /api/ but no crash)
kubectl -n teslasync get pods -l app.kubernetes.io/component=web

# Restore API
kubectl -n teslasync scale deploy teslasync-api --replicas=1
# /api/ should start working once API is ready
```

## Important Notes

- The `set $variable` + `proxy_pass $variable` pattern is the standard Nginx
  approach for dynamic upstreams. Without the variable, `proxy_pass` resolves
  hostnames only at config load time.
- `ipv6=off` avoids issues in clusters without IPv6 support (common in k3s).
- `valid=10s` means DNS results are cached for 10 seconds — a good balance between
  performance and responsiveness to endpoint changes.
- Docker uses `127.0.0.11` as its embedded DNS resolver — this is standard and
  documented in Docker networking docs.

## Verification

```bash
# Helm lint
helm lint helm/teslasync

# Template render — verify resolver appears
helm template test helm/teslasync | Select-String "resolver"

# Nginx config test (locally)
docker run --rm -v ${PWD}/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t
# Expected: "nginx: configuration file /etc/nginx/nginx.conf syntax is ok"
# Note: resolver 127.0.0.11 will warn in non-Docker context — that's expected
```

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "fix(web): add nginx DNS resolver for startup resilience

- Add resolver kube-dns.kube-system.svc.cluster.local valid=10s to helm nginx configmap
- Add resolver 127.0.0.11 valid=10s to docker compose nginx.conf
- Use set \$backend + proxy_pass \$backend for runtime DNS resolution
- Prevents web pod crash when API pod starts after nginx"
```

## What NOT To Change

- Do not remove the `proxy_set_header` directives — they're needed for correct forwarding
- Do not change `proxy_read_timeout 3600s` on the `/api/` location — SSE needs long timeouts
- Do not add `upstream` blocks — the `set $variable` pattern is simpler and sufficient
- Do not change the Dockerfile.web — this is a config-only change
