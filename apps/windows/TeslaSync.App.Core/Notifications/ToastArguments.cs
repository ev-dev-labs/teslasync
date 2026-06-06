using System.Collections.ObjectModel;
using System.Text;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The well-known toast activation actions (P2/W8-0001). The body-tap uses <see cref="Navigate"/>;
/// buttons use the more specific actions. Every action is paired with a route so the activation
/// handler can always resolve a destination even for a closed-app cold launch.
/// </summary>
public static class ToastActions
{
    /// <summary>Open the deep-linked route (the default body-tap action).</summary>
    public const string Navigate = "navigate";

    /// <summary>Dismiss the notification without navigating.</summary>
    public const string Dismiss = "dismiss";

    /// <summary>Open the notifications inbox.</summary>
    public const string OpenInbox = "open_inbox";

    /// <summary>Retry the underlying operation (e.g. a failed command), landing on its page.</summary>
    public const string Retry = "retry";

    /// <summary>Start re-authentication, landing on the account/settings surface.</summary>
    public const string Reauthenticate = "reauthenticate";
}

/// <summary>
/// Encodes and decodes the opaque argument string a toast carries and returns on activation
/// (P2/W8-0001). The format is a query-string-style list of <c>key=value</c> pairs joined by
/// <c>;</c>, with every key and value <see cref="Uri.EscapeDataString(string)"/>-escaped so a route,
/// action or entity id containing reserved characters round-trips exactly. Decoding is tolerant: a
/// null, empty or malformed segment yields an empty map rather than throwing, because the activation
/// payload originates outside the app and must never crash a cold launch.
/// </summary>
public static class ToastArguments
{
    /// <summary>The activation action key (one of <see cref="ToastActions"/>).</summary>
    public const string ActionKey = "action";

    /// <summary>The in-app route path key (no leading slash).</summary>
    public const string RouteKey = "route";

    /// <summary>The notification kind key (a <see cref="NotificationKinds.ToWire"/> token).</summary>
    public const string KindKey = "kind";

    /// <summary>The optional entity id key (vehicle id, session id, incident id, …).</summary>
    public const string EntityKey = "id";

    private const char PairSeparator = ';';
    private const char ValueSeparator = '=';

    /// <summary>
    /// Builds the canonical argument string for a body-tap or button: action, then route, then kind,
    /// then optional entity id. Order is fixed so equal inputs encode identically (stable for tests).
    /// </summary>
    public static string For(string action, string route, NotificationKind kind, string? entityId = null)
    {
        ArgumentNullException.ThrowIfNull(action);
        ArgumentNullException.ThrowIfNull(route);

        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ActionKey] = action,
            [RouteKey] = route,
            [KindKey] = NotificationKinds.ToWire(kind),
        };

        if (!string.IsNullOrWhiteSpace(entityId))
        {
            values[EntityKey] = entityId;
        }

        return Encode(values);
    }

    /// <summary>Encodes <paramref name="values"/> into the <c>key=value;…</c> argument string (insertion order preserved).</summary>
    public static string Encode(IReadOnlyDictionary<string, string> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        var builder = new StringBuilder();
        foreach (var pair in values)
        {
            if (string.IsNullOrEmpty(pair.Key))
            {
                continue;
            }

            if (builder.Length > 0)
            {
                builder.Append(PairSeparator);
            }

            builder.Append(Uri.EscapeDataString(pair.Key));
            builder.Append(ValueSeparator);
            builder.Append(Uri.EscapeDataString(pair.Value ?? string.Empty));
        }

        return builder.ToString();
    }

    /// <summary>Decodes an argument string into an ordinal map; a null/empty/malformed input yields an empty map.</summary>
    public static IReadOnlyDictionary<string, string> Decode(string? arguments)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(arguments))
        {
            return new ReadOnlyDictionary<string, string>(map);
        }

        foreach (var segment in arguments.Split(PairSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            int split = segment.IndexOf(ValueSeparator);
            if (split <= 0)
            {
                continue;
            }

            var key = Unescape(segment[..split]);
            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            map[key] = Unescape(segment[(split + 1)..]);
        }

        return new ReadOnlyDictionary<string, string>(map);
    }

    private static string Unescape(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch (UriFormatException)
        {
            return value;
        }
    }
}
