using System.Globalization;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One render-ready paint swatch — the native projection of a single mapped <c>PAINT_PALETTE_LIST</c> entry
/// (web/src/components/vehicles/VehiclePaintPicker.tsx L47-L93). Carries the palette <see cref="Id"/> (the value
/// handed back when the swatch is picked), the opaque <see cref="Swatch"/> hex the dot is filled with (web
/// <c>style={{ background: p.swatch }}</c>), the localized <see cref="Label"/> (the swatch's Narrator name, the
/// web <c>aria-label={label}</c>), the <see cref="Title"/> tooltip — the label plus the "· Auto-detected" suffix
/// for the inferred palette (web <c>title={isInferred ? `${label} · …` : label}</c>) — the <see cref="Selected"/>
/// flag (web <c>aria-checked={selected}</c>, which shows the check mark) and the <see cref="IsInferred"/> flag
/// (web <c>p.id === inferred.id</c>). Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Id">The palette id (web <c>p.id</c>); the value emitted when the swatch is picked.</param>
/// <param name="Swatch">The opaque swatch hex the dot is filled with (web <c>p.swatch</c>).</param>
/// <param name="Label">The localized swatch label and Narrator name (web <c>t(p.labelKey, p.defaultLabel)</c>).</param>
/// <param name="Title">The localized tooltip (web <c>title</c>): the label, or "label · Auto-detected" when inferred.</param>
/// <param name="Selected">Whether this swatch is the active paint (web <c>selected</c> → checked + check mark).</param>
/// <param name="IsInferred">Whether this is the auto-detected palette (web <c>p.id === inferred.id</c>).</param>
public sealed record PaintSwatchItem(
    PaintPaletteId Id,
    string Swatch,
    string Label,
    string Title,
    bool Selected,
    bool IsInferred);

/// <summary>
/// Canonical metadata + localized strings + persistence identity for the vehicle-paint-picker surface — the
/// native analogue of the web <c>VehiclePaintPicker</c> (web/src/components/vehicles/VehiclePaintPicker.tsx) and
/// the storage helpers in its <c>useVehiclePaint</c> hook (web/src/hooks/useVehiclePaint.ts). It carries the
/// diagnostics slug, every render-contract i18n key/fallback the web source passes to <c>t()</c> (verbatim copy,
/// each under the catalog's <c>translation.</c> namespace so it resolves against
/// <c>apps/shared/i18n/catalog/en.json</c> + <c>apps/windows/Strings/*/Resources.resw</c> and falls back to the
/// English value headlessly), the per-palette label key map (web <c>p.labelKey</c>), the stable persistence
/// token map (web <c>PaintPaletteId</c> string ids such as <c>"red-multicoat"</c>) and the per-vehicle storage
/// key (web <c>`teslasync:vehicle:${id}:paint`</c>). UI-free so it is asserted without a XAML host.
/// </summary>
public static class VehiclePaintPickerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehiclePaintPicker";

    /// <summary>i18n key for the radio-group accessible name (web <c>paint.pickerLabel</c>).</summary>
    public const string PickerLabelKey = "translation.paint.pickerLabel";

    /// <summary>English fallback for <see cref="PickerLabelKey"/> (web second arg, verbatim).</summary>
    public const string PickerLabelFallback = "Vehicle paint color";

    /// <summary>i18n key for the leading "Paint" caption (web <c>paint.label</c>).</summary>
    public const string CaptionKey = "translation.paint.label";

    /// <summary>English fallback for <see cref="CaptionKey"/> (web second arg, verbatim).</summary>
    public const string CaptionFallback = "Paint";

    /// <summary>i18n key for the auto-detected tooltip suffix (web <c>paint.detected</c>).</summary>
    public const string DetectedKey = "translation.paint.detected";

    /// <summary>English fallback for <see cref="DetectedKey"/> (web second arg, verbatim).</summary>
    public const string DetectedFallback = "Auto-detected";

    /// <summary>i18n key for the reset-to-auto button (web <c>paint.reset</c>).</summary>
    public const string ResetKey = "translation.paint.reset";

    /// <summary>English fallback for <see cref="ResetKey"/> (web second arg, verbatim).</summary>
    public const string ResetFallback = "Reset to auto-detected";

    /// <summary>i18n key for the Pearl White Multi-Coat swatch label (web <c>paint.pearlWhite</c>).</summary>
    public const string PearlWhiteKey = "translation.paint.pearlWhite";

    /// <summary>i18n key for the Midnight Silver Metallic swatch label (web <c>paint.midnightSilver</c>).</summary>
    public const string MidnightSilverKey = "translation.paint.midnightSilver";

    /// <summary>i18n key for the Deep Blue Metallic swatch label (web <c>paint.deepBlue</c>).</summary>
    public const string DeepBlueKey = "translation.paint.deepBlue";

    /// <summary>i18n key for the Solid Black swatch label (web <c>paint.solidBlack</c>).</summary>
    public const string SolidBlackKey = "translation.paint.solidBlack";

    /// <summary>i18n key for the Red Multi-Coat swatch label (web <c>paint.redMulticoat</c>).</summary>
    public const string RedMulticoatKey = "translation.paint.redMulticoat";

    /// <summary>The per-vehicle storage key prefix (web <c>STORAGE_PREFIX = 'teslasync:vehicle:'</c>).</summary>
    public const string StorageKeyPrefix = "teslasync:vehicle:";

    /// <summary>The per-vehicle storage key suffix (web <c>STORAGE_SUFFIX = ':paint'</c>).</summary>
    public const string StorageKeySuffix = ":paint";

    /// <summary>
    /// The i18n key for a palette's swatch label — the native port of the web <c>p.labelKey</c>
    /// (web/src/lib/vehicleColors.ts), under the catalog's <c>translation.</c> namespace.
    /// </summary>
    /// <param name="id">The palette id.</param>
    public static string LabelKey(PaintPaletteId id) => id switch
    {
        PaintPaletteId.MidnightSilver => MidnightSilverKey,
        PaintPaletteId.DeepBlue => DeepBlueKey,
        PaintPaletteId.SolidBlack => SolidBlackKey,
        PaintPaletteId.RedMulticoat => RedMulticoatKey,
        _ => PearlWhiteKey,
    };

    /// <summary>
    /// The stable persistence token for a palette — the native port of the web <c>PaintPaletteId</c> string id
    /// (kebab-case, e.g. <c>"red-multicoat"</c>) the hook writes to <c>localStorage</c>. Cross-compatible with
    /// the web slot so a value written by either client round-trips.
    /// </summary>
    /// <param name="id">The palette id.</param>
    public static string Token(PaintPaletteId id) => id switch
    {
        PaintPaletteId.MidnightSilver => "midnight-silver",
        PaintPaletteId.DeepBlue => "deep-blue",
        PaintPaletteId.SolidBlack => "solid-black",
        PaintPaletteId.RedMulticoat => "red-multicoat",
        _ => "pearl-white",
    };

    /// <summary>
    /// Parse a persisted token back into a palette id — the native port of the web <c>isPaintPaletteId</c>
    /// type-guard (web/src/lib/vehicleColors.ts L274): a known kebab token yields its id, anything else (a stale
    /// or foreign value) yields <see langword="null"/>, so the caller falls back to the inferred paint.
    /// </summary>
    /// <param name="token">The raw persisted token, or <see langword="null"/>.</param>
    /// <param name="id">The parsed palette id when the token is recognized.</param>
    /// <returns><see langword="true"/> when <paramref name="token"/> is a known palette token.</returns>
    public static bool TryParseToken(string? token, out PaintPaletteId id)
    {
        switch (token)
        {
            case "pearl-white":
                id = PaintPaletteId.PearlWhite;
                return true;
            case "midnight-silver":
                id = PaintPaletteId.MidnightSilver;
                return true;
            case "deep-blue":
                id = PaintPaletteId.DeepBlue;
                return true;
            case "solid-black":
                id = PaintPaletteId.SolidBlack;
                return true;
            case "red-multicoat":
                id = PaintPaletteId.RedMulticoat;
                return true;
            default:
                id = PaintPaletteId.PearlWhite;
                return false;
        }
    }

    /// <summary>
    /// The per-vehicle persistence key — the native port of the web <c>storageKey</c> helper
    /// (web/src/hooks/useVehiclePaint.ts L67): <c>teslasync:vehicle:{vehicleId}:paint</c>.
    /// </summary>
    /// <param name="vehicleId">The vehicle id (must be positive for a real slot).</param>
    public static string StorageKey(long vehicleId) =>
        string.Create(CultureInfo.InvariantCulture, $"{StorageKeyPrefix}{vehicleId}{StorageKeySuffix}");

    /// <summary>
    /// Compose the inferred swatch's tooltip — the web <c>`${label} · ${t('paint.detected', 'Auto-detected')}`</c>
    /// (web/src/components/vehicles/VehiclePaintPicker.tsx L58).
    /// </summary>
    /// <param name="label">The localized swatch label.</param>
    /// <param name="detected">The localized "Auto-detected" suffix.</param>
    public static string FormatDetectedTitle(string label, string detected)
    {
        ArgumentNullException.ThrowIfNull(label);
        ArgumentNullException.ThrowIfNull(detected);
        return string.Create(CultureInfo.CurrentCulture, $"{label} · {detected}");
    }
}

/// <summary>
/// PII-safe diagnostics for the vehicle-paint-picker surface (P1/S11 diagnostics contract). The override is a
/// browser-local cosmetic preference, not vehicle identity, and the collector records only operational signals —
/// the <see cref="RecordViewOpened"/> event with the surface slug and a <see cref="RecordPaintSelected"/> counter —
/// never the vehicle id or the chosen color. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class VehiclePaintPickerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _paintsSelected;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehiclePaintPickerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a paint swatch (or reset) was picked.</summary>
    public long PaintsSelected => Interlocked.Read(ref _paintsSelected);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehiclePaintPicker</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={VehiclePaintPickerRegistration.Slug}"));
    }

    /// <summary>Record that a paint was picked, emitting <c>paint.selected slug=VehiclePaintPicker</c> (no color).</summary>
    public void RecordPaintSelected()
    {
        Interlocked.Increment(ref _paintsSelected);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"paint.selected slug={VehiclePaintPickerRegistration.Slug}"));
    }
}
