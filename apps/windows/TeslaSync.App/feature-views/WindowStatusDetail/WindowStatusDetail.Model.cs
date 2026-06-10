using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SecurityAccess;

/// <summary>
/// The resolved state of one Tesla window — the native analogue of the web <c>WindowState</c> union
/// (<c>'Closed' | 'Venting' | 'Open' | 'Unknown'</c> in
/// <c>web/src/features/admin/components/security-access/helpers.ts</c>). Drives the panel's accent colour and
/// the localized state caption.
/// </summary>
public enum WindowState
{
    /// <summary>The window is fully closed (web <c>'Closed'</c>) — the "secure" green tier.</summary>
    Closed,

    /// <summary>The window is cracked for ventilation (web <c>'Venting'</c>) — the amber warning tier.</summary>
    Venting,

    /// <summary>The window is open (web <c>'Open'</c>) — the red danger tier.</summary>
    Open,

    /// <summary>The window state is unknown / unreported (web <c>'Unknown'</c>) — the muted neutral tier.</summary>
    Unknown,
}

/// <summary>
/// The render-time data model the <c>WindowStatusDetail</c> surface binds to — the native analogue of the web
/// component's prop (<c>latest: SecurityEvent | undefined</c> in
/// <c>web/src/features/admin/components/security-access/WindowStatusDetail.tsx</c>), narrowed to the four raw
/// window fields the card actually reads (<c>fd/fp/rd/rpWindow</c>). Each field mirrors the web wire union
/// <c>string | boolean | null</c>, so it is typed as <see cref="object"/>? and run through the same
/// <c>parseWindowState</c> coercion the web helper applies; a missing <c>latest</c> maps to
/// <see cref="Empty"/> (all four <see langword="null"/>), exactly as the web optional chaining
/// (<c>latest?.[win.key]</c>) yields <see langword="undefined"/> for every slot. The web card is purely
/// presentational — the hosting Security &amp; Access page owns all fetching (loading / empty / error / stale
/// / offline live on the parent, which re-renders this surface with already-resolved props), so this model
/// performs no fetching. Pure data, no WinUI types, so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="FrontDriver">The front-driver window raw value (web <c>latest.fdWindow</c>).</param>
/// <param name="FrontPassenger">The front-passenger window raw value (web <c>latest.fpWindow</c>).</param>
/// <param name="RearDriver">The rear-driver window raw value (web <c>latest.rdWindow</c>).</param>
/// <param name="RearPassenger">The rear-passenger window raw value (web <c>latest.rpWindow</c>).</param>
public sealed record WindowStatusDetailModel(
    object? FrontDriver,
    object? FrontPassenger,
    object? RearDriver,
    object? RearPassenger)
{
    /// <summary>
    /// The no-data model — every window slot <see langword="null"/>, the native analogue of an
    /// <see langword="undefined"/> <c>latest</c> on the web (every panel resolves to
    /// <see cref="WindowState.Unknown"/>).
    /// </summary>
    public static WindowStatusDetailModel Empty { get; } = new(null, null, null, null);
}

/// <summary>
/// The fully projected, render-ready view of a single window panel — the native analogue of one
/// <c>WINDOW_KEYS.map(...)</c> cell in the web source. Every value the web cell derives is resolved here: the
/// parsed <see cref="State"/> (web <c>parseWindowState</c>), the localized <see cref="Label"/> (web
/// <c>t(win.i18nKey, win.fallback)</c>), the localized <see cref="StateText"/> (web
/// <c>t('admin.security.windowState.…', state)</c>), the token-backed <see cref="AccentBrushKey"/> (web
/// <c>windowColor</c> / <c>windowTextClass</c>) and the composed Narrator name. Pure data so every branch is
/// asserted headlessly.
/// </summary>
/// <param name="State">The parsed window state.</param>
/// <param name="Label">The localized window label (e.g. "Front Driver").</param>
/// <param name="StateText">The localized state caption (e.g. "Closed").</param>
/// <param name="AccentBrushKey">The generated design-token brush key the state tints to.</param>
/// <param name="AutomationName">The composed Narrator name for the panel ("Label: StateText").</param>
public sealed record WindowPanelDisplay(
    WindowState State,
    string Label,
    string StateText,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the whole <c>WindowStatusDetail</c> surface — the localized
/// <see cref="Title"/> (web <c>t('admin.security.windowDetail', 'Window Status Detail')</c>) and the four
/// window <see cref="Panels"/> in the web's <c>WINDOW_KEYS</c> order (front-driver, front-passenger,
/// rear-driver, rear-passenger). Pure data so every value is asserted without a UI host.
/// </summary>
/// <param name="Title">The localized section title.</param>
/// <param name="Panels">The four window panels, front-driver first (web <c>WINDOW_KEYS</c> order).</param>
public sealed record WindowStatusDetailDisplay(string Title, IReadOnlyList<WindowPanelDisplay> Panels);

/// <summary>
/// Pure projection from a <see cref="WindowStatusDetailModel"/> to its <see cref="WindowStatusDetailDisplay"/>
/// — the native port of <c>web/src/features/admin/components/security-access/WindowStatusDetail.tsx</c> and its
/// <c>helpers.ts</c>. Reproduces the web derivations exactly: <see cref="ParseWindowState"/> mirrors
/// <c>parseWindowState</c> (the <c>asNonEmptyString</c> guard so non-string / empty values are
/// <see cref="WindowState.Unknown"/>, then the <c>'closed'</c>/<c>'0'</c> → vent → open ladder);
/// <see cref="AccentBrushKey"/> mirrors <c>windowColor</c> / <c>windowTextClass</c> (green / amber / red /
/// muted) mapped onto the generated token brushes; and every label flows through the i18n facade using the
/// exact catalog keys + English fallbacks the web feeds into <c>t()</c>. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class WindowStatusDetailProjection
{
    /// <summary>i18n key for the section title (web <c>t('admin.security.windowDetail', …)</c>).</summary>
    public const string TitleKey = "translation.admin.security.windowDetail";

    /// <summary>English fallback for <see cref="TitleKey"/> (matches the web default).</summary>
    public const string TitleFallback = "Window Status Detail";

    /// <summary>i18n key for the front-driver window label (web <c>'admin.security.window.fd'</c>).</summary>
    public const string FrontDriverKey = "translation.admin.security.window.fd";

    /// <summary>i18n key for the front-passenger window label (web <c>'admin.security.window.fp'</c>).</summary>
    public const string FrontPassengerKey = "translation.admin.security.window.fp";

    /// <summary>i18n key for the rear-driver window label (web <c>'admin.security.window.rd'</c>).</summary>
    public const string RearDriverKey = "translation.admin.security.window.rd";

    /// <summary>i18n key for the rear-passenger window label (web <c>'admin.security.window.rp'</c>).</summary>
    public const string RearPassengerKey = "translation.admin.security.window.rp";

    /// <summary>English fallback for <see cref="FrontDriverKey"/> (matches the web <c>WINDOW_KEYS</c> fallback).</summary>
    public const string FrontDriverFallback = "Front Driver";

    /// <summary>English fallback for <see cref="FrontPassengerKey"/> (matches the web <c>WINDOW_KEYS</c> fallback).</summary>
    public const string FrontPassengerFallback = "Front Passenger";

    /// <summary>English fallback for <see cref="RearDriverKey"/> (matches the web <c>WINDOW_KEYS</c> fallback).</summary>
    public const string RearDriverFallback = "Rear Driver";

    /// <summary>English fallback for <see cref="RearPassengerKey"/> (matches the web <c>WINDOW_KEYS</c> fallback).</summary>
    public const string RearPassengerFallback = "Rear Passenger";

    /// <summary>The <c>admin.security.windowState.*</c> key prefix the state caption resolves under (web template literal).</summary>
    public const string StateKeyPrefix = "translation.admin.security.windowState.";

    /// <summary>Token brush key for the <see cref="WindowState.Closed"/> tier (web <c>bg/border/text-green</c>).</summary>
    public const string ClosedBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the <see cref="WindowState.Venting"/> tier (web <c>bg/border/text-amber</c>).</summary>
    public const string VentingBrushKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the <see cref="WindowState.Open"/> tier (web <c>bg/border/text-red</c>).</summary>
    public const string OpenBrushKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the <see cref="WindowState.Unknown"/> tier (web <c>bg/border-gray</c>, <c>text-[var(--text-muted)]</c>).</summary>
    public const string UnknownBrushKey = "TsColorTextMutedBrush";

    /// <summary>
    /// Parse a raw window value into a <see cref="WindowState"/>, mirroring the web <c>parseWindowState</c>
    /// verbatim. The web first applies <c>asNonEmptyString</c> (a value is kept only when it is a non-empty
    /// string), so <see langword="null"/>, booleans and the empty string all fall through to
    /// <see cref="WindowState.Unknown"/>. A non-empty string is lower-cased and matched: <c>"closed"</c> or
    /// <c>"0"</c> → <see cref="WindowState.Closed"/>; containing <c>"vent"</c> → <see cref="WindowState.Venting"/>;
    /// anything else → <see cref="WindowState.Open"/> (the web's final <c>includes('open') || lower !== '0'</c>
    /// is always true for the strings that reach it, so the trailing <c>'Unknown'</c> is unreachable for
    /// non-empty strings — preserved here for exact parity).
    /// </summary>
    /// <param name="value">The raw window value (web <c>string | boolean | null</c>).</param>
    public static WindowState ParseWindowState(object? value)
    {
        string? raw = AsNonEmptyString(value);
        if (raw is null)
        {
            return WindowState.Unknown;
        }

        string lower = raw.ToLowerInvariant();
        if (lower is "closed" or "0")
        {
            return WindowState.Closed;
        }

        if (lower.Contains("vent", StringComparison.Ordinal))
        {
            return WindowState.Venting;
        }

        if (lower.Contains("open", StringComparison.Ordinal) || lower != "0")
        {
            return WindowState.Open;
        }

        return WindowState.Unknown;
    }

    /// <summary>
    /// The generated token brush key a window state tints to, mirroring the web <c>windowColor</c> /
    /// <c>windowTextClass</c> traffic-light: closed → success (green), venting → warning (amber), open →
    /// danger (red), unknown → muted (gray).
    /// </summary>
    public static string AccentBrushKey(WindowState state) => state switch
    {
        WindowState.Closed => ClosedBrushKey,
        WindowState.Venting => VentingBrushKey,
        WindowState.Open => OpenBrushKey,
        _ => UnknownBrushKey,
    };

    /// <summary>
    /// The i18n catalog key for a state caption, mirroring the web template literal
    /// <c>`admin.security.windowState.${state.toLowerCase()}`</c>.
    /// </summary>
    public static string StateKey(WindowState state) => StateKeyPrefix + StateFallback(state).ToLowerInvariant();

    /// <summary>
    /// The English fallback for a state caption — the web passes the raw <c>WindowState</c> string as the
    /// <c>t()</c> default, so the fallback is the title-cased state name ("Closed" / "Venting" / "Open" /
    /// "Unknown").
    /// </summary>
    public static string StateFallback(WindowState state) => state switch
    {
        WindowState.Closed => "Closed",
        WindowState.Venting => "Venting",
        WindowState.Open => "Open",
        _ => "Unknown",
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time window data (the web <c>latest</c> prop, narrowed).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    public static WindowStatusDetailDisplay Project(WindowStatusDetailModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var panels = new[]
        {
            ProjectPanel(model.FrontDriver, FrontDriverKey, FrontDriverFallback, localizer),
            ProjectPanel(model.FrontPassenger, FrontPassengerKey, FrontPassengerFallback, localizer),
            ProjectPanel(model.RearDriver, RearDriverKey, RearDriverFallback, localizer),
            ProjectPanel(model.RearPassenger, RearPassengerKey, RearPassengerFallback, localizer),
        };

        return new WindowStatusDetailDisplay(
            Title: localizer.GetString(TitleKey, TitleFallback),
            Panels: panels);
    }

    private static WindowPanelDisplay ProjectPanel(
        object? raw,
        string labelKey,
        string labelFallback,
        ILocalizer localizer)
    {
        WindowState state = ParseWindowState(raw);
        string label = localizer.GetString(labelKey, labelFallback);
        string stateText = localizer.GetString(StateKey(state), StateFallback(state));

        return new WindowPanelDisplay(
            State: state,
            Label: label,
            StateText: stateText,
            AccentBrushKey: AccentBrushKey(state),
            AutomationName: string.Concat(label, ": ", stateText));
    }

    // Web `asNonEmptyString`: keep the value only when it is a non-empty string; everything else is null.
    private static string? AsNonEmptyString(object? v) => v is string s && s.Length > 0 ? s : null;
}

/// <summary>
/// PII-safe diagnostics for the <c>WindowStatusDetail</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a window value or vehicle state — so
/// a diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class WindowStatusDetailDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WindowStatusDetailDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WindowStatusDetail</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WindowStatusDetailRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>WindowStatusDetail</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/security-access/WindowStatusDetail.tsx</c>: the stable
/// diagnostics slug. UI-free so the metadata is asserted in tests.
/// </summary>
public static class WindowStatusDetailRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WindowStatusDetail";
}
