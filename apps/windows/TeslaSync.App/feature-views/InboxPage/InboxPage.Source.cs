using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The two read seams the <see cref="InboxPageViewModel"/> binds to (P1/S8 state-holder layer) — the native
/// port of the web <c>InboxPage</c>'s <c>useVehicles()</c> + <c>useAlertRules()</c> query composition
/// (web/src/features/notifications/pages/InboxPage.tsx). Each yields the cache-then-network sequence the web
/// hooks ride; the view never performs HTTP itself. The concrete <see cref="InboxPageSource"/> (or a test
/// fake) drives this.
/// </summary>
public interface IInboxPageSource
{
    /// <summary>Stream the cache-then-network fleet list (web <c>useVehicles</c>).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> StreamVehiclesAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network alert-rule list (web <c>useAlertRules</c>).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> StreamAlertRulesAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IInboxPageSource"/> — the native data adapter for the inbox page's two
/// auxiliary reads. It streams <c>GET /vehicles</c> and <c>GET /alerts/rules</c> through the shared
/// <see cref="CacheThenNetworkEngine"/> (the same cache-then-network pipeline the web <c>useVehicles</c> /
/// <c>useAlertRules</c> queries ride) and folds each emission's JSON array into the page read-models. Each
/// body is cached as JSON so the snake_case wire shape round-trips losslessly and a network failure surfaces
/// the last cached list rather than an empty one. No HTTP touches the view.
/// </summary>
public sealed class InboxPageSource : IInboxPageSource
{
    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/alerts/rules</c> (web <c>useAlertRules</c>).</summary>
    public const string AlertRulesOperation = "get_api_v1_alerts_rules";

    private const string VehiclesCacheKey = "notifications:inbox-page:vehicles";
    private const string AlertRulesCacheKey = "notifications:inbox-page:alert-rules";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public InboxPageSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(VehiclesOperation);
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            VehiclesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            InboxPageJson.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            IReadOnlyList<InboxPageVehicle>? vehicles = result.Value is { } body
                ? InboxPageJson.ParseVehicles(body)
                : null;
            yield return new RepositoryResult<IReadOnlyList<InboxPageVehicle>>(
                result.Status, vehicles, result.FetchedAt, result.IsStale, result.Error);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> StreamAlertRulesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(AlertRulesOperation);
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            AlertRulesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            InboxPageJson.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            IReadOnlyList<InboxPageAlertRule>? rules = result.Value is { } body
                ? InboxPageJson.ParseAlertRules(body)
                : null;
            yield return new RepositoryResult<IReadOnlyList<InboxPageAlertRule>>(
                result.Status, rules, result.FetchedAt, result.IsStale, result.Error);
        }
    }
}

/// <summary>
/// An inert <see cref="IInboxPageSource"/> for headless hosts and the shell entry point — both reads emit a
/// single terminal empty result, so the page mounts (and renders the inbox body) without a network round-trip.
/// The Windows app's data-wired host supplies the contract-client-backed <see cref="InboxPageSource"/>.
/// </summary>
public sealed class EmptyInboxPageSource : IInboxPageSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyInboxPageSource Instance { get; } = new();

    private EmptyInboxPageSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Empty();
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> StreamAlertRulesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Empty();
    }
}

/// <summary>
/// A fixed <see cref="IInboxPageSource"/> that replays explicit snapshot sequences for galleries and tests, so
/// a test can drive the loading / loaded / empty / offline / error branches the live source produces without a
/// network round-trip. The default constructor surfaces the supplied lists as a single loaded (or empty)
/// terminal emission per read.
/// </summary>
public sealed class StaticInboxPageSource : IInboxPageSource
{
    private readonly IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> _vehicles;
    private readonly IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> _rules;

    /// <summary>Creates the source over fixed lists (defaults to empty lists).</summary>
    /// <param name="vehicles">The fixed fleet to surface, or null for an empty fleet.</param>
    /// <param name="rules">The fixed rule list to surface, or null for an empty list.</param>
    /// <param name="clock">The clock stamping the loaded emissions (defaults to UTC now).</param>
    public StaticInboxPageSource(
        IReadOnlyList<InboxPageVehicle>? vehicles = null,
        IReadOnlyList<InboxPageAlertRule>? rules = null,
        Func<DateTimeOffset>? clock = null)
    {
        DateTimeOffset stamp = (clock ?? (() => DateTimeOffset.UtcNow))();
        IReadOnlyList<InboxPageVehicle> fleet = vehicles ?? Array.Empty<InboxPageVehicle>();
        IReadOnlyList<InboxPageAlertRule> ruleList = rules ?? Array.Empty<InboxPageAlertRule>();
        _vehicles =
        [
            fleet.Count == 0
                ? RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Empty(stamp)
                : RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Loaded(fleet, stamp),
        ];
        _rules =
        [
            ruleList.Count == 0
                ? RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Empty(stamp)
                : RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Loaded(ruleList, stamp),
        ];
    }

    private StaticInboxPageSource(
        IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> vehicles,
        IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> rules)
    {
        _vehicles = vehicles;
        _rules = rules;
    }

    /// <summary>Creates a source that replays explicit per-read snapshot sequences (drives every branch).</summary>
    /// <param name="vehicles">The vehicle snapshots to yield in order.</param>
    /// <param name="rules">The alert-rule snapshots to yield in order.</param>
    public static StaticInboxPageSource Emitting(
        IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> vehicles,
        IReadOnlyList<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> rules)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(rules);
        return new StaticInboxPageSource(vehicles, rules);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageVehicle>>> StreamVehiclesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        foreach (RepositoryResult<IReadOnlyList<InboxPageVehicle>> emission in _vehicles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<InboxPageAlertRule>>> StreamAlertRulesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        foreach (RepositoryResult<IReadOnlyList<InboxPageAlertRule>> emission in _rules)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return emission;
        }
    }
}

/// <summary>
/// An inert <see cref="IInboxSource"/> that emits a single empty reading — used to mount the hosted
/// <see cref="InboxBody"/> in the shell entry point where the live data layer is not yet injected, mirroring
/// how the sibling W7 pages host their bodies over empty sources. The data-wired host instead constructs the
/// body over the repository-backed <see cref="InboxSource"/>.
/// </summary>
public sealed class EmptyInboxSource : IInboxSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyInboxSource Instance { get; } = new();

    private EmptyInboxSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<InboxReading>> StreamAsync(
        InboxQuery query,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<InboxReading>.Empty();
    }
}

/// <summary>
/// An inert <see cref="IInboxCommands"/> whose mutations complete without side effects — paired with
/// <see cref="EmptyInboxSource"/> to host the read-only <see cref="InboxBody"/> in the shell entry point. The
/// data-wired host supplies the repository-backed <see cref="InboxCommands"/>.
/// </summary>
public sealed class NoOpInboxCommands : IInboxCommands
{
    /// <summary>The shared singleton instance.</summary>
    public static NoOpInboxCommands Instance { get; } = new();

    private NoOpInboxCommands()
    {
    }

    /// <inheritdoc />
    public Task MarkReadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task MarkAllReadAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task MarkUnreadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task ArchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task UnarchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
