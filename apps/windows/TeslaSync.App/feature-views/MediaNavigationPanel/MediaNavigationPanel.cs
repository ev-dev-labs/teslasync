using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Media &amp; Navigation feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the "Media &amp; Navigation" header) over two stacked sections: the Now-Playing
/// section (the track title — or "Nothing playing" — over the artist — or "Unknown artist" — with the optional
/// playback-source chip and the colour-coded playback-status badge, or the "No media data" caption when there is
/// no media object) and the Navigation section (the active-route card with the destination, the distance — SI
/// metres converted to the user's display unit at the boundary — and the minutes-to-arrival, or the
/// "No active destination" caption, plus the Home / Work / Favorite presence chips, or the "No location data"
/// caption when there is no location object). The web component is a pure child of the live-telemetry grid; the
/// native surface binds its own cache-then-network <see cref="MediaNavigationPanelViewModel"/>, so it renders
/// every state the P2 contract requires — the skeleton while loading, a retry surface on a hard failure, a
/// friendly empty surface when there is neither a media object nor a location object, and a stale / offline
/// freshness chip over the sections otherwise. The view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class MediaNavigationPanel : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE767";       // Segoe Fluent — Volume (web Headphones, the media motif)
    private const string NavigationGlyph = "\uE724";   // Segoe Fluent — Send (web Navigation2 arrow)
    private const string DestinationGlyph = "\uE707";  // Segoe Fluent — Location (web MapPin)
    private const string RefreshGlyph = "\uE72C";      // Segoe Fluent — Refresh
    private const int FadeDelayMs = 240;               // web FadeIn delay={0.24}
    private const double OuterPadding = 24;            // web GlassPanel p-6
    private const double SectionSpacing = 20;          // web space-y-5
    private const double LabelSpacing = 8;             // web mb-2 between a section label and its content
    private const double CardSpacing = 8;              // web card space-y-2
    private const double NavInnerSpacing = 12;         // web navigation space-y-3
    private const double RowSpacing = 8;               // web chip row gap-2
    private const double DetailSpacing = 12;           // web destination detail row gap-3
    private const double HeaderIconSize = 16;          // web h-4 w-4
    private const double LabelIconSize = 12;           // web h-3 w-3
    private const double TitleFontSize = 14;           // web text-sm
    private const double DetailFontSize = 12;          // web text-xs
    private const double ChipFontSize = 12;
    private const double CardPadding = 16;             // web p-4
    private const double CardRadius = 12;              // web rounded-xl
    private const double SkeletonHeight = 96;
    private const double SkeletonIconSize = 16;

    private readonly MediaNavigationPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly MediaNavigationPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network media-and-navigation source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public MediaNavigationPanel(
        IMediaNavigationPanelSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        MediaNavigationPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new MediaNavigationPanelDiagnostics();
        _viewModel = new MediaNavigationPanelViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>media-navigation-panel</c>).</summary>
    public static string SurfaceId => MediaNavigationPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public MediaNavigationPanelViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the distance in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MediaNavigationPanelSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static MediaNavigationPanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        MediaNavigationPanelDiagnostics? diagnostics = null)
    {
        var source = new MediaNavigationPanelSource(vehicles, api, engine, options, vehicleId);
        return new MediaNavigationPanel(source, localizer, units, diagnostics);
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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            MediaNavigationPanelState.Loading => BuildLoading(),
            MediaNavigationPanelState.Error => BuildErrorSurface(),
            _ => BuildPanel(),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel()
    {
        var display = _viewModel.Display;

        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());

        if (_viewModel.State == MediaNavigationPanelState.Empty || !display.HasData)
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = HeaderGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }
        else
        {
            column.Children.Add(BuildNowPlayingSection(display));
            column.Children.Add(BuildNavigationSection(display));
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = HeaderGlyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = _viewModel.Title, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetAccessibilityView(titleRow, AccessibilityView.Raw);
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    // ── Now Playing section ─────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildNowPlayingSection(MediaNavigationPanelDisplay display)
    {
        var section = new StackPanel { Spacing = LabelSpacing };
        section.Children.Add(new Caption { Value = display.NowPlayingLabel });

        if (display.NowPlaying is { } nowPlaying)
        {
            section.Children.Add(BuildNowPlayingCard(nowPlaying));
        }
        else
        {
            section.Children.Add(new Caption { Value = display.NoMediaMessage });
        }

        return section;
    }

    private static Border BuildNowPlayingCard(MediaNavNowPlaying nowPlaying)
    {
        var content = new StackPanel { Spacing = CardSpacing };

        content.Children.Add(new TextBlock
        {
            Text = nowPlaying.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        content.Children.Add(new TextBlock
        {
            Text = nowPlaying.Artist,
            FontSize = DetailFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (nowPlaying.HasSource || nowPlaying.HasStatus)
        {
            var chips = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = RowSpacing,
                VerticalAlignment = VerticalAlignment.Center,
            };

            if (nowPlaying.HasSource)
            {
                chips.Children.Add(BuildChip(nowPlaying.Source!, StatusKind.Neutral));
            }

            if (nowPlaying.HasStatus)
            {
                chips.Children.Add(BuildChip(nowPlaying.StatusLabel!, nowPlaying.StatusKind));
            }

            content.Children.Add(chips);
        }

        var card = BuildCard(content);
        AutomationProperties.SetName(card, nowPlaying.AutomationName);
        return card;
    }

    // ── Navigation section ──────────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildNavigationSection(MediaNavigationPanelDisplay display)
    {
        var section = new StackPanel { Spacing = LabelSpacing };

        var label = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        label.Children.Add(new FontIcon
        {
            Glyph = NavigationGlyph,
            FontSize = LabelIconSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        label.Children.Add(new Caption { Value = display.NavigationLabel, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        section.Children.Add(label);

        if (display.HasNavigation)
        {
            var body = new StackPanel { Spacing = NavInnerSpacing };

            if (display.Destination is { } destination)
            {
                body.Children.Add(BuildDestinationCard(destination));
            }
            else
            {
                body.Children.Add(new Caption { Value = display.NoActiveDestinationMessage });
            }

            if (display.Places.Count > 0)
            {
                body.Children.Add(BuildPlacesRow(display.Places));
            }

            section.Children.Add(body);
        }
        else
        {
            section.Children.Add(new Caption { Value = display.NoLocationMessage });
        }

        return section;
    }

    private static Border BuildDestinationCard(MediaNavDestination destination)
    {
        var content = new StackPanel { Spacing = CardSpacing };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = DestinationGlyph,
            FontSize = DetailFontSize,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new TextBlock
        {
            Text = destination.Name,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });
        content.Children.Add(titleRow);

        if (destination.HasDistance || destination.HasEta)
        {
            var detail = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = DetailSpacing,
                VerticalAlignment = VerticalAlignment.Center,
            };

            if (destination.HasDistance)
            {
                detail.Children.Add(BuildDetailText(destination.Distance!));
            }

            if (destination.HasEta)
            {
                detail.Children.Add(BuildDetailText(destination.Eta!));
            }

            content.Children.Add(detail);
        }

        var card = BuildCard(content);
        AutomationProperties.SetName(card, destination.AutomationName);
        return card;
    }

    private static StackPanel BuildPlacesRow(IReadOnlyList<MediaNavPlace> places)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        foreach (var place in places)
        {
            var chip = BuildChip(
                string.Format(CultureInfo.CurrentCulture, "{0} {1}", place.Marker, place.Label),
                place.Status);
            AutomationProperties.SetName(chip, place.AutomationName);
            row.Children.Add(chip);
        }

        return row;
    }

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is MediaNavigationPanelState.Stale or MediaNavigationPanelState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == MediaNavigationPanelState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(MediaNavigationPanelState state)
    {
        bool offline = state == MediaNavigationPanelState.Offline;
        string text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = ChipFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Shared primitives ───────────────────────────────────────────────────────────────────────────────

    private static Border BuildCard(UIElement content) => new()
    {
        Background = DisplayTokens.Surface,
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(CardRadius),
        Padding = new Thickness(CardPadding),
        Child = content,
    };

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = ChipFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TextBlock BuildDetailText(string text) => new()
    {
        Text = text,
        FontSize = DetailFontSize,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 180,
            BlockHeight = SkeletonIconSize,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonHeight,
            Radius = CardRadius,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonHeight,
            Radius = CardRadius,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(CultureInfo.CurrentCulture, "{0}. {1}", _viewModel.Title, _viewModel.LoadingLabel));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
