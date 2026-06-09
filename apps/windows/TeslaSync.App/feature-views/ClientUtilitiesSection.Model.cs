using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.ClientUtilities;

/// <summary>
/// The mutually-exclusive surface state for the <see cref="ClientUtilitiesViewModel"/>. The web
/// <c>ClientUtilitiesSection</c> (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx) is a
/// purely client-side surface — its tool list comes from the in-memory <c>useToolList</c> registry, not a
/// network read — so it has only two states: the searchable grid (<see cref="Ready"/>) and the
/// no-search-match empty surface (<see cref="Empty"/>, the web <c>{filtered.length === 0 &amp;&amp; …}</c>
/// branch). There is deliberately no loading / error / stale / offline state because the web source has
/// none (the registry resolves synchronously).
/// </summary>
public enum ClientUtilityToolState
{
    /// <summary>At least one tool matched the current search — render the responsive grid.</summary>
    Ready,

    /// <summary>No tool matched the current search — render the friendly empty surface (never a blank box).</summary>
    Empty,
}

/// <summary>
/// One canonical client-utility entry — the native analogue of a web <c>useToolList</c> record
/// (<c>{ id, name: t(nameKey), desc: t(descKey), icon, color, Component }</c> in
/// web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx). <see cref="Glyph"/> is the Segoe
/// Fluent code point standing in for the web Lucide icon, and <see cref="AccentBrushKey"/> is the semantic
/// design token standing in for the web Tailwind neon colour (web <c>ICON_COLOR_MAP</c> in
/// web/src/features/admin/components/devtools/constants.ts — no ad-hoc hex in the control layer, per the
/// engineering guidelines). The tool body itself (the web <c>Component</c>) is a separate surface
/// (W-0011…W-0025) hosted at the expand seam; this registry only carries the card metadata.
/// </summary>
/// <param name="Id">Stable tool id (web <c>id</c>, e.g. <c>vin</c>, <c>jwt</c>).</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="NameKey">i18n key for the tool name (web <c>t(key)</c>).</param>
/// <param name="NameFallback">English fallback name (web translation default).</param>
/// <param name="DescriptionKey">i18n key for the tool description (web <c>t(key)</c>).</param>
/// <param name="DescriptionFallback">English fallback description (web translation default).</param>
/// <param name="AccentBrushKey">Semantic accent token key (web Tailwind neon <c>color</c>).</param>
public sealed record ClientUtilityTool(
    string Id,
    string Glyph,
    string NameKey,
    string NameFallback,
    string DescriptionKey,
    string DescriptionFallback,
    string AccentBrushKey);

/// <summary>
/// One projected, render-ready tool card consumed by the WinUI view (the web <c>ExpandableToolCard</c>).
/// <see cref="Name"/> and <see cref="Description"/> are already resolved through the i18n facade
/// (web <c>t(nameKey)</c> / <c>t(descKey)</c>), and <see cref="AutomationName"/> is the Narrator name for
/// the whole disclosure (name + description, mirroring the web button's accessible content). Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable tool id the card toggles / hosts.</param>
/// <param name="Glyph">Segoe Fluent glyph for the tinted icon chip.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the icon tint / chip.</param>
/// <param name="Name">Localized tool name.</param>
/// <param name="Description">Localized tool description.</param>
/// <param name="AutomationName">Narrator name for the disclosure (name + description).</param>
public sealed record ClientUtilityToolCard(
    string Id,
    string Glyph,
    string AccentBrushKey,
    string Name,
    string Description,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view for one search query — the native analogue of the web
/// <c>filtered</c> list render: the ordered tool cards that matched the search, plus the registry size
/// (<see cref="TotalCount"/>) so a "showing N of M" affordance and tests can reason about the unfiltered
/// catalog. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Cards">The ordered, search-matched tool cards (web <c>filtered.map</c>).</param>
/// <param name="TotalCount">The total number of tools in the registry before filtering (web <c>tools.length</c>).</param>
public sealed record ClientUtilitiesDisplay(IReadOnlyList<ClientUtilityToolCard> Cards, int TotalCount);

/// <summary>
/// Canonical registry metadata for the Client Utilities surface — the native mirror of the web devtools
/// <c>ClientUtilitiesSection</c>. The diagnostics <see cref="Slug"/> is the stable surface identifier emitted
/// with the <c>view.opened</c> event (P1/S11 diagnostics contract); the localized <see cref="Name(ILocalizer)"/> /
/// <see cref="Description(ILocalizer)"/> back the surface's Narrator name and any host chrome.
/// </summary>
public static class ClientUtilitiesRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "client-utilities";

    /// <summary>Surface category (the web devtools live under the admin feature).</summary>
    public const string Category = "admin";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ClientUtilitiesSection";

    /// <summary>Localized surface display name.</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("devtools.clientUtilities.title", "Client Utilities");
    }

    /// <summary>Localized surface description.</summary>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "devtools.clientUtilities.description",
            "Offline developer utilities that run entirely on this device");
    }
}

/// <summary>
/// Pure projection from the canonical <see cref="ClientUtilityTool"/> registry to the render-ready
/// <see cref="ClientUtilitiesDisplay"/> — the native port of the web <c>useToolList</c> + <c>filtered</c>
/// pipeline in web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx. Every name and
/// description resolves through the i18n facade before filtering, so the search matches the localized text
/// exactly as the web filters the resolved <c>tool.name</c> / <c>tool.desc</c> (case-insensitive substring
/// on either field). The Narrator name joins name and description as the web disclosure's accessible name
/// does. No SI conversion applies (the surface carries no measurements).
/// </summary>
public static class ClientUtilitiesProjection
{
    /// <summary>Segoe Fluent chevron-down glyph (web <c>ChevronDown</c>) shown on each disclosure header.</summary>
    public const string ChevronGlyph = "\uE70D";

    /// <summary>
    /// Project <paramref name="tools"/> for <paramref name="search"/>, resolving every label through
    /// <paramref name="localizer"/> and filtering on the localized name or description (web
    /// <c>tool.name.toLowerCase().includes(q) || tool.desc.toLowerCase().includes(q)</c>). A blank or
    /// whitespace-only query returns every tool in registry order (web <c>if (!search.trim()) return tools</c>).
    /// </summary>
    /// <param name="tools">The canonical tool registry to project.</param>
    /// <param name="search">The current search query (null / blank returns every tool).</param>
    /// <param name="localizer">The i18n facade resolving every name and description.</param>
    public static ClientUtilitiesDisplay Project(
        IReadOnlyList<ClientUtilityTool> tools,
        string? search,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(tools);
        ArgumentNullException.ThrowIfNull(localizer);

        string query = (search ?? string.Empty).Trim();
        bool filtering = query.Length > 0;

        var cards = new List<ClientUtilityToolCard>(tools.Count);
        foreach (var tool in tools)
        {
            string name = localizer.GetString(tool.NameKey, tool.NameFallback);
            string description = localizer.GetString(tool.DescriptionKey, tool.DescriptionFallback);

            if (filtering && !Matches(name, description, query))
            {
                continue;
            }

            string automationName = string.Create(CultureInfo.CurrentCulture, $"{name}, {description}");
            cards.Add(new ClientUtilityToolCard(
                tool.Id,
                tool.Glyph,
                tool.AccentBrushKey,
                name,
                description,
                automationName));
        }

        return new ClientUtilitiesDisplay(cards, tools.Count);
    }

    /// <summary>True when <paramref name="query"/> is a case-insensitive substring of the name or description.</summary>
    private static bool Matches(string name, string description, string query) =>
        name.Contains(query, StringComparison.CurrentCultureIgnoreCase) ||
        description.Contains(query, StringComparison.CurrentCultureIgnoreCase);
}

/// <summary>
/// PII-safe diagnostics for the Client Utilities surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a tool name, search query or any user
/// data — so a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class ClientUtilitiesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public ClientUtilitiesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ClientUtilitiesSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ClientUtilitiesRegistration.Slug}");
    }
}
