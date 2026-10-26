const { app, BrowserWindow, dialog, Menu, net, protocol, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_URL, isolationHeaders, resolveBundlePath, isAppUrl, isExternalUrl } = require('./bundle.cjs');

app.setName('Word Trail');
// Keep development storage separate from installed builds and automated checks.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Word Trail Development'));
if (process.env.WORD_TRAIL_SMOKE_USER_DATA && !app.isPackaged) {
  app.setPath('userData', process.env.WORD_TRAIL_SMOKE_USER_DATA);
}
app.setAppUserModelId('com.designerzen.wordtrail');

protocol.registerSchemesAsPrivileged([{
  scheme: 'wordtrail',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, allowServiceWorkers: true }
}]);

const devUrl = !app.isPackaged ? process.env.WORD_TRAIL_DEV_URL : undefined;
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devUrl)) throw new Error('Development URL must be a loopback Vite URL.');
let mainWindow;
const granted = new Set();

function configurePermissions() {
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (!contents || !isAppUrl(details.requestingUrl || origin, devUrl)) return false;
    if (permission === 'persistent-storage') return true;
    if (permission === 'media') return details.mediaType !== 'video' && granted.has('media');
    return permission === 'geolocation' && granted.has('geolocation');
  });
  session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (!contents || !isAppUrl(details.requestingUrl, devUrl)) return callback(false);
    if (permission === 'persistent-storage') return callback(true);
    const audioOnly = permission === 'media' && details.mediaTypes?.length > 0 && details.mediaTypes.every((type) => type === 'audio');
    if (!audioOnly && permission !== 'geolocation') return callback(false);
    try {
      if (!granted.has(permission)) {
        const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(contents), {
          type: 'question',
          title: 'Word Trail',
          message: audioOnly ? 'Allow Word Trail to use your microphone?' : 'Allow Word Trail to access your location?',
          detail: audioOnly ? 'Audio is recorded and transcribed on this device.' : 'Your location can be attached to recorded phrases and shown on the map.',
          buttons: ['Allow', 'Don’t allow'], defaultId: 1, cancelId: 1, noLink: true
        });
        if (response !== 0) return callback(false);
        if (audioOnly && process.platform === 'darwin' && !await systemPreferences.askForMediaAccess('microphone')) return callback(false);
        granted.add(permission);
      }
      callback(true);
    } catch {
      callback(false);
    }
  });
}

function openExternal(url) {
  if (isExternalUrl(url)) void shell.openExternal(url).catch(console.error);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Word Trail', width: 1360, height: 920, minWidth: 640, minHeight: 560,
    backgroundColor: '#faf8f4', show: false,
    icon: devUrl ? path.join(__dirname, '..', 'public', 'icon.png') : path.join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, devUrl)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(devUrl || APP_URL).catch((error) => {
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return;
    dialog.showErrorBox('Word Trail could not start', error.message);
    app.quit();
  });
}

app.whenReady().then(() => {
  protocol.handle('wordtrail', async (request) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const file = resolveBundlePath(path.join(app.getAppPath(), 'dist'), request.url);
      if (!file) return new Response(null, { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(isolationHeaders)) headers.set(name, value);
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  configurePermissions();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [
      { id: 'downloads', label: 'Desktop downloads', click: () => {
        // In-page navigation preserves the current recording and transcript.
        if (mainWindow) void mainWindow.webContents.executeJavaScript("window.location.hash = '#downloads'").catch(console.error);
      } },
      { label: 'GitHub releases', click: () => openExternal('https://github.com/designerzen/info-recorder/releases') }
    ] }
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
