import WebSocket from "ws";

const deviceId=process.env.MOCK_DEVICE_ID??"DEMO-PHONE";
const accessKey=process.env.MOCK_ACCESS_KEY;
if(!accessKey) throw new Error("Set MOCK_ACCESS_KEY before starting the mock device");
const ws=new WebSocket(process.env.WS_URL??"ws://localhost:8787/ws");
ws.on("open",()=>ws.send(JSON.stringify({type:"registerDevice",deviceId,accessKey})));
ws.on("message",raw=>{
  const message=JSON.parse(raw.toString());
  if(message.type==="getDeviceInfo") ws.send(JSON.stringify({type:"deviceInfo",data:{name:"我的 Android 手机",model:"Pixel 7",androidVersion:"14",battery:87,apps:[
    {label:"设置",packageName:"com.android.settings"},{label:"Chrome",packageName:"com.android.chrome"},{label:"微信",packageName:"com.tencent.mm"},{label:"相册",packageName:"com.google.android.apps.photos"},{label:"文件管理",packageName:"com.google.android.documentsui"},{label:"相机",packageName:"com.android.camera2"},{label:"日历",packageName:"com.google.android.calendar"}
  ]}}));
  if(["launchApp","back","home","recents","gesture"].includes(message.type)) console.log("mock command",message);
});
console.log(`Mock device ready: ${deviceId}`);
