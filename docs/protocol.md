# WebSocket 协议

服务端默认监听 `/ws`。所有文本消息均为 JSON；屏幕帧也封装在 JSON 中，以 Base64 JPEG 传输。生产环境必须使用 `wss://`。

## 角色与鉴权

每个连接建立后必须先声明角色并完成鉴权。

### Android 设备注册

```json
{
  "type": "registerDevice",
  "deviceId": "DEVICE-ID",
  "accessKey": "DEVICE-ACCESS-KEY"
}
```

服务端查找 Web 账号中已保存的设备，并使用 bcrypt 校验访问密钥。成功后返回：

```json
{ "type": "registered", "deviceId": "DEVICE-ID" }
```

### 浏览器控制端连接

```json
{
  "type": "connectController",
  "token": "JWT-TOKEN",
  "deviceDbId": 1
}
```

服务端验证 JWT，并确认该设备属于当前用户。随后返回在线状态：

```json
{ "type": "deviceStatus", "online": true }
```

鉴权失败时返回：

```json
{ "type": "authFailed", "message": "失败原因" }
```

## 浏览器发往设备的命令

### 获取设备信息和屏幕流

```json
{ "type": "getDeviceInfo" }
```

```json
{ "type": "startStream" }
```

### 启动应用

```json
{
  "type": "launchApp",
  "packageName": "com.example.app"
}
```

### 系统导航

```json
{ "type": "back" }
```

`home` 和 `recents` 的格式相同。

### 点击

```json
{
  "type": "gesture",
  "action": "tap",
  "x": 0.5,
  "y": 0.6
}
```

### 滑动

```json
{
  "type": "gesture",
  "action": "swipe",
  "startX": 0.5,
  "startY": 0.8,
  "endX": 0.5,
  "endY": 0.2
}
```

手势坐标使用相对于实时画面的 `0..1` 比例值，避免浏览器显示尺寸与设备分辨率不一致。

## 设备发往浏览器的消息

### 设备信息

```json
{
  "type": "deviceInfo",
  "data": {
    "name": "Android 设备",
    "model": "设备型号",
    "androidVersion": "14",
    "battery": 80,
    "apps": [
      { "label": "设置", "packageName": "com.android.settings" }
    ]
  }
}
```

### 屏幕帧

```json
{
  "type": "screenFrame",
  "data": "BASE64-JPEG"
}
```

### 截图失败

```json
{
  "type": "captureError",
  "message": "失败原因"
}
```

## 连接行为

- 同一设备 ID 建立新设备连接时，服务端会关闭旧连接，避免两个 Agent 同时占用会话。
- 设备上线或离线时，服务端向已连接的浏览器广播 `deviceStatus`。
- 浏览器连接在线设备后，服务端会主动请求设备信息和屏幕流。
- 删除已连接设备后，服务端仅关闭对应设备连接，不应影响其他设备或服务进程。
- Agent 应在断线后退避重连，并在发送队列积压时跳过屏幕帧。

## 安全建议

- 不要在日志中输出 JWT、设备访问密钥或完整屏幕帧。
- 对公网服务启用 TLS、来源限制、速率限制和操作审计。
- 定期轮换 JWT 密钥和设备访问密钥，并使旧会话失效。
- 服务端 WebSocket 消息大小上限当前为 4 MiB；反向代理也应设置匹配的限制。
