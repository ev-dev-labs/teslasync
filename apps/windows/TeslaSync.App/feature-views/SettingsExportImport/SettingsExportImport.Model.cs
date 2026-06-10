using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive import-flow stage for the <see cref="SettingsExportImportViewModel"/> — the native
/// union of the <c>ImportStage</c> the web <c>SettingsExportImport</c> component renders
/// (web/src/features/settings/components/SettingsExportImport.tsx). That component is an action surface, not a
/// data widget: it never fetches on mount, so — exactly as the sibling client utilities document (see
/// <see cref="JwtDecoderState"/> and <see cref="AdvancedSettingsState"/>) — there is deliberately no
/// loading / empty / error / stale / offline lifecycle. The export flow's transient busy state and the import
/// flow's inline parse error are orthogonal flags carried by the view-model rather than stages. Every value
/// maps onto a visible surface (never a blank panel): <see cref="Idle"/> shows the drop zone / file picker,
/// <see cref="Parsing"/> swaps the picker label for a reading spinner, <see cref="Preview"/> renders the
/// dry-run per-section diff with the Apply / Cancel actions, and <see cref="Applied"/> renders the applied
/// per-section diff with the Done action.
/// </summary>
public enum SettingsExportImportState
{
    /// <summary>Resting state — the export row plus the import drop zone / file picker are shown.</summary>
    Idle,

    /// <summary>A file is being read and validated — the picker shows the reading spinner (web <c>parsing</c>).</summary>
    Parsing,

    /// <summary>The dry-run preview resolved — render the per-section diff and Apply / Cancel (web <c>preview</c>).</summary>
    Preview,

    /// <summary>The import was applied — render the applied per-section diff and Done (web <c>applied</c>).</summary>
    Applied,
}

/// <summary>
/// Shared constants mirroring the web settings-bundle schema
/// (web/src/lib/settingsImportSchema.ts). Kept WinUI-free so the schema is unit-tested headlessly and shared
/// by the validator, the source and the projection.
/// </summary>
public static class SettingsBundleConstants
{
    /// <summary>The schema_version this build emits and accepts (web <c>SETTINGS_BUNDLE_SCHEMA_VERSION</c>).</summary>
    public const int SchemaVersion = 1;

    /// <summary>The maximum import file size, 1 MiB — matches the backend <c>MaxSettingsImportBodyBytes</c> (web <c>MAX_IMPORT_FILE_BYTES</c>).</summary>
    public const long MaxImportFileBytes = 1L << 20;

    /// <summary>The <c>settings</c> section wire key (general settings object).</summary>
    public const string SettingsKey = "settings";

    /// <summary>The <c>alert_rules</c> section wire key (array).</summary>
    public const string AlertRulesKey = "alert_rules";

    /// <summary>The <c>geofences</c> section wire key (array).</summary>
    public const string GeofencesKey = "geofences";

    /// <summary>The <c>quiet_hours</c> section wire key (array).</summary>
    public const string QuietHoursKey = "quiet_hours";

    /// <summary>The ordered section keys carried in the bundle (web <c>SETTINGS_BUNDLE_SECTION_KEYS</c>).</summary>
    public static IReadOnlyList<string> SectionKeys { get; } =
        new[] { SettingsKey, AlertRulesKey, GeofencesKey, QuietHoursKey };

    /// <summary>The three array-valued section keys (everything except <c>settings</c>).</summary>
    public static IReadOnlyList<string> ArraySectionKeys { get; } =
        new[] { AlertRulesKey, GeofencesKey, QuietHoursKey };

    /// <summary>
    /// Build the user-facing export filename for <paramref name="now"/> — the UTC date keeps multiple exports
    /// distinguishable without exposing the locale-confusing hour (web <c>defaultExportFilename</c>).
    /// </summary>
    /// <param name="now">The instant to stamp (UTC date is used).</param>
    public static string DefaultExportFilename(DateTimeOffset now) =>
        string.Format(CultureInfo.InvariantCulture, "teslasync-settings-{0:yyyyMMdd}.json", now.ToUniversalTime());
}

/// <summary>
/// One section's diff/apply counts — the native analogue of the web <c>SettingsImportSectionResult</c>
/// (<c>{ added, updated, skipped, conflicts? }</c> in web/src/lib/settingsImportSchema.ts). Pure data.
/// </summary>
/// <param name="Added">Items that would be (or were) created.</param>
/// <param name="Updated">Items that would be (or were) overwritten by name.</param>
/// <param name="Skipped">Items left unchanged.</param>
/// <param name="Conflicts">Optional conflict descriptions surfaced by the backend.</param>
public sealed record SettingsImportSectionResult(
    int Added,
    int Updated,
    int Skipped,
    IReadOnlyList<string> Conflicts);

/// <summary>
/// The top-level import response shared by the dry-run and apply paths — the native analogue of the web
/// <c>SettingsImportResult</c> (web/src/lib/settingsImportSchema.ts). <see cref="Sections"/> carries only the
/// sections the backend returned; an absent section renders the em-dash marker. Pure data.
/// </summary>
/// <param name="DryRun">True when this is a preview (the <c>dry_run</c> echo).</param>
/// <param name="Sections">Per-section counts keyed by the section wire key (only present sections).</param>
public sealed record SettingsImportResult(
    bool DryRun,
    IReadOnlyDictionary<string, SettingsImportSectionResult> Sections)
{
    /// <summary>
    /// Parse the import endpoint's JSON response into a <see cref="SettingsImportResult"/>, reading only the
    /// four known sections (unknown keys are ignored, exactly as the web typed response narrows them).
    /// </summary>
    /// <param name="element">The raw JSON object returned by <c>POST /settings/import</c>.</param>
    public static SettingsImportResult FromJson(JsonElement element)
    {
        bool dryRun = element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("dry_run", out var dr)
            && dr.ValueKind is JsonValueKind.True or JsonValueKind.False
            && dr.GetBoolean();

        var sections = new Dictionary<string, SettingsImportSectionResult>(StringComparer.Ordinal);
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("sections", out var secs)
            && secs.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in SettingsBundleConstants.SectionKeys)
            {
                if (secs.TryGetProperty(key, out var s) && s.ValueKind == JsonValueKind.Object)
                {
                    sections[key] = new SettingsImportSectionResult(
                        ReadInt(s, "added"),
                        ReadInt(s, "updated"),
                        ReadInt(s, "skipped"),
                        ReadConflicts(s));
                }
            }
        }

        return new SettingsImportResult(dryRun, sections);
    }

    private static int ReadInt(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;

    private static IReadOnlyList<string> ReadConflicts(JsonElement obj)
    {
        if (!obj.TryGetProperty("conflicts", out var c) || c.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(c.GetArrayLength());
        foreach (var item in c.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } s)
            {
                list.Add(s);
            }
        }

        return list;
    }
}

/// <summary>
/// The summed import counts — the native analogue of the web <c>summariseImportResult</c> return
/// (web/src/lib/settingsImportSchema.ts). <see cref="Total"/> is <c>added + updated</c> (skipped is excluded)
/// because it drives the Apply button's "N change(s)" label and its disabled-when-zero gate.
/// </summary>
/// <param name="Added">Total items added across every section.</param>
/// <param name="Updated">Total items updated across every section.</param>
/// <param name="Skipped">Total items skipped across every section.</param>
/// <param name="Total">The actionable change count (<c>Added + Updated</c>).</param>
public sealed record SettingsImportSummary(int Added, int Updated, int Skipped, int Total)
{
    /// <summary>Sum every section's counts into a single summary (web <c>summariseImportResult</c>).</summary>
    /// <param name="result">The dry-run or apply result to summarise.</param>
    public static SettingsImportSummary From(SettingsImportResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        int added = 0, updated = 0, skipped = 0;
        foreach (var section in result.Sections.Values)
        {
            added += section.Added;
            updated += section.Updated;
            skipped += section.Skipped;
        }

        return new SettingsImportSummary(added, updated, skipped, added + updated);
    }
}

/// <summary>
/// The category of a settings-bundle validation failure — the native, localizable replacement for the web
/// validator's hard-coded English strings (<c>validateSettingsBundle</c> in
/// web/src/lib/settingsImportSchema.ts). Reproduces every branch the web rejects so a corrupt upload is caught
/// locally before any network round-trip, while routing the message through the i18n facade rather than the
/// web's literal strings.
/// </summary>
public enum SettingsBundleErrorKind
{
    /// <summary>The root value is not a JSON object (web <c>"Bundle must be a JSON object"</c>).</summary>
    NotObject,

    /// <summary>schema_version is missing / non-numeric / below one (web <c>"schema_version must be a positive integer"</c>).</summary>
    VersionInvalid,

    /// <summary>schema_version is newer than this build supports (web <c>"… newer than this build supports …"</c>).</summary>
    VersionNewer,

    /// <summary>exported_at is missing or blank (web <c>"exported_at must be a non-empty ISO-8601 string"</c>).</summary>
    ExportedAtInvalid,

    /// <summary>sections is not a JSON object (web <c>"sections must be a JSON object"</c>).</summary>
    SectionsNotObject,

    /// <summary>An unknown section key is present (web <c>Unknown section "X"</c>).</summary>
    UnknownSection,

    /// <summary>sections.settings is present but not an object (web <c>"sections.settings must be an object"</c>).</summary>
    SettingsNotObject,

    /// <summary>An array section is present but not an array (web <c>"sections.K must be an array"</c>).</summary>
    SectionNotArray,
}

/// <summary>
/// A settings-bundle validation failure carrying the <see cref="Kind"/> plus the data its localized message
/// interpolates. Kept UI-free; <see cref="Localize"/> resolves the message through the i18n facade so the same
/// failure that the web renders as a hard-coded English string renders as a catalog string here.
/// </summary>
/// <param name="Kind">The failure category.</param>
/// <param name="Version">The offending schema_version (for <see cref="SettingsBundleErrorKind.VersionNewer"/>).</param>
/// <param name="SectionKey">The offending section key (for unknown-section / non-array failures).</param>
public sealed record SettingsBundleError(
    SettingsBundleErrorKind Kind,
    double Version = 0,
    string? SectionKey = null)
{
    /// <summary>i18n key for the not-an-object failure.</summary>
    public const string NotObjectKey = "backup.import.errorNotObject";

    /// <summary>i18n key for the invalid-version failure.</summary>
    public const string VersionInvalidKey = "backup.import.errorVersion";

    /// <summary>i18n key for the version-too-new failure.</summary>
    public const string VersionNewerKey = "backup.import.errorVersionNewer";

    /// <summary>i18n key for the invalid-exported_at failure.</summary>
    public const string ExportedAtKey = "backup.import.errorExportedAt";

    /// <summary>i18n key for the sections-not-an-object failure.</summary>
    public const string SectionsNotObjectKey = "backup.import.errorSectionsObject";

    /// <summary>i18n key for the unknown-section failure.</summary>
    public const string UnknownSectionKey = "backup.import.errorUnknownSection";

    /// <summary>i18n key for the settings-not-an-object failure.</summary>
    public const string SettingsNotObjectKey = "backup.import.errorSettingsObject";

    /// <summary>i18n key for the section-not-an-array failure.</summary>
    public const string SectionNotArrayKey = "backup.import.errorSectionArray";

    /// <summary>Resolve this failure to its localized, render-ready message.</summary>
    /// <param name="localizer">The i18n facade resolving the message template.</param>
    public string Localize(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return Kind switch
        {
            SettingsBundleErrorKind.NotObject =>
                localizer.GetString(NotObjectKey, "Bundle must be a JSON object"),
            SettingsBundleErrorKind.VersionInvalid =>
                localizer.GetString(VersionInvalidKey, "schema_version must be a positive integer"),
            SettingsBundleErrorKind.VersionNewer => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(VersionNewerKey, "schema_version {0} is newer than this build supports (max {1})"),
                FormatVersion(Version),
                SettingsBundleConstants.SchemaVersion),
            SettingsBundleErrorKind.ExportedAtInvalid =>
                localizer.GetString(ExportedAtKey, "exported_at must be a non-empty ISO-8601 string"),
            SettingsBundleErrorKind.SectionsNotObject =>
                localizer.GetString(SectionsNotObjectKey, "sections must be a JSON object"),
            SettingsBundleErrorKind.UnknownSection => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(UnknownSectionKey, "Unknown section \"{0}\""),
                SectionKey ?? string.Empty),
            SettingsBundleErrorKind.SettingsNotObject =>
                localizer.GetString(SettingsNotObjectKey, "sections.settings must be an object"),
            SettingsBundleErrorKind.SectionNotArray => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(SectionNotArrayKey, "sections.{0} must be an array"),
                SectionKey ?? string.Empty),
            _ => localizer.GetString(NotObjectKey, "Bundle must be a JSON object"),
        };
    }

    private static string FormatVersion(double version) =>
        version == Math.Floor(version) && !double.IsInfinity(version)
            ? ((long)version).ToString(CultureInfo.CurrentCulture)
            : version.ToString(CultureInfo.CurrentCulture);
}

/// <summary>
/// A validated settings bundle ready to ship to the import endpoint — the native analogue of the normalized
/// <c>SettingsBundle</c> the web validator returns (web/src/lib/settingsImportSchema.ts). Carries the original
/// JSON <see cref="Root"/> (sent verbatim as the <c>bundle</c> payload), the parsed <see cref="SchemaVersion"/>
/// and <see cref="ExportedAt"/>, and the section keys actually present. Pure data.
/// </summary>
/// <param name="Root">The bundle JSON object, shipped unchanged in the import request.</param>
/// <param name="SchemaVersion">The parsed schema_version.</param>
/// <param name="ExportedAt">The parsed exported_at timestamp string.</param>
/// <param name="PresentSections">The section keys present in the bundle (subset of the four known keys).</param>
public sealed record ParsedSettingsBundle(
    JsonObject Root,
    double SchemaVersion,
    string ExportedAt,
    IReadOnlyList<string> PresentSections);

/// <summary>
/// The settled outcome of validating an uploaded file — either a valid <see cref="Bundle"/> or a typed
/// <see cref="Error"/>. Mirrors the web validator's union return (a normalized bundle or a message string),
/// but keeps the failure typed so it can be localized and unit-tested by kind.
/// </summary>
public sealed class SettingsBundleValidation
{
    private SettingsBundleValidation(ParsedSettingsBundle? bundle, SettingsBundleError? error)
    {
        Bundle = bundle;
        Error = error;
    }

    /// <summary>True when the upload validated (the web truthy bundle return).</summary>
    public bool IsValid => Bundle is not null;

    /// <summary>The validated bundle, or <see langword="null"/> on failure.</summary>
    public ParsedSettingsBundle? Bundle { get; }

    /// <summary>The typed failure, or <see langword="null"/> on success.</summary>
    public SettingsBundleError? Error { get; }

    /// <summary>A successful validation carrying the normalized bundle.</summary>
    /// <param name="bundle">The validated bundle.</param>
    public static SettingsBundleValidation Success(ParsedSettingsBundle bundle)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        return new SettingsBundleValidation(bundle, null);
    }

    /// <summary>A failed validation carrying the typed error.</summary>
    /// <param name="error">The validation failure.</param>
    public static SettingsBundleValidation Failure(SettingsBundleError error)
    {
        ArgumentNullException.ThrowIfNull(error);
        return new SettingsBundleValidation(null, error);
    }
}

/// <summary>
/// The pure settings-bundle validator — the native port of the web <c>validateSettingsBundle</c>
/// (web/src/lib/settingsImportSchema.ts). It reproduces every rejection branch-for-branch so any upload the
/// backend would refuse is refused locally (early reject, no corrupt round-trip), returning a typed
/// <see cref="SettingsBundleValidation"/>. UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class SettingsBundleValidator
{
    /// <summary>Validate <paramref name="input"/> (a parsed JSON value) into a typed outcome.</summary>
    /// <param name="input">The JSON value parsed from the uploaded file (null when parsing yielded nothing).</param>
    public static SettingsBundleValidation Validate(JsonNode? input)
    {
        if (input is not JsonObject obj)
        {
            return SettingsBundleValidation.Failure(new SettingsBundleError(SettingsBundleErrorKind.NotObject));
        }

        if (!TryReadNumber(obj, "schema_version", out double version) || version < 1)
        {
            return SettingsBundleValidation.Failure(new SettingsBundleError(SettingsBundleErrorKind.VersionInvalid));
        }

        if (version > SettingsBundleConstants.SchemaVersion)
        {
            return SettingsBundleValidation.Failure(
                new SettingsBundleError(SettingsBundleErrorKind.VersionNewer, Version: version));
        }

        if (ReadString(obj, "exported_at") is not { } exportedAt || exportedAt.Trim().Length == 0)
        {
            return SettingsBundleValidation.Failure(new SettingsBundleError(SettingsBundleErrorKind.ExportedAtInvalid));
        }

        if (obj["sections"] is not JsonObject sections)
        {
            return SettingsBundleValidation.Failure(new SettingsBundleError(SettingsBundleErrorKind.SectionsNotObject));
        }

        foreach (var pair in sections)
        {
            if (!SettingsBundleConstants.SectionKeys.Contains(pair.Key, StringComparer.Ordinal))
            {
                return SettingsBundleValidation.Failure(
                    new SettingsBundleError(SettingsBundleErrorKind.UnknownSection, SectionKey: pair.Key));
            }
        }

        if (sections[SettingsBundleConstants.SettingsKey] is { } settingsNode && settingsNode is not JsonObject)
        {
            return SettingsBundleValidation.Failure(new SettingsBundleError(SettingsBundleErrorKind.SettingsNotObject));
        }

        foreach (var key in SettingsBundleConstants.ArraySectionKeys)
        {
            if (sections[key] is { } node && node is not JsonArray)
            {
                return SettingsBundleValidation.Failure(
                    new SettingsBundleError(SettingsBundleErrorKind.SectionNotArray, SectionKey: key));
            }
        }

        var present = new List<string>(SettingsBundleConstants.SectionKeys.Count);
        foreach (var key in SettingsBundleConstants.SectionKeys)
        {
            if (sections[key] is not null)
            {
                present.Add(key);
            }
        }

        return SettingsBundleValidation.Success(new ParsedSettingsBundle(obj, version, exportedAt, present));
    }

    private static bool TryReadNumber(JsonObject obj, string name, out double value)
    {
        value = 0;
        if (obj[name] is JsonValue v && v.GetValueKind() == JsonValueKind.Number)
        {
            value = v.GetValue<double>();
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        return false;
    }

    private static string? ReadString(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;
}

/// <summary>
/// One render-ready row of the per-section diff list — the native analogue of a web <c>&lt;li&gt;</c> in
/// <c>SectionDiffList</c> (web/src/features/settings/components/SettingsExportImport.tsx). Carries the friendly
/// section <see cref="Label"/>, whether the backend reported <see cref="HasCounts"/>, and the monospace
/// <see cref="CountsText"/> (<c>+added ~updated =skipped</c>); when absent the view shows the em-dash. Pure data.
/// </summary>
/// <param name="Key">The stable section wire key.</param>
/// <param name="Label">The friendly, localized section label.</param>
/// <param name="HasCounts">True when the backend reported counts for this section.</param>
/// <param name="CountsText">The <c>+a ~u =s</c> code text (empty when <see cref="HasCounts"/> is false).</param>
public sealed record SettingsImportSectionRow(string Key, string Label, bool HasCounts, string CountsText);

/// <summary>
/// An immutable snapshot of the <see cref="SettingsExportImportViewModel"/>'s mutable state, fed to the pure
/// <see cref="SettingsExportImportProjection"/>. Keeping the projection a function of this snapshot lets every
/// branch be unit-tested headlessly without driving the asynchronous flows.
/// </summary>
/// <param name="State">The current import-flow stage.</param>
/// <param name="ExportBusy">True while an export is in flight (web <c>exportMut.isPending</c>).</param>
/// <param name="IsApplying">True while an apply is in flight (web <c>applyMut.isPending</c>).</param>
/// <param name="ParseError">The inline parse/preview error message, or <see langword="null"/>.</param>
/// <param name="PendingFilename">The pending import file's name, or <see langword="null"/>.</param>
/// <param name="PendingSizeBytes">The pending import file's size in bytes.</param>
/// <param name="PreviewResult">The dry-run result shown in the preview stage, or <see langword="null"/>.</param>
/// <param name="AppliedResult">The apply result shown in the applied stage, or <see langword="null"/>.</param>
public sealed record SettingsExportImportSnapshot(
    SettingsExportImportState State,
    bool ExportBusy,
    bool IsApplying,
    string? ParseError,
    string? PendingFilename,
    long PendingSizeBytes,
    SettingsImportResult? PreviewResult,
    SettingsImportResult? AppliedResult);

/// <summary>
/// The fully projected, render-ready view of the backup-and-restore panel — the native analogue of the web
/// <c>SettingsExportImport</c> render output. Carries the localized header chrome, the export-row strings and
/// busy state, the import-row strings, the drop-zone visibility / labels, the inline error, the preview-stage
/// strings (header, summary, Apply gate/label, Cancel/Change) and the applied-stage strings, plus the per-section
/// diff <see cref="SectionRows"/> for the active result. Pure data — no WinUI types — so the projection is
/// unit-tested headlessly.
/// </summary>
public sealed record SettingsExportImportDisplay
{
    /// <summary>The localized panel title (web <c>backup.title</c>) — also the surface Narrator name.</summary>
    public required string Title { get; init; }

    /// <summary>The localized panel subtitle (web <c>backup.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The Segoe Fluent glyph for the header accent badge (web Lucide <c>Database</c>).</summary>
    public required string Glyph { get; init; }

    /// <summary>The header badge accent name (web <c>color="cyan"</c>).</summary>
    public required string Accent { get; init; }

    /// <summary>The surface's Narrator name (the localized title).</summary>
    public required string RegionName { get; init; }

    /// <summary>The localized export-row title (web <c>backup.export.title</c>).</summary>
    public required string ExportTitle { get; init; }

    /// <summary>The localized export-row helper text (web <c>backup.export.help</c>).</summary>
    public required string ExportHelp { get; init; }

    /// <summary>The export button label — the busy spinner label or the call-to-action.</summary>
    public required string ExportButtonText { get; init; }

    /// <summary>The export button Narrator name (always the call-to-action, even while busy).</summary>
    public required string ExportButtonName { get; init; }

    /// <summary>True while the export is in flight (the button shows a spinner and is disabled).</summary>
    public required bool ExportBusy { get; init; }

    /// <summary>The localized import-row title (web <c>backup.import.title</c>).</summary>
    public required string ImportTitle { get; init; }

    /// <summary>The localized import-row helper text (web <c>backup.import.help</c>).</summary>
    public required string ImportHelp { get; init; }

    /// <summary>True when the drop zone / file picker is shown (web <c>stage !== preview &amp;&amp; stage !== applied</c>).</summary>
    public required bool ShowDropzone { get; init; }

    /// <summary>The localized drop-zone prompt (web <c>backup.import.dropPrompt</c>).</summary>
    public required string DropPrompt { get; init; }

    /// <summary>The pick-file button label — the reading spinner label or the call-to-action.</summary>
    public required string ChooseText { get; init; }

    /// <summary>True while a file is being read / validated (the pick button shows a spinner and is disabled).</summary>
    public required bool IsParsing { get; init; }

    /// <summary>True when the inline parse/preview error is shown.</summary>
    public required bool HasError { get; init; }

    /// <summary>The localized inline error message, or <see langword="null"/>.</summary>
    public required string? ErrorMessage { get; init; }

    /// <summary>True when the dry-run preview stage is shown.</summary>
    public required bool ShowPreview { get; init; }

    /// <summary>The localized "Previewing {name} ({size} bytes)" header, or <see langword="null"/>.</summary>
    public required string? PreviewHeader { get; init; }

    /// <summary>The localized "{a} added, {u} updated, {s} unchanged" summary, or <see langword="null"/>.</summary>
    public required string? SummaryText { get; init; }

    /// <summary>The localized "Change file" action label.</summary>
    public required string ChangeFileText { get; init; }

    /// <summary>The localized "Cancel" action label.</summary>
    public required string CancelText { get; init; }

    /// <summary>The Apply button label — applying spinner, "Apply N change(s)", or "Nothing to apply".</summary>
    public required string ApplyButtonText { get; init; }

    /// <summary>True when the Apply button is enabled (not applying and there is at least one change).</summary>
    public required bool ApplyEnabled { get; init; }

    /// <summary>True while the apply is in flight (the Apply button shows a spinner).</summary>
    public required bool IsApplying { get; init; }

    /// <summary>True when the applied stage is shown.</summary>
    public required bool ShowApplied { get; init; }

    /// <summary>The localized "Import complete" header, or <see langword="null"/>.</summary>
    public required string? AppliedHeader { get; init; }

    /// <summary>The localized "Done" action label.</summary>
    public required string DoneText { get; init; }

    /// <summary>The per-section diff rows for the active result (empty outside preview/applied).</summary>
    public required IReadOnlyList<SettingsImportSectionRow> SectionRows { get; init; }
}

/// <summary>
/// Pure projection from a <see cref="SettingsExportImportSnapshot"/> to the render-ready
/// <see cref="SettingsExportImportDisplay"/> — the native port of the web <c>SettingsExportImport</c> render
/// (web/src/features/settings/components/SettingsExportImport.tsx). It resolves every owned string through the
/// i18n facade using the web's keys, selects the busy / parsing / applying labels, formats the preview header
/// and summary, derives the Apply button label and its disabled-when-zero gate, and composes the four-row
/// section diff from the active result. No SI conversion applies — the surface carries no measurements. UI-free
/// so it is unit-tested without a XAML runtime.
/// </summary>
public static class SettingsExportImportProjection
{
    /// <summary>i18n key for the panel title (web <c>backup.title</c>).</summary>
    public const string TitleKey = "backup.title";

    /// <summary>i18n key for the panel subtitle (web <c>backup.subtitle</c>; disambiguated from the admin backup key).</summary>
    public const string SubtitleKey = "backup.exportImport.subtitle";

    /// <summary>i18n key for the export-row title (web <c>backup.export.title</c>).</summary>
    public const string ExportTitleKey = "backup.export.title";

    /// <summary>i18n key for the export-row helper text (web <c>backup.export.help</c>).</summary>
    public const string ExportHelpKey = "backup.export.help";

    /// <summary>i18n key for the export call-to-action (web <c>backup.export.cta</c>).</summary>
    public const string ExportCtaKey = "backup.export.cta";

    /// <summary>i18n key for the export busy label (web <c>backup.export.busy</c>).</summary>
    public const string ExportBusyKey = "backup.export.busy";

    /// <summary>i18n key for the import-row title (web <c>backup.import.title</c>).</summary>
    public const string ImportTitleKey = "backup.import.title";

    /// <summary>i18n key for the import-row helper text (web <c>backup.import.help</c>).</summary>
    public const string ImportHelpKey = "backup.import.help";

    /// <summary>i18n key for the drop-zone prompt (web <c>backup.import.dropPrompt</c>).</summary>
    public const string DropPromptKey = "backup.import.dropPrompt";

    /// <summary>i18n key for the pick-file call-to-action (web <c>backup.import.choose</c>).</summary>
    public const string ChooseKey = "backup.import.choose";

    /// <summary>i18n key for the reading label (web <c>backup.import.parsing</c>).</summary>
    public const string ParsingKey = "backup.import.parsing";

    /// <summary>i18n key for the preview header template (web <c>backup.import.previewHeader</c>).</summary>
    public const string PreviewHeaderKey = "backup.import.previewHeader";

    /// <summary>i18n key for the preview summary template (web <c>backup.import.summary</c>).</summary>
    public const string SummaryKey = "backup.import.summary";

    /// <summary>i18n key for the change-file action (web <c>backup.import.changeFile</c>).</summary>
    public const string ChangeFileKey = "backup.import.changeFile";

    /// <summary>i18n key for the cancel action (web <c>backup.import.cancel</c>).</summary>
    public const string CancelKey = "backup.import.cancel";

    /// <summary>i18n key for the applying label (web <c>backup.import.applying</c>).</summary>
    public const string ApplyingKey = "backup.import.applying";

    /// <summary>i18n key for the apply-count template (web <c>backup.import.applyCount</c>).</summary>
    public const string ApplyCountKey = "backup.import.applyCount";

    /// <summary>i18n key for the nothing-to-apply label (web <c>backup.import.applyNoChanges</c>).</summary>
    public const string ApplyNoChangesKey = "backup.import.applyNoChanges";

    /// <summary>i18n key for the applied header (web <c>backup.import.appliedHeader</c>).</summary>
    public const string AppliedHeaderKey = "backup.import.appliedHeader";

    /// <summary>i18n key for the done action (web <c>backup.import.done</c>).</summary>
    public const string DoneKey = "backup.import.done";

    /// <summary>i18n key for the general-settings section label (web <c>backup.section.settings</c>).</summary>
    public const string SectionSettingsKey = "backup.section.settings";

    /// <summary>i18n key for the alert-rules section label (web <c>backup.section.alertRules</c>).</summary>
    public const string SectionAlertRulesKey = "backup.section.alertRules";

    /// <summary>i18n key for the geofences section label (web <c>backup.section.geofences</c>).</summary>
    public const string SectionGeofencesKey = "backup.section.geofences";

    /// <summary>i18n key for the quiet-hours section label (web <c>backup.section.quietHours</c>).</summary>
    public const string SectionQuietHoursKey = "backup.section.quietHours";

    /// <summary>Segoe Fluent "Storage" glyph standing in for the web Lucide <c>Database</c> icon.</summary>
    public const string Glyph = "\uEDA2";

    /// <summary>The header badge accent name (web <c>color="cyan"</c>); resolved by <see cref="ToolCardAccent"/>.</summary>
    public const string Accent = "cyan";

    /// <summary>The em-dash shown for a section the backend did not report (web literal <c>—</c>).</summary>
    public const string SectionDash = "\u2014";

    /// <summary>Project <paramref name="snapshot"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    /// <param name="snapshot">The current view-model state snapshot.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static SettingsExportImportDisplay Project(SettingsExportImportSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, "Backup & Restore");
        bool showPreview = snapshot.State == SettingsExportImportState.Preview;
        bool showApplied = snapshot.State == SettingsExportImportState.Applied;
        bool isParsing = snapshot.State == SettingsExportImportState.Parsing;

        SettingsImportResult? activeResult = showApplied ? snapshot.AppliedResult : snapshot.PreviewResult;
        SettingsImportSummary? summary = snapshot.PreviewResult is { } preview
            ? SettingsImportSummary.From(preview)
            : null;

        return new SettingsExportImportDisplay
        {
            Title = title,
            Subtitle = localizer.GetString(
                SubtitleKey,
                "Export your TeslaSync configuration as a JSON file you can stash in a backup folder or git repo, and import it on a fresh install."),
            Glyph = Glyph,
            Accent = Accent,
            RegionName = title,

            ExportTitle = localizer.GetString(ExportTitleKey, "Export settings"),
            ExportHelp = localizer.GetString(
                ExportHelpKey,
                "Includes general settings, alert rules, geofences, and your quiet-hours windows. Tesla credentials and notification-channel secrets are NEVER exported."),
            ExportButtonText = snapshot.ExportBusy
                ? localizer.GetString(ExportBusyKey, "Exporting\u2026")
                : localizer.GetString(ExportCtaKey, "Export JSON"),
            ExportButtonName = localizer.GetString(ExportCtaKey, "Export JSON"),
            ExportBusy = snapshot.ExportBusy,

            ImportTitle = localizer.GetString(ImportTitleKey, "Import settings"),
            ImportHelp = localizer.GetString(
                ImportHelpKey,
                "Drop or pick a previously exported bundle. Existing items with the same name are updated; nothing is deleted."),
            ShowDropzone = !showPreview && !showApplied,
            DropPrompt = localizer.GetString(DropPromptKey, "Drag a JSON bundle here, or"),
            ChooseText = isParsing
                ? localizer.GetString(ParsingKey, "Reading\u2026")
                : localizer.GetString(ChooseKey, "Choose a file"),
            IsParsing = isParsing,

            HasError = !string.IsNullOrEmpty(snapshot.ParseError),
            ErrorMessage = snapshot.ParseError,

            ShowPreview = showPreview,
            PreviewHeader = showPreview && snapshot.PendingFilename is { } name
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString(PreviewHeaderKey, "Previewing {0} ({1} bytes)"),
                    name,
                    snapshot.PendingSizeBytes.ToString("N0", CultureInfo.CurrentCulture))
                : null,
            SummaryText = showPreview && summary is { } s
                ? string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString(SummaryKey, "{0} added, {1} updated, {2} unchanged"),
                    s.Added,
                    s.Updated,
                    s.Skipped)
                : null,
            ChangeFileText = localizer.GetString(ChangeFileKey, "Change file"),
            CancelText = localizer.GetString(CancelKey, "Cancel"),
            ApplyButtonText = ApplyLabel(snapshot, summary, localizer),
            ApplyEnabled = !snapshot.IsApplying && !(summary is { Total: 0 }),
            IsApplying = snapshot.IsApplying,

            ShowApplied = showApplied,
            AppliedHeader = showApplied ? localizer.GetString(AppliedHeaderKey, "Import complete") : null,
            DoneText = localizer.GetString(DoneKey, "Done"),

            SectionRows = BuildRows(activeResult, localizer),
        };
    }

    /// <summary>Resolve the localized friendly label for a section wire key.</summary>
    /// <param name="key">The section wire key.</param>
    /// <param name="localizer">The i18n facade resolving the label.</param>
    public static string SectionLabel(string key, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return key switch
        {
            SettingsBundleConstants.SettingsKey => localizer.GetString(SectionSettingsKey, "General settings"),
            SettingsBundleConstants.AlertRulesKey => localizer.GetString(SectionAlertRulesKey, "Alert rules"),
            SettingsBundleConstants.GeofencesKey => localizer.GetString(SectionGeofencesKey, "Geofences"),
            SettingsBundleConstants.QuietHoursKey => localizer.GetString(SectionQuietHoursKey, "Quiet hours"),
            _ => key ?? string.Empty,
        };
    }

    private static List<SettingsImportSectionRow> BuildRows(SettingsImportResult? result, ILocalizer localizer)
    {
        var rows = new List<SettingsImportSectionRow>(SettingsBundleConstants.SectionKeys.Count);
        if (result is null)
        {
            return rows;
        }

        foreach (var key in SettingsBundleConstants.SectionKeys)
        {
            string label = SectionLabel(key, localizer);
            if (result.Sections.TryGetValue(key, out var counts))
            {
                rows.Add(new SettingsImportSectionRow(
                    key,
                    label,
                    HasCounts: true,
                    CountsText: string.Format(
                        CultureInfo.CurrentCulture,
                        "+{0} ~{1} ={2}",
                        counts.Added,
                        counts.Updated,
                        counts.Skipped)));
            }
            else
            {
                rows.Add(new SettingsImportSectionRow(key, label, HasCounts: false, CountsText: string.Empty));
            }
        }

        return rows;
    }

    private static string ApplyLabel(
        SettingsExportImportSnapshot snapshot,
        SettingsImportSummary? summary,
        ILocalizer localizer)
    {
        if (snapshot.IsApplying)
        {
            return localizer.GetString(ApplyingKey, "Applying\u2026");
        }

        if (summary is { Total: > 0 } s)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(ApplyCountKey, "Apply {0} change(s)"),
                s.Total);
        }

        return localizer.GetString(ApplyNoChangesKey, "Nothing to apply");
    }
}

/// <summary>
/// Canonical metadata for the SettingsExportImport surface — the native anchor for the web component at
/// web/src/features/settings/components/SettingsExportImport.tsx. The diagnostics <see cref="Slug"/> is the
/// stable surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class SettingsExportImportRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SettingsExportImport";

    /// <summary>The localized surface name (the panel title) — the host chrome / Narrator name.</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SettingsExportImportProjection.TitleKey, "Backup & Restore");
    }
}

/// <summary>
/// PII-safe diagnostics for the SettingsExportImport surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a filename, bundle content or any field
/// value — so a diagnostics line can never leak user data. Thread-safe.
/// </summary>
public sealed class SettingsExportImportDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public SettingsExportImportDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SettingsExportImport</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SettingsExportImportRegistration.Slug}");
    }
}
