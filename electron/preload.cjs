// 렌더러(설정 페이지) ↔ main 간 안전한 IPC 브릿지.
// contextIsolation 켜진 상태라 require/process 등 직접 노출 X.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dscode', {
  // settings 창: 토큰 저장 후 앱 부트스트랩까지 진행
  saveToken: (token) => ipcRenderer.invoke('dscode:save-token', token),
  cancelSettings: () => ipcRenderer.send('dscode:cancel-settings'),
  // 메인 창: 로그인 후 자동 발급받은 토큰을 영구 저장만 (부트스트랩 X)
  persistToken: (token) => ipcRenderer.invoke('dscode:persist-token', token),
})
