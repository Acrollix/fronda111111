import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DATASET_SCHEMA_VERSION,
  PORTABLE_CACHE_FILES
} from "@shared/constants";
import type {
  AppSettings,
  AppBootstrapState,
  DatasetManifest,
  DepartmentProfile,
  DirectoryRecord,
  DisciplinaryEvent,
  EntityHistoryEntry,
  EntityManifest,
  ExternalSource,
  FrondaExchangeBundle,
  FirstRunWizardResult,
  GeneratedPostSnapshot,
  GeneratedPostPreview,
  GitCommitResult,
  GitStatusSummary,
  ImportBatch,
  ImportDisciplinaryCandidate,
  ImportExternalSourceCandidate,
  ImportMappingOverride,
  ImportMappingPreset,
  ImportNoteCandidate,
  ImportParticipantCandidate,
  ImportPreview,
  ImportReleaseCandidate,
  ImportReleaseRelationCandidate,
  ImportRewardCandidate,
  LocalUnsavedDraftFile,
  LocalUnsavedDraftInfo,
  LocalWorkspaceConfig,
  ManualBackupResult,
  ParticipantAggregate,
  ParticipantEquipment,
  ParticipantListItem,
  ParticipantNote,
  ParticipantOrg,
  ParticipantProfile,
  ParticipantVoiceSample,
  PositionAssignment,
  PostTemplate,
  RegistryEntry,
  ReleaseAggregate,
  ReleaseExternalAssignment,
  ReleaseListItem,
  ReleaseParticipantAssignment,
  RewardEvent,
  StructureContact,
  Substitution,
  StructuredImportPreview,
  SyncStatus,
  SystemDiagnostics,
  SystemFileInfo,
  TemporaryAssignment,
  WorkspaceSnapshot,
  WorkspaceValidationResult
} from "@shared/types";
import { BackupService } from "./backup-service";
import { CacheService } from "./cache-service";
import { DatasetRepository } from "./dataset-repository";
import {
  exists,
  hashFile,
  isTransientReadError,
  readDirentsWithRetry,
  readJsonFile,
  readTextFile,
  removePath,
  safeTimestamp,
  TRANSIENT_CLOUD_READ_MESSAGE,
  writeJsonFile
} from "./fs-utils";
import { GitService } from "./git-service";
import { ImportService } from "./import-service";
import { LockService } from "./lock-service";
import { PortablePathsService } from "./portable-paths";
import { PostGeneratorService } from "./post-generator";
import { WorkspaceService } from "./workspace-service";

class LocalDraftSavedError extends Error {}
const execFileAsync = promisify(execFile);

const LEGACY_PARTICIPANT_ROLE_LEVEL_MAP: Record<string, string> = {
  "Начальный": "Низкий",
  "Рабочий": "Удовлетворительный",
  "Старший": "Средний",
  "Ведущий": "Высокий",
  "Резервный": "Достаточный"
};

function normalizeParticipantRoleLevel(value?: string | null): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return undefined;
  }
  return LEGACY_PARTICIPANT_ROLE_LEVEL_MAP[trimmed] ?? trimmed;
}

function isVisibleDirectoryRecord(record: Pick<DirectoryRecord, "status" | "archived_at"> & { archived?: boolean | null }): boolean {
  return record.status !== "inactive" && record.status !== "archived" && !record.archived_at && !record.archived;
}

function buildPostGeneratorOptions(snapshot: WorkspaceSnapshot) {
  const activeReleaseTypes = (snapshot.directories.release_types ?? []).filter(isVisibleDirectoryRecord);
  return {
    activeReleaseTypeIds: new Set(activeReleaseTypes.map((item) => item.id)),
    releaseTypeNameById: new Map(activeReleaseTypes.map((item) => [item.id, item.name]))
  };
}

function normalizeWorkspacePathForCompare(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/g, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export class FrondaAppService {
  private readonly portablePaths = new PortablePathsService();
  private readonly workspaceService = new WorkspaceService();
  private readonly gitService = new GitService(this.portablePaths.portableDataPath);
  private readonly repository = new DatasetRepository(this.gitService);
  private readonly backupService = new BackupService();
  private readonly lockService = new LockService();
  private readonly importService = new ImportService();
  private readonly postGenerator = new PostGeneratorService();
  private readonly cacheService = new CacheService(
    path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.sqliteIndex)
  );

  private isYandexDiskWorkspace(sharedPath?: string | null): boolean {
    const normalizedPath = (sharedPath ?? "").toLowerCase();
    return (
      normalizedPath.includes("yandex.disk")
      || normalizedPath.includes("yandexdisk")
      || normalizedPath.includes("\\yandex\\")
    );
  }

  private async findYandexDiskProcessName(): Promise<string | null> {
    if (process.platform !== "win32") {
      return null;
    }

    try {
      const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"]);
      const match = stdout.match(/"(Yandex\s*Disk(?:\d+)?\.exe|YandexDisk(?:\d+)?\.exe)"/i);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // Fall through to the PowerShell fallback below.
    }

    try {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        "Get-Process YandexDisk* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName"
      ]);
      const processName = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => /^Yandex\s*Disk\d*$|^YandexDisk\d*$/i.test(line));
      if (processName) {
        return processName.endsWith(".exe") ? processName : `${processName}.exe`;
      }
    } catch {
      // The caller returns a generic message if both checks fail.
    }

    return null;
  }

  private async probeYandexDiskWorkspace(sharedPath?: string | null): Promise<{
    ok: boolean;
    message: string | null;
  }> {
    if (!sharedPath) {
      return { ok: true, message: null };
    }

    const probeCandidates = [
      path.join(sharedPath, "participants", "registry.json"),
      path.join(sharedPath, "registry", "file_registry.json"),
      path.join(sharedPath, "manifest.json")
    ];

    for (const filePath of probeCandidates) {
      if (!(await exists(filePath))) {
        continue;
      }
      try {
        await readTextFile(filePath);
        return { ok: true, message: null };
      } catch (error) {
        const message = this.normalizeStorageError(error);
        if (this.isTransientCloudReadMessage(message)) {
          return {
            ok: false,
            message: "Яндекс Диск запущен, но облачный провайдер файлов сейчас не отдает рабочую папку. Подождите синхронизацию и попробуйте снова."
          };
        }
        return {
          ok: false,
          message
        };
      }
    }

    return { ok: true, message: null };
  }

  async bootstrap(): Promise<AppBootstrapState> {
    await this.portablePaths.initialize();
    await this.cacheService.initialize();
    const state = await this.portablePaths.getBootstrapState();
    state.settings = await this.portablePaths.loadAppSettings();
    if (state.workspace) {
      if (!state.workspace.machineFingerprint) {
        state.workspace = {
          ...state.workspace,
          machineFingerprint: this.portablePaths.currentMachineFingerprint,
          machineLabel: this.portablePaths.currentMachineLabel
        };
        await this.portablePaths.saveWorkspaceConfig(state.workspace);
      }
    }
    if (state.workspace && !state.workspaceSelectionRequired) {
      const refreshedWorkspace = {
        ...state.workspace,
        lastOpenedAt: new Date().toISOString()
      };
      await this.portablePaths.saveWorkspaceConfig(refreshedWorkspace);
      state.workspace = refreshedWorkspace;
      state.syncStatus = await withTimeout(
        this.getSyncStatus(state.workspace.sharedDatasetPath),
        8000,
        "Старая рабочая папка слишком долго отвечает. Откройте приложение и выберите папку заново или дождитесь синхронизации облака."
      ).catch((error) => ({
        mode: "RO_STALE" as const,
        message: error instanceof Error ? error.message : "Рабочая папка временно недоступна.",
        workspacePath: state.workspace?.sharedDatasetPath,
        issues: [error instanceof Error ? error.message : "Рабочая папка временно недоступна."]
      }));
    }
    return state;
  }

  async getYandexDiskStatus(sharedPath?: string | null): Promise<{
    relevant: boolean;
    running: boolean;
    processName: string | null;
    message: string | null;
  }> {
    const relevant = this.isYandexDiskWorkspace(sharedPath);

    if (!relevant) {
      return {
        relevant: false,
        running: true,
        processName: null,
        message: null
      };
    }

    if (process.platform !== "win32") {
      const probe = await this.probeYandexDiskWorkspace(sharedPath);
      return {
        relevant: true,
        running: probe.ok,
        processName: null,
        message: probe.ok
          ? null
          : (probe.message ?? "Облачная рабочая папка сейчас недоступна для чтения. Проверьте, что клиент синхронизации включен и файлы успели скачаться локально.")
      };
    }

    try {
      const processName = await this.findYandexDiskProcessName();
      if (processName) {
        const probe = await this.probeYandexDiskWorkspace(sharedPath);
        if (!probe.ok) {
          return {
            relevant: true,
            running: false,
            processName,
            message: probe.message
          };
        }
        return {
          relevant: true,
          running: true,
          processName,
          message: null
        };
      }
    } catch {
      return {
        relevant: true,
        running: false,
        processName: null,
        message: "Не удалось проверить процесс Яндекс Диска. Если он выключен, облако не будет своевременно получать изменения."
      };
    }

    return {
      relevant: true,
      running: false,
      processName: null,
      message: "Яндекс Диск не запущен. Рабочая папка подключена через облако, поэтому изменения не будут своевременно сохраняться в облако, пока клиент синхронизации не включен."
    };
  }

  async saveAppSettings(settings: AppSettings): Promise<AppSettings> {
    await this.portablePaths.saveAppSettings(settings);
    return this.portablePaths.loadAppSettings();
  }

  async configureWorkspace(input: FirstRunWizardResult): Promise<WorkspaceValidationResult> {
    const validation = await this.workspaceService.validateWorkspace(input.sharedDatasetPath);
    if (!validation.valid || !validation.manifest) {
      return validation;
    }
    const normalizedSharedPath = path.resolve(input.sharedDatasetPath);
    const normalizedBackupPath = path.resolve(input.backupDirectoryPath);
    const previousWorkspace = await this.portablePaths.loadWorkspaceConfig();
    const workspaceChanged = previousWorkspace
      ? normalizeWorkspacePathForCompare(previousWorkspace.sharedDatasetPath)
        !== normalizeWorkspacePathForCompare(normalizedSharedPath)
      : false;
    if (!input.backupDirectoryPath.trim()) {
      return {
        valid: false,
        sharedPath: input.sharedDatasetPath,
        mode: validation.mode,
        errors: ["Выберите локальную папку для резервных копий."],
        warnings: []
      };
    }
    if (
      normalizedBackupPath === normalizedSharedPath ||
      normalizedBackupPath.startsWith(`${normalizedSharedPath}${path.sep}`)
    ) {
      return {
        valid: false,
        sharedPath: input.sharedDatasetPath,
        mode: validation.mode,
        errors: ["Папка резервных копий должна находиться вне общей рабочей папки."],
        warnings: []
      };
    }
    if (workspaceChanged) {
      await this.clearLocalWorkspaceCache();
    }
    await fs.mkdir(normalizedBackupPath, { recursive: true });
    const workspace: LocalWorkspaceConfig = {
      sharedDatasetPath: normalizedSharedPath,
      backupDirectoryPath: normalizedBackupPath,
      portableDataPath: this.portablePaths.portableDataPath,
      lastOpenedAt: new Date().toISOString(),
      machineFingerprint: this.portablePaths.currentMachineFingerprint,
      machineLabel: this.portablePaths.currentMachineLabel
    };
    await this.portablePaths.saveWorkspaceConfig(workspace);
    const syncStatus = await this.syncWorkspace(true);
    return {
      ...validation,
      mode: syncStatus.mode,
      warnings: Array.from(new Set([...validation.warnings, ...syncStatus.issues])),
      manifest: {
        ...validation.manifest,
        dataset_revision: syncStatus.datasetRevision ?? validation.manifest.dataset_revision
      }
    };
  }

  async loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
    const workspace = await this.portablePaths.loadWorkspaceConfig();
    if (!workspace) {
      return null;
    }
    const cachedSnapshot = await this.cacheService.loadSnapshot();
    const validation = await this.workspaceService.validateWorkspace(workspace.sharedDatasetPath);
    if (
      cachedSnapshot
      && validation.manifest
      && cachedSnapshot.manifest.dataset_id === validation.manifest.dataset_id
      && cachedSnapshot.manifest.dataset_revision === validation.manifest.dataset_revision
    ) {
      return cachedSnapshot;
    }
    if (!validation.valid || validation.mode === "RO_OFFLINE" || validation.mode === "RO_RECOVERY") {
      return cachedSnapshot;
    }
    await this.syncWorkspace(false);
    return this.cacheService.loadSnapshot();
  }

  private buildSyncStatusMessage(args: {
    validation: WorkspaceValidationResult;
    localRevision?: number;
    rebuilt?: boolean;
  }): string {
    if (!args.validation.valid) {
      return args.validation.errors[0] ?? "Общая папка недоступна.";
    }
    if (args.validation.mode === "RO_STALE") {
      return args.validation.warnings[0]
        ?? TRANSIENT_CLOUD_READ_MESSAGE;
    }
    if (args.validation.mode === "RO_LOCKED_ENTITY") {
      return args.validation.warnings[0] ?? "Запись сейчас заблокирована другой операцией.";
    }
    if (args.localRevision !== undefined && args.localRevision !== args.validation.manifest?.dataset_revision) {
      return "В общей папке есть более новая версия данных. Обновите локальную копию перед редактированием.";
    }
    return args.rebuilt
      ? "Локальный кэш обновлен из общей папки."
      : "Локальный кэш уже актуален.";
  }

  private isTransientCloudReadMessage(message?: string | null): boolean {
    const text = (message ?? "").trim();
    if (!text) {
      return false;
    }
    return (
      /UNKNOWN:\s*unknown error,\s*read/i.test(text)
      || /\bunknown error,\s*read\b/i.test(text)
      || /временно .*перечит/i.test(text)
      || /временно .*недоступ/i.test(text)
      || /синхронизац.*облак/i.test(text)
    );
  }

  async getSyncStatus(sharedPath: string): Promise<SyncStatus> {
    const validation = await this.workspaceService.validateWorkspace(sharedPath);
    const localManifestPath = path.join(
      this.portablePaths.portableDataPath,
      PORTABLE_CACHE_FILES.lastSeenManifest
    );
    let localRevision: number | undefined;
    if (await exists(localManifestPath)) {
      const localManifest = await readJsonFile<DatasetManifest>(localManifestPath).catch(() => null);
      localRevision = localManifest?.dataset_revision;
    }
    if (validation.mode === "RO_OFFLINE" && this.isTransientCloudReadMessage(validation.errors[0])) {
      const cachedSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
      if (localRevision !== undefined || cachedSnapshot) {
        const message = validation.errors[0]
          || TRANSIENT_CLOUD_READ_MESSAGE;
        return {
          mode: "RO_STALE",
          message,
          datasetRevision: validation.manifest?.dataset_revision,
          localRevision,
          workspacePath: sharedPath,
          issues: [message]
        };
      }
    }
    const message = this.buildSyncStatusMessage({ validation, localRevision });
    return {
      mode: validation.mode,
      message,
      datasetRevision: validation.manifest?.dataset_revision,
      localRevision,
      workspacePath: sharedPath,
      issues: [...validation.errors, ...validation.warnings]
    };
  }

  async syncWorkspace(force: boolean): Promise<SyncStatus> {
    const workspace = await this.portablePaths.loadWorkspaceConfig();
    if (!workspace) {
      return {
        mode: "RO_OFFLINE",
        message: "Рабочее пространство не настроено.",
        issues: ["Путь к общей папке данных еще не выбран."]
      };
    }
    const validation = await this.workspaceService.validateWorkspace(workspace.sharedDatasetPath);
    const localManifestPath = path.join(
      this.portablePaths.portableDataPath,
      PORTABLE_CACHE_FILES.lastSeenManifest
    );
    const localRegistryPath = path.join(
      this.portablePaths.portableDataPath,
      PORTABLE_CACHE_FILES.lastSeenRegistry
    );
    const localManifest = (await exists(localManifestPath))
      ? await readJsonFile<DatasetManifest>(localManifestPath).catch(() => null)
      : null;
    if (!validation.valid || !validation.manifest) {
      const message = validation.errors[0] ?? "Не удалось синхронизировать рабочее пространство.";
      const cachedSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
      const localRevision =
        localManifest?.dataset_revision
        ?? cachedSnapshot?.manifest?.dataset_revision;
      if (
        (validation.mode === "RO_STALE" || this.isTransientCloudReadMessage(message))
        && (localRevision !== undefined || cachedSnapshot)
      ) {
        return {
          mode: "RO_STALE",
          message,
          datasetRevision: validation.manifest?.dataset_revision,
          localRevision,
          workspacePath: workspace.sharedDatasetPath,
          issues: [...validation.errors, ...validation.warnings]
        };
      }
      return {
        mode: validation.mode,
        message,
        datasetRevision: validation.manifest?.dataset_revision,
        localRevision,
        issues: [...validation.errors, ...validation.warnings],
        workspacePath: workspace.sharedDatasetPath
      };
    }

    const validatedManifest = validation.manifest;
    const repairedIndexes = await this.ensureSharedIndexesHealthy(
      workspace.sharedDatasetPath,
      validatedManifest
    ).catch(() => ({
      manifest: validatedManifest,
      repaired: false
    }));
    const effectiveManifest = repairedIndexes.manifest ?? validatedManifest;

    const shouldRebuild =
      force ||
      !localManifest ||
      repairedIndexes.repaired ||
      localManifest.dataset_id !== effectiveManifest.dataset_id ||
      localManifest.dataset_revision !== effectiveManifest.dataset_revision;

    if (shouldRebuild) {
      try {
        const fileRegistry = await this.workspaceService.readFileRegistry(workspace.sharedDatasetPath);
        const cachedFallbackSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
        const fallbackSnapshot = cachedFallbackSnapshot?.manifest.dataset_id === effectiveManifest.dataset_id
          ? cachedFallbackSnapshot
          : null;
        const snapshot = await this.repository.loadWorkspaceSnapshot(
          workspace.sharedDatasetPath,
          effectiveManifest,
          fallbackSnapshot
        );
        await this.cacheService.rebuild(snapshot);
        await writeJsonFile(localManifestPath, effectiveManifest);
        await writeJsonFile(localRegistryPath, fileRegistry);
      } catch (error) {
        const normalizedMessage = this.normalizeStorageError(error);
        const cachedSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
        const hasLocalState = Boolean(localManifest || cachedSnapshot);
        return {
          mode: hasLocalState ? "RO_STALE" : "RO_OFFLINE",
          message: normalizedMessage,
          datasetRevision: effectiveManifest.dataset_revision,
          localRevision: localManifest?.dataset_revision,
          workspacePath: workspace.sharedDatasetPath,
          issues: [normalizedMessage]
        };
      }
    }

    return {
      mode: validation.mode,
      message: this.buildSyncStatusMessage({
        validation,
        localRevision: effectiveManifest.dataset_revision,
        rebuilt: shouldRebuild
      }),
      datasetRevision: effectiveManifest.dataset_revision,
      localRevision: effectiveManifest.dataset_revision,
      workspacePath: workspace.sharedDatasetPath,
      issues: validation.warnings
    };
  }

  async saveParticipant(participant: ParticipantAggregate, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const entityType = "participant";
    const entityId = participant.profile.id;
    const basePath = path.join(workspace.sharedDatasetPath, "participants", "by_id", `prt_${entityId.replace(/^prt_/, "")}`);
    await this.saveEntityAggregate({
      sharedPath: workspace.sharedDatasetPath,
      entityType,
      entityId,
      entityPath: basePath,
      draftPayload: participant,
      baseEntityRevision: participant.entity_manifest.entity_revision,
      loadCurrent: () => this.repository.loadParticipantAggregate(basePath),
      mergeOnConflict: (current, draft) =>
        this.mergeParticipantAggregateOnConflict(current as ParticipantAggregate, draft as ParticipantAggregate, userName),
      prepareForSave: (draftPayload, current) => {
        const next = this.prepareParticipantAggregateForSave(
          draftPayload as ParticipantAggregate,
          current as ParticipantAggregate | null,
          userName
        );
        return next;
      },
      buildFiles: (next) => this.buildParticipantAggregateFiles(next as ParticipantAggregate),
      userName,
      localDraftDomain: "participant"
    });
  }

  async saveRelease(release: ReleaseAggregate, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const entityType = "release";
    const entityId = release.release.id;
    const basePath = path.join(workspace.sharedDatasetPath, "releases", "by_id", `rel_${entityId.replace(/^rel_/, "")}`);
    await this.saveEntityAggregate({
      sharedPath: workspace.sharedDatasetPath,
      entityType,
      entityId,
      entityPath: basePath,
      draftPayload: release,
      baseEntityRevision: release.entity_manifest.entity_revision,
      loadCurrent: () => this.repository.loadReleaseAggregate(basePath),
      mergeOnConflict: (current, draft) =>
        this.mergeReleaseAggregateOnConflict(current as ReleaseAggregate, draft as ReleaseAggregate, userName),
      prepareForSave: (draftPayload, current) => {
        const next = this.prepareReleaseAggregateForSave(
          draftPayload as ReleaseAggregate,
          current as ReleaseAggregate | null,
          userName
        );
        return next;
      },
      buildFiles: (next) => this.buildReleaseAggregateFiles(next as ReleaseAggregate),
      userName,
      localDraftDomain: "release"
    });
  }

  async deleteParticipant(participantId: string, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    const basePath = path.join(sharedPath, "participants", "by_id", `prt_${participantId.replace(/^prt_/, "")}`);
    if (!(await exists(basePath))) {
      throw new Error("Участник не найден.");
    }

    await this.backupService.createEntityBackup(sharedPath, "participants", participantId, basePath).catch(() => undefined);

    const departmentProfilesPath = path.join(sharedPath, "structure", "department_profiles.json");
    const assignmentsPath = path.join(sharedPath, "structure", "position_assignments.json");
    const substitutionsPath = path.join(sharedPath, "structure", "substitutions.json");
    const temporaryAssignmentsPath = path.join(sharedPath, "structure", "temporary_assignments.json");
    const structureContactsPath = path.join(sharedPath, "structure", "structure_contacts.json");

    const currentDepartmentProfiles = await this.readJsonIfExists<DepartmentProfile[]>(departmentProfilesPath, []);
    const currentAssignments = await this.readJsonIfExists<PositionAssignment[]>(assignmentsPath, []);
    const currentSubstitutions = await this.readJsonIfExists<Substitution[]>(substitutionsPath, []);
    const currentTemporaryAssignments = await this.readJsonIfExists<TemporaryAssignment[]>(temporaryAssignmentsPath, []);
    const currentStructureContacts = await this.readJsonIfExists<StructureContact[]>(structureContactsPath, []);

    const removedAssignmentIds = new Set(
      currentAssignments
        .filter((item) => item.participant_id === participantId)
        .map((item) => item.id)
    );

    const nextDepartmentProfiles = currentDepartmentProfiles.map((item) =>
      item.default_contact_participant_id === participantId
        ? { ...item, default_contact_participant_id: null }
        : item
    );
    const nextAssignments = currentAssignments.filter((item) => item.participant_id !== participantId);
    const nextSubstitutions = currentSubstitutions.filter(
      (item) =>
        item.substitute_participant_id !== participantId
        && !(item.source_assignment_id && removedAssignmentIds.has(item.source_assignment_id))
    );
    const nextTemporaryAssignments = currentTemporaryAssignments.filter((item) => item.participant_id !== participantId);
    const nextStructureContacts = currentStructureContacts.filter((item) => item.participant_id !== participantId);

    const structureChanged =
      JSON.stringify(nextDepartmentProfiles) !== JSON.stringify(currentDepartmentProfiles)
      || nextAssignments.length !== currentAssignments.length
      || nextSubstitutions.length !== currentSubstitutions.length
      || nextTemporaryAssignments.length !== currentTemporaryAssignments.length
      || nextStructureContacts.length !== currentStructureContacts.length;

    if (JSON.stringify(nextDepartmentProfiles) !== JSON.stringify(currentDepartmentProfiles)) {
      await this.saveSectionSnapshot(sharedPath, "structure", "department_profiles", currentDepartmentProfiles);
      await writeJsonFile(departmentProfilesPath, nextDepartmentProfiles);
    }
    if (nextAssignments.length !== currentAssignments.length) {
      await this.saveSectionSnapshot(sharedPath, "structure", "position_assignments", currentAssignments);
      await writeJsonFile(assignmentsPath, nextAssignments);
    }
    if (nextSubstitutions.length !== currentSubstitutions.length) {
      await this.saveSectionSnapshot(sharedPath, "structure", "substitutions", currentSubstitutions);
      await writeJsonFile(substitutionsPath, nextSubstitutions);
    }
    if (nextTemporaryAssignments.length !== currentTemporaryAssignments.length) {
      await this.saveSectionSnapshot(sharedPath, "structure", "temporary_assignments", currentTemporaryAssignments);
      await writeJsonFile(temporaryAssignmentsPath, nextTemporaryAssignments);
    }
    if (nextStructureContacts.length !== currentStructureContacts.length) {
      await this.saveSectionSnapshot(sharedPath, "structure", "structure_contacts", currentStructureContacts);
      await writeJsonFile(structureContactsPath, nextStructureContacts);
    }

    const currentReleases = await this.repository.loadReleases(sharedPath);
    const updatedReleases: ReleaseAggregate[] = [];
    for (const currentRelease of currentReleases) {
      const touchesParticipant =
        currentRelease.release.curator_id === participantId
        || currentRelease.release.co_curator_ids.includes(participantId)
        || currentRelease.participants.some((item) => item.participant_id === participantId)
        || (currentRelease.roles ?? []).some((item) => item.participant_id === participantId);
      if (!touchesParticipant) {
        continue;
      }

      const releasePath = path.join(
        sharedPath,
        "releases",
        "by_id",
        `rel_${currentRelease.release.id.replace(/^rel_/, "")}`
      );
      await this.backupService.createEntityBackup(sharedPath, "releases", currentRelease.release.id, releasePath).catch(() => undefined);

      const nextRelease = this.cloneValue(currentRelease);
      nextRelease.release.curator_id = nextRelease.release.curator_id === participantId ? null : nextRelease.release.curator_id;
      nextRelease.release.co_curator_ids = nextRelease.release.co_curator_ids.filter((id) => id !== participantId);
      nextRelease.participants = nextRelease.participants
        .filter((item) => item.participant_id !== participantId)
        .map((item, index) => ({
          ...item,
          credit_order: index + 1
        }));
      nextRelease.roles = (nextRelease.roles ?? [])
        .filter((item) => item.participant_id !== participantId)
        .map((item, index) => ({
          ...item,
          display_order: index + 1
        }));

      const preparedRelease = this.prepareReleaseAggregateForSave(nextRelease, currentRelease, userName);
      await this.writeAggregateFiles(releasePath, this.buildReleaseAggregateFiles(preparedRelease));
      updatedReleases.push(preparedRelease);
    }

    await removePath(basePath);
    await this.rewriteDomainRegistry(sharedPath, "participant");
    if (updatedReleases.length) {
      await this.rewriteDomainRegistry(sharedPath, "release");
    }
    await this.bumpManifest(
      sharedPath,
      userName,
      [
        "participants",
        ...(updatedReleases.length ? ["releases"] : []),
        ...(structureChanged ? ["structure"] : [])
      ]
    );

    try {
      await this.refreshLocalCacheFromShared(sharedPath);
    } catch {
      await this.patchLocalCacheAfterParticipantDelete(participantId, {
        departmentProfiles: nextDepartmentProfiles,
        assignments: nextAssignments,
        substitutions: nextSubstitutions,
        temporaryAssignments: nextTemporaryAssignments,
        structureContacts: nextStructureContacts
      }, updatedReleases).catch(() => undefined);
    }
  }

  async deleteRelease(releaseId: string, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    const basePath = path.join(sharedPath, "releases", "by_id", `rel_${releaseId.replace(/^rel_/, "")}`);
    if (!(await exists(basePath))) {
      throw new Error("Релиз не найден.");
    }

    await this.backupService.createEntityBackup(sharedPath, "releases", releaseId, basePath).catch(() => undefined);
    await removePath(basePath);
    await this.rewriteDomainRegistry(sharedPath, "release");
    await this.bumpManifest(sharedPath, userName, ["releases"]);

    try {
      await this.refreshLocalCacheFromShared(sharedPath);
    } catch {
      await this.patchLocalCacheAfterReleaseDelete(releaseId).catch(() => undefined);
    }
  }

  async saveExternalSources(sources: ExternalSource[], userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "directories",
      userName,
      reason: "Редактирование внешних источников",
      localDraftDomain: "external",
      localDraftId: "external_sources",
      payload: sources,
      run: async () => {
        await this.rewriteExternalSources(sharedPath, sources);
        await this.bumpManifest(sharedPath, userName, ["external"]);
        await this.syncWorkspace(true);
      }
    });
  }

  async saveTemplates(templates: PostTemplate[], userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "directories",
      userName,
      reason: "Редактирование шаблонов постов",
      localDraftDomain: "templates",
      localDraftId: "post_templates",
      payload: templates,
      run: async () => {
        await this.rewriteTemplates(sharedPath, templates);
        await this.bumpManifest(sharedPath, userName, ["templates"]);
        await this.syncWorkspace(true);
      }
    });
  }

  async saveDirectoryRecords(
    fileName: string,
    records: DirectoryRecord[],
    userName: string
  ): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "directories",
      userName,
      reason: `Редактирование ${fileName}`,
      localDraftDomain: "directories",
      localDraftId: fileName,
      payload: records,
      run: async () => {
        const filePath = path.join(sharedPath, "directories", `${fileName}.json`);
        const currentRecords = await this.readJsonIfExists<DirectoryRecord[]>(filePath, []);
        await this.saveSectionSnapshot(sharedPath, "directories", fileName, currentRecords);
        await writeJsonFile(filePath, records);
        await this.bumpManifest(sharedPath, userName, ["directories"]);
        await this.syncWorkspace(true);
      }
    });
  }

  async saveStructureFile(fileName: string, payload: unknown, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "structure",
      userName,
      reason: `Редактирование structure/${fileName}`,
      localDraftDomain: "structure",
      localDraftId: fileName,
      payload,
      run: async () => {
        const filePath = path.join(sharedPath, "structure", fileName);
        const currentPayload = await this.readJsonIfExists<unknown>(filePath, Array.isArray(payload) ? [] : {});
        await this.saveSectionSnapshot(sharedPath, "structure", fileName.replace(/\.json$/i, ""), currentPayload);
        await writeJsonFile(filePath, payload);
        await this.bumpManifest(sharedPath, userName, ["structure"]);
        await this.syncWorkspace(true);
      }
    });
  }

  async previewImport(sourceFile: string, mappingOverrides: ImportMappingOverride[] = []): Promise<ImportPreview> {
    const workspace = await this.requireWorkspace();
    const snapshot = await this.loadWorkspaceSnapshot();
    try {
      const preview = await this.importService.createImportPreview(
        workspace.sharedDatasetPath,
        sourceFile,
        snapshot?.participants ?? [],
        snapshot?.releases ?? [],
        snapshot?.externalSources ?? [],
        mappingOverrides
      );
      await this.persistLocalImportPreview(preview.batch, preview.structured, mappingOverrides, sourceFile);
      return preview;
    } catch (error) {
      if (!isTransientReadError(error)) {
        throw error;
      }
      const structured = await this.importService.analyzeSourceFile(
        sourceFile,
        snapshot?.participants ?? [],
        snapshot?.releases ?? [],
        snapshot?.externalSources ?? [],
        mappingOverrides
      );
      const batch = this.buildImportBatch(sourceFile, structured);
      structured.batch = batch;
      await this.persistLocalImportPreview(batch, structured, mappingOverrides, sourceFile);
      return { batch, structured };
    }
  }

  private shouldReviewImport(structured: StructuredImportPreview): boolean {
    return structured.issues.some((item) => item.severity === "error")
      || (!structured.exchange_bundle && structured.duplicates.length > 0);
  }

  private buildImportBatch(sourceFile: string, structured: StructuredImportPreview): ImportBatch {
    const now = new Date().toISOString();
    return {
      id: `imp_${safeTimestamp().replace(/[-:TZ.]/g, "")}`,
      schema_version: 1,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: "system",
      status: "active",
      source_filename: path.basename(sourceFile),
      source_type: path.extname(sourceFile).toLowerCase() === ".json" ? "json" : "excel",
      queue_status: this.shouldReviewImport(structured) ? "review" : "pending",
      fingerprint: structured.source_signature,
      candidate_matches: structured.duplicates
        .map((item) => item.matched_entity_id)
        .filter((value): value is string => Boolean(value)),
      decision: "pending",
      template_kind: structured.template_kind,
      sheet_names: structured.sheet_names,
      detected_headers: structured.detected_headers.map((item) => item.original),
      detected_entities: {
        participants: structured.participants.length,
        releases: structured.releases.length,
        relations: structured.relations.length,
        external_sources: structured.external_sources.length
      },
      issue_count: structured.issues.length
    };
  }

  async exportImportBundle(targetPath: string, userName: string): Promise<string> {
    const workspace = await this.requireWorkspace();
    const snapshot = await this.cacheService.loadSnapshot() ?? await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      throw new Error("Нет доступного снимка рабочего пространства для экспорта.");
    }

    const bundle: FrondaExchangeBundle = {
      format: "fronda_exchange_bundle",
      version: 1,
      exported_at: new Date().toISOString(),
      exported_by: userName,
      source_workspace: workspace.sharedDatasetPath,
      directories: this.cloneValue(snapshot.directories),
      structure: {
        department_profiles: this.cloneValue(snapshot.departmentProfiles),
        position_assignments: this.cloneValue(snapshot.assignments),
        substitutions: this.cloneValue(snapshot.substitutions),
        temporary_assignments: this.cloneValue(snapshot.temporaryAssignments),
        structure_contacts: this.cloneValue(snapshot.structureContacts),
        structure_notes: this.cloneValue(snapshot.structureNotes)
      },
      participants: this.cloneValue(snapshot.participants),
      releases: this.cloneValue(snapshot.releases),
      external_sources: this.cloneValue(snapshot.externalSources),
      templates: this.cloneValue(snapshot.templates)
    };

    await writeJsonFile(targetPath, bundle);
    return targetPath;
  }

  async getImportPreview(batchId: string): Promise<ImportPreview> {
    const workspace = await this.requireWorkspace();
    const { preview } = await this.loadImportPreviewWithFallback(workspace.sharedDatasetPath, batchId);
    return preview;
  }

  async rebuildImportPreview(batchId: string, mappingOverrides: ImportMappingOverride[]): Promise<ImportPreview> {
    const workspace = await this.requireWorkspace();
    const { preview: currentPreview, sharedLocated, activePath } = await this.loadImportPreviewWithFallback(
      workspace.sharedDatasetPath,
      batchId
    );
    const batch = this.cloneValue(currentPreview.batch);
    const snapshot = await this.loadFreshSharedSnapshot(workspace.sharedDatasetPath);
    const sourceFilePath = path.join(activePath, batch.source_filename);
    const structured = await this.importService.analyzeSourceFile(
      sourceFilePath,
      snapshot?.participants ?? [],
      snapshot?.releases ?? [],
      snapshot?.externalSources ?? [],
      mappingOverrides
    );
    batch.template_kind = structured.template_kind;
    batch.sheet_names = structured.sheet_names;
    batch.detected_headers = structured.detected_headers.map((item) => item.original);
    batch.detected_entities = {
      participants: structured.participants.length,
      releases: structured.releases.length,
      relations: structured.relations.length,
      external_sources: structured.external_sources.length
    };
    batch.issue_count = structured.issues.length;
    batch.candidate_matches = structured.duplicates
      .map((item) => item.matched_entity_id)
      .filter((value): value is string => Boolean(value));
    batch.queue_status = this.shouldReviewImport(structured) ? "review" : "pending";
    batch.updated_at = new Date().toISOString();
    batch.updated_by = "system";
    structured.batch = batch;

    const targetDir = path.join(workspace.sharedDatasetPath, "imports", batch.queue_status, batch.id);
    let activeSharedDir: string | null = sharedLocated?.path ?? null;
    try {
      if (sharedLocated?.path && sharedLocated.path !== targetDir) {
        await fs.mkdir(path.dirname(targetDir), { recursive: true });
        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.rename(sharedLocated.path, targetDir);
        activeSharedDir = targetDir;
      } else if (!sharedLocated) {
        await fs.mkdir(targetDir, { recursive: true });
        const targetSourcePath = path.join(targetDir, batch.source_filename);
        if (await exists(sourceFilePath) && !(await exists(targetSourcePath))) {
          await fs.copyFile(sourceFilePath, targetSourcePath);
        }
        activeSharedDir = targetDir;
      }
    } catch (error) {
      if (!isTransientReadError(error)) {
        throw error;
      }
      activeSharedDir = null;
    }

    if (activeSharedDir) {
      await writeJsonFile(path.join(activeSharedDir, "structured_preview.json"), structured);
      await writeJsonFile(path.join(activeSharedDir, "candidate_matches.json"), structured.duplicates);
      await writeJsonFile(path.join(activeSharedDir, "mapping_overrides.json"), mappingOverrides);
      await writeJsonFile(path.join(activeSharedDir, "review_state.json"), batch);
    }

    await this.persistLocalImportPreview(batch, structured, mappingOverrides, sourceFilePath);
    return { batch, structured };
  }

  async listImportMappingPresets(sourceSignature?: string): Promise<ImportMappingPreset[]> {
    const workspace = await this.requireWorkspace();
    const presetsDir = path.join(workspace.sharedDatasetPath, "imports", "presets");
    await fs.mkdir(presetsDir, { recursive: true });
    const entries = await fs.readdir(presetsDir).catch(() => []);
    const presets: ImportMappingPreset[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const preset = await readJsonFile<ImportMappingPreset>(path.join(presetsDir, entry)).catch(() => null);
      if (!preset) continue;
      if (sourceSignature && preset.source_signature !== sourceSignature) continue;
      presets.push(preset);
    }
    return presets.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  async saveImportMappingPreset(
    name: string,
    sourceSignature: string,
    overrides: ImportMappingOverride[],
    userName: string
  ): Promise<ImportMappingPreset> {
    const workspace = await this.requireWorkspace();
    const presetsDir = path.join(workspace.sharedDatasetPath, "imports", "presets");
    await fs.mkdir(presetsDir, { recursive: true });
    const now = new Date().toISOString();
    const preset: ImportMappingPreset = {
      id: `imp_preset_${safeTimestamp().replace(/[-:TZ.]/g, "")}`,
      name: name.trim() || "Новый набор правил импорта",
      source_signature: sourceSignature,
      overrides,
      created_at: now,
      updated_at: now,
      author: userName
    };
    await writeJsonFile(path.join(presetsDir, `${preset.id}.json`), preset);
    return preset;
  }

  async getSystemDiagnostics(): Promise<SystemDiagnostics> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;
    const backupsRoot = workspace.backupDirectoryPath || this.portablePaths.backupsDir;
    const locksRoot = path.join(sharedPath, "locks");
    const transactionsRoot = path.join(sharedPath, "transactions");
    const localDraftsRoot = path.join(this.portablePaths.draftsDir, "unsaved_edits");

    return {
      shared_paths: {
        backups: backupsRoot,
        locks: locksRoot,
        transactions: transactionsRoot
      },
      local_paths: {
        drafts: localDraftsRoot
      },
      backup_snapshots: await this.collectBackupSnapshots(backupsRoot, 24),
      local_drafts: await this.collectLocalUnsavedDrafts(localDraftsRoot, 50),
      active_locks: await this.collectSystemFiles(locksRoot, "lock", 24),
      pending_transactions: await this.collectSystemFiles(path.join(transactionsRoot, "pending"), "pending_transaction", 24),
      failed_transactions: await this.collectSystemFiles(path.join(transactionsRoot, "failed"), "failed_transaction", 24)
    };
  }

  async getLocalUnsavedDraft(draftPath: string): Promise<LocalUnsavedDraftFile> {
    const resolvedPath = this.resolveLocalDraftPath(draftPath);
    const raw = await readJsonFile<{
      saved_at?: string;
      domain?: string;
      entity_id?: string;
      user_name?: string;
      reason?: string;
      shared_path?: string;
      payload?: unknown;
    }>(resolvedPath);
    const stat = await fs.stat(resolvedPath).catch(() => null);
    const domain = raw.domain ?? "unknown";
    const entityId = raw.entity_id ?? path.basename(resolvedPath, path.extname(resolvedPath));
    return {
      id: path.basename(resolvedPath),
      label: this.buildLocalDraftLabel(domain, entityId, raw.payload),
      domain,
      entity_id: entityId,
      path: resolvedPath,
      saved_at: raw.saved_at ?? (stat ? new Date(stat.mtime).toISOString() : undefined),
      user_name: raw.user_name,
      reason: raw.reason,
      shared_path: raw.shared_path,
      detail: this.buildLocalDraftDetail(domain, entityId, raw.reason),
      payload: raw.payload
    };
  }

  async deleteLocalUnsavedDraft(draftPath: string): Promise<void> {
    const resolvedPath = this.resolveLocalDraftPath(draftPath);
    await removePath(resolvedPath);
  }

  async createManualBackup(userName: string): Promise<ManualBackupResult> {
    const workspace = await this.requireWorkspace();
    const backupRoot = workspace.backupDirectoryPath || this.portablePaths.backupsDir;
    return this.backupService.createManualWorkspaceBackup(workspace.sharedDatasetPath, backupRoot, userName);
  }

  async restoreManualBackup(backupPath: string, _userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    await this.backupService.restoreManualWorkspaceBackup(backupPath, workspace.sharedDatasetPath);
    await this.syncWorkspace(true);
  }

  async finalizeWorkspaceOnExit(userName: string): Promise<void> {
    const workspace = await this.portablePaths.loadWorkspaceConfig();
    if (!workspace) {
      return;
    }

    try {
      await this.syncWorkspace(true);
    } catch {
      // Ignore transient sync errors on exit; closing must still continue.
    }

    try {
      const backupRoot = workspace.backupDirectoryPath || this.portablePaths.backupsDir;
      await this.backupService.createManualWorkspaceBackup(workspace.sharedDatasetPath, backupRoot, userName);
    } catch {
      // Ignore backup errors on exit; closing must still continue.
    }

    try {
      await this.syncWorkspace(true);
    } catch {
      // Ignore final refresh errors on exit; closing must still continue.
    }
  }

  async resolveImportBatch(
    batchId: string,
    action: "create" | "update" | "review" | "reject",
    userName: string,
    targetParticipantId?: string
  ): Promise<void> {
    const workspace = await this.requireWorkspace();
    let { preview, sharedLocated, activePath } = await this.loadImportPreviewWithFallback(
      workspace.sharedDatasetPath,
      batchId
    );
    if (action !== "reject") {
      const mappingOverrides = preview.structured.mapping_overrides
        ?? await this.readJsonIfExists<ImportMappingOverride[]>(
          path.join(activePath, "mapping_overrides.json"),
          []
        );
      await this.rebuildImportPreview(batchId, mappingOverrides);
      const refreshed = await this.loadImportPreviewWithFallback(workspace.sharedDatasetPath, batchId);
      preview = refreshed.preview;
      sharedLocated = refreshed.sharedLocated;
      activePath = refreshed.activePath;
    }
    const batch = this.cloneValue(preview.batch);
    const now = new Date().toISOString();

    const hasBlockingIssues = preview.structured.issues.some((item) => item.severity === "error");

    if ((action === "create" || action === "update") && hasBlockingIssues) {
      throw new Error("В импорте есть критические ошибки. Отправьте файл на ручную проверку или исправьте правила распознавания.");
    }

    if ((action === "create" || action === "update") && preview.structured.exchange_bundle) {
      const alreadyIntegrated = await this.isExchangeBundleAlreadyIntegrated(
        preview.structured.exchange_bundle,
        workspace.sharedDatasetPath
      );
      if (!alreadyIntegrated) {
        await this.applyExchangeBundleImport(preview.structured.exchange_bundle, userName, preview.batch.id, action);
      }
      batch.decision = action;
      batch.queue_status = "resolved";
    } else if (action === "create") {
      await this.applyStructuredImport(preview, "create", userName, targetParticipantId);
      batch.decision = "create";
      batch.queue_status = "resolved";
    } else if (action === "update") {
      await this.applyStructuredImport(preview, "update", userName, targetParticipantId);
      batch.decision = "update";
      batch.queue_status = "resolved";
    } else if (action === "review") {
      batch.decision = "review";
      batch.queue_status = "review";
    } else {
      batch.decision = "reject";
      batch.queue_status = "rejected";
    }

    batch.updated_at = now;
    batch.updated_by = userName;
    preview.structured.batch = batch;

    const nextDir = path.join(workspace.sharedDatasetPath, "imports", batch.queue_status, batch.id);
    let activeSharedDir: string | null = sharedLocated?.path ?? null;
    try {
      await fs.mkdir(path.dirname(nextDir), { recursive: true });
      if (sharedLocated?.path && sharedLocated.path !== nextDir) {
        await fs.rm(nextDir, { recursive: true, force: true });
        await fs.rename(sharedLocated.path, nextDir);
        activeSharedDir = nextDir;
      } else if (!sharedLocated) {
        await fs.mkdir(nextDir, { recursive: true });
        const sourcePath = path.join(activePath, batch.source_filename);
        const targetSourcePath = path.join(nextDir, batch.source_filename);
        if (await exists(sourcePath) && !(await exists(targetSourcePath))) {
          await fs.copyFile(sourcePath, targetSourcePath);
        }
        activeSharedDir = nextDir;
      }
    } catch (error) {
      if (!isTransientReadError(error)) {
        throw error;
      }
      activeSharedDir = null;
    }

    if (activeSharedDir) {
      await writeJsonFile(path.join(activeSharedDir, "review_state.json"), batch);
      await writeJsonFile(path.join(activeSharedDir, "decision.json"), {
        batch_id: batch.id,
        decision: batch.decision,
        target_participant_id: targetParticipantId ?? null,
        at: now,
        by: userName
      });
    }

    await writeJsonFile(path.join(this.getLocalImportBatchPath(batch.id), "decision.json"), {
      batch_id: batch.id,
      decision: batch.decision,
      target_participant_id: targetParticipantId ?? null,
      at: now,
      by: userName
    });
    await this.persistLocalImportPreview(
      batch,
      preview.structured,
      preview.structured.mapping_overrides ?? [],
      path.join(activePath, batch.source_filename)
    );
    try {
      await this.bumpManifest(workspace.sharedDatasetPath, userName, ["imports"]);
    } catch (error) {
      if (!isTransientReadError(error) && !this.isTransientCloudReadMessage(this.normalizeStorageError(error))) {
        throw error;
      }
      console.warn("[FRONDA] Не удалось сразу обновить manifest после обработки импорта.", error);
    }

    try {
      await this.syncWorkspace(true);
    } catch (error) {
      if (!isTransientReadError(error) && !this.isTransientCloudReadMessage(this.normalizeStorageError(error))) {
        throw error;
      }
      console.warn("[FRONDA] Общая папка временно не успела перечитаться после применения импорта.", error);
    }
  }

  async generatePostPreview(releaseId: string, templateId?: string): Promise<GeneratedPostPreview> {
    const snapshot = await this.cacheService.loadSnapshot() ?? await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      throw new Error("Для генерации поста нет доступного снимка рабочего пространства.");
    }
    const release = snapshot.releases.find((item) => item.release.id === releaseId);
    if (!release) {
      throw new Error("Релиз не найден.");
    }
    const template = templateId
      ? snapshot.templates.find((item) => item.id === templateId)
      : snapshot.templates.find((item) => item.id === release.posting.default_post_template_id);
    return this.postGenerator.generate(
      release,
      snapshot.participants,
      snapshot.externalSources,
      template,
      buildPostGeneratorOptions(snapshot)
    );
  }

  async generatePostPreviewFromDraft(
    releaseDraft: ReleaseAggregate,
    templateId?: string
  ): Promise<GeneratedPostPreview> {
    const snapshot = await this.cacheService.loadSnapshot() ?? await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      throw new Error("Для генерации поста нет доступного снимка рабочего пространства.");
    }
    const template = templateId
      ? snapshot.templates.find((item) => item.id === templateId)
      : snapshot.templates.find((item) => item.id === releaseDraft.posting.default_post_template_id);
    return this.postGenerator.generate(
      releaseDraft,
      snapshot.participants,
      snapshot.externalSources,
      template,
      buildPostGeneratorOptions(snapshot)
    );
  }

  async saveGeneratedPost(
    releaseId: string,
    payload: { title: string; content: string; finalized: boolean; template_id?: string | null },
    userName: string
  ): Promise<GeneratedPostSnapshot> {
    const workspace = await this.requireWorkspace();
    const now = new Date().toISOString();
    const postId = `post_${safeTimestamp().replace(/-/g, "")}`;
    const nextPost: GeneratedPostSnapshot = {
      id: postId,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      release_id: releaseId,
      template_id: payload.template_id ?? null,
      title: payload.title,
      content: payload.content,
      finalized: payload.finalized
    };
    const sharedPostPath = path.join(
      workspace.sharedDatasetPath,
      "releases",
      "by_id",
      `rel_${releaseId.replace(/^rel_/, "")}`,
      "posts",
      "generated",
      `${postId}.json`
    );
    await writeJsonFile(sharedPostPath, nextPost);
    await this.bumpManifest(workspace.sharedDatasetPath, userName, ["releases"]);
    await this.syncWorkspace(true);
    return nextPost;
  }

  async deleteGeneratedPost(releaseId: string, postId: string, userName: string): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPostPath = path.join(
      workspace.sharedDatasetPath,
      "releases",
      "by_id",
      `rel_${releaseId.replace(/^rel_/, "")}`,
      "posts",
      "generated",
      `${postId}.json`
    );
    if (!(await exists(sharedPostPath))) {
      throw new Error("Сохраненный пост не найден.");
    }
    await removePath(sharedPostPath);
    await this.bumpManifest(workspace.sharedDatasetPath, userName, ["releases"]);
    await this.syncWorkspace(true);
  }

  async getGitStatus(): Promise<GitStatusSummary> {
    return this.gitService.getStatus();
  }

  async configureGitRepo(repoPath: string): Promise<void> {
    await this.gitService.saveConfig(repoPath);
  }

  async exportGitSnapshot(mode: "config" | "full"): Promise<string> {
    const workspace = await this.requireWorkspace();
    const config = await this.gitService.loadConfig();
    if (!config) {
      throw new Error("Git-репозиторий не настроен.");
    }
    const includePaths =
      mode === "config"
        ? ["manifest.json", "directories", "structure", "templates", "external"]
        : ["manifest.json", "registry", "directories", "structure", "participants", "releases", "external", "templates"];
    await this.gitService.exportSnapshot(workspace.sharedDatasetPath, config.repoPath, includePaths);
    await writeJsonFile(path.join(config.repoPath, "export_manifest.json"), {
      export_type: mode === "config" ? "config_only" : "full_snapshot",
      source_dataset_id: (await this.workspaceService.readManifest(workspace.sharedDatasetPath)).dataset_id,
      exported_at: new Date().toISOString(),
      included_domains: includePaths
    });
    return config.repoPath;
  }

  async gitCommit(message: string, push: boolean): Promise<GitCommitResult> {
    const config = await this.gitService.loadConfig();
    if (!config) {
      throw new Error("Git-репозиторий не настроен.");
    }
    return this.gitService.commit(config.repoPath, message, push);
  }

  private cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private async readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
    if (!(await exists(filePath))) {
      return fallback;
    }
    try {
      return await readJsonFile<T>(filePath);
    } catch {
      return fallback;
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private isPrimitiveValue(value: unknown): value is string | number | boolean | null {
    return value === null || ["string", "number", "boolean"].includes(typeof value);
  }

  private hasMeaningfulValue(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  }

  private uniqueArrayPreservingCurrent<T>(current: T[], next: T[]): T[] {
    const items = [...current];
    const seen = new Set(items.map((item) => JSON.stringify(item)));
    next.forEach((item) => {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(this.cloneValue(item));
      }
    });
    return items;
  }

  private mergeObjectKeepingCurrent<T>(current: T, next: T): T {
    if (Array.isArray(current) && Array.isArray(next)) {
      const primitivesOnly = [...current, ...next].every((item) => this.isPrimitiveValue(item));
      if (primitivesOnly) {
        return this.uniqueArrayPreservingCurrent(current, next) as T;
      }
      return (current.length > 0 ? current : next) as T;
    }
    if (this.isPlainObject(current) && this.isPlainObject(next)) {
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(next)) {
        if (!(key in merged)) {
          merged[key] = this.cloneValue(value);
          continue;
        }
        const currentValue = merged[key];
        if (this.isPlainObject(currentValue) && this.isPlainObject(value)) {
          merged[key] = this.mergeObjectKeepingCurrent(currentValue, value);
          continue;
        }
        if (Array.isArray(currentValue) && Array.isArray(value)) {
          const primitivesOnly = [...currentValue, ...value].every((item) => this.isPrimitiveValue(item));
          merged[key] = primitivesOnly
            ? this.uniqueArrayPreservingCurrent(currentValue, value)
            : (currentValue.length > 0 ? currentValue : value);
          continue;
        }
        merged[key] = this.hasMeaningfulValue(currentValue) ? currentValue : value;
      }
      return merged as T;
    }
    return (this.hasMeaningfulValue(current) ? current : next) as T;
  }

  private mergeRecordsKeepingCurrent<T>(
    current: T[],
    next: T[],
    getKey: (item: T) => string | undefined
  ): T[] {
    const merged = current.map((item) => this.cloneValue(item));
    const indexByKey = new Map<string, number>();
    merged.forEach((item, index) => {
      const key = getKey(item);
      if (key) {
        indexByKey.set(key, index);
      }
    });

    next.forEach((item) => {
      const key = getKey(item);
      if (!key) {
        merged.push(this.cloneValue(item));
        return;
      }
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        indexByKey.set(key, merged.length);
        merged.push(this.cloneValue(item));
        return;
      }
      merged[existingIndex] = this.mergeObjectKeepingCurrent(merged[existingIndex], item);
    });

    return merged;
  }

  private mergeRecordsCreateMissingOnly<T>(
    current: T[],
    next: T[],
    getKey: (item: T) => string | undefined
  ): T[] {
    const merged = current.map((item) => this.cloneValue(item));
    const seen = new Set(
      current
        .map((item) => getKey(item))
        .filter((value): value is string => Boolean(value))
    );

    next.forEach((item) => {
      const key = getKey(item);
      if (key && seen.has(key)) {
        return;
      }
      if (key) {
        seen.add(key);
      }
      merged.push(this.cloneValue(item));
    });

    return merged;
  }

  private getStructureMergeKey(fileName: string, item: unknown): string | undefined {
    if (!this.isPlainObject(item)) {
      return undefined;
    }
    switch (fileName) {
      case "department_profiles.json":
        return typeof item.department_id === "string" ? item.department_id : undefined;
      case "position_assignments.json":
      case "substitutions.json":
      case "temporary_assignments.json":
      case "structure_contacts.json":
      case "structure_notes.json":
        return typeof item.id === "string" ? item.id : undefined;
      default:
        return undefined;
    }
  }

  private mergeParticipantAggregateOnConflict(
    current: ParticipantAggregate,
    draft: ParticipantAggregate,
    userName: string
  ): ParticipantAggregate {
    const merged = this.cloneValue(current);
    merged.entity_manifest = this.mergeObjectKeepingCurrent(current.entity_manifest, draft.entity_manifest);
    merged.entity_manifest.files = this.uniqueArrayPreservingCurrent(
      current.entity_manifest.files ?? [],
      draft.entity_manifest.files ?? []
    );

    merged.profile = this.mergeObjectKeepingCurrent(current.profile, draft.profile);
    merged.profile.contacts = this.uniqueArrayPreservingCurrent(
      current.profile.contacts ?? [],
      draft.profile.contacts ?? []
    );
    merged.profile.posting = this.mergeObjectKeepingCurrent(current.profile.posting ?? {}, draft.profile.posting ?? {});

    merged.org = this.mergeObjectKeepingCurrent(current.org, draft.org);
    merged.org.department_assignments = this.mergeRecordsKeepingCurrent(
      current.org.department_assignments ?? [],
      draft.org.department_assignments ?? [],
      (item) => `${item.department_id}|${item.assignment_status}|${item.started_at ?? ""}|${item.ended_at ?? ""}`
    );
    merged.org.role_assignments = this.mergeRecordsKeepingCurrent(
      current.org.role_assignments ?? [],
      draft.org.role_assignments ?? [],
      (item) => `${item.role_id}|${item.department_id ?? ""}|${item.started_at ?? ""}`
    );
    merged.org.role_assignments = merged.org.role_assignments.map((item) => {
      const draftMatch = (draft.org.role_assignments ?? []).find(
        (candidate) =>
          `${candidate.role_id}|${candidate.department_id ?? ""}|${candidate.started_at ?? ""}` ===
          `${item.role_id}|${item.department_id ?? ""}|${item.started_at ?? ""}`
      );
      if (!draftMatch) {
        return item;
      }
      return {
        ...item,
        note: this.hasMeaningfulValue(draftMatch.note) ? draftMatch.note : item.note,
        level: normalizeParticipantRoleLevel(draftMatch.level) ?? normalizeParticipantRoleLevel(item.level),
        active: typeof draftMatch.active === "boolean" ? draftMatch.active : item.active
      };
    });
    merged.org.desired_role_ids = this.uniqueArrayPreservingCurrent(
      current.org.desired_role_ids ?? [],
      draft.org.desired_role_ids ?? []
    );
    merged.org.skill_entries = this.mergeRecordsKeepingCurrent(
      current.org.skill_entries ?? [],
      draft.org.skill_entries ?? [],
      (item) => item.skill_id
    );
    merged.org.specialization_entries = this.mergeRecordsKeepingCurrent(
      current.org.specialization_entries ?? [],
      draft.org.specialization_entries ?? [],
      (item) => item.specialization_id
    );
    merged.org.staffing_flags = this.uniqueArrayPreservingCurrent(
      current.org.staffing_flags ?? [],
      draft.org.staffing_flags ?? []
    );

    merged.equipment = this.mergeObjectKeepingCurrent(current.equipment, draft.equipment);
    merged.voice_sample = this.mergeObjectKeepingCurrent(current.voice_sample, draft.voice_sample);
    merged.voice_sample.voice_tags = this.uniqueArrayPreservingCurrent(
      current.voice_sample.voice_tags ?? [],
      draft.voice_sample.voice_tags ?? []
    );

    merged.notes = this.mergeRecordsKeepingCurrent(current.notes ?? [], draft.notes ?? [], (item) => item.id);
    merged.discipline = this.mergeRecordsKeepingCurrent(current.discipline ?? [], draft.discipline ?? [], (item) => item.id);
    merged.rewards = this.mergeRecordsKeepingCurrent(current.rewards ?? [], draft.rewards ?? [], (item) => item.id);
    merged.history = this.mergeRecordsKeepingCurrent(current.history ?? [], draft.history ?? [], (item) => item.id);
    merged.history = [
      this.createHistoryEntry({
        actor: userName,
        action: "participant_conflict_merged",
        entityType: "participant",
        entityId: current.profile.id,
        summary: "Локальные правки объединены с актуальной карточкой без удаления уже сохраненных данных"
      }),
      ...merged.history
    ];

    return merged;
  }

  private mergeReleaseAggregateOnConflict(
    current: ReleaseAggregate,
    draft: ReleaseAggregate,
    userName: string
  ): ReleaseAggregate {
    const merged = this.cloneValue(current);
    merged.entity_manifest = this.mergeObjectKeepingCurrent(current.entity_manifest, draft.entity_manifest);
    merged.entity_manifest.files = this.uniqueArrayPreservingCurrent(
      current.entity_manifest.files ?? [],
      draft.entity_manifest.files ?? []
    );

    merged.release = this.mergeObjectKeepingCurrent(current.release, draft.release);
    merged.release.department_ids = this.uniqueArrayPreservingCurrent(
      current.release.department_ids ?? [],
      draft.release.department_ids ?? []
    );
    merged.release.co_curator_ids = this.uniqueArrayPreservingCurrent(
      current.release.co_curator_ids ?? [],
      draft.release.co_curator_ids ?? []
    );

    merged.participants = this.mergeRecordsKeepingCurrent(
      current.participants ?? [],
      draft.participants ?? [],
      (item) => item.id
    );
    merged.roles = this.mergeRecordsKeepingCurrent(current.roles ?? [], draft.roles ?? [], (item) => item.id);
    merged.external = this.mergeRecordsKeepingCurrent(current.external ?? [], draft.external ?? [], (item) => item.id);

    merged.content = this.mergeObjectKeepingCurrent(current.content, draft.content);
    merged.content.genre_ids = this.uniqueArrayPreservingCurrent(
      current.content.genre_ids ?? [],
      draft.content.genre_ids ?? []
    );
    merged.content.tag_ids = this.uniqueArrayPreservingCurrent(
      current.content.tag_ids ?? [],
      draft.content.tag_ids ?? []
    );
    merged.content.platform_links = this.mergeRecordsKeepingCurrent(
      current.content.platform_links ?? [],
      draft.content.platform_links ?? [],
      (item) => `${item.platform_id}|${item.url ?? ""}|${item.label_override ?? ""}`
    );

    merged.posting = this.mergeObjectKeepingCurrent(current.posting, draft.posting);
    merged.posting.post_tags_override = this.uniqueArrayPreservingCurrent(
      current.posting.post_tags_override ?? [],
      draft.posting.post_tags_override ?? []
    );

    merged.generated_posts = this.mergeRecordsKeepingCurrent(
      current.generated_posts ?? [],
      draft.generated_posts ?? [],
      (item) => item.id
    );
    merged.history = this.mergeRecordsKeepingCurrent(current.history ?? [], draft.history ?? [], (item) => item.id);
    merged.history = [
      this.createHistoryEntry({
        actor: userName,
        action: "release_conflict_merged",
        entityType: "release",
        entityId: current.release.id,
        summary: "Локальные правки объединены с актуальным релизом без удаления уже сохраненных данных"
      }),
      ...merged.history
    ];

    return merged;
  }

  private mergeStructurePayloadKeepingCurrent(fileName: string, current: unknown, next: unknown): unknown {
    if (fileName === "onboarding_rules.json") {
      return this.mergeObjectKeepingCurrent(
        this.isPlainObject(current) ? current : {},
        this.isPlainObject(next) ? next : {}
      );
    }
    if (Array.isArray(current) && Array.isArray(next)) {
      return this.mergeRecordsKeepingCurrent(current, next, (item) => this.getStructureMergeKey(fileName, item));
    }
    return this.mergeObjectKeepingCurrent(current, next);
  }

  private mergeStructurePayloadCreateMissingOnly(fileName: string, current: unknown, next: unknown): unknown {
    if (fileName === "onboarding_rules.json") {
      return this.isPlainObject(current) ? this.cloneValue(current) : this.cloneValue(next);
    }
    if (Array.isArray(current) && Array.isArray(next)) {
      return this.mergeRecordsCreateMissingOnly(current, next, (item) => this.getStructureMergeKey(fileName, item));
    }
    return this.hasMeaningfulValue(current) ? this.cloneValue(current) : this.cloneValue(next);
  }

  private async integrateParticipantAggregate(
    participant: ParticipantAggregate,
    userName: string,
    importBatchId?: string,
    mode: "create" | "update" = "update"
  ): Promise<void> {
    const workspace = await this.requireWorkspace();
    const basePath = path.join(
      workspace.sharedDatasetPath,
      "participants",
      "by_id",
      `prt_${participant.profile.id.replace(/^prt_/, "")}`
    );
    const current = (await exists(basePath))
      ? await this.repository.loadParticipantAggregate(basePath).catch(() => null)
      : null;
    if (current && mode === "create") {
      return;
    }
    const integrated = current
      ? this.mergeParticipantAggregateOnConflict(current, participant, userName)
      : this.cloneValue(participant);
    integrated.history = integrated.history ?? [];
    integrated.history.unshift(this.createHistoryEntry({
      actor: userName,
      action: current ? "participant_exchange_merged" : "participant_exchange_imported",
      entityType: "participant",
      entityId: integrated.profile.id,
      importBatchId,
      summary: current
        ? "Локальный экспорт FRONDA объединен с существующей карточкой участника"
        : "Карточка участника импортирована из экспортного файла FRONDA"
    }));
    integrated.entity_manifest.entity_revision = current?.entity_manifest.entity_revision ?? 1;
    await this.saveParticipant(integrated, userName);
  }

  private async integrateReleaseAggregate(
    release: ReleaseAggregate,
    userName: string,
    importBatchId?: string,
    mode: "create" | "update" = "update"
  ): Promise<void> {
    const workspace = await this.requireWorkspace();
    const basePath = path.join(
      workspace.sharedDatasetPath,
      "releases",
      "by_id",
      `rel_${release.release.id.replace(/^rel_/, "")}`
    );
    const current = (await exists(basePath))
      ? await this.repository.loadReleaseAggregate(basePath).catch(() => null)
      : null;
    if (current && mode === "create") {
      return;
    }
    const integrated = current
      ? this.mergeReleaseAggregateOnConflict(current, release, userName)
      : this.cloneValue(release);
    integrated.history = integrated.history ?? [];
    integrated.history.unshift(this.createHistoryEntry({
      actor: userName,
      action: current ? "release_exchange_merged" : "release_exchange_imported",
      entityType: "release",
      entityId: integrated.release.id,
      importBatchId,
      summary: current
        ? "Локальный экспорт FRONDA объединен с существующим релизом"
        : "Релиз импортирован из экспортного файла FRONDA"
    }));
    integrated.entity_manifest.entity_revision = current?.entity_manifest.entity_revision ?? 1;
    await this.saveRelease(integrated, userName);
  }

  private async applyExchangeBundleImport(
    bundle: FrondaExchangeBundle,
    userName: string,
    importBatchId?: string,
    mode: "create" | "update" = "update"
  ): Promise<void> {
    const workspace = await this.requireWorkspace();
    const sharedPath = workspace.sharedDatasetPath;

    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "directories",
      userName,
      reason: "Импорт экспортного файла FRONDA: справочники",
      localDraftDomain: "directories",
      localDraftId: "fronda_exchange_bundle",
      payload: bundle.directories,
      run: async () => {
        for (const [fileName, records] of Object.entries(bundle.directories ?? {})) {
          const filePath = path.join(sharedPath, "directories", `${fileName}.json`);
          const currentRecords = await this.readJsonIfExists<DirectoryRecord[]>(filePath, []);
          const mergedRecords = mode === "create"
            ? this.mergeRecordsCreateMissingOnly(currentRecords, records ?? [], (item) => item.id)
            : this.mergeRecordsKeepingCurrent(currentRecords, records ?? [], (item) => item.id);
          await this.saveSectionSnapshot(sharedPath, "directories", fileName, currentRecords);
          await writeJsonFile(filePath, mergedRecords);
        }
      }
    });

    await this.withSectionSaveProtection({
      sharedPath,
      lockEntityType: "structure",
      userName,
      reason: "Импорт экспортного файла FRONDA: структура",
      localDraftDomain: "structure",
      localDraftId: "fronda_exchange_bundle",
      payload: bundle.structure,
      run: async () => {
        const structureFiles: Array<[string, unknown]> = [
          ["department_profiles.json", bundle.structure.department_profiles],
          ["position_assignments.json", bundle.structure.position_assignments],
          ["substitutions.json", bundle.structure.substitutions],
          ["temporary_assignments.json", bundle.structure.temporary_assignments],
          ["structure_contacts.json", bundle.structure.structure_contacts],
          ["structure_notes.json", bundle.structure.structure_notes]
        ];
        for (const [fileName, payload] of structureFiles) {
          const filePath = path.join(sharedPath, "structure", fileName);
          const currentPayload = await this.readJsonIfExists<unknown>(filePath, Array.isArray(payload) ? [] : {});
          const mergedPayload = mode === "create"
            ? this.mergeStructurePayloadCreateMissingOnly(fileName, currentPayload, payload)
            : this.mergeStructurePayloadKeepingCurrent(fileName, currentPayload, payload);
          await this.saveSectionSnapshot(sharedPath, "structure", fileName.replace(/\.json$/i, ""), currentPayload);
          await writeJsonFile(filePath, mergedPayload);
        }
      }
    });

    if (bundle.external_sources?.length) {
      const registryPath = path.join(sharedPath, "external", "registry.json");
      const currentSources = await this.readJsonIfExists<ExternalSource[]>(registryPath, []);
      const mergedSources = mode === "create"
        ? this.mergeRecordsCreateMissingOnly(currentSources, bundle.external_sources, (item) => item.id)
        : this.mergeRecordsKeepingCurrent(currentSources, bundle.external_sources, (item) => item.id);
      await this.saveSectionSnapshot(sharedPath, "external", "registry", currentSources);
      await this.rewriteExternalSources(sharedPath, mergedSources);
    }

    if (bundle.templates?.length) {
      const registryPath = path.join(sharedPath, "templates", "registry.json");
      const currentTemplates = await this.readJsonIfExists<PostTemplate[]>(registryPath, []);
      const mergedTemplates = mode === "create"
        ? this.mergeRecordsCreateMissingOnly(currentTemplates, bundle.templates, (item) => item.id)
        : this.mergeRecordsKeepingCurrent(currentTemplates, bundle.templates, (item) => item.id);
      await this.saveSectionSnapshot(sharedPath, "templates", "registry", currentTemplates);
      await this.rewriteTemplates(sharedPath, mergedTemplates);
    }

    for (const participant of bundle.participants ?? []) {
      await this.integrateParticipantAggregate(participant, userName, importBatchId, mode);
    }

    for (const release of bundle.releases ?? []) {
      await this.integrateReleaseAggregate(release, userName, importBatchId, mode);
    }

    await this.bumpManifest(sharedPath, userName, ["directories", "structure", "external", "templates", "participants", "releases", "imports"]);
  }

  private async saveSectionSnapshot(
    sharedPath: string,
    domain: string,
    entityId: string,
    payload: unknown
  ): Promise<void> {
    const hasPayload =
      Array.isArray(payload)
        ? payload.length > 0
        : this.isPlainObject(payload)
          ? Object.keys(payload).length > 0
          : payload !== undefined && payload !== null;
    if (!hasPayload) {
      return;
    }
    const timestamp = safeTimestamp();
    const targetPath = path.join(
      sharedPath,
      "transactions",
      "snapshots",
      domain,
      `${entityId}_${timestamp}.json`
    );
    await writeJsonFile(targetPath, {
      saved_at: new Date().toISOString(),
      domain,
      entity_id: entityId,
      payload
    });
  }

  private async loadFreshSharedSnapshot(sharedPath: string): Promise<WorkspaceSnapshot | null> {
    const manifest = await this.workspaceService.readManifest(sharedPath);
    const fallbackSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
    return this.repository.loadWorkspaceSnapshot(sharedPath, manifest, fallbackSnapshot);
  }

  private async isExchangeBundleAlreadyIntegrated(
    bundle: FrondaExchangeBundle,
    sharedPath: string
  ): Promise<boolean> {
    for (const [fileName, records] of Object.entries(bundle.directories ?? {})) {
      const currentRecords = await this.readJsonIfExists<DirectoryRecord[]>(
        path.join(sharedPath, "directories", `${fileName}.json`),
        []
      );
      const currentIds = new Set(currentRecords.map((item) => item.id));
      for (const record of records ?? []) {
        if (!currentIds.has(record.id)) {
          return false;
        }
      }
    }

    const structureFiles: Array<[string, unknown[] | undefined]> = [
      ["department_profiles", bundle.structure?.department_profiles],
      ["position_assignments", bundle.structure?.position_assignments],
      ["substitutions", bundle.structure?.substitutions],
      ["temporary_assignments", bundle.structure?.temporary_assignments],
      ["structure_contacts", bundle.structure?.structure_contacts],
      ["structure_notes", bundle.structure?.structure_notes]
    ];
    for (const [fileName, records] of structureFiles) {
      const currentRecords = await this.readJsonIfExists<unknown[]>(
        path.join(sharedPath, "structure", `${fileName}.json`),
        []
      );
      const currentKeys = new Set(currentRecords.map((item) => this.buildImportComparisonKey(item)));
      for (const record of records ?? []) {
        if (!currentKeys.has(this.buildImportComparisonKey(record))) {
          return false;
        }
      }
    }

    const currentSources = await this.readJsonIfExists<ExternalSource[]>(
      path.join(sharedPath, "external", "registry.json"),
      []
    );
    const currentSourceIds = new Set(currentSources.map((item) => item.id));
    for (const source of bundle.external_sources ?? []) {
      if (!currentSourceIds.has(source.id)) {
        return false;
      }
    }

    const currentTemplates = await this.readJsonIfExists<PostTemplate[]>(
      path.join(sharedPath, "templates", "registry.json"),
      []
    );
    const currentTemplateIds = new Set(currentTemplates.map((item) => item.id));
    for (const template of bundle.templates ?? []) {
      if (!currentTemplateIds.has(template.id)) {
        return false;
      }
    }

    for (const participant of bundle.participants ?? []) {
      const participantId = participant.profile.id;
      if (!(await exists(path.join(sharedPath, "participants", "by_id", participantId)))) {
        return false;
      }
    }

    for (const release of bundle.releases ?? []) {
      const releaseId = release.release.id;
      if (!(await exists(path.join(sharedPath, "releases", "by_id", releaseId)))) {
        return false;
      }
    }

    return true;
  }

  private buildImportComparisonKey(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.buildImportComparisonKey(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.trim()) {
        return `id:${record.id}`;
      }
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${key}:${this.buildImportComparisonKey(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private buildLocalDraftError(message: string, localDraftPath?: string | null): string {
    if (!localDraftPath) {
      return message;
    }
    return `${message} Текущие правки сохранены локально: ${localDraftPath}`;
  }

  private normalizeStorageError(error: unknown): string {
    if (!(error instanceof Error)) {
      return "Не удалось прочитать или обновить данные в общей папке.";
    }
    const message = error.message || "Не удалось прочитать или обновить данные в общей папке.";
    if (/UNKNOWN:\s*unknown error,\s*read/i.test(message) || /\bunknown error,\s*read\b/i.test(message)) {
      return "Общая папка временно недоступна для перечитывания после записи. Сама запись уже могла сохраниться. Подождите синхронизацию облака и нажмите «Обновить данные».";
    }
    return message;
  }

  private getLocalUnsavedDraftsRoot(): string {
    return path.join(this.portablePaths.draftsDir, "unsaved_edits");
  }

  private resolveLocalDraftPath(draftPath: string): string {
    const rootPath = path.resolve(this.getLocalUnsavedDraftsRoot());
    const resolvedPath = path.resolve(draftPath);
    if (resolvedPath !== rootPath && !resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error("Указан путь вне каталога локальных черновиков.");
    }
    return resolvedPath;
  }

  private buildLocalDraftLabel(domain: string, entityId: string, payload: unknown): string {
    if (domain === "participant" && payload && typeof payload === "object") {
      const profile = (payload as { profile?: { display_name?: string; nickname?: string } }).profile;
      return profile?.display_name || profile?.nickname || entityId;
    }
    if (domain === "release" && payload && typeof payload === "object") {
      const release = (payload as { release?: { title_primary?: string; title_secondary?: string } }).release;
      return release?.title_primary || release?.title_secondary || entityId;
    }
    if (domain === "directories") {
      return `Справочник: ${entityId}`;
    }
    if (domain === "templates") {
      return "Шаблоны постов";
    }
    if (domain === "external") {
      return "Субтитры и внешние источники";
    }
    if (domain === "structure") {
      return `Структура: ${entityId}`;
    }
    return entityId;
  }

  private buildLocalDraftDetail(domain: string, entityId: string, reason?: string): string {
    const domainLabelMap: Record<string, string> = {
      participant: "участник",
      release: "релиз",
      directories: "справочник",
      templates: "шаблоны постов",
      external: "субтитры",
      structure: "структура"
    };
    const domainLabel = domainLabelMap[domain] ?? domain;
    return `${domainLabel} • ${entityId}${reason ? ` • ${reason}` : ""}`;
  }

  private async saveLocalUnsavedEdit(args: {
    domain: string;
    entityId: string;
    payload: unknown;
    userName: string;
    reason: string;
    sharedPath: string;
  }): Promise<string> {
    const safeEntityId = args.entityId.replace(/[^\w.-]+/g, "_");
    const timestamp = safeTimestamp();
    const targetPath = path.join(
      this.portablePaths.draftsDir,
      "unsaved_edits",
      args.domain,
      `${safeEntityId}_${timestamp}.json`
    );
    await writeJsonFile(targetPath, {
      saved_at: new Date().toISOString(),
      domain: args.domain,
      entity_id: args.entityId,
      user_name: args.userName,
      reason: args.reason,
      shared_path: args.sharedPath,
      payload: args.payload
    });
    return targetPath;
  }

  private prepareParticipantAggregateForSave(
    participant: ParticipantAggregate,
    current: ParticipantAggregate | null,
    userName: string
  ): ParticipantAggregate {
    const next = this.cloneValue(participant);
    const now = new Date().toISOString();
    next.org.role_assignments = (next.org.role_assignments ?? []).map((item) => ({
      ...item,
      level: normalizeParticipantRoleLevel(item.level)
    }));
    next.entity_manifest.updated_at = now;
    next.entity_manifest.updated_by = userName;
    next.entity_manifest.entity_revision = current
      ? (current.entity_manifest.entity_revision ?? 0) + 1
      : Math.max(next.entity_manifest.entity_revision ?? 1, 1);
    next.profile.updated_at = now;
    next.profile.updated_by = userName;
    next.profile.record_revision = current
      ? (current.profile.record_revision ?? 0) + 1
      : Math.max(next.profile.record_revision ?? 1, 1);
    next.org.updated_at = now;
    next.org.updated_by = userName;
    next.org.record_revision = current
      ? (current.org.record_revision ?? 0) + 1
      : Math.max(next.org.record_revision ?? 1, 1);
    next.equipment.updated_at = now;
    next.equipment.updated_by = userName;
    next.equipment.record_revision = current
      ? (current.equipment.record_revision ?? 0) + 1
      : Math.max(next.equipment.record_revision ?? 1, 1);
    next.voice_sample.updated_at = now;
    next.voice_sample.updated_by = userName;
    next.voice_sample.record_revision = current
      ? (current.voice_sample.record_revision ?? 0) + 1
      : Math.max(next.voice_sample.record_revision ?? 1, 1);
    return next;
  }

  private prepareReleaseAggregateForSave(
    release: ReleaseAggregate,
    current: ReleaseAggregate | null,
    userName: string
  ): ReleaseAggregate {
    const next = this.cloneValue(release);
    const now = new Date().toISOString();
    next.entity_manifest.files = Array.from(new Set([
      ...next.entity_manifest.files,
      "roles.json"
    ]));
    next.entity_manifest.updated_at = now;
    next.entity_manifest.updated_by = userName;
    next.entity_manifest.entity_revision = current
      ? (current.entity_manifest.entity_revision ?? 0) + 1
      : Math.max(next.entity_manifest.entity_revision ?? 1, 1);
    next.release.updated_at = now;
    next.release.updated_by = userName;
    next.release.record_revision = current
      ? (current.release.record_revision ?? 0) + 1
      : Math.max(next.release.record_revision ?? 1, 1);
    next.content.updated_at = now;
    next.content.updated_by = userName;
    next.content.record_revision = current
      ? (current.content.record_revision ?? 0) + 1
      : Math.max(next.content.record_revision ?? 1, 1);
    next.posting.updated_at = now;
    next.posting.updated_by = userName;
    next.posting.record_revision = current
      ? (current.posting.record_revision ?? 0) + 1
      : Math.max(next.posting.record_revision ?? 1, 1);
    return next;
  }

  private buildParticipantAggregateFiles(next: ParticipantAggregate): Record<string, unknown> {
    return {
      "entity_manifest.json": next.entity_manifest,
      "profile.json": next.profile,
      "org.json": next.org,
      "equipment.json": next.equipment,
      "voice_sample.json": next.voice_sample,
      "notes.json": next.notes,
      "discipline.json": next.discipline,
      "rewards.json": next.rewards,
      "history.jsonl": next.history
    };
  }

  private buildReleaseAggregateFiles(next: ReleaseAggregate): Record<string, unknown> {
    return {
      "entity_manifest.json": next.entity_manifest,
      "release.json": next.release,
      "participants.json": next.participants,
      "roles.json": next.roles,
      "external.json": next.external,
      "content.json": next.content,
      "posting.json": next.posting,
      "history.jsonl": next.history
    };
  }

  private async writeAggregateFiles(entityPath: string, files: Record<string, unknown>): Promise<void> {
    for (const [relativePath, payload] of Object.entries(files)) {
      await this.writeAggregateFile(path.join(entityPath, relativePath), payload);
    }
  }

  private async withSectionSaveProtection(args: {
    sharedPath: string;
    lockEntityType: "directories" | "structure";
    userName: string;
    reason: string;
    localDraftDomain: string;
    localDraftId: string;
    payload: unknown;
    run: () => Promise<void>;
  }): Promise<void> {
    const lock = await this.lockService.acquireLock(args.sharedPath, args.lockEntityType, undefined, {
      entity_type: args.lockEntityType,
      user_id: args.userName,
      user_name: args.userName,
      machine_id: os.hostname(),
      session_id: `session_${safeTimestamp()}`,
      base_dataset_revision: 0,
      reason: args.reason
    });
    if (!lock.ok) {
      const localDraftPath = await this.saveLocalUnsavedEdit({
        domain: args.localDraftDomain,
        entityId: args.localDraftId,
        payload: args.payload,
        userName: args.userName,
        reason: lock.reason ?? args.reason,
        sharedPath: args.sharedPath
      }).catch(() => null);
      throw new Error(this.buildLocalDraftError(lock.reason ?? args.reason, localDraftPath));
    }

    try {
      await args.run();
    } catch (error) {
      const reason = this.normalizeStorageError(error);
      const localDraftPath = await this.saveLocalUnsavedEdit({
        domain: args.localDraftDomain,
        entityId: args.localDraftId,
        payload: args.payload,
        userName: args.userName,
        reason,
        sharedPath: args.sharedPath
      }).catch(() => null);
      throw new Error(this.buildLocalDraftError(reason, localDraftPath));
    } finally {
      await this.lockService.releaseLock(args.sharedPath, args.lockEntityType).catch((releaseError) => {
        console.warn(`[FRONDA] Не удалось снять секционный lock ${args.lockEntityType}`, releaseError);
      });
    }
  }

  private async saveEntityAggregate(args: {
    sharedPath: string;
    entityType: "participant" | "release";
    entityId: string;
    entityPath: string;
    draftPayload: ParticipantAggregate | ReleaseAggregate;
    baseEntityRevision?: number;
    loadCurrent: () => Promise<ParticipantAggregate | ReleaseAggregate | null>;
    mergeOnConflict?: (
      current: ParticipantAggregate | ReleaseAggregate,
      draft: ParticipantAggregate | ReleaseAggregate
    ) => ParticipantAggregate | ReleaseAggregate;
    prepareForSave: (
      draftPayload: ParticipantAggregate | ReleaseAggregate,
      current: ParticipantAggregate | ReleaseAggregate | null
    ) => ParticipantAggregate | ReleaseAggregate;
    buildFiles: (preparedPayload: ParticipantAggregate | ReleaseAggregate) => Record<string, unknown>;
    userName: string;
    localDraftDomain: string;
  }): Promise<void> {
    const manifest = await this.readManifestForEntitySave(args.sharedPath);
    const lock = await this.lockService.acquireLock(args.sharedPath, args.entityType, args.entityId, {
      entity_type: args.entityType,
      entity_id: args.entityId,
      user_id: args.userName,
      user_name: args.userName,
      machine_id: os.hostname(),
      session_id: `session_${safeTimestamp()}`,
      base_dataset_revision: manifest.dataset_revision,
      base_entity_revision: args.baseEntityRevision,
      reason: `Редактирование ${args.entityType}`
    });
    if (!lock.ok) {
      const localDraftPath = await this.saveLocalUnsavedEdit({
        domain: args.localDraftDomain,
        entityId: args.entityId,
        payload: args.draftPayload,
        userName: args.userName,
        reason: lock.reason ?? `Редактирование ${args.entityType}`,
        sharedPath: args.sharedPath
      }).catch(() => null);
      throw new Error(this.buildLocalDraftError(lock.reason ?? `Редактирование ${args.entityType}`, localDraftPath));
    }

    try {
      let current: ParticipantAggregate | ReleaseAggregate | null = null;
      try {
        current = await args.loadCurrent();
      } catch (error) {
        if (!isTransientReadError(error)) {
          throw error;
        }
        current = (await exists(args.entityPath))
          ? this.cloneValue(args.draftPayload)
          : null;
      }
      let payloadToSave = this.cloneValue(args.draftPayload);
      if (current) {
        await this.backupService.createEntityBackup(
          args.sharedPath,
          args.entityType === "participant" ? "participants" : "releases",
          args.entityId,
          args.entityPath
        ).catch(() => undefined);
      }
      const expectedRevision = args.baseEntityRevision ?? 0;
      const currentRevision = current?.entity_manifest.entity_revision ?? 0;
      if (current && expectedRevision > 0 && currentRevision !== expectedRevision) {
        const localDraftPath = await this.saveLocalUnsavedEdit({
          domain: args.localDraftDomain,
          entityId: args.entityId,
          payload: args.draftPayload,
          userName: args.userName,
          reason: "Конфликт версий записи, сохранена локальная страховочная копия перед объединением",
          sharedPath: args.sharedPath
        }).catch(() => null);
        if (!args.mergeOnConflict) {
          throw new LocalDraftSavedError(
            this.buildLocalDraftError(
              "Запись уже изменилась в общей папке с момента открытия. Обновите данные, проверьте изменения и только потом сохраняйте повторно.",
              localDraftPath
            )
          );
        }
        payloadToSave = args.mergeOnConflict(current, args.draftPayload);
      }
      if (!current && expectedRevision > 1) {
        const localDraftPath = await this.saveLocalUnsavedEdit({
          domain: args.localDraftDomain,
          entityId: args.entityId,
          payload: args.draftPayload,
          userName: args.userName,
          reason: "Запись не найдена в общей папке",
          sharedPath: args.sharedPath
        }).catch(() => null);
        throw new LocalDraftSavedError(
          this.buildLocalDraftError(
            "Запись уже отсутствует или была пересобрана в общей папке. Обновите данные перед повторным сохранением.",
            localDraftPath
          )
        );
      }

      const preparedPayload = args.prepareForSave(payloadToSave, current);
      const files = args.buildFiles(preparedPayload);
      await this.writeAggregateFiles(args.entityPath, files);
      const finalizedManifest = await this.finalizeSharedEntitySave(
        args.sharedPath,
        args.entityType,
        preparedPayload,
        args.entityPath,
        files,
        args.userName
      );
      await this.patchLocalCacheAfterEntitySave(
        args.entityType,
        preparedPayload,
        finalizedManifest
      ).catch(() => undefined);
      void this.refreshLocalCacheFromShared(args.sharedPath).catch((refreshError) => {
        console.warn(`[FRONDA] Не удалось полностью перечитать общую папку после сохранения ${args.entityType}:${args.entityId}`, refreshError);
      });
    } catch (error) {
      if (error instanceof LocalDraftSavedError) {
        throw error;
      }
      const reason = this.normalizeStorageError(error);
      const localDraftPath = await this.saveLocalUnsavedEdit({
        domain: args.localDraftDomain,
        entityId: args.entityId,
        payload: args.draftPayload,
        userName: args.userName,
        reason,
        sharedPath: args.sharedPath
      }).catch(() => null);
      throw new Error(this.buildLocalDraftError(reason, localDraftPath));
    } finally {
      await this.lockService.releaseLock(args.sharedPath, args.entityType, args.entityId).catch((releaseError) => {
        console.warn(`[FRONDA] Не удалось снять lock ${args.entityType}:${args.entityId}`, releaseError);
      });
    }
  }

  private async readManifestForEntitySave(sharedPath: string): Promise<DatasetManifest> {
    try {
      return await this.workspaceService.readManifest(sharedPath);
    } catch (error) {
      if (!isTransientReadError(error)) {
        throw error;
      }
      const localManifestPath = path.join(
        this.portablePaths.portableDataPath,
        PORTABLE_CACHE_FILES.lastSeenManifest
      );
      const cachedManifest =
        await readJsonFile<DatasetManifest>(localManifestPath).catch(() => null)
        ?? await this.cacheService.loadManifest().catch(() => null)
        ?? await this.readJsonIfExists<DatasetManifest | null>(path.join(sharedPath, "manifest.json"), null);
      if (cachedManifest) {
        return this.cloneValue(cachedManifest);
      }
      throw error;
    }
  }

  private async finalizeSharedEntitySave(
    sharedPath: string,
    entityType: "participant" | "release",
    payload: ParticipantAggregate | ReleaseAggregate,
    entityPath: string,
    files: Record<string, unknown>,
    userName: string
  ): Promise<DatasetManifest | null> {
    const touchedDomains = [entityType === "participant" ? "participants" : "releases"];
    try {
      await this.patchSharedDomainRegistryAfterEntitySave(sharedPath, entityType, payload);
      await this.patchSharedFileRegistryAfterEntitySave(sharedPath, entityPath, files);
      return await this.bumpManifest(sharedPath, userName, touchedDomains);
    } catch (error) {
      if (!isTransientReadError(error) && !this.isTransientCloudReadMessage(this.normalizeStorageError(error))) {
        throw error;
      }
      console.warn(`[FRONDA] Общая папка не успела полностью перечитаться после сохранения ${entityType}:${entityType === "participant" ? (payload as ParticipantAggregate).profile.id : (payload as ReleaseAggregate).release.id}`, error);
    }

    await this.patchSharedDomainRegistryAfterEntitySave(sharedPath, entityType, payload).catch(() => undefined);
    await this.patchSharedFileRegistryAfterEntitySave(sharedPath, entityPath, files).catch(() => undefined);
    return this.bumpManifestWithFallback(sharedPath, userName, touchedDomains).catch(() => null);
  }

  private async patchSharedDomainRegistryAfterEntitySave(
    sharedPath: string,
    entityType: "participant" | "release",
    payload: ParticipantAggregate | ReleaseAggregate
  ): Promise<void> {
    if (entityType === "participant") {
      const participantPayload = this.cloneValue(payload as ParticipantAggregate);
      const registryPath = path.join(sharedPath, "participants", "registry.json");
      const currentRegistry = await this.readJsonIfExists<ParticipantListItem[]>(registryPath, []);
      const nextItem = this.repository.buildParticipantList([participantPayload])[0];
      const participants = [
        ...currentRegistry.filter((item) => item.id !== participantPayload.profile.id),
        nextItem
      ].sort((left, right) => {
        const leftName = left.displayName || left.nickname || left.id;
        const rightName = right.displayName || right.nickname || right.id;
        return leftName.localeCompare(rightName, "ru");
      });
      await writeJsonFile(
        registryPath,
        participants
      );
      return;
    }

    const releasePayload = this.cloneValue(payload as ReleaseAggregate);
    const registryPath = path.join(sharedPath, "releases", "registry.json");
    const currentRegistry = await this.readJsonIfExists<ReleaseListItem[]>(registryPath, []);
    const nextItem = this.repository.buildReleaseList([releasePayload])[0];
    const releases = [
      ...currentRegistry.filter((item) => item.id !== releasePayload.release.id),
      nextItem
    ].sort((left, right) => {
      const leftTitle = left.title || "Новый релиз";
      const rightTitle = right.title || "Новый релиз";
      return leftTitle.localeCompare(rightTitle, "ru");
    });
    await writeJsonFile(
      registryPath,
      releases
    );
  }

  private async patchSharedFileRegistryAfterEntitySave(
    sharedPath: string,
    entityPath: string,
    files: Record<string, unknown>
  ): Promise<void> {
    const registryPath = path.join(sharedPath, "registry", "file_registry.json");
    const currentRegistry = await this.readJsonIfExists<RegistryEntry[]>(registryPath, []);
    const registryByPath = new Map(currentRegistry.map((entry) => [entry.path, entry]));

    for (const relativeFilePath of Object.keys(files)) {
      const fullPath = path.join(entityPath, relativeFilePath);
      const relativePath = path.relative(sharedPath, fullPath).replace(/\\/g, "/");
      const previous = registryByPath.get(relativePath);
      try {
        const stat = await fs.stat(fullPath);
        let hash = previous?.hash ?? "";
        try {
          hash = await hashFile(fullPath);
        } catch (error) {
          if (!isTransientReadError(error)) {
            throw error;
          }
        }
        registryByPath.set(relativePath, {
          path: relativePath,
          domain: relativePath.split("/")[0],
          entity_type: this.detectEntityType(relativePath),
          entity_id: this.detectEntityId(relativePath),
          file_revision: (previous?.file_revision ?? 0) + 1,
          entity_revision: previous?.entity_revision ?? 1,
          hash,
          size: stat.size,
          updated_at: new Date(stat.mtime).toISOString(),
          updated_by: "system",
          last_commit_id: null
        });
      } catch (error) {
        if (!isTransientReadError(error)) {
          throw error;
        }
        if (previous) {
          registryByPath.set(relativePath, previous);
        }
      }
    }

    await writeJsonFile(
      registryPath,
      Array.from(registryByPath.values()).sort((left, right) => left.path.localeCompare(right.path, "ru"))
    );
  }

  private async bumpManifestWithFallback(
    sharedPath: string,
    userName: string,
    touchedDomains: string[]
  ): Promise<DatasetManifest | null> {
    const manifestPath = path.join(sharedPath, "manifest.json");
    const baseManifest =
      await this.readJsonIfExists<DatasetManifest | null>(manifestPath, null)
      ?? await readJsonFile<DatasetManifest>(
        path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.lastSeenManifest)
      ).catch(() => null)
      ?? await this.cacheService.loadManifest().catch(() => null);
    if (!baseManifest) {
      return null;
    }
    const manifest = this.cloneValue(baseManifest);
    manifest.dataset_revision = (manifest.dataset_revision ?? 0) + 1;
    manifest.file_registry_revision = (manifest.file_registry_revision ?? 0) + 1;
    manifest.domain_revisions = manifest.domain_revisions ?? {};
    for (const domain of touchedDomains) {
      manifest.domain_revisions[domain] = (manifest.domain_revisions[domain] ?? 0) + 1;
    }
    manifest.state = "clean";
    manifest.last_commit_id = `tx_${safeTimestamp()}`;
    manifest.last_commit_at = new Date().toISOString();
    await writeJsonFile(manifestPath, manifest);
    await appendChangeLog(sharedPath, {
      at: manifest.last_commit_at,
      by: userName,
      commit_id: manifest.last_commit_id,
      touched_domains: touchedDomains
    });
    return manifest;
  }

  private async refreshLocalCacheFromShared(sharedPath: string): Promise<void> {
    const manifest = await this.workspaceService.readManifest(sharedPath);
    const registry = await this.workspaceService.readFileRegistry(sharedPath);
    const fallbackSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
    const snapshot = await this.repository.loadWorkspaceSnapshot(sharedPath, manifest, fallbackSnapshot);
    const localManifestPath = path.join(
      this.portablePaths.portableDataPath,
      PORTABLE_CACHE_FILES.lastSeenManifest
    );
    const localRegistryPath = path.join(
      this.portablePaths.portableDataPath,
      PORTABLE_CACHE_FILES.lastSeenRegistry
    );
    await this.cacheService.rebuild(snapshot);
    await writeJsonFile(localManifestPath, manifest);
    await writeJsonFile(localRegistryPath, registry);
  }

  private async patchLocalCacheAfterEntitySave(
    entityType: "participant" | "release",
    payload: ParticipantAggregate | ReleaseAggregate,
    manifestOverride?: DatasetManifest | null
  ): Promise<void> {
    const snapshot = await this.cacheService.loadSnapshot();
    const manifest = manifestOverride
      ? this.cloneValue(manifestOverride)
      : await this.cacheService.loadManifest();
    if (!snapshot || !manifest) {
      return;
    }

    if (entityType === "participant") {
      const participantPayload = structuredClone(payload as ParticipantAggregate);
      const participants = [
        ...snapshot.participants.filter((item) => item.profile.id !== participantPayload.profile.id),
        participantPayload
      ].sort((left, right) => {
        const leftOrder = left.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.profile.display_name.localeCompare(right.profile.display_name, "ru");
      });
      await this.cacheService.rebuild({
        ...snapshot,
        manifest,
        participants,
        participantList: this.repository.buildParticipantList(participants)
      });
      await writeJsonFile(
        path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.lastSeenManifest),
        manifest
      );
      return;
    }

    const releasePayload = structuredClone(payload as ReleaseAggregate);
    const releases = [
      ...snapshot.releases.filter((item) => item.release.id !== releasePayload.release.id),
      releasePayload
    ].sort((left, right) => {
      const leftOrder = left.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return (left.release.title_primary || left.release.title_secondary || "Новый релиз")
        .localeCompare(right.release.title_primary || right.release.title_secondary || "Новый релиз", "ru");
    });
    await this.cacheService.rebuild({
      ...snapshot,
      manifest,
      releases,
      releaseList: this.repository.buildReleaseList(releases)
    });
    await writeJsonFile(
      path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.lastSeenManifest),
      manifest
    );
  }

  private async patchLocalCacheAfterParticipantDelete(
    participantId: string,
    structurePatch: {
      departmentProfiles: DepartmentProfile[];
      assignments: PositionAssignment[];
      substitutions: Substitution[];
      temporaryAssignments: TemporaryAssignment[];
      structureContacts: StructureContact[];
    },
    updatedReleases: ReleaseAggregate[]
  ): Promise<void> {
    const snapshot = await this.cacheService.loadSnapshot();
    const manifest = await this.cacheService.loadManifest();
    if (!snapshot || !manifest) {
      return;
    }

    const releaseById = new Map(updatedReleases.map((item) => [item.release.id, structuredClone(item)]));
    const releases = snapshot.releases.map((item) => releaseById.get(item.release.id) ?? item);
    const participants = snapshot.participants.filter((item) => item.profile.id !== participantId);

    await this.cacheService.rebuild({
      ...snapshot,
      manifest,
      participants,
      participantList: this.repository.buildParticipantList(participants),
      releases,
      releaseList: this.repository.buildReleaseList(releases),
      departmentProfiles: structurePatch.departmentProfiles,
      assignments: structurePatch.assignments,
      substitutions: structurePatch.substitutions,
      temporaryAssignments: structurePatch.temporaryAssignments,
      structureContacts: structurePatch.structureContacts
    });
  }

  private async patchLocalCacheAfterReleaseDelete(releaseId: string): Promise<void> {
    const snapshot = await this.cacheService.loadSnapshot();
    const manifest = await this.cacheService.loadManifest();
    if (!snapshot || !manifest) {
      return;
    }

    const releases = snapshot.releases.filter((item) => item.release.id !== releaseId);
    await this.cacheService.rebuild({
      ...snapshot,
      manifest,
      releases,
      releaseList: this.repository.buildReleaseList(releases)
    });
  }

  private async rewriteDomainRegistry(sharedPath: string, entityType: "participant" | "release"): Promise<void> {
    const fallbackSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
    if (entityType === "participant") {
      const participants = await this.loadParticipantsForRegistryRewrite(sharedPath, fallbackSnapshot);
      await writeJsonFile(
        path.join(sharedPath, "participants", "registry.json"),
        this.repository.buildParticipantList(participants)
      );
    } else {
      const releases = await this.loadReleasesForRegistryRewrite(sharedPath, fallbackSnapshot);
      await writeJsonFile(
        path.join(sharedPath, "releases", "registry.json"),
        this.repository.buildReleaseList(releases)
      );
    }
    const registry = await this.buildRegistry(sharedPath);
    await writeJsonFile(path.join(sharedPath, "registry", "file_registry.json"), registry);
  }

  private async ensureSharedIndexesHealthy(
    sharedPath: string,
    manifest: DatasetManifest
  ): Promise<{ manifest: DatasetManifest; repaired: boolean }> {
    const [participantIndexState, releaseIndexState] = await Promise.all([
      this.collectEntityIndexState(sharedPath, "participant"),
      this.collectEntityIndexState(sharedPath, "release")
    ]);

    if (!participantIndexState.reliable || !releaseIndexState.reliable) {
      return { manifest, repaired: false };
    }

    const participantMismatch =
      !this.areSetsEqual(participantIndexState.registryIds, participantIndexState.actualIds);
    const releaseMismatch =
      !this.areSetsEqual(releaseIndexState.registryIds, releaseIndexState.actualIds);

    if (!participantMismatch && !releaseMismatch) {
      return { manifest, repaired: false };
    }

    const fallbackSnapshot = await this.cacheService.loadSnapshot().catch(() => null);
    const touchedDomains = new Set<string>(["registry"]);

    if (participantMismatch) {
      const participants = await this.loadParticipantsForRegistryRewrite(sharedPath, fallbackSnapshot);
      await writeJsonFile(
        path.join(sharedPath, "participants", "registry.json"),
        this.repository.buildParticipantList(participants)
      );
      touchedDomains.add("participants");
    }

    if (releaseMismatch) {
      const releases = await this.loadReleasesForRegistryRewrite(sharedPath, fallbackSnapshot);
      await writeJsonFile(
        path.join(sharedPath, "releases", "registry.json"),
        this.repository.buildReleaseList(releases)
      );
      touchedDomains.add("releases");
    }

    const registry = await this.buildRegistry(sharedPath);
    await writeJsonFile(path.join(sharedPath, "registry", "file_registry.json"), registry);

    const bumpedManifest = await this.bumpManifestWithFallback(
      sharedPath,
      "Система FRONDA",
      Array.from(touchedDomains)
    ).catch(() => manifest);

    return {
      manifest: bumpedManifest ?? manifest,
      repaired: true
    };
  }

  private async loadParticipantsForRegistryRewrite(
    sharedPath: string,
    fallbackSnapshot?: WorkspaceSnapshot | null
  ): Promise<ParticipantAggregate[]> {
    const indexState = await this.collectEntityIndexState(sharedPath, "participant");
    const participants = await this.repository.loadParticipants(sharedPath, fallbackSnapshot?.participants ?? []);
    if (!indexState.reliable || indexState.actualIds.size === 0) {
      return participants;
    }
    const sourceIds = indexState.actualIds;
    return participants.filter((item) => sourceIds.has(item.profile.id));
  }

  private async loadReleasesForRegistryRewrite(
    sharedPath: string,
    fallbackSnapshot?: WorkspaceSnapshot | null
  ): Promise<ReleaseAggregate[]> {
    const indexState = await this.collectEntityIndexState(sharedPath, "release");
    const releases = await this.repository.loadReleases(sharedPath, fallbackSnapshot?.releases ?? []);
    if (!indexState.reliable || indexState.actualIds.size === 0) {
      return releases;
    }
    const sourceIds = indexState.actualIds;
    return releases.filter((item) => sourceIds.has(item.release.id));
  }

  private async collectEntityIndexState(
    sharedPath: string,
    entityType: "participant" | "release"
  ): Promise<{
    reliable: boolean;
    registryIds: Set<string>;
    fileRegistryIds: Set<string>;
    dirIds: Set<string>;
    actualIds: Set<string>;
  }> {
    const registryPath = path.join(
      sharedPath,
      entityType === "participant" ? "participants" : "releases",
      "registry.json"
    );
    const byIdDir = path.join(
      sharedPath,
      entityType === "participant" ? "participants" : "releases",
      "by_id"
    );
    const registryRead = entityType === "participant"
      ? await this.readJsonForRepair<ParticipantListItem[]>(registryPath, [])
      : await this.readJsonForRepair<ReleaseListItem[]>(registryPath, []);
    const fileRegistryRead = await this.readJsonForRepair<RegistryEntry[]>(
      path.join(sharedPath, "registry", "file_registry.json"),
      []
    );
    const dirIdsRead = await this.readDirectoryIdsForRepair(byIdDir);

    const registryIds = new Set(
      registryRead.value
        .map((item) => item?.id)
        .filter((value): value is string => Boolean(value))
    );
    const fileRegistryIds = new Set(
      fileRegistryRead.value
        .filter((entry) =>
          entityType === "participant"
            ? entry.path?.startsWith("participants/by_id/") && entry.path?.endsWith("/profile.json")
            : entry.path?.startsWith("releases/by_id/") && entry.path?.endsWith("/release.json")
        )
        .map((entry) => entry.entity_id)
        .filter((value): value is string => Boolean(value))
    );
    const actualIds = new Set<string>([...fileRegistryIds, ...dirIdsRead.value]);

    return {
      reliable: registryRead.reliable && fileRegistryRead.reliable && dirIdsRead.reliable,
      registryIds,
      fileRegistryIds,
      dirIds: dirIdsRead.value,
      actualIds
    };
  }

  private async readJsonForRepair<T>(
    filePath: string,
    fallback: T
  ): Promise<{ value: T; reliable: boolean }> {
    if (!(await exists(filePath))) {
      return { value: fallback, reliable: true };
    }
    try {
      return {
        value: await readJsonFile<T>(filePath),
        reliable: true
      };
    } catch (error) {
      if (isTransientReadError(error)) {
        return {
          value: fallback,
          reliable: false
        };
      }
      throw error;
    }
  }

  private async readDirectoryIdsForRepair(
    dirPath: string
  ): Promise<{ value: Set<string>; reliable: boolean }> {
    if (!(await exists(dirPath))) {
      return { value: new Set<string>(), reliable: true };
    }
    try {
      const entries = await readDirentsWithRetry(dirPath);
      return {
        value: new Set(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
        ),
        reliable: true
      };
    } catch (error) {
      if (isTransientReadError(error)) {
        return {
          value: new Set<string>(),
          reliable: false
        };
      }
      throw error;
    }
  }

  private areSetsEqual(left: Set<string>, right: Set<string>): boolean {
    if (left.size !== right.size) {
      return false;
    }
    for (const value of left) {
      if (!right.has(value)) {
        return false;
      }
    }
    return true;
  }

  private async rewriteExternalSources(sharedPath: string, sources: ExternalSource[]): Promise<void> {
    const byIdPath = path.join(sharedPath, "external", "by_id");
    await fs.mkdir(byIdPath, { recursive: true });
    const registryPath = path.join(sharedPath, "external", "registry.json");
    const currentSources = await this.readJsonIfExists<ExternalSource[]>(registryPath, []);
    await this.saveSectionSnapshot(sharedPath, "external", "registry", currentSources);
    const activeIds = new Set(sources.map((source) => `${source.id}.json`));
    const currentEntries = await fs.readdir(byIdPath, { withFileTypes: true }).catch(() => []);
    for (const entry of currentEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || activeIds.has(entry.name)) continue;
      await removePath(path.join(byIdPath, entry.name));
    }
    for (const source of sources) {
      await writeJsonFile(path.join(byIdPath, `${source.id}.json`), source);
    }
    await writeJsonFile(registryPath, sources);
    const registry = await this.buildRegistry(sharedPath);
    await writeJsonFile(path.join(sharedPath, "registry", "file_registry.json"), registry);
  }

  private async rewriteTemplates(sharedPath: string, templates: PostTemplate[]): Promise<void> {
    const templatesPath = path.join(sharedPath, "templates", "post_templates");
    await fs.mkdir(templatesPath, { recursive: true });
    const registryPath = path.join(sharedPath, "templates", "registry.json");
    const currentTemplates = await this.readJsonIfExists<PostTemplate[]>(registryPath, []);
    await this.saveSectionSnapshot(sharedPath, "templates", "registry", currentTemplates);
    const activeIds = new Set(templates.map((template) => `${template.id}.json`));
    const currentEntries = await fs.readdir(templatesPath, { withFileTypes: true }).catch(() => []);
    for (const entry of currentEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || activeIds.has(entry.name)) continue;
      await removePath(path.join(templatesPath, entry.name));
    }
    for (const template of templates) {
      await writeJsonFile(path.join(templatesPath, `${template.id}.json`), template);
    }
    await writeJsonFile(registryPath, templates);
    const registry = await this.buildRegistry(sharedPath);
    await writeJsonFile(path.join(sharedPath, "registry", "file_registry.json"), registry);
  }

  private async findImportBatchDirectory(
    sharedPath: string,
    batchId: string
  ): Promise<{ queue: ImportBatch["queue_status"]; path: string } | null> {
    const queues: ImportBatch["queue_status"][] = ["incoming", "pending", "review", "resolved", "rejected"];
    for (const queue of queues) {
      const batchPath = path.join(sharedPath, "imports", queue, batchId);
      if (await exists(batchPath)) {
        return { queue, path: batchPath };
      }
    }
    return null;
  }

  private getLocalImportBatchPath(batchId: string): string {
    return path.join(this.portablePaths.draftsDir, "imports", batchId);
  }

  private async readImportPreviewFromPath(batchPath: string): Promise<ImportPreview> {
    const batch = await readJsonFile<ImportBatch>(path.join(batchPath, "review_state.json"));
    const structured = await readJsonFile<StructuredImportPreview>(path.join(batchPath, "structured_preview.json"));
    return { batch, structured };
  }

  private async persistLocalImportPreview(
    batch: ImportBatch,
    structured: StructuredImportPreview,
    mappingOverrides: ImportMappingOverride[],
    sourceFilePath?: string
  ): Promise<void> {
    const targetDir = this.getLocalImportBatchPath(batch.id);
    await fs.mkdir(targetDir, { recursive: true });
    if (sourceFilePath && await exists(sourceFilePath)) {
      const targetSourcePath = path.join(targetDir, batch.source_filename);
      if (path.resolve(sourceFilePath) !== path.resolve(targetSourcePath)) {
        await fs.copyFile(sourceFilePath, targetSourcePath).catch(() => undefined);
      }
    }
    await writeJsonFile(path.join(targetDir, "structured_preview.json"), structured);
    await writeJsonFile(path.join(targetDir, "candidate_matches.json"), structured.duplicates);
    await writeJsonFile(path.join(targetDir, "mapping_overrides.json"), mappingOverrides);
    await writeJsonFile(path.join(targetDir, "review_state.json"), batch);
  }

  private async loadImportPreviewWithFallback(
    sharedPath: string,
    batchId: string
  ): Promise<{
    preview: ImportPreview;
    sharedLocated: { queue: ImportBatch["queue_status"]; path: string } | null;
    activePath: string;
  }> {
    const sharedLocated = await this.findImportBatchDirectory(sharedPath, batchId);
    let lastError: unknown;

    if (sharedLocated) {
      try {
        const preview = await this.readImportPreviewFromPath(sharedLocated.path);
        return {
          preview,
          sharedLocated,
          activePath: sharedLocated.path
        };
      } catch (error) {
        lastError = error;
        if (!isTransientReadError(error)) {
          throw error;
        }
      }
    }

    const localPath = this.getLocalImportBatchPath(batchId);
    if (await exists(localPath)) {
      const preview = await this.readImportPreviewFromPath(localPath);
      return {
        preview,
        sharedLocated,
        activePath: localPath
      };
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("Файл импорта не найден.");
  }

  private async applyStructuredImport(
    preview: ImportPreview,
    action: "create" | "update",
    userName: string,
    targetParticipantId?: string
  ): Promise<void> {
    const snapshot = await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      throw new Error("Локальный снимок рабочего пространства недоступен.");
    }

    const participantTargets = new Map<string, string>();
    const releaseTargets = new Map<string, string>();
    const externalTargets = new Map<string, string>();

    for (const candidate of preview.structured.participants) {
      const duplicateId = this.resolveParticipantDuplicateId(candidate, targetParticipantId);
      if (action === "update" && duplicateId) {
        const existing = snapshot.participants.find((item) => item.profile.id === duplicateId);
        if (existing) {
          const updated = this.applyImportCandidateToParticipant(existing, candidate, userName, preview.batch.id);
          await this.saveParticipant(updated, userName);
          participantTargets.set(candidate.id, updated.profile.id);
          continue;
        }
      }
      if (action === "create" && duplicateId) {
        participantTargets.set(candidate.id, duplicateId);
        continue;
      }
      const created = this.buildParticipantFromImportCandidate(candidate, userName, preview.batch.id);
      await this.saveParticipant(created, userName);
      participantTargets.set(candidate.id, created.profile.id);
    }

    for (const candidate of preview.structured.releases) {
      const duplicateId = this.resolveReleaseDuplicateId(candidate);
      if (action === "update" && duplicateId) {
        const existing = snapshot.releases.find((item) => item.release.id === duplicateId);
        if (existing) {
          const updated = this.applyImportCandidateToRelease(existing, candidate, userName, preview.batch.id);
          await this.saveRelease(updated, userName);
          releaseTargets.set(candidate.id, updated.release.id);
          continue;
        }
      }
      if (action === "create" && duplicateId) {
        releaseTargets.set(candidate.id, duplicateId);
        continue;
      }
      const created = this.buildReleaseFromImportCandidate(candidate, userName, preview.batch.id);
      await this.saveRelease(created, userName);
      releaseTargets.set(candidate.id, created.release.id);
    }

    if (preview.structured.external_sources.length > 0) {
      const nextExternal = snapshot.externalSources.map((item) => JSON.parse(JSON.stringify(item)) as ExternalSource);
      for (const candidate of preview.structured.external_sources) {
        const duplicateId = candidate.duplicate_matches.find((item) => item.domain === "external")?.matched_entity_id;
        if (duplicateId) {
          externalTargets.set(slugId(candidate.label), duplicateId);
          if (action === "update") {
            const target = nextExternal.find((item) => item.id === duplicateId);
            if (target) {
              target.comment = [target.comment, candidate.label].filter(Boolean).join(" | ");
              mergeUniqueStrings(target.aliases, [candidate.label]);
            }
          }
          continue;
        }
        const created = this.buildExternalSourceFromImportCandidate(candidate, userName);
        nextExternal.push(created);
        externalTargets.set(slugId(candidate.label), created.id);
      }
      await this.saveExternalSources(nextExternal, userName);
    }

    if (preview.structured.notes.length || preview.structured.discipline.length || preview.structured.rewards.length) {
      await this.applyParticipantSideEffects(
        preview.structured.notes,
        preview.structured.discipline,
        preview.structured.rewards,
        participantTargets,
        userName,
        preview.batch.id
      );
    }

    if (preview.structured.relations.length > 0) {
      await this.applyReleaseRelations(
        preview.structured.relations,
        participantTargets,
        releaseTargets,
        externalTargets,
        userName,
        preview.batch.id
      );
    }
  }

  private buildParticipantFromImportCandidate(
    candidate: ImportParticipantCandidate,
    userName: string,
    importBatchId?: string
  ): ParticipantAggregate {
    const now = new Date().toISOString();
    const suffix = safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12);
    const id = `prt_${suffix}`;
    const nickname = candidate.nickname ?? slugId(candidate.display_label || id);
    const displayName = candidate.display_name ?? candidate.real_name ?? candidate.display_label ?? nickname;
    const realName = candidate.real_name ?? "";
    const entityManifest: EntityManifest = {
      entity_id: id,
      entity_type: "participant",
      entity_revision: 1,
      files: [
        "entity_manifest.json",
        "profile.json",
        "org.json",
        "equipment.json",
        "voice_sample.json",
        "notes.json",
        "discipline.json",
        "rewards.json",
        "history.jsonl"
      ],
      updated_at: now,
      updated_by: userName,
      last_commit_id: null
    };
    const profile: ParticipantProfile = {
      id,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      nickname,
      real_name: realName || undefined,
      display_name: displayName,
      participant_status_id: "active",
      reserve_flag: false,
      joined_at: now,
      availability_note: candidate.availability_note,
      contacts: [],
      posting: {
        mention: candidate.mention,
        mention_id: candidate.mention_id,
        display_name_for_post: candidate.display_name_for_post ?? displayName,
        vk_slug: candidate.vk_slug,
        vk_url: candidate.vk_url,
        post_copy_string: candidate.mention
          ? `${candidate.mention} (${candidate.nickname ?? displayName})`
          : (candidate.nickname ?? displayName)
      }
    };
    const org: ParticipantOrg = {
      id: `${id}_org`,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      department_assignments: candidate.department_ids.map((departmentId, index) => ({
        department_id: departmentId,
        assignment_status: "participates",
        primary_flag: index === 0
      })),
      role_assignments: candidate.role_ids.map((roleId) => ({
        role_id: roleId,
        active: true
      })),
      desired_role_ids: [],
      skill_entries: candidate.skill_ids.map((skillId) => ({
        skill_id: skillId,
        confirmed: false
      })),
      specialization_entries: candidate.specialization_ids.map((specializationId) => ({
        specialization_id: specializationId
      })),
      staffing_flags: []
    };
    const equipment: ParticipantEquipment = {
      id: `${id}_equipment`,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      hardware_notes: candidate.equipment_notes.join("; ")
    };
    const voiceSample: ParticipantVoiceSample = {
      id: `${id}_voice`,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      voice_sample_present: candidate.voice_sample_refs.length > 0,
      voice_sample_url: candidate.voice_sample_refs[0],
      voice_tags: candidate.voice_sample_refs.length > 0 ? ["imported"] : []
    };
    const notes: ParticipantNote[] = [];
    const discipline: DisciplinaryEvent[] = [];
    const rewards: RewardEvent[] = [];
    const history: EntityHistoryEntry[] = [this.createHistoryEntry({
      actor: userName,
      action: "participant_created_from_import",
      entityType: "participant",
      entityId: id,
      importBatchId,
      summary: `Создан участник ${displayName} из импорта`
    })];

    return {
      entity_manifest: entityManifest,
      profile,
      org,
      equipment,
      voice_sample: voiceSample,
      notes,
      discipline,
      rewards,
      history
    };
  }

  private applyImportCandidateToParticipant(
    existing: ParticipantAggregate,
    candidate: ImportParticipantCandidate,
    userName: string,
    importBatchId?: string
  ): ParticipantAggregate {
    const next = JSON.parse(JSON.stringify(existing)) as ParticipantAggregate;
    const now = new Date().toISOString();
    next.entity_manifest.updated_at = now;
    next.entity_manifest.updated_by = userName;
    next.entity_manifest.entity_revision += 1;
    next.profile.updated_at = now;
    next.profile.updated_by = userName;
    next.profile.record_revision += 1;

    next.profile.nickname = candidate.nickname ?? next.profile.nickname;
    next.profile.real_name = candidate.real_name ?? next.profile.real_name;
    next.profile.display_name = candidate.display_name ?? next.profile.display_name;
    next.profile.availability_note = candidate.availability_note ?? next.profile.availability_note;
    next.profile.posting.mention = candidate.mention ?? next.profile.posting.mention;
    next.profile.posting.vk_url = candidate.vk_url ?? next.profile.posting.vk_url;
    next.profile.posting.vk_slug = candidate.vk_slug ?? next.profile.posting.vk_slug;
    next.profile.posting.display_name_for_post = candidate.display_name_for_post ?? next.profile.posting.display_name_for_post;

    mergeUniqueObjects(
      next.org.department_assignments,
      candidate.department_ids.map((departmentId, index) => ({
        department_id: departmentId,
        assignment_status: "participates",
        primary_flag: index === 0
      })),
      (item) => `${item.department_id}|${item.assignment_status}`
    );
    mergeUniqueObjects(
      next.org.role_assignments,
      candidate.role_ids.map((roleId) => ({
        role_id: roleId,
        active: true
      })),
      (item) => `${item.role_id}|${item.department_id ?? ""}`
    );
    mergeUniqueObjects(
      next.org.skill_entries,
      candidate.skill_ids.map((skillId) => ({
        skill_id: skillId,
        confirmed: false
      })),
      (item) => item.skill_id
    );
    mergeUniqueObjects(
      next.org.specialization_entries,
      candidate.specialization_ids.map((specializationId) => ({
        specialization_id: specializationId
      })),
      (item) => item.specialization_id
    );
    if (candidate.equipment_notes.length > 0) {
      next.equipment.hardware_notes = [next.equipment.hardware_notes, candidate.equipment_notes.join("; ")]
        .filter(Boolean)
        .join(" | ");
    }
    if (candidate.voice_sample_refs.length > 0) {
      next.voice_sample.voice_sample_present = true;
      next.voice_sample.voice_sample_url = next.voice_sample.voice_sample_url ?? candidate.voice_sample_refs[0];
      mergeUniqueStrings(next.voice_sample.voice_tags, ["imported"]);
    }
    next.history = next.history ?? [];
    next.history.push(this.createHistoryEntry({
      actor: userName,
      action: "participant_updated_from_import",
      entityType: "participant",
      entityId: next.profile.id,
      importBatchId,
      summary: `Карточка обновлена данными импорта (${candidate.display_label})`
    }));

    return next;
  }

  private buildReleaseFromImportCandidate(
    candidate: ImportReleaseCandidate,
    userName: string,
    importBatchId?: string
  ): ReleaseAggregate {
    const now = new Date().toISOString();
    const id = `rel_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`;
    const entity_manifest: EntityManifest = {
      entity_id: id,
      entity_type: "release",
      entity_revision: 1,
      files: [
        "entity_manifest.json",
        "release.json",
        "participants.json",
        "roles.json",
        "external.json",
        "content.json",
        "posting.json",
        "history.jsonl"
      ],
      updated_at: now,
      updated_by: userName,
      last_commit_id: null
    };
    return {
      entity_manifest,
      release: {
        id,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: now,
        updated_at: now,
        updated_by: userName,
        status: "active",
        title_primary: candidate.title_primary,
        release_type_id: candidate.release_type_id ?? "standard_release",
        release_status_id: candidate.release_status_id ?? "in_work",
        primary_department_id: candidate.primary_department_id ?? candidate.department_ids[0] ?? "unknown_department",
        department_ids: candidate.department_ids.length > 0 ? candidate.department_ids : [candidate.primary_department_id ?? "unknown_department"],
        curator_id: candidate.curator_hint ? slugId(candidate.curator_hint) : null,
        co_curator_ids: [],
        commissioned_flag: false,
        top_release_flag: false,
        training_flag: false,
        legacy_flag: false,
        archival_state: "normal",
        release_visibility: "internal",
        season_number: candidate.season_number,
        episode_start: candidate.episode_start,
        episode_end: candidate.episode_end,
        release_year: candidate.release_year
      },
      participants: [],
      roles: [],
      external: [],
      content: {
        id: `${id}_content`,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: now,
        updated_at: now,
        updated_by: userName,
        status: "active",
        release_id: id,
        description_short: "",
        description_full: candidate.notes[0],
        genre_ids: candidate.genre_labels.map(slugId),
        tag_ids: candidate.tag_labels.map(slugId),
        platform_links: candidate.platform_labels.map((platformLabel, index) => ({
          platform_id: slugId(platformLabel),
          label_override: platformLabel,
          display_order: index + 1,
          is_primary: index === 0,
          active_flag: true
        }))
      },
      posting: {
        id: `${id}_posting`,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: now,
        updated_at: now,
        updated_by: userName,
        status: "active",
        release_id: id,
        post_tags_override: candidate.tag_labels,
        hide_empty_blocks_flag: true
      },
      generated_posts: [],
      history: [this.createHistoryEntry({
        actor: userName,
        action: "release_created_from_import",
        entityType: "release",
        entityId: id,
        importBatchId,
        summary: `Создан релиз ${candidate.title_primary || candidate.title_secondary || "без названия"} из импорта`
      })]
    };
  }

  private applyImportCandidateToRelease(
    existing: ReleaseAggregate,
    candidate: ImportReleaseCandidate,
    userName: string,
    importBatchId?: string
  ): ReleaseAggregate {
    const next = JSON.parse(JSON.stringify(existing)) as ReleaseAggregate;
    const now = new Date().toISOString();
    next.entity_manifest.updated_at = now;
    next.entity_manifest.updated_by = userName;
    next.entity_manifest.entity_revision += 1;
    next.release.updated_at = now;
    next.release.updated_by = userName;
    next.release.record_revision += 1;
    next.release.title_primary = candidate.title_primary ?? next.release.title_primary;
    next.release.release_type_id = candidate.release_type_id ?? next.release.release_type_id;
    next.release.release_status_id = candidate.release_status_id ?? next.release.release_status_id;
    next.release.primary_department_id = candidate.primary_department_id ?? next.release.primary_department_id;
    mergeUniqueStrings(next.release.department_ids, candidate.department_ids);
    next.release.season_number = candidate.season_number ?? next.release.season_number;
    next.release.episode_start = candidate.episode_start ?? next.release.episode_start;
    next.release.episode_end = candidate.episode_end ?? next.release.episode_end;
    next.release.release_year = candidate.release_year ?? next.release.release_year;
    mergeUniqueStrings(next.content.genre_ids, candidate.genre_labels.map(slugId));
    mergeUniqueStrings(next.content.tag_ids, candidate.tag_labels.map(slugId));
    mergeUniqueObjects(
      next.content.platform_links,
      candidate.platform_labels.map((platformLabel, index) => ({
        platform_id: slugId(platformLabel),
        label_override: platformLabel,
        display_order: next.content.platform_links.length + index + 1,
        is_primary: next.content.platform_links.length === 0 && index === 0,
        active_flag: true
      })),
      (item) => item.platform_id
    );
    if (candidate.notes.length > 0) {
      next.content.description_full = [next.content.description_full, ...candidate.notes].filter(Boolean).join(" | ");
      next.content.description_short = "";
    }
    next.history = next.history ?? [];
    next.history.push(this.createHistoryEntry({
      actor: userName,
      action: "release_updated_from_import",
      entityType: "release",
      entityId: next.release.id,
      importBatchId,
      summary: `Релиз обновлен данными импорта (${candidate.title_primary || candidate.title_secondary || "без названия"})`
    }));
    return next;
  }

  private buildExternalSourceFromImportCandidate(
    candidate: ImportExternalSourceCandidate,
    userName: string
  ): ExternalSource {
    const now = new Date().toISOString();
    return {
      id: `ext_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`,
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: userName,
      status: "active",
      external_source_type_id: candidate.source_type_hint ?? "external",
      name: candidate.label,
      aliases: [],
      contacts: [],
      links: candidate.links,
      preferred_post_label: candidate.label
    };
  }

  private async applyParticipantSideEffects(
    notes: ImportNoteCandidate[],
    discipline: ImportDisciplinaryCandidate[],
    rewards: ImportRewardCandidate[],
    participantTargets: Map<string, string>,
    userName: string,
    importBatchId?: string
  ): Promise<void> {
    const snapshot = await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      return;
    }
    const affected = new Map<string, ParticipantAggregate>();
    const getTarget = (participantId?: string, participantMatchId?: string) => {
      if (participantId && participantTargets.has(participantId)) {
        return participantTargets.get(participantId);
      }
      return participantMatchId;
    };
    const ensure = (id: string) => {
      if (affected.has(id)) {
        return affected.get(id)!;
      }
      const existing = snapshot.participants.find((item) => item.profile.id === id);
      if (!existing) {
        throw new Error(`Участник ${id} не найден для применения побочных данных импорта.`);
      }
      const clone = JSON.parse(JSON.stringify(existing)) as ParticipantAggregate;
      affected.set(id, clone);
      return clone;
    };

    notes.forEach((note) => {
      const targetId = getTarget(note.participant_candidate_id, note.participant_match_id);
      if (!targetId) return;
      const participant = ensure(targetId);
      participant.notes.push({
        id: `note_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: userName,
        status: "active",
        participant_id: targetId,
        note_type_id: note.note_type_hint ?? "working",
        title: note.title,
        body: note.body,
        priority: "normal",
        pinned: false,
        visibility_scope: "OPS",
        active_flag: true
      });
    });

    discipline.forEach((item) => {
      const targetId = getTarget(item.participant_candidate_id, item.participant_match_id);
      if (!targetId) return;
      const participant = ensure(targetId);
      participant.discipline.push({
        id: `disc_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: userName,
        status: "active",
        participant_id: targetId,
        disciplinary_type_id: item.severity,
        severity: item.severity,
        date: new Date().toISOString(),
        description: item.description,
        active_flag: true
      });
    });

    rewards.forEach((item) => {
      const targetId = getTarget(item.participant_candidate_id, item.participant_match_id);
      if (!targetId) return;
      const participant = ensure(targetId);
      participant.rewards.push({
        id: `reward_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`,
        schema_version: DATASET_SCHEMA_VERSION,
        record_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: userName,
        status: "active",
        participant_id: targetId,
        reward_type_id: item.tags[0] ?? "positive_note",
        date: new Date().toISOString(),
        description: item.description,
        tags: item.tags
      });
    });

    for (const participant of affected.values()) {
      participant.history = participant.history ?? [];
      participant.history.push(this.createHistoryEntry({
        actor: userName,
        action: "participant_side_effects_imported",
        entityType: "participant",
        entityId: participant.profile.id,
        importBatchId,
        summary: "Добавлены заметки / дисциплина / награды из импорта"
      }));
      await this.saveParticipant(participant, userName);
    }
  }

  private async applyReleaseRelations(
    relations: ImportReleaseRelationCandidate[],
    participantTargets: Map<string, string>,
    releaseTargets: Map<string, string>,
    externalTargets: Map<string, string>,
    userName: string,
    importBatchId?: string
  ): Promise<void> {
    const snapshot = await this.loadWorkspaceSnapshot();
    if (!snapshot) {
      return;
    }
    const affected = new Map<string, ReleaseAggregate>();
    const ensure = (id: string) => {
      if (affected.has(id)) return affected.get(id)!;
      const existing = snapshot.releases.find((item) => item.release.id === id);
      if (!existing) {
        throw new Error(`Релиз ${id} не найден для применения связей импорта.`);
      }
      const clone = JSON.parse(JSON.stringify(existing)) as ReleaseAggregate;
      affected.set(id, clone);
      return clone;
    };

    relations.forEach((relation) => {
      const releaseId = relation.release_candidate_id ? releaseTargets.get(relation.release_candidate_id) : relation.release_match_id;
      if (!releaseId) {
        return;
      }
      const draft = ensure(releaseId);
      const participantId = relation.participant_candidate_id ? participantTargets.get(relation.participant_candidate_id) : relation.participant_match_id;
      if (participantId) {
        relation.role_labels.forEach((roleLabel, index) => {
          const roleId = canonicalImportedRoleId(roleLabel || "role");
          const existsRelation = draft.participants.some((item) => item.participant_id === participantId && item.role_id === roleId);
          if (existsRelation) {
            return;
          }
          const assignment: ReleaseParticipantAssignment = {
            id: `rpa_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}_${index}`,
            schema_version: DATASET_SCHEMA_VERSION,
            record_revision: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: userName,
            status: "active",
            release_id: releaseId,
            participant_id: participantId,
            role_id: roleId,
            credit_group_id: canonicalImportedPostGroup(roleLabel || roleId),
            credit_order: draft.participants.length + index + 1,
            is_primary_for_role: index === 0,
            include_in_post: true,
            include_in_internal_stats: true,
            active_flag: true
          };
          draft.participants.push(assignment);
        });
      }
      if (relation.external_source_label) {
        const externalLabel = relation.external_source_label;
        const externalId = externalTargets.get(slugId(externalLabel))
          ?? snapshot.externalSources.find((item) => item.name === externalLabel || item.aliases.includes(externalLabel))?.id;
        if (externalId && !draft.external.some((item) => item.external_source_id === externalId)) {
          const assignment: ReleaseExternalAssignment = {
            id: `rea_${safeTimestamp().replace(/[-:TZ.]/g, "").slice(-12)}`,
            schema_version: DATASET_SCHEMA_VERSION,
            record_revision: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: userName,
            status: "active",
            release_id: releaseId,
            external_source_id: externalId,
            credit_group_id: "external_source",
            display_order: draft.external.length + 1,
            include_in_post: true,
            is_primary_source: draft.external.length === 0
          };
          draft.external.push(assignment);
        }
      }
    });

    for (const release of affected.values()) {
      release.history = release.history ?? [];
      release.history.push(this.createHistoryEntry({
        actor: userName,
        action: "release_relations_imported",
        entityType: "release",
        entityId: release.release.id,
        importBatchId,
        summary: "Добавлены связи участники/источники субтитров из импорта"
      }));
      await this.saveRelease(release, userName);
    }
  }

  private createHistoryEntry(args: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    importBatchId?: string;
    summary: string;
  }): EntityHistoryEntry {
    return {
      id: `hist_${safeTimestamp().replace(/[-:TZ.]/g, "")}`,
      at: new Date().toISOString(),
      actor: args.actor,
      action: args.action,
      entity_type: args.entityType,
      entity_id: args.entityId,
      source: args.importBatchId ? "import" : "manual",
      import_batch_id: args.importBatchId ?? null,
      summary: args.summary
    };
  }

  private resolveParticipantDuplicateId(
    candidate: ImportParticipantCandidate,
    targetParticipantId?: string
  ): string | undefined {
    return targetParticipantId ?? candidate.duplicate_matches.find((item) => item.domain === "participant")?.matched_entity_id;
  }

  private resolveReleaseDuplicateId(candidate: ImportReleaseCandidate): string | undefined {
    return candidate.duplicate_matches.find((item) => item.domain === "release")?.matched_entity_id;
  }

  private async writeAggregateFile(filePath: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (filePath.endsWith(".jsonl")) {
      const lines = Array.isArray(payload)
        ? payload.map((item) => JSON.stringify(item)).join("\n")
        : JSON.stringify(payload);
      const nextContent = lines.length > 0 ? `${lines}\n` : "";
      const currentContent = await fs.readFile(filePath, "utf8").catch(() => null);
      if (currentContent === nextContent) {
        return;
      }
      await fs.writeFile(filePath, nextContent, "utf8");
      return;
    }
    const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
    const currentContent = await fs.readFile(filePath, "utf8").catch(() => null);
    if (currentContent === nextContent) {
      return;
    }
    await writeJsonFile(filePath, payload);
  }

  private async buildRegistry(sharedPath: string): Promise<RegistryEntry[]> {
    const previousRegistryPath = path.join(sharedPath, "registry", "file_registry.json");
    const previousRegistry = await this.readJsonIfExists<RegistryEntry[]>(previousRegistryPath, []);
    const previousByPath = new Map(previousRegistry.map((entry) => [entry.path, entry]));
    const files = await this.collectJsonFiles(sharedPath);
    const entries: RegistryEntry[] = [];
    for (const relativePath of files) {
      const fullPath = path.join(sharedPath, relativePath);
      const normalizedRelativePath = relativePath.replace(/\\/g, "/");
      const previousEntry = previousByPath.get(normalizedRelativePath);
      try {
        const stat = await fs.stat(fullPath);
        let hash = previousEntry?.hash ?? "";
        try {
          hash = await hashFile(fullPath);
        } catch (error) {
          if (!isTransientReadError(error)) {
            throw error;
          }
        }
        entries.push({
          path: normalizedRelativePath,
          domain: relativePath.split(path.sep)[0],
          entity_type: this.detectEntityType(relativePath),
          entity_id: this.detectEntityId(relativePath),
          file_revision: previousEntry?.file_revision ?? 1,
          entity_revision: previousEntry?.entity_revision ?? 1,
          hash,
          size: stat.size,
          updated_at: new Date(stat.mtime).toISOString(),
          updated_by: previousEntry?.updated_by ?? "system",
          last_commit_id: previousEntry?.last_commit_id ?? null
        });
      } catch (error) {
        if (!isTransientReadError(error)) {
          throw error;
        }
        if (previousEntry) {
          entries.push(previousEntry);
        }
      }
    }
    return entries;
  }

  private async collectJsonFiles(rootPath: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (currentPath: string) => {
      let dirents;
      try {
        dirents = await readDirentsWithRetry(currentPath);
      } catch (error) {
        if (isTransientReadError(error)) {
          return;
        }
        throw error;
      }
      for (const dirent of dirents) {
        const fullPath = path.join(currentPath, dirent.name);
        if (dirent.isDirectory()) {
          if (["backups", "locks", "transactions"].includes(dirent.name)) {
            continue;
          }
          await walk(fullPath);
          continue;
        }
        if (dirent.name.endsWith(".json")) {
          result.push(path.relative(rootPath, fullPath));
        }
      }
    };
    await walk(rootPath);
    return result;
  }

  private async collectSystemFiles(rootPath: string, kind: string, limit = 24): Promise<SystemFileInfo[]> {
    const result: SystemFileInfo[] = [];
    const walk = async (currentPath: string) => {
      const dirents = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        const fullPath = path.join(currentPath, dirent.name);
        if (dirent.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        const stat = await fs.stat(fullPath).catch(() => null);
        result.push({
          id: `${kind}_${result.length + 1}`,
          label: dirent.name,
          kind,
          path: fullPath,
          updated_at: stat ? new Date(stat.mtime).toISOString() : undefined,
          detail: path.relative(rootPath, fullPath)
        });
      }
    };
    await walk(rootPath).catch(() => undefined);
    return result
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, limit);
  }

  private async collectLocalUnsavedDrafts(rootPath: string, limit = 50): Promise<LocalUnsavedDraftInfo[]> {
    const result: LocalUnsavedDraftInfo[] = [];
    const walk = async (currentPath: string) => {
      const dirents = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        const fullPath = path.join(currentPath, dirent.name);
        if (dirent.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!dirent.name.endsWith(".json")) {
          continue;
        }
        const stat = await fs.stat(fullPath).catch(() => null);
        const raw = await readJsonFile<{
          saved_at?: string;
          domain?: string;
          entity_id?: string;
          user_name?: string;
          reason?: string;
          shared_path?: string;
          payload?: unknown;
        }>(fullPath).catch(() => null);
        const domain = raw?.domain ?? path.basename(path.dirname(fullPath));
        const entityId = raw?.entity_id ?? path.basename(fullPath, path.extname(fullPath));
        result.push({
          id: path.basename(fullPath),
          label: this.buildLocalDraftLabel(domain, entityId, raw?.payload),
          domain,
          entity_id: entityId,
          path: fullPath,
          saved_at: raw?.saved_at ?? (stat ? new Date(stat.mtime).toISOString() : undefined),
          user_name: raw?.user_name,
          reason: raw?.reason,
          shared_path: raw?.shared_path,
          detail: this.buildLocalDraftDetail(domain, entityId, raw?.reason)
        });
      }
    };
    await walk(rootPath).catch(() => undefined);
    return result
      .sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))
      .slice(0, limit);
  }

  private async collectBackupSnapshots(rootPath: string, limit = 24): Promise<SystemFileInfo[]> {
    const result: SystemFileInfo[] = [];
    const visit = async (currentPath: string) => {
      const dirents = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      if (!dirents.length) {
        return;
      }

      const infoPath = path.join(currentPath, "backup_info.json");
      if (await exists(infoPath)) {
        const info = await readJsonFile<{
          id?: string;
          label?: string;
          created_at?: string;
          source_path?: string;
        }>(infoPath).catch(() => null);
        const stat = await fs.stat(infoPath).catch(() => null);
        result.push({
          id: info?.id ?? `backup_${result.length + 1}`,
          label: info?.label ?? path.basename(currentPath),
          kind: "backup",
          path: currentPath,
          updated_at: info?.created_at ?? (stat ? new Date(stat.mtime).toISOString() : undefined),
          detail: info?.source_path ? `Источник: ${info.source_path}` : path.relative(rootPath, currentPath)
        });
        return;
      }

      const subdirs = dirents.filter((item) => item.isDirectory());
      const files = dirents.filter((item) => item.isFile());
      if (files.length && !subdirs.length) {
        const stat = await fs.stat(currentPath).catch(() => null);
        result.push({
          id: `backup_${result.length + 1}`,
          label: path.basename(currentPath),
          kind: "backup",
          path: currentPath,
          updated_at: stat ? new Date(stat.mtime).toISOString() : undefined,
          detail: path.relative(rootPath, currentPath)
        });
        return;
      }

      for (const dirent of subdirs) {
        await visit(path.join(currentPath, dirent.name));
      }
    };

    await visit(rootPath).catch(() => undefined);
    return result
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, limit);
  }

  private detectEntityType(relativePath: string): string {
    if (relativePath.startsWith(`participants${path.sep}`)) {
      return "participant";
    }
    if (relativePath.startsWith(`releases${path.sep}`)) {
      return "release";
    }
    if (relativePath.startsWith(`structure${path.sep}`)) {
      return "structure";
    }
    if (relativePath.startsWith(`directories${path.sep}`)) {
      return "directory";
    }
    return "generic";
  }

  private detectEntityId(relativePath: string): string | undefined {
    const match = relativePath.match(/(prt_[^\\/]+|rel_[^\\/]+)/);
    return match?.[1];
  }

  private async bumpManifest(
    sharedPath: string,
    userName: string,
    touchedDomains: string[]
  ): Promise<DatasetManifest> {
    const manifest = await this.workspaceService.readManifest(sharedPath);
    manifest.dataset_revision += 1;
    manifest.file_registry_revision += 1;
    for (const domain of touchedDomains) {
      manifest.domain_revisions[domain] = (manifest.domain_revisions[domain] ?? 0) + 1;
    }
    manifest.state = "clean";
    manifest.last_commit_id = `tx_${safeTimestamp()}`;
    manifest.last_commit_at = new Date().toISOString();
    await writeJsonFile(path.join(sharedPath, "manifest.json"), manifest);
    await appendChangeLog(sharedPath, {
      at: manifest.last_commit_at,
      by: userName,
      commit_id: manifest.last_commit_id,
      touched_domains: touchedDomains
    });
    return manifest;
  }

  private async clearLocalWorkspaceCache(): Promise<void> {
    await this.cacheService.clear();
    await Promise.all([
      removePath(path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.lastSeenManifest)),
      removePath(path.join(this.portablePaths.portableDataPath, PORTABLE_CACHE_FILES.lastSeenRegistry))
    ]);
  }

  private async requireWorkspace(): Promise<LocalWorkspaceConfig> {
    const workspace = await this.portablePaths.loadWorkspaceConfig();
    if (!workspace) {
      throw new Error("Рабочее пространство не настроено.");
    }
    return workspace;
  }
}

async function appendChangeLog(
  sharedPath: string,
  entry: Record<string, unknown>
): Promise<void> {
  const logPath = path.join(sharedPath, "registry", "change_log.jsonl");
  const line = `${JSON.stringify(entry)}\n`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, "utf8");
}

function canonicalImportedRoleId(value: string): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    voicecast: "voice_cast",
    озвучка: "voice_cast",
    даббер: "voice_cast",
    translation: "translation",
    перевод: "translation",
    переводчик: "translation",
    mixing: "mixing",
    сведение: "mixing",
    звук: "mixing",
    звукорежиссер: "mixing",
    звукорежиссёр: "mixing",
    timing: "mixing",
    тайминг: "mixing",
    design: "design",
    оформление: "design",
    художник: "design",
    vocal: "vocal",
    вокал: "vocal"
  };
  return map[normalized] ?? slugId(value);
}

function canonicalImportedPostGroup(value: string): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    header: "header",
    platforms: "platforms",
    voicecast: "voice_cast",
    озвучка: "voice_cast",
    ролиозвучивали: "voice_cast",
    translation: "translation",
    перевод: "translation",
    mixing: "mixing",
    сведение: "mixing",
    timing: "mixing",
    тайминг: "mixing",
    design: "design",
    оформление: "design",
    genres: "genres",
    жанр: "genres",
    description: "description",
    описание: "description",
    tags: "tags",
    теги: "tags"
  };
  return map[normalized] ?? canonicalImportedRoleId(value);
}

function normalizeLookupKey(value?: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .trim();
}

function slugId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function mergeUniqueStrings(target: string[], values: string[]): void {
  values.forEach((value) => {
    if (!value || target.includes(value)) {
      return;
    }
    target.push(value);
  });
}

function mergeUniqueObjects<T>(target: T[], values: T[], getKey: (value: T) => string): void {
  const seen = new Set(target.map(getKey));
  values.forEach((value) => {
    const key = getKey(value);
    if (seen.has(key)) {
      return;
    }
    target.push(value);
    seen.add(key);
  });
}
