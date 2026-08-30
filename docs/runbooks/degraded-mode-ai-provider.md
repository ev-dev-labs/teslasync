# Degraded mode: AI provider (Ollama / hosted LLM)

**Criticality:** degraded-tolerable. The AI subsystem is isolated behind
provider decorators (rate limit, cost, redaction, tracing) in
`internal/ai/provider`. Losing it affects AI panels only.

Registered in `ops/runbooks/dependencies.yaml` (`ai-provider`).

## Symptoms

- AI-backed panels render an explicit unavailable state. They must never
  render a blank panel or a fabricated answer — if you see plausible
  output during a provider outage, that is a **correctness bug**, not a
  degradation, and it should be escalated.
- The AI health poller (`internal/ai/health`) flips the feature registry
  capability to unavailable.
- AI call error ratio climbs in the provider audit decorator.
- Cost/quota counters stop advancing (nothing is being spent).

## Confirm

```bash
kubectl -n "$NS" logs deploy/"$RELEASE"-api --since=15m | grep -i 'ollama\|provider\|ai_call'
kubectl -n "$NS" exec deploy/"$RELEASE"-api -- wget -qO- localhost:8080/api/v1/system/status
```

Separate provider failure from *deliberate* refusal — the rate limiter
and the cost quota both fail closed on purpose:

| Cause | Evidence | Action |
|---|---|---|
| Provider unreachable | connection errors, health poll failing | restore/wait |
| Rate limited by us | `ratelimit_decorator` rejections | expected; raise limit only with intent |
| Quota exhausted | `internal/ai/limit` quota rejections | expected; this is the cost guardrail working |
| Redaction refusal | `redact_decorator` blocked the call | leave it — the guard prevented PII egress |

## Immediate mitigation

1. Confirm the blast radius is AI-only: every non-AI page must be
   unaffected. If they are not, the isolation boundary has been breached
   and that is the incident.
2. **Provider unreachable:** restart or reschedule the provider. For a
   hosted provider, check the credential has not expired.
3. **Quota exhausted:** do not raise the quota reflexively. It exists so
   an AI feature cannot generate unbounded spend. Raise it only as a
   deliberate, recorded decision.
4. **Redaction refusal:** never disable redaction to "unblock" a
   feature. Fix the prompt or the tool that tried to send raw PII.

## Recovery

1. Restore the provider and wait for the health poller to flip the
   registry capability back to available.
2. Confirm cached/eval'd responses still serve where present, and that
   fresh calls succeed.
3. If the outage coincided with a release, check whether an AI feature
   flag was enabled too early — `ops/rollout/stages.yaml` stages
   `ai-provider-live-calls` at the canary stage precisely so this is
   caught before full rollout.

## Verify

Open an AI-backed page and confirm a real answer is produced. Then
re-run the evaluation suite so quality — not just availability — is
confirmed:

```bash
go run ./cmd/ai-eval
```

A provider that answers but answers badly (wrong model pulled, wrong
endpoint) passes a health check and fails the eval.

## Escalation

Do not page for an AI provider outage. Escalate during business hours.
Page immediately for either of these, which are not degradations:

- AI panels showing fabricated content during a provider outage
  (violates ADR-002, "no fabricated data").
- Redaction being bypassed, i.e. PII appearing in provider request logs.
