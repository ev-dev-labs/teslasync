using System.Diagnostics;

namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// Locates and (when present) launches the WinAppDriver.exe service so the UI suite can run without a
/// separately started runner. WinAppDriver ships as a standalone Windows service/exe; this wrapper
/// finds it at the two standard install locations or on PATH, starts it bound to the requested port,
/// and stops it on dispose. When the executable is absent it reports <see cref="Found"/> = false and
/// the caller surfaces an explicit BLOCKED reason rather than pretending the runner exists.
/// </summary>
public sealed class WinAppDriverProcess : IDisposable
{
    private static readonly string[] StandardPaths =
    [
        @"C:\Program Files\Windows Application Driver\WinAppDriver.exe",
        @"C:\Program Files (x86)\Windows Application Driver\WinAppDriver.exe",
    ];

    private readonly string _exePath;
    private Process? _process;

    private WinAppDriverProcess(string exePath) => _exePath = exePath;

    /// <summary>The resolved WinAppDriver.exe path, or empty when none was found.</summary>
    public string ExecutablePath => _exePath;

    /// <summary>True when a WinAppDriver.exe was located on this machine.</summary>
    public bool Found => _exePath.Length > 0;

    /// <summary>Locate WinAppDriver.exe at its standard install paths or on PATH.</summary>
    public static WinAppDriverProcess Locate()
    {
        foreach (var candidate in StandardPaths)
        {
            if (File.Exists(candidate))
            {
                return new WinAppDriverProcess(candidate);
            }
        }

        var onPath = ProbePath();
        return new WinAppDriverProcess(onPath ?? string.Empty);
    }

    /// <summary>
    /// Start WinAppDriver listening on <paramref name="host"/>:<paramref name="port"/>. No-op (returns
    /// false) when the executable was not found; throws when it was found but could not start.
    /// </summary>
    public bool Start(string host, int port)
    {
        if (!Found)
        {
            return false;
        }

        if (_process is { HasExited: false })
        {
            return true;
        }

        var info = new ProcessStartInfo(_exePath)
        {
            Arguments = $"{host} {port}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        _process = Process.Start(info)
            ?? throw new WinAppDriverException($"Failed to start WinAppDriver from '{_exePath}'.");
        return true;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(5000);
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // The driver may already be gone; teardown is best-effort.
        }
        finally
        {
            _process?.Dispose();
            _process = null;
        }
    }

    private static string? ProbePath()
    {
        var pathVar = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(dir.Trim(), "WinAppDriver.exe");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            catch (ArgumentException)
            {
                // Ignore malformed PATH entries.
            }
        }

        return null;
    }
}
