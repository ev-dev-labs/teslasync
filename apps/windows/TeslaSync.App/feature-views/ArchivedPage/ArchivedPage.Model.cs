using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="ArchivedPageViewModel"/> can be in for its page-level
/// context load (the web page's <c>useVehicles</c> + <c>useAlertRules</c> hooks). The web <c>ArchivedPage</c>
/// renders its body (<c>InboxBody</c>) unconditionally and lets those two hooks default to empty arrays, so the
/// context never blocks the inbox; this union exists only to drive a non-blocking status surface (a retriable
/// failure strip) and the success signal. Every branch maps onto a visible outcome; none hides the inbox.
/// </summary>
public enum ArchivedContextState
{
    /// <summary>The first context fetch is in flight with nothing cached yet.</summary>
    Loading,

    /// <summary>The vehicle and/or alert-rule context resolved (web success).</summary>
    Loaded,

    /// <summary>The context resolved but carried no vehicles and no rules.</summary>
    Empty,

    /// <summary>The context fetch failed with no cached value — surface the retriable strip.</summary>
    Error,
}

/// <summary>
/// The page-level context the web <c>ArchivedPage</c> loads and threads into <c>InboxBody</c> — the
/// <c>vehicleMap</c> (id → display name, from <c>GET /vehicles</c> / web <c>useVehicles</c>) and the
/// <c>ruleMap</c> (id → rule name, from <c>GET /alerts/rules</c> / web <c>useAlertRules</c>). Only the two
/// id → name projections the web maps expose are kept; parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Vehicles">The vehicle id → display-name map (web <c>vehicleMap</c>).</param>
/// <param name="Rules">The alert-rule id → name map (web <c>ruleMap</c>).</param>
public sealed record ArchivedContext(
    IReadOnlyDictionary<long, string> Vehicles,
    IReadOnlyDictionary<long, string> Rules)
{
    /// <summary>The resolved-but-empty context (no vehicles, no rules) — the web hooks' default arrays.</summary>
    public static ArchivedContext Empty { get; } =
        new(new Dictionary<long, string>(), new Dictionary<long, string>());

    /// <summary>True when at least one vehicle or rule resolved.</summary>
    public bool HasData => Vehicles.Count > 0 || Rules.Count > 0;

    /// <summary>Assemble the context from the two raw response bodies (vehicles array + rules array).</summary>
    /// <param name="vehicles">The parsed <c>GET /vehicles</c> body (web <c>useVehicles</c>).</param>
    /// <param name="rules">The parsed <c>GET /alerts/rules</c> body (web <c>useAlertRules</c>).</param>
    /// <returns>The assembled, render-ready context.</returns>
    public static ArchivedContext FromResponses(JsonElement vehicles, JsonElement rules) =>
        new(ParseVehicleMap(vehicles), ParseRuleMap(rules));

    /// <summary>Project a <c>GET /vehicles</c> array into the id → display-name map (web <c>vehicleMap</c>).</summary>
    /// <param name="root">The parsed vehicles body.</param>
    /// <returns>The id → name map (empty when the body is not an array).</returns>
    public static IReadOnlyDictionary<long, string> ParseVehicleMap(JsonElement root)
    {
        var map = new Dictionary<long, string>();
        if (root.ValueKind != JsonValueKind.Array)
        {
            return map;
        }

        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long? id = ArchivedJson.Long(element, "id", "id");
            if (id is not { } vehicleId)
            {
                continue;
            }

            string name = ArchivedJson.String(element, "display_name", "displayName")
                ?? ArchivedJson.String(element, "name", "name")
                ?? string.Format(CultureInfo.InvariantCulture, "Vehicle {0}", vehicleId);
            map[vehicleId] = name;
        }

        return map;
    }

    /// <summary>Project a <c>GET /alerts/rules</c> array into the id → rule-name map (web <c>ruleMap</c>).</summary>
    /// <param name="root">The parsed alert-rules body.</param>
    /// <returns>The id → name map (empty when the body is not an array).</returns>
    public static IReadOnlyDictionary<long, string> ParseRuleMap(JsonElement root)
    {
        var map = new Dictionary<long, string>();
        if (root.ValueKind != JsonValueKind.Array)
        {
            return map;
        }

        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long? id = ArchivedJson.Long(element, "id", "id");
            if (id is not { } ruleId)
            {
                continue;
            }

            string name = ArchivedJson.String(element, "name", "name")
                ?? string.Format(CultureInfo.InvariantCulture, "Rule {0}", ruleId);
            map[ruleId] = name;
        }

        return map;
    }
}

/// <summary>
/// The render-ready projection the <see cref="ArchivedPage"/> view binds to. The web page is thin — a
/// <c>PageContainer</c> (title + subtitle + copy-link + a back-to-inbox action) wrapping <c>InboxBody</c> — so
/// the display carries the three localized header literals, the copy-link target, and the non-blocking context
/// status (the retriable failure strip), all decided here rather than in the view.
/// </summary>
/// <param name="Title">The page title (web <c>notifications.archived.title</c>).</param>
/// <param name="Subtitle">The page sub-heading (web <c>notifications.archived.subtitle</c>).</param>
/// <param name="BackToInboxText">The back-to-inbox action label (web <c>notifications.archived.backToInbox</c>).</param>
/// <param name="CopyLinkText">The deep link the copy-link affordance writes (web <c>window.location.href</c>).</param>
/// <param name="State">The current context lifecycle state.</param>
/// <param name="ShowContextError">Whether the non-blocking context failure strip is shown.</param>
/// <param name="ContextErrorText">The failure-strip message.</param>
/// <param name="RetryText">The failure-strip retry label.</param>
/// <param name="AutomationName">The page's composed accessible name.</param>
public sealed record ArchivedDisplay(
    string Title,
    string Subtitle,
    string BackToInboxText,
    string CopyLinkText,
    ArchivedContextState State,
    bool ShowContextError,
    string ContextErrorText,
    string RetryText,
    string AutomationName);

/// <summary>
/// Projects an <see cref="ArchivedContext"/> + <see cref="ArchivedContextState"/> into the render-ready
/// <see cref="ArchivedDisplay"/>, resolving every literal through the i18n facade with the web key names and
/// verbatim English defaults. The failure strip is shown only in the <see cref="ArchivedContextState.Error"/>
/// branch, so the inbox is never replaced by a blank region.
/// </summary>
public static class ArchivedProjection
{
    /// <summary>Build the display for a context + state.</summary>
    /// <param name="context">The resolved (or empty) page context.</param>
    /// <param name="state">The current context lifecycle state.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static ArchivedDisplay Project(ArchivedContext context, ArchivedContextState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = ArchivedRegistration.Title(localizer);

        return new ArchivedDisplay(
            Title: title,
            Subtitle: ArchivedRegistration.Subtitle(localizer),
            BackToInboxText: ArchivedRegistration.BackToInbox(localizer),
            CopyLinkText: ArchivedRegistration.CopyLink,
            State: state,
            ShowContextError: state == ArchivedContextState.Error,
            ContextErrorText: localizer.GetString("error.loadFailed", "Failed to load data"),
            RetryText: localizer.GetString("common.retry", "Retry"),
            AutomationName: title);
    }
}

/// <summary>
/// Static identity + i18n helpers for the Archived notifications page (web
/// <c>web/src/features/notifications/pages/ArchivedPage.tsx</c>, route <c>/notifications/archived</c>, nav name
/// <c>NotificationsArchived</c>). The shell page factory binds the view under <see cref="RouteName"/>.
/// </summary>
public static class ArchivedRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("NotificationsArchived", …)).</summary>
    public const string RouteName = "NotificationsArchived";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "notifications/archived";

    /// <summary>The inbox route the back-to-inbox action navigates to (web <c>to="/notifications/inbox"</c>).</summary>
    public const string InboxRoute = "notifications/inbox";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ArchivedPage";

    /// <summary>The shared cache key for the assembled vehicle + rule context.</summary>
    public const string CacheKey = "notifications:archived:context";

    /// <summary>The deep link the copy-link affordance writes (the native analogue of <c>window.location.href</c>).</summary>
    public const string CopyLink = "teslasync://notifications/archived";

    /// <summary>The generated operation id for the alert-rule read (web <c>useAlertRules</c>).</summary>
    public const string AlertRulesOperation = "get_api_v1_alerts_rules";

    /// <summary>The localized page title (web <c>notifications.archived.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.archived.title", "Archived notifications");
    }

    /// <summary>The localized page sub-heading (web <c>notifications.archived.subtitle</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "notifications.archived.subtitle",
            "Notifications you previously archived. Restore to bring them back.");
    }

    /// <summary>The localized back-to-inbox action label (web <c>notifications.archived.backToInbox</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized label.</returns>
    public static string BackToInbox(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.archived.backToInbox", "Back to inbox");
    }
}

/// <summary>
/// PII-safe diagnostics for the Archived notifications surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a notification, VIN, vehicle name or rule
/// name — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ArchivedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public ArchivedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ArchivedPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ArchivedRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="ArchivedPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of assembled <see cref="ArchivedContext"/> readings — the native analogue of the
/// web page's <c>useVehicles</c> + <c>useAlertRules</c> composition. The view never performs HTTP itself; the
/// concrete <see cref="ArchivedContextSource"/> (or a test fake) drives this.
/// </summary>
public interface IArchivedContextSource
{
    /// <summary>Stream the cache-then-network vehicle + rule context, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<ArchivedContext>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="IArchivedContextSource"/> — resolves every read to the empty context (the empty data
/// state). The shell uses this until a host wires the generated-client-backed
/// <see cref="ArchivedContextSource"/>.
/// </summary>
public sealed class EmptyArchivedContextSource : IArchivedContextSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyArchivedContextSource Instance { get; } = new();

    private EmptyArchivedContextSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ArchivedContext>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<ArchivedContext>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>Null-tolerant JSON readers for the vehicle / rule bodies (snake_case first, camelCase fallback).</summary>
internal static class ArchivedJson
{
    /// <summary>Read a string field by its snake_case then camelCase name, or null when absent/non-string.</summary>
    public static string? String(JsonElement element, string snake, string camel)
    {
        if (element.TryGetProperty(snake, out var s) && s.ValueKind == JsonValueKind.String)
        {
            return s.GetString();
        }

        if (!string.Equals(snake, camel, StringComparison.Ordinal)
            && element.TryGetProperty(camel, out var c)
            && c.ValueKind == JsonValueKind.String)
        {
            return c.GetString();
        }

        return null;
    }

    /// <summary>Read a long field by its snake_case then camelCase name, tolerating string-encoded numbers.</summary>
    public static long? Long(JsonElement element, string snake, string camel)
    {
        if (TryLong(element, snake, out var value))
        {
            return value;
        }

        if (!string.Equals(snake, camel, StringComparison.Ordinal) && TryLong(element, camel, out value))
        {
            return value;
        }

        return null;
    }

    private static bool TryLong(JsonElement element, string name, out long value)
    {
        value = 0;
        if (!element.TryGetProperty(name, out var property))
        {
            return false;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetInt64(out value) => true,
            JsonValueKind.String when long.TryParse(
                property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value) => true,
            _ => false,
        };
    }
}
