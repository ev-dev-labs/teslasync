# Kubernetes homelab node reboot recovery

This procedure covers a planned or unplanned reboot of the Kubernetes node
hosting TeslaSync. It assumes the default single-node/small-cluster topology
and the chart's restart-safe probes, dependency waits, and persistent volumes.

## Scope and guarantee

This is a **same-node reboot, not permanent node or disk loss**. With the
default `nodeSelector`, workloads wait for the `carbon` node to return and
reattach their existing PVCs. A local-path volume is physically tied to that
host; Kubernetes cannot recreate its contents on another node. Replicated
storage or a tested off-node backup is required for permanent host, disk, or
filesystem loss.

The chart protects the reboot path by:

- refusing ephemeral storage for bundled stateful services unless
  `nodeRecovery.enforcePersistentState=false` is explicitly selected;
- giving PostgreSQL WAL, Redis AOF, Mosquitto session state, MongoDB, Grafana,
  and Tempo enough startup time to replay without liveness restart loops;
- waiting for PostgreSQL, Redis, and MQTT before starting dependent processes;
- using `Recreate` for stable-ID MQTT consumers so revisions never overlap;
- retaining chart-managed PVCs when Helm removes a release.

`helm.sh/resource-policy: keep` does not protect against a failed disk, manual
PVC deletion, or a StorageClass whose reclaim policy deletes the backing
volume. Do not delete or recreate a PVC during recovery.

## Preflight

Set the names once and capture a before-reboot snapshot:

```bash
export NS="${NS:-teslasync}"
export RELEASE="${RELEASE:-teslasync}"
export NODE="${NODE:-carbon}"

kubectl get node "$NODE" -o wide
kubectl -n "$NS" get pods -o wide
kubectl -n "$NS" get pvc
kubectl get storageclass
kubectl -n "$NS" get pdb
```

Every enabled stateful claim must be `Bound`. Confirm the backing
StorageClass is the one expected for the homelab host. If it is `local-path`,
the node must return with the same disk and Kubernetes data directory.

Capture durable-data baselines before a planned reboot:

```bash
kubectl -n "$NS" exec deployment/"$RELEASE"-postgresql -- \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM vehicles; SELECT count(*), max(ts) FROM signal_log;"'
kubectl -n "$NS" exec deployment/"$RELEASE"-redis -- \
  redis-cli INFO persistence
kubectl -n "$NS" exec deployment/"$RELEASE"-mosquitto -- \
  ls -lh /mosquitto/data/mosquitto.db
```

Confirm the latest configured backup has passed its verification/restore
drill. A local backup on the same disk is not protection from disk loss.

If an API or web PodDisruptionBudget has `minAvailable: 1` with only one
replica, a drain will correctly stop rather than approve downtime silently.
Change the desired Helm values for the maintenance window; do not bypass it
with `--disable-eviction`.

## Planned reboot

For a planned host reboot, drain first so PostgreSQL, Redis, and Mosquitto
receive SIGTERM and flush state:

```bash
kubectl cordon "$NODE"
kubectl drain "$NODE" --ignore-daemonsets --delete-emptydir-data --grace-period=180 --timeout=15m
```

Reboot the host through the normal operating-system or hypervisor procedure.
After the kubelet is running again:

```bash
kubectl wait --for=condition=Ready node/"$NODE" --timeout=10m
kubectl uncordon "$NODE"
kubectl -n "$NS" get pods -o wide --watch
```

The stateful services may take several minutes to replay. Do not delete pods
while startup probes are still succeeding intermittently; inspect their logs
and events instead.

## Unplanned reboot recovery

After a power loss or abrupt reboot, wait for the node and storage before
touching workloads:

```bash
kubectl wait --for=condition=Ready node/"$NODE" --timeout=10m
kubectl uncordon "$NODE"
kubectl -n "$NS" get pvc
kubectl -n "$NS" get pods -o wide
kubectl -n "$NS" get events --sort-by=.lastTimestamp
```

All expected PVCs must still be `Bound`. A `Pending` claim or mount error is a
storage problem; restarting the API cannot fix it.

Wait in dependency order:

```bash
kubectl -n "$NS" rollout status deployment/"$RELEASE"-postgresql --timeout=10m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-redis --timeout=10m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-mosquitto --timeout=10m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-api --timeout=15m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-notification-worker --timeout=10m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-export-worker --timeout=10m
kubectl -n "$NS" rollout status deployment/"$RELEASE"-automation-worker --timeout=10m
```

If bundled Fleet Telemetry is enabled, also wait for it:

```bash
kubectl -n "$NS" rollout status deployment/"$RELEASE"-fleet-telemetry --timeout=10m
```

The dependency init containers intentionally retry for up to ten minutes
before Kubernetes records a failed attempt and backs off. `Init:*` during that
window is expected; repeated failures after a dependency is Ready are not.

## Verification

Check API health from inside the cluster and confirm the dedicated telemetry
consumer is both connected and subscribed:

```bash
kubectl -n "$NS" port-forward service/"$RELEASE"-api 18080:8080
curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/readyz
curl -fsS http://127.0.0.1:18080/metrics | grep 'teslasync_mqtt_pipeline_'
```

In another terminal, compare durable data with the preflight snapshot and
watch new telemetry advance for an awake vehicle:

```bash
kubectl -n "$NS" exec deployment/"$RELEASE"-postgresql -- \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM vehicles; SELECT count(*), max(ts) FROM signal_log;"'
kubectl -n "$NS" logs deployment/"$RELEASE"-api --since=15m | \
  grep -E 'PipelineSubscriber started|signal store hydrated|FSM vehicle state engine active|Redis Pub/Sub subscription started'
```

Expected recovery is: stateful services Ready within ten minutes, API Ready
within fifteen minutes, both MQTT pipeline gauges equal to `1`, and
`signal_log.ts` advances once an awake vehicle publishes. A sleeping
vehicle is not evidence of ingest failure.

## Escalation

Do not repeatedly restart all pods. Preserve `kubectl get events`, previous
container logs, PVC status, and the PostgreSQL/Mosquitto persistence files
before intervening.

- PostgreSQL still recovering: inspect its logs for WAL replay progress and
  storage I/O errors; the startup probe allows ten minutes before restart.
- Redis fails AOF load: copy the PVC data before using `redis-check-aof`.
- Mosquitto starts cold or the pipeline subscription gauge remains `0`: follow
  `docs/runbooks/degraded-mode-mqtt.md`.
- A PVC is lost or the node/disk will not return: stop this procedure and use
  the tested backup restore workflow. This runbook cannot turn local storage
  into high availability.
