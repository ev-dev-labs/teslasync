using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.UptimeHeatmapSurface;

/// <summary>
/// The native WinUI 3 <c>UptimeHeatmap</c> shared surface — a parity port of
/// <c>web/src/components/status/UptimeHeatmap.tsx</c>. It renders a rolling N-day status grid inside a
/// <see cref="TsGlassPanel"/> (the native counterpart of the web <c>GlassPanel</c>): one tinted square per day,
/// oldest first, each carrying a date + status (+ optional summary) tooltip and an accessible name; a heading; and
/// a rolling uptime caption coloured by the web's <c>&gt;= 99</c> / <c>&gt;= 95</c> / else tiers (healthy + maintenance
/// days count as up). The view never performs HTTP: it is prop-driven exactly like the web component, whose parent
/// (a System / Status page) owns any fetching, so there is no loading / error / stale / offline chrome — only the
/// "populated" branch (the squares + caption) and the "empty" branch (no days), both of which always render. The
/// empty branch shows a friendly <see cref="TsEmptyState"/> rather than the web's blank squares row (per the P2
/// "never a blank box" rule). All derivation — the heading, the uptime caption + threshold colour, the per-day tint
/// and labels, and the accessible names — happens in the WinUI-free <see cref="UptimeHeatmapProjection"/>; the squares
/// flow into a <see cref="VariableSizedWrapGrid"/> (the codebase's wrapping idiom). The threshold caption colour and
/// the per-day tint are rendered via <see cref="DisplayPrimitives.HexBrush"/>: the status palette is a semantic data
/// attribute shared with the web (like a chart series colour), not an ad-hoc theme colour; ambient theming still
/// flows through the token brushes.
/// </summary>
public sealed partial class UptimeHeatmap : ContentControl
{
    private const double SquareSize = 12;       // web h-3 w-3 (0.75rem ≈ 12 px)
    private const double SquareCell = 16;        // square + web gap-1 (0.25rem ≈ 4 px)
    private const double SquareRadius = 2;       // web rounded-sm

    private readonly ILocalizer _localizer;
    private readonly UptimeHeatmapDiagnostics _diagnostics;

    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly PanelTitle _heading = new();
    private readonly TextBlock _uptime = new()
    {
        FontSize = 12,
        FontWeight = FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Bottom,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly VariableSizedWrapGrid _squares = new()
    {
        Orientation = Orientation.Horizontal,
        ItemWidth = SquareCell,
        ItemHeight = SquareCell,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TsEmptyState _empty = new() { Visibility = Visibility.Collapsed };
    private readonly Caption _footnote = new() { Visibility = Visibility.Collapsed };

    private UptimeHeatmapModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="UptimeHeatmapModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public UptimeHeatmap(
        ILocalizer localizer,
        UptimeHeatmapModel? model = null,
        UptimeHeatmapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? UptimeHeatmapModel.Empty;
        _diagnostics = diagnostics ?? new UptimeHeatmapDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _heading.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(_heading, 0);
        Grid.SetColumn(_uptime, 1);
        headerRow.Children.Add(_heading);
        headerRow.Children.Add(_uptime);

        _root.Children.Add(headerRow);
        _root.Children.Add(_squares);
        _root.Children.Add(_empty);
        _root.Children.Add(_footnote);

        _panel.Content = _root;
        Content = _panel;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>UptimeHeatmap</c>).</summary>
    public static string Slug => UptimeHeatmapRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public UptimeHeatmapModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
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

    private void Render()
    {
        UptimeHeatmapDisplay display = UptimeHeatmapProjection.Project(_model, _localizer);

        _heading.Value = display.Heading;

        _uptime.Text = display.UptimeText;
        _uptime.Foreground = DisplayPrimitives.HexBrush(display.UptimeColorHex);
        _uptime.Visibility = display.HasUptime ? Visibility.Visible : Visibility.Collapsed;

        _squares.Children.Clear();
        foreach (UptimeDayCell cell in display.Cells)
        {
            var square = new Rectangle
            {
                Width = SquareSize,
                Height = SquareSize,
                RadiusX = SquareRadius,
                RadiusY = SquareRadius,
                Fill = DisplayPrimitives.HexBrush(cell.AccentHex),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
            };

            ToolTipService.SetToolTip(square, cell.TooltipText);
            AutomationProperties.SetName(square, cell.AccessibleLabel);
            _squares.Children.Add(square);
        }

        _squares.Visibility = display.HasDays ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_squares, display.ListLabel);

        _empty.Message = display.EmptyText;
        _empty.Visibility = display.HasDays ? Visibility.Collapsed : Visibility.Visible;

        _footnote.Value = display.Footnote ?? string.Empty;
        _footnote.Visibility = display.HasFootnote ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, display.AutomationName);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new FrameworkElementAutomationPeer(this);
}
