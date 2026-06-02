// 렌더러(메인 창) ↔ main 간 안전한 IPC 브릿지.
// contextIsolation 켜진 상태라 require/process 등 직접 노출 X.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dscode', {
  // 메인 창: 로그인 후 자동 발급받은 토큰을 OS 보안저장소에 영구 저장만 (부트스트랩 X).
  // 다음 앱 실행 때 main.cjs 가 이 토큰을 읽어 자식 Next 에 주입한다.
  persistToken: (token) => ipcRenderer.invoke('dscode:persist-token', token),
})
