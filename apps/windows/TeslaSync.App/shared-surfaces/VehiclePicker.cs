using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>VehiclePicker</c> shared surface — a parity port of the web <c>VehiclePicker</c>
/// (web/src/components/layout/VehiclePicker.tsx), the persistent app-wide vehicle selector mounted in the sidebar
/// header. Like the web source it is a controlled picker wired to the global scope store: a decorative leading
/// <c>Car</c> glyph plus a platform <see cref="ComboBox"/> (the Fluent equivalent of the web <c>&lt;Select&gt;</c>)
/// that floats pinned vehicles to the top in pin-position order, prefixes each pinned option with a 📌 glyph,
/// labels every option <c>display_name || vin || "Vehicle {id}"</c> (via the shared
/// <see cref="VehicleLabels.Short"/> rule), and writes the chosen id back to the shared
/// <see cref="VehicleSelectState"/>. It binds the <see cref="VehiclePickerViewModel"/> (over that shared holder +
/// the <see cref="IVehiclePinSource"/> pin seam) and performs no I/O of its own.
///
/// <para>
/// State coverage: the web component renders exactly two ways — the icon + select when the fleet holds two or
/// more vehicles, and nothing at all (<c>return null</c>) otherwise. This surface reproduces both: the populated
/// picker (<see cref="VehiclePickerStatus.Ready"/>) and the collapsed surface
/// (<see cref="VehiclePickerStatus.Hidden"/>, <see cref="Visibility.Collapsed"/>). The web
/// <c>useSelectedVehicle()</c> / <c>usePinned()</c> reads carry no freshness or connectivity dimension and the web
/// source hides while the fleet is still loading, so the data-source lifecycle states (loading, resolved-empty,
/// failed, stale, offline) and the single-vehicle case all collapse into the hidden state exactly as the web
/// source collapses them into <c>return null</c> — reproduced and tested in <c>VehiclePickerTests</c>. The combo
/// carries the trigger's accessible name (web <c>aria-label</c>), the decorative car glyph is hidden from Narrator
/// (<see cref="AccessibilityView.Raw"/>, web <c>aria-hidden</c>), the surface uses no entrance animation (matching
/// the web, which simply mounts, so the OS reduce-motion preference is honoured by construction), and it emits the
/// <c>view.opened</c> diagnostic once when first mounted.
/// </para>
/// </summary>
public sealed partial class VehiclePicker : ContentControl, IDisposable
{
    private const string CarGlyph = "\uE804";   // Segoe Fluent Icons "Car" — the web lucide Car icon (decorative).
    private const double IconSize = 16;          // web h-4 w-4.
    private const double RowSpacing = 8;         // web gap-2.
    private const double PaddingH = 12;          // web px-3.
    private const double PaddingV = 8;           // web py-2.
    private const double BottomBorderThickness = 1; // web border-b.

    private readonly VehiclePickerViewModel _viewModel;
    private readonly VehiclePickerDiagnostics _diagnostics;

    private readonly Border _root = new()
    {
        Padding = new Thickness(PaddingH, PaddingV, PaddingH, PaddingV),
        BorderThickness = new Thickness(0, 0, 0, BottomBorderThickness), // web border-b (bottom hairline only).
    };

    private readonly Grid _layout = new() { ColumnSpacing = RowSpacing };

    private readonly FontIcon _icon = new()
    {
        Glyph = CarGlyph,
        FontSize = IconSize,
        FontFamily = new FontFamily("Segoe Fluent Icons"),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ComboBox _combo = new() { HorizontalAlignment = HorizontalAlignment.Stretch };

    private bool _suppress;
    private bool _viewOpenedRecorded;
    private bool _disposed;

    /// <summary>Creates the surface over the shared fleet state, the pin seam, the i18n facade and diagnostics.</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c>).</param>
    /// <param name="pins">The pin seam (web <c>usePinned('vehicle')</c>).</param>
    /// <param name="localizer">The i18n facade every caption resolves through (P1/S10).</param>
    /// <param name="ariaLabel">Optional override for the trigger's accessible name (web <c>ariaLabel</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehiclePicker(
        VehicleSelectState state,
        IVehiclePinSource pins,
        ILocalizer localizer,
        string? ariaLabel = null,
        VehiclePickerDiagnostics? diagnostics = null)
        : this(new VehiclePickerViewModel(state, pins, localizer, ariaLabel), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehiclePicker(VehiclePickerViewModel viewModel, VehiclePickerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new VehiclePickerDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_combo, 1);

        // The car glyph is decorative; the combo's accessible name (web aria-label) is authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        _layout.Children.Add(_icon);
        _layout.Children.Add(_combo);

        _root.Child = _layout;
        Content = _root;

        _combo.SelectionChanged += OnComboSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>VehiclePicker</c>).</summary>
    public static string Slug => VehiclePickerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehiclePickerViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _combo.SelectionChanged -= OnComboSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_viewOpenedRecorded)
        {
            _viewOpenedRecorded = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Render();

    private void Render()
    {
        _icon.Foreground = DisplayTokens.TextMuted;            // web text-[var(--text-muted)].
        _root.BorderBrush = DisplayTokens.Border;              // web border-[var(--glass-border)].
        _combo.PlaceholderText = _viewModel.AriaLabel;         // parity:allow ComboBox.PlaceholderText is the WinUI prompt API; reuses the single aria key.
        AutomationProperties.SetName(_combo, _viewModel.AriaLabel);

        RebuildOptions();

        // web: returns null unless vehicles.length > 1 — the surface collapses entirely otherwise.
        Visibility = _viewModel.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        SyncComboSelection();
    }

    private void RebuildOptions()
    {
        _suppress = true;
        _combo.Items.Clear();
        foreach (var item in _viewModel.Items)
        {
            _combo.Items.Add(new ComboBoxItem { Content = item.Label, Tag = item });
        }

        _suppress = false;
    }

    private void SyncComboSelection()
    {
        _suppress = true;
        var match = _combo.Items
            .OfType<ComboBoxItem>()
            .FirstOrDefault(cbi => cbi.Tag is VehiclePickerItem item && item.Id == _viewModel.SelectedId);
        _combo.SelectedItem = match;
        _suppress = false;
    }

    private void OnComboSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        var value = _combo.SelectedItem is ComboBoxItem { Tag: VehiclePickerItem item } ? item.Value : null;
        _viewModel.SelectByValue(value);
    }
}
