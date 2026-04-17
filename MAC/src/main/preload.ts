import { contextBridge, ipcRenderer } from "electron";
import type {
  AppCommand,
  AppSettings,
  DirectoryRecord,
  ExternalSource,
  ImportMappingOverride,
  LocalUnsavedDraftFile,
  ParticipantAggregate,
  PostTemplate,
  ReleaseAggregate
} from "@shared/types";

const api = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  saveAppSettings: (settings: AppSettings) => ipcRenderer.invoke("app:saveSettings", settings),
  pickWorkspaceDirectory: (title?: string) => ipcRenderer.invoke("workspace:pickDirectory", title),
  validateAndConfigureWorkspace: (payload: { sharedDatasetPath: string; backupDirectoryPath: string }) =>
    ipcRenderer.invoke("workspace:validate", payload),
  syncWorkspace: (force = false) => ipcRenderer.invoke("workspace:sync", force),
  loadWorkspaceSnapshot: () => ipcRenderer.invoke("workspace:loadSnapshot"),
  getSyncStatus: () => ipcRenderer.invoke("workspace:getSyncStatus"),
  checkYandexDisk: (sharedPath?: string) => ipcRenderer.invoke("system:checkYandexDisk", sharedPath),
  saveParticipant: (participant: ParticipantAggregate, userName: string) =>
    ipcRenderer.invoke("participant:save", participant, userName),
  deleteParticipant: (participantId: string, userName: string) =>
    ipcRenderer.invoke("participant:delete", participantId, userName),
  saveRelease: (release: ReleaseAggregate, userName: string) =>
    ipcRenderer.invoke("release:save", release, userName),
  deleteRelease: (releaseId: string, userName: string) =>
    ipcRenderer.invoke("release:delete", releaseId, userName),
  saveDirectoryRecords: (fileName: string, records: DirectoryRecord[], userName: string) =>
    ipcRenderer.invoke("directories:save", fileName, records, userName),
  saveExternalSources: (sources: ExternalSource[], userName: string) =>
    ipcRenderer.invoke("external:save", sources, userName),
  saveTemplates: (templates: PostTemplate[], userName: string) =>
    ipcRenderer.invoke("templates:save", templates, userName),
  saveStructureFile: (fileName: string, payload: unknown, userName: string) =>
    ipcRenderer.invoke("structure:saveFile", fileName, payload, userName),
  pickImportFile: () => ipcRenderer.invoke("imports:pickFile"),
  previewImport: (sourceFile: string, mappingOverrides?: ImportMappingOverride[]) =>
    ipcRenderer.invoke("imports:preview", sourceFile, mappingOverrides),
  getImportPreview: (batchId: string) => ipcRenderer.invoke("imports:getPreview", batchId),
  rebuildImportPreview: (batchId: string, mappingOverrides: ImportMappingOverride[]) =>
    ipcRenderer.invoke("imports:rebuildPreview", batchId, mappingOverrides),
  listImportMappingPresets: (sourceSignature?: string) =>
    ipcRenderer.invoke("imports:listPresets", sourceSignature),
  saveImportMappingPreset: (
    name: string,
    sourceSignature: string,
    mappingOverrides: ImportMappingOverride[],
    userName: string
  ) => ipcRenderer.invoke("imports:savePreset", name, sourceSignature, mappingOverrides, userName),
  exportImportBundle: (userName: string) => ipcRenderer.invoke("imports:exportBundle", userName),
  resolveImportBatch: (
    batchId: string,
    action: "create" | "update" | "review" | "reject",
    userName: string,
    targetParticipantId?: string
  ) => ipcRenderer.invoke("imports:resolve", batchId, action, userName, targetParticipantId),
  generatePost: (releaseId: string, templateId?: string) =>
    ipcRenderer.invoke("posts:generate", releaseId, templateId),
  generatePostDraft: (release: ReleaseAggregate, templateId?: string) =>
    ipcRenderer.invoke("posts:generateDraft", release, templateId),
  saveGeneratedPost: (
    releaseId: string,
    payload: { title: string; content: string; finalized: boolean; template_id?: string | null },
    userName: string
  ) => ipcRenderer.invoke("posts:saveGenerated", releaseId, payload, userName),
  deleteGeneratedPost: (releaseId: string, postId: string, userName: string) =>
    ipcRenderer.invoke("posts:deleteGenerated", releaseId, postId, userName),
  copyText: (value: string) => ipcRenderer.invoke("system:copyText", value),
  continueAppClose: (userName: string) => ipcRenderer.invoke("app:continueClose", userName),
  openResource: (value: string) => ipcRenderer.invoke("system:openResource", value),
  getGitStatus: () => ipcRenderer.invoke("git:status"),
  getSystemDiagnostics: () => ipcRenderer.invoke("system:diagnostics"),
  getLocalUnsavedDraft: (draftPath: string): Promise<LocalUnsavedDraftFile> =>
    ipcRenderer.invoke("system:getLocalUnsavedDraft", draftPath),
  deleteLocalUnsavedDraft: (draftPath: string) =>
    ipcRenderer.invoke("system:deleteLocalUnsavedDraft", draftPath),
  createManualBackup: (userName: string) => ipcRenderer.invoke("system:createManualBackup", userName),
  restoreManualBackup: (backupPath: string, userName: string) =>
    ipcRenderer.invoke("system:restoreManualBackup", backupPath, userName),
  openSettingsFolder: () => ipcRenderer.invoke("system:openSettingsFolder"),
  pickGitRepo: () => ipcRenderer.invoke("git:pickRepo"),
  configureGitRepo: (repoPath: string) => ipcRenderer.invoke("git:configure", repoPath),
  exportGitSnapshot: (mode: "config" | "full") => ipcRenderer.invoke("git:exportSnapshot", mode),
  gitCommit: (message: string, push: boolean) => ipcRenderer.invoke("git:commit", message, push),
  onAppCommand: (listener: (command: AppCommand) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: AppCommand) => listener(command);
    ipcRenderer.on("app:command", wrapped);
    return () => {
      ipcRenderer.removeListener("app:command", wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("fronda", api);

export type FrondaApi = typeof api;
