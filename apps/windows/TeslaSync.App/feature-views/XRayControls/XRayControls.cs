using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// The native WinUI 3 <c>XRayControls</c> feature surface — a parity port of
/// web/src/features/admin/components/ingest-xray/XRayControls.tsx. It is a controlled presentational bar:
/// assign a <see cref="Model"/> (the web <c>vehicles</c> + <c>vehicleId</c> + <c>windowSel</c> +
/// <c>bucketSel</c> props) and it renders the three Fluent <see cref="TsSelect"/> dropdowns the web composes
/// — a vehicle picker (a "Select vehicle…" prompt plus one option per vehicle, labelled
/// <c>display_name || vin || "Vehicle {id}"</c>), a window selector, and a bucket selector whose options
/// auto-disable any granularity &gt;= the selected window (the web guard against the server-side
/// "bucket &gt;= window" 400). Picking a value raises the typed <see cref="VehicleChanged"/> /
/// <see cref="WindowChanged"/> / <see cref="BucketChanged"/> event the host applies (the web
/// <c>onVehicleChange</c> / <c>onWindowChange</c> / <c>onBucketChange</c> callbacks); the surface never
/// performs HTTP and never mutates its own model. Beyond the web's pure render it additionally surfaces the
/// parent fleet query's loading / stale / offline / error lifecycle on the vehicle picker (a strict superset
/// — the window and bucket selectors stay interactive throughout). All branch selection, option building and
/// label resolution happen in the WinUI-free <see cref="XRayControlsProjection"/>; every string resolves
/// through the i18n facade and every selector carries a Narrator name.
/// </summary>
public sealed partial class XRayControls : ContentControl
{
    private const string RetryGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double VehicleSelectWidth = 256; // web w-64
    private const double ScaleSelectWidth = 160;   // web w-40

    private readonly ILocalizer _localizer;
    private readonly XRayControlsDiagnostics _diagnostics;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly StackPanel _controlsRow = new() { Orientation = Orientation.Horizontal, Spacing = 16 };
    private readonly Caption _vehicleLabel = new();
    private readonly Caption _windowLabel = new();
    private readonly Caption _bucketLabel = new();
    private readonly TsSelect _vehicleSelect = new() { Width = VehicleSelectWidth };
    private readonly TsSelect _windowSelect = new() { Width = ScaleSelectWidth };
    private readonly TsSelect _bucketSelect = new() { Width = ScaleSelectWidth };
    private readonly TsButton _retryButton = new();
    private readonly TextBlock _hint;

    private XRayControlsModel _model;
    private bool _opened;
    private bool _suppress;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="XRayControlsModel.Initial"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public XRayControls(
        ILocalizer localizer,
        XRayControlsModel? model = null,
        XRayControlsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? XRayControlsModel.Initial;
        _diagnostics = diagnostics ?? new XRayControlsDiagnostics();
        _hint = DisplayPrimitives.Caption();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _windowSelect.SelectionChanged += OnWindowSelectionChanged;
        _bucketSelect.SelectionChanged += OnBucketSelectionChanged;
        _retryButton.Click += OnRetryClick;
        Loaded += OnLoaded;

        Render();
    }

    /// <summary>Raised when the operator picks a different vehicle (null = the "Select vehicle…" prompt).</summary>
    public event EventHandler<int?>? VehicleChanged;

    /// <summary>Raised when the operator picks a different rolling window.</summary>
    public event EventHandler<IngestXRayWindow>? WindowChanged;

    /// <summary>Raised when the operator picks a different bucket granularity.</summary>
    public event EventHandler<IngestXRayBucket>? BucketChanged;

    /// <summary>Raised when the operator asks to retry a failed fleet load (the error-state retry).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>XRayControls</c>).</summary>
    public static string Slug => XRayControlsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public XRayControlsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void BuildChrome()
    {
        _retryButton.Variant = ButtonVariant.Secondary;
        _retryButton.Size = ControlSize.Small;
        _retryButton.IconGlyph = RetryGlyph;
        _retryButton.VerticalAlignment = VerticalAlignment.Center;
        _retryButton.Visibility = Visibility.Collapsed;

        _statusRow.Children.Add(_retryButton);

        _controlsRow.Children.Add(Field(_vehicleLabel, _vehicleSelect));
        _controlsRow.Children.Add(Field(_windowLabel, _windowSelect));
        _controlsRow.Children.Add(Field(_bucketLabel, _bucketSelect));

        _hint.TextWrapping = TextWrapping.Wrap;
        _hint.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_hint);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_controlsRow);
        _root.Children.Add(_hint);

        Content = _root;
    }

    private static StackPanel Field(Caption label, TsSelect select)
    {
        var column = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(label);
        column.Children.Add(select);
        return column;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private void Render()
    {
        var display = XRayControlsProjection.Project(_model, _localizer);

        _suppress = true;

        _vehicleLabel.Value = display.VehicleLabel;
        _windowLabel.Value = display.WindowLabel;
        _bucketLabel.Value = display.BucketLabel;

        AutomationProperties.SetName(_vehicleSelect, display.VehicleLabel);
        AutomationProperties.SetName(_windowSelect, display.WindowLabel);
        AutomationProperties.SetName(_bucketSelect, display.BucketLabel);

        Fill(_vehicleSelect, display.VehicleOptions, display.SelectedVehicleValue);
        Fill(_windowSelect, display.WindowOptions, display.SelectedWindowValue);
        Fill(_bucketSelect, display.BucketOptions, display.SelectedBucketValue);

        _vehicleSelect.IsEnabled = display.VehiclePickerEnabled;

        _suppress = false;

        UpdateStatusRow(display);
        UpdateHint(display);

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void UpdateStatusRow(XRayControlsDisplay display)
    {
        _statusRow.Children.Clear();

        if (display.StatusChip is { } chip)
        {
            _statusRow.Children.Add(BuildBadge(chip, display.StatusChipKind));
        }

        if (display.RetryLabel is { } retry)
        {
            _retryButton.Text = retry;
            AutomationProperties.SetName(_retryButton, retry);
            _retryButton.Visibility = Visibility.Visible;
            _statusRow.Children.Add(_retryButton);
        }
        else
        {
            _retryButton.Visibility = Visibility.Collapsed;
        }

        _statusRow.Visibility = _statusRow.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateHint(XRayControlsDisplay display)
    {
        if (string.IsNullOrEmpty(display.Hint))
        {
            _hint.Visibility = Visibility.Collapsed;
            _hint.Text = string.Empty;
            return;
        }

        _hint.Text = display.Hint;
        _hint.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_hint, display.Hint);
        LiveRegion.Announce(_hint);
    }

    private static void Fill(ComboBox combo, IReadOnlyList<ComboOption> options, string selectedValue)
    {
        combo.Items.Clear();
        ComboBoxItem? selected = null;

        foreach (var option in options)
        {
            var item = new ComboBoxItem
            {
                Content = option.Label,
                Tag = option.Value,
                IsEnabled = !option.Disabled,
            };
            AutomationProperties.SetName(item, option.Label);
            combo.Items.Add(item);

            if (string.Equals(option.Value, selectedValue, StringComparison.Ordinal))
            {
                selected = item;
            }
        }

        combo.SelectedItem = selected;
    }

    private void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        int? id = null;
        if (_vehicleSelect.SelectedItem is ComboBoxItem { Tag: string value }
            && !string.IsNullOrEmpty(value)
            && int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed))
        {
            id = parsed;
        }

        VehicleChanged?.Invoke(this, id);
    }

    private void OnWindowSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        if (_windowSelect.SelectedItem is ComboBoxItem { Tag: string wire })
        {
            WindowChanged?.Invoke(this, IngestXRayWindows.FromWire(wire));
        }
    }

    private void OnBucketSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        if (_bucketSelect.SelectedItem is ComboBoxItem { Tag: string wire })
        {
            BucketChanged?.Invoke(this, XRayControlsBuckets.FromWire(wire));
        }
    }

    private static TsBadge BuildBadge(string text, StatusKind kind)
    {
        var badge = new TsBadge
        {
            Status = kind,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }
}
