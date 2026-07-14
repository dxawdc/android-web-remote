import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppPanel } from "./AppPanel";

const apps=[{label:"设置",packageName:"com.android.settings"},{label:"相机",packageName:"com.android.camera"}];

describe("AppPanel",()=>{
  it("filters apps and launches the selected package",()=>{
    const launch=vi.fn();render(<AppPanel apps={apps} onLaunch={launch}/>);
    fireEvent.change(screen.getByLabelText("搜索应用"),{target:{value:"设置"}});
    expect(screen.queryByText("相机")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"打开"}));
    expect(launch).toHaveBeenCalledWith("com.android.settings");
  });
});
