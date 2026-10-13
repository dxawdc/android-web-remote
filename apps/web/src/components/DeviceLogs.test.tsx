import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceLogs } from "./DeviceLogs";

const deviceLogs = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ api: { deviceLogs } }));
afterEach(cleanup);
describe("remote device logs", () => {
  it("shows saved offline logs as text and identifies their receipt time", async () => {
    deviceLogs.mockResolvedValue({ snapshot: { receivedAt: "2026-10-13T02:00:00Z", version: "0.9.0", lines: ["[连接] 离线", "<script>alert(1)</script>"] } });
    render(<DeviceLogs token="test" device={{ id: 7, name: "异地手机" }} onClose={() => {}} />);
    const text = await screen.findByRole("textbox", { name: "手机诊断日志" }) as HTMLTextAreaElement;
    expect(text.value).toContain("<script>alert(1)</script>");
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/服务器接收时间/).textContent).toContain("0.9.0");
    expect(deviceLogs).toHaveBeenCalledWith("test", 7);
  });

  it("explains why a device has not uploaded and handles access failures", async () => {
    deviceLogs.mockResolvedValue({ snapshot: null });
    const view = render(<DeviceLogs token="test" device={{ id: 7, name: "异地手机" }} onClose={() => {}} />);
    expect(await screen.findByText(/尚未收到日志/)).toBeTruthy();
    view.unmount();
    deviceLogs.mockRejectedValue(new Error("无权访问"));
    render(<DeviceLogs token="test" device={{ id: 8, name: "另一手机" }} onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("无权访问");
  });
});
