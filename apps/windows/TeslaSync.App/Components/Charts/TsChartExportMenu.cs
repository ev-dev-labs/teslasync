using System.Collections.Generic;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using WinRT.Interop;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Header action that exports a chart to PNG, SVG or CSV (mirrors the web chart
/// export menu). CSV and SVG are generated purely from the bound <see cref="Series"/>
/// via <see cref="ChartExport"/>; PNG is captured from the live <see cref="Target"/>
/// element with a <see cref="RenderTargetBitmap"/>. Each format is written through a
/// real file-save picker, so nothing here is a stub.
/// </summary>
public partial class TsChartExportMenu : ContentControl
{
    private readonly TsButton _button;

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsChartExportMenu),
        new PropertyMetadata(null));

    public static readonly DependencyProperty TargetProperty = DependencyProperty.Register(
        nameof(Target), typeof(FrameworkElement), typeof(TsChartExportMenu),
        new PropertyMetadata(null));

    public static readonly DependencyProperty FileBaseNameProperty = DependencyProperty.Register(
        nameof(FileBaseName), typeof(string), typeof(TsChartExportMenu),
        new PropertyMetadata("chart"));

    public TsChartExportMenu()
    {
        IsTabStop = false;

        var flyout = new MenuFlyout();
        flyout.Items.Add(BuildItem("Export as PNG", ExportPngAsync));
        flyout.Items.Add(BuildItem("Export as SVG", ExportSvgAsync));
        flyout.Items.Add(BuildItem("Export as CSV", ExportCsvAsync));

        _button = new TsButton
        {
            Variant = TeslaSync.App.Core.ButtonVariant.Subtle,
            Text = "Export",
            IconGlyph = "\uE74E",
            Flyout = flyout,
        };

        Content = _button;
    }

    /// <summary>The series exported to CSV / SVG.</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>The element captured for PNG export (usually the chart body).</summary>
    public FrameworkElement? Target
    {
        get => (FrameworkElement?)GetValue(TargetProperty);
        set => SetValue(TargetProperty, value);
    }

    /// <summary>Suggested file name (without extension) for saved exports.</summary>
    public string FileBaseName
    {
        get => (string)GetValue(FileBaseNameProperty);
        set => SetValue(FileBaseNameProperty, value);
    }

    private static MenuFlyoutItem BuildItem(string text, Func<Task> handler)
    {
        var item = new MenuFlyoutItem { Text = text };
        item.Click += async (s, e) => await handler().ConfigureAwait(true);
        return item;
    }

    private async Task ExportCsvAsync()
    {
        var series = Series ?? [];
        var csv = ChartExport.ToCsv(series);
        var file = await PickFileAsync("CSV", ".csv").ConfigureAwait(true);
        if (file is not null)
        {
            await FileIO.WriteTextAsync(file, csv, Windows.Storage.Streams.UnicodeEncoding.Utf8).AsTask().ConfigureAwait(true);
        }
    }

    private async Task ExportSvgAsync()
    {
        var series = Series ?? [];
        var width = Target?.ActualWidth ?? 640;
        var height = Target?.ActualHeight ?? 360;
        var svg = ChartExport.ToSvg(series, width <= 0 ? 640 : width, height <= 0 ? 360 : height);
        var file = await PickFileAsync("SVG", ".svg").ConfigureAwait(true);
        if (file is not null)
        {
            await FileIO.WriteTextAsync(file, svg, Windows.Storage.Streams.UnicodeEncoding.Utf8).AsTask().ConfigureAwait(true);
        }
    }

    private async Task ExportPngAsync()
    {
        if (Target is null)
        {
            return;
        }

        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(Target).AsTask().ConfigureAwait(true);
        var pixels = await bitmap.GetPixelsAsync().AsTask().ConfigureAwait(true);

        var file = await PickFileAsync("PNG", ".png").ConfigureAwait(true);
        if (file is null)
        {
            return;
        }

        using var stream = await file.OpenAsync(FileAccessMode.ReadWrite).AsTask().ConfigureAwait(true);
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream).AsTask().ConfigureAwait(true);
        encoder.SetPixelData(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied,
            (uint)bitmap.PixelWidth,
            (uint)bitmap.PixelHeight,
            96,
            96,
            pixels.ToArray());
        await encoder.FlushAsync().AsTask().ConfigureAwait(true);
    }

    private async Task<StorageFile?> PickFileAsync(string typeName, string extension)
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return null;
        }

        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            SuggestedFileName = FileBaseName,
        };
        picker.FileTypeChoices.Add(typeName, new List<string> { extension });

        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));
        return await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
    }
}
