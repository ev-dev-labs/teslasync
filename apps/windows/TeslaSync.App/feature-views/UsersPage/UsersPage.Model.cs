using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive render branch the admin <c>UsersPage</c> (web "Subjects" page) shows — the native mirror of
/// the render ladder in web/src/features/admin/pages/UsersPage.tsx. The web component renders, in precedence order, the
/// open-mode notice (web <c>open</c> — <c>isImpersonationOpenMode(status)</c>), the loading panel (web
/// <c>candidates.isLoading</c>), the failure surface (web <c>candidates.isError</c> — <c>ErrorDisplay</c> + retry), the
/// empty surface (web <c>subjects.length === 0</c> — <c>EmptyState</c>) and finally the subjects list (web
/// <c>subjects.map</c>). Per-region visibility is driven by the projected flags so each branch renders exactly as the
/// web composes it; the open-mode branch carries the <c>impersonation.users.openMode</c> string.
/// </summary>
public enum UsersPageState
{
    /// <summary>The candidates query is in flight with no resolution yet (web <c>candidates.isLoading</c>).</summary>
    Loading,

    /// <summary>The status reported open mode (web <c>open</c>) — the forward-auth notice shows; candidates never load.</summary>
    OpenMode,

    /// <summary>The candidates query failed (web <c>candidates.isError</c>) — the failure surface + retry shows.</summary>
    Error,

    /// <summary>The candidates query resolved with no other subjects (web <c>subjects.length === 0</c>).</summary>
    Empty,

    /// <summary>The candidates query resolved with one or more subjects (web <c>subjects.map</c>).</summary>
    Populated,
}

/// <summary>
/// The discriminator of the impersonation status the page reads from <c>GET /admin/impersonate</c> — the native mirror
/// of the three values the web <c>UsersPage</c> derives from <c>useImpersonationStatus</c> via the
/// <c>isImpersonationOpenMode</c> / <c>isImpersonationActive</c> helpers. The page only needs the open-vs-active
/// distinction: <see cref="Open"/> suppresses the candidates query and shows the forward-auth notice; <see cref="Active"/>
/// disables every per-row impersonate action (an admin already impersonating cannot start a second session).
/// </summary>
public enum UsersImpersonationStatus
{
    /// <summary>Forward-auth is disabled (web <c>mode === 'open'</c>, backend <c>AUTH_MODE_OPEN</c>).</summary>
    Open,

    /// <summary>No impersonation claim is active for the calling admin (web <c>mode === 'inactive'</c> / no data).</summary>
    Inactive,

    /// <summary>An impersonation session is already active (web <c>mode === 'active'</c>) — the actions are disabled.</summary>
    Active,
}

/// <summary>
/// The discriminator of the candidates response from <c>GET /admin/impersonate/candidates</c> — the native mirror of
/// the web <c>ImpersonationCandidatesResponse</c> union (<c>{ mode: 'open' }</c> | <c>{ mode: 'session'; candidates }</c>).
/// </summary>
public enum ImpersonationSubjectsMode
{
    /// <summary>Forward-auth is disabled (web <c>{ mode: 'open' }</c>) — the page treats the subject list as empty.</summary>
    Open,

    /// <summary>Forward-auth is active and the (possibly empty) candidate list is present (web <c>{ mode: 'session' }</c>).</summary>
    Session,
}

/// <summary>
/// One impersonation candidate — the native mirror of the web <c>ImpersonationCandidate</c> (web/src/api/types.ts), a
/// single opaque proxy-issued <see cref="Subject"/> the calling admin could impersonate. Field name mirrors the Go
/// snake_case JSON tag; parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without
/// a UI host.
/// </summary>
/// <param name="Subject">The opaque proxy-issued subject identifier (web <c>subject</c>).</param>
public sealed record ImpersonationCandidate(string Subject)
{
    /// <summary>Read one candidate from a JSON object, tolerating a missing / null <c>subject</c>.</summary>
    public static ImpersonationCandidate FromJson(JsonElement element) =>
        new(UsersJson.Str(element, "subject") ?? string.Empty);
}

/// <summary>
/// The candidates envelope — the native mirror of the resolved web <c>useImpersonationCandidates</c> value: the
/// discriminating <see cref="Mode"/> plus the parsed <see cref="Candidates"/>. The tolerant parser accepts the backend
/// <c>{ mode, candidates }</c> object, the platform <c>{ data: [...] }</c> envelope and a bare array; an explicit
/// <c>mode: 'open'</c> resolves to <see cref="Open"/>. Pure data.
/// </summary>
public sealed record ImpersonationCandidatesSnapshot(
    ImpersonationSubjectsMode Mode,
    IReadOnlyList<ImpersonationCandidate> Candidates)
{
    /// <summary>The open-mode snapshot (forward-auth disabled) — web <c>{ mode: 'open' }</c>.</summary>
    public static ImpersonationCandidatesSnapshot Open { get; } =
        new(ImpersonationSubjectsMode.Open, Array.Empty<ImpersonationCandidate>());

    /// <summary>The resolved-but-empty session snapshot — the default local-state feed result (single-subject install).</summary>
    public static ImpersonationCandidatesSnapshot EmptySession { get; } =
        new(ImpersonationSubjectsMode.Session, Array.Empty<ImpersonationCandidate>());

    /// <summary>
    /// Read the candidate list from JSON, tolerating the backend <c>{ mode, candidates }</c> object, the platform
    /// <c>{ data: [...] }</c> envelope and a bare array. An explicit <c>mode: 'open'</c> yields <see cref="Open"/>.
    /// </summary>
    public static ImpersonationCandidatesSnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            string? mode = UsersJson.Str(root, "mode");
            if (string.Equals(mode, "open", StringComparison.OrdinalIgnoreCase))
            {
                return Open;
            }

            if (root.TryGetProperty("candidates", out var candidates))
            {
                return new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, ReadArray(candidates));
            }

            if (root.TryGetProperty("data", out var data))
            {
                return new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, ReadArray(data));
            }
        }

        return new ImpersonationCandidatesSnapshot(ImpersonationSubjectsMode.Session, ReadArray(root));
    }

    private static IReadOnlyList<ImpersonationCandidate> ReadArray(JsonElement arr)
    {
        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ImpersonationCandidate>();
        }

        var list = new List<ImpersonationCandidate>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(ImpersonationCandidate.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>Null-tolerant <see cref="JsonElement"/> string reader for the candidates payload (web parity: undefined-tolerant).</summary>
internal static class UsersJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
}

/// <summary>
/// The render-time data model the <c>UsersPage</c> projects from — the native analogue of the web component's resolved
/// status + candidates queries (web/src/features/admin/pages/UsersPage.tsx). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Status">The resolved impersonation status (null while the first status read is in flight).</param>
/// <param name="CandidatesMode">The resolved candidates discriminator (null until the candidates query resolves).</param>
/// <param name="Candidates">The candidate subjects (web <c>subjects</c>).</param>
/// <param name="Loading">Whether a query is in flight with no resolution yet (web <c>candidates.isLoading</c>).</param>
/// <param name="HasError">Whether the candidates query failed (web <c>candidates.isError</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
public sealed record UsersModel(
    UsersImpersonationStatus? Status,
    ImpersonationSubjectsMode? CandidatesMode,
    IReadOnlyList<ImpersonationCandidate> Candidates,
    bool Loading,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The initial model — the first status read, nothing resolved yet.</summary>
    public static UsersModel Initial { get; } = new(
        Status: null,
        CandidatesMode: null,
        Candidates: Array.Empty<ImpersonationCandidate>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null);
}

/// <summary>
/// One projected, render-ready subject row (web list item): the subject identifier plus the impersonate action's
/// disabled flag (web <c>disabled={active}</c>). Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Subject">The opaque subject the impersonate action targets (web <c>c.subject</c>).</param>
/// <param name="ImpersonateDisabled">Whether the per-row impersonate action is disabled (web <c>active</c>).</param>
public sealed record UsersSubjectRowDisplay(string Subject, bool ImpersonateDisabled);

/// <summary>
/// The render-ready display the <c>UsersPage</c> view binds to — every visible literal resolved through the i18n facade
/// and every per-region visibility flag computed, so the view is a thin renderer. The native mirror of the full web
/// tree: the page chrome (<see cref="Title"/> + <see cref="Subtitle"/>) plus the open-mode / loading / error / empty /
/// list render branches.
/// </summary>
public sealed record UsersDisplay(
    UsersPageState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    string LoadingText,
    bool ShowOpenMode,
    string OpenModeText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowList,
    IReadOnlyList<UsersSubjectRowDisplay> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="UsersModel"/> to its <see cref="UsersDisplay"/> — the native port of the render
/// logic in web/src/features/admin/pages/UsersPage.tsx. Every visible literal resolves through the i18n facade using
/// the exact web key names with the same English fallbacks; the chrome strings (title/subtitle) resolve on every
/// projection so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class UsersProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web status + candidates queries).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static UsersDisplay Project(UsersModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Page chrome (web PageContainer title + subtitle — two of the five manifest strings).
        string title = UsersPageRegistration.Title(localizer);
        string subtitle = UsersPageRegistration.Subtitle(localizer);

        // Open-mode notice (web open-mode branch — the impersonation.users.openMode manifest string).
        string openModeText = UsersPageRegistration.OpenModeText(localizer);

        // Loading panel (web candidates.isLoading — bare Spinner; the native chrome adds an a11y caption).
        string loadingText = UsersPageRegistration.LoadingText(localizer);

        // Failure surface (web candidates.isError — ErrorDisplay + retry).
        string loadFailed = UsersPageRegistration.ErrorText(localizer);
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed} {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = UsersPageRegistration.RetryLabel(localizer);

        // Empty surface (web subjects.length === 0 — EmptyState title + message manifest strings).
        string emptyTitle = UsersPageRegistration.EmptyTitle(localizer);
        string emptyMessage = UsersPageRegistration.EmptyMessage(localizer);

        UsersPageState state = ResolveState(model);

        bool active = model.Status == UsersImpersonationStatus.Active;
        var rows = new List<UsersSubjectRowDisplay>();
        if (state == UsersPageState.Populated)
        {
            foreach (var candidate in Subjects(model))
            {
                rows.Add(new UsersSubjectRowDisplay(candidate.Subject, active));
            }
        }

        return new UsersDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == UsersPageState.Loading,
            LoadingText: loadingText,
            ShowOpenMode: state == UsersPageState.OpenMode,
            OpenModeText: openModeText,
            ShowError: state == UsersPageState.Error,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: state == UsersPageState.Empty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowList: state == UsersPageState.Populated,
            Rows: rows,
            AutomationName: title);
    }

    /// <summary>Resolve the top-level render branch from the model in the web precedence order.</summary>
    public static UsersPageState ResolveState(UsersModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        // web: open ? OpenMode (the candidates query is disabled while open).
        if (model.Status == UsersImpersonationStatus.Open)
        {
            return UsersPageState.OpenMode;
        }

        // web: candidates.isLoading ? Loading.
        if (model.Loading)
        {
            return UsersPageState.Loading;
        }

        // web: candidates.isError ? Error.
        if (model.HasError)
        {
            return UsersPageState.Error;
        }

        // web: subjects.length === 0 ? Empty : list.
        return Subjects(model).Count == 0 ? UsersPageState.Empty : UsersPageState.Populated;
    }

    // web: const subjects = candidates.data?.mode === 'session' ? candidates.data.candidates : [].
    private static IReadOnlyList<ImpersonationCandidate> Subjects(UsersModel model) =>
        model.CandidatesMode == ImpersonationSubjectsMode.Session
            ? model.Candidates
            : Array.Empty<ImpersonationCandidate>();
}

/// <summary>
/// Canonical metadata for the <c>UsersPage</c> feature surface — the native mirror of the web admin "Subjects" page at
/// web/src/features/admin/pages/UsersPage.tsx. The shell page factory registers the surface under <see cref="RouteName"/>;
/// the page ships unrouted in the web (no router entry — it is an importable-but-unrouted symbol), so the native factory
/// registration is likewise latent. Every string resolves through the i18n facade with the web key names and the web
/// inline-default English copy (these keys live as inline <c>t(key, default)</c> fallbacks in the web source — they are
/// not catalog entries — so the native surface resolves them the same way: keyed, with the same English fallback).
/// </summary>
public static class UsersPageRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "Users";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "UsersPage";

    /// <summary>The generated OpenAPI operation id for the status read (web <c>useImpersonationStatus</c> GET /admin/impersonate).</summary>
    public const string StatusOperation = "get_api_v1_admin_impersonate";

    /// <summary>The generated OpenAPI operation id for the candidates read (web <c>useImpersonationCandidates</c>).</summary>
    public const string CandidatesOperation = "get_api_v1_admin_impersonate_candidates";

    /// <summary>The structured error code the backend returns when forward-auth is disabled (web <c>AUTH_MODE_OPEN</c> sentinel).</summary>
    public const string AuthModeOpenCode = "AUTH_MODE_OPEN";

    /// <summary>The Segoe Fluent Icons glyph for the open-mode notice (web AlertTriangle icon).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>The Segoe Fluent Icons glyph for the empty surface (web Users icon).</summary>
    public const string SubjectsGlyph = "\uE716"; // People

    /// <summary>Page title (web <c>impersonation.users.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.users.title", "Subjects");

    /// <summary>Page subtitle (web <c>impersonation.users.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.users.subtitle",
            "Active subjects you can impersonate for support. Sessions are limited to 15 minutes and recorded in the audit log.");

    /// <summary>Open-mode notice (web <c>impersonation.users.openMode</c>).</summary>
    public static string OpenModeText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.users.openMode",
            "Impersonation requires forward-auth mode. This install is in open mode, so per-user identity is not available.");

    /// <summary>Empty-surface title (web <c>impersonation.users.emptyTitle</c>).</summary>
    public static string EmptyTitle(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.users.emptyTitle", "No other subjects");

    /// <summary>Empty-surface message (web <c>impersonation.users.emptyMessage</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.users.emptyMessage",
            "No other subjects have an active session right now. Sign someone else in to enable impersonation.");

    /// <summary>Loading-panel a11y caption (native chrome — the web renders a bare Spinner).</summary>
    public static string LoadingText(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.users.loading", "Loading subjects\u2026");

    /// <summary>Candidates-load failure message (web <c>ErrorDisplay</c> surface).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.users.error", "Failed to load subjects.");

    /// <summary>Retry affordance label for the failure surface (shared key, web <c>ErrorDisplay onRetry</c>).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>UsersPage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> counter with the surface slug — never a subject identifier — so a diagnostics line can never leak
/// who an operator can impersonate. Thread-safe.
/// </summary>
public sealed class UsersPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UsersPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UsersPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UsersPageRegistration.Slug}");
    }
}
