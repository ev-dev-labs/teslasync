using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>VehicleSelect</c> shared surface — a parity port of the web <c>VehicleSelect</c>
/// (web/src/components/forms/VehicleSelect.tsx), the canonical per-page vehicle scope picker. Like the web
/// source it is a controlled select bound to the global scope store: it renders one option per fleet vehicle
/// (labelled <c>display_name || vin || "Vehicle {id}"</c> via the shared <see cref="VehicleLabels.Short"/>
/// rule) and writes the chosen id back to the shared <see cref="VehicleSelectState"/> holder, and it can be
/// prefixed with a small decorative <c>Car</c> icon (web <c>withIcon</c>). The native idiom is the platform
/// <see cref="ComboBox"/> (the Fluent equivalent of the web <c>&lt;Select&gt;</c>) rather than a hand-rolled
/// listbox. Because a native scope picker binds the fleet load directly — where the web component delegates
/// those states to its page — the surface also renders the holder's loading (<see cref="TsSpinner"/>), failed
/// (<see cref="TsErrorDisplay"/> with a retry affordance) and resolved-but-empty (<see cref="TsEmptyState"/>)
/// states inline; only one is ever visible. The web store is a plain scope value with no freshness or
/// connectivity dimension, so there is no stale / offline chrome to reproduce.
///
/// <para>
/// The combo carries the trigger's accessible name (web <c>aria-label</c>), the decorative car glyph is hidden
/// from Narrator (<see cref="AccessibilityView.Raw"/>, web <c>aria-hidden</c>), and the surface emits the
/// <c>view.opened</c> diagnostic once when shown. It binds the <see cref="VehicleSelectViewModel"/> and
/// performs no I/O of its own.
/// </para>
/// </summary>
public sealed partial class VehicleSelect : ContentControl, IDisposable
{
    private const string CarGlyph = "\uE804"; // Segoe Fluent Icons "Car" — the web lucide Car icon (decorative).
    private const double IconSize = 16;        // web h-4 w-4.

    private readonly VehicleSelectViewModel _viewModel;
    private readonly VehicleSelectDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly TsSpinner _spinner = new();
    private readonly TsErrorDisplay _error = new();
    private readonly TsEmptyState _empty = new();
    private readonly StackPanel _ready = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

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

    /// <summary>Creates the surface over the shared fleet state, the i18n facade and the optional-icon flag.</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c>).</param>
    /// <param name="localizer">The i18n facade every caption resolves through (P1/S10).</param>
    /// <param name="withIcon">When true, prefixes a small decorative <c>Car</c> icon (web <c>withIcon</c>).</param>
    /// <param name="ariaLabel">Optional override for the trigger's accessible name (web <c>ariaLabel</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleSelect(
        VehicleSelectState state,
        ILocalizer localizer,
        bool withIcon = false,
        string? ariaLabel = null,
        VehicleSelectDiagnostics? diagnostics = null)
        : this(new VehicleSelectViewModel(state, localizer, withIcon, ariaLabel), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleSelect(VehicleSelectViewModel viewModel, VehicleSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new VehicleSelectDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        _ready.Children.Add(_icon);
        _ready.Children.Add(_combo);

        _root.Children.Add(_spinner);
        _root.Children.Add(_error);
        _root.Children.Add(_empty);
        _root.Children.Add(_ready);
        Content = _root;

        _combo.SelectionChanged += OnComboSelectionChanged;
        _error.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>VehicleSelect</c>).</summary>
    public static string Slug => VehicleSelectRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehicleSelectViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _combo.SelectionChanged -= OnComboSelectionChanged;
        _error.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_viewOpenedRecorded)
        {
            _viewOpenedRecorded = true;
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Retry();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Render();

    private void Render()
    {
        _spinner.Label = _viewModel.LoadingText;
        _error.Title = _viewModel.ErrorTitle;
        _error.Message = _viewModel.ErrorMessage;
        _error.ActionText = _viewModel.RetryText;
        _empty.Title = _viewModel.EmptyTitle;
        _empty.Message = _viewModel.EmptyMessage;
        _combo.PlaceholderText = _viewModel.PromptText; // parity:allow ComboBox.PlaceholderText is the WinUI prompt API.
        AutomationProperties.SetName(_combo, _viewModel.AriaLabel);
        _icon.Visibility = _viewModel.WithIcon ? Visibility.Visible : Visibility.Collapsed;

        RebuildOptions();

        var status = _viewModel.Status;
        _spinner.Visibility = status == VehicleSelectStatus.Loading ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = status == VehicleSelectStatus.Error ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = status == VehicleSelectStatus.Empty ? Visibility.Visible : Visibility.Collapsed;
        _ready.Visibility = status == VehicleSelectStatus.Ready ? Visibility.Visible : Visibility.Collapsed;

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
            .FirstOrDefault(cbi => cbi.Tag is VehicleSelectItem item && item.Id == _viewModel.SelectedId);
        _combo.SelectedItem = match;
        _suppress = false;
    }

    private void OnComboSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        var value = _combo.SelectedItem is ComboBoxItem { Tag: VehicleSelectItem item } ? item.Value : null;
        _viewModel.SelectByValue(value);
    }
}
