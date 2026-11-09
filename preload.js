const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
  show: () => ipcRenderer.send('win:show'),
  attention: () => ipcRenderer.send('win:attention'),
  setTrayTitle: (t) => ipcRenderer.send('tray:title', t),
  openSpeechSettings: () => ipcRenderer.send('open-speech-settings'),
  quit: () => ipcRenderer.send('app:quit')
});
