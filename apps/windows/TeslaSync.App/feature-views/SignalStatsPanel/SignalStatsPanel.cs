using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SignalStatsPanel</c> feature surface — a parity port of
/// web/src/features/telemetry/components/SignalStatsPanel.tsx. It is the presentational per-signal
/// min / max / avg / count summary: assign a <see cref="Model"/> and it renders the web composition inside a
/// <see cref="TsGlassPanel"/> (the native <c>GlassPanel</c>) wrapped in a <see cref="TsFadeIn"/> (the web
/// <c>FadeIn</c>) — a header with the section title and, when any row carries no data, a
/// "Hide empty ({{count}})" <see cref="TsToggle"/> (the web <c>Toggle</c>), over a five-column table (Signal /
/// Min / Max / Avg / Count) whose signal names are tinted from the categorical chart palette and whose empty
/// signals surface an em-dash plus a "No data in range" caption. Every state from the web source renders —
/// the <c>loading</c> skeleton grid, the populated table and the friendly "No stats available"
/// <see cref="TsEmptyState"/> — never a blank box. The SI-free numeric formatting + projection happen in the
/// WinUI-free <see cref="SignalStatsProjection"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade, the em-dash cells carry a "No data" Narrator label, every row carries a composed Narrator
/// name and the entrance motion is the system-honoured <see cref="TsFadeIn"/>, so reduced-motion is respected
/// by construction.
/// </summary>
public sealed partial class SignalStatsPanel : ContentControl
{
    private const double PanelPadding = 18;        // web `p-4 sm:p-5`
    private const double HeaderSpacing = 12;        // web `mb-3`
    private const double RowSpacing = 0;            // table rows are separated by hairline borders
    private const double TableMaxHeight = 460;      // scroll instead of the web 50-row pager
    private const double SkeletonHeight = 80;       // web `h-20`
    private const int SkeletonTiles = 4;            // web `[1,2,3,4].map(...)`
    private const double HeaderFontSize = 11;
    private const double ValueFontSize = 13;
    private const double SignalFontSize = 13;
    private const int HeaderCharacterSpacing = 40;
    private const double RowMinHeight = 40;

    private static readonly GridLength[] ColumnWidths =
    [
        new GridLength(1.6, GridUnitType.Star),  // Signal
        new GridLength(1, GridUnitType.Star),    // Min
        new GridLength(1, GridUnitType.Star),    // Max
        new GridLength(1, GridUnitType.Star),    // Avg
        new GridLength(0.8, GridUnitType.Star),  // Count
    ];

    private readonly ILocalizer _localizer;
    private readonly SignalStatsPanelDiagnostics _diagnostics;

    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsToggle _hideEmptyToggle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private SignalStatsModel _model;
    private int _precision;
    private bool _hideEmpty;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, the decimal precision and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SignalStatsModel.Pending"/>.</param>
    /// <param name="precision">The decimal precision for min / max / avg (web <c>fmtNumber</c> precision).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalStatsPanel(
        ILocalizer localizer,
        SignalStatsModel? model = null,
        int precision = SignalStatsProjection.DefaultPrecision,
        SignalStatsPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SignalStatsModel.Pending;
        _precision = precision;
        _diagnostics = diagnostics ?? new SignalStatsPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _hideEmptyToggle.Toggled += OnHideEmptyToggled;

        var root = new StackPanel { Spacing = HeaderSpacing };
        root.Children.Add(BuildHeader());
        root.Children.Add(_bodyHost);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = root,
        };

        Content = new TsFadeIn { Content = panel };
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SignalStatsPanel</c>).</summary>
    public static string Slug => SignalStatsPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the panel.</summary>
    public SignalStatsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The decimal precision for the min / max / avg cells (web <c>fmtNumber</c> precision).</summary>
    public int Precision
    {
        get => _precision;
        set
        {
            _precision = value;
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

    private void OnHideEmptyToggled(object? sender, EventArgs e)
    {
        if (_hideEmpty == _hideEmptyToggle.IsOn)
        {
            return;
        }

        _hideEmpty = _hideEmptyToggle.IsOn;
        Render();
    }

    // ── Persistent header (built once so the toggle keeps its focus across re-render) ──────────────────────
    private Grid BuildHeader()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_hideEmptyToggle, 1);
        header.Children.Add(_title);
        header.Children.Add(_hideEmptyToggle);
        return header;
    }

    private void Render()
    {
        var display = SignalStatsProjection.Project(_model, _hideEmpty, _precision, _localizer);

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.RegionLabel);

        _hideEmptyToggle.Visibility = display.ShowHideEmptyToggle ? Visibility.Visible : Visibility.Collapsed;
        _hideEmptyToggle.Header = display.HideEmptyLabel;
        AutomationProperties.SetName(_hideEmptyToggle, display.HideEmptyLabel);

        _bodyHost.Child = display.State switch
        {
            SignalStatsState.Loading => BuildLoading(display.LoadingLabel),
            SignalStatsState.Empty => BuildEmpty(display.EmptyMessage),
            _ => BuildTable(display),
        };
    }

    // ── Loading (parent's live-signal query still resolving) ───────────────────────────────────────────────
    private static Grid BuildLoading(string announce)
    {
        var grid = new Grid { ColumnSpacing = HeaderSpacing, RowSpacing = HeaderSpacing };
        for (int c = 0; c < SkeletonTiles; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < SkeletonTiles; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = SkeletonHeight, ReduceMotion = MotionPreference.ReduceMotion };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        AutomationProperties.SetName(grid, announce);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    // ── Empty ("No stats available") ───────────────────────────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(string message) => new()
    {
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Ready (the per-signal stat table) ──────────────────────────────────────────────────────────────────
    private static StackPanel BuildTable(SignalStatsDisplay display)
    {
        var headers = new[]
        {
            display.SignalHeader,
            display.MinHeader,
            display.MaxHeader,
            display.AvgHeader,
            display.CountHeader,
        };

        var table = new StackPanel { Spacing = RowSpacing };
        table.Children.Add(BuildHeaderRow(headers));

        var body = new StackPanel { Spacing = RowSpacing };
        foreach (var row in display.Rows)
        {
            body.Children.Add(BuildRow(row, display.NoDataLabel));
        }

        table.Children.Add(new ScrollViewer
        {
            Content = body,
            MaxHeight = TableMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        });
        return table;
    }

    private static Border BuildHeaderRow(string[] headers)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 4, 8, 6);
        for (int i = 0; i < headers.Length; i++)
        {
            var cell = new TextBlock
            {
                Text = headers[i],
                FontSize = HeaderFontSize,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextMuted,
                CharacterSpacing = HeaderCharacterSpacing,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = i == 0 ? HorizontalAlignment.Left : HorizontalAlignment.Right,
            };
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
    }

    private static Border BuildRow(SignalStatRow row, string noDataLabel)
    {
        var grid = NewColumnGrid();
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = RowMinHeight;

        var signal = BuildSignalCell(row);
        var min = BuildNumericCell(row.Min, DisplayTokens.TextSecondary, noDataLabel);
        var max = BuildNumericCell(row.Max, DisplayTokens.TextSecondary, noDataLabel);
        var avg = BuildNumericCell(row.Avg, DisplayTokens.TextPrimary, noDataLabel);
        var count = new TextBlock
        {
            Text = row.CountText,
            FontFamily = MonoFont,
            FontSize = ValueFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var cells = new UIElement[] { signal, min, max, avg, count };
        for (int i = 0; i < cells.Length; i++)
        {
            Grid.SetColumn((FrameworkElement)cells[i], i);
            grid.Children.Add(cells[i]);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static StackPanel BuildSignalCell(SignalStatRow row)
    {
        var stack = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(new TextBlock
        {
            Text = row.Signal,
            FontFamily = MonoFont,
            FontSize = SignalFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.Brush(row.ColorKey),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (!string.IsNullOrEmpty(row.NoDataSubtitle))
        {
            stack.Children.Add(new Caption { Value = row.NoDataSubtitle });
        }

        return stack;
    }

    private static TextBlock BuildNumericCell(SignalStatCell cell, Brush finiteBrush, string noDataLabel)
    {
        var block = new TextBlock
        {
            Text = cell.Text,
            FontFamily = MonoFont,
            FontSize = ValueFontSize,
            Foreground = cell.IsNoData ? DisplayTokens.TextMuted : finiteBrush,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web: the em-dash carries aria-label="No data" so a no-data cell is announced, not read as a glyph.
        if (cell.IsNoData)
        {
            AutomationProperties.SetName(block, noDataLabel);
        }

        return block;
    }

    private static Grid NewColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = HeaderSpacing };
        foreach (var width in ColumnWidths)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        }

        return grid;
    }

    private static FontFamily MonoFont => TypographyTokens.Mono ?? new FontFamily("Consolas");

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SignalStatsPanelAutomationPeer(this);

    private sealed class SignalStatsPanelAutomationPeer(SignalStatsPanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SignalStatsPanel)Owner)._localizer.GetString(
                    SignalStatsPanelRegistration.RegionLabelKey, SignalStatsPanelRegistration.RegionLabelFallback)
                : name;
        }
    }
}
