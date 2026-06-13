using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The data port the <see cref="ScheduledExportsPanelViewModel"/> reads the schedule list through and writes the
/// create / update / delete / run-now mutations back through — the native parity of the web hooks the panel binds
/// (web/src/features/system/pages/ScheduledExportsPanel.tsx): <c>useScheduledExports</c>,
/// <c>useCreateScheduledExport</c>, <c>useUpdateScheduledExport</c>, <c>useDeleteScheduledExport</c> and
/// <c>useRunScheduledExportNow</c>. The view never performs HTTP itself; the default
/// <see cref="EmptyScheduledExportsFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="ScheduledExportsClientFeed"/> binds to the <c>/scheduled-exports</c> endpoints (ADR-004).
/// </summary>
public interface IScheduledExportsFeed
{
    /// <summary>Resolve the current schedule list (web <c>useScheduledExports → GET /scheduled-exports</c>).</summary>
    Task<IReadOnlyList<ScheduledExport>> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Create a schedule (web <c>useCreateScheduledExport → POST /scheduled-exports</c>).</summary>
    Task CreateAsync(ScheduledExportFormState form, CancellationToken cancellationToken);

    /// <summary>Update a schedule (web <c>useUpdateScheduledExport → PUT /scheduled-exports/{id}</c>).</summary>
    Task UpdateAsync(long id, ScheduledExportFormState form, CancellationToken cancellationToken);

    /// <summary>Delete a schedule (web <c>useDeleteScheduledExport → DELETE /scheduled-exports/{id}</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken);

    /// <summary>Trigger a manual run (web <c>useRunScheduledExportNow → POST /scheduled-exports/{id}/run</c>).</summary>
    Task RunNowAsync(long id, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no schedules and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyScheduledExportsFeed : IScheduledExportsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyScheduledExportsFeed Instance { get; } = new();

    private EmptyScheduledExportsFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ScheduledExport>> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<ScheduledExport>>(Array.Empty<ScheduledExport>());
    }

    /// <inheritdoc />
    public Task CreateAsync(ScheduledExportFormState form, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpdateAsync(long id, ScheduledExportFormState form, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task RunNowAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IScheduledExportsFeed"/> — the native data adapter for the
/// scheduled-exports surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET
/// /scheduled-exports</c> for the list (web <c>useScheduledExports</c>), <c>POST /scheduled-exports</c> for create
/// (web <c>useCreateScheduledExport</c>), <c>PUT /scheduled-exports/{id}</c> for update (web
/// <c>useUpdateScheduledExport</c>), <c>DELETE /scheduled-exports/{id}</c> for delete (web
/// <c>useDeleteScheduledExport</c>) and <c>POST /scheduled-exports/{id}/run</c> for the manual run-now (web
/// <c>useRunScheduledExportNow</c>). No HTTP touches the view; the list response JSON round-trips through the
/// tolerant <see cref="ScheduledExport.ParseList"/> parser so the snake_case wire shape is preserved losslessly,
/// and the write bodies are pinned to snake_case via <see cref="ScheduledExportPayload"/>.
/// </summary>
public sealed class ScheduledExportsClientFeed : IScheduledExportsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ScheduledExportsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ScheduledExport>> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ScheduledExportsRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ScheduledExport.ParseList(json);
    }

    /// <inheritdoc />
    public async Task CreateAsync(ScheduledExportFormState form, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(form);

        var request = new ApiRequest(ScheduledExportsRegistration.CreateOperation, Body: form.ToPayload());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UpdateAsync(long id, ScheduledExportFormState form, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(form);

        var request = new ApiRequest(
            ScheduledExportsRegistration.UpdateOperation,
            PathParams: PathFor(id),
            Body: form.ToPayload());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ScheduledExportsRegistration.DeleteOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RunNowAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ScheduledExportsRegistration.RunOperation, PathParams: PathFor(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string> PathFor(long id) =>
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["id"] = id.ToString(CultureInfo.InvariantCulture),
        };
}
