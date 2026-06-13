using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemStatus;

/// <summary>
/// The render-time data model the <c>UpdateAvailableCallout</c> view binds to — the native analogue of the
/// web <c>UpdateAvailableCalloutProps</c> (<c>{ current, latest, checkedAt }</c> in
/// web/src/features/system/components/status/UpdateAvailableCallout.tsx). The web component is a pure
/// presentational callout: the parent status page owns the <c>/system/update-check</c> query and mounts the
/// callout only when it reports <c>update_available</c>, feeding the already-resolved running
/// <see cref="Current"/> version, the available <see cref="Latest"/> version, and the optional
/// <see cref="CheckedAt"/> poll time. There is therefore no fetch-driven loading / empty / error / stale /
/// offline branch to reproduce here (those belong to the parent page, exactly as React re-renders the
/// callout with already-resolved props); the surface's branches are the three optional regions — the
/// version suffix, the running-version lead-in and the last-checked stamp — each of which simply collapses
/// when its datum is absent, so the callout can never render a blank box. Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Current">The version the deployment is currently running (web <c>current</c>); null/empty when unknown.</param>
/// <param name="Latest">The newly available release version (web <c>latest</c>); null/empty when unknown.</param>
/// <param name="CheckedAt">When the update check last ran (web <c>checkedAt</c>); null when never/unknown.</param>
public sealed record UpdateAvailableCalloutModel(string? Current, string? Latest, DateTimeOffset? CheckedAt)
{
    /// <summary>The initial model — an anonymous "update available" callout with no version or poll detail.</summary>
    public static UpdateAvailableCalloutModel Empty { get; } = new(null, null, null);
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="UpdateAvailableCalloutModel"/> — the native
/// analogue of everything the web component renders before returning JSX: the headline
/// <see cref="TitleText"/> (web <c>Update available{latest ? ` — v${latest}` : ''}</c>), the secondary
/// <see cref="BodyText"/> (the optional <c>You're running v…</c> lead-in joined to the review-the-notes
/// sentence), the optional muted <see cref="LastCheckedText"/> stamp (web
/// <c> · Last checked {formatDateTime(checkedAt)}</c>), the <see cref="ViewNotesText"/> action label with
/// its <see cref="ReleaseNotesUri"/> target, the token-backed <see cref="AccentBrushKey"/>, the decorative
/// <see cref="IconGlyph"/> / <see cref="ActionIconGlyph"/>, and the composed Narrator
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="TitleText">The headline, optionally suffixed with the available version.</param>
/// <param name="BodyText">The secondary copy: the optional running-version lead-in plus the review sentence.</param>
/// <param name="HasLastChecked">Whether the muted last-checked stamp should render (web <c>checkedAt &amp;&amp; …</c>).</param>
/// <param name="LastCheckedText">The localized "Last checked {time}" stamp, or empty when no poll time is known.</param>
/// <param name="ViewNotesText">The localized label for the release-notes action (web "View notes").</param>
/// <param name="ReleaseNotesUri">The GitHub "releases/latest" target the action opens (web <c>href</c>).</param>
/// <param name="AccentBrushKey">The generated design-token brush key for the cyan callout accent.</param>
/// <param name="IconGlyph">The Segoe Fluent glyph standing in for the web Lucide <c>Sparkles</c> mark.</param>
/// <param name="ActionIconGlyph">The Segoe Fluent glyph standing in for the web Lucide <c>ExternalLink</c> mark.</param>
/// <param name="AutomationName">The composed Narrator name for the callout (title, body and stamp).</param>
public sealed record UpdateAvailableCalloutDisplay(
    string TitleText,
    string BodyText,
    bool HasLastChecked,
    string LastCheckedText,
    string ViewNotesText,
    Uri ReleaseNotesUri,
    string AccentBrushKey,
    string IconGlyph,
    string ActionIconGlyph,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="UpdateAvailableCalloutModel"/> to its
/// <see cref="UpdateAvailableCalloutDisplay"/> — the native port of
/// web/src/features/system/components/status/UpdateAvailableCallout.tsx. Reproduces the web derivations
/// exactly: the headline appends <c> — v{latest}</c> only when a latest version is present (web truthiness,
/// i.e. a non-empty string); the body prepends <c>You're running v{current}. </c> only when a current
/// version is present and always ends with the review-the-release-notes sentence; the <c>Last checked …</c>
/// stamp renders only when <c>checkedAt</c> is set, formatted through <see cref="DateTimeFormatting"/> (the
/// native <c>useDateFormat().formatDateTime</c>). The web source renders raw English literals; the native
/// port instead routes every region through the i18n facade with the English copy as the fallback, so no
/// English is hardcoded in the control. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class UpdateAvailableCalloutProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The "now" anchor threaded into the date formatter (the <c>useDateFormat</c> seam).</param>
    public static UpdateAvailableCalloutDisplay Project(
        UpdateAvailableCalloutModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool hasLatest = !string.IsNullOrEmpty(model.Latest);
        bool hasCurrent = !string.IsNullOrEmpty(model.Current);
        bool hasChecked = model.CheckedAt is not null;

        // Web `Update available{latest ? ` — v${latest}` : ''}`.
        string title = hasLatest
            ? string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(UpdateAvailableCalloutRegistration.TitleWithVersionKey, "Update available — v{0}"),
                model.Latest)
            : localizer.GetString(UpdateAvailableCalloutRegistration.TitleKey, "Update available");

        // Web `{current ? `You're running v${current}. ` : ''}Review the release notes before upgrading your deployment.`.
        string review = localizer.GetString(
            UpdateAvailableCalloutRegistration.BodyKey,
            "Review the release notes before upgrading your deployment.");
        string body = hasCurrent
            ? string.Concat(
                string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString(UpdateAvailableCalloutRegistration.CurrentKey, "You're running v{0}."),
                    model.Current),
                " ",
                review)
            : review;

        // Web `{checkedAt && <span> · Last checked {formatDateTime(checkedAt)}</span>}`.
        string lastChecked = hasChecked
            ? string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(UpdateAvailableCalloutRegistration.LastCheckedKey, "Last checked {0}"),
                DateTimeFormatting.Format(model.CheckedAt, DateTimeVariant.Full, now))
            : string.Empty;

        string viewNotes = localizer.GetString(UpdateAvailableCalloutRegistration.ViewNotesKey, "View notes");

        return new UpdateAvailableCalloutDisplay(
            TitleText: title,
            BodyText: body,
            HasLastChecked: hasChecked,
            LastCheckedText: lastChecked,
            ViewNotesText: viewNotes,
            ReleaseNotesUri: UpdateAvailableCalloutRegistration.ReleaseNotesUri,
            AccentBrushKey: UpdateAvailableCalloutRegistration.AccentBrushKey,
            IconGlyph: UpdateAvailableCalloutRegistration.SparkleGlyph,
            ActionIconGlyph: UpdateAvailableCalloutRegistration.ExternalLinkGlyph,
            AutomationName: BuildAutomationName(title, body, hasChecked, lastChecked));
    }

    // The callout announces as one status: headline, body and (when present) the last-checked stamp. The
    // action link carries its own Narrator name, so it is not folded into the surface name.
    private static string BuildAutomationName(string title, string body, bool hasChecked, string lastChecked)
    {
        string head = string.Concat(title, ". ", body);
        return hasChecked ? string.Concat(head, " ", lastChecked) : head;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>UpdateAvailableCallout</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never the running or available
/// version, nor the poll time — so a diagnostics line can never leak deployment state. Thread-safe.
/// </summary>
public sealed class UpdateAvailableCalloutDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public UpdateAvailableCalloutDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=UpdateAvailableCallout</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={UpdateAvailableCalloutRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>UpdateAvailableCallout</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/system/components/status/UpdateAvailableCallout.tsx</c>: the stable
/// diagnostics slug, the token brush key for the cyan accent, the Segoe Fluent glyphs that stand in for the
/// web Lucide marks, the GitHub release-notes target, and the i18n catalog keys (the <c>translation.*</c>
/// resource names every label resolves through). UI-free so the metadata is asserted in tests.
/// </summary>
public static class UpdateAvailableCalloutRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "UpdateAvailableCallout";

    /// <summary>The generated design-token brush key for the cyan callout accent (web <c>cyan</c>).</summary>
    public const string AccentBrushKey = "TsColorInfoBrush";

    /// <summary>Segoe Fluent "Sparkle" glyph — the native stand-in for the web Lucide <c>Sparkles</c> mark.</summary>
    public const string SparkleGlyph = "\uE734";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph — the native stand-in for the web Lucide <c>ExternalLink</c> mark.</summary>
    public const string ExternalLinkGlyph = "\uE8A7";

    /// <summary>i18n key for the bare headline (web "Update available").</summary>
    public const string TitleKey = "translation.system.updateCallout.title";

    /// <summary>i18n key for the headline with the available version (web "Update available — v{0}").</summary>
    public const string TitleWithVersionKey = "translation.system.updateCallout.titleWithVersion";

    /// <summary>i18n key for the running-version lead-in (web "You're running v{0}.").</summary>
    public const string CurrentKey = "translation.system.updateCallout.current";

    /// <summary>i18n key for the review-the-release-notes sentence.</summary>
    public const string BodyKey = "translation.system.updateCallout.body";

    /// <summary>i18n key for the last-checked stamp (web "Last checked {0}").</summary>
    public const string LastCheckedKey = "translation.system.updateCallout.lastChecked";

    /// <summary>i18n key for the release-notes action label (web "View notes").</summary>
    public const string ViewNotesKey = "translation.system.updateCallout.viewNotes";

    /// <summary>The GitHub "releases/latest" page the "View notes" action opens (web <c>href</c>).</summary>
    public static Uri ReleaseNotesUri { get; } =
        new("https://github.com/ev-dev-labs/teslasync/releases/latest", UriKind.Absolute);
}
