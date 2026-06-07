using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IBackupHistorySource"/> — the native data adapter for the Backup
/// History surface. It is the native analogue of the web component's two-hook composition
/// (web/src/features/dashboard/widgets/BackupHistoryWidget.tsx): one cache-then-network read that first
/// resolves the Tesla Energy site list (generated operation
/// <see cref="BackupHistoryRegistration.SitesOperationId"/>, web <c>useTeslaEnergySites</c>), takes the
/// first site's <c>energy_site_id</c>, then — only when a site exists — reads that site's backup history
/// over the trailing 30-day window (operation <see cref="BackupHistoryRegistration.BackupHistoryOperationId"/>,
/// web <c>useTeslaBackupHistory(siteId, since)</c>). The combined <see cref="BackupHistorySnapshot"/> is
/// cached so the whole surface restores instantly, and no HTTP ever touches the view.
/// </summary>
public sealed class BackupHistorySource : IBackupHistorySource
{
    private const string CacheKey = "tesla:backup-history";

    private static readonly ApiRequest SitesRequest = new(BackupHistoryRegistration.SitesOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and (optional) clock.</summary>
    public BackupHistorySource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BackupHistorySnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // The combined snapshot is always a meaningful value (a "no site" / "no events" result is rendered
        // as its own empty surface, not the engine's generic Empty), so nothing is treated as empty here —
        // the view-model derives the NoSite / NoEvents / Loaded distinction from the snapshot's content.
        var stream = _engine.StreamAsync(
            CacheKey,
            FetchAsync,
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    /// <summary>The trailing-window start date (web <c>thirtyDaysAgo()</c>), an ISO <c>yyyy-MM-dd</c> UTC date.</summary>
    internal static string SinceDate(DateTimeOffset now) =>
        now.UtcDateTime.Date.AddDays(-BackupHistoryRegistration.LookbackDays)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<BackupHistorySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var sites = await _api.SendAsync<JsonElement>(SitesRequest, cancellationToken).ConfigureAwait(false);
        if (BackupHistorySnapshot.ParseFirstSiteId(sites) is not { } siteId)
        {
            // Web parity: with no linked site the backup-history query is disabled (enabled: !!siteId).
            return BackupHistorySnapshot.NoSites;
        }

        var backupRequest = new ApiRequest(
            BackupHistoryRegistration.BackupHistoryOperationId,
            PathParams: new Dictionary<string, string>
            {
                [BackupHistoryRegistration.SitePathParam] = siteId.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>
            {
                [BackupHistoryRegistration.SinceQueryParam] = SinceDate(_clock()),
            });

        var events = await _api.SendAsync<JsonElement>(backupRequest, cancellationToken).ConfigureAwait(false);
        return BackupHistorySnapshot.FromSiteAndEvents(siteId, events);
    }
}
