using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.FeatureFlags;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The top-level data state the <c>FeatureFlagsPage</c> surfaces for its primary (flag-registry) query — the native
/// discriminator for the three web data states the page exposes through its <c>PageContainer query={flags}</c>
/// freshness chip and the child surfaces (web/src/features/admin/pages/FeatureFlagsPage.tsx). The web page never
/// blanks the body — the children always render (the FlagsTable "Loading flags…" / empty body, the ChangesPanel
/// empty state) — so this enum drives only the page-tier freshness indicator, never a hidden region.
/// </summary>
public enum FeatureFlagsState
{
    /// <summary>The flags query is in flight with no data yet (web <c>flags.isLoading</c>).</summary>
    Loading,

    /// <summary>The flags query failed (web <c>flags.isError</c>) — the freshness chip shows "Error" while the children stay visible.</summary>
    Error,

    /// <summary>The flags query resolved (web <c>flags.data</c>) — the registry + audit render their content.</summary>
    Ready,
}

/// <summary>
/// One resolved page of the flag registry — the native mirror of the web <c>FeatureFlagsListResponse.flags</c>
/// payload (web/src/types/admin-diagnostics.ts). Each <see cref="FeatureFlagEntry"/> carries the flag key and its
/// JSON value; the page binds the list straight into the shared <c>FlagsTable</c> surface.
/// </summary>
public sealed record FeatureFlagsSnapshot(IReadOnlyList<FeatureFlagEntry> Flags)
{
    /// <summary>An empty, resolved snapshot (no flags) — the default local-state feed result.</summary>
    public static FeatureFlagsSnapshot Empty { get; } = new(Array.Empty<FeatureFlagEntry>());
}

/// <summary>
/// One resolved page of the flag-change audit feed — the native mirror of the web
/// <c>FeatureFlagChangesResponse.rows</c> payload (web/src/types/admin-diagnostics.ts). The page binds the rows
/// straight into the shared <c>ChangesPanel</c> surface.
/// </summary>
public sealed record FlagChangesSnapshot(IReadOnlyList<FeatureFlagChangeRow> Rows)
{
    /// <summary>An empty, resolved snapshot (no audit rows) — the default local-state feed result.</summary>
    public static FlagChangesSnapshot Empty { get; } = new(Array.Empty<FeatureFlagChangeRow>());
}

/// <summary>
/// The data port the <see cref="FeatureFlagsPageViewModel"/> reads the current flag registry through — the native
/// analogue of the web <c>useFlags</c> hook (<c>GET /system/flags</c>). The default
/// <see cref="EmptyFeatureFlagsFeed"/> resolves to the empty state; the generated-client-backed
/// <c>FeatureFlagsClientFeed</c> (FeatureFlagsPage.Source.cs) binds the OpenAPI contract client (ADR-004).
/// </summary>
public interface IFeatureFlagsFeed
{
    /// <summary>Resolve the current flag registry snapshot.</summary>
    Task<FeatureFlagsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The data port the <see cref="FeatureFlagsPageViewModel"/> reads the recent flag-change audit feed through — the
/// native analogue of the web <c>useFlagChanges(null, 50)</c> hook (<c>GET /system/flags/changes?limit=</c>).
/// </summary>
public interface IFlagChangesFeed
{
    /// <summary>Resolve the most recent <paramref name="limit"/> flag-change audit rows (global, unscoped).</summary>
    Task<FlagChangesSnapshot> FetchAsync(int limit, CancellationToken cancellationToken);
}

/// <summary>
/// The write port the <see cref="FeatureFlagsPageViewModel"/> mutates flags through — the native analogue of the web
/// <c>useSetFlag</c> (<c>PUT /system/flags/{key}</c>) and <c>useDeleteFlag</c> (<c>DELETE /system/flags/{key}?reason=</c>)
/// mutations. Both are sudo-gated server-side; the audit row rejects an empty reason, which is why the page gates
/// the save/delete actions on a non-empty reason. The default <see cref="NoopFlagWriteService"/> is a no-op for the
/// local-state page; the generated-client-backed <c>FlagWriteClientService</c> (FeatureFlagsPage.Source.cs) binds
/// the OpenAPI contract client (ADR-004).
/// </summary>
public interface IFlagWriteService
{
    /// <summary>Create or update <paramref name="key"/> with the parsed JSON <paramref name="value"/> and an audit <paramref name="reason"/>.</summary>
    Task SetAsync(string key, JsonElement value, string reason, CancellationToken cancellationToken);

    /// <summary>Delete <paramref name="key"/>, logging the audit <paramref name="reason"/>.</summary>
    Task DeleteAsync(string key, string reason, CancellationToken cancellationToken);
}

/// <summary>The default flag-registry feed — resolves every query to the empty snapshot (the empty data state).</summary>
public sealed class EmptyFeatureFlagsFeed : IFeatureFlagsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFeatureFlagsFeed Instance { get; } = new();

    private EmptyFeatureFlagsFeed()
    {
    }

    /// <inheritdoc />
    public Task<FeatureFlagsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FeatureFlagsSnapshot.Empty);
    }
}

/// <summary>The default flag-change feed — resolves every query to the empty snapshot (the empty data state).</summary>
public sealed class EmptyFlagChangesFeed : IFlagChangesFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFlagChangesFeed Instance { get; } = new();

    private EmptyFlagChangesFeed()
    {
    }

    /// <inheritdoc />
    public Task<FlagChangesSnapshot> FetchAsync(int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FlagChangesSnapshot.Empty);
    }
}

/// <summary>The default flag write service — a no-op for the local-state page (no backend mutation).</summary>
public sealed class NoopFlagWriteService : IFlagWriteService
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopFlagWriteService Instance { get; } = new();

    private NoopFlagWriteService()
    {
    }

    /// <inheritdoc />
    public Task SetAsync(string key, JsonElement value, string reason, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(string key, string reason, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// Canonical metadata + localized literals for the <c>FeatureFlagsPage</c> feature surface — the native mirror of the
/// web page at <c>web/src/features/admin/pages/FeatureFlagsPage.tsx</c> (route <c>/admin/flags</c>, nav name
/// <c>FeatureFlagsAdmin</c>). Every visible literal resolves through the i18n facade using the same catalog keys the
/// web source feeds into <c>t()</c> (the <c>Strings/{lang}/Resources.resw</c> catalog stores them under the
/// <c>translation.</c> prefix); the English fallback is the web default verbatim. UI-free so the mapping is asserted
/// without a XAML host.
/// </summary>
public static class FeatureFlagsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FeatureFlagsPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>FeatureFlagsAdmin</c> → <c>admin/flags</c>).</summary>
    public const string RouteName = "FeatureFlagsAdmin";

    /// <summary>The generated OpenAPI operation id for the registry query (web <c>useFlags</c>, <c>GET /system/flags</c>).</summary>
    public const string ListOperation = "get_api_v1_system_flags";

    /// <summary>The generated OpenAPI operation id for the change-audit query (web <c>useFlagChanges</c>, <c>GET /system/flags/changes</c>).</summary>
    public const string ChangesOperation = "get_api_v1_system_flags_changes";

    /// <summary>The generated OpenAPI operation id for the set mutation (web <c>useSetFlag</c>, <c>PUT /system/flags/{key}</c>).</summary>
    public const string SetOperation = "put_api_v1_system_flags_key";

    /// <summary>The generated OpenAPI operation id for the delete mutation (web <c>useDeleteFlag</c>, <c>DELETE /system/flags/{key}</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_system_flags_key";

    /// <summary>The default audit page size the global feed mounts with (web <c>useFlagChanges(null, 50)</c>).</summary>
    public const int ChangesLimit = 50;

    /// <summary>The page title (web key <c>admin.flags.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.pageTitle", "Feature Flags");

    /// <summary>The page subtitle (web key <c>admin.flags.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.subtitle",
            "Typed feature-flag registry \u2014 all changes are sudo-gated and logged.");

    /// <summary>The header "Add flag" CTA label (web key <c>admin.flags.actions.add</c>).</summary>
    public static string AddLabel(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.actions.add", "Add flag");

    /// <summary>The registry panel title (web key <c>admin.flags.panels.registry</c>).</summary>
    public static string PanelRegistry(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.panels.registry", "Registry");

    /// <summary>The recent-changes panel title (web key <c>admin.flags.panels.changes</c>).</summary>
    public static string PanelChanges(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.panels.changes", "Recent changes");

    /// <summary>The delete confirm-dialog title (web key <c>admin.flags.delete.title</c>).</summary>
    public static string DeleteTitle(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.delete.title", "Delete flag?");

    /// <summary>
    /// The delete confirm-dialog message with the flag key interpolated (web key <c>admin.flags.delete.message</c>,
    /// web template <c>"…flag "{{key}}"…"</c> — the catalog uses the positional <c>{0}</c> form).
    /// </summary>
    public static string DeleteMessage(ILocalizer localizer, string key) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Get(localizer, "translation.admin.flags.delete.message",
                "Permanently remove flag \"{0}\". This is logged as a delete operation in the audit feed."),
            key ?? string.Empty);

    /// <summary>The delete-dialog reason field label (web key <c>admin.flags.delete.reasonLabel</c>).</summary>
    public static string DeleteReasonLabel(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.delete.reasonLabel", "Reason");

    /// <summary>The delete-dialog reason field input hint, shown when the field is empty.</summary>
    public static string DeleteReasonPrompt(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.delete.reasonPlaceholder", "Why this delete? (logged in audit)"); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>The delete-dialog confirm button label (web key <c>admin.flags.delete.confirm</c>).</summary>
    public static string DeleteConfirmLabel(ILocalizer localizer) =>
        Get(localizer, "translation.admin.flags.delete.confirm", "Delete flag");

    /// <summary>The shared cancel label (web key <c>common.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Get(localizer, "translation.common.cancel", "Cancel");

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FeatureFlagsPage</c> surface (P1/S11 diagnostics contract). The page edits
/// privileged feature-flag values and audited reasons, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never a flag key, value, or reason. Thread-safe.
/// </summary>
public sealed class FeatureFlagsPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FeatureFlagsPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FeatureFlagsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={FeatureFlagsRegistration.Slug}"));
    }
}
