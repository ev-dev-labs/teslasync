using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.Components.Vehicles;

/// <summary>
/// The vehicle hero card (port of the web <c>VehicleHeroCard</c>). Shows the vehicle
/// identity, four live gauges (battery, range, inside/outside temperature) and a
/// detail grid, converting SI state to the user's display units at the render
/// boundary via <see cref="VehicleHeroMetrics"/> + <see cref="UnitPref"/>. When no
/// state is reported it shows an empty state rather than hiding the panel.
/// </summary>
public partial class TsVehicleHeroCard : ContentControl
{
    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.Cyan };
    private readonly StackPanel _root = new() { Spacing = 16 };

    private readonly Heading _name = new();
    private readonly Code _vin = new();
    private readonly TsBadge _model = new();

    private readonly StackPanel _gauges = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
    };

    private readonly TsRadialGauge _battery = new() { Diameter = 100, ColorIndex = 1 };
    private readonly TsRadialGauge _range = new() { Diameter = 100, ColorIndex = 0 };
    private readonly TsRadialGauge _insideTemp = new() { Diameter = 100, ColorIndex = 2 };
    private readonly TsRadialGauge _outsideTemp = new() { Diameter = 100, ColorIndex = 3 };

    private readonly Grid _stats = new();
    private readonly TsEmptyState _empty = new();

    private readonly TsStatCard _statInside = new();
    private readonly TsStatCard _statOutside = new();
    private readonly TsStatCard _odometerStat = new();
    private readonly TsStatCard _statRange = new();
    private readonly TsStatCard _statLock = new();
    private readonly TsStatCard _statSentry = new();
    private readonly TsStatCard _statFirmware = new();
    private readonly TsStatCard _statPower = new();

    private VehicleHeroState? _state;

    public static readonly DependencyProperty PrefProperty = DependencyProperty.Register(
        nameof(Pref), typeof(UnitPref), typeof(TsVehicleHeroCard), new PropertyMetadata(null, OnPrefChanged));

    public TsVehicleHeroCard()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _battery.Label = "Battery";
        _battery.Unit = "%";
        _range.Label = "Range";
        _insideTemp.Label = "Inside";
        _outsideTemp.Label = "Outside";

        _empty.IconGlyph = "\uE804";
        _empty.Title = "No live state";
        _empty.Message = "This vehicle has not reported any telemetry yet.";
        _empty.Visibility = Visibility.Collapsed;

        BuildHeader();
        BuildGauges();
        BuildStats();

        _root.Children.Add(_empty);
        _panel.Content = _root;
        Content = _panel;
        Rebuild();
    }

    /// <summary>The unit-display preference applied to the gauges + stats.</summary>
    public UnitPref? Pref
    {
        get => (UnitPref?)GetValue(PrefProperty);
        set => SetValue(PrefProperty, value);
    }

    /// <summary>Set the vehicle identity shown in the header.</summary>
    public void SetVehicle(string displayName, string model, string vin, string statusText)
    {
        _name.Value = displayName ?? string.Empty;
        _model.Content = model ?? string.Empty;
        _vin.Value = vin ?? string.Empty;
        AutomationProperties.SetName(this, $"{displayName} {statusText}".Trim());
    }

    /// <summary>Set (or clear) the SI vehicle state; null shows the empty state.</summary>
    public void SetState(VehicleHeroState? state)
    {
        _state = state;
        Rebuild();
    }

    private static void OnPrefChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsVehicleHeroCard)d).Rebuild();

    private UnitPref EffectivePref => Pref ?? UnitPref.Metric;

    private void BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        var topRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        topRow.Children.Add(_name);
        topRow.Children.Add(_model);
        header.Children.Add(topRow);
        header.Children.Add(_vin);
        _root.Children.Add(header);
    }

    private void BuildGauges()
    {
        _gauges.Children.Add(_battery);
        _gauges.Children.Add(_range);
        _gauges.Children.Add(_insideTemp);
        _gauges.Children.Add(_outsideTemp);
        _root.Children.Add(_gauges);
    }

    private void BuildStats()
    {
        for (int c = 0; c < 4; c++)
        {
            _stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        _stats.RowSpacing = 12;
        _stats.ColumnSpacing = 12;
        _stats.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _stats.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        TsStatCard[] cards =
        [
            _statInside, _statOutside, _odometerStat, _statRange,
            _statLock, _statSentry, _statFirmware, _statPower,
        ];

        for (int i = 0; i < cards.Length; i++)
        {
            Grid.SetColumn(cards[i], i % 4);
            Grid.SetRow(cards[i], i / 4);
            _stats.Children.Add(cards[i]);
        }

        _statInside.Label = "Inside Temp";
        _statOutside.Label = "Outside Temp";
        _odometerStat.Label = "Odometer";
        _statRange.Label = "Range";
        _statLock.Label = "Status";
        _statSentry.Label = "Sentry";
        _statFirmware.Label = "Firmware";
        _statPower.Label = "Power";

        _root.Children.Add(_stats);
    }

    private void Rebuild()
    {
        bool hasState = _state is not null;
        _gauges.Visibility = hasState ? Visibility.Visible : Visibility.Collapsed;
        _stats.Visibility = hasState ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = hasState ? Visibility.Collapsed : Visibility.Visible;

        if (_state is not { } s)
        {
            return;
        }

        var pref = EffectivePref;
        var c = System.Globalization.CultureInfo.InvariantCulture;

        var battery = VehicleHeroMetrics.Battery(s);
        _battery.Value = battery.Value;
        _battery.Max = battery.Max;

        var range = VehicleHeroMetrics.Range(s, pref);
        _range.Value = range.Value;
        _range.Max = range.Max;
        _range.Unit = range.UnitLabel;

        var inside = VehicleHeroMetrics.InsideTemp(s, pref);
        _insideTemp.Value = inside.Value;
        _insideTemp.Max = inside.Max;
        _insideTemp.Unit = inside.UnitLabel;

        var outside = VehicleHeroMetrics.OutsideTemp(s, pref);
        _outsideTemp.Value = outside.Value;
        _outsideTemp.Max = outside.Max;
        _outsideTemp.Unit = outside.UnitLabel;

        double odometer = VehicleHeroMetrics.OdometerDisplay(s, pref);
        double power = VehicleHeroMetrics.PowerKilowatts(s);

        _statInside.Value = string.Create(c, $"{inside.Value:0} {inside.UnitLabel}");
        _statOutside.Value = string.Create(c, $"{outside.Value:0} {outside.UnitLabel}");
        _odometerStat.Value = string.Create(c, $"{odometer:0} {range.UnitLabel}");
        _statRange.Value = string.Create(c, $"{range.Value:0} {range.UnitLabel}");
        _statLock.Value = VehicleTwinPresentation.LockLabel(s.IsLocked);
        _statSentry.Value = s.SentryMode == true ? "On" : "Off";
        _statFirmware.Value = string.IsNullOrEmpty(s.SoftwareVersion) ? "—" : s.SoftwareVersion;
        _statPower.Value = string.Create(c, $"{power:0.#} kW");
    }
}
