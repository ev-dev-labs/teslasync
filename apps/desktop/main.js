// TeslaSync desktop shell (main process).
//
// Serves the bundled web UI from a stable, private app origin. A random
// loopback port would change the localStorage origin on every launch.
'use strict';

const { app, BrowserWindow, ipcMain, nativeImage, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAsset, MIME } = require('./assets');
const { HEIGHT: TITLEBAR_HEIGHT, isTitleBarTheme, isIconDataURL } = require('./titlebar');

const PROTOCOL = 'teslasync';
const APP_ORIGIN = 'teslasync-app://app';

protocol.registerSchemesAsPrivileged([{
  scheme: 'teslasync-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true },
}]);

function webRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'web', 'dist');
  return path.join(__dirname, '..', '..', 'web', 'dist');
}

async function registerAssets(root) {
  protocol.handle('teslasync-app', async (request) => {
    if (new URL(request.url).host !== 'app') return new Response(null, { status: 404 });
    const file = resolveAsset(root, request.url);
    if (file == null) return new Response(null, { status: 404 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

let win = null;
let pendingDeepLink = null;

ipcMain.on('titlebar-theme', (event, colors) => {
  if (win == null || win.isDestroyed() || event.sender !== win.webContents) return;
  if (!isTitleBarTheme(colors)) return;
  win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TITLEBAR_HEIGHT });
});

ipcMain.on('app-icon', (event, dataURL) => {
  if (win == null || win.isDestroyed() || event.sender !== win.webContents || !isIconDataURL(dataURL)) return;
  try {
    const image = nativeImage.createFromDataURL(dataURL);
    if (!image.isEmpty()) win.setIcon(image);
  } catch (error) {
    console.error('Unable to update Windows app icon:', error);
  }
});

function forwardDeepLink(url) {
  if (win != null && !win.isDestroyed()) {
    win.webContents.send('deep-link', url);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingDeepLink = url;
  }
}

function handleArgv(argv) {
  const hit = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (hit) {
    if (app.isReady() && win != null) forwardDeepLink(hit);
    else pendingDeepLink = hit;
  }
}

async function createWindow() {
  const root = webRoot();
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    // eslint-disable-next-line no-console
    console.error(`web build not found at ${root} — run 'npm run build' in web/ first.`);
    app.exit(1);
    return;
  }
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0b0d12', symbolColor: '#f4f7fb', height: TITLEBAR_HEIGHT },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.on('closed', () => {
    win = null;
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  await win.loadURL(`${APP_ORIGIN}/`);
  if (pendingDeepLink != null) {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    win.webContents.send('deep-link', url);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => handleArgv(argv));
  // macOS / Linux open-url; Windows delivers the protocol URL via argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    forwardDeepLink(url);
  });
  app.whenReady().then(async () => {
    if (app.isPackaged && process.platform === 'win32') {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
    handleArgv(process.argv);
    await registerAssets(webRoot());
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
