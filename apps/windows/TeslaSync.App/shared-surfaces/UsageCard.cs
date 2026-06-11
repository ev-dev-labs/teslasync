using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Feedback;

namespace TeslaSync.App.SharedSurfaces.UsageCardSurface;

/// <summary>
/// The native WinUI 3 <c>UsageCard</c> shared surface — a parity port of
/// web/src/components/data-display/UsageCard.tsx, the shared "spend / volume" card primitive that both the
/// Tesla Fleet API usage card and the AI provider audit-log usage card compose. It reproduces every region of
/// the web card, top to bottom: an optional budget progress bar (a "spent of total" headline with an optional
/// right caption, the clamped fill bar and an optional under-bar caption), a responsive band grid (1 / 3
/// columns) of at-a-glance label + value + sub tiles, a responsive detail grid (2 / 4 columns) of muted
/// label-over-value cells, a responsive top-list grid (1 / 2 columns) of titled breakdown blocks, an optional
/// callout banner and a footer of navigation links — or, when no region is present, a friendly empty state
/// instead of a blank box. Each region carries the web's three-way intent (normal / warn / danger) on its
/// accent colour, ring tint and value text.
/// <para>
/// The card is purely presentational: the page computes the values and supplies the visual slots, exactly like
/// the web component, so it has no fetch lifecycle (no loading / error / stale / offline chrome — the web source
/// has none, mirroring the other presentational shared surfaces such as <c>KpiOverviewCard</c> and <c>Delta</c>
/// empty branches). All presentational state flows through the shared <see cref="UsageCardViewModel"/> and its
/// <see cref="IUsageCardSource"/> P1/S8 seam; the view never performs HTTP and never recomputes — it renders the
/// <see cref="UsageCardDisplay"/> projection. The web component is anonymous (zero <c>t()</c> calls — every
/// visible string arrives already-localized through the props), so the surface resolves no i18n keys of its own.
/// The card carries no animation (so the reduced-motion contract is satisfied by construction), its text uses
/// the design tokens (so system font scaling and the high-contrast dictionary keep working), the budget bar is
/// exposed to assistive tech as a read-only progress bar reporting the unclamped percentage (the web
/// <c>role="progressbar"</c> + <c>aria-valuenow</c>), every band / cell / row / link announces its
/// label-and-value pair, and the surface emits the <c>view.opened</c> diagnostic exactly once when it is shown.
/// </para>
/// </summary>
public sealed partial class UsageCard : ContentControl, IDisposable
{
    private const double SectionSpacing = 16;       // web space-y-4
    private const double BudgetSpacing = 8;          // web space-y-2
    private const double BandColumnSpacing = 12;     // web gap-3
    private const double BandPadding = 12;           // web p-3
    private const double DetailColumnSpacing = 16;   // web gap-x-4
    private const double DetailRowSpacing = 4;       // web gap-y-1
    private const double TopListColumnSpacing = 12;  // web gap-3
    private const double TopListPadding = 12;        // web p-3
    private const double FooterSpacing = 8;          // web gap-2
    private const double LabelRowSpacing = 6;        // web gap-1.5
    private const double IconSize = 14;              // web h-3.5 w-3.5
    private const double FooterMinHeight = 36;       // web min-h-[36px]
    private const double MdBreakpoint = 768;         // Tailwind md

    private const int BandNarrowColumns = 1;
    private const int BandWideColumns = 3;
    private const int DetailNarrowColumns = 2;
    private const int DetailWideColumns = 4;
    private const int TopListNarrowColumns = 1;
    private const int TopListWideColumns = 2;

    private const byte IntentFillAlpha = 0x1A;       // web bg-*-500/10
    private const byte IntentRingAlpha = 0x4D;       // web ring-*-500/30
    private const byte PrimaryChipFillAlpha = 0x26;  // web bg-cyan-500/15
    private const byte PrimaryChipRingAlpha = 0x4D;  // web ring-cyan-400/30

    private const string ExternalLinkGlyph = "\uE8A7";   // OpenInNewWindow (web ExternalLink)
    private const string AccentColorKey = "TsColorAccentColor";
    private const string ValueSeparator = ": ";

    private readonly IUsageCardSource _source;
    private readonly UsageCardViewModel _viewModel;
    private readonly UsageCardSource? _mutableSource;
    private readonly UsageCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over a fresh in-memory source (the common host path).</summary>
    public UsageCard()
        : this(new UsageCardSource(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over an explicit input seam and an optional PII-safe diagnostics collector.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public UsageCard(IUsageCardSource source, UsageCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);

        _source = source;
        _viewModel = new UsageCardViewModel(source);
        _mutableSource = source as UsageCardSource;
        _diagnostics = diagnostics ?? new UsageCardDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when a footer link is invoked; the host navigates to <see cref="UsageCardFooterLink.Route"/>.</summary>
    public event EventHandler<UsageCardFooterLink>? FooterLinkInvoked;

    /// <summary>The diagnostics slug this surface registers under (<c>UsageCard</c>).</summary>
    public static string Slug => UsageCardRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public UsageCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// The whole presentational input. Getting reads the bound seam; setting pushes a fresh input onto the
    /// in-memory <see cref="UsageCardSource"/> (a no-op when the surface was constructed over a custom seam),
    /// the analogue of a parent re-rendering the web card with new props.
    /// </summary>
    public UsageCardInput Input
    {
        get => _source.Input;
        set => _mutableSource?.SetInput(value);
    }

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new UsageCardAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(UsageCardViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;

        // A source change can be raised from a background settings/state callback; render on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        UsageCardDisplay display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AccessibleName);
        if (display.ShowEmptyState)
        {
            Content = BuildEmpty(display);
        }
        else
        {
            Content = BuildContent(display);
        }
    }

    private static TsEmptyState BuildEmpty(UsageCardDisplay display) =>
        new() { Message = display.EmptyMessage };

    private StackPanel BuildContent(UsageCardDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        if (display.Budget is { } budget)
        {
            column.Children.Add(BuildBudget(budget));
        }

        if (display.ShowBands)
        {
            column.Children.Add(BuildReflowGrid(
                BuildItems(display.Bands, BuildBand), BandNarrowColumns, BandWideColumns, BandColumnSpacing, BandColumnSpacing));
        }

        if (display.ShowDetails)
        {
            column.Children.Add(BuildReflowGrid(
                BuildItems(display.Details, BuildDetailCell), DetailNarrowColumns, DetailWideColumns, DetailColumnSpacing, DetailRowSpacing));
        }

        if (display.ShowTopLists)
        {
            column.Children.Add(BuildReflowGrid(
                BuildItems(display.TopLists, BuildTopList), TopListNarrowColumns, TopListWideColumns, TopListColumnSpacing, TopListColumnSpacing));
        }

        if (display.Banner is { } banner)
        {
            column.Children.Add(BuildBanner(banner));
        }

        if (display.ShowFooter)
        {
            column.Children.Add(BuildFooter(display.Footer));
        }

        return column;
    }

    // ── Budget bar (web BudgetSection L220-L262) ─────────────────────────────────────────────────────────

    private static StackPanel BuildBudget(UsageCardBudgetView budget)
    {
        var header = TwoColumnGrid();
        var headline = new TextBlock
        {
            Text = budget.Headline,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        Grid.SetColumn(headline, 0);
        header.Children.Add(headline);

        if (budget.ShowRightLabel)
        {
            var rightLabel = new TextBlock
            {
                Text = budget.RightLabel,
                FontSize = 12,
                FontWeight = budget.RightLabelIsDanger ? FontWeights.SemiBold : FontWeights.Normal,
                Foreground = budget.RightLabelIsDanger ? DisplayTokens.Brush("TsColorDangerBrush") : DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            Grid.SetColumn(rightLabel, 1);
            header.Children.Add(rightLabel);
        }

        AutomationProperties.SetAccessibilityView(header, AccessibilityView.Raw);

        var metric = new TsMetricBar
        {
            Value = budget.BarValue,
            Max = UsageCardRegistration.BudgetBarMax,
            AccentBrushKey = budget.AccentBrushKey,
        };
        AutomationProperties.SetAccessibilityView(metric, AccessibilityView.Raw);

        // The bar is exposed to assistive tech as a read-only progress bar reporting the unclamped percentage,
        // the native analogue of the web role="progressbar" + aria-valuenow / aria-label (web L244-L251).
        var bar = new UsageBudgetBar
        {
            Content = metric,
            AnnouncedValue = budget.AnnouncedPercent,
            RangeMaximum = Math.Max(UsageCardRegistration.BudgetBarMax, budget.AnnouncedPercent),
        };
        AutomationProperties.SetName(bar, budget.AccessibleName);

        var column = new StackPanel { Spacing = BudgetSpacing };
        column.Children.Add(header);
        column.Children.Add(bar);

        if (budget.ShowCaption)
        {
            var caption = new Caption { Value = budget.Caption };
            AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
            column.Children.Add(caption);
        }

        return column;
    }

    // ── Band grid (web BandsSection L264-L286) ───────────────────────────────────────────────────────────

    private static Border BuildBand(UsageCardBand band)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(LabelRow(band.IconGlyph, band.Label));
        column.Children.Add(new TextBlock
        {
            Text = band.Value,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });

        if (!string.IsNullOrEmpty(band.Sub))
        {
            column.Children.Add(new TextBlock
            {
                Text = band.Sub,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var border = new Border
        {
            Child = column,
            Padding = new Thickness(BandPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = IntentFill(band.Intent),
            BorderBrush = IntentRing(band.Intent),
            BorderThickness = new Thickness(band.Intent == UsageCardIntent.Normal ? 0 : 1),
        };
        AutomationProperties.SetName(border, LabelValueName(band.Label, band.Value, band.Sub));
        return border;
    }

    // ── Detail grid (web DetailsSection L288-L302) ───────────────────────────────────────────────────────

    private static StackPanel BuildDetailCell(UsageCardDetail detail)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new TextBlock
        {
            Text = detail.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        column.Children.Add(new TextBlock
        {
            Text = detail.Value,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(UsageCardPalette.ValueBrushKey(detail.Intent)),
        });
        AutomationProperties.SetName(column, LabelValueName(detail.Label, detail.Value, sub: null));
        return column;
    }

    // ── Top-list grid (web TopListsSection L304-L329) ────────────────────────────────────────────────────

    private static Border BuildTopList(UsageCardTopList topList)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(LabelRow(topList.IconGlyph, topList.Title));

        var list = new StackPanel { Spacing = 4 };
        foreach (UsageCardTopListItem item in topList.Items)
        {
            list.Children.Add(BuildTopListItem(item));
        }

        column.Children.Add(list);

        var border = new Border
        {
            Child = column,
            Padding = new Thickness(TopListPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
        };
        AutomationProperties.SetName(border, topList.Title);
        return border;
    }

    private static Grid BuildTopListItem(UsageCardTopListItem item)
    {
        var row = TwoColumnGrid();
        row.ColumnSpacing = BandColumnSpacing;

        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = 12,
            FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new TextBlock
        {
            Text = item.Value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        row.Children.Add(label);
        row.Children.Add(value);
        AutomationProperties.SetName(row, LabelValueName(item.Label, item.Value, sub: null));
        return row;
    }

    // ── Banner (web BannerSection L331-L347) ─────────────────────────────────────────────────────────────

    private static TsInlineCallout BuildBanner(UsageCardBanner banner) => new()
    {
        Variant = ToCalloutVariant(banner.Intent),
        Title = banner.Title,
        Message = banner.Description,
    };

    // ── Footer (web FooterSection L349-L379) ─────────────────────────────────────────────────────────────

    private Border BuildFooter(IReadOnlyList<UsageCardFooterLink> links)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = FooterSpacing,
        };

        foreach (UsageCardFooterLink link in links)
        {
            row.Children.Add(BuildFooterLink(link));
        }

        return new Border
        {
            Child = row,
            Padding = new Thickness(0, BudgetSpacing, 0, 0),
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = DisplayTokens.Border,
        };
    }

    private HyperlinkButton BuildFooterLink(UsageCardFooterLink link)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(new TextBlock
        {
            Text = link.Label,
            FontSize = 12,
            FontWeight = link.Primary ? FontWeights.SemiBold : FontWeights.Normal,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var glyph = new FontIcon { Glyph = ExternalLinkGlyph, FontSize = IconSize };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        content.Children.Add(glyph);

        var button = new HyperlinkButton
        {
            Content = content,
            Tag = link,
            MinHeight = FooterMinHeight,
            Padding = new Thickness(12, 6, 12, 6),
        };

        if (link.Primary)
        {
            button.Background = Tint(AccentColorKey, PrimaryChipFillAlpha);
            button.BorderBrush = Tint(AccentColorKey, PrimaryChipRingAlpha);
            button.BorderThickness = new Thickness(1);
            button.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        }

        AutomationProperties.SetName(button, link.Label);
        button.Click += OnFooterLinkClick;
        return button;
    }

    private void OnFooterLinkClick(object sender, RoutedEventArgs e)
    {
        if (sender is HyperlinkButton { Tag: UsageCardFooterLink link })
        {
            FooterLinkInvoked?.Invoke(this, link);
        }
    }

    // ── Shared builders + intent → token mapping ─────────────────────────────────────────────────────────

    private static StackPanel LabelRow(string? iconGlyph, string label)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (!string.IsNullOrEmpty(iconGlyph))
        {
            var icon = new FontIcon
            {
                Glyph = iconGlyph,
                FontSize = IconSize,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
        }

        row.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 12,
            CharacterSpacing = 60,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return row;
    }

    private static Grid TwoColumnGrid()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        return grid;
    }

    private static List<FrameworkElement> BuildItems<T>(IReadOnlyList<T> items, Func<T, FrameworkElement> build)
    {
        var result = new List<FrameworkElement>(items.Count);
        foreach (T item in items)
        {
            result.Add(build(item));
        }

        return result;
    }

    private static Grid BuildReflowGrid(
        List<FrameworkElement> items, int narrowColumns, int wideColumns, double columnSpacing, double rowSpacing)
    {
        var grid = new Grid
        {
            ColumnSpacing = columnSpacing,
            RowSpacing = rowSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        foreach (FrameworkElement item in items)
        {
            item.HorizontalAlignment = HorizontalAlignment.Stretch;
            grid.Children.Add(item);
        }

        void Layout() => LayoutReflow(grid, items.Count, narrowColumns, wideColumns);
        grid.SizeChanged += (_, _) => Layout();
        Layout();
        return grid;
    }

    private static void LayoutReflow(Grid grid, int count, int narrowColumns, int wideColumns)
    {
        if (count == 0)
        {
            grid.ColumnDefinitions.Clear();
            grid.RowDefinitions.Clear();
            return;
        }

        int columns = grid.ActualWidth >= MdBreakpoint ? wideColumns : narrowColumns;
        columns = Math.Clamp(columns, 1, count);
        int rows = (count + columns - 1) / columns;

        if (grid.ColumnDefinitions.Count != columns || grid.RowDefinitions.Count != rows)
        {
            grid.ColumnDefinitions.Clear();
            for (int c = 0; c < columns; c++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            grid.RowDefinitions.Clear();
            for (int r = 0; r < rows; r++)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }
        }

        for (int i = 0; i < count; i++)
        {
            var child = (FrameworkElement)grid.Children[i];
            Grid.SetColumn(child, i % columns);
            Grid.SetRow(child, i / columns);
        }
    }

    private static string LabelValueName(string label, string value, string? sub)
    {
        string name = string.IsNullOrEmpty(value) ? label : label + ValueSeparator + value;
        return string.IsNullOrEmpty(sub) ? name : name + ValueSeparator + sub;
    }

    private static CalloutVariant ToCalloutVariant(UsageCardIntent intent) => intent switch
    {
        UsageCardIntent.Warn => CalloutVariant.Warning,
        UsageCardIntent.Danger => CalloutVariant.Danger,
        _ => CalloutVariant.Info,
    };

    // web band normal = bg-white/[0.03]; warn = bg-amber-500/10; danger = bg-red-500/10.
    private static Brush IntentFill(UsageCardIntent intent)
    {
        string? colorKey = UsageCardPalette.BandTintColorKey(intent);
        return colorKey is null ? DisplayTokens.Brush("TsColorSurfaceGlassBrush") : Tint(colorKey, IntentFillAlpha);
    }

    // web band normal = no ring; warn = ring-amber-500/30; danger = ring-red-500/30.
    private static SolidColorBrush IntentRing(UsageCardIntent intent)
    {
        string? colorKey = UsageCardPalette.BandTintColorKey(intent);
        return colorKey is null ? new SolidColorBrush(Microsoft.UI.Colors.Transparent) : Tint(colorKey, IntentRingAlpha);
    }

    private static SolidColorBrush Tint(string colorKey, byte alpha)
    {
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue(colorKey, out object? value) &&
            value is Windows.UI.Color color)
        {
            return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, color.R, color.G, color.B));
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    /// <summary>
    /// Read-only progress-bar host for the budget bar — the native analogue of the web
    /// <c>role="progressbar"</c> with <c>aria-valuenow</c> / <c>aria-valuemin</c> / <c>aria-valuemax</c>. It
    /// hosts the <see cref="TsMetricBar"/> visual and exposes the unclamped announced percentage to assistive
    /// tech so over-budget overflow is reported accurately, exactly like the web.
    /// </summary>
    private sealed partial class UsageBudgetBar : ContentControl
    {
        public UsageBudgetBar()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
        }

        public double AnnouncedValue { get; set; }

        public double RangeMaximum { get; set; } = UsageCardRegistration.BudgetBarMax;

        protected override AutomationPeer OnCreateAutomationPeer() => new BudgetBarPeer(this);

        private sealed class BudgetBarPeer(UsageBudgetBar owner) : FrameworkElementAutomationPeer(owner), IRangeValueProvider
        {
            public bool IsReadOnly => true;

            public double LargeChange => 0;

            public double SmallChange => 0;

            public double Maximum => ((UsageBudgetBar)Owner).RangeMaximum;

            public double Minimum => 0;

            public double Value => ((UsageBudgetBar)Owner).AnnouncedValue;

            public void SetValue(double value) =>
                throw new InvalidOperationException("The UsageCard budget bar is read-only.");

            protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.ProgressBar;

            protected override object? GetPatternCore(PatternInterface patternInterface) =>
                patternInterface == PatternInterface.RangeValue ? this : base.GetPatternCore(patternInterface);
        }
    }

    private sealed class UsageCardAutomationPeer(UsageCard owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((UsageCard)Owner).ViewModel.Display.AccessibleName : name;
        }
    }
}
