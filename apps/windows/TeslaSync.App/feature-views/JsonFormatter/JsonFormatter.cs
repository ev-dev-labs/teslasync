using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 JsonFormatter surface — a parity port of
/// web/src/features/admin/components/devtools/tools/JsonFormatter.tsx. It reproduces the web tool: a
/// <see cref="ToolCard"/> (the shared devtools card — a tokenized glass panel with a green-accent "Braces"
/// glyph, the localized title and description) wrapping a labelled multi-line editor (the web
/// <see cref="TsTextarea"/>) above a mutually-exclusive output region rebuilt on every keystroke in the same
/// precedence as the web <c>useMemo</c>: nothing while the editor is blank (web <c>!inputVal.trim()</c>), the
/// parser message as danger text when it fails to parse (web <c>{result.error}</c>), or the two-space-indented
/// JSON in a token-tinted inset — with the shared <see cref="TsCopyButton"/> — when it parses (web
/// <c>{result.formatted}</c>). All transform logic and every label flow through the shared
/// <see cref="JsonFormatterViewModel"/>; the view never performs HTTP (its only web dependency is
/// <c>useTranslation</c>). The editor is built once so typing is never interrupted by a re-render; only the
/// output region is rebuilt. Every owned string resolves through the i18n facade, the editor and copy button
/// carry Narrator names, and the output is announced through a live region (assertive on a parse error) so the
/// surface is accessible by construction.
/// </summary>
public sealed partial class JsonFormatter : ContentControl, IDisposable
{
    private const string IconGlyph = "\uE8A5"; // Segoe Fluent "Document" — the web Braces glyph (matches the devtools registry)
    private const string Accent = "green";     // web color="green"
    private const double EditorMinHeight = 96; // web rows={4}

    private readonly JsonFormatterViewModel _viewModel;
    private readonly JsonFormatterDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ToolCard _card;
    private readonly TsTextarea _editor = new();
    private readonly Border _outputHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announcedName;

    /// <summary>Creates the surface over the i18n facade and an optional diagnostics collector (a blank editor).</summary>
    /// <param name="localizer">The i18n facade resolving every owned label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public JsonFormatter(ILocalizer localizer, JsonFormatterDiagnostics? diagnostics = null)
        : this(StaticJsonFormatterSource.Blank(), localizer, diagnostics)
    {
    }

    /// <summary>Creates the surface over its seed seam, the i18n facade and an optional diagnostics collector.</summary>
    /// <param name="source">The seed seam (the initial editor value).</param>
    /// <param name="localizer">The i18n facade resolving every owned label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public JsonFormatter(IJsonFormatterSource source, ILocalizer localizer, JsonFormatterDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new JsonFormatterDiagnostics();
        _viewModel = new JsonFormatterViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _card = new ToolCard
        {
            IconGlyph = IconGlyph,
            Accent = Accent,
            Title = _viewModel.Title,
            Description = _viewModel.Description,
            Body = BuildBody(),
        };
        Content = _card;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>JsonFormatter</c>).</summary>
    public static string Slug => JsonFormatterRegistration.Slug;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every owned label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static JsonFormatter Create(ILocalizer localizer, JsonFormatterDiagnostics? diagnostics = null) =>
        new(localizer, diagnostics);

    private StackPanel BuildBody()
    {
        var inputLabel = new TextBlock
        {
            Text = _viewModel.InputLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        _editor.Hint = JsonFormatterProjection.InputExample;
        _editor.Text = _viewModel.Text; // seed before wiring the handler so seeding raises no change
        _editor.MinHeight = EditorMinHeight;
        _editor.TextWrapping = TextWrapping.Wrap;
        AutomationProperties.SetName(_editor, _viewModel.InputLabel);
        _editor.TextChanged += OnEditorTextChanged;

        var inputStack = new StackPanel { Spacing = 4 };
        inputStack.Children.Add(inputLabel);
        inputStack.Children.Add(_editor);

        _outputHost.HorizontalAlignment = HorizontalAlignment.Stretch;

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(inputStack);
        body.Children.Add(_outputHost);
        return body;
    }

    private void OnEditorTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.SetText(_editor.Text);

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

    /// <summary>Detach from the view-model and the editor (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _editor.TextChanged -= OnEditorTextChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(JsonFormatterViewModel.Display))
        {
            ScheduleRender();
        }
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
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;

        if (display.IsEmpty)
        {
            _outputHost.Child = null;
            _outputHost.Visibility = Visibility.Collapsed;
            AutomationProperties.SetName(_outputHost, string.Empty);
            _announcedName = null;
            return;
        }

        _outputHost.Child = display.HasError ? BuildError(display) : BuildFormatted(display);
        _outputHost.Visibility = Visibility.Visible;

        LiveRegion.Configure(_outputHost, assertive: display.HasError);
        AutomationProperties.SetName(_outputHost, display.OutputName);
        if (!string.Equals(_announcedName, display.OutputName, StringComparison.Ordinal))
        {
            _announcedName = display.OutputName;
            LiveRegion.Announce(_outputHost);
        }
    }

    private static TextBlock BuildError(JsonFormatterDisplay display) => new()
    {
        Text = display.ErrorMessage,
        FontSize = 14, // web text-sm
        Foreground = DisplayTokens.Brush(JsonFormatterProjection.ErrorBrushKey),
        TextWrapping = TextWrapping.Wrap,
    };

    private Border BuildFormatted(JsonFormatterDisplay display)
    {
        var label = new TextBlock
        {
            Text = _viewModel.FormattedLabel,
            FontSize = 12, // web text-xs
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var copy = new TsCopyButton
        {
            Size = ControlSize.Small,
            ValueToCopy = display.FormattedText,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Text = _viewModel.CopyLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(copy, _viewModel.CopyLabel);

        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(copy, 1);
        header.Children.Add(label);
        header.Children.Add(copy);

        // The web <pre>: a preformatted, selectable monospace block — preserve the JSON layout and let long
        // lines scroll horizontally rather than wrap.
        var pre = new TextBlock
        {
            Text = display.FormattedText,
            FontFamily = TypographyTokens.Mono,
            FontSize = 12, // web text-xs
            Foreground = DisplayTokens.Brush(JsonFormatterProjection.FormattedBrushKey),
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };

        var scroller = new ScrollViewer
        {
            Content = pre,
            MaxHeight = 256, // web max-h-64
            Margin = new Thickness(0, 4, 0, 0), // web mt-1
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
        };

        var column = new StackPanel();
        column.Children.Add(header);
        column.Children.Add(scroller);

        return new Border
        {
            Background = DisplayTokens.Brush(JsonFormatterProjection.OverlayBrushKey),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(12), // web p-3
            Child = column,
        };
    }
}
