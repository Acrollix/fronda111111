import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { DatasetManifest, WorkspaceSnapshot } from "@shared/types";
import { hashJson } from "./fs-utils";

export class CacheService {
  private SQL: SqlJsStatic | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    if (!this.SQL) {
      this.SQL = await initSqlJs({
        locateFile: (file: string) => {
          if (file === "sql-wasm.wasm") {
            return require.resolve("sql.js/dist/sql-wasm.wasm");
          }
          return file;
        }
      });
    }
    if (!(await this.exists(this.dbPath))) {
      const db = new this.SQL.Database();
      this.applySchema(db);
      await this.persist(db);
      db.close();
    }
  }

  async rebuild(snapshot: WorkspaceSnapshot): Promise<void> {
    const db = await this.open();
    db.run("DELETE FROM participant_list;");
    db.run("DELETE FROM release_list;");
    db.run("DELETE FROM system_state;");
    const insertParticipant = db.prepare(
      "INSERT INTO participant_list (id, nickname, display_name, status, activity_level, reliability_level, warning_count, has_voice_sample, top_release_fit, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    for (const participant of snapshot.participantList) {
      insertParticipant.run([
        participant.id,
        participant.nickname,
        participant.displayName,
        participant.status,
        participant.activityLevel,
        participant.reliabilityLevel,
        participant.warningCount,
        participant.hasVoiceSample ? 1 : 0,
        participant.topReleaseFit ? 1 : 0,
        JSON.stringify(participant)
      ]);
    }
    insertParticipant.free();

    const insertRelease = db.prepare(
      "INSERT INTO release_list (id, title, status, type, primary_department_id, archival_state, year, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?);"
    );
    for (const release of snapshot.releaseList) {
      insertRelease.run([
        release.id,
        release.title,
        release.status,
        release.type,
        release.primaryDepartmentId,
        release.archivalState,
        release.year ?? null,
        JSON.stringify(release)
      ]);
    }
    insertRelease.free();

    db.run("INSERT INTO system_state (key, value) VALUES (?, ?);", [
      "manifest",
      JSON.stringify(snapshot.manifest)
    ]);
    db.run("INSERT INTO system_state (key, value) VALUES (?, ?);", [
      "snapshot",
      JSON.stringify(snapshot)
    ]);
    db.run("INSERT INTO system_state (key, value) VALUES (?, ?);", [
      "snapshot_hash",
      await hashJson(snapshot)
    ]);
    await this.persist(db);
    db.close();
  }

  async loadSnapshot(): Promise<WorkspaceSnapshot | null> {
    const db = await this.open();
    const row = db.exec("SELECT value FROM system_state WHERE key = 'snapshot';");
    db.close();
    if (row.length === 0 || row[0].values.length === 0) {
      return null;
    }
    return JSON.parse(String(row[0].values[0][0])) as WorkspaceSnapshot;
  }

  async loadManifest(): Promise<DatasetManifest | null> {
    const db = await this.open();
    const row = db.exec("SELECT value FROM system_state WHERE key = 'manifest';");
    db.close();
    if (row.length === 0 || row[0].values.length === 0) {
      return null;
    }
    return JSON.parse(String(row[0].values[0][0])) as DatasetManifest;
  }

  private async open(): Promise<Database> {
    await this.initialize();
    const raw = await fs.readFile(this.dbPath);
    const db = new this.SQL!.Database(raw);
    this.applySchema(db);
    return db;
  }

  private applySchema(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS participant_list (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        activity_level TEXT NOT NULL,
        reliability_level TEXT NOT NULL,
        warning_count INTEGER NOT NULL,
        has_voice_sample INTEGER NOT NULL,
        top_release_fit INTEGER NOT NULL,
        raw TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS release_list (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        type TEXT NOT NULL,
        primary_department_id TEXT NOT NULL,
        archival_state TEXT NOT NULL,
        year INTEGER,
        raw TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private async persist(db: Database): Promise<void> {
    const data = db.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
