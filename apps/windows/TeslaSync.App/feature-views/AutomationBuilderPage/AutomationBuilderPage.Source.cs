using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The data port the <see cref="AutomationBuilderPageViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the seven web hooks the page composes
/// (web/src/features/automations/pages/AutomationBuilderPage.tsx): the edit-mode automation read
/// (<c>useAutomation</c>), the preset read (<c>useAutomationPreset</c>), the vehicle scope list (<c>useVehicles</c>),
/// the notification channels (<c>useNotificationChannels</c>), the create / update write paths
/// (<c>useCreateAutomationFull</c> / <c>useUpdateAutomationFull</c>) and the test-run trigger
/// (<c>useTestRunAutomation</c>). The view never performs HTTP itself; the concrete
/// <see cref="AutomationBuilderClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IAutomationBuilderFeed
{
    /// <summary>Read an existing automation for editing (web <c>useAutomation</c> → <c>GET /automations/{id}</c>).</summary>
    Task<AutomationDetailSnapshot> LoadAutomationAsync(long id, CancellationToken cancellationToken);

    /// <summary>Read a preset to install (web <c>useAutomationPreset</c> → <c>GET /automations/presets/{id}</c>).</summary>
    Task<AutomationPresetSnapshot> LoadPresetAsync(string presetId, CancellationToken cancellationToken);

    /// <summary>Read the vehicle scope options (web <c>useVehicles</c> → <c>GET /vehicles</c>).</summary>
    Task<IReadOnlyList<VehicleOptionRow>> LoadVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Read the notification channels (web <c>useNotificationChannels</c> → <c>GET /notifications</c>).</summary>
    Task<IReadOnlyList<AutomationChannel>> LoadChannelsAsync(CancellationToken cancellationToken);

    /// <summary>Create a new automation (web <c>useCreateAutomationFull</c> → <c>POST /automations</c>); returns the new id.</summary>
    Task<long> CreateAsync(AutomationBuilderForm form, CancellationToken cancellationToken);

    /// <summary>Update an automation (web <c>useUpdateAutomationFull</c> → <c>PUT /automations/{id}</c>); returns the id.</summary>
    Task<long> UpdateAsync(long id, AutomationBuilderForm form, CancellationToken cancellationToken);

    /// <summary>Trigger a test run (web <c>useTestRunAutomation</c> → <c>POST /automations/{id}/test-run</c>).</summary>
    Task TestRunAsync(long id, CancellationToken cancellationToken);
}

/// <summary>
/// The generated-client-backed <see cref="IAutomationBuilderFeed"/> — the native data adapter binding the seven page
/// data sources to the generated OpenAPI contract client (ADR-004). Each method resolves a generated operation id
/// (<see cref="AutomationBuilderRegistration"/>), passes path parameters in the <c>{id}</c> / <c>{presetId}</c> slots
/// and, for the write paths, the SI-faithful snake-case JSON envelope produced by
/// <see cref="AutomationGraphCodec.SerializePayload"/> exactly as the web hooks do. Responses round-trip through the
/// tolerant snapshot parsers (the platform <c>{data:…}</c> envelope preserved). No HTTP touches the view; a
/// non-success response surfaces as the client's <see cref="ApiException"/> so the view-model can map it to the load
/// / save failure surfaces.
/// </summary>
public sealed class AutomationBuilderClientFeed : IAutomationBuilderFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AutomationBuilderClientFeed(IApiClient api)
    {
        System.ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AutomationDetailSnapshot> LoadAutomationAsync(long id, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            AutomationBuilderRegistration.DetailOperation,
            "id",
            id.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AutomationDetailSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<AutomationPresetSnapshot> LoadPresetAsync(string presetId, CancellationToken cancellationToken)
    {
        System.ArgumentException.ThrowIfNullOrEmpty(presetId);
        var request = ApiRequest.WithPath(AutomationBuilderRegistration.PresetOperation, "presetId", presetId);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AutomationPresetSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOptionRow>> LoadVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AutomationBuilderRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehicleOptionRow.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AutomationChannel>> LoadChannelsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AutomationBuilderRegistration.ChannelsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AutomationChannelList.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<long> CreateAsync(AutomationBuilderForm form, CancellationToken cancellationToken)
    {
        System.ArgumentNullException.ThrowIfNull(form);
        var request = new ApiRequest(
            AutomationBuilderRegistration.CreateOperation,
            Body: AutomationGraphCodec.SerializePayload(form));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ReadId(json);
    }

    /// <inheritdoc />
    public async Task<long> UpdateAsync(long id, AutomationBuilderForm form, CancellationToken cancellationToken)
    {
        System.ArgumentNullException.ThrowIfNull(form);
        var request = new ApiRequest(
            AutomationBuilderRegistration.UpdateOperation,
            PathParams: new Dictionary<string, string>(System.StringComparer.Ordinal)
            {
                ["id"] = id.ToString(CultureInfo.InvariantCulture),
            },
            Body: AutomationGraphCodec.SerializePayload(form));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        long parsed = ReadId(json);
        return parsed > 0 ? parsed : id;
    }

    /// <inheritdoc />
    public async Task TestRunAsync(long id, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            AutomationBuilderRegistration.TestRunOperation,
            "id",
            id.ToString(CultureInfo.InvariantCulture));
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static long ReadId(JsonElement json) => AutomationJson.Long(AutomationJson.Unwrap(json), "id") ?? 0;
}

/// <summary>
/// The default local-state <see cref="IAutomationBuilderFeed"/> — the no-backend feed the shell-registered page uses
/// (mirroring the sibling W7 pages' empty feeds). Reads resolve to "not found" / empty so the surface renders its
/// default create-mode form with empty option lists; writes are inert. The generated-client wiring lives in
/// <see cref="AutomationBuilderClientFeed"/> and is exercised by the surface's tests.
/// </summary>
public sealed class EmptyAutomationBuilderFeed : IAutomationBuilderFeed
{
    /// <summary>The shared instance.</summary>
    public static EmptyAutomationBuilderFeed Instance { get; } = new();

    /// <inheritdoc />
    public Task<AutomationDetailSnapshot> LoadAutomationAsync(long id, CancellationToken cancellationToken) =>
        Task.FromResult(AutomationDetailSnapshot.NotFound);

    /// <inheritdoc />
    public Task<AutomationPresetSnapshot> LoadPresetAsync(string presetId, CancellationToken cancellationToken) =>
        Task.FromResult(AutomationPresetSnapshot.None);

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOptionRow>> LoadVehiclesAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<VehicleOptionRow>>(System.Array.Empty<VehicleOptionRow>());

    /// <inheritdoc />
    public Task<IReadOnlyList<AutomationChannel>> LoadChannelsAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AutomationChannel>>(System.Array.Empty<AutomationChannel>());

    /// <inheritdoc />
    public Task<long> CreateAsync(AutomationBuilderForm form, CancellationToken cancellationToken) => Task.FromResult(0L);

    /// <inheritdoc />
    public Task<long> UpdateAsync(long id, AutomationBuilderForm form, CancellationToken cancellationToken) =>
        Task.FromResult(id);

    /// <inheritdoc />
    public Task TestRunAsync(long id, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>
/// A no-geofence <see cref="ITriggerGeofenceSource"/> for the hosted <see cref="TriggerConfigurator"/> on the default
/// (no-backend) page — emits a single empty result so the geofence dropdown shows its "no geofences configured"
/// surface rather than spinning forever.
/// </summary>
public sealed class EmptyTriggerGeofenceSource : ITriggerGeofenceSource
{
    /// <summary>The shared instance.</summary>
    public static EmptyTriggerGeofenceSource Instance { get; } = new();

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TriggerGeofence>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<TriggerGeofence>>.Empty();
    }
}

/// <summary>
/// A no-geofence <see cref="IConditionBuilderSource"/> for the hosted <see cref="ConditionBuilder"/> on the default
/// (no-backend) page — emits a single empty result so the geofence-condition dropdown shows its empty surface.
/// </summary>
public sealed class EmptyConditionBuilderSource : IConditionBuilderSource
{
    /// <summary>The shared instance.</summary>
    public static EmptyConditionBuilderSource Instance { get; } = new();

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeofenceOption>>> StreamGeofencesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield return RepositoryResult<IReadOnlyList<GeofenceOption>>.Empty();
    }
}
