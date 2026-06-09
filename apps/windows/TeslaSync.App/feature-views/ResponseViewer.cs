using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 ResponseViewer feature view — a parity port of
/// web/src/features/admin/components/ResponseViewer.tsx. It reproduces the web component's composition: a
/// "Response" <see cref="TsGlassPanel"/> whose body is one of the three mutually-exclusive branches the web
/// source has — a <see cref="TsSkeleton"/> while loading, a friendly <see cref="TsEmptyState"/> when no
/// response has resolved, or (inside a reduced-motion-aware <see cref="TsFadeIn"/>) the populated view: a
/// status bar tinted by the status class (web <c>statusBg</c>/<c>statusColor</c> → success/warning/danger
/// tokens), a selectable monospace body block (the web <c>&lt;pre&gt;</c>, indented JSON or raw text), and a
/// self-hiding "Response Headers" <see cref="Expander"/> — followed by the self-hiding "Recent Requests"
/// history strip whose chips replay a past request through the <see cref="OnReplay"/> callback (web
/// <c>onReplay</c>). The web source is presentational (its only hook is <c>useTranslation</c> and every value
/// arrives as a prop), so there is deliberately no fetch-driven error / stale / offline branch to reproduce —
/// a failed request arrives as a response with a 4xx/5xx status rendered with the danger tint, and
/// connectivity belongs to the parent page. All projection / formatting / label resolution flows through the
/// shared <see cref="ResponseViewerViewModel"/> + the pure <see cref="ResponseViewerProjection"/>; the view
/// never performs HTTP. Every owned string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class ResponseViewer : ContentControl, IDisposable
{
    private const double SkeletonHeight = 192; // web h-48 (12rem)
    private const double BodyMaxHeight = 500;  // web max-h-[500px]
    private const double HeadersMaxHeight = 160; // web max-h-40
    private const double TintFillOpacity = 0.10; // web bg-{color}/10
    private const double TintBorderOpacity = 0.20; // web border-{color}/20
    private const double BadgeFillOpacity = 0.20; // web method badge bg-{color}/20
    private const double ChipPathMaxWidth = 140; // web max-w-[120px] path truncation

    private readonly ResponseViewerViewModel _viewModel;
    private readonly ResponseViewerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the i18n facade and the optional initial props.</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    /// <param name="input">The initial props (web <c>{ response, loading, history }</c>); defaults to idle.</param>
    /// <param name="onReplay">The replay callback invoked on a history-chip click (web <c>onReplay</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public ResponseViewer(
        ILocalizer localizer,
        ResponseViewerInput? input = null,
        Action<RequestHistoryEntry>? onReplay = null,
        ResponseViewerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ResponseViewerDiagnostics();
        _viewModel = new ResponseViewerViewModel(
            new StaticResponseViewerSource(input ?? ResponseViewerInput.Idle),
            localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        OnReplay = onReplay;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The replay callback invoked with the source entry when a history chip is clicked (web <c>onReplay</c>).</summary>
    public Action<RequestHistoryEntry>? OnReplay { get; set; }

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="input">The initial props; defaults to idle.</param>
    /// <param name="onReplay">The replay callback.</param>
    /// <param name="diagnostics">Optional diagnostics collector.</param>
    /// <returns>A new surface.</returns>
    public static ResponseViewer Create(
        ILocalizer localizer,
        ResponseViewerInput? input = null,
        Action<RequestHistoryEntry>? onReplay = null,
        ResponseViewerDiagnostics? diagnostics = null) =>
        new(localizer, input, onReplay, diagnostics);

    /// <summary>Re-render for a new set of props (the web re-render with new <c>{ response, loading, history }</c>).</summary>
    /// <param name="input">The latest props.</param>
    public void Update(ResponseViewerInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        _viewModel.Update(input);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
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
        ResponseViewerDisplay display = _viewModel.Display;

        var root = new StackPanel { Spacing = Space("TsSpaceMd", 12) };
        root.Children.Add(BuildResponsePanel(display));
        if (display.HasHistory)
        {
            root.Children.Add(BuildHistoryPanel(display, OnReplay));
        }

        Content = root;
    }

    private static TsGlassPanel BuildResponsePanel(ResponseViewerDisplay display)
    {
        var column = new StackPanel { Spacing = Space("TsSpaceSm", 8) };
        column.Children.Add(BuildHeading(display.ResponseTitle, "TsTypeCaptionFontSize", 12, DisplayTokens.TextSecondary));
        column.Children.Add(BuildResponseBody(display));

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(Space("TsSpaceMd", 16)),
            Content = column,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(panel, display.ResponseRegionName);
        return panel;
    }

    private static FrameworkElement BuildResponseBody(ResponseViewerDisplay display)
    {
        FrameworkElement body = display.State switch
        {
            ResponseViewerState.Loading => BuildSkeleton(),
            ResponseViewerState.Empty => BuildEmpty(display),
            _ => BuildResponseContent(display),
        };

        AutomationProperties.SetName(body, display.StatusBodyName);
        LiveRegion.Configure(body);
        LiveRegion.Announce(body);
        return body;
    }

    private static TsSkeleton BuildSkeleton() => new TsSkeleton
    {
        BlockHeight = SkeletonHeight,
        Radius = DisplayTokens.Radius("TsRadiusMd", 12).TopLeft,
    };

    private static TsEmptyState BuildEmpty(ResponseViewerDisplay display) => new TsEmptyState
    {
        Message = display.EmptyMessage,
    };

    private static TsFadeIn BuildResponseContent(ResponseViewerDisplay display)
    {
        var stack = new StackPanel { Spacing = Space("TsSpaceSm", 8) };
        stack.Children.Add(BuildStatusBar(display));
        stack.Children.Add(BuildBodyBlock(display));
        if (display.HasHeaders)
        {
            stack.Children.Add(BuildHeadersToggle(display));
        }

        return new TsFadeIn { Content = stack };
    }

    private static Border BuildStatusBar(ResponseViewerDisplay display)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var status = new TextBlock
        {
            Text = display.StatusText,
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightBold", 700)),
            Foreground = DisplayTokens.Brush(display.StatusBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(status, 0);
        grid.Children.Add(status);

        var meta = new TextBlock
        {
            Text = display.MetaText,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(meta, 1);
        grid.Children.Add(meta);

        return new Border
        {
            Background = Tint(display.StatusBrushKey, TintFillOpacity),
            BorderBrush = Tint(display.StatusBrushKey, TintBorderOpacity),
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(Space("TsSpaceMd", 12), Space("TsSpaceXs", 6), Space("TsSpaceMd", 12), Space("TsSpaceXs", 6)),
            Child = grid,
        };
    }

    private static Border BuildBodyBlock(ResponseViewerDisplay display)
    {
        var pre = new TextBlock
        {
            Text = display.BodyText,
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };

        var scroller = new ScrollViewer
        {
            Content = pre,
            MaxHeight = BodyMaxHeight,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
        };

        return new Border
        {
            Background = DisplayTokens.Brush(ResponseViewerProjection.OverlayBrushKey),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(Space("TsSpaceSm", 8)),
            Child = scroller,
        };
    }

    private static Expander BuildHeadersToggle(ResponseViewerDisplay display)
    {
        var rows = new StackPanel { Spacing = 2 };
        foreach (HttpHeaderEntry header in display.Headers)
        {
            rows.Children.Add(BuildHeaderRow(header));
        }

        var scroller = new ScrollViewer
        {
            Content = rows,
            MaxHeight = HeadersMaxHeight,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
        };

        var expander = new Expander
        {
            Header = display.HeadersCountLabel,
            Content = scroller,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.HeadersCountLabel);
        return expander;
    }

    private static TextBlock BuildHeaderRow(HttpHeaderEntry header)
    {
        var line = new TextBlock
        {
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            TextWrapping = TextWrapping.Wrap,
        };
        line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run
        {
            Text = header.Name + ":",
            Foreground = DisplayTokens.TextSecondary,
        });
        line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run
        {
            Text = " " + header.Value,
            Foreground = DisplayTokens.TextMuted,
        });
        AutomationProperties.SetName(line, header.Name + " " + header.Value);
        return line;
    }

    private static TsGlassPanel BuildHistoryPanel(ResponseViewerDisplay display, Action<RequestHistoryEntry>? onReplay)
    {
        var column = new StackPanel { Spacing = Space("TsSpaceSm", 8) };
        column.Children.Add(BuildHeading(display.HistoryTitle, "TsTypeLabelFontSize", 11, DisplayTokens.TextMuted));

        var strip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = Space("TsSpaceXs", 6) };
        foreach (RequestHistoryRow row in display.History)
        {
            strip.Children.Add(BuildHistoryChip(row, onReplay));
        }

        var scroller = new ScrollViewer
        {
            Content = strip,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };
        column.Children.Add(scroller);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(Space("TsSpaceMd", 12)),
            Content = column,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(panel, display.HistoryTitle);
        return panel;
    }

    private static TsButton BuildHistoryChip(RequestHistoryRow row, Action<RequestHistoryEntry>? onReplay)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = Space("TsSpaceXs", 6),
            VerticalAlignment = VerticalAlignment.Center,
        };

        content.Children.Add(BuildMethodBadge(row));

        content.Children.Add(new TextBlock
        {
            Text = row.Path,
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeLabelFontSize", 11),
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            MaxWidth = ChipPathMaxWidth,
            VerticalAlignment = VerticalAlignment.Center,
        });

        content.Children.Add(new TextBlock
        {
            Text = row.Status.ToString(System.Globalization.CultureInfo.InvariantCulture),
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeLabelFontSize", 11),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightBold", 700)),
            Foreground = DisplayTokens.Brush(row.StatusBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        });

        content.Children.Add(new TextBlock
        {
            Text = row.DurationText,
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeLabelFontSize", 11),
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = content,
        };
        chip.Click += (_, _) => onReplay?.Invoke(row.Entry);
        AutomationProperties.SetName(chip, row.AutomationName);
        ToolTipService.SetToolTip(chip, row.Tooltip);
        return chip;
    }

    private static Border BuildMethodBadge(RequestHistoryRow row)
    {
        var label = new TextBlock
        {
            Text = row.Method,
            FontSize = TypographyTokens.Size("TsTypeMicroFontSize", 10),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightBold", 700)),
            Foreground = DisplayTokens.Brush(row.MethodBrushKey),
        };

        return new Border
        {
            Background = Tint(row.MethodBrushKey, BadgeFillOpacity),
            CornerRadius = DisplayTokens.Radius("TsRadiusXs", 4),
            Padding = new Thickness(Space("TsSpaceXs", 4), 1, Space("TsSpaceXs", 4), 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = label,
        };
    }

    private static TextBlock BuildHeading(string text, string sizeKey, double sizeFallback, Brush foreground) => new()
    {
        Text = text,
        FontSize = TypographyTokens.Size(sizeKey, sizeFallback),
        FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightSemibold", 600)),
        Foreground = foreground,
        CharacterSpacing = 60,
    };

    private static Brush Tint(string brushKey, double opacity)
    {
        Brush brush = DisplayTokens.Brush(brushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = opacity }
            : brush;
    }

    private static double Space(string key, double fallback) =>
        Application.Current?.Resources is { } resources &&
        resources.TryGetValue(key, out object? value) && value is double measure
            ? measure
            : fallback;
}
