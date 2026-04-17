import type { Dirent } from "node:fs";
import path from "node:path";
import type {
  DashboardSummary,
  DatasetManifest,
  DepartmentDirectoryItem,
  DepartmentProfile,
  DirectoryRecord,
  DisciplinaryEvent,
  EntityManifest,
  ExternalSource,
  GeneratedPostSnapshot,
  ImportBatch,
  EntityHistoryEntry,
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
  ReleaseContent,
  ReleaseCore,
  ReleaseExternalAssignment,
  ReleaseListItem,
  ReleaseParticipantAssignment,
  ReleaseRoleAssignment,
  ReleasePosting,
  RewardEvent,
  StatisticsSummary,
  StructureContact,
  StructureNote,
  StructurePosition,
  Substitution,
  TemporaryAssignment,
  WorkspaceSnapshot
} from "@shared/types";
import { accessWithRetry, readDirentsWithRetry, readTextFile } from "./fs-utils";
import { GitService } from "./git-service";

const DIRECTORY_FILES = [
  "departments",
  "structure_positions",
  "participant_roles",
  "skills",
  "specializations",
  "participant_statuses",
  "release_types",
  "release_statuses",
  "note_types",
  "disciplinary_types",
  "reward_types",
  "external_source_types",
  "platforms",
  "genres",
  "tags"
] as const;

async function readDirectoryJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await withReadTimeout(filePath);
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const READ_CONCURRENCY_LIMIT = 16;
const READ_FILE_TIMEOUT_MS = 1200;

async function withReadTimeout(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`READ_TIMEOUT:${filePath}`));
    }, READ_FILE_TIMEOUT_MS);
    readTextFile(filePath)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeStatusToken(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function getParticipantListStatus(participant: ParticipantAggregate): string {
  const normalized = normalizeStatusToken(participant.profile.participant_status_id);
  const archivedRequested = participant.profile.status === "archived" || Boolean(participant.profile.archived_at);
  const leftRequested = Boolean(participant.profile.left_at);
  if (normalized === "active") {
    if (leftRequested) return "left";
    return archivedRequested ? "archived" : "active";
  }
  if (normalized === "reserve") return "reserve";
  if (normalized === "blocked") return "blocked";
  if (normalized === "left") return "left";
  if (normalized === "inactive") return "inactive";
  if (normalized === "archived") return "archived";
  if (leftRequested) {
    return "left";
  }
  if (archivedRequested) {
    return "archived";
  }
  if (participant.profile.reserve_flag) return "reserve";
  return normalized || "active";
}

function computeParticipantListActivityLevel(participant: ParticipantAggregate): string {
  const recentReward = participant.rewards.find((entry) => entry.tags.includes("active"));
  if (recentReward) {
    return "активный";
  }
  if (participant.profile.reserve_flag) {
    return "резерв";
  }
  return participant.rewards.length > 0 ? "умеренный" : "низкий";
}

function computeParticipantListReliabilityLevel(participant: ParticipantAggregate): string {
  const negative = participant.discipline.filter((entry) => entry.active_flag).length;
  const positive =
    participant.org.staffing_flags.filter((flag) => flag === "key_member" || flag === "priority_top").length
    + participant.rewards.filter((entry) =>
      entry.tags.some((tag) => tag === "key_member" || tag === "priority_top")
    ).length;
  if (negative >= 3) {
    return "риск";
  }
  if (positive >= 1) {
    return "высокая";
  }
  return "нормальная";
}

export class DatasetRepository {
  constructor(private readonly gitService: GitService) {}

  async loadWorkspaceSnapshot(
    sharedPath: string,
    manifest: DatasetManifest,
    fallbackSnapshot?: WorkspaceSnapshot | null
  ): Promise<WorkspaceSnapshot> {
    const directories = await this.loadDirectories(sharedPath);
    const structure = await this.loadStructure(sharedPath);
    const participants = await this.loadParticipants(sharedPath, fallbackSnapshot?.participants ?? []);
    const releases = await this.loadReleases(sharedPath, fallbackSnapshot?.releases ?? []);
    const externalSources = await this.loadExternalSources(sharedPath);
    const templates = await this.loadTemplates(sharedPath);
    const imports = await this.loadImports(sharedPath);
    const participantList = this.buildParticipantList(participants);
    const releaseList = this.buildReleaseList(releases);
    const statistics = this.buildStatistics(releases);
    const dashboard = this.buildDashboard(participantList, releaseList, imports, participants);
    const git = await this.gitService.getStatus();

    return {
      manifest,
      dashboard,
      participantList,
      releaseList,
      directories,
      departments: (directories.departments as unknown as DepartmentDirectoryItem[]) ?? [],
      structurePositions: structure.positions,
      departmentProfiles: structure.departmentProfiles,
      assignments: structure.assignments,
      substitutions: structure.substitutions,
      temporaryAssignments: structure.temporaryAssignments,
      structureContacts: structure.contacts,
      structureNotes: structure.notes,
      participants,
      releases,
      externalSources,
      templates,
      imports,
      statistics,
      git
    };
  }

  private buildDefaultEntityManifest(
    entityId: string,
    entityType: "participant" | "release",
    fallback?: EntityManifest | null,
    updatedAt?: string,
    updatedBy?: string
  ): EntityManifest {
    return {
      entity_id: entityId,
      entity_type: entityType,
      entity_revision: fallback?.entity_revision ?? 1,
      files: fallback?.files ?? [],
      updated_at: updatedAt ?? fallback?.updated_at ?? new Date().toISOString(),
      updated_by: updatedBy ?? fallback?.updated_by ?? "system",
      last_commit_id: fallback?.last_commit_id ?? null
    };
  }

  private buildFallbackParticipantProfile(
    participantId: string,
    registryItem?: ParticipantListItem | null,
    fallback?: ParticipantAggregate | null
  ): ParticipantProfile | null {
    if (fallback?.profile) {
      return fallback.profile;
    }
    if (!registryItem) {
      const now = new Date().toISOString();
      return {
        id: participantId,
        schema_version: 1,
        record_revision: 1,
        created_at: now,
        updated_at: now,
        updated_by: "system",
        status: "active",
        nickname: participantId,
        display_name: `Недоступный участник (${participantId})`,
        participant_status_id: "active",
        reserve_flag: false,
        contacts: [],
        posting: {}
      };
    }
    const now = new Date().toISOString();
    return {
      id: participantId,
      schema_version: 1,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: "system",
      status: registryItem.status === "archived" ? "archived" : "active",
      nickname: registryItem.nickname,
      display_name: registryItem.displayName || registryItem.nickname || participantId,
      participant_status_id: registryItem.status || "active",
      reserve_flag: registryItem.status === "reserve",
      contacts: [],
      posting: {}
    };
  }

  private buildFallbackParticipantOrg(
    participantId: string,
    registryItem?: ParticipantListItem | null,
    fallback?: ParticipantAggregate | null,
    profileFallback?: ParticipantProfile | null
  ): ParticipantOrg {
    if (fallback?.org) {
      return fallback.org;
    }
    const now = profileFallback?.updated_at ?? new Date().toISOString();
    const actor = profileFallback?.updated_by ?? "system";
    return {
      id: `${participantId}_org`,
      schema_version: 1,
      record_revision: 1,
      created_at: profileFallback?.created_at ?? now,
      updated_at: now,
      updated_by: actor,
      status: "active",
      department_assignments: (registryItem?.departmentIds ?? []).map((departmentId, index) => ({
        department_id: departmentId,
        assignment_status: "active",
        primary_flag: index === 0
      })),
      role_assignments: (registryItem?.roleIds ?? []).map((roleId) => ({
        role_id: roleId,
        active: true
      })),
      desired_role_ids: [],
      skill_entries: [],
      specialization_entries: [],
      staffing_flags: []
    };
  }

  private buildFallbackReleaseCore(
    releaseId: string,
    registryItem?: ReleaseListItem | null,
    fallback?: ReleaseAggregate | null
  ): ReleaseCore | null {
    if (fallback?.release) {
      return fallback.release;
    }
    if (!registryItem) {
      const now = new Date().toISOString();
      return {
        id: releaseId,
        schema_version: 1,
        record_revision: 1,
        created_at: now,
        updated_at: now,
        updated_by: "system",
        status: "active",
        title_primary: `Недоступный релиз (${releaseId})`,
        title_secondary: "",
        release_type_id: "series",
        release_status_id: "planned",
        primary_department_id: "",
        department_ids: [],
        curator_id: null,
        co_curator_ids: [],
        commissioned_flag: false,
        top_release_flag: false,
        archival_state: "",
        release_visibility: "internal"
      };
    }
    const now = new Date().toISOString();
    return {
      id: releaseId,
      schema_version: 1,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: "system",
      status: "active",
      title_primary: registryItem.title || "Новый релиз",
      title_secondary: "",
      release_type_id: registryItem.type || "series",
      release_status_id: registryItem.status || "planned",
      primary_department_id: registryItem.primaryDepartmentId,
      department_ids: registryItem.departmentIds ?? [registryItem.primaryDepartmentId].filter(Boolean),
      curator_id: registryItem.curatorId ?? null,
      co_curator_ids: [],
      commissioned_flag: false,
      top_release_flag: false,
      archival_state: registryItem.archivalState || "",
      release_visibility: "internal",
      release_year: registryItem.year ?? null
    };
  }

  async loadDirectories(sharedPath: string): Promise<Record<string, DirectoryRecord[]>> {
    const entries = await Promise.all(
      DIRECTORY_FILES.map(async (name) => {
        const filePath = path.join(sharedPath, "directories", `${name}.json`);
        const data = await readDirectoryJson<DirectoryRecord[]>(filePath, []);
        return [name, data] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  async loadStructure(sharedPath: string): Promise<{
    departmentProfiles: DepartmentProfile[];
    positions: StructurePosition[];
    assignments: PositionAssignment[];
    substitutions: Substitution[];
    temporaryAssignments: TemporaryAssignment[];
    contacts: StructureContact[];
    notes: StructureNote[];
  }> {
    return {
      departmentProfiles: await readDirectoryJson(
        path.join(sharedPath, "structure", "department_profiles.json"),
        []
      ),
      positions: await readDirectoryJson(
        path.join(sharedPath, "directories", "structure_positions.json"),
        []
      ),
      assignments: await readDirectoryJson(
        path.join(sharedPath, "structure", "position_assignments.json"),
        []
      ),
      substitutions: await readDirectoryJson(
        path.join(sharedPath, "structure", "substitutions.json"),
        []
      ),
      temporaryAssignments: await readDirectoryJson(
        path.join(sharedPath, "structure", "temporary_assignments.json"),
        []
      ),
      contacts: await readDirectoryJson(
        path.join(sharedPath, "structure", "structure_contacts.json"),
        []
      ),
      notes: await readDirectoryJson(path.join(sharedPath, "structure", "structure_notes.json"), [])
    };
  }

  async loadParticipants(sharedPath: string, fallbackParticipants: ParticipantAggregate[] = []): Promise<ParticipantAggregate[]> {
    const byIdDir = path.join(sharedPath, "participants", "by_id");
    const registryItems = await readDirectoryJson<ParticipantListItem[]>(
      path.join(sharedPath, "participants", "registry.json"),
      []
    );
    const fileRegistry = await readDirectoryJson<RegistryEntry[]>(
      path.join(sharedPath, "registry", "file_registry.json"),
      []
    );
    const registryById = new Map(registryItems.map((item) => [item.id, item]));
    const fallbackById = new Map(fallbackParticipants.map((item) => [item.profile.id, item]));
    const fileRegistryIds = fileRegistry
      .filter((entry) => entry.path?.startsWith("participants/by_id/") && entry.path?.endsWith("/profile.json"))
      .map((entry) => entry.entity_id)
      .filter((value): value is string => Boolean(value));
    const dirIds = (await this.safeReadDir(byIdDir))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    const participantIds = Array.from(
      new Set([
        ...registryItems.map((item) => item.id),
        ...fileRegistryIds,
        ...dirIds,
        ...fallbackParticipants.map((item) => item.profile.id)
      ])
    );
    const aggregates = await mapWithConcurrency(participantIds, READ_CONCURRENCY_LIMIT, async (participantId) => {
      const basePath = path.join(byIdDir, participantId);
      return this.loadParticipantAggregate(
        basePath,
        fallbackById.get(participantId) ?? null,
        registryById.get(participantId) ?? null
      );
    });
    return (aggregates.filter(Boolean) as ParticipantAggregate[]).sort((left, right) => {
      const leftOrder = left.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.profile.display_name.localeCompare(right.profile.display_name, "ru");
    });
  }

  async loadParticipantAggregate(
    basePath: string,
    fallback?: ParticipantAggregate | null,
    registryItem?: ParticipantListItem | null
  ): Promise<ParticipantAggregate | null> {
    const participantId = path.basename(basePath);
    const profile = await readDirectoryJson<ParticipantProfile | null>(
      path.join(basePath, "profile.json"),
      this.buildFallbackParticipantProfile(participantId, registryItem, fallback)
    );
    if (!profile) {
      return null;
    }
    const entity_manifest = await readDirectoryJson<EntityManifest>(
      path.join(basePath, "entity_manifest.json"),
      this.buildDefaultEntityManifest(
        profile.id,
        "participant",
        fallback?.entity_manifest,
        profile.updated_at,
        profile.updated_by
      )
    );
    const org = await readDirectoryJson<ParticipantOrg>(
      path.join(basePath, "org.json"),
      this.buildFallbackParticipantOrg(profile.id, registryItem, fallback, profile)
    );
    const equipment = await readDirectoryJson<ParticipantEquipment>(
      path.join(basePath, "equipment.json"),
      fallback?.equipment ?? {
        id: `${profile.id}_equipment`,
        schema_version: 1,
        record_revision: 1,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        updated_by: profile.updated_by,
        status: "active"
      }
    );
    const voice_sample = await readDirectoryJson<ParticipantVoiceSample>(
      path.join(basePath, "voice_sample.json"),
      fallback?.voice_sample ?? {
        id: `${profile.id}_voice`,
        schema_version: 1,
        record_revision: 1,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        updated_by: profile.updated_by,
        status: "active",
        voice_sample_present: registryItem?.hasVoiceSample ?? false,
        voice_tags: []
      }
    );
    const notes = await readDirectoryJson<ParticipantNote[]>(path.join(basePath, "notes.json"), fallback?.notes ?? []);
    const discipline = await readDirectoryJson<DisciplinaryEvent[]>(
      path.join(basePath, "discipline.json"),
      fallback?.discipline ?? []
    );
    const rewards = await readDirectoryJson<RewardEvent[]>(
      path.join(basePath, "rewards.json"),
      fallback?.rewards ?? []
    );
    const loadedHistory = await this.loadHistory(path.join(basePath, "history.jsonl"));
    const history = loadedHistory.length > 0 ? loadedHistory : (fallback?.history ?? []);
    return {
      entity_manifest,
      profile,
      org,
      equipment,
      voice_sample,
      notes,
      discipline,
      rewards,
      history
    };
  }

  async loadReleases(sharedPath: string, fallbackReleases: ReleaseAggregate[] = []): Promise<ReleaseAggregate[]> {
    const byIdDir = path.join(sharedPath, "releases", "by_id");
    const registryItems = await readDirectoryJson<ReleaseListItem[]>(
      path.join(sharedPath, "releases", "registry.json"),
      []
    );
    const fileRegistry = await readDirectoryJson<RegistryEntry[]>(
      path.join(sharedPath, "registry", "file_registry.json"),
      []
    );
    const registryById = new Map(registryItems.map((item) => [item.id, item]));
    const fallbackById = new Map(fallbackReleases.map((item) => [item.release.id, item]));
    const fileRegistryIds = fileRegistry
      .filter((entry) => entry.path?.startsWith("releases/by_id/") && entry.path?.endsWith("/release.json"))
      .map((entry) => entry.entity_id)
      .filter((value): value is string => Boolean(value));
    const dirIds = (await this.safeReadDir(byIdDir))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
    const releaseIds = Array.from(
      new Set([
        ...registryItems.map((item) => item.id),
        ...fileRegistryIds,
        ...dirIds,
        ...fallbackReleases.map((item) => item.release.id)
      ])
    );
    const aggregates = await mapWithConcurrency(releaseIds, READ_CONCURRENCY_LIMIT, async (releaseId) => {
      const basePath = path.join(byIdDir, releaseId);
      return this.loadReleaseAggregate(basePath, fallbackById.get(releaseId) ?? null, registryById.get(releaseId) ?? null);
    });
    return (aggregates.filter(Boolean) as ReleaseAggregate[]).sort((left, right) => {
      const leftOrder = left.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.release.title_primary.localeCompare(right.release.title_primary, "ru");
    });
  }

  async loadReleaseAggregate(
    basePath: string,
    fallback?: ReleaseAggregate | null,
    registryItem?: ReleaseListItem | null
  ): Promise<ReleaseAggregate | null> {
    const releaseId = path.basename(basePath);
    const release = await readDirectoryJson<ReleaseCore | null>(
      path.join(basePath, "release.json"),
      this.buildFallbackReleaseCore(releaseId, registryItem, fallback)
    );
    if (!release) {
      return null;
    }
    const entity_manifest = await readDirectoryJson<EntityManifest>(
      path.join(basePath, "entity_manifest.json"),
      this.buildDefaultEntityManifest(
        release.id,
        "release",
        fallback?.entity_manifest,
        release.updated_at,
        release.updated_by
      )
    );
    const participants = await readDirectoryJson<ReleaseParticipantAssignment[]>(
      path.join(basePath, "participants.json"),
      fallback?.participants ?? []
    );
    const roles = await readDirectoryJson<ReleaseRoleAssignment[]>(
      path.join(basePath, "roles.json"),
      fallback?.roles ?? []
    );
    const external = await readDirectoryJson<ReleaseExternalAssignment[]>(
      path.join(basePath, "external.json"),
      fallback?.external ?? []
    );
    const content = await readDirectoryJson<ReleaseContent>(
      path.join(basePath, "content.json"),
      fallback?.content ?? {
        id: `${release.id}_content`,
        schema_version: 1,
        record_revision: 1,
        created_at: release.created_at,
        updated_at: release.updated_at,
        updated_by: release.updated_by,
        status: "active",
        release_id: release.id,
        genre_ids: [],
        tag_ids: [],
        platform_links: []
      }
    );
    const posting = await readDirectoryJson<ReleasePosting>(
      path.join(basePath, "posting.json"),
      fallback?.posting ?? {
        id: `${release.id}_posting`,
        schema_version: 1,
        record_revision: 1,
        created_at: release.created_at,
        updated_at: release.updated_at,
        updated_by: release.updated_by,
        status: "active",
        release_id: release.id,
        post_tags_override: [],
        hide_empty_blocks_flag: true
      }
    );
    const generated_posts = await this.loadGeneratedPosts(path.join(basePath, "posts", "generated"));
    const loadedHistory = await this.loadHistory(path.join(basePath, "history.jsonl"));
    const history = loadedHistory.length > 0 ? loadedHistory : (fallback?.history ?? []);
    return {
      entity_manifest,
      release,
      participants,
      roles: Array.isArray(roles) ? roles : [],
      external,
      content,
      posting,
      generated_posts: generated_posts.length > 0 ? generated_posts : (fallback?.generated_posts ?? []),
      history
    };
  }

  async loadGeneratedPosts(dirPath: string): Promise<GeneratedPostSnapshot[]> {
    const files = await this.safeReadDir(dirPath);
    const targetFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const loaded = await mapWithConcurrency(targetFiles, READ_CONCURRENCY_LIMIT, async (entry) =>
      readDirectoryJson<GeneratedPostSnapshot>(path.join(dirPath, entry.name), null as never)
    );
    return loaded.filter(Boolean);
  }

  async loadExternalSources(sharedPath: string): Promise<ExternalSource[]> {
    const byIdDir = path.join(sharedPath, "external", "by_id");
    const files = await this.safeReadDir(byIdDir);
    const targetFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const loaded = await mapWithConcurrency(targetFiles, READ_CONCURRENCY_LIMIT, async (entry) =>
      readDirectoryJson<ExternalSource>(path.join(byIdDir, entry.name), null as never)
    );
    return loaded.filter(Boolean);
  }

  async loadTemplates(sharedPath: string): Promise<PostTemplate[]> {
    const dirPath = path.join(sharedPath, "templates", "post_templates");
    const files = await this.safeReadDir(dirPath);
    const targetFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const loaded = await mapWithConcurrency(targetFiles, READ_CONCURRENCY_LIMIT, async (entry) =>
      readDirectoryJson<PostTemplate>(path.join(dirPath, entry.name), null as never)
    );
    return loaded.filter(Boolean);
  }

  async loadImports(sharedPath: string): Promise<ImportBatch[]> {
    const statuses = ["pending", "review", "resolved", "rejected"] as const;
    const allBatches: ImportBatch[] = [];
    for (const status of statuses) {
      const statusDir = path.join(sharedPath, "imports", status);
      const entries = await this.safeReadDir(statusDir);
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const reviewFile = path.join(statusDir, entry.name, "review_state.json");
        if (await this.pathExists(reviewFile)) {
          const batch = await readDirectoryJson<ImportBatch>(reviewFile, null as never);
          if (batch) {
            allBatches.push(batch);
          }
        }
      }
    }
    return allBatches;
  }

  async loadHistory(filePath: string): Promise<EntityHistoryEntry[]> {
    try {
      const raw = await withReadTimeout(filePath);
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EntityHistoryEntry);
    } catch {
      return [];
    }
  }

  buildParticipantList(participants: ParticipantAggregate[]): ParticipantListItem[] {
    return participants.map((participant) => {
      const warningCount = participant.discipline.filter((entry) => entry.severity === "warning").length;
      const hasFlag = (flag: string) =>
        participant.org.staffing_flags.includes(flag)
        || participant.rewards.some((entry) => entry.tags.includes(flag));
      return {
        id: participant.profile.id,
        nickname: participant.profile.nickname,
        displayName: participant.profile.display_name,
        status: getParticipantListStatus(participant),
        departmentIds: participant.org.department_assignments.map((item) => item.department_id),
        roleIds: participant.org.role_assignments.filter((item) => item.active).map((item) => item.role_id),
        activityLevel: computeParticipantListActivityLevel(participant),
        reliabilityLevel: computeParticipantListReliabilityLevel(participant),
        warningCount,
        hasVoiceSample: participant.voice_sample.voice_sample_present,
        topReleaseFit: hasFlag("priority_top") || hasFlag("key_member")
      };
    });
  }

  buildReleaseList(releases: ReleaseAggregate[]): ReleaseListItem[] {
    return releases.map((release) => ({
      id: release.release.id,
      title: release.release.title_primary,
      status: release.release.release_status_id,
      type: release.release.release_type_id,
      primaryDepartmentId: release.release.primary_department_id,
      departmentIds: release.release.department_ids,
      curatorId: release.release.curator_id,
      year: release.release.release_year,
      archivalState: release.release.archival_state
    }));
  }

  buildDashboard(
    participants: ParticipantListItem[],
    releases: ReleaseListItem[],
    imports: ImportBatch[],
    participantAggregates: ParticipantAggregate[]
  ): DashboardSummary {
    return {
      participantCount: participants.length,
      activeParticipants: participants.filter((item) => item.status === "active").length,
      releaseCount: releases.length,
      releasesInWork: releases.filter((item) => item.status === "in_work").length,
      pendingImports: imports.filter((item) => item.queue_status === "pending" || item.queue_status === "review").length,
      activeWarnings: participantAggregates.reduce(
        (sum, participant) => sum + participant.discipline.filter((entry) => entry.active_flag).length,
        0
      ),
      staleLocks: 0
    };
  }

  buildStatistics(releases: ReleaseAggregate[]): StatisticsSummary {
    const byDepartment = new Map<string, number>();
    const byYear = new Map<string, number>();
    const byType = new Map<string, number>();
    let inWork = 0;
    let completed = 0;
    let frozen = 0;
    let canceled = 0;
    let lost = 0;
    for (const release of releases) {
      if (release.release.release_status_id === "in_work") {
        inWork += 1;
      }
      if (release.release.release_status_id === "completed") {
        completed += 1;
      }
      if (release.release.release_status_id === "frozen") {
        frozen += 1;
      }
      if (release.release.release_status_id === "canceled") {
        canceled += 1;
      }
      if (release.release.archival_state.includes("lost")) {
        lost += 1;
      }
      for (const departmentId of release.release.department_ids) {
        byDepartment.set(departmentId, (byDepartment.get(departmentId) ?? 0) + 1);
      }
      byYear.set(
        String(release.release.release_year ?? "Не указан"),
        (byYear.get(String(release.release.release_year ?? "Не указан")) ?? 0) + 1
      );
      byType.set(release.release.release_type_id, (byType.get(release.release.release_type_id) ?? 0) + 1);
    }
    return {
      totalReleases: releases.length,
      inWork,
      completed,
      frozen,
      canceled,
      lost,
      byDepartment: Array.from(byDepartment.entries()).map(([label, value]) => ({ label, value })),
      byYear: Array.from(byYear.entries()).map(([label, value]) => ({ label, value })),
      byType: Array.from(byType.entries()).map(([label, value]) => ({ label, value }))
    };
  }

  computeActivityLevel(participant: ParticipantAggregate): string {
    const recentReward = participant.rewards.find((entry) => entry.tags.includes("active"));
    if (recentReward) {
      return "активный";
    }
    if (participant.profile.reserve_flag) {
      return "резерв";
    }
    return participant.rewards.length > 0
      ? "умеренный"
      : "низкий";
  }

  computeReliabilityLevel(participant: ParticipantAggregate): string {
    const negative = participant.discipline.filter((entry) => entry.active_flag).length;
    const positive =
      participant.org.staffing_flags.filter((flag) => flag === "key_member" || flag === "priority_top").length
      + participant.rewards.filter((entry) =>
        entry.tags.some((tag) => tag === "key_member" || tag === "priority_top")
      ).length;
    if (negative >= 3) {
      return "риск";
    }
    if (positive >= 1) {
      return "высокая";
    }
    return "нормальная";
  }

  private async safeReadDir(dirPath: string): Promise<Dirent[]> {
    try {
      return await readDirentsWithRetry(dirPath);
    } catch {
      return [];
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await accessWithRetry(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
