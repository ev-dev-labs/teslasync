using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// The native WinUI 3 RequestBuilder surface — a parity port of
/// web/src/features/admin/components/RequestBuilder.tsx. It reproduces the web component's composition: a URL
/// bar (a method badge beside a monospaced, scrollable <c>/api/v1</c>-prefixed path and a primary Send button
/// that disables + spins while a send is in flight, web <c>loading</c>), a destructive-action confirm banner
/// that arms before any non-GET request is sent (web <c>confirmOpen</c>, announced through a polite live
/// region), the optional summary / description lines, the optional Path Parameters / Query Parameters panels
/// (each a <see cref="TsGlassPanel"/> of labelled <see cref="TsInput"/> rows, present only when the endpoint
/// declares parameters of that location — web <c>{pathParams.length > 0 &amp;&amp; …}</c>), the optional Request Body
/// panel (a <see cref="TsTextarea"/> seeded from the endpoint example), and the always-present "Authentication
/// (Optional)" panel whose secret field is a masked <see cref="PasswordBox"/> (the native idiom for the web
/// <c>type="password"</c> input). User-owned input controls are rebuilt only when the endpoint changes (the
/// native analogue of the web endpoint-change <c>useEffect</c> reset) so typing is never disturbed; the URL,
/// send button, confirm banner and every localized label refresh on each notification. The web source is
/// presentational — its endpoint and loading flag arrive as props and its only hook is <c>useTranslation</c> —
/// so there is deliberately no loading-spinner-for-data / error / stale / offline branch to reproduce beyond
/// the <c>loading</c> send state; those data-freshness states belong to the parent page that owns the fetch.
/// All state and the send flow run through the shared <see cref="RequestBuilderViewModel"/> + the pure
/// <see cref="RequestBuilderProjection"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RequestBuilder : ContentControl, IDisposable
{
    private const string SendGlyph = "\uE724";   // Segoe Fluent — Send (web Lucide Send)
    private const string WarningGlyph = "\uE7BA"; // Segoe Fluent — Warning (web Lucide AlertTriangle)
    private const double LabelColumnWidth = 112;  // web label w-28 (7rem)
    private const byte BadgeFillAlpha = 48;       // ~19% — web bg-{color}/20 badge wash
    private const byte ConfirmFillAlpha = 26;     // ~10% — web bg-amber-500/10 banner wash
    private const byte ConfirmBorderAlpha = 76;   // ~30% — web border-amber-500/30 banner edge

    private readonly RequestBuilderViewModel _viewModel;
    private readonly RequestBuilderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private readonly Border _methodBadge = new();
    private readonly TextBlock _methodBadgeText = new();
    private readonly TextBlock _urlText = new();
    private readonly TsButton _sendButton = new();

    private readonly Border _confirmBanner = new();
    private readonly TextBlock _confirmText = new();
    private readonly TsButton _confirmYes = new();
    private readonly TsButton _confirmCancel = new();

    private readonly TextBlock _summaryText = new();
    private readonly TextBlock _descriptionText = new();

    private readonly TsGlassPanel _pathPanel = new();
    private readonly TextBlock _pathTitle = new();
    private readonly StackPanel _pathFields = new() { Spacing = 12 };

    private readonly TsGlassPanel _queryPanel = new();
    private readonly TextBlock _queryTitle = new();
    private readonly StackPanel _queryFields = new() { Spacing = 12 };

    private readonly TsGlassPanel _bodyPanel = new();
    private readonly TextBlock _bodyTitle = new();
    private readonly TextBlock _bodyContentType = new();
    private readonly TsTextarea _bodyTextarea = new();

    private readonly TsGlassPanel _authPanel = new();
    private readonly TextBlock _authTitle = new();
    private readonly TextBlock _authFieldLabel = new();
    private readonly PasswordBox _apiKeyBox = new();
    private readonly TextBlock _authHint = new();

    private readonly Dictionary<string, ParamRow> _paramRows = new(StringComparer.Ordinal);

    private bool _started;
    private bool _renderQueued;
    private bool _structureDirty;
    private bool _rebuilding;
    private bool _disposed;
    private bool _confirmAnnounced;

    /// <summary>Creates the surface over its i18n facade, the initial endpoint and the optional props.</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    /// <param name="endpoint">The initial endpoint (web <c>endpoint</c> prop).</param>
    /// <param name="onSend">The send callback (web <c>onSend</c> prop); invoked on a confirmed send.</param>
    /// <param name="loading">The initial loading flag (web <c>loading</c> prop).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public RequestBuilder(
        ILocalizer localizer,
        ParsedEndpoint endpoint,
        Action<OutgoingRequest>? onSend = null,
        bool loading = false,
        RequestBuilderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(endpoint);

        _diagnostics = diagnostics ?? new RequestBuilderDiagnostics();
        _viewModel = new RequestBuilderViewModel(localizer, endpoint, onSend, loading);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _sendButton.Click += OnSendClick;
        _confirmYes.Click += OnConfirmYesClick;
        _confirmCancel.Click += OnConfirmCancelClick;
        _bodyTextarea.TextChanged += OnBodyChanged;
        _apiKeyBox.PasswordChanged += OnApiKeyChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        RebuildStructure();
        RenderChrome();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>RequestBuilder</c>).</summary>
    public static string Slug => RequestBuilderRegistration.Slug;

    /// <summary>The shared state holder — the parent drives the endpoint / loading flag through it.</summary>
    public RequestBuilderViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="endpoint">The initial endpoint.</param>
    /// <param name="onSend">The send callback invoked on a confirmed send.</param>
    /// <param name="loading">The initial loading flag.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static RequestBuilder Create(
        ILocalizer localizer,
        ParsedEndpoint endpoint,
        Action<OutgoingRequest>? onSend = null,
        bool loading = false,
        RequestBuilderDiagnostics? diagnostics = null) =>
        new(localizer, endpoint, onSend, loading, diagnostics);

    private void BuildChrome()
    {
        _root.Children.Add(BuildUrlBar());
        _root.Children.Add(BuildConfirmBanner());

        _summaryText.TextWrapping = TextWrapping.Wrap;
        _summaryText.FontSize = 14;
        _summaryText.Foreground = DisplayTokens.TextSecondary;
        _root.Children.Add(_summaryText);

        _descriptionText.TextWrapping = TextWrapping.Wrap;
        _descriptionText.FontSize = 12;
        _descriptionText.Foreground = DisplayTokens.TextMuted;
        _root.Children.Add(_descriptionText);

        _root.Children.Add(BuildParamPanel(_pathPanel, _pathTitle, _pathFields));
        _root.Children.Add(BuildParamPanel(_queryPanel, _queryTitle, _queryFields));
        _root.Children.Add(BuildBodyPanel());
        _root.Children.Add(BuildAuthPanel());

        var scroller = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Disabled,
            Content = _root,
        };
        Content = scroller;
    }

    private Grid BuildUrlBar()
    {
        var grid = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _methodBadgeText.FontFamily = MonoFont();
        _methodBadgeText.FontSize = 11;
        _methodBadgeText.FontWeight = FontWeights.Bold;
        _methodBadgeText.HorizontalAlignment = HorizontalAlignment.Center;
        _methodBadgeText.TextAlignment = TextAlignment.Center;
        _methodBadgeText.VerticalAlignment = VerticalAlignment.Center;

        _methodBadge.CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4);
        _methodBadge.Padding = new Thickness(6, 2, 6, 2);
        _methodBadge.MinWidth = 56;
        _methodBadge.VerticalAlignment = VerticalAlignment.Center;
        _methodBadge.Child = _methodBadgeText;
        AutomationProperties.SetAccessibilityView(_methodBadge, AccessibilityView.Raw); // verb is in the URL region name
        Grid.SetColumn(_methodBadge, 0);

        _urlText.FontFamily = MonoFont();
        _urlText.FontSize = 13;
        _urlText.Foreground = DisplayTokens.TextPrimary;
        _urlText.TextWrapping = TextWrapping.NoWrap;
        _urlText.IsTextSelectionEnabled = true;
        _urlText.VerticalAlignment = VerticalAlignment.Center;

        var urlScroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollMode = ScrollMode.Disabled,
            Content = _urlText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var urlHost = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 8, 12, 8),
            Child = urlScroller,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(urlHost, 1);

        _sendButton.Variant = ButtonVariant.Primary;
        _sendButton.Size = ControlSize.Small;
        _sendButton.IconGlyph = SendGlyph;
        _sendButton.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_sendButton, 2);

        grid.Children.Add(_methodBadge);
        grid.Children.Add(urlHost);
        grid.Children.Add(_sendButton);
        return grid;
    }

    private Border BuildConfirmBanner()
    {
        Brush warning = DisplayTokens.Brush("TsColorWarningBrush");

        var icon = new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 16,
            Foreground = warning,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        _confirmText.FontSize = 12;
        _confirmText.Foreground = warning;
        _confirmText.TextWrapping = TextWrapping.Wrap;
        _confirmText.VerticalAlignment = VerticalAlignment.Center;
        LiveRegion.Configure(_confirmText);
        Grid.SetColumn(_confirmText, 1);

        _confirmYes.Variant = ButtonVariant.Primary;
        _confirmYes.Size = ControlSize.Small;
        _confirmYes.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_confirmYes, 2);

        _confirmCancel.Variant = ButtonVariant.Subtle;
        _confirmCancel.Size = ControlSize.Small;
        _confirmCancel.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_confirmCancel, 3);

        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(icon);
        grid.Children.Add(_confirmText);
        grid.Children.Add(_confirmYes);
        grid.Children.Add(_confirmCancel);

        _confirmBanner.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _confirmBanner.BorderThickness = new Thickness(1);
        _confirmBanner.BorderBrush = Wash(warning, ConfirmBorderAlpha);
        _confirmBanner.Background = Wash(warning, ConfirmFillAlpha);
        _confirmBanner.Padding = new Thickness(16, 10, 16, 10);
        _confirmBanner.Visibility = Visibility.Collapsed;
        _confirmBanner.Child = grid;
        return _confirmBanner;
    }

    private static TsGlassPanel BuildParamPanel(TsGlassPanel panel, TextBlock title, StackPanel fields)
    {
        ConfigurePanelTitle(title);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(title);
        column.Children.Add(fields);

        panel.Padding = new Thickness(16);
        panel.Visibility = Visibility.Collapsed;
        panel.Content = column;
        return panel;
    }

    private TsGlassPanel BuildBodyPanel()
    {
        ConfigurePanelTitle(_bodyTitle);

        _bodyContentType.FontSize = 11;
        _bodyContentType.FontFamily = MonoFont();
        _bodyContentType.Foreground = DisplayTokens.TextMuted;
        _bodyContentType.VerticalAlignment = VerticalAlignment.Center;

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(_bodyTitle);
        header.Children.Add(_bodyContentType);

        _bodyTextarea.FontFamily = MonoFont();
        _bodyTextarea.FontSize = 12;
        _bodyTextarea.MinHeight = 160;
        _bodyTextarea.AcceptsReturn = true;
        _bodyTextarea.HorizontalAlignment = HorizontalAlignment.Stretch;

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(header);
        column.Children.Add(_bodyTextarea);

        _bodyPanel.Padding = new Thickness(16);
        _bodyPanel.Visibility = Visibility.Collapsed;
        _bodyPanel.Content = column;
        return _bodyPanel;
    }

    private TsGlassPanel BuildAuthPanel()
    {
        ConfigurePanelTitle(_authTitle);

        _authFieldLabel.FontFamily = MonoFont();
        _authFieldLabel.FontSize = 12;
        _authFieldLabel.Foreground = DisplayTokens.TextMuted;
        _authFieldLabel.VerticalAlignment = VerticalAlignment.Center;
        _authFieldLabel.Width = LabelColumnWidth;

        _apiKeyBox.HorizontalAlignment = HorizontalAlignment.Stretch;
        _apiKeyBox.FontFamily = MonoFont();

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_authFieldLabel, 0);
        Grid.SetColumn(_apiKeyBox, 1);
        row.Children.Add(_authFieldLabel);
        row.Children.Add(_apiKeyBox);

        _authHint.FontSize = 11;
        _authHint.Foreground = DisplayTokens.TextMuted;
        _authHint.TextWrapping = TextWrapping.Wrap;

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_authTitle);
        column.Children.Add(row);
        column.Children.Add(_authHint);

        _authPanel.Padding = new Thickness(16);
        _authPanel.Content = column;
        return _authPanel;
    }

    private static void ConfigurePanelTitle(TextBlock title)
    {
        title.FontSize = 12;
        title.FontWeight = FontWeights.SemiBold;
        title.Foreground = DisplayTokens.TextMuted;
        title.CharacterSpacing = 60;
        title.TextWrapping = TextWrapping.Wrap;
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

    /// <summary>Detach from the view-model and the owned controls (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _sendButton.Click -= OnSendClick;
        _confirmYes.Click -= OnConfirmYesClick;
        _confirmCancel.Click -= OnConfirmCancelClick;
        _bodyTextarea.TextChanged -= OnBodyChanged;
        _apiKeyBox.PasswordChanged -= OnApiKeyChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnSendClick(object sender, RoutedEventArgs e) => _viewModel.RequestSend();

    private void OnConfirmYesClick(object sender, RoutedEventArgs e) => _viewModel.RequestSend();

    private void OnConfirmCancelClick(object sender, RoutedEventArgs e) => _viewModel.Cancel();

    private void OnBodyChanged(object sender, TextChangedEventArgs e)
    {
        if (_rebuilding)
        {
            return;
        }

        _viewModel.SetBody(_bodyTextarea.Text);
    }

    private void OnApiKeyChanged(object sender, RoutedEventArgs e)
    {
        if (_rebuilding)
        {
            return;
        }

        _viewModel.SetApiKey(_apiKeyBox.Password);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (string.Equals(e.PropertyName, nameof(RequestBuilderViewModel.Endpoint), StringComparison.Ordinal))
        {
            _structureDirty = true;
        }

        ScheduleRender();
    }

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
        if (_structureDirty)
        {
            _structureDirty = false;
            RebuildStructure();
        }

        RenderChrome();
    }

    // Rebuild the user-owned input controls — the native analogue of the web endpoint-change `useEffect` that
    // reseeds `params` and `body`. Runs on construction and whenever the endpoint changes; never on a mere
    // loading / confirm / typing notification, so the operator's caret is never disturbed. The API-key field is
    // deliberately left untouched (the web effect preserves it).
    private void RebuildStructure()
    {
        RequestBuilderDisplay display = _viewModel.Display;

        _rebuilding = true;
        try
        {
            RebuildParamSection(_pathPanel, _pathFields, display.PathParams);
            RebuildParamSection(_queryPanel, _queryFields, display.QueryParams);

            if (display.Body is { } body)
            {
                _bodyTextarea.Text = body.Value;
            }
        }
        finally
        {
            _rebuilding = false;
        }
    }

    private void RebuildParamSection(TsGlassPanel panel, StackPanel host, RequestParamSectionDisplay? section)
    {
        foreach (UIElement child in host.Children)
        {
            if (child is FrameworkElement element && element.Tag is string key)
            {
                _paramRows.Remove(key);
            }
        }

        host.Children.Clear();
        panel.Visibility = section is null ? Visibility.Collapsed : Visibility.Visible;
        if (section is null)
        {
            return;
        }

        foreach (RequestParamFieldDisplay field in section.Fields)
        {
            host.Children.Add(BuildParamRow(field));
        }
    }

    private Grid BuildParamRow(RequestParamFieldDisplay field)
    {
        var label = new TextBlock
        {
            FontFamily = MonoFont(),
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var marker = new TextBlock
        {
            Text = "*",
            FontSize = 12,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(2, 0, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(marker, AccessibilityView.Raw); // "required" is in the field name

        var labelStack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Width = LabelColumnWidth,
        };
        labelStack.Children.Add(label);
        labelStack.Children.Add(marker);
        Grid.SetColumn(labelStack, 0);

        var input = new TsInput { HorizontalAlignment = HorizontalAlignment.Stretch };
        input.Text = field.Value;
        string name = field.Name;
        input.TextChanged += (_, _) =>
        {
            if (!_rebuilding)
            {
                _viewModel.SetParam(name, input.Text);
            }
        };
        Grid.SetColumn(input, 1);

        var grid = new Grid { ColumnSpacing = 12, Tag = field.Name };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.Children.Add(labelStack);
        grid.Children.Add(input);

        var row = new ParamRow(input, label, marker);
        _paramRows[field.Name] = row;
        ApplyFieldChrome(row, field);
        return grid;
    }

    // Refresh every localized label, hint, badge, URL and chrome state from the latest projection —
    // never the user-owned input *values* (param text, body text, API key), so a loading / confirm / language
    // change re-render leaves the operator's typing intact.
    private void RenderChrome()
    {
        RequestBuilderDisplay display = _viewModel.Display;

        AutomationProperties.SetName(this, display.AutomationName);

        UpdateBadge(display);

        _urlText.Text = display.UrlText;
        AutomationProperties.SetName(_urlText, display.UrlText);

        _sendButton.Text = display.SendLabel;
        _sendButton.IsLoading = display.SendDisabled;
        AutomationProperties.SetName(_sendButton, display.SendAutomationName);

        UpdateConfirm(display.Confirm);
        UpdateOptionalLine(_summaryText, display.Summary);
        UpdateOptionalLine(_descriptionText, display.Description);

        UpdateParamTitle(_pathTitle, display.PathParams);
        UpdateParamTitle(_queryTitle, display.QueryParams);
        UpdateParamChrome(display.PathParams);
        UpdateParamChrome(display.QueryParams);

        UpdateBody(display.Body);
        UpdateAuth(display.Auth);
    }

    private void UpdateBadge(RequestBuilderDisplay display)
    {
        Brush brush = DisplayTokens.Brush(display.MethodBrushKey);
        _methodBadgeText.Text = display.MethodLabel;
        _methodBadgeText.Foreground = brush;
        _methodBadge.Background = Wash(brush, BadgeFillAlpha);
    }

    private void UpdateConfirm(RequestConfirmDisplay confirm)
    {
        _confirmYes.Text = confirm.ConfirmLabel;
        _confirmCancel.Text = confirm.CancelLabel;
        _confirmText.Text = confirm.Message;
        AutomationProperties.SetName(_confirmYes, confirm.ConfirmLabel);
        AutomationProperties.SetName(_confirmCancel, confirm.CancelLabel);
        AutomationProperties.SetName(_confirmText, confirm.Message);

        if (confirm.Visible)
        {
            _confirmBanner.Visibility = Visibility.Visible;
            if (!_confirmAnnounced)
            {
                _confirmAnnounced = true;
                LiveRegion.Announce(_confirmText);
            }
        }
        else
        {
            _confirmBanner.Visibility = Visibility.Collapsed;
            _confirmAnnounced = false;
        }
    }

    private static void UpdateOptionalLine(TextBlock block, string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            block.Visibility = Visibility.Collapsed;
            block.Text = string.Empty;
        }
        else
        {
            block.Text = value;
            block.Visibility = Visibility.Visible;
        }
    }

    private static void UpdateParamTitle(TextBlock title, RequestParamSectionDisplay? section)
    {
        if (section is not null)
        {
            title.Text = section.Title;
        }
    }

    private void UpdateParamChrome(RequestParamSectionDisplay? section)
    {
        if (section is null)
        {
            return;
        }

        foreach (RequestParamFieldDisplay field in section.Fields)
        {
            if (_paramRows.TryGetValue(field.Name, out ParamRow? row))
            {
                ApplyFieldChrome(row, field);
            }
        }
    }

    private static void ApplyFieldChrome(ParamRow row, RequestParamFieldDisplay field)
    {
        row.Label.Text = field.Label;
        row.Marker.Visibility = field.ShowRequiredMarker ? Visibility.Visible : Visibility.Collapsed;
        row.Input.Hint = field.Hint;
        AutomationProperties.SetName(row.Input, field.AutomationName);
    }

    private void UpdateBody(RequestBodySectionDisplay? body)
    {
        if (body is null)
        {
            _bodyPanel.Visibility = Visibility.Collapsed;
            return;
        }

        _bodyPanel.Visibility = Visibility.Visible;
        _bodyTitle.Text = body.Title;
        _bodyContentType.Text = body.ContentType;
        _bodyContentType.Visibility = string.IsNullOrEmpty(body.ContentType) ? Visibility.Collapsed : Visibility.Visible;
        _bodyTextarea.Hint = body.Hint;
        AutomationProperties.SetName(_bodyTextarea, body.AutomationName);
    }

    private void UpdateAuth(RequestAuthSectionDisplay auth)
    {
        _authTitle.Text = auth.Title;
        _authFieldLabel.Text = auth.FieldLabel;
        _apiKeyBox.PlaceholderText = auth.Hint; // parity:allow PlaceholderText is the WinUI hint API
        _authHint.Text = auth.Hint;
        AutomationProperties.SetName(_apiKeyBox, auth.AutomationName);
    }

    private static Brush Wash(Brush brush, byte alpha)
    {
        if (brush is SolidColorBrush solid)
        {
            Color color = solid.Color;
            color.A = alpha;
            return new SolidColorBrush(color);
        }

        return brush;
    }

    private static FontFamily MonoFont() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("TsTypeFontFamilyMono", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Consolas");

    /// <summary>The persistent controls of one parameter row, kept so chrome can refresh without a rebuild.</summary>
    private sealed record ParamRow(TsInput Input, TextBlock Label, TextBlock Marker);
}
