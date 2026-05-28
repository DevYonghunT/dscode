// 렌더러(설정 페이지) ↔ main 간 안전한 IPC 브릿지.
// contextIsolation 켜진 상태라 require/process 등 직접 노출 X.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dscode', {
  saveToken: (token) => ipcRenderer.invoke('dscode:save-token', token),
  cancelSettings: () => ipcRenderer.send('dscode:cancel-settings'),
})
