import { clipboard, dialog, ipcMain, shell } from "electron";
import type {
  AppSettings,
  DirectoryRecord,
  ExternalSource,
  ImportMappingOverride,
  LocalUnsavedDraftFile,
  ParticipantAggregate,
  PostTemplate,
  ReleaseAggregate
} from "@shared/types";
import { FrondaAppService } from "./services/app-service";
import { PortablePathsService } from "./services/portable-paths";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatExportStamp(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}-${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
}

export function registerIpcHandlers(appService: FrondaAppService): void {
  const portablePaths = new PortablePathsService();

  ipcMain.handle("app:bootstrap", () => appService.bootstrap());
  ipcMain.handle("app:saveSettings", (_event, settings: AppSettings) => appService.saveAppSettings(settings));

  ipcMain.handle("workspace:pickDirectory", async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title || "Выбор папки",
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("workspace:validate", (_event, payload: { sharedDatasetPath: string; backupDirectoryPath: string }) =>
    appService.configureWorkspace(payload)
  );
  ipcMain.handle("workspace:sync", (_event, force: boolean) => appService.syncWorkspace(force));
  ipcMain.handle("workspace:loadSnapshot", () => appService.loadWorkspaceSnapshot());
  ipcMain.handle("workspace:getSyncStatus", async () => {
    const bootstrap = await appService.bootstrap();
    if (!bootstrap.workspace) {
      return null;
    }
    return appService.getSyncStatus(bootstrap.workspace.sharedDatasetPath);
  });
  ipcMain.handle("system:checkYandexDisk", (_event, sharedPath?: string) =>
    appService.getYandexDiskStatus(sharedPath)
  );

  ipcMain.handle("participant:save", (_event, participant: ParticipantAggregate, userName: string) =>
    appService.saveParticipant(participant, userName)
  );
  ipcMain.handle("participant:delete", (_event, participantId: string, userName: string) =>
    appService.deleteParticipant(participantId, userName)
  );
  ipcMain.handle("release:save", (_event, release: ReleaseAggregate, userName: string) =>
    appService.saveRelease(release, userName)
  );
  ipcMain.handle("release:delete", (_event, releaseId: string, userName: string) =>
    appService.deleteRelease(releaseId, userName)
  );
  ipcMain.handle(
    "directories:save",
    (_event, fileName: string, records: DirectoryRecord[], userName: string) =>
      appService.saveDirectoryRecords(fileName, records, userName)
  );
  ipcMain.handle("external:save", (_event, sources: ExternalSource[], userName: string) =>
    appService.saveExternalSources(sources, userName)
  );
  ipcMain.handle("templates:save", (_event, templates: PostTemplate[], userName: string) =>
    appService.saveTemplates(templates, userName)
  );
  ipcMain.handle(
    "structure:saveFile",
    (_event, fileName: string, payload: unknown, userName: string) =>
      appService.saveStructureFile(fileName, payload, userName)
  );

  ipcMain.handle("imports:pickFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Файлы импорта", extensions: ["xlsx", "xls", "json"] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle(
    "imports:preview",
    (_event, sourceFile: string, mappingOverrides: ImportMappingOverride[] = []) =>
      appService.previewImport(sourceFile, mappingOverrides)
  );
  ipcMain.handle("imports:getPreview", (_event, batchId: string) => appService.getImportPreview(batchId));
  ipcMain.handle(
    "imports:rebuildPreview",
    (_event, batchId: string, mappingOverrides: ImportMappingOverride[]) =>
      appService.rebuildImportPreview(batchId, mappingOverrides)
  );
  ipcMain.handle("imports:listPresets", (_event, sourceSignature?: string) =>
    appService.listImportMappingPresets(sourceSignature)
  );
  ipcMain.handle(
    "imports:savePreset",
    (
      _event,
      name: string,
      sourceSignature: string,
      mappingOverrides: ImportMappingOverride[],
      userName: string
    ) => appService.saveImportMappingPreset(name, sourceSignature, mappingOverrides, userName)
  );
  ipcMain.handle("imports:exportBundle", async (_event, userName: string) => {
    const result = await dialog.showSaveDialog({
      title: "Экспортировать реестр FRONDA",
      defaultPath: `FRONDA-Экспорт-${formatExportStamp(new Date())}.json`,
      filters: [{ name: "FRONDA bundle", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return appService.exportImportBundle(result.filePath, userName);
  });
  ipcMain.handle(
    "imports:resolve",
    (
      _event,
      batchId: string,
      action: "create" | "update" | "review" | "reject",
      userName: string,
      targetParticipantId?: string
    ) => appService.resolveImportBatch(batchId, action, userName, targetParticipantId)
  );

  ipcMain.handle("posts:generate", (_event, releaseId: string, templateId?: string) =>
    appService.generatePostPreview(releaseId, templateId)
  );
  ipcMain.handle("posts:generateDraft", (_event, release: ReleaseAggregate, templateId?: string) =>
    appService.generatePostPreviewFromDraft(release, templateId)
  );
  ipcMain.handle(
    "posts:saveGenerated",
    (
      _event,
      releaseId: string,
      payload: { title: string; content: string; finalized: boolean; template_id?: string | null },
      userName: string
    ) => appService.saveGeneratedPost(releaseId, payload, userName)
  );
  ipcMain.handle(
    "posts:deleteGenerated",
    (_event, releaseId: string, postId: string, userName: string) =>
      appService.deleteGeneratedPost(releaseId, postId, userName)
  );

  ipcMain.handle("system:copyText", (_event, value: string) => {
    clipboard.writeText(value ?? "");
    return true;
  });
  ipcMain.handle("system:openResource", async (_event, value: string) => {
    const target = String(value ?? "").trim();
    if (!target) {
      return false;
    }
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target);
      return true;
    }
    await shell.openPath(target);
    return true;
  });
  ipcMain.handle("system:diagnostics", () => appService.getSystemDiagnostics());
  ipcMain.handle("system:getLocalUnsavedDraft", (_event, draftPath: string): Promise<LocalUnsavedDraftFile> =>
    appService.getLocalUnsavedDraft(draftPath)
  );
  ipcMain.handle("system:deleteLocalUnsavedDraft", (_event, draftPath: string) =>
    appService.deleteLocalUnsavedDraft(draftPath)
  );
  ipcMain.handle("system:createManualBackup", (_event, userName: string) =>
    appService.createManualBackup(userName)
  );
  ipcMain.handle("system:restoreManualBackup", (_event, backupPath: string, userName: string) =>
    appService.restoreManualBackup(backupPath, userName)
  );
  ipcMain.handle("system:openSettingsFolder", async () => {
    await portablePaths.initialize();
    await shell.openPath(portablePaths.settingsDir);
    return portablePaths.settingsDir;
  });

  ipcMain.handle("git:status", () => appService.getGitStatus());
  ipcMain.handle("git:pickRepo", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("git:configure", (_event, repoPath: string) => appService.configureGitRepo(repoPath));
  ipcMain.handle("git:exportSnapshot", (_event, mode: "config" | "full") =>
    appService.exportGitSnapshot(mode)
  );
  ipcMain.handle("git:commit", (_event, message: string, push: boolean) =>
    appService.gitCommit(message, push)
  );
}
