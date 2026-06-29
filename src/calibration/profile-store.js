import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isBaseline } from "./baseline.js";

const PROFILE_STORE_SCHEMA = "subtext/profile-store/v1";

export function defaultProfileStorePath(cwd = process.cwd()) {
  return resolve(cwd, process.env.SUBTEXT_PROFILE_STORE || ".subtext/profiles.json");
}

export async function loadProfileStore(filePath = defaultProfileStorePath()) {
  if (!(await exists(filePath))) return emptyProfileStore();
  const store = JSON.parse(await readFile(filePath, "utf8"));
  return normalizeProfileStore(store);
}

export async function saveProfileStore(filePath, store) {
  const normalized = normalizeProfileStore(store);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function listProfiles(store) {
  const normalized = normalizeProfileStore(store);
  return Object.entries(normalized.profiles)
    .map(([name, profile]) => ({
      name,
      device: profile.device ?? "",
      deviceId: profile.deviceId ?? "",
      groupId: profile.groupId ?? "",
      environment: profile.environment ?? "",
      samples: isBaseline(profile.baseline) ? profile.baseline.samples : 0,
      updatedAt: profile.updatedAt ?? profile.createdAt ?? "",
      hasBaseline: isBaseline(profile.baseline)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getProfile(store, name) {
  const profileName = normalizeProfileName(name);
  const normalized = normalizeProfileStore(store);
  return normalized.profiles[profileName] ?? null;
}

export function getProfileBaseline(store, name) {
  const profile = getProfile(store, name);
  return isBaseline(profile?.baseline) ? profile.baseline : null;
}

export function upsertProfileBaseline(store, options) {
  const profileName = normalizeProfileName(options.name);
  if (!isBaseline(options.baseline)) {
    throw new Error("Profile baseline must use subtext/baseline/v1.");
  }

  const normalized = normalizeProfileStore(store);
  const existing = normalized.profiles[profileName] ?? {};
  normalized.profiles[profileName] = {
    ...existing,
    name: profileName,
    device: options.device ?? existing.device ?? "",
    deviceId: options.deviceId ?? existing.deviceId ?? "",
    groupId: options.groupId ?? existing.groupId ?? "",
    environment: options.environment ?? existing.environment ?? "",
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    baseline: options.baseline
  };
  return normalized;
}

export function deleteProfile(store, name) {
  const profileName = normalizeProfileName(name);
  const normalized = normalizeProfileStore(store);
  delete normalized.profiles[profileName];
  return normalized;
}

export function emptyProfileStore() {
  return {
    schema: PROFILE_STORE_SCHEMA,
    deviceProfiles: {},
    profiles: {}
  };
}

export function normalizeProfileStore(store) {
  if (!store || typeof store !== "object") return emptyProfileStore();
  const profiles = {};
  for (const [name, profile] of Object.entries(store.profiles ?? {})) {
    const profileName = normalizeProfileName(profile?.name ?? name);
    profiles[profileName] = {
      name: profileName,
      device: profile?.device ?? "",
      deviceId: profile?.deviceId ?? "",
      groupId: profile?.groupId ?? "",
      environment: profile?.environment ?? "",
      createdAt: profile?.createdAt ?? "",
      updatedAt: profile?.updatedAt ?? "",
      baseline: profile?.baseline ?? null
    };
  }
  return {
    schema: PROFILE_STORE_SCHEMA,
    deviceProfiles: store.deviceProfiles ?? {},
    profiles
  };
}

export function normalizeProfileName(name) {
  const profileName = String(name ?? "").trim();
  if (!profileName) throw new Error("Profile name is required.");
  if (profileName.length > 80) throw new Error("Profile name must be 80 characters or fewer.");
  return profileName;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
