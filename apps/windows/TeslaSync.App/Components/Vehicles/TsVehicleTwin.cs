using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.Components.Vehicles;

/// <summary>
/// The vehicle digital twin (native port of the web <c>VehicleTwin</c>). Draws a
/// tokenized, paint-aware side-view schematic whose doors, windows, frunk/trunk,
/// charge port, headlights and lock/sentry indicators reflect the bound
/// <see cref="VehicleTwinModel"/> via the semantic colours in
/// <see cref="VehicleTwinPresentation"/>. A textual status legend and an
/// <c>role="img"</c>-equivalent accessible summary expose the same state non-visually.
/// </summary>
public partial class TsVehicleTwin : ContentControl
{
    private const double LogicalWidth = 560;
    private const double LogicalHeight = 220;

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly Canvas _canvas = new() { Width = LogicalWidth, Height = LogicalHeight };
    private readonly StackPanel _legend = new() { Spacing = 6 };

    private VehicleTwinModel _model = new();
    private PaintPalette? _paintOverride;

    public TsVehicleTwin()
    {
        IsTabStop = true;
        AutomationProperties.SetAccessibilityView(this, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Content);

        var viewbox = new Viewbox
        {
            Child = _canvas,
            Stretch = Stretch.Uniform,
            MaxWidth = LogicalWidth,
        };

        _root.Children.Add(viewbox);
        _root.Children.Add(_legend);
        Content = _root;
        Rebuild();
    }

    /// <summary>Bind the current digital-twin state and redraw.</summary>
    public void SetModel(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        _model = model;
        Rebuild();
    }

    /// <summary>Force a specific paint palette (otherwise inferred from the model).</summary>
    public void SetPaint(PaintPalette? paint)
    {
        _paintOverride = paint;
        Rebuild();
    }

    /// <summary>The paint currently applied (override, else inferred from the model).</summary>
    public PaintPalette ActivePaint =>
        _paintOverride ?? PaintPalettes.InferFromTesla(_model.ExteriorColor);

    private static Brush Hex(string hex) => DisplayPrimitives.HexBrush(hex);

    private void Rebuild()
    {
        _canvas.Children.Clear();
        var paint = ActivePaint;

        DrawBody(paint);
        DrawGreenhouse();
        DrawWindows();
        DrawDoorSeams();
        DrawFrunkTrunk();
        DrawWheels();
        DrawLighting(paint);
        DrawChargePort();
        DrawSecurity();

        BuildLegend();
        AutomationProperties.SetName(this, BuildSummary());
    }

    private void DrawBody(PaintPalette paint)
    {
        var gradient = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1) };
        gradient.GradientStops.Add(new GradientStop { Color = ToColor(paint.BodyTop), Offset = 0 });
        gradient.GradientStops.Add(new GradientStop { Color = ToColor(paint.BodyBottom), Offset = 1 });

        var body = new Rectangle
        {
            Width = 440,
            Height = 80,
            RadiusX = 28,
            RadiusY = 28,
            Fill = gradient,
            Stroke = Hex(paint.Stroke),
            StrokeThickness = 2,
        };
        Canvas.SetLeft(body, 60);
        Canvas.SetTop(body, 90);
        _canvas.Children.Add(body);

        var highlight = new Rectangle
        {
            Width = 420,
            Height = 6,
            RadiusX = 3,
            RadiusY = 3,
            Fill = Hex(paint.Highlight),
            Opacity = 0.7,
        };
        Canvas.SetLeft(highlight, 70);
        Canvas.SetTop(highlight, 94);
        _canvas.Children.Add(highlight);
    }

    private void DrawGreenhouse()
    {
        var roof = new Rectangle
        {
            Width = 230,
            Height = 52,
            RadiusX = 20,
            RadiusY = 20,
            Fill = Hex("#0F172A"),
            Stroke = Hex(VehicleTwinPresentation.GlassStroke),
            StrokeThickness = 2,
            Opacity = 0.92,
        };
        Canvas.SetLeft(roof, 165);
        Canvas.SetTop(roof, 52);
        _canvas.Children.Add(roof);
    }

    private void DrawWindows()
    {
        AddWindow(180, 58, _model.WindowDriverFront, "Front window");
        AddWindow(295, 58, _model.WindowDriverRear, "Rear window");
    }

    private void AddWindow(double left, double top, WindowPosition state, string label)
    {
        var window = new Rectangle
        {
            Width = 75,
            Height = 38,
            RadiusX = 8,
            RadiusY = 8,
            Fill = Hex("#1E293B"),
            Stroke = Hex(VehicleTwinPresentation.WindowStroke(state)),
            StrokeThickness = state == WindowPosition.Closed ? 2 : 4,
        };
        AutomationProperties.SetName(window, $"{label}: {VehicleTwinPresentation.WindowLabel(state)}");
        Canvas.SetLeft(window, left);
        Canvas.SetTop(window, top);
        _canvas.Children.Add(window);
    }

    private void DrawDoorSeams()
    {
        AddSeam(250, _model.DoorDriverFront, "Driver front door");
        AddSeam(330, _model.DoorDriverRear, "Driver rear door");
    }

    private void AddSeam(double x, bool? open, string label)
    {
        var seam = new Line
        {
            X1 = x,
            Y1 = 96,
            X2 = x,
            Y2 = 164,
            Stroke = Hex(VehicleTwinPresentation.DoorStroke(open)),
            StrokeThickness = open == true ? 4 : 2,
        };
        AutomationProperties.SetName(seam, $"{label}: {VehicleTwinPresentation.StateLabel(open, "Open", "Closed")}");
        _canvas.Children.Add(seam);

        var handle = new Rectangle
        {
            Width = 18,
            Height = 5,
            RadiusX = 2,
            RadiusY = 2,
            Fill = Hex(VehicleTwinPresentation.DoorStroke(open)),
        };
        Canvas.SetLeft(handle, x + 6);
        Canvas.SetTop(handle, 118);
        _canvas.Children.Add(handle);
    }

    private void DrawFrunkTrunk()
    {
        // Front of the car is on the right; rear (trunk) on the left.
        AddLid(468, _model.FrunkOpen, "Frunk");
        AddLid(70, _model.TrunkOpen, "Trunk");
    }

    private void AddLid(double left, bool? open, string label)
    {
        var lid = new Rectangle
        {
            Width = 24,
            Height = 34,
            RadiusX = 6,
            RadiusY = 6,
            Fill = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            Stroke = Hex(VehicleTwinPresentation.DoorStroke(open)),
            StrokeThickness = open == true ? 4 : 2,
        };
        AutomationProperties.SetName(lid, $"{label}: {VehicleTwinPresentation.StateLabel(open, "Open", "Closed")}");
        Canvas.SetLeft(lid, left);
        Canvas.SetTop(lid, 108);
        _canvas.Children.Add(lid);
    }

    private void DrawWheels()
    {
        AddWheel(150);
        AddWheel(410);
    }

    private void AddWheel(double cx)
    {
        var tyre = new Ellipse { Width = 56, Height = 56, Fill = Hex("#111827"), Stroke = Hex("#1F2937"), StrokeThickness = 3 };
        Canvas.SetLeft(tyre, cx - 28);
        Canvas.SetTop(tyre, 140);
        _canvas.Children.Add(tyre);

        var rim = new Ellipse { Width = 26, Height = 26, Fill = Hex("#334155"), Stroke = Hex("#64748B"), StrokeThickness = 2 };
        Canvas.SetLeft(rim, cx - 13);
        Canvas.SetTop(rim, 155);
        _canvas.Children.Add(rim);
    }

    private void DrawLighting(PaintPalette paint)
    {
        bool on = _model.Headlights == true;
        var head = new Ellipse
        {
            Width = 18,
            Height = 14,
            Fill = Hex(on ? VehicleTwinPresentation.HeadlightOn : "#475569"),
            Opacity = on ? 1 : 0.6,
        };
        AutomationProperties.SetName(head, $"Headlights: {VehicleTwinPresentation.StateLabel(_model.Headlights, "On", "Off")}");
        Canvas.SetLeft(head, 486);
        Canvas.SetTop(head, 120);
        _canvas.Children.Add(head);

        var tail = new Ellipse { Width = 14, Height = 12, Fill = Hex("#EF4444"), Opacity = on ? 0.95 : 0.55 };
        Canvas.SetLeft(tail, 62);
        Canvas.SetTop(tail, 121);
        _canvas.Children.Add(tail);
    }

    private void DrawChargePort()
    {
        string color = _model.IsCharging
            ? VehicleTwinPresentation.ChargeGreen
            : _model.ChargePortOpen == true ? VehicleTwinPresentation.AmberOpen : VehicleTwinPresentation.Neutral;

        var port = new Ellipse { Width = 14, Height = 14, Fill = Hex(color), Stroke = Hex("#0F172A"), StrokeThickness = 2 };
        string label = _model.IsCharging
            ? "Charging"
            : $"Charge port: {VehicleTwinPresentation.StateLabel(_model.ChargePortOpen, "Open", "Closed")}";
        AutomationProperties.SetName(port, label);
        Canvas.SetLeft(port, 96);
        Canvas.SetTop(port, 96);
        _canvas.Children.Add(port);
    }

    private void DrawSecurity()
    {
        var lockIcon = new FontIcon
        {
            Glyph = _model.Locked == false ? "\uE785" : "\uE72E",
            FontSize = 22,
            Foreground = Hex(VehicleTwinPresentation.LockColor(_model.Locked)),
        };
        AutomationProperties.SetName(lockIcon, VehicleTwinPresentation.LockLabel(_model.Locked));
        Canvas.SetLeft(lockIcon, 272);
        Canvas.SetTop(lockIcon, 112);
        _canvas.Children.Add(lockIcon);

        if (_model.SentryMode == true)
        {
            var sentry = new FontIcon { Glyph = "\uE890", FontSize = 18, Foreground = Hex(VehicleTwinPresentation.SentryRed) };
            AutomationProperties.SetName(sentry, "Sentry on");
            Canvas.SetLeft(sentry, 300);
            Canvas.SetTop(sentry, 70);
            _canvas.Children.Add(sentry);
        }
    }

    private void BuildLegend()
    {
        _legend.Children.Clear();

        AddLegendRow(VehicleTwinPresentation.LockColor(_model.Locked), "Lock", VehicleTwinPresentation.LockLabel(_model.Locked));
        AddLegendRow(
            _model.SentryMode == true ? VehicleTwinPresentation.SentryRed : VehicleTwinPresentation.Neutral,
            "Sentry",
            VehicleTwinPresentation.StateLabel(_model.SentryMode, "On", "Off"));
        AddLegendRow(
            _model.IsCharging ? VehicleTwinPresentation.ChargeGreen : VehicleTwinPresentation.Neutral,
            "Charging",
            _model.IsCharging ? "Yes" : "No");
        AddLegendRow(VehicleTwinPresentation.DoorStroke(_model.FrunkOpen), "Frunk", VehicleTwinPresentation.StateLabel(_model.FrunkOpen, "Open", "Closed"));
        AddLegendRow(VehicleTwinPresentation.DoorStroke(_model.TrunkOpen), "Trunk", VehicleTwinPresentation.StateLabel(_model.TrunkOpen, "Open", "Closed"));
        AddLegendRow(
            _model.Headlights == true ? VehicleTwinPresentation.HeadlightOn : VehicleTwinPresentation.Neutral,
            "Headlights",
            VehicleTwinPresentation.StateLabel(_model.Headlights, "On", "Off"));
    }

    private void AddLegendRow(string colorHex, string label, string value)
    {
        var row = DisplayPrimitives.Row(8);
        row.Children.Add(DisplayPrimitives.Dot(Hex(colorHex), 10));

        var caption = new Caption { Value = label };
        var text = new Text { Value = value };
        row.Children.Add(caption);
        row.Children.Add(text);
        AutomationProperties.SetName(row, $"{label}: {value}");
        _legend.Children.Add(row);
    }

    private string BuildSummary()
    {
        var c = System.Globalization.CultureInfo.InvariantCulture;
        string doors = AnyDoorOpen() ? "a door open" : "all doors closed";
        string charging = _model.IsCharging ? ", charging" : string.Empty;
        return string.Create(
            c,
            $"Vehicle digital twin showing current physical state: {VehicleTwinPresentation.LockLabel(_model.Locked)}, {doors}{charging}.");
    }

    private bool AnyDoorOpen() =>
        _model.DoorDriverFront == true || _model.DoorPassengerFront == true ||
        _model.DoorDriverRear == true || _model.DoorPassengerRear == true ||
        _model.FrunkOpen == true || _model.TrunkOpen == true;

    private static Windows.UI.Color ToColor(string hex)
    {
        if (Hex(hex) is SolidColorBrush b)
        {
            return b.Color;
        }

        return Microsoft.UI.Colors.Gray;
    }
}
