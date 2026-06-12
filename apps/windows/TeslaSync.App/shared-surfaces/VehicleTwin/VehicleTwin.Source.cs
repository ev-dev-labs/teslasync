using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data port the <see cref="VehicleTwinViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of live twin readings for the bound vehicle — the native analogue of the live
/// vehicle-state composition that feeds the web <c>VehicleTwin</c> (its parent owns the fetch and re-renders the
/// element with the resolved <c>VehicleTwinState</c>). The view never performs HTTP itself; a concrete
/// repository-backed source (supplied by the host composition root) or a scripted source (tests / previews)
/// drives this.
/// </summary>
public interface IVehicleTwinSource
{
    /// <summary>Stream the cache-then-network twin readings, oldest emission first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<VehicleTwinReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A single per-vehicle paint-override change — the native analogue of the web <c>vehicle.paint.changed</c>
/// broadcast message (web/src/hooks/useVehiclePaint.ts). <see cref="PaintId"/> is the new override id, or null
/// when the override was cleared (revert to the inferred paint).
/// </summary>
/// <param name="VehicleId">The vehicle whose override changed.</param>
/// <param name="PaintId">The new override id, or null when cleared.</param>
public readonly record struct VehiclePaintOverrideChange(long VehicleId, PaintPaletteId? PaintId);

/// <summary>
/// The per-vehicle paint-override store the surface reads through (P1/S8) — the native analogue of the web
/// <c>useVehiclePaint</c> persistence + cross-instance sync (web/src/hooks/useVehiclePaint.ts). The web hook
/// keeps a browser-local, per-vehicle override and broadcasts changes so a picker and the twin below it stay in
/// sync without a reload; this seam expresses that responsibility so the <see cref="VehicleTwinViewModel"/>
/// re-projects when the override changes. The production implementation persists to the app settings store; the
/// headless / preview / unit-test default is <see cref="InMemoryVehiclePaintOverrideStore"/>.
/// </summary>
public interface IVehiclePaintOverrideStore
{
    /// <summary>The manual override id for <paramref name="vehicleId"/>, or null when none is set.</summary>
    /// <param name="vehicleId">The vehicle id; ids &lt;= 0 always resolve to null (web "no vehicle yet").</param>
    PaintPaletteId? GetOverride(long vehicleId);

    /// <summary>
    /// Set (or, with a null <paramref name="paintId"/>, clear) the override for <paramref name="vehicleId"/> and
    /// raise <see cref="Changed"/>. Ids &lt;= 0 are ignored (web disables persistence for "no vehicle yet").
    /// </summary>
    /// <param name="vehicleId">The vehicle id the override is keyed by.</param>
    /// <param name="paintId">The new override id, or null to clear it.</param>
    void SetOverride(long vehicleId, PaintPaletteId? paintId);

    /// <summary>Raised whenever an override changes (the web in-tab listeners + cross-tab broadcast).</summary>
    event EventHandler<VehiclePaintOverrideChange>? Changed;
}

/// <summary>
/// An in-memory <see cref="IVehiclePaintOverrideStore"/> — the headless / preview / unit-test default. It keeps a
/// per-vehicle override map and raises <see cref="Changed"/> on every mutation, exercising the surface's
/// override-driven re-projection without a settings host. Thread-safe.
/// </summary>
public sealed class InMemoryVehiclePaintOverrideStore : IVehiclePaintOverrideStore
{
    private readonly object _gate = new();
    private readonly Dictionary<long, PaintPaletteId> _overrides = new();

    /// <inheritdoc />
    public event EventHandler<VehiclePaintOverrideChange>? Changed;

    /// <inheritdoc />
    public PaintPaletteId? GetOverride(long vehicleId)
    {
        if (vehicleId <= 0)
        {
            return null;
        }

        lock (_gate)
        {
            return _overrides.TryGetValue(vehicleId, out PaintPaletteId id) ? id : null;
        }
    }

    /// <inheritdoc />
    public void SetOverride(long vehicleId, PaintPaletteId? paintId)
    {
        if (vehicleId <= 0)
        {
            return;
        }

        lock (_gate)
        {
            if (paintId is { } id)
            {
                _overrides[vehicleId] = id;
            }
            else
            {
                _overrides.Remove(vehicleId);
            }
        }

        Changed?.Invoke(this, new VehiclePaintOverrideChange(vehicleId, paintId));
    }
}

/// <summary>
/// An <see cref="IVehicleTwinSource"/> that replays a scripted sequence of emissions — the unit-test / preview
/// default. It lets every surface state (loading, cached, refreshing, loaded, empty, offline, error) be exercised
/// deterministically without a network or cache. The sequence is yielded in order, honouring cancellation.
/// </summary>
public sealed class ScriptedVehicleTwinSource : IVehicleTwinSource
{
    private readonly IReadOnlyList<RepositoryResult<VehicleTwinReading>> _emissions;

    /// <summary>Creates the source over an ordered emission sequence.</summary>
    /// <param name="emissions">The emissions to replay, oldest first.</param>
    public ScriptedVehicleTwinSource(params RepositoryResult<VehicleTwinReading>[] emissions)
    {
        ArgumentNullException.ThrowIfNull(emissions);
        _emissions = emissions;
    }

    /// <summary>Creates the source over an ordered emission sequence.</summary>
    /// <param name="emissions">The emissions to replay, oldest first.</param>
    public ScriptedVehicleTwinSource(IReadOnlyList<RepositoryResult<VehicleTwinReading>> emissions)
    {
        ArgumentNullException.ThrowIfNull(emissions);
        _emissions = emissions;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleTwinReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (var emission in _emissions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
        }

        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>
/// An <see cref="IVehicleTwinSource"/> that surfaces a single resolved reading — the parameterless / preview
/// default that mirrors the web component being handed already-resolved props. It emits
/// <see cref="RepositoryResult{T}.Loading"/> then <see cref="RepositoryResult{T}.Loaded"/> with the reading (or
/// <see cref="RepositoryResult{T}.Empty"/> when no reading is supplied), so the surface renders its baseline
/// without a data host.
/// </summary>
public sealed class StaticVehicleTwinSource : IVehicleTwinSource
{
    private readonly VehicleTwinReading? _reading;
    private readonly DateTimeOffset _fetchedAt;

    /// <summary>Creates the source over an optional resolved reading.</summary>
    /// <param name="reading">The reading to surface, or null to render the empty state.</param>
    /// <param name="fetchedAt">The fetch timestamp stamped on the loaded emission; defaults to now.</param>
    public StaticVehicleTwinSource(VehicleTwinReading? reading = null, DateTimeOffset? fetchedAt = null)
    {
        _reading = reading;
        _fetchedAt = fetchedAt ?? DateTimeOffset.UtcNow;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleTwinReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<VehicleTwinReading>.Loading();

        cancellationToken.ThrowIfCancellationRequested();
        yield return _reading is { } reading
            ? RepositoryResult<VehicleTwinReading>.Loaded(reading, _fetchedAt)
            : RepositoryResult<VehicleTwinReading>.Empty(_fetchedAt);

        await Task.CompletedTask.ConfigureAwait(false);
    }
}
