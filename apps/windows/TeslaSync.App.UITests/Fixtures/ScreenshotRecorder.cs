using TeslaSync.App.UITests.Drivers;

namespace TeslaSync.App.UITests.Fixtures;

/// <summary>
/// Persists failure artifacts under <c>apps/windows/TeslaSync.App.UITests/artifacts</c>: a PNG
/// screenshot of the app window and the UIA source tree at the moment a test failed, plus an appended
/// run log. These are the artifacts the W9-0002 acceptance criteria require so a CI failure is
/// diagnosable after the fact.
/// </summary>
public sealed class ScreenshotRecorder
{
    private readonly string _directory;
    private readonly object _sync = new();

    /// <summary>Create a recorder writing to <paramref name="directory"/> (created on demand).</summary>
    public ScreenshotRecorder(string directory)
    {
        _directory = directory;
        System.IO.Directory.CreateDirectory(_directory);
    }

    /// <summary>The directory failure artifacts are written to.</summary>
    public string Directory => _directory;

    /// <summary>Capture a screenshot + UIA tree for a failed test and append a log line.</summary>
    public async Task CaptureAsync(WinAppDriverClient client, string testName, Exception failure, CancellationToken cancellationToken = default)
    {
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff");
        var safeName = Sanitize(testName);
        var basePath = Path.Combine(_directory, $"{stamp}-{safeName}");

        try
        {
            var png = await client.CaptureScreenshotAsync(cancellationToken).ConfigureAwait(false);
            if (png.Length > 0)
            {
                await File.WriteAllBytesAsync(basePath + ".png", png, cancellationToken).ConfigureAwait(false);
            }

            var source = await client.GetPageSourceAsync(cancellationToken).ConfigureAwait(false);
            if (source.Length > 0)
            {
                await File.WriteAllTextAsync(basePath + ".uia.xml", source, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (WinAppDriverException)
        {
            // The driver may already be down; the log line below still records the failure.
        }

        Log($"FAIL {testName}: {failure.GetType().Name}: {failure.Message}");
    }

    /// <summary>Append a single line to the run log.</summary>
    public void Log(string line)
    {
        lock (_sync)
        {
            File.AppendAllText(
                Path.Combine(_directory, "ui-automation-run.log"),
                $"{DateTime.UtcNow:O} {line}{System.Environment.NewLine}");
        }
    }

    private static string Sanitize(string value)
    {
        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            value = value.Replace(invalid, '_');
        }

        return value.Length <= 80 ? value : value[..80];
    }
}
