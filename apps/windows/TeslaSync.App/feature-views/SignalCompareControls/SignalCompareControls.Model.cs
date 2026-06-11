using System.Globalization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SignalDiff;

/// <summary>
/// One of the eight signal categories the compare bar exposes as a quick filter chip — the native port of an
/// entry in the web <c>CATEGORY_PREFIXES</c> array
/// (<c>web/src/features/telemetry/components/SignalCompareControls.tsx</c>). Carries the stable <see cref="Id"/>
/// (the wire value the page turns into a server-side filter prefix), the i18n <see cref="LabelKey"/> + English
/// <see cref="DefaultLabel"/>, and the case-insensitive name <see cref="Matches(string)"/> predicate the web
/// uses to decide whether a signal name belongs to the category. Pure (no WinUI types) so the matching rules
/// are asserted headlessly.
/// </summary>
public sealed class SignalCategory
{
    private readonly Regex _pattern;

    /// <summary>Creates a category over its id, i18n key, English fallback and the web name-match pattern.</summary>
    /// <param name="id">Stable wire id (web <c>id</c>), e.g. <c>battery</c>.</param>
    /// <param name="labelKey">Web i18n key (web <c>labelKey</c>), e.g. <c>signalDiff.cat.battery</c>.</param>
    /// <param name="defaultLabel">English fallback label (web <c>defaultLabel</c>).</param>
    /// <param name="pattern">The web regular-expression source the chip matches signal names against.</param>
    public SignalCategory(string id, string labelKey, string defaultLabel, string pattern)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        ArgumentException.ThrowIfNullOrEmpty(labelKey);
        ArgumentException.ThrowIfNullOrEmpty(defaultLabel);
        ArgumentException.ThrowIfNullOrEmpty(pattern);

        Id = id;
        LabelKey = labelKey;
        DefaultLabel = defaultLabel;
        Pattern = pattern;
        _pattern = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    /// <summary>Stable wire id (web <c>id</c>).</summary>
    public string Id { get; }

    /// <summary>Web i18n key (web <c>labelKey</c>).</summary>
    public string LabelKey { get; }

    /// <summary>English fallback label (web <c>defaultLabel</c>).</summary>
    public string DefaultLabel { get; }

    /// <summary>The web regular-expression source (kept for parity assertions).</summary>
    public string Pattern { get; }

    /// <summary>True when <paramref name="name"/> matches the category pattern (web <c>matches(name)</c>).</summary>
    public bool Matches(string? name) => !string.IsNullOrEmpty(name) && _pattern.IsMatch(name);
}

/// <summary>
/// The eight signal categories the compare bar offers, in display order — the native port of the web
/// <c>CATEGORY_PREFIXES</c> export. The pages reuse this list (and each entry's <see cref="SignalCategory.Matches"/>
/// predicate) to drive their server-side filter strings, exactly as the web does. Pure — unit-tested without a UI
/// host.
/// </summary>
public static class SignalCompareControlsCategories
{
    /// <summary>The eight categories in web declaration order.</summary>
    public static IReadOnlyList<SignalCategory> All { get; } = new[]
    {
        new SignalCategory("battery", "signalDiff.cat.battery", "Battery", "battery|charge|soc|range|kwh"),
        new SignalCategory("drive", "signalDiff.cat.drive", "Drive", "speed|odometer|gear|drive|brake|throttle|steering"),
        new SignalCategory("climate", "signalDiff.cat.climate", "Climate", "climate|hvac|cabin|seat|temp"),
        new SignalCategory("security", "signalDiff.cat.security", "Security", "lock|sentry|alarm|valet|guard"),
        new SignalCategory("motor", "signalDiff.cat.motor", "Motor", "motor|inverter|torque|rpm"),
        new SignalCategory("tire", "signalDiff.cat.tire", "Tire", "tpms|tire|pressure"),
        new SignalCategory("media", "signalDiff.cat.media", "Media", "media|audio|volume|playback"),
        new SignalCategory("safety", "signalDiff.cat.safety", "Safety", "airbag|seatbelt|fcw|aeb|safety"),
    };

    /// <summary>The category whose pattern matches <paramref name="signalName"/>, or null (first match wins).</summary>
    public static SignalCategory? Classify(string? signalName)
    {
        if (string.IsNullOrEmpty(signalName))
        {
            return null;
        }

        foreach (var category in All)
        {
            if (category.Matches(signalName))
            {
                return category;
            }
        }

        return null;
    }
}

/// <summary>The five datetime presets the compare bar offers — the native port of the web <c>DiffPresetId</c>.</summary>
public enum DiffPresetId
{
    /// <summary>Window A = one hour ago, Window B = now (web <c>now-vs-1h</c>).</summary>
    NowVs1h,

    /// <summary>Window A = one day ago, Window B = now (web <c>now-vs-1d</c>).</summary>
    NowVs1d,

    /// <summary>Window A = four hours ago, Window B = now (web <c>before-after-charge</c>).</summary>
    BeforeAfterCharge,

    /// <summary>Window A = 90 minutes ago, Window B = five minutes ago (web <c>last-drive</c>).</summary>
    LastDrive,

    /// <summary>Window A = one day ago, Window B = now (web <c>today-vs-yesterday</c>).</summary>
    TodayVsYesterday,
}

/// <summary>
/// One datetime preset — the native port of an entry in the web <c>DIFF_PRESETS</c> array. Carries the typed
/// <see cref="Id"/>, the stable <see cref="Wire"/> literal (web <c>id</c>), the i18n <see cref="LabelKey"/> +
/// English <see cref="DefaultLabel"/>, and the relative-time <see cref="Compute(DateTime)"/> the button applies.
/// Pure — the time maths is asserted against a fixed clock.
/// </summary>
/// <param name="Id">The typed preset id.</param>
/// <param name="Wire">The stable wire literal (web <c>id</c>), e.g. <c>now-vs-1h</c>.</param>
/// <param name="LabelKey">Web i18n key (web <c>labelKey</c>), e.g. <c>signalDiff.preset.nowVs1h</c>.</param>
/// <param name="DefaultLabel">English fallback label (web <c>defaultLabel</c>).</param>
public sealed record SignalDiffPreset(DiffPresetId Id, string Wire, string LabelKey, string DefaultLabel)
{
    /// <summary>Resolve the two window timestamps relative to <paramref name="now"/> (web <c>compute()</c>).</summary>
    public (DateTime AtA, DateTime AtB) Compute(DateTime now) => Id switch
    {
        DiffPresetId.NowVs1h => (now.AddHours(-1), now),
        DiffPresetId.NowVs1d => (now.AddDays(-1), now),
        DiffPresetId.BeforeAfterCharge => (now.AddHours(-4), now),
        DiffPresetId.LastDrive => (now.AddMinutes(-90), now.AddMinutes(-5)),
        DiffPresetId.TodayVsYesterday => (now.AddDays(-1), now),
        _ => (now, now),
    };
}

/// <summary>
/// The five datetime presets the compare bar offers, in display order — the native port of the web
/// <c>DIFF_PRESETS</c> export. Pure — unit-tested without a UI host.
/// </summary>
public static class SignalCompareControlsPresets
{
    /// <summary>The five presets in web declaration order.</summary>
    public static IReadOnlyList<SignalDiffPreset> All { get; } = new[]
    {
        new SignalDiffPreset(DiffPresetId.NowVs1h, "now-vs-1h", "signalDiff.preset.nowVs1h", "Now vs 1h ago"),
        new SignalDiffPreset(DiffPresetId.NowVs1d, "now-vs-1d", "signalDiff.preset.nowVs1d", "Now vs 1 day ago"),
        new SignalDiffPreset(DiffPresetId.BeforeAfterCharge, "before-after-charge", "signalDiff.preset.beforeAfterCharge", "Before vs after last charge"),
        new SignalDiffPreset(DiffPresetId.LastDrive, "last-drive", "signalDiff.preset.lastDrive", "Last drive start vs end"),
        new SignalDiffPreset(DiffPresetId.TodayVsYesterday, "today-vs-yesterday", "signalDiff.preset.todayVsYesterday", "Today vs yesterday (same time)"),
    };

    /// <summary>The preset with the given id (always present for a valid enum value).</summary>
    public static SignalDiffPreset Get(DiffPresetId id) => All.First(p => p.Id == id);
}

/// <summary>
/// Pure ports of the web datetime helpers <c>toLocalDatetimeInput</c> and <c>isoOrEmpty</c> plus the inverse
/// parse the native pickers need. Kept WinUI-free so the round-trip is asserted headlessly.
/// </summary>
public static class SignalCompareControlsTime
{
    private const string LocalFormat = "yyyy-MM-ddTHH:mm";

    /// <summary>
    /// Format a local datetime as the <c>datetime-local</c> input value <c>yyyy-MM-ddTHH:mm</c> (web
    /// <c>toLocalDatetimeInput</c>). Seconds and zone are intentionally dropped to match the HTML control.
    /// </summary>
    public static string ToLocalDatetimeInput(DateTime local) =>
        local.ToString(LocalFormat, CultureInfo.InvariantCulture);

    /// <summary>
    /// Convert a <c>datetime-local</c> value to a UTC ISO-8601 instant, or the empty string for blank/invalid
    /// input (web <c>isoOrEmpty</c>: <c>new Date(local).toISOString()</c>). The value is read as local time and
    /// normalized to UTC with millisecond precision and a trailing <c>Z</c>, matching JavaScript's
    /// <c>toISOString()</c>.
    /// </summary>
    public static string IsoOrEmpty(string? localValue)
    {
        if (string.IsNullOrEmpty(localValue))
        {
            return string.Empty;
        }

        if (!DateTime.TryParse(
                localValue,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out var parsed))
        {
            return string.Empty;
        }

        return parsed.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
    }

    /// <summary>Parse a <c>datetime-local</c> value back to a local <see cref="DateTime"/> (false when blank/invalid).</summary>
    public static bool TryParseLocalInput(string? localValue, out DateTime value)
    {
        value = default;
        return !string.IsNullOrEmpty(localValue)
            && DateTime.TryParse(localValue, CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
    }
}

/// <summary>
/// The render-time data model the controlled compare bar binds to — the native analogue of the web
/// <c>SignalCompareControlsProps</c> data fields (<c>atA</c>, <c>atB</c>, <c>search</c>, <c>category</c>). The
/// component is purely controlled: it holds the current selection and raises change events the host applies; it
/// performs no fetching and mutates nothing itself. The web <c>topSlot</c> / <c>className</c> are view concerns
/// (a slot element and styling), not data, so they live on the WinUI view rather than this model. Pure data — the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="AtA">The Window A <c>datetime-local</c> value (web <c>atA</c>).</param>
/// <param name="AtB">The Window B <c>datetime-local</c> value (web <c>atB</c>).</param>
/// <param name="Search">The signal-name filter text (web <c>search</c>).</param>
/// <param name="Category">The active category id, or null for none (web <c>category</c>).</param>
public sealed record SignalCompareControlsModel(
    string AtA,
    string AtB,
    string Search,
    string? Category)
{
    /// <summary>The initial model: both windows and the filter empty, no category selected.</summary>
    public static SignalCompareControlsModel Empty { get; } =
        new(string.Empty, string.Empty, string.Empty, null);
}

/// <summary>A render-ready preset button (web <c>DIFF_PRESETS.map</c> entry): typed id, wire literal, localized label.</summary>
public sealed record PresetButton(DiffPresetId Id, string Wire, string Label);

/// <summary>A render-ready category chip (web <c>CATEGORY_PREFIXES.map</c> entry): id, localized label, active flag.</summary>
public sealed record CategoryChip(string Id, string Label, bool Active);

/// <summary>
/// The fully projected, render-ready view of the compare bar for one input model — the native analogue of what
/// the web <c>SignalCompareControls</c> renders. Holds the two window field labels (+ their help body / aria
/// copy), the presets-row label and the five preset buttons, the signal-name filter hint, the eight category chips
/// (each carrying its <see cref="CategoryChip.Active"/> flag), the clear-affordance visibility + label, the
/// echoed selection (so the view sets the pickers / filter), and the surface automation name. Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record SignalCompareControlsDisplay(
    string WindowALabel,
    string WindowBLabel,
    string SnapshotHelp,
    string SnapshotHelpAria,
    string DiffHelp,
    string DiffHelpAria,
    string PresetsLabel,
    IReadOnlyList<PresetButton> Presets,
    string FilterHint,
    IReadOnlyList<CategoryChip> Categories,
    bool ShowClear,
    string ClearLabel,
    string AtA,
    string AtB,
    string Search,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SignalCompareControlsModel"/> to its <see cref="SignalCompareControlsDisplay"/>
/// — the native port of <c>web/src/features/telemetry/components/SignalCompareControls.tsx</c>. It resolves the
/// two window labels and their help copy, builds the five preset buttons and the eight category chips (marking the
/// one whose id equals the model's <c>category</c> as active, exactly as the web compares
/// <c>category === c.id</c>), decides whether the "Clear" affordance shows (the web renders it only when a
/// category is selected), echoes the current selection, and resolves every string through the i18n facade. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class SignalCompareControlsProjection
{
    /// <summary>i18n key prefix every web key is namespaced under in the resource catalog.</summary>
    public const string KeyPrefix = "translation.";

    private const string WindowAKey = "translation.signalDiff.windowA";
    private const string WindowBKey = "translation.signalDiff.windowB";
    private const string SnapshotHelpKey = "translation.help.signal.snapshot";
    private const string SnapshotHelpAriaKey = "translation.help.signal.snapshot.aria";
    private const string DiffHelpKey = "translation.help.signal.diff";
    private const string DiffHelpAriaKey = "translation.help.signal.diff.aria";
    private const string PresetsLabelKey = "translation.signalDiff.presetsLabel";
    private const string FilterHintKey = "translation.signalDiff.filterPlaceholder"; // parity:allow web i18n key signalDiff.filterPlaceholder
    private const string ClearKey = "translation.signalDiff.clearCategory";

    private const string WindowAFallback = "Window A";
    private const string WindowBFallback = "Window B";
    private const string SnapshotHelpFallback =
        "A snapshot is a point-in-time view of every signal value at a single timestamp. " +
        "Falls back to signal_log within the last 30 days when the live layer doesn\u2019t have it.";
    private const string SnapshotHelpAriaFallback = "More info about signal snapshots";
    private const string DiffHelpFallback =
        "Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise.";
    private const string DiffHelpAriaFallback = "More info about signal diffs";
    private const string PresetsLabelFallback = "Quick presets:";
    private const string FilterHintFallback = "Filter signals\u2026";
    private const string ClearFallback = "Clear";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web data props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SignalCompareControlsDisplay Project(SignalCompareControlsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string windowA = localizer.GetString(WindowAKey, WindowAFallback);
        string windowB = localizer.GetString(WindowBKey, WindowBFallback);
        string presetsLabel = localizer.GetString(PresetsLabelKey, PresetsLabelFallback);
        string filterHint = localizer.GetString(FilterHintKey, FilterHintFallback);
        string clearLabel = localizer.GetString(ClearKey, ClearFallback);

        var presets = BuildPresets(localizer);
        var categories = BuildCategories(model.Category, localizer);
        bool showClear = !string.IsNullOrEmpty(model.Category);

        return new SignalCompareControlsDisplay(
            WindowALabel: windowA,
            WindowBLabel: windowB,
            SnapshotHelp: localizer.GetString(SnapshotHelpKey, SnapshotHelpFallback),
            SnapshotHelpAria: localizer.GetString(SnapshotHelpAriaKey, SnapshotHelpAriaFallback),
            DiffHelp: localizer.GetString(DiffHelpKey, DiffHelpFallback),
            DiffHelpAria: localizer.GetString(DiffHelpAriaKey, DiffHelpAriaFallback),
            PresetsLabel: presetsLabel,
            Presets: presets,
            FilterHint: filterHint,
            Categories: categories,
            ShowClear: showClear,
            ClearLabel: clearLabel,
            AtA: model.AtA,
            AtB: model.AtB,
            Search: model.Search,
            AutomationName: BuildAutomationName(windowA, windowB, presetsLabel, categories));
    }

    /// <summary>The category id toggled when chip <paramref name="chipId"/> is tapped (web <c>category === id ? null : id</c>).</summary>
    public static string? ToggleCategory(string? current, string chipId)
    {
        ArgumentException.ThrowIfNullOrEmpty(chipId);
        return string.Equals(current, chipId, StringComparison.Ordinal) ? null : chipId;
    }

    // Web parity: DIFF_PRESETS.map(p => ({ id: p.id, label: t(p.labelKey, p.defaultLabel) })).
    private static List<PresetButton> BuildPresets(ILocalizer localizer)
    {
        var buttons = new List<PresetButton>(SignalCompareControlsPresets.All.Count);
        foreach (var preset in SignalCompareControlsPresets.All)
        {
            buttons.Add(new PresetButton(
                preset.Id,
                preset.Wire,
                localizer.GetString(KeyPrefix + preset.LabelKey, preset.DefaultLabel)));
        }

        return buttons;
    }

    // Web parity: CATEGORY_PREFIXES.map(c => ({ id: c.id, label: t(c.labelKey, c.defaultLabel),
    // active: category === c.id })).
    private static List<CategoryChip> BuildCategories(string? active, ILocalizer localizer)
    {
        var chips = new List<CategoryChip>(SignalCompareControlsCategories.All.Count);
        foreach (var category in SignalCompareControlsCategories.All)
        {
            chips.Add(new CategoryChip(
                category.Id,
                localizer.GetString(KeyPrefix + category.LabelKey, category.DefaultLabel),
                string.Equals(active, category.Id, StringComparison.Ordinal)));
        }

        return chips;
    }

    private static string BuildAutomationName(
        string windowA,
        string windowB,
        string presetsLabel,
        IReadOnlyList<CategoryChip> categories)
    {
        var active = categories.FirstOrDefault(c => c.Active);
        string baseName = string.Create(
            CultureInfo.CurrentCulture,
            $"{windowA}. {windowB}. {presetsLabel}");

        return active is null
            ? baseName
            : string.Create(CultureInfo.CurrentCulture, $"{baseName} {active.Label}");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalCompareControls</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the selected timestamps, filter text or
/// category — so a diagnostics line can never leak what an operator compared. Thread-safe.
/// </summary>
public sealed class SignalCompareControlsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public SignalCompareControlsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalCompareControls</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalCompareControlsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SignalCompareControls</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/telemetry/components/SignalCompareControls.tsx</c>.
/// </summary>
public static class SignalCompareControlsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalCompareControls";
}
