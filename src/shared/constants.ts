export const DATASET_KIND = "fronda-studio-dataset";
export const DATASET_SCHEMA_VERSION = 1;
export const APP_MIN_DATASET_VERSION = 1;
export const PORTABLE_MARKER_FILE = "portable.mode";

export const REQUIRED_SHARED_DIRS = [
  "registry",
  "directories",
  "structure",
  "participants",
  "releases",
  "external",
  "templates",
  "locks",
  "backups",
  "imports",
  "transactions"
] as const;

export const REQUIRED_SHARED_FILES = [
  "manifest.json",
  "registry/file_registry.json",
  "participants/registry.json",
  "releases/registry.json"
] as const;

export const PORTABLE_DIRS = {
  settings: "settings",
  cache: "cache",
  drafts: "drafts",
  logs: "logs",
  localBackups: "local_backups",
  temp: "temp",
  machine: "machine",
  gitExports: "git_exports"
} as const;

export const PORTABLE_CACHE_FILES = {
  sqliteIndex: "cache/ui_index.sqlite",
  lastSeenManifest: "cache/last_seen_manifest.json",
  lastSeenRegistry: "cache/last_seen_registry.json"
} as const;

export const LOCK_TTL_MINUTES = 20;

export const systemSections = [
  "health",
  "conflicts",
  "recovery",
  "git"
] as const;

export type SystemSection = (typeof systemSections)[number];
