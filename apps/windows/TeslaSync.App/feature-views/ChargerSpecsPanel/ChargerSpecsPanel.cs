using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargerSpecsPanel</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx. It is a presentational panel:
/// assign a <see cref="Model"/> (the web <c>specs: ChargerSpecsData | null</c> prop, plus the parent's loading
/// flag) and it renders inside a <see cref="TsGlassPanel"/> a persistent header (the purple gauge glyph + the
/// "Charger Specs Breakdown" title) above one of three web-derived branches —
/// <see cref="ChargerSpecsState.Loading"/> (skeleton chrome while the parent computes the breakdown),
/// <see cref="ChargerSpecsState.Empty"/> (the friendly "no charger specification data" surface for the web
/// <c>!hasData</c> branch), or <see cref="ChargerSpecsState.Ready"/> (the responsive four-column grid — By
/// Voltage, By Phase, By Cable, By Brand — each column either listing its rows or showing its own empty state).
/// The view never performs HTTP; all branch selection, label resolution and SI→display unit conversion happen
/// in the WinUI-free <see cref="ChargerSpecsPanelProjection"/>. The grid re-flows 1/2/4 columns across the web
/// breakpoints, every string resolves through the i18n facade, and the surface, each column and each row carry
/// a Narrator name.
/// </summary>
public sealed partial class ChargerSpecsPanel : ContentControl
{
    private const double PanelPadding = 20;        // web p-5
    private const double HeaderGap = 8;            // web gap-2
    private const double HeaderToBodyGap = 16;     // web mb-4
    private const double GridGap = 24;             // web gap-6
    private const double ColumnLabelGap = 4;       // web gap-1
    private const double ColumnInnerGap = 8;       // web mb-2 (label → rows) / space-y-2 (between rows)
    private const double HeaderIconSize = 16;      // web h-4 w-4
    private const double ColumnIconSize = 12;      // web h-3 w-3
    private const double NarrowBreakpoint = 640;   // web sm: → 2 columns
    private const double WideBreakpoint = 1024;    // web lg: → 4 columns
    private const int ColumnCount = 4;
    private const string HeaderAccentBrushKey = "TsChartPowerBrush"; // purple, web text-neon-purple

    private readonly ILocalizer _localizer;
    private readonly ChargerSpecsPanelDiagnostics _diagnostics;

    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _root = new() { Spacing = HeaderToBodyGap };
    private readonly Border _bodyHost = new();
    private readonly FontIcon _headerIcon = new() { FontSize = HeaderIconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };

    private ChargerSpecsPanelModel _model;
    private UnitPref _units;
    private ChargerSpecsState _renderedState;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, unit preference and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargerSpecsPanelModel.Pending"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargerSpecsPanel(
        ILocalizer localizer,
        ChargerSpecsPanelModel? model = null,
        UnitPref? units = null,
        ChargerSpecsPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargerSpecsPanelModel.Pending;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new ChargerSpecsPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargerSpecsPanel</c>).</summary>
    public static string Slug => ChargerSpecsPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargerSpecsPanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the rows in the new locale / precision.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
            Render();
        }
    }

    private void BuildChrome()
    {
        _headerIcon.Foreground = ChartBrushes.Resolve(HeaderAccentBrushKey);
        AutomationProperties.SetAccessibilityView(_headerIcon, AccessibilityView.Raw);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(_headerIcon);
        header.Children.Add(_title);

        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
        _panel.Content = _root;
        Content = _panel;
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // Re-flow the responsive grid when the available width crosses a breakpoint.
        if (e.PreviousSize.Width != e.NewSize.Width && UsesGrid(_renderedState))
        {
            Render();
        }
    }

    private void Render()
    {
        ChargerSpecsPanelDisplay display = ChargerSpecsPanelProjection.Project(_model, _localizer, _units);
        _renderedState = display.State;

        _headerIcon.Glyph = display.HeaderGlyph;
        _title.Value = display.Title;

        _bodyHost.Child = display.State switch
        {
            ChargerSpecsState.Loading => BuildLoading(),
            ChargerSpecsState.Ready => BuildGrid(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
    }

    // ── Ready: the responsive four-column breakdown grid ─────────────────────────────────────────────
    private Grid BuildGrid(ChargerSpecsPanelDisplay display)
    {
        Grid grid = NewColumnGrid(ColumnsForWidth(AvailableWidth()), display.Columns.Count);
        int columns = grid.ColumnDefinitions.Count;

        for (int i = 0; i < display.Columns.Count; i++)
        {
            StackPanel cell = BuildColumn(display.Columns[i]);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildColumn(ChargerSpecsColumn column)
    {
        var stack = new StackPanel { Spacing = ColumnInnerGap };

        var glyph = new FontIcon
        {
            Glyph = column.Glyph,
            FontSize = ColumnIconSize,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = column.Label,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var labelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ColumnLabelGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        labelRow.Children.Add(glyph);
        labelRow.Children.Add(label);
        stack.Children.Add(labelRow);

        if (column.HasItems)
        {
            var rows = new StackPanel { Spacing = ColumnInnerGap };
            foreach (ChargerSpecsRow row in column.Rows)
            {
                rows.Children.Add(BuildRow(row));
            }

            stack.Children.Add(rows);
        }
        else
        {
            // Web parity: an empty group shows its own EmptyState, never a blank cell.
            stack.Children.Add(new TsEmptyState
            {
                Message = column.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        AutomationProperties.SetName(stack, column.AutomationName);
        return stack;
    }

    private static Grid BuildRow(ChargerSpecsRow row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = row.Name,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var meta = new TextBlock
        {
            Text = row.Meta,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(ColumnInnerGap, 0, 0, 0),
        };

        Grid.SetColumn(name, 0);
        Grid.SetColumn(meta, 1);
        grid.Children.Add(name);
        grid.Children.Add(meta);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    // ── Empty: the web !hasData branch (inside the panel, under the header) ──────────────────────────
    private static TsEmptyState BuildEmpty(ChargerSpecsPanelDisplay display) => new()
    {
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    // ── Loading: a skeleton grid mirroring the populated layout ──────────────────────────────────────
    private Grid BuildLoading()
    {
        Grid grid = NewColumnGrid(ColumnsForWidth(AvailableWidth()), ColumnCount);
        int columns = grid.ColumnDefinitions.Count;

        for (int i = 0; i < ColumnCount; i++)
        {
            var column = new StackPanel { Spacing = ColumnInnerGap };
            column.Children.Add(new TsSkeleton { BlockWidth = 90, BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockHeight = 12 });

            Grid.SetColumn(column, i % columns);
            Grid.SetRow(column, i / columns);
            grid.Children.Add(column);
        }

        AutomationProperties.SetName(grid, _title.Value);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static Grid NewColumnGrid(int columns, int cellCount)
    {
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(cellCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    // Web grid-cols-1 sm:grid-cols-2 lg:grid-cols-4. An unmeasured panel assumes the wide desktop layout and
    // re-flows on the first SizeChanged.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => ColumnCount,
        < NarrowBreakpoint => 1,
        < WideBreakpoint => 2,
        _ => ColumnCount,
    };

    private static bool UsesGrid(ChargerSpecsState state) =>
        state is ChargerSpecsState.Ready or ChargerSpecsState.Loading;

    protected override AutomationPeer OnCreateAutomationPeer() => new ChargerSpecsPanelAutomationPeer(this);

    private sealed class ChargerSpecsPanelAutomationPeer(ChargerSpecsPanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
