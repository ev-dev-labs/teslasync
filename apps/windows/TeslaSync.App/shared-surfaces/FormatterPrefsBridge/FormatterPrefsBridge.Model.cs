using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the formatter-preferences bridge surface — the native mirror of the web
/// <c>FormatterPrefsBridge</c> component (web/src/components/FormatterPrefsBridge.tsx). The web component is
/// anonymous and renders <see langword="null"/>: it has no titles, labels or i18n keys of its own (there are
/// none to extract), only the diagnostics slug and the locale/precision contract it keeps in sync. This holder
/// carries the slug emitted with the <c>view.opened</c> event, the formatter defaults (the web
/// <c>numberFormat</c> module defaults — locale <c>en-US</c>, precision <c>2</c>, the <c>0..20</c> precision
/// clamp), the settings-document JSON keys the data adapter reads (<c>locale</c> + <c>decimal_precision</c>),
/// and the <see cref="ResolveLocale"/> / <see cref="ClampPrecision"/> helpers that reproduce the web
/// <c>resolveLocale</c> (lib/locale.ts) and <c>setGlobalPrecision</c> clamp (lib/numberFormat.ts). Every member
/// is WinUI-free so the registration is asserted headlessly without a XAML host.
/// </summary>
public static class FormatterPrefsBridgeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FormatterPrefsBridge";

    /// <summary>The default BCP-47 locale (web <c>numberFormat._globalLocale</c> default, and the blank fallback).</summary>
    public const string DefaultLocale = "en-US";

    /// <summary>The default decimal precision applied when settings carry none (web <c>settings.decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>The smallest precision the formatter globals accept (web <c>Math.max(0, ...)</c>).</summary>
    public const int MinPrecision = 0;

    /// <summary>The largest precision the formatter globals accept (web <c>Math.min(20, ...)</c>).</summary>
    public const int MaxPrecision = 20;

    /// <summary>The settings-document key carrying the BCP-47 locale tag (web <c>settings.locale</c>).</summary>
    public const string LocaleKey = "locale";

    /// <summary>The settings-document key carrying the decimal precision (web <c>settings.decimal_precision</c>).</summary>
    public const string DecimalPrecisionKey = "decimal_precision";

    /// <summary>
    /// Resolve a raw settings locale to a usable BCP-47 tag — the native port of the web <c>resolveLocale</c>
    /// (web/src/lib/locale.ts). A null, empty or whitespace-only value degrades to <see cref="DefaultLocale"/>
    /// (the web guard against <c>Intl.NumberFormat('')</c> throwing), otherwise the trimmed tag is returned.
    /// </summary>
    /// <param name="locale">The raw locale from settings (web <c>settings.locale</c>), which may be null or blank.</param>
    /// <returns>A non-empty BCP-47 locale tag.</returns>
    public static string ResolveLocale(string? locale) =>
        string.IsNullOrWhiteSpace(locale) ? DefaultLocale : locale.Trim();

    /// <summary>
    /// Clamp a precision to the formatter-globals range — the native port of the web
    /// <c>setGlobalPrecision</c> bound (<c>Math.max(0, Math.min(20, decimals))</c>, web/src/lib/numberFormat.ts).
    /// </summary>
    /// <param name="precision">The requested precision (web <c>decimals</c>), which may be out of range.</param>
    /// <returns>The precision clamped to <see cref="MinPrecision"/>..<see cref="MaxPrecision"/>.</returns>
    public static int ClampPrecision(int precision) =>
        Math.Clamp(precision, MinPrecision, MaxPrecision);
}

/// <summary>
/// The resolved formatter preferences the bridge applies to the formatter globals — the native projection of the
/// two fields the web <c>FormatterPrefsBridge</c> reads off the settings query: the BCP-47 locale
/// (already run through <see cref="FormatterPrefsBridgeRegistration.ResolveLocale"/>, web <c>resolveLocale</c>)
/// and the decimal precision (web <c>settings.decimal_precision ?? 2</c>). The precision is carried verbatim
/// (the web <c>decimals</c> value before <c>setGlobalPrecision</c>'s clamp), so the bridge's de-dupe compares the
/// same value the web effect compares; clamping happens at the store boundary (<see cref="FormatterPrefsStore"/>),
/// exactly as the web clamps only inside <c>setGlobalPrecision</c>. Pure value record — unit-tested without a UI
/// host. A snapshot is the resolved data; the <em>absence</em> of one (a null source <c>Current</c>) models the
/// web <c>settings === undefined</c> branch where the effect returns early and applies nothing.
/// </summary>
/// <param name="Locale">The resolved BCP-47 locale tag (never blank).</param>
/// <param name="Precision">The requested decimal precision (web <c>decimals</c>; clamped only when stored).</param>
public sealed record FormatterPrefsSnapshot(string Locale, int Precision)
{
    /// <summary>The formatter defaults used before any settings resolve (web <c>en-US</c> + precision <c>2</c>).</summary>
    public static FormatterPrefsSnapshot Default { get; } =
        new(FormatterPrefsBridgeRegistration.DefaultLocale, FormatterPrefsBridgeRegistration.DefaultPrecision);

    /// <summary>
    /// Project a raw settings locale + precision into a snapshot — the native analogue of the web effect's
    /// <c>const locale = resolveLocale(settings.locale)</c> and <c>const decimals = settings.decimal_precision ?? 2</c>.
    /// The locale is resolved (blank → <c>en-US</c>); the precision falls back to
    /// <see cref="FormatterPrefsBridgeRegistration.DefaultPrecision"/> when absent and is otherwise carried
    /// verbatim (clamped later at the store boundary).
    /// </summary>
    /// <param name="rawLocale">The settings locale (web <c>settings.locale</c>); may be null or blank.</param>
    /// <param name="rawPrecision">The settings precision (web <c>settings.decimal_precision</c>); null when absent.</param>
    /// <returns>The resolved snapshot.</returns>
    public static FormatterPrefsSnapshot FromSettings(string? rawLocale, int? rawPrecision) =>
        new(
            FormatterPrefsBridgeRegistration.ResolveLocale(rawLocale),
            rawPrecision ?? FormatterPrefsBridgeRegistration.DefaultPrecision);

    /// <summary>
    /// Project a settings document into a snapshot — the data adapter for the web <c>useSettings</c> query
    /// payload. Reads the <c>locale</c> string and the <c>decimal_precision</c> number (tolerating a numeric
    /// string, exactly like the web settings page), then defers to <see cref="FromSettings"/>. A non-object
    /// element (or one missing both keys) yields <see cref="Default"/>, the same values the web globals start at.
    /// </summary>
    /// <param name="settings">The settings document (web <c>AppSettings</c> JSON from <c>GET /settings</c>).</param>
    /// <returns>The resolved snapshot.</returns>
    public static FormatterPrefsSnapshot FromJson(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object)
        {
            return Default;
        }

        return FromSettings(
            ReadLocale(settings),
            ReadPrecision(settings));
    }

    private static string? ReadLocale(JsonElement settings) =>
        settings.TryGetProperty(FormatterPrefsBridgeRegistration.LocaleKey, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? ReadPrecision(JsonElement settings)
    {
        if (!settings.TryGetProperty(FormatterPrefsBridgeRegistration.DecimalPrecisionKey, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var i) => i,
            JsonValueKind.Number when value.TryGetDouble(out var d) => (int)d,
            JsonValueKind.String when int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// The process-wide formatter globals the bridge keeps in sync — the native analogue of the web
/// <c>numberFormat</c> module globals (<c>_globalLocale</c> / <c>_globalPrecision</c> with their
/// <c>setGlobalLocale</c> / <c>setGlobalPrecision</c> / <c>getGlobalLocale</c> / <c>getGlobalPrecision</c>
/// accessors, web/src/lib/numberFormat.ts). Where the web module is a singleton read by <c>fmtNumber</c> and
/// friends regardless of which page is mounted, this is the <see cref="Shared"/> singleton consumed by
/// <see cref="FormatNumber"/> and <see cref="ApplyTo"/>; an injected instance lets the bridge view-model be
/// exercised in isolation without touching the shared globals. Setting <see cref="Locale"/> clamps a blank tag to
/// <see cref="FormatterPrefsBridgeRegistration.DefaultLocale"/> and setting <see cref="Precision"/> clamps to
/// <c>0..20</c>, exactly like the web setters; <see cref="Changed"/> fires only when a write actually moves a
/// value. Thread-safe: the production bridge applies updates from the settings stream's pump thread while
/// formatters read on the UI thread.
/// </summary>
public interface IFormatterPrefsStore
{
    /// <summary>The current BCP-47 locale (web <c>getGlobalLocale()</c>); set clamps a blank tag to <c>en-US</c>.</summary>
    string Locale { get; set; }

    /// <summary>The current decimal precision (web <c>getGlobalPrecision()</c>); set clamps to <c>0..20</c>.</summary>
    int Precision { get; set; }

    /// <summary>Raised after a write moves <see cref="Locale"/> or <see cref="Precision"/>; may fire off the UI thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Format a number with the current globals — the native analogue of the web <c>fmtNumber</c> reading
    /// <c>_globalLocale</c> / <c>_globalPrecision</c>. The per-call overrides mirror <c>fmtNumber(v, decimals, locale)</c>.
    /// </summary>
    /// <param name="value">The value to format.</param>
    /// <param name="decimals">Optional fraction-digit override; the current <see cref="Precision"/> when null.</param>
    /// <param name="locale">Optional locale override; the current <see cref="Locale"/> when null.</param>
    /// <returns>The formatted number.</returns>
    string FormatNumber(double value, int? decimals = null, string? locale = null);

    /// <summary>
    /// Return a copy of <paramref name="basePref"/> carrying the current locale + precision — the bridge into the
    /// existing SI display formatters (<see cref="UnitFormatters"/> consume <see cref="UnitPref.Locale"/> /
    /// <see cref="UnitPref.Precision"/>), so the globals the bridge syncs flow through the same pipeline the web
    /// formatters use.
    /// </summary>
    /// <param name="basePref">The per-quantity unit choice to overlay the synced locale/precision onto.</param>
    /// <returns>A <see cref="UnitPref"/> with the current <see cref="Locale"/> and <see cref="Precision"/>.</returns>
    UnitPref ApplyTo(UnitPref basePref);
}

/// <inheritdoc cref="IFormatterPrefsStore" />
public sealed class FormatterPrefsStore : IFormatterPrefsStore
{
    private readonly object _gate = new();
    private string _locale = FormatterPrefsBridgeRegistration.DefaultLocale;
    private int _precision = FormatterPrefsBridgeRegistration.DefaultPrecision;

    /// <summary>
    /// The process-wide formatter globals (the web <c>numberFormat</c> module singleton). The production bridge
    /// keeps this in sync so direct formatter calls render at the user's locale/precision on every surface.
    /// </summary>
    public static FormatterPrefsStore Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string Locale
    {
        get
        {
            lock (_gate)
            {
                return _locale;
            }
        }

        set
        {
            var resolved = FormatterPrefsBridgeRegistration.ResolveLocale(value);
            lock (_gate)
            {
                if (string.Equals(_locale, resolved, StringComparison.Ordinal))
                {
                    return;
                }

                _locale = resolved;
            }

            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <inheritdoc />
    public int Precision
    {
        get
        {
            lock (_gate)
            {
                return _precision;
            }
        }

        set
        {
            var clamped = FormatterPrefsBridgeRegistration.ClampPrecision(value);
            lock (_gate)
            {
                if (_precision == clamped)
                {
                    return;
                }

                _precision = clamped;
            }

            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <inheritdoc />
    public string FormatNumber(double value, int? decimals = null, string? locale = null)
    {
        string resolvedLocale;
        int resolvedDigits;
        lock (_gate)
        {
            resolvedLocale = FormatterPrefsBridgeRegistration.ResolveLocale(locale ?? _locale);
            resolvedDigits = FormatterPrefsBridgeRegistration.ClampPrecision(decimals ?? _precision);
        }

        return NumberFormatting.Format(value, resolvedLocale, resolvedDigits);
    }

    /// <inheritdoc />
    public UnitPref ApplyTo(UnitPref basePref)
    {
        ArgumentNullException.ThrowIfNull(basePref);
        lock (_gate)
        {
            return basePref with { Locale = _locale, Precision = _precision };
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the formatter-preferences bridge surface (P1/S11 diagnostics contract). The bridge
/// carries no user content — it only mirrors locale + precision into the formatter globals — so the collector
/// records only the operational <c>view.opened</c> event with the surface slug, never the locale, precision or
/// any settings value. Thread-safe.
/// </summary>
public sealed class FormatterPrefsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink; null in headless callers that only count opens.</param>
    public FormatterPrefsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FormatterPrefsBridge</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FormatterPrefsBridgeRegistration.Slug}");
    }
}
