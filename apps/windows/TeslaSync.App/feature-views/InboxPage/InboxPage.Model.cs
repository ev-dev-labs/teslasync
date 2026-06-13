using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// A fleet vehicle as the inbox page consumes it — the native subset of the web <c>Vehicle</c> the page reads
/// via <c>useVehicles()</c> and hands to <c>InboxBody</c> for its vehicle filter + row labels
/// (web/src/features/notifications/pages/InboxPage.tsx). Only the id and display name are needed at this tier.
/// </summary>
/// <param name="Id">The vehicle id (web <c>vehicle.id</c>).</param>
/// <param name="DisplayName">The vehicle's display name (web <c>vehicle.display_name</c>), or null.</param>
public sealed record InboxPageVehicle(long Id, string? DisplayName);

/// <summary>
/// An alert rule as the inbox page consumes it — the native subset of the web <c>AlertRule</c> the page reads
/// via <c>useAlertRules()</c> and hands to <c>InboxBody</c> for its rule filter + row labels. Only the id and
/// name are needed at this tier.
/// </summary>
/// <param name="Id">The alert-rule id (web <c>rule.id</c>).</param>
/// <param name="Name">The alert-rule name (web <c>rule.name</c>), or null.</param>
public sealed record InboxPageAlertRule(long Id, string? Name);

/// <summary>
/// The mutually-exclusive data state the inbox page's two auxiliary reads (vehicles + alert rules) fold into.
/// The web page defaults both queries to <c>[]</c> and renders the inbox unconditionally, so this state never
/// hides the page body — it is the page-owned contract for the <c>useVehicles</c> + <c>useAlertRules</c> reads
/// the manifest declares, surfaced for the freshness chip, diagnostics and tests.
/// </summary>
public enum InboxPageState
{
    /// <summary>At least one read is still in flight with no value yet.</summary>
    Loading,

    /// <summary>Both reads settled and at least one returned data.</summary>
    Loaded,

    /// <summary>Both reads settled successfully but neither returned data.</summary>
    Empty,

    /// <summary>Both reads failed with no usable cached value.</summary>
    Error,
}

/// <summary>
/// Canonical, UI-free metadata for the <c>InboxPage</c> surface — the native mirror of the web page at
/// <c>web/src/features/notifications/pages/InboxPage.tsx</c>. Holds the diagnostics slug, the three ported
/// i18n keys with their English defaults, and the localized-label resolvers the view-model exposes. Kept
/// Microsoft.UI-free so the metadata is asserted in headless tests.
/// </summary>
public static class InboxPageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "InboxPage";

    /// <summary>i18n key for the page title (web <c>notifications.inbox.title</c>).</summary>
    public const string TitleKey = "notifications.inbox.title";

    /// <summary>English default for <see cref="TitleKey"/> (web second argument to <c>t()</c>).</summary>
    public const string TitleFallback = "Inbox";

    /// <summary>i18n key for the page subtitle (web <c>notifications.inbox.subtitle</c>).</summary>
    public const string SubtitleKey = "notifications.inbox.subtitle";

    /// <summary>English default for <see cref="SubtitleKey"/>.</summary>
    public const string SubtitleFallback = "Recent notifications from your alert rules.";

    /// <summary>i18n key for the header "View archived" action (web <c>notifications.inbox.viewArchived</c>).</summary>
    public const string ViewArchivedKey = "notifications.inbox.viewArchived";

    /// <summary>English default for <see cref="ViewArchivedKey"/>.</summary>
    public const string ViewArchivedFallback = "View archived";

    /// <summary>Segoe Fluent "Archive" glyph for the header action (web Lucide <c>Archive</c>).</summary>
    public const string ArchiveGlyph = "\uE7B8";

    /// <summary>The route name the shell registers the page factory under (web route <c>/notifications/inbox</c>).</summary>
    public const string RouteName = "NotificationsInbox";

    /// <summary>The deep-link route the "View archived" action navigates to (web <c>/notifications/archived</c>).</summary>
    public const string ArchivedRoute = "notifications/archived";

    /// <summary>The localized page title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized page subtitle.</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, SubtitleFallback);
    }

    /// <summary>The localized "View archived" header-action label.</summary>
    public static string ViewArchivedLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ViewArchivedKey, ViewArchivedFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>InboxPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a notification, vehicle or rule name —
/// so a diagnostics line can never leak a user's data. Thread-safe.
/// </summary>
public sealed class InboxPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public InboxPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=InboxPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={InboxPageRegistration.Slug}");
    }
}

/// <summary>
/// Pure JSON readers for the inbox page's two auxiliary reads. Both endpoints return a snake_case array
/// (<c>camelCaseKeys</c> on the web means both casings can appear), so each reader is tolerant of either
/// casing and skips any malformed entry. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class InboxPageJson
{
    /// <summary>True when a payload is a null body or an empty array (the empty result for either read).</summary>
    public static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    /// <summary>Fold a <c>GET /vehicles</c> JSON array into <see cref="InboxPageVehicle"/>s.</summary>
    public static IReadOnlyList<InboxPageVehicle> ParseVehicles(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<InboxPageVehicle>();
        }

        var vehicles = new List<InboxPageVehicle>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long? id = ReadLong(item, "id", "id");
            if (id is null)
            {
                continue;
            }

            vehicles.Add(new InboxPageVehicle(id.Value, ReadString(item, "display_name", "displayName")));
        }

        return vehicles;
    }

    /// <summary>Fold a <c>GET /alerts/rules</c> JSON array into <see cref="InboxPageAlertRule"/>s.</summary>
    public static IReadOnlyList<InboxPageAlertRule> ParseAlertRules(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<InboxPageAlertRule>();
        }

        var rules = new List<InboxPageAlertRule>(element.GetArrayLength());
        foreach (JsonElement item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long? id = ReadLong(item, "id", "id");
            if (id is null)
            {
                continue;
            }

            rules.Add(new InboxPageAlertRule(id.Value, ReadString(item, "name", "name")));
        }

        return rules;
    }

    private static long? ReadLong(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => null,
        };
    }

    private static string? ReadString(JsonElement element, string snake, string camel)
    {
        JsonElement value = Pick(element, snake, camel);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static JsonElement Pick(JsonElement element, string first, string second)
    {
        if (element.TryGetProperty(first, out JsonElement byFirst))
        {
            return byFirst;
        }

        return element.TryGetProperty(second, out JsonElement bySecond) ? bySecond : default;
    }
}
