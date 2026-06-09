using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 JwtDecoder surface — a parity port of
/// web/src/features/admin/components/devtools/tools/JwtDecoder.tsx. It reproduces the web tool's composition:
/// a shared <see cref="ToolCard"/> (the web <c>ToolCard</c> — a tokenized glass panel with the purple key
/// badge, the localized "Jwt Decoder" title and description) wrapping a labelled multi-line
/// <see cref="TsTextarea"/> (the web <c>Textarea</c>) above the decode output. The token is decoded
/// synchronously on every edit, entirely on this device, and the surface renders one of the web's three
/// branches: the rose "Invalid Jwt" line when the token cannot be decoded (web <c>decoded.error</c>), the
/// header and payload <see cref="ResultPanel"/>s when it decodes (web <c>decoded.header</c> /
/// <c>decoded.payload</c>), or just the input field when it is empty. There is no loading / stale / offline
/// branch because the web source has none — the decode is an offline, synchronous computation. All decoding
/// and projection flow through the shared <see cref="JwtDecoderViewModel"/>; the view never performs HTTP.
/// Every string resolves through the i18n facade, the input carries a Narrator label, and the failure message
/// is announced through an assertive live region.
/// </summary>
public sealed partial class JwtDecoder : ContentControl, IDisposable
{
    private const double InputMinHeight = 84; // web rows={3}

    private readonly ILocalizer _localizer;
    private readonly JwtDecoderViewModel _viewModel;
    private readonly JwtDecoderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ToolCard _card = new();
    private readonly StackPanel _body = new() { Spacing = 0 };
    private readonly StackPanel _inputSection = new() { Spacing = 4 };
    private readonly TextBlock _inputLabel = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TsTextarea _input = new();
    private readonly TextBlock _error = new() { TextWrapping = TextWrapping.Wrap };
    private readonly ResultPanel _headerPanel;
    private readonly ResultPanel _payloadPanel;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over the i18n facade, an optional diagnostics collector and an optional initial token.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="initialJwt">An optional initial token (defaults to empty — the web resting state).</param>
    public JwtDecoder(ILocalizer localizer, JwtDecoderDiagnostics? diagnostics = null, string? initialJwt = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new JwtDecoderDiagnostics();
        _viewModel = new JwtDecoderViewModel(localizer, initialJwt);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _headerPanel = new ResultPanel(localizer);
        _payloadPanel = new ResultPanel(localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _input.TextChanged += OnInputChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>JwtDecoder</c>).</summary>
    public static string Slug => JwtDecoderRegistration.Slug;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static JwtDecoder Create(ILocalizer localizer, JwtDecoderDiagnostics? diagnostics = null) =>
        new(localizer, diagnostics);

    private void BuildChrome()
    {
        _inputLabel.FontFamily = TypographyTokens.Sans;
        _inputLabel.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _inputLabel.FontWeight = FontWeights.Medium;
        _inputLabel.Foreground = DisplayTokens.TextSecondary;

        _input.MinHeight = InputMinHeight;
        _input.AcceptsReturn = true;
        _input.TextWrapping = TextWrapping.Wrap;

        _inputSection.Children.Add(_inputLabel);
        _inputSection.Children.Add(_input);

        _error.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);
        _error.Foreground = DisplayTokens.Brush(ResultPanelProjection.DangerBrushKey);
        _error.Margin = new Thickness(0, 12, 0, 0);
        _error.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_error, assertive: true);

        _body.Children.Add(_inputSection);
        _body.Children.Add(_error);
        _body.Children.Add(_headerPanel);
        _body.Children.Add(_payloadPanel);

        _card.Body = _body;
        Content = _card;
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

    /// <summary>Detach from the view-model and the input field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _input.TextChanged -= OnInputChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _headerPanel.Dispose();
        _payloadPanel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnInputChanged(object sender, TextChangedEventArgs e) => _viewModel.UpdateText(_input.Text);

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
        JwtDecoderDisplay display = _viewModel.Display;

        _card.Title = display.Title;
        _card.Description = display.Description;
        _card.IconGlyph = display.Glyph;
        _card.Accent = display.Accent;
        AutomationProperties.SetName(this, display.RegionName);

        _inputLabel.Text = display.InputLabel;
        _input.Hint = display.InputExample;
        AutomationProperties.SetName(_input, display.InputLabel);

        _error.Text = display.ErrorMessage ?? string.Empty;
        _error.Visibility = display.HasError ? Visibility.Visible : Visibility.Collapsed;
        if (display.HasError)
        {
            AutomationProperties.SetName(_error, display.ErrorMessage);
        }

        _headerPanel.Title = display.HeaderPanel.Title;
        _headerPanel.Data = display.HeaderPanel.Data;
        _headerPanel.Visibility = display.HasHeader ? Visibility.Visible : Visibility.Collapsed;

        _payloadPanel.Title = display.PayloadPanel.Title;
        _payloadPanel.Data = display.PayloadPanel.Data;
        _payloadPanel.Visibility = display.HasPayload ? Visibility.Visible : Visibility.Collapsed;

        Announce(display.StatusAnnouncement);
    }

    private void Announce(string? message)
    {
        if (string.IsNullOrEmpty(message))
        {
            _announced = null;
            return;
        }

        if (string.Equals(_announced, message, StringComparison.Ordinal))
        {
            return;
        }

        _announced = message;
        LiveRegion.Announce(_error);
    }
}
