import crypto from "node:crypto";
import { app } from "electron";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PORTABLE_DIRS, PORTABLE_MARKER_FILE } from "@shared/constants";
import type { AppBootstrapState, AppSettings, LocalWorkspaceConfig } from "@shared/types";
import { ensureDir, exists, readJsonFile, writeJsonFile } from "./fs-utils";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  compactSidebar: false,
  showAdvancedMode: false,
  lastSection: "dashboard",
  lastSystemSection: "health"
};

const DEFAULT_UI_STATE = {
  lastOpenedEntityId: null,
  windowBounds: null
};

export class PortablePathsService {
  readonly appRoot: string;
  readonly portableMode: boolean;
  readonly portableDataPath: string;

  private resolveAppRoot(): string {
    const executableDir = path.dirname(app.getPath("exe"));
    if (process.platform !== "darwin") {
      return executableDir;
    }
    return path.resolve(executableDir, "..", "..", "..");
  }

  constructor() {
    const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
    this.appRoot = portableExecutableDir || this.resolveAppRoot();
    const portableMarkerPresent = fs.existsSync(path.join(this.appRoot, PORTABLE_MARKER_FILE));
    this.portableMode = process.platform !== "darwin" && (Boolean(portableExecutableDir) || portableMarkerPresent);
    this.portableDataPath = this.portableMode
      ? path.join(this.appRoot, "PortableData")
      : path.join(app.getPath("userData"), "PortableData");
  }

  get settingsDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.settings);
  }

  get cacheDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.cache);
  }

  get draftsDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.drafts);
  }

  get logsDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.logs);
  }

  get backupsDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.localBackups);
  }

  get tempDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.temp);
  }

  get machineDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.machine);
  }

  get gitExportsDir(): string {
    return path.join(this.portableDataPath, PORTABLE_DIRS.gitExports);
  }

  get currentMachineFingerprint(): string {
    return crypto
      .createHash("sha1")
      .update(`${os.hostname()}|${os.platform()}|${os.arch()}`)
      .digest("hex");
  }

  get currentMachineLabel(): string {
    return `${os.hostname()} • ${os.platform()} ${os.arch()}`;
  }

  get workspaceConfigPath(): string {
    return path.join(this.settingsDir, "workspace.json");
  }

  get appSettingsPath(): string {
    return path.join(this.settingsDir, "app_settings.json");
  }

  get uiStatePath(): string {
    return path.join(this.settingsDir, "ui_state.json");
  }

  get machineIdPath(): string {
    return path.join(this.machineDir, "machine_id.json");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.settingsDir),
      ensureDir(this.cacheDir),
      ensureDir(path.join(this.cacheDir, "entity_snapshots")),
      ensureDir(path.join(this.cacheDir, "search_indexes")),
      ensureDir(this.draftsDir),
      ensureDir(path.join(this.draftsDir, "posts")),
      ensureDir(path.join(this.draftsDir, "imports")),
      ensureDir(path.join(this.draftsDir, "unsaved_edits")),
      ensureDir(this.logsDir),
      ensureDir(this.backupsDir),
      ensureDir(path.join(this.backupsDir, "rollback_points")),
      ensureDir(path.join(this.backupsDir, "pre_restore")),
      ensureDir(this.tempDir),
      ensureDir(path.join(this.tempDir, "write_staging")),
      ensureDir(path.join(this.tempDir, "import_staging")),
      ensureDir(path.join(this.tempDir, "restore_staging")),
      ensureDir(this.machineDir),
      ensureDir(this.gitExportsDir),
      ensureDir(path.join(this.gitExportsDir, "snapshots")),
      ensureDir(path.join(this.gitExportsDir, "config_exports"))
    ]);

    if (!(await exists(this.appSettingsPath))) {
      await writeJsonFile(this.appSettingsPath, DEFAULT_SETTINGS);
    }

    if (!(await exists(this.uiStatePath))) {
      await writeJsonFile(this.uiStatePath, DEFAULT_UI_STATE);
    }

    if (!(await exists(this.machineIdPath))) {
      await writeJsonFile(this.machineIdPath, {
        machine_id: `machine_${crypto.randomUUID()}`,
        created_at: new Date().toISOString()
      });
    }

    await this.ensureTextFile(path.join(this.logsDir, "app.log"));
    await this.ensureTextFile(path.join(this.logsDir, "sync.log"));
    await this.ensureTextFile(path.join(this.logsDir, "recovery.log"));
    await this.ensureTextFile(path.join(this.logsDir, "import.log"));
  }

  async loadWorkspaceConfig(): Promise<LocalWorkspaceConfig | null> {
    if (!(await exists(this.workspaceConfigPath))) {
      return null;
    }

    const config = await readJsonFile<Partial<LocalWorkspaceConfig>>(this.workspaceConfigPath);
    return {
      sharedDatasetPath: config.sharedDatasetPath ?? "",
      backupDirectoryPath: config.backupDirectoryPath ?? this.backupsDir,
      portableDataPath: config.portableDataPath ?? this.portableDataPath,
      lastOpenedAt: config.lastOpenedAt ?? new Date().toISOString(),
      machineFingerprint: config.machineFingerprint,
      machineLabel: config.machineLabel
    };
  }

  async saveWorkspaceConfig(config: LocalWorkspaceConfig): Promise<void> {
    await writeJsonFile(this.workspaceConfigPath, config);
  }

  async loadAppSettings(): Promise<AppSettings> {
    if (!(await exists(this.appSettingsPath))) {
      return DEFAULT_SETTINGS;
    }
    return readJsonFile<AppSettings>(this.appSettingsPath);
  }

  async saveAppSettings(settings: AppSettings): Promise<void> {
    await writeJsonFile(this.appSettingsPath, settings);
  }

  async getBootstrapState(): Promise<AppBootstrapState> {
    const workspace = await this.loadWorkspaceConfig();
    const settings = await this.loadAppSettings();
    const workspaceSelectionRequired = Boolean(
      workspace?.machineFingerprint &&
      workspace.machineFingerprint !== this.currentMachineFingerprint
    );

    return {
      configured: Boolean(workspace) && !workspaceSelectionRequired,
      portableMode: this.portableMode,
      settingsPath: this.settingsDir,
      settings,
      workspace: workspace ?? undefined,
      workspaceSelectionRequired,
      workspaceSelectionReason: workspaceSelectionRequired
        ? `Эта настройка рабочей папки была сохранена на другом компьютере (${workspace?.machineLabel ?? "другое устройство"}). На этом компьютере папки нужно выбрать заново.`
        : undefined
    };
  }

  private async ensureTextFile(filePath: string): Promise<void> {
    if (await exists(filePath)) {
      return;
    }
    await ensureDir(path.dirname(filePath));
    await fsPromises.writeFile(filePath, "", "utf8");
  }
}
