using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 ResultPanel feature view — a parity port of
/// web/src/features/admin/components/devtools/ResultPanel.tsx. It reproduces the web component's compact,
/// tinted result card: a header carrying the caller-supplied label and — only when a payload resolved — a
/// shared <see cref="TsCopyButton"/>, above a body that is one of three mutually-exclusive branches in the
/// same precedence as the web source: an error string rendered as danger text (red-tinted card), a non-null
/// payload rendered as two-space-indented, selectable monospace JSON in a scrollable inset (green-tinted
/// card), or the friendly idle message <c>idleMessage ?? "No result yet"</c> in muted italics (neutral
/// card). It is presentational and prop-driven: the bindable <see cref="Title"/> / <see cref="Data"/> /
/// <see cref="Error"/> / <see cref="IdleMessage"/> properties mirror the web props and re-project through the
/// shared <see cref="ResultPanelViewModel"/>; the view never performs HTTP. There is no loading / stale /
/// offline branch because the web source has none. Every owned string resolves through the i18n facade, the
/// card is a named Automation region, the body is announced as a live region on each state change, and the
/// copy button carries a Narrator name — so the surface is accessible by construction.
/// </summary>
public sealed partial class ResultPanel : ContentControl, IDisposable
{
    private const string CopyGlyph = "\uE8C8"; // Segoe Fluent — Copy

    private readonly ResultPanelViewModel _viewModel;
    private readonly ResultPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the i18n facade and an optional diagnostics collector.</summary>
    public ResultPanel(ILocalizer localizer, ResultPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ResultPanelDiagnostics();
        _viewModel = new ResultPanelViewModel(StaticResultPanelSource.Idle(string.Empty), localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The header label shown verbatim (web <c>title</c>).</summary>
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(ResultPanel),
        new PropertyMetadata(string.Empty, OnInputChanged));

    /// <summary>The resolved payload rendered as JSON, or <see langword="null"/> (web <c>data</c>).</summary>
    public static readonly DependencyProperty DataProperty = DependencyProperty.Register(
        nameof(Data), typeof(object), typeof(ResultPanel),
        new PropertyMetadata(null, OnInputChanged));

    /// <summary>The error string, or <see langword="null"/> when there is none (web <c>error</c>).</summary>
    public static readonly DependencyProperty ErrorProperty = DependencyProperty.Register(
        nameof(Error), typeof(string), typeof(ResultPanel),
        new PropertyMetadata(null, OnInputChanged));

    /// <summary>An optional override for the idle text (web <c>idleMessage</c>).</summary>
    public static readonly DependencyProperty IdleMessageProperty = DependencyProperty.Register(
        nameof(IdleMessage), typeof(string), typeof(ResultPanel),
        new PropertyMetadata(null, OnInputChanged));

    /// <summary>The header label shown verbatim (web <c>title</c>).</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The resolved payload rendered as JSON, or <see langword="null"/> (web <c>data</c>).</summary>
    public object? Data
    {
        get => GetValue(DataProperty);
        set => SetValue(DataProperty, value);
    }

    /// <summary>The error string, or <see langword="null"/> when there is none (web <c>error</c>).</summary>
    public string? Error
    {
        get => (string?)GetValue(ErrorProperty);
        set => SetValue(ErrorProperty, value);
    }

    /// <summary>An optional override for the idle text (web <c>idleMessage</c>).</summary>
    public string? IdleMessage
    {
        get => (string?)GetValue(IdleMessageProperty);
        set => SetValue(IdleMessageProperty, value);
    }

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    public static ResultPanel Create(ILocalizer localizer, ResultPanelDiagnostics? diagnostics = null) =>
        new(localizer, diagnostics);

    private static void OnInputChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((ResultPanel)d).PushInput();

    private void PushInput() =>
        _viewModel.Update(new ResultPanelInput(Title ?? string.Empty, Data, Error, IdleMessage));

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

    private void Render() => Content = BuildPanel(_viewModel.Display);

    private static Border BuildPanel(ResultPanelDisplay display)
    {
        var column = new StackPanel { Spacing = Space("TsSpaceXs", 4) };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildBody(display));

        var container = new Border
        {
            Background = Tint(display.TintBrushKey, display.TintOpacity),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 12),
            Padding = new Thickness(Space("TsSpaceMd", 12)),
            Margin = new Thickness(0, Space("TsSpaceMd", 12), 0, 0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = column,
        };

        AutomationProperties.SetName(container, display.RegionName);
        return container;
    }

    private static Grid BuildHeader(ResultPanelDisplay display)
    {
        var header = new Grid
        {
            ColumnSpacing = Space("TsSpaceSm", 8),
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text = display.Title,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightMedium", 500)),
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        if (display.HasCopyAction)
        {
            var copy = new TsCopyButton
            {
                ValueToCopy = display.CopyValue,
                CopyLabel = display.CopyLabel,
                CopiedLabel = display.CopiedLabel,
                IconGlyph = CopyGlyph,
                Size = ControlSize.Small,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(copy, display.CopyLabel);
            Grid.SetColumn(copy, 1);
            header.Children.Add(copy);
        }

        return header;
    }

    private static FrameworkElement BuildBody(ResultPanelDisplay display)
    {
        FrameworkElement body = display.State switch
        {
            ResultPanelState.Error => BuildErrorText(display),
            ResultPanelState.Result => BuildResult(display),
            _ => BuildIdleText(display),
        };

        AutomationProperties.SetName(body, display.BodyName);
        LiveRegion.Configure(body, assertive: display.State == ResultPanelState.Error);
        LiveRegion.Announce(body);
        return body;
    }

    private static TextBlock BuildErrorText(ResultPanelDisplay display) => new()
    {
        Text = display.ErrorMessage ?? string.Empty,
        FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
        Foreground = DisplayTokens.Brush(ResultPanelProjection.DangerBrushKey),
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BuildIdleText(ResultPanelDisplay display) => new()
    {
        Text = display.IdleMessage,
        FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
        FontStyle = Windows.UI.Text.FontStyle.Italic,
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
    };

    private static Border BuildResult(ResultPanelDisplay display)
    {
        // A preformatted, selectable monospace block (the web <pre>): preserve the JSON layout and let long
        // lines scroll horizontally rather than wrap, inside a token-tinted overlay surface.
        var pre = new TextBlock
        {
            Text = display.SerializedData ?? string.Empty,
            FontFamily = TypographyTokens.Mono,
            FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };

        var scroller = new ScrollViewer
        {
            Content = pre,
            MaxHeight = 256,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
        };

        return new Border
        {
            Background = DisplayTokens.Brush(ResultPanelProjection.OverlayBrushKey),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(Space("TsSpaceSm", 8)),
            Child = scroller,
        };
    }

    private static Brush Tint(string brushKey, double opacity)
    {
        var brush = DisplayTokens.Brush(brushKey);
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
