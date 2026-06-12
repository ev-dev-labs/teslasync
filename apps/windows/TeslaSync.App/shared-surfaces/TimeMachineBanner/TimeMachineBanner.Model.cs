using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The branch the <c>TimeMachineBanner</c> actually renders — the honest union of the web component's render gates
/// (web/src/components/feedback/TimeMachineBanner.tsx L107-126). The web banner has no network read of its own (it
/// reads URL-mounted state), so it has no loading / error / stale / offline chrome; a still-unresolved or malformed
/// anchor simply collapses to live mode. The visible branches the web actually has are reproduced in full here.
/// </summary>
public enum TimeMachineBannerMode
{
    /// <summary>Live mode with the picker closed — the banner is invisible (web <c>asOf == null &amp;&amp; !pickerOpen</c> → null).</summary>
    Hidden,

    /// <summary>Live mode with the picker open from the command palette — the "pick a point in time" prompt shows.</summary>
    LivePrompt,

    /// <summary>An anchor is set — the read-only "viewing data as of …" historical notice shows.</summary>
    Historical,
}

/// <summary>
/// Canonical metadata for the <c>TimeMachineBanner</c> shared surface — the native analogue of the literals,
/// <c>data-testid</c>s and <c>t()</c> keys in web/src/components/feedback/TimeMachineBanner.tsx plus the URL-state
/// helpers in web/src/hooks/useAsOfDate.ts. Carries the diagnostics slug, the automation ids (mirroring the web
/// test ids), the ARIA role/live contract the wrapping <c>role="status" aria-live="polite"</c> div declares, the
/// semantic <see cref="CalloutVariant"/> (the web <c>variant="info"</c>), the Segoe Fluent glyphs standing in for
/// the web Lucide <c>History</c> / <c>Clock</c> marks, the eight i18n keys with the verbatim English fallbacks the
/// web <c>t()</c> calls render, and the pure RFC 3339 / draft / formatting helpers the projection and view-model
/// compose. UI-free so it is asserted headlessly.
/// </summary>
public static class TimeMachineBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TimeMachineBanner";

    /// <summary>Automation id of the banner root (web <c>data-testid="time-machine-banner"</c>).</summary>
    public const string BannerAutomationId = "time-machine-banner";

    /// <summary>Automation id of the body copy (web <c>data-testid="time-machine-banner-body"</c>).</summary>
    public const string BodyAutomationId = "time-machine-banner-body";

    /// <summary>Automation id of the "Pick a date" toggle (web <c>data-testid="time-machine-banner-pick"</c>).</summary>
    public const string PickAutomationId = "time-machine-banner-pick";

    /// <summary>Automation id of the "Return to live" action (web <c>data-testid="time-machine-banner-return"</c>).</summary>
    public const string ReturnAutomationId = "time-machine-banner-return";

    /// <summary>Automation id of the picker panel (web <c>data-testid="time-machine-banner-picker"</c>).</summary>
    public const string PickerAutomationId = "time-machine-banner-picker";

    /// <summary>Automation id of the date/time input (web <c>id</c>/<c>data-testid="time-machine-banner-input"</c>).</summary>
    public const string InputAutomationId = "time-machine-banner-input";

    /// <summary>Automation id of the "View as of date" submit (web <c>data-testid="time-machine-banner-submit"</c>).</summary>
    public const string SubmitAutomationId = "time-machine-banner-submit";

    /// <summary>Automation id of the "Cancel" action (web <c>data-testid="time-machine-banner-cancel"</c>).</summary>
    public const string CancelAutomationId = "time-machine-banner-cancel";

    /// <summary>ARIA role the wrapping div exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the banner declares — a polite, non-interrupting announcement (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The semantic emphasis the banner renders with — the web <c>&lt;AlertBanner variant="info"&gt;</c>.</summary>
    public const CalloutVariant Variant = CalloutVariant.Info;

    /// <summary>The Segoe Fluent "History" glyph the banner leads with (the native stand-in for the web Lucide <c>History</c>).</summary>
    public const string HistoryGlyph = "\uE81C";

    /// <summary>The Segoe Fluent "Clock" glyph on the "Pick a date" toggle (the native stand-in for the web Lucide <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE121";

    /// <summary>i18n key for the banner title (web <c>t('timeMachine.banner.title', …, { when })</c>).</summary>
    public const string TitleKey = "translation.timeMachine.banner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web literal with the .NET positional argument (<c>{0}</c>=when).</summary>
    public const string TitleFallback = "Viewing data as of {0}";

    /// <summary>i18n key for the historical body copy (web <c>t('timeMachine.banner.body', …)</c>).</summary>
    public const string BodyKey = "translation.timeMachine.banner.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web literal, verbatim.</summary>
    public const string BodyFallback = "Read-only point-in-time mode.";

    /// <summary>i18n key for the live-mode pick prompt (web <c>t('timeMachine.banner.pickPrompt', …)</c>).</summary>
    public const string PickPromptKey = "translation.timeMachine.banner.pickPrompt";

    /// <summary>English fallback for <see cref="PickPromptKey"/> — the web literal, verbatim.</summary>
    public const string PickPromptFallback = "Pick a point in time to view historical data.";

    /// <summary>i18n key for the "Pick a date" toggle label (web <c>t('timeMachine.banner.pick', …)</c>).</summary>
    public const string PickKey = "translation.timeMachine.banner.pick";

    /// <summary>English fallback for <see cref="PickKey"/> — the web literal, verbatim.</summary>
    public const string PickFallback = "Pick a date";

    /// <summary>i18n key for the "Return to live" action label (web <c>t('timeMachine.banner.returnToLive', …)</c>).</summary>
    public const string ReturnToLiveKey = "translation.timeMachine.banner.returnToLive";

    /// <summary>English fallback for <see cref="ReturnToLiveKey"/> — the web literal, verbatim.</summary>
    public const string ReturnToLiveFallback = "Return to live";

    /// <summary>i18n key for the "View as of date" submit label (web <c>t('timeMachine.banner.submit', …)</c>).</summary>
    public const string SubmitKey = "translation.timeMachine.banner.submit";

    /// <summary>English fallback for <see cref="SubmitKey"/> — the web literal, verbatim.</summary>
    public const string SubmitFallback = "View as of date";

    /// <summary>i18n key for the "Cancel" action label (web <c>t('timeMachine.banner.cancel', …)</c>).</summary>
    public const string CancelKey = "translation.timeMachine.banner.cancel";

    /// <summary>English fallback for <see cref="CancelKey"/> — the web literal, verbatim.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>i18n key for the date/time input label (web <c>t('timeMachine.banner.inputLabel', …)</c>).</summary>
    public const string InputLabelKey = "translation.timeMachine.banner.inputLabel";

    /// <summary>English fallback for <see cref="InputLabelKey"/> — the web literal, verbatim.</summary>
    public const string InputLabelFallback = "Date and time";

    private const string IsoMillisFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    private const string LocalDatetimeFormat = "yyyy-MM-dd'T'HH:mm:ss";

    private static readonly Regex Rfc3339Sniff = new(
        @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// Strict RFC 3339 sniff — the native port of the web <c>looksLikeIso</c> (useAsOfDate.ts L34-42): the value
    /// must match the RFC 3339 shape AND round-trip through the parser, so a well-formed-but-impossible date
    /// (e.g. 2024-02-31) is rejected exactly as <c>Date.parse</c> rejects it on the web.
    /// </summary>
    /// <param name="value">The candidate timestamp.</param>
    public static bool LooksLikeIso(string? value)
    {
        if (string.IsNullOrEmpty(value) || !Rfc3339Sniff.IsMatch(value))
        {
            return false;
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);
    }

    /// <summary>
    /// Normalize a raw anchor into a usable value or null — the native port of the web <c>useAsOfDate</c> parse +
    /// getter (useAsOfDate.ts L57, L81): null/empty and malformed values both collapse to null (live mode), a
    /// well-formed RFC 3339 value passes through unchanged.
    /// </summary>
    /// <param name="value">The raw anchor.</param>
    public static string? NormalizeAsOf(string? value) =>
        string.IsNullOrEmpty(value) ? null : LooksLikeIso(value) ? value : null;

    /// <summary>Parse a well-formed anchor to a <see cref="DateTimeOffset"/>; false (and default) when it is null/malformed.</summary>
    /// <param name="value">The candidate anchor.</param>
    /// <param name="instant">The parsed instant when the return is true.</param>
    public static bool TryParseAsOf(string? value, out DateTimeOffset instant)
    {
        instant = default;
        return LooksLikeIso(value)
            && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out instant);
    }

    /// <summary>
    /// Convert a local wall-clock instant to a UTC RFC 3339 string — the native port of the web
    /// <c>localInputToRfc3339</c> (TimeMachineBanner.tsx L53-61): the picked local instant is converted to UTC and
    /// emitted with millisecond precision and a trailing <c>Z</c> (JS <c>Date.toISOString()</c>). The result always
    /// satisfies <see cref="LooksLikeIso"/>.
    /// </summary>
    /// <param name="instant">The local wall-clock instant the user picked.</param>
    public static string LocalToRfc3339(DateTimeOffset instant) =>
        instant.ToUniversalTime().ToString(IsoMillisFormat, CultureInfo.InvariantCulture);

    /// <summary>
    /// Render an instant as the local <c>datetime-local</c> draft string — the native port of the web
    /// <c>toLocalDatetimeStr</c> (dateFormat.ts L340-343): the local wall-clock components, second-precision, no
    /// zone. Used to seed the picker from the current anchor or the default seed.
    /// </summary>
    /// <param name="instant">The instant to render in local wall-clock terms.</param>
    public static string ToLocalDatetimeStr(DateTimeOffset instant) =>
        instant.ToLocalTime().ToString(LocalDatetimeFormat, CultureInfo.InvariantCulture);

    /// <summary>
    /// The default picker seed — yesterday at local noon — the native port of the web command-palette seed
    /// (TimeMachineBanner.tsx L82-87): a sensible default that lands the user inside the supported lookback window
    /// without requiring a click.
    /// </summary>
    /// <param name="now">The current instant (injected for deterministic tests).</param>
    public static DateTimeOffset DefaultPickerSeed(DateTimeOffset now)
    {
        DateTime localNoonYesterday = now.ToLocalTime().Date.AddDays(-1).AddHours(12);
        return new DateTimeOffset(localNoonYesterday, TimeZoneInfo.Local.GetUtcOffset(localNoonYesterday));
    }

    /// <summary>
    /// Combine a picked calendar date and time-of-day into a single local instant — the native equivalent of the
    /// web <c>&lt;input type="datetime-local"&gt;</c> value (a date and a time read as one local wall-clock moment).
    /// </summary>
    /// <param name="date">The picked calendar date (its wall-clock day is used).</param>
    /// <param name="time">The picked time-of-day.</param>
    public static DateTimeOffset CombineDraft(DateTimeOffset date, TimeSpan time)
    {
        DateTime local = date.Date.Add(time);
        return new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), TimeZoneInfo.Local.GetUtcOffset(local));
    }

    /// <summary>
    /// The interpolation value for the title — the native port of the web <c>formatDateTime(effective)</c>
    /// (TimeMachineBanner.tsx L112-113): the anchor rendered in the shared full date+time format, or an empty
    /// string when there is no anchor (the web <c>effective != null ? … : ''</c>).
    /// </summary>
    /// <param name="asOf">The current anchor (RFC 3339), or null in live mode.</param>
    /// <param name="now">The current instant (only used by the relative tier; the full format is now-independent).</param>
    public static string FormatWhen(string? asOf, DateTimeOffset now) =>
        TryParseAsOf(asOf, out DateTimeOffset instant)
            ? DateTimeFormatting.Format(instant, DateTimeVariant.Full, now)
            : string.Empty;

    /// <summary>Resolve the localized title with the interpolated <paramref name="when"/> (web <c>timeMachine.banner.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="when">The already-formatted anchor (empty in live mode).</param>
    public static string ResolveTitle(ILocalizer localizer, string when)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.Format(CultureInfo.CurrentCulture, localizer.GetString(TitleKey, TitleFallback), when);
    }

    /// <summary>Resolve the localized historical body (web <c>timeMachine.banner.body</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveBody(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(BodyKey, BodyFallback);
    }

    /// <summary>Resolve the localized live-mode pick prompt (web <c>timeMachine.banner.pickPrompt</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolvePickPrompt(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PickPromptKey, PickPromptFallback);
    }

    /// <summary>Resolve the localized "Pick a date" toggle label (web <c>timeMachine.banner.pick</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolvePick(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PickKey, PickFallback);
    }

    /// <summary>Resolve the localized "Return to live" label (web <c>timeMachine.banner.returnToLive</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveReturnToLive(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ReturnToLiveKey, ReturnToLiveFallback);
    }

    /// <summary>Resolve the localized "View as of date" submit label (web <c>timeMachine.banner.submit</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveSubmit(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubmitKey, SubmitFallback);
    }

    /// <summary>Resolve the localized "Cancel" label (web <c>timeMachine.banner.cancel</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveCancel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(CancelKey, CancelFallback);
    }

    /// <summary>Resolve the localized date/time input label (web <c>timeMachine.banner.inputLabel</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveInputLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(InputLabelKey, InputLabelFallback);
    }

    /// <summary>The Segoe Fluent accent brush key the info chrome tints from.</summary>
    public static string AccentBrushKey => CalloutVariants.AccentBrushKey(Variant);
}

/// <summary>
/// The fully projected, render-ready view of the as-of anchor + the local picker state — everything the web
/// <c>TimeMachineBanner</c> derives before returning JSX (web/src/components/feedback/TimeMachineBanner.tsx
/// L107-126): the render <see cref="Mode"/> and its inverse-of-the-null-guard <see cref="IsVisible"/>, whether an
/// anchor is set (<see cref="HasAsOf"/>), whether the inline picker is open (<see cref="PickerOpen"/>), the
/// localized <see cref="Title"/> / <see cref="Body"/>, the four action labels, the <see cref="InputLabel"/>,
/// whether the "Return to live" action shows (<see cref="ShowReturnToLive"/>), whether "View as of date" is enabled
/// (<see cref="SubmitEnabled"/> — the web <c>disabled={!draft}</c>), the ARIA <see cref="LiveSetting"/>, and the
/// <see cref="AccessibleName"/> the polite status region announces. Pure value type so every field is asserted
/// headlessly.
/// </summary>
public readonly record struct TimeMachineBannerProjection
{
    private TimeMachineBannerProjection(
        TimeMachineBannerMode mode,
        bool hasAsOf,
        bool pickerOpen,
        string title,
        string body,
        string pickLabel,
        string returnLabel,
        string submitLabel,
        string cancelLabel,
        string inputLabel,
        bool submitEnabled,
        string liveSetting,
        string accessibleName)
    {
        Mode = mode;
        HasAsOf = hasAsOf;
        PickerOpen = pickerOpen;
        Title = title;
        Body = body;
        PickLabel = pickLabel;
        ReturnLabel = returnLabel;
        SubmitLabel = submitLabel;
        CancelLabel = cancelLabel;
        InputLabel = inputLabel;
        SubmitEnabled = submitEnabled;
        LiveSetting = liveSetting;
        AccessibleName = accessibleName;
    }

    /// <summary>The render branch (web render gates).</summary>
    public TimeMachineBannerMode Mode { get; }

    /// <summary>Whether the banner is shown — the web <c>asOf == null &amp;&amp; !pickerOpen</c> early-return, inverted.</summary>
    public bool IsVisible => Mode != TimeMachineBannerMode.Hidden;

    /// <summary>Whether an anchor is set (web <c>effective != null</c>).</summary>
    public bool HasAsOf { get; }

    /// <summary>Whether the inline date/time picker is open (web <c>pickerOpen</c>).</summary>
    public bool PickerOpen { get; }

    /// <summary>The localized banner title (web <c>timeMachine.banner.title</c>), the anchor interpolated.</summary>
    public string Title { get; }

    /// <summary>The localized body — the historical notice or the live-mode pick prompt (web <c>body</c>).</summary>
    public string Body { get; }

    /// <summary>The localized "Pick a date" toggle label (web <c>pickLabel</c>).</summary>
    public string PickLabel { get; }

    /// <summary>The localized "Return to live" action label (web <c>returnLabel</c>).</summary>
    public string ReturnLabel { get; }

    /// <summary>The localized "View as of date" submit label (web <c>submitLabel</c>).</summary>
    public string SubmitLabel { get; }

    /// <summary>The localized "Cancel" action label (web <c>cancelLabel</c>).</summary>
    public string CancelLabel { get; }

    /// <summary>The localized date/time input label (web <c>inputLabel</c>).</summary>
    public string InputLabel { get; }

    /// <summary>Whether the "Return to live" action is shown — only when an anchor is set (web <c>effective != null &amp;&amp; …</c>).</summary>
    public bool ShowReturnToLive => HasAsOf;

    /// <summary>Whether "View as of date" is enabled — only with a complete draft (web <c>disabled={!draft}</c>).</summary>
    public bool SubmitEnabled { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>The accessible name the polite status region announces (the title and/or body).</summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the anchor + picker state into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/TimeMachineBanner.tsx L107-126): live mode with the picker closed is hidden;
    /// live mode with the picker open shows the pick prompt; an anchor shows the read-only historical notice with
    /// the "Return to live" action. Every string is resolved through the localizer so it is ready the instant the
    /// banner shows.
    /// </summary>
    /// <param name="asOf">The current anchor (RFC 3339), or null in live mode (web <c>asOf</c>).</param>
    /// <param name="pickerOpen">Whether the inline picker is open (web <c>pickerOpen</c>).</param>
    /// <param name="draftReady">Whether a complete date+time draft is staged (web <c>!!draft</c>).</param>
    /// <param name="now">The current instant (injected for deterministic tests).</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    public static TimeMachineBannerProjection Project(
        string? asOf,
        bool pickerOpen,
        bool draftReady,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string? normalized = TimeMachineBannerRegistration.NormalizeAsOf(asOf);
        bool hasAsOf = normalized is not null;
        TimeMachineBannerMode mode = hasAsOf
            ? TimeMachineBannerMode.Historical
            : pickerOpen ? TimeMachineBannerMode.LivePrompt : TimeMachineBannerMode.Hidden;

        string when = TimeMachineBannerRegistration.FormatWhen(normalized, now);
        string title = TimeMachineBannerRegistration.ResolveTitle(localizer, when);
        string body = hasAsOf
            ? TimeMachineBannerRegistration.ResolveBody(localizer)
            : TimeMachineBannerRegistration.ResolvePickPrompt(localizer);

        return new TimeMachineBannerProjection(
            mode: mode,
            hasAsOf: hasAsOf,
            pickerOpen: pickerOpen,
            title: title,
            body: body,
            pickLabel: TimeMachineBannerRegistration.ResolvePick(localizer),
            returnLabel: TimeMachineBannerRegistration.ResolveReturnToLive(localizer),
            submitLabel: TimeMachineBannerRegistration.ResolveSubmit(localizer),
            cancelLabel: TimeMachineBannerRegistration.ResolveCancel(localizer),
            inputLabel: TimeMachineBannerRegistration.ResolveInputLabel(localizer),
            submitEnabled: draftReady,
            liveSetting: TimeMachineBannerRegistration.LiveSetting,
            accessibleName: ComposeAccessibleName(hasAsOf, title, body));
    }

    private static string ComposeAccessibleName(bool hasAsOf, string title, string body)
    {
        // With an anchor the title carries the moment, so the status reads "title. body"; in the live-mode prompt
        // the title's interpolated moment is empty, so the prompt body alone is the meaningful announcement.
        if (!hasAsOf)
        {
            return body;
        }

        return string.IsNullOrEmpty(body) ? title : $"{title}. {body}";
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TimeMachineBanner</c> surface (P1/S11 diagnostics contract). The as-of anchor
/// pins the operator to a specific historical moment and is therefore sensitive, so the collector records ONLY
/// operational counters with the surface slug — never the timestamp itself. It mirrors the web component, which
/// emits no telemetry. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class TimeMachineBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _anchorsApplied;
    private long _returnedToLive;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public TimeMachineBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the user applied a historical anchor from this surface.</summary>
    public long AnchorsApplied => Interlocked.Read(ref _anchorsApplied);

    /// <summary>Number of times the user returned to live from this surface.</summary>
    public long ReturnedToLive => Interlocked.Read(ref _returnedToLive);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimeMachineBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimeMachineBannerRegistration.Slug}");
    }

    /// <summary>Record an anchor apply, emitting <c>time-machine.as-of-applied slug=TimeMachineBanner</c> (no timestamp).</summary>
    public void RecordAnchorApplied()
    {
        Interlocked.Increment(ref _anchorsApplied);
        _sink?.Invoke($"time-machine.as-of-applied slug={TimeMachineBannerRegistration.Slug}");
    }

    /// <summary>Record a return-to-live, emitting <c>time-machine.returned-to-live slug=TimeMachineBanner</c>.</summary>
    public void RecordReturnedToLive()
    {
        Interlocked.Increment(ref _returnedToLive);
        _sink?.Invoke($"time-machine.returned-to-live slug={TimeMachineBannerRegistration.Slug}");
    }
}
