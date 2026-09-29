// Preload: the only bridge between the page and the shell. Exposes the
// shell marker (drives the server-picker gate) and deep-link delivery.
// Runs before page scripts; contextIsolation keeps page JS out of
// Node/Electron APIs.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__TESLASYNC_SHELL__', 'electron');

ipcRenderer.on('deep-link', (_event, url) => {
  window.dispatchEvent(new CustomEvent('teslasync:deep-link', { detail: url }));
});

if (process.platform === 'win32') {
  window.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    root.dataset.teslasyncDesktop = 'true';
    const bar = document.createElement('div');
    bar.className = 'teslasync-desktop-titlebar';
    bar.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('img');
    icon.src = '/favicon.svg';
    icon.alt = '';
    bar.append(icon);
    const caption = document.createElement('span');
    bar.append(caption);
    document.body.prepend(bar);

    let lastIconHref;
    const syncChrome = () => {
      caption.textContent = document.title || 'TeslaSync';
      const href = document.querySelector('link[rel="icon"]')?.href;
      if (!href || href === lastIconHref) return;
      lastIconHref = href;
      icon.src = href;
      const image = new Image();
      image.onload = () => {
        if (href !== lastIconHref) return;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 64, 64);
        ipcRenderer.send('app-icon', canvas.toDataURL('image/png'));
      };
      image.onerror = () => console.error('Unable to load app icon:', href.slice(0, 80));
      image.src = href;
    };
    new MutationObserver(syncChrome).observe(document.head, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'],
    });
    syncChrome();

    let scheduled = false;
    const syncTheme = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const style = getComputedStyle(root);
        ipcRenderer.send('titlebar-theme', {
          color: style.getPropertyValue('--bg-app').trim(),
          symbolColor: style.getPropertyValue('--text-primary').trim(),
        });
      });
    };
    new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    syncTheme();
  });
}
