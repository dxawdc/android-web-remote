import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteDevice: vi.fn().mockResolvedValue(undefined),
  devices: vi.fn().mockResolvedValue({
    devices: [
      {
        id: 7,
        device_id: "DEVICE123",
        name: "测试手机",
        last_seen_at: null,
        created_at: "",
        updated_at: "",
        online: false,
      },
    ],
  }),
}));

vi.mock("./lib/api", () => ({
  api: {
    devices: mocks.devices,
    deleteDevice: mocks.deleteDevice,
    login: vi.fn(),
    addDevice: vi.fn(),
    renameDevice: vi.fn(),
    users: vi.fn(),
    addUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock("./lib/remoteClient", () => ({
  RemoteClient: class {
    connect() {}
    send() {}
    gesture() {}
    launch() {}
    close() {}
  },
  demoDevice: { name: "测试设备", model: "", androidVersion: "", battery: 0, apps: [] },
}));

import App from "./App";

describe("device management", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("remote-token", "test-token");
    sessionStorage.setItem(
      "remote-user",
      JSON.stringify({ id: 1, username: "tester", role: "user" }),
    );
    mocks.deleteDevice.mockClear();
    mocks.devices.mockClear();
  });

  it("deletes a saved device after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    const deleteButton = await screen.findByRole("button", { name: "删除设备" });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(mocks.deleteDevice).toHaveBeenCalledWith("test-token", 7));
  });
});
