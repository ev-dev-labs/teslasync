using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 now-playing dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise the "♪ Now Playing" freshness header above the
/// body) and the web's footprint branches: a centred icon + title + artist for the compact 1×1 variant; a track
/// header (icon tile, title, artist, a green "Playing" chip while playing) with an <c>m:ss</c> progress bar and a
/// source row for the standard variant; and the tall (<c>rows ≥ 2</c>) variant that additionally shows the album,
/// the source row and a volume row. When the response carries no media object the friendly "Nothing playing"
/// empty state renders (the web <c>{media ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="MediaNowPlayingViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and the rendered track carries a Narrator name.
/// </summary>
public sealed partial class MediaNowPlayingWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double BarHeight = 4;

    private readonly MediaNowPlayingViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly MediaNowPlayingDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly Border _bodyHost = new();

    private readonly Grid _compactRoot = new();
    private readonly Border _compactBodyHost = new();
    private readonly TsDataFreshness _compactFreshness = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network media source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / tall branches).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public MediaNowPlayingWidget(
        IMediaNowPlayingSource source,
        ILocalizer localizer,
        MediaNowPlayingSize size,
        MediaNowPlayingDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new MediaNowPlayingDiagnostics();
        _viewModel = new MediaNowPlayingViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>media-now-playing</c>).</summary>
    public static string RegistryId => MediaNowPlayingRegistration.Id;

    /// <summary>The widget footprint (registry metadata; reassigning re-renders the compact / standard / tall layout).</summary>
    public MediaNowPlayingSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MediaNowPlayingSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static MediaNowPlayingWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        MediaNowPlayingSize? size = null,
        long? vehicleId = null,
        MediaNowPlayingDiagnostics? diagnostics = null)
    {
        var source = new MediaNowPlayingSource(vehicles, api, engine, options, vehicleId);
        return new MediaNowPlayingWidget(source, localizer, size ?? MediaNowPlayingRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        // ── Non-compact shell: a "♪ Now Playing" freshness header above the body ──
        var icon = new FontIcon
        {
            Glyph = MediaNowPlayingProjection.MusicGlyph,
            FontSize = 14,
            Foreground = InfoBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.mediaNowPlaying.refresh", "Refresh now playing"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(16, 12, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.Padding = new Thickness(16, 4, 16, 12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        // ── Compact 1×1 shell: body with an overlaid freshness dot (web title-less WidgetShell) ──
        _compactBodyHost.Padding = new Thickness(8);
        _compactBodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _compactBodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        var overlay = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 6, 6, 0),
        };
        overlay.Children.Add(_compactFreshness);

        _compactRoot.Children.Add(_compactBodyHost);
        _compactRoot.Children.Add(overlay);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
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
        switch (_viewModel.State)
        {
            case MediaNowPlayingState.Loading:
                Content = BuildLoading();
                break;

            case MediaNowPlayingState.Error:
                Content = BuildError();
                break;

            default:
                if (_viewModel.Size.IsCompact)
                {
                    UpdateCompactFreshness();
                    _compactBodyHost.Child = BuildBody(compact: true);
                    Content = _compactRoot;
                }
                else
                {
                    UpdateHeader();
                    _bodyHost.Child = BuildBody(compact: false);
                    Content = _root;
                }

                break;
        }
    }

    private void UpdateHeader()
    {
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private void UpdateCompactFreshness()
    {
        _compactFreshness.UpdatedAt = _viewModel.UpdatedAt;
        _compactFreshness.IsFetching = _viewModel.IsFetching;
        _compactFreshness.IsError = _viewModel.IsError;
    }

    private UIElement BuildBody(bool compact)
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no media object (media == null) renders the "Nothing playing" surface.
            return BuildEmpty();
        }

        return compact ? BuildCompact(display) : BuildStandardOrTall(display, _viewModel.Size.IsTall);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 140 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14, BlockWidth = 100 });
        column.Children.Add(new TsSkeleton { BlockHeight = 8 });
        column.Children.Add(new TsSkeleton { BlockHeight = 14 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.mediaNowPlaying.loading", "Loading now playing"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.mediaNowPlaying.error", "Couldn't load what's playing"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = MediaNowPlayingProjection.MusicGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact 1×1 (web isCompact branch): centred icon + title + artist ──
    private static StackPanel BuildCompact(MediaNowPlayingDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = MediaNowPlayingProjection.MusicGlyph,
            FontSize = 20,
            Foreground = InfoBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        column.Children.Add(icon);

        column.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.Artist,
            FontSize = 10,
            Foreground = DisplayTokens.TextSecondary,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Standard / Tall (web non-compact branch) ──
    private static Grid BuildStandardOrTall(MediaNowPlayingDisplay display, bool isTall)
    {
        var grid = new Grid { RowSpacing = 8 };
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // track header
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // progress
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // spacer (pins bottom rows)
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // bottom (source / volume)

        var headerRow = BuildTrackHeader(display, isTall);
        Grid.SetRow(headerRow, 0);
        grid.Children.Add(headerRow);

        if (display.HasDuration)
        {
            var progress = BuildProgress(display);
            Grid.SetRow(progress, 1);
            grid.Children.Add(progress);
        }

        var bottom = BuildBottom(display, isTall);
        if (bottom is not null)
        {
            Grid.SetRow(bottom, 3);
            grid.Children.Add(bottom);
        }

        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    // Web parity: <div className="flex items-start gap-3"> — icon tile, title/artist[/album], playing chip.
    private static Grid BuildTrackHeader(MediaNowPlayingDisplay display, bool isTall)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var tile = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(8),
            Background = InfoTint(0.12),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var tileIcon = new FontIcon
        {
            Glyph = MediaNowPlayingProjection.MusicGlyph,
            FontSize = 20,
            Foreground = InfoBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(tileIcon, AccessibilityView.Raw);
        tile.Child = tileIcon;
        Grid.SetColumn(tile, 0);
        grid.Children.Add(tile);

        var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        text.Children.Add(new TextBlock
        {
            Text = display.Artist,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (isTall && display.Album is { } album)
        {
            text.Children.Add(new TextBlock
            {
                Text = album,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        if (display.IsPlaying)
        {
            var chip = BuildPlayingChip(display.PlayingChipText);
            Grid.SetColumn(chip, 2);
            grid.Children.Add(chip);
        }

        return grid;
    }

    // Web parity: <span className="bg-green-500/10 text-green-400 rounded-full">{Playing}</span>.
    private static Border BuildPlayingChip(string text)
    {
        Brush accent = SuccessBrush();
        var label = new TextBlock
        {
            Text = text,
            FontSize = 11,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chip = new Border
        {
            Child = label,
            Background = Tint(accent, 0.12),
            CornerRadius = new CornerRadius(999),
            Padding = new Thickness(8, 2, 8, 2),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    // Web parity: a thin progress track + the elapsed / duration clocks beneath it.
    private static StackPanel BuildProgress(MediaNowPlayingDisplay display)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(BuildBar(display.ProgressFraction, InfoBrush(), TrackBrush()));

        var clocks = new Grid();
        clocks.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        clocks.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var elapsed = new TextBlock { Text = display.ElapsedText, FontSize = 10, Foreground = DisplayTokens.TextMuted };
        var duration = new TextBlock
        {
            Text = display.DurationText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(elapsed, 0);
        Grid.SetColumn(duration, 1);
        clocks.Children.Add(elapsed);
        clocks.Children.Add(duration);
        column.Children.Add(clocks);

        return column;
    }

    // Web parity: the bottom block — source row (tall + standard) and, in the tall variant, the volume row.
    private static StackPanel? BuildBottom(MediaNowPlayingDisplay display, bool isTall)
    {
        var rows = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Bottom };

        if (display.HasSource && display.Source is { } source)
        {
            rows.Children.Add(BuildIconText(MediaNowPlayingProjection.RadioGlyph, source, $"{display.SourceLabel} {source}"));
        }

        if (isTall && display.HasVolume)
        {
            rows.Children.Add(BuildVolumeRow(display));
        }

        return rows.Children.Count == 0 ? null : rows;
    }

    // Web parity: <Radio /> + <span>{source}</span>.
    private static Grid BuildIconText(string glyph, string text, string automationName)
    {
        var grid = new Grid { ColumnSpacing = 6 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var label = new TextBlock
        {
            Text = text,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        Grid.SetColumn(label, 1);
        grid.Children.Add(label);

        AutomationProperties.SetName(grid, automationName);
        return grid;
    }

    // Web parity: <Volume2 /> + a thin bar + the raw {volume} value.
    private static Grid BuildVolumeRow(MediaNowPlayingDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 6 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = MediaNowPlayingProjection.VolumeGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        // Web parity: the volume track and its fill share the same muted surface colour.
        var bar = BuildBar(display.VolumeFraction, TrackBrush(), TrackBrush());
        bar.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(bar, 1);
        grid.Children.Add(bar);

        var value = new TextBlock
        {
            Text = display.VolumeText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 2);
        grid.Children.Add(value);

        AutomationProperties.SetName(grid, $"{display.VolumeLabel} {display.VolumeText}");
        return grid;
    }

    // A rounded proportional bar: a tinted fill occupying `fraction` of a muted track via star columns.
    private static Border BuildBar(double fraction, Brush fill, Brush track)
    {
        double clamped = Math.Clamp(fraction, 0, 1);
        var bars = new Grid();
        bars.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(clamped, GridUnitType.Star) });
        bars.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - clamped, GridUnitType.Star) });

        var fillBorder = new Border { Background = fill, CornerRadius = new CornerRadius(BarHeight / 2) };
        Grid.SetColumn(fillBorder, 0);
        bars.Children.Add(fillBorder);

        return new Border
        {
            Height = BarHeight,
            CornerRadius = new CornerRadius(BarHeight / 2),
            Background = track,
            Child = bars,
        };
    }

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static Brush SuccessBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

    private static Brush TrackBrush() => DisplayTokens.Border;

    private static SolidColorBrush InfoTint(double opacity) => Tint(InfoBrush(), opacity);

    private static SolidColorBrush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : Transparent();

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
