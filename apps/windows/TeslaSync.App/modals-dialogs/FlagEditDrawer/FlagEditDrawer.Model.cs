using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// One feature-flag row in the shape the editor binds to — the native mirror of the web
/// <c>FeatureFlagEntry</c> (web/src/types/admin-diagnostics.ts: <c>{ key, value }</c>). The backend stores the
/// value as arbitrary JSONB, so the web surfaces it as <c>unknown</c>; the native carries it as a parsed
/// <see cref="System.Text.Json.JsonElement"/> so any JSON value (object / array / scalar / null) round-trips
/// faithfully. The drawer receives this as its <c>initial</c> input (null = "create new" mode).
/// </summary>
public sealed record FeatureFlagEntry(string Key, JsonElement Value)
{
    /// <summary>
    /// Build an entry from a key and a raw JSON string, parsing + cloning the value so it is independent of the
    /// transient parse document. Throws <see cref="JsonException"/> when the value is not valid JSON.
    /// </summary>
    public static FeatureFlagEntry FromJson(string key, string valueJson)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(valueJson);
        using var document = JsonDocument.Parse(valueJson);
        return new FeatureFlagEntry(key, document.RootElement.Clone());
    }
}

/// <summary>
/// The payload the drawer emits when the operator saves — the native mirror of the object the web passes to
/// <c>onSave({ key, value, reason })</c>. <see cref="Key"/> and <see cref="Reason"/> are already trimmed; the
/// backend audit row rejects an empty reason, which is why the save gate requires it. <see cref="ValueJson"/>
/// is the canonical compact serialization of the parsed value (the body the set-flag mutation posts).
/// </summary>
public sealed record FlagEditSaveRequest(string Key, JsonElement Value, string Reason)
{
    /// <summary>The canonical compact JSON serialization of <see cref="Value"/> (the wire body).</summary>
    public string ValueJson => JsonSerializer.Serialize(Value);
}

/// <summary>
/// The result of parsing the free-form value textarea — the native mirror of the web <c>parsed</c> memo
/// (<c>{ ok, value?, error? }</c>). On success <see cref="Ok"/> is true and <see cref="Value"/> carries the
/// parsed JSON; on failure <see cref="Ok"/> is false and <see cref="Error"/> carries the localized helper text
/// (the empty-value or invalid-JSON message) that disables the save button and renders under the field.
/// </summary>
public sealed class FlagValueParse
{
    private FlagValueParse(bool ok, JsonElement value, string? error)
    {
        Ok = ok;
        Value = value;
        Error = error;
    }

    /// <summary>True when the textarea held a parseable JSON value.</summary>
    public bool Ok { get; }

    /// <summary>The parsed JSON value when <see cref="Ok"/> is true; <c>default</c> otherwise.</summary>
    public JsonElement Value { get; }

    /// <summary>The localized parse-error helper text when <see cref="Ok"/> is false; <c>null</c> otherwise.</summary>
    public string? Error { get; }

    /// <summary>A successful parse carrying the parsed JSON value.</summary>
    public static FlagValueParse Valid(JsonElement value) => new(true, value, null);

    /// <summary>A failed parse carrying the localized helper text.</summary>
    public static FlagValueParse Invalid(string error) => new(false, default, error);
}

/// <summary>
/// Canonical metadata + localized copy for the feature-flag edit / create drawer — the native mirror of the web
/// component's identity and every <c>t('admin.flags.*')</c> / <c>t('common.cancel')</c> call site
/// (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx). Carries the diagnostics surface slug,
/// the (non-localized) JSON example hint the web hardcodes, and a label helper per i18n key. Every key is
/// the catalog key (<c>translation.*</c> in <c>Strings/{lang}/Resources.resw</c>, P1/S10) and every fallback is
/// the web default; the two interpolated keys (edit title, invalid-JSON) resolve to a <c>{0}</c> format string
/// (the resw form of the web <c>{{key}}</c> / <c>{{msg}}</c> token) and are spliced with
/// <see cref="string.Format(IFormatProvider, string, object?)"/>.
/// </summary>
public static class FlagEditDrawerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FlagEditDrawer";

    /// <summary>
    /// The value textarea's example JSON hint. The web hardcodes this JSON snippet inline (it is not a
    /// translated string), so the native mirrors it verbatim rather than routing it through the i18n facade.
    /// </summary>
    public const string ValuePrompt = "{\n  \"enabled\": true\n}";

    /// <summary>Drawer title in "create new" mode (web <c>admin.flags.drawer.createTitle</c>).</summary>
    public static string CreateTitle(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.drawer.createTitle", "Create flag");

    /// <summary>Drawer title in "edit existing" mode, interpolated with the flag key (web <c>admin.flags.drawer.editTitle</c>).</summary>
    public static string EditTitle(ILocalizer localizer, string key) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Require(localizer).GetString("translation.admin.flags.drawer.editTitle", "Edit flag \"{0}\""),
            key ?? string.Empty);

    /// <summary>Save button label (web <c>admin.flags.drawer.save</c>).</summary>
    public static string SaveLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.drawer.save", "Save flag");

    /// <summary>Cancel button label (web <c>common.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.common.cancel", "Cancel");

    /// <summary>Flag-key field label (web <c>admin.flags.editor.keyLabel</c>).</summary>
    public static string KeyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.editor.keyLabel", "Flag key");

    /// <summary>Flag-key field input hint (shown when empty).</summary>
    public static string KeyPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.editor.keyPlaceholder", "feature.dlq.replay_enabled"); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>Immutable-key note shown in edit mode (web <c>admin.flags.editor.keyImmutable</c>).</summary>
    public static string KeyImmutableNote(ILocalizer localizer) =>
        Require(localizer).GetString(
            "translation.admin.flags.editor.keyImmutable",
            "Flag keys are immutable once created. Delete + re-create to rename.");

    /// <summary>Value field label (web <c>admin.flags.editor.valueLabel</c>).</summary>
    public static string ValueLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.editor.valueLabel", "Value (JSON)");

    /// <summary>Reason field label (web <c>admin.flags.editor.reasonLabel</c>).</summary>
    public static string ReasonLabel(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.editor.reasonLabel", "Reason");

    /// <summary>Reason field input hint (shown when empty).</summary>
    public static string ReasonPrompt(ILocalizer localizer) =>
        Require(localizer).GetString(
            "translation.admin.flags.editor.reasonPlaceholder", // parity:allow web i18n key kept verbatim for catalog parity
            "Why this change? (logged in audit)");

    /// <summary>Empty-value helper text (web <c>admin.flags.editor.valueEmpty</c>).</summary>
    public static string ValueEmptyError(ILocalizer localizer) =>
        Require(localizer).GetString("translation.admin.flags.editor.valueEmpty", "Value is required.");

    /// <summary>Invalid-JSON helper text, interpolated with the parser message (web <c>admin.flags.editor.valueInvalid</c>).</summary>
    public static string ValueInvalidError(ILocalizer localizer, string message) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Require(localizer).GetString("translation.admin.flags.editor.valueInvalid", "Invalid JSON: {0}"),
            message ?? string.Empty);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// UI-free projection logic for the feature-flag editor — the native mirror of the web component's
/// <c>defaultValueJson</c> seed, the <c>parsed</c> JSON memo, and the <c>keyValid</c> / <c>reasonValid</c> /
/// <c>canSave</c> gate. Pure and side-effect free so every branch is asserted headlessly.
/// </summary>
public static class FlagEditDrawerProjection
{
    private static readonly JsonSerializerOptions IndentedOptions = new() { WriteIndented = true };

    /// <summary>
    /// The seed for the value textarea — the web <c>defaultValueJson(initial)</c>: an empty string in "create"
    /// mode, otherwise the entry's value pretty-printed with two-space indentation (web
    /// <c>JSON.stringify(initial.value, null, 2)</c>).
    /// </summary>
    public static string DefaultValueJson(FeatureFlagEntry? initial) =>
        initial is null ? string.Empty : JsonSerializer.Serialize(initial.Value, IndentedOptions);

    /// <summary>
    /// Parse the value textarea — the web <c>parsed</c> memo. An empty / whitespace value is the "value
    /// required" branch; otherwise the text is parsed as JSON, succeeding for any JSON value and surfacing the
    /// parser message on failure. <paramref name="localizer"/> supplies the localized helper text.
    /// </summary>
    public static FlagValueParse ParseValue(string? raw, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string text = raw ?? string.Empty;
        if (text.Trim().Length == 0)
        {
            return FlagValueParse.Invalid(FlagEditDrawerRegistration.ValueEmptyError(localizer));
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            return FlagValueParse.Valid(document.RootElement.Clone());
        }
        catch (JsonException ex)
        {
            return FlagValueParse.Invalid(FlagEditDrawerRegistration.ValueInvalidError(localizer, ex.Message));
        }
    }

    /// <summary>True once the trimmed key is non-empty (web <c>keyInput.trim().length &gt; 0</c>).</summary>
    public static bool IsKeyValid(string? key) => (key ?? string.Empty).Trim().Length > 0;

    /// <summary>True once the trimmed reason is non-empty (web <c>reason.trim().length &gt; 0</c>).</summary>
    public static bool IsReasonValid(string? reason) => (reason ?? string.Empty).Trim().Length > 0;

    /// <summary>
    /// The save gate — the web <c>canSave = parsed.ok &amp;&amp; keyValid &amp;&amp; reasonValid &amp;&amp; !saving</c>.
    /// </summary>
    public static bool CanSave(bool valueOk, string? key, string? reason, bool saving) =>
        valueOk && IsKeyValid(key) && IsReasonValid(reason) && !saving;
}

/// <summary>
/// PII-safe diagnostics for the <c>FlagEditDrawer</c> surface (P1/S11 diagnostics contract). The drawer edits
/// privileged feature-flag values and an audited reason, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never a flag key, value, or reason. Thread-safe.
/// </summary>
public sealed class FlagEditDrawerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FlagEditDrawerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the drawer has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the drawer was opened, emitting <c>view.opened slug=FlagEditDrawer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={FlagEditDrawerRegistration.Slug}"));
    }
}
