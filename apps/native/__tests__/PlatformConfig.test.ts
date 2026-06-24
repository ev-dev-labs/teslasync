export {};

declare const __dirname: string;
declare function require(name: 'fs'): {
  readFileSync(filePath: string, encoding: string): string;
};
declare function require(name: 'path'): {
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
};

const fs = require('fs');
const path = require('path');

const nativeRoot = path.resolve(__dirname, '..');

function readNativeFile(...segments: string[]): string {
  return fs.readFileSync(path.join(nativeRoot, ...segments), 'utf8');
}

describe('native platform notification and deep-link config', () => {
  test('Android declares notification permission and teslasync deep-link intent', () => {
    const manifest = readNativeFile(
      'android',
      'app',
      'src',
      'main',
      'AndroidManifest.xml',
    );

    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android.intent.action.VIEW');
    expect(manifest).toContain('android.intent.category.BROWSABLE');
    expect(manifest).toContain('android:scheme="teslasync"');
  });

  test('iOS declares teslasync URL scheme and notification usage copy', () => {
    const infoPlist = readNativeFile('ios', 'TeslaSyncNative', 'Info.plist');

    expect(infoPlist).toContain('<key>CFBundleURLSchemes</key>');
    expect(infoPlist).toContain('<string>teslasync</string>');
    expect(infoPlist).toContain(
      '<key>NSUserNotificationsUsageDescription</key>',
    );
  });

  test('Windows declares teslasync protocol activation', () => {
    const appxManifest = readNativeFile(
      'windows',
      'TeslaSyncNative.Package',
      'Package.appxmanifest',
    );

    expect(appxManifest).toContain('Category="windows.protocol"');
    expect(appxManifest).toContain('<uap:Protocol Name="teslasync">');
  });
});
