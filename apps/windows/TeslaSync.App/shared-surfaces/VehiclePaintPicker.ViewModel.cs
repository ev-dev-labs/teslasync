using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="VehiclePaintPicker"/> view — the native port of
/// the web <c>VehiclePaintPicker</c> body (web/src/components/vehicles/VehiclePaintPicker.tsx) plus its
/// <c>useVehiclePaint</c> hook (web/src/hooks/useVehiclePaint.ts). It resolves the active paint exactly as the
/// web hook does — override (the per-vehicle <see cref="IVehiclePaintStore"/> slot) &gt; inferred (from the Tesla
/// <see cref="ExteriorColor"/> code via <see cref="PaintPalettes.InferFromTesla"/>) &gt; the high-contrast Pearl
/// White fallback — projects the five <see cref="PaintPalettes.All"/> entries into render-ready
/// <see cref="PaintSwatchItem"/>s (web <c>PAINT_PALETTE_LIST.map</c>), resolves every label through the i18n
/// facade, and exposes whether the user has overridden the auto-detected paint (web <c>isOverridden</c>, which
/// shows the reset affordance). Picking a swatch is the web <c>setPaint</c>: selecting the inferred color clears
/// the override (so the picker stays in sync if Tesla later reports a paint), otherwise it persists the choice;
/// <see cref="Reset"/> is the web <c>reset</c>. A cross-instance write (the web cross-tab broadcast / same-tab
/// notify) flows in through <see cref="IVehiclePaintStore.ExternalChanged"/>. It carries no view-framework
/// dependency so it is verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class VehiclePaintPickerViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ILocalizer _localizer;
    private readonly IVehiclePaintStore _store;

    private long _vehicleId;
    private string? _exteriorColor;
    private PaintPaletteId? _overrideId;
    private bool _disposed;

    /// <summary>Creates the holder over the i18n facade and the per-vehicle paint store (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="store">The per-vehicle override store the picker reads and writes.</param>
    public VehiclePaintPickerViewModel(ILocalizer localizer, IVehiclePaintStore store)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(store);
        _localizer = localizer;
        _store = store;
        _store.ExternalChanged += OnExternalChanged;
        _overrideId = LoadOverride();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>VehiclePaintPicker</c>).</summary>
    public static string Slug => VehiclePaintPickerRegistration.Slug;

    /// <summary>
    /// The vehicle the picker targets (web <c>vehicleId</c> prop). Switching re-reads that vehicle's override
    /// slot (web effect: <c>setOverrideId(readOverride(vehicleId))</c>).
    /// </summary>
    public long VehicleId
    {
        get => _vehicleId;
        set
        {
            if (_vehicleId == value)
            {
                return;
            }

            _vehicleId = value;
            _overrideId = LoadOverride();
            RaiseAll();
        }
    }

    /// <summary>
    /// The Tesla <c>exterior_color</c> code driving the auto-detected paint (web <c>exteriorColor</c> prop).
    /// Changing it recomputes <see cref="Inferred"/> and, when not overridden, the active <see cref="Paint"/>.
    /// </summary>
    public string? ExteriorColor
    {
        get => _exteriorColor;
        set
        {
            if (string.Equals(_exteriorColor, value, StringComparison.Ordinal))
            {
                return;
            }

            _exteriorColor = value;
            RaiseAll();
        }
    }

    /// <summary>Whether the target vehicle id is a usable, persistable slot (web <c>vehicleId &gt; 0</c>).</summary>
    public bool IsValidVehicle => _vehicleId > 0;

    /// <summary>The auto-detected paint (web <c>inferred</c>), ignoring any override.</summary>
    public PaintPalette Inferred => PaintPalettes.InferFromTesla(_exteriorColor);

    /// <summary>The active paint — override when set, otherwise inferred (web <c>paint</c>).</summary>
    public PaintPalette Paint => _overrideId is { } id ? PaintPalettes.ById(id) : Inferred;

    /// <summary>Whether the user has manually picked a color for this vehicle (web <c>isOverridden</c>).</summary>
    public bool IsOverridden => _overrideId is not null;

    /// <summary>The radio-group accessible name (web <c>aria-label={t('paint.pickerLabel', …)}</c>).</summary>
    public string PickerLabel =>
        _localizer.GetString(VehiclePaintPickerRegistration.PickerLabelKey, VehiclePaintPickerRegistration.PickerLabelFallback);

    /// <summary>The leading "Paint" caption (web <c>t('paint.label', 'Paint')</c>).</summary>
    public string Caption =>
        _localizer.GetString(VehiclePaintPickerRegistration.CaptionKey, VehiclePaintPickerRegistration.CaptionFallback);

    /// <summary>The reset-to-auto button label (web <c>t('paint.reset', 'Reset to auto-detected')</c>).</summary>
    public string ResetLabel =>
        _localizer.GetString(VehiclePaintPickerRegistration.ResetKey, VehiclePaintPickerRegistration.ResetFallback);

    /// <summary>The auto-detected tooltip suffix (web <c>t('paint.detected', 'Auto-detected')</c>).</summary>
    public string DetectedSuffix =>
        _localizer.GetString(VehiclePaintPickerRegistration.DetectedKey, VehiclePaintPickerRegistration.DetectedFallback);

    /// <summary>The active paint's localized label shown in the polite live region (web active-paint span).</summary>
    public string ActivePaintLabel => LabelFor(Paint);

    /// <summary>
    /// The five swatch options projected for the view, in display order (web
    /// <c>PAINT_PALETTE_LIST.map((p) =&gt; …)</c>). Each carries its localized label, tooltip, swatch hex and
    /// selected / inferred flags.
    /// </summary>
    public IReadOnlyList<PaintSwatchItem> Swatches
    {
        get
        {
            IReadOnlyList<PaintPalette> all = PaintPalettes.All;
            PaintPaletteId activeId = Paint.Id;
            PaintPaletteId inferredId = Inferred.Id;
            string detected = DetectedSuffix;

            var items = new PaintSwatchItem[all.Count];
            for (int i = 0; i < all.Count; i++)
            {
                PaintPalette p = all[i];
                string label = LabelFor(p);
                bool isInferred = p.Id == inferredId;
                items[i] = new PaintSwatchItem(
                    p.Id,
                    p.Swatch,
                    label,
                    isInferred ? VehiclePaintPickerRegistration.FormatDetectedTitle(label, detected) : label,
                    p.Id == activeId,
                    isInferred);
            }

            return items;
        }
    }

    /// <summary>The localized label for a palette (web <c>t(p.labelKey, p.defaultLabel)</c>).</summary>
    /// <param name="palette">The palette to label.</param>
    public string LabelFor(PaintPalette palette)
    {
        ArgumentNullException.ThrowIfNull(palette);
        return _localizer.GetString(VehiclePaintPickerRegistration.LabelKey(palette.Id), palette.DefaultLabel);
    }

    /// <summary>
    /// Pick a paint — the web <c>setPaint(id)</c>: selecting the inferred color is treated as clearing the
    /// override (so the picker re-syncs if Tesla later reports a paint), otherwise the choice is persisted. The
    /// write always flows to the store (web <c>writeOverride</c> + notify + broadcast); the surface re-renders
    /// only when the effective override actually changed. A <see langword="null"/> <paramref name="id"/> clears
    /// the override (the web <c>reset</c> path).
    /// </summary>
    /// <param name="id">The picked palette id, or <see langword="null"/> to clear the override.</param>
    /// <returns><see langword="true"/> when the effective override changed.</returns>
    public bool SetPaint(PaintPaletteId? id)
    {
        // web: const normalized = id === inferred.id ? null : id;
        PaintPaletteId? normalized = id is { } value && value == Inferred.Id ? null : id;
        bool changed = !Nullable.Equals(_overrideId, normalized);
        _overrideId = normalized;

        if (IsValidVehicle)
        {
            _store.Persist(_vehicleId, normalized);
        }

        if (changed)
        {
            RaiseAll();
        }

        return changed;
    }

    /// <summary>Clear the override and revert to the inferred paint (web <c>reset = () =&gt; setPaint(null)</c>).</summary>
    /// <returns><see langword="true"/> when an override was actually cleared.</returns>
    public bool Reset() => SetPaint(null);

    /// <summary>
    /// Re-raise so the view re-resolves every label from the localizer — call after the active language changes
    /// so the swatch labels, caption and reset label update without reconstructing the surface (web
    /// react-i18next parity).
    /// </summary>
    public void Reload() => RaiseAll();

    /// <summary>Detach from the store (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.ExternalChanged -= OnExternalChanged;
        GC.SuppressFinalize(this);
    }

    private PaintPaletteId? LoadOverride() => IsValidVehicle ? _store.Load(_vehicleId) : null;

    private void OnExternalChanged(object? sender, VehiclePaintChangedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        // web cross-tab / in-tab handler: ignore writes for other vehicles, then re-validate the new value.
        if (e.VehicleId != _vehicleId || Nullable.Equals(_overrideId, e.NewValue))
        {
            return;
        }

        _overrideId = e.NewValue;
        RaiseAll();
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
