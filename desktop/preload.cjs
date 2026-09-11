const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('greybeardDesktop', Object.freeze({
  chooseFile: () => ipcRenderer.invoke('desktop:choose-file'),
  exportMemory: memoryTenant => ipcRenderer.invoke('desktop:export', memoryTenant),
  openStorage: () => ipcRenderer.invoke('desktop:storage'),
  updates: action => ipcRenderer.invoke('desktop:updates', action),
  openRecovery: () => ipcRenderer.invoke('desktop:recovery'),
  quit: () => ipcRenderer.invoke('desktop:quit')
}));
