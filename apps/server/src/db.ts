import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, "remote-control.json");

type StoredUser = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  active: number;
  created_at: string;
  updated_at: string;
};

type StoredDevice = {
  id: number;
  user_id: number;
  device_id: string;
  name: string;
  access_key_hash: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type Store = {
  nextUserId: number;
  nextDeviceId: number;
  users: StoredUser[];
  devices: StoredDevice[];
};

const now = () => new Date().toISOString();
const emptyStore = (): Store => ({ nextUserId: 1, nextDeviceId: 1, users: [], devices: [] });

function load(): Store {
  if (!fs.existsSync(file)) return emptyStore();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Store;
  } catch {
    return emptyStore();
  }
}

let store = load();

function save() {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

if (store.users.length === 0) {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "No administrator exists. Set ADMIN_USERNAME and ADMIN_PASSWORD before the first start.",
    );
  }
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  }
  const timestamp = now();
  store.users.push({
    id: store.nextUserId++,
    username,
    password_hash: bcrypt.hashSync(password, 12),
    role: "admin",
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  save();
}

const secretPath = path.join(dataDir, ".jwt-secret");
export const jwtSecret = process.env.JWT_SECRET ?? (
  fs.existsSync(secretPath)
    ? fs.readFileSync(secretPath, "utf8").trim()
    : crypto.randomBytes(32).toString("hex")
);
if (!process.env.JWT_SECRET && !fs.existsSync(secretPath)) {
  fs.writeFileSync(secretPath, jwtSecret, { mode: 0o600 });
}

export type UserRow = StoredUser;
export type DeviceRow = StoredDevice;

export function findUser(username: string) {
  return store.users.find((user) => user.username === username);
}

export function getUser(id: number) {
  return store.users.find((user) => user.id === id);
}

export function listUsers() {
  return store.users.map(({ password_hash, ...user }) => user);
}

export function createUser(username: string, password: string, role: "admin" | "user" = "user") {
  if (store.users.some((user) => user.username === username)) throw new Error("UNIQUE username");
  const timestamp = now();
  const user = {
    id: store.nextUserId++,
    username,
    password_hash: bcrypt.hashSync(password, 12),
    role,
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  } as StoredUser;
  store.users.push(user);
  save();
  return user;
}

export function updateUser(
  id: number,
  values: { username?: string; password?: string; role?: "admin" | "user"; active?: boolean },
) {
  const user = getUser(id);
  if (!user) return undefined;
  const nextName = values.username?.trim() || user.username;
  if (store.users.some((item) => item.id !== id && item.username === nextName)) {
    throw new Error("UNIQUE username");
  }
  user.username = nextName;
  if (values.password) user.password_hash = bcrypt.hashSync(values.password, 12);
  if (values.role) user.role = values.role;
  if (values.active !== undefined) user.active = values.active ? 1 : 0;
  user.updated_at = now();
  save();
  return user;
}

export function deleteUser(id: number) {
  const before = store.users.length;
  store.users = store.users.filter((user) => user.id !== id);
  store.devices = store.devices.filter((device) => device.user_id !== id);
  if (store.users.length === before) return false;
  save();
  return true;
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash);
}

export function listDevices(userId: number) {
  return store.devices
    .filter((device) => device.user_id === userId)
    .map(({ access_key_hash, user_id, ...device }) => device);
}

export function getDevice(id: number) {
  return store.devices.find((device) => device.id === id);
}

export function getDeviceForUser(id: number, userId: number) {
  return store.devices.find((device) => device.id === id && device.user_id === userId);
}

export function getDeviceByDeviceId(deviceId: string) {
  return store.devices.find((device) => device.device_id === deviceId);
}

export function createDevice(userId: number, deviceId: string, name: string, accessKey: string) {
  if (store.devices.some((device) => device.device_id === deviceId.trim())) {
    throw new Error("UNIQUE device_id");
  }
  const timestamp = now();
  const device = {
    id: store.nextDeviceId++,
    user_id: userId,
    device_id: deviceId.trim(),
    name: name.trim(),
    access_key_hash: bcrypt.hashSync(accessKey, 12),
    last_seen_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.devices.push(device);
  save();
  return device;
}

export function updateDeviceName(id: number, userId: number, name: string) {
  const device = getDeviceForUser(id, userId);
  if (!device) return undefined;
  device.name = name.trim();
  device.updated_at = now();
  save();
  return device;
}

export function deleteDevice(id: number, userId: number) {
  const before = store.devices.length;
  store.devices = store.devices.filter(
    (device) => !(device.id === id && device.user_id === userId),
  );
  if (store.devices.length === before) return false;
  save();
  return true;
}

export function verifyDeviceKey(device: DeviceRow, accessKey: string) {
  return bcrypt.compareSync(accessKey, device.access_key_hash);
}

export function markDeviceSeen(id: number) {
  const device = getDevice(id);
  if (!device) return;
  device.last_seen_at = now();
  device.updated_at = now();
  save();
}
