using TeslaSync.App.Core.Status;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render mode a <c>HealthRow</c> resolves to — the native analogue of the web component's three
/// polymorphic branches plus its inert default (web/src/components/status/HealthRow.tsx L78-107). The web
/// component is an <c>&lt;a target="_blank"&gt;</c> when <c>to</c> is set and <c>external</c> is true, a
/// react-router <c>&lt;Link&gt;</c> when <c>to</c> is set and not external, a <c>&lt;button&gt;</c> when only
/// <c>onClick</c> is set, and a plain <c>&lt;div&gt;</c> otherwise. <c>to</c> wins over <c>onClick</c>, exactly
/// as the web returns from the <c>if (to)</c> branch before reaching the <c>if (onClick)</c> branch.
/// </summary>
public enum HealthRowInteraction
{
    /// <summary>No link and no handler — the web non-interactive <c>&lt;div&gt;</c> branch.</summary>
    None,

    /// <summary>A same-app route — the web react-router <c>&lt;Link to&gt;</c> branch.</summary>
    InternalLink,

    /// <summary>An external destination opened out of the app — the web <c>&lt;a target="_blank"&gt;</c> branch.</summary>
    ExternalLink,

    /// <summary>A click handler with no link — the web <c>&lt;button onClick&gt;</c> branch.</summary>
    Command,
}

/// <summary>
/// The immutable prop set a <c>HealthRow</c> renders — the native analogue of the web <c>HealthRowProps</c>
/// (web/src/components/status/HealthRow.tsx L31-43). <see cref="Status"/> drives the dot + summary tint,
/// <see cref="Label"/> is the primary text, <see cref="Summary"/> the right-aligned summary, <see cref="Glyph"/>
/// the optional leading icon (the web <c>icon?: ReactNode</c>, carried here as a Segoe Fluent glyph),
/// <see cref="To"/> / <see cref="External"/> the optional link target (web <c>to</c> / <c>external</c>), and
/// <see cref="Interactive"/> whether a click handler is attached (web <c>onClick</c>, consulted only when there
/// is no link). The actual click callback and the navigation seam live on the view-model — this record stays
/// pure data so the projection is unit-tested without a UI host. <see cref="Label"/> and <see cref="Summary"/>
/// arrive already localized by the caller (the web passes resolved strings); the row itself renders no literals
/// of its own.
/// </summary>
public sealed record HealthRowModel
{
    /// <summary>The health status driving the dot colour and the summary tint (web <c>status</c>).</summary>
    public required HealthStatus Status { get; init; }

    /// <summary>The primary, left-aligned label (web <c>label</c>).</summary>
    public required string Label { get; init; }

    /// <summary>The right-aligned summary, e.g. "12 / 12 healthy" (web <c>summary</c>).</summary>
    public required string Summary { get; init; }

    /// <summary>Optional leading Segoe Fluent icon glyph (web <c>icon?: ReactNode</c>); null/empty hides it.</summary>
    public string? Glyph { get; init; }

    /// <summary>Optional link destination (web <c>to</c>); a non-empty value makes the row a link.</summary>
    public string? To { get; init; }

    /// <summary>Whether <see cref="To"/> opens out of the app in a new window (web <c>external</c>).</summary>
    public bool External { get; init; }

    /// <summary>Whether a click handler is attached (web <c>onClick</c>); consulted only when <see cref="To"/> is empty.</summary>
    public bool Interactive { get; init; }

    /// <summary>A non-interactive row (web no <c>to</c>, no <c>onClick</c>).</summary>
    /// <param name="status">The health status.</param>
    /// <param name="label">The primary label.</param>
    /// <param name="summary">The right-aligned summary.</param>
    /// <param name="glyph">Optional leading icon glyph.</param>
    public static HealthRowModel Static(HealthStatus status, string label, string summary, string? glyph = null) =>
        new() { Status = status, Label = label, Summary = summary, Glyph = glyph };

    /// <summary>A linked row (web <c>to</c> / <c>external</c>).</summary>
    /// <param name="status">The health status.</param>
    /// <param name="label">The primary label.</param>
    /// <param name="summary">The right-aligned summary.</param>
    /// <param name="to">The link destination.</param>
    /// <param name="external">Whether the destination opens out of the app.</param>
    /// <param name="glyph">Optional leading icon glyph.</param>
    public static HealthRowModel Link(
        HealthStatus status,
        string label,
        string summary,
        string to,
        bool external = false,
        string? glyph = null) =>
        new() { Status = status, Label = label, Summary = summary, To = to, External = external, Glyph = glyph };

    /// <summary>A clickable row with a handler but no link (web <c>onClick</c>).</summary>
    /// <param name="status">The health status.</param>
    /// <param name="label">The primary label.</param>
    /// <param name="summary">The right-aligned summary.</param>
    /// <param name="glyph">Optional leading icon glyph.</param>
    public static HealthRowModel Clickable(HealthStatus status, string label, string summary, string? glyph = null) =>
        new() { Status = status, Label = label, Summary = summary, Interactive = true };
}

/// <summary>
/// Canonical metadata for the HealthRow surface — the native analogue of the module-level constants in
/// web/src/components/status/HealthRow.tsx. The web component is anonymous (it renders no titles or labels of
/// its own — <see cref="HealthRowModel.Label"/> and <see cref="HealthRowModel.Summary"/> are caller-supplied,
/// already-localized strings), so this carries no i18n message keys; it carries the diagnostics slug, the
/// automation id, the accessible-name recipe (the web link <c>aria-label={`${label} — ${summary}`}</c>), the
/// Segoe Fluent chevron glyph standing in for the web Lucide <c>ChevronRight</c>, and the pure interaction
/// classifier. UI-free so it is asserted in tests.
/// </summary>
public static class HealthRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HealthRow";

    /// <summary>The automation id Narrator and UI-automation resolve the row by.</summary>
    public const string AutomationId = "health-row";

    /// <summary>The " — " join (space, U+2014 em dash, space) between label and summary in the accessible name (web template literal).</summary>
    public const string AccessibleNameSeparator = " \u2014 ";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the native stand-in for the web Lucide <c>ChevronRight</c> affordance.</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>Compose the accessible name a screen reader announces — the web link <c>aria-label</c> ("{label} — {summary}").</summary>
    /// <param name="label">The primary label.</param>
    /// <param name="summary">The right-aligned summary.</param>
    public static string ComposeAccessibleName(string label, string summary) =>
        $"{label}{AccessibleNameSeparator}{summary}";

    /// <summary>
    /// Resolve the render mode from the link / handler inputs, reproducing the web branch order
    /// (web/src/components/status/HealthRow.tsx L78-107): a non-empty <paramref name="to"/> is a link
    /// (external when <paramref name="external"/>, otherwise an in-app route) and takes precedence; otherwise an
    /// attached handler (<paramref name="interactive"/>) is a command; otherwise the row is non-interactive.
    /// </summary>
    /// <param name="to">The link destination (web <c>to</c>), or null/empty for none.</param>
    /// <param name="external">Whether the link opens out of the app (web <c>external</c>).</param>
    /// <param name="interactive">Whether a click handler is attached (web <c>onClick</c>).</param>
    public static HealthRowInteraction ClassifyInteraction(string? to, bool external, bool interactive) =>
        !string.IsNullOrEmpty(to)
            ? (external ? HealthRowInteraction.ExternalLink : HealthRowInteraction.InternalLink)
            : interactive ? HealthRowInteraction.Command : HealthRowInteraction.None;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="HealthRowModel"/> — everything the web component
/// derives before returning JSX (web/src/components/status/HealthRow.tsx L45-107): the <see cref="Status"/> the
/// dot + summary tint from, the <see cref="Label"/> / <see cref="Summary"/> text, the <see cref="Glyph"/> and
/// whether it is shown (<see cref="ShowIcon"/> — the web <c>icon &amp;&amp; …</c> gate), the resolved
/// <see cref="Interaction"/> mode and whether the chevron + activation are present (<see cref="Actionable"/> —
/// the web <c>(to || onClick)</c> gate), the link <see cref="Target"/> and whether it is <see cref="External"/>,
/// and the composed <see cref="AccessibleName"/> (the web link <c>aria-label</c>). Pure value type so every
/// field is asserted headlessly.
/// </summary>
/// <param name="Status">The health status (web <c>status</c>).</param>
/// <param name="Label">The primary label (web <c>label</c>).</param>
/// <param name="Summary">The right-aligned summary (web <c>summary</c>).</param>
/// <param name="Glyph">The leading icon glyph, or empty when none.</param>
/// <param name="ShowIcon">Whether the leading icon is shown (web <c>icon</c> truthy).</param>
/// <param name="Interaction">The resolved render mode.</param>
/// <param name="Actionable">Whether the row shows a chevron and raises activation (web <c>to || onClick</c>).</param>
/// <param name="Target">The link destination when the row is a link, otherwise null.</param>
/// <param name="External">Whether the link opens out of the app (web <c>external</c>).</param>
/// <param name="AccessibleName">The composed "{label} — {summary}" accessible name (web link <c>aria-label</c>).</param>
public readonly record struct HealthRowProjection(
    HealthStatus Status,
    string Label,
    string Summary,
    string Glyph,
    bool ShowIcon,
    HealthRowInteraction Interaction,
    bool Actionable,
    string? Target,
    bool External,
    string AccessibleName)
{
    /// <summary>
    /// Project a model into a render-ready value, reproducing the web component
    /// (web/src/components/status/HealthRow.tsx L45-107): the icon shows only when supplied, the chevron +
    /// activation are present only when the row is a link or has a handler, and the accessible name is the
    /// "{label} — {summary}" the web sets as the link <c>aria-label</c>.
    /// </summary>
    /// <param name="model">The prop set to project.</param>
    public static HealthRowProjection Project(HealthRowModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var interaction = HealthRowRegistration.ClassifyInteraction(model.To, model.External, model.Interactive);
        var glyph = model.Glyph ?? string.Empty;
        var target = string.IsNullOrEmpty(model.To) ? null : model.To;

        return new HealthRowProjection(
            Status: model.Status,
            Label: model.Label,
            Summary: model.Summary,
            Glyph: glyph,
            ShowIcon: glyph.Length > 0,
            Interaction: interaction,
            Actionable: interaction != HealthRowInteraction.None,
            Target: target,
            External: interaction == HealthRowInteraction.ExternalLink,
            AccessibleName: HealthRowRegistration.ComposeAccessibleName(model.Label, model.Summary));
    }
}

/// <summary>
/// PII-safe diagnostics for the HealthRow surface (P1/S11 diagnostics contract). The label / summary can carry
/// user-facing content, so the collector records ONLY the operational <c>view.opened</c> event with the surface
/// slug — never the label, summary, status or link target. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class HealthRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public HealthRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HealthRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HealthRowRegistration.Slug}");
    }
}
