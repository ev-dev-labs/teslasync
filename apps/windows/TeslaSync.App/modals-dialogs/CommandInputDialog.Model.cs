using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The kind of client-side validation a command-input field runs — the native mirror of the web
/// <c>InputField.validation</c> / <c>InputConfig.validation</c> union
/// (<c>'pin' | 'number' | 'decimal' | 'text'</c>, web/src/features/system/commands.ts). It drives both the
/// validation rule (<see cref="CommandInputProjection.Validate"/>) and the field's secret / numeric input
/// affordance (web <c>resolveInputType</c> / <c>resolveInputMode</c>).
/// </summary>
public enum CommandInputValidation
{
    /// <summary>Free text — only the required check applies (web <c>'text'</c> / no validation).</summary>
    Text,

    /// <summary>A 4-digit PIN, masked on entry (web <c>'pin'</c> → <c>type="password"</c>).</summary>
    Pin,

    /// <summary>A whole number within the optional min/max bounds (web <c>'number'</c>).</summary>
    Number,

    /// <summary>A decimal number within the optional min/max bounds (web <c>'decimal'</c>).</summary>
    Real,
}

/// <summary>Wire mapping for <see cref="CommandInputValidation"/> — UI-free so it is asserted headlessly.</summary>
public static class CommandInputValidations
{
    /// <summary>The lower-case web token for <paramref name="validation"/> (web union member).</summary>
    public static string ToToken(CommandInputValidation validation) => validation switch
    {
        CommandInputValidation.Pin => "pin",
        CommandInputValidation.Number => "number",
        CommandInputValidation.Real => "decimal",
        _ => "text",
    };

    /// <summary>
    /// Parse a web validation token to a <see cref="CommandInputValidation"/>; an unknown / null token maps to
    /// <see cref="CommandInputValidation.Text"/> (web parity — the <c>default</c> branch performs no validation).
    /// </summary>
    public static CommandInputValidation FromToken(string? token) => token switch
    {
        "pin" => CommandInputValidation.Pin,
        "number" => CommandInputValidation.Number,
        "decimal" => CommandInputValidation.Real,
        _ => CommandInputValidation.Text,
    };
}

/// <summary>
/// One field of a multi-field command-input form — the native mirror of the web <c>InputField</c>
/// (web/src/features/system/commands.ts). <see cref="LabelKey"/> / <see cref="LabelFallback"/> resolve the
/// field label through the i18n facade (web <c>t(field.labelKey, field.labelFallback)</c>); the input
/// type / mode are derived from <see cref="Validation"/> (web ignores <c>field.type</c> and uses
/// <c>resolveInputType(field.validation)</c>).
/// </summary>
public sealed record CommandInputField(
    string Name,
    string LabelKey,
    string LabelFallback,
    string? Hint = null,
    CommandInputValidation Validation = CommandInputValidation.Text,
    double? Min = null,
    double? Max = null);

/// <summary>
/// The command-input form the dialog binds — the native projection of a web <c>CommandDef</c> plus its
/// <c>inputConfig</c> (web/src/features/system/commands.ts). It carries the header copy (title + prompt + the
/// optional single-field sub-label + a Segoe Fluent header glyph standing in for the web lucide
/// <c>def.icon</c>) and the input shape: either a list of <see cref="Fields"/> (the multi-field branch, e.g.
/// HomeLink lat/lon) or a single parameter keyed by <see cref="ParamName"/> with its <see cref="Validation"/>
/// / <see cref="Min"/> / <see cref="Max"/> and an initial value (web <c>getDefaultValue?.({ vehicle }) ??
/// defaultValue ?? ''</c> via <see cref="ResolveDefaultValue"/> / <see cref="DefaultValue"/>). It is a plain,
/// WinUI-free data carrier so the projection + view-model are asserted headlessly.
/// </summary>
public sealed class CommandInputForm
{
    /// <summary>The dialog title i18n key (web <c>def.labelKey</c>).</summary>
    public required string TitleKey { get; init; }

    /// <summary>The dialog title English fallback (web <c>def.labelFallback</c>).</summary>
    public required string TitleFallback { get; init; }

    /// <summary>The single-field sub-label i18n key (web <c>def.sublabelKey</c>); null hides the label.</summary>
    public string? SubtitleKey { get; init; }

    /// <summary>The single-field sub-label fallback (web <c>def.sublabelFallback</c>); null hides the label.</summary>
    public string? SubtitleFallback { get; init; }

    /// <summary>A Segoe Fluent glyph standing in for the web lucide <c>def.icon</c>; empty hides the header icon.</summary>
    public string IconGlyph { get; init; } = string.Empty;

    /// <summary>The prompt i18n key shown under the title (web <c>ic.promptKey</c>).</summary>
    public required string PromptKey { get; init; }

    /// <summary>The prompt English fallback (web <c>ic.promptFallback</c>).</summary>
    public required string PromptFallback { get; init; }

    /// <summary>The single-field parameter name (web <c>ic.paramName</c>).</summary>
    public required string ParamName { get; init; }

    /// <summary>The single-field default value used as the input hint (web <c>ic.defaultValue</c>).</summary>
    public string? DefaultValue { get; init; }

    /// <summary>The single-field validation rule (web <c>ic.validation</c>).</summary>
    public CommandInputValidation Validation { get; init; } = CommandInputValidation.Text;

    /// <summary>The single-field lower bound for number/decimal validation (web <c>ic.min</c>).</summary>
    public double? Min { get; init; }

    /// <summary>The single-field upper bound for number/decimal validation (web <c>ic.max</c>).</summary>
    public double? Max { get; init; }

    /// <summary>
    /// The multi-field list (web <c>ic.fields</c>); when non-null the dialog renders one input per field and
    /// the single-field <see cref="ParamName"/> / <see cref="Validation"/> / bounds are not used.
    /// </summary>
    public IReadOnlyList<CommandInputField>? Fields { get; init; }

    /// <summary>
    /// Resolves the single-field initial value from the active vehicle's display name — the native analogue of
    /// the web <c>ic.getDefaultValue?.({ vehicle })</c> closure (the only real use is "Rename", which seeds the
    /// field with the current name). When set it takes precedence over <see cref="DefaultValue"/> (web parity).
    /// </summary>
    public Func<string?, string>? ResolveDefaultValue { get; init; }
}

/// <summary>
/// The submission the dialog emits — the native analogue of the web <c>onSubmit(values)</c> argument
/// (web/src/features/system/components/CommandInputDialog.tsx). <see cref="Values"/> maps each field name to
/// its raw entered value (a single <c>{ paramName: value }</c> entry in the single-field branch, or one entry
/// per <c>ic.fields</c> in the multi-field branch); the parent owns turning it into command parameters
/// (web <c>buildParams</c>).
/// </summary>
public sealed record CommandInputSubmission(IReadOnlyDictionary<string, string> Values);

/// <summary>
/// Canonical slug + the static i18n keys the <c>CommandInputDialog</c> surface owns — the native mirror of
/// <c>web/src/features/system/components/CommandInputDialog.tsx</c>. The dynamic copy (title, prompt, field
/// labels, sub-label) is keyed per command in the bound <see cref="CommandInputForm"/> and resolved through the
/// facade exactly like the web <c>t(def.labelKey, …)</c> calls; this registry keys the surface-owned literals:
/// the Cancel / Send buttons (web <c>t('common.cancel', 'Cancel')</c> / <c>t('common.send', 'Send')</c>) and
/// the validation messages the web component returns as bare strings (so the native view + view-model never
/// embed an English literal). UI-free so every key, fallback and the <c>{{min}}</c> / <c>{{max}}</c>
/// interpolation are asserted headlessly.
/// </summary>
public static class CommandInputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CommandInputDialog";

    /// <summary>Cancel button label (web <c>t('common.cancel', 'Cancel')</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>Submit button label (web <c>t('common.send', 'Send')</c>).</summary>
    public static string SubmitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.send", "Send");

    /// <summary>Required-field message (web <c>validateField</c> returns the literal <c>'Required'</c>).</summary>
    public static string RequiredMessage(ILocalizer localizer) =>
        Require(localizer).GetString("commands.input.required", "Required");

    /// <summary>PIN-format message (web <c>'Enter a 4-digit PIN'</c>).</summary>
    public static string PinMessage(ILocalizer localizer) =>
        Require(localizer).GetString("commands.input.pinFormat", "Enter a 4-digit PIN");

    /// <summary>Whole-number message (web <c>'Enter a whole number'</c>).</summary>
    public static string WholeNumberMessage(ILocalizer localizer) =>
        Require(localizer).GetString("commands.input.wholeNumber", "Enter a whole number");

    /// <summary>Decimal-number message (web <c>'Enter a valid number'</c>).</summary>
    public static string DecimalMessage(ILocalizer localizer) =>
        Require(localizer).GetString("commands.input.validNumber", "Enter a valid number");

    /// <summary>
    /// Minimum-bound message with the bound interpolated — the native analogue of web
    /// <c>`Minimum: ${min}`</c>. Resolves the keyed template then substitutes the i18next <c>{{min}}</c> token
    /// so a translated catalog string keeps the substitution point (the FeedbackModal interpolation convention).
    /// </summary>
    public static string MinimumMessage(ILocalizer localizer, double min)
    {
        string template = Require(localizer).GetString("commands.input.minimum", "Minimum: {{min}}");
        return template.Replace("{{min}}", FormatBound(min), StringComparison.Ordinal);
    }

    /// <summary>
    /// Maximum-bound message with the bound interpolated — the native analogue of web <c>`Maximum: ${max}`</c>
    /// (see <see cref="MinimumMessage"/> for the interpolation convention).
    /// </summary>
    public static string MaximumMessage(ILocalizer localizer, double max)
    {
        string template = Require(localizer).GetString("commands.input.maximum", "Maximum: {{max}}");
        return template.Replace("{{max}}", FormatBound(max), StringComparison.Ordinal);
    }

    /// <summary>
    /// Format a numeric bound the way the web template literal does (JS <c>${min}</c>): a whole value prints
    /// without a fractional part (<c>50</c>), a fractional value keeps it (<c>15.5</c>), invariant culture.
    /// </summary>
    public static string FormatBound(double bound) =>
        bound.ToString("0.################", CultureInfo.InvariantCulture);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>CommandInputDialog</c> surface — the native analogue of the web component's
/// <c>validateField</c> rule, its <c>buildInitialValues</c> seeding and its <c>isValid</c> submit gate
/// (web/src/features/system/components/CommandInputDialog.tsx). Every message flows through the i18n facade so
/// the rule is asserted headlessly and the view-model never recomputes it inline. The number / decimal parsers
/// reproduce JavaScript <c>parseInt(v, 10)</c> + <c>String(n) === v</c> and <c>parseFloat</c> semantics so the
/// accept / reject boundary matches the web byte-for-byte.
/// </summary>
public static partial class CommandInputProjection
{
    /// <summary>
    /// Validate a field value — the native analogue of web <c>validateField(value, validation, min, max)</c>.
    /// Returns the localized error message, or null when the value is acceptable. A blank value always fails the
    /// required check first (web <c>if (!trimmed) return 'Required'</c>); otherwise the rule depends on
    /// <paramref name="validation"/>.
    /// </summary>
    public static string? Validate(
        string? value,
        CommandInputValidation validation,
        double? min,
        double? max,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return CommandInputRegistration.RequiredMessage(localizer);
        }

        switch (validation)
        {
            case CommandInputValidation.Pin:
                return PinRegex().IsMatch(trimmed) ? null : CommandInputRegistration.PinMessage(localizer);

            case CommandInputValidation.Number:
                if (!TryParseJsInt(trimmed, out long whole))
                {
                    return CommandInputRegistration.WholeNumberMessage(localizer);
                }

                return CheckBounds(whole, min, max, localizer);

            case CommandInputValidation.Real:
                if (!TryParseJsFloat(trimmed, out double real))
                {
                    return CommandInputRegistration.DecimalMessage(localizer);
                }

                return CheckBounds(real, min, max, localizer);

            default:
                return null;
        }
    }

    /// <summary>
    /// Seed the form's values — the native analogue of web <c>buildInitialValues()</c>. The multi-field branch
    /// returns one empty entry per field (web <c>for (const f of fields) vals[f.name] = ''</c>); the
    /// single-field branch returns one entry keyed by <see cref="CommandInputForm.ParamName"/> whose value is
    /// <c>ResolveDefaultValue(vehicleDisplayName)</c> when supplied, else <see cref="CommandInputForm.DefaultValue"/>,
    /// else the empty string (web <c>getDefaultValue ? getDefaultValue({ vehicle }) : defaultValue ?? ''</c>).
    /// </summary>
    public static Dictionary<string, string> BuildInitialValues(CommandInputForm form, string? vehicleDisplayName)
    {
        ArgumentNullException.ThrowIfNull(form);

        if (form.Fields is { } fields)
        {
            var values = new Dictionary<string, string>(fields.Count, StringComparer.Ordinal);
            foreach (var field in fields)
            {
                values[field.Name] = string.Empty;
            }

            return values;
        }

        string seed = form.ResolveDefaultValue is { } resolve
            ? resolve(vehicleDisplayName) ?? string.Empty
            : form.DefaultValue ?? string.Empty;

        return new Dictionary<string, string>(1, StringComparer.Ordinal) { [form.ParamName] = seed };
    }

    /// <summary>
    /// The live submit gate — the native analogue of web <c>isValid()</c>. Returns true when every field passes
    /// <see cref="Validate"/> (the multi-field branch validates each <c>ic.fields</c> entry; the single-field
    /// branch validates <see cref="CommandInputForm.ParamName"/>). Missing entries are treated as empty so an
    /// absent required value keeps the gate closed.
    /// </summary>
    public static bool IsValid(
        CommandInputForm form,
        IReadOnlyDictionary<string, string> values,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(form);
        ArgumentNullException.ThrowIfNull(values);
        ArgumentNullException.ThrowIfNull(localizer);

        if (form.Fields is { } fields)
        {
            foreach (var field in fields)
            {
                if (Validate(Lookup(values, field.Name), field.Validation, field.Min, field.Max, localizer) is not null)
                {
                    return false;
                }
            }

            return true;
        }

        return Validate(Lookup(values, form.ParamName), form.Validation, form.Min, form.Max, localizer) is null;
    }

    /// <summary>
    /// Reproduces JavaScript <c>parseInt(v, 10)</c> followed by the web <c>String(num) !== v</c> guard: succeeds
    /// only when <paramref name="trimmed"/> is the canonical base-10 representation of an integer (rejecting
    /// leading zeros, a leading <c>+</c>, decimals, exponents and trailing text), returning the parsed value.
    /// </summary>
    public static bool TryParseJsInt(string trimmed, out long value)
    {
        value = 0;
        if (!long.TryParse(trimmed, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value))
        {
            return false;
        }

        return string.Equals(value.ToString(CultureInfo.InvariantCulture), trimmed, StringComparison.Ordinal);
    }

    /// <summary>
    /// Reproduces JavaScript <c>parseFloat(v)</c>: parses the leading numeric token (optional sign, digits,
    /// optional fraction, optional exponent), ignoring any trailing text (so <c>"1.5abc"</c> yields
    /// <c>1.5</c>), and fails (NaN) only when no number leads the string.
    /// </summary>
    public static bool TryParseJsFloat(string trimmed, out double value)
    {
        value = double.NaN;
        var match = LeadingFloatRegex().Match(trimmed);
        if (!match.Success || match.Index != 0)
        {
            return false;
        }

        string token = match.Value;
        if (token.EndsWith('.'))
        {
            token = token[..^1];
        }

        if (token.Length == 0 || token == "+" || token == "-")
        {
            return false;
        }

        return double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static string? CheckBounds(double value, double? min, double? max, ILocalizer localizer)
    {
        if (min is { } lo && value < lo)
        {
            return CommandInputRegistration.MinimumMessage(localizer, lo);
        }

        if (max is { } hi && value > hi)
        {
            return CommandInputRegistration.MaximumMessage(localizer, hi);
        }

        return null;
    }

    private static string Lookup(IReadOnlyDictionary<string, string> values, string name) =>
        values.TryGetValue(name, out var value) ? value : string.Empty;

    [GeneratedRegex(@"^\d{4}$")]
    private static partial Regex PinRegex();

    [GeneratedRegex(@"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")]
    private static partial Regex LeadingFloatRegex();
}

/// <summary>
/// PII-safe diagnostics for the <c>CommandInputDialog</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the entered PIN / value(s) — so a diagnostics line can
/// never leak a command parameter. Thread-safe.
/// </summary>
public sealed class CommandInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _submitted;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of submissions emitted from this surface.</summary>
    public long Submitted => Interlocked.Read(ref _submitted);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandInputDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={CommandInputRegistration.Slug}"));
    }

    /// <summary>Record that a submission was emitted (the entered values are never logged).</summary>
    public void RecordSubmitted()
    {
        Interlocked.Increment(ref _submitted);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"command.input.submitted slug={CommandInputRegistration.Slug}"));
    }
}
