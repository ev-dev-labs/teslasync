using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Foundation.Collections;
using Windows.Graphics;
using Windows.Storage;

namespace TeslaSync.App.Shell;

/// <summary>
/// Persists and restores the shell window's size, position and theme across launches
/// using the packaged app's <see cref="ApplicationData.LocalSettings"/>. Every access
/// is defensive: in unpackaged or first-run contexts the settings store may be
/// unavailable, in which case persistence is silently skipped and the window keeps
/// its default geometry.
/// </summary>
internal sealed class WindowStateService
{
    private const string KeyX = "shell.window.x";
    private const string KeyY = "shell.window.y";
    private const string KeyWidth = "shell.window.width";
    private const string KeyHeight = "shell.window.height";
    private const string KeyTheme = "shell.window.theme";

    /// <summary>Minimum width the shell window may be resized to.</summary>
    public int MinWidth { get; } = 1024;

    /// <summary>Minimum height the shell window may be resized to.</summary>
    public int MinHeight { get; } = 640;

    private static IPropertySet? Values
    {
        get
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Apply the persisted geometry to <paramref name="appWindow"/>, or center a
    /// default-sized window when no valid state is stored. Returns the restored theme.
    /// </summary>
    public ElementTheme Restore(AppWindow appWindow)
    {
        ArgumentNullException.ThrowIfNull(appWindow);

        var values = Values;
        if (values is not null
            && values.TryGetValue(KeyWidth, out var wObj) && wObj is int w
            && values.TryGetValue(KeyHeight, out var hObj) && hObj is int h)
        {
            int width = Math.Max(w, MinWidth);
            int height = Math.Max(h, MinHeight);

            if (values.TryGetValue(KeyX, out var xObj) && xObj is int x
                && values.TryGetValue(KeyY, out var yObj) && yObj is int y)
            {
                appWindow.MoveAndResize(new RectInt32(x, y, width, height));
            }
            else
            {
                appWindow.Resize(new SizeInt32(width, height));
            }
        }
        else
        {
            appWindow.Resize(new SizeInt32(1280, 800));
        }

        return ReadTheme(values);
    }

    /// <summary>Persist the current geometry and <paramref name="theme"/> of the window.</summary>
    public void Save(AppWindow appWindow, ElementTheme theme)
    {
        ArgumentNullException.ThrowIfNull(appWindow);

        var values = Values;
        if (values is null)
        {
            return;
        }

        try
        {
            var pos = appWindow.Position;
            var size = appWindow.Size;
            values[KeyX] = pos.X;
            values[KeyY] = pos.Y;
            values[KeyWidth] = Math.Max(size.Width, MinWidth);
            values[KeyHeight] = Math.Max(size.Height, MinHeight);
            values[KeyTheme] = (int)theme;
        }
        catch (Exception)
        {
            // Non-fatal: a transient settings-store failure must not crash teardown.
        }
    }

    private static ElementTheme ReadTheme(IPropertySet? values)
    {
        if (values is not null && values.TryGetValue(KeyTheme, out var tObj) && tObj is int t
            && Enum.IsDefined(typeof(ElementTheme), t))
        {
            return (ElementTheme)t;
        }

        return ElementTheme.Default;
    }
}
