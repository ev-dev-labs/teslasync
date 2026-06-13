using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.SharedSurfaces.RecentActivityFeedSurface;

/// <summary>
/// The native WinUI 3 <c>RecentActivityFeed</c> shared surface — a parity port of
/// web/src/components/data-display/RecentActivityFeed.tsx, the reusable chronological feed of per-user audit-log
/// entries. It reproduces the web component's composition exactly: when there are no rows it renders the empty
/// notice (the web <c>EmptyState</c> — a History glyph plus the <c>activity.myActivity.empty</c> message, or the
/// caller's override); otherwise it renders the web <c>Timeline</c> — a stacked set of rows, each a muted
/// per-action icon (web <c>getActivityVisual(action).icon</c> with the feed's <c>color: undefined</c> muting), a
/// title (a click-through link when the entity has a route — web <c>entityHref</c> — otherwise plain text), an
/// optional <c>entity · id — detail</c> subtitle, and a relative timestamp, joined by a connector rail. A host
/// that is still resolving its first page can flag <see cref="RecentActivityFeedInput.IsLoading"/> to show a
/// skeleton instead of a premature empty notice.
/// <para>
/// Like the peer presentational shared surfaces (<c>Accordion</c> / <c>UsageCard</c> / <c>InlineCallout</c>), the
/// feed is purely presentational and prop-driven: the host computes the rows and supplies them, exactly like the
/// web component, so the view performs no HTTP and owns no fetch lifecycle — the host owns error / disabled /
/// unauthorized chrome around it (web <c>MyActivityPage</c>). All presentational state flows through the shared
/// <see cref="RecentActivityFeedViewModel"/> and its <see cref="IRecentActivityFeedSource"/> P1/S8 seam; the view
/// renders the <see cref="RecentActivityFeedDisplay"/> projection and never recomputes. Every label resolves
/// through the P1/S10 i18n facade with the web key names; the feed carries no entrance animation (so the
/// reduced-motion contract holds by construction, and the only pulsing element — the loading skeleton — honours
/// <see cref="MotionPreference.ReduceMotion"/>); its text uses the design tokens (so system font scaling and the
/// high-contrast dictionary keep working); each row link announces its action label, the decorative glyphs are
/// hidden from Narrator, and the surface emits the <c>view.opened</c> diagnostic exactly once when it is shown.
/// </para>
/// </summary>
public sealed partial class RecentActivityFeed : ContentControl, IDisposable
{
    private const double RowSpacing = 16;           // web space-y-4
    private const double MarkerSize = 22;           // web h-[22px] w-[22px]
    private const double MarkerBorder = 1.5;        // web border-2
    private const double MarkerGap = 12;            // web gap-3
    private const double IconSize = 14;             // web h-3.5 w-3.5
    private const double ConnectorWidth = 1;        // web w-px
    private const double ConnectorMinHeight = 22;   // bridges the inter-row gap
    private const double SubtitleSpacing = 2;       // web mt-0.5
    private const double TitleFontSize = 14;        // web text-sm
    private const double CaptionFontSize = 12;      // web text-xs
    private const double TimeLeftGap = 8;           // web gap-2 between title and time

    private const int SkeletonRowCount = 4;
    private const double SkeletonTitleWidth = 168;
    private const double SkeletonSubtitleWidth = 104;
    private const double SkeletonTitleHeight = 13;
    private const double SkeletonSubtitleHeight = 11;

    private readonly IRecentActivityFeedSource _source;
    private readonly RecentActivityFeedViewModel _viewModel;
    private readonly RecentActivityFeedSource? _mutableSource;
    private readonly RecentActivityFeedDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over a fresh in-memory source and the shell localizer (the common host path).</summary>
    public RecentActivityFeed()
        : this(new RecentActivityFeedSource(), ShellLocalizer.Instance, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over an explicit input seam, i18n facade and optional PII-safe diagnostics.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10); never null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters (P1/S11).</param>
    public RecentActivityFeed(
        IRecentActivityFeedSource source,
        ILocalizer localizer,
        RecentActivityFeedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _viewModel = new RecentActivityFeedViewModel(source, localizer);
        _mutableSource = source as RecentActivityFeedSource;
        _diagnostics = diagnostics ?? new RecentActivityFeedDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when a row title link is invoked; the host navigates to the entity route (web <c>entityHref</c>).</summary>
    public event EventHandler<string>? EntryInvoked;

    /// <summary>The diagnostics slug this surface registers under (<c>RecentActivityFeed</c>).</summary>
    public static string Slug => RecentActivityFeedRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RecentActivityFeedViewModel ViewModel => _viewModel;

    /// <summary>
    /// The whole presentational input. Getting reads the bound seam; setting pushes a fresh input onto the
    /// in-memory <see cref="RecentActivityFeedSource"/> (a no-op when the surface was constructed over a custom
    /// seam) — the analogue of a parent re-rendering the web feed with new props.
    /// </summary>
    public RecentActivityFeedInput Input
    {
        get => _source.Input;
        set => _mutableSource?.SetInput(value);
    }

    /// <summary>Convenience: get / set just the rows on the in-memory seam (web <c>entries</c> prop).</summary>
    public IReadOnlyList<RecentActivityEntry>? Entries
    {
        get => _source.Input.Entries;
        set => _mutableSource?.SetEntries(value);
    }

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors sibling surfaces).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RecentActivityFeedAutomationPeer(this);

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

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(RecentActivityFeedViewModel.Display))
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

        // A source change can be raised from a background host callback; render on the UI thread.
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
        RecentActivityFeedDisplay display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AccessibleName);
        Content = display.Phase switch
        {
            RecentActivityFeedPhase.Loading => BuildLoading(),
            RecentActivityFeedPhase.Empty => BuildEmpty(display),
            _ => BuildTimeline(display),
        };
    }

    // web: <EmptyState icon={history} message={emptyMessage} />
    private static TsEmptyState BuildEmpty(RecentActivityFeedDisplay display) =>
        new() { IconGlyph = display.EmptyGlyph, Message = display.EmptyMessage };

    // web: <Timeline items={items} /> — the populated success branch.
    private StackPanel BuildTimeline(RecentActivityFeedDisplay display)
    {
        var column = new StackPanel { Spacing = RowSpacing };
        IReadOnlyList<RecentActivityRow> rows = display.Rows;
        for (int i = 0; i < rows.Count; i++)
        {
            column.Children.Add(BuildRow(rows[i], showConnector: i < rows.Count - 1));
        }

        return column;
    }

    // One web TimelineItem: [marker rail] [title + time / subtitle].
    private Grid BuildRow(RecentActivityRow row, bool showConnector)
    {
        var grid = new Grid { ColumnSpacing = MarkerGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        StackPanel marker = BuildMarker(row.Glyph, showConnector);
        Grid.SetColumn(marker, 0);
        grid.Children.Add(marker);

        StackPanel body = BuildBody(row);
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        AutomationProperties.SetName(grid, row.AccessibleName);
        return grid;
    }

    private static StackPanel BuildMarker(string glyph, bool showConnector)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var badge = new Border
        {
            Width = MarkerSize,
            Height = MarkerSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(MarkerBorder),
            Background = DisplayTokens.Surface,
            Child = icon,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var marker = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        marker.Children.Add(badge);
        if (showConnector)
        {
            marker.Children.Add(new Rectangle
            {
                Width = ConnectorWidth,
                MinHeight = ConnectorMinHeight,
                Fill = DisplayTokens.Border,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Stretch,
            });
        }

        return marker;
    }

    private StackPanel BuildBody(RecentActivityRow row)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        FrameworkElement title = row.HasRoute ? BuildLinkTitle(row) : BuildTextTitle(row.Title);
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        var time = new TextBlock
        {
            Text = FormatRelative(row.Timestamp),
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(TimeLeftGap, 0, 0, 0),
        };
        Grid.SetColumn(time, 1);
        header.Children.Add(time);

        var body = new StackPanel { Spacing = SubtitleSpacing };
        body.Children.Add(header);
        if (!string.IsNullOrEmpty(row.Subtitle))
        {
            body.Children.Add(new TextBlock
            {
                Text = row.Subtitle,
                FontSize = CaptionFontSize,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        return body;
    }

    // web: <Link to={href} className="text-cyan-300 ...">{title}</Link>
    private HyperlinkButton BuildLinkTitle(RecentActivityRow row)
    {
        var text = new TextBlock
        {
            Text = row.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Medium,
            TextWrapping = TextWrapping.Wrap,
        };

        var button = new HyperlinkButton
        {
            Content = text,
            Tag = row.Route,
            Padding = new Thickness(0),
            MinWidth = 0,
            MinHeight = 0,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(button, row.Title);
        button.Click += OnEntryLinkClick;
        return button;
    }

    // web: plain title (no href) — text-sm font-medium text-gray-900.
    private static TextBlock BuildTextTitle(string title) =>
        new()
        {
            Text = title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
        };

    private void OnEntryLinkClick(object sender, RoutedEventArgs e)
    {
        if (sender is HyperlinkButton { Tag: string route } && !string.IsNullOrEmpty(route))
        {
            EntryInvoked?.Invoke(this, route);
        }
    }

    // The host's first fetch is in flight: a loading skeleton honouring reduced-motion.
    private static StackPanel BuildLoading()
    {
        bool reduce = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = RowSpacing };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            var row = new Grid { ColumnSpacing = MarkerGap };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var badge = new TsSkeleton
            {
                BlockWidth = MarkerSize,
                BlockHeight = MarkerSize,
                Radius = MarkerSize / 2,
                ReduceMotion = reduce,
                VerticalAlignment = VerticalAlignment.Top,
            };
            Grid.SetColumn(badge, 0);
            row.Children.Add(badge);

            var lines = new StackPanel { Spacing = SubtitleSpacing + 2 };
            lines.Children.Add(new TsSkeleton
            {
                BlockWidth = SkeletonTitleWidth,
                BlockHeight = SkeletonTitleHeight,
                ReduceMotion = reduce,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
            lines.Children.Add(new TsSkeleton
            {
                BlockWidth = SkeletonSubtitleWidth,
                BlockHeight = SkeletonSubtitleHeight,
                ReduceMotion = reduce,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
            Grid.SetColumn(lines, 1);
            row.Children.Add(lines);

            column.Children.Add(row);
        }

        return column;
    }

    // web: formatRelative(entry.ts) — "Just now" / "5m ago" / absolute fallback.
    private static string FormatRelative(DateTimeOffset? timestamp) =>
        DateTimeFormatting.Format(timestamp, DateTimeVariant.Relative, DateTimeOffset.Now);

    private sealed class RecentActivityFeedAutomationPeer(RecentActivityFeed owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
