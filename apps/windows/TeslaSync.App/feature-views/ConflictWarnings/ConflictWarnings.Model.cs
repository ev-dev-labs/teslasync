using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The severity of a single automation conflict — the native analogue of the web union
/// <c>severity: 'warning' | 'info'</c> on <c>AutomationConflict</c>
/// (<c>web/src/api/types.ts</c>, consumed by
/// <c>web/src/features/automations/pages/ConflictWarnings.tsx</c>). The web treats the value defensively
/// (<c>severity === 'warning' ? 'warning' : 'info'</c>): only the exact literal <c>'warning'</c> is the
/// cautionary tier, everything else (including <c>'info'</c>, an unexpected casing, or a missing value) is the
/// neutral informational tier. <see cref="ConflictWarningsProjection.ParseSeverity"/> reproduces that ladder.
/// </summary>
public enum ConflictSeverity
{
    /// <summary>The cautionary tier (web <c>'warning'</c>) — the amber <see cref="CalloutVariant.Warning"/> banner with the alert-triangle glyph.</summary>
    Warning,

    /// <summary>The neutral informational tier (web <c>'info'</c> / any non-<c>'warning'</c> value) — the <see cref="CalloutVariant.Info"/> banner with the info glyph.</summary>
    Info,
}

/// <summary>
/// One automation conflict — the native analogue of the web <c>AutomationConflict</c> interface
/// (<c>web/src/api/types.ts</c>: <c>automation_id</c> / <c>automation_name</c> / <c>reason</c> /
/// <c>severity</c>). The string fields are nullable so the projection can apply the project-wide null-safety
/// fallbacks (a missing name / reason collapses to an empty fragment rather than throwing), mirroring the web
/// type's nominal shape while staying defensive against a partially-populated wire payload. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="AutomationId">The conflicting automation's id (web <c>automation_id</c>) — part of the stable list key.</param>
/// <param name="AutomationName">The conflicting automation's display name (web <c>automation_name</c>), or null.</param>
/// <param name="Reason">The human-readable conflict reason (web <c>reason</c>), or null.</param>
/// <param name="Severity">The raw severity token (web <c>severity</c>: <c>'warning'</c> / <c>'info'</c>), or null.</param>
public sealed record AutomationConflict(
    long AutomationId,
    string? AutomationName,
    string? Reason,
    string? Severity);

/// <summary>
/// The mutually-exclusive render branch of the <c>ConflictWarnings</c> surface — the native union of the states
/// the web component renders (<c>web/src/features/automations/pages/ConflictWarnings.tsx</c>). The web source is
/// a pure presentational list: it takes an already-resolved <c>conflicts</c> array and renders one
/// <c>AlertBanner</c> per entry, returning <c>null</c> when the array is empty. It performs no fetching, so
/// there is no fetch-driven error / stale / offline branch to reproduce here — the hosting
/// <c>AutomationBuilderPage</c> owns the conflict-check lifecycle (it derives <c>conflicts</c> from the save
/// mutation and renders the save-error / network surfaces itself, then re-renders this control with
/// already-resolved props, exactly as React only mounts the list with resolved data). The
/// <see cref="Loading"/> branch is the card-local skeleton a parent drives while it is still resolving the
/// check, and the <see cref="Empty"/> branch is the native always-render-a-surface replacement for the web's
/// bare <c>return null</c> (a region never collapses to an invisible box). Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum ConflictWarningsState
{
    /// <summary>The parent is still resolving the conflict check — tokenized skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no conflicts (web <c>conflicts.length === 0</c>) — a friendly empty surface, never a blank box.</summary>
    Empty,

    /// <summary>One or more conflicts (the web render) — a stacked list of severity-tinted alert banners.</summary>
    Ready,
}

/// <summary>
/// The fully projected, render-ready view of one conflict banner — the native analogue of a single
/// <c>conflicts.map(...)</c> cell in the web source. Every value the web cell derives is resolved here: the
/// parsed <see cref="Severity"/> (web <c>severity === 'warning' ? …</c>), the mapped banner
/// <see cref="Variant"/> (web <c>variant</c>) and its <see cref="IconGlyph"/> (web <c>AlertTriangle</c> /
/// <c>Info</c>), the shared localized <see cref="Title"/> (web <c>t('automations.builder.conflict', …)</c>),
/// the interpolated <see cref="Message"/> (web <c>`"${automation_name}": ${reason}`</c>), the token-backed
/// <see cref="AccentBrushKey"/>, the stable list <see cref="Key"/> (web <c>`${automation_id}-${i}`</c>) and the
/// composed Narrator name. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="Severity">The parsed conflict severity.</param>
/// <param name="Variant">The banner emphasis the severity maps to (warning / info).</param>
/// <param name="IconGlyph">The Segoe Fluent leading glyph (web <c>AlertTriangle</c> / <c>Info</c>).</param>
/// <param name="Title">The shared localized banner heading ("Potential Conflict").</param>
/// <param name="Message">The interpolated banner body (<c>"name": reason</c>).</param>
/// <param name="AccentBrushKey">The theme-aware accent token brush key for the variant.</param>
/// <param name="Key">The stable list key (<c>automationId-index</c>) mirroring the web React key.</param>
/// <param name="AutomationName">The composed Narrator name for the banner ("Title. Message").</param>
public sealed record ConflictBannerDisplay(
    ConflictSeverity Severity,
    CalloutVariant Variant,
    string IconGlyph,
    string Title,
    string Message,
    string AccentBrushKey,
    string Key,
    string AutomationName);

/// <summary>
/// The render-time data model the <c>ConflictWarnings</c> view binds to — the native analogue of the web
/// <c>ConflictWarningsProps</c> (<c>web/src/features/automations/pages/ConflictWarnings.tsx</c>). The web
/// <c>conflicts</c> prop becomes <see cref="Conflicts"/>; <see cref="Loading"/> is the card-local flag a parent
/// grid drives while the conflict check is still resolving (the web parent owns that lifecycle, so the model is
/// purely a projection input). Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">When true the parent has not resolved the conflict check yet (the loading branch).</param>
/// <param name="Conflicts">The resolved conflicts to render (web <c>conflicts</c>); empty renders the empty branch.</param>
public sealed record ConflictWarningsModel(
    bool Loading,
    IReadOnlyList<AutomationConflict> Conflicts)
{
    /// <summary>The initial model: the parent is still resolving the check, so the loading branch renders.</summary>
    public static ConflictWarningsModel Pending { get; } = new(true, Array.Empty<AutomationConflict>());

    /// <summary>A resolved model with no conflicts — the empty branch (the web <c>return null</c> case).</summary>
    public static ConflictWarningsModel Empty { get; } = new(false, Array.Empty<AutomationConflict>());

    /// <summary>A resolved model wrapping <paramref name="conflicts"/> — the ready (or empty) branch.</summary>
    /// <param name="conflicts">The conflicts to render; null collapses to the empty branch.</param>
    public static ConflictWarningsModel Of(params AutomationConflict[] conflicts) =>
        new(false, conflicts ?? Array.Empty<AutomationConflict>());
}

/// <summary>
/// The fully projected, render-ready view of the whole <c>ConflictWarnings</c> surface — the active
/// <see cref="State"/>, the projected <see cref="Banners"/> (in the web <c>conflicts</c> order), the localized
/// empty + loading copy and the surface Narrator name. Pure data so every value is asserted without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Banners">The projected conflict banners, in source order (empty unless <see cref="ConflictWarningsState.Ready"/>).</param>
/// <param name="EmptyMessage">The localized empty-state copy (the empty branch).</param>
/// <param name="LoadingLabel">The localized loading copy (the loading branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface in the active state.</param>
public sealed record ConflictWarningsDisplay(
    ConflictWarningsState State,
    IReadOnlyList<ConflictBannerDisplay> Banners,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ConflictWarningsModel"/> to its <see cref="ConflictWarningsDisplay"/> — the
/// native port of <c>web/src/features/automations/pages/ConflictWarnings.tsx</c>. Reproduces the web derivations
/// exactly: the branch precedence mirrors the card lifecycle (loading → empty → ready);
/// <see cref="ParseSeverity"/> mirrors the web <c>severity === 'warning' ? 'warning' : 'info'</c> guard;
/// <see cref="VariantFor"/> + <see cref="GlyphFor"/> map the severity onto the shared callout variant and the
/// Segoe Fluent stand-ins for the web Lucide <c>AlertTriangle</c> / <c>Info</c> icons;
/// <see cref="FormatMessage"/> reproduces the web template literal <c>`"${automation_name}": ${reason}`</c>
/// verbatim; and the banner heading flows through the i18n facade using the exact catalog key + English
/// fallback the web feeds into <c>t()</c>. The shared loading / empty copy uses the common catalog keys (the web
/// renders nothing when empty, so the native empty surface borrows the shared "no data" string, exactly as the
/// sibling presentational ports do). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ConflictWarningsProjection
{
    /// <summary>The exact severity token the web treats as the cautionary tier (web <c>=== 'warning'</c>).</summary>
    public const string WarningToken = "warning";

    /// <summary>i18n key for the shared banner heading (web <c>t('automations.builder.conflict', …)</c>).</summary>
    public const string ConflictTitleKey = "translation.automations.builder.conflict";

    /// <summary>English fallback for <see cref="ConflictTitleKey"/> (matches the web default).</summary>
    public const string ConflictTitleFallback = "Potential Conflict";

    /// <summary>i18n key for the empty-state copy (the shared <c>common.noData</c> string; the web renders nothing).</summary>
    public const string EmptyMessageKey = "translation.common.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No data available";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>
    /// Parse a raw severity token into a <see cref="ConflictSeverity"/>, mirroring the web
    /// <c>severity === 'warning' ? 'warning' : 'info'</c> guard verbatim: only the exact ordinal literal
    /// <c>"warning"</c> is <see cref="ConflictSeverity.Warning"/>; every other value — <c>"info"</c>, an
    /// unexpected casing, the empty string or null — is <see cref="ConflictSeverity.Info"/>.
    /// </summary>
    /// <param name="raw">The raw severity token (web <c>severity</c>).</param>
    public static ConflictSeverity ParseSeverity(string? raw) =>
        string.Equals(raw, WarningToken, StringComparison.Ordinal)
            ? ConflictSeverity.Warning
            : ConflictSeverity.Info;

    /// <summary>The shared callout variant a severity maps to (web <c>variant</c>): warning → warning, info → info.</summary>
    public static CalloutVariant VariantFor(ConflictSeverity severity) =>
        severity == ConflictSeverity.Warning ? CalloutVariant.Warning : CalloutVariant.Info;

    /// <summary>
    /// The Segoe Fluent leading glyph a severity maps to — the native stand-in for the web Lucide icons: warning
    /// → the alert-triangle glyph (web <c>AlertTriangle</c>), info → the info glyph (web <c>Info</c>). Matches the
    /// shared banner variant's default glyph so the explicit web <c>icon</c> prop and the variant agree.
    /// </summary>
    public static string GlyphFor(ConflictSeverity severity) =>
        severity == ConflictSeverity.Warning
            ? ConflictWarningsRegistration.AlertTriangleGlyph
            : ConflictWarningsRegistration.InfoGlyph;

    /// <summary>
    /// The banner body for one conflict, mirroring the web template literal
    /// <c>`"${automation_name}": ${reason}`</c> verbatim (a missing name / reason collapses to an empty
    /// fragment, the project-wide null-safety fallback).
    /// </summary>
    /// <param name="automationName">The automation display name (web <c>automation_name</c>).</param>
    /// <param name="reason">The conflict reason (web <c>reason</c>).</param>
    public static string FormatMessage(string? automationName, string? reason) =>
        string.Concat("\"", automationName ?? string.Empty, "\": ", reason ?? string.Empty);

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the heading / empty / loading copy resolves through.</param>
    public static ConflictWarningsDisplay Project(ConflictWarningsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(ConflictTitleKey, ConflictTitleFallback);
        string emptyMessage = localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);

        IReadOnlyList<AutomationConflict> conflicts = model.Conflicts ?? Array.Empty<AutomationConflict>();
        ConflictWarningsState state = SelectState(model.Loading, conflicts.Count);

        // Banners are projected only for the ready branch — the loading branch renders skeletons and the empty
        // branch renders the empty surface, so neither exposes (nor renders) any conflict banner.
        IReadOnlyList<ConflictBannerDisplay> banners = state == ConflictWarningsState.Ready
            ? BuildBanners(conflicts, title)
            : Array.Empty<ConflictBannerDisplay>();

        return new ConflictWarningsDisplay(
            State: state,
            Banners: banners,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: state switch
            {
                ConflictWarningsState.Loading => loadingLabel,
                ConflictWarningsState.Empty => emptyMessage,
                _ => title,
            });
    }

    /// <summary>Branch precedence from the card lifecycle: loading → empty (no conflicts) → ready.</summary>
    private static ConflictWarningsState SelectState(bool loading, int conflictCount)
    {
        if (loading)
        {
            return ConflictWarningsState.Loading;
        }

        // The web returns null when there are no conflicts; the native surface always renders, so a resolved
        // empty list maps to the friendly empty branch rather than a collapsed (invisible) box.
        return conflictCount == 0 ? ConflictWarningsState.Empty : ConflictWarningsState.Ready;
    }

    private static List<ConflictBannerDisplay> BuildBanners(
        IReadOnlyList<AutomationConflict> conflicts,
        string title)
    {
        var banners = new List<ConflictBannerDisplay>(conflicts.Count);
        for (int i = 0; i < conflicts.Count; i++)
        {
            banners.Add(ProjectBanner(conflicts[i], i, title));
        }

        return banners;
    }

    private static ConflictBannerDisplay ProjectBanner(AutomationConflict conflict, int index, string title)
    {
        ConflictSeverity severity = ParseSeverity(conflict.Severity);
        CalloutVariant variant = VariantFor(severity);
        string message = FormatMessage(conflict.AutomationName, conflict.Reason);

        return new ConflictBannerDisplay(
            Severity: severity,
            Variant: variant,
            IconGlyph: GlyphFor(severity),
            Title: title,
            Message: message,
            AccentBrushKey: CalloutVariants.AccentBrushKey(variant),
            Key: string.Create(CultureInfo.InvariantCulture, $"{conflict.AutomationId}-{index}"),
            AutomationName: string.Concat(title, ". ", message));
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ConflictWarnings</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, reason or id — so a
/// diagnostics line can never leak fleet / automation data. Thread-safe.
/// </summary>
public sealed class ConflictWarningsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ConflictWarningsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ConflictWarnings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ConflictWarningsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ConflictWarnings</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/automations/pages/ConflictWarnings.tsx</c>: the stable diagnostics slug and the Segoe
/// Fluent glyphs that stand in for the web Lucide <c>AlertTriangle</c> / <c>Info</c> icons. UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class ConflictWarningsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ConflictWarnings";

    /// <summary>Segoe Fluent "Warning" glyph for a warning-severity conflict (web <c>AlertTriangle</c>).</summary>
    public const string AlertTriangleGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "Info" glyph for an info-severity conflict (web <c>Info</c>).</summary>
    public const string InfoGlyph = "\uE946";
}
