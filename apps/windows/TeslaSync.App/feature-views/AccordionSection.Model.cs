using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The render-time data model the <c>AccordionSection</c> view binds to — the native analogue of the web
/// <c>AccordionSectionProps</c> (web/src/features/system/components/status/AccordionSection.tsx). The web source is a
/// pure presentational disclosure: it takes an already-resolved <c>icon</c> / <c>title</c> / <c>description</c> /
/// <c>defaultOpen</c> (plus the <c>badges</c> and <c>children</c> render nodes, which are supplied to the view as
/// WinUI elements and so are NOT part of this pure-data model) and performs no fetching. The web <c>icon:
/// ReactNode</c> becomes an optional Segoe Fluent <see cref="IconGlyph"/> (the parent supplies a glyph, exactly as it
/// supplies a Lucide node on the web). Because the component has no fetch lifecycle there is no loading / error /
/// stale / offline branch to model — the only states are collapsed and expanded (resolved from
/// <see cref="DefaultOpen"/>), plus a friendly empty caption when an expanded section has no body. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The section title shown in the header (web <c>title</c>).</param>
/// <param name="Description">The muted sub-line under the title (web <c>description</c>).</param>
/// <param name="IconGlyph">Optional Segoe Fluent glyph rendered before the title (web <c>icon</c>), or null.</param>
/// <param name="DefaultOpen">Whether the section starts expanded (web <c>defaultOpen</c>, default false).</param>
public sealed record AccordionSectionModel(
    string Title,
    string Description,
    string? IconGlyph = null,
    bool DefaultOpen = false);

/// <summary>
/// The fully projected, render-ready view of one <c>AccordionSection</c> input — the native analogue of everything
/// the web component resolves before returning JSX. Holds the optional <see cref="IconGlyph"/>, the verbatim
/// <see cref="Title"/> + <see cref="Description"/> (with presence flags so a blank line is collapsed rather than
/// rendered as empty space), the initial <see cref="DefaultOpen"/> state, the shared empty-body caption, and the
/// composed header <see cref="AutomationName"/>. Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="IconGlyph">The Segoe Fluent header glyph, or null when the web <c>icon</c> was absent.</param>
/// <param name="HasIcon">Whether a glyph is present.</param>
/// <param name="Title">The section title, rendered verbatim (web <c>title</c>).</param>
/// <param name="HasTitle">Whether a non-blank title is present.</param>
/// <param name="Description">The muted sub-line, rendered verbatim (web <c>description</c>).</param>
/// <param name="HasDescription">Whether a non-blank description is present.</param>
/// <param name="DefaultOpen">Whether the section starts expanded (web <c>defaultOpen</c>).</param>
/// <param name="EmptyMessage">The localized caption shown when an expanded section has no body (never a blank box).</param>
/// <param name="AutomationName">The composed Narrator name for the disclosure header (title then description).</param>
public sealed record AccordionSectionDisplay(
    string? IconGlyph,
    bool HasIcon,
    string Title,
    bool HasTitle,
    string Description,
    bool HasDescription,
    bool DefaultOpen,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AccordionSectionModel"/> to its <see cref="AccordionSectionDisplay"/> — the
/// native port of web/src/features/system/components/status/AccordionSection.tsx. The title and description are
/// rendered verbatim (the web interpolates the resolved props unchanged); an empty glyph collapses to null so no
/// icon slot is reserved; the empty-body caption resolves through the i18n facade; and the header Narrator name is
/// composed from the present header parts (title then description) — the expanded / collapsed state itself is spoken
/// by the disclosure control, so it is not duplicated into the name. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AccordionSectionProjection
{
    /// <summary>i18n key for the empty-body caption shown when an expanded section has no content.</summary>
    public const string EmptyMessageKey = "accordion.empty";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No content";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props minus the badge / body render nodes).</param>
    /// <param name="localizer">The i18n facade the empty-body caption resolves through.</param>
    public static AccordionSectionDisplay Project(AccordionSectionModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = model.Title ?? string.Empty;
        string description = model.Description ?? string.Empty;
        string? icon = string.IsNullOrEmpty(model.IconGlyph) ? null : model.IconGlyph;
        bool hasTitle = !string.IsNullOrWhiteSpace(title);
        bool hasDescription = !string.IsNullOrWhiteSpace(description);
        string emptyMessage = localizer.GetString(EmptyMessageKey, EmptyMessageFallback);

        return new AccordionSectionDisplay(
            IconGlyph: icon,
            HasIcon: icon is not null,
            Title: title,
            HasTitle: hasTitle,
            Description: description,
            HasDescription: hasDescription,
            DefaultOpen: model.DefaultOpen,
            EmptyMessage: emptyMessage,
            AutomationName: BuildAutomationName(hasTitle, title, hasDescription, description, emptyMessage));
    }

    private static string BuildAutomationName(
        bool hasTitle,
        string title,
        bool hasDescription,
        string description,
        string emptyMessage)
    {
        // Reading order matches the web header (title then description). Only present parts are spoken so the
        // Narrator name never carries a dangling separator; a fully blank header falls back to the empty caption so
        // the disclosure always has a meaningful accessible name.
        var parts = new List<string>(2);
        if (hasTitle)
        {
            parts.Add(title);
        }

        if (hasDescription)
        {
            parts.Add(description);
        }

        return parts.Count > 0 ? string.Join(". ", parts) : emptyMessage;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AccordionSection</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the title, description or body — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class AccordionSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AccordionSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AccordionSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AccordionSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AccordionSection</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/status/AccordionSection.tsx</c>. Holds the diagnostics slug emitted with the
/// <c>view.opened</c> event. UI-free so the metadata is asserted in tests.
/// </summary>
public static class AccordionSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AccordionSection";
}
