using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The render-time data model a <c>CommandSearch</c> view binds to — the native analogue of the web
/// component's props (web/src/features/system/components/CommandSearch.tsx). The web source is a thin,
/// fully-controlled text field: it owns no state of its own, taking the current query string as <c>value</c>
/// and reporting every edit through <c>onChange</c>. The model therefore carries just that controlled
/// <see cref="Value"/>; the parent (the command palette) owns it. Pure data — no WinUI types — so the
/// projection that consumes it is unit-tested without a UI host.
/// </summary>
/// <param name="Value">The current query text the field shows (web <c>value</c>); null is treated as empty.</param>
public sealed record CommandSearchModel(string? Value = null)
{
    /// <summary>The initial model for a freshly constructed view: an empty query.</summary>
    public static CommandSearchModel Empty { get; } = new((string?)null);
}

/// <summary>
/// The fully projected, render-ready view of a <c>CommandSearch</c> field — the native analogue of
/// everything the web component resolves before returning JSX
/// (web/src/features/system/components/CommandSearch.tsx). The web source is purely presentational with no
/// fetch lifecycle, so — exactly like the sibling <see cref="SettingFieldDisplay"/> — there is deliberately
/// no loading / error / stale / offline branch to reproduce: there is nothing to fetch, fail, go stale or
/// fall offline (the command palette that hosts this field owns the command list and its query lifecycle).
/// The web's only render-affecting distinction is whether the field is empty (the empty-field prompt shows)
/// or holds a query, captured here by <see cref="HasValue"/> so the empty and populated surfaces are both
/// reproduced explicitly. Holds the normalized <see cref="Value"/> (null coerced to empty — the field text),
/// the resolved <see cref="PromptText"/> (the web empty-field prompt), the <see cref="AccessibleName"/> (the
/// field's Narrator name) and whether the field currently holds text (<see cref="HasValue"/>). Pure data so
/// every branch is asserted headlessly.
/// </summary>
/// <param name="Value">The field text (web <c>value</c>), with null coerced to empty.</param>
/// <param name="PromptText">The localized empty-field prompt (the web prompt copy).</param>
/// <param name="AccessibleName">The field's accessible (Narrator) name.</param>
/// <param name="HasValue">Whether the field holds text; when false the empty-field prompt is shown.</param>
public sealed record CommandSearchDisplay(
    string Value,
    string PromptText,
    string AccessibleName,
    bool HasValue);

/// <summary>
/// Pure projection from a <see cref="CommandSearchModel"/> to its <see cref="CommandSearchDisplay"/> — the
/// native port of web/src/features/system/components/CommandSearch.tsx. Normalizes the controlled value
/// (null → empty, matching the web default), resolves the localized empty-field prompt — which doubles as the
/// field's accessible name, exactly as the web <c>&lt;input&gt;</c> derives its accessible name from its
/// prompt when no separate label is supplied — and reports whether the field holds text. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class CommandSearchProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the prompt / accessible name resolve through.</param>
    public static CommandSearchDisplay Project(CommandSearchModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string value = model.Value ?? string.Empty;
        string prompt = CommandSearchRegistration.PromptText(localizer);

        return new CommandSearchDisplay(value, prompt, prompt, value.Length > 0);
    }
}

/// <summary>
/// Canonical registry metadata for the <c>CommandSearch</c> surface — the native mirror of the web component
/// (web/src/features/system/components/CommandSearch.tsx). Centralises the diagnostics slug, the Segoe Fluent
/// search glyph standing in for the web Lucide <c>Search</c> icon, and the single component-level i18n key
/// (the field's empty-field prompt). The key is resolved through the P1/S10 facade verbatim from the web
/// source (it already exists in the en catalog); the English fallback doubles as the headless / unit-test
/// value. UI-free so the metadata is asserted in tests.
/// </summary>
public static class CommandSearchRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "CommandSearch";

    /// <summary>Segoe Fluent "Search" glyph — the native stand-in for the web Lucide <c>Search</c> icon.</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>i18n key for the field's empty-field prompt (the web <c>t()</c> prompt key).</summary>
    public const string PromptKey = "commands.search.placeholder"; // parity:allow web i18n key literally named placeholder

    /// <summary>English fallback for the prompt — verbatim from the web source.</summary>
    public const string PromptFallback = "Search commands...";

    /// <summary>The localized empty-field prompt text (the web prompt copy).</summary>
    /// <param name="localizer">The i18n facade the prompt resolves through.</param>
    public static string PromptText(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(PromptKey, PromptFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>CommandSearch</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the typed query — so a diagnostics line
/// can never leak what a user searched for. Thread-safe.
/// </summary>
public sealed class CommandSearchDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public CommandSearchDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandSearch</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CommandSearchRegistration.Slug}");
    }
}
