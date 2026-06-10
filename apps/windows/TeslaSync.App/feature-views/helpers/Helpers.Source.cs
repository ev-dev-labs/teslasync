using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The semantic tone a status string maps to for colour / icon / foreground purposes — the native
/// classification behind the web <c>getStatusColor</c> / <c>statusTextClass</c> / <c>getStatusIcon</c>
/// helpers (web/src/features/system/components/status/helpers.tsx). The three web helpers share one
/// vocabulary (their "green" set includes <c>connected</c>); <see cref="StatusBadgeVariant"/> is kept
/// separate because the web <c>statusToBadgeVariant</c> uses a deliberately different "success" set.
/// </summary>
public enum StatusColorTone
{
    /// <summary>Healthy / ok / online / connected / ready / sent / completed — the web green (#22c55e).</summary>
    Success,

    /// <summary>Degraded / warning / pending / queued / processing — the web amber (#f59e0b).</summary>
    Warning,

    /// <summary>Unhealthy / offline / error / down / failed — the web red (#ef4444).</summary>
    Danger,

    /// <summary>Anything unrecognised (or null/empty) — the web muted grey (#6b7280).</summary>
    Neutral,
}

/// <summary>
/// The badge tone a status string maps to — the native union mirroring the web
/// <c>statusToBadgeVariant</c> return type (<c>'success' | 'warning' | 'danger' | 'neutral'</c>). Note the
/// web source's "success" set here intentionally OMITS <c>connected</c> (unlike the colour / icon / text
/// helpers), so <c>connected</c> renders a green dot but a neutral badge — a quirk reproduced verbatim by
/// <see cref="StatusHelpers.BadgeVariant(string)"/>.
/// </summary>
public enum StatusBadgeVariant
{
    /// <summary>Healthy / ok / online / ready / sent / completed (NOT connected).</summary>
    Success,

    /// <summary>Degraded / warning / pending / queued / processing.</summary>
    Warning,

    /// <summary>Unhealthy / offline / error / down / failed.</summary>
    Danger,

    /// <summary>Anything unrecognised (or null/empty).</summary>
    Neutral,
}

/// <summary>
/// The native, WinUI-free port of the web status presentation helpers
/// (web/src/features/system/components/status/helpers.tsx). The web module is a pure utility collection —
/// it exposes no React component, no hooks, no data sources and no render states — so this is a static
/// helper class rather than a feature view: the system-status sections (BackendStatusSection,
/// DataPipelineSection, HealthProbesSection, OperationsSection) compose their pills, icons and badges from
/// these helpers exactly as the web sections do.
/// <para>
/// Each web function is reproduced 1:1: <c>getStatusColor</c> → <see cref="StatusColorHex(string)"/>
/// (identical hex parity so chart/legend colours match the web byte-for-byte), <c>statusTextClass</c> →
/// <see cref="StatusForegroundBrushKey(string)"/> (the web Tailwind class is replaced by the equivalent
/// platform token brush key per the Windows guideline to theme through tokens, never web classes),
/// <c>getStatusIcon</c> → <see cref="StatusGlyph(string)"/> (the web lucide icon becomes the matching
/// Segoe Fluent glyph), <c>formatUptime</c> → <see cref="FormatUptime(double)"/>, <c>formatBytes</c> →
/// <see cref="FormatBytes(double)"/> (through <see cref="NumberFormatting"/>, the byte-exact
/// <c>fmtNumber</c> port), and <c>statusToBadgeVariant</c> → <see cref="BadgeVariant(string)"/>.
/// </para>
/// The status vocabulary is matched case-insensitively (the web lower-cases the input first); the unit
/// symbols (<c>d</c>/<c>h</c>/<c>m</c> and <c>B</c>/<c>KB</c>/<c>MB</c>/<c>GB</c>/<c>TB</c>) are the same
/// locale-neutral symbols the web source hard-codes, so there are no translatable strings to route through
/// the i18n facade. UI-free so every branch is unit-tested without a XAML host.
/// </summary>
public static class StatusHelpers
{
    /// <summary>Web success hex (<c>#22c55e</c>) — lucide green-500.</summary>
    public const string SuccessHex = "#22c55e";

    /// <summary>Web warning hex (<c>#f59e0b</c>) — lucide amber-500.</summary>
    public const string WarningHex = "#f59e0b";

    /// <summary>Web danger hex (<c>#ef4444</c>) — lucide red-500.</summary>
    public const string DangerHex = "#ef4444";

    /// <summary>Web neutral hex (<c>#6b7280</c>) — lucide gray-500 (the default branch).</summary>
    public const string NeutralHex = "#6b7280";

    /// <summary>Token brush key for the success tone (web <c>text-green-400</c>).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the warning tone (web <c>text-amber-400</c>).</summary>
    public const string WarningBrushKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the danger tone (web <c>text-red-400</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the neutral tone (web <c>text-[var(--text-muted)]</c>).</summary>
    public const string NeutralBrushKey = "TsColorTextMutedBrush";

    /// <summary>Segoe Fluent "Completed" glyph — the web lucide <c>CheckCircle</c> (success).</summary>
    public const string SuccessGlyph = "\uE930";

    /// <summary>Segoe Fluent "Warning" glyph — the web lucide <c>AlertTriangle</c> (warning + default).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "ErrorBadge" glyph — the web lucide <c>XCircle</c> (danger).</summary>
    public const string DangerGlyph = "\uEA39";

    private const string DayUnit = "d";
    private const string HourUnit = "h";
    private const string MinuteUnit = "m";

    private const double SecondsPerDay = 86400.0;
    private const double SecondsPerHour = 3600.0;
    private const double SecondsPerMinute = 60.0;

    private const double BytesPerUnit = 1024.0;

    // Web `sizes` array; index drives both the divisor and the suffix.
    private static readonly string[] ByteUnits = ["B", "KB", "MB", "GB", "TB"];

    // Web "green" set shared by getStatusColor / statusTextClass / getStatusIcon — includes "connected".
    private static readonly HashSet<string> SuccessTones = new(StringComparer.OrdinalIgnoreCase)
    {
        "healthy", "ok", "online", "connected", "ready", "sent", "completed",
    };

    // Web "amber" set shared by getStatusColor / statusTextClass / getStatusIcon (== the badge warning set).
    private static readonly HashSet<string> WarningTones = new(StringComparer.OrdinalIgnoreCase)
    {
        "degraded", "warning", "pending", "queued", "processing",
    };

    // Web "red" set shared by getStatusColor / statusTextClass / getStatusIcon (== the badge danger set).
    private static readonly HashSet<string> DangerTones = new(StringComparer.OrdinalIgnoreCase)
    {
        "unhealthy", "offline", "error", "down", "failed",
    };

    // Web statusToBadgeVariant "success" set — DELIBERATELY omits "connected" (parity quirk, see the enum).
    private static readonly HashSet<string> SuccessBadgeStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "healthy", "ok", "online", "ready", "sent", "completed",
    };

    /// <summary>
    /// Classify a status string into its colour/icon/text tone — the shared switch behind
    /// <c>getStatusColor</c> / <c>statusTextClass</c> / <c>getStatusIcon</c>. Matching is case-insensitive
    /// (the web lower-cases first); a null, empty or unrecognised status is <see cref="StatusColorTone.Neutral"/>.
    /// </summary>
    /// <param name="status">The wire status string (may be null).</param>
    public static StatusColorTone Classify(string? status)
    {
        string value = status ?? string.Empty;
        if (SuccessTones.Contains(value))
        {
            return StatusColorTone.Success;
        }

        if (WarningTones.Contains(value))
        {
            return StatusColorTone.Warning;
        }

        if (DangerTones.Contains(value))
        {
            return StatusColorTone.Danger;
        }

        return StatusColorTone.Neutral;
    }

    /// <summary>
    /// The accent hex for a status — the parity port of web <c>getStatusColor</c>. Returns the exact lucide
    /// hex (<see cref="SuccessHex"/> / <see cref="WarningHex"/> / <see cref="DangerHex"/> /
    /// <see cref="NeutralHex"/>) so any value rendered through this helper matches the web pixel-for-pixel.
    /// </summary>
    /// <param name="status">The wire status string (may be null).</param>
    public static string StatusColorHex(string? status) => Classify(status) switch
    {
        StatusColorTone.Success => SuccessHex,
        StatusColorTone.Warning => WarningHex,
        StatusColorTone.Danger => DangerHex,
        _ => NeutralHex,
    };

    /// <summary>
    /// The token brush key for a status — the native port of web <c>statusTextClass</c>. The web returns a
    /// Tailwind class (<c>text-green-400</c> …, default <c>text-[var(--text-muted)]</c>); per the Windows
    /// guideline the native surface themes through token brushes, so this returns the equivalent token key
    /// (<see cref="SuccessBrushKey"/> / <see cref="WarningBrushKey"/> / <see cref="DangerBrushKey"/> /
    /// <see cref="NeutralBrushKey"/>) which stays legible under light theme and forced-colors.
    /// </summary>
    /// <param name="status">The wire status string (may be null).</param>
    public static string StatusForegroundBrushKey(string? status) => Classify(status) switch
    {
        StatusColorTone.Success => SuccessBrushKey,
        StatusColorTone.Warning => WarningBrushKey,
        StatusColorTone.Danger => DangerBrushKey,
        _ => NeutralBrushKey,
    };

    /// <summary>
    /// The Segoe Fluent glyph for a status — the native port of web <c>getStatusIcon</c>. Success maps to
    /// the check glyph (web <c>CheckCircle</c>), danger to the error-badge glyph (web <c>XCircle</c>), and
    /// both warning AND the default branch map to the warning-triangle glyph (the web default returns an
    /// <c>AlertTriangle</c>, tinted with the muted colour) — pair this with
    /// <see cref="StatusForegroundBrushKey(string)"/> for the matching tint.
    /// </summary>
    /// <param name="status">The wire status string (may be null).</param>
    public static string StatusGlyph(string? status) => Classify(status) switch
    {
        StatusColorTone.Success => SuccessGlyph,
        StatusColorTone.Danger => DangerGlyph,
        // Warning and the neutral/default branch both use the AlertTriangle glyph (web parity).
        _ => WarningGlyph,
    };

    /// <summary>
    /// Map a status to its badge tone — the parity port of web <c>statusToBadgeVariant</c>. The "success"
    /// set here intentionally omits <c>connected</c> (a web quirk faithfully reproduced), so <c>connected</c>
    /// yields <see cref="StatusBadgeVariant.Neutral"/> even though it is green for colour/icon/text.
    /// </summary>
    /// <param name="status">The wire status string (may be null).</param>
    public static StatusBadgeVariant BadgeVariant(string? status)
    {
        string value = status ?? string.Empty;
        if (SuccessBadgeStatuses.Contains(value))
        {
            return StatusBadgeVariant.Success;
        }

        if (WarningTones.Contains(value))
        {
            return StatusBadgeVariant.Warning;
        }

        if (DangerTones.Contains(value))
        {
            return StatusBadgeVariant.Danger;
        }

        return StatusBadgeVariant.Neutral;
    }

    /// <summary>
    /// Format an uptime in seconds as <c>"{d}d {h}h {m}m"</c> — the parity port of web <c>formatUptime</c>.
    /// Days are dropped when zero and hours are dropped when both days and hours are zero (so a sub-hour
    /// uptime renders just <c>"{m}m"</c>), matching the web cascade exactly. A non-finite or negative input
    /// (outside the web domain of a non-negative finite uptime) is hardened to <c>"0m"</c> rather than the
    /// web's NaN/negative string leakage.
    /// </summary>
    /// <param name="seconds">The uptime in seconds.</param>
    public static string FormatUptime(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds < 0)
        {
            return $"0{MinuteUnit}";
        }

        long days = (long)Math.Floor(seconds / SecondsPerDay);
        long hours = (long)Math.Floor(seconds % SecondsPerDay / SecondsPerHour);
        long mins = (long)Math.Floor(seconds % SecondsPerHour / SecondsPerMinute);

        if (days > 0)
        {
            return $"{days}{DayUnit} {hours}{HourUnit} {mins}{MinuteUnit}";
        }

        if (hours > 0)
        {
            return $"{hours}{HourUnit} {mins}{MinuteUnit}";
        }

        return $"{mins}{MinuteUnit}";
    }

    /// <summary>
    /// Format a byte count with binary units — the parity port of web <c>formatBytes</c>. Zero renders as
    /// <c>"0 B"</c>; otherwise the magnitude is bucketed by <c>floor(log(bytes)/log(1024))</c> and formatted
    /// to one fraction digit through <see cref="NumberFormatting"/> (the byte-exact <c>fmtNumber</c> port,
    /// so grouping such as <c>"1,023.0 B"</c> matches the web). The bucket index is clamped to the unit
    /// ladder so a petabyte-scale value renders in <c>TB</c> instead of the web's out-of-range
    /// <c>"undefined"</c>, and a non-finite input is hardened to <c>"0 B"</c>.
    /// </summary>
    /// <param name="bytes">The byte count.</param>
    public static string FormatBytes(double bytes)
    {
        if (bytes == 0 || !double.IsFinite(bytes))
        {
            return $"0 {ByteUnits[0]}";
        }

        int index = (int)Math.Floor(Math.Log(bytes) / Math.Log(BytesPerUnit));
        index = Math.Clamp(index, 0, ByteUnits.Length - 1);

        double magnitude = bytes / Math.Pow(BytesPerUnit, index);
        return $"{NumberFormatting.Format(magnitude, null, 1)} {ByteUnits[index]}";
    }
}

/// <summary>
/// Canonical metadata for the status <c>helpers</c> surface — the native mirror of the web module at
/// <c>web/src/features/system/components/status/helpers.tsx</c>.
/// </summary>
public static class HelpersRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "helpers";
}

/// <summary>
/// PII-safe diagnostics for the status <c>helpers</c> surface (P1/S11 diagnostics contract). A consuming
/// status section calls <see cref="RecordViewOpened"/> when it mounts; the collector emits only the
/// operational <c>view.opened slug=helpers</c> line — never a status value or any payload — so a diagnostics
/// line can never leak operational data. Thread-safe.
/// </summary>
public sealed class HelpersDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to (null for a counter-only collector).</param>
    public HelpersDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times a surface backed by these helpers has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=helpers</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HelpersRegistration.Slug}");
    }
}
