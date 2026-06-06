using System.Collections.Concurrent;
using System.Text.Json;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// One vehicle signal's latest live value, with the time it was received so freshness can be
/// derived against the ADR-013 two-minute window. This is L1 live state only — historical series
/// continue to flow through the W5 REST repositories (<c>signal_log</c>), never reconstructed from
/// SSE replay.
/// </summary>
public sealed record LiveSignal(
    long VehicleId,
    string Field,
    SignalKind Kind,
    SignalValue Value,
    string Timestamp,
    DateTimeOffset ReceivedAt)
{
    /// <summary>The freshness status of this value at <paramref name="now"/> (fresh/stale/offline).</summary>
    public FreshnessStatus Freshness(DateTimeOffset now) => FreshnessLogic.GetStatus(ReceivedAt, now);

    /// <summary>True once this value is older than the stale window (cross-pod/live two-minute rule).</summary>
    public bool IsStale(DateTimeOffset now, int staleSeconds = FreshnessLogic.DefaultStaleSeconds) =>
        FreshnessLogic.IsStale(ReceivedAt, now, staleSeconds);
}

/// <summary>
/// The live signal state holder that SSE updates flow into, binding the foreground stream to the
/// W5 data layer's freshness model without bypassing its cache rules. It keeps the latest typed
/// value per <c>(vehicleId, field)</c> and the latest batched <c>vehicle_update</c> payload per
/// vehicle, each stamped with a receive time so callers can flag stale (older than two minutes)
/// live values. It deliberately does NOT persist history or touch the REST cache: charts, replay
/// and point-in-time reads remain REST/<c>signal_log</c> responsibilities (ADR-004 layered live
/// state).
/// </summary>
public sealed class LiveSignalStore
{
    private readonly ConcurrentDictionary<(long VehicleId, string Field), LiveSignal> _signals = new();
    private readonly ConcurrentDictionary<long, VehicleUpdateSnapshot> _vehicleUpdates = new();
    private readonly Func<DateTimeOffset> _clock;
    private readonly int _staleSeconds;

    /// <summary>Creates the store with an optional injectable clock and stale window.</summary>
    public LiveSignalStore(
        Func<DateTimeOffset>? clock = null,
        int staleSeconds = FreshnessLogic.DefaultStaleSeconds)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _staleSeconds = staleSeconds;
    }

    /// <summary>Raised when a signal's live value changes.</summary>
    public event Action<LiveSignal>? SignalChanged;

    /// <summary>Raised when a batched <c>vehicle_update</c> arrives for a vehicle.</summary>
    public event Action<VehicleUpdateSnapshot>? VehicleUpdated;

    /// <summary>Applies one decoded live event to the store, raising the matching change event.</summary>
    public void Apply(LiveEvent liveEvent)
    {
        ArgumentNullException.ThrowIfNull(liveEvent);
        var now = _clock();

        switch (liveEvent)
        {
            case LiveEvent.Signal signal:
                var value = new LiveSignal(
                    signal.Envelope.VehicleId,
                    signal.Envelope.Field,
                    signal.Envelope.Kind,
                    signal.Envelope.Value,
                    signal.Envelope.Timestamp,
                    now);
                _signals[(value.VehicleId, value.Field)] = value;
                SignalChanged?.Invoke(value);
                break;

            case LiveEvent.VehicleUpdate update:
                var snapshot = new VehicleUpdateSnapshot(ResolveVehicleId(update.Data), update.Data, now);
                _vehicleUpdates[snapshot.VehicleId] = snapshot;
                VehicleUpdated?.Invoke(snapshot);
                break;

            default:
                // Connected / Heartbeat / Alert / ExportStatus / AchievementUnlocked / Unknown carry
                // no per-signal live state for this store; other holders consume them.
                break;
        }
    }

    /// <summary>Consumes a subscription's event stream, applying every event until cancelled.</summary>
    public async Task BindAsync(LiveSubscription subscription, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        await foreach (var liveEvent in subscription.ReadEventsAsync(cancellationToken).ConfigureAwait(false))
        {
            Apply(liveEvent);
        }
    }

    /// <summary>The latest live value for a signal, or <see langword="null"/> when none was received.</summary>
    public LiveSignal? Latest(long vehicleId, string field)
    {
        ArgumentException.ThrowIfNullOrEmpty(field);
        return _signals.TryGetValue((vehicleId, field), out var value) ? value : null;
    }

    /// <summary>Every live signal currently held for a vehicle.</summary>
    public IReadOnlyCollection<LiveSignal> SignalsFor(long vehicleId) =>
        _signals.Values.Where(s => s.VehicleId == vehicleId).ToArray();

    /// <summary>The latest batched <c>vehicle_update</c> snapshot for a vehicle, if any.</summary>
    public VehicleUpdateSnapshot? LatestVehicleUpdate(long vehicleId) =>
        _vehicleUpdates.TryGetValue(vehicleId, out var snapshot) ? snapshot : null;

    /// <summary>True when the signal is missing or older than the stale window at the current clock.</summary>
    public bool IsStale(long vehicleId, string field, DateTimeOffset? now = null)
    {
        var value = Latest(vehicleId, field);
        return value is null || value.IsStale(now ?? _clock(), _staleSeconds);
    }

    /// <summary>Clears all held live state (e.g. on sign-out).</summary>
    public void Clear()
    {
        _signals.Clear();
        _vehicleUpdates.Clear();
    }

    private static long ResolveVehicleId(JsonElement data)
    {
        if (data.ValueKind == JsonValueKind.Object &&
            data.TryGetProperty("vehicle_id", out var id) &&
            id.ValueKind == JsonValueKind.Number &&
            id.TryGetInt64(out long vehicleId))
        {
            return vehicleId;
        }

        return 0;
    }
}

/// <summary>A batched <c>vehicle_update</c> payload with the time it was received.</summary>
public sealed record VehicleUpdateSnapshot(long VehicleId, JsonElement Data, DateTimeOffset ReceivedAt)
{
    /// <summary>True once this batched update is older than the stale window.</summary>
    public bool IsStale(DateTimeOffset now, int staleSeconds = FreshnessLogic.DefaultStaleSeconds) =>
        FreshnessLogic.IsStale(ReceivedAt, now, staleSeconds);
}
