import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PhoneViewer } from "./PhoneViewer";

afterEach(cleanup);
function setup(frame?: string) {
  const gesture=vi.fn();
  const view=render(<PhoneViewer frame={frame} frameStage="waiting" onRetry={()=>{}} onFrameError={()=>{}} onCommand={()=>{}} onGesture={gesture} onDisconnect={()=>{}}/>);
  const screen=view.container.querySelector(".phone-screen") as HTMLElement;
  screen.setPointerCapture=vi.fn();
  screen.getBoundingClientRect=()=>({left:0,top:0,width:100,height:200}) as DOMRect;
  const pointer=(type:string,x:number,y:number)=>{
    const event=new Event(type,{bubbles:true});
    Object.assign(event,{clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0});fireEvent(screen,event);
  };
  return {gesture,pointer};
}
it("clips captured drags released outside the displayed screen",()=>{
  const {gesture,pointer}=setup("frame");pointer("pointerdown",50,100);pointer("pointerup",-30,250);
  expect(gesture).toHaveBeenCalledWith("swipe",{startX:0.5,startY:0.5,endX:0,endY:1});
});
it("does not send cancelled or invisible-screen input",()=>{
  const {gesture,pointer}=setup("frame");pointer("pointerdown",50,100);pointer("pointercancel",50,100);pointer("pointerup",50,100);
  expect(gesture).not.toHaveBeenCalled();cleanup();
  const empty=setup();empty.pointer("pointerdown",50,100);empty.pointer("pointerup",50,100);expect(empty.gesture).not.toHaveBeenCalled();
});
