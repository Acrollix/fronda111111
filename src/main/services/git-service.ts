import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { GitStatusSummary } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./fs-utils";

interface GitConfig {
  repoPath: string;
}

export class GitService {
  constructor(private readonly portableDataPath: string) {}

  private get configPath(): string {
    return path.join(this.portableDataPath, "settings", "git.json");
  }

  async getStatus(): Promise<GitStatusSummary> {
    const config = await this.loadConfig();
    if (!config) {
      return { available: await this.hasGit(), configured: false };
    }
    const gitAvailable = await this.hasGit();
    if (!gitAvailable) {
      return {
        available: false,
        configured: true,
        repoPath: config.repoPath,
        lastError: "Не найден git CLI."
      };
    }
    const status = await this.runGit(["status", "--short", "--branch"], config.repoPath);
    const remote = await this.runGit(["remote", "get-url", "origin"], config.repoPath);
    return {
      available: true,
      configured: true,
      repoPath: config.repoPath,
      remoteOrigin: remote.success ? remote.stdout.trim() : undefined,
      branch: status.success ? status.stdout.split("\n")[0].replace(/^##\s*/, "") : undefined,
      clean: status.success ? status.stdout.trim().split("\n").length <= 1 : undefined,
      lastError: status.success ? undefined : status.stderr.trim()
    };
  }

  async saveConfig(repoPath: string): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await writeJsonFile(this.configPath, { repoPath });
  }

  async loadConfig(): Promise<GitConfig | null> {
    try {
      return await readJsonFile<GitConfig>(this.configPath);
    } catch {
      return null;
    }
  }

  async exportSnapshot(sourcePath: string, destinationPath: string, includePaths: string[]): Promise<void> {
    await fs.mkdir(destinationPath, { recursive: true });
    for (const relativePath of includePaths) {
      await fs.cp(path.join(sourcePath, relativePath), path.join(destinationPath, relativePath), {
        recursive: true,
        force: true
      });
    }
  }

  async commit(repoPath: string, message: string, push = false): Promise<{ success: boolean; output: string }> {
    const addResult = await this.runGit(["add", "."], repoPath);
    if (!addResult.success) {
      return { success: false, output: addResult.stderr };
    }
    const commitResult = await this.runGit(["commit", "-m", message], repoPath);
    if (!commitResult.success && !commitResult.stderr.includes("nothing to commit")) {
      return { success: false, output: commitResult.stderr };
    }
    if (push) {
      const pushResult = await this.runGit(["push"], repoPath);
      return {
        success: pushResult.success,
        output: `${commitResult.stdout}\n${pushResult.stdout || pushResult.stderr}`
      };
    }
    return { success: true, output: commitResult.stdout || commitResult.stderr };
  }

  private async hasGit(): Promise<boolean> {
    const result = await this.runGit(["--version"], process.cwd());
    return result.success;
  }

  private runGit(
    args: string[],
    workdir: string
  ): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn("git", args, { cwd: workdir, shell: false });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        resolve({ success: code === 0, stdout, stderr });
      });
      child.on("error", (error) => {
        resolve({ success: false, stdout, stderr: error.message });
      });
    });
  }
}
