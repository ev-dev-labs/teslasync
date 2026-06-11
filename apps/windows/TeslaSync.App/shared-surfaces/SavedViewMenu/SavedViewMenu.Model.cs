using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One saved-views row — the native port of the web <c>SavedView</c> interface
/// (web/src/api/types.ts) returned by <c>useSavedViews</c>. The API ships snake_case JSON
/// (<c>is_default</c>, <c>is_pinned</c>, <c>sort_order</c>, <c>created_at</c>, …); a host adapter maps that
/// wire shape onto these PascalCase properties before handing the row to the
/// <see cref="ISavedViewsStore"/> seam, so the surface never deserializes anything itself. Immutable so a
/// projection can be compared by value in headless tests.
/// </summary>
/// <param name="Id">Server row id (web <c>id</c>); the stable key + the mutation target.</param>
/// <param name="Name">The user-facing view name (web <c>name</c>).</param>
/// <param name="Route">The SPA route the view belongs to (web <c>route</c>), e.g. <c>/drives</c>.</param>
/// <param name="Query">The canonical querystring the view applies (web <c>query</c>; no leading <c>?</c>).</param>
/// <param name="IsDefault">Whether the view auto-applies on first open (web <c>is_default</c>).</param>
/// <param name="IsPinned">Whether the view is pinned ahead of the rest (web <c>is_pinned</c>).</param>
/// <param name="SortOrder">The server-assigned ordering weight (web <c>sort_order</c>).</param>
/// <param name="UserId">Owning user id, when present (web <c>user_id</c>).</param>
/// <param name="CreatedAt">ISO-8601 creation timestamp (web <c>created_at</c>).</param>
/// <param name="UpdatedAt">ISO-8601 last-update timestamp (web <c>updated_at</c>).</param>
public sealed record SavedView(
    long Id,
    string Name,
    string Route,
    string Query,
    bool IsDefault,
    bool IsPinned,
    int SortOrder = 0,
    long? UserId = null,
    string? CreatedAt = null,
    string? UpdatedAt = null);

/// <summary>
/// The create payload — the native port of the web <c>SavedViewCreateInput</c>
/// (web/src/api/types.ts), built by the surface's Save dialog from the current querystring.
/// </summary>
/// <param name="Name">The new view's name (web <c>name</c>).</param>
/// <param name="Route">The route the view is scoped to (web <c>route</c>).</param>
/// <param name="Query">The querystring to capture (web <c>query</c>).</param>
/// <param name="IsDefault">Whether to mark it the route default (web <c>is_default</c>).</param>
public sealed record SavedViewCreateInput(
    string Name,
    string Route,
    string Query,
    bool IsDefault = false);

/// <summary>
/// The patch payload — the native port of the web <c>SavedViewUpdateInput</c>
/// (web/src/api/types.ts). Each field is optional; only the supplied members are changed (rename sends
/// <see cref="Name"/>, pin toggles send <see cref="IsPinned"/>, the default toggle sends
/// <see cref="IsDefault"/>).
/// </summary>
public sealed record SavedViewUpdateInput(
    string? Name = null,
    string? Query = null,
    bool? IsDefault = null,
    bool? IsPinned = null,
    int? SortOrder = null);

/// <summary>
/// The mutually-exclusive body layout the popover shows — the projection of the
/// <c>useSavedViews</c> query lifecycle onto the four chrome branches the native surface renders. The web
/// component collapses an undefined query to an empty array (so it only ever shows empty-vs-list); the
/// native surface honours the prompt's full state matrix and renders the loading / error branches the
/// underlying query actually has, in addition to the web empty / list branches.
/// </summary>
public enum SavedViewMenuContentState
{
    /// <summary>Initial fetch with no cached value — show the skeleton chrome.</summary>
    Loading,

    /// <summary>At least one saved view — show the interactive list (web <c>views.map(...)</c>).</summary>
    List,

    /// <summary>Resolved with no rows — show the empty state + "Save current view…" (web <c>views.length === 0</c>).</summary>
    Empty,

    /// <summary>The fetch failed with no cached value — show the query-error chrome + retry.</summary>
    Error,
}

/// <summary>
/// The freshness chip shown above the list — the projection of the query's cache freshness. It overlays the
/// <see cref="SavedViewMenuContentState.List"/> / <see cref="SavedViewMenuContentState.Empty"/> body so a
/// cached value is never hidden: <see cref="Stale"/> when a cached value is past its window (auto-refresh in
/// flight) and <see cref="Offline"/> when the network failed but a cached value remains usable.
/// </summary>
public enum SavedViewFreshness
{
    /// <summary>A fresh value — no chip.</summary>
    Fresh,

    /// <summary>A cached value older than the freshness window — show the stale chip; a refresh is in flight.</summary>
    Stale,

    /// <summary>The network failed; a cached value is still shown behind an offline chip.</summary>
    Offline,
}

/// <summary>
/// Canonical metadata + i18n keys for the saved-view menu surface — the native mirror of the web
/// <c>SavedViewMenu</c> (web/src/components/data-display/SavedViewMenu.tsx). It carries the diagnostics slug
/// the surface registers under and every render-contract i18n key/fallback the web source passes to
/// <c>t()</c> (verbatim English fallbacks, U+2026 ellipses included), so the native surface reproduces the
/// web copy exactly. Keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects.
/// The handful of keys the web source does not have (loading / error / stale / offline chrome the native
/// state matrix requires) are scoped to <c>savedViews.*</c> / reuse the canonical <c>common.*</c> keys, never
/// hard-coded English. UI-free so it is asserted without a XAML host.
/// </summary>
public static class SavedViewMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SavedViewMenu";

    /// <summary>The substitution token interpolated in the announce / delete-confirm templates (web i18next <c>{{name}}</c>).</summary>
    public const string NameToken = "{{name}}";

    /// <summary>i18n key for the menu title / trigger fallback (web <c>savedViews.title</c>).</summary>
    public const string TitleKey = "translation.savedViews.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg, verbatim).</summary>
    public const string TitleFallback = "Saved views";

    /// <summary>i18n key for the "Manage views" link (web <c>savedViews.manage</c>).</summary>
    public const string ManageKey = "translation.savedViews.manage";

    /// <summary>English fallback for <see cref="ManageKey"/> (web second arg, verbatim).</summary>
    public const string ManageFallback = "Manage views";

    /// <summary>i18n key for the empty-state message (web <c>savedViews.empty</c>).</summary>
    public const string EmptyKey = "translation.savedViews.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (web second arg, verbatim).</summary>
    public const string EmptyFallback = "No saved views yet";

    /// <summary>i18n key for the "Save current view…" action (web <c>savedViews.saveCurrent</c>).</summary>
    public const string SaveCurrentKey = "translation.savedViews.saveCurrent";

    /// <summary>English fallback for <see cref="SaveCurrentKey"/> (web second arg, verbatim — the ellipsis is U+2026).</summary>
    public const string SaveCurrentFallback = "Save current view\u2026";

    /// <summary>i18n key for the default-marker label (web <c>savedViews.defaultBadge</c>).</summary>
    public const string DefaultBadgeKey = "translation.savedViews.defaultBadge";

    /// <summary>English fallback for <see cref="DefaultBadgeKey"/> (web second arg, verbatim).</summary>
    public const string DefaultBadgeFallback = "Default";

    /// <summary>i18n key for the clear-default action (web <c>savedViews.unsetDefault</c>).</summary>
    public const string UnsetDefaultKey = "translation.savedViews.unsetDefault";

    /// <summary>English fallback for <see cref="UnsetDefaultKey"/> (web second arg, verbatim).</summary>
    public const string UnsetDefaultFallback = "Clear default";

    /// <summary>i18n key for the set-default action (web <c>savedViews.setDefault</c>).</summary>
    public const string SetDefaultKey = "translation.savedViews.setDefault";

    /// <summary>English fallback for <see cref="SetDefaultKey"/> (web second arg, verbatim).</summary>
    public const string SetDefaultFallback = "Set as default";

    /// <summary>i18n key for the unpin action (web <c>savedViews.unpin</c>).</summary>
    public const string UnpinKey = "translation.savedViews.unpin";

    /// <summary>English fallback for <see cref="UnpinKey"/> (web second arg, verbatim).</summary>
    public const string UnpinFallback = "Unpin";

    /// <summary>i18n key for the pin action (web <c>savedViews.pin</c>).</summary>
    public const string PinKey = "translation.savedViews.pin";

    /// <summary>English fallback for <see cref="PinKey"/> (web second arg, verbatim).</summary>
    public const string PinFallback = "Pin";

    /// <summary>i18n key for the rename action (web <c>savedViews.renamePrompt</c>).</summary>
    public const string RenamePromptKey = "translation.savedViews.renamePrompt";

    /// <summary>English fallback for <see cref="RenamePromptKey"/> (web second arg, verbatim).</summary>
    public const string RenamePromptFallback = "Rename view";

    /// <summary>i18n key for the "view applied" announcement (web <c>savedViews.announceApplied</c>).</summary>
    public const string AnnounceAppliedKey = "translation.savedViews.announceApplied";

    /// <summary>English fallback for <see cref="AnnounceAppliedKey"/> (web second arg, verbatim — carries the <c>{{name}}</c> token).</summary>
    public const string AnnounceAppliedFallback = "View {{name}} applied";

    /// <summary>i18n key for the "view cleared" announcement (web <c>savedViews.announceCleared</c>).</summary>
    public const string AnnounceClearedKey = "translation.savedViews.announceCleared";

    /// <summary>English fallback for <see cref="AnnounceClearedKey"/> (web second arg, verbatim).</summary>
    public const string AnnounceClearedFallback = "Saved view cleared";

    /// <summary>i18n key for the applied-badge prefix (web <c>savedViews.appliedBadge</c>).</summary>
    public const string AppliedBadgeKey = "translation.savedViews.appliedBadge";

    /// <summary>English fallback for <see cref="AppliedBadgeKey"/> (web second arg, verbatim).</summary>
    public const string AppliedBadgeFallback = "View";

    /// <summary>i18n key for the clear-applied-view action (web <c>savedViews.clearApplied</c>).</summary>
    public const string ClearAppliedKey = "translation.savedViews.clearApplied";

    /// <summary>English fallback for <see cref="ClearAppliedKey"/> (web second arg, verbatim).</summary>
    public const string ClearAppliedFallback = "Clear applied view";

    /// <summary>i18n key for the "no filters" manage-row tooltip (web <c>savedViews.emptyQuery</c>).</summary>
    public const string EmptyQueryKey = "translation.savedViews.emptyQuery";

    /// <summary>English fallback for <see cref="EmptyQueryKey"/> (web second arg, verbatim).</summary>
    public const string EmptyQueryFallback = "No filters";

    /// <summary>i18n key for the delete-dialog title (web <c>savedViews.deleteTitle</c>).</summary>
    public const string DeleteTitleKey = "translation.savedViews.deleteTitle";

    /// <summary>English fallback for <see cref="DeleteTitleKey"/> (web second arg, verbatim).</summary>
    public const string DeleteTitleFallback = "Delete saved view";

    /// <summary>i18n key for the delete-confirm body (web <c>savedViews.deleteConfirm</c>).</summary>
    public const string DeleteConfirmKey = "translation.savedViews.deleteConfirm";

    /// <summary>English fallback for <see cref="DeleteConfirmKey"/> (web second arg, verbatim — carries the <c>{{name}}</c> token).</summary>
    public const string DeleteConfirmFallback = "Delete saved view \"{{name}}\"?";

    /// <summary>i18n key for the name-field hint (web saved-view name-field hint).</summary>
    public const string NameHintKey = "translation.savedViews.namePlaceholder"; // parity:allow web i18n key savedViews.namePlaceholder (catalog-mandated literal)

    /// <summary>English fallback for <see cref="NameHintKey"/> (web second arg, verbatim).</summary>
    public const string NameHintFallback = "View name";

    /// <summary>i18n key for the name-field label (web <c>savedViews.name</c>).</summary>
    public const string NameKey = "translation.savedViews.name";

    /// <summary>English fallback for <see cref="NameKey"/> (web second arg, verbatim).</summary>
    public const string NameFallback = "Name";

    /// <summary>i18n key for the "make default" toggle (web <c>savedViews.makeDefault</c>).</summary>
    public const string MakeDefaultKey = "translation.savedViews.makeDefault";

    /// <summary>English fallback for <see cref="MakeDefaultKey"/> (web second arg, verbatim).</summary>
    public const string MakeDefaultFallback = "Apply automatically when I open this page";

    /// <summary>i18n key for the delete action label (web <c>common.delete</c>).</summary>
    public const string DeleteKey = "translation.common.delete";

    /// <summary>English fallback for <see cref="DeleteKey"/> (web second arg, verbatim).</summary>
    public const string DeleteFallback = "Delete";

    /// <summary>i18n key for the cancel action label (web <c>common.cancel</c>).</summary>
    public const string CancelKey = "translation.common.cancel";

    /// <summary>English fallback for <see cref="CancelKey"/> (web second arg, verbatim).</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>i18n key for the saving label (web <c>common.saving</c>).</summary>
    public const string SavingKey = "translation.common.saving";

    /// <summary>English fallback for <see cref="SavingKey"/> (web second arg, verbatim — the ellipsis is U+2026).</summary>
    public const string SavingFallback = "Saving\u2026";

    /// <summary>i18n key for the save action label (web <c>common.save</c>).</summary>
    public const string SaveKey = "translation.common.save";

    /// <summary>English fallback for <see cref="SaveKey"/> (web second arg, verbatim).</summary>
    public const string SaveFallback = "Save";

    /// <summary>i18n key for the close action label (web <c>common.close</c>).</summary>
    public const string CloseKey = "translation.common.close";

    /// <summary>English fallback for <see cref="CloseKey"/> (web second arg, verbatim).</summary>
    public const string CloseFallback = "Close";

    // ── Native state-matrix chrome (no web SavedViewMenu equivalent; the underlying query has these states) ──

    /// <summary>i18n key for the loading chrome's accessible name (native loading branch).</summary>
    public const string LoadingKey = "translation.savedViews.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading saved views";

    /// <summary>i18n key for the load-error title (native error branch).</summary>
    public const string LoadErrorKey = "translation.savedViews.loadError";

    /// <summary>English fallback for <see cref="LoadErrorKey"/> (apostrophe is U+2019).</summary>
    public const string LoadErrorFallback = "Couldn\u2019t load saved views";

    /// <summary>i18n key for the retry affordance (canonical <c>common.retry</c>).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale chip (native stale branch).</summary>
    public const string StaleKey = "translation.savedViews.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline chip (native offline branch).</summary>
    public const string OfflineKey = "translation.savedViews.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>
    /// Interpolate the <see cref="NameToken"/> substitution in a resolved template — the native analogue of
    /// i18next's <c>{ name }</c> interpolation used by the announce / delete-confirm strings. Replaces every
    /// occurrence of <c>{{name}}</c> with <paramref name="name"/>.
    /// </summary>
    public static string FormatName(string template, string name)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template.Replace(NameToken, name ?? string.Empty, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the saved-view menu surface (P1/S11 diagnostics contract). Saved-view names and
/// querystrings can carry user-identifying filter content (vehicle ids, locations), so the collector records
/// ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never a view name,
/// route, or querystring. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class SavedViewMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SavedViewMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SavedViewMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={SavedViewMenuRegistration.Slug}"));
    }
}
