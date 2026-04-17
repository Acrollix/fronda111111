import fs from "node:fs/promises";
import path from "node:path";
import type { ManualBackupResult } from "@shared/types";
import { copyPath, ensureDir, safeTimestamp, writeJsonFile } from "./fs-utils";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateStamp(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatTimeStamp(date: Date): string {
  return `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
}

function formatDateTimeLabel(date: Date): string {
  return `${formatDateStamp(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatBackupLabel(date: Date): string {
  return `Бэкап · ${formatDateTimeLabel(date)}`;
}

export class BackupService {
  async createEntityBackup(
    sharedPath: string,
    domain: string,
    entityId: string,
    entityPath: string
  ): Promise<string> {
    const timestamp = safeTimestamp();
    const backupDir = path.join(
      sharedPath,
      "backups",
      timestamp.slice(0, 4),
      timestamp.slice(5, 7),
      timestamp.slice(8, 10),
      domain,
      entityId,
      timestamp
    );
    await ensureDir(path.dirname(backupDir));
    await copyPath(entityPath, backupDir);
    return backupDir;
  }

  async createManualWorkspaceBackup(
    sharedPath: string,
    backupRootPath: string,
    actor: string
  ): Promise<ManualBackupResult> {
    const createdAt = new Date();
    const timestamp = safeTimestamp(createdAt);
    const backupId = `Бэкап-${formatDateStamp(createdAt)}-${formatTimeStamp(createdAt)}`;
    const backupDir = path.join(
      backupRootPath,
      timestamp.slice(0, 4),
      timestamp.slice(5, 7),
      timestamp.slice(8, 10),
      backupId
    );
    const datasetDir = path.join(backupDir, "dataset");
    const entries = await fs.readdir(sharedPath, { withFileTypes: true });
    const included: string[] = [];
    const label = formatBackupLabel(createdAt);
    const createdAtIso = createdAt.toISOString();

    await ensureDir(datasetDir);

    for (const entry of entries) {
      if (["backups", "locks", "transactions"].includes(entry.name)) {
        continue;
      }
      included.push(entry.name);
      await copyPath(
        path.join(sharedPath, entry.name),
        path.join(datasetDir, entry.name)
      );
    }

    const detail = "Полный ручной снимок рабочей папки без временных блокировок и старых резервных копий.";
    await writeJsonFile(path.join(backupDir, "backup_info.json"), {
      id: backupId,
      kind: "manual_workspace",
      label,
      created_at: createdAtIso,
      actor,
      source_path: sharedPath,
      included
    });

    return {
      id: backupId,
      label,
      path: backupDir,
      created_at: createdAtIso,
      detail
    };
  }

  async restoreManualWorkspaceBackup(backupPath: string, sharedPath: string): Promise<void> {
    const datasetDir = path.join(backupPath, "dataset");
    const backupEntries = await fs.readdir(datasetDir, { withFileTypes: true });
    const currentEntries = await fs.readdir(sharedPath, { withFileTypes: true }).catch(() => []);

    for (const entry of currentEntries) {
      if (["locks", "transactions"].includes(entry.name)) {
        continue;
      }
      await fs.rm(path.join(sharedPath, entry.name), { recursive: true, force: true });
    }

    await ensureDir(sharedPath);
    for (const entry of backupEntries) {
      await copyPath(path.join(datasetDir, entry.name), path.join(sharedPath, entry.name));
    }
  }
}
