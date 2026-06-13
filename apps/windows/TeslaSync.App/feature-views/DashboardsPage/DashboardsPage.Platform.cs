using Windows.ApplicationModel.DataTransfer;
using Windows.Foundation.Collections;
using Windows.Storage;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// The <see cref="IDashboardDraftStore"/> backed by the packaged app's
/// <see cref="ApplicationData.LocalSettings"/> — the native analogue of the web page's <c>localStorage</c>
/// persistence (web/src/features/power-user/pages/DashboardsPage.tsx). Every access is defensive in exactly the
/// way the web wraps <c>localStorage</c> in a <c>try/catch</c>: in unpackaged or first-run contexts the settings
/// store may be unavailable, in which case the seed resolves to empty and a save is silently skipped (web
/// parity — a quota or access failure is swallowed). WinUI-only, so it lives in the platform partial outside the
/// headless test host.
/// </summary>
public sealed class LocalSettingsDashboardDraftStore : IDashboardDraftStore
{
    /// <summary>The settings key the draft persists under (the web <c>localStorage</c> key, verbatim).</summary>
    public const string DraftKey = "ai.dashboardComposer.draft";

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

    /// <inheritdoc />
    public string Load()
    {
        var values = Values;
        if (values is not null && values.TryGetValue(DraftKey, out var value) && value is string draft)
        {
            return draft;
        }

        return string.Empty;
    }

    /// <inheritdoc />
    public void Save(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var values = Values;
        if (values is null)
        {
            return;
        }

        try
        {
            if (string.IsNullOrEmpty(value))
            {
                values.Remove(DraftKey);
            }
            else
            {
                values[DraftKey] = value;
            }
        }
        catch (Exception)
        {
            // Non-fatal: a transient settings-store failure must not crash editing (web swallows the same).
        }
    }
}

/// <summary>
/// The <see cref="IDashboardClipboard"/> backed by the WinUI <see cref="Clipboard"/> — the native analogue of the
/// web <c>navigator.clipboard</c>. A packaged WinUI app always has clipboard access, so
/// <see cref="IsAvailable"/> is <see langword="true"/>; a write that the shell rejects (e.g. the clipboard is
/// momentarily locked by another process) throws, which the view-model maps to the <c>copyFailed</c> branch.
/// WinUI-only, so it lives in the platform partial outside the headless test host.
/// </summary>
public sealed class WindowsDashboardClipboard : IDashboardClipboard
{
    /// <inheritdoc />
    public bool IsAvailable => true;

    /// <inheritdoc />
    public Task WriteTextAsync(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
        package.SetText(text);
        Clipboard.SetContent(package);
        return Task.CompletedTask;
    }
}
