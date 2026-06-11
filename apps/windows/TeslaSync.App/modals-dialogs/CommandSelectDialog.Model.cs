using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// One selectable option in the <c>CommandSelectDialog</c> — the native analogue of the web <c>SelectOption</c>
/// (web/src/features/system/commands.ts). <see cref="LabelKey"/> / <see cref="LabelFallback"/> resolve through the
/// i18n facade (web <c>t(opt.labelKey, opt.labelFallback)</c>); <see cref="Description"/> is the optional, already
/// human-readable sub-line rendered verbatim (web renders <c>opt.description</c> directly, not through <c>t()</c>).
/// <see cref="Value"/> is the command-parameter payload emitted when the option is chosen (web <c>onSelect(opt.value)</c>).
/// </summary>
public sealed record CommandSelectOption(string Value, string LabelKey, string LabelFallback, string? Description = null);

/// <summary>
/// The command-select request the dialog renders — the native analogue of the web <c>def</c> +
/// <c>def.selectConfig</c> props of <c>CommandSelectDialog</c> (web/src/features/system/components/CommandSelectDialog.tsx).
/// It carries the keyed title (web <c>t(def.labelKey, def.labelFallback)</c>), the leading icon glyph (web
/// <c>def.icon</c>), the parameter name the chosen value populates (web <c>sc.paramName</c>) and the list of
/// <see cref="CommandSelectOption"/>s. The view never fetches this — the parent (web Vehicle Commands page) supplies it.
/// </summary>
public sealed class CommandSelectRequest
{
    /// <summary>Creates the request over its keyed title, parameter name, options and optional icon glyph.</summary>
    /// <param name="titleKey">The i18n key for the dialog title (web <c>def.labelKey</c>).</param>
    /// <param name="titleFallback">The English fallback for the title (web <c>def.labelFallback</c>).</param>
    /// <param name="paramName">The command parameter the chosen value populates (web <c>sc.paramName</c>).</param>
    /// <param name="options">The selectable options (web <c>sc.options</c>); null entries are dropped.</param>
    /// <param name="iconGlyph">Optional Segoe Fluent glyph for the leading icon (web <c>def.icon</c>).</param>
    public CommandSelectRequest(
        string titleKey,
        string titleFallback,
        string paramName,
        IEnumerable<CommandSelectOption>? options,
        string? iconGlyph = null)
    {
        TitleKey = titleKey ?? string.Empty;
        TitleFallback = titleFallback ?? string.Empty;
        ParamName = paramName ?? string.Empty;
        Options = CommandSelectProjection.Normalize(options);
        IconGlyph = string.IsNullOrWhiteSpace(iconGlyph) ? CommandSelectRegistration.DefaultIconGlyph : iconGlyph!;
    }

    /// <summary>The i18n key for the dialog title (web <c>def.labelKey</c>).</summary>
    public string TitleKey { get; }

    /// <summary>The English fallback for the title (web <c>def.labelFallback</c>).</summary>
    public string TitleFallback { get; }

    /// <summary>The command parameter the chosen value populates (web <c>sc.paramName</c>).</summary>
    public string ParamName { get; }

    /// <summary>The normalized (null-dropped, order-preserving) list of options (web <c>sc.options</c>).</summary>
    public IReadOnlyList<CommandSelectOption> Options { get; }

    /// <summary>The leading icon glyph (web <c>def.icon</c>); defaults to <see cref="CommandSelectRegistration.DefaultIconGlyph"/>.</summary>
    public string IconGlyph { get; }
}

/// <summary>
/// A display-ready option — the native projection of a <see cref="CommandSelectOption"/> with its label resolved
/// through the i18n facade. The view binds these directly so it never resolves keys or recomputes the
/// description-visibility gate inline (web <c>{opt.description &amp;&amp; …}</c>).
/// </summary>
public sealed record CommandSelectResolvedOption(string Value, string Label, string? Description)
{
    /// <summary>True when a description sub-line should render (web truthiness <c>opt.description &amp;&amp;</c>: empty hides).</summary>
    public bool HasDescription => !string.IsNullOrEmpty(Description);
}

/// <summary>
/// Canonical slug, default icon and i18n keys for the <c>CommandSelectDialog</c> surface — the native mirror of
/// <c>web/src/features/system/components/CommandSelectDialog.tsx</c>. The only literal copy intrinsic to the web
/// component is the Cancel label (<c>t('common.cancel', 'Cancel')</c>); the title and per-option labels are
/// caller-supplied dynamic keys resolved through the i18n facade. The empty-state copy has no web counterpart (the
/// web maps over a non-empty option list) and is keyed here so the native empty branch is never a blank box. UI-free
/// so every key, fallback and bound is asserted headlessly.
/// </summary>
public static class CommandSelectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CommandSelectDialog";

    /// <summary>Default leading icon glyph (Segoe Fluent — <c>Repair/Options</c>) when the request supplies none.</summary>
    public const string DefaultIconGlyph = "\uE71C";

    /// <summary>Cancel button label (web <c>t('common.cancel', 'Cancel')</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>
    /// Friendly empty-state message shown when the request carries no options. The web component always renders a
    /// non-empty option list, so this copy is native-only and keyed (with its English fallback) so the empty branch
    /// resolves through the i18n facade rather than a hardcoded literal.
    /// </summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("commands.select.noOptions", "No options available");

    /// <summary>Resolve the dialog title from a request (web <c>t(def.labelKey, def.labelFallback)</c>).</summary>
    public static string Title(ILocalizer localizer, CommandSelectRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return Require(localizer).GetString(request.TitleKey, request.TitleFallback);
    }

    /// <summary>Resolve a single option's label (web <c>t(opt.labelKey, opt.labelFallback)</c>).</summary>
    public static string OptionLabel(ILocalizer localizer, CommandSelectOption option)
    {
        ArgumentNullException.ThrowIfNull(option);
        return Require(localizer).GetString(option.LabelKey, option.LabelFallback);
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>CommandSelectDialog</c> surface — the native analogue of the web component's
/// <c>sc.options.map(…)</c> render: dropping unusable entries, resolving each label through the i18n facade and
/// detecting the empty branch. UI-free so the option-resolution and empty-gate are unit-tested headlessly and the
/// view-model never recomputes them inline.
/// </summary>
public static class CommandSelectProjection
{
    /// <summary>
    /// Normalize the supplied options to the renderable list — null input becomes empty and null entries are
    /// dropped (null safety), while order and every non-null option are preserved (web maps the list as given).
    /// </summary>
    public static IReadOnlyList<CommandSelectOption> Normalize(IEnumerable<CommandSelectOption>? options)
    {
        if (options is null)
        {
            return Array.Empty<CommandSelectOption>();
        }

        var list = new List<CommandSelectOption>();
        foreach (var option in options)
        {
            if (option is not null)
            {
                list.Add(option);
            }
        }

        return list;
    }

    /// <summary>True when there is nothing to choose from (the native empty branch); web never hits this.</summary>
    public static bool IsEmpty(IReadOnlyList<CommandSelectOption>? options) => (options?.Count ?? 0) == 0;

    /// <summary>Resolve one option for display (web <c>t(opt.labelKey, …)</c> + the verbatim description).</summary>
    public static CommandSelectResolvedOption Resolve(ILocalizer localizer, CommandSelectOption option)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(option);
        return new CommandSelectResolvedOption(
            option.Value ?? string.Empty,
            CommandSelectRegistration.OptionLabel(localizer, option),
            option.Description);
    }

    /// <summary>Resolve every option for display, preserving order (web <c>sc.options.map(…)</c>).</summary>
    public static IReadOnlyList<CommandSelectResolvedOption> ResolveAll(
        ILocalizer localizer,
        IEnumerable<CommandSelectOption>? options)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var resolved = new List<CommandSelectResolvedOption>();
        foreach (var option in Normalize(options))
        {
            resolved.Add(Resolve(localizer, option));
        }

        return resolved;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>CommandSelectDialog</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the chosen command value or option labels — so a diagnostics
/// line can never leak which command a user issued. Thread-safe.
/// </summary>
public sealed class CommandSelectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _optionsSelected;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandSelectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of option selections emitted from this surface.</summary>
    public long OptionsSelected => Interlocked.Read(ref _optionsSelected);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandSelectDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={CommandSelectRegistration.Slug}"));
    }

    /// <summary>Record that an option was chosen (the value / label are never logged).</summary>
    public void RecordOptionSelected()
    {
        Interlocked.Increment(ref _optionsSelected);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"command.optionSelected slug={CommandSelectRegistration.Slug}"));
    }
}
