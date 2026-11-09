const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWin());
}

app.setAppUserModelId('ru.pizzeria.expiry-alarm');

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 380,
    minHeight: 520,
    show: !startHidden,
    title: 'Будильник сроков',
    backgroundColor: '#1c1d21',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,               // таймеры работают и в свёрнутом окне
      autoplayPolicy: 'no-user-gesture-required' // звук без клика
    }
  });
  win.loadFile('index.html');

  // Закрытие окна = свернуть в трей, будильники продолжают работать
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Будильник сроков');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть', click: showWin },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWin);
}

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-app-suspension');
  createWindow();
  createTray();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* живём в трее */ });

// ---------- IPC ----------
// В портативной сборке exe распаковывается во временную папку — в автозагрузку пишем путь к самому exe
const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
// При запуске через electron.exe (не собранный exe) передаём путь к папке приложения
const loginOpts = { path: exePath, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] };
ipcMain.handle('autostart:get', () => app.getLoginItemSettings(loginOpts).openAtLogin);
ipcMain.handle('autostart:set', (_e, on) => {
  app.setLoginItemSettings({ ...loginOpts, openAtLogin: !!on });
  return app.getLoginItemSettings(loginOpts).openAtLogin;
});
ipcMain.on('win:show', showWin);
ipcMain.on('win:attention', () => {
  if (!win) return;
  if (!win.isVisible() || win.isMinimized()) { win.showInactive(); }
  win.flashFrame(true);
});
ipcMain.on('tray:title', (_e, text) => { if (tray) tray.setToolTip(text || 'Будильник сроков'); });
ipcMain.on('open-speech-settings', () => { shell.openExternal('ms-settings:speech'); });
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
