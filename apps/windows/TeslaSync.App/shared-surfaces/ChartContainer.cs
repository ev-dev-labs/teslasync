using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ChartContainerSurface;

/// <summary>
/// The native WinUI 3 <c>ChartContainer</c> shared surface — a parity port of
/// web/src/components/charts/ChartContainer.tsx in its cross-feature role as the framing chrome every chart is
/// wrapped in. It composes the web <c>&lt;figure&gt;</c> from the shared primitives: a tokenized
/// <see cref="TsGlassPanel"/> with a title / subtitle, the title-bar action toolbar (a caller action slot, the
/// annotation add + hide/show toggles, the export menu, and an optional fullscreen toggle), the mobile annotation
/// marker chips, a fixed-height body that renders every state the web does (a centred <see cref="TsSpinner"/> while
/// loading, the friendly <see cref="TsEmptyState"/> when empty, and the chart inside a
/// <see cref="TsSectionErrorBoundary"/> when ready), the screen-reader / forced-colors accessible figcaption
/// fallback (a visually-hidden <see cref="TsVisuallyHidden"/> carrying the long description, the same data the chart
/// shows as a readable table, or the bare summary), the annotation list footer, and the add-annotation popover.
/// When the surface opts into annotations it owns the full flow — fetch, add, delete, and the persisted hide toggle
/// — entirely through the shared <see cref="ChartContainerViewModel"/> and its <see cref="IChartAnnotationSource"/>
/// / <see cref="IAnnotationHiddenStore"/> seams; the view never performs HTTP. Every string resolves through the
/// i18n facade, every interactive element carries a Narrator name, and the surface emits the <c>view.opened</c>
/// diagnostic once when it is shown.
/// </summary>
public sealed partial class ChartContainer : ContentControl, IDisposable
{
    private readonly ChartContainerViewModel _viewModel;
    private readonly ChartContainerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 0 };
    private readonly Grid _bodyHost = new();

    private object? _body;
    private object? _action;
    private AppWindow? _appWindow;
    private bool _opened;
    private bool _annotationsRequested;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its annotation source, hidden-toggle store, localizer, options and diagnostics.</summary>
    /// <param name="annotationSource">The durable annotation data seam (web annotation hooks); never opened by the view.</param>
    /// <param name="hiddenStore">The persisted hide-toggle store (web localStorage helpers).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="options">The immutable composition inputs (web props other than the chart body).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public ChartContainer(
        IChartAnnotationSource annotationSource,
        IAnnotationHiddenStore hiddenStore,
        ILocalizer localizer,
        ChartContainerOptions options,
        ChartContainerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(annotationSource);
        ArgumentNullException.ThrowIfNull(hiddenStore);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(options);

        _viewModel = new ChartContainerViewModel(annotationSource, hiddenStore, localizer, options);
        _diagnostics = diagnostics ?? new ChartContainerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, ChartContainerRegistration.RootAutomationId);

        // web figure: role="img" aria-label={ariaLabel} — the accessible name a focus-stop on the chart re-states.
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChartContainer</c>).</summary>
    public static string Slug => ChartContainerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ChartContainerViewModel ViewModel => _viewModel;

    /// <summary>
    /// The chart control rendered in the ready body (web <c>children</c>). Setting it rebuilds the body so the
    /// chart appears once the host has wired it.
    /// </summary>
    public object? Body
    {
        get => _body;
        set
        {
            _body = value;
            ScheduleRender();
        }
    }

    /// <summary>The optional caller-supplied header action element rendered first in the toolbar (web <c>action</c>).</summary>
    public object? Action
    {
        get => _action;
        set
        {
            _action = value;
            ScheduleRender();
        }
    }

    /// <summary>
    /// The window the optional fullscreen toggle drives (web <c>FullscreenButton</c> targets the figure element;
    /// the native fullscreen presenter operates on a window). When null the fullscreen toggle is still shown but
    /// inert, matching a figure with no fullscreen-capable ancestor.
    /// </summary>
    public AppWindow? AppWindow
    {
        get => _appWindow;
        set
        {
            _appWindow = value;
            ScheduleRender();
        }
    }

    /// <summary>
    /// Convenience factory wiring the repository-backed <see cref="HttpClientChartAnnotationSource"/> from the
    /// shared HTTP layer plus a durable, settings-backed hide-toggle store, so the host composes the surface with
    /// just its client, API options and token provider.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="containerOptions">The chart composition inputs.</param>
    /// <param name="hiddenStore">An explicit hide-toggle store, or null to use the durable local-settings store.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static ChartContainer Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        ILocalizer localizer,
        ChartContainerOptions containerOptions,
        IAnnotationHiddenStore? hiddenStore = null,
        ChartContainerDiagnostics? diagnostics = null)
    {
        var source = new HttpClientChartAnnotationSource(http, options, tokenProvider);
        return new ChartContainer(
            source,
            hiddenStore ?? new LocalSettingsAnnotationHiddenStore(),
            localizer,
            containerOptions,
            diagnostics);
    }

    /// <summary>Detach from the view-model and cancel any in-flight annotation fetch (idempotent).</summary>
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

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once when shown.
            _diagnostics.RecordViewOpened();
        }

        // web: the annotation query runs when the chart with an annotations config mounts. Kick it off once on
        // load; results flow back through the view-model's change notifications and are marshalled below.
        if (!_annotationsRequested && _viewModel.AnnotationsEnabled)
        {
            _annotationsRequested = true;
            _ = _viewModel.LoadAnnotationsAsync();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;

        // An annotation fetch settles on a background continuation; rebuild on the UI thread.
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
        _root.Children.Clear();
        AutomationProperties.SetName(this, _viewModel.AriaLabel);
        _root.Children.Add(BuildFigure());
    }

    private TsGlassPanel BuildFigure()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildHeader());

        if (_viewModel.ShowMarkerRow)
        {
            column.Children.Add(BuildMarkerRow());
        }

        column.Children.Add(BuildBody());
        column.Children.Add(BuildAccessibleFallback());

        if (_viewModel.AnnotationListVisible)
        {
            column.Children.Add(BuildAnnotationList());
        }

        return new TsGlassPanel { Padding = new Thickness(16), Content = column };
    }

    private Grid BuildHeader()
    {
        var titles = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        titles.Children.Add(new PanelTitle { Value = _viewModel.Title });
        if (!string.IsNullOrEmpty(_viewModel.Subtitle))
        {
            titles.Children.Add(new Caption { Value = _viewModel.Subtitle! });
        }

        var grid = new Grid { ColumnSpacing = 12, Margin = new Thickness(0, 0, 0, 4) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(titles, 0);
        var toolbar = BuildToolbar();
        Grid.SetColumn(toolbar, 1);

        grid.Children.Add(titles);
        grid.Children.Add(toolbar);
        return grid;
    }

    private StackPanel BuildToolbar()
    {
        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
        };

        if (_action is FrameworkElement actionElement)
        {
            toolbar.Children.Add(actionElement);
        }

        if (_viewModel.AnnotationsEnabled)
        {
            toolbar.Children.Add(BuildAddAnnotationButton());
            toolbar.Children.Add(BuildToggleAnnotationsButton());
        }

        if (_viewModel.ShowExportMenu)
        {
            toolbar.Children.Add(BuildExportMenu());
        }

        if (_viewModel.ShowFullscreen)
        {
            toolbar.Children.Add(new TsFullscreenButton
            {
                Size = ControlSize.Small,
                AppWindow = _appWindow,
            });
        }

        return toolbar;
    }

    private TsButton BuildAddAnnotationButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = "\uE710", // Add
        };
        AutomationProperties.SetName(button, _viewModel.Display.AddAnnotation);
        ToolTipService.SetToolTip(button, _viewModel.Display.AddAnnotation);

        var flyout = BuildAddAnnotationFlyout();
        flyout.Opening += (_, _) => _viewModel.OpenPopover();
        flyout.Closed += (_, _) => _viewModel.ClosePopover();
        button.Flyout = flyout;
        return button;
    }

    private TsButton BuildToggleAnnotationsButton()
    {
        bool hidden = _viewModel.Hidden;
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = hidden ? "\uED1A" : "\uE7B3", // Hide : RedEye (view)
        };
        AutomationProperties.SetName(button, _viewModel.ToggleAnnotationsLabel);
        ToolTipService.SetToolTip(button, _viewModel.ToggleAnnotationsLabel);
        button.Click += (_, _) => _viewModel.ToggleHidden();
        return button;
    }

    private TsChartExportMenu BuildExportMenu() => new()
    {
        Target = _bodyHost,
        FileBaseName = _viewModel.ExportFileName,
    };

    private Grid BuildMarkerRow()
    {
        var row = new Grid();
        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (ChartDataAnnotation annotation in _viewModel.VisibleAnnotations)
        {
            chips.Children.Add(BuildMarkerChip(annotation));
        }

        row.Children.Add(chips);
        AutomationProperties.SetName(row, _viewModel.Display.MarkerRow);
        return row;
    }

    private static Border BuildMarkerChip(ChartDataAnnotation annotation)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var tag = new FontIcon { Glyph = "\uE8EC", FontSize = 10, Foreground = DisplayTokens.TextMuted }; // Tag
        AutomationProperties.SetAccessibilityView(tag, AccessibilityView.Raw);
        content.Children.Add(tag);
        content.Children.Add(new Caption { Value = annotation.Label });

        var chip = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusPillRadius", 999),
            Padding = new Thickness(8, 2, 8, 2),
            Child = content,
        };

        // web chip: title={ann.description ?? ann.label}.
        ToolTipService.SetToolTip(chip, string.IsNullOrEmpty(annotation.Description) ? annotation.Label : annotation.Description!);
        AutomationProperties.SetName(chip, annotation.Label);
        return chip;
    }

    private Grid BuildBody()
    {
        _bodyHost.Children.Clear();
        _bodyHost.MinHeight = _viewModel.Height;

        FrameworkElement body = _viewModel.BodyState switch
        {
            ChartBodyState.Loading => BuildLoadingBody(),
            ChartBodyState.Empty => BuildEmptyBody(),
            _ => BuildReadyBody(),
        };

        _bodyHost.Children.Add(body);
        return _bodyHost;
    }

    private static TsSpinner BuildLoadingBody() => new()
    {
        Size = ControlSize.Medium,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsEmptyState BuildEmptyBody() => new()
    {
        // web: <EmptyState message={t('chart.noData')} /> — no action: a chart can't recover without data.
        Message = _viewModel.Display.NoData,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsSectionErrorBoundary BuildReadyBody()
    {
        var boundary = new TsSectionErrorBoundary
        {
            FallbackTitle = _viewModel.Display.ChartFailed,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
        };

        // web role="img" aria-label on the chart body wrapper — re-states the figure summary on a focus stop.
        AutomationProperties.SetName(boundary, _viewModel.AriaLabel);

        if (_body is UIElement element)
        {
            boundary.ProtectedContent = element;
        }

        return boundary;
    }

    private TsVisuallyHidden BuildAccessibleFallback() => new() { Text = ComposeAccessibleFallback() };

    private string ComposeAccessibleFallback()
    {
        // web figcaption: the prose description (when set) PLUS either the data table or the bare summary, all
        // visually hidden but exposed to assistive technology. The native fallback carries the same content as
        // readable text so Narrator hears the description and the same data the chart shows.
        var parts = new List<string>(2);

        if (_viewModel.ShowFallbackDescription && _viewModel.AriaDescription is { } description)
        {
            parts.Add(description);
        }

        if (_viewModel.HasFallbackTable)
        {
            parts.Add(ComposeFallbackTableText());
        }
        else if (_viewModel.ShowFallbackSummary)
        {
            parts.Add(_viewModel.AccessibleSummary());
        }

        return string.Join(". ", parts);
    }

    private string ComposeFallbackTableText()
    {
        IReadOnlyList<ChartDataColumn> columns = _viewModel.DataColumns;
        IReadOnlyList<ChartDataRow> rows = _viewModel.Data;

        var builder = new System.Text.StringBuilder();
        builder.Append(_viewModel.FallbackTableLabel());

        foreach (ChartDataRow row in rows)
        {
            builder.Append("; ");
            for (int i = 0; i < columns.Count; i++)
            {
                if (i > 0)
                {
                    builder.Append(", ");
                }

                ChartDataColumn column = columns[i];
                builder.Append(column.Label);
                builder.Append(' ');
                builder.Append(ChartFallbackTable.FormatCell(column, row));
            }
        }

        return builder.ToString();
    }

    private StackPanel BuildAnnotationList()
    {
        var list = new StackPanel { Spacing = 4, Margin = new Thickness(0, 8, 0, 0) };
        foreach (ChartDataAnnotation annotation in _viewModel.FetchedAnnotations)
        {
            list.Children.Add(BuildAnnotationRow(annotation));
        }

        return list;
    }

    private Grid BuildAnnotationRow(ChartDataAnnotation annotation)
    {
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Text { Value = annotation.Label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);
        row.Children.Add(label);

        var remove = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = "\uE74D", // Delete
        };
        AutomationProperties.SetName(remove, annotation.Label);
        ToolTipService.SetToolTip(remove, annotation.Label);
        string id = annotation.Id;
        remove.Click += (_, _) => _ = _viewModel.RemoveAnnotationAsync(id);
        Grid.SetColumn(remove, 1);
        row.Children.Add(remove);

        return row;
    }

    private Flyout BuildAddAnnotationFlyout()
    {
        var labelInput = new TsInput { MinWidth = 240 };
        AutomationProperties.SetName(labelInput, _viewModel.Display.AddAnnotation);

        var categorySelect = new TsSelect { MinWidth = 240 };
        foreach (AnnotationCategory category in Enum.GetValues<AnnotationCategory>())
        {
            categorySelect.Items.Add(category);
        }

        categorySelect.SelectedIndex = 0;
        AutomationProperties.SetName(categorySelect, _viewModel.Display.AddAnnotation);

        var dateLabel = new Caption { Value = _viewModel.Display.DateLabel };
        var dateInput = new TsInput { MinWidth = 240 };
        AutomationProperties.SetName(dateInput, _viewModel.Display.DateLabel);

        var descriptionInput = new TsTextarea { MinWidth = 240, MinHeight = 64 };
        AutomationProperties.SetName(descriptionInput, _viewModel.Display.AddAnnotation);

        var confirm = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            Text = _viewModel.Display.AddAnnotation,
        };
        var cancel = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.Display.CancelLabel,
        };

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(cancel);
        buttons.Children.Add(confirm);

        var form = new StackPanel { Spacing = 8, MinWidth = 260 };
        form.Children.Add(new PanelTitle { Value = _viewModel.Display.AddAnnotation });
        form.Children.Add(labelInput);
        form.Children.Add(categorySelect);
        form.Children.Add(dateLabel);
        form.Children.Add(dateInput);
        form.Children.Add(descriptionInput);
        form.Children.Add(buttons);

        var flyout = new Flyout { Content = form };

        // web AddAnnotationPopover: timestamp defaults to new Date().toISOString(); editableDate lets the user adjust it.
        flyout.Opening += (_, _) => dateInput.Text = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture);

        confirm.Click += (_, _) =>
        {
            AnnotationCategory category = categorySelect.SelectedItem is AnnotationCategory selected
                ? selected
                : AnnotationCategory.Custom;
            string? description = string.IsNullOrWhiteSpace(descriptionInput.Text) ? null : descriptionInput.Text;
            _ = _viewModel.AddAnnotationAsync(labelInput.Text, category, description, dateInput.Text);
            flyout.Hide();
        };
        cancel.Click += (_, _) => flyout.Hide();

        return flyout;
    }
}

/// <summary>
/// A durable <see cref="IAnnotationHiddenStore"/> backed by the packaged app's
/// <c>ApplicationData.LocalSettings</c> — the native analogue of the web localStorage the ChartContainer hide
/// toggle persists to (web <c>readHiddenPref</c> / <c>writeHiddenPref</c>). Best-effort by contract: an
/// unpackaged / identity-less host (where <c>ApplicationData.Current</c> throws) degrades to a non-throwing
/// in-memory map, exactly as the web helpers silently degrade when localStorage is unavailable.
/// </summary>
public sealed class LocalSettingsAnnotationHiddenStore : IAnnotationHiddenStore
{
    private readonly InMemoryAnnotationHiddenStore _fallback = new();
    private readonly Windows.Storage.ApplicationDataContainer? _settings;

    /// <summary>Creates the store, resolving the local-settings container when running packaged.</summary>
    public LocalSettingsAnnotationHiddenStore()
    {
        try
        {
            _settings = Windows.Storage.ApplicationData.Current.LocalSettings;
        }
        catch (InvalidOperationException)
        {
            // Unpackaged / no app identity: ApplicationData.Current is unavailable — fall back to the in-memory map.
            _settings = null;
        }
    }

    /// <inheritdoc />
    public bool IsHidden(string annotationKey)
    {
        if (_settings is null)
        {
            return _fallback.IsHidden(annotationKey);
        }

        string key = HiddenPreference.StorageKey(annotationKey);
        return _settings.Values.TryGetValue(key, out object? value) && value is bool flag && flag;
    }

    /// <inheritdoc />
    public void SetHidden(string annotationKey, bool hidden)
    {
        if (_settings is null)
        {
            _fallback.SetHidden(annotationKey, hidden);
            return;
        }

        string key = HiddenPreference.StorageKey(annotationKey);
        if (hidden)
        {
            _settings.Values[key] = true;
        }
        else
        {
            _settings.Values.Remove(key);
        }
    }
}
