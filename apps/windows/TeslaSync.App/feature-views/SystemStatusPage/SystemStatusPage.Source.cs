using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The generated-client-backed <see cref="ISystemStatusFeed"/> — the native data adapter for the System Status
/// surface. It binds to the generated OpenAPI contract client (ADR-004) for the seven parameter-free queries the web
/// page runs: <c>GET /system/health</c> (web <c>useSystemHealth</c>), <c>GET /vehicles</c> (web <c>useVehicles</c>),
/// <c>GET /notifications/stats</c> (web <c>useNotificationStats</c>), <c>GET /auth/status</c> (web
/// <c>useAuthStatus</c>), <c>GET /backup/runs</c> (web <c>useBackupRuns</c>), <c>GET /backup/configs</c> (web
/// <c>useBackupConfigs</c>) and <c>GET /admin/maintenance</c> (web <c>useMaintenanceState</c>). No HTTP touches the
/// view; each response JSON round-trips through the tolerant snapshot parsers so the snake_case Go wire shape is
/// preserved losslessly. A non-success response surfaces as the client's <see cref="ApiException"/> so the view-model
/// can surface the per-source error / empty branches.
/// </summary>
public sealed class SystemStatusClientFeed : ISystemStatusFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SystemStatusClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public Task<SystemHealthSnapshot> FetchHealthAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.HealthOperation, SystemHealthSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<StatusVehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.VehiclesOperation, StatusVehiclesSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<NotificationStatsSnapshot> FetchNotificationsAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.NotificationsOperation, NotificationStatsSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<AuthStatusSnapshot> FetchAuthAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.AuthOperation, AuthStatusSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<BackupRunsSnapshot> FetchBackupRunsAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.BackupRunsOperation, BackupRunsSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<BackupConfigsSnapshot> FetchBackupConfigsAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.BackupConfigsOperation, BackupConfigsSnapshot.FromJson, cancellationToken);

    /// <inheritdoc />
    public Task<MaintenanceSnapshot> FetchMaintenanceAsync(CancellationToken cancellationToken) =>
        SendAsync(SystemStatusRegistration.MaintenanceOperation, MaintenanceSnapshot.FromJson, cancellationToken);

    private async Task<TSnapshot> SendAsync<TSnapshot>(
        string operationId, Func<JsonElement, TSnapshot> parse, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(operationId);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return parse(json);
    }
}
