using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the impersonation status payload. Every getter
/// returns a fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /admin/impersonate/</c> never aborts the parse (web parity: the SPA tolerates undefined fields
/// and coalesces them — see <c>useImpersonationStatus</c>). Kept private to the surface and free of WinUI
/// types so the parse is unit-tested without a UI host.
/// </summary>
internal static class ImpersonationStatusJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>Parse the backend mode token (<c>inactive</c> / <c>active</c>); anything else is unknown.</summary>
    public static ImpersonationMode ParseMode(string? raw) => raw switch
    {
        "active" => ImpersonationMode.Active,
        "inactive" => ImpersonationMode.Inactive,
        _ => ImpersonationMode.Unknown,
    };

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The impersonation subsystem mode reported by <c>GET /admin/impersonate/</c> — the native analogue of the
/// web <c>ImpersonationStatus</c> discriminated union (web/src/api/types.ts). The backend's 200 body only ever
/// carries <c>inactive</c> or <c>active</c>; the <c>open</c> case (forward-auth disabled) is signalled by the
/// <c>AUTH_MODE_OPEN</c> error code on a 501 and is classified at the view-model boundary, not here.
/// </summary>
public enum ImpersonationMode
{
    /// <summary>The status could not be determined (missing/garbled mode field).</summary>
    Unknown,

    /// <summary>No impersonation claim is active for the calling admin.</summary>
    Inactive,

    /// <summary>An impersonation session is currently active.</summary>
    Active,
}

/// <summary>
/// One impersonation status snapshot from <c>GET /admin/impersonate/</c> — the native analogue of the web
/// <c>ImpersonationStatus</c> active shape (web/src/api/types.ts). Field names mirror the Go API's snake_case
/// JSON tags; parsing is null-tolerant so a partial body never throws. The raw <c>expires_at</c> string is
/// kept and parsed on demand. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record ImpersonationStatusSnapshot(
    ImpersonationMode Mode,
    string? OriginalAdmin,
    string? Target,
    string? ExpiresAt)
{
    /// <summary>The "nothing known yet" snapshot used before the first successful read.</summary>
    public static readonly ImpersonationStatusSnapshot Unknown =
        new(ImpersonationMode.Unknown, null, null, null);

    /// <summary>The parsed claim-expiry instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? ExpiresAtInstant => ImpersonationStatusJson.TryParseTimestamp(ExpiresAt);

    /// <summary>
    /// Parse a status envelope. A non-object body (web parity: the query has no usable data) yields the
    /// <see cref="Unknown"/> snapshot rather than throwing.
    /// </summary>
    public static ImpersonationStatusSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Unknown;
        }

        return new ImpersonationStatusSnapshot(
            ImpersonationStatusJson.ParseMode(ImpersonationStatusJson.GetString(element, "mode")),
            ImpersonationStatusJson.GetString(element, "original_admin"),
            ImpersonationStatusJson.GetString(element, "target"),
            ImpersonationStatusJson.GetString(element, "expires_at"));
    }
}

/// <summary>
/// The top-level state the <c>UserImpersonateButton</c> surface renders. Every value maps to a visible,
/// non-collapsing surface (no hidden panels): the action button is always shown; the value selects the
/// surrounding chrome (freshness / availability / inline error) and the button's enabled + busy state. The
/// generic data states (loading / empty / error / stale / offline) are driven by the cache-then-network
/// status read (web <c>useImpersonationStatus</c>); <see cref="Starting"/> and the action-error path are
/// driven by the start mutation (web <c>useStartImpersonation</c>).
/// </summary>
public enum ImpersonateSurfaceState
{
    /// <summary>The first status read is in flight and no cached value exists yet.</summary>
    Loading,

    /// <summary>The status is known and the impersonation action is available.</summary>
    Ready,

    /// <summary>The start mutation is in flight (button shows the busy "Starting…" label).</summary>
    Starting,

    /// <summary>The action cannot be offered here — forward-auth is disabled (open-access install).</summary>
    Empty,

    /// <summary>A hard failure (the status read failed with no cache, or the start mutation failed).</summary>
    Error,

    /// <summary>A cached status is shown but is past the freshness window (still actionable).</summary>
    Stale,

    /// <summary>The network is unreachable; a cached status may be shown but the action is unavailable.</summary>
    Offline,
}

/// <summary>
/// The lifecycle of the start-impersonation action — the native analogue of the web component's
/// <c>open</c> dialog flag combined with the <c>startMut</c> mutation status
/// (web/src/features/admin/components/UserImpersonateButton.tsx).
/// </summary>
public enum ImpersonateActionPhase
{
    /// <summary>No action in progress.</summary>
    Idle,

    /// <summary>The confirmation dialog is open, awaiting the admin's decision.</summary>
    Confirming,

    /// <summary>The start mutation is in flight.</summary>
    Starting,

    /// <summary>The start mutation succeeded (the global impersonation banner appears elsewhere).</summary>
    Started,

    /// <summary>The start mutation failed; an inline error with a retry affordance is shown.</summary>
    Failed,
}

/// <summary>
/// The outcome of a start-impersonation mutation (<c>POST /admin/impersonate/</c>). On success it carries the
/// fresh status snapshot the backend returns (web parity: <c>useStartImpersonation</c> primes the status
/// cache with the mutation result); on failure it carries the privacy-safe <see cref="RepositoryError"/>.
/// </summary>
public sealed record ImpersonationStartOutcome(
    bool Success,
    ImpersonationStatusSnapshot? Status,
    RepositoryError? Error)
{
    /// <summary>A successful start carrying the new active status.</summary>
    public static ImpersonationStartOutcome Ok(ImpersonationStatusSnapshot status) =>
        new(true, status, null);

    /// <summary>A failed start carrying the classified error.</summary>
    public static ImpersonationStartOutcome Fail(RepositoryError error) =>
        new(false, null, error);
}

/// <summary>
/// Maps a raw <see cref="RepositoryResult{T}"/> of the status JSON envelope onto a typed
/// <see cref="ImpersonationStatusSnapshot"/> result, preserving the load status, fetch time, stale flag and
/// (critically) the <see cref="RepositoryError"/> — including its server <c>code</c> — so the view-model can
/// recognise the <c>AUTH_MODE_OPEN</c> open-access signal. Pure — unit-tested without a UI host.
/// </summary>
public static class ImpersonationStatusResultMapper
{
    /// <summary>The server error code that signals forward-auth is disabled (web <c>AUTH_MODE_OPEN</c>).</summary>
    public const string AuthModeOpenCode = "AUTH_MODE_OPEN";

    /// <summary>Project one raw status emission into a typed snapshot result.</summary>
    public static RepositoryResult<ImpersonationStatusSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ImpersonationStatusSnapshot>.Loading(),
            LoadStatus.Empty => RepositoryResult<ImpersonationStatusSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<ImpersonationStatusSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
            LoadStatus.Cached => RepositoryResult<ImpersonationStatusSnapshot>.Cached(
                Snapshot(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ImpersonationStatusSnapshot>.Refreshing(
                Snapshot(raw), raw.FetchedAt ?? default, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<ImpersonationStatusSnapshot>.OfflineCached(
                Snapshot(raw),
                raw.FetchedAt ?? default,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<ImpersonationStatusSnapshot>.Loaded(Snapshot(raw), raw.FetchedAt ?? default),
        };
    }

    /// <summary>True when the failure is the open-access signal rather than a real fault (web parity).</summary>
    public static bool IsOpenMode(RepositoryError? error) =>
        error?.Code is AuthModeOpenCode;

    private static ImpersonationStatusSnapshot Snapshot(RepositoryResult<JsonElement> raw) =>
        raw.HasValue ? ImpersonationStatusSnapshot.FromJson(raw.Value) : ImpersonationStatusSnapshot.Unknown;
}

/// <summary>
/// Canonical registry metadata for the impersonate-button surface — the native mirror of the web admin
/// component (web/src/features/admin/components/UserImpersonateButton.tsx). Centralises the stable id, the
/// diagnostics slug and every localized string (keyed exactly as the web <c>t(...)</c> calls, with the same
/// English fallbacks) so the view and view-model stay free of literal copy.
/// </summary>
public static class UserImpersonateButtonRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "user-impersonate-button";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "UserImpersonateButton";

    /// <summary>Idle button label (web <c>impersonation.button.start</c>).</summary>
    public static string StartLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.button.start", "Impersonate");

    /// <summary>Busy button label (web <c>impersonation.button.starting</c>).</summary>
    public static string StartingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.button.starting", "Starting\u2026");

    /// <summary>Accessible button name with the subject interpolated (web <c>impersonation.button.aria</c>).</summary>
    public static string AriaLabel(ILocalizer localizer, string subject) =>
        Format(Require(localizer).GetString("impersonation.button.aria", "Impersonate {0}"), subject);

    /// <summary>Confirmation dialog title (web <c>impersonation.confirm.title</c>).</summary>
    public static string ConfirmTitle(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.confirm.title", "Start impersonation session?");

    /// <summary>Confirmation dialog message with the subject interpolated (web <c>impersonation.confirm.message</c>).</summary>
    public static string ConfirmMessage(ILocalizer localizer, string subject) =>
        Format(
            Require(localizer).GetString(
                "impersonation.confirm.message",
                "You will see TeslaSync as {0} for up to 15 minutes. The action is logged to the audit log. End the session from the banner when you are done."),
            subject);

    /// <summary>Confirmation primary-button label (web <c>impersonation.confirm.confirm</c>).</summary>
    public static string ConfirmConfirmLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.confirm.confirm", "Start impersonation");

    /// <summary>Confirmation cancel-button label (web <c>impersonation.confirm.cancel</c>).</summary>
    public static string ConfirmCancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.confirm.cancel", "Cancel");

    /// <summary>Loading-chip caption while the status read is in flight (native chrome).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.button.loading", "Checking impersonation\u2026");

    /// <summary>Open-access "feature unavailable" hint (the empty surface).</summary>
    public static string UnavailableLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.button.unavailable",
            "Impersonation is unavailable in open-access mode.");

    /// <summary>Offline hint shown beside the disabled action.</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.button.offline",
            "Offline \u2014 impersonation is unavailable until the connection returns.");

    /// <summary>Stale-status hint (the action stays available).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.button.stale", "Status may be out of date.");

    /// <summary>Status-read hard-failure message (web parity: the impersonation service is unreachable).</summary>
    public static string StatusErrorLabel(ILocalizer localizer) =>
        Require(localizer).GetString(
            "impersonation.button.error",
            "Could not reach the impersonation service. Try again.");

    /// <summary>Start-mutation failure message (web <c>impersonation.toast.startFailed</c> default).</summary>
    public static string StartFailedLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.toast.startFailed", "Failed to start impersonation");

    /// <summary>Retry affordance label for the error surfaces.</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("impersonation.button.retry", "Try again");

    private static string Format(string template, string subject) =>
        template.Contains("{0}", StringComparison.Ordinal)
            ? string.Format(CultureInfo.CurrentCulture, template, subject)
            : template;

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the impersonate-button surface (P1/S11 diagnostics contract). Records only the
/// operational counters with the surface slug — never the subject identifier — so a diagnostics line can never
/// leak who an operator can or did impersonate. Thread-safe.
/// </summary>
public sealed class UserImpersonateButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _startsRequested;
    private long _startsSucceeded;
    private long _startsFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UserImpersonateButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of start-impersonation actions confirmed.</summary>
    public long StartsRequested => Interlocked.Read(ref _startsRequested);

    /// <summary>Number of start-impersonation actions that succeeded.</summary>
    public long StartsSucceeded => Interlocked.Read(ref _startsSucceeded);

    /// <summary>Number of start-impersonation actions that failed.</summary>
    public long StartsFailed => Interlocked.Read(ref _startsFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UserImpersonateButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UserImpersonateButtonRegistration.Slug}");
    }

    /// <summary>Record that a start action was confirmed (no subject is ever logged).</summary>
    public void RecordStartRequested()
    {
        Interlocked.Increment(ref _startsRequested);
        _sink?.Invoke($"impersonation.start.requested slug={UserImpersonateButtonRegistration.Slug}");
    }

    /// <summary>Record the resolution of a start action (success/failure only — never the subject).</summary>
    public void RecordStartResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _startsSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _startsFailed);
        }

        _sink?.Invoke(
            $"impersonation.start.resolved slug={UserImpersonateButtonRegistration.Slug} success={(success ? "true" : "false")}");
    }
}
