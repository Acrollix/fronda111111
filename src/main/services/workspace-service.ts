import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_MIN_DATASET_VERSION,
  DATASET_KIND,
  DATASET_SCHEMA_VERSION
} from "@shared/constants";
import type {
  DatasetManifest,
  DepartmentDirectoryItem,
  DepartmentProfile,
  DirectoryRecord,
  ExternalSource,
  PostTemplate,
  RegistryEntry,
  StructurePosition,
  WorkspaceValidationResult
} from "@shared/types";
import {
  ensureDir,
  exists,
  hashFile,
  isTransientReadError,
  readJsonFile,
  readDirentsWithRetry,
  safeTimestamp,
  statWithRetry,
  TRANSIENT_CLOUD_READ_MESSAGE,
  writeJsonFile
} from "./fs-utils";

const SHARED_BOOTSTRAP_DIRS = [
  "registry",
  "directories",
  "structure",
  "structure/public_exports",
  "participants",
  "participants/by_id",
  "releases",
  "releases/by_id",
  "external",
  "external/by_id",
  "templates",
  "templates/post_templates",
  "locks",
  "backups",
  "imports",
  "imports/incoming",
  "imports/pending",
  "imports/review",
  "imports/resolved",
  "imports/rejected",
  "imports/presets",
  "transactions"
] as const;

const DIRECTORY_JSON_FILES = [
  "departments",
  "structure_positions",
  "participant_roles",
  "skills",
  "specializations",
  "participant_statuses",
  "release_statuses",
  "release_types",
  "external_source_types",
  "platforms",
  "genres",
  "tags",
  "note_types",
  "disciplinary_types",
  "reward_types"
] as const;

const REGISTRY_SKIP_DIRS = new Set(["backups", "locks", "transactions"]);
const BOOTSTRAP_ACTOR = "Система FRONDA";

export class WorkspaceService {
  private isTransientWorkspaceReadError(error: unknown): boolean {
    return isTransientReadError(error);
  }

  private normalizeWorkspaceReadError(error: unknown): string {
    if (!(error instanceof Error) && !(error && typeof error === "object" && "message" in error)) {
      return "Не удалось подготовить рабочую папку FRONDA.";
    }
    const message = error instanceof Error
      ? (error.message ?? "Не удалось подготовить рабочую папку FRONDA.")
      : String((error as { message?: unknown }).message ?? "Не удалось подготовить рабочую папку FRONDA.");
    if (this.isTransientWorkspaceReadError(error)) {
      return TRANSIENT_CLOUD_READ_MESSAGE;
    }
    return message;
  }

  async validateWorkspace(sharedPath: string): Promise<WorkspaceValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const prepared = await this.prepareWorkspace(sharedPath);
      const manifest = prepared.manifest;

      let mode: WorkspaceValidationResult["mode"] = "RW_IN_SYNC";
      let valid = true;

      if (manifest.schema_version !== DATASET_SCHEMA_VERSION) {
        valid = false;
        mode = "RO_SCHEMA_MISMATCH";
        errors.push("Версия данных в рабочей папке не совпадает с текущей версией приложения.");
      } else if (manifest.repair_mode || manifest.state === "repair_required") {
        mode = "RO_RECOVERY";
        warnings.push("Набор данных помечен как требующий проверки или восстановления.");
      } else if (manifest.state === "commit_pending") {
        mode = "RO_COMMIT_PENDING";
        warnings.push("Предыдущая запись не завершилась полностью. Проверьте состояние данных.");
      }

      return {
        valid,
        sharedPath,
        mode,
        errors,
        warnings,
        manifest
      };
    } catch (error) {
      const message = this.normalizeWorkspaceReadError(error);
      errors.push(message);
      return {
        valid: false,
        sharedPath,
        mode: this.isTransientWorkspaceReadError(error) ? "RO_STALE" : "RO_OFFLINE",
        errors,
        warnings
      };
    }
  }

  async prepareWorkspace(sharedPath: string): Promise<{
    manifest: DatasetManifest;
    registry: RegistryEntry[];
    created: boolean;
    seeded: boolean;
  }> {
    await ensureDir(sharedPath);

    for (const relativeDir of SHARED_BOOTSTRAP_DIRS) {
      await ensureDir(path.join(sharedPath, relativeDir));
    }

    const manifestPath = path.join(sharedPath, "manifest.json");
    const registryPath = path.join(sharedPath, "registry", "file_registry.json");
    const participantsRegistryPath = path.join(sharedPath, "participants", "registry.json");
    const releasesRegistryPath = path.join(sharedPath, "releases", "registry.json");
    const changeLogPath = path.join(sharedPath, "registry", "change_log.jsonl");
    const externalRegistryPath = path.join(sharedPath, "external", "registry.json");
    const templatesRegistryPath = path.join(sharedPath, "templates", "registry.json");
    const structureFiles = [
      "department_profiles.json",
      "position_assignments.json",
      "substitutions.json",
      "temporary_assignments.json",
      "structure_contacts.json",
      "structure_notes.json",
      "onboarding_rules.json"
    ];

    const manifestExists = await exists(manifestPath);
    let manifest = manifestExists
      ? await readJsonFile<DatasetManifest>(manifestPath)
      : buildDefaultManifest(sharedPath);
    const created = !manifestExists;

    let changed = false;
    let seeded = false;
    const touchedDomains = new Set<string>();

    if (!(await exists(participantsRegistryPath))) {
      await writeJsonFile(participantsRegistryPath, []);
      changed = true;
      touchedDomains.add("participants");
    }

    if (!(await exists(releasesRegistryPath))) {
      await writeJsonFile(releasesRegistryPath, []);
      changed = true;
      touchedDomains.add("releases");
    }

    if (!(await exists(externalRegistryPath))) {
      await writeJsonFile(externalRegistryPath, []);
      changed = true;
      touchedDomains.add("external");
    }

    if (!(await exists(templatesRegistryPath))) {
      await writeJsonFile(templatesRegistryPath, []);
      changed = true;
      touchedDomains.add("templates");
    }

    if (!(await exists(changeLogPath))) {
      await fs.writeFile(changeLogPath, "", "utf8");
      changed = true;
      touchedDomains.add("registry");
    }

    for (const fileName of structureFiles) {
      const targetPath = path.join(sharedPath, "structure", fileName);
      if (!(await exists(targetPath))) {
        const emptyValue = fileName === "onboarding_rules.json" ? {} : [];
        await writeJsonFile(targetPath, emptyValue);
        changed = true;
        touchedDomains.add("structure");
      }
    }

    for (const directoryName of DIRECTORY_JSON_FILES) {
      const targetPath = path.join(sharedPath, "directories", `${directoryName}.json`);
      if (!(await exists(targetPath))) {
        await writeJsonFile(targetPath, []);
        changed = true;
        touchedDomains.add("directories");
      }
    }

    const seedChanges = await this.seedBaseDirectories(sharedPath);
    if (seedChanges.changed) {
      changed = true;
      seeded = true;
      seedChanges.touchedDomains.forEach((domain) => touchedDomains.add(domain));
    }

    const registryExists = await exists(registryPath);
    const existingRegistry = registryExists
      ? await readJsonFile<RegistryEntry[]>(registryPath).catch(() => [])
      : [];
    let nextRegistry = existingRegistry;

    if (!registryExists || changed || created) {
      nextRegistry = await this.buildFileRegistry(sharedPath, existingRegistry);
      if (JSON.stringify(existingRegistry) !== JSON.stringify(nextRegistry)) {
        await writeJsonFile(registryPath, nextRegistry);
        changed = true;
        touchedDomains.add("registry");
      }
    }

    if (created) {
      manifest = buildDefaultManifest(sharedPath);
      changed = true;
    }

    if (changed) {
      const now = new Date().toISOString();
      if (!created) {
        manifest.dataset_revision += 1;
        manifest.file_registry_revision += 1;
      }
      manifest.schema_version = DATASET_SCHEMA_VERSION;
      manifest.dataset_kind = DATASET_KIND;
      manifest.app_min_version = String(APP_MIN_DATASET_VERSION);
      manifest.state = "clean";
      manifest.repair_mode = false;
      manifest.last_commit_at = now;
      manifest.last_commit_id = `bootstrap_${safeTimestamp()}`;
      for (const domain of touchedDomains) {
        manifest.domain_revisions[domain] = (manifest.domain_revisions[domain] ?? 0) + 1;
      }
      await writeJsonFile(manifestPath, manifest);
      if (!registryExists || touchedDomains.has("registry") || touchedDomains.has("directories") || touchedDomains.has("structure") || touchedDomains.has("participants") || touchedDomains.has("releases") || touchedDomains.has("external") || touchedDomains.has("templates")) {
        nextRegistry = await this.buildFileRegistry(sharedPath, nextRegistry);
        await writeJsonFile(registryPath, nextRegistry);
      }
    }

    return {
      manifest,
      registry: changed ? nextRegistry : existingRegistry,
      created,
      seeded
    };
  }

  async readManifest(sharedPath: string): Promise<DatasetManifest> {
    const { manifest } = await this.prepareWorkspace(sharedPath);
    return manifest;
  }

  async readFileRegistry(sharedPath: string): Promise<RegistryEntry[]> {
    const { registry } = await this.prepareWorkspace(sharedPath);
    return registry;
  }

  async getDirectoryStat(sharedPath: string, relativePath = "."): Promise<Stats | null> {
    try {
      return await statWithRetry(path.join(sharedPath, relativePath));
    } catch {
      return null;
    }
  }

  private async seedBaseDirectories(sharedPath: string): Promise<{
    changed: boolean;
    touchedDomains: Set<string>;
  }> {
    const touchedDomains = new Set<string>();
    let changed = false;

    const departmentsPath = path.join(sharedPath, "directories", "departments.json");
    const departmentProfilesPath = path.join(sharedPath, "structure", "department_profiles.json");
    const positionsPath = path.join(sharedPath, "directories", "structure_positions.json");
    const participantRolesPath = path.join(sharedPath, "directories", "participant_roles.json");
    const skillsPath = path.join(sharedPath, "directories", "skills.json");
    const specializationsPath = path.join(sharedPath, "directories", "specializations.json");
    const participantStatusesPath = path.join(sharedPath, "directories", "participant_statuses.json");
    const releaseStatusesPath = path.join(sharedPath, "directories", "release_statuses.json");
    const releaseTypesPath = path.join(sharedPath, "directories", "release_types.json");
    const externalSourceTypesPath = path.join(sharedPath, "directories", "external_source_types.json");
    const platformsPath = path.join(sharedPath, "directories", "platforms.json");
    const genresPath = path.join(sharedPath, "directories", "genres.json");
    const tagsPath = path.join(sharedPath, "directories", "tags.json");
    const noteTypesPath = path.join(sharedPath, "directories", "note_types.json");
    const disciplinaryTypesPath = path.join(sharedPath, "directories", "disciplinary_types.json");
    const rewardTypesPath = path.join(sharedPath, "directories", "reward_types.json");
    const externalRegistryPath = path.join(sharedPath, "external", "registry.json");
    const externalByIdPath = path.join(sharedPath, "external", "by_id");
    const templatesPath = path.join(sharedPath, "templates", "post_templates");
    const templateRegistryPath = path.join(sharedPath, "templates", "registry.json");

    const departments = await readJsonFile<DepartmentDirectoryItem[]>(departmentsPath).catch(() => []);
    const nextDepartments = mergeSeedRecords(departments, buildSeedDepartments());
    if (nextDepartments.changed) {
      await writeJsonFile(departmentsPath, nextDepartments.records);
      changed = true;
      touchedDomains.add("directories");
    }

    const profiles = await readJsonFile<DepartmentProfile[]>(departmentProfilesPath).catch(() => []);
    const nextProfiles = mergeDepartmentProfiles(profiles, buildSeedDepartmentProfiles());
    if (nextProfiles.changed) {
      await writeJsonFile(departmentProfilesPath, nextProfiles.records);
      changed = true;
      touchedDomains.add("structure");
    }

    const positions = await readJsonFile<StructurePosition[]>(positionsPath).catch(() => []);
    const nextPositions = mergeSeedRecords(positions, buildSeedPositions());
    if (nextPositions.changed) {
      await writeJsonFile(positionsPath, nextPositions.records);
      changed = true;
      touchedDomains.add("directories");
    }

    changed = await this.seedGenericDirectory(
      participantRolesPath,
      buildSeedParticipantRoles(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(skillsPath, buildSeedSkills(), touchedDomains, changed);
    changed = await this.seedGenericDirectory(
      specializationsPath,
      buildSeedSpecializations(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(
      participantStatusesPath,
      buildSeedParticipantStatuses(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(
      releaseStatusesPath,
      buildSeedReleaseStatuses(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(
      releaseTypesPath,
      buildSeedReleaseTypes(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(
      externalSourceTypesPath,
      buildSeedExternalSourceTypes(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(platformsPath, buildSeedPlatforms(), touchedDomains, changed);
    changed = await this.seedGenericDirectory(genresPath, buildSeedGenres(), touchedDomains, changed);
    changed = await this.seedGenericDirectory(tagsPath, buildSeedTags(), touchedDomains, changed);
    changed = await this.seedGenericDirectory(noteTypesPath, buildSeedNoteTypes(), touchedDomains, changed);
    changed = await this.seedGenericDirectory(
      disciplinaryTypesPath,
      buildSeedDisciplinaryTypes(),
      touchedDomains,
      changed
    );
    changed = await this.seedGenericDirectory(
      rewardTypesPath,
      buildSeedRewardTypes(),
      touchedDomains,
      changed
    );

    await ensureDir(externalByIdPath);
    const currentExternalSources = await readJsonFile<ExternalSource[]>(externalRegistryPath).catch(() => []);
    const mergedExternalSources = mergeSeedRecords(currentExternalSources, buildSeedExternalSources());
    if (mergedExternalSources.changed || !(await exists(externalRegistryPath))) {
      for (const source of mergedExternalSources.records) {
        await writeJsonFile(path.join(externalByIdPath, `${source.id}.json`), source);
      }
      await writeJsonFile(externalRegistryPath, mergedExternalSources.records);
      changed = true;
      touchedDomains.add("external");
    }

    await ensureDir(templatesPath);
    const templateFiles = await readDirentsWithRetry(templatesPath).catch(() => []);
    const templates = await Promise.all(
      templateFiles
        .filter((file) => file.isFile() && file.name.endsWith(".json"))
        .map((file) => readJsonFile<PostTemplate>(path.join(templatesPath, file.name)).catch(() => null))
    );
    const existingTemplates = templates.filter(Boolean) as PostTemplate[];
    const mergedTemplates = mergeSeedRecords(existingTemplates, buildSeedTemplates());
    if (mergedTemplates.changed) {
      for (const template of mergedTemplates.records) {
        await writeJsonFile(path.join(templatesPath, `${template.id}.json`), template);
      }
      await writeJsonFile(templateRegistryPath, mergedTemplates.records);
      changed = true;
      touchedDomains.add("templates");
    } else if (!(await exists(templateRegistryPath))) {
      await writeJsonFile(templateRegistryPath, mergedTemplates.records);
      changed = true;
      touchedDomains.add("templates");
    }

    return { changed, touchedDomains };
  }

  private async seedGenericDirectory(
    filePath: string,
    seeds: DirectoryRecord[],
    touchedDomains: Set<string>,
    changedFlag: boolean
  ): Promise<boolean> {
    const current = await readJsonFile<DirectoryRecord[]>(filePath).catch(() => []);
    const merged = mergeSeedRecords(current, seeds);
    if (!merged.changed) {
      return changedFlag;
    }
    await writeJsonFile(filePath, merged.records);
    touchedDomains.add("directories");
    return true;
  }

  private async buildFileRegistry(sharedPath: string, previousRegistry: RegistryEntry[] = []): Promise<RegistryEntry[]> {
    const previousByPath = new Map(previousRegistry.map((entry) => [entry.path, entry]));
    const files = await this.collectRegistryFiles(sharedPath);
    const entries: RegistryEntry[] = [];
    for (const relativePath of files) {
      const fullPath = path.join(sharedPath, relativePath);
      const normalizedRelativePath = relativePath.replace(/\\/g, "/");
      try {
        const stat = await statWithRetry(fullPath);
        entries.push({
          path: normalizedRelativePath,
          domain: relativePath.split(path.sep)[0],
          entity_type: detectEntityType(relativePath),
          entity_id: detectEntityId(relativePath),
          file_revision: 1,
          entity_revision: 1,
          hash: await hashFile(fullPath),
          size: stat.size,
          updated_at: new Date(stat.mtime).toISOString(),
          updated_by: BOOTSTRAP_ACTOR,
          last_commit_id: null
        });
      } catch (error) {
        if (!isTransientReadError(error)) {
          throw error;
        }
        const previousEntry = previousByPath.get(normalizedRelativePath);
        if (previousEntry) {
          entries.push(previousEntry);
        }
      }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async collectRegistryFiles(rootPath: string): Promise<string[]> {
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
          if (REGISTRY_SKIP_DIRS.has(dirent.name)) {
            continue;
          }
          await walk(fullPath);
          continue;
        }
        if (!dirent.name.endsWith(".json") && !dirent.name.endsWith(".jsonl")) {
          continue;
        }
        result.push(path.relative(rootPath, fullPath));
      }
    };
    await walk(rootPath);
    return result;
  }
}

function buildDefaultManifest(sharedPath: string): DatasetManifest {
  const now = new Date().toISOString();
  const datasetId = `ds_${slugifySeed(path.basename(sharedPath) || "fronda")}_${safeTimestamp().replace(/[^0-9]/g, "").slice(-10)}`;
  return {
    dataset_kind: DATASET_KIND,
    dataset_id: datasetId,
    dataset_name: path.basename(sharedPath) || "FRONDA",
    schema_version: DATASET_SCHEMA_VERSION,
    app_min_version: String(APP_MIN_DATASET_VERSION),
    dataset_revision: 1,
    file_registry_revision: 1,
    domain_revisions: {
      registry: 1,
      directories: 1,
      structure: 1,
      participants: 1,
      releases: 1,
      external: 1,
      templates: 1,
      imports: 1
    },
    state: "clean",
    repair_mode: false,
    last_commit_id: `bootstrap_${safeTimestamp()}`,
    last_commit_at: now
  };
}

function buildSeedDepartments(): DepartmentDirectoryItem[] {
  return [
    createDepartment("dep_anime", "Аниме", "Аниме", 1, true, "department", ["аниме"]),
    createDepartment("dep_dorama", "Дорамы", "Дорамы", 2, true, "department", ["дорамы"]),
    createDepartment("dep_films", "Фильмы", "Фильмы", 3, true, "department", ["фильмы"]),
    createDepartment("dep_serials", "Сериалы", "Сериалы", 4, true, "department", ["сериалы"]),
    createDepartment("dep_ongoings", "Онгоинги", "Онгоинги", 5, true, "release_unit", ["онгоинги"]),
    createDepartment("dep_books", "Книги", "Книги", 6, true, "department", ["книги"]),
    createDepartment("dep_funny", "Смешные озвучки", "Смешные", 7, true, "department", ["юмор", "смешные"]),
    createDepartment("dep_erotica", "Эротика", "Эротика", 8, false, "department", ["эротика"]),
    createDepartment("dep_media", "Телеграм и медиа", "Медиа", 9, true, "support", ["телеграм", "медиа"]),
    createDepartment("dep_management", "Управление", "Управление", 10, false, "admin", ["структура"]),
    createDepartment("dep_training", "Мастерская и обучение", "Мастерская", 11, false, "support", ["обучение"])
  ];
}

function buildSeedDepartmentProfiles(): DepartmentProfile[] {
  return [
    createDepartmentProfile("dep_anime", true, "Релизы и процессы направления аниме."),
    createDepartmentProfile("dep_dorama", true, "Релизы дорам и связанная с ними команда."),
    createDepartmentProfile("dep_films", true, "Полнометражные фильмы и спецпроекты."),
    createDepartmentProfile("dep_serials", true, "Сериалы и долгие релизные циклы."),
    createDepartmentProfile("dep_ongoings", true, "Онгоинги и быстрые регулярные релизы."),
    createDepartmentProfile("dep_books", true, "Книги, аудиопостановки и смежные форматы."),
    createDepartmentProfile("dep_funny", true, "Смешные озвучки и экспериментальные форматы."),
    createDepartmentProfile("dep_erotica", false, "Отдельное направление для релизов с возрастным ограничением и особыми правилами доступа."),
    createDepartmentProfile("dep_media", true, "Телеграм, постинг и медийная поддержка."),
    createDepartmentProfile("dep_management", false, "Руководство, кураторы и ключевые организационные решения."),
    createDepartmentProfile("dep_training", false, "Обучение, наставничество и внутренняя мастерская.")
  ];
}

function buildSeedPositions(): StructurePosition[] {
  return [
    createPosition("pos_admin", "dep_management", "Админ", "Админ", 1, "admin", false),
    createPosition("pos_head_dubbers", "dep_management", "Глава дабберов", "Глава дабберов", 2, "leadership", true),
    createPosition("pos_head_anime", "dep_anime", "Глава аниме", "Глава аниме", 3, "leadership", true),
    createPosition("pos_head_translators", "dep_management", "Глава переводчиков", "Глава переводчиков", 4, "leadership", true),
    createPosition("pos_curator_serials", "dep_serials", "Куратор сериалов", "Куратор сериалов", 5, "curator", true),
    createPosition("pos_curator_telegram", "dep_media", "Куратор телеграма", "Куратор телеграма", 6, "curator", true),
    createPosition("pos_curator_ongoings", "dep_ongoings", "Куратор онгоингов", "Куратор онгоингов", 7, "curator", true),
    createPosition("pos_curator_dorama", "dep_dorama", "Куратор дорам", "Куратор дорам", 8, "curator", true),
    createPosition("pos_curator_funny", "dep_funny", "Куратор смешных озвучек", "Куратор смешных озвучек", 9, "curator", true),
    createPosition("pos_curator_books", "dep_books", "Куратор книг", "Куратор книг", 10, "curator", true),
    createPosition("pos_teacher", "dep_training", "Учитель", "Учитель", 11, "support", true),
    createPosition("pos_curator_dubbing", "dep_management", "Куратор дубляжа", "Куратор дубляжа", 12, "curator", true)
  ];
}

function buildSeedParticipantRoles(): DirectoryRecord[] {
  return [
    createDirectoryRecord("voice_cast", "Актер озвучивания", "Озвучивание ролей, персонажей и голосовых партий."),
    createDirectoryRecord("translation", "Переводчик", "Перевод и адаптация текста."),
    createDirectoryRecord("mixing", "Звукорежиссёр", "Сведение и сборка звука."),
    createDirectoryRecord("design", "Оформитель", "Графика, визуальные материалы и оформление релиза."),
    createDirectoryRecord("vocal", "Вокалист", "Вокальные партии и музыкальные вставки."),
    createDirectoryRecord("tech_support", "Техническая поддержка", "Подготовка материалов, сборка и служебные технические задачи.")
  ];
}

function buildSeedSkills(): DirectoryRecord[] {
  return [
    createDirectoryRecord("skill_script_adaptation", "Адаптация текста", "Подготовка текста под озвучивание и удобную подачу реплик."),
    createDirectoryRecord("skill_audio_cleanup", "Чистка звука", "Удаление шумов, щелчков и базовая звуковая обработка."),
    createDirectoryRecord("skill_project_prep", "Подготовка проекта", "Сборка материалов, проверка файлов и подготовка сессии к работе."),
    createDirectoryRecord("skill_qc", "Проверка качества", "Проверка готового материала перед публикацией или сдачей."),
    createDirectoryRecord("skill_release_posting", "Подготовка поста", "Сборка финального текста поста, ссылок и подписей."),
    createDirectoryRecord("skill_music_work", "Работа с музыкальными вставками", "Подготовка вокальных и музыкальных фрагментов для релиза.")
  ];
}

function buildSeedSpecializations(): DirectoryRecord[] {
  return [
    createDirectoryRecord("spec_lead_roles", "Главные роли"),
    createDirectoryRecord("spec_secondary_roles", "Второстепенные роли"),
    createDirectoryRecord("spec_comedy_delivery", "Комедийная подача"),
    createDirectoryRecord("spec_dramatic_delivery", "Драматическая подача"),
    createDirectoryRecord("spec_audio_cleanup", "Восстановление и чистка звука"),
    createDirectoryRecord("spec_song_parts", "Песенные партии")
  ];
}

function buildSeedParticipantStatuses(): DirectoryRecord[] {
  return [
    createDirectoryRecord("active", "Активный"),
    createDirectoryRecord("reserve", "Резерв"),
    createDirectoryRecord("blocked", "Блок"),
    createDirectoryRecord("left", "Ушедший"),
    createDirectoryRecord("inactive", "Неактивный")
  ];
}

function buildSeedReleaseStatuses(): DirectoryRecord[] {
  return [
    createDirectoryRecord("announcement", "Анонс"),
    createDirectoryRecord("in_work", "Активный"),
    createDirectoryRecord("completed", "Завершён"),
    createDirectoryRecord("frozen", "Заморожен"),
    createDirectoryRecord("archived", "Архивный"),
    createDirectoryRecord("canceled", "Отменён")
  ];
}

function buildSeedReleaseTypes(): DirectoryRecord[] {
  return [
    createDirectoryRecord("anime", "Аниме"),
    createDirectoryRecord("ongoing", "Онгоинги"),
    createDirectoryRecord("series", "Сериалы"),
    createDirectoryRecord("film", "Фильм"),
    createDirectoryRecord("dorama", "Дорама"),
    createDirectoryRecord("book", "Книга"),
    createDirectoryRecord("funny", "Смешная озвучка")
  ];
}

function buildSeedExternalSourceTypes(): DirectoryRecord[] {
  return [
    createDirectoryRecord("fsg", "FSG"),
    createDirectoryRecord("partner", "Партнёр"),
    createDirectoryRecord("translator", "Внешний переводчик"),
    createDirectoryRecord("studio", "Внешняя команда"),
    createDirectoryRecord("vk_only", "Только упоминание VK")
  ];
}

function buildSeedPlatforms(): DirectoryRecord[] {
  return [
    createDirectoryRecord("kodik", "Kodik"),
    createDirectoryRecord("anime365", "Anime365"),
    createDirectoryRecord("telegram", "Telegram"),
    createDirectoryRecord("vk", "VK"),
    createDirectoryRecord("youtube", "YouTube"),
    createDirectoryRecord("rutube", "RuTube")
  ];
}

function buildSeedGenres(): DirectoryRecord[] {
  return [
    createDirectoryRecord("comedy", "Комедия"),
    createDirectoryRecord("drama", "Драма"),
    createDirectoryRecord("romance", "Романтика"),
    createDirectoryRecord("action", "Экшен"),
    createDirectoryRecord("fantasy", "Фэнтези"),
    createDirectoryRecord("mystery", "Мистика"),
    createDirectoryRecord("adventure", "Приключения"),
    createDirectoryRecord("slice_of_life", "Повседневность"),
    createDirectoryRecord("school", "Школа"),
    createDirectoryRecord("sports", "Спорт"),
    createDirectoryRecord("sci_fi", "Научная фантастика"),
    createDirectoryRecord("thriller", "Триллер"),
    createDirectoryRecord("horror", "Ужасы"),
    createDirectoryRecord("historical", "Историческое"),
    createDirectoryRecord("supernatural", "Сверхъестественное"),
    createDirectoryRecord("mecha", "Меха"),
    createDirectoryRecord("music", "Музыка"),
    createDirectoryRecord("psychological", "Психологическое"),
    createDirectoryRecord("detective", "Детектив"),
    createDirectoryRecord("erotica", "Эротика"),
    createDirectoryRecord("isekai", "Исекай"),
    createDirectoryRecord("shounen", "Сёнэн"),
    createDirectoryRecord("shoujo", "Сёдзё"),
    createDirectoryRecord("seinen", "Сэйнэн"),
    createDirectoryRecord("josei", "Дзёсэй"),
    createDirectoryRecord("ecchi", "Этти"),
    createDirectoryRecord("harem", "Гарем"),
    createDirectoryRecord("reverse_harem", "Реверс-гарем"),
    createDirectoryRecord("magic", "Магия"),
    createDirectoryRecord("martial_arts", "Боевые искусства"),
    createDirectoryRecord("military", "Военное"),
    createDirectoryRecord("vampires", "Вампиры"),
    createDirectoryRecord("demons", "Демоны"),
    createDirectoryRecord("survival", "Выживание"),
    createDirectoryRecord("post_apocalyptic", "Постапокалипсис"),
    createDirectoryRecord("cyberpunk", "Киберпанк"),
    createDirectoryRecord("parody", "Пародия"),
    createDirectoryRecord("crime", "Криминал"),
    createDirectoryRecord("everyday", "Бытовое"),
    createDirectoryRecord("workplace", "Работа и студия"),
    createDirectoryRecord("family", "Семья"),
    createDirectoryRecord("friendship", "Дружба"),
    createDirectoryRecord("politics", "Политика"),
    createDirectoryRecord("mythology", "Мифология")
  ];
}

function buildSeedTags(): DirectoryRecord[] {
  return [
    createDirectoryRecord("fronda", "#FRONDA"),
    createDirectoryRecord("new_release", "#новыйрелиз"),
    createDirectoryRecord("new_episode", "#новаясерия"),
    createDirectoryRecord("weekly_release", "#еженедельныйрелиз"),
    createDirectoryRecord("anime", "#аниме"),
    createDirectoryRecord("dorama", "#дорама"),
    createDirectoryRecord("series", "#сериал"),
    createDirectoryRecord("film", "#фильм"),
    createDirectoryRecord("voice", "#озвучка"),
    createDirectoryRecord("dub", "#дубляж"),
    createDirectoryRecord("subtitles", "#субтитры"),
    createDirectoryRecord("ongoing", "#онгоинг"),
    createDirectoryRecord("completed", "#завершено"),
    createDirectoryRecord("romance", "#романтика"),
    createDirectoryRecord("fantasy", "#фэнтези"),
    createDirectoryRecord("action", "#экшен"),
    createDirectoryRecord("comedy", "#комедия"),
    createDirectoryRecord("drama", "#драма"),
    createDirectoryRecord("mystery", "#мистика"),
    createDirectoryRecord("slice_of_life", "#повседневность"),
    createDirectoryRecord("adventure", "#приключения"),
    createDirectoryRecord("thriller", "#триллер"),
    createDirectoryRecord("horror", "#ужасы"),
    createDirectoryRecord("erotica", "#эротика")
  ];
}

function buildSeedNoteTypes(): DirectoryRecord[] {
  return [
    createDirectoryRecord("directing_note", "Режиссура"),
    createDirectoryRecord("tech_note", "Техника"),
    createDirectoryRecord("equipment_note", "Оборудование"),
    createDirectoryRecord("communication_note", "Коммуникация"),
    createDirectoryRecord("potential_note", "Пригодность")
  ];
}

function buildSeedDisciplinaryTypes(): DirectoryRecord[] {
  return [
    createDirectoryRecord("remark", "Замечание"),
    createDirectoryRecord("warning", "Предупреждение"),
    createDirectoryRecord("blacklist", "Чёрный список"),
    createDirectoryRecord("block", "Блок")
  ];
}

function buildSeedRewardTypes(): DirectoryRecord[] {
  return [
    createDirectoryRecord("positive_note", "Положительная пометка"),
    createDirectoryRecord("initiative", "Инициативность"),
    createDirectoryRecord("key_member", "Ключевой участник"),
    createDirectoryRecord("priority_top", "Приоритет топ-релизов"),
    createDirectoryRecord("priority_commercial", "Приоритет заказных проектов")
  ];
}

function buildSeedTemplates(): PostTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: "tpl_standard_release",
      schema_version: DATASET_SCHEMA_VERSION,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: BOOTSTRAP_ACTOR,
      status: "active",
      name: "Основной релизный пост",
      template_type: "standard_release_post",
      description: "Основной шаблон релизного поста FRONDA с площадками, составом, описанием и тегами.",
      block_order: ["header", "platforms", "voice_cast", "mixing", "curator", "translation", "timing", "design", "rating", "genres", "description", "tags", "footer"],
      hide_empty_blocks: true,
      role_group_labels: {
        voice_cast: "Роли озвучивали",
        translation: "Перевод",
        mixing: "Звукорежиссер",
        curator: "Куратор",
        external_source: "Перевод",
        timing: "Тайминг",
        design: "Оформление",
        rating: "Возрастной рейтинг"
      },
      name_style: "mention_name",
      applicable_department_ids: ["dep_anime", "dep_dorama", "dep_films", "dep_serials", "dep_ongoings", "dep_books", "dep_funny", "dep_erotica"],
      applicable_release_type_ids: ["anime", "ongoing", "series", "film", "dorama", "book", "funny"],
      footer: ""
    }
  ];
}

function createDepartment(
  id: string,
  name: string,
  shortName: string,
  sortOrder: number,
  onboardingVisible: boolean,
  departmentTypeId: string,
  tags: string[]
): DepartmentDirectoryItem {
  return {
    ...createRecordMeta(id),
    name,
    short_name: shortName,
    slug: slugifySeed(name),
    department_type_id: departmentTypeId,
    parent_department_id: null,
    onboarding_visible_flag: onboardingVisible,
    sort_order: sortOrder,
    tags
  };
}

function createDepartmentProfile(
  departmentId: string,
  onboardingVisible: boolean,
  descriptionOnboarding: string
): DepartmentProfile {
  return {
    department_id: departmentId,
    description_internal: "",
    description_onboarding: descriptionOnboarding,
    responsibility_summary: "",
    default_contact_participant_id: null,
    onboarding_visible_flag: onboardingVisible
  };
}

function createPosition(
  id: string,
  departmentId: string,
  name: string,
  shortLabel: string,
  sortOrder: number,
  positionType: string,
  onboardingVisible: boolean
): StructurePosition {
  return {
    ...createRecordMeta(id),
    department_id: departmentId,
    name,
    short_label: shortLabel,
    position_type_id: positionType,
    reports_to_position_id: null,
    is_leadership: positionType === "leadership",
    is_curator: positionType === "curator",
    is_admin: positionType === "admin",
    is_single_seat: true,
    can_have_multiple_holders: false,
    responsibility_scope_ids: [],
    onboarding_visible_flag: onboardingVisible,
    sort_order: sortOrder,
    description_internal: "",
    description_onboarding: ""
  };
}

function createDirectoryRecord(id: string, name: string, description = "", aliases: string[] = [], color = ""): DirectoryRecord {
  return {
    ...createRecordMeta(id),
    name,
    description,
    archived: false,
    aliases,
    color
  };
}

function createExternalSource(id: string, name: string, externalSourceTypeId: string): ExternalSource {
  return {
    ...createRecordMeta(id),
    external_source_type_id: externalSourceTypeId,
    name,
    aliases: [],
    contacts: [],
    links: [],
    preferred_post_label: name,
    comment: undefined
  };
}

function buildSeedExternalSources(): ExternalSource[] {
  return [
    createExternalSource("src_subs_default", "Субтитры", "translator"),
    createExternalSource("src_fsg_default", "Партнерская FSG", "fsg"),
    createExternalSource("src_partner_default", "Партнерский перевод", "partner")
  ];
}

function createRecordMeta(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    schema_version: DATASET_SCHEMA_VERSION,
    record_revision: 1,
    created_at: now,
    updated_at: now,
    updated_by: BOOTSTRAP_ACTOR,
    status: "active"
  };
}

function mergeSeedRecords<T extends { id: string; name?: string }>(
  current: T[],
  seeds: T[]
): { records: T[]; changed: boolean } {
  const records = [...current];
  const currentById = new Set(current.map((item) => item.id));
  const currentByName = new Set(
    current
      .map((item) => normalizeSeedKey(item.name))
      .filter((item): item is string => Boolean(item))
  );

  let changed = false;
  for (const seed of seeds) {
    const seedName = normalizeSeedKey(seed.name);
    if (currentById.has(seed.id) || (seedName && currentByName.has(seedName))) {
      continue;
    }
    records.push(seed);
    currentById.add(seed.id);
    if (seedName) {
      currentByName.add(seedName);
    }
    changed = true;
  }

  return { records, changed };
}

function mergeDepartmentProfiles(
  current: DepartmentProfile[],
  seeds: DepartmentProfile[]
): { records: DepartmentProfile[]; changed: boolean } {
  const records = [...current];
  const seen = new Set(current.map((item) => item.department_id));
  let changed = false;

  for (const seed of seeds) {
    if (seen.has(seed.department_id)) {
      continue;
    }
    records.push(seed);
    seen.add(seed.department_id);
    changed = true;
  }

  return { records, changed };
}

function detectEntityType(relativePath: string): string {
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
  if (relativePath.startsWith(`templates${path.sep}`)) {
    return "template";
  }
  if (relativePath.startsWith(`external${path.sep}`)) {
    return "external";
  }
  return "generic";
}

function detectEntityId(relativePath: string): string | undefined {
  const match = relativePath.match(/(prt_[^\\/]+|rel_[^\\/]+|tpl_[^\\/]+|dep_[^\\/]+|pos_[^\\/]+)/);
  return match?.[1];
}

function slugifySeed(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSeedKey(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}
