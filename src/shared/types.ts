import type { NavigationSection } from "./branding";
import type { SystemSection } from "./constants";

export type Id = string;
export type ISODateTime = string;
export type VisibilityScope = "ALL" | "OPS" | "LEAD" | "PUB";
export type ImportTemplateKind =
  | "participants_master"
  | "releases_master"
  | "department_release_board"
  | "new_participant_form"
  | "mixed_historical"
  | "fronda_exchange_bundle"
  | "unknown";
export type SyncMode =
  | "RW_IN_SYNC"
  | "RO_STALE"
  | "RO_LOCKED_ENTITY"
  | "RO_CONFLICT"
  | "RO_RECOVERY"
  | "RO_OFFLINE"
  | "RO_PERMISSION"
  | "RO_SCHEMA_MISMATCH"
  | "RO_COMMIT_PENDING";

export interface RecordMeta {
  id: Id;
  schema_version: number;
  record_revision: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  updated_by: string;
  archived_at?: ISODateTime | null;
  status: string;
}

export interface DatasetManifest {
  dataset_kind: string;
  dataset_id: string;
  dataset_name: string;
  schema_version: number;
  app_min_version: string;
  dataset_revision: number;
  file_registry_revision: number;
  domain_revisions: Record<string, number>;
  state: "clean" | "commit_pending" | "repair_required";
  repair_mode: boolean;
  last_commit_id: string | null;
  last_commit_at: ISODateTime | null;
}

export interface RegistryEntry {
  path: string;
  domain: string;
  entity_type: string;
  entity_id?: Id;
  file_revision: number;
  entity_revision?: number;
  hash: string;
  size: number;
  updated_at: ISODateTime;
  updated_by: string;
  last_commit_id: string | null;
}

export interface EntityManifest {
  entity_id: Id;
  entity_type: string;
  entity_revision: number;
  files: string[];
  updated_at: ISODateTime;
  updated_by: string;
  last_commit_id: string | null;
}

export interface EntityHistoryEntry {
  id: Id;
  at: ISODateTime;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: Id;
  source?: "manual" | "import" | "restore" | "system" | "git";
  import_batch_id?: Id | null;
  file_path?: string | null;
  revision?: number | null;
  summary?: string;
  changes?: Array<{
    field: string;
    before?: string | null;
    after?: string | null;
  }>;
}

export interface WorkspaceValidationResult {
  valid: boolean;
  sharedPath: string;
  mode: SyncMode;
  errors: string[];
  warnings: string[];
  manifest?: DatasetManifest;
}

export interface LocalWorkspaceConfig {
  sharedDatasetPath: string;
  backupDirectoryPath: string;
  portableDataPath: string;
  lastOpenedAt: ISODateTime;
  machineFingerprint?: string;
  machineLabel?: string;
}

export interface AppSettings {
  theme: "dark";
  compactSidebar: boolean;
  showAdvancedMode: boolean;
  lastSection: NavigationSection;
  lastSystemSection: SystemSection;
}

export interface SavedView {
  id: Id;
  name: string;
  domain: "participants" | "releases";
  filters: Record<string, unknown>;
}

export interface DepartmentDirectoryItem extends RecordMeta {
  name: string;
  short_name: string;
  slug: string;
  department_type_id?: Id;
  parent_department_id?: Id | null;
  onboarding_visible_flag: boolean;
  sort_order: number;
  tags: string[];
}

export interface StructurePosition extends RecordMeta {
  department_id: Id;
  name: string;
  short_label: string;
  position_type_id?: Id;
  reports_to_position_id?: Id | null;
  is_leadership: boolean;
  is_curator: boolean;
  is_admin: boolean;
  is_single_seat: boolean;
  can_have_multiple_holders: boolean;
  responsibility_scope_ids: Id[];
  onboarding_visible_flag: boolean;
  sort_order: number;
  description_internal?: string;
  description_onboarding?: string;
}

export interface DepartmentProfile {
  department_id: Id;
  description_internal: string;
  description_onboarding: string;
  responsibility_summary: string;
  default_contact_participant_id?: Id | null;
  onboarding_visible_flag: boolean;
}

export interface PositionAssignment extends RecordMeta {
  position_id: Id;
  participant_id: Id;
  department_id: Id;
  assignment_kind: "permanent" | "acting" | "temporary" | "backup" | "internship" | "assistant";
  started_at: ISODateTime;
  planned_end_at?: ISODateTime | null;
  ended_at?: ISODateTime | null;
  active_flag: boolean;
  appointed_by?: Id | null;
  reason?: string;
  comment_internal?: string;
  visible_in_onboarding: boolean;
}

export interface ResponsibilityScope extends RecordMeta {
  name: string;
  description: string;
  onboarding_visible_flag: boolean;
}

export interface Substitution extends RecordMeta {
  source_position_id: Id;
  source_assignment_id?: Id | null;
  substitute_participant_id: Id;
  substitute_position_id?: Id | null;
  department_id: Id;
  started_at: ISODateTime;
  planned_end_at?: ISODateTime | null;
  ended_at?: ISODateTime | null;
  reason: string;
  visible_in_onboarding: boolean;
  comment_internal?: string;
}

export interface TemporaryAssignment extends RecordMeta {
  participant_id: Id;
  department_id: Id;
  position_id?: Id | null;
  responsibility_scope_id?: Id | null;
  started_at: ISODateTime;
  planned_end_at?: ISODateTime | null;
  ended_at?: ISODateTime | null;
  granted_by?: Id | null;
  reason: string;
  permissions_note?: string;
  visible_in_onboarding: boolean;
}

export interface StructureContact extends RecordMeta {
  department_id?: Id | null;
  position_id?: Id | null;
  participant_id?: Id | null;
  contact_type_id?: Id | null;
  display_label: string;
  contact_value: string;
  onboarding_visible_flag: boolean;
}

export interface StructureNote extends RecordMeta {
  department_id?: Id | null;
  position_id?: Id | null;
  author_id?: Id | null;
  body: string;
  visibility_scope: VisibilityScope;
  active_flag: boolean;
}

export interface PostingProfile {
  mention?: string;
  mention_id?: string;
  display_name_for_post?: string;
  vk_slug?: string;
  vk_url?: string;
  post_copy_string?: string;
}

export interface ParticipantProfile extends RecordMeta {
  nickname: string;
  nickname_pronunciation?: string;
  real_name?: string;
  display_name: string;
  participant_status_id: Id;
  sort_order?: number | null;
  reserve_flag: boolean;
  joined_at?: ISODateTime | null;
  reserve_since?: ISODateTime | null;
  left_at?: ISODateTime | null;
  availability_note?: string;
  contact_max?: string;
  contact_phone?: string;
  contact_telegram?: string;
  contact_vk?: string;
  contact_email?: string;
  contact_odnoklassniki?: string;
  contacts: string[];
  posting: PostingProfile;
}

export interface ParticipantOrg extends RecordMeta {
  department_assignments: Array<{
    department_id: Id;
    assignment_status: string;
    started_at?: ISODateTime | null;
    ended_at?: ISODateTime | null;
    primary_flag: boolean;
    comment?: string;
  }>;
  role_assignments: Array<{
    role_id: Id;
    department_id?: Id | null;
    note?: string;
    level?: string;
      confirmed_by?: Id | null;
      started_at?: ISODateTime | null;
      active: boolean;
  }>;
  desired_role_ids: Id[];
  skill_entries: Array<{
    skill_id: Id;
    level?: string;
    confirmed: boolean;
    confirmed_by?: Id | null;
    note?: string;
  }>;
  specialization_entries: Array<{
    specialization_id: Id;
    level?: string;
    priority?: number;
    comment?: string;
  }>;
  staffing_flags: string[];
}

export interface ParticipantEquipment extends RecordMeta {
  equipment_status?: string;
  microphone_type?: string;
  audio_interface?: string;
  recording_space_quality?: string;
  monitoring?: string;
  software_stack?: string;
  hardware_notes?: string;
  equipment_limitations?: string;
  noise_issues?: string;
  remote_recording_constraints?: string;
}

export interface ParticipantVoiceSample extends RecordMeta {
  voice_sample_present: boolean;
  voice_sample_url?: string;
  voice_sample_storage_ref?: string;
  voice_sample_uploaded_at?: ISODateTime | null;
  voice_sample_review_status?: string;
  voice_sample_reviewed_by?: Id | null;
  voice_sample_comment?: string;
  voice_tags: string[];
}

export interface ParticipantNote extends RecordMeta {
  participant_id: Id;
  note_type_id: Id;
  title: string;
  body: string;
  author_id?: Id | null;
  priority: "low" | "normal" | "high" | "critical";
  pinned: boolean;
  visibility_scope: VisibilityScope;
  review_date?: ISODateTime | null;
  resolved_at?: ISODateTime | null;
  active_flag: boolean;
  related_department_id?: Id | null;
}

export interface DisciplinaryEvent extends RecordMeta {
  participant_id: Id;
  disciplinary_type_id: Id;
  severity: "remark" | "warning" | "blacklist" | "block";
  date: ISODateTime;
  author_id?: Id | null;
  description: string;
  evidence_ref?: string;
  active_flag: boolean;
  expires_at?: ISODateTime | null;
  resolution_note?: string;
}

export interface RewardEvent extends RecordMeta {
  participant_id: Id;
  reward_type_id: Id;
  date: ISODateTime;
  author_id?: Id | null;
  description: string;
  value?: number | null;
  tags: string[];
}

export interface ParticipantAggregate {
  entity_manifest: EntityManifest;
  profile: ParticipantProfile;
  org: ParticipantOrg;
  equipment: ParticipantEquipment;
  voice_sample: ParticipantVoiceSample;
  notes: ParticipantNote[];
  discipline: DisciplinaryEvent[];
  rewards: RewardEvent[];
  history: EntityHistoryEntry[];
}

export interface ExternalSource extends RecordMeta {
  external_source_type_id: Id;
  name: string;
  aliases: string[];
  contacts: string[];
  links: string[];
  preferred_post_label?: string;
  comment?: string;
}

export interface ReleaseCore extends RecordMeta {
  title_primary: string;
  title_secondary?: string;
  short_title?: string;
  release_type_id: Id;
  release_status_id: Id;
  sort_order?: number | null;
  staffing_mode?: "confirmed" | "aligning" | "provisional" | null;
  primary_department_id: Id;
  department_ids: Id[];
  curator_id?: Id | null;
  co_curator_ids: Id[];
  production_priority?: string;
  commissioned_flag: boolean;
  top_release_flag: boolean;
  training_flag?: boolean;
  legacy_flag?: boolean;
  archival_state: string;
  release_visibility: string;
  season_number?: number | null;
  episode_start?: number | null;
  episode_end?: number | null;
  episode_count?: number | null;
  release_year?: number | null;
  first_publish_date?: ISODateTime | null;
  last_update_date?: ISODateTime | null;
}

export interface ReleaseParticipantAssignment extends RecordMeta {
  release_id: Id;
  participant_id: Id;
  role_id: Id;
  credit_group_id: string;
  credit_label_override?: string;
  display_name_override?: string;
  department_id?: Id | null;
  credit_order: number;
  is_primary_for_role: boolean;
  include_in_post: boolean;
  include_in_internal_stats: boolean;
  comment_internal?: string;
  active_flag: boolean;
}

export interface ReleaseRoleAssignment extends RecordMeta {
  release_id: Id;
  participant_id: Id;
  role_type: "main" | "secondary";
  character_names: string[];
  secondary_character_names: string[];
  display_order: number;
  comment_internal?: string;
  active_flag: boolean;
}

export interface ReleaseExternalAssignment extends RecordMeta {
  release_id: Id;
  external_source_id?: Id | null;
  external_source_type_id?: Id | null;
  credit_group_id: string;
  credit_label_override?: string;
  vk_mention?: string;
  vk_display_name?: string;
  translator_names?: string[];
  display_order: number;
  include_in_post: boolean;
  is_primary_source: boolean;
  comment_internal?: string;
}

export interface ReleaseContent extends RecordMeta {
  release_id: Id;
  description_short?: string;
  description_full?: string;
  post_description_override?: string;
  warning_notes?: string;
  genre_ids: Id[];
  tag_ids: Id[];
  platform_links: Array<{
    platform_id: Id;
    url?: string;
    label_override?: string;
    display_order: number;
    is_primary: boolean;
    active_flag: boolean;
  }>;
  country_of_origin?: string;
  age_rating?: string;
  content_status_note?: string;
}

export interface ReleasePosting extends RecordMeta {
  release_id: Id;
  default_post_template_id?: Id | null;
  episode_label_mode?: "range" | "single";
  separator_pattern?: string;
  include_age_rating_in_post?: boolean;
  post_header_override?: string;
  post_description_override?: string;
  post_tags_override: string[];
  post_platform_block_override?: string;
  post_external_block_override?: string;
  post_footer_override?: string;
  hide_empty_blocks_flag: boolean;
  posting_notes_internal?: string;
}

export interface GeneratedPostSnapshot extends RecordMeta {
  release_id: Id;
  template_id?: Id | null;
  title: string;
  content: string;
  finalized: boolean;
}

export interface ReleaseAggregate {
  entity_manifest: EntityManifest;
  release: ReleaseCore;
  participants: ReleaseParticipantAssignment[];
  roles: ReleaseRoleAssignment[];
  external: ReleaseExternalAssignment[];
  content: ReleaseContent;
  posting: ReleasePosting;
  generated_posts: GeneratedPostSnapshot[];
  history: EntityHistoryEntry[];
}

export interface PostTemplate extends RecordMeta {
  name: string;
  template_type: string;
  description?: string;
  block_order: string[];
  hide_empty_blocks: boolean;
  role_group_labels: Record<string, string>;
  name_style: "display_name" | "mention_name" | "credit_name";
  applicable_department_ids?: Id[];
  applicable_release_type_ids?: Id[];
  footer?: string;
}

export interface ImportBatch extends RecordMeta {
  source_filename: string;
  source_type: "excel" | "json";
  queue_status: "incoming" | "pending" | "review" | "resolved" | "rejected";
  fingerprint: string;
  candidate_matches: Id[];
  decision?: "create" | "update" | "review" | "reject" | "pending";
  template_kind?: ImportTemplateKind;
  sheet_names?: string[];
  detected_headers?: string[];
  detected_entities?: Record<string, number>;
  issue_count?: number;
}

export interface ImportHeaderMapping {
  original: string;
  canonical?: string;
  confidence: number;
  source_sheet?: string;
  sample_values: string[];
}

export interface ImportMappingOverride {
  id: Id;
  source_sheet?: string;
  original_header: string;
  canonical?: string;
  role_label?: string;
  ignore?: boolean;
}

export interface ImportMappingPreset {
  id: Id;
  name: string;
  source_signature: string;
  overrides: ImportMappingOverride[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
  author: string;
}

export interface ImportWorkbookSection {
  id: Id;
  sheet_name: string;
  kind: "header_band" | "data_block" | "status_marker" | "unknown";
  title?: string;
  row_start: number;
  row_end: number;
  header_row_number?: number;
  confidence: number;
  signals: string[];
  headers: ImportHeaderMapping[];
}

export interface ImportWorkbookSheetAnalysis {
  sheet_name: string;
  row_count: number;
  column_count: number;
  merged_range_count: number;
  hyperlink_count: number;
  formula_count: number;
  section_markers: string[];
  repeated_header_rows: number[];
  sections: ImportWorkbookSection[];
}

export interface ImportWorkbookAnalysis {
  source_signature: string;
  sheets: ImportWorkbookSheetAnalysis[];
  uncertain_sections: number;
  repeated_headers: number;
  status_markers: string[];
}

export interface ImportDuplicateMatch {
  id: Id;
  domain: "participant" | "release" | "external";
  matched_entity_id?: Id;
  matched_label: string;
  reason: string;
  confidence: number;
}

export interface ImportSourceRef {
  sheet_name: string;
  row_number: number;
}

export interface ImportParticipantCandidate {
  id: Id;
  display_label: string;
  confidence: number;
  confidence_reasons: string[];
  nickname?: string;
  real_name?: string;
  display_name?: string;
  mention?: string;
  mention_id?: string;
  vk_slug?: string;
  vk_url?: string;
  display_name_for_post?: string;
  department_ids: Id[];
  role_ids: Id[];
  skill_ids: Id[];
  specialization_ids: Id[];
  equipment_notes: string[];
  voice_sample_refs: string[];
  availability_note?: string;
  note_titles: string[];
  discipline_flags: string[];
  reward_flags: string[];
  source_refs: ImportSourceRef[];
  source_rows: number[];
  duplicate_matches: ImportDuplicateMatch[];
}

export interface ImportReleaseCandidate {
  id: Id;
  display_label: string;
  confidence: number;
  confidence_reasons: string[];
  title_primary: string;
  title_secondary?: string;
  release_type_id?: string;
  release_status_id?: string;
  primary_department_id?: string;
  department_ids: Id[];
  curator_hint?: string;
  release_year?: number;
  season_number?: number;
  episode_start?: number;
  episode_end?: number;
  platform_labels: string[];
  genre_labels: string[];
  tag_labels: string[];
  notes: string[];
  external_source_labels: string[];
  source_refs: ImportSourceRef[];
  source_rows: number[];
  duplicate_matches: ImportDuplicateMatch[];
}

export interface ImportReleaseRelationCandidate {
  id: Id;
  participant_candidate_id?: Id;
  participant_match_id?: Id;
  release_candidate_id?: Id;
  release_match_id?: Id;
  external_source_label?: string;
  role_labels: string[];
  department_hint?: string;
  source_refs: ImportSourceRef[];
  source_rows: number[];
  confidence: number;
  confidence_reasons: string[];
}

export interface ImportNoteCandidate {
  id: Id;
  participant_candidate_id?: Id;
  participant_match_id?: Id;
  release_candidate_id?: Id;
  release_match_id?: Id;
  title: string;
  body: string;
  note_type_hint?: string;
  source_refs: ImportSourceRef[];
  source_rows: number[];
}

export interface ImportDisciplinaryCandidate {
  id: Id;
  participant_candidate_id?: Id;
  participant_match_id?: Id;
  severity: "remark" | "warning" | "blacklist" | "block";
  description: string;
  source_refs: ImportSourceRef[];
  source_rows: number[];
}

export interface ImportRewardCandidate {
  id: Id;
  participant_candidate_id?: Id;
  participant_match_id?: Id;
  description: string;
  tags: string[];
  source_refs: ImportSourceRef[];
  source_rows: number[];
}

export interface ImportExternalSourceCandidate {
  id: Id;
  label: string;
  confidence: number;
  confidence_reasons: string[];
  source_type_hint?: string;
  links: string[];
  source_refs: ImportSourceRef[];
  source_rows: number[];
  duplicate_matches: ImportDuplicateMatch[];
}

export interface ImportIssue {
  id: Id;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  source_sheet?: string;
  source_rows: number[];
}

export interface StructuredImportPreview {
  batch: ImportBatch;
  template_kind: ImportTemplateKind;
  template_confidence: number;
  source_signature: string;
  sheet_names: string[];
  workbook: ImportWorkbookAnalysis;
  mapping_overrides: ImportMappingOverride[];
  detected_headers: ImportHeaderMapping[];
  participants: ImportParticipantCandidate[];
  releases: ImportReleaseCandidate[];
  relations: ImportReleaseRelationCandidate[];
  notes: ImportNoteCandidate[];
  discipline: ImportDisciplinaryCandidate[];
  rewards: ImportRewardCandidate[];
  external_sources: ImportExternalSourceCandidate[];
  duplicates: ImportDuplicateMatch[];
  issues: ImportIssue[];
  unknown_rows: Array<{
    source_sheet?: string;
    row_number: number;
    raw: Record<string, unknown>;
  }>;
  suggested_actions: string[];
  exchange_bundle?: FrondaExchangeBundle | null;
}

export interface FrondaExchangeBundle {
  format: "fronda_exchange_bundle";
  version: 1;
  exported_at: ISODateTime;
  exported_by: string;
  source_workspace?: string;
  directories: Record<string, DirectoryRecord[]>;
  structure: {
    department_profiles: DepartmentProfile[];
    position_assignments: PositionAssignment[];
    substitutions: Substitution[];
    temporary_assignments: TemporaryAssignment[];
    structure_contacts: StructureContact[];
    structure_notes: StructureNote[];
  };
  participants: ParticipantAggregate[];
  releases: ReleaseAggregate[];
  external_sources: ExternalSource[];
  templates: PostTemplate[];
}

export interface DirectoryRecord extends RecordMeta {
  name: string;
  description?: string;
  archived: boolean;
  aliases?: string[];
  color?: string;
}

export interface DashboardSummary {
  participantCount: number;
  activeParticipants: number;
  releaseCount: number;
  releasesInWork: number;
  pendingImports: number;
  activeWarnings: number;
  staleLocks: number;
}

export interface ParticipantListItem {
  id: Id;
  nickname: string;
  displayName: string;
  status: string;
  departmentIds: Id[];
  roleIds: Id[];
  activityLevel: string;
  reliabilityLevel: string;
  warningCount: number;
  hasVoiceSample: boolean;
  topReleaseFit: boolean;
}

export interface ReleaseListItem {
  id: Id;
  title: string;
  status: string;
  type: string;
  primaryDepartmentId: Id;
  departmentIds: Id[];
  curatorId?: Id | null;
  year?: number | null;
  archivalState: string;
}

export interface StatisticsSummary {
  totalReleases: number;
  inWork: number;
  completed: number;
  frozen: number;
  canceled: number;
  lost: number;
  byDepartment: Array<{ label: string; value: number }>;
  byYear: Array<{ label: string; value: number }>;
  byType: Array<{ label: string; value: number }>;
}

export interface LockFile {
  lock_id: Id;
  entity_type: string;
  entity_id?: Id;
  user_id: string;
  user_name: string;
  machine_id: string;
  session_id: string;
  base_dataset_revision: number;
  base_entity_revision?: number;
  acquired_at: ISODateTime;
  heartbeat_at: ISODateTime;
  expires_at: ISODateTime;
  reason: string;
}

export interface SyncStatus {
  mode: SyncMode;
  message: string;
  datasetRevision?: number;
  localRevision?: number;
  workspacePath?: string;
  issues: string[];
}

export interface GitStatusSummary {
  available: boolean;
  configured: boolean;
  repoPath?: string;
  remoteOrigin?: string;
  branch?: string;
  clean?: boolean;
  lastError?: string;
}

export interface GeneratedPostPreview {
  title: string;
  content: string;
  warnings: string[];
}

export interface ImportPreview {
  batch: ImportBatch;
  structured: StructuredImportPreview;
}

export interface GitCommitResult {
  success: boolean;
  output: string;
}

export interface ManualBackupResult {
  id: Id;
  label: string;
  path: string;
  created_at: ISODateTime;
  detail?: string;
}

export interface SystemFileInfo {
  id: Id;
  label: string;
  kind: string;
  path: string;
  updated_at?: ISODateTime;
  detail?: string;
}

export interface LocalUnsavedDraftInfo {
  id: Id;
  label: string;
  domain: string;
  entity_id: string;
  path: string;
  saved_at?: ISODateTime;
  user_name?: string;
  reason?: string;
  shared_path?: string;
  detail?: string;
}

export interface LocalUnsavedDraftFile extends LocalUnsavedDraftInfo {
  payload: unknown;
}

export interface SystemDiagnostics {
  shared_paths: {
    backups: string;
    locks: string;
    transactions: string;
  };
  local_paths: {
    drafts: string;
  };
  backup_snapshots: SystemFileInfo[];
  local_drafts: LocalUnsavedDraftInfo[];
  active_locks: SystemFileInfo[];
  pending_transactions: SystemFileInfo[];
  failed_transactions: SystemFileInfo[];
}

export interface WorkspaceSnapshot {
  manifest: DatasetManifest;
  dashboard: DashboardSummary;
  participantList: ParticipantListItem[];
  releaseList: ReleaseListItem[];
  directories: Record<string, DirectoryRecord[]>;
  departments: DepartmentDirectoryItem[];
  structurePositions: StructurePosition[];
  departmentProfiles: DepartmentProfile[];
  assignments: PositionAssignment[];
  substitutions: Substitution[];
  temporaryAssignments: TemporaryAssignment[];
  structureContacts: StructureContact[];
  structureNotes: StructureNote[];
  participants: ParticipantAggregate[];
  releases: ReleaseAggregate[];
  externalSources: ExternalSource[];
  templates: PostTemplate[];
  imports: ImportBatch[];
  statistics: StatisticsSummary;
  git: GitStatusSummary;
}

export interface AppBootstrapState {
  configured: boolean;
  portableMode: boolean;
  settingsPath: string;
  settings: AppSettings;
  workspace?: LocalWorkspaceConfig;
  syncStatus?: SyncStatus;
  workspaceSelectionRequired?: boolean;
  workspaceSelectionReason?: string;
}

export interface FirstRunWizardResult {
  sharedDatasetPath: string;
  backupDirectoryPath: string;
}

export type AppCommand =
  | { type: "workspace:change" }
  | { type: "workspace:refresh" }
  | { type: "settings:openFolder" }
  | { type: "view:toggleAdvanced" }
  | { type: "navigate"; section: NavigationSection }
  | {
      type: "notice:show";
      notice: "entry" | "exit";
      title: string;
      message: string;
      copyText: string;
    };
