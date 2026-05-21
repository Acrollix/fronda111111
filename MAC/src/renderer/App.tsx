import { Component, type ErrorInfo, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { memo } from "react";
import type {
  AppCommand,
  AppSettings,
  AppBootstrapState,
  DepartmentDirectoryItem,
  DepartmentProfile,
  DirectoryRecord,
  DisciplinaryEvent,
  EntityHistoryEntry,
  EntityManifest,
  ExternalSource,
  ImportBatch,
  ImportMappingOverride,
  ImportMappingPreset,
  ImportPreview,
  ImportSourceRef,
  LocalUnsavedDraftFile,
  ManualBackupResult,
  ParticipantAggregate,
  ParticipantListItem,
  ParticipantNote,
  PostTemplate,
  ReleaseAggregate,
  ReleaseContent,
  ReleaseExternalAssignment,
  ReleaseParticipantAssignment,
  ReleaseRoleAssignment,
  RewardEvent,
  SyncStatus,
  SystemDiagnostics,
  StructurePosition,
  TemporaryAssignment,
  PositionAssignment,
  Substitution,
  WorkspaceSnapshot
} from "@shared/types";
import type { NavigationSection } from "@shared/branding";
import { ActionMenu, ActionMenuItem, BrandLockup, Button, Chip, EmptyState, Field, Panel, ScrollRegion, SearchSelect, StatCard } from "./components";
import { cloneJson, formatDate, toPrettyJson } from "./utils";

type LoadingState = "booting" | "ready" | "error";
type StructureEditorKey =
  | "department_profiles.json"
  | "position_assignments.json"
  | "substitutions.json"
  | "temporary_assignments.json"
  | "structure_contacts.json"
  | "structure_notes.json";

type ImportReviewEntityKind =
  | "participant"
  | "release"
  | "relation"
  | "duplicate"
  | "issue"
  | "note"
  | "discipline"
  | "reward"
  | "external";

interface SelectedImportReviewEntity {
  kind: ImportReviewEntityKind;
  id: string;
}

type DirectoryEditorRecord =
  | DirectoryRecord
  | DepartmentDirectoryItem
  | StructurePosition
  | ExternalSource
  | PostTemplate;

const sections: Array<{ key: NavigationSection; label: string }> = [
  { key: "dashboard", label: "Главная" },
  { key: "structure", label: "Структура" },
  { key: "composition", label: "Состав" },
  { key: "releases", label: "Релизы" },
  { key: "imports", label: "Импорт" },
  { key: "directories", label: "Справочники" },
  { key: "statistics", label: "Статистика" },
  { key: "system", label: "Система" }
];

const structureEditorOptions: StructureEditorKey[] = [
  "department_profiles.json",
  "position_assignments.json",
  "substitutions.json",
  "temporary_assignments.json",
  "structure_contacts.json",
  "structure_notes.json"
];

const DIRECTORY_EDITOR_ORDER = [
  "departments",
  "structure_positions",
  "participant_roles",
  "skills",
  "specializations",
  "participant_statuses",
  "release_statuses",
  "release_types",
  "note_types",
  "disciplinary_types",
  "reward_types",
  "external_source_types",
  "platforms",
  "genres",
  "tags"
] as const;

const DEPARTMENT_TYPE_OPTIONS = [
  { id: "department", label: "Основной отдел" },
  { id: "release_unit", label: "Релизный блок" },
  { id: "support", label: "Поддержка" },
  { id: "admin", label: "Административный отдел" }
] as const;

const POSITION_TYPE_OPTIONS = [
  { id: "worker", label: "Рабочая должность" },
  { id: "leadership", label: "Руководство" },
  { id: "curator", label: "Кураторство" },
  { id: "admin", label: "Администрирование" },
  { id: "support", label: "Поддержка" }
] as const;

const POSITION_ASSIGNMENT_KIND_OPTIONS = [
  { id: "permanent", label: "Постоянное" },
  { id: "temporary", label: "Временное" },
  { id: "internship", label: "Стажировка" },
  { id: "assistant", label: "Помощник" }
] as const;

const PARTICIPANT_ROLE_LEVEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "", label: "Не указан" },
  { id: "Низкий", label: "Низкий" },
  { id: "Удовлетворительный", label: "Удовлетворительный" },
  { id: "Средний", label: "Средний" },
  { id: "Достаточный", label: "Достаточный" },
  { id: "Высокий", label: "Высокий" }
];

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

const TEMPLATE_TYPE_OPTIONS = [
  { id: "standard_release_post", label: "Основной релизный пост" },
  { id: "short_release_post", label: "Короткий релизный пост" },
  { id: "announcement_post", label: "Анонс" },
  { id: "custom", label: "Свободный шаблон" }
] as const;

const DIRECTORY_RECORD_STATUS_OPTIONS = [
  { id: "active", label: "Активная" },
  { id: "inactive", label: "Неактивная" },
  { id: "archived", label: "Архивная" }
] as const;

const STANDARD_POST_TEMPLATE_ID = "tpl_standard_release";

const RELEASE_EXTERNAL_VARIANT_OPTIONS = [
  { id: "translator", label: "Группа субтитров" },
  { id: "fsg", label: "Партнерская FSG" },
  { id: "partner", label: "Партнерский перевод" },
  { id: "vk_only", label: "Только упоминание VK" }
] as const;

type ReleaseExternalVariantId = typeof RELEASE_EXTERNAL_VARIANT_OPTIONS[number]["id"];

const POST_TEMPLATE_BLOCK_OPTIONS = [
  { id: "header", label: "Заголовок" },
  { id: "platforms", label: "Площадки" },
  { id: "voice_cast", label: "Роли озвучивали" },
  { id: "mixing", label: "Звукорежиссер" },
  { id: "curator", label: "Куратор" },
  { id: "translation", label: "Перевод" },
  { id: "timing", label: "Тайминг" },
  { id: "design", label: "Оформление" },
  { id: "rating", label: "Возрастной рейтинг" },
  { id: "genres", label: "Жанр" },
  { id: "description", label: "Описание" },
  { id: "tags", label: "Теги" },
  { id: "footer", label: "Нижний блок" }
] as const;

const POST_BLOCK_LABELS = Object.fromEntries(
  POST_TEMPLATE_BLOCK_OPTIONS.map((item) => [item.id, item.label])
) as Record<string, string>;

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "dark",
  compactSidebar: false,
  showAdvancedMode: false,
  lastSection: "dashboard",
  lastSystemSection: "health"
};

const AUTO_REFRESH_INTERVAL_MS = 30000;
const AUTO_REFRESH_MIN_GAP_MS = 12000;
const AUTO_REFRESH_FAILURE_BACKOFF_MS = 45000;
const STARTUP_OPERATION_TIMEOUT_MS = 12000;

function withStartupTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), STARTUP_OPERATION_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function isDirectoryEditorRecord(value: unknown): value is DirectoryEditorRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function toDirectoryEditorRecords<T extends DirectoryEditorRecord>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(isDirectoryEditorRecord) as T[] : [];
}

function isArchivedLookupRecord<T extends { status?: string | null; archived_at?: string | null; archived?: boolean | null }>(
  record: T
): boolean {
  return normalizeDirectoryRecordStatus(record.status) === "archived" || Boolean(record.archived_at) || Boolean(record.archived);
}

function isVisibleLookupRecord<T extends { status?: string | null; archived_at?: string | null; archived?: boolean | null }>(record: T): boolean {
  return record.status !== "inactive" && !isArchivedLookupRecord(record);
}

function filterVisibleLookupRecords<T extends { status?: string | null }>(records: T[]): T[] {
  return records.filter(isVisibleLookupRecord);
}

function isLookupCategoryEnabled<T extends { status?: string | null; archived_at?: string | null; archived?: boolean | null }>(
  records: T[]
): boolean {
  return filterVisibleLookupRecords(records).length > 0;
}

interface ToggleableDirectoryCategoryMeta {
  title: string;
  enabledText: string;
  disabledText: string;
  emptyText: string;
  enabledSuccessText: string;
  disabledSuccessText: string;
}

const TOGGLEABLE_DIRECTORY_CATEGORY_META: Record<string, ToggleableDirectoryCategoryMeta> = {
  release_statuses: {
    title: "Категория «Статусы релизов»",
    enabledText: "Категория включена: статус релиза показывается в карточках, фильтрах и статистике.",
    disabledText: "Категория отключена: старые статусы остаются в базе, но скрыты из карточек, фильтров и статистики.",
    emptyText: "Активировать тумблер можно после создания хотя бы одного статуса релиза.",
    enabledSuccessText: "Категория «Статусы релизов» включена. Поле снова появится в релизах, фильтрах и статистике.",
    disabledSuccessText: "Категория «Статусы релизов» отключена. Старые значения сохранены, но поле скрыто из релизов, фильтров и статистики."
  },
  release_types: {
    title: "Категория «Тип релиза»",
    enabledText: "Категория включена: тип релиза показывается в карточках релизов, фильтрах и заголовке поста.",
    disabledText: "Категория отключена: старые значения остаются в базе, но не используются в релизах и посте.",
    emptyText: "Активировать тумблер можно после создания хотя бы одной записи типа релиза.",
    enabledSuccessText: "Категория «Тип релиза» включена. Поле снова появится в релизах, фильтрах и заголовке поста.",
    disabledSuccessText: "Категория «Тип релиза» отключена. Старые значения сохранены, но поле скрыто из релизов и поста."
  }
};

function mergeLookupOptionsWithCurrent<T extends { id: string; status?: string | null }>(
  allRecords: T[],
  currentIds: Array<string | null | undefined>
): T[] {
  const visibleRecords = filterVisibleLookupRecords(allRecords);
  const nextRecords = [...visibleRecords];
  const seen = new Set(nextRecords.map((item) => item.id));
  currentIds
    .filter((value): value is string => Boolean(value))
    .forEach((currentId) => {
      if (seen.has(currentId)) {
        return;
      }
      const currentRecord = allRecords.find((item) => item.id === currentId);
      if (currentRecord) {
        nextRecords.push(currentRecord);
        seen.add(currentRecord.id);
      }
    });
  return nextRecords;
}

function isSelectableParticipantListItem(item: Pick<ParticipantListItem, "status">): boolean {
  return !isParticipantArchivedStatus(item.status);
}

function filterSelectableParticipantList(items: ParticipantListItem[]): ParticipantListItem[] {
  return items.filter(isSelectableParticipantListItem);
}

function mergeParticipantPickerOptionsWithCurrent(
  allItems: ParticipantListItem[],
  currentIds: Array<string | null | undefined>
): ParticipantListItem[] {
  const visibleItems = filterSelectableParticipantList(allItems);
  const nextItems = [...visibleItems];
  const seen = new Set(nextItems.map((item) => item.id));
  currentIds
    .filter((value): value is string => Boolean(value))
    .forEach((currentId) => {
      if (seen.has(currentId)) {
        return;
      }
      const currentItem = allItems.find((item) => item.id === currentId);
      if (currentItem) {
        nextItems.push(currentItem);
        seen.add(currentItem.id);
      }
    });
  return sortParticipantPickerItems(nextItems);
}

function buildParticipantPickerSourceItems(
  participantList: ParticipantListItem[],
  participants: ParticipantAggregate[]
): ParticipantListItem[] {
  const byId = new Map<string, ParticipantListItem>();
  participantList.forEach((item) => byId.set(item.id, item));
  participants.forEach((participant) => {
    const existing = byId.get(participant.profile.id);
    const warningCount = participant.discipline.filter((entry) => entry.severity === "warning" && entry.active_flag).length;
    byId.set(participant.profile.id, {
      id: participant.profile.id,
      nickname: participant.profile.nickname,
      displayName: participant.profile.display_name,
      status: getParticipantLifecycleStatus(participant),
      departmentIds: mergeStringValues(
        existing?.departmentIds ?? [],
        participant.org.department_assignments.map((item) => item.department_id)
      ),
      roleIds: mergeStringValues(
        existing?.roleIds ?? [],
        participant.org.role_assignments.filter((item) => item.active).map((item) => item.role_id)
      ),
      activityLevel: existing?.activityLevel ?? "нормальный",
      reliabilityLevel: existing?.reliabilityLevel ?? getParticipantReliabilityLabel(participant),
      warningCount,
      hasVoiceSample: participant.voice_sample.voice_sample_present,
      topReleaseFit: participantHasFlag(participant, "priority_top") || participantHasFlag(participant, "key_member")
    });
  });
  return sortParticipantPickerItems(Array.from(byId.values()));
}

function mergeStringValues(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().map((item) => cleanOptionalText(item)).filter((item): item is string => Boolean(item))));
}

function mergeReleaseOptionsWithCurrent(
  allItems: ReleaseAggregate[],
  currentIds: Array<string | null | undefined>
): ReleaseAggregate[] {
  const visibleItems = allItems.filter((item) => !isReleaseArchivedEntity(item.release));
  const nextItems = [...visibleItems];
  const seen = new Set(nextItems.map((item) => item.release.id));
  currentIds
    .filter((value): value is string => Boolean(value))
    .forEach((currentId) => {
      if (seen.has(currentId)) {
        return;
      }
      const currentItem = allItems.find((item) => item.release.id === currentId);
      if (currentItem) {
        nextItems.push(currentItem);
        seen.add(currentItem.release.id);
      }
    });
  return nextItems;
}

function normalizeDirectoryRecordStatus(status: string | null | undefined): "active" | "inactive" | "archived" {
  if (status === "inactive" || status === "archived") {
    return status;
  }
  return "active";
}

function getDirectoryRecordStatusLabel(status: string | null | undefined): string {
  return DIRECTORY_RECORD_STATUS_OPTIONS.find((option) => option.id === normalizeDirectoryRecordStatus(status))?.label ?? "Активная";
}

class SectionErrorBoundary extends Component<
  {
    sectionLabel: string;
    children: ReactNode;
    onReset: () => void;
  },
  {
    hasError: boolean;
    errorMessage: string | null;
  }
> {
  state = {
    hasError: false,
    errorMessage: null
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      errorMessage: error.message || "Неизвестная ошибка интерфейса."
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Сбой секции «${this.props.sectionLabel}»`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: Readonly<{ sectionLabel: string }>) {
    if (prevProps.sectionLabel !== this.props.sectionLabel && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
    this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-body">
          <Panel
            title={`Ошибка раздела: ${this.props.sectionLabel}`}
            subtitle="Интерфейс этого раздела дал сбой. Остальная рабочая область не должна теряться."
          >
            <EmptyState
              title="Раздел временно не открылся"
              body={this.state.errorMessage ?? "Произошла ошибка при построении экрана."}
              action={<Button className="primary" onClick={this.handleReset}>Вернуться на главную</Button>}
            />
          </Panel>
        </div>
      );
    }
    return this.props.children;
  }
}

const STANDARD_AGE_RATING_OPTIONS = ["0+", "6+", "12+", "16+", "18+"] as const;
const ANIME_AGE_RATING_OPTIONS = ["0+", "6+", "12+", "16+", "18+", "PG-13", "R-17"] as const;
const DEPARTMENT_INTEREST_OPTIONS = [
  { id: "participates", label: "Участвует" },
  { id: "abstains", label: "Воздерживается" },
  { id: "can_help", label: "Может" },
  { id: "optional", label: "По желанию" },
  { id: "declined", label: "Нет" }
] as const;
const PARTICIPANT_GROWTH_INTENT_OPTIONS = [
  { id: "guided_work", label: "Хочет работать под режиссурой" },
  { id: "learn_new", label: "Хочет научиться новому" }
] as const;
const DICTION_LEVEL_OPTIONS = [
  { id: "bad", label: "Плохая" },
  { id: "okay", label: "Неплохая" },
  { id: "normal", label: "Нормальная" },
  { id: "good", label: "Хорошая" }
] as const;
const RELEASE_ARCHIVE_OPTIONS = [
  { id: "archived", label: "Обычный архив" },
  { id: "archived_dropped", label: "Дропнутый релиз" }
] as const;
const POST_SEPARATOR_OPTIONS = [
  "__________",
  "__________",
  "----------",
  "==========",
  "~~~~~~~~~~",
  "..........",
  "::::::::::",
  "**********",
  "++++++++++",
  "//////////",
  "\\\\\\\\\\\\\\\\",
  "~~~~~~~~~~",
  "----------",
  "==========",
  "**********",
  "++++++++++",
  "::::::::::",
  "..........",
  "~~~~~~~~~~"
] as const;

function useDelayedOpenIntent(onSelect: () => void, onOpen: () => void) {
  function handleClick() {
    onSelect();
  }

  function handleDoubleClick() {
    onOpen();
  }

  return { handleClick, handleDoubleClick };
}

export function App() {
  const entryNoticeShownRef = useRef(false);
  const autoRefreshInFlightRef = useRef(false);
  const deferredAutoRefreshRef = useRef(false);
  const lastAutoRefreshAtRef = useRef(0);
  const lastAutoRefreshFailureAtRef = useRef(0);
  const [loadingState, setLoadingState] = useState<LoadingState>("booting");
  const [bootstrap, setBootstrap] = useState<AppBootstrapState | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [activeSection, setActiveSection] = useState<NavigationSection>("dashboard");
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [activeDirty, setActiveDirty] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | undefined>(undefined);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | undefined>(undefined);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | undefined>(undefined);
  const [restoredLocalDraft, setRestoredLocalDraft] = useState<LocalUnsavedDraftFile | null>(null);
  const [workspaceInput, setWorkspaceInput] = useState("");
  const [backupInput, setBackupInput] = useState("");
  const [wizardMessage, setWizardMessage] = useState<string | null>(null);
  const [appNotice, setAppNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<{
    kind: "entry" | "exit";
    title: string;
    message: string;
    copyText: string;
    copied: boolean;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const actorName = "Портативный пользователь";

  useEffect(() => {
    void bootstrapApp();
  }, []);

  function showEntryClipboardNotice() {
    if (entryNoticeShownRef.current) {
      return;
    }
    entryNoticeShownRef.current = true;
    setClipboardNotice({
      kind: "entry",
      title: "Перед началом работы",
      message: "НАПИШИ В ЧАТ, ЧТО ОТКРЫЛ(А) РЕЕСТР И ЗАНИМАЕШЬСЯ РЕДАКТИРОВАНИЕМ.",
      copyText: "Ребята, я захожу в программу реестра фронды, пожалуйста, не заходите пока не отпишусь.",
      copied: false
    });
  }

  async function bootstrapApp() {
    setLoadingState("booting");
    setErrorMessage(null);
    try {
      const state = await window.fronda.bootstrap();
      setBootstrap(state);
      setAppSettings(state.settings ?? DEFAULT_APP_SETTINGS);
      setActiveSection(state.settings?.lastSection ?? "dashboard");
      setWorkspaceInput(state.workspace?.sharedDatasetPath ?? "");
      setBackupInput(state.workspace?.backupDirectoryPath ?? "");
      setWizardMessage(state.configured ? null : state.workspaceSelectionReason ?? null);
      if (state.workspace && state.configured) {
        let startupHadIssue = false;
        setSyncStatus(normalizeSyncStatusForUi(state.syncStatus ?? null));
        setSnapshot(null);
        setLoadingState("ready");
        try {
          const startupSyncStatus = await withStartupTimeout(
            window.fronda.syncWorkspace(true),
            "Рабочая папка слишком долго отвечает. Проверьте синхронизацию облака или смените рабочую папку через меню."
          );
          setSyncStatus(normalizeSyncStatusForUi(startupSyncStatus));
          const loadedSnapshot = await withStartupTimeout(
            window.fronda.loadWorkspaceSnapshot(),
            "Локальный кэш не успел загрузиться. Нажмите «Обновить данные» после синхронизации облака."
          );
          setSnapshot(loadedSnapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Рабочая папка временно недоступна.";
          startupHadIssue = true;
          setSyncStatus(normalizeSyncStatusForUi({
            mode: "RO_STALE",
            message,
            workspacePath: state.workspace.sharedDatasetPath,
            issues: [message]
          }));
          setAppNotice({
            tone: "warning",
            text: message
          });
        }
        lastAutoRefreshAtRef.current = Date.now();
        lastAutoRefreshFailureAtRef.current = 0;
        const yandexDiskStatus = await window.fronda.checkYandexDisk(state.workspace.sharedDatasetPath);
        if (yandexDiskStatus?.relevant && !yandexDiskStatus.running) {
          setAppNotice({
            tone: "warning",
            text: yandexDiskStatus.message ?? "Яндекс Диск не запущен. Изменения не будут своевременно выгружаться в облако."
          });
        } else if (!startupHadIssue) {
          setAppNotice(null);
        }
      } else {
        setSyncStatus(normalizeSyncStatusForUi(state.syncStatus ?? null));
        setSnapshot(null);
        setAppNotice(null);
      }
      setLoadingState("ready");
      if (state.configured && state.workspace?.sharedDatasetPath) {
        showEntryClipboardNotice();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось запустить FRONDA.");
      setLoadingState("error");
    }
  }

  async function pickWorkspaceDirectory() {
    const selectedPath = await window.fronda.pickWorkspaceDirectory("Выберите рабочую папку FRONDA");
    if (selectedPath) {
      setWorkspaceInput(selectedPath);
    }
  }

  async function pickBackupDirectory() {
    const selectedPath = await window.fronda.pickWorkspaceDirectory("Выберите папку для ручных резервных копий");
    if (selectedPath) {
      setBackupInput(selectedPath);
    }
  }

  async function configureWorkspace(event: FormEvent) {
    event.preventDefault();
    setWizardMessage("Проверяем рабочую папку, сохраняем путь для резервных копий и собираем локальную копию...");
    const result = await window.fronda.validateAndConfigureWorkspace({
      sharedDatasetPath: workspaceInput,
      backupDirectoryPath: backupInput
    });
    if (!result.valid) {
      setWizardMessage(result.errors[0] ?? "Проверка рабочей папки не прошла.");
      return;
    }
    setWizardMessage("Рабочая папка и папка ручных резервных копий сохранены. Эти пути будут открываться автоматически при следующих запусках.");
    startTransition(() => {
      void bootstrapApp();
    });
  }

  async function reselectWorkspace() {
    const pickedWorkspacePath = await window.fronda.pickWorkspaceDirectory("Выберите рабочую папку FRONDA");
    if (!pickedWorkspacePath) {
      return;
    }
    const pickedBackupPath = await window.fronda.pickWorkspaceDirectory("Выберите папку для ручных резервных копий");
    if (!pickedBackupPath) {
      setAppNotice({
        tone: "warning",
        text: "Папка резервных копий не выбрана. Настройка рабочей папки отменена."
      });
      return;
    }
    const result = await window.fronda.validateAndConfigureWorkspace({
      sharedDatasetPath: pickedWorkspacePath,
      backupDirectoryPath: pickedBackupPath
    });
    if (!result.valid) {
      setAppNotice({
        tone: "danger",
        text: result.errors[0] ?? "Не удалось подключить выбранную рабочую папку."
      });
      return;
    }
    await bootstrapApp();
    setAppNotice({
      tone: result.warnings.length ? "warning" : "success",
      text: result.warnings.length
        ? result.warnings[0]
        : `Рабочая папка изменена: ${getShortPathLabel(pickedWorkspacePath)}. Папка ручных копий тоже обновлена и будет использоваться автоматически.`
    });
  }

  async function refreshWorkspace(force = true) {
    const status = await window.fronda.syncWorkspace(force);
    setSyncStatus(normalizeSyncStatusForUi(status));
    const shouldReloadSnapshot =
      force ||
      !snapshot ||
      (status.datasetRevision != null && status.datasetRevision !== snapshot.manifest.dataset_revision);
    if (shouldReloadSnapshot) {
      const loadedSnapshot = await window.fronda.loadWorkspaceSnapshot();
      if (loadedSnapshot) {
        setSnapshot(loadedSnapshot);
      }
    }
  }

  async function runAutomaticWorkspaceRefresh(reason: "interval" | "focus" | "visibility" | "resume" = "interval") {
    if (autoRefreshInFlightRef.current) {
      return;
    }
    if (loadingState !== "ready" || !bootstrap?.workspace?.sharedDatasetPath) {
      return;
    }
    if (document.visibilityState === "hidden") {
      return;
    }
    if (activeDirty) {
      deferredAutoRefreshRef.current = true;
      return;
    }
    const now = Date.now();
    const minGap = reason === "interval" ? AUTO_REFRESH_INTERVAL_MS : AUTO_REFRESH_MIN_GAP_MS;
    if (
      reason !== "resume" &&
      lastAutoRefreshAtRef.current > 0 &&
      now - lastAutoRefreshAtRef.current < minGap
    ) {
      return;
    }
    if (
      reason !== "resume" &&
      lastAutoRefreshFailureAtRef.current > 0 &&
      now - lastAutoRefreshFailureAtRef.current < AUTO_REFRESH_FAILURE_BACKOFF_MS
    ) {
      return;
    }
    autoRefreshInFlightRef.current = true;
    try {
      await refreshWorkspace(false);
      deferredAutoRefreshRef.current = false;
      lastAutoRefreshAtRef.current = Date.now();
      lastAutoRefreshFailureAtRef.current = 0;
    } catch (error) {
      console.warn("[FRONDA] Автообновление рабочей папки не удалось", error);
      lastAutoRefreshAtRef.current = Date.now();
      lastAutoRefreshFailureAtRef.current = Date.now();
    } finally {
      autoRefreshInFlightRef.current = false;
    }
  }

  async function saveAppSettings(next: AppSettings) {
    setAppSettings(next);
    const saved = await window.fronda.saveAppSettings(next);
    setAppSettings(saved);
  }

  async function copyClipboardNoticeText() {
    if (!clipboardNotice) {
      return;
    }
    await window.fronda.copyText(clipboardNotice.copyText);
    setClipboardNotice((current) => current ? { ...current, copied: true } : current);
  }

  async function continueClipboardNotice() {
    if (!clipboardNotice) {
      return;
    }
    const kind = clipboardNotice.kind;
    if (kind === "exit") {
      await window.fronda.continueAppClose(actorName);
      return;
    }
    setClipboardNotice(null);
  }

  function restoreLocalDraftToCard(draft: LocalUnsavedDraftFile) {
    const nextDraft = cloneJson(draft) as LocalUnsavedDraftFile;
    setRestoredLocalDraft(nextDraft);
    if (nextDraft.domain === "participant") {
      const participantId = (nextDraft.payload as { profile?: { id?: string } } | undefined)?.profile?.id ?? nextDraft.entity_id;
      changeSection("composition", { participantId });
      return;
    }
    if (nextDraft.domain === "release") {
      const releaseId = (nextDraft.payload as { release?: { id?: string } } | undefined)?.release?.id ?? nextDraft.entity_id;
      changeSection("releases", { releaseId });
      return;
    }
    if (nextDraft.domain === "structure") {
      changeSection("structure");
      return;
    }
    if (nextDraft.domain === "directories" || nextDraft.domain === "templates" || nextDraft.domain === "external") {
      changeSection("directories");
      return;
    }
    changeSection("system");
  }

  function changeSection(
    section: NavigationSection,
    selection?: {
      participantId?: string;
      releaseId?: string;
      departmentId?: string;
    }
  ) {
    setActiveSection(section);
    setSelectedParticipantId(section === "composition" ? selection?.participantId : undefined);
    setSelectedReleaseId(section === "releases" ? selection?.releaseId : undefined);
    setSelectedDepartmentId(section === "structure" ? selection?.departmentId : undefined);
    void saveAppSettings({ ...appSettings, lastSection: section });
  }

  function toggleAdvancedMode() {
    void saveAppSettings({ ...appSettings, showAdvancedMode: !appSettings.showAdvancedMode });
  }

  useEffect(() => {
    return window.fronda.onAppCommand((command: AppCommand) => {
      void (async () => {
        if (command.type === "workspace:change") {
          await reselectWorkspace();
          return;
        }
        if (command.type === "workspace:refresh") {
          await refreshWorkspace(true);
          setAppNotice({ tone: "success", text: "Локальная копия обновлена из рабочей папки." });
          return;
        }
        if (command.type === "settings:openFolder") {
          const openedPath = await window.fronda.openSettingsFolder();
          setAppNotice({
            tone: "success",
            text: `Открыта папка локальных настроек: ${getShortPathLabel(openedPath)}.`
          });
          return;
        }
        if (command.type === "view:toggleAdvanced") {
          toggleAdvancedMode();
          return;
        }
        if (command.type === "notice:show") {
          if (command.notice === "entry" && entryNoticeShownRef.current) {
            return;
          }
          if (command.notice === "entry") {
            entryNoticeShownRef.current = true;
          }
          setClipboardNotice({
            kind: command.notice,
            title: command.title,
            message: command.message,
            copyText: command.copyText,
            copied: false
          });
          return;
        }
        if (command.type === "navigate") {
          changeSection(command.section);
        }
      })();
    });
  }, [appSettings]);

  useEffect(() => {
    if (loadingState !== "ready" || !bootstrap?.workspace?.sharedDatasetPath) {
      return;
    }

    function handleWindowFocus() {
      void runAutomaticWorkspaceRefresh("focus");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void runAutomaticWorkspaceRefresh("visibility");
      }
    }

    const intervalId = window.setInterval(() => {
      void runAutomaticWorkspaceRefresh("interval");
    }, AUTO_REFRESH_INTERVAL_MS);

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [bootstrap?.workspace?.sharedDatasetPath, loadingState, activeDirty, snapshot?.manifest.dataset_revision]);

  useEffect(() => {
    if (!activeDirty && deferredAutoRefreshRef.current) {
      void runAutomaticWorkspaceRefresh("resume");
    }
  }, [activeDirty]);

  const clipboardNoticeOverlay = clipboardNotice ? (
    <AppClipboardNoticeModal
      title={clipboardNotice.title}
      message={clipboardNotice.message}
      copyText={clipboardNotice.copyText}
      copied={clipboardNotice.copied}
      onCopy={() => void copyClipboardNoticeText()}
      onContinue={() => void continueClipboardNotice()}
    />
  ) : null;

  const pageSummary = useMemo(() => (snapshot ? buildWorkspaceSummary(snapshot) : null), [snapshot]);

  if (loadingState === "booting") {
    return (
      <>
        <div className="wizard">
          <div className="wizard-card">
            <BrandLockup subtitle="Портативная рабочая среда" />
            <h1>FRONDA</h1>
            <p>Открываем локальные настройки и проверяем последнюю подключенную рабочую папку.</p>
          </div>
        </div>
        {clipboardNoticeOverlay}
      </>
    );
  }

  if (loadingState === "error") {
    return (
      <>
        <div className="wizard">
          <div className="wizard-card">
            <BrandLockup subtitle="Ошибка запуска" />
            <h1>Не удалось запустить FRONDA</h1>
            <p>{errorMessage}</p>
            <Button className="primary" onClick={() => void bootstrapApp()}>
              Повторить запуск
            </Button>
          </div>
        </div>
        {clipboardNoticeOverlay}
      </>
    );
  }

  if (!bootstrap?.configured) {
    return (
      <>
        <div className="wizard">
          <form className="wizard-card section-stack" onSubmit={configureWorkspace}>
          <BrandLockup subtitle="Первое подключение" />
          <div>
            <h1>Подключение рабочей папки</h1>
            <p>
              FRONDA работает с обычной папкой на диске, которую Яндекс Диск синхронизирует в фоне.
              Папку нужно выбрать один раз: приложение запомнит ее и будет подключаться к ней автоматически
              при следующих запусках. Если служебных файлов еще нет, FRONDA создаст их сама.
            </p>
          </div>
          <div className="wizard-list">
            <Chip tone="accent">1. Выберите общую рабочую папку FRONDA</Chip>
            <Chip>2. Приложение проверит структуру и создаст недостающие служебные файлы</Chip>
            <Chip>3. Локальная копия соберется автоматически и откроется без повторного выбора папки</Chip>
          </div>
          <Field
            label="Рабочая папка FRONDA"
            help="Это общая папка со справочниками, участниками, релизами и служебными файлами."
            hint="Обычно это локальная папка Яндекс Диска, которая уже синхронизируется на этом компьютере."
          >
            <div className="row">
              <input
                className="text-input"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
                placeholder={"Пример: /Users/name/Yandex.Disk/FrondaData или D:\\YandexDisk\\FrondaData"}
              />
              <Button type="button" className="secondary" onClick={pickWorkspaceDirectory}>
                Обзор
              </Button>
            </div>
          </Field>
          <Field
            label="Папка ручных резервных копий"
            help="Сюда FRONDA будет сохранять ручные резервные копии. Эта папка должна находиться на этом компьютере и не должна лежать внутри общей рабочей папки."
            hint="Можно выбрать обычную локальную папку, например /Users/name/FRONDA Backups или D:\\FRONDA Backups."
          >
            <div className="row">
              <input
                className="text-input"
                value={backupInput}
                onChange={(event) => setBackupInput(event.target.value)}
                placeholder={"Пример: /Users/name/FRONDA Backups или D:\\FRONDA Backups"}
              />
              <Button type="button" className="secondary" onClick={pickBackupDirectory}>
                Обзор
              </Button>
            </div>
          </Field>
          {wizardMessage ? <div className="notice-banner warning">{wizardMessage}</div> : null}
          <div className="row spread">
            <span className="footer-note">Путь к рабочей папке и локальный кэш сохраняются автоматически.</span>
            <Button type="submit" className="primary" disabled={!workspaceInput.trim() || !backupInput.trim()}>
              Подключить и запомнить папку
            </Button>
          </div>
          </form>
        </div>
        {clipboardNoticeOverlay}
      </>
    );
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
        <BrandLockup subtitle="Реестр фронды" />
        <nav className="nav-list">
          {sections.map((section) => (
            <button
              key={section.key}
              className={`nav-button ${activeSection === section.key ? "active" : ""}`}
              onClick={() => changeSection(section.key)}
            >
              <span>{section.label}</span>
              {section.key === "imports" && snapshot ? <span className="nav-badge">{snapshot.imports.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="footer-note">Портативный режим: <strong>{bootstrap.portableMode ? "включен" : "резервный"}</strong></div>
          <div className="footer-note" title={bootstrap.workspace?.sharedDatasetPath}>
            Рабочая папка: {getShortPathLabel(bootstrap.workspace?.sharedDatasetPath)}
          </div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div className="topbar-title-block">
            <div className="topbar-title">
              <h1>{sections.find((section) => section.key === activeSection)?.label}</h1>
              <p>{sectionMeta(activeSection)}</p>
            </div>
            <div className="topbar-meta-line">
              <div className="topbar-meta-item" title={bootstrap.workspace?.sharedDatasetPath}>
                <span className="field-label">Рабочая папка</span>
                <div className="sync-meta-value">{getShortPathLabel(bootstrap.workspace?.sharedDatasetPath)}</div>
              </div>
              <div className="topbar-meta-item">
                <span className="field-label">Последняя запись</span>
                <div className="sync-meta-value">{formatDate(snapshot?.manifest.last_commit_at)}</div>
              </div>
              <div className="topbar-meta-item">
                <span className="field-label">Локальные правки</span>
                <div className="sync-meta-value">{activeDirty ? "Есть" : "Нет"}</div>
              </div>
              <div className="topbar-meta-item" title={syncStatus?.message}>
                <span className="field-label">Синхронизация</span>
                <div className="sync-meta-value">{syncStatus ? shortSyncLabel(syncStatus) : "Подключение проверяется"}</div>
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            <Button className="secondary utility" onClick={() => void refreshWorkspace(true)}>
              Обновить
            </Button>
            <Button className="secondary utility" onClick={() => void reselectWorkspace()}>
              Сменить папку
            </Button>
            <ActionMenu label="Еще">
              <ActionMenuItem onClick={toggleAdvancedMode}>
                {appSettings.showAdvancedMode ? "Скрыть расширенные данные" : "Показать расширенные данные"}
              </ActionMenuItem>
              <ActionMenuItem onClick={() => void (async () => {
                const openedPath = await window.fronda.openSettingsFolder();
                setAppNotice({ tone: "success", text: `Открыта папка локальных настроек: ${getShortPathLabel(openedPath)}.` });
              })()}>
                Открыть папку настроек
              </ActionMenuItem>
            </ActionMenu>
          </div>
        </header>

        {appNotice ? (
          <div className={`status-banner page-status-banner ${appNotice.tone}`}>
            <div>
              <strong>{appNotice.text}</strong>
            </div>
            <Button className="secondary" onClick={() => setAppNotice(null)}>
              Скрыть
            </Button>
          </div>
        ) : null}

        {syncStatus && syncStatus.mode !== "RW_IN_SYNC" ? (
          <div className={`status-banner page-status-banner ${bannerClass(syncStatus)}`}>
            <div>
              <strong>{syncStatus.message}</strong>
              {syncStatus.issues.length > 0 ? <div className="footer-note">{syncStatus.issues.join(" • ")}</div> : null}
            </div>
            <Button className="secondary" onClick={() => void refreshWorkspace(true)}>
              Проверить снова
            </Button>
          </div>
        ) : null}

        <main className="main-view">
          <div className="page-toolbar">
            <div className="toolbar-group metric-toolbar">
              <button className="toolbar-metric" onClick={() => changeSection("composition")}>
                <span>Участники</span>
                <strong>{pageSummary?.participants.total ?? 0}</strong>
              </button>
              <button className="toolbar-metric" onClick={() => changeSection("releases")}>
                <span>Релизы</span>
                <strong>{pageSummary?.releases.total ?? 0}</strong>
              </button>
              <button className="toolbar-metric" onClick={() => changeSection("imports")}>
                <span>Импорт</span>
                <strong>{pageSummary?.imports.review ?? 0}</strong>
              </button>
              <button className="toolbar-metric" onClick={() => changeSection("system")}>
                <span>Система</span>
                <strong>{pageSummary?.system.alerts ?? 0}</strong>
              </button>
            </div>
            <div className="toolbar-group toolbar-context">
              {pageSummary ? <Chip>{activeDirty ? "Есть локальные правки" : "Локальных правок нет"}</Chip> : null}
              <Chip tone={syncStatus ? statusTone(syncStatus) : undefined}>
                {syncStatus ? shortSyncLabel(syncStatus) : "Проверяем подключение"}
              </Chip>
              {appSettings.showAdvancedMode && pageSummary ? <Chip>Расширенный режим</Chip> : null}
            </div>
          </div>

          {snapshot ? (
            <SectionErrorBoundary
              sectionLabel={sections.find((section) => section.key === activeSection)?.label ?? "Раздел"}
              onReset={() => {
                setRestoredLocalDraft(null);
                setActiveDirty(false);
                changeSection("dashboard");
              }}
            >
              <ActiveSection
                section={activeSection}
                snapshot={snapshot}
                onRefresh={refreshWorkspace}
                actorName={actorName}
                syncStatus={syncStatus}
                bootstrap={bootstrap}
                selectedParticipantId={selectedParticipantId}
                selectedReleaseId={selectedReleaseId}
                selectedDepartmentId={selectedDepartmentId}
                onDirtyChange={setActiveDirty}
                restoredLocalDraft={restoredLocalDraft}
                onRestoredLocalDraftApplied={() => setRestoredLocalDraft(null)}
                onOpenParticipant={(id) => {
                  changeSection("composition", { participantId: id });
                }}
                onOpenRelease={(id) => {
                  changeSection("releases", { releaseId: id });
                }}
                onOpenDepartment={(id) => {
                  changeSection("structure", { departmentId: id });
                }}
                onRestoreLocalDraft={restoreLocalDraftToCard}
                onNavigate={changeSection}
                showAdvancedMode={appSettings.showAdvancedMode}
                onShowAppNotice={setAppNotice}
              />
            </SectionErrorBoundary>
          ) : (
            <div className="page-body">
              <Panel title="Нет локального снимка кэша" subtitle="Общая рабочая папка найдена, но локальный портативный кэш еще не собран.">
                <EmptyState
                  title="Данные рабочей области не загружены"
                  body="Запустите обновление, чтобы просканировать общую папку данных и пересобрать локальный портативный кэш."
                  action={<Button className="primary" onClick={() => void refreshWorkspace(true)}>Собрать локальный кэш</Button>}
                />
              </Panel>
            </div>
          )}
        </main>
        </section>
      </div>
      {clipboardNoticeOverlay}
    </>
  );
}

function AppClipboardNoticeModal({
  title,
  message,
  copyText,
  copied,
  onCopy,
  onContinue
}: {
  title: string;
  message: string;
  copyText: string;
  copied: boolean;
  onCopy: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="app-modal-backdrop" role="presentation">
      <div className="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="app-notice-title">
        <BrandLockup subtitle="Реестр фронды" />
        <div className="section-stack">
          <div>
            <div className="field-label">Согласование работы</div>
            <h2 id="app-notice-title" className="app-modal-title">{title}</h2>
            <div className="app-modal-alert">{message}</div>
          </div>
          <div className="app-modal-copy-block">
            <div className="field-label">Текст для чата</div>
            <div className="app-modal-copy-text">{copyText}</div>
            <div className="row spread app-modal-actions">
              <Button className="secondary" onClick={onCopy}>
                {copied ? "Скопировано" : "Скопировать текст"}
              </Button>
            </div>
          </div>
          <div className="app-modal-footer">
            <strong>Сделал(а)?</strong>
            <Button className="primary" onClick={onContinue}>
              Продолжить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReleaseArchiveChoiceModal({
  onDropped,
  onRegularArchive,
  onCancel
}: {
  onDropped: () => void;
  onRegularArchive: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="app-modal-backdrop" role="presentation">
      <div className="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="release-archive-choice-title">
        <BrandLockup subtitle="Релизы" />
        <div className="section-stack">
          <div>
            <div className="field-label">Архивирование релиза</div>
            <h2 id="release-archive-choice-title" className="app-modal-title">Как пометить архивный релиз?</h2>
            <div className="app-modal-alert">
              Выберите, считать ли этот релиз дропнутым. Эта пометка влияет на состояние архива и на то, как релиз будет показан в обзоре.
            </div>
          </div>
          <div className="app-modal-footer app-modal-footer-stack">
            <strong>Выберите вариант</strong>
            <div className="app-modal-button-row">
              <Button className="secondary" onClick={onRegularArchive}>Нет, не дропнутый</Button>
              <Button className="danger" onClick={onDropped}>Да, дропнутый</Button>
              <Button className="ghost" onClick={onCancel}>Отмена</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppConfirmModal({
  sectionLabel,
  title,
  message,
  confirmLabel,
  confirmTone = "danger",
  onConfirm,
  onCancel
}: {
  sectionLabel: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmTone?: "primary" | "danger" | "secondary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClassName = confirmTone === "danger" ? "danger" : confirmTone === "secondary" ? "secondary" : "primary";
  return (
    <div className="app-modal-backdrop" role="presentation">
      <div className="app-modal-card" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title">
        <BrandLockup subtitle={sectionLabel} />
        <div className="section-stack">
          <div>
            <div className="field-label">Подтверждение действия</div>
            <h2 id="app-confirm-title" className="app-modal-title">{title}</h2>
            <div className="app-modal-alert">{message}</div>
          </div>
          <div className="app-modal-footer app-modal-footer-stack">
            <strong>Подтвердите действие</strong>
            <div className="app-modal-button-row">
              <Button className={confirmClassName} onClick={onConfirm}>{confirmLabel}</Button>
              <Button className="ghost" onClick={onCancel}>Отмена</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveSection({
  section,
  snapshot,
  onRefresh,
  actorName,
  syncStatus,
  bootstrap,
  selectedParticipantId,
  selectedReleaseId,
  selectedDepartmentId,
  onDirtyChange,
  restoredLocalDraft,
  onRestoredLocalDraftApplied,
  onOpenParticipant,
  onOpenRelease,
  onOpenDepartment,
  onRestoreLocalDraft,
  onNavigate,
  showAdvancedMode,
  onShowAppNotice
}: {
  section: NavigationSection;
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  syncStatus: SyncStatus | null;
  bootstrap: AppBootstrapState;
  selectedParticipantId?: string;
  selectedReleaseId?: string;
  selectedDepartmentId?: string;
  onDirtyChange: (dirty: boolean) => void;
  restoredLocalDraft: LocalUnsavedDraftFile | null;
  onRestoredLocalDraftApplied: () => void;
  onOpenParticipant: (id: string) => void;
  onOpenRelease: (id: string) => void;
  onOpenDepartment: (id: string) => void;
  onRestoreLocalDraft: (draft: LocalUnsavedDraftFile) => void;
  onNavigate: (section: NavigationSection) => void;
  showAdvancedMode: boolean;
  onShowAppNotice: (notice: { tone: "success" | "warning" | "danger"; text: string } | null) => void;
}) {
  switch (section) {
    case "dashboard":
      return <DashboardScreen snapshot={snapshot} onOpenParticipant={onOpenParticipant} onOpenRelease={onOpenRelease} onNavigate={onNavigate} />;
    case "structure":
      return <StructureScreen snapshot={snapshot} onRefresh={onRefresh} actorName={actorName} selectedDepartmentId={selectedDepartmentId} onDirtyChange={onDirtyChange} onOpenParticipant={onOpenParticipant} restoredLocalDraft={restoredLocalDraft} onRestoredLocalDraftApplied={onRestoredLocalDraftApplied} showAdvancedMode={showAdvancedMode} />;
    case "composition":
      return <CompositionScreen snapshot={snapshot} onRefresh={onRefresh} actorName={actorName} selectedParticipantId={selectedParticipantId} onDirtyChange={onDirtyChange} onOpenRelease={onOpenRelease} onNavigate={onNavigate} restoredLocalDraft={restoredLocalDraft} onRestoredLocalDraftApplied={onRestoredLocalDraftApplied} showAdvancedMode={showAdvancedMode} />;
    case "releases":
      return <ReleasesScreen snapshot={snapshot} onRefresh={onRefresh} actorName={actorName} selectedReleaseId={selectedReleaseId} onDirtyChange={onDirtyChange} onOpenParticipant={onOpenParticipant} onNavigate={onNavigate} restoredLocalDraft={restoredLocalDraft} onRestoredLocalDraftApplied={onRestoredLocalDraftApplied} showAdvancedMode={showAdvancedMode} />;
    case "imports":
      return <ImportsScreen snapshot={snapshot} onRefresh={onRefresh} actorName={actorName} onDirtyChange={onDirtyChange} onOpenParticipant={onOpenParticipant} onOpenRelease={onOpenRelease} onShowAppNotice={onShowAppNotice} />;
    case "directories":
      return <DirectoriesScreen snapshot={snapshot} onRefresh={onRefresh} actorName={actorName} onDirtyChange={onDirtyChange} restoredLocalDraft={restoredLocalDraft} onRestoredLocalDraftApplied={onRestoredLocalDraftApplied} showAdvancedMode={showAdvancedMode} />;
    case "statistics":
      return <StatisticsScreen snapshot={snapshot} onOpenRelease={onOpenRelease} onOpenDepartment={onOpenDepartment} />;
    case "system":
      return <SystemScreen snapshot={snapshot} onRefresh={onRefresh} syncStatus={syncStatus} bootstrap={bootstrap} actorName={actorName} onDirtyChange={onDirtyChange} onRestoreLocalDraft={onRestoreLocalDraft} showAdvancedMode={showAdvancedMode} onShowAppNotice={onShowAppNotice} />;
    default:
      return null;
  }
}

function DashboardScreen({
  snapshot,
  onOpenParticipant,
  onOpenRelease,
  onNavigate
}: {
  snapshot: WorkspaceSnapshot;
  onOpenParticipant: (id: string) => void;
  onOpenRelease: (id: string) => void;
  onNavigate: (section: NavigationSection) => void;
}) {
  const releaseLinksById = useMemo(() => buildParticipantReleaseLinkIndex(snapshot.releases), [snapshot.releases]);
  const participants = useMemo(() => buildParticipantViews(snapshot, releaseLinksById), [snapshot, releaseLinksById]);
  const releases = useMemo(() => buildReleaseViews(snapshot), [snapshot]);
  const releaseStatusCategoryEnabled = isLookupCategoryEnabled(snapshot.directories.release_statuses ?? []);
  const activeParticipants = useMemo(() => participants.filter((item) => item.status === "active" && !item.archived), [participants]);
  const activeReleases = useMemo(() => releases.filter((item) => !isReleaseArchivedView(item)), [releases]);
  const importsReview = snapshot.imports.filter((item) => item.queue_status === "review" || item.queue_status === "pending");
  const focusParticipants = {
    problem: activeParticipants.filter((item) => item.warningCount > 0 || item.blacklistCount > 0).slice(0, 4),
    key: activeParticipants.filter((item) => item.keyMember).slice(0, 4),
    top: activeParticipants.filter((item) => item.topReleaseFit).slice(0, 4),
    newOnes: [...activeParticipants].sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? "")).slice(0, 4)
  };
  const releaseQueue = {
    inWork: activeReleases.filter((item) => item.status === "in_work").slice(0, 5),
    incomplete: activeReleases.filter((item) => item.missingCoreRoles.length > 0).slice(0, 5),
    withoutPost: activeReleases.filter((item) => !item.hasGeneratedPost).slice(0, 5)
  };

  return (
    <div className="page-body dashboard-grid">
      <div className="section-stack dashboard-stage">
        <div className="notice-banner">
          Главная показывает только то, что требует внимания прямо сейчас: кого держать в фокусе, какие релизы проседают и что зависло в импорте или дисциплине.
        </div>
        <div className="dashboard-priority-grid">
          <div className="detail-card card-shell">
            <div className="card-section">
              <h4>Быстрые действия</h4>
              <div className="dashboard-actions">
                <Button className="primary" onClick={() => onNavigate("composition")}>Добавить участника</Button>
                <Button className="secondary" onClick={() => onNavigate("releases")}>Создать релиз</Button>
                <Button className="secondary" onClick={() => onNavigate("imports")}>Открыть импорт</Button>
                <Button className="secondary" onClick={() => onNavigate("system")}>Проверить систему</Button>
              </div>
            </div>
          </div>
          <div className="detail-card card-shell">
            <div className="card-section">
              <h4>Дисциплина</h4>
              <div className="card-copy">
                <div className="muted">С предупреждениями: {participants.filter((item) => item.warningCount > 0).length}</div>
                <div className="muted">С замечаниями: {participants.filter((item) => item.remarkCount > 0).length}</div>
                <div className="muted">В черном списке: {participants.filter((item) => item.blacklistCount > 0).length}</div>
              </div>
            </div>
            <div className="card-section">
              <Button className="secondary" onClick={() => onNavigate("composition")}>Открыть состав</Button>
            </div>
          </div>
          <div className="detail-card card-shell">
            <div className="card-section">
              <h4>Импорт и состояние команды</h4>
              <div className="card-copy">
                <div className="muted">На проверке импорта: {importsReview.length}</div>
                <div className="muted">Конфликты и дубли: {snapshot.imports.filter((item) => (item.candidate_matches?.length ?? 0) > 0).length}</div>
                <div className="muted">В резерве: {participants.filter((item) => item.status === "reserve").length}</div>
              </div>
            </div>
            <div className="card-section">
              <Button className="secondary" onClick={() => onNavigate("statistics")}>Открыть статистику</Button>
            </div>
          </div>
        </div>
        <div className="dashboard-summary-grid">
          <StatCard
            label="Всего участников"
            value={participants.length}
            note={formatSimpleCount(activeParticipants.length, "активный участник", "активных участников")}
          />
          <StatCard label="С предупреждениями" value={participants.filter((item) => item.warningCount > 0).length} note="нужен контроль дисциплины" />
          {releaseStatusCategoryEnabled ? (
            <StatCard
              label="Активных релизов"
              value={releases.filter((item) => item.status === "in_work").length}
              note={`${formatSimpleCount(releases.length, "релиз", "релизов")} всего`}
            />
          ) : null}
          <StatCard
            label="На проверке импорта"
            value={importsReview.length}
            note={formatSimpleCount(snapshot.imports.filter((item) => item.queue_status === "review").length, "конфликтный импорт", "конфликтных импортов")}
          />
        </div>
        <div className="section-grid two-equal">
          <Panel title="Участники в фокусе" subtitle="Проблемные, ключевые, новые и пригодные на важные релизы.">
            <div className="section-stack compact">
              <FocusGroup title="Проблемные" items={focusParticipants.problem} empty="Нет активных проблемных кейсов." onOpenParticipant={onOpenParticipant} />
              <FocusGroup title="Ключевые" items={focusParticipants.key} empty="Ключевые участники пока не отмечены." onOpenParticipant={onOpenParticipant} />
              <FocusGroup title="Кандидаты на важные релизы" items={focusParticipants.top} empty="Подборка еще не сформирована." onOpenParticipant={onOpenParticipant} />
              <FocusGroup title="Новые" items={focusParticipants.newOnes} empty="Новых участников пока нет." onOpenParticipant={onOpenParticipant} />
            </div>
          </Panel>
          <Panel title="Очередь релизов" subtitle="То, что сейчас проседает: работа, состав и готовность поста.">
            <div className="section-stack compact">
              {releaseStatusCategoryEnabled ? <QueueGroup title="Активные релизы" releases={releaseQueue.inWork} releaseStatusCategoryEnabled={releaseStatusCategoryEnabled} onOpenRelease={onOpenRelease} /> : null}
              <QueueGroup title="Без полного состава" releases={releaseQueue.incomplete} releaseStatusCategoryEnabled={releaseStatusCategoryEnabled} onOpenRelease={onOpenRelease} />
              <QueueGroup title="Без поста" releases={releaseQueue.withoutPost} releaseStatusCategoryEnabled={releaseStatusCategoryEnabled} onOpenRelease={onOpenRelease} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StructureScreen({
  snapshot,
  onRefresh,
  actorName,
  selectedDepartmentId,
  onDirtyChange,
  onOpenParticipant,
  restoredLocalDraft,
  onRestoredLocalDraftApplied,
  showAdvancedMode
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  selectedDepartmentId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenParticipant: (id: string) => void;
  restoredLocalDraft: LocalUnsavedDraftFile | null;
  onRestoredLocalDraftApplied: () => void;
  showAdvancedMode: boolean;
}) {
  const [selectedDepartmentIdState, setSelectedDepartmentIdState] = useState(
    selectedDepartmentId
    ?? filterVisibleLookupRecords(snapshot.departments)[0]?.id
    ?? snapshot.departments[0]?.id
    ?? ""
  );
  const [editorKey, setEditorKey] = useState<StructureEditorKey>("department_profiles.json");
  const editorValue = useMemo(() => {
    switch (editorKey) {
      case "department_profiles.json":
        return toPrettyJson(snapshot.departmentProfiles);
      case "position_assignments.json":
        return toPrettyJson(snapshot.assignments);
      case "substitutions.json":
        return toPrettyJson(snapshot.substitutions);
      case "temporary_assignments.json":
        return toPrettyJson(snapshot.temporaryAssignments);
      case "structure_contacts.json":
        return toPrettyJson(snapshot.structureContacts);
      case "structure_notes.json":
        return toPrettyJson(snapshot.structureNotes);
    }
  }, [editorKey, snapshot]);
  const [jsonValue, setJsonValue] = useState(editorValue);
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentShortName, setNewDepartmentShortName] = useState("");
  const [newPositionName, setNewPositionName] = useState("");
  const [newPositionType, setNewPositionType] = useState("worker");
  const [newAssignmentParticipantId, setNewAssignmentParticipantId] = useState(filterSelectableParticipantList(snapshot.participantList)[0]?.id ?? "");
  const [newAssignmentPositionId, setNewAssignmentPositionId] = useState("");
  const [newAssignmentKind, setNewAssignmentKind] = useState<PositionAssignment["assignment_kind"]>("permanent");
  const [newSubstituteParticipantId, setNewSubstituteParticipantId] = useState(filterSelectableParticipantList(snapshot.participantList)[0]?.id ?? "");
  const [newSubstitutePositionId, setNewSubstitutePositionId] = useState("");
  const [newTemporaryParticipantId, setNewTemporaryParticipantId] = useState(filterSelectableParticipantList(snapshot.participantList)[0]?.id ?? "");
  const [newTemporaryReason, setNewTemporaryReason] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [structureMode, setStructureMode] = useState<"view" | "edit">("view");
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentDirectoryItem | null>(null);
  const [positionDraft, setPositionDraft] = useState<StructurePosition | null>(null);
  const [departmentInternalDraft, setDepartmentInternalDraft] = useState("");
  const [departmentOnboardingDraft, setDepartmentOnboardingDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [departmentPointerDrag, setDepartmentPointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragDepartmentId, setDragDepartmentId] = useState<string | null>(null);
  const [dragDepartmentTargetId, setDragDepartmentTargetId] = useState<string | null>(null);
  const [departmentDragPreviewIds, setDepartmentDragPreviewIds] = useState<string[] | null>(null);
  const [departmentCommittedOrderIds, setDepartmentCommittedOrderIds] = useState<string[] | null>(null);
  const departmentDragBaseIdsRef = useRef<string[] | null>(null);
  const [positionPointerDrag, setPositionPointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragPositionId, setDragPositionId] = useState<string | null>(null);
  const [dragPositionTargetId, setDragPositionTargetId] = useState<string | null>(null);
  const [positionDragPreviewIds, setPositionDragPreviewIds] = useState<string[] | null>(null);
  const [positionCommittedOrderIds, setPositionCommittedOrderIds] = useState<string[] | null>(null);
  const positionDragBaseIdsRef = useRef<string[] | null>(null);
  const [structureNotice, setStructureNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<null | "position" | "department">(null);
  const suppressDepartmentClickRef = useRef(false);
  const suppressPositionClickRef = useRef(false);

  useEffect(() => {
    setJsonValue(editorValue);
  }, [editorValue]);

  useEffect(() => {
    if (!restoredLocalDraft || restoredLocalDraft.domain !== "structure") {
      return;
    }
    const nextEditorKey = structureEditorOptions.includes(restoredLocalDraft.entity_id as StructureEditorKey)
      ? restoredLocalDraft.entity_id as StructureEditorKey
      : "department_profiles.json";
    if (editorKey !== nextEditorKey) {
      setEditorKey(nextEditorKey);
      return;
    }
    setShowRawEditor(true);
    setJsonValue(toPrettyJson(restoredLocalDraft.payload));
    setStructureMode("view");
    setStructureNotice({
      tone: "warning",
      text: `Открыт локальный черновик структуры от ${formatDate(restoredLocalDraft.saved_at)}. Эти данные еще не сохранены в общую папку.`
    });
    onRestoredLocalDraftApplied();
  }, [editorKey, onRestoredLocalDraftApplied, restoredLocalDraft]);

  useEffect(() => {
    if (selectedDepartmentId) {
      setSelectedDepartmentIdState(selectedDepartmentId);
    }
  }, [selectedDepartmentId]);

  const activeDepartments = useMemo(() => filterVisibleLookupRecords(snapshot.departments), [snapshot.departments]);
  const participantPickerOptions = useMemo(
    () => filterSelectableParticipantList(snapshot.participantList),
    [snapshot.participantList]
  );
  const selectedDepartment = snapshot.departments.find((item) => item.id === selectedDepartmentIdState);
  const departmentProfile = snapshot.departmentProfiles.find((item) => item.department_id === selectedDepartment?.id);
  const participantNameById = useMemo(
    () => new Map(snapshot.participantList.map((participant) => [participant.id, participant.displayName])),
    [snapshot.participantList]
  );
  const positionNameById = useMemo(
    () => new Map(snapshot.structurePositions.map((position) => [position.id, position.name])),
    [snapshot.structurePositions]
  );
  const departmentNameById = useMemo(
    () => new Map(snapshot.departments.map((department) => [department.id, department.name])),
    [snapshot.departments]
  );
  const getParticipantName = (participantId?: string | null) =>
    participantId ? participantNameById.get(participantId) ?? "участник не найден" : "участник не найден";
  const getPositionName = (positionId?: string | null) =>
    positionId ? positionNameById.get(positionId) ?? "должность не найдена" : "должность не найдена";
  const getDepartmentName = (departmentId?: string | null) =>
    departmentId ? departmentNameById.get(departmentId) ?? "отдел не найден" : "отдел не найден";
  const getPositionTypeLabel = (positionTypeId?: string | null) =>
    POSITION_TYPE_OPTIONS.find((item) => item.id === (positionTypeId ?? "worker"))?.label ?? "Рабочая должность";
  const getTemporaryTargetLabel = (item: TemporaryAssignment) =>
    item.position_id ? getPositionName(item.position_id) : item.responsibility_scope_id ?? "временная зона";
  const structurePositionOptions = useMemo(
    () => mergeLookupOptionsWithCurrent(snapshot.structurePositions, [selectedPositionId, positionDraft?.reports_to_position_id]),
    [positionDraft?.reports_to_position_id, selectedPositionId, snapshot.structurePositions]
  );
  const positions = useMemo(
    () =>
      [...structurePositionOptions]
        .filter((item) => item.department_id === selectedDepartment?.id)
        .sort((left, right) => {
          const leftOrder = left.sort_order ?? 0;
          const rightOrder = right.sort_order ?? 0;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return left.name.localeCompare(right.name, "ru");
        }),
    [selectedDepartment?.id, structurePositionOptions]
  );
  const selectedPosition = positions.find((item) => item.id === selectedPositionId) ?? null;
  const orderedPositions = useMemo(() => {
    const activeOrderIds = positionDragPreviewIds?.length ? positionDragPreviewIds : positionCommittedOrderIds;
    if (!activeOrderIds?.length) {
      return positions;
    }
    const orderMap = new Map(activeOrderIds.map((id, index) => [id, index]));
    return [...positions].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [positionCommittedOrderIds, positionDragPreviewIds, positions]);
  const assignments = snapshot.assignments.filter((item) => item.department_id === selectedDepartment?.id && item.active_flag);
  const substitutions = snapshot.substitutions.filter((item) => item.department_id === selectedDepartment?.id);
  const temporaryAssignments = snapshot.temporaryAssignments.filter((item) => item.department_id === selectedDepartment?.id);
  const allActiveAssignments = snapshot.assignments.filter((item) => item.active_flag);
  const allSubstitutions = snapshot.substitutions;
  const allTemporaryAssignments = snapshot.temporaryAssignments;
  const leaders = positions.filter((item) => item.is_leadership);
  const curators = positions.filter((item) => item.is_curator);
  const admins = positions.filter((item) => item.is_admin);
  const dirty = jsonValue !== editorValue;
  const selectedPositionAssignments = selectedPosition ? assignments.filter((item) => item.position_id === selectedPosition.id) : [];
  const selectedPositionSubstitutions = selectedPosition ? substitutions.filter((item) => item.source_position_id === selectedPosition.id) : [];
  const selectedPositionTemporaryAssignments = selectedPosition ? temporaryAssignments.filter((item) => item.position_id === selectedPosition.id) : [];
  const assignmentPositionValue = newAssignmentPositionId || selectedPosition?.id || positions[0]?.id || "";
  const getPositionAssignmentNames = (positionId: string) =>
    assignments
      .filter((item) => item.position_id === positionId)
      .map((item) => getParticipantName(item.participant_id));
  const getPositionSubstituteNames = (positionId: string) =>
    substitutions
      .filter((item) => item.source_position_id === positionId)
      .map((item) => getParticipantName(item.substitute_participant_id));
  const getPositionTemporaryHolderNames = (positionId: string) =>
    temporaryAssignments
      .filter((item) => item.position_id === positionId)
      .map((item) => getParticipantName(item.participant_id));
  const getPositionAssignmentSummary = (positionId: string) => {
    const assignmentNames = getPositionAssignmentNames(positionId);
    if (assignmentNames.length) {
      return `назначены: ${assignmentNames.join(", ")}`;
    }
    const substituteNames = getPositionSubstituteNames(positionId);
    if (substituteNames.length) {
      return `временно замещает: ${substituteNames.join(", ")}`;
    }
    const temporaryHolderNames = getPositionTemporaryHolderNames(positionId);
    if (temporaryHolderNames.length) {
      return `временно исполняет: ${temporaryHolderNames.join(", ")}`;
    }
    return "никто не назначен";
  };
  const visibleDepartments = [...activeDepartments]
    .sort((left, right) => left.sort_order - right.sort_order)
    .filter((department) =>
      !departmentSearch.trim() ||
      `${department.name} ${department.short_name}`.toLowerCase().includes(departmentSearch.trim().toLowerCase())
    );
  const orderedVisibleDepartments = useMemo(() => {
    const activeOrderIds = departmentDragPreviewIds?.length ? departmentDragPreviewIds : departmentCommittedOrderIds;
    if (!activeOrderIds?.length) {
      return visibleDepartments;
    }
    const orderMap = new Map(activeOrderIds.map((id, index) => [id, index]));
    return [...visibleDepartments].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [departmentCommittedOrderIds, departmentDragPreviewIds, visibleDepartments]);

  useEffect(() => {
    setDepartmentInternalDraft(departmentProfile?.description_internal ?? "");
    setDepartmentOnboardingDraft(departmentProfile?.description_onboarding ?? "");
  }, [departmentProfile?.department_id, departmentProfile?.description_internal, departmentProfile?.description_onboarding]);

  useEffect(() => {
    setDepartmentDraft(selectedDepartment ? cloneJson(selectedDepartment) : null);
  }, [selectedDepartment?.id, snapshot.departments]);

  useEffect(() => {
    if (selectedPositionId && !positions.some((item) => item.id === selectedPositionId)) {
      setSelectedPositionId("");
      setStructureMode("view");
    }
  }, [positions, selectedPositionId]);

  useEffect(() => {
    const fallbackParticipantId = participantPickerOptions[0]?.id ?? "";
    if (!newAssignmentParticipantId || !participantPickerOptions.some((item) => item.id === newAssignmentParticipantId)) {
      setNewAssignmentParticipantId(fallbackParticipantId);
    }
    if (!newSubstituteParticipantId || !participantPickerOptions.some((item) => item.id === newSubstituteParticipantId)) {
      setNewSubstituteParticipantId(fallbackParticipantId);
    }
    if (!newTemporaryParticipantId || !participantPickerOptions.some((item) => item.id === newTemporaryParticipantId)) {
      setNewTemporaryParticipantId(fallbackParticipantId);
    }
  }, [
    newAssignmentParticipantId,
    newSubstituteParticipantId,
    newTemporaryParticipantId,
    participantPickerOptions
  ]);

  useEffect(() => {
    const fallbackPositionId = selectedPosition?.id ?? positions[0]?.id ?? "";
    if (selectedPosition?.id) {
      if (newAssignmentPositionId !== selectedPosition.id) {
        setNewAssignmentPositionId(selectedPosition.id);
      }
      if (!newSubstitutePositionId || !positions.some((item) => item.id === newSubstitutePositionId)) {
        setNewSubstitutePositionId(selectedPosition.id);
      }
      return;
    }
    if (!newAssignmentPositionId || !positions.some((item) => item.id === newAssignmentPositionId)) {
      setNewAssignmentPositionId(fallbackPositionId);
    }
    if (!newSubstitutePositionId || !positions.some((item) => item.id === newSubstitutePositionId)) {
      setNewSubstitutePositionId(fallbackPositionId);
    }
  }, [newAssignmentPositionId, newSubstitutePositionId, positions, selectedPosition?.id]);

  useEffect(() => {
    setPositionDraft(selectedPosition ? cloneJson(selectedPosition) : null);
  }, [selectedPosition?.id, snapshot.structurePositions]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function saveStructureFile() {
    setIsSaving(true);
    try {
      const parsed = JSON.parse(jsonValue);
      await window.fronda.saveStructureFile(editorKey, parsed, actorName);
      setStructureNotice({ tone: "success", text: `Файл ${editorKey} сохранен.` });
      await onRefresh(false);
    } catch (error) {
      setStructureNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить исходные данные структуры."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function openDepartmentOverview(departmentId: string) {
    setSelectedDepartmentIdState(departmentId);
    setSelectedPositionId("");
    setStructureMode("view");
    setStructureNotice(null);
  }

  function openPositionOverview(positionId: string) {
    setSelectedPositionId(positionId);
    setStructureMode("view");
    setStructureNotice(null);
  }

  function beginDepartmentEditing(departmentId?: string) {
    const targetDepartment = departmentId
      ? snapshot.departments.find((item) => item.id === departmentId) ?? null
      : selectedDepartment;
    if (!targetDepartment) {
      return;
    }
    const targetProfile = snapshot.departmentProfiles.find((item) => item.department_id === targetDepartment.id);
    setSelectedDepartmentIdState(targetDepartment.id);
    setSelectedPositionId("");
    setDepartmentDraft(cloneJson(targetDepartment));
    setDepartmentInternalDraft(targetProfile?.description_internal ?? "");
    setDepartmentOnboardingDraft(targetProfile?.description_onboarding ?? "");
    setStructureMode("edit");
    setStructureNotice(null);
  }

  function beginPositionEditing(positionId?: string) {
    const targetPosition = positionId ? positions.find((item) => item.id === positionId) ?? null : selectedPosition;
    if (!targetPosition) {
      return;
    }
    setSelectedPositionId(targetPosition.id);
    setPositionDraft(cloneJson(targetPosition));
    setStructureMode("edit");
    setStructureNotice(null);
  }

  function beginStructureEditing() {
    if (selectedPosition) {
      beginPositionEditing(selectedPosition.id);
      return;
    }
    beginDepartmentEditing();
  }

  function cancelStructureEditing() {
    setDepartmentDraft(selectedDepartment ? cloneJson(selectedDepartment) : null);
    setPositionDraft(selectedPosition ? cloneJson(selectedPosition) : null);
    setDepartmentInternalDraft(departmentProfile?.description_internal ?? "");
    setDepartmentOnboardingDraft(departmentProfile?.description_onboarding ?? "");
    setStructureMode("view");
    setStructureNotice(null);
  }

  async function persistPositionOrder(draggedPositionId: string, targetPositionId: string) {
    if (draggedPositionId === targetPositionId) return;
    const orderedCollection = [...snapshot.structurePositions].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
    const reordered = reorderByTarget(orderedCollection, draggedPositionId, targetPositionId);
    await window.fronda.saveDirectoryRecords(
      "structure_positions",
      normalizeOrderedDirectoryCollection(reordered) as unknown as DirectoryRecord[],
      actorName
    );
    await onRefresh(false);
    setSelectedPositionId(draggedPositionId);
    setStructureNotice({ tone: "success", text: "Порядок должностей обновлен." });
  }

  async function persistDepartmentOrder(draggedDepartmentId: string, targetDepartmentId: string) {
    if (draggedDepartmentId === targetDepartmentId) return;
    const ordered = reorderByTarget(
      [...snapshot.departments].sort((left, right) => left.sort_order - right.sort_order),
      draggedDepartmentId,
      targetDepartmentId
    );
    await window.fronda.saveDirectoryRecords(
      "departments",
      normalizeOrderedDirectoryCollection(ordered) as unknown as DirectoryRecord[],
      actorName
    );
    await onRefresh(false);
    setSelectedDepartmentIdState(draggedDepartmentId);
    setStructureNotice({ tone: "success", text: "Порядок отделов обновлен." });
  }

  function beginDepartmentDrag(departmentId: string) {
    departmentDragBaseIdsRef.current = orderedVisibleDepartments.map((item) => item.id);
    setDragDepartmentId(departmentId);
    setDragDepartmentTargetId(departmentId);
    setDepartmentDragPreviewIds(departmentDragBaseIdsRef.current);
  }

  function trackDepartmentDropTarget(departmentId: string) {
    if (!dragDepartmentId || dragDepartmentId === departmentId || dragDepartmentTargetId === departmentId) return;
    setDragDepartmentTargetId(departmentId);
    const source = departmentDragBaseIdsRef.current ?? orderedVisibleDepartments.map((item) => item.id);
    setDepartmentDragPreviewIds(reorderIdsByTarget([...source], dragDepartmentId, departmentId));
  }

  function beginDepartmentPointerDrag(event: ReactPointerEvent<HTMLDivElement>, departmentId: string) {
    if (event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setDepartmentPointerDrag({
      id: departmentId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function handleDepartmentItemClick(departmentId: string) {
    if (suppressDepartmentClickRef.current) {
      return;
    }
    openDepartmentOverview(departmentId);
  }

  function beginPositionDrag(positionId: string) {
    positionDragBaseIdsRef.current = orderedPositions.map((item) => item.id);
    setDragPositionId(positionId);
    setDragPositionTargetId(positionId);
    setPositionDragPreviewIds(positionDragBaseIdsRef.current);
  }

  function trackPositionDropTarget(positionId: string) {
    if (!dragPositionId || dragPositionId === positionId || dragPositionTargetId === positionId) return;
    setDragPositionTargetId(positionId);
    const source = positionDragBaseIdsRef.current ?? orderedPositions.map((item) => item.id);
    setPositionDragPreviewIds(reorderIdsByTarget([...source], dragPositionId, positionId));
  }

  function beginPositionPointerDrag(event: ReactPointerEvent<HTMLDivElement>, positionId: string) {
    if (event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setPositionPointerDrag({
      id: positionId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function handlePositionItemClick(positionId: string) {
    if (suppressPositionClickRef.current) {
      return;
    }
    openPositionOverview(positionId);
  }

  useEffect(() => {
    if (!departmentPointerDrag && !dragDepartmentId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setDepartmentPointerDrag(null);
      setDragDepartmentId(null);
      setDragDepartmentTargetId(null);
      if (!options?.preservePreview) {
        setDepartmentDragPreviewIds(null);
        departmentDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = departmentPointerDrag;
      const activeId = dragDepartmentId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }

      if (!dragDepartmentId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginDepartmentDrag(candidate.id);
      }

      const targetDepartmentId = findNearestReorderTargetId("data-department-order-id", activeId, event.clientX, event.clientY);
      if (targetDepartmentId && targetDepartmentId !== activeId) {
        trackDepartmentDropTarget(targetDepartmentId);
      }
    }

    function handlePointerUp() {
      const activeId = dragDepartmentId;
      const targetId = dragDepartmentTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      const committedIds =
        didReorder && activeId && targetId
          ? (departmentDragPreviewIds ?? reorderIdsByTarget([...(departmentDragBaseIdsRef.current ?? orderedVisibleDepartments.map((item) => item.id))], activeId, targetId))
          : null;
      if (committedIds) {
        setDepartmentCommittedOrderIds(committedIds);
      }
      resetState({ preservePreview: didReorder });
      if (didReorder) {
        suppressDepartmentClickRef.current = true;
        window.setTimeout(() => {
          suppressDepartmentClickRef.current = false;
        }, 160);
      }
      if (activeId && targetId && activeId !== targetId) {
        void persistDepartmentOrder(activeId, targetId)
          .catch(() => {
            setDepartmentCommittedOrderIds(null);
          })
          .finally(() => {
            setDepartmentDragPreviewIds(null);
            departmentDragBaseIdsRef.current = null;
          });
      } else {
        setDepartmentDragPreviewIds(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [departmentDragPreviewIds, departmentPointerDrag, dragDepartmentId, dragDepartmentTargetId, orderedVisibleDepartments]);

  useEffect(() => {
    if (!positionPointerDrag && !dragPositionId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setPositionPointerDrag(null);
      setDragPositionId(null);
      setDragPositionTargetId(null);
      if (!options?.preservePreview) {
        setPositionDragPreviewIds(null);
        positionDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = positionPointerDrag;
      const activeId = dragPositionId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }

      if (!dragPositionId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginPositionDrag(candidate.id);
      }

      const targetPositionId = findNearestReorderTargetId("data-position-order-id", activeId, event.clientX, event.clientY);
      if (targetPositionId && targetPositionId !== activeId) {
        trackPositionDropTarget(targetPositionId);
      }
    }

    function handlePointerUp() {
      const activeId = dragPositionId;
      const targetId = dragPositionTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      const committedIds =
        didReorder && activeId && targetId
          ? (positionDragPreviewIds ?? reorderIdsByTarget([...(positionDragBaseIdsRef.current ?? orderedPositions.map((item) => item.id))], activeId, targetId))
          : null;
      if (committedIds) {
        setPositionCommittedOrderIds(committedIds);
      }
      resetState({ preservePreview: didReorder });
      if (didReorder) {
        suppressPositionClickRef.current = true;
        window.setTimeout(() => {
          suppressPositionClickRef.current = false;
        }, 160);
      }
      if (activeId && targetId && activeId !== targetId) {
        void persistPositionOrder(activeId, targetId)
          .catch(() => {
            setPositionCommittedOrderIds(null);
          })
          .finally(() => {
            setPositionDragPreviewIds(null);
            positionDragBaseIdsRef.current = null;
          });
      } else {
        setPositionDragPreviewIds(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragPositionId, dragPositionTargetId, orderedPositions, positionDragPreviewIds, positionPointerDrag]);

  async function saveStructureOverview() {
    setIsSaving(true);
    try {
      if (selectedPosition && positionDraft) {
        const normalized = normalizeDirectoryEditorDraft("structure_positions", cloneJson(positionDraft)) as StructurePosition;
        const nextPositions = normalizeOrderedDirectoryCollection(
          snapshot.structurePositions.map((item) => item.id === selectedPosition.id ? { ...item, ...normalized } : item)
        );
        await window.fronda.saveDirectoryRecords("structure_positions", nextPositions as unknown as DirectoryRecord[], actorName);
        await onRefresh(false);
        setSelectedPositionId(normalized.id);
        setStructureMode("view");
        setStructureNotice({ tone: "success", text: "Должность сохранена. Открыт обычный обзор." });
        return;
      }
      if (selectedDepartment && departmentDraft) {
        const normalizedDepartment = normalizeDirectoryEditorDraft("departments", cloneJson(departmentDraft)) as DepartmentDirectoryItem;
        const nextDepartments = normalizeOrderedDirectoryCollection(
          snapshot.departments.map((item) => item.id === selectedDepartment.id ? { ...item, ...normalizedDepartment } : item)
        );
        const existingProfile = snapshot.departmentProfiles.find((item) => item.department_id === selectedDepartment.id);
        const nextProfiles = existingProfile
          ? snapshot.departmentProfiles.map((item) => item.department_id === selectedDepartment.id ? {
            ...item,
            description_internal: departmentInternalDraft,
            description_onboarding: departmentOnboardingDraft
          } : item)
          : [...snapshot.departmentProfiles, {
            ...createDepartmentProfileDraft(selectedDepartment.id),
            description_internal: departmentInternalDraft,
            description_onboarding: departmentOnboardingDraft
          }];
        await window.fronda.saveDirectoryRecords("departments", nextDepartments as unknown as DirectoryRecord[], actorName);
        await window.fronda.saveStructureFile("department_profiles.json", nextProfiles, actorName);
        await onRefresh(false);
        setSelectedDepartmentIdState(normalizedDepartment.id);
        setStructureMode("view");
        setStructureNotice({ tone: "success", text: "Карточка отдела сохранена. Открыт обычный обзор." });
      }
    } catch (error) {
      setStructureNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить данные структуры."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function createDepartment() {
    const normalizedName = normalizeSingleLineText(newDepartmentName);
    const normalizedShortName = normalizeSingleLineText(newDepartmentShortName) || normalizedName;
    if (!normalizedName) return;
    const department = createDepartmentDraft(normalizedName, normalizedShortName, actorName, snapshot.departments.length + 1);
    await window.fronda.saveDirectoryRecords("departments", [...snapshot.departments, department] as unknown as DirectoryRecord[], actorName);
    await window.fronda.saveStructureFile("department_profiles.json", [...snapshot.departmentProfiles, createDepartmentProfileDraft(department.id)], actorName);
    setNewDepartmentName("");
    setNewDepartmentShortName("");
    await onRefresh(false);
    setSelectedDepartmentIdState(department.id);
    setSelectedPositionId("");
    setStructureMode("view");
    setStructureNotice({ tone: "success", text: "Новый отдел создан и открыт в режиме обзора." });
  }

  async function createPosition() {
    const normalizedName = normalizeSingleLineText(newPositionName);
    if (!selectedDepartment || !normalizedName) return;
    const position = createStructurePositionDraft(selectedDepartment.id, normalizedName, actorName, snapshot.structurePositions.length + 1, newPositionType);
    await window.fronda.saveDirectoryRecords("structure_positions", [...snapshot.structurePositions, position] as unknown as DirectoryRecord[], actorName);
    setNewPositionName("");
    await onRefresh(false);
    setSelectedPositionId(position.id);
    setStructureMode("view");
    setStructureNotice({ tone: "success", text: "Должность создана и открыта в режиме обзора." });
  }

  async function createAssignment() {
    const targetPositionId = assignmentPositionValue;
    if (!selectedDepartment || !newAssignmentParticipantId || !targetPositionId) return;
    const assignment = createPositionAssignmentEntry(selectedDepartment.id, targetPositionId, newAssignmentParticipantId, actorName, newAssignmentKind);
    await window.fronda.saveStructureFile("position_assignments.json", [...snapshot.assignments, assignment], actorName);
    await onRefresh(false);
    setSelectedPositionId(targetPositionId);
    setStructureNotice({ tone: "success", text: "Назначение сохранено." });
  }

  async function removeAssignment(assignmentId: string) {
    const nextAssignments = snapshot.assignments.map((item) =>
      item.id === assignmentId
        ? {
            ...item,
            active_flag: false,
            ended_at: item.ended_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: actorName
          }
        : item
    );
    await window.fronda.saveStructureFile("position_assignments.json", nextAssignments, actorName);
    await onRefresh(false);
    setStructureNotice({ tone: "success", text: "Назначение снято." });
  }

  async function createSubstitution() {
    const targetPositionId = selectedPosition?.id || newSubstitutePositionId;
    if (!selectedDepartment || !newSubstituteParticipantId || !targetPositionId) return;
    const substitution = createSubstitutionEntry(selectedDepartment.id, targetPositionId, newSubstituteParticipantId, actorName);
    await window.fronda.saveStructureFile("substitutions.json", [...snapshot.substitutions, substitution], actorName);
    await onRefresh(false);
    setSelectedPositionId(targetPositionId);
    setStructureNotice({ tone: "success", text: "Замещение сохранено." });
  }

  async function createTemporaryAssignment() {
    const targetPositionId = selectedPosition?.id || newSubstitutePositionId || undefined;
    if (!selectedDepartment || !newTemporaryParticipantId || !newTemporaryReason.trim()) return;
    const temporary = createTemporaryAssignmentEntry(selectedDepartment.id, newTemporaryParticipantId, actorName, newTemporaryReason.trim(), targetPositionId);
    await window.fronda.saveStructureFile("temporary_assignments.json", [...snapshot.temporaryAssignments, temporary], actorName);
    setNewTemporaryReason("");
    await onRefresh(false);
    setStructureNotice({ tone: "success", text: "Временное исполнение сохранено." });
  }

  async function removeSubstitution(substitutionId: string) {
    await window.fronda.saveStructureFile(
      "substitutions.json",
      snapshot.substitutions.filter((item) => item.id !== substitutionId),
      actorName
    );
    await onRefresh(false);
    setStructureNotice({ tone: "success", text: "Замещение удалено." });
  }

  async function removeTemporaryAssignmentEntry(temporaryAssignmentId: string) {
    await window.fronda.saveStructureFile(
      "temporary_assignments.json",
      snapshot.temporaryAssignments.filter((item) => item.id !== temporaryAssignmentId),
      actorName
    );
    await onRefresh(false);
    setStructureNotice({ tone: "success", text: "Временное исполнение удалено." });
  }

  async function deleteSelectedPosition() {
    if (!selectedPosition || !selectedDepartment) return;
    setIsSaving(true);
    try {
      const nextPositions = snapshot.structurePositions
        .filter((item) => item.id !== selectedPosition.id)
        .map((item) =>
          item.reports_to_position_id === selectedPosition.id
            ? { ...item, reports_to_position_id: null }
            : item
        );
      const nextAssignments = snapshot.assignments.filter((item) => item.position_id !== selectedPosition.id);
      const nextSubstitutions = snapshot.substitutions.filter(
        (item) => item.source_position_id !== selectedPosition.id && item.substitute_position_id !== selectedPosition.id
      );
      const nextTemporaryAssignments = snapshot.temporaryAssignments.filter((item) => item.position_id !== selectedPosition.id);
      const nextStructureContacts = snapshot.structureContacts.filter((item) => item.position_id !== selectedPosition.id);
      const nextStructureNotes = snapshot.structureNotes.filter((item) => item.position_id !== selectedPosition.id);
      await window.fronda.saveDirectoryRecords("structure_positions", nextPositions as unknown as DirectoryRecord[], actorName);
      await window.fronda.saveStructureFile("position_assignments.json", nextAssignments, actorName);
      await window.fronda.saveStructureFile("substitutions.json", nextSubstitutions, actorName);
      await window.fronda.saveStructureFile("temporary_assignments.json", nextTemporaryAssignments, actorName);
      await window.fronda.saveStructureFile("structure_contacts.json", nextStructureContacts, actorName);
      await window.fronda.saveStructureFile("structure_notes.json", nextStructureNotes, actorName);
      await onRefresh(false);
      setSelectedPositionId("");
      setStructureMode("view");
      setStructureNotice({ tone: "success", text: "Должность удалена вместе со связанными назначениями." });
    } catch (error) {
      setStructureNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось удалить должность."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSelectedDepartment() {
    if (!selectedDepartment) return;
    const departmentPositions = snapshot.structurePositions.filter((item) => item.department_id === selectedDepartment.id);
    const departmentPositionIds = new Set(departmentPositions.map((item) => item.id));
    setIsSaving(true);
    try {
      const nextDepartments = snapshot.departments.filter((item) => item.id !== selectedDepartment.id);
      const nextDepartmentProfiles = snapshot.departmentProfiles.filter((item) => item.department_id !== selectedDepartment.id);
      const nextPositions = snapshot.structurePositions
        .filter((item) => item.department_id !== selectedDepartment.id)
        .map((item) =>
          item.reports_to_position_id && departmentPositionIds.has(item.reports_to_position_id)
            ? { ...item, reports_to_position_id: null }
            : item
        );
      const nextAssignments = snapshot.assignments.filter(
        (item) => item.department_id !== selectedDepartment.id && !departmentPositionIds.has(item.position_id)
      );
      const cleanedSubstitutions = snapshot.substitutions.filter(
        (item) =>
          item.department_id !== selectedDepartment.id &&
          !departmentPositionIds.has(item.source_position_id) &&
          !departmentPositionIds.has(item.substitute_position_id ?? "")
      );
      const nextTemporaryAssignments = snapshot.temporaryAssignments.filter(
        (item) =>
          item.department_id !== selectedDepartment.id &&
          !departmentPositionIds.has(item.position_id ?? "")
      );
      const nextStructureContacts = snapshot.structureContacts.filter(
        (item) =>
          item.department_id !== selectedDepartment.id &&
          !departmentPositionIds.has(item.position_id ?? "")
      );
      const nextStructureNotes = snapshot.structureNotes.filter(
        (item) =>
          item.department_id !== selectedDepartment.id &&
          !departmentPositionIds.has(item.position_id ?? "")
      );
      const participantUpdates = snapshot.participants
        .filter((participant) =>
          participant.org.department_assignments.some((item) => item.department_id === selectedDepartment.id)
          || participant.org.role_assignments.some((item) => item.department_id === selectedDepartment.id)
          || participant.notes.some((item) => item.related_department_id === selectedDepartment.id)
        )
        .map((participant) => {
          const nextParticipant = structuredClone(participant);
          nextParticipant.org.department_assignments = nextParticipant.org.department_assignments
            .filter((item) => item.department_id !== selectedDepartment.id);
          nextParticipant.org.role_assignments = nextParticipant.org.role_assignments.map((item) =>
            item.department_id === selectedDepartment.id
              ? { ...item, department_id: null }
              : item
          );
          nextParticipant.notes = nextParticipant.notes.map((item) =>
            item.related_department_id === selectedDepartment.id
              ? { ...item, related_department_id: null }
              : item
          );
          normalizeParticipantAggregateDraft(nextParticipant);
          return nextParticipant;
        });
      const fallbackDepartmentId = nextDepartments[0]?.id ?? "general";
      const releaseUpdates = snapshot.releases
        .filter((release) =>
          release.release.primary_department_id === selectedDepartment.id
          || release.release.department_ids.includes(selectedDepartment.id)
          || release.participants.some((item) => item.department_id === selectedDepartment.id)
        )
        .map((release) => {
          const nextRelease = structuredClone(release);
          nextRelease.release.department_ids = nextRelease.release.department_ids.filter((id) => id !== selectedDepartment.id);
          if (!nextRelease.release.department_ids.length) {
            nextRelease.release.department_ids = [fallbackDepartmentId];
          }
          if (nextRelease.release.primary_department_id === selectedDepartment.id) {
            nextRelease.release.primary_department_id = nextRelease.release.department_ids[0] ?? fallbackDepartmentId;
          }
          nextRelease.participants = nextRelease.participants.map((item) =>
            item.department_id === selectedDepartment.id
              ? { ...item, department_id: null }
              : item
          );
          normalizeReleaseAggregateDraft(nextRelease);
          return nextRelease;
        });
      for (const participant of participantUpdates) {
        await window.fronda.saveParticipant(participant, actorName);
      }
      for (const release of releaseUpdates) {
        await window.fronda.saveRelease(release, actorName);
      }
      await window.fronda.saveDirectoryRecords("departments", nextDepartments as unknown as DirectoryRecord[], actorName);
      await window.fronda.saveDirectoryRecords("structure_positions", nextPositions as unknown as DirectoryRecord[], actorName);
      await window.fronda.saveStructureFile("department_profiles.json", nextDepartmentProfiles, actorName);
      await window.fronda.saveStructureFile("position_assignments.json", nextAssignments, actorName);
      await window.fronda.saveStructureFile("substitutions.json", cleanedSubstitutions, actorName);
      await window.fronda.saveStructureFile("temporary_assignments.json", nextTemporaryAssignments, actorName);
      await window.fronda.saveStructureFile("structure_contacts.json", nextStructureContacts, actorName);
      await window.fronda.saveStructureFile("structure_notes.json", nextStructureNotes, actorName);
      await onRefresh(false);
      setSelectedDepartmentIdState("");
      setSelectedPositionId("");
      setStructureMode("view");
      setStructureNotice({ tone: "success", text: "Отдел удален вместе со связанными должностями и назначениями." });
    } catch (error) {
      setStructureNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось удалить отдел."
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="structure:list">
      <Panel title="Отделы и направления" subtitle="Слева находится реестр отделов: поиск, создание и быстрый выбор нужного направления.">
        <div className="list">
          <Field
            label="Поиск отдела"
            help="Поиск смотрит название и короткое имя отдела. Используйте его, когда отделов станет больше."
            hint="Отделы здесь — это направления студии: аниме, дорамы, фильмы, медиа и другие секции."
          >
            <input className="search-input" value={departmentSearch} onChange={(event) => setDepartmentSearch(event.target.value)} placeholder="Название или короткое имя отдела" />
          </Field>
          <details className="detail-disclosure">
            <summary className="disclosure-summary">
              <strong>Новый отдел</strong>
              <span className="muted">Создайте новое направление студии, если его еще нет в реестре.</span>
            </summary>
            <div className="detail-disclosure-body">
              <div className="grid two">
                <Field label="Название отдела" help="Полное название используется в структуре, справочниках и карточках релизов."><input className="text-input" value={newDepartmentName} onChange={(event) => setNewDepartmentName(event.target.value)} /></Field>
                <Field label="Короткое имя" help="Короткая форма помогает в узких карточках и списках."><input className="text-input" value={newDepartmentShortName} onChange={(event) => setNewDepartmentShortName(event.target.value)} /></Field>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <Button className="primary" onClick={() => void createDepartment()}>Создать отдел</Button>
              </div>
            </div>
          </details>
          {orderedVisibleDepartments.map((department) => (
            <div
              key={department.id}
              data-department-order-id={department.id}
              data-reorder-surface="true"
              className={`list-item ${department.id === selectedDepartment?.id ? "active" : ""} ${dragDepartmentId === department.id ? "dragging" : ""} ${dragDepartmentTargetId === department.id && dragDepartmentId !== department.id ? "drop-target" : ""}`}
              onClick={() => handleDepartmentItemClick(department.id)}
              onDoubleClick={() => openDepartmentOverview(department.id)}
              onPointerDown={(event) => beginDepartmentPointerDrag(event, department.id)}
              onDragStart={(event) => event.preventDefault()}
            >
              <div className="card-header-row">
                <div className="card-header-main">
                  <h3>{department.name}</h3>
                  <div className="card-inline-meta">
                    <span>{filterVisibleLookupRecords(snapshot.structurePositions).filter((item) => item.department_id === department.id).length} должностей</span>
                    <span>{department.onboarding_visible_flag ? "видно новичкам" : "только для команды"}</span>
                    {showAdvancedMode && department.short_name && department.short_name !== department.name ? <span>короткое имя: {department.short_name}</span> : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!visibleDepartments.length ? <EmptyState title="Отделы не найдены" body="Уточните поиск или создайте первый отдел, чтобы начать настройку структуры команды." /> : null}
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey="structure:details">
      <div className="section-stack">
        <Panel
          title={selectedDepartment?.name ?? "Обзор структуры"}
          subtitle={
            selectedDepartment
              ? departmentProfile?.responsibility_summary ?? "В центре показывается карточка отдела: описание, должности и зоны ответственности."
              : "Когда отдел не выбран, в центре показывается общая картина по всем назначениям, замещениям и временным полномочиям структуры."
          }
          actions={selectedDepartment ? <Button className="secondary utility" onClick={() => { setSelectedDepartmentIdState(""); setSelectedPositionId(""); setStructureMode("view"); setStructureNotice(null); }}>← К списку отделов</Button> : undefined}
        >
          {selectedDepartment ? (
            structureMode === "view" ? (
            <>
              <div className="stat-grid">
                <StatCard label="Должности" value={positions.length} note={formatSimpleCount(assignments.length, "активное назначение", "активных назначений")} />
                <StatCard label="Руководство" value={leaders.length} note={`${curators.length} кураторов • ${admins.length} администраторов`} />
                <StatCard label="Замещения" value={substitutions.length} note={`${temporaryAssignments.length} временных полномочий`} />
                <StatCard label="Для новичков" value={selectedDepartment.onboarding_visible_flag ? "видно" : "скрыто"} note="видимость карточки отдела" />
              </div>
              <div className="grid two">
                <div className="detail-card card-shell"><h4>Описание для команды</h4><div className="card-copy"><div className="muted">{departmentProfile?.description_internal || "Внутреннее описание пока не заполнено."}</div></div></div>
                <div className="detail-card card-shell"><h4>Описание для новичков</h4><div className="card-copy"><div className="muted">{departmentProfile?.description_onboarding || "Описание для новичков пока не заполнено."}</div></div></div>
              </div>
              <div className="detail-card card-shell">
                <div className="card-header-row">
                  <div className="card-header-main">
                    <h4>Должности отдела</h4>
                    <div className="muted">Все должности отдела собраны по центру, чтобы их было удобно просматривать, открывать и редактировать.</div>
                  </div>
                </div>
                {orderedPositions.length ? (
                  <div className="grid two">
                    {orderedPositions.map((position) => (
                      <div
                        key={position.id}
                        className={`detail-card subdued registry-click-target ${selectedPosition?.id === position.id ? "active" : ""} ${dragPositionId === position.id ? "dragging" : ""} ${dragPositionTargetId === position.id ? "drop-target" : ""}`}
                        data-position-order-id={position.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(event) => beginPositionPointerDrag(event, position.id)}
                        onClick={() => handlePositionItemClick(position.id)}
                        onDoubleClick={() => openPositionOverview(position.id)}
                        onDragStart={(event) => event.preventDefault()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPositionOverview(position.id);
                          }
                        }}
                      >
                        <div className="card-header-row">
                          <div className="card-header-main">
                            <strong>{showAdvancedMode && position.short_label && position.short_label !== position.name ? `${position.name} • ${position.short_label}` : position.name}</strong>
                            <div className="muted">
                              {getPositionAssignmentSummary(position.id)}
                              {position.responsibility_scope_ids.length ? ` • ${formatSimpleCount(position.responsibility_scope_ids.length, "зона ответственности", "зон ответственности")}` : ""}
                            </div>
                          </div>
                          <div className="chip-group">
                            {position.is_leadership ? <Chip tone="accent">Руководство</Chip> : null}
                            {position.is_curator ? <Chip tone="accent">Кураторство</Chip> : null}
                            {position.is_admin ? <Chip>Администрирование</Chip> : null}
                          </div>
                        </div>
                        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                          <Button
                            className="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPositionOverview(position.id);
                            }}
                          >
                            Открыть
                          </Button>
                          <Button
                            className="secondary"
                            onClick={(event) => {
                              event.stopPropagation();
                              beginPositionEditing(position.id);
                            }}
                          >
                            Редактировать должность
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="card-copy"><div className="muted">Пока нет связанных должностей.</div></div>}
              </div>
              {selectedPosition ? (
                <div className="detail-card card-shell">
                  <div className="card-header-row">
                    <div className="card-header-main">
                      <h4>{showAdvancedMode && selectedPosition.short_label && selectedPosition.short_label !== selectedPosition.name ? `${selectedPosition.name} • ${selectedPosition.short_label}` : selectedPosition.name}</h4>
                      <div className="muted">{getPositionAssignmentSummary(selectedPosition.id)} • {selectedPosition.responsibility_scope_ids.length ? formatSimpleCount(selectedPosition.responsibility_scope_ids.length, "зона ответственности", "зон ответственности") : "зоны пока не описаны"}</div>
                    </div>
                    <div className="chip-group">
                      <Chip>{POSITION_TYPE_OPTIONS.find((item) => item.id === (selectedPosition.position_type_id ?? "worker"))?.label ?? "Рабочая должность"}</Chip>
                      {selectedPosition.onboarding_visible_flag ? <Chip tone="accent">видно новичкам</Chip> : <Chip>только для команды</Chip>}
                    </div>
                  </div>
                  <div className="summary-key-list">
                    <div className="compact-row"><strong>Подчиняется</strong><span className="muted">{selectedPosition.reports_to_position_id ? getPositionName(selectedPosition.reports_to_position_id) : "не указано"}</span></div>
                    <div className="compact-row"><strong>Внутреннее описание</strong><span className="muted">{selectedPosition.description_internal || "Описание пока не заполнено."}</span></div>
                    <div className="compact-row"><strong>Описание для новичков</strong><span className="muted">{selectedPosition.description_onboarding || "Описание для новичков пока не заполнено."}</span></div>
                  </div>
                  <div className="card-section">
                    <h4>Кто назначен на эту должность</h4>
                    <div className="list compact-list">
                      {selectedPositionAssignments.length ? selectedPositionAssignments.map((assignment) => (
                        <div key={assignment.id} className="list-item subdued">
                          <div className="row spread">
                            <div>
                              <strong>{getParticipantName(assignment.participant_id)}</strong>
                              <div className="muted">{translateCode(assignment.assignment_kind)} • {formatDate(assignment.started_at)}</div>
                            </div>
                            <Button className="ghost" onClick={() => onOpenParticipant(assignment.participant_id)}>Открыть участника</Button>
                          </div>
                        </div>
                      )) : <EmptyState title="Никто не назначен" body="Назначения для этой должности создаются в центральной колонке при редактировании отдела или должности." />}
                    </div>
                  </div>
                  {selectedPositionSubstitutions.length || selectedPositionTemporaryAssignments.length ? (
                    <div className="card-section">
                      <h4>Временное замещение</h4>
                      <div className="list compact-list">
                        {selectedPositionSubstitutions.map((item) => (
                          <div key={item.id} className="list-item subdued">
                            <strong>Временно замещает: {getParticipantName(item.substitute_participant_id)}</strong>
                            <div className="muted">{item.reason || "Без комментария"}</div>
                          </div>
                        ))}
                        {selectedPositionTemporaryAssignments.map((item) => (
                          <div key={item.id} className="list-item subdued">
                            <strong>Временно исполняет: {getParticipantName(item.participant_id)}</strong>
                            <div className="muted">{item.reason || "Без комментария"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!selectedPosition ? (
                <div className="detail-card card-shell">
                  <div className="card-header-row">
                    <div className="card-header-main">
                      <h4>Назначения отдела</h4>
                      <div className="muted">В обычном просмотре здесь видны текущие назначения, замещения и временные полномочия без перехода в редактирование.</div>
                    </div>
                  </div>
                  <div className="details-grid">
                    <div className="detail-card">
                      <h4>Активные назначения</h4>
                      <div className="list compact-list">
                        {assignments.length ? assignments.map((assignment) => (
                          <div key={assignment.id} className="list-item subdued">
                            <div className="row spread">
                              <div>
                                <strong>{getPositionName(assignment.position_id)}</strong>
                                <div className="muted">
                                  {getParticipantName(assignment.participant_id)}
                                  {" • "}
                                  {translateCode(assignment.assignment_kind)}
                                  {assignment.reason ? ` • ${assignment.reason}` : ""}
                                </div>
                              </div>
                              <Button className="ghost" onClick={() => onOpenParticipant(assignment.participant_id)}>Открыть участника</Button>
                            </div>
                          </div>
                        )) : <EmptyState title="Назначения не найдены" body="В выбранном отделе пока нет активных структурных назначений." />}
                      </div>
                    </div>
                    <div className="detail-card">
                      <h4>Замещения и временное исполнение</h4>
                      <div className="list compact-list">
                        {substitutions.map((item) => (
                          <div key={item.id} className="list-item subdued">
                            <strong>{item.reason}</strong>
                            <div className="muted">
                              {getPositionName(item.source_position_id)}
                              {" → "}
                              {getParticipantName(item.substitute_participant_id)}
                            </div>
                          </div>
                        ))}
                        {temporaryAssignments.map((item) => (
                          <div key={item.id} className="list-item subdued">
                            <strong>{item.reason}</strong>
                            <div className="muted">
                              {getParticipantName(item.participant_id)}
                              {" • "}
                              {getTemporaryTargetLabel(item)}
                            </div>
                          </div>
                        ))}
                        {!substitutions.length && !temporaryAssignments.length ? <EmptyState title="Временных назначений нет" body="Здесь появятся замещения и временные полномочия по отделу." /> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
            ) : (
              selectedPosition ? (
                positionDraft ? (
                  <>
                    <div className="detail-card card-shell">
                      <div className="card-header-row">
                        <div className="card-header-main">
                          <h4>Назначение на выбранную должность</h4>
                          <div className="muted">Этот блок работает только с текущей выбранной должностью. Создание новых должностей остается в редакторе отдела.</div>
                        </div>
                      </div>
                      {participantPickerOptions.length ? (
                        <>
                          {dirty ? (
                            <div className="notice-banner">
                              <strong>Сначала сохраните должность</strong>
                              <div>Пока у должности есть несохраненные правки, назначение временно заблокировано.</div>
                            </div>
                          ) : null}
                          <div className="grid two">
                            <Field label="Должность">
                              <input className="text-input" value={selectedPosition.name} readOnly />
                            </Field>
                            <Field label="Человек из состава">
                              <select className="select-input" value={newAssignmentParticipantId} onChange={(event) => setNewAssignmentParticipantId(event.target.value)} disabled={dirty || isSaving}>
                                <option value="">Выберите участника</option>
                                {participantPickerOptions.map((participant) => <option key={participant.id} value={participant.id}>{getParticipantPickerLabel(participant)}</option>)}
                              </select>
                            </Field>
                            <Field label="Тип назначения">
                              <select className="select-input" value={newAssignmentKind} onChange={(event) => setNewAssignmentKind(event.target.value as PositionAssignment["assignment_kind"])} disabled={dirty || isSaving}>
                                {POSITION_ASSIGNMENT_KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                              </select>
                            </Field>
                          </div>
                          <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                            <Button className="primary" onClick={() => void createAssignment()} disabled={dirty || isSaving || !newAssignmentParticipantId || !selectedPosition.id}>
                              Назначить на должность
                            </Button>
                          </div>
                          <div className="card-section">
                            <h4>Кто уже назначен</h4>
                            <div className="list compact-list">
                              {selectedPositionAssignments.length ? selectedPositionAssignments.map((assignment) => (
                                <div key={assignment.id} className="list-item subdued">
                                  <div className="row spread">
                                    <div>
                                      <strong>{getParticipantName(assignment.participant_id)}</strong>
                                      <div className="muted">{translateCode(assignment.assignment_kind)} • {formatDate(assignment.started_at)}</div>
                                    </div>
                                    <div className="row">
                                      <Button className="ghost" onClick={() => onOpenParticipant(assignment.participant_id)}>Открыть участника</Button>
                                      <Button className="danger" onClick={() => void removeAssignment(assignment.id)}>Снять</Button>
                                    </div>
                                  </div>
                                </div>
                              )) : <EmptyState title="Пока никто не назначен" body="После сохранения должности здесь будет видно, кто закреплен за этой позицией." />}
                            </div>
                          </div>
                          <div className="card-section">
                            <h4>Замещение и временное исполнение</h4>
                            <div className="grid two">
                              <Field label="Кто замещает" help="Участник, который временно берет на себя обязанности выбранной должности.">
                                <select className="select-input" value={newSubstituteParticipantId} onChange={(event) => setNewSubstituteParticipantId(event.target.value)} disabled={dirty || isSaving}>
                                  <option value="">Выберите участника</option>
                                  {participantPickerOptions.map((participant) => <option key={participant.id} value={participant.id}>{getParticipantPickerLabel(participant)}</option>)}
                                </select>
                              </Field>
                              <Field label="Временный исполнитель" help="Если нужно выдать временные полномочия по выбранной должности.">
                                <select className="select-input" value={newTemporaryParticipantId} onChange={(event) => setNewTemporaryParticipantId(event.target.value)} disabled={dirty || isSaving}>
                                  <option value="">Выберите участника</option>
                                  {participantPickerOptions.map((participant) => <option key={participant.id} value={participant.id}>{getParticipantPickerLabel(participant)}</option>)}
                                </select>
                              </Field>
                              <Field label="Причина или комментарий" help="Коротко опишите причину временного назначения.">
                                <input className="text-input" value={newTemporaryReason} onChange={(event) => setNewTemporaryReason(event.target.value)} disabled={dirty || isSaving} />
                              </Field>
                            </div>
                            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                              <Button className="secondary" onClick={() => void createSubstitution()} disabled={dirty || isSaving || !selectedPosition.id || !newSubstituteParticipantId}>
                                Создать замещение
                              </Button>
                              <Button className="secondary" onClick={() => void createTemporaryAssignment()} disabled={dirty || isSaving || !selectedPosition.id || !newTemporaryParticipantId || !newTemporaryReason.trim()}>
                                Создать временное исполнение
                              </Button>
                            </div>
                            {(selectedPositionSubstitutions.length || selectedPositionTemporaryAssignments.length) ? (
                              <div className="list compact-list" style={{ marginTop: 12 }}>
                                {selectedPositionSubstitutions.map((item) => (
                                  <div key={item.id} className="list-item subdued">
                                    <div className="row spread">
                                      <div>
                                        <strong>Временно замещает: {getParticipantName(item.substitute_participant_id)}</strong>
                                        <div className="muted">{item.reason || "Без комментария"}</div>
                                      </div>
                                      <Button className="danger" onClick={() => void removeSubstitution(item.id)}>Удалить</Button>
                                    </div>
                                  </div>
                                ))}
                                {selectedPositionTemporaryAssignments.map((item) => (
                                  <div key={item.id} className="list-item subdued">
                                    <div className="row spread">
                                      <div>
                                        <strong>Временно исполняет: {getParticipantName(item.participant_id)}</strong>
                                        <div className="muted">{item.reason || "Без комментария"}</div>
                                      </div>
                                      <Button className="danger" onClick={() => void removeTemporaryAssignmentEntry(item.id)}>Удалить</Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <EmptyState title="Состав пока пуст" body="Сначала добавьте участников в раздел «Состав», после чего здесь появится выбор человека для назначения." />
                      )}
                    </div>
                    <div className="detail-card">
                      <h4>Редактирование должности</h4>
                      <div className="grid two">
                        <Field label="Название должности"><input className="text-input" value={positionDraft.name} onChange={(event) => setPositionDraft({ ...positionDraft, name: event.target.value })} /></Field>
                        <Field label="Короткая подпись"><input className="text-input" value={positionDraft.short_label} onChange={(event) => setPositionDraft({ ...positionDraft, short_label: event.target.value })} /></Field>
                      </div>
                      <div className="grid two">
                        <Field label="Отдел"><select className="select-input" value={positionDraft.department_id} onChange={(event) => setPositionDraft({ ...positionDraft, department_id: event.target.value })}>{mergeLookupOptionsWithCurrent(snapshot.departments, [positionDraft.department_id]).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
                        <Field label="Тип должности"><select className="select-input" value={positionDraft.position_type_id ?? "worker"} onChange={(event) => { const nextType = event.target.value; setPositionDraft({ ...positionDraft, position_type_id: nextType, is_leadership: nextType === "leadership", is_curator: nextType === "curator", is_admin: nextType === "admin" }); }}>{POSITION_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
                      </div>
                      <div className="grid two">
                        <Field label="Подчиняется позиции"><select className="select-input" value={positionDraft.reports_to_position_id ?? ""} onChange={(event) => setPositionDraft({ ...positionDraft, reports_to_position_id: event.target.value || null })}><option value="">Не указано</option>{mergeLookupOptionsWithCurrent(snapshot.structurePositions, [positionDraft.reports_to_position_id]).filter((item) => item.id !== positionDraft.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                        <Field label="Порядок"><input className="text-input" type="number" value={positionDraft.sort_order} onChange={(event) => setPositionDraft({ ...positionDraft, sort_order: Number(event.target.value) || 0 })} /></Field>
                      </div>
                      <div className="filter-chip-grid">
                        <ToggleChip label="Руководство" active={positionDraft.is_leadership} onToggle={(value) => setPositionDraft({ ...positionDraft, is_leadership: value })} tone="accent" />
                        <ToggleChip label="Кураторство" active={positionDraft.is_curator} onToggle={(value) => setPositionDraft({ ...positionDraft, is_curator: value })} tone="accent" />
                        <ToggleChip label="Административная роль" active={positionDraft.is_admin} onToggle={(value) => setPositionDraft({ ...positionDraft, is_admin: value })} tone="accent" />
                        <ToggleChip label="Одна ставка" active={positionDraft.is_single_seat} onToggle={(value) => setPositionDraft({ ...positionDraft, is_single_seat: value })} />
                        <ToggleChip label="Несколько держателей" active={positionDraft.can_have_multiple_holders} onToggle={(value) => setPositionDraft({ ...positionDraft, can_have_multiple_holders: value })} />
                      </div>
                      <div className="grid two">
                        <Field label="Зоны ответственности через запятую"><input className="text-input" value={positionDraft.responsibility_scope_ids.join(", ")} onChange={(event) => setPositionDraft({ ...positionDraft, responsibility_scope_ids: splitCsv(event.target.value) })} /></Field>
                        <Field label="Показывать новичкам"><select className="select-input" value={positionDraft.onboarding_visible_flag ? "yes" : "no"} onChange={(event) => setPositionDraft({ ...positionDraft, onboarding_visible_flag: event.target.value === "yes" })}><option value="yes">Да</option><option value="no">Нет</option></select></Field>
                      </div>
                      <div className="grid two">
                        <Field label="Внутреннее описание"><textarea className="text-area" value={positionDraft.description_internal ?? ""} onChange={(event) => setPositionDraft({ ...positionDraft, description_internal: event.target.value })} /></Field>
                        <Field label="Описание для новичков"><textarea className="text-area" value={positionDraft.description_onboarding ?? ""} onChange={(event) => setPositionDraft({ ...positionDraft, description_onboarding: event.target.value })} /></Field>
                      </div>
                    </div>
                  </>
                ) : null
              ) : departmentDraft ? (
                <>
                  <div className="detail-card card-shell">
                    <div className="card-header-row">
                      <div className="card-header-main">
                        <h4>Новая должность в отделе</h4>
                        <div className="muted">В редакторе отдела создается только новая должность. Назначения, замещения и временное исполнение редактируются уже внутри конкретной выбранной должности.</div>
                      </div>
                    </div>
                    <div className="section-stack compact">
                      <div className="detail-card">
                        <h4>Создать должность</h4>
                        <div className="grid two">
                          <Field label="Название должности" help="Должность — это структурная позиция: глава направления, куратор, администратор, наставник."><input className="text-input" value={newPositionName} onChange={(event) => setNewPositionName(event.target.value)} /></Field>
                          <Field label="Тип должности" help="Тип помогает отличать руководство, кураторство, поддержку и обычные структурные места.">
                            <select className="select-input" value={newPositionType} onChange={(event) => setNewPositionType(event.target.value)}>
                              {POSITION_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        <div className="row" style={{ marginTop: 12 }}>
                          <Button className="primary" onClick={() => void createPosition()} disabled={!selectedDepartment}>Создать должность</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="detail-card card-shell">
                    <div className="card-header-row">
                      <div className="card-header-main">
                        <h4>Должности отдела</h4>
                        <div className="muted">Откройте конкретную должность, чтобы назначать на нее людей, создавать замещения и временное исполнение.</div>
                      </div>
                    </div>
                    {orderedPositions.length ? (
                      <div className="list compact-list">
                        {orderedPositions.map((position) => (
                          <div key={position.id} className="list-item subdued">
                            <div className="row spread" style={{ alignItems: "flex-start", gap: 12 }}>
                              <div>
                                <strong>{showAdvancedMode && position.short_label && position.short_label !== position.name ? `${position.name} • ${position.short_label}` : position.name}</strong>
                                <div className="muted">{getPositionAssignmentSummary(position.id)}</div>
                              </div>
                              <div className="row" style={{ flexWrap: "wrap" }}>
                                <Button className="ghost" onClick={() => openPositionOverview(position.id)}>Открыть</Button>
                                <Button className="secondary" onClick={() => beginPositionEditing(position.id)}>Редактировать должность</Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="Должностей пока нет" body="Сначала создайте должность в этом отделе. После этого здесь появятся переходы к карточке должности и назначению людей." />
                    )}
                  </div>
                  <div className="detail-card">
                    <h4>Редактирование отдела</h4>
                    <div className="grid two">
                      <Field label="Название отдела"><input className="text-input" value={departmentDraft.name} onChange={(event) => setDepartmentDraft({ ...departmentDraft, name: event.target.value })} /></Field>
                      <Field label="Короткое имя"><input className="text-input" value={departmentDraft.short_name} onChange={(event) => setDepartmentDraft({ ...departmentDraft, short_name: event.target.value })} /></Field>
                    </div>
                    <div className="grid two">
                      <Field label="Тип отдела"><select className="select-input" value={departmentDraft.department_type_id ?? "department"} onChange={(event) => setDepartmentDraft({ ...departmentDraft, department_type_id: event.target.value })}>{DEPARTMENT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></Field>
                      <Field label="Родительский отдел"><select className="select-input" value={departmentDraft.parent_department_id ?? ""} onChange={(event) => setDepartmentDraft({ ...departmentDraft, parent_department_id: event.target.value || null })}><option value="">Без родителя</option>{mergeLookupOptionsWithCurrent(snapshot.departments, [departmentDraft.parent_department_id]).filter((item) => item.id !== departmentDraft.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                    </div>
                    <div className="grid two">
                      <Field label="Порядок"><input className="text-input" type="number" value={departmentDraft.sort_order} onChange={(event) => setDepartmentDraft({ ...departmentDraft, sort_order: Number(event.target.value) || 0 })} /></Field>
                      <Field label="Показывать новичкам"><select className="select-input" value={departmentDraft.onboarding_visible_flag ? "yes" : "no"} onChange={(event) => setDepartmentDraft({ ...departmentDraft, onboarding_visible_flag: event.target.value === "yes" })}><option value="yes">Да</option><option value="no">Нет</option></select></Field>
                    </div>
                    <Field label="Теги через запятую"><input className="text-input" value={departmentDraft.tags.join(", ")} onChange={(event) => setDepartmentDraft({ ...departmentDraft, tags: splitCsv(event.target.value) })} /></Field>
                    <div className="grid two">
                      <Field label="Описание для команды" help="Это внутреннее описание видят кураторы и админы."><textarea className="text-area" value={departmentInternalDraft} onChange={(event) => setDepartmentInternalDraft(event.target.value)} /></Field>
                      <Field label="Описание для новичков" help="Этот текст можно использовать в onboarding-режиме и вводных материалах."><textarea className="text-area" value={departmentOnboardingDraft} onChange={(event) => setDepartmentOnboardingDraft(event.target.value)} /></Field>
                    </div>
                  </div>
                </>
              ) : null
            )
          ) : (
            <>
              <div className="detail-card card-shell">
                <div className="card-header-row">
                  <div className="card-header-main">
                    <h4>Все назначения структуры</h4>
                    <div className="muted">Когда отдел не выбран, здесь показывается общая картина по всем назначениям, замещениям и временным полномочиям.</div>
                  </div>
                </div>
                <div className="stat-grid">
                  <StatCard label="Активные назначения" value={allActiveAssignments.length} note={formatSimpleCount(allActiveAssignments.length, "назначение", "назначений")} />
                  <StatCard label="Замещения" value={allSubstitutions.length} note={formatSimpleCount(allSubstitutions.length, "замещение", "замещений")} />
                  <StatCard label="Временные полномочия" value={allTemporaryAssignments.length} note={formatSimpleCount(allTemporaryAssignments.length, "полномочие", "полномочий")} />
                </div>
                <div className="details-grid">
                  <div className="detail-card">
                    <h4>Активные назначения</h4>
                    <div className="list compact-list">
                      {allActiveAssignments.length ? allActiveAssignments.map((assignment) => (
                        <div key={assignment.id} className="list-item subdued">
                          <div className="row spread">
                            <div>
                              <strong>{getPositionName(assignment.position_id)}</strong>
                              <div className="muted">
                                {getParticipantName(assignment.participant_id)}
                                {" • "}
                                {translateCode(assignment.assignment_kind)}
                              </div>
                            </div>
                            <Button className="ghost" onClick={() => onOpenParticipant(assignment.participant_id)}>Открыть участника</Button>
                          </div>
                        </div>
                      )) : <EmptyState title="Назначений пока нет" body="Выберите отдел слева и откройте нужную карточку, чтобы назначить человека на должность." />}
                    </div>
                  </div>
                  <div className="detail-card">
                    <h4>Замещения и временное исполнение</h4>
                    <div className="list compact-list">
                      {allSubstitutions.map((item) => (
                        <div key={item.id} className="list-item subdued">
                          <strong>{item.reason}</strong>
                          <div className="muted">
                            {getPositionName(item.source_position_id)}
                            {" → "}
                            {getParticipantName(item.substitute_participant_id)}
                          </div>
                        </div>
                      ))}
                      {allTemporaryAssignments.map((item) => (
                        <div key={item.id} className="list-item subdued">
                          <strong>{item.reason}</strong>
                          <div className="muted">
                            {getParticipantName(item.participant_id)}
                            {" • "}
                            {getTemporaryTargetLabel(item)}
                          </div>
                        </div>
                      ))}
                      {!allSubstitutions.length && !allTemporaryAssignments.length ? <EmptyState title="Временных назначений нет" body="Здесь появятся все замещения и временные полномочия по структуре." /> : null}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>
      </ScrollRegion>

      <ScrollRegion scrollKey="structure:actions">
      <div className="section-stack">
      <Panel
        title={selectedDepartment ? "Карточка отдела" : "Обзор структуры"}
        subtitle={
          !selectedDepartment
            ? "Когда отдел не выбран, справа показывается только краткая сводка по всей структуре."
            : structureMode === "view"
              ? (selectedPosition ? "Справа остается обзор отдела и быстрые действия. Сведения о должности открываются в центре." : "Справа показывается обзор отдела и быстрые действия.")
              : "Во время редактирования справа остаются статус и действия, а основная форма открыта в центре."
        }
        actions={
          <div className="row">
            <Chip tone={structureMode === "view" ? undefined : "warning"}>{structureMode === "view" ? "Просмотр" : "Редактирование"}</Chip>
            {selectedDepartment && structureMode === "view" ? (
              <Button className="primary" onClick={beginStructureEditing} disabled={isSaving}>
                {selectedPosition ? "Редактировать должность" : "Редактировать отдел"}
              </Button>
            ) : null}
            {selectedDepartment && structureMode !== "view" ? <Button className="secondary" onClick={cancelStructureEditing} disabled={isSaving}>Отменить</Button> : null}
            {selectedDepartment && structureMode !== "view" ? <Button className="primary" onClick={() => void saveStructureOverview()} disabled={isSaving}>{isSaving ? "Сохраняем..." : "Сохранить"}</Button> : null}
            {selectedDepartment && structureMode !== "view" && selectedPosition ? (
              <Button className="danger" onClick={() => setPendingDeleteTarget("position")} disabled={isSaving}>
                Удалить должность
              </Button>
            ) : null}
            {selectedDepartment && structureMode !== "view" && !selectedPosition ? (
              <Button className="danger" onClick={() => setPendingDeleteTarget("department")} disabled={isSaving}>
                Удалить отдел
              </Button>
            ) : null}
            {selectedPosition ? <Button className="secondary utility" onClick={() => { setSelectedPositionId(""); setStructureMode("view"); setStructureNotice(null); }}>К обзору отдела</Button> : null}
            {showAdvancedMode ? <Button className="secondary utility" onClick={() => setShowRawEditor((value) => !value)}>{showRawEditor ? "Скрыть исходные данные" : "Показать исходные данные"}</Button> : null}
          </div>
        }
      >
        <div className="section-stack">
          {isSaving ? <div className="notice-banner"><strong>Сохраняем...</strong><div>Изменения структуры записываются. Повторно нажимать кнопку не нужно.</div></div> : null}
          {!isSaving && structureNotice ? <div className="detail-card card-shell"><div className="card-header-row"><div className="chip-group"><Chip tone={structureNotice.tone}>{structureNotice.tone === "success" ? "Готово" : structureNotice.tone === "warning" ? "Нужно проверить" : "Ошибка"}</Chip></div><div className="card-copy"><div className="muted">{structureNotice.text}</div></div></div></div> : null}
          {!selectedDepartment ? (
            <>
              <div className="detail-card card-shell">
                <h4>Структура пока без выбранного отдела</h4>
                <div className="muted">Выберите отдел слева, чтобы открыть его карточку, посмотреть должности и при необходимости перейти к редактированию.</div>
              </div>
              <div className="detail-card">
                <h4>Состояние структуры</h4>
                <div className="summary-key-list">
                  <div className="compact-row"><strong>Активные назначения</strong><span className="muted">{formatSimpleCount(allActiveAssignments.length, "назначение", "назначений")}</span></div>
                  <div className="compact-row"><strong>Замещения</strong><span className="muted">{formatSimpleCount(allSubstitutions.length, "замещение", "замещений")}</span></div>
                  <div className="compact-row"><strong>Временные полномочия</strong><span className="muted">{formatSimpleCount(allTemporaryAssignments.length, "полномочие", "полномочий")}</span></div>
                </div>
              </div>
            </>
          ) : structureMode === "view" ? (
            <>
              {selectedPosition ? (
                <div className="detail-card card-shell">
                  <div className="card-header-row">
                    <div className="card-header-main">
                      <h4>Открыта должность</h4>
                      <div className="muted">{showAdvancedMode && selectedPosition.short_label && selectedPosition.short_label !== selectedPosition.name ? `${selectedPosition.name} • ${selectedPosition.short_label}` : selectedPosition.name}</div>
                    </div>
                    <div className="chip-group">
                      <Chip>{POSITION_TYPE_OPTIONS.find((item) => item.id === (selectedPosition.position_type_id ?? "worker"))?.label ?? "Рабочая должность"}</Chip>
                    </div>
                  </div>
                  <div className="muted">Подробная карточка должности находится в центре. Справа остается обзор отдела и быстрые действия.</div>
                </div>
              ) : null}
              <div className="detail-card card-shell">
                <div className="card-header-row">
                  <div className="card-header-main">
                    <h4>{selectedDepartment.name}</h4>
                    <div className="muted">{DEPARTMENT_TYPE_OPTIONS.find((item) => item.id === (selectedDepartment.department_type_id ?? "department"))?.label ?? "Основной отдел"} • {selectedDepartment.onboarding_visible_flag ? "видно новичкам" : "только для команды"}</div>
                  </div>
                  <div className="chip-group">
                    {selectedDepartment.tags.slice(0, 3).map((tag) => <Chip key={tag}>{tag}</Chip>)}
                  </div>
                </div>
                <div className="card-section">
                  <div className="compact-row"><strong>Короткое имя</strong><span className="muted">{selectedDepartment.short_name || "не указано"}</span></div>
                  <div className="compact-row"><strong>Родительский отдел</strong><span className="muted">{selectedDepartment.parent_department_id ? getDepartmentName(selectedDepartment.parent_department_id) : "не указан"}</span></div>
                  <div className="compact-row"><strong>Описание для команды</strong><span className="muted">{departmentProfile?.description_internal || "Описание пока не заполнено."}</span></div>
                  <div className="compact-row"><strong>Описание для новичков</strong><span className="muted">{departmentProfile?.description_onboarding || "Описание пока не заполнено."}</span></div>
                </div>
              </div>
            </>
          ) : (
            <div className="detail-card card-shell">
              <h4>{selectedPosition ? "Редактирование выбранной должности идет в центре" : "Редактирование отдела идет в центре"}</h4>
              <div className="muted">
                {selectedPosition
                  ? "Основная форма назначения на выбранную должность находится в центральной колонке. Справа остаются только статус, сохранение и краткая сводка."
                  : "Основная форма отдела и создание новой должности находятся в центральной колонке. Справа остаются только статус, сохранение и краткая сводка."}
              </div>
              {selectedPosition ? (
                <div className="summary-key-list">
                  <div className="compact-row"><strong>Должность</strong><span className="muted">{selectedPosition.name}</span></div>
                  <div className="compact-row"><strong>Отдел</strong><span className="muted">{getDepartmentName(selectedPosition.department_id)}</span></div>
                  <div className="compact-row"><strong>Тип</strong><span className="muted">{getPositionTypeLabel(selectedPosition.position_type_id)}</span></div>
                </div>
              ) : selectedDepartment ? (
                <div className="summary-key-list">
                  <div className="compact-row"><strong>Отдел</strong><span className="muted">{selectedDepartment.name}</span></div>
                  <div className="compact-row"><strong>Короткое имя</strong><span className="muted">{selectedDepartment.short_name || "не указано"}</span></div>
                  <div className="compact-row"><strong>Видимость</strong><span className="muted">{selectedDepartment.onboarding_visible_flag ? "видно новичкам" : "только для команды"}</span></div>
                </div>
              ) : null}
            </div>
          )}
          {showAdvancedMode && showRawEditor ? (
            <div className="detail-card">
              <div className="row" style={{ marginBottom: 12 }}>
                <select className="select-input" value={editorKey} onChange={(event) => setEditorKey(event.target.value as StructureEditorKey)}>
                  {structureEditorOptions.map((option) => <option key={option} value={option}>{translateStructureEditorKey(option)}</option>)}
                </select>
                <Button className="primary" onClick={() => void saveStructureFile()} disabled={isSaving}>{isSaving ? "Сохраняем..." : "Сохранить исходные данные"}</Button>
              </div>
              <textarea className="text-area json-box" value={jsonValue} onChange={(event) => setJsonValue(event.target.value)} />
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel title={selectedDepartment ? "Состояние раздела" : "Состояние структуры"} subtitle={selectedDepartment ? "Справа остаются только краткая сводка и служебное состояние выбранного отдела." : "Справа показана краткая сводка по всей структуре без выбранного отдела."}>
        <div className="section-stack">
          <div className="detail-card">
            <h4>{selectedDepartment ? "Состояние раздела" : "Состояние структуры"}</h4>
            <div className="summary-key-list">
              <div className="compact-row"><strong>Активные назначения</strong><span className="muted">{formatSimpleCount(selectedDepartment ? assignments.length : allActiveAssignments.length, "назначение", "назначений")}</span></div>
              <div className="compact-row"><strong>Замещения</strong><span className="muted">{formatSimpleCount(selectedDepartment ? substitutions.length : allSubstitutions.length, "замещение", "замещений")}</span></div>
              <div className="compact-row"><strong>Временные полномочия</strong><span className="muted">{formatSimpleCount(selectedDepartment ? temporaryAssignments.length : allTemporaryAssignments.length, "полномочие", "полномочий")}</span></div>
            </div>
            <div className="chip-group" style={{ marginTop: 12 }}>
              <Chip tone={dirty ? "warning" : "success"}>{dirty ? "Локальные правки не сохранены" : "Файл синхронизирован"}</Chip>
              {showAdvancedMode ? <Chip>{translateStructureEditorKey(editorKey)}</Chip> : null}
            </div>
            <div className="muted" style={{ marginTop: 12 }}>
              {selectedDepartment
                ? "Основная работа с должностями, назначениями и замещениями ведется в центральной колонке."
                : "Выберите отдел слева, чтобы перейти от общего обзора структуры к конкретной карточке отдела."}
            </div>
          </div>
        </div>
      </Panel>
      </div>
      </ScrollRegion>
    </div>
    {pendingDeleteTarget === "department" && selectedDepartment ? (
      <AppConfirmModal
        sectionLabel="Структура"
        title={`Удалить отдел «${selectedDepartment.name}»?`}
        message="Будут удалены связанные должности, профили отдела, назначения, замещения, временные полномочия, контакты и заметки этого отдела."
        confirmLabel="Удалить отдел"
        confirmTone="danger"
        onConfirm={() => {
          setPendingDeleteTarget(null);
          void deleteSelectedDepartment();
        }}
        onCancel={() => setPendingDeleteTarget(null)}
      />
    ) : null}
    {pendingDeleteTarget === "position" && selectedPosition ? (
      <AppConfirmModal
        sectionLabel="Структура"
        title={`Удалить должность «${selectedPosition.name}»?`}
        message="Будут удалены связанные назначения, замещения, временные полномочия, контакты и заметки по этой должности."
        confirmLabel="Удалить должность"
        confirmTone="danger"
        onConfirm={() => {
          setPendingDeleteTarget(null);
          void deleteSelectedPosition();
        }}
        onCancel={() => setPendingDeleteTarget(null)}
      />
    ) : null}
    </>
  );
}

function CompositionScreen({
  snapshot,
  onRefresh,
  actorName,
  selectedParticipantId,
  onDirtyChange,
  onOpenRelease,
  onNavigate,
  restoredLocalDraft,
  onRestoredLocalDraftApplied,
  showAdvancedMode
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  selectedParticipantId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenRelease: (id: string) => void;
  onNavigate: (section: NavigationSection) => void;
  restoredLocalDraft: LocalUnsavedDraftFile | null;
  onRestoredLocalDraftApplied: () => void;
  showAdvancedMode: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [equipmentOnly, setEquipmentOnly] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [warningOnly, setWarningOnly] = useState(false);
  const [remarkOnly, setRemarkOnly] = useState(false);
  const [reliableOnly, setReliableOnly] = useState(false);
  const [keyOnly, setKeyOnly] = useState(false);
  const [oldReleaseOnly, setOldReleaseOnly] = useState(false);
  const [registrySort, setRegistrySort] = useState<ParticipantRegistrySort>("alphabet");
  const [registryView, setRegistryView] = useState<"list" | "cards">("list");
  const [viewPreset, setViewPreset] = useState<"all" | "problem" | "top" | "archive" | "inactive" | "reliable">("all");
  const [selectedId, setSelectedId] = useState(selectedParticipantId ?? snapshot.participants[0]?.profile.id ?? "");
  const [activeTab, setActiveTab] = useState("overview");
  const [screenMode, setScreenMode] = useState<"view" | "edit" | "create">("view");
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [draftDirty, setDraftDirty] = useState(false);
  const [restoredDraftActive, setRestoredDraftActive] = useState(false);
  const [participantNotice, setParticipantNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [pendingDeleteParticipant, setPendingDeleteParticipant] = useState(false);
  const [draft, setDraft] = useState<ParticipantAggregate | null>(snapshot.participants[0] ? cloneJson(snapshot.participants[0]) : null);
  const [releaseLinkTargetId, setReleaseLinkTargetId] = useState(
    snapshot.releases.find((item) => !isReleaseArchivedEntity(item.release))?.release.id
    ?? snapshot.releases[0]?.release.id
    ?? ""
  );
  const [releaseLinkRoleId, setReleaseLinkRoleId] = useState(
    filterVisibleLookupRecords(snapshot.directories.participant_roles ?? [])[0]?.id
    ?? snapshot.directories.participant_roles?.[0]?.id
    ?? "voice_cast"
  );
  const [pendingDepartmentAssignment, setPendingDepartmentAssignment] = useState<{
    department_id: string;
    assignment_status: string;
    primary_flag: boolean;
    comment: string;
  } | null>(null);
  const [pendingRoleAssignment, setPendingRoleAssignment] = useState<{
    role_id: string;
    note: string;
    level: string;
    active: boolean;
  } | null>(null);
  const [pendingStructureAssignment, setPendingStructureAssignment] = useState<{
    department_id: string;
    position_id: string;
    assignment_kind: PositionAssignment["assignment_kind"];
  } | null>(null);
  const [isStructureAssignmentSaving, setIsStructureAssignmentSaving] = useState(false);
  const [editingDepartmentAssignmentIndex, setEditingDepartmentAssignmentIndex] = useState<number | null>(null);
  const [editingRoleAssignmentIndex, setEditingRoleAssignmentIndex] = useState<number | null>(null);
  const [editingDisciplineId, setEditingDisciplineId] = useState<string | null>(null);
  const [editingRewardId, setEditingRewardId] = useState<string | null>(null);
  const [participantPointerDrag, setParticipantPointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragParticipantId, setDragParticipantId] = useState<string | null>(null);
  const [dragTargetParticipantId, setDragTargetParticipantId] = useState<string | null>(null);
  const [participantDragPreviewIds, setParticipantDragPreviewIds] = useState<string[] | null>(null);
  const [participantCommittedOrderIds, setParticipantCommittedOrderIds] = useState<string[] | null>(null);
  const participantDragBaseIdsRef = useRef<string[] | null>(null);
  const suppressParticipantClickRef = useRef(false);
  const participantLinksById = useMemo(() => buildParticipantReleaseLinkIndex(snapshot.releases), [snapshot.releases]);
  const participantViews = useMemo(() => buildParticipantViews(snapshot, participantLinksById), [snapshot, participantLinksById]);
  const activeDepartments = useMemo(() => filterVisibleLookupRecords(snapshot.departments), [snapshot.departments]);
  const participantStatusOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.participant_statuses ?? []), [snapshot.directories.participant_statuses]);
  const roleOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.participant_roles ?? []), [snapshot.directories.participant_roles]);
  const skillOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.skills ?? []), [snapshot.directories.skills]);
  const disciplineTypeOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.disciplinary_types ?? []), [snapshot.directories.disciplinary_types]);
  const rewardTypeOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.reward_types ?? []), [snapshot.directories.reward_types]);
  const releaseLinkOptions = useMemo(
    () => mergeReleaseOptionsWithCurrent(snapshot.releases, [releaseLinkTargetId]),
    [releaseLinkTargetId, snapshot.releases]
  );
  const departmentNameById = useMemo(() => new Map(snapshot.departments.map((item) => [item.id, item.name])), [snapshot.departments]);
  const structurePositionNameById = useMemo(() => new Map(snapshot.structurePositions.map((item) => [item.id, item.name])), [snapshot.structurePositions]);
  const structurePositionById = useMemo(() => new Map(snapshot.structurePositions.map((item) => [item.id, item])), [snapshot.structurePositions]);
  const roleNameById = useMemo(() => new Map(roleOptions.map((item) => [item.id, item.name])), [roleOptions]);
  const disciplineTypeNameById = useMemo(() => new Map(disciplineTypeOptions.map((item) => [item.id, item.name])), [disciplineTypeOptions]);
  const rewardTypeNameById = useMemo(() => new Map(rewardTypeOptions.map((item) => [item.id, item.name])), [rewardTypeOptions]);
  const participantById = useMemo(
    () => new Map(snapshot.participants.map((item) => [item.profile.id, item])),
    [snapshot.participants]
  );
  const skillNameById = useMemo(() => new Map(skillOptions.map((item) => [item.id, item.name])), [skillOptions]);
  const participantSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const item of participantViews) {
      const participant = participantById.get(item.id);
      const releaseLinks = participantLinksById.get(item.id)?.linked ?? [];
      const searchChunks: string[] = [
        item.displayName,
        item.nickname,
        item.mention ?? "",
        item.vkSlug ?? "",
        item.noteSearch
      ];

      if (participant) {
        searchChunks.push(
          participant.profile.real_name ?? "",
          participant.profile.nickname_pronunciation ?? "",
          participant.profile.availability_note ?? "",
          participant.profile.contact_max ?? "",
          participant.profile.contact_phone ?? "",
          participant.profile.contact_telegram ?? "",
          participant.profile.contact_vk ?? "",
          participant.profile.contact_email ?? "",
          participant.profile.contact_odnoklassniki ?? "",
          participant.profile.posting.mention ?? "",
          participant.profile.posting.mention_id ?? "",
          participant.profile.posting.display_name_for_post ?? "",
          participant.profile.posting.vk_slug ?? "",
          participant.profile.posting.vk_url ?? "",
          participant.profile.posting.post_copy_string ?? "",
          participant.profile.contacts.join(" ")
        );
        searchChunks.push(
          participant.org.department_assignments
            .map((entry) => `${departmentNameById.get(entry.department_id) ?? entry.department_id} ${entry.comment ?? ""}`)
            .join(" ")
        );
        searchChunks.push(
          participant.org.role_assignments
            .map((entry) => `${roleNameById.get(entry.role_id) ?? entry.role_id} ${entry.note ?? ""} ${entry.level ?? ""}`)
            .join(" ")
        );
        searchChunks.push(
          participant.org.skill_entries
            .map((entry) => `${skillNameById.get(entry.skill_id) ?? entry.skill_id} ${entry.level ?? ""} ${entry.note ?? ""}`)
            .join(" ")
        );
        searchChunks.push(
          participant.org.specialization_entries
            .map((entry) => `${entry.specialization_id} ${entry.level ?? ""} ${entry.comment ?? ""}`)
            .join(" ")
        );
        searchChunks.push(
          participant.notes.map((entry) => `${entry.title} ${entry.body}`).join(" ")
        );
        searchChunks.push(
          participant.discipline
            .map((entry) => `${disciplineTypeNameById.get(entry.disciplinary_type_id) ?? entry.disciplinary_type_id} ${entry.description ?? ""} ${entry.severity}`)
            .join(" ")
        );
        searchChunks.push(
          participant.rewards
            .map((entry) => `${rewardTypeNameById.get(entry.reward_type_id) ?? entry.reward_type_id} ${entry.description ?? ""} ${entry.tags.join(" ")}`)
            .join(" ")
        );
        searchChunks.push(
          [
            participant.equipment.equipment_status,
            participant.equipment.microphone_type,
            participant.equipment.audio_interface,
            participant.equipment.recording_space_quality,
            participant.equipment.monitoring,
            participant.equipment.software_stack,
            participant.equipment.hardware_notes,
            participant.equipment.equipment_limitations,
            participant.equipment.noise_issues,
            participant.equipment.remote_recording_constraints,
            participant.voice_sample.voice_sample_url,
            participant.voice_sample.voice_sample_storage_ref,
            participant.voice_sample.voice_sample_comment,
            participant.voice_sample.voice_tags.join(" ")
          ].join(" ")
        );
      }

      searchChunks.push(
        releaseLinks
          .map((release) => [release.release.title_primary, release.release.title_secondary, release.release.short_title].filter(Boolean).join(" "))
          .join(" ")
      );

      index.set(item.id, searchChunks.join(" ").toLowerCase());
    }
    return index;
  }, [
    departmentNameById,
    disciplineTypeNameById,
    participantById,
    participantLinksById,
    participantViews,
    rewardTypeNameById,
    roleNameById,
    skillNameById
  ]);
  const roleLevelOptions = useMemo(() => {
    const options = [...PARTICIPANT_ROLE_LEVEL_OPTIONS];
    const seen = new Set(options.map((item) => item.id));
    const currentLevels = [
      pendingRoleAssignment?.level,
      ...(draft?.org.role_assignments ?? []).map((item) => item.level)
    ];
    currentLevels.forEach((value) => {
      const trimmed = normalizeParticipantRoleLevel(value) ?? "";
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ id: trimmed, label: trimmed });
    });
    return options;
  }, [draft?.org.role_assignments, pendingRoleAssignment?.level]);
  const sourceParticipant = participantById.get(selectedId) ?? null;
  const currentParticipant = screenMode === "view" ? sourceParticipant : draft;
  const showTechnicalInfo = showAdvancedMode;
  const dirty = screenMode !== "view" && draft ? (screenMode === "create" ? true : draftDirty) : false;
  const detailMode = detailExpanded || screenMode !== "view";

  useEffect(() => {
    const next = participantById.get(selectedId) ?? null;
    if (screenMode === "create") {
      if (draft?.profile.id === selectedId) {
        return;
      }
      if (next) {
        setDraft(cloneJson(next));
        setDraftDirty(false);
        setEditingDisciplineId(null);
        setEditingRewardId(null);
      }
      return;
    }
    if (!next) {
      const fallback = snapshot.participants.find((item) => !isParticipantArchivedEntity(item)) ?? snapshot.participants[0] ?? null;
      if (fallback) {
        setSelectedId(fallback.profile.id);
        if (screenMode !== "view") {
          setDraft(cloneJson(fallback));
          setDraftDirty(false);
          setEditingDisciplineId(null);
          setEditingRewardId(null);
        }
      } else {
        setDraft(null);
        setDraftDirty(false);
        setEditingDisciplineId(null);
        setEditingRewardId(null);
      }
      return;
    }
    if (screenMode !== "view") {
      if (restoredDraftActive && draft?.profile.id === next.profile.id) {
        return;
      }
      if (!draft || draft.profile.id !== next.profile.id || draft.profile.record_revision !== next.profile.record_revision) {
        setDraft(cloneJson(next));
        setDraftDirty(false);
        setEditingDisciplineId(null);
        setEditingRewardId(null);
      }
    }
    setParticipantNotice(null);
  }, [selectedId, participantById, screenMode, snapshot.participants, draft, restoredDraftActive]);

  useEffect(() => {
    if (selectedParticipantId) {
      setSelectedId(selectedParticipantId);
      setRestoredDraftActive(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setParticipantNotice(null);
      setPendingStructureAssignment(null);
      setPendingDepartmentAssignment(null);
      setPendingRoleAssignment(null);
      setEditingDisciplineId(null);
      setEditingRewardId(null);
    }
  }, [selectedParticipantId]);

  useEffect(() => {
    if (!restoredLocalDraft || restoredLocalDraft.domain !== "participant") {
      return;
    }
    const payload = cloneJson(restoredLocalDraft.payload) as ParticipantAggregate;
    const participantId = payload.profile?.id ?? restoredLocalDraft.entity_id;
    setSelectedId(participantId);
    setDraft(payload);
    setDraftDirty(true);
    setActiveTab("overview");
    setRestoredDraftActive(true);
    setScreenMode(participantById.has(participantId) ? "edit" : "create");
    setDetailExpanded(true);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
    setParticipantNotice({
      tone: "warning",
      text: `Открыт локальный черновик участника от ${formatDate(restoredLocalDraft.saved_at)}. Проверьте правки и сохраните запись вручную.`
    });
    onRestoredLocalDraftApplied();
  }, [onRestoredLocalDraftApplied, participantById, restoredLocalDraft]);

  useEffect(() => {
    onDirtyChange(Boolean(dirty));
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (screenMode !== "view") {
      setDetailExpanded(true);
    }
  }, [screenMode]);

  const filtered = useMemo(() => participantViews.filter((item) => {
    const needle = search.trim().toLowerCase();
    if (needle && !(participantSearchIndex.get(item.id) ?? `${item.displayName} ${item.nickname} ${item.mention ?? ""} ${item.vkSlug ?? ""} ${item.noteSearch}`.toLowerCase()).includes(needle)) return false;
    const archiveViewActive =
      viewPreset === "archive"
      || statusFilter === "archived"
      || statusFilter === "blocked"
      || statusFilter === "left";
    if (!archiveViewActive && item.archived) return false;
    if (statusFilter === "archived" && !item.archived) return false;
    if (statusFilter !== "all" && statusFilter !== "archived" && item.status !== statusFilter) return false;
    if (departmentFilter !== "all" && !item.departmentIds.includes(departmentFilter)) return false;
    if (roleFilter !== "all" && !item.roleIds.includes(roleFilter)) return false;
    if (activityFilter !== "all" && item.activityLevel !== activityFilter) return false;
    if (disciplineFilter === "warning" && item.warningCount === 0) return false;
    if (disciplineFilter === "remark" && item.remarkCount === 0) return false;
    if (disciplineFilter === "blacklist" && item.blacklistCount === 0) return false;
    if (disciplineFilter === "clean" && item.activeDisciplineCount > 0) return false;
    if (voiceOnly && !item.hasVoiceSample) return false;
    if (equipmentOnly && !item.hasEquipment) return false;
    if (topOnly && !item.topReleaseFit) return false;
    if (commercialOnly && !item.commercialFit) return false;
    if (warningOnly && item.warningCount === 0) return false;
    if (remarkOnly && item.remarkCount === 0) return false;
    if (reliableOnly && !item.reliable) return false;
    if (keyOnly && !item.keyMember) return false;
    if (oldReleaseOnly && !item.oldReleaseLoad) return false;
    return true;
  }), [
    participantViews,
    search,
    statusFilter,
    departmentFilter,
    roleFilter,
    activityFilter,
    disciplineFilter,
    voiceOnly,
    equipmentOnly,
    topOnly,
    commercialOnly,
    warningOnly,
    remarkOnly,
    reliableOnly,
    keyOnly,
    oldReleaseOnly
  , participantSearchIndex]);

  const sortedFiltered = useMemo(() => {
    const statusOrder: Record<string, number> = {
      active: 0,
      reserve: 1,
      inactive: 2,
      blocked: 3,
      left: 4,
      archived: 5
    };
    const activityOrder: Record<string, number> = {
      "в работе": 0,
      "умеренный": 1,
      "резерв": 2,
      "низкий": 3
    };
    const reliabilityOrder: Record<string, number> = {
      "высокий": 0,
      "нормальный": 1,
      "риск": 2
    };

    const getPrimaryDepartmentLabel = (item: ParticipantView) =>
      [...item.departmentIds]
        .map((departmentId) => departmentNameById.get(departmentId) ?? departmentId)
        .sort((left, right) => left.localeCompare(right, "ru"))[0]
      ?? "Без отдела";

    const getPrimaryRoleLabel = (item: ParticipantView) =>
      [...item.roleIds]
        .map((roleId) => roleNameById.get(roleId) ?? roleId)
        .sort((left, right) => left.localeCompare(right, "ru"))[0]
      ?? "Без роли";

    return [...filtered].sort((left, right) => {
      switch (registrySort) {
        case "manual": {
          const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          break;
        }
        case "department": {
          const departmentCompare = getPrimaryDepartmentLabel(left).localeCompare(getPrimaryDepartmentLabel(right), "ru");
          if (departmentCompare !== 0) {
            return departmentCompare;
          }
          break;
        }
        case "role": {
          const roleCompare = getPrimaryRoleLabel(left).localeCompare(getPrimaryRoleLabel(right), "ru");
          if (roleCompare !== 0) {
            return roleCompare;
          }
          break;
        }
        case "status": {
          const statusCompare =
            (statusOrder[left.status] ?? Number.MAX_SAFE_INTEGER) - (statusOrder[right.status] ?? Number.MAX_SAFE_INTEGER);
          if (statusCompare !== 0) {
            return statusCompare;
          }
          break;
        }
        case "activity": {
          const activityCompare =
            (activityOrder[left.activityLevel] ?? Number.MAX_SAFE_INTEGER) - (activityOrder[right.activityLevel] ?? Number.MAX_SAFE_INTEGER);
          if (activityCompare !== 0) {
            return activityCompare;
          }
          break;
        }
        case "reliability": {
          const reliabilityCompare =
            (reliabilityOrder[left.reliabilityLevel] ?? Number.MAX_SAFE_INTEGER) - (reliabilityOrder[right.reliabilityLevel] ?? Number.MAX_SAFE_INTEGER);
          if (reliabilityCompare !== 0) {
            return reliabilityCompare;
          }
          break;
        }
        case "problems": {
          const leftProblems = left.activeDisciplineCount + left.warningCount + left.remarkCount + left.blacklistCount;
          const rightProblems = right.activeDisciplineCount + right.warningCount + right.remarkCount + right.blacklistCount;
          if (leftProblems !== rightProblems) {
            return rightProblems - leftProblems;
          }
          break;
        }
        case "notes": {
          if (left.noteCount !== right.noteCount) {
            return right.noteCount - left.noteCount;
          }
          break;
        }
        case "alphabet":
        default:
          break;
      }

      const leftName = left.displayName || left.nickname || left.id;
      const rightName = right.displayName || right.nickname || right.id;
      return leftName.localeCompare(rightName, "ru");
    });
  }, [departmentNameById, filtered, registrySort, roleNameById]);

  const orderedFiltered = useMemo(() => {
    if (registrySort !== "manual") {
      return sortedFiltered;
    }
    const activeOrderIds = participantDragPreviewIds?.length ? participantDragPreviewIds : participantCommittedOrderIds;
    if (!activeOrderIds?.length) {
      return sortedFiltered;
    }
    const orderMap = new Map(activeOrderIds.map((id, index) => [id, index]));
    return [...sortedFiltered].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [participantCommittedOrderIds, participantDragPreviewIds, registrySort, sortedFiltered]);

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setRoleFilter("all");
    setActivityFilter("all");
    setDisciplineFilter("all");
    setVoiceOnly(false);
    setEquipmentOnly(false);
    setTopOnly(false);
    setCommercialOnly(false);
    setWarningOnly(false);
    setRemarkOnly(false);
    setReliableOnly(false);
    setKeyOnly(false);
    setOldReleaseOnly(false);
    setViewPreset("all");
  }

  function applyParticipantPreset(preset: typeof viewPreset) {
    setViewPreset(preset);
    if (preset === "archive") {
      setSearch("");
      setDepartmentFilter("all");
      setRoleFilter("all");
      setDisciplineFilter("all");
      setVoiceOnly(false);
      setEquipmentOnly(false);
      setCommercialOnly(false);
      setKeyOnly(false);
      setOldReleaseOnly(false);
      const hasArchived = participantViews.some((item) => item.archived);
      setSelectedId("");
      setDetailExpanded(false);
      if (hasArchived) {
        setParticipantNotice({ tone: "success", text: "Открыт архив участников." });
      } else {
        setParticipantNotice({ tone: "warning", text: "В архиве участников пока нет записей." });
      }
    }
    setStatusFilter(preset === "archive" ? "archived" : "all");
    setActivityFilter(preset === "inactive" ? "низкий" : "all");
    setWarningOnly(preset === "problem");
    setRemarkOnly(preset === "problem");
    setReliableOnly(preset === "reliable");
    setTopOnly(preset === "top");
    if (preset !== "top") {
      setCommercialOnly(false);
    }
    if (preset !== "problem") {
      setWarningOnly(false);
      setRemarkOnly(false);
    }
    if (preset !== "reliable") {
      setReliableOnly(false);
    }
  }

  function updateDraft(mutator: (value: ParticipantAggregate) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneJson(current);
      mutator(next);
      applyParticipantDerivedFields(next);
      return next;
    });
    setDraftDirty(true);
  }

  function enterEditModeWith(mutator?: (value: ParticipantAggregate) => void, nextTab?: string) {
    const base = draft ?? sourceParticipant;
    if (!base) return;
    const next = cloneJson(base);
    if (mutator) {
      mutator(next);
      applyParticipantDerivedFields(next);
    }
    setDraft(next);
    setDraftDirty(Boolean(mutator) || dirty || !sourceParticipant);
    setScreenMode(sourceParticipant && base.profile.id === sourceParticipant.profile.id ? "edit" : "create");
    setDetailExpanded(true);
    if (nextTab) setActiveTab(nextTab);
  }

  async function saveDraft() {
    if (!draft) return;
    setIsSaving(true);
    setSaveState("saving");
    try {
      const next = cloneJson(draft);
      const normalizedStatus = normalizeParticipantStatusId(next.profile.participant_status_id, next.profile.reserve_flag);
      const legacyLeftRequested = normalizedStatus === "active" && Boolean(next.profile.left_at);
      const archivedRequested =
        next.profile.status === "archived"
        || normalizedStatus === "archived"
        || normalizedStatus === "blocked"
        || normalizedStatus === "left"
        || legacyLeftRequested;
      const leftRequested = normalizedStatus === "left" || legacyLeftRequested;
      next.profile.status = archivedRequested ? "archived" : "active";
      next.profile.participant_status_id = normalizedStatus;
      next.profile.reserve_flag = normalizedStatus === "reserve";
      next.profile.archived_at = archivedRequested
        ? (next.profile.archived_at ?? new Date().toISOString())
        : null;
      next.profile.left_at = archivedRequested || leftRequested
        ? (next.profile.left_at ?? new Date().toISOString())
        : null;
      normalizeParticipantAggregateDraft(next);
      const archivedAfterSave = next.profile.status === "archived";
      const fallbackParticipantId = filtered.find((item) => item.id !== next.profile.id && !item.archived)?.id ?? "";
      await window.fronda.saveParticipant(next, actorName);
      startTransition(() => {
        setSelectedId(archivedAfterSave ? fallbackParticipantId : next.profile.id);
        setActiveTab("overview");
        setScreenMode("view");
        setDetailExpanded(!archivedAfterSave);
        if (archivedAfterSave) {
          applyParticipantPreset("all");
        }
        setParticipantNotice({ tone: "success", text: archivedAfterSave ? "Карточка участника сохранена в архив и скрыта из общего состава." : "Карточка участника сохранена. Открыт обычный обзор." });
        setRestoredDraftActive(false);
        setDraftDirty(false);
        setEditingDisciplineId(null);
        setEditingRewardId(null);
        setSaveState("saved");
      });
      void onRefresh(false);
    } catch (error) {
      setParticipantNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить карточку участника."
      });
      setSaveState("idle");
    } finally {
      setIsSaving(false);
      window.setTimeout(() => {
        setSaveState((current) => (current === "saving" || current === "saved" ? "idle" : current));
      }, 800);
    }
  }

  function createParticipant() {
    const next = createEmptyParticipantAggregate(actorName);
    next.profile.sort_order = snapshot.participants.length + 1;
    setSelectedId(next.profile.id);
    setDraft(next);
    setDraftDirty(true);
    setActiveTab("overview");
    setScreenMode("create");
    setDetailExpanded(true);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  function addDepartmentAssignment() {
    const assignments = (draft ?? sourceParticipant)?.org.department_assignments ?? [];
    enterEditModeWith(undefined, "org");
    setPendingStructureAssignment(null);
    setPendingRoleAssignment(null);
    setPendingDepartmentAssignment({
      department_id: assignments[0]?.department_id ?? activeDepartments[0]?.id ?? snapshot.departments[0]?.id ?? "general",
      assignment_status: "participates",
      primary_flag: assignments.length === 0,
      comment: ""
    });
  }

  function addRoleAssignment() {
    enterEditModeWith(undefined, "org");
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment({
      role_id: roleOptions[0]?.id ?? "role",
      note: "",
      level: "",
      active: true
    });
  }

  function addStructureAssignment() {
    if (!currentParticipant || screenMode === "create" || !sourceParticipant) {
      setParticipantNotice({
        tone: "warning",
        text: "Сначала сохраните участника в общий состав, а потом назначайте ему структурную должность."
      });
      return;
    }
    if (!structurePositionOptions.length) {
      setParticipantNotice({
        tone: "warning",
        text: "В структуре пока нет должностей. Сначала создайте должность в разделе «Структура», после чего ее можно будет назначить участнику."
      });
      return;
    }
    const primaryDepartmentId =
      currentParticipant.org.department_assignments.find((item) => item.primary_flag)?.department_id
      ?? currentParticipant.org.department_assignments[0]?.department_id
      ?? structureDepartmentOptions[0]?.id
      ?? snapshot.departments[0]?.id
      ?? "";
    const firstPosition =
      structurePositionOptions.find((item) => item.department_id === primaryDepartmentId)
      ?? structurePositionOptions[0]
      ?? null;
    setPendingStructureAssignment({
      department_id: firstPosition?.department_id ?? primaryDepartmentId,
      position_id: firstPosition?.id ?? "",
      assignment_kind: "permanent"
    });
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setActiveTab("org");
    setDetailExpanded(true);
    setParticipantNotice(null);
  }

  function duplicateParticipant() {
    if (!draft) return;
    const next = cloneParticipantAggregateDraft(draft, actorName);
    setSelectedId(next.profile.id);
    setDraft(next);
    setDraftDirty(true);
    setActiveTab("overview");
    setScreenMode("create");
    setDetailExpanded(true);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  async function toggleArchiveParticipant() {
    const mutate = (next: ParticipantAggregate) => {
      const archived = next.profile.status === "archived";
      next.profile.status = archived ? "active" : "archived";
      next.profile.participant_status_id = archived ? "active" : "archived";
      next.profile.archived_at = archived ? null : new Date().toISOString();
      next.profile.left_at = archived ? null : new Date().toISOString();
      next.history = [
        createHistoryEntryDraft({
          actor: actorName,
          action: archived ? "restore" : "archive",
          entityType: "participant",
          entityId: next.profile.id,
          summary: archived ? "Участник восстановлен из архива" : "Участник архивирован"
        }),
        ...next.history
      ];
    };
    enterEditModeWith(mutate);
    setParticipantNotice({ tone: "warning", text: "Статус архива изменен локально. Нажмите «Сохранить участника», чтобы записать изменения в общую папку." });
  }

  async function deleteSelectedParticipant() {
    if (!sourceParticipant || screenMode !== "view") {
      return;
    }
    const participantId = sourceParticipant.profile.id;
    const fallbackParticipantId =
      participantViews.find((item) => item.id !== participantId && !item.archived)?.id
      ?? participantViews.find((item) => item.id !== participantId)?.id
      ?? "";
    setIsSaving(true);
    try {
      await window.fronda.deleteParticipant(participantId, actorName);
      startTransition(() => {
        setSelectedId(fallbackParticipantId);
        setDraft(null);
        setDraftDirty(false);
        setActiveTab("overview");
        setScreenMode("view");
        setDetailExpanded(Boolean(fallbackParticipantId));
        setPendingStructureAssignment(null);
        setPendingDepartmentAssignment(null);
        setPendingRoleAssignment(null);
        setEditingDisciplineId(null);
        setEditingRewardId(null);
        setRestoredDraftActive(false);
        setParticipantNotice({
          tone: "success",
          text: "Карточка участника удалена из общего состава."
        });
      });
      await onRefresh(false);
    } catch (error) {
      setParticipantNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось удалить карточку участника."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function addNote() {
    enterEditModeWith((next) => {
      next.notes = [createParticipantNoteDraft(next.profile.id, actorName), ...next.notes];
    }, "notes");
  }

  function addDisciplineEvent(severity: DisciplinaryEvent["severity"]) {
    const baseParticipantId = (draft ?? sourceParticipant)?.profile.id ?? createEmptyParticipantAggregate(actorName).profile.id;
    const event = createDisciplinaryEventDraft(baseParticipantId, severity, actorName);
    enterEditModeWith((next) => {
      next.discipline = [event, ...next.discipline];
    }, "discipline");
    setEditingRewardId(null);
    setEditingDisciplineId(event.id);
  }

  function addReward() {
    const baseParticipantId = (draft ?? sourceParticipant)?.profile.id ?? createEmptyParticipantAggregate(actorName).profile.id;
    const reward = createRewardEventDraft(baseParticipantId, actorName);
    enterEditModeWith((next) => {
      next.rewards = [reward, ...next.rewards];
    }, "rewards");
    setEditingDisciplineId(null);
    setEditingRewardId(reward.id);
  }

  function startEditingDiscipline(itemId: string) {
    setEditingRewardId(null);
    setEditingDisciplineId(itemId);
  }

  function saveDisciplineEditor() {
    setEditingDisciplineId(null);
  }

  function startEditingReward(itemId: string) {
    setEditingDisciplineId(null);
    setEditingRewardId(itemId);
  }

  function saveRewardEditor() {
    setEditingRewardId(null);
  }

  function enableVoiceSample() {
    enterEditModeWith((next) => {
      next.voice_sample.voice_sample_present = true;
      next.voice_sample.voice_sample_uploaded_at = next.voice_sample.voice_sample_uploaded_at ?? new Date().toISOString();
    }, "voice");
  }

  async function addReleaseLink() {
    if (!draft || !releaseLinkTargetId) return;
    const targetRelease = snapshot.releases.find((item) => item.release.id === releaseLinkTargetId);
    if (!targetRelease) return;
    const releaseDraft = cloneJson(targetRelease);
    releaseDraft.participants = [
      ...releaseDraft.participants,
      createReleaseParticipantDraft(releaseDraft.release.id, draft.profile.id, releaseLinkRoleId, releaseDraft.release.primary_department_id, actorName, releaseDraft.participants.length + 1)
    ];
    await window.fronda.saveRelease(releaseDraft, actorName);
    await onRefresh(false);
    setActiveTab("releases");
    setParticipantNotice({ tone: "success", text: "Связь с релизом сохранена." });
  }

  function confirmDepartmentAssignment() {
    if (!pendingDepartmentAssignment) return;
    updateDraft((next) => {
      next.org.department_assignments = [
        ...next.org.department_assignments,
        {
          department_id: pendingDepartmentAssignment.department_id,
          assignment_status: pendingDepartmentAssignment.assignment_status,
          started_at: new Date().toISOString(),
          ended_at: null,
          primary_flag: pendingDepartmentAssignment.primary_flag,
          comment: pendingDepartmentAssignment.comment
        }
      ];
    });
    setPendingDepartmentAssignment(null);
    setEditingDepartmentAssignmentIndex(null);
  }

  function confirmRoleAssignment() {
    if (!pendingRoleAssignment) return;
    updateDraft((next) => {
      next.org.role_assignments = [
        ...next.org.role_assignments,
        {
          role_id: pendingRoleAssignment.role_id,
          department_id: null,
          note: pendingRoleAssignment.note,
          level: pendingRoleAssignment.level,
          confirmed_by: null,
          started_at: new Date().toISOString(),
          active: pendingRoleAssignment.active
        }
      ];
    });
    setPendingRoleAssignment(null);
    setEditingRoleAssignmentIndex(null);
  }

  async function confirmStructureAssignment() {
    if (!currentParticipant || !pendingStructureAssignment?.position_id || screenMode === "create" || !sourceParticipant) {
      return;
    }
    const targetPosition = structurePositionById.get(pendingStructureAssignment.position_id);
    if (!targetPosition) {
      setParticipantNotice({ tone: "danger", text: "Не удалось найти выбранную должность в структуре." });
      return;
    }
    const departmentId = targetPosition.department_id || pendingStructureAssignment.department_id;
    const duplicate = snapshot.assignments.find((item) =>
      item.active_flag
      && item.participant_id === currentParticipant.profile.id
      && item.position_id === targetPosition.id
    );
    if (duplicate) {
      setParticipantNotice({ tone: "warning", text: "Эта должность уже назначена участнику." });
      return;
    }
    setIsStructureAssignmentSaving(true);
    try {
      const assignment = createPositionAssignmentEntry(
        departmentId,
        targetPosition.id,
        currentParticipant.profile.id,
        actorName,
        pendingStructureAssignment.assignment_kind
      );
      await window.fronda.saveStructureFile("position_assignments.json", [...snapshot.assignments, assignment], actorName);
      await onRefresh(false);
      setPendingStructureAssignment(null);
      setParticipantNotice({ tone: "success", text: "Структурная должность назначена участнику." });
    } catch (error) {
      setParticipantNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось назначить структурную должность."
      });
    } finally {
      setIsStructureAssignmentSaving(false);
    }
  }

  async function removeParticipantStructureAssignment(assignmentId: string) {
    setIsStructureAssignmentSaving(true);
    try {
      const nextAssignments = snapshot.assignments.map((item) =>
        item.id === assignmentId
          ? {
              ...item,
              active_flag: false,
              ended_at: item.ended_at ?? new Date().toISOString(),
              updated_at: new Date().toISOString(),
              updated_by: actorName
            }
          : item
      );
      await window.fronda.saveStructureFile("position_assignments.json", nextAssignments, actorName);
      await onRefresh(false);
      setParticipantNotice({ tone: "success", text: "Структурная должность снята." });
    } catch (error) {
      setParticipantNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось снять структурную должность."
      });
    } finally {
      setIsStructureAssignmentSaving(false);
    }
  }

  async function persistParticipantOrder(draggedParticipantId: string, targetParticipantId: string, orderedIds?: string[] | null) {
    if (draggedParticipantId === targetParticipantId) return;

    const ordered =
      orderedIds?.length
        ? orderedIds
            .map((id) => participantViews.find((item) => item.id === id))
            .filter((item): item is ParticipantView => Boolean(item))
        : reorderByTarget([...participantViews], draggedParticipantId, targetParticipantId);
    const nextIndex = ordered.findIndex((item) => item.id === draggedParticipantId);
    if (nextIndex < 0) return;

    const current = participantById.get(draggedParticipantId);
    if (!current) return;

    const before = ordered[nextIndex - 1];
    const after = ordered[nextIndex + 1];
    const currentOrder = ordered[nextIndex].sortOrder;
    const nextOrder =
      before && after
        ? (before.sortOrder + after.sortOrder) / 2
        : before
          ? before.sortOrder + 1
          : after
            ? after.sortOrder - 1
            : currentOrder;

    const next = cloneJson(current);
    next.profile.sort_order = nextOrder;
    normalizeParticipantAggregateDraft(next);
    setParticipantNotice({ tone: "warning", text: "Сохраняем новый порядок списка..." });
    await window.fronda.saveParticipant(next, actorName);
    setParticipantNotice({ tone: "success", text: "Порядок участников обновлен." });
    void onRefresh(false);
  }

  function beginParticipantDrag(participantId: string) {
    participantDragBaseIdsRef.current = orderedFiltered.map((item) => item.id);
    setDragParticipantId(participantId);
    setDragTargetParticipantId(participantId);
    setParticipantDragPreviewIds(participantDragBaseIdsRef.current);
  }

  function trackParticipantDropTarget(participantId: string) {
    if (!dragParticipantId || dragParticipantId === participantId || dragTargetParticipantId === participantId) return;
    setDragTargetParticipantId(participantId);
    const source = participantDragBaseIdsRef.current ?? orderedFiltered.map((item) => item.id);
    setParticipantDragPreviewIds(reorderIdsByTarget([...source], dragParticipantId, participantId));
  }

  function beginParticipantPointerDrag(event: ReactPointerEvent<HTMLDivElement>, participantId: string) {
    if (registrySort !== "manual" || event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setParticipantPointerDrag({
      id: participantId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function handleParticipantItemClick(id: string) {
    if (suppressParticipantClickRef.current) {
      return;
    }
    openParticipant(id);
  }

  useEffect(() => {
    if (!participantPointerDrag && !dragParticipantId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setParticipantPointerDrag(null);
      setDragParticipantId(null);
      setDragTargetParticipantId(null);
      if (!options?.preservePreview) {
        setParticipantDragPreviewIds(null);
        participantDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = participantPointerDrag;
      const activeId = dragParticipantId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }

      if (!dragParticipantId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginParticipantDrag(candidate.id);
      }

      const targetParticipantId = findNearestReorderTargetId("data-participant-order-id", activeId, event.clientX, event.clientY);
      if (targetParticipantId && targetParticipantId !== activeId) {
        trackParticipantDropTarget(targetParticipantId);
      }
    }

    function handlePointerUp() {
      const activeId = dragParticipantId;
      const targetId = dragTargetParticipantId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      const committedIds =
        didReorder && activeId && targetId
          ? (participantDragPreviewIds ?? reorderIdsByTarget([...(participantDragBaseIdsRef.current ?? orderedFiltered.map((item) => item.id))], activeId, targetId))
          : null;
      if (committedIds) {
        setParticipantCommittedOrderIds(committedIds);
      }
      resetState({ preservePreview: didReorder });
      if (didReorder) {
        suppressParticipantClickRef.current = true;
        window.setTimeout(() => {
          suppressParticipantClickRef.current = false;
        }, 160);
      }
      if (activeId && targetId && activeId !== targetId) {
        void persistParticipantOrder(activeId, targetId, committedIds)
          .catch(() => {
            setParticipantCommittedOrderIds(null);
          })
          .finally(() => {
            setParticipantDragPreviewIds(null);
            participantDragBaseIdsRef.current = null;
          });
      } else {
        setParticipantDragPreviewIds(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragParticipantId, dragTargetParticipantId, orderedFiltered, participantDragPreviewIds, participantPointerDrag, registrySort]);

  function resetDraft() {
    if (!sourceParticipant) return;
    setDraft(cloneJson(sourceParticipant));
    setDraftDirty(false);
    setScreenMode("view");
    setDetailExpanded(true);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  function openParticipant(id: string) {
    setSelectedId(id);
    setActiveTab("overview");
    setScreenMode("view");
    setDetailExpanded(false);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  function openParticipantDetails(id: string) {
    setSelectedId(id);
    setActiveTab("overview");
    setScreenMode("view");
    setDetailExpanded(true);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  function beginEditing() {
    if (!sourceParticipant) return;
    setDraft(cloneJson(sourceParticipant));
    setDraftDirty(false);
    setScreenMode("edit");
    setDetailExpanded(true);
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  function cancelEditing() {
    if (sourceParticipant) {
      setDraft(cloneJson(sourceParticipant));
      setDraftDirty(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setParticipantNotice(null);
      setPendingStructureAssignment(null);
      setPendingDepartmentAssignment(null);
      setPendingRoleAssignment(null);
      setEditingDisciplineId(null);
      setEditingRewardId(null);
      return;
    }
    const fallback = snapshot.participants[0] ?? null;
    if (fallback) {
      setSelectedId(fallback.profile.id);
      setDraft(cloneJson(fallback));
      setDraftDirty(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setParticipantNotice(null);
      setPendingStructureAssignment(null);
      setPendingDepartmentAssignment(null);
      setPendingRoleAssignment(null);
      setEditingDisciplineId(null);
      setEditingRewardId(null);
      return;
    }
    setDraft(null);
    setDraftDirty(false);
    setScreenMode("create");
    setParticipantNotice(null);
    setPendingStructureAssignment(null);
    setPendingDepartmentAssignment(null);
    setPendingRoleAssignment(null);
    setEditingDisciplineId(null);
    setEditingRewardId(null);
  }

  const releaseLinks = currentParticipant
    ? participantLinksById.get(currentParticipant.profile.id) ?? { participated: [], curated: [], linked: [] }
    : { participated: [], curated: [], linked: [] };
  const relatedReleases = releaseLinks.linked;
  const curatedReleases = releaseLinks.curated;
  const selectedView = useMemo(
    () => participantViews.find((item) => item.id === currentParticipant?.profile.id),
    [participantViews, currentParticipant?.profile.id]
  );
  const participantAssignments = currentParticipant ? snapshot.assignments.filter((item) => item.participant_id === currentParticipant.profile.id) : [];
  const participantTemporaryAssignments = currentParticipant ? snapshot.temporaryAssignments.filter((item) => item.participant_id === currentParticipant.profile.id) : [];
  const participantSubstitutions = currentParticipant
    ? {
        asSubstitute: snapshot.substitutions.filter((item) => item.substitute_participant_id === currentParticipant.profile.id),
        asSource: snapshot.substitutions.filter((item) => {
          const sourceAssignment = snapshot.assignments.find((entry) => entry.id === item.source_assignment_id);
          return sourceAssignment?.participant_id === currentParticipant.profile.id;
        })
      }
    : { asSubstitute: [], asSource: [] };
  const pinnedNotes = currentParticipant?.notes.filter((item) => item.pinned) ?? [];
  const nextReleaseCandidates = [...relatedReleases].slice(0, 5);
  const draftAdditionalContacts = (draft?.profile.contacts ?? []).map(parseAdditionalContactEntry);
  const structurePositionOptions = useMemo(
    () => mergeLookupOptionsWithCurrent(snapshot.structurePositions, [
      ...(participantAssignments.map((item) => item.position_id)),
      pendingStructureAssignment?.position_id
    ]),
    [participantAssignments, pendingStructureAssignment?.position_id, snapshot.structurePositions]
  );
  const structureDepartmentOptions = useMemo(
    () => mergeLookupOptionsWithCurrent(snapshot.departments, [
      ...(participantAssignments.map((item) => item.department_id)),
      pendingStructureAssignment?.department_id
    ]),
    [participantAssignments, pendingStructureAssignment?.department_id, snapshot.departments]
  );
  const participantStructureAssignments = participantAssignments
    .filter((item) => item.active_flag)
    .sort((left, right) => {
      const leftPosition = structurePositionById.get(left.position_id);
      const rightPosition = structurePositionById.get(right.position_id);
      const leftOrder = leftPosition?.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = rightPosition?.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return `${left.started_at ?? ""}`.localeCompare(`${right.started_at ?? ""}`);
    });
  useEffect(() => {
    const fallbackReleaseId = releaseLinkOptions[0]?.release.id ?? "";
    if (!releaseLinkTargetId || !releaseLinkOptions.some((item) => item.release.id === releaseLinkTargetId)) {
      setReleaseLinkTargetId(fallbackReleaseId);
    }
  }, [releaseLinkOptions, releaseLinkTargetId]);

  return (
    <>
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="composition:list">
      <Panel title="Поиск, фильтры и действия" subtitle="Слева находятся поиск по базе, быстрые подборки, создание карточек и импорт. Список участников вынесен в центр.">
        <div className="section-stack">
          <Field
            label="Поиск по базе"
            help="Поиск одновременно смотрит ник, отображаемое имя, упоминание VK, ссылку VK и текст рабочих заметок."
            hint="Используйте поиск, когда нужно быстро найти человека по нику, имени, ссылке или заметке."
          >
            <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ник, имя, упоминание VK, ссылка VK или текст заметки" />
          </Field>
          <div className="dashboard-actions primary-cluster">
            <Button className="primary" onClick={createParticipant}>Создать участника</Button>
            <ActionMenu label="Еще">
              <ActionMenuItem onClick={() => onNavigate("imports")}>Открыть импорт</ActionMenuItem>
              <ActionMenuItem onClick={duplicateParticipant} disabled={!draft}>Дублировать карточку</ActionMenuItem>
              <ActionMenuItem onClick={() => applyParticipantPreset("archive")}>Открыть архив</ActionMenuItem>
              <ActionMenuItem onClick={() => applyParticipantPreset("problem")}>Показать проблемных</ActionMenuItem>
              <ActionMenuItem onClick={() => applyParticipantPreset("top")}>Показать кандидатов на важные релизы</ActionMenuItem>
              <ActionMenuItem onClick={() => applyParticipantPreset("reliable")}>Показать надежных</ActionMenuItem>
              <ActionMenuItem onClick={resetFilters}>Сбросить фильтры</ActionMenuItem>
            </ActionMenu>
          </div>
          <div className="detail-card filter-card">
            <div className="filter-card-header">
              <h4>Быстрые подборки</h4>
              <div className="muted">Выберите готовую подборку, затем при необходимости уточните ее обычными фильтрами ниже.</div>
            </div>
            <div className="filter-card-section">
              <div className="tab-chip-group">
                <button className={`tab ${viewPreset === "all" ? "active" : ""}`} onClick={() => applyParticipantPreset("all")}>Весь состав</button>
                <button className={`tab ${viewPreset === "problem" ? "active" : ""}`} onClick={() => applyParticipantPreset("problem")}>Проблемные</button>
                <button className={`tab ${viewPreset === "top" ? "active" : ""}`} onClick={() => applyParticipantPreset("top")}>Важные релизы</button>
                <button className={`tab ${viewPreset === "archive" ? "active" : ""}`} onClick={() => applyParticipantPreset("archive")}>Архив</button>
                <button className={`tab ${viewPreset === "reliable" ? "active" : ""}`} onClick={() => applyParticipantPreset("reliable")}>Надежные</button>
              </div>
            </div>
            <div className="filter-card-section">
              <div className="grid two filter-card-grid">
                <Field label="Статус участия" help="Показывает рабочий статус человека: активен, в резерве, неактивен, ушел или заблокирован.">
                  <select className="select-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">Все статусы</option>
                    <option value="archived">Архив</option>
                    {participantStatusOptions.length
                      ? participantStatusOptions.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)
                      : [...new Set(participantViews.map((item) => item.status))]
                        .filter((status) => status !== "archived")
                        .map((status) => <option key={status} value={status}>{translateCode(status)}</option>)}
                  </select>
                </Field>
                <Field label="Направление" help="Отдел или рабочее направление студии, к которому привязан участник.">
                  <select className="select-input" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                    <option value="all">Все направления</option>
                    {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="chip-group filter-card-summary">
                <Chip tone={viewPreset === "all" ? "accent" : undefined}>Подборка: {translateParticipantPreset(viewPreset)}</Chip>
                <Chip>В выборке: {filtered.length}</Chip>
                <Chip tone="warning">{participantViews.filter((item) => item.warningCount > 0 || item.remarkCount > 0).length} проблемных</Chip>
                <Chip tone="accent">{participantViews.filter((item) => item.topReleaseFit).length} {pluralizeSimple(participantViews.filter((item) => item.topReleaseFit).length, "подходит", "подходят")} для важных релизов</Chip>
              </div>
            </div>
            <div className="filter-card-section">
              <details className="detail-disclosure">
                <summary className="disclosure-summary">
                  <strong>Дополнительные фильтры</strong>
                  <span className="muted">Роли, активность, дисциплина, техника и пригодность к важным или заказным проектам.</span>
                </summary>
                <div className="detail-disclosure-body">
                  <div className="grid two filter-card-grid">
                    <Field label="Роль участника" help="Роль показывает, что человек реально делает в релизах: озвучивает, переводит, сводит, оформляет и так далее.">
                      <select className="select-input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                        <option value="all">Все роли</option>
                        {roleOptions.length
                          ? roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)
                          : Array.from(new Set(participantViews.flatMap((item) => item.roleIds))).map((roleId) => <option key={roleId} value={roleId}>{roleId}</option>)}
                      </select>
                    </Field>
                    <Field label="Уровень активности" help="Показывает, есть ли у человека текущая работа в релизах, умеренная нагрузка, низкая активность или резерв.">
                      <select className="select-input" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                        <option value="all">Любая активность</option>
                        {["в работе", "умеренный", "низкий", "резерв"].map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Field label="Дисциплина" help="Позволяет отдельно смотреть чистые карточки, замечания, предупреждения и блокировки.">
                      <select className="select-input" value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)}>
                        <option value="all">Любая дисциплина</option>
                        <option value="clean">Без активных событий</option>
                        <option value="remark">Есть замечания</option>
                        <option value="warning">Есть предупреждения</option>
                        <option value="blacklist">Есть блок или черный список</option>
                      </select>
                    </Field>
                  </div>
                  <div className="filter-chip-grid">
                    <ToggleChip label="проба голоса" active={voiceOnly} onToggle={setVoiceOnly} tone="accent" />
                    <ToggleChip label="оборудование" active={equipmentOnly} onToggle={setEquipmentOnly} tone="accent" />
                    <ToggleChip label="топ-релизы" active={topOnly} onToggle={setTopOnly} tone="accent" />
                    <ToggleChip label="заказные" active={commercialOnly} onToggle={setCommercialOnly} tone="accent" />
                    <ToggleChip label="предупреждения" active={warningOnly} onToggle={setWarningOnly} tone="warning" />
                    <ToggleChip label="замечания" active={remarkOnly} onToggle={setRemarkOnly} tone="warning" />
                    <ToggleChip label="надежные" active={reliableOnly} onToggle={setReliableOnly} tone="success" />
                    <ToggleChip label="ключевые" active={keyOnly} onToggle={setKeyOnly} tone="accent" />
                    <ToggleChip label="старые релизы" active={oldReleaseOnly} onToggle={setOldReleaseOnly} tone="warning" />
                  </div>
                </div>
              </details>
            </div>
          </div>
          <div className="detail-card">
            <h4>Сводка по выборке</h4>
            <div className="summary-key-list">
              <div className="compact-row"><strong>Найдено участников</strong><span className="muted">{formatSimpleCount(filtered.length, "участник", "участников")}</span></div>
              <div className="compact-row"><strong>Текущая подборка</strong><span className="muted">{translateParticipantPreset(viewPreset)}</span></div>
              <div className="compact-row"><strong>Сортировка</strong><span className="muted">{PARTICIPANT_REGISTRY_SORT_OPTIONS.find((item) => item.id === registrySort)?.label ?? "По алфавиту"}</span></div>
              <div className="compact-row"><strong>Режим реестра</strong><span className="muted">{registryView === "list" ? "Строки" : "Карточки"}</span></div>
            </div>
          </div>
          <div className="detail-card">
            <h4>Как устроен экран</h4>
            <div className="muted">Центр всегда показывает рабочий реестр участников. Справа открывается короткая сводка по выбранному человеку, а полная карточка открывается отдельно и не подменяет сам реестр.</div>
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`composition:details:${selectedId || "empty"}`}>
      <div className="section-stack">
      {!detailMode ? (
      <Panel
        title="Реестр участников"
        subtitle="Центральная область показывает основную базу участников. Выберите запись, чтобы открыть короткую сводку справа, а полную карточку открывайте отдельно."
        actions={
          <div className="chip-group">
            <Chip>В реестре: {filtered.length}</Chip>
            <div className="registry-sort-control">
              <span className="registry-sort-label">Сортировка</span>
              <select className="select-input registry-sort-select" value={registrySort} onChange={(event) => setRegistrySort(event.target.value as ParticipantRegistrySort)}>
                {PARTICIPANT_REGISTRY_SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <button className={`tab ${registryView === "list" ? "active" : ""}`} onClick={() => setRegistryView("list")}>Строки</button>
            <button className={`tab ${registryView === "cards" ? "active" : ""}`} onClick={() => setRegistryView("cards")}>Карточки</button>
          </div>
        }
      >
        {!filtered.length ? (
          <EmptyState
            title="По текущим фильтрам никого не найдено"
            body="Сбросьте часть фильтров или измените поисковый запрос, чтобы снова увидеть участников в реестре."
          />
        ) : (
          <div className={registryView === "cards" ? "participant-registry-grid" : "participant-registry-list"}>
            {orderedFiltered.map((item) => (
              <ParticipantRegistryItem
                key={item.id}
                item={item}
                active={item.id === selectedId}
                viewMode={registryView}
                roleNameById={roleNameById}
                departmentNameById={departmentNameById}
                showAdvancedMode={showAdvancedMode}
                isDragging={dragParticipantId === item.id}
                isDropTarget={dragTargetParticipantId === item.id && dragParticipantId !== item.id}
                onPointerDown={(event) => beginParticipantPointerDrag(event, item.id)}
                onOpen={handleParticipantItemClick}
                onOpenDetails={openParticipantDetails}
              />
            ))}
          </div>
        )}
      </Panel>
      ) : null}

      {detailMode ? (
      <Panel
        title={currentParticipant?.profile.display_name ?? (screenMode === "create" ? "Новый участник" : "Карточка участника")}
        subtitle={
          screenMode === "view"
            ? "В центре открыт полный обзор выбранной карточки. Чтобы вернуться к реестру, используйте кнопку вверху или справа."
            : screenMode === "edit"
              ? "Редактирование выбранной карточки. После сохранения экран вернется в обычный обзор."
              : "Создание новой карточки участника."
        }
        actions={<div className="row" style={{ flexWrap: "wrap" }}>
          <Chip tone={screenMode === "view" ? undefined : saveState === "saving" ? "warning" : saveState === "saved" ? "success" : dirty ? "warning" : "success"}>
            {screenMode === "view" ? "Обзор" : saveState === "saving" ? "Сохраняем..." : saveState === "saved" ? "Сохранено" : dirty ? "Есть локальные правки" : "Готово к сохранению"}
          </Chip>
          {screenMode === "view" ? <Button className="secondary" onClick={() => setDetailExpanded(false)}>Вернуться к реестру</Button> : null}
          {screenMode === "view" ? <Button className="primary" onClick={beginEditing} disabled={!sourceParticipant || isSaving}>Редактировать</Button> : null}
          {screenMode !== "view" ? <Button className="secondary" onClick={cancelEditing} disabled={isSaving}>Отменить</Button> : null}
          {screenMode !== "view" ? <Button className="primary" disabled={!draft || isSaving} onClick={() => void saveDraft()}>{isSaving ? "Сохраняем..." : "Сохранить участника"}</Button> : null}
          {(currentParticipant || screenMode !== "view") ? (
            <ActionMenu label="Еще действия">
              {currentParticipant ? <ActionMenuItem onClick={duplicateParticipant} disabled={!currentParticipant || isSaving}>Дублировать</ActionMenuItem> : null}
              {currentParticipant ? <ActionMenuItem onClick={() => void toggleArchiveParticipant()} disabled={isSaving || (screenMode === "view" && !sourceParticipant)}>{currentParticipant && isParticipantArchivedEntity(currentParticipant) ? "Восстановить" : "Архивировать"}</ActionMenuItem> : null}
              {screenMode !== "view" ? <ActionMenuItem onClick={resetDraft} disabled={!dirty || isSaving}>Вернуть исходные значения</ActionMenuItem> : null}
            </ActionMenu>
          ) : null}
        </div>}
      >
        {isSaving ? <div className="notice-banner"><strong>Сохраняем...</strong><div>Карточка участника обновляется. Повторно нажимать кнопку не нужно.</div></div> : null}
        {!isSaving && participantNotice ? <div className={`notice-banner ${participantNotice.tone}`}><strong>{participantNotice.tone === "success" ? "Сохранено" : participantNotice.tone === "warning" ? "Нужно проверить" : "Ошибка"}</strong><div>{participantNotice.text}</div></div> : null}
        {!currentParticipant && screenMode !== "create" ? <EmptyState title="Участник не выбран" body="Выберите участника в центральном реестре, чтобы открыть карточку, или создайте новую запись." /> : screenMode === "view" && currentParticipant ? (
          <ParticipantViewPanel
            participant={currentParticipant}
            selectedView={selectedView}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            relatedReleases={relatedReleases}
            pinnedNotes={pinnedNotes}
            participantAssignments={participantAssignments}
            participantTemporaryAssignments={participantTemporaryAssignments}
            participantSubstitutions={participantSubstitutions}
            curatedReleases={curatedReleases}
            roleNameById={roleNameById}
            rewardTypeNameById={rewardTypeNameById}
            departmentNameById={departmentNameById}
            positionNameById={structurePositionNameById}
            skillNameById={skillNameById}
            onOpenRelease={onOpenRelease}
            showAdvancedMode={showAdvancedMode}
          />
        ) : !draft ? <EmptyState title="Новый участник еще не подготовлен" body="Нажмите «Создать участника» слева, чтобы открыть форму создания." /> : (
          <div className="section-stack">
            <div className="participant-header">
              <div>
                <h2 className="hero-title">{draft.profile.display_name}</h2>
                <div className="muted">{draft.profile.posting.mention || `@${draft.profile.nickname}`} • {draft.profile.real_name || "реальное имя не указано"}</div>
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Chip>{getLookupLabel(new Map((snapshot.directories.participant_statuses ?? []).map((item) => [item.id, item.name])), getParticipantLifecycleStatus(draft), translateCode(getParticipantLifecycleStatus(draft)))}</Chip>
                <Chip tone={selectedView?.keyMember ? "accent" : undefined}>{selectedView?.keyMember ? "Ключевой" : selectedView?.reliabilityLevel ?? "—"}</Chip>
                <Chip tone={selectedView?.topReleaseFit ? "accent" : undefined}>{selectedView?.topReleaseFit ? "Важные релизы" : "Обычный приоритет"}</Chip>
              </div>
            </div>
            <div className="tabs">
              {[
                ["overview", "Обзор"],
                ["contacts", "Связь"],
                ["org", "Отделы и роли"],
                ["skills", "Навыки"],
                ["equipment", "Оборудование"],
                ["voice", "Проба голоса"],
                ["releases", "Релизы"],
                ["notes", "Заметки"],
                ["discipline", "Дисциплина"],
                ["rewards", "Вклад в команду"],
                ["posting", "Данные для постов"],
                ["history", "История"]
              ].map(([tab, label]) => (
                <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>

            {activeTab === "overview" ? (
              <div className="section-stack">
                <div className="grid two">
                  <Field label="Ник"><input className="text-input" value={draft.profile.nickname} onChange={(event) => updateDraft((next) => { next.profile.nickname = event.target.value; })} /></Field>
                  <Field label="Произношение ника"><input className="text-input" value={draft.profile.nickname_pronunciation ?? ""} onChange={(event) => updateDraft((next) => { next.profile.nickname_pronunciation = event.target.value; })} /></Field>
                  <Field label="Отображаемое имя"><input className="text-input" value={draft.profile.display_name} onChange={(event) => updateDraft((next) => { next.profile.display_name = event.target.value; })} /></Field>
                  <Field label="Реальное имя"><input className="text-input" value={draft.profile.real_name ?? ""} onChange={(event) => updateDraft((next) => { next.profile.real_name = event.target.value; })} /></Field>
                  <Field label="Статус">
                    <select className="select-input" value={normalizeParticipantStatusId(draft.profile.participant_status_id, draft.profile.reserve_flag)} onChange={(event) => updateDraft((next) => { next.profile.participant_status_id = event.target.value; })}>
                      {mergeLookupOptionsWithCurrent(snapshot.directories.participant_statuses ?? [], [normalizeParticipantStatusId(draft.profile.participant_status_id, draft.profile.reserve_flag)]).length
                        ? mergeLookupOptionsWithCurrent(snapshot.directories.participant_statuses ?? [], [normalizeParticipantStatusId(draft.profile.participant_status_id, draft.profile.reserve_flag)]).map((status) => <option key={status.id} value={status.id}>{status.name}</option>)
                        : <option value={normalizeParticipantStatusId(draft.profile.participant_status_id, draft.profile.reserve_flag)}>{translateCode(normalizeParticipantStatusId(draft.profile.participant_status_id, draft.profile.reserve_flag))}</option>}
                    </select>
                  </Field>
                  <Field label="Заметка по доступности"><input className="text-input" value={draft.profile.availability_note ?? ""} onChange={(event) => updateDraft((next) => { next.profile.availability_note = event.target.value; })} /></Field>
                </div>
                <div className="detail-card">
                  <h4>Закрепленные заметки и рабочий фокус</h4>
                  {pinnedNotes.length
                    ? pinnedNotes.map((item) => <div key={item.id} className="compact-row"><strong title={item.title}>{item.title}</strong><span className="muted" title={item.body}>{item.body}</span></div>)
                    : <div className="muted">Закрепленных заметок пока нет. Создайте рабочую заметку и закрепите ее, чтобы она всегда была в обзоре.</div>}
                </div>
              </div>
            ) : null}
            {activeTab === "contacts" ? (
              <div className="section-stack">
                <div className="grid two">
                  <Field label="MAX"><input className="text-input" value={draft.profile.contact_max ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_max = event.target.value; })} /></Field>
                  <Field label="Телефон"><input className="text-input" value={draft.profile.contact_phone ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_phone = event.target.value; })} /></Field>
                  <Field label="Telegram"><input className="text-input" value={draft.profile.contact_telegram ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_telegram = event.target.value; })} /></Field>
                  <Field label="Связь VK"><input className="text-input" value={draft.profile.contact_vk ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_vk = event.target.value; })} /></Field>
                  <Field label="Email"><input className="text-input" value={draft.profile.contact_email ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_email = event.target.value; })} /></Field>
                  <Field label="Одноклассники"><input className="text-input" value={draft.profile.contact_odnoklassniki ?? ""} onChange={(event) => updateDraft((next) => { next.profile.contact_odnoklassniki = event.target.value; })} /></Field>
                </div>
                <div className="detail-card">
                  <div className="card-header-row">
                    <div className="card-header-main">
                      <h4>Дополнительные поля связи</h4>
                      <div className="muted">Добавляйте сюда сайт, Discord, запасной мессенджер или любой другой способ связи отдельными полями.</div>
                    </div>
                    <Button className="secondary" onClick={() => updateDraft((next) => { next.profile.contacts = [...next.profile.contacts, ""]; })}>Добавить поле связи</Button>
                  </div>
                  <div className="section-stack compact">
                    {draftAdditionalContacts.length ? draftAdditionalContacts.map((contact, index) => (
                      <div key={`contact-field-${index}`} className="list-item subdued">
                        <div className="grid two">
                          <Field label="Название поля">
                            <input
                              className="text-input"
                              value={contact.label}
                              placeholder="Например: Discord"
                              onChange={(event) => updateDraft((next) => {
                                const current = parseAdditionalContactEntry(next.profile.contacts[index]);
                                next.profile.contacts[index] = serializeAdditionalContactEntry({ ...current, label: event.target.value });
                              })}
                            />
                          </Field>
                          <Field label="Контакт или ссылка">
                            <input
                              className="text-input"
                              value={contact.value}
                              placeholder="Например: @nickname или https://..."
                              onChange={(event) => updateDraft((next) => {
                                const current = parseAdditionalContactEntry(next.profile.contacts[index]);
                                next.profile.contacts[index] = serializeAdditionalContactEntry({ ...current, value: event.target.value });
                              })}
                            />
                          </Field>
                        </div>
                        <div className="row spread" style={{ flexWrap: "wrap" }}>
                          <div className="muted">Если название не нужно, можно оставить только сам контакт или ссылку.</div>
                          <Button className="danger" onClick={() => updateDraft((next) => { next.profile.contacts = next.profile.contacts.filter((_, contactIndex) => contactIndex !== index); })}>Удалить поле</Button>
                        </div>
                      </div>
                    )) : <div className="muted">Дополнительных полей связи пока нет.</div>}
                  </div>
                </div>
              </div>
            ) : null}
            {activeTab === "org" ? (
              <div className="section-stack">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button
                    className="secondary"
                    onClick={addStructureAssignment}
                    disabled={isStructureAssignmentSaving}
                  >
                    Добавить должность
                  </Button>
                  <Button className="secondary" onClick={addDepartmentAssignment}>Добавить отдел</Button>
                  <Button className="secondary" onClick={addRoleAssignment}>Добавить роль</Button>
                </div>
                {pendingStructureAssignment ? (
                  <div className="detail-card">
                    <h4>Новая структурная должность</h4>
                    <div className="grid two">
                      <Field label="Отдел">
                        <select
                          className="select-input"
                          value={pendingStructureAssignment.department_id}
                          onChange={(event) => {
                            const nextDepartmentId = event.target.value;
                            const firstPositionForDepartment =
                              structurePositionOptions.find((item) => item.department_id === nextDepartmentId)
                              ?? structurePositionOptions.find((item) => item.id === pendingStructureAssignment.position_id)
                              ?? null;
                            setPendingStructureAssignment((current) => current ? {
                              ...current,
                              department_id: nextDepartmentId,
                              position_id: firstPositionForDepartment?.id ?? ""
                            } : current);
                          }}
                        >
                          {mergeLookupOptionsWithCurrent(snapshot.departments, [pendingStructureAssignment.department_id]).map((department) => (
                            <option key={department.id} value={department.id}>{department.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Должность">
                        <select
                          className="select-input"
                          value={pendingStructureAssignment.position_id}
                          onChange={(event) => setPendingStructureAssignment((current) => current ? {
                            ...current,
                            position_id: event.target.value
                          } : current)}
                        >
                          <option value="">Выберите должность</option>
                          {structurePositionOptions
                            .filter((item) =>
                              !pendingStructureAssignment.department_id
                              || item.department_id === pendingStructureAssignment.department_id
                              || item.id === pendingStructureAssignment.position_id
                            )
                            .map((position) => (
                              <option key={position.id} value={position.id}>{position.name}</option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Тип назначения">
                        <select
                          className="select-input"
                          value={pendingStructureAssignment.assignment_kind}
                          onChange={(event) => setPendingStructureAssignment((current) => current ? {
                            ...current,
                            assignment_kind: event.target.value as PositionAssignment["assignment_kind"]
                          } : current)}
                        >
                          {POSITION_ASSIGNMENT_KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="row spread">
                      <span className="muted">Это назначение сразу записывается в раздел «Структура» и связывается с карточкой участника.</span>
                      <div className="row">
                        <Button className="secondary" onClick={() => setPendingStructureAssignment(null)} disabled={isStructureAssignmentSaving}>Отменить</Button>
                        <Button className="primary" onClick={() => void confirmStructureAssignment()} disabled={!pendingStructureAssignment.position_id || isStructureAssignmentSaving}>
                          {isStructureAssignmentSaving ? "Назначаем..." : "Назначить"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="detail-card">
                  <div className="card-header-row">
                    <div className="card-header-main">
                      <h4>Должности в структуре</h4>
                      <div className="muted">Здесь видны все активные структурные позиции участника: постоянные, временные и стажировочные.</div>
                    </div>
                    <Button className="secondary utility" onClick={() => onNavigate("structure")}>Открыть структуру</Button>
                  </div>
                  {screenMode === "create" ? (
                    <div className="notice-banner">
                      <strong>Сначала сохраните участника</strong>
                      <div>Новый участник еще не записан в общий состав. После сохранения здесь можно сразу назначить ему должность из структуры.</div>
                    </div>
                  ) : !structurePositionOptions.length ? (
                    <div className="notice-banner">
                      <strong>В структуре пока нет должностей</strong>
                      <div>Сначала создайте хотя бы одну должность в разделе «Структура», после чего здесь появится форма назначения.</div>
                    </div>
                  ) : null}
                  <div className="list compact-list">
                    {participantStructureAssignments.length ? participantStructureAssignments.map((assignment) => {
                      const position = structurePositionById.get(assignment.position_id);
                      return (
                        <div key={assignment.id} className="list-item subdued">
                          <div className="section-stack compact">
                            <div className="compact-row">
                              <strong>{position?.name ?? structurePositionNameById.get(assignment.position_id) ?? "Должность не указана"}</strong>
                              <span className="muted">{getLookupLabel(departmentNameById, assignment.department_id, "Отдел не указан")}</span>
                            </div>
                            <div className="compact-row">
                              <span className="muted">{translateCode(assignment.assignment_kind)}</span>
                              <span className="muted">{formatDate(assignment.started_at)}</span>
                            </div>
                          </div>
                          <div className="row spread">
                            <Chip tone={assignment.assignment_kind === "permanent" ? "accent" : assignment.assignment_kind === "internship" ? "warning" : assignment.assignment_kind === "assistant" ? "accent" : undefined}>
                              {translateCode(assignment.assignment_kind)}
                            </Chip>
                            <div className="row">
                              <Button className="secondary" onClick={() => onNavigate("structure")}>Открыть в структуре</Button>
                              <Button className="danger" onClick={() => void removeParticipantStructureAssignment(assignment.id)} disabled={isStructureAssignmentSaving}>Снять</Button>
                            </div>
                          </div>
                        </div>
                      );
                    }) : <EmptyState title="Структурные должности еще не назначены" body={screenMode === "create" ? "Сначала сохраните участника, а затем назначьте ему должность из структуры." : structurePositionOptions.length ? "Нажмите «Добавить должность», чтобы закрепить за участником структурную позицию." : "Сначала создайте должности в разделе «Структура», а затем назначьте одну из них участнику."} />}
                  </div>
                </div>
                {pendingDepartmentAssignment ? (
                  <div className="detail-card">
                    <h4>Новый отдел для участника</h4>
                    <div className="grid two">
                      <Field label="Отдел">
                        <select className="select-input" value={pendingDepartmentAssignment.department_id} onChange={(event) => setPendingDepartmentAssignment((current) => current ? { ...current, department_id: event.target.value } : current)}>
                          {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Заинтересованность">
                        <select className="select-input" value={pendingDepartmentAssignment.assignment_status} onChange={(event) => setPendingDepartmentAssignment((current) => current ? { ...current, assignment_status: event.target.value } : current)}>
                          {DEPARTMENT_INTEREST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Основной отдел">
                        <select className="select-input" value={pendingDepartmentAssignment.primary_flag ? "yes" : "no"} onChange={(event) => setPendingDepartmentAssignment((current) => current ? { ...current, primary_flag: event.target.value === "yes" } : current)}>
                          <option value="yes">Да</option>
                          <option value="no">Нет</option>
                        </select>
                      </Field>
                      <Field label="Комментарий">
                        <input className="text-input" value={pendingDepartmentAssignment.comment} onChange={(event) => setPendingDepartmentAssignment((current) => current ? { ...current, comment: event.target.value } : current)} />
                      </Field>
                    </div>
                    <div className="row spread">
                      <span className="muted">Сначала подтвердите новый отдел, затем при необходимости сохраните всю карточку участника.</span>
                      <div className="row">
                        <Button className="secondary" onClick={() => setPendingDepartmentAssignment(null)}>Отменить</Button>
                        <Button className="primary" onClick={confirmDepartmentAssignment}>Подтвердить отдел</Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {pendingRoleAssignment ? (
                  <div className="detail-card">
                    <h4>Новая роль участника</h4>
                    <div className="grid two">
                      <Field label="Роль">
                        <select className="select-input" value={pendingRoleAssignment.role_id} onChange={(event) => setPendingRoleAssignment((current) => current ? { ...current, role_id: event.target.value } : current)}>
                          {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Заметки">
                        <input className="text-input" value={pendingRoleAssignment.note} onChange={(event) => setPendingRoleAssignment((current) => current ? { ...current, note: event.target.value } : current)} />
                      </Field>
                      <Field label="Уровень">
                        <select className="select-input" value={normalizeParticipantRoleLevel(pendingRoleAssignment.level) ?? ""} onChange={(event) => setPendingRoleAssignment((current) => current ? { ...current, level: event.target.value } : current)}>
                          {roleLevelOptions.map((option) => <option key={option.id || "__empty"} value={option.id}>{option.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Активность роли">
                        <select className="select-input" value={pendingRoleAssignment.active ? "yes" : "no"} onChange={(event) => setPendingRoleAssignment((current) => current ? { ...current, active: event.target.value === "yes" } : current)}>
                          <option value="yes">Активная</option>
                          <option value="no">Неактивная</option>
                        </select>
                      </Field>
                    </div>
                    <div className="row spread">
                      <span className="muted">Здесь можно оставить короткую заметку к роли, не ломая старые записи базы.</span>
                      <div className="row">
                        <Button className="secondary" onClick={() => setPendingRoleAssignment(null)}>Отменить</Button>
                        <Button className="primary" onClick={confirmRoleAssignment}>Подтвердить роль</Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="list compact-list">
                  {draft.org.department_assignments.length ? draft.org.department_assignments.map((assignment, index) => {
                    const isEditingAssignment = screenMode !== "view" && editingDepartmentAssignmentIndex === index;
                    return (
                      <div key={`${assignment.department_id}_${index}`} className="list-item subdued">
                        {isEditingAssignment ? (
                          <div className="grid two">
                            <Field label="Отдел">
                              <select className="select-input" value={assignment.department_id} onChange={(event) => updateDraft((next) => {
                                const target = next.org.department_assignments[index];
                                if (target) target.department_id = event.target.value;
                              })}>
                                {mergeLookupOptionsWithCurrent(snapshot.departments, [assignment.department_id]).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                              </select>
                            </Field>
                            <Field label="Заинтересованность">
                              <select className="select-input" value={assignment.assignment_status} onChange={(event) => updateDraft((next) => { const target = next.org.department_assignments[index]; if (target) target.assignment_status = event.target.value; })}>
                                {DEPARTMENT_INTEREST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                              </select>
                            </Field>
                            <Field label="Комментарий"><input className="text-input" value={assignment.comment ?? ""} onChange={(event) => updateDraft((next) => { const target = next.org.department_assignments[index]; if (target) target.comment = event.target.value; })} /></Field>
                            <Field label="Основной отдел">
                              <select className="select-input" value={assignment.primary_flag ? "yes" : "no"} onChange={(event) => updateDraft((next) => { const target = next.org.department_assignments[index]; if (target) target.primary_flag = event.target.value === "yes"; })}>
                                <option value="yes">Да</option>
                                <option value="no">Нет</option>
                              </select>
                            </Field>
                          </div>
                        ) : (
                          <div className="section-stack compact">
                            <div className="compact-row">
                              <strong>{getLookupLabel(departmentNameById, assignment.department_id, "Отдел не указан")}</strong>
                              <span className="muted">{getDepartmentInterestLabel(assignment.assignment_status)}</span>
                            </div>
                            {assignment.comment ? <div className="muted">{assignment.comment}</div> : null}
                          </div>
                        )}
                        <div className="row spread">
                          <Chip tone={assignment.primary_flag ? "accent" : undefined}>{assignment.primary_flag ? "Основной отдел" : getDepartmentInterestLabel(assignment.assignment_status)}</Chip>
                          {screenMode !== "view" ? (
                            <div className="row">
                              {isEditingAssignment ? (
                                <>
                                  <Button className="secondary" onClick={() => setEditingDepartmentAssignmentIndex(null)}>Готово</Button>
                                  <Button className="danger" onClick={() => updateDraft((next) => { next.org.department_assignments = next.org.department_assignments.filter((_, position) => position !== index); })}>Удалить</Button>
                                </>
                              ) : (
                                <Button className="secondary" onClick={() => setEditingDepartmentAssignmentIndex(index)}>Редактировать</Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }) : <EmptyState title="Отделы еще не указаны" body="Добавьте хотя бы один отдел, чтобы показать участие человека в направлениях команды." />}
                </div>
                <div className="list compact-list">
                  {draft.org.role_assignments.length ? draft.org.role_assignments.map((assignment, index) => {
                    const isEditingRole = screenMode !== "view" && editingRoleAssignmentIndex === index;
                    return (
                      <div key={`${assignment.role_id}_${index}`} className="list-item subdued">
                        {isEditingRole ? (
                          <div className="grid two">
                            <Field label="Роль">
                              <select className="select-input" value={assignment.role_id} onChange={(event) => updateDraft((next) => {
                                const target = next.org.role_assignments[index];
                                if (target) target.role_id = event.target.value;
                              })}>
                                {mergeLookupOptionsWithCurrent(snapshot.directories.participant_roles ?? [], [assignment.role_id]).map((role) => (
                                  <option key={role.id} value={role.id}>{role.name}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Заметки">
                              <input className="text-input" value={assignment.note ?? ""} onChange={(event) => updateDraft((next) => {
                                const target = next.org.role_assignments[index];
                                if (target) target.note = event.target.value;
                              })} />
                            </Field>
                            <Field label="Уровень">
                              <select className="select-input" value={normalizeParticipantRoleLevel(assignment.level) ?? ""} onChange={(event) => updateDraft((next) => {
                                const target = next.org.role_assignments[index];
                                if (target) target.level = event.target.value;
                              })}>
                                {roleLevelOptions.map((option) => <option key={option.id || "__empty"} value={option.id}>{option.label}</option>)}
                              </select>
                            </Field>
                            <Field label="Активность роли">
                              <select className="select-input" value={assignment.active ? "yes" : "no"} onChange={(event) => updateDraft((next) => {
                                const target = next.org.role_assignments[index];
                                if (target) target.active = event.target.value === "yes";
                              })}>
                                <option value="yes">Активная</option>
                                <option value="no">Неактивная</option>
                              </select>
                            </Field>
                          </div>
                        ) : (
                          <div className="section-stack compact">
                            <div className="compact-row">
                              <strong>{getLookupLabel(roleNameById, assignment.role_id, "Роль не указана")}</strong>
                              <span className="muted">
                                {assignment.note?.trim()
                                  ? assignment.note
                                  : assignment.department_id
                                    ? `Отдел: ${getLookupLabel(departmentNameById, assignment.department_id, "Отдел не указан")}`
                                    : "без заметки"}
                              </span>
                            </div>
                            <div className="compact-row">
                              <span className="muted">{normalizeParticipantRoleLevel(assignment.level) || "уровень не указан"}</span>
                              <span className="muted">{assignment.active ? "активная" : "неактивная"}</span>
                            </div>
                          </div>
                        )}
                        <div className="row spread">
                          <Chip tone={assignment.active ? "accent" : undefined}>{assignment.active ? "Активная" : "Неактивная"}</Chip>
                          {screenMode !== "view" ? (
                            <div className="row">
                              {isEditingRole ? (
                                <>
                                  <Button className="secondary" onClick={() => setEditingRoleAssignmentIndex(null)}>Готово</Button>
                                  <Button className="danger" onClick={() => updateDraft((next) => { next.org.role_assignments = next.org.role_assignments.filter((_, position) => position !== index); })}>Удалить</Button>
                                </>
                              ) : (
                                <Button className="secondary" onClick={() => setEditingRoleAssignmentIndex(index)}>Редактировать</Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }) : <EmptyState title="Роли еще не заданы" body="Добавьте роль участника, чтобы показать его рабочие задачи внутри команды." />}
                </div>
              </div>
            ) : null}
            {activeTab === "skills" ? (
              <div className="section-stack">
                <Field label="Навыки">
                  <OptionChipGroup
                    options={skillOptions.map((item) => ({ id: item.id, label: item.name }))}
                    selectedIds={draft.org.skill_entries.map((item) => item.skill_id)}
                    onToggle={(skillId) => updateDraft((next) => {
                      if (next.org.skill_entries.some((item) => item.skill_id === skillId)) {
                        next.org.skill_entries = next.org.skill_entries.filter((item) => item.skill_id !== skillId);
                        return;
                      }
                      next.org.skill_entries = [
                        ...next.org.skill_entries,
                        { skill_id: skillId, level: "", confirmed: true, confirmed_by: null, note: "" }
                      ];
                    })}
                  />
                </Field>
                <Field label="Дикция">
                  <OptionChipGroup
                    options={DICTION_LEVEL_OPTIONS.map((item) => ({ id: item.id, label: item.label }))}
                    selectedIds={getParticipantDictionLevel(draft) ? [getParticipantDictionLevel(draft) as string] : []}
                    onToggle={(levelId) => updateDraft((next) => {
                      const currentLevel = getParticipantDictionLevel(next);
                      next.org.specialization_entries = next.org.specialization_entries.filter((item) => item.specialization_id !== "diction");
                      if (currentLevel === levelId) {
                        return;
                      }
                      next.org.specialization_entries = [
                        ...next.org.specialization_entries,
                        { specialization_id: "diction", level: levelId, priority: 1, comment: "" }
                      ];
                    })}
                  />
                </Field>
                <Field
                  label="Рост в озвучке"
                  help="Здесь отмечаются только актерские направления роста. Управленческие и производственные роли сюда не относятся."
                  hint="Выберите, в каком актерском направлении участник хочет расти или проходить обучение."
                >
                  <OptionChipGroup
                    options={PARTICIPANT_GROWTH_INTENT_OPTIONS.map((item) => ({ id: item.id, label: item.label }))}
                    selectedIds={draft.org.desired_role_ids}
                    onToggle={(intentId) => updateDraft((next) => {
                      next.org.desired_role_ids = toggleId(next.org.desired_role_ids, intentId);
                    })}
                  />
                </Field>
                <Field label="Сильные стороны и пометки">
                  <OptionChipGroup
                    options={STAFFING_FLAG_OPTIONS}
                    selectedIds={draft.org.staffing_flags}
                    onToggle={(flag) => updateDraft((next) => {
                      next.org.staffing_flags = toggleId(next.org.staffing_flags, flag);
                    })}
                  />
                </Field>
                <Field label="Ограничения и комментарий"><textarea className="text-area" value={draft.profile.availability_note ?? ""} onChange={(event) => updateDraft((next) => { next.profile.availability_note = event.target.value; })} /></Field>
              </div>
            ) : null}
            {activeTab === "equipment" ? (
              <div className="section-stack">
                <div className="details-grid">
                  <Field label="Состояние сетапа">
                    <select className="select-input" value={draft.equipment.equipment_status ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.equipment_status = event.target.value; })}>
                      <option value="">Не указано</option>
                      <option value="full">Полный сетап</option>
                      <option value="limited">Есть ограничения</option>
                      <option value="needs_check">Нужно уточнить</option>
                      <option value="no_mic">Без микрофона</option>
                    </select>
                  </Field>
                  <Field label="Микрофон"><input className="text-input" value={draft.equipment.microphone_type ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.microphone_type = event.target.value; })} /></Field>
                  <Field label="Аудиоинтерфейс"><input className="text-input" value={draft.equipment.audio_interface ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.audio_interface = event.target.value; })} /></Field>
                  <Field label="Помещение">
                    <select className="select-input" value={draft.equipment.recording_space_quality ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.recording_space_quality = event.target.value; })}>
                      <option value="">Не указано</option>
                      <option value="good">Хорошее</option>
                      <option value="acceptable">Приемлемое</option>
                      <option value="needs_work">Нужно доработать</option>
                    </select>
                  </Field>
                  <Field label="Мониторинг"><input className="text-input" value={draft.equipment.monitoring ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.monitoring = event.target.value; })} /></Field>
                  <Field label="Софт"><input className="text-input" value={draft.equipment.software_stack ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.software_stack = event.target.value; })} /></Field>
                </div>
                <Field label="Техническая заметка"><textarea className="text-area" value={draft.equipment.hardware_notes ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.hardware_notes = event.target.value; })} /></Field>
                <Field label="Ограничения"><textarea className="text-area" value={draft.equipment.equipment_limitations ?? ""} onChange={(event) => updateDraft((next) => { next.equipment.equipment_limitations = event.target.value; })} /></Field>
              </div>
            ) : null}
            {activeTab === "voice" ? (
              <div className="section-stack">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button className="secondary" onClick={enableVoiceSample}>Добавить пробу голоса</Button>
                  <Button
                    className="secondary"
                    onClick={() => void window.fronda.openResource(getVoiceSampleResource(draft.voice_sample))}
                    disabled={!getVoiceSampleResource(draft.voice_sample)}
                  >
                    Проба
                  </Button>
                  <Chip tone={draft.voice_sample.voice_sample_present ? "accent" : undefined}>{draft.voice_sample.voice_sample_present ? "Проба добавлена" : "Пробы нет"}</Chip>
                </div>
                <div className="grid two">
                  <Field label="Ссылка или путь к пробе" help="Укажите одну основную ссылку или путь. Кнопка «Проба» откроет этот адрес или локальный файл."><input className="text-input" value={draft.voice_sample.voice_sample_url ?? ""} onChange={(event) => updateDraft((next) => { next.voice_sample.voice_sample_url = event.target.value; next.voice_sample.voice_sample_present = Boolean(event.target.value); })} /></Field>
                  <Field label="Статус проверки">
                    <select className="select-input" value={draft.voice_sample.voice_sample_review_status ?? ""} onChange={(event) => updateDraft((next) => { next.voice_sample.voice_sample_review_status = event.target.value; })}>
                      <option value="">Не указано</option>
                      <option value="new">Новая</option>
                      <option value="in_review">На проверке</option>
                      <option value="approved">Подтверждена</option>
                      <option value="recheck">Нужно переслушать</option>
                    </select>
                  </Field>
                  <Field label="Дата добавления"><input className="text-input" value={formatDate(draft.voice_sample.voice_sample_uploaded_at)} readOnly /></Field>
                </div>
                <Field label="Комментарий по пробе"><textarea className="text-area" value={draft.voice_sample.voice_sample_comment ?? ""} onChange={(event) => updateDraft((next) => { next.voice_sample.voice_sample_comment = event.target.value; })} /></Field>
                <Field label="Теги пробы"><OptionChipGroup options={VOICE_TAG_OPTIONS} selectedIds={draft.voice_sample.voice_tags} onToggle={(tag) => updateDraft((next) => { next.voice_sample.voice_tags = toggleId(next.voice_sample.voice_tags, tag); })} /></Field>
              </div>
            ) : null}
            {activeTab === "releases" ? (
              <div className="section-stack">
                <div className="detail-card">
                  <h4>Добавить связь с релизом</h4>
                  <div className="grid two">
                    <Field label="Релиз">
                      <select className="select-input" value={releaseLinkTargetId} onChange={(event) => setReleaseLinkTargetId(event.target.value)}>
                        <option value="">Выберите релиз</option>
                        {releaseLinkOptions.map((release) => <option key={release.release.id} value={release.release.id}>{getReleaseDisplayTitle(release.release)}</option>)}
                      </select>
                    </Field>
                    <Field label="Роль на релизе">
                      <select className="select-input" value={releaseLinkRoleId} onChange={(event) => setReleaseLinkRoleId(event.target.value)}>
                        {roleOptions.length ? roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>) : <option value={releaseLinkRoleId}>{releaseLinkRoleId}</option>}
                      </select>
                    </Field>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Button className="secondary" onClick={() => void addReleaseLink()}>Добавить связь</Button>
                  </div>
                </div>
                <div className="list">
                  {relatedReleases.length ? relatedReleases.map((release) => <div key={release.release.id} className="list-item"><div className="row spread"><div><h3 title={getReleaseTitleSegments(release.release).join(" / ")}>{getReleaseDisplayTitle(release.release)}</h3><div className="muted" title={`${translateCode(release.release.release_status_id)} • ${describeParticipantReleaseLink(release, draft.profile.id, roleNameById)}`}>{translateCode(release.release.release_status_id)} • {describeParticipantReleaseLink(release, draft.profile.id, roleNameById)}</div></div><div className="row"><Chip>{release.release.release_year ?? "—"}</Chip><Button className="ghost" onClick={() => onOpenRelease(release.release.id)}>Открыть релиз</Button></div></div></div>) : <EmptyState title="История релизов пока пуста" body="Этот участник пока не привязан ни к одному релизному назначению в текущем наборе данных." />}</div>
              </div>
            ) : null}
            {activeTab === "notes" ? (
              <div className="section-stack">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button className="secondary" onClick={addNote}>Создать заметку</Button>
                </div>
                <div className="list compact-list">
                  {draft.notes.length ? draft.notes.map((note) => (
                    <div key={note.id} className="list-item subdued">
                      <div className="grid two">
                        <Field label="Заголовок"><input className="text-input" value={note.title} onChange={(event) => updateDraft((next) => { const target = next.notes.find((item) => item.id === note.id); if (target) target.title = event.target.value; })} /></Field>
                        <Field label="Тип заметки">
                          <select className="select-input" value={note.note_type_id} onChange={(event) => updateDraft((next) => { const target = next.notes.find((item) => item.id === note.id); if (target) target.note_type_id = event.target.value; })}>
                            {mergeLookupOptionsWithCurrent(snapshot.directories.note_types ?? [], [note.note_type_id]).length
                              ? mergeLookupOptionsWithCurrent(snapshot.directories.note_types ?? [], [note.note_type_id]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
                              : <option value={note.note_type_id}>{note.note_type_id}</option>}
                          </select>
                        </Field>
                        <Field label="Приоритет">
                          <select className="select-input" value={note.priority} onChange={(event) => updateDraft((next) => { const target = next.notes.find((item) => item.id === note.id); if (target) target.priority = event.target.value as ParticipantNote["priority"]; })}>
                            <option value="low">Низкий</option>
                            <option value="normal">Обычный</option>
                            <option value="high">Высокий</option>
                            <option value="critical">Критичный</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="Текст заметки"><textarea className="text-area" value={note.body} onChange={(event) => updateDraft((next) => { const target = next.notes.find((item) => item.id === note.id); if (target) target.body = event.target.value; })} /></Field>
                      <div className="row spread">
                        <Chip tone={note.pinned ? "accent" : undefined}>{note.pinned ? "Закреплена" : "Обычная"}</Chip>
                        <div className="row">
                          <Button className="secondary" onClick={() => updateDraft((next) => { const target = next.notes.find((item) => item.id === note.id); if (target) target.pinned = !target.pinned; })}>{note.pinned ? "Открепить" : "Закрепить"}</Button>
                          <Button className="danger" onClick={() => updateDraft((next) => { next.notes = next.notes.filter((item) => item.id !== note.id); })}>Удалить</Button>
                        </div>
                      </div>
                    </div>
                  )) : <EmptyState title="Рабочих заметок пока нет" body="Здесь живут режиссерские, технические и коммуникационные заметки, отдельно от дисциплины." />}
                </div>
              </div>
            ) : null}
            {activeTab === "discipline" ? (
              <div className="section-stack">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button className="secondary" onClick={() => addDisciplineEvent("remark")}>Добавить замечание</Button>
                  <Button className="secondary" onClick={() => addDisciplineEvent("warning")}>Добавить предупреждение</Button>
                  <Button className="danger" onClick={() => addDisciplineEvent("block")}>Добавить блок</Button>
                </div>
                <div className="list compact-list">
                  {draft.discipline.length ? draft.discipline.map((item) => {
                    const isEditingDiscipline = screenMode !== "view" && editingDisciplineId === item.id;
                    return (
                      <div key={item.id} className="list-item subdued">
                        {isEditingDiscipline ? (
                          <>
                            <div className="grid two">
                              <Field label="Тип события">
                                <select className="select-input" value={item.disciplinary_type_id} onChange={(event) => updateDraft((next) => { const target = next.discipline.find((entry) => entry.id === item.id); if (target) target.disciplinary_type_id = event.target.value; })}>
                                  {mergeLookupOptionsWithCurrent(snapshot.directories.disciplinary_types ?? [], [item.disciplinary_type_id]).length
                                    ? mergeLookupOptionsWithCurrent(snapshot.directories.disciplinary_types ?? [], [item.disciplinary_type_id]).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)
                                    : <option value={item.disciplinary_type_id}>{getDisciplineEventTitle(item, disciplineTypeNameById)}</option>}
                                </select>
                              </Field>
                              <Field label="Уровень">
                                <select className="select-input" value={item.severity} onChange={(event) => updateDraft((next) => { const target = next.discipline.find((entry) => entry.id === item.id); if (target) target.severity = event.target.value as DisciplinaryEvent["severity"]; })}>
                                  <option value="remark">Замечание</option>
                                  <option value="warning">Предупреждение</option>
                                  <option value="blacklist">Черный список</option>
                                  <option value="block">Блокировка</option>
                                </select>
                              </Field>
                              <Field label="Статус">
                                <select className="select-input" value={item.active_flag ? "active" : "resolved"} onChange={(event) => updateDraft((next) => { const target = next.discipline.find((entry) => entry.id === item.id); if (target) target.active_flag = event.target.value !== "resolved"; })}>
                                  <option value="active">Активно</option>
                                  <option value="resolved">Закрыто</option>
                                </select>
                              </Field>
                              <Field label="Дата"><input className="text-input" value={formatDate(item.date)} readOnly /></Field>
                            </div>
                            <Field label="Описание"><textarea className="text-area" value={item.description} onChange={(event) => updateDraft((next) => { const target = next.discipline.find((entry) => entry.id === item.id); if (target) target.description = event.target.value; })} /></Field>
                          </>
                        ) : (
                          <div className="section-stack compact">
                            <div className="compact-row">
                              <strong>{getDisciplineEventTitle(item, disciplineTypeNameById)}</strong>
                              <span className="muted">{formatDate(item.date)}</span>
                            </div>
                            <div className="compact-row">
                              <span className="muted">{translateCode(item.severity)}</span>
                              <span className="muted">{item.active_flag ? "Активно" : "Погашено"}</span>
                            </div>
                            {item.description ? <div className="muted">{item.description}</div> : null}
                          </div>
                        )}
                        <div className="row spread">
                          <Chip tone={item.active_flag ? "warning" : "success"}>{item.active_flag ? "Активно" : "Погашено"}</Chip>
                          {screenMode !== "view" ? (
                            <div className="row">
                              {isEditingDiscipline ? (
                                <>
                                  <Button className="secondary" onClick={saveDisciplineEditor}>Сохранить</Button>
                                  <Button className="danger" onClick={() => {
                                    updateDraft((next) => { next.discipline = next.discipline.filter((entry) => entry.id !== item.id); });
                                    setEditingDisciplineId(null);
                                  }}>Удалить</Button>
                                </>
                              ) : (
                                <Button className="secondary" onClick={() => startEditingDiscipline(item.id)}>Редактировать</Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }) : <EmptyState title="Дисциплинарных событий пока нет" body="Замечания, предупреждения и блокировки появятся здесь отдельным журналом." />}
                </div>
              </div>
            ) : null}
            {activeTab === "rewards" ? (
              <div className="section-stack">
                <div className="grid two">
                  <Field
                    label="Приоритет участия"
                    help="Показывает, на какие проекты участника стоит выводить в первую очередь."
                    hint="Приоритет хранится в рабочих пометках карточки и используется в сводках, фильтрах и быстрых подборках."
                  >
                    <select
                      className="select-input"
                      value={readParticipantPriority(draft.org.staffing_flags)}
                      onChange={(event) => updateDraft((next) => {
                        next.org.staffing_flags = writeParticipantPriority(
                          next.org.staffing_flags,
                          event.target.value as "normal" | "top" | "commercial" | "both"
                        );
                      })}
                    >
                      {PARTICIPANT_PRIORITY_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Chip tone={participantHasFlag(draft, "key_member") ? "accent" : undefined}>Ключевой участник</Chip>
                  <Chip tone={participantHasFlag(draft, "priority_top") ? "accent" : undefined}>Приоритет на топ-релизы</Chip>
                  <Chip tone={participantHasFlag(draft, "priority_commercial") ? "accent" : undefined}>Приоритет на заказные проекты</Chip>
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <Button className="secondary" onClick={addReward}>Добавить награду / пометку</Button>
                </div>
                <div className="list compact-list">
                  {draft.rewards.length ? draft.rewards.map((item) => {
                    const isEditingReward = screenMode !== "view" && editingRewardId === item.id;
                    return (
                      <div key={item.id} className="list-item subdued">
                        {isEditingReward ? (
                          <>
                            <Field label="Тип поощрения">
                              <select className="select-input" value={item.reward_type_id} onChange={(event) => updateDraft((next) => { const target = next.rewards.find((entry) => entry.id === item.id); if (target) target.reward_type_id = event.target.value; })}>
                                {mergeLookupOptionsWithCurrent(snapshot.directories.reward_types ?? [], [item.reward_type_id]).length
                                  ? mergeLookupOptionsWithCurrent(snapshot.directories.reward_types ?? [], [item.reward_type_id]).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)
                                  : <option value={item.reward_type_id}>{getLookupLabel(rewardTypeNameById, item.reward_type_id, "Награда")}</option>}
                              </select>
                            </Field>
                            <Field label="Описание"><input className="text-input" value={item.description} onChange={(event) => updateDraft((next) => { const target = next.rewards.find((entry) => entry.id === item.id); if (target) target.description = event.target.value; })} /></Field>
                            <Field label="Дата"><input className="text-input" value={formatDate(item.date)} readOnly /></Field>
                            <Field label="Пометки">
                              <OptionChipGroup options={REWARD_TAG_OPTIONS} selectedIds={item.tags} onToggle={(tag) => updateDraft((next) => { const target = next.rewards.find((entry) => entry.id === item.id); if (target) target.tags = toggleId(target.tags, tag); })} />
                            </Field>
                          </>
                        ) : (
                          <div className="section-stack compact">
                            <div className="compact-row">
                              <strong>{getRewardDisplayTitle(item, rewardTypeNameById)}</strong>
                              <span className="muted">{formatDate(item.date)}</span>
                            </div>
                            <div className="muted">{getRewardTagsLabel(item.tags, "без пометок")}</div>
                            {item.description && item.description !== getRewardDisplayTitle(item, rewardTypeNameById) ? <div className="muted">{item.description}</div> : null}
                          </div>
                        )}
                        <div className="row spread">
                          <div className="muted">{isEditingReward ? getRewardTagsLabel(item.tags, "без пометок") : ""}</div>
                          {screenMode !== "view" ? (
                            <div className="row">
                              {isEditingReward ? (
                                <>
                                  <Button className="secondary" onClick={saveRewardEditor}>Сохранить</Button>
                                  <Button className="danger" onClick={() => {
                                    updateDraft((next) => { next.rewards = next.rewards.filter((entry) => entry.id !== item.id); });
                                    setEditingRewardId(null);
                                  }}>Удалить</Button>
                                </>
                              ) : (
                                <Button className="secondary" onClick={() => startEditingReward(item.id)}>Редактировать</Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }) : <EmptyState title="Поощрений пока нет" body="Здесь хранятся награды, инициативность и приоритеты на ключевые релизы." />}
                </div>
              </div>
            ) : null}
            {activeTab === "posting" ? (
              <div className="section-stack">
                <div className="muted">Подпись и готовая строка для поста собираются автоматически из основной карточки участника.</div>
                <div className="grid two">
                  <Field label="Упоминание VK" help="То, что можно вставить в пост как активное упоминание, например @mr.nikanor."><input className="text-input" value={draft.profile.posting.mention ?? ""} onChange={(event) => updateDraft((next) => { next.profile.posting.mention = event.target.value; })} /></Field>
                  <Field label="Подпись в посте" help="Это имя берется из ника участника в обзоре. Если подпись для поста должна измениться, поправьте ник в основной карточке."><input className="text-input" value={getParticipantPostDisplayName(draft)} readOnly /></Field>
                  <Field label="Короткий адрес VK" help="Короткая часть адреса после vk.com/. Полная ссылка соберется автоматически."><input className="text-input" value={draft.profile.posting.vk_slug ?? ""} onChange={(event) => updateDraft((next) => { next.profile.posting.vk_slug = event.target.value; })} /></Field>
                  <Field label="Полная ссылка VK" help="Автоматически собирается из короткого адреса, если он указан."><input className="text-input" value={draft.profile.posting.vk_url ?? ""} readOnly /></Field>
                  <Field label="Идентификатор упоминания" help="Внутренний идентификатор упоминания нужен только для тех случаев, где платформа требует отдельный ID."><input className="text-input" value={draft.profile.posting.mention_id ?? ""} onChange={(event) => updateDraft((next) => { next.profile.posting.mention_id = event.target.value; })} /></Field>
                </div>
                <div className="detail-card">
                  <h4>Готовые строки для копирования</h4>
                  <div className="compact-row"><strong>Упоминание VK</strong><span className="muted" title={draft.profile.posting.mention || "не указано"}>{draft.profile.posting.mention || "не указано"}</span></div>
                  <div className="compact-row"><strong>Имя</strong><span className="muted" title={getParticipantPostDisplayName(draft)}>{getParticipantPostDisplayName(draft)}</span></div>
                  <div className="compact-row"><strong>Формат поста</strong><span className="muted" title={buildPostCopyString(draft)}>{buildPostCopyString(draft)}</span></div>
                  <div className="row" style={{ flexWrap: "wrap", marginTop: 12 }}>
                    <Button className="secondary" onClick={() => void window.fronda.copyText(draft.profile.posting.mention ?? "")}>Копировать упоминание</Button>
                    <Button className="secondary" onClick={() => void window.fronda.copyText(getParticipantPostDisplayName(draft))}>Копировать имя</Button>
                    <Button className="secondary" onClick={() => void window.fronda.copyText(buildPostCopyString(draft))}>Копировать формат для поста</Button>
                    <Button className="secondary" onClick={() => void window.fronda.copyText(draft.profile.posting.vk_url ?? "")}>Копировать ссылку</Button>
                  </div>
                </div>
              </div>
            ) : null}
            {activeTab === "history" ? (
              <div className="section-stack">
                <div className="list compact-list">
                  {draft.history?.length ? draft.history.map((item) => <div key={item.id} className="list-item subdued"><div className="row spread"><div><strong>{item.summary || item.action}</strong><div className="muted">{formatDate(item.at)} • {item.actor}</div></div><Chip>{translateCode(item.source ?? "manual")}</Chip></div><div className="muted">Источник изменения: {translateCode(item.source ?? "manual")}{item.import_batch_id ? " • из файла импорта" : ""}</div>{showTechnicalInfo ? <div className="muted">Версия: {item.revision ?? "—"} • файл: {item.file_path ?? "ручное изменение"}</div> : null}</div>) : <EmptyState title="История изменений пока пуста" body="Здесь появятся ручные, импортные и восстановительные версии карточки участника." />}
                </div>
                {showTechnicalInfo ? <Field label="Служебные сведения"><textarea className="text-area json-box" value={toPrettyJson(draft.entity_manifest)} readOnly /></Field> : null}
              </div>
            ) : null}
          </div>
        )}
      </Panel>
      ) : null}
      </div>
      </ScrollRegion>
      <ScrollRegion scrollKey={`composition:summary:${selectedId || "empty"}`}>
      <Panel title="Сводка по участнику" subtitle="Краткий статус, 3-5 главных действий и быстрый переход к полной карточке.">
        {!currentParticipant ? <EmptyState title="Сводка недоступна" body="Сначала выберите участника в центральном реестре." /> : (
          <div className="section-stack">
            <div className="detail-card sticky-actions-card">
              <h4>Быстрые действия</h4>
              <div className="dashboard-actions">
                {screenMode === "view" ? <Button className="secondary" onClick={() => setDetailExpanded((value) => !value)}>{detailMode ? "Вернуться к реестру" : "Открыть полный обзор"}</Button> : null}
                {screenMode === "view" ? <Button className="primary" onClick={beginEditing} disabled={isSaving}>Редактировать</Button> : null}
                {screenMode === "view" ? <Button className="danger" onClick={() => setPendingDeleteParticipant(true)} disabled={isSaving}>Удалить участника</Button> : null}
                <Button className="secondary" onClick={addNote} disabled={isSaving}>Заметка</Button>
                <Button className="secondary" onClick={() => addDisciplineEvent("warning")} disabled={isSaving}>Предупреждение</Button>
                <ActionMenu label="Еще действия">
                  <ActionMenuItem onClick={addReward} disabled={isSaving}>Добавить поощрение</ActionMenuItem>
                  <ActionMenuItem onClick={enableVoiceSample} disabled={isSaving}>Добавить пробу голоса</ActionMenuItem>
                  <ActionMenuItem onClick={() => onNavigate("imports")}>Открыть импорт</ActionMenuItem>
                  <ActionMenuItem onClick={() => void toggleArchiveParticipant()} disabled={isSaving}>{isParticipantArchivedEntity(currentParticipant) ? "Восстановить" : "Архивировать"}</ActionMenuItem>
                </ActionMenu>
              </div>
            </div>
            <div className="detail-card">
              <h4>Быстрый статус</h4>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Chip tone={selectedView?.reliable ? "success" : undefined}>{selectedView?.reliabilityLevel ?? "—"}</Chip>
                <Chip tone={selectedView?.topReleaseFit ? "accent" : undefined}>{selectedView?.topReleaseFit ? "топ-релизы" : "обычный приоритет"}</Chip>
                {selectedView?.commercialFit ? <Chip tone="accent">заказные проекты</Chip> : null}
                {hasParticipantBlacklist(currentParticipant) ? <Chip tone="danger">ЧЕРНЫЙ СПИСОК</Chip> : null}
                <Chip>{`Загруженность: ${selectedView?.releaseLoadLabel ?? "нет"}`}</Chip>
                <Chip tone={participantNeedsAttention(currentParticipant) ? "warning" : "success"}>
                  {participantNeedsAttention(currentParticipant) ? "Есть проблемы" : "Проблем нет"}
                </Chip>
              </div>
            </div>
            <div className="detail-card">
              <h4>Коротко</h4>
              <div className="summary-key-list">
                <div className="compact-row"><strong>Дисциплина</strong><span className="muted">{getParticipantDisciplineSummary(currentParticipant)}</span></div>
                <div className="compact-row"><strong>Должность</strong><span className="muted">{participantStructureAssignments.length ? participantStructureAssignments.map((item) => structurePositionNameById.get(item.position_id) ?? "Должность не найдена").join(", ") : "не назначена"}</span></div>
                <div className="compact-row"><strong>Произношение ника</strong><span className="muted" title={currentParticipant.profile.nickname_pronunciation || "не указано"}>{currentParticipant.profile.nickname_pronunciation || "не указано"}</span></div>
                <div className="compact-row"><strong>Упоминание VK</strong><span className="muted" title={currentParticipant.profile.posting.mention || "не указано"}>{currentParticipant.profile.posting.mention || "не указано"}</span></div>
                <div className="compact-row"><strong>Полная ссылка VK</strong><span className="muted" title={currentParticipant.profile.posting.vk_url || currentParticipant.profile.posting.vk_slug || "не указана"}>{currentParticipant.profile.posting.vk_url || currentParticipant.profile.posting.vk_slug || "не указана"}</span></div>
                <div className="compact-row"><strong>Готовая строка для поста</strong><span className="muted" title={buildPostCopyString(currentParticipant)}>{buildPostCopyString(currentParticipant)}</span></div>
              </div>
            </div>
            <div className="detail-card">
              <h4>Связь</h4>
              <div className="summary-key-list">
                <div className="compact-row"><strong>MAX</strong><span className="muted">{currentParticipant.profile.contact_max || "не указан"}</span></div>
                <div className="compact-row"><strong>Telegram</strong><span className="muted">{currentParticipant.profile.contact_telegram || "не указан"}</span></div>
                <div className="compact-row"><strong>Телефон</strong><span className="muted">{currentParticipant.profile.contact_phone || "не указан"}</span></div>
                <div className="compact-row"><strong>VK</strong><span className="muted">{currentParticipant.profile.contact_vk || currentParticipant.profile.posting.vk_url || "не указан"}</span></div>
                {currentParticipant.profile.contacts.map(parseAdditionalContactEntry).filter((entry) => entry.label || entry.value).slice(0, 2).map((entry, index) => (
                  <div key={`summary-contact-${index}`} className="compact-row">
                    <strong>{entry.label || `Дополнительно ${index + 1}`}</strong>
                    <span className="muted">{entry.value || "не указано"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="detail-card">
              <h4>Ближайшие и связанные релизы</h4>
              {nextReleaseCandidates.length ? nextReleaseCandidates.slice(0, 3).map((release) => (
                <div key={release.release.id} className="compact-row">
                  <strong>{getReleaseDisplayTitle(release.release)}</strong>
                  <span className="muted">
                    {curatedReleases.some((item) => item.release.id === release.release.id) ? "Куратор" : "Участник"}
                  </span>
                  <Button className="ghost" onClick={() => onOpenRelease(release.release.id)}>Открыть</Button>
                </div>
              )) : <div className="muted">Связанных релизов пока нет.</div>}
            </div>
            <div className="detail-card">
              <h4>Сводка по работе</h4>
              <div className="compact-row"><strong>Структурные назначения</strong><span className="muted">{participantStructureAssignments.length}</span></div>
              <div className="compact-row"><strong>Временные полномочия</strong><span className="muted">{participantTemporaryAssignments.length}</span></div>
              <div className="compact-row"><strong>Замещения</strong><span className="muted">{participantSubstitutions.asSubstitute.length + participantSubstitutions.asSource.length}</span></div>
              <div className="compact-row"><strong>Курирует релизы</strong><span className="muted">{formatSimpleCount(curatedReleases.length, "релиз", "релизов")}</span></div>
              <div className="compact-row"><strong>Релизы</strong><span className="muted">{formatSimpleCount(selectedView?.releaseCount ?? 0, "релиз", "релизов")}</span></div>
              <div className="compact-row"><strong>Загруженность релизами</strong><span className="muted">{selectedView?.releaseLoadLabel ?? "нет"}</span></div>
              <div className="compact-row"><strong>Активная дисциплина</strong><span className="muted">{getParticipantDisciplineSummary(currentParticipant)}</span></div>
              <div className="compact-row"><strong>Закрепленные заметки</strong><span className="muted">{pinnedNotes.length}</span></div>
            </div>
            {showTechnicalInfo ? <div className="detail-card">
              <h4>Служебные сведения</h4>
              <div className="muted mono">{currentParticipant.profile.id}</div>
              <div className="muted mono">Внутренняя версия записи: {currentParticipant.entity_manifest.entity_revision}</div>
              <div className="muted">Последнее изменение: {translateCode(currentParticipant.history?.[currentParticipant.history.length - 1]?.source ?? "manual")}</div>
            </div> : null}
          </div>
        )}
      </Panel>
      </ScrollRegion>
    </div>
    {pendingDeleteParticipant && sourceParticipant ? (
      <AppConfirmModal
        sectionLabel="Состав"
        title={`Удалить участника «${sourceParticipant.profile.display_name}»?`}
        message="Будет удалена карточка участника, а также очищены связанные назначения в структуре и привязки в релизах."
        confirmLabel="Удалить участника"
        confirmTone="danger"
        onConfirm={() => {
          setPendingDeleteParticipant(false);
          void deleteSelectedParticipant();
        }}
        onCancel={() => setPendingDeleteParticipant(false)}
      />
    ) : null}
    </>
  );
}

function ReleasesScreen({
  snapshot,
  onRefresh,
  actorName,
  selectedReleaseId,
  onDirtyChange,
  onOpenParticipant,
  onNavigate,
  restoredLocalDraft,
  onRestoredLocalDraftApplied,
  showAdvancedMode
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  selectedReleaseId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenParticipant: (id: string) => void;
  onNavigate: (section: NavigationSection) => void;
  restoredLocalDraft: LocalUnsavedDraftFile | null;
  onRestoredLocalDraftApplied: () => void;
  showAdvancedMode: boolean;
}) {
  const initialRelease = snapshot.releases.find((item) => !isReleaseArchivedEntity(item.release)) ?? snapshot.releases[0] ?? null;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [curatorFilter, setCuratorFilter] = useState("all");
  const [quickView, setQuickView] = useState<"all" | "in_work" | "completed" | "lost" | "archived" | "missing_post" | "missing_team">("all");
  const [selectedId, setSelectedId] = useState(selectedReleaseId ?? initialRelease?.release.id ?? "");
  const [activeTab, setActiveTab] = useState("overview");
  const [screenMode, setScreenMode] = useState<"view" | "edit" | "create">("view");
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [restoredDraftActive, setRestoredDraftActive] = useState(false);
  const [releaseNotice, setReleaseNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [pendingDeleteRelease, setPendingDeleteRelease] = useState(false);
  const [draft, setDraft] = useState<ReleaseAggregate | null>(initialRelease ? cloneJson(initialRelease) : null);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [generated, setGenerated] = useState<{ title: string; content: string; warnings: string[] } | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState("");
  const [savedPostPreviewId, setSavedPostPreviewId] = useState<string | null>(null);
  const [newExternalVariant, setNewExternalVariant] = useState<ReleaseExternalVariantId>("translator");
  const [newExternalSourceId, setNewExternalSourceId] = useState(
    filterVisibleLookupRecords(snapshot.externalSources)[0]?.id ?? snapshot.externalSources[0]?.id ?? ""
  );
  const [newReleaseRoleParticipantId, setNewReleaseRoleParticipantId] = useState("");
  const [editingReleaseRoleIds, setEditingReleaseRoleIds] = useState<string[]>([]);
  const [newPlatformId, setNewPlatformId] = useState(
    filterVisibleLookupRecords(snapshot.directories.platforms ?? []).find((item) => item.id === "kodik")?.id
    ?? filterVisibleLookupRecords(snapshot.directories.platforms ?? []).find((item) => item.id === "vk")?.id
    ?? filterVisibleLookupRecords(snapshot.directories.platforms ?? [])[0]?.id
    ?? snapshot.directories.platforms?.[0]?.id
    ?? ""
  );
  const [newPlatformName, setNewPlatformName] = useState("");
  const [releaseArchiveChoiceOpen, setReleaseArchiveChoiceOpen] = useState(false);
  const [releasePointerDrag, setReleasePointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragReleaseId, setDragReleaseId] = useState<string | null>(null);
  const [dragReleaseTargetId, setDragReleaseTargetId] = useState<string | null>(null);
  const [releaseDragPreviewIds, setReleaseDragPreviewIds] = useState<string[] | null>(null);
  const [releaseCommittedOrderIds, setReleaseCommittedOrderIds] = useState<string[] | null>(null);
  const releaseDragBaseIdsRef = useRef<string[] | null>(null);
  const releaseArchiveChoiceResolveRef = useRef<((value: "archived" | "archived_dropped" | null) => void) | null>(null);
  const [releaseParticipantPointerDrag, setReleaseParticipantPointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragReleaseParticipantId, setDragReleaseParticipantId] = useState<string | null>(null);
  const [dragReleaseParticipantTargetId, setDragReleaseParticipantTargetId] = useState<string | null>(null);
  const [releaseParticipantDragPreviewIds, setReleaseParticipantDragPreviewIds] = useState<string[] | null>(null);
  const releaseParticipantDragBaseIdsRef = useRef<string[] | null>(null);
  const [releaseExternalPointerDrag, setReleaseExternalPointerDrag] = useState<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const [dragReleaseExternalId, setDragReleaseExternalId] = useState<string | null>(null);
  const [dragReleaseExternalTargetId, setDragReleaseExternalTargetId] = useState<string | null>(null);
  const [releaseExternalDragPreviewIds, setReleaseExternalDragPreviewIds] = useState<string[] | null>(null);
  const releaseExternalDragBaseIdsRef = useRef<string[] | null>(null);
  const suppressReleaseClickRef = useRef(false);
  const releaseViews = useMemo(() => buildReleaseViews(snapshot), [snapshot]);
  const activeDepartments = useMemo(() => filterVisibleLookupRecords(snapshot.departments), [snapshot.departments]);
  const releaseStatusOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.release_statuses ?? []), [snapshot.directories.release_statuses]);
  const releaseStatusCategoryEnabled = releaseStatusOptions.length > 0;
  const releaseTypeOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.release_types ?? []), [snapshot.directories.release_types]);
  const releaseTypeCategoryEnabled = releaseTypeOptions.length > 0;
  const roleOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.participant_roles ?? []), [snapshot.directories.participant_roles]);
  const participantPickerSourceItems = useMemo(
    () => buildParticipantPickerSourceItems(snapshot.participantList, snapshot.participants),
    [snapshot.participantList, snapshot.participants]
  );
  const participantPickerOptions = useMemo(
    () => sortParticipantPickerItems(filterSelectableParticipantList(participantPickerSourceItems)),
    [participantPickerSourceItems]
  );
  const defaultReleaseRoleId = roleOptions.find((item) => item.id === "voice_cast")?.id ?? roleOptions[0]?.id ?? "voice_cast";
  const tagOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.tags ?? []), [snapshot.directories.tags]);
  const platformOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.platforms ?? []), [snapshot.directories.platforms]);
  const genreOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.genres ?? []), [snapshot.directories.genres]);
  const templateOptions = useMemo(() => filterVisibleLookupRecords(snapshot.templates ?? []), [snapshot.templates]);
  const activeExternalSources = useMemo(() => filterVisibleLookupRecords(snapshot.externalSources), [snapshot.externalSources]);
  const departmentNameById = useMemo(() => new Map(snapshot.departments.map((item) => [item.id, item.name])), [snapshot.departments]);
  const releaseTypeNameById = useMemo(() => new Map(releaseTypeOptions.map((item) => [item.id, item.name])), [releaseTypeOptions]);
  const roleNameById = useMemo(() => new Map(roleOptions.map((item) => [item.id, item.name])), [roleOptions]);
  const skillNameById = useMemo(() => new Map((snapshot.directories.skills ?? []).map((item) => [item.id, item.name])), [snapshot.directories.skills]);
  const specializationNameById = useMemo(() => new Map((snapshot.directories.specializations ?? []).map((item) => [item.id, item.name])), [snapshot.directories.specializations]);
  const participantNameById = useMemo(
    () => new Map(participantPickerSourceItems.map((item) => [item.id, item.displayName || item.nickname || item.id])),
    [participantPickerSourceItems]
  );
  const participantSearchTextById = useMemo(
    () => buildParticipantPickerSearchIndex(snapshot.participants, participantPickerSourceItems, {
      departmentNameById,
      roleNameById,
      skillNameById,
      specializationNameById
    }),
    [departmentNameById, participantPickerSourceItems, roleNameById, skillNameById, snapshot.participants, specializationNameById]
  );
  const platformNameById = useMemo(() => new Map((snapshot.directories.platforms ?? []).map((item) => [item.id, item.name])), [snapshot.directories.platforms]);
  const externalSourceNameById = useMemo(() => new Map(snapshot.externalSources.map((item) => [item.id, item.name])), [snapshot.externalSources]);
  const externalSourceTypeById = useMemo(() => new Map(snapshot.externalSources.map((item) => [item.id, item.external_source_type_id])), [snapshot.externalSources]);
  const availableExternalSourceOptions = useMemo(() => {
    if (newExternalVariant === "vk_only") {
      return [];
    }
    return activeExternalSources.filter((item) => {
      const typeId = item.external_source_type_id ?? "translator";
      return typeId === newExternalVariant;
    });
  }, [activeExternalSources, newExternalVariant]);
  const genreNameById = useMemo(() => new Map((snapshot.directories.genres ?? []).map((item) => [item.id, item.name])), [snapshot.directories.genres]);
  const tagNameById = useMemo(() => new Map((snapshot.directories.tags ?? []).map((item) => [item.id, item.name])), [snapshot.directories.tags]);
  const templateNameById = useMemo(() => new Map(templateOptions.map((item) => [item.id, item.name])), [templateOptions]);
  const releaseById = useMemo(() => new Map(snapshot.releases.map((item) => [item.release.id, item])), [snapshot.releases]);
  const availableTemplates = useMemo(() => {
    if (!draft) return templateOptions;
    const filtered = templateOptions.filter((template) => {
      const departmentMatch =
        !template.applicable_department_ids?.length ||
        template.applicable_department_ids.includes(draft.release.primary_department_id);
      const typeMatch =
        !releaseTypeCategoryEnabled ||
        !template.applicable_release_type_ids?.length ||
        template.applicable_release_type_ids.includes(draft.release.release_type_id);
      return departmentMatch && typeMatch;
    });
    const requiredIds = [draft.posting.default_post_template_id, templateId].filter((value): value is string => Boolean(value));
    for (const requiredId of requiredIds) {
      const existing = filtered.some((template) => template.id === requiredId);
      const fallback = (snapshot.templates ?? []).find((template) => template.id === requiredId);
      if (!existing && fallback) {
        filtered.push(fallback);
      }
    }
    return filtered;
  }, [draft, releaseTypeCategoryEnabled, snapshot.templates, templateId, templateOptions]);
  const standardTemplate = useMemo(
    () =>
      (snapshot.templates ?? []).find((template) => template.id === STANDARD_POST_TEMPLATE_ID) ??
      templateOptions.find((template) => template.id === STANDARD_POST_TEMPLATE_ID) ??
      templateOptions[0],
    [snapshot.templates, templateOptions]
  );
  const sourceRelease = snapshot.releases.find((item) => item.release.id === selectedId) ?? null;
  const currentRelease = screenMode === "view" ? sourceRelease : draft;
  const selectedSavedPost = useMemo(() => {
    if (!savedPostPreviewId) {
      return null;
    }
    const baseRelease = screenMode === "view"
      ? (currentRelease ?? sourceRelease)
      : (draft ?? sourceRelease ?? currentRelease);
    return baseRelease?.generated_posts.find((item) => item.id === savedPostPreviewId) ?? null;
  }, [currentRelease, draft, savedPostPreviewId, screenMode, sourceRelease]);
  const currentStaffingMode = draft ? getReleaseStaffingMode(draft.release) : "confirmed";
  const currentReleaseUniqueParticipantCount = currentRelease ? getReleaseUniqueParticipantCount(currentRelease) : 0;
  const orderedReleaseParticipants = useMemo(() => {
    if (!draft) {
      return [];
    }
    if (!releaseParticipantDragPreviewIds?.length) {
      return draft.participants;
    }
    const orderMap = new Map(releaseParticipantDragPreviewIds.map((id, index) => [id, index]));
    return [...draft.participants].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [draft, releaseParticipantDragPreviewIds]);
  const orderedReleaseExternals = useMemo(() => {
    if (!draft) {
      return [];
    }
    if (!releaseExternalDragPreviewIds?.length) {
      return draft.external;
    }
    const orderMap = new Map(releaseExternalDragPreviewIds.map((id, index) => [id, index]));
    return [...draft.external].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [draft, releaseExternalDragPreviewIds]);
  const releaseRoleParticipantOptions = useMemo(() => {
    if (!draft) {
      return [];
    }
    const seen = new Set<string>();
    return draft.participants
      .map((item) => item.participant_id)
      .filter((participantId) => {
        if (!participantId || seen.has(participantId)) {
          return false;
        }
        seen.add(participantId);
        return true;
      })
      .map((participantId) => ({
        id: participantId,
        label: getParticipantPickerLabel(participantPickerSourceItems.find((item) => item.id === participantId) ?? {
          id: participantId,
          nickname: participantNameById.get(participantId) ?? participantId,
          displayName: participantNameById.get(participantId) ?? participantId,
          status: "active",
          departmentIds: [],
          roleIds: [],
          activityLevel: "",
          reliabilityLevel: "",
          warningCount: 0,
          hasVoiceSample: false,
          topReleaseFit: false
        }),
        searchText: participantSearchTextById.get(participantId) ?? participantNameById.get(participantId) ?? participantId
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ru", { sensitivity: "base" }));
  }, [draft, participantNameById, participantPickerSourceItems, participantSearchTextById]);
  const ageRatingOptions = useMemo(
    () => getReleaseAgeRatingChoices(draft ?? currentRelease),
    [draft, currentRelease]
  );
  const showTechnicalInfo = showAdvancedMode;
  const dirty = screenMode !== "view" && draft ? (screenMode === "create" ? true : draftDirty) : false;
  const detailMode = detailExpanded || screenMode !== "view";
  const releaseArchiveChoiceOverlay = releaseArchiveChoiceOpen ? (
    <ReleaseArchiveChoiceModal
      onDropped={() => resolveReleaseArchiveChoice("archived_dropped")}
      onRegularArchive={() => resolveReleaseArchiveChoice("archived")}
      onCancel={() => resolveReleaseArchiveChoice(null)}
    />
  ) : null;

  function resolveReleaseArchiveChoice(value: "archived" | "archived_dropped" | null) {
    setReleaseArchiveChoiceOpen(false);
    const resolver = releaseArchiveChoiceResolveRef.current;
    releaseArchiveChoiceResolveRef.current = null;
    resolver?.(value);
  }

  function promptReleaseArchiveChoice() {
    setReleaseArchiveChoiceOpen(true);
    return new Promise<"archived" | "archived_dropped" | null>((resolve) => {
      releaseArchiveChoiceResolveRef.current = resolve;
    });
  }

  useEffect(() => {
    const defaultParticipantId = releaseRoleParticipantOptions[0]?.id ?? "";
    if (!newReleaseRoleParticipantId || !releaseRoleParticipantOptions.some((item) => item.id === newReleaseRoleParticipantId)) {
      setNewReleaseRoleParticipantId(defaultParticipantId);
    }
  }, [newReleaseRoleParticipantId, releaseRoleParticipantOptions]);

  useEffect(() => {
    const defaultPlatformId =
      platformOptions.find((item) => item.id === "kodik")?.id
      ?? platformOptions.find((item) => item.id === "vk")?.id
      ?? platformOptions[0]?.id
      ?? "";
    if (!newPlatformId || !platformOptions.some((item) => item.id === newPlatformId)) {
      setNewPlatformId(defaultPlatformId);
    }
  }, [newPlatformId, platformOptions]);

  useEffect(() => {
    const next = releaseById.get(selectedId) ?? null;
    if (screenMode === "create") {
      if (draft?.release.id === selectedId) {
        return;
      }
      if (next) {
        setDraft(cloneJson(next));
        setDraftDirty(false);
        setEditingReleaseRoleIds([]);
        setGenerated(null);
        setGeneratedDraft("");
        setTemplateId(undefined);
        setSavedPostPreviewId(null);
      }
      return;
    }
    if (!next) {
      const fallback = snapshot.releases.find((item) => !isReleaseArchivedEntity(item.release)) ?? snapshot.releases[0] ?? null;
      if (fallback) {
        setSelectedId(fallback.release.id);
        if (screenMode !== "view") {
          setDraft(cloneJson(fallback));
          setDraftDirty(false);
          setEditingReleaseRoleIds([]);
        }
      } else {
        setDraft(null);
        setDraftDirty(false);
        setEditingReleaseRoleIds([]);
      }
      setGenerated(null);
      setGeneratedDraft("");
      setTemplateId(undefined);
      setSavedPostPreviewId(null);
      setReleaseNotice(null);
      return;
    }
    if (screenMode !== "view") {
      if (restoredDraftActive && draft?.release.id === next.release.id) {
        return;
      }
      if (!draft || draft.release.id !== next.release.id || draft.release.record_revision !== next.release.record_revision) {
        setDraft(cloneJson(next));
        setDraftDirty(false);
        setEditingReleaseRoleIds([]);
        setGenerated(null);
        setGeneratedDraft("");
        setTemplateId(undefined);
        setSavedPostPreviewId(null);
      }
      return;
    }
    if (savedPostPreviewId && !next.generated_posts.some((item) => item.id === savedPostPreviewId)) {
      setSavedPostPreviewId(null);
    }
    setReleaseNotice(null);
  }, [draft, releaseById, restoredDraftActive, savedPostPreviewId, screenMode, selectedId, snapshot.releases]);

  useEffect(() => {
    if (selectedReleaseId) {
      setSelectedId(selectedReleaseId);
      setRestoredDraftActive(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setSavedPostPreviewId(null);
      setReleaseNotice(null);
    }
  }, [selectedReleaseId]);

  useEffect(() => {
    if (!restoredLocalDraft || restoredLocalDraft.domain !== "release") {
      return;
    }
    const payload = cloneJson(restoredLocalDraft.payload) as ReleaseAggregate;
    const releaseId = payload.release?.id ?? restoredLocalDraft.entity_id;
    setSelectedId(releaseId);
    setDraft(payload);
    setDraftDirty(true);
    setActiveTab("overview");
    setRestoredDraftActive(true);
    setScreenMode(releaseById.has(releaseId) ? "edit" : "create");
    setDetailExpanded(true);
    setSavedPostPreviewId(null);
    setReleaseNotice({
      tone: "warning",
      text: `Открыт локальный черновик релиза от ${formatDate(restoredLocalDraft.saved_at)}. Проверьте правки и сохраните релиз вручную.`
    });
    onRestoredLocalDraftApplied();
  }, [onRestoredLocalDraftApplied, releaseById, restoredLocalDraft]);

  useEffect(() => {
    if (newExternalVariant === "vk_only") {
      setNewExternalSourceId("");
      return;
    }
    if (!availableExternalSourceOptions.length) {
      setNewExternalSourceId("");
      return;
    }
    setNewExternalSourceId((current) => current && availableExternalSourceOptions.some((item) => item.id === current)
      ? current
      : availableExternalSourceOptions[0]?.id || "");
  }, [availableExternalSourceOptions, newExternalVariant]);

  useEffect(() => {
    onDirtyChange(Boolean(dirty));
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!releaseTypeCategoryEnabled && typeFilter !== "all") {
      setTypeFilter("all");
    }
  }, [releaseTypeCategoryEnabled, typeFilter]);

  useEffect(() => {
    if (!releaseStatusCategoryEnabled && statusFilter !== "all") {
      setStatusFilter("all");
    }
    if (!releaseStatusCategoryEnabled && (quickView === "in_work" || quickView === "completed")) {
      setQuickView("all");
    }
  }, [quickView, releaseStatusCategoryEnabled, statusFilter]);

  const filtered = useMemo(() => releaseViews.filter((item) => {
    const needle = search.trim().toLowerCase();
    if (
      needle &&
      !`${item.title} ${(item.departmentIds.map((departmentId) => departmentNameById.get(departmentId) ?? departmentId)).join(" ")} ${participantNameById.get(item.curatorId ?? "") ?? ""} ${releaseTypeNameById.get(item.type) ?? ""}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    const archiveViewActive = quickView === "archived" || (releaseStatusCategoryEnabled && statusFilter === "archived");
    if (!archiveViewActive && isReleaseArchivedView(item)) return false;
    if (releaseStatusCategoryEnabled) {
      if (statusFilter === "archived" && !isReleaseArchivedView(item)) return false;
      if (statusFilter !== "all" && statusFilter !== "archived" && item.status !== statusFilter) return false;
    }
    if (departmentFilter !== "all" && !item.departmentIds.includes(departmentFilter)) return false;
    if (yearFilter !== "all" && String(item.year ?? "") !== yearFilter) return false;
    if (releaseTypeCategoryEnabled && typeFilter !== "all" && item.type !== typeFilter) return false;
    if (curatorFilter !== "all" && item.curatorId !== curatorFilter) return false;
    if (quickView === "in_work" && item.status !== "in_work") return false;
    if (quickView === "completed" && item.status !== "completed") return false;
    if (quickView === "lost" && !item.archivalState.includes("lost")) return false;
    if (quickView === "archived" && !isReleaseArchivedView(item)) return false;
    if (quickView === "missing_post" && item.hasGeneratedPost) return false;
    if (quickView === "missing_team" && item.missingCoreRoles.length === 0) return false;
    return true;
  }), [releaseViews, search, departmentNameById, participantNameById, releaseTypeNameById, quickView, releaseStatusCategoryEnabled, statusFilter, departmentFilter, yearFilter, releaseTypeCategoryEnabled, typeFilter, curatorFilter]);

  const orderedFilteredReleases = useMemo(() => {
    const activeOrderIds = releaseDragPreviewIds?.length ? releaseDragPreviewIds : releaseCommittedOrderIds;
    if (!activeOrderIds?.length) {
      return filtered;
    }
    const orderMap = new Map(activeOrderIds.map((id, index) => [id, index]));
    return [...filtered].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [filtered, releaseCommittedOrderIds, releaseDragPreviewIds]);

  function resetReleaseFilters() {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setYearFilter("all");
    setTypeFilter("all");
    setCuratorFilter("all");
    setQuickView("all");
  }

  function openReleaseArchiveView() {
    setSearch("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    setYearFilter("all");
    setTypeFilter("all");
    setCuratorFilter("all");
    setQuickView("archived");
    const firstArchived = releaseViews.find((item) => isReleaseArchivedView(item));
    if (firstArchived) {
      setSelectedId(firstArchived.id);
      setDetailExpanded(true);
      setReleaseNotice({ tone: "success", text: "Открыт архив релизов." });
    } else {
      setReleaseNotice({ tone: "warning", text: "В архиве релизов пока нет записей." });
    }
  }

  function updateDraft(mutator: (value: ReleaseAggregate) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneJson(current);
      mutator(next);
      return next;
    });
    setDraftDirty(true);
  }

  function enterEditModeWith(mutator?: (value: ReleaseAggregate) => void, nextTab?: string) {
    const base = draft ?? sourceRelease;
    if (!base) return;
    const next = cloneJson(base);
    if (mutator) mutator(next);
    setDraft(next);
    setDraftDirty(Boolean(mutator) || dirty || !sourceRelease);
    setScreenMode(sourceRelease && base.release.id === sourceRelease.release.id ? "edit" : "create");
    setDetailExpanded(true);
    if (nextTab) setActiveTab(nextTab);
  }

  async function saveDraft() {
    if (!draft) return;
    setIsSaving(true);
    try {
      const next = cloneJson(draft);
      normalizeReleaseAggregateDraft(next);
      const teamHistorySummary = buildReleaseTeamHistorySummary(sourceRelease ?? undefined, next, participantNameById, roleNameById);
      const releaseRoleHistorySummary = buildReleaseRoleHistorySummary(sourceRelease ?? undefined, next, participantNameById);
      const pendingHistoryEntries: EntityHistoryEntry[] = [];
      if (teamHistorySummary) {
        pendingHistoryEntries.push(createHistoryEntryDraft({
          actor: actorName,
          action: "update",
          entityType: "release",
          entityId: next.release.id,
          summary: teamHistorySummary
        }));
      }
      if (releaseRoleHistorySummary) {
        pendingHistoryEntries.push(createHistoryEntryDraft({
          actor: actorName,
          action: "update",
          entityType: "release",
          entityId: next.release.id,
          summary: releaseRoleHistorySummary
        }));
      }
      if (pendingHistoryEntries.length) {
        next.history = [
          ...pendingHistoryEntries,
          ...next.history
        ];
      }
      const wasArchived = sourceRelease ? isReleaseArchivedEntity(sourceRelease.release) : false;
      const archiveRequestedByStatus = next.release.release_status_id === "archived";
      const archiveRequestedByState = isArchivedReleaseState(next.release.archival_state);
      if (!archiveRequestedByState && archiveRequestedByStatus) {
        const archiveChoice = wasArchived ? "archived" : await promptReleaseArchiveChoice();
        if (!archiveChoice) {
          setIsSaving(false);
          return;
        }
        next.release.archival_state = wasArchived
          ? "archived"
          : archiveChoice;
      }
      const archivedAfterSave = isReleaseArchivedEntity(next.release);
      next.release.status = archivedAfterSave ? "archived" : "active";
      next.release.release_status_id = archivedAfterSave
        ? "archived"
        : (next.release.release_status_id === "archived" ? "in_work" : next.release.release_status_id);
      next.release.archival_state = archivedAfterSave
        ? (isArchivedReleaseState(next.release.archival_state) ? next.release.archival_state : "archived")
        : (isArchivedReleaseState(next.release.archival_state) ? "normal" : next.release.archival_state);
      next.release.archived_at = archivedAfterSave ? (next.release.archived_at ?? new Date().toISOString()) : null;
      const fallbackReleaseId = releaseViews.find((item) => item.id !== next.release.id && !isReleaseArchivedView(item))?.id ?? "";
      await window.fronda.saveRelease(next, actorName);
      startTransition(() => {
        setSelectedId(archivedAfterSave ? fallbackReleaseId : next.release.id);
        setActiveTab("overview");
        setRestoredDraftActive(false);
        setScreenMode("view");
        setEditingReleaseRoleIds([]);
        setDetailExpanded(!archivedAfterSave);
        if (archivedAfterSave) {
          setQuickView("all");
        }
        setDraftDirty(false);
        setReleaseNotice({ tone: "success", text: archivedAfterSave ? "Релиз сохранен в архив и скрыт из общего реестра." : "Карточка релиза сохранена. Открыт обычный обзор." });
      });
      void onRefresh(false);
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить карточку релиза."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function createReleaseFromScratch(defaultTemplate = false) {
    const next = createEmptyReleaseAggregate(
      actorName,
      departmentFilter !== "all" ? departmentFilter : activeDepartments[0]?.id ?? snapshot.departments[0]?.id,
      defaultTemplate ? standardTemplate?.id : undefined
    );
    next.release.sort_order = snapshot.releases.length + 1;
    setSelectedId(next.release.id);
    setDraft(next);
    setDraftDirty(true);
    setActiveTab("overview");
    setScreenMode("create");
    setDetailExpanded(true);
    setReleaseNotice(null);
  }

  function createReleaseInDepartment() {
    createReleaseFromScratch(false);
  }

  function cloneRelease() {
    if (!draft) return;
    const next = cloneReleaseAggregateDraft(draft, actorName);
    next.release.sort_order = snapshot.releases.length + 1;
    setSelectedId(next.release.id);
    setDraft(next);
    setDraftDirty(true);
    setActiveTab("overview");
    setScreenMode("create");
    setDetailExpanded(true);
    setReleaseNotice(null);
  }

  async function persistReleaseOrder(draggedReleaseId: string, targetReleaseId: string, orderedIds?: string[] | null) {
    if (draggedReleaseId === targetReleaseId) return;

    const ordered =
      orderedIds?.length
        ? orderedIds
            .map((id) => releaseViews.find((item) => item.id === id))
            .filter((item): item is ReleaseView => Boolean(item))
        : reorderByTarget([...releaseViews], draggedReleaseId, targetReleaseId);
    const nextIndex = ordered.findIndex((item) => item.id === draggedReleaseId);
    if (nextIndex < 0) return;

    const current = releaseById.get(draggedReleaseId);
    if (!current) return;

    const before = ordered[nextIndex - 1];
    const after = ordered[nextIndex + 1];
    const currentOrder = ordered[nextIndex].sortOrder;
    const nextOrder =
      before && after
        ? (before.sortOrder + after.sortOrder) / 2
        : before
          ? before.sortOrder + 1
          : after
            ? after.sortOrder - 1
            : currentOrder;

    const next = cloneJson(current);
    next.release.sort_order = nextOrder;
    normalizeReleaseAggregateDraft(next);
    setReleaseNotice({ tone: "warning", text: "Сохраняем новый порядок релизов..." });
    await window.fronda.saveRelease(next, actorName);
    setReleaseNotice({ tone: "success", text: "Порядок релизов обновлен." });
    void onRefresh(false);
  }

  function beginReleaseDrag(releaseId: string) {
    releaseDragBaseIdsRef.current = orderedFilteredReleases.map((item) => item.id);
    setDragReleaseId(releaseId);
    setDragReleaseTargetId(releaseId);
    setReleaseDragPreviewIds(releaseDragBaseIdsRef.current);
  }

  function trackReleaseDropTarget(releaseId: string) {
    if (!dragReleaseId || dragReleaseId === releaseId || dragReleaseTargetId === releaseId) return;
    setDragReleaseTargetId(releaseId);
    const source = releaseDragBaseIdsRef.current ?? orderedFilteredReleases.map((item) => item.id);
    setReleaseDragPreviewIds(reorderIdsByTarget([...source], dragReleaseId, releaseId));
  }

  function beginReleasePointerDrag(event: ReactPointerEvent<HTMLDivElement>, releaseId: string) {
    if (event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setReleasePointerDrag({
      id: releaseId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function handleReleaseItemClick(id: string) {
    if (suppressReleaseClickRef.current) {
      return;
    }
    openRelease(id);
  }

  useEffect(() => {
    if (!releasePointerDrag && !dragReleaseId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setReleasePointerDrag(null);
      setDragReleaseId(null);
      setDragReleaseTargetId(null);
      if (!options?.preservePreview) {
        setReleaseDragPreviewIds(null);
        releaseDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = releasePointerDrag;
      const activeId = dragReleaseId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }

      if (!dragReleaseId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginReleaseDrag(candidate.id);
      }

      const targetReleaseId = findNearestReorderTargetId("data-release-order-id", activeId, event.clientX, event.clientY);
      if (targetReleaseId && targetReleaseId !== activeId) {
        trackReleaseDropTarget(targetReleaseId);
      }
    }

    function handlePointerUp() {
      const activeId = dragReleaseId;
      const targetId = dragReleaseTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      const committedIds =
        didReorder && activeId && targetId
          ? (releaseDragPreviewIds ?? reorderIdsByTarget([...(releaseDragBaseIdsRef.current ?? orderedFilteredReleases.map((item) => item.id))], activeId, targetId))
          : null;
      if (committedIds) {
        setReleaseCommittedOrderIds(committedIds);
      }
      resetState({ preservePreview: didReorder });
      if (didReorder) {
        suppressReleaseClickRef.current = true;
        window.setTimeout(() => {
          suppressReleaseClickRef.current = false;
        }, 160);
      }
      if (activeId && targetId && activeId !== targetId) {
        void persistReleaseOrder(activeId, targetId, committedIds)
          .catch(() => {
            setReleaseCommittedOrderIds(null);
          })
          .finally(() => {
            setReleaseDragPreviewIds(null);
            releaseDragBaseIdsRef.current = null;
          });
      } else {
        setReleaseDragPreviewIds(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragReleaseId, dragReleaseTargetId, orderedFilteredReleases, releaseById, releaseDragPreviewIds, releasePointerDrag, releaseViews]);

  useEffect(() => {
    if (!releaseParticipantPointerDrag && !dragReleaseParticipantId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setReleaseParticipantPointerDrag(null);
      setDragReleaseParticipantId(null);
      setDragReleaseParticipantTargetId(null);
      if (!options?.preservePreview) {
        setReleaseParticipantDragPreviewIds(null);
        releaseParticipantDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = releaseParticipantPointerDrag;
      const activeId = dragReleaseParticipantId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }
      if (!dragReleaseParticipantId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginReleaseParticipantDrag(candidate.id);
      }
      const targetParticipantId = findNearestReorderTargetId("data-release-participant-order-id", activeId, event.clientX, event.clientY);
      if (targetParticipantId && targetParticipantId !== activeId) {
        trackReleaseParticipantDropTarget(targetParticipantId);
      }
    }

    function handlePointerUp() {
      const activeId = dragReleaseParticipantId;
      const targetId = dragReleaseParticipantTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      resetState({ preservePreview: didReorder });
      if (didReorder && activeId && targetId) {
        reorderReleaseParticipants(activeId, targetId);
        window.setTimeout(() => {
          setReleaseParticipantDragPreviewIds(null);
          releaseParticipantDragBaseIdsRef.current = null;
        }, 0);
      } else {
        setReleaseParticipantDragPreviewIds(null);
        releaseParticipantDragBaseIdsRef.current = null;
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragReleaseParticipantId, dragReleaseParticipantTargetId, orderedReleaseParticipants, releaseParticipantPointerDrag]);

  useEffect(() => {
    if (!releaseExternalPointerDrag && !dragReleaseExternalId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setReleaseExternalPointerDrag(null);
      setDragReleaseExternalId(null);
      setDragReleaseExternalTargetId(null);
      if (!options?.preservePreview) {
        setReleaseExternalDragPreviewIds(null);
        releaseExternalDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = releaseExternalPointerDrag;
      const activeId = dragReleaseExternalId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }
      if (!dragReleaseExternalId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 6) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginReleaseExternalDrag(candidate.id);
      }
      const targetExternalId = findNearestReorderTargetId("data-release-external-order-id", activeId, event.clientX, event.clientY);
      if (targetExternalId && targetExternalId !== activeId) {
        trackReleaseExternalDropTarget(targetExternalId);
      }
    }

    function handlePointerUp() {
      const activeId = dragReleaseExternalId;
      const targetId = dragReleaseExternalTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      resetState({ preservePreview: didReorder });
      if (didReorder && activeId && targetId) {
        reorderReleaseExternals(activeId, targetId);
        window.setTimeout(() => {
          setReleaseExternalDragPreviewIds(null);
          releaseExternalDragBaseIdsRef.current = null;
        }, 0);
      } else {
        setReleaseExternalDragPreviewIds(null);
        releaseExternalDragBaseIdsRef.current = null;
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragReleaseExternalId, dragReleaseExternalTargetId, orderedReleaseExternals, releaseExternalPointerDrag]);

  async function toggleReleaseArchive() {
    const current = draft ?? sourceRelease;
    const archivedNow = current ? isReleaseArchivedEntity(current.release) : false;
    const archiveChoice =
      archivedNow
        ? "normal"
        : await promptReleaseArchiveChoice();
    if (!archiveChoice) {
      return;
    }
    const archiveStateForSave =
      archivedNow
        ? "normal"
        : archiveChoice;
    const mutate = (next: ReleaseAggregate) => {
      const archived = isArchivedReleaseState(next.release.archival_state) || next.release.release_status_id === "archived";
      next.release.status = archived ? "active" : "archived";
      next.release.release_status_id = archived ? "in_work" : "archived";
      next.release.archival_state = archived ? "normal" : archiveStateForSave;
      next.release.archived_at = archived ? null : new Date().toISOString();
      next.history = [
        createHistoryEntryDraft({
          actor: actorName,
          action: archived ? "restore" : "archive",
          entityType: "release",
          entityId: next.release.id,
          summary: archived ? "Релиз восстановлен из архива" : "Релиз архивирован"
        }),
        ...next.history
      ];
    };
    enterEditModeWith(mutate);
    setReleaseNotice({ tone: "warning", text: "Статус архива изменен локально. Нажмите «Сохранить релиз», чтобы записать изменения в общую папку." });
  }

  async function markReleaseLost() {
    const mutate = (next: ReleaseAggregate) => {
      next.release.archival_state = "lost";
      next.release.release_status_id = next.release.release_status_id === "completed" ? next.release.release_status_id : "frozen";
    };
    enterEditModeWith(mutate);
    setReleaseNotice({ tone: "warning", text: "Пометка утерянного релиза изменена локально. Нажмите «Сохранить релиз», чтобы записать изменения в общую папку." });
  }

  async function deleteSelectedRelease() {
    if (!sourceRelease || screenMode !== "view") {
      return;
    }
    const releaseId = sourceRelease.release.id;
    const fallbackReleaseId =
      releaseViews.find((item) => item.id !== releaseId && !isReleaseArchivedView(item))?.id
      ?? releaseViews.find((item) => item.id !== releaseId)?.id
      ?? "";
    setIsSaving(true);
    try {
      await window.fronda.deleteRelease(releaseId, actorName);
      startTransition(() => {
        setSelectedId(fallbackReleaseId);
        setDraft(null);
        setDraftDirty(false);
        setActiveTab("overview");
        setScreenMode("view");
        setDetailExpanded(Boolean(fallbackReleaseId));
        setGenerated(null);
        setGeneratedDraft("");
        setSavedPostPreviewId(null);
        setEditingReleaseRoleIds([]);
        setRestoredDraftActive(false);
        setReleaseNotice({
          tone: "success",
          text: "Карточка релиза удалена из общего реестра."
        });
      });
      await onRefresh(false);
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось удалить релиз."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function generatePreview() {
    if (!draft) return;
    setIsGenerating(true);
    setReleaseNotice({ tone: "warning", text: "Собираем пост..." });
    try {
      const next = cloneJson(draft);
      normalizeReleaseAggregateDraft(next);
      const result = await window.fronda.generatePostDraft(next, templateId);
      setGenerated(result);
      setGeneratedDraft(result.content);
      setReleaseNotice({ tone: result.warnings.length ? "warning" : "success", text: result.warnings.length ? "Черновик поста собран, но в нем есть предупреждения." : "Пост обновлен." });
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось собрать пост."
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveGenerated(finalized: boolean) {
    if (!draft || !generatedDraft.trim()) return;
    setIsSaving(true);
    try {
      const savedPost = await window.fronda.saveGeneratedPost(
        draft.release.id,
        {
          title: generated?.title ?? getReleaseDisplayTitle(draft.release),
          content: generatedDraft,
          finalized,
          template_id: templateId ?? draft.posting.default_post_template_id ?? null
        },
        actorName
      );
      setDraft((current) => {
        if (!current || current.release.id !== draft.release.id) {
          return current;
        }
        const next = cloneJson(current);
        next.generated_posts = [...next.generated_posts.filter((item) => item.id !== savedPost.id), savedPost]
          .sort((left, right) => `${right.updated_at}`.localeCompare(`${left.updated_at}`));
        return next;
      });
      setSavedPostPreviewId(savedPost.id);
      await onRefresh(false);
      setReleaseNotice({ tone: "success", text: finalized ? "Итоговая версия поста сохранена." : "Снимок поста сохранен." });
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить пост."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function previewSavedPost(postId: string) {
    const baseRelease = screenMode === "view"
      ? (currentRelease ?? sourceRelease)
      : (draft ?? sourceRelease ?? currentRelease);
    if (!baseRelease) return;
    const post = baseRelease.generated_posts.find((item) => item.id === postId);
    if (!post) return;
    setSavedPostPreviewId(post.id);
    setActiveTab("generator");
    setDetailExpanded(true);
    setReleaseNotice({
      tone: "success",
      text: post.finalized ? "Открыта итоговая версия поста для просмотра." : "Открыт сохраненный черновик поста."
    });
  }

  function openSavedPost(postId: string) {
    const baseRelease = screenMode === "view"
      ? (currentRelease ?? sourceRelease)
      : (draft ?? sourceRelease ?? currentRelease);
    if (!baseRelease) return;
    const post = baseRelease.generated_posts.find((item) => item.id === postId);
    if (!post) return;
    const next = cloneJson(baseRelease);
    setDraft(next);
    setSavedPostPreviewId(post.id);
    setTemplateId(post.template_id ?? next.posting.default_post_template_id ?? undefined);
    setGenerated({
      title: post.title,
      content: post.content,
      warnings: []
    });
    setGeneratedDraft(post.content);
    setActiveTab("generator");
    setDetailExpanded(true);
    setScreenMode(sourceRelease && sourceRelease.release.id === next.release.id ? "edit" : "create");
    setReleaseNotice({
      tone: "success",
      text: post.finalized ? "Открыта итоговая версия поста для правки и повторного сохранения." : "Открыт сохраненный черновик поста."
    });
  }

  async function deleteSavedPost(postId: string) {
    const baseRelease = screenMode === "view"
      ? (currentRelease ?? sourceRelease)
      : (draft ?? sourceRelease ?? currentRelease);
    if (!baseRelease) {
      return;
    }
    const post = baseRelease.generated_posts.find((item) => item.id === postId);
    if (!post) {
      return;
    }
    const confirmed = window.confirm(
      `Удалить ${post.finalized ? "итоговую версию" : "черновик"} поста «${post.title}»?\n\nЭто действие удалит сохраненный снимок из релиза.`
    );
    if (!confirmed) {
      return;
    }
    setIsSaving(true);
    try {
      await window.fronda.deleteGeneratedPost(baseRelease.release.id, postId, actorName);
      setDraft((current) => {
        if (!current || current.release.id !== baseRelease.release.id) {
          return current;
        }
        const next = cloneJson(current);
        next.generated_posts = next.generated_posts.filter((item) => item.id !== postId);
        return next;
      });
      if (savedPostPreviewId === postId) {
        setSavedPostPreviewId(null);
      }
      await onRefresh(false);
      setReleaseNotice({ tone: "success", text: post.finalized ? "Итоговая версия поста удалена." : "Черновик поста удален." });
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось удалить сохраненный пост."
      });
    } finally {
      setIsSaving(false);
    }
  }

  function resetDraft() {
    if (!sourceRelease) return;
    setDraft(cloneJson(sourceRelease));
    setDraftDirty(false);
    setScreenMode("view");
    setReleaseNotice(null);
  }

  function openRelease(id: string) {
    setSelectedId(id);
    setActiveTab("overview");
    setScreenMode("view");
    setDetailExpanded(false);
    setReleaseNotice(null);
  }

  function openReleaseDetails(id: string) {
    setSelectedId(id);
    setActiveTab("overview");
    setScreenMode("view");
    setDetailExpanded(true);
    setReleaseNotice(null);
  }

  function beginEditing() {
    if (!sourceRelease) return;
    setDraft(cloneJson(sourceRelease));
    setDraftDirty(false);
    setScreenMode("edit");
    setDetailExpanded(true);
    setReleaseNotice(null);
  }

  function cancelEditing() {
    if (sourceRelease) {
      setDraft(cloneJson(sourceRelease));
      setDraftDirty(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setReleaseNotice(null);
      return;
    }
    const fallback = snapshot.releases[0] ?? null;
    if (fallback) {
      setSelectedId(fallback.release.id);
      setDraft(cloneJson(fallback));
      setDraftDirty(false);
      setScreenMode("view");
      setDetailExpanded(true);
      setReleaseNotice(null);
      return;
    }
    setDraft(null);
    setDraftDirty(false);
    setScreenMode("create");
    setReleaseNotice(null);
  }

  function startParticipantAssignment() {
    enterEditModeWith((next) => {
      const nextParticipant = createReleaseParticipantDraft(
        next.release.id,
        "",
        defaultReleaseRoleId,
        next.release.primary_department_id,
        actorName,
        1
      );
      next.participants = [
        nextParticipant,
        ...next.participants.map((item, index) => ({
          ...item,
          credit_order: index + 2
        }))
      ];
    }, "team");
  }

  function reorderReleaseParticipants(draggedId: string, targetId: string) {
    updateDraft((next) => {
      next.participants = reorderByTarget([...next.participants], draggedId, targetId).map((item, index) => ({
        ...item,
        credit_order: index + 1
      }));
    });
  }

  function beginReleaseParticipantDrag(participantId: string) {
    if (!draft) return;
    releaseParticipantDragBaseIdsRef.current = orderedReleaseParticipants.map((item) => item.id);
    setDragReleaseParticipantId(participantId);
    setDragReleaseParticipantTargetId(participantId);
    setReleaseParticipantDragPreviewIds(releaseParticipantDragBaseIdsRef.current);
  }

  function trackReleaseParticipantDropTarget(participantId: string) {
    if (!dragReleaseParticipantId || dragReleaseParticipantId === participantId || dragReleaseParticipantTargetId === participantId) return;
    setDragReleaseParticipantTargetId(participantId);
    const source = releaseParticipantDragBaseIdsRef.current ?? orderedReleaseParticipants.map((item) => item.id);
    setReleaseParticipantDragPreviewIds(reorderIdsByTarget([...source], dragReleaseParticipantId, participantId));
  }

  function beginReleaseParticipantPointerDrag(event: ReactPointerEvent<HTMLDivElement>, participantId: string) {
    if (event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setReleaseParticipantPointerDrag({
      id: participantId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function reorderReleaseExternals(draggedId: string, targetId: string) {
    updateDraft((next) => {
      next.external = reorderByTarget([...next.external], draggedId, targetId).map((item, index) => ({
        ...item,
        display_order: index + 1
      }));
    });
  }

  function beginReleaseExternalDrag(externalId: string) {
    if (!draft) return;
    releaseExternalDragBaseIdsRef.current = orderedReleaseExternals.map((item) => item.id);
    setDragReleaseExternalId(externalId);
    setDragReleaseExternalTargetId(externalId);
    setReleaseExternalDragPreviewIds(releaseExternalDragBaseIdsRef.current);
  }

  function trackReleaseExternalDropTarget(externalId: string) {
    if (!dragReleaseExternalId || dragReleaseExternalId === externalId || dragReleaseExternalTargetId === externalId) return;
    setDragReleaseExternalTargetId(externalId);
    const source = releaseExternalDragBaseIdsRef.current ?? orderedReleaseExternals.map((item) => item.id);
    setReleaseExternalDragPreviewIds(reorderIdsByTarget([...source], dragReleaseExternalId, externalId));
  }

  function beginReleaseExternalPointerDrag(event: ReactPointerEvent<HTMLDivElement>, externalId: string) {
    if (event.button !== 0 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    event.preventDefault();
    setReleaseExternalPointerDrag({
      id: externalId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function applyStandardTemplate() {
    if (!standardTemplate) return;
    enterEditModeWith((next) => {
      next.posting.default_post_template_id = standardTemplate.id;
      next.posting.hide_empty_blocks_flag = true;
    }, "posting");
    setTemplateId(standardTemplate.id);
  }

  function addExternalAssignment() {
    if (newExternalVariant !== "vk_only" && !activeExternalSources.length) {
      setReleaseNotice({ tone: "warning", text: "Сначала добавьте хотя бы один источник субтитров в справочнике «Субтитры»." });
      return;
    }
    if (newExternalVariant !== "vk_only" && !availableExternalSourceOptions.length) {
      setReleaseNotice({ tone: "warning", text: "Для выбранного варианта пока нет подходящих источников в справочнике «Субтитры»." });
      return;
    }
    if (newExternalVariant !== "vk_only" && !newExternalSourceId) {
      setNewExternalSourceId(availableExternalSourceOptions[0]?.id ?? "");
      return;
    }
    enterEditModeWith((next) => {
      const nextExternal = createReleaseExternalDraft(
        next.release.id,
        newExternalVariant === "vk_only" ? "" : newExternalSourceId,
        actorName,
        1,
        newExternalVariant
      );
      next.external = [
        nextExternal,
        ...next.external.map((item, index) => ({
          ...item,
          display_order: index + 2
        }))
      ];
    }, "external");
  }

  function addReleaseRole() {
    if (!draft) {
      return;
    }
    if (!releaseRoleParticipantOptions.length) {
      setReleaseNotice({ tone: "warning", text: "Сначала добавьте участника в команду релиза, а потом уже назначайте роли персонажей." });
      return;
    }
    const participantId = newReleaseRoleParticipantId || releaseRoleParticipantOptions[0]?.id;
    if (!participantId) {
      setReleaseNotice({ tone: "warning", text: "Сначала выберите участника из команды релиза." });
      return;
    }
    const newRole = createReleaseRoleDraft(draft.release.id, participantId, actorName, 1);
    enterEditModeWith((next) => {
      const nextRoles = next.roles ?? [];
      next.roles = [
        newRole,
        ...nextRoles.map((item, index) => ({
          ...item,
          display_order: index + 2
        }))
      ];
    }, "roles");
    setEditingReleaseRoleIds((current) => current.includes(newRole.id) ? current : [...current, newRole.id]);
  }

  function saveReleaseRole(roleId: string, patch: Partial<ReleaseRoleAssignment>) {
    updateDraft((next) => {
      const target = (next.roles ?? []).find((entry) => entry.id === roleId);
      if (!target) {
        return;
      }
      if (patch.character_names !== undefined) {
        target.character_names = normalizeStringArray(patch.character_names);
      }
      if (patch.secondary_character_names !== undefined) {
        target.secondary_character_names = normalizeStringArray(patch.secondary_character_names);
      }
    });
    setEditingReleaseRoleIds((current) => current.filter((item) => item !== roleId));
  }

  function startEditingReleaseRole(roleId: string) {
    setEditingReleaseRoleIds((current) => current.includes(roleId) ? current : [...current, roleId]);
  }

  function removeReleaseRole(roleId: string) {
    updateDraft((next) => {
      next.roles = (next.roles ?? []).filter((entry) => entry.id !== roleId).map((entry, index) => ({
        ...entry,
        display_order: index + 1
      }));
    });
    setEditingReleaseRoleIds((current) => current.filter((item) => item !== roleId));
  }

  function addPlatform() {
    if (!newPlatformId) return;
    enterEditModeWith((next) => {
      const shouldBecomePrimary =
        next.content.platform_links.length === 0
        || newPlatformId === "kodik";
      if (shouldBecomePrimary) {
        next.content.platform_links = next.content.platform_links.map((item) => ({
          ...item,
          is_primary: false
        }));
      }
      next.content.platform_links = [
        ...next.content.platform_links,
        createPlatformLinkDraft(newPlatformId, next.content.platform_links.length + 1, shouldBecomePrimary)
      ];
    }, "content");
  }

  async function createPlatformOption() {
    const normalizedName = normalizeSingleLineText(newPlatformName);
    if (!normalizedName) {
      setReleaseNotice({ tone: "warning", text: "Введите название новой площадки." });
      return;
    }
    const allPlatformOptions = snapshot.directories.platforms ?? [];
    const existingByName = allPlatformOptions.find((item) => item.name.toLowerCase() === normalizedName.toLowerCase());
    const existingById = allPlatformOptions.find((item) => item.id === slugify(normalizedName));
    const existing = existingByName ?? existingById;
    if (existing) {
      setNewPlatformId(existing.id);
      setNewPlatformName("");
      setReleaseNotice({ tone: "success", text: `Площадка «${existing.name}» уже есть в справочнике и выбрана для релиза.` });
      return;
    }
    const record = createDirectoryRecordDraft(actorName, "platform");
    record.id = slugify(normalizedName) || record.id;
    record.name = normalizedName;
    try {
      await window.fronda.saveDirectoryRecords("platforms", [...platformOptions, record], actorName);
      await onRefresh(false);
      setNewPlatformId(record.id);
      setNewPlatformName("");
      setReleaseNotice({ tone: "success", text: `Площадка «${normalizedName}» добавлена в справочник.` });
    } catch (error) {
      setReleaseNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось добавить площадку в справочник."
      });
    }
  }

  const missingRoles = currentRelease ? getReleaseMissingCoreRoles(currentRelease) : [];
  const primaryPlatform = currentRelease?.content.platform_links.find((item) => item.is_primary) ?? null;
  const primaryExternal = currentRelease?.external.find((item) => item.is_primary_source) ?? null;

  return (
    <>
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="releases:list">
      <Panel title="Поиск, фильтры и действия" subtitle="Слева находятся поиск по релизам, быстрые подборки, создание карточек и базовые фильтры. Сам реестр релизов вынесен в центр.">
        <div className="section-stack">
          <Field
            label="Поиск по релизам"
            help="Поиск смотрит название релиза и помогает быстро найти нужную карточку в общем реестре."
          >
            <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название релиза" />
          </Field>
          <div className="dashboard-actions primary-cluster">
            <Button className="primary" onClick={() => createReleaseFromScratch(false)} disabled={isSaving}>Создать релиз</Button>
            <Button className="secondary" onClick={() => onNavigate("imports")} disabled={isSaving}>Импорт</Button>
            <ActionMenu label="Еще">
              <ActionMenuItem onClick={createReleaseInDepartment} disabled={isSaving}>Создать в выбранном отделе</ActionMenuItem>
              <ActionMenuItem onClick={() => createReleaseFromScratch(true)} disabled={isSaving}>Создать из шаблона</ActionMenuItem>
              <ActionMenuItem onClick={cloneRelease} disabled={!draft || isSaving}>Клонировать релиз</ActionMenuItem>
              <ActionMenuItem onClick={() => onNavigate("statistics")}>Открыть статистику</ActionMenuItem>
              <ActionMenuItem onClick={openReleaseArchiveView}>Открыть архив</ActionMenuItem>
              <ActionMenuItem onClick={() => void toggleReleaseArchive()} disabled={isSaving || (screenMode === "view" ? !sourceRelease : !draft)}>{currentRelease && isReleaseArchivedEntity(currentRelease.release) ? "Восстановить" : "Архивировать"}</ActionMenuItem>
              <ActionMenuItem onClick={resetReleaseFilters}>Сбросить фильтры</ActionMenuItem>
            </ActionMenu>
          </div>
          <div className="detail-card filter-card">
            <div className="filter-card-header">
              <h4>Быстрые подборки</h4>
              <div className="muted">Готовые подборки релизов и обычные фильтры собраны в одном блоке, чтобы список было проще читать и уточнять.</div>
            </div>
            <div className="filter-card-section">
              <div className="tab-chip-group">
                <button className={`tab ${quickView === "all" ? "active" : ""}`} onClick={() => setQuickView("all")}><Chip tone={quickView === "all" ? "accent" : undefined}>Все релизы: {releaseViews.length}</Chip></button>
                {releaseStatusCategoryEnabled ? <button className={`tab ${quickView === "in_work" ? "active" : ""}`} onClick={() => setQuickView("in_work")}><Chip tone="accent">Активные: {releaseViews.filter((item) => item.status === "in_work").length}</Chip></button> : null}
                {releaseStatusCategoryEnabled ? <button className={`tab ${quickView === "completed" ? "active" : ""}`} onClick={() => setQuickView("completed")}><Chip>Завершенные: {releaseViews.filter((item) => item.status === "completed").length}</Chip></button> : null}
                <button className={`tab ${quickView === "lost" ? "active" : ""}`} onClick={() => setQuickView("lost")}><Chip tone="warning">Утерянные: {releaseViews.filter((item) => item.archivalState.includes("lost")).length}</Chip></button>
                <button className={`tab ${quickView === "archived" ? "active" : ""}`} onClick={() => setQuickView("archived")}><Chip>Архив: {releaseViews.filter((item) => isReleaseArchivedView(item)).length}</Chip></button>
                <button className={`tab ${quickView === "missing_post" ? "active" : ""}`} onClick={() => setQuickView("missing_post")}><Chip tone="warning">Без поста: {releaseViews.filter((item) => !item.hasGeneratedPost).length}</Chip></button>
                <button className={`tab ${quickView === "missing_team" ? "active" : ""}`} onClick={() => setQuickView("missing_team")}><Chip tone="warning">Без полного состава: {releaseViews.filter((item) => item.missingCoreRoles.length > 0).length}</Chip></button>
              </div>
            </div>
            <div className="filter-card-section">
              <div className="grid two filter-card-grid">
                {releaseStatusCategoryEnabled ? (
                  <Field label="Статус релиза" help="Показывает текущую стадию релиза: анонс, активная работа, завершение, заморозка, отмена или архив.">
                    <select className="select-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Все статусы</option>{releaseStatusOptions.length ? releaseStatusOptions.map((status) => <option key={status.id} value={status.id}>{getReleaseStatusLabel(status.id, releaseStatusOptions)}</option>) : [...new Set(releaseViews.map((item) => item.status))].map((status) => <option key={status} value={status}>{getReleaseStatusLabel(status, releaseStatusOptions)}</option>)}</select>
                  </Field>
                ) : null}
                <Field label="Отдел" help="Основное направление студии, к которому относится релиз.">
                  <select className="select-input" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="all">Все отделы</option>{activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
                </Field>
              </div>
              <div className="chip-group filter-card-summary">
                <Chip tone={quickView === "all" ? "accent" : undefined}>Подборка: {translateReleaseQuickView(quickView)}</Chip>
                <Chip>В выборке: {filtered.length}</Chip>
                <Chip tone="warning">{releaseViews.filter((item) => item.missingCoreRoles.length > 0).length} без полного состава</Chip>
                <Chip tone="accent">{releaseViews.filter((item) => item.hasGeneratedPost).length} с постом</Chip>
              </div>
            </div>
            <div className="filter-card-section">
              <details className="detail-disclosure">
                <summary className="disclosure-summary">
                  <strong>Дополнительные фильтры</strong>
                  <span className="muted">{releaseTypeOptions.length ? "Год, тип релиза и куратор для точной выборки." : "Год и куратор для точной выборки."}</span>
                </summary>
                <div className="detail-disclosure-body">
                  <div className="grid two filter-card-grid">
                    <select className="select-input" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="all">Все годы</option>{Array.from(new Set(releaseViews.map((item) => String(item.year ?? "")))).filter(Boolean).map((year) => <option key={year} value={year}>{year}</option>)}</select>
                    {releaseTypeOptions.length ? (
                      <select className="select-input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Все типы</option>{releaseTypeOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
                    ) : null}
                    <select className="select-input" value={curatorFilter} onChange={(event) => setCuratorFilter(event.target.value)}><option value="all">Любой куратор</option>{participantPickerOptions.map((item) => <option key={item.id} value={item.id}>{getParticipantPickerLabel(item)}</option>)}</select>
                  </div>
                </div>
              </details>
            </div>
          </div>
          <div className="detail-card">
            <h4>Сводка по выборке</h4>
            <div className="summary-key-list">
              <div className="compact-row"><strong>Найдено релизов</strong><span className="muted">{formatSimpleCount(filtered.length, "релиз", "релизов")}</span></div>
              <div className="compact-row"><strong>Текущая подборка</strong><span className="muted">{translateReleaseQuickView(quickView)}</span></div>
              <div className="compact-row"><strong>Режим центра</strong><span className="muted">{detailMode ? "Полный обзор / редактирование" : "Реестр релизов"}</span></div>
            </div>
          </div>
          <div className="detail-card">
            <h4>Как устроен экран</h4>
            <div className="muted">Центр показывает реестр релизов, а справа открывается краткая сводка по выбранной записи. Полный обзор или редактирование открываются отдельно и не смешиваются с самим реестром.</div>
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`releases:details:${selectedId || "empty"}`}>
      {!detailMode ? (
      <Panel
        title="Реестр релизов"
        subtitle="Центральная область показывает рабочий реестр релизов. Выберите запись, чтобы открыть сводку справа, а полный обзор открывайте отдельно."
        actions={<div className="chip-group"><Chip>В реестре: {filtered.length}</Chip></div>}
      >
        {!filtered.length ? (
          <EmptyState title="По текущим фильтрам релизы не найдены" body="Измените фильтры или поисковый запрос, чтобы снова увидеть релизы в рабочем реестре." />
        ) : (
          <div className="list">
            {orderedFilteredReleases.map((item) => (
              <ReleaseRegistryItem
                key={item.id}
                item={item}
                active={item.id === currentRelease?.release.id}
                showAdvancedMode={showAdvancedMode}
                departmentNameById={departmentNameById}
                releaseTypeNameById={releaseTypeNameById}
                releaseStatusCategoryEnabled={releaseStatusCategoryEnabled}
                isDragging={dragReleaseId === item.id}
                isDropTarget={dragReleaseTargetId === item.id && dragReleaseId !== item.id}
                onPointerDown={(event) => beginReleasePointerDrag(event, item.id)}
                onOpen={handleReleaseItemClick}
                onOpenDetails={openReleaseDetails}
              />
            ))}
          </div>
        )}
      </Panel>
      ) : null}
      {detailMode ? (
      <Panel
        title={currentRelease ? getReleaseDisplayTitle(currentRelease.release) : (screenMode === "create" ? "Новый релиз" : "Карточка релиза")}
        subtitle={
          screenMode === "view"
            ? "В центре открыт полный обзор релиза. Чтобы вернуться к реестру, используйте кнопку вверху или справа."
            : screenMode === "edit"
              ? "Редактирование выбранного релиза. После сохранения экран вернется в обычный обзор."
              : "Создание нового релиза."
        }
        actions={<div className="row" style={{ flexWrap: "wrap" }}>
          <Chip tone={screenMode === "view" ? undefined : dirty ? "warning" : "success"}>
            {screenMode === "view" ? "Обзор" : dirty ? "Есть локальные правки" : "Готово к сохранению"}
          </Chip>
          {screenMode === "view" ? <Button className="secondary" onClick={() => setDetailExpanded(false)}>Вернуться к реестру</Button> : null}
          {screenMode === "view" ? <Button className="primary" onClick={beginEditing} disabled={!sourceRelease || isSaving}>Редактировать</Button> : null}
          {screenMode !== "view" ? <Button className="secondary" onClick={cancelEditing} disabled={isSaving}>Отменить</Button> : null}
          {screenMode !== "view" ? <Button className="primary" disabled={!draft || isSaving} onClick={() => void saveDraft()}>{isSaving ? "Сохраняем..." : "Сохранить релиз"}</Button> : null}
          {(currentRelease || screenMode !== "view") ? (
            <ActionMenu label="Еще действия">
              {currentRelease ? <ActionMenuItem onClick={cloneRelease} disabled={isSaving}>Клонировать</ActionMenuItem> : null}
              {currentRelease ? <ActionMenuItem onClick={() => void markReleaseLost()} disabled={isSaving}>Пометить утерянным</ActionMenuItem> : null}
              {currentRelease ? <ActionMenuItem onClick={() => void toggleReleaseArchive()} disabled={isSaving}>{isReleaseArchivedEntity(currentRelease.release) ? "Восстановить" : "Архивировать"}</ActionMenuItem> : null}
              {screenMode !== "view" ? <ActionMenuItem onClick={resetDraft} disabled={!dirty || isSaving}>Вернуть исходные значения</ActionMenuItem> : null}
            </ActionMenu>
          ) : null}
        </div>}
      >
        {isSaving ? <div className="notice-banner"><strong>Сохраняем...</strong><div>Карточка релиза обновляется. Повторно нажимать кнопку не нужно.</div></div> : null}
        {!isSaving && releaseNotice ? <div className={`notice-banner ${releaseNotice.tone}`}><strong>{releaseNotice.tone === "success" ? "Сохранено" : releaseNotice.tone === "warning" ? "Нужно проверить" : "Ошибка"}</strong><div>{releaseNotice.text}</div></div> : null}
        {!currentRelease && screenMode !== "create" ? <EmptyState title="Релиз не выбран" body="Выберите релиз в центральном реестре или создайте новый." /> : screenMode === "view" && currentRelease ? (
          <ReleaseViewPanel
            release={currentRelease}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenParticipant={onOpenParticipant}
            onPreviewSavedPost={previewSavedPost}
            onOpenSavedPost={openSavedPost}
            onDeleteSavedPost={deleteSavedPost}
            selectedSavedPost={selectedSavedPost}
            onNavigate={onNavigate}
            departmentNameById={departmentNameById}
            releaseTypeNameById={releaseTypeNameById}
            releaseStatusCategoryEnabled={releaseStatusCategoryEnabled}
            roleNameById={roleNameById}
            participantNameById={participantNameById}
            platformNameById={platformNameById}
            externalSourceNameById={externalSourceNameById}
            genreNameById={genreNameById}
            tagNameById={tagNameById}
            templateNameById={templateNameById}
            showAdvancedMode={showAdvancedMode}
          />
        ) : !draft ? <EmptyState title="Новый релиз еще не подготовлен" body="Нажмите «Создать релиз» слева, чтобы открыть форму создания." /> : (
          <div className="section-stack">
            <div className="participant-header">
              <div>
                <h2 className="hero-title">{getReleaseDisplayTitle(draft.release)}</h2>
                {showTechnicalInfo && (getReleaseSecondaryDisplayTitle(draft.release) || draft.release.short_title) ? <div className="muted">{getReleaseSecondaryDisplayTitle(draft.release) || draft.release.short_title}</div> : null}
                <div className="muted" title={[releaseStatusCategoryEnabled ? getReleaseStatusLabel(draft.release.release_status_id, releaseStatusOptions) : null, releaseTypeNameById.get(draft.release.release_type_id), getLookupLabel(departmentNameById, draft.release.primary_department_id, "Отдел не указан")].filter(Boolean).join(" • ")}>
                  {[releaseStatusCategoryEnabled ? getReleaseStatusLabel(draft.release.release_status_id, releaseStatusOptions) : null, releaseTypeNameById.get(draft.release.release_type_id), getLookupLabel(departmentNameById, draft.release.primary_department_id, "Отдел не указан")].filter(Boolean).join(" • ")}
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Chip tone={draft.generated_posts.some((post) => post.finalized) ? "accent" : undefined}>{draft.generated_posts.some((post) => post.finalized) ? "Пост сохранен" : "Пост не готов"}</Chip>
                <Chip tone={draft.release.archival_state.includes("lost") ? "warning" : undefined}>{getReleaseConditionLabel(draft.release.archival_state)}</Chip>
              </div>
            </div>
            <div className="tabs">
              {[
                ["overview", "Обзор"],
                ["team", "Команда"],
                ["roles", "Роли"],
                ["external", "Субтитры"],
                ["content", "Контент"],
                ["posting", "Настройки поста"],
                ["generator", "Сборка поста"],
                ["history", "История"]
              ].map(([tab, label]) => (
                <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>

            {activeTab === "overview" ? (
              <div className="section-stack">
                <div className="grid two">
                  <Field label="Название на русском">
                    <input className="text-input" value={draft.release.title_primary} onChange={(event) => updateDraft((next) => { next.release.title_primary = event.target.value; })} />
                  </Field>
                  <Field label="Другое название">
                    <input className="text-input" value={draft.release.title_secondary ?? ""} onChange={(event) => updateDraft((next) => { next.release.title_secondary = event.target.value; })} />
                  </Field>
                  {releaseStatusCategoryEnabled ? (
                    <Field label="Статус релиза">
                      <select
                        className="select-input"
                        value={draft.release.release_status_id}
                        onChange={(event) => updateDraft((next) => {
                          next.release.release_status_id = event.target.value;
                          next.release.staffing_mode = normalizeReleaseStaffingMode(event.target.value, next.release.staffing_mode);
                        })}
                      >
                        {mergeLookupOptionsWithCurrent(snapshot.directories.release_statuses ?? [], [draft.release.release_status_id]).length
                          ? mergeLookupOptionsWithCurrent(snapshot.directories.release_statuses ?? [], [draft.release.release_status_id]).map((status) => (
                            <option key={status.id} value={status.id}>{getReleaseStatusLabel(status.id, releaseStatusOptions)}</option>
                          ))
                          : <option value={draft.release.release_status_id}>{getReleaseStatusLabel(draft.release.release_status_id, releaseStatusOptions)}</option>}
                      </select>
                    </Field>
                  ) : null}
                  {releaseTypeOptions.length ? (
                    <Field label="Тип релиза">
                      <select className="select-input" value={draft.release.release_type_id} onChange={(event) => updateDraft((next) => { next.release.release_type_id = event.target.value; next.content.age_rating = normalizeAgeRating(next.content.age_rating, event.target.value) ?? ""; })}>
                        {mergeLookupOptionsWithCurrent(snapshot.directories.release_types ?? [], [draft.release.release_type_id]).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  <Field label="Основной отдел">
                    <select className="select-input" value={draft.release.primary_department_id} onChange={(event) => updateDraft((next) => { next.release.primary_department_id = event.target.value; if (!next.release.department_ids.includes(event.target.value)) next.release.department_ids = [...next.release.department_ids, event.target.value]; })}>
                      {mergeLookupOptionsWithCurrent(snapshot.departments, [draft.release.primary_department_id]).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Состояние релиза">
                    <select className="select-input" value={draft.release.archival_state} onChange={(event) => updateDraft((next) => { next.release.archival_state = event.target.value; })}>
                      <option value="normal">Нормальный</option>
                      <option value="archived">Архивный</option>
                      <option value="lost">Утерян</option>
                      <option value="frozen">Заморожен</option>
                    </select>
                  </Field>
                  <Field label="Куратор">
                    <select className="select-input" value={draft.release.curator_id ?? ""} onChange={(event) => updateDraft((next) => { next.release.curator_id = event.target.value || null; })}>
                      <option value="">Не выбран</option>
                      {mergeParticipantPickerOptionsWithCurrent(participantPickerSourceItems, [draft.release.curator_id]).map((item) => <option key={item.id} value={item.id}>{getParticipantPickerLabel(item)}</option>)}
                    </select>
                  </Field>
                  <Field label="Год">
                    <input className="text-input" type="number" value={String(draft.release.release_year ?? "")} onChange={(event) => updateDraft((next) => { next.release.release_year = Number(event.target.value) || null; })} />
                  </Field>
                  <Field label="Сезон">
                    <input className="text-input" type="number" value={String(draft.release.season_number ?? "")} onChange={(event) => updateDraft((next) => { next.release.season_number = Number(event.target.value) || null; })} />
                  </Field>
                  <Field label="Серия с">
                    <input className="text-input" type="number" value={String(draft.release.episode_start ?? "")} onChange={(event) => updateDraft((next) => { next.release.episode_start = Number(event.target.value) || null; })} />
                  </Field>
                  <Field label="Серия по">
                    <input className="text-input" type="number" value={String(draft.release.episode_end ?? "")} onChange={(event) => updateDraft((next) => { next.release.episode_end = Number(event.target.value) || null; })} />
                  </Field>
                  <Field label="Всего серий">
                    <input className="text-input" type="number" value={String(draft.release.episode_count ?? "")} onChange={(event) => updateDraft((next) => { next.release.episode_count = Number(event.target.value) || null; })} />
                  </Field>
                </div>
                {isArchivedReleaseState(draft.release.archival_state) ? (
                  <Field label="Статус архива">
                    <select className="select-input" value={draft.release.archival_state} onChange={(event) => updateDraft((next) => { next.release.archival_state = event.target.value; })}>
                      {RELEASE_ARCHIVE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                ) : null}
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <ToggleChip label="Приоритетный релиз" active={draft.release.top_release_flag} onToggle={(value) => updateDraft((next) => { next.release.top_release_flag = value; })} tone="accent" />
                  <ToggleChip label="Заказной проект" active={draft.release.commissioned_flag} onToggle={(value) => updateDraft((next) => { next.release.commissioned_flag = value; })} tone="accent" />
                  <ToggleChip label="Учебный релиз" active={Boolean(draft.release.training_flag)} onToggle={(value) => updateDraft((next) => { next.release.training_flag = value; })} tone="accent" />
                  <ToggleChip label="Старый релиз" active={Boolean(draft.release.legacy_flag)} onToggle={(value) => updateDraft((next) => { next.release.legacy_flag = value; })} tone="accent" />
                </div>
              </div>
            ) : null}
            {activeTab === "team" ? (
              <div className="section-stack">
                <div className="detail-card">
                  <div className="row spread">
                    <div>
                      <h4>Состав релиза</h4>
                      <div className="muted">
                        {draft.release.release_status_id === "announcement"
                          ? "Для анонса можно либо оставить состав на стадии согласования, либо вести примерный список участников."
                          : "Здесь указываются подтвержденные участники релиза и их роли в посте."}
                      </div>
                    </div>
                    <div className="dashboard-actions">
                      {draft.release.release_status_id === "announcement" && currentStaffingMode === "aligning" ? (
                        <Button
                          className="primary"
                          onClick={() => updateDraft((next) => { next.release.staffing_mode = "provisional"; })}
                          disabled={isSaving}
                        >
                          Перейти к примерному составу
                        </Button>
                      ) : (
                        <Button className="secondary" onClick={startParticipantAssignment} disabled={isSaving}>Добавить участника</Button>
                      )}
                    </div>
                  </div>
                  {draft.release.release_status_id === "announcement" && currentStaffingMode === "aligning" ? (
                    <EmptyState
                      title="Состав еще согласуется"
                      body="В этом режиме релиз не считается укомплектованным. Когда появится примерный список людей, переключите режим состава и добавьте участников."
                    />
                  ) : null}
                  {draft.release.release_status_id === "announcement" && currentStaffingMode === "provisional" ? (
                    <div className="notice-banner warning">
                      <strong>Примерный состав</strong>
                      <div>Эти участники показывают предварительный состав для анонса. Они не считаются окончательно подтвержденными.</div>
                    </div>
                  ) : null}
                </div>
                {draft.release.release_status_id !== "announcement" || currentStaffingMode !== "aligning" ? (
                  <div className="list compact-list">
                    {orderedReleaseParticipants.length ? orderedReleaseParticipants.map((item) => (
                      <div
                        key={item.id}
                        className={`list-item subdued ${dragReleaseParticipantId === item.id ? "dragging" : ""} ${dragReleaseParticipantTargetId === item.id && dragReleaseParticipantId !== item.id ? "drop-target" : ""}`}
                        data-release-participant-order-id={item.id}
                        data-reorder-surface="true"
                        onPointerDown={(event) => beginReleaseParticipantPointerDrag(event, item.id)}
                        onDragStart={(event) => event.preventDefault()}
                      >
                        <div className="grid two">
                          <Field label="Участник">
                            <SearchSelect
                              value={item.participant_id}
                              options={mergeParticipantPickerOptionsWithCurrent(participantPickerSourceItems, [item.participant_id]).map((participant) => ({
                                id: participant.id,
                                label: getParticipantPickerLabel(participant),
                                searchText: participantSearchTextById.get(participant.id) ?? getParticipantPickerLabel(participant)
                              }))}
                              placeholder="Выберите участника"
                              searchPlaceholder="Поиск по нику, имени, фамилии, VK, отделам, ролям и заметкам"
                              emptyText="Участник не найден в составе"
                              onChange={(participantId) => updateDraft((next) => {
                                const target = next.participants.find((entry) => entry.id === item.id);
                                if (target) {
                                  target.participant_id = participantId;
                                }
                              })}
                            />
                          </Field>
                          <Field label="Роль">
                            <select className="select-input" value={item.role_id} onChange={(event) => updateDraft((next) => { const target = next.participants.find((entry) => entry.id === item.id); if (target) { target.role_id = event.target.value; target.credit_group_id = canonicalPostGroupId(event.target.value); } })}>
                              {mergeLookupOptionsWithCurrent(snapshot.directories.participant_roles ?? [], [item.role_id]).length ? mergeLookupOptionsWithCurrent(snapshot.directories.participant_roles ?? [], [item.role_id]).map((role) => <option key={role.id} value={role.id}>{role.name}</option>) : <option value={item.role_id}>{item.role_id}</option>}
                            </select>
                          </Field>
                          <Field label="Группа в посте">
                            <input className="text-input" value={item.credit_group_id} onChange={(event) => updateDraft((next) => { const target = next.participants.find((entry) => entry.id === item.id); if (target) target.credit_group_id = event.target.value; })} />
                          </Field>
                          <Field label="Включать в пост">
                            <select className="select-input" value={item.include_in_post ? "yes" : "no"} onChange={(event) => updateDraft((next) => { const target = next.participants.find((entry) => entry.id === item.id); if (target) target.include_in_post = event.target.value === "yes"; })}>
                              <option value="yes">Да</option>
                              <option value="no">Нет</option>
                            </select>
                          </Field>
                          <Field label="Комментарий">
                            <input className="text-input" value={item.comment_internal ?? ""} onChange={(event) => updateDraft((next) => { const target = next.participants.find((entry) => entry.id === item.id); if (target) target.comment_internal = event.target.value; })} />
                          </Field>
                        </div>
                        <div className="row spread">
                          <Chip tone={item.is_primary_for_role ? "accent" : undefined}>{item.is_primary_for_role ? "Основной слот" : "Дополнительный слот"}</Chip>
                          <div className="row">
                            <Button className="secondary" onClick={() => updateDraft((next) => { const target = next.participants.find((entry) => entry.id === item.id); if (target) target.is_primary_for_role = !target.is_primary_for_role; })}>{item.is_primary_for_role ? "Перевести в доп. слот" : "Сделать основным"}</Button>
                            <Button className="ghost" onClick={() => onOpenParticipant(item.participant_id)} disabled={!item.participant_id}>Открыть участника</Button>
                            <Button className="danger" onClick={() => updateDraft((next) => {
                              next.participants = next.participants.filter((entry) => entry.id !== item.id);
                              const activeParticipantIds = new Set(next.participants.map((entry) => entry.participant_id).filter(Boolean));
                              next.roles = (next.roles ?? [])
                                .filter((entry) => activeParticipantIds.has(entry.participant_id))
                                .map((entry, index) => ({ ...entry, display_order: index + 1 }));
                            })}>Удалить связь</Button>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <EmptyState
                        title={draft.release.release_status_id === "announcement" ? "Примерный состав пока не задан" : "Состав не заполнен"}
                        body={draft.release.release_status_id === "announcement" ? "Добавьте примерный состав для анонса, если хотите показать людей заранее." : "Добавьте участников и роли релиза или загрузите их из импорта."}
                        action={<Button className="secondary" onClick={startParticipantAssignment}>Добавить участника</Button>}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {activeTab === "roles" ? (
              <div className="section-stack">
                <div className="detail-card">
                  <h4>Роли персонажей</h4>
                  <div className="muted">Сначала выберите человека из команды релиза, а потом добавьте ему отдельную карточку роли. Таких карточек можно создать сколько угодно и уже внутри каждой заполнить персонажей и второстепенных персонажей.</div>
                  {releaseRoleParticipantOptions.length ? (
                    <div className="section-stack" style={{ marginTop: 12 }}>
                      <Field label="Участник из команды">
                        <SearchSelect
                          value={newReleaseRoleParticipantId}
                          options={releaseRoleParticipantOptions}
                          placeholder="Выберите участника"
                          searchPlaceholder="Поиск по нику, имени, фамилии, VK, отделам, ролям и заметкам"
                          emptyText="Участник не найден в команде релиза"
                          onChange={setNewReleaseRoleParticipantId}
                        />
                      </Field>
                      <div className="dashboard-actions">
                        <Button className="secondary" onClick={addReleaseRole}>Добавить роль</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                {releaseRoleParticipantOptions.length ? (
                  <div className="list compact-list">
                    {(draft.roles ?? []).length ? (draft.roles ?? []).map((item) => (
                      <ReleaseRoleEditorCard
                        key={item.id}
                        item={item}
                        participantLabel={participantNameById.get(item.participant_id) ?? "Участник не найден"}
                        isEditing={editingReleaseRoleIds.includes(item.id)}
                        onSave={saveReleaseRole}
                        onStartEdit={startEditingReleaseRole}
                        onDelete={removeReleaseRole}
                        onOpenParticipant={onOpenParticipant}
                      />
                    )) : (
                      <EmptyState
                        title="Роли пока не добавлены"
                        body="Выберите человека из команды выше и добавьте ему отдельную карточку роли."
                      />
                    )}
                  </div>
                ) : (
                  <EmptyState
                    title="Сначала соберите команду"
                    body="Роли создаются только для тех людей, которые уже добавлены в команду релиза."
                    action={<Button className="secondary" onClick={startParticipantAssignment}>Добавить участника в команду</Button>}
                  />
                )}
              </div>
            ) : null}
            {activeTab === "external" ? (
              <div className="section-stack">
                <div className="detail-card">
                  <h4>Добавить субтитры / группу</h4>
                  <div className="grid two">
                    <Field label="Вариант записи">
                      <select className="select-input" value={newExternalVariant} onChange={(event) => setNewExternalVariant(event.target.value as ReleaseExternalVariantId)}>
                        {RELEASE_EXTERNAL_VARIANT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </Field>
                    {newExternalVariant === "vk_only" ? (
                      <Field label="Источник субтитров">
                        <input className="text-input" value="Источник не нужен для этого варианта" readOnly />
                      </Field>
                    ) : (
                      <Field label="Источник субтитров">
                        <select className="select-input" value={newExternalSourceId} onChange={(event) => setNewExternalSourceId(event.target.value)}>
                          <option value="">Выберите источник</option>
                          {availableExternalSourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </Field>
                    )}
                    <Field label="Блок в посте"><input className="text-input" value="перевод" readOnly /></Field>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Button className="secondary" onClick={addExternalAssignment}>Добавить субтитры</Button>
                  </div>
                </div>
                <div className="list compact-list">
                  {orderedReleaseExternals.length ? orderedReleaseExternals.map((item) => {
                    const itemVariant = getReleaseExternalVariant(item, externalSourceTypeById);
                    const itemSourceOptions = mergeLookupOptionsWithCurrent(snapshot.externalSources, [item.external_source_id]).filter((source) => {
                      const typeId = source.external_source_type_id ?? "translator";
                      return typeId === itemVariant;
                    });
                    return (
                    <div
                      key={item.id}
                      className={`list-item subdued ${dragReleaseExternalId === item.id ? "dragging" : ""} ${dragReleaseExternalTargetId === item.id && dragReleaseExternalId !== item.id ? "drop-target" : ""}`}
                      data-release-external-order-id={item.id}
                      data-reorder-surface="true"
                      onPointerDown={(event) => beginReleaseExternalPointerDrag(event, item.id)}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <div className="row spread">
                        <div>
                          <strong>{getReleaseExternalDisplayLine(item, externalSourceNameById)}</strong>
                          {getReleaseExternalTranslatorLine(item) ? <div className="muted">{getReleaseExternalTranslatorLine(item)}</div> : null}
                        </div>
                        <Chip tone={item.is_primary_source ? "accent" : undefined}>{item.is_primary_source ? "Основной источник" : "Дополнительный источник"}</Chip>
                      </div>
                      <div className="grid two">
                        <Field label="Вариант записи">
                          <select
                            className="select-input"
                            value={itemVariant}
                            onChange={(event) => updateDraft((next) => {
                              const target = next.external.find((entry) => entry.id === item.id);
                              if (!target) return;
                              const nextVariant = event.target.value as ReleaseExternalVariantId;
                              target.external_source_type_id = nextVariant;
                              if (nextVariant === "vk_only") {
                                target.external_source_id = "";
                                return;
                              }
                              const fallbackSource = activeExternalSources.find((source) => (source.external_source_type_id ?? "translator") === nextVariant);
                              target.external_source_id = fallbackSource?.id ?? "";
                            })}
                          >
                            {RELEASE_EXTERNAL_VARIANT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </Field>
                        {itemVariant === "vk_only" ? (
                          <Field label="Источник субтитров">
                            <input className="text-input" value="Источник не используется в этой записи" readOnly />
                          </Field>
                        ) : (
                          <Field label="Источник субтитров">
                            <select className="select-input" value={item.external_source_id ?? ""} onChange={(event) => updateDraft((next) => { const target = next.external.find((entry) => entry.id === item.id); if (target) target.external_source_id = event.target.value; })}>
                              <option value="">Выберите источник</option>
                              {itemSourceOptions.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                            </select>
                          </Field>
                        )}
                        <Field label="Название / подпись">
                          <input
                            className="text-input"
                            value={item.credit_label_override ?? ""}
                            onChange={(event) => updateDraft((next) => {
                              const target = next.external.find((entry) => entry.id === item.id);
                              if (target) target.credit_label_override = event.target.value;
                            })}
                            placeholder={externalSourceNameById.get(item.external_source_id ?? "") ?? "Партнерская FSG"}
                          />
                        </Field>
                        <Field label="Упоминание VK" help="Например @id341515 или @club12345. В посте будет показано после названия.">
                          <input
                            className="text-input"
                            value={item.vk_mention ?? ""}
                            onChange={(event) => updateDraft((next) => {
                              const target = next.external.find((entry) => entry.id === item.id);
                              if (target) target.vk_mention = event.target.value;
                            })}
                            placeholder="@id341515"
                          />
                        </Field>
                        <Field label="Название сообщества" help="Имя, которое будет показано в скобках после упоминания.">
                          <input
                            className="text-input"
                            value={item.vk_display_name ?? ""}
                            onChange={(event) => updateDraft((next) => {
                              const target = next.external.find((entry) => entry.id === item.id);
                              if (target) target.vk_display_name = event.target.value;
                            })}
                            placeholder="Хорошие сабы"
                          />
                        </Field>
                        <Field label="Включать в пост">
                          <select className="select-input" value={item.include_in_post ? "yes" : "no"} onChange={(event) => updateDraft((next) => { const target = next.external.find((entry) => entry.id === item.id); if (target) target.include_in_post = event.target.value === "yes"; })}>
                            <option value="yes">Да</option>
                            <option value="no">Нет</option>
                          </select>
                        </Field>
                        <Field label="Комментарий">
                          <input className="text-input" value={item.comment_internal ?? ""} onChange={(event) => updateDraft((next) => { const target = next.external.find((entry) => entry.id === item.id); if (target) target.comment_internal = event.target.value; })} />
                        </Field>
                      </div>
                      <div className="section-stack" style={{ marginTop: 12 }}>
                        <div className="row spread">
                          <strong>Переводчики</strong>
                          <Button
                            className="secondary"
                            onClick={() => updateDraft((next) => {
                              const target = next.external.find((entry) => entry.id === item.id);
                              if (!target) return;
                              target.translator_names = [...(target.translator_names ?? []), ""];
                            })}
                          >
                            Добавить переводчика
                          </Button>
                        </div>
                        {(item.translator_names?.length ?? 0) ? (
                          <div className="section-stack">
                            {(item.translator_names ?? []).map((translator, translatorIndex) => (
                              <div key={`${item.id}_translator_${translatorIndex}`} className="row">
                                <input
                                  className="text-input"
                                  value={translator}
                                  onChange={(event) => updateDraft((next) => {
                                    const target = next.external.find((entry) => entry.id === item.id);
                                    if (!target) return;
                                    const nextNames = [...(target.translator_names ?? [])];
                                    nextNames[translatorIndex] = event.target.value;
                                    target.translator_names = nextNames;
                                  })}
                                  placeholder="Имя переводчика"
                                />
                                <Button
                                  className="ghost"
                                  onClick={() => updateDraft((next) => {
                                    const target = next.external.find((entry) => entry.id === item.id);
                                    if (!target) return;
                                    target.translator_names = (target.translator_names ?? []).filter((_, index) => index !== translatorIndex);
                                  })}
                                >
                                  Убрать
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : <div className="muted">Переводчики пока не указаны.</div>}
                      </div>
                      <div className="row spread">
                        <div className="muted">Перетащите карточку мышью, чтобы поменять порядок вывода.</div>
                        <div className="row">
                          <Button className="secondary" onClick={() => updateDraft((next) => { const target = next.external.find((entry) => entry.id === item.id); if (target) target.is_primary_source = !target.is_primary_source; })}>{item.is_primary_source ? "Сделать дополнительным" : "Сделать основным"}</Button>
                          <Button className="danger" onClick={() => updateDraft((next) => { next.external = next.external.filter((entry) => entry.id !== item.id).map((entry, index) => ({ ...entry, display_order: index + 1 })); })}>Удалить</Button>
                        </div>
                      </div>
                    </div>
                  )}) : <EmptyState title="Субтитры пока не заданы" body="Здесь появятся группы субтитров, переводчики и партнерские источники." />}
                </div>
              </div>
            ) : null}
            {activeTab === "content" ? (
              <div className="section-stack">
                <div className="grid two">
                  <Field label="Добавить площадку">
                    <div className="section-stack">
                      <div className="row">
                        <select className="select-input" value={newPlatformId} onChange={(event) => setNewPlatformId(event.target.value)}>
                          <option value="">Выберите площадку</option>
                          {platformOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <Button className="secondary" onClick={addPlatform}>Добавить</Button>
                      </div>
                      <div className="row">
                        <input
                          className="text-input"
                          value={newPlatformName}
                          onChange={(event) => setNewPlatformName(event.target.value)}
                          placeholder="Новая площадка"
                        />
                        <Button className="secondary" onClick={() => void createPlatformOption()}>Создать площадку</Button>
                      </div>
                    </div>
                  </Field>
                  <Field label="Возрастной рейтинг">
                    <select className="select-input" value={draft.content.age_rating ?? ""} onChange={(event) => updateDraft((next) => { next.content.age_rating = event.target.value; })}>
                      <option value="">Не указан</option>
                      {ageRatingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Показывать рейтинг в посте">
                    <label className="toggle-field">
                      <input
                        type="checkbox"
                        checked={draft.posting.include_age_rating_in_post !== false}
                        onChange={(event) => updateDraft((next) => { next.posting.include_age_rating_in_post = event.target.checked; })}
                      />
                      <span>Добавлять возрастной рейтинг в готовый пост</span>
                    </label>
                  </Field>
                </div>
                <div className="grid two">
                  <Field label="Описание"><textarea className="text-area" value={getReleaseDescriptionValue(draft.content)} onChange={(event) => updateDraft((next) => { next.content.description_full = event.target.value; next.content.description_short = ""; })} /></Field>
                  <Field label="Страна"><input className="text-input" value={draft.content.country_of_origin ?? ""} onChange={(event) => updateDraft((next) => { next.content.country_of_origin = event.target.value; })} /></Field>
                  <Field label="Заметка по состоянию релиза"><textarea className="text-area" value={draft.content.content_status_note ?? ""} onChange={(event) => updateDraft((next) => { next.content.content_status_note = event.target.value; })} /></Field>
                </div>
                <div className="details-grid">
                  <div className="detail-card">
                    <h4>Жанры</h4>
                    {draft.content.genre_ids.length ? (
                      <div className="chip-group compact-chip-summary">
                        {draft.content.genre_ids.map((genreId) => <Chip key={genreId}>{getLookupLabel(genreNameById, genreId, "Жанр")}</Chip>)}
                      </div>
                    ) : <div className="muted">Жанры пока не выбраны.</div>}
                    <details className="detail-disclosure choice-disclosure">
                      <summary className="disclosure-summary">
                        <strong>Выбрать жанры</strong>
                        <span className="muted">Полный список жанров открывается отдельно, чтобы не перегружать основную форму.</span>
                      </summary>
                      <div className="detail-disclosure-body">
                        <OptionChipGroup options={genreOptions.map((item) => ({ id: item.id, label: item.name }))} selectedIds={draft.content.genre_ids} onToggle={(genreId) => updateDraft((next) => { next.content.genre_ids = toggleId(next.content.genre_ids, genreId); })} />
                      </div>
                    </details>
                  </div>
                  <div className="detail-card">
                    <h4>Теги</h4>
                    {draft.content.tag_ids.length ? (
                      <div className="chip-group compact-chip-summary">
                        {draft.content.tag_ids.map((tagId) => <Chip key={tagId}>{getLookupLabel(tagNameById, tagId, "Тег")}</Chip>)}
                      </div>
                    ) : <div className="muted">Теги пока не выбраны.</div>}
                    <details className="detail-disclosure choice-disclosure">
                      <summary className="disclosure-summary">
                        <strong>Выбрать теги</strong>
                        <span className="muted">Основная форма показывает только выбранные теги, а полный набор открывается здесь.</span>
                      </summary>
                      <div className="detail-disclosure-body">
                        <OptionChipGroup options={tagOptions.map((item) => ({ id: item.id, label: item.name }))} selectedIds={draft.content.tag_ids} onToggle={(tagId) => updateDraft((next) => { next.content.tag_ids = toggleId(next.content.tag_ids, tagId); })} />
                      </div>
                    </details>
                  </div>
                </div>
                <Field label="Предупреждения / контентные пометки"><textarea className="text-area" value={draft.content.warning_notes ?? ""} onChange={(event) => updateDraft((next) => { next.content.warning_notes = event.target.value; })} /></Field>
                <div className="list compact-list">
                  {draft.content.platform_links.length ? draft.content.platform_links.map((item, index) => (
                    <div key={`${item.platform_id}_${index}`} className="list-item subdued">
                      <div className="grid two">
                        <Field label="Площадка">
                          <select className="select-input" value={item.platform_id} onChange={(event) => updateDraft((next) => { const target = next.content.platform_links[index]; if (target) target.platform_id = event.target.value; })}>
                            <option value="">Не выбрана</option>
                            {platformOptions.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
                          </select>
                        </Field>
                        <Field label="URL"><input className="text-input" value={item.url ?? ""} onChange={(event) => updateDraft((next) => { const target = next.content.platform_links[index]; if (target) target.url = event.target.value; })} /></Field>
                      </div>
                      <div className="row spread">
                        <Chip tone={item.is_primary ? "accent" : undefined}>{item.is_primary ? "Основная" : "Дополнительная"}</Chip>
                        <div className="row">
                          <Button className="secondary" onClick={() => updateDraft((next) => { const target = next.content.platform_links[index]; if (target) target.is_primary = !target.is_primary; })}>{item.is_primary ? "Снять основной статус" : "Сделать основной"}</Button>
                          <Button className="danger" onClick={() => updateDraft((next) => { next.content.platform_links = next.content.platform_links.filter((_, position) => position !== index); })}>Удалить</Button>
                        </div>
                      </div>
                    </div>
                  )) : <EmptyState title="Площадки пока не заданы" body="Добавьте площадки, жанры и описание релиза." />}
                </div>
              </div>
            ) : null}
            {activeTab === "posting" ? (
              <div className="section-stack">
                {!availableTemplates.length ? (
                  <EmptyState
                    title="Шаблон поста пока не выбран"
                    body="Для публикации нужен хотя бы один шаблон. Вы можете открыть шаблоны, создать новый или использовать основной шаблон, если он уже есть в наборе."
                    action={
                      <div className="dashboard-actions">
                        <Button className="secondary" onClick={() => onNavigate("directories")}>Открыть шаблоны постов</Button>
                        {standardTemplate ? <Button className="primary" onClick={applyStandardTemplate}>Использовать основной шаблон</Button> : null}
                      </div>
                    }
                  />
                ) : null}
                <div className="grid two">
                  <Field label="Шаблон поста">
                    <select className="select-input" value={draft.posting.default_post_template_id ?? ""} onChange={(event) => updateDraft((next) => { next.posting.default_post_template_id = event.target.value || undefined; })}>
                      <option value="">Не выбран</option>
                      {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Скрывать пустые блоки"><select className="select-input" value={draft.posting.hide_empty_blocks_flag ? "yes" : "no"} onChange={(event) => updateDraft((next) => { next.posting.hide_empty_blocks_flag = event.target.value === "yes"; })}><option value="yes">Да</option><option value="no">Нет</option></select></Field>
                  <Field label="Как показывать серии" help="Для еженедельных релизов можно собирать пост только по текущей серии, даже если в карточке заполнен диапазон.">
                    <select className="select-input" value={draft.posting.episode_label_mode ?? "range"} onChange={(event) => updateDraft((next) => { next.posting.episode_label_mode = event.target.value as "range" | "single"; })}>
                      <option value="range">Диапазон серий</option>
                      <option value="single">Только текущая серия</option>
                    </select>
                  </Field>
                  <Field label="Разделитель поста">
                    <select className="select-input" value={getReleaseSeparator(draft.posting.separator_pattern)} onChange={(event) => updateDraft((next) => { next.posting.separator_pattern = event.target.value; })}>
                      {POST_SEPARATOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Свой заголовок поста"><input className="text-input" value={draft.posting.post_header_override ?? ""} onChange={(event) => updateDraft((next) => { next.posting.post_header_override = event.target.value; })} /></Field>
                  <Field label="Свой нижний блок"><input className="text-input" value={draft.posting.post_footer_override ?? ""} onChange={(event) => updateDraft((next) => { next.posting.post_footer_override = event.target.value; })} /></Field>
                  <Field label="Свои теги"><input className="text-input" value={draft.posting.post_tags_override.join(", ")} onChange={(event) => updateDraft((next) => { next.posting.post_tags_override = splitCsv(event.target.value); })} /></Field>
                  <Field label="Свой блок площадок"><input className="text-input" value={draft.posting.post_platform_block_override ?? ""} onChange={(event) => updateDraft((next) => { next.posting.post_platform_block_override = event.target.value; })} /></Field>
                  <Field label="Своя подпись перевода"><input className="text-input" value={draft.posting.post_external_block_override ?? ""} onChange={(event) => updateDraft((next) => { next.posting.post_external_block_override = event.target.value; })} placeholder="Перевод" /></Field>
                </div>
                <Field label="Внутренние заметки по публикации"><textarea className="text-area" value={draft.posting.posting_notes_internal ?? ""} onChange={(event) => updateDraft((next) => { next.posting.posting_notes_internal = event.target.value; })} /></Field>
                <div className="detail-card">
                  <h4>Шаблон для этого релиза</h4>
                  <div className="muted">
                    {draft.posting.default_post_template_id
                      ? `Сейчас выбран шаблон «${availableTemplates.find((item) => item.id === draft.posting.default_post_template_id)?.name ?? "не найден"}».`
                      : "Для релиза пока не выбран шаблон. Можно назначить основной шаблон или открыть справочник шаблонов."}
                  </div>
                  <div className="dashboard-actions" style={{ marginTop: 12 }}>
                    <Button className="secondary" onClick={() => onNavigate("directories")}>Открыть шаблоны постов</Button>
                    {standardTemplate ? <Button className="primary" onClick={applyStandardTemplate}>Использовать основной шаблон</Button> : null}
                  </div>
                </div>
              </div>
            ) : null}
            {activeTab === "generator" ? (
              <div className="section-stack">
                {!availableTemplates.length ? (
                  <EmptyState
                    title="Сначала выберите шаблон поста"
                    body="Для генерации нужен хотя бы один шаблон. Его можно открыть в справочниках или сразу назначить основной шаблон для релиза."
                    action={
                      <div className="dashboard-actions">
                        <Button className="secondary" onClick={() => onNavigate("directories")}>Открыть шаблоны постов</Button>
                        {standardTemplate ? <Button className="primary" onClick={applyStandardTemplate}>Использовать основной шаблон</Button> : null}
                      </div>
                    }
                  />
                ) : null}
                <div className="detail-card">
                  <h4>Сборка текста поста</h4>
                  <div className="muted">
                    Выберите шаблон, соберите черновик, проверьте текст и сохраните снимок или итоговую версию.
                  </div>
                  <div className="section-stack compact" style={{ marginTop: 12 }}>
                    <Field label="Шаблон для сборки">
                      <select className="select-input" value={templateId ?? ""} onChange={(event) => setTemplateId(event.target.value || undefined)}>
                        <option value="">Использовать шаблон релиза</option>
                        {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                      </select>
                    </Field>
                    <div className="dashboard-actions">
                      <Button className="primary" onClick={() => void generatePreview()} disabled={isSaving || isGenerating || (!availableTemplates.length && !draft.posting.default_post_template_id)}>{isGenerating ? "Собираем пост..." : "Собрать черновик"}</Button>
                      <Button className="secondary" onClick={() => void saveGenerated(false)} disabled={isSaving || isGenerating || !generatedDraft.trim()}>Сохранить черновик</Button>
                      <Button className="primary" onClick={() => void saveGenerated(true)} disabled={isSaving || isGenerating || !generatedDraft.trim()}>Сохранить как итог</Button>
                      <Button className="secondary" onClick={() => void window.fronda.copyText(generatedDraft)} disabled={isGenerating || !generatedDraft.trim()}>Копировать в буфер</Button>
                      <ActionMenu label="Еще действия">
                        <ActionMenuItem onClick={() => void saveGenerated(false)} disabled={isSaving || isGenerating || !generatedDraft.trim()}>Сохранить черновик</ActionMenuItem>
                        <ActionMenuItem onClick={() => void saveGenerated(true)} disabled={isSaving || isGenerating || !generatedDraft.trim()}>Сохранить как итог</ActionMenuItem>
                        <ActionMenuItem onClick={applyStandardTemplate} disabled={isSaving || isGenerating}>Использовать основной шаблон</ActionMenuItem>
                        <ActionMenuItem onClick={() => onNavigate("directories")}>Открыть шаблоны постов</ActionMenuItem>
                      </ActionMenu>
                    </div>
                  </div>
                </div>
                {generated?.warnings.length ? <div className="notice-banner warning">{generated.warnings.join(" • ")}</div> : null}
                <div className="detail-card">
                  <h4>Сохраненные версии</h4>
                  <div className="list compact-list">
                    {draft.generated_posts.length ? draft.generated_posts.map((post) => (
                      <div key={post.id} className="list-item subdued">
                        <div className="row spread">
                          <div>
                            <strong>{post.title}</strong>
                            <div className="muted">{formatDate(post.updated_at)} • {post.finalized ? "итоговая версия" : "черновик"}</div>
                          </div>
                          <div className="row" style={{ flexWrap: "wrap" }}>
                            <Chip tone={post.finalized ? "accent" : undefined}>{post.finalized ? "Итог" : "Черновик"}</Chip>
                            <Button className="ghost" onClick={() => previewSavedPost(post.id)}>Посмотреть</Button>
                            <Button className="ghost" onClick={() => openSavedPost(post.id)}>Открыть в редакторе</Button>
                            <Button className="danger" onClick={() => void deleteSavedPost(post.id)} disabled={isSaving}>Удалить</Button>
                          </div>
                        </div>
                      </div>
                    )) : <div className="muted">Сохраненных версий пока нет. Сначала соберите и сохраните черновик или итог.</div>}
                  </div>
                </div>
                {selectedSavedPost ? (
                  <div className="detail-card">
                    <h4>{selectedSavedPost.finalized ? "Итоговый пост" : "Сохраненный черновик"}</h4>
                    <div className="muted">{selectedSavedPost.title} • {formatDate(selectedSavedPost.updated_at)}</div>
                    <div className="post-preview-box" style={{ marginTop: 12 }} title={selectedSavedPost.content}>
                      {selectedSavedPost.content}
                    </div>
                  </div>
                ) : null}
                <div className="detail-card">
                  <h4>Предпросмотр поста</h4>
                  <div className="post-preview-box" title={generatedDraft || "Пока ничего не собрано"}>
                    {generatedDraft || "Соберите черновик, чтобы увидеть итоговый текст поста."}
                  </div>
                </div>
                <Field label="Текст для правки">
                  <textarea className="text-area json-box" value={generatedDraft} onChange={(event) => setGeneratedDraft(event.target.value)} />
                </Field>
              </div>
            ) : null}
            {activeTab === "history" ? <div className="section-stack"><div className="list compact-list">{draft.history.length ? draft.history.map((item) => <div key={item.id} className="list-item subdued"><div className="row spread"><div><strong>{item.summary || item.action}</strong><div className="muted">{formatDate(item.at)} • {item.actor}</div></div><Chip>{translateCode(item.source ?? "manual")}</Chip></div><div className="muted">Источник изменения: {translateCode(item.source ?? "manual")}</div>{showTechnicalInfo ? <div className="muted">Версия: {item.revision ?? "—"} • файл: {item.file_path ?? "ручное изменение"}</div> : null}</div>) : <EmptyState title="История релиза пока пуста" body="После сохранений, импорта и восстановления здесь появится журнал изменений релиза." />}</div><Panel title="Сохраненные посты" subtitle="Снимки постов для этого релиза."><div className="list">{draft.generated_posts.length ? draft.generated_posts.map((post) => <div key={post.id} className="list-item"><div className="row spread"><div><h3>{post.title}</h3><div className="muted">{formatDate(post.updated_at)}</div></div><div className="row" style={{ flexWrap: "wrap" }}><Chip tone={post.finalized ? "accent" : undefined}>{post.finalized ? "Итоговая версия" : "Черновик"}</Chip><Button className="ghost" onClick={() => previewSavedPost(post.id)}>Посмотреть</Button><Button className="ghost" onClick={() => openSavedPost(post.id)}>Открыть в редакторе</Button><Button className="danger" onClick={() => void deleteSavedPost(post.id)} disabled={isSaving}>Удалить</Button></div></div></div>) : <EmptyState title="Сохраненных постов пока нет" body="Соберите пост и сохраните снимок, чтобы заполнить эту историю." />}</div></Panel>{selectedSavedPost ? <Panel title={selectedSavedPost.finalized ? "Итоговый пост" : "Сохраненный черновик"} subtitle={`${selectedSavedPost.title} • ${formatDate(selectedSavedPost.updated_at)}`}><div className="post-preview-box" title={selectedSavedPost.content}>{selectedSavedPost.content}</div></Panel> : null}{showTechnicalInfo ? <Field label="Служебные сведения"><textarea className="text-area json-box" value={toPrettyJson(draft.entity_manifest)} readOnly /></Field> : null}</div> : null}
          </div>
        )}
      </Panel>
      ) : null}
      </ScrollRegion>
      <ScrollRegion scrollKey={`releases:summary:${selectedId || "empty"}`}>
      <Panel title="Сводка по релизу" subtitle="Быстрые операции по составу, источникам и готовности публикации.">
        {!currentRelease ? <EmptyState title="Сводка недоступна" body="Сначала выберите релиз в центральном реестре." /> : (
          <div className="section-stack">
            <div className="detail-card sticky-actions-card">
              <h4>Быстрые действия</h4>
              <div className="dashboard-actions">
                {screenMode === "view" ? <Button className="secondary" onClick={() => setDetailExpanded((value) => !value)}>{detailMode ? "Вернуться к реестру" : "Открыть полный обзор"}</Button> : null}
                {screenMode === "view" ? <Button className="primary" onClick={beginEditing} disabled={isSaving}>Редактировать</Button> : null}
                {screenMode === "view" ? <Button className="danger" onClick={() => setPendingDeleteRelease(true)} disabled={isSaving}>Удалить релиз</Button> : null}
                <Button
                  className="secondary"
                  onClick={() => {
                    if (currentRelease.release.release_status_id === "announcement" && getReleaseStaffingMode(currentRelease.release) === "aligning") {
                      enterEditModeWith((next) => {
                        next.release.staffing_mode = "provisional";
                      }, "team");
                      return;
                    }
                    startParticipantAssignment();
                  }}
                  disabled={isSaving}
                >
                  {currentRelease.release.release_status_id === "announcement" && getReleaseStaffingMode(currentRelease.release) === "aligning"
                    ? "Включить примерный состав"
                    : "Добавить участника"}
                </Button>
                <Button className="primary" onClick={() => void generatePreview()} disabled={isSaving || isGenerating}>{isGenerating ? "Собираем пост..." : "Собрать пост"}</Button>
                <ActionMenu label="Еще действия">
                  <ActionMenuItem onClick={addExternalAssignment} disabled={isSaving || isGenerating}>Добавить источник</ActionMenuItem>
                  <ActionMenuItem onClick={addPlatform} disabled={isSaving || isGenerating}>Добавить площадку</ActionMenuItem>
                  <ActionMenuItem onClick={() => setActiveTab("content")} disabled={isSaving || isGenerating}>Открыть жанры и теги</ActionMenuItem>
                  <ActionMenuItem onClick={() => onNavigate("directories")}>Открыть шаблоны постов</ActionMenuItem>
                </ActionMenu>
              </div>
            </div>
            <div className="detail-card">
              <h4>Быстрый статус</h4>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {releaseStatusCategoryEnabled ? <Chip>{getReleaseStatusLabel(currentRelease.release.release_status_id, releaseStatusOptions)}</Chip> : null}
                <Chip tone={currentRelease.generated_posts.some((post) => post.finalized) ? "accent" : undefined}>{currentRelease.generated_posts.some((post) => post.finalized) ? "Пост готов" : "Нет финального поста"}</Chip>
                <Chip tone={releaseNeedsAttention(currentRelease) ? "warning" : "success"}>
                  {releaseNeedsAttention(currentRelease) ? "Нужно проверить данные" : "Данные в порядке"}
                </Chip>
              </div>
            </div>
            <div className="detail-card">
              <h4>Коротко</h4>
              <div className="summary-key-list">
                <div className="compact-row"><strong>Состав</strong><span className="muted">{currentReleaseUniqueParticipantCount} {pluralizeSimple(currentReleaseUniqueParticipantCount, "участник", "участников")}</span></div>
                <div className="compact-row"><strong>Площадки</strong><span className="muted">{currentRelease.content.platform_links.length || "не указаны"}</span></div>
                <div className="compact-row"><strong>Источник</strong><span className="muted">{primaryExternal ? getReleaseExternalDisplayLine(primaryExternal, externalSourceNameById) : "не задан"}</span></div>
                {getReleaseStaffingMode(currentRelease.release) === "confirmed" ? (
                  <div className="compact-row"><strong>Не хватает ролей</strong><span className="muted">{missingRoles.length ? formatPostGroupList(missingRoles) : "все основные роли закрыты"}</span></div>
                ) : null}
              </div>
            </div>
            <div className="detail-card">
              <h4>Публикация</h4>
              <div className="summary-key-list">
                <div className="compact-row"><strong>Шаблон</strong><span className="muted">{availableTemplates.find((item) => item.id === currentRelease.posting.default_post_template_id)?.name ?? "не выбран"}</span></div>
                <div className="compact-row"><strong>Основная площадка</strong><span className="muted">{primaryPlatform ? getLookupLabel(platformNameById, primaryPlatform.platform_id, "не задана") : "не задана"}</span></div>
                <div className="compact-row"><strong>Снимки поста</strong><span className="muted">{currentRelease.generated_posts.length}</span></div>
              </div>
            </div>
            {showTechnicalInfo ? <div className="detail-card">
              <h4>Служебные сведения</h4>
              <div className="muted mono">{currentRelease.release.id}</div>
              <div className="muted mono">Внутренняя версия записи: {currentRelease.entity_manifest.entity_revision}</div>
              <div className="muted">Состояние релиза: {getReleaseConditionLabel(currentRelease.release.archival_state)}</div>
            </div> : null}
          </div>
        )}
      </Panel>
      </ScrollRegion>
    </div>
    {pendingDeleteRelease && sourceRelease ? (
      <AppConfirmModal
        sectionLabel="Релизы"
        title={`Удалить релиз «${getReleaseDisplayTitle(sourceRelease.release)}»?`}
        message="Будут удалены карточка релиза, состав, роли, источники, контент, история и сохраненные версии поста этого релиза."
        confirmLabel="Удалить релиз"
        confirmTone="danger"
        onConfirm={() => {
          setPendingDeleteRelease(false);
          void deleteSelectedRelease();
        }}
        onCancel={() => setPendingDeleteRelease(false)}
      />
    ) : null}
    {releaseArchiveChoiceOverlay}
    </>
  );
}

function ParticipantRegistryItem({
  item,
  active,
  viewMode,
  roleNameById,
  departmentNameById,
  showAdvancedMode,
  isDragging,
  isDropTarget,
  onPointerDown,
  onOpen,
  onOpenDetails
}: {
  item: ParticipantView;
  active: boolean;
  viewMode: "list" | "cards";
  roleNameById: Map<string, string>;
  departmentNameById: Map<string, string>;
  showAdvancedMode: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpen: (id: string) => void;
  onOpenDetails: (id: string) => void;
}) {
  const departments = item.departmentIds.map((departmentId) => getLookupLabel(departmentNameById, departmentId, ""));
  const roles = item.roleIds.map((roleId) => getLookupLabel(roleNameById, roleId, ""));
  const summaryLabel = departments[0] ?? "Направление не выбрано";
  const cardClassName =
    viewMode === "cards"
      ? `participant-registry-card ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`
      : `participant-registry-row ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`;
  const { handleClick, handleDoubleClick } = useDelayedOpenIntent(
    () => onOpen(item.id),
    () => onOpenDetails(item.id)
  );

  if (viewMode === "cards") {
    return (
      <div
        className={cardClassName}
        role="button"
        tabIndex={0}
        data-participant-order-id={item.id}
        data-reorder-surface="true"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={onPointerDown}
        onDragStart={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenDetails(item.id);
          }
        }}
      >
        <div className="participant-registry-topline">
          <div className="participant-registry-heading">
            <span className="participant-registry-name">{item.displayName}</span>
            <span className="participant-registry-subtitle">
              {item.nickname} • {summaryLabel}
            </span>
            {showAdvancedMode ? <span className="participant-registry-handle" title={item.mention ?? `@${item.nickname}`}>{item.mention ?? `@${item.nickname}`}</span> : null}
          </div>
          <div className="participant-registry-row-side">
            <Chip tone={item.topReleaseFit ? "accent" : undefined}>{item.activityLevel}</Chip>
          </div>
        </div>
        <div className="participant-registry-card-copy">
          <div className="participant-registry-card-section">
            <strong>Направления</strong>
            <span title={departments.join(", ") || "без направления"}>{departments.join(", ") || "не заданы"}</span>
          </div>
          <div className="participant-registry-card-section">
            <strong>Роли</strong>
            <span title={roles.join(", ") || "без ролей"}>{roles.join(", ") || "не заданы"}</span>
          </div>
        </div>
        <div className="participant-registry-badges">
          <Chip>{translateCode(item.status)}</Chip>
          <Chip tone={item.reliable ? "success" : undefined}>{item.reliabilityLevel}</Chip>
          <Chip tone={item.warningCount > 0 ? "warning" : undefined}>{item.warningCount} предупреждений</Chip>
          {item.remarkCount > 0 ? <Chip tone="warning">{item.remarkCount} замечаний</Chip> : null}
          {item.blacklistCount > 0 ? <Chip tone="danger">Есть блокировка</Chip> : null}
          {item.curatedReleaseCount > 0 ? <Chip tone="accent">Куратор: {item.curatedReleaseCount}</Chip> : null}
          {item.keyMember ? <Chip tone="accent">Ключевой</Chip> : null}
          {item.topReleaseFit ? <Chip tone="accent">Важные релизы</Chip> : null}
          {item.commercialFit ? <Chip tone="accent">Заказные</Chip> : null}
          {item.hasVoiceSample ? <Chip>Есть проба</Chip> : null}
        </div>
        <div className="participant-registry-footer">
          <div className="row spread">
            <span className="muted">Двойной клик открывает полный обзор. Порядок можно менять, перетаскивая карточку мышью.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cardClassName}
      role="button"
      tabIndex={0}
      data-participant-order-id={item.id}
      data-reorder-surface="true"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={onPointerDown}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails(item.id);
        }
      }}
    >
      <div className="participant-registry-row-main">
        <div className="participant-registry-heading">
          <span className="participant-registry-name">{item.displayName}</span>
          <span className="participant-registry-subtitle">
            {item.nickname} • {summaryLabel}
          </span>
          {showAdvancedMode ? <span className="participant-registry-handle" title={item.mention ?? `@${item.nickname}`}>{item.mention ?? `@${item.nickname}`}</span> : null}
        </div>
        {item.notePreview ? (
          <div className="participant-registry-row-note" title={item.noteTooltip ?? item.notePreview}>
            <span className="participant-registry-row-note-title">
              {item.noteCount > 1 ? `${item.noteTitle ?? "Заметка"} • ещё ${item.noteCount - 1}` : (item.noteTitle ?? "Заметка")}
            </span>
            <span className="participant-registry-row-note-body">{item.notePreview}</span>
          </div>
        ) : null}
        <div className="participant-registry-row-side">
          <Chip tone={item.topReleaseFit ? "accent" : undefined}>{item.activityLevel}</Chip>
          <Chip>{translateCode(item.status)}</Chip>
        </div>
      </div>
      <div className="participant-registry-row-summary">
        <span title={roles.join(", ") || "роли не указаны"}>{roles.slice(0, 4).join(", ") || "Роли не заданы"}</span>
        <span>
          {item.warningCount > 0 || item.remarkCount > 0
            ? `Дисциплина: ${item.warningCount} предупреждений, ${item.remarkCount} замечаний`
            : "Без активных дисциплинарных событий"}
        </span>
        {item.curatedReleaseCount > 0 ? <span>Курирует: {item.curatedReleaseCount}</span> : null}
      </div>
      <div className="row spread">
        <span className="muted registry-double-click-note">Двойной клик открывает полный обзор. Порядок можно менять, перетаскивая запись мышью.</span>
      </div>
    </div>
  );
}

function ReleaseRegistryItem({
  item,
  active,
  showAdvancedMode,
  departmentNameById,
  releaseTypeNameById,
  releaseStatusCategoryEnabled,
  isDragging,
  isDropTarget,
  onPointerDown,
  onOpen,
  onOpenDetails
}: {
  item: ReleaseView;
  active: boolean;
  showAdvancedMode: boolean;
  departmentNameById: Map<string, string>;
  releaseTypeNameById: Map<string, string>;
  releaseStatusCategoryEnabled: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpen: (id: string) => void;
  onOpenDetails: (id: string) => void;
}) {
  const { handleClick, handleDoubleClick } = useDelayedOpenIntent(
    () => onOpen(item.id),
    () => onOpenDetails(item.id)
  );
  const releaseTypeLabel = releaseTypeNameById.get(item.type);
  const summaryParts = [
    ...(releaseStatusCategoryEnabled ? [getReleaseStatusLabel(item.status)] : []),
    ...(releaseTypeLabel ? [releaseTypeLabel] : []),
    getLookupLabel(departmentNameById, item.primaryDepartmentId, "Отдел не указан"),
    `команда: ${item.teamCount}`
  ];
  if (item.staffingMode === "confirmed" && item.missingCoreRoles.length) {
    summaryParts.push(`не хватает: ${formatPostGroupList(item.missingCoreRoles)}`);
  }
  const summaryText = summaryParts.join(" • ");

  return (
    <div
      className={`list-item registry-click-target ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      role="button"
      tabIndex={0}
      data-release-order-id={item.id}
      data-reorder-surface="true"
      onPointerDown={onPointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails(item.id);
        }
      }}
    >
      <div className="row spread">
        <div>
          <h3 title={item.title}>{item.title}</h3>
          {showAdvancedMode && (item.shortTitle || item.secondaryTitle) ? (
            <div className="muted" title={item.secondaryTitle || item.shortTitle}>
              {item.secondaryTitle || item.shortTitle}
            </div>
          ) : null}
          <div className="muted" title={summaryText}>
            {summaryText}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <Chip>{item.year ?? "Год не указан"}</Chip>
        {releaseTypeLabel ? <Chip>{releaseTypeLabel}</Chip> : null}
        <Chip tone={item.hasGeneratedPost ? "accent" : undefined}>{item.hasGeneratedPost ? "Пост собран" : "Без поста"}</Chip>
        <Chip tone={item.archivalState.includes("lost") ? "warning" : undefined}>{getReleaseConditionLabel(item.archived && item.archivalState === "normal" ? "archived" : item.archivalState)}</Chip>
        <span className="muted registry-double-click-note">Двойной клик открывает полный обзор.</span>
      </div>
    </div>
  );
}

function ParticipantViewPanel({
  participant,
  selectedView,
  activeTab,
  setActiveTab,
  relatedReleases,
  curatedReleases,
  pinnedNotes,
  participantAssignments,
  participantTemporaryAssignments,
  participantSubstitutions,
  roleNameById,
  rewardTypeNameById,
  departmentNameById,
  positionNameById,
  skillNameById,
  onOpenRelease,
  showAdvancedMode
}: {
  participant: ParticipantAggregate;
  selectedView?: ReturnType<typeof buildParticipantViews>[number];
  activeTab: string;
  setActiveTab: (tab: string) => void;
  relatedReleases: ReleaseAggregate[];
  curatedReleases: ReleaseAggregate[];
  pinnedNotes: ParticipantNote[];
  participantAssignments: PositionAssignment[];
  participantTemporaryAssignments: TemporaryAssignment[];
  participantSubstitutions: { asSubstitute: Substitution[]; asSource: Substitution[] };
  roleNameById: Map<string, string>;
  rewardTypeNameById: Map<string, string>;
  departmentNameById: Map<string, string>;
  positionNameById: Map<string, string>;
  skillNameById: Map<string, string>;
  onOpenRelease: (id: string) => void;
  showAdvancedMode: boolean;
}) {
  const remarks = participant.discipline.filter((item) => item.severity === "remark").length;
  const warnings = participant.discipline.filter((item) => item.severity === "warning").length;
  const activeStructureAssignments = participantAssignments.filter((item) => item.active_flag);
  const hasBlacklist = hasParticipantBlacklist(participant);

  return (
    <div className="section-stack">
      <div className="participant-header">
        <div>
          <h2 className="hero-title">{participant.profile.display_name}</h2>
          <div className="muted">{participant.profile.posting.mention || `@${participant.profile.nickname}`} • {participant.profile.real_name || "реальное имя не указано"}</div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Chip>{translateCode(getParticipantLifecycleStatus(participant))}</Chip>
          <Chip tone={selectedView?.keyMember ? "accent" : undefined}>{selectedView?.keyMember ? "ключевой" : selectedView?.reliabilityLevel ?? "—"}</Chip>
          <Chip tone={selectedView?.topReleaseFit ? "accent" : undefined}>{selectedView?.topReleaseFit ? "топ-релизы" : "обычный приоритет"}</Chip>
          {hasBlacklist ? <Chip tone="danger">ЧЕРНЫЙ СПИСОК</Chip> : null}
        </div>
      </div>
      <div className="tabs">
        {[
          ["overview", "Обзор"],
          ["contacts", "Связь"],
          ["org", "Отделы и роли"],
          ["skills", "Навыки"],
          ["equipment", "Оборудование"],
          ["voice", "Проба голоса"],
          ["releases", "Релизы"],
          ["notes", "Заметки"],
          ["discipline", "Дисциплина"],
          ["rewards", "Вклад в команду"],
          ["posting", "Данные для постов"],
          ["history", "История изменений"]
        ].map(([tab, label]) => (
          <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="section-stack">
          <div className="stat-grid">
            <StatCard label="Отделы" value={selectedView?.departmentIds.length ?? 0} note={getLookupLabels(departmentNameById, selectedView?.departmentIds ?? [], "не назначены")} />
            <StatCard label="Роли" value={selectedView?.roleIds.length ?? 0} note={getLookupLabels(roleNameById, selectedView?.roleIds ?? [], "не указаны")} />
            <StatCard label="Дисциплина" value={`${remarks}/${warnings}`} note="замечания / предупреждения" />
            <StatCard label="Должности" value={activeStructureAssignments.length} note={activeStructureAssignments.length ? activeStructureAssignments.map((item) => getLookupLabel(positionNameById, item.position_id, "должность не найдена")).join(", ") : "не назначены"} />
            <StatCard label="Вклад" value={selectedView?.keyMember ? "ключевой" : selectedView?.reliabilityLevel ?? "—"} note={selectedView?.commercialFit ? "заказные проекты" : "обычный приоритет"} />
            <StatCard label="Курирует релизы" value={curatedReleases.length} note={curatedReleases.length ? curatedReleases.map((item) => getReleaseDisplayTitle(item.release)).slice(0, 2).join(", ") : "не указаны"} />
          </div>
          <div className="details-grid">
            <div className="detail-card">
              <h4>Основные сведения</h4>
              <div className="compact-row"><strong>Ник</strong><span className="muted">{participant.profile.nickname}</span></div>
              <div className="compact-row"><strong>Произношение ника</strong><span className="muted">{participant.profile.nickname_pronunciation || "не указано"}</span></div>
              <div className="compact-row"><strong>Отображаемое имя</strong><span className="muted">{participant.profile.display_name}</span></div>
              <div className="compact-row"><strong>Реальное имя</strong><span className="muted">{participant.profile.real_name || "не указано"}</span></div>
              <div className="compact-row"><strong>Должность</strong><span className="muted">{activeStructureAssignments.length ? activeStructureAssignments.map((item) => getLookupLabel(positionNameById, item.position_id, "должность не найдена")).join(", ") : "не назначена"}</span></div>
              <div className="compact-row"><strong>Релизы</strong><span className="muted">{relatedReleases.length ? `${relatedReleases.length} в работе и истории` : "пока не связаны"}</span></div>
              <div className="compact-row"><strong>Курируемые релизы</strong><span className="muted">{curatedReleases.length ? curatedReleases.map((item) => getReleaseDisplayTitle(item.release)).slice(0, 3).join(", ") : "не указаны"}</span></div>
              <div className="compact-row"><strong>Доступность</strong><span className="muted">{participant.profile.availability_note || "без пометки"}</span></div>
            </div>
            <div className="detail-card">
              <h4>Закрепленные заметки</h4>
              {pinnedNotes.length ? pinnedNotes.map((item) => <div key={item.id} className="muted" title={item.body}>{item.title}</div>) : <div className="muted">Закрепленных заметок пока нет.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "contacts" ? (
        <div className="details-grid">
          <div className="detail-card">
            <h4>Основные контакты</h4>
            <div className="compact-row"><strong>MAX</strong><span className="muted">{participant.profile.contact_max || "не указан"}</span></div>
            <div className="compact-row"><strong>Телефон</strong><span className="muted">{participant.profile.contact_phone || "не указан"}</span></div>
            <div className="compact-row"><strong>Telegram</strong><span className="muted">{participant.profile.contact_telegram || "не указан"}</span></div>
            <div className="compact-row"><strong>VK</strong><span className="muted">{participant.profile.contact_vk || participant.profile.posting.vk_url || "не указан"}</span></div>
          </div>
          <div className="detail-card">
            <h4>Дополнительно</h4>
            <div className="compact-row"><strong>Email</strong><span className="muted">{participant.profile.contact_email || "не указан"}</span></div>
            <div className="compact-row"><strong>Одноклассники</strong><span className="muted">{participant.profile.contact_odnoklassniki || "не указаны"}</span></div>
            {participant.profile.contacts.map(parseAdditionalContactEntry).filter((entry) => entry.label || entry.value).length ? participant.profile.contacts.map(parseAdditionalContactEntry).filter((entry) => entry.label || entry.value).map((entry, index) => (
              <div key={`participant-contact-${index}`} className="compact-row">
                <strong>{entry.label || `Дополнительно ${index + 1}`}</strong>
                <span className="muted">{entry.value || "не указано"}</span>
              </div>
            )) : <div className="compact-row"><strong>Дополнительные контакты</strong><span className="muted">не указаны</span></div>}
          </div>
        </div>
      ) : null}

      {activeTab === "org" ? (
        <div className="section-stack">
          <div className="detail-card">
            <h4>Отделы и роли</h4>
            <div className="muted">{participant.org.department_assignments.map((item) => `${getLookupLabel(departmentNameById, item.department_id, "Отдел не указан")} — ${getDepartmentInterestLabel(item.assignment_status)}`).join(" • ") || "не назначены"}</div>
            <div className="muted" style={{ marginTop: 8 }}>{getLookupLabels(roleNameById, participant.org.role_assignments.filter((item) => item.active).map((item) => item.role_id), "роли не указаны")}</div>
          </div>
          <div className="detail-card">
            <h4>Должности в структуре</h4>
            {activeStructureAssignments.length ? (
              <div className="list compact-list">
                {activeStructureAssignments.map((item) => (
                  <div key={item.id} className="list-item subdued">
                    <div className="compact-row">
                      <strong>{getLookupLabel(positionNameById, item.position_id, "Должность не найдена")}</strong>
                      <span className="muted">{getLookupLabel(departmentNameById, item.department_id, "Отдел не указан")}</span>
                    </div>
                    <div className="compact-row">
                      <span className="muted">{translateCode(item.assignment_kind)}</span>
                      <span className="muted">{formatDate(item.started_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="muted">Структурные должности пока не назначены.</div>}
          </div>
          <div className="stat-grid">
            <StatCard label="Структурные назначения" value={activeStructureAssignments.length} />
            <StatCard label="Временные полномочия" value={participantTemporaryAssignments.length} />
            <StatCard label="Замещает" value={participantSubstitutions.asSubstitute.length} />
            <StatCard label="Его замещают" value={participantSubstitutions.asSource.length} />
          </div>
        </div>
      ) : null}

      {activeTab === "skills" ? (
        <div className="section-stack">
          <div className="detail-card">
            <h4>Навыки и специализации</h4>
            <div className="muted">Навыки: {participant.org.skill_entries.map((item) => getLookupLabel(skillNameById, item.skill_id, "")).filter(Boolean).join(", ") || "не указаны"}</div>
            <div className="muted">Дикция: {DICTION_LEVEL_OPTIONS.find((item) => item.id === getParticipantDictionLevel(participant))?.label ?? "не указана"}</div>
            <div className="muted">Рост в озвучке: {getParticipantGrowthLabels(participant).join(", ") || "не указан"}</div>
            <div className="muted">Рабочие пометки: {participant.org.staffing_flags.map((id) => STAFFING_FLAG_OPTIONS.find((item) => item.id === id)?.label ?? translateCode(id)).join(", ") || "не указаны"}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "equipment" ? (
        <div className="details-grid">
          <div className="detail-card">
            <h4>Оборудование</h4>
            <div className="compact-row"><strong>Статус</strong><span className="muted">{participant.equipment.equipment_status || "не указан"}</span></div>
            <div className="compact-row"><strong>Микрофон</strong><span className="muted">{participant.equipment.microphone_type || "не указан"}</span></div>
            <div className="compact-row"><strong>Аудиоинтерфейс</strong><span className="muted">{participant.equipment.audio_interface || "не указан"}</span></div>
            <div className="compact-row"><strong>Софт</strong><span className="muted">{participant.equipment.software_stack || "не указан"}</span></div>
          </div>
          <div className="detail-card">
            <h4>Ограничения</h4>
            <div className="muted">{participant.equipment.equipment_limitations || participant.equipment.hardware_notes || "Ограничения не указаны."}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "voice" ? (
        <div className="details-grid">
          <div className="detail-card">
            <h4>Проба голоса</h4>
            <div className="compact-row"><strong>Статус</strong><span className="muted">{participant.voice_sample.voice_sample_present ? "добавлена" : "не добавлена"}</span></div>
            <div className="compact-row"><strong>Ссылка или путь</strong><span className="muted">{getVoiceSampleResource(participant.voice_sample) || "не указаны"}</span></div>
            <div className="compact-row"><strong>Дата</strong><span className="muted">{formatDate(participant.voice_sample.voice_sample_uploaded_at)}</span></div>
            <div className="compact-row"><strong>Теги</strong><span className="muted">{participant.voice_sample.voice_tags.map((id) => VOICE_TAG_OPTIONS.find((item) => item.id === id)?.label ?? translateCode(id)).join(", ") || "не указаны"}</span></div>
            <div className="row" style={{ flexWrap: "wrap", marginTop: 12 }}>
              <Button className="secondary" onClick={() => void window.fronda.openResource(getVoiceSampleResource(participant.voice_sample))} disabled={!getVoiceSampleResource(participant.voice_sample)}>Проба</Button>
            </div>
          </div>
          <div className="detail-card">
            <h4>Комментарий</h4>
            <div className="muted">{participant.voice_sample.voice_sample_comment || "Комментарий не добавлен."}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "releases" ? (
        <div className="list">
          {relatedReleases.length ? relatedReleases.map((release) => (
            <div key={release.release.id} className="list-item subdued">
              <div className="row spread">
                <div>
                  <strong>{getReleaseDisplayTitle(release.release)}</strong>
                  <div className="muted">{translateCode(release.release.release_status_id)} • {describeParticipantReleaseLink(release, participant.profile.id, roleNameById)}</div>
                </div>
                <div className="row">
                  {curatedReleases.some((item) => item.release.id === release.release.id) ? <Chip tone="accent">Курирует</Chip> : null}
                  <Button className="ghost" onClick={() => onOpenRelease(release.release.id)}>Открыть релиз</Button>
                </div>
              </div>
            </div>
          )) : <EmptyState title="Связанных релизов пока нет" body="После добавления участника в релизы они появятся здесь." />}
        </div>
      ) : null}

      {activeTab === "notes" ? (
        <div className="list compact-list">
          {participant.notes.length ? participant.notes.map((note) => (
            <div key={note.id} className="list-item subdued">
              <div className="row spread">
                <strong>{note.title}</strong>
                <Chip tone={note.pinned ? "accent" : undefined}>{note.pinned ? "закреплена" : "обычная"}</Chip>
              </div>
              <div className="muted">{note.body}</div>
            </div>
          )) : <EmptyState title="Рабочих заметок пока нет" body="Здесь будут режиссерские, технические и коммуникационные заметки." />}
        </div>
      ) : null}

      {activeTab === "discipline" ? (
        <div className="list compact-list">
          {participant.discipline.length ? participant.discipline.map((item) => (
            <div key={item.id} className="list-item subdued">
              <div className="row spread">
                <strong>{translateCode(item.severity)}</strong>
                <Chip tone={item.active_flag ? "warning" : "success"}>{item.active_flag ? "активно" : "закрыто"}</Chip>
              </div>
              <div className="muted">{item.description}</div>
            </div>
          )) : <EmptyState title="Дисциплинарных событий пока нет" body="Замечания, предупреждения и блокировки появятся в этом журнале." />}
        </div>
      ) : null}

      {activeTab === "rewards" ? (
        <div className="section-stack">
          <div className="detail-card">
            <div className="compact-row"><strong>Приоритет участия</strong><span className="muted">{PARTICIPANT_PRIORITY_OPTIONS.find((option) => option.id === readParticipantPriority(participant.org.staffing_flags))?.label ?? "Обычный приоритет"}</span></div>
            <div className="compact-row"><strong>Рабочие пометки</strong><span className="muted">{participant.org.staffing_flags.map((id) => STAFFING_FLAG_OPTIONS.find((item) => item.id === id)?.label ?? translateCode(id)).join(", ") || "не указаны"}</span></div>
          </div>
          <div className="list compact-list">
            {participant.rewards.length ? participant.rewards.map((item) => (
              <div key={item.id} className="list-item subdued">
                <strong>{getRewardDisplayTitle(item, rewardTypeNameById)}</strong>
                <div className="muted">{getRewardTagsLabel(item.tags)}</div>
              </div>
            )) : <EmptyState title="Пометок по вкладу пока нет" body="Здесь появятся награды, инициативность и дополнительные подтверждения вклада участника." />}
          </div>
        </div>
      ) : null}

      {activeTab === "posting" ? (
        <div className="details-grid">
          <div className="detail-card">
            <h4>Данные для постов</h4>
            <div className="compact-row"><strong>Упоминание VK</strong><span className="muted">{participant.profile.posting.mention || "не указано"}</span></div>
            <div className="compact-row"><strong>Подпись в посте</strong><span className="muted">{getParticipantPostDisplayName(participant)}</span></div>
            <div className="compact-row"><strong>Полная ссылка VK</strong><span className="muted">{participant.profile.posting.vk_url || participant.profile.posting.vk_slug || "не указана"}</span></div>
            <div className="compact-row"><strong>Готовая строка для поста</strong><span className="muted">{buildPostCopyString(participant)}</span></div>
          </div>
          <div className="detail-card">
            <h4>Готовые действия</h4>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Button className="secondary" onClick={() => void window.fronda.copyText(participant.profile.posting.mention ?? "")}>Копировать упоминание</Button>
              <Button className="secondary" onClick={() => void window.fronda.copyText(buildPostCopyString(participant))}>Копировать формат</Button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div className="section-stack">
          <div className="list compact-list">
            {participant.history.length ? participant.history.map((item) => (
              <div key={item.id} className="list-item subdued">
                <strong>{item.summary || item.action}</strong>
                <div className="muted">{formatDate(item.at)} • {item.actor}</div>
                {showAdvancedMode ? <div className="muted">Версия: {item.revision ?? "—"} • файл: {item.file_path ?? "ручное изменение"}</div> : null}
              </div>
            )) : <EmptyState title="История изменений пока пуста" body="После сохранений, импорта и восстановления здесь появится журнал изменений." />}
          </div>
          {showAdvancedMode ? <Field label="Служебные сведения"><textarea className="text-area json-box" value={toPrettyJson(participant.entity_manifest)} readOnly /></Field> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReleaseViewPanel({
  release,
  activeTab,
  setActiveTab,
  onOpenParticipant,
  onPreviewSavedPost,
  onOpenSavedPost,
  onDeleteSavedPost,
  selectedSavedPost,
  onNavigate,
  departmentNameById,
  releaseTypeNameById,
  releaseStatusCategoryEnabled,
  roleNameById,
  participantNameById,
  platformNameById,
  externalSourceNameById,
  genreNameById,
  tagNameById,
  templateNameById,
  showAdvancedMode
}: {
  release: ReleaseAggregate;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenParticipant: (id: string) => void;
  onPreviewSavedPost: (postId: string) => void;
  onOpenSavedPost: (postId: string) => void;
  onDeleteSavedPost: (postId: string) => void;
  selectedSavedPost: ReleaseAggregate["generated_posts"][number] | null;
  onNavigate: (section: NavigationSection) => void;
  departmentNameById: Map<string, string>;
  releaseTypeNameById: Map<string, string>;
  releaseStatusCategoryEnabled: boolean;
  roleNameById: Map<string, string>;
  participantNameById: Map<string, string>;
  platformNameById: Map<string, string>;
  externalSourceNameById: Map<string, string>;
  genreNameById: Map<string, string>;
  tagNameById: Map<string, string>;
  templateNameById: Map<string, string>;
  showAdvancedMode: boolean;
}) {
  const teamEntries = buildReleaseTeamEntries(release, participantNameById, roleNameById);
  const uniqueParticipantCount = getReleaseUniqueParticipantCount(release);
  const releaseRoleEntries = buildReleaseRoleEntries(release, participantNameById);
  const releaseTypeLabel = releaseTypeNameById.get(release.release.release_type_id);
  const releaseHeaderSummary = [
    releaseStatusCategoryEnabled ? getReleaseStatusLabel(release.release.release_status_id) : null,
    releaseTypeLabel,
    getLookupLabel(departmentNameById, release.release.primary_department_id, "Отдел не указан")
  ].filter(Boolean).join(" • ");

  return (
    <div className="section-stack">
      <div className="participant-header">
        <div>
          <h2 className="hero-title">{getReleaseDisplayTitle(release.release)}</h2>
          {showAdvancedMode && (getReleaseSecondaryDisplayTitle(release.release) || release.release.short_title) ? <div className="muted">{getReleaseSecondaryDisplayTitle(release.release) || release.release.short_title}</div> : null}
          <div className="muted">{releaseHeaderSummary}</div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Chip tone={release.generated_posts.some((post) => post.finalized) ? "accent" : undefined}>{release.generated_posts.some((post) => post.finalized) ? "Пост готов" : "Пост не готов"}</Chip>
          <Chip tone={release.release.archival_state.includes("lost") ? "warning" : undefined}>{getReleaseConditionLabel(release.release.archival_state)}</Chip>
        </div>
      </div>
      <div className="tabs">
              {[
                ["overview", "Обзор"],
                ["team", "Команда"],
                ["roles", "Роли"],
                ["external", "Субтитры"],
                ["content", "Контент"],
                ["posting", "Настройки поста"],
                ["generator", "Сборка поста"],
          ["history", "История"]
        ].map(([tab, label]) => (
          <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="section-stack">
          <div className="stat-grid">
            <StatCard
              label="Команда"
              value={uniqueParticipantCount}
              note={formatSimpleCount(release.external.length, "источник субтитров", "источников субтитров")}
            />
            <StatCard label="Роли" value={releaseRoleEntries.length} note={releaseRoleEntries.length ? releaseRoleEntries.slice(0, 2).map((item) => item.participantLabel).join(", ") : "не назначены"} />
            <StatCard label="Площадки" value={release.content.platform_links.length} note={`${release.content.genre_ids.length} жанров`} />
            <StatCard label="Теги" value={release.content.tag_ids.length} note={formatSimpleCount(release.generated_posts.length, "снимок", "снимков")} />
            <StatCard label="Год" value={release.release.release_year ?? "—"} note={getReleaseConditionLabel(release.release.archival_state)} />
          </div>
          <div className="details-grid">
            <div className="detail-card">
              <h4>Основные сведения</h4>
              {releaseTypeLabel ? <div className="compact-row"><strong>Тип релиза</strong><span className="muted">{releaseTypeLabel}</span></div> : null}
              <div className="compact-row"><strong>Куратор</strong><span className="muted">{participantNameById.get(release.release.curator_id ?? "") ?? "не указан"}</span></div>
              <div className="compact-row"><strong>Сезон</strong><span className="muted">{release.release.season_number ?? "не указан"}</span></div>
              <div className="compact-row"><strong>Серии</strong><span className="muted">{release.release.episode_start ?? "—"} – {release.release.episode_end ?? "—"}</span></div>
              <div className="compact-row"><strong>Всего серий</strong><span className="muted">{release.release.episode_count ?? "не указано"}</span></div>
            </div>
            <div className="detail-card">
              <h4>Флаги релиза</h4>
              {getReleaseFlagLabels(release.release).length ? (
                <div className="chip-group">
                  {getReleaseFlagLabels(release.release).map((label) => <Chip key={label} tone="accent">{label}</Chip>)}
                </div>
              ) : <div className="muted">Особые пометки не указаны.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "team" ? (
        <div className="section-stack">
          {isAnnouncementRelease(release.release) && getReleaseStaffingMode(release.release) === "aligning" ? (
            <EmptyState title="Состав еще согласуется" body="Для этого анонса состав пока не подтвержден и не показывается как готовая команда." />
          ) : (
            <div className="list compact-list">
              {teamEntries.length ? teamEntries.map((item) => (
                <div key={item.participantId} className="list-item subdued">
                  <div className="row spread">
                    <div>
                      <strong>{item.displayName}</strong>
                      <div className="muted">{item.roles.join(", ") || "Роль не указана"}</div>
                    </div>
                    <Button className="ghost" onClick={() => onOpenParticipant(item.participantId)}>Открыть</Button>
                  </div>
                </div>
              )) : <EmptyState title="Команда релиза пока не заполнена" body={isAnnouncementRelease(release.release) ? "Добавьте примерный состав для анонса, если хотите показать участников заранее." : "После добавления участников они появятся здесь."} />}
            </div>
          )}
          {isAnnouncementRelease(release.release) && getReleaseStaffingMode(release.release) === "provisional" ? (
            <div className="notice-banner warning">
              <strong>Примерный состав</strong>
              <div>Сейчас в релизе показан предварительный список участников. Его можно уточнять до перехода в активную работу.</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "roles" ? (
        <div className="section-stack">
          <div className="detail-card">
            <h4>Роли персонажей</h4>
            <div className="muted">Здесь видно, какие персонажи закреплены за участниками команды релиза.</div>
          </div>
          <div className="list compact-list">
            {releaseRoleEntries.length ? releaseRoleEntries.map((item) => (
              <div key={item.id} className="list-item subdued">
                <div className="row spread">
                  <div>
                    <strong>{item.participantLabel}</strong>
                    {item.characterText ? <div className="muted">{item.characterText}</div> : null}
                  </div>
                  <Button className="ghost" onClick={() => onOpenParticipant(item.participantId)}>Открыть участника</Button>
                </div>
              </div>
            )) : <EmptyState title="Роли пока не назначены" body="После добавления ролей участникам команды они появятся здесь." />}
          </div>
        </div>
      ) : null}

      {activeTab === "external" ? (
        <div className="list compact-list">
          {release.external.length ? release.external.map((item) => (
            <div key={item.id} className="list-item subdued">
              <strong>{getReleaseExternalDisplayLine(item, externalSourceNameById)}</strong>
              {getReleaseExternalTranslatorLine(item) ? <div className="muted">{getReleaseExternalTranslatorLine(item)}</div> : null}
              {!getReleaseExternalTranslatorLine(item) ? <div className="muted">Переводчики не указаны</div> : null}
            </div>
          )) : <EmptyState title="Субтитры не указаны" body="Здесь появятся группы субтитров, переводчики и партнерские источники." />}
        </div>
      ) : null}

      {activeTab === "content" ? (
        <div className="details-grid">
          <div className="detail-card">
            <h4>Описание</h4>
            <div className="muted">{getReleaseDescriptionValue(release.content) || "Описание пока не заполнено."}</div>
          </div>
          <div className="detail-card">
            <h4>Площадки и теги</h4>
            <div className="muted">Площадки: {getLookupLabels(platformNameById, release.content.platform_links.map((item) => item.platform_id))}</div>
            <div className="muted">Возрастной рейтинг: {release.content.age_rating || "не указан"}</div>
            <div className="muted">Жанры: {getLookupLabels(genreNameById, release.content.genre_ids)}</div>
            <div className="muted">Теги: {getLookupLabels(tagNameById, release.content.tag_ids)}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "posting" ? (
        <div className="section-stack">
          <div className="detail-card">
            <h4>Шаблон поста</h4>
            <div className="muted">
              {release.posting.default_post_template_id
                ? templateNameById.get(release.posting.default_post_template_id) ?? "не найден"
                : "не выбран"}
            </div>
            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <Button className="secondary" onClick={() => onNavigate("directories")}>Открыть шаблоны постов</Button>
            </div>
          </div>
          <div className="detail-card">
            <h4>Переопределения</h4>
            <div className="muted">Заголовок: {release.posting.post_header_override || "нет"}</div>
            <div className="muted">Подпись перевода: {release.posting.post_external_block_override || "Перевод"}</div>
            <div className="muted">Нижний блок: {release.posting.post_footer_override || "нет"}</div>
          </div>
        </div>
      ) : null}

      {activeTab === "generator" ? (
        <div className="section-stack">
          <div className="detail-card">
            <h4>Сборка поста</h4>
            <div className="muted">В режиме просмотра можно проверить выбранный шаблон и перейти к сохраненным версиям. Для правки текста откройте режим редактирования.</div>
          </div>
          <div className="list compact-list">
            {release.generated_posts.length ? release.generated_posts.map((post) => (
              <div key={post.id} className="list-item subdued">
                <div className="row spread">
                  <div>
                    <strong>{post.title}</strong>
                    <div className="muted">{formatDate(post.updated_at)} • {post.finalized ? "итоговая версия" : "черновик"}</div>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <Button className="ghost" onClick={() => onPreviewSavedPost(post.id)}>Посмотреть</Button>
                    <Button className="ghost" onClick={() => onOpenSavedPost(post.id)}>Открыть в редакторе</Button>
                    <Button className="danger" onClick={() => onDeleteSavedPost(post.id)}>Удалить</Button>
                  </div>
                </div>
              </div>
            )) : <EmptyState title="Сохраненных постов пока нет" body="После сборки и сохранения версии поста появятся здесь." />}
          </div>
          {selectedSavedPost ? (
            <div className="detail-card">
              <h4>{selectedSavedPost.finalized ? "Итоговый пост" : "Сохраненный черновик"}</h4>
              <div className="muted">{selectedSavedPost.title} • {formatDate(selectedSavedPost.updated_at)}</div>
              <div className="post-preview-box" style={{ marginTop: 12 }} title={selectedSavedPost.content}>
                {selectedSavedPost.content}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div className="section-stack">
          <div className="list compact-list">
            {release.history.length ? release.history.map((item) => (
              <div key={item.id} className="list-item subdued">
                <strong>{item.summary || item.action}</strong>
                <div className="muted">{formatDate(item.at)} • {item.actor}</div>
                {showAdvancedMode ? <div className="muted">Версия: {item.revision ?? "—"} • файл: {item.file_path ?? "ручное изменение"}</div> : null}
              </div>
            )) : <EmptyState title="История релиза пока пуста" body="После сохранений, импорта и восстановления здесь появится журнал изменений релиза." />}
          </div>
          {showAdvancedMode ? <Field label="Служебные сведения"><textarea className="text-area json-box" value={toPrettyJson(release.entity_manifest)} readOnly /></Field> : null}
        </div>
      ) : null}
    </div>
  );
}

function ImportsScreen({
  snapshot,
  onRefresh,
  actorName,
  onDirtyChange,
  onOpenParticipant,
  onOpenRelease,
  onShowAppNotice
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenParticipant: (id: string) => void;
  onOpenRelease: (id: string) => void;
  onShowAppNotice: (notice: { tone: "success" | "warning" | "danger"; text: string } | null) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(snapshot.imports[0]?.id ?? "");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [mappingDrafts, setMappingDrafts] = useState<ImportMappingOverride[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | ImportBatch["queue_status"]>("all");
  const [importNotice, setImportNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [presets, setPresets] = useState<ImportMappingPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [previewTab, setPreviewTab] = useState<"participants" | "releases" | "relations" | "duplicates" | "issues" | "notes" | "external">("participants");
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("__all__");
  const [selectedReviewEntity, setSelectedReviewEntity] = useState<SelectedImportReviewEntity | null>(null);
  const canonicalOptions = useMemo(() => [
    ["", "Авто / не переопределять"],
    ["__ignore__", "Игнорировать колонку"],
    ["nickname", "Ник"],
    ["real_name", "Имя"],
    ["display_name", "Отображаемое имя"],
    ["mention", "Упоминание VK"],
    ["mention_id", "Идентификатор упоминания"],
    ["vk_slug", "Короткий адрес VK"],
    ["vk_url", "Полная ссылка VK"],
    ["department", "Отдел"],
    ["role", "Роль"],
    ["skill", "Навык"],
    ["specialization", "Специализация"],
    ["equipment", "Оборудование"],
    ["voice_sample", "Проба голоса"],
    ["availability", "Доступность"],
    ["participant_status", "Статус участника"],
    ["release_title", "Название релиза"],
    ["release_type", "Тип релиза"],
    ["release_status", "Статус релиза"],
    ["season", "Сезон"],
    ["episode", "Серия"],
    ["year", "Год"],
    ["curator", "Куратор"],
    ["platform", "Площадка"],
    ["genre", "Жанр"],
    ["tag", "Тег"],
    ["external_source", "Субтитры / группа"],
    ["note", "Заметка"],
    ["comment", "Комментарий"],
    ["remark", "Замечание"],
    ["warning", "Предупреждение"],
    ["reward", "Награда / вклад"]
  ] as const, []);
  const filteredImports = useMemo(() => {
    const search = batchSearch.trim().toLowerCase();
    return snapshot.imports
      .filter((item) => (queueFilter === "all" ? true : item.queue_status === queueFilter))
      .filter((item) => {
        if (!search) return true;
        return [item.source_filename, item.id, item.template_kind, ...(item.sheet_names ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((a, b) => `${b.updated_at}`.localeCompare(`${a.updated_at}`));
  }, [batchSearch, queueFilter, snapshot.imports]);
  const blockingIssueCount = preview?.structured.issues.filter((item) => item.severity === "error").length ?? 0;
  const uncertainRowCount = preview?.structured.unknown_rows.length ?? 0;
  const canApplyPreview = Boolean(preview) && blockingIssueCount === 0;
  const isExchangeBundleImport = Boolean(preview?.structured.exchange_bundle);
  const selectedSheet =
    preview?.structured.workbook.sheets.find((item) => item.sheet_name === selectedSheetName) ?? null;
  const selectedSection =
    selectedSheet && selectedSectionId !== "__all__"
      ? selectedSheet.sections.find((item) => item.id === selectedSectionId) ?? null
      : null;
  const scopedPreview = useMemo(() => {
    if (!preview) return null;
    if (!selectedSheetName && !selectedSection) return preview;
    const nextIssues = preview.structured.issues.filter((item) => {
      if (!selectedSheetName) return true;
      if (item.source_sheet && item.source_sheet !== selectedSheetName) return false;
      if (!selectedSection || !item.source_rows.length) return !item.source_sheet || item.source_sheet === selectedSheetName;
      return item.source_rows.some(
        (rowNumber) => rowNumber >= selectedSection.row_start && rowNumber <= selectedSection.row_end
      );
    });
    const nextUnknownRows = preview.structured.unknown_rows.filter((item) => {
      if (!selectedSheetName) return true;
      if (item.source_sheet !== selectedSheetName) return false;
      if (!selectedSection) return true;
      return item.row_number >= selectedSection.row_start && item.row_number <= selectedSection.row_end;
    });
    return {
      ...preview,
      structured: {
        ...preview.structured,
        detected_headers: preview.structured.detected_headers.filter((item) => !selectedSheetName || item.source_sheet === selectedSheetName),
        participants: preview.structured.participants.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        releases: preview.structured.releases.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        relations: preview.structured.relations.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        notes: preview.structured.notes.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        discipline: preview.structured.discipline.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        rewards: preview.structured.rewards.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        external_sources: preview.structured.external_sources.filter((item) => matchesImportScope(item.source_refs, selectedSheetName, selectedSection)),
        issues: nextIssues,
        unknown_rows: nextUnknownRows
      }
    } satisfies ImportPreview;
  }, [preview, selectedSheetName, selectedSection]);
  const activePreview = scopedPreview ?? preview;
  const scopeSummary = !preview
    ? ""
    : !selectedSheetName
      ? "Показан весь файл"
      : selectedSection
        ? `Показан лист «${selectedSheetName}», ${selectedSection.title || translateImportSectionKind(selectedSection.kind).toLowerCase()}`
        : `Показан лист «${selectedSheetName}» целиком`;
  const importReviewSummary = activePreview
    ? {
        participantMatches: activePreview.structured.participants.filter((item) => item.duplicate_matches.some((match) => match.domain === "participant")).length,
        releaseMatches: activePreview.structured.releases.filter((item) => item.duplicate_matches.some((match) => match.domain === "release")).length,
        externalMatches: activePreview.structured.external_sources.filter((item) => item.duplicate_matches.some((match) => match.domain === "external")).length,
        reviewSignals: activePreview.structured.issues.length + activePreview.structured.unknown_rows.length
      }
    : null;
  const importReadiness = !preview
    ? null
    : blockingIssueCount > 0
      ? {
          tone: "danger" as const,
          title: "Нужно ручное решение",
          body: `Есть критические проблемы: ${blockingIssueCount}. Сначала проверьте правила распознавания и строки с ошибками.`
        }
      : uncertainRowCount > 0 || (importReviewSummary?.reviewSignals ?? 0) > 0
        ? {
            tone: "warning" as const,
            title: "Проверьте найденные данные",
            body: `Нераспознанных строк: ${uncertainRowCount}. Совпадений и спорных мест: ${importReviewSummary?.reviewSignals ?? 0}.`
          }
        : {
            tone: "success" as const,
            title: "Разбор выглядит устойчиво",
            body: "Сущности распознаны без критических ошибок. Перед применением достаточно просмотреть ключевые совпадения."
          };
  const selectedReviewDetail = useMemo(() => {
    if (!selectedReviewEntity || !preview) return null;
    if (selectedReviewEntity.kind === "participant") {
      const item = activePreview?.structured.participants.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.display_label,
        kindLabel: "Участник",
        confidence: item.confidence,
        sourceRefs: item.source_refs,
        reasons: item.confidence_reasons,
        summary: [
          `роли: ${formatListSummary(item.role_ids.map((value) => translateCode(value) || ""), "не указаны")}`,
          `отделы: ${formatListSummary(item.department_ids.map((value) => translateCode(value) || ""), "не указаны")}`
        ],
        matches: item.duplicate_matches,
        nextStep: describeImportNextStep("participant", item.duplicate_matches.length > 0)
      };
    }
    if (selectedReviewEntity.kind === "release") {
      const item = activePreview?.structured.releases.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: getReleaseDisplayTitle(item),
        kindLabel: "Релиз",
        confidence: item.confidence,
        sourceRefs: item.source_refs,
        reasons: item.confidence_reasons,
        summary: [
          `статус: ${translateCode(item.release_status_id) || "не определен"}`,
          `тип: ${translateCode(item.release_type_id) || "не определен"}`,
          `отдел: ${translateCode(item.primary_department_id) || "не определен"}`
        ],
        matches: item.duplicate_matches,
        nextStep: describeImportNextStep("release", item.duplicate_matches.length > 0)
      };
    }
    if (selectedReviewEntity.kind === "relation") {
      const item = activePreview?.structured.relations.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: formatListSummary(item.role_labels, "Связь без роли"),
        kindLabel: "Связь участника с релизом",
        confidence: item.confidence,
        sourceRefs: item.source_refs,
        reasons: item.confidence_reasons,
        summary: [
          item.department_hint ? `отдел: ${item.department_hint}` : "отдел не определен",
          item.external_source_label ? `субтитры: ${item.external_source_label}` : "внутренняя связь"
        ],
        matches: [],
        nextStep: describeImportNextStep("relation")
      };
    }
    if (selectedReviewEntity.kind === "duplicate") {
      const item = preview.structured.duplicates.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.matched_label,
        kindLabel: "Совпадение с существующей записью",
        confidence: item.confidence,
        sourceRefs: [],
        reasons: [item.reason],
        summary: [`домен: ${translateCode(item.domain)}`],
        matches: [item],
        nextStep: describeImportNextStep("duplicate", true)
      };
    }
    if (selectedReviewEntity.kind === "issue") {
      const item = activePreview?.structured.issues.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.code,
        kindLabel: "Проблема разбора",
        confidence: item.severity === "error" ? 1 : 0.75,
        sourceRefs: item.source_rows.map((rowNumber) => ({
          sheet_name: item.source_sheet || "лист не указан",
          row_number: rowNumber
        })),
        reasons: [item.message],
        summary: [`уровень: ${translateCode(item.severity)}`],
        matches: [],
        nextStep: describeImportNextStep("issue")
      };
    }
    if (selectedReviewEntity.kind === "note") {
      const item = activePreview?.structured.notes.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.title,
        kindLabel: "Заметка",
        confidence: 0.85,
        sourceRefs: item.source_refs,
        reasons: [item.body],
        summary: [item.note_type_hint ? `тип: ${item.note_type_hint}` : "тип не определен"],
        matches: [],
        nextStep: describeImportNextStep("note")
      };
    }
    if (selectedReviewEntity.kind === "discipline") {
      const item = activePreview?.structured.discipline.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: translateCode(item.severity),
        kindLabel: "Дисциплинарная запись",
        confidence: 0.88,
        sourceRefs: item.source_refs,
        reasons: [item.description],
        summary: [`тип: ${translateCode(item.severity)}`],
        matches: [],
        nextStep: describeImportNextStep("discipline")
      };
    }
    if (selectedReviewEntity.kind === "reward") {
      const item = activePreview?.structured.rewards.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.description,
        kindLabel: "Поощрение или вклад",
        confidence: 0.86,
        sourceRefs: item.source_refs,
        reasons: [formatListSummary(item.tags, "теги не указаны")],
        summary: [`теги: ${formatListSummary(item.tags, "не указаны")}`],
        matches: [],
        nextStep: describeImportNextStep("reward")
      };
    }
    if (selectedReviewEntity.kind === "external") {
      const item = activePreview?.structured.external_sources.find((entry) => entry.id === selectedReviewEntity.id);
      if (!item) return null;
      return {
        title: item.label,
        kindLabel: "Субтитры / источник",
        confidence: item.confidence,
        sourceRefs: item.source_refs,
        reasons: item.confidence_reasons,
        summary: [
          item.source_type_hint ? `тип: ${item.source_type_hint}` : "тип не определен",
          `ссылки: ${item.links.length}`
        ],
        matches: item.duplicate_matches,
        nextStep: describeImportNextStep("external", item.duplicate_matches.length > 0)
      };
    }
    return null;
  }, [activePreview, preview, selectedReviewEntity]);

  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  useEffect(() => {
    setMappingDrafts(preview?.structured.mapping_overrides ?? []);
    setPresetName(preview ? `Правила для ${preview.batch.source_filename}` : "");
    void loadPresets(preview?.structured.source_signature);
  }, [preview]);

  useEffect(() => {
    if (!preview) {
      setSelectedSheetName("");
      setSelectedSectionId("__all__");
      return;
    }
    const sheetNames = preview.structured.workbook.sheets.map((item) => item.sheet_name);
    setSelectedSheetName((current) => (current && sheetNames.includes(current) ? current : ""));
  }, [preview]);

  useEffect(() => {
    if (!preview || !selectedSheetName) {
      setSelectedSectionId("__all__");
      return;
    }
    const sections =
      preview.structured.workbook.sheets.find((item) => item.sheet_name === selectedSheetName)?.sections ?? [];
    setSelectedSectionId((current) =>
      current !== "__all__" && sections.some((item) => item.id === current) ? current : "__all__"
    );
  }, [preview, selectedSheetName]);

  useEffect(() => {
    if (!preview || !activePreview) {
      setSelectedReviewEntity(null);
      return;
    }
    const candidateMap: Record<typeof previewTab, SelectedImportReviewEntity | null> = {
      participants: activePreview.structured.participants[0]
        ? { kind: "participant", id: activePreview.structured.participants[0].id }
        : null,
      releases: activePreview.structured.releases[0]
        ? { kind: "release", id: activePreview.structured.releases[0].id }
        : null,
      relations: activePreview.structured.relations[0]
        ? { kind: "relation", id: activePreview.structured.relations[0].id }
        : null,
      duplicates: preview.structured.duplicates[0]
        ? { kind: "duplicate", id: preview.structured.duplicates[0].id }
        : null,
      issues: activePreview.structured.issues[0]
        ? { kind: "issue", id: activePreview.structured.issues[0].id }
        : null,
      notes: activePreview.structured.notes[0]
        ? { kind: "note", id: activePreview.structured.notes[0].id }
        : activePreview.structured.discipline[0]
          ? { kind: "discipline", id: activePreview.structured.discipline[0].id }
          : activePreview.structured.rewards[0]
            ? { kind: "reward", id: activePreview.structured.rewards[0].id }
            : null,
      external: activePreview.structured.external_sources[0]
        ? { kind: "external", id: activePreview.structured.external_sources[0].id }
        : null
    };
    const existsInCurrentScope = (() => {
      if (!selectedReviewEntity) return false;
      if (selectedReviewEntity.kind === "duplicate") {
        return preview.structured.duplicates.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "participant") {
        return activePreview.structured.participants.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "release") {
        return activePreview.structured.releases.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "relation") {
        return activePreview.structured.relations.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "issue") {
        return activePreview.structured.issues.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "note") {
        return activePreview.structured.notes.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "discipline") {
        return activePreview.structured.discipline.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "reward") {
        return activePreview.structured.rewards.some((item) => item.id === selectedReviewEntity.id);
      }
      if (selectedReviewEntity.kind === "external") {
        return activePreview.structured.external_sources.some((item) => item.id === selectedReviewEntity.id);
      }
      return false;
    })();
    if (!existsInCurrentScope) {
      setSelectedReviewEntity(candidateMap[previewTab]);
    }
  }, [activePreview, preview, previewTab, selectedReviewEntity]);

  async function loadPresets(sourceSignature?: string) {
    if (!sourceSignature) {
      setPresets([]);
      setSelectedPresetId("");
      return;
    }
    const nextPresets = await window.fronda.listImportMappingPresets(sourceSignature);
    setPresets(nextPresets);
    setSelectedPresetId(nextPresets[0]?.id ?? "");
  }

  async function pickImport() {
    try {
      setImportNotice(null);
      const filePath = await window.fronda.pickImportFile();
      if (!filePath) return;
      const result: ImportPreview = await window.fronda.previewImport(filePath, mappingDrafts);
      setPreview(result);
      setSelectedBatchId(result.batch.id);
      setSelectedTargetId(result.structured.duplicates.find((item) => item.domain === "participant")?.matched_entity_id ?? "");
      setImportNotice({
        tone: result.batch.queue_status === "review" ? "warning" : "success",
        text:
          result.structured.exchange_bundle
            ? "Единый экспорт FRONDA разобран. Можно сразу создать недостающие записи или сравнить совпадения и добрать недостающие данные."
            : result.batch.queue_status === "review"
            ? "Импорт открыт в режиме проверки: найдены дубли или критические неоднозначности."
            : "Файл разобран и готов к проверке."
      });
      await onRefresh(true);
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось открыть файл импорта."
      });
    }
  }

  async function exportImportBundle() {
    try {
      setImportNotice(null);
      const output = await window.fronda.exportImportBundle(actorName);
      if (!output) return;
      onShowAppNotice({
        tone: "success",
        text: `👍 Акро благодарит тебя за Экспорт! Файл сохранен: ${getShortPathLabel(output)}.`
      });
      setImportNotice({
        tone: "success",
        text: `Единый экспорт FRONDA сохранен: ${getShortPathLabel(output)}. Этот файл можно потом открыть здесь же через импорт.`
      });
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось экспортировать единый файл FRONDA."
      });
    }
  }

  async function openBatch(batchId: string) {
    try {
      setImportNotice(null);
      setSelectedBatchId(batchId);
      const result: ImportPreview = await window.fronda.getImportPreview(batchId);
      setPreview(result);
      setSelectedTargetId(result.structured.duplicates.find((item) => item.domain === "participant")?.matched_entity_id ?? "");
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось открыть пакет импорта."
      });
    }
  }

  async function rebuildPreview() {
    if (!preview) return;
    try {
      const result: ImportPreview = await window.fronda.rebuildImportPreview(preview.batch.id, mappingDrafts);
      setPreview(result);
      setSelectedTargetId(result.structured.duplicates.find((item) => item.domain === "participant")?.matched_entity_id ?? "");
      setImportNotice({
        tone: result.batch.queue_status === "review" ? "warning" : "success",
        text:
          result.structured.exchange_bundle
            ? "Предпросмотр bundle обновлен. Можно создавать недостающие записи или мягко добирать недостающие данные в совпадениях."
            : result.batch.queue_status === "review"
            ? "Предпросмотр обновлен, пакет остается в ручной проверке."
            : "Предпросмотр обновлен, блокирующих проблем не найдено."
      });
      await onRefresh(true);
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось обновить предпросмотр."
      });
    }
  }

  async function savePreset() {
    if (!preview || !mappingDrafts.length) return;
    try {
      const preset = await window.fronda.saveImportMappingPreset(
      presetName.trim() || `Правила разбора ${preview.batch.source_filename}`,
        preview.structured.source_signature,
        mappingDrafts,
        actorName
      );
      const nextPresets = [...presets, preset].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      setPresets(nextPresets);
      setSelectedPresetId(preset.id);
      setImportNotice({
        tone: "success",
        text: `Правила «${preset.name}» сохранены.`
      });
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить набор сопоставлений."
      });
    }
  }

  async function applySelectedPreset() {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    setMappingDrafts(preset.overrides);
    if (preview) {
      const result = await window.fronda.rebuildImportPreview(preview.batch.id, preset.overrides);
      setPreview(result);
    }
  }

  function updateMapping(sourceSheet: string | undefined, originalHeader: string, canonical: string) {
    setMappingDrafts((current) => {
      const next = current.filter((item) => !(item.original_header === originalHeader && item.source_sheet === sourceSheet));
      if (!canonical) return next;
      if (canonical === "__ignore__") {
        return [...next, { id: createDraftId("map"), source_sheet: sourceSheet, original_header: originalHeader, ignore: true }];
      }
      return [...next, { id: createDraftId("map"), source_sheet: sourceSheet, original_header: originalHeader, canonical }];
    });
  }

  async function resolve(action: "create" | "update" | "review" | "reject") {
    if (!preview) return;
    try {
      await window.fronda.resolveImportBatch(preview.batch.id, action, actorName, selectedTargetId || undefined);
      setImportNotice({
        tone: action === "reject" ? "warning" : "success",
        text:
          preview.structured.exchange_bundle && action === "create"
            ? "Bundle применен: недостающие записи созданы, существующие не изменялись."
            : preview.structured.exchange_bundle && action === "update"
              ? "Bundle применен: недостающие записи созданы, совпадающие записи мягко дополнены без перезаписи текущей базы."
            : action === "review"
            ? "Пакет оставлен в очереди ручного разбора."
            : action === "reject"
              ? "Импорт отклонен."
              : "Импорт применен."
      });
      setPreview(action === "review" ? preview : null);
      setSelectedTargetId("");
      await onRefresh(true);
      if (action === "review") {
        await openBatch(preview.batch.id);
      }
    } catch (error) {
      setImportNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось завершить действие по импорту."
      });
    }
  }

  return (
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="imports:list">
      <Panel title="Пакеты импорта" subtitle="Файлы на проверке и последние результаты разбора.">
        <div className="section-stack">
          <div className="dashboard-actions primary-cluster">
            <Button className="primary" onClick={() => void pickImport()}>Выбрать файл</Button>
            <Button className="secondary" onClick={() => void exportImportBundle()}>Экспортировать всё</Button>
            <ActionMenu>
              <ActionMenuItem onClick={() => setQueueFilter("all")}>Показать все файлы</ActionMenuItem>
              <ActionMenuItem onClick={() => setQueueFilter("pending")}>Показать ожидающие проверки</ActionMenuItem>
              <ActionMenuItem onClick={() => setQueueFilter("review")}>Показать ручную проверку</ActionMenuItem>
              {selectedBatchId ? <ActionMenuItem onClick={() => void openBatch(selectedBatchId)}>Открыть выбранный пакет заново</ActionMenuItem> : null}
            </ActionMenu>
          </div>
          <Field label="Поиск по очереди">
            <input className="text-input" value={batchSearch} onChange={(event) => setBatchSearch(event.target.value)} placeholder="Файл, тип таблицы или название листа" />
          </Field>
          <details className="detail-disclosure">
            <summary className="disclosure-summary">
              <strong>Очередь и фильтры</strong>
              <span className="muted">Статус пакетов, спорные совпадения и ручная проверка.</span>
            </summary>
            <div className="detail-disclosure-body section-stack compact">
              <Field label="Показывать">
                <select className="select-input" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as "all" | ImportBatch["queue_status"])}>
                  <option value="all">Все файлы</option>
                  <option value="pending">Ожидают проверки</option>
                  <option value="review">Ручная проверка</option>
                  <option value="resolved">Примененные</option>
                  <option value="rejected">Отклоненные</option>
                </select>
              </Field>
              <div className="stat-grid">
                <StatCard label="На проверке" value={snapshot.imports.filter((item) => item.queue_status === "review" || item.queue_status === "pending").length} />
                <StatCard label="Со спорными совпадениями" value={snapshot.imports.filter((item) => (item.candidate_matches?.length ?? 0) > 0).length} />
                <StatCard label="Ручная проверка" value={snapshot.imports.filter((item) => item.queue_status === "review").length} />
              </div>
            </div>
          </details>
          {importNotice ? <div className={`notice-banner ${importNotice.tone}`}>{importNotice.text}</div> : null}
          <div className="list">
            {filteredImports.map((batch) => (
              <div key={batch.id} className={`list-item ${selectedBatchId === batch.id ? "active" : ""}`} onClick={() => void openBatch(batch.id)}>
                <div className="row spread">
                  <div><h3>{batch.source_filename}</h3><div className="muted">обновлено: {formatDate(batch.updated_at)}</div></div>
                  <Chip tone={batch.queue_status === "review" ? "warning" : batch.queue_status === "resolved" ? "success" : undefined}>{translateCode(batch.queue_status)}</Chip>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {translateTemplateKind(batch.template_kind)} • совпадения: {batch.candidate_matches.length ? batch.candidate_matches.join(", ") : "не найдены"}
                </div>
                <div className="muted">
                  сущности: {batch.detected_entities?.participants ?? 0} {pluralizeSimple(batch.detected_entities?.participants ?? 0, "участник", "участников")} • {batch.detected_entities?.releases ?? 0} {pluralizeSimple(batch.detected_entities?.releases ?? 0, "релиз", "релизов")} • {batch.issue_count ?? 0} проблем
                </div>
              </div>
            ))}
            {!filteredImports.length ? (
              <EmptyState title="Файлы не найдены" body="Смените фильтр очереди, очистите поиск или откройте новый файл для импорта." />
            ) : null}
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`imports:preview:${preview?.batch.id || "empty"}`}>
      <Panel title="Проверка результата" subtitle="Найденные записи, совпадения и решения по выбранному файлу.">
        {preview && activePreview ? (
          <div className="section-stack">
            <div className="stat-grid">
              <StatCard label="Файл" value={preview.batch.source_filename} note={translateCode(preview.batch.queue_status)} />
              <StatCard label="Участники" value={activePreview.structured.participants.length} note={`${activePreview.structured.releases.length} ${pluralizeSimple(activePreview.structured.releases.length, "релиз", "релизов")}`} />
              <StatCard label="Связи" value={activePreview.structured.relations.length} note={formatSimpleCount(activePreview.structured.external_sources.length, "внешний источник", "внешних источников")} />
              <StatCard label="Совпадения и проблемы" value={`${preview.structured.duplicates.length} / ${activePreview.structured.issues.length}`} note={translateTemplateKind(preview.structured.template_kind)} />
            </div>
            {importReadiness ? <div className={`notice-banner ${importReadiness.tone}`}>{importReadiness.title}. {importReadiness.body}</div> : null}
            <div className="details-grid">
              <div className="detail-card">
                <h4>Область просмотра</h4>
                <div className="muted">{scopeSummary}</div>
                {selectedSection ? (
                  <div className="muted">
                    {formatImportSectionRange(selectedSection.row_start, selectedSection.row_end)} • сигналы: {selectedSection.signals.join(" • ") || "нет служебных маркеров"}
                  </div>
                ) : null}
              </div>
              {importReviewSummary ? (
                <div className="detail-card">
                  <h4>Совпадения и проверка</h4>
                  <div className="summary-key-list">
                    <div className="compact-row"><span className="muted">Участники с совпадениями</span><Chip tone={importReviewSummary.participantMatches ? "warning" : "success"}>{importReviewSummary.participantMatches}</Chip></div>
                    <div className="compact-row"><span className="muted">Релизы с совпадениями</span><Chip tone={importReviewSummary.releaseMatches ? "warning" : "success"}>{importReviewSummary.releaseMatches}</Chip></div>
                    <div className="compact-row"><span className="muted">Источники с совпадениями</span><Chip tone={importReviewSummary.externalMatches ? "warning" : "success"}>{importReviewSummary.externalMatches}</Chip></div>
                    <div className="compact-row"><span className="muted">Нужно проверить</span><Chip tone={importReviewSummary.reviewSignals ? "warning" : "success"}>{importReviewSummary.reviewSignals}</Chip></div>
                  </div>
                </div>
              ) : null}
              <div className="detail-card">
                <h4>Что дальше</h4>
                <div className="muted">
                  Просмотрите совпадения и сомнительные строки, затем выберите: создать новые записи, обновить найденные совпадения или оставить пакет на ручной проверке.
                </div>
              </div>
            </div>
            <div className="tabs">
              {([
                ["participants", `Участники (${activePreview.structured.participants.length})`],
                ["releases", `Релизы (${activePreview.structured.releases.length})`],
                ["relations", `Связи (${activePreview.structured.relations.length})`],
                ["duplicates", `Дубли (${preview.structured.duplicates.length})`],
                ["issues", `Ошибки (${activePreview.structured.issues.length})`],
                ["notes", `Заметки, дисциплина и награды (${activePreview.structured.notes.length + activePreview.structured.discipline.length + activePreview.structured.rewards.length})`],
                ["external", `Источники (${activePreview.structured.external_sources.length})`]
              ] as const).map(([tab, label]) => <button key={tab} className={`tab ${previewTab === tab ? "active" : ""}`} onClick={() => setPreviewTab(tab)}>{label}</button>)}
            </div>
            {previewTab === "participants" ? (
              <ImportParticipantsPreview
                preview={activePreview}
                onSelectTarget={setSelectedTargetId}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "participant", id })}
                selectedId={selectedReviewEntity?.kind === "participant" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            {previewTab === "releases" ? (
              <ImportReleasesPreview
                preview={activePreview}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "release", id })}
                selectedId={selectedReviewEntity?.kind === "release" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            {previewTab === "relations" ? (
              <ImportRelationsPreview
                preview={activePreview}
                onOpenParticipant={onOpenParticipant}
                onOpenRelease={onOpenRelease}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "relation", id })}
                selectedId={selectedReviewEntity?.kind === "relation" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            {previewTab === "duplicates" ? (
              <ImportDuplicatesPreview
                preview={preview}
                onOpenParticipant={onOpenParticipant}
                onOpenRelease={onOpenRelease}
                onSelectTarget={setSelectedTargetId}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "duplicate", id })}
                selectedId={selectedReviewEntity?.kind === "duplicate" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            {previewTab === "issues" ? (
              <ImportIssuesPreview
                preview={activePreview}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "issue", id })}
                selectedId={selectedReviewEntity?.kind === "issue" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            {previewTab === "notes" ? (
              <ImportNotesPreview
                preview={activePreview}
                selectedEntity={selectedReviewEntity}
                onSelectItem={setSelectedReviewEntity}
              />
            ) : null}
            {previewTab === "external" ? (
              <ImportExternalPreview
                preview={activePreview}
                onSelectItem={(id) => setSelectedReviewEntity({ kind: "external", id })}
                selectedId={selectedReviewEntity?.kind === "external" ? selectedReviewEntity.id : undefined}
              />
            ) : null}
            <div className="detail-card">
              <h4>Применить результат</h4>
              <div className="muted">Критических ошибок: {blockingIssueCount} • нераспознанных строк: {uncertainRowCount} • ручных правил: {mappingDrafts.length}</div>
              <div className="muted">
                {blockingIssueCount > 0
                  ? "Этот файл нельзя применять напрямую. Сначала исправьте правила распознавания или оставьте пакет на ручной проверке."
                  : isExchangeBundleImport
                    ? "Недостающие записи можно создать сразу. Совпадающие записи можно сравнить и безопасно добрать недостающие данные без перезаписи текущей базы."
                    : "Файл можно применять после просмотра совпадений и найденных записей."}
              </div>
              {!isExchangeBundleImport ? (
                <Field label="Участник для точечного обновления">
                  <select className="select-input" value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}>
                    <option value="">Не выбран</option>
                    {snapshot.participantList.map((item) => <option key={item.id} value={item.id}>{item.displayName}{item.nickname ? ` • @${item.nickname}` : ""}</option>)}
                  </select>
                </Field>
              ) : null}
              <div className="dashboard-actions primary-cluster">
                <Button className="primary" onClick={() => void resolve("create")} disabled={!canApplyPreview}>
                  {isExchangeBundleImport ? "Создать недостающие" : "Создать записи"}
                </Button>
                <Button className="secondary" onClick={() => void resolve("update")} disabled={!canApplyPreview}>
                  {isExchangeBundleImport ? "Сравнить и внести изменения" : "Обновить совпадения"}
                </Button>
                <ActionMenu>
                  <ActionMenuItem onClick={() => void rebuildPreview()}>Обновить разбор</ActionMenuItem>
                  <ActionMenuItem onClick={() => void applySelectedPreset()} disabled={!selectedPresetId}>Применить набор правил</ActionMenuItem>
                  <ActionMenuItem onClick={() => void savePreset()} disabled={!mappingDrafts.length}>Сохранить набор правил</ActionMenuItem>
                  <ActionMenuItem onClick={() => void resolve("review")}>Оставить на ручной проверке</ActionMenuItem>
                  <ActionMenuItem className="danger" onClick={() => void resolve("reject")}>Отклонить импорт</ActionMenuItem>
                </ActionMenu>
              </div>
            </div>
          </div>
        ) : <EmptyState title="Предпросмотр импорта пока не открыт" body="Выберите Excel- или JSON-файл, чтобы разобрать структуру, найти сущности и открыть проверку результата." />}
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`imports:details:${preview?.batch.id || "empty"}`}>
      <Panel title="Проверка файла" subtitle="Короткая сводка, выбранная запись и правила распознавания.">
        {preview ? (
          <div className="section-stack">
            <div className="detail-card">
              <div className="row spread">
                <h4>Качество распознавания</h4>
                <Chip tone={importConfidenceTone(preview.structured.template_confidence)}>{describeImportConfidence(preview.structured.template_confidence)}</Chip>
              </div>
              <div className="muted">{translateTemplateKind(preview.structured.template_kind)} • уверенность распознавания {Math.round(preview.structured.template_confidence * 100)}%</div>
              <div className="muted">{preview.structured.workbook.sheets.length} листов • спорных секций: {preview.structured.workbook.uncertain_sections} • повторных заголовков: {preview.structured.workbook.repeated_headers}</div>
              <div className="muted">Разделы по статусам: {preview.structured.workbook.status_markers.join(" • ") || "не найдены"}</div>
            </div>
            <div className="detail-card">
              <div className="row spread">
                <h4>Выбранная запись</h4>
                {selectedReviewDetail ? <Chip tone={importConfidenceTone(selectedReviewDetail.confidence)}>{describeImportConfidence(selectedReviewDetail.confidence)}</Chip> : null}
              </div>
              {selectedReviewDetail ? (
                <div className="section-stack compact">
                  <div>
                    <strong>{selectedReviewDetail.title}</strong>
                    <div className="muted">
                      {selectedReviewDetail.kindLabel} • уверенность {formatImportConfidence(selectedReviewDetail.confidence)}
                    </div>
                  </div>
                  <div className="muted">Источник: {formatImportSourceRefs(selectedReviewDetail.sourceRefs)}</div>
                  {selectedReviewDetail.summary.map((line) => (
                    <div key={line} className="muted">{line}</div>
                  ))}
                  {selectedReviewDetail.reasons.length ? (
                    <div className="section-stack compact">
                      {selectedReviewDetail.reasons.map((reason) => (
                        <div key={reason} className="muted">{reason}</div>
                      ))}
                    </div>
                  ) : null}
                  {selectedReviewDetail.matches.length ? (
                    <div className="section-stack compact">
                      <strong>Совпадения</strong>
                      {selectedReviewDetail.matches.map((match) => (
                        <div key={match.id} className="muted">
                          {match.matched_label} • {match.reason} • {formatImportConfidence(match.confidence)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="muted">{selectedReviewDetail.nextStep}</div>
                </div>
              ) : (
                <div className="muted">
                  Выберите участника, релиз, связь, проблему или источник в центре, чтобы увидеть подробности проверки именно по этой записи.
                </div>
              )}
            </div>
            <details className="detail-disclosure" open={Boolean(selectedSheetName)}>
              <summary className="disclosure-summary">
                <strong>Область проверки</strong>
                <span className="muted">Вся книга, отдельный лист или конкретный раздел.</span>
              </summary>
              <div className="detail-disclosure-body section-stack compact">
                <div className="tabs">
                  <button className={`tab ${selectedSheetName === "" ? "active" : ""}`} onClick={() => setSelectedSheetName("")}>Вся книга</button>
                  {preview.structured.workbook.sheets.map((sheet) => (
                    <button
                      key={sheet.sheet_name}
                      className={`tab ${selectedSheetName === sheet.sheet_name ? "active" : ""}`}
                      onClick={() => setSelectedSheetName(sheet.sheet_name)}
                    >
                      {sheet.sheet_name}
                    </button>
                  ))}
                </div>
                {selectedSheet ? (
                  <div className="section-stack compact">
                    <div className="muted">
                      {selectedSheet.row_count} строк • {selectedSheet.sections.length} секций • повторных заголовков: {selectedSheet.repeated_header_rows.length}
                    </div>
                    <div className="list compact-list">
                      <div
                        className={`list-item subdued ${selectedSectionId === "__all__" ? "active" : ""}`}
                        onClick={() => setSelectedSectionId("__all__")}
                      >
                        <div className="row spread">
                          <strong>Весь лист</strong>
                          <Chip>{selectedSheet.sheet_name}</Chip>
                        </div>
                        <div className="muted">Показать все найденные данные только по этому листу.</div>
                      </div>
                      {selectedSheet.sections.map((section) => (
                        <div
                          key={section.id}
                          className={`list-item subdued ${selectedSectionId === section.id ? "active" : ""}`}
                          onClick={() => setSelectedSectionId(section.id)}
                        >
                          <div className="row spread">
                            <strong>{section.title || translateImportSectionKind(section.kind)}</strong>
                            <Chip tone={importConfidenceTone(section.confidence)}>{describeImportConfidence(section.confidence)}</Chip>
                          </div>
                          <div className="muted">
                            {formatImportSectionRange(section.row_start, section.row_end)} • {section.signals.join(" • ") || "без дополнительных сигналов"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="muted">Выберите лист, если хотите ограничить просмотр отдельной секцией.</div>
                )}
              </div>
            </details>
            <details className="detail-disclosure">
              <summary className="disclosure-summary">
                <strong>Правила распознавания</strong>
                <span className="muted">Сопоставление колонок и сохраненные наборы правил.</span>
              </summary>
              <div className="detail-disclosure-body section-stack compact">
                <Field label="Название набора правил">
                  <input className="text-input" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
                </Field>
                <Field label="Сохраненные наборы правил">
                  <select className="select-input" value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
                    <option value="">Выберите набор правил</option>
                    {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <div className="list compact-list">
                  {(activePreview ?? preview).structured.detected_headers.map((item) => {
                    const override = mappingDrafts.find((entry) => entry.original_header === item.original && entry.source_sheet === item.source_sheet);
                    const mappingValue = override?.ignore ? "__ignore__" : override?.canonical ?? item.canonical ?? "";
                    return (
                      <div key={`${item.source_sheet}_${item.original}`} className="list-item subdued">
                        <div className="row spread">
                          <div>
                            <strong>{item.original}</strong>
                            <div className="muted">{item.source_sheet || "лист не указан"} • {describeImportConfidence(item.confidence)} • {Math.round(item.confidence * 100)}%</div>
                            <div className="muted">{item.sample_values.join(" | ") || "без примеров"}</div>
                          </div>
                          <select className="select-input" value={mappingValue} onChange={(event) => updateMapping(item.source_sheet, item.original, event.target.value)}>
                            {canonicalOptions.map(([value, label]) => <option key={`${item.original}_${value || "none"}`} value={value}>{label}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!(activePreview ?? preview).structured.detected_headers.length ? <div className="muted">Для выбранной области заголовки не найдены.</div> : null}
              </div>
            </details>
            <details className="detail-disclosure">
              <summary className="disclosure-summary">
                <strong>Строение файла</strong>
                <span className="muted">Листы, разделы, объединения, ссылки и формулы.</span>
              </summary>
              <div className="detail-disclosure-body">
                <div className="list compact-list">
                  {preview.structured.workbook.sheets.map((sheet) => (
                    <div key={sheet.sheet_name} className="list-item subdued">
                      <strong>{sheet.sheet_name}</strong>
                      <div className="muted">{sheet.row_count} строк • объединений: {sheet.merged_range_count} • ссылок: {sheet.hyperlink_count} • формул: {sheet.formula_count}</div>
                      <div className="muted">{sheet.sections.map((section) => `${section.title || translateImportSectionKind(section.kind)} (${Math.round(section.confidence * 100)}%)`).join(" • ") || "секции не выделены"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </details>
            <div className="detail-card">
              <h4>Что сделать дальше</h4>
              <div className="summary-key-list">
                {preview.structured.suggested_actions.length ? preview.structured.suggested_actions.map((item) => (
                  <div key={item} className="compact-row">
                    <span className="muted">{item}</span>
                  </div>
                )) : <div className="muted">Дополнительных действий не требуется.</div>}
              </div>
            </div>
          </div>
        ) : <EmptyState title="Файл импорта не выбран" body="Откройте файл или выберите запись из очереди, чтобы увидеть структуру и результаты разбора." />}
      </Panel>
      </ScrollRegion>
    </div>
  );
}

function DirectoriesScreen({
  snapshot,
  onRefresh,
  actorName,
  onDirtyChange,
  restoredLocalDraft,
  onRestoredLocalDraftApplied,
  showAdvancedMode
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  actorName: string;
  onDirtyChange: (dirty: boolean) => void;
  restoredLocalDraft: LocalUnsavedDraftFile | null;
  onRestoredLocalDraftApplied: () => void;
  showAdvancedMode: boolean;
}) {
  type EditorDraft = DirectoryEditorRecord;

  const directoryKeys = DIRECTORY_EDITOR_ORDER as readonly string[];
  const [editorKey, setEditorKey] = useState<string>(directoryKeys[0] ?? "departments");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "archived">("all");
  const [screenMode, setScreenMode] = useState<"view" | "edit" | "create">("view");
  const [rawMode, setRawMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dragRecordId, setDragRecordId] = useState<string | null>(null);
  const [dragRecordTargetId, setDragRecordTargetId] = useState<string | null>(null);
  const [recordPointerDrag, setRecordPointerDrag] = useState<{
    id: string;
    startX: number;
    startY: number;
    pointerId: number;
  } | null>(null);
  const [recordDragPreviewIds, setRecordDragPreviewIds] = useState<string[] | null>(null);
  const [recordCommittedOrderIds, setRecordCommittedOrderIds] = useState<string[] | null>(null);
  const [editorNotice, setEditorNotice] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const recordDragBaseIdsRef = useRef<string[] | null>(null);
  const suppressDirectoryRecordClickRef = useRef(false);
  const departmentNameById = useMemo(() => new Map(snapshot.departments.map((item) => [item.id, item.name])), [snapshot.departments]);
  const releaseTypeNameById = useMemo(() => new Map((snapshot.directories.release_types ?? []).map((item) => [item.id, item.name])), [snapshot.directories.release_types]);
  const activeDepartments = useMemo(() => filterVisibleLookupRecords(snapshot.departments), [snapshot.departments]);
  const getDirectoryCollection = (key: string): DirectoryEditorRecord[] => {
    if (key === "departments") return toDirectoryEditorRecords<DepartmentDirectoryItem>(snapshot.departments);
    if (key === "structure_positions") return toDirectoryEditorRecords<StructurePosition>(snapshot.structurePositions);
    if (key === "__external__") return toDirectoryEditorRecords<ExternalSource>(snapshot.externalSources);
    if (key === "__templates__") return toDirectoryEditorRecords<PostTemplate>(snapshot.templates);
    return toDirectoryEditorRecords<DirectoryRecord>(snapshot.directories[key]);
  };
  const editorMeta = getDirectoryEditorMeta(editorKey);
  const editorValue = useMemo(() => {
    return toPrettyJson(getDirectoryCollection(editorKey));
  }, [editorKey, snapshot]);
  const [jsonValue, setJsonValue] = useState(editorValue);

  useEffect(() => {
    setJsonValue(editorValue);
  }, [editorValue]);

  useEffect(() => {
    const supportedEditorKeys = new Set([...directoryKeys, "__external__", "__templates__"]);
    if (!supportedEditorKeys.has(editorKey)) {
      setEditorKey(directoryKeys[0] ?? "departments");
    }
  }, [directoryKeys, editorKey]);

  useEffect(() => {
    if (!restoredLocalDraft || !["directories", "templates", "external"].includes(restoredLocalDraft.domain)) {
      return;
    }
    const nextEditorKey =
      restoredLocalDraft.domain === "templates"
        ? "__templates__"
        : restoredLocalDraft.domain === "external"
          ? "__external__"
          : restoredLocalDraft.entity_id;
    if (editorKey !== nextEditorKey) {
      setEditorKey(nextEditorKey);
      return;
    }
    setRawMode(true);
    setScreenMode("edit");
    setJsonValue(toPrettyJson(restoredLocalDraft.payload));
    setEditorNotice({
      tone: "warning",
      text: `Открыт локальный черновик от ${formatDate(restoredLocalDraft.saved_at)}. Сначала проверьте изменения, затем сохраните их вручную.`
    });
    onRestoredLocalDraftApplied();
  }, [editorKey, onRestoredLocalDraftApplied, restoredLocalDraft]);

  useEffect(() => {
    const firstId =
      getDirectoryCollection(editorKey)[0]?.id;
    setSelectedRecordId(firstId ?? "");
  }, [editorKey, snapshot]);

  const currentRecords = useMemo(() => getDirectoryCollection(editorKey), [editorKey, snapshot, departmentNameById, releaseTypeNameById]);
  const toggleableCategoryMeta = TOGGLEABLE_DIRECTORY_CATEGORY_META[editorKey];
  const currentCategoryEnabled = Boolean(toggleableCategoryMeta) && isLookupCategoryEnabled(currentRecords);
  const currentCategoryEditableCount = toggleableCategoryMeta
    ? currentRecords.filter((record) => !isArchivedLookupRecord(record)).length
    : 0;
  const filteredRecords = useMemo(() => currentRecords.filter((record) => {
    const normalizedStatus = normalizeDirectoryRecordStatus(record.status);
    const archived = isArchivedLookupRecord(record);
    if (statusFilter !== "archived" && archived) return false;
    if (statusFilter === "active" && normalizedStatus !== "active") return false;
    if (statusFilter === "inactive" && normalizedStatus !== "inactive") return false;
    if (statusFilter === "archived" && !archived) return false;
    return !search.trim() || JSON.stringify(record).toLowerCase().includes(search.trim().toLowerCase());
  }), [currentRecords, search, statusFilter]);
  const orderedFilteredRecords = useMemo(() => {
    const activeOrderIds = recordDragPreviewIds?.length ? recordDragPreviewIds : recordCommittedOrderIds;
    if (!activeOrderIds?.length) {
      return filteredRecords;
    }
    const orderMap = new Map(activeOrderIds.map((id, index) => [id, index]));
    return [...filteredRecords].sort((left, right) => {
      const leftIndex = orderMap.get(left.id);
      const rightIndex = orderMap.get(right.id);
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }, [filteredRecords, recordCommittedOrderIds, recordDragPreviewIds]);
  const selectedRecord =
    currentRecords.find((record) => record.id === selectedRecordId) ??
    orderedFilteredRecords[0] ??
    currentRecords[0] ??
    null;
  const selectedRecordIndex = selectedRecord ? currentRecords.findIndex((record) => record.id === selectedRecord.id) : -1;
  const normalizedSelectedRecord = useMemo(
    () =>
      selectedRecord
        ? (normalizeDirectoryEditorDraft(editorKey, cloneJson(selectedRecord) as EditorDraft) as EditorDraft)
        : null,
    [editorKey, selectedRecord]
  );
  const [recordDraft, setRecordDraft] = useState<EditorDraft | null>(
    normalizedSelectedRecord ? (cloneJson(normalizedSelectedRecord) as EditorDraft) : null
  );
  const currentRecord = screenMode === "view" ? normalizedSelectedRecord : recordDraft;
  const recordDirty = rawMode
    ? jsonValue !== editorValue
    : screenMode === "create"
      ? Boolean(recordDraft)
      : Boolean(
          normalizedSelectedRecord &&
            recordDraft &&
            serializeStable(normalizedSelectedRecord) !== serializeStable(recordDraft)
        );
  const usageSummary = selectedRecord ? buildDirectoryUsageSummary(snapshot, editorKey, selectedRecord.id) : null;
  const crossDirectoryAudit = useMemo(() => buildDirectoryCrossAudit(snapshot), [snapshot]);
  const boundaryDescription = getDirectoryBoundaryDescription(editorKey);
  const directoryNavigationLocked = screenMode !== "view";

  useEffect(() => {
    if (screenMode === "create") return;
    setRecordDraft(normalizedSelectedRecord ? (cloneJson(normalizedSelectedRecord) as EditorDraft) : null);
    if (!rawMode) {
      setEditorNotice(null);
    }
  }, [editorKey, normalizedSelectedRecord, rawMode, screenMode, selectedRecordId, snapshot]);

  useEffect(() => {
    if (orderedFilteredRecords.length === 0) {
      setSelectedRecordId("");
      return;
    }
    if (!orderedFilteredRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(orderedFilteredRecords[0].id);
    }
  }, [orderedFilteredRecords, selectedRecordId]);

  useEffect(() => {
    const restoringIntoCurrentEditor =
      restoredLocalDraft &&
      ["directories", "templates", "external"].includes(restoredLocalDraft.domain) &&
      (
        (restoredLocalDraft.domain === "templates" && editorKey === "__templates__")
        || (restoredLocalDraft.domain === "external" && editorKey === "__external__")
        || (restoredLocalDraft.domain === "directories" && editorKey === restoredLocalDraft.entity_id)
      );
    if (restoringIntoCurrentEditor) {
      return;
    }
    setScreenMode("view");
    setRawMode(false);
    setDragRecordId(null);
    setDragRecordTargetId(null);
    setRecordPointerDrag(null);
    setRecordDragPreviewIds(null);
    setRecordCommittedOrderIds(null);
    recordDragBaseIdsRef.current = null;
  }, [editorKey, restoredLocalDraft]);

  useEffect(() => {
    onDirtyChange(recordDirty);
    return () => onDirtyChange(false);
  }, [recordDirty, onDirtyChange]);

  async function saveDirectoryCollection(records: unknown, successText = "Изменения сохранены.") {
    setIsSaving(true);
    try {
      if (editorKey === "__external__") {
        await window.fronda.saveExternalSources(records as ExternalSource[], actorName);
      } else if (editorKey === "__templates__") {
        await window.fronda.saveTemplates(records as PostTemplate[], actorName);
      } else {
        await window.fronda.saveDirectoryRecords(editorKey, records as DirectoryRecord[], actorName);
      }
      setEditorNotice({ tone: "success", text: successText });
      await onRefresh(false);
    } catch (error) {
      setEditorNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось сохранить справочник."
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleDirectoryCategory(enabled: boolean) {
    const categoryMeta = TOGGLEABLE_DIRECTORY_CATEGORY_META[editorKey];
    if (!categoryMeta) {
      return;
    }
    if (directoryNavigationLocked) {
      showDirectoryNavigationBlockedNotice();
      return;
    }
    if (!currentRecords.length) {
      setEditorNotice({
        tone: "warning",
        text: categoryMeta.emptyText
      });
      return;
    }
    const now = new Date().toISOString();
    const nextRecords = currentRecords.map((record) => {
      if (isArchivedLookupRecord(record)) {
        return record;
      }
      return {
        ...(record as DirectoryRecord),
        status: enabled ? "active" : "inactive",
        updated_at: now,
        updated_by: actorName
      };
    });
    setStatusFilter("all");
    await saveDirectoryCollection(
      nextRecords,
      enabled ? categoryMeta.enabledSuccessText : categoryMeta.disabledSuccessText
    );
  }

  async function createRecord() {
    if (directoryNavigationLocked) {
      showDirectoryNavigationBlockedNotice();
      return;
    }
    try {
      let draft: EditorDraft | null = null;
      if (editorKey === "__external__") {
        draft = createExternalSourceDraft(actorName);
      } else if (editorKey === "__templates__") {
        draft = createPostTemplateDraft(actorName);
      } else if (editorKey === "departments") {
        draft = createDepartmentDraft("Новый отдел", "Отдел", actorName, currentRecords.length + 1);
      } else if (editorKey === "structure_positions") {
        draft = createStructurePositionDraft(
          activeDepartments[0]?.id ?? snapshot.departments[0]?.id ?? "general",
          "Новая должность",
          actorName,
          currentRecords.length + 1
        );
      } else {
        draft = createDirectoryRecordDraft(actorName, editorKey);
      }
      setRecordDraft(draft);
      setScreenMode("create");
      setRawMode(false);
      setEditorNotice(null);
    } catch (error) {
      setEditorNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Не удалось подготовить форму новой записи."
      });
    }
  }

  function showDirectoryNavigationBlockedNotice() {
    setEditorNotice({
      tone: "warning",
      text: "Сначала сохраните или отмените текущее редактирование, а потом переходите к другой записи или разделу."
    });
  }

  function canLeaveCurrentDirectoryRecord(nextRecordId?: string) {
    if (screenMode === "view") {
      return true;
    }
    if (nextRecordId && nextRecordId === selectedRecordId) {
      return true;
    }
    showDirectoryNavigationBlockedNotice();
    return false;
  }

  function openDirectorySection(nextEditorKey: string) {
    if (nextEditorKey === editorKey) {
      return;
    }
    if (!canLeaveCurrentDirectoryRecord()) {
      return;
    }
    setEditorKey(nextEditorKey);
  }

  function duplicateRecord() {
    if (!selectedRecord) return;
    let draft: EditorDraft;
    if (editorKey === "__external__") {
      draft = {
        ...(cloneJson(selectedRecord) as ExternalSource),
        ...createRecordMeta("ext", actorName),
        name: `${(selectedRecord as ExternalSource).name} (копия)`
      };
    } else if (editorKey === "__templates__") {
      draft = {
        ...(cloneJson(selectedRecord) as PostTemplate),
        ...createRecordMeta("tpl", actorName),
        name: `${(selectedRecord as PostTemplate).name} (копия)`
      };
    } else {
      draft = {
        ...(cloneJson(selectedRecord) as DirectoryRecord),
        ...createRecordMeta("dir", actorName),
        name: `${getDirectoryRecordLabel(selectedRecord, editorKey)} (копия)`
      };
    }
    setRecordDraft(normalizeDirectoryEditorDraft(editorKey, cloneJson(draft)) as EditorDraft);
    setScreenMode("create");
    setRawMode(false);
    setEditorNotice(null);
  }

  async function archiveRecord(recordId: string) {
    if (editorKey === "__external__") {
      await saveDirectoryCollection(
        snapshot.externalSources.map((item) =>
          item.id === recordId ? toggleDirectoryArchiveState(item) : item
        ),
        "Состояние внешнего источника обновлено."
      );
      return;
    }
    if (editorKey === "__templates__") {
      await saveDirectoryCollection(
        snapshot.templates.map((item) =>
          item.id === recordId ? toggleDirectoryArchiveState(item) : item
        ),
        "Состояние шаблона обновлено."
      );
      return;
    }
    await saveDirectoryCollection(
      currentRecords.map((item) =>
        item.id === recordId ? toggleDirectoryArchiveState(item) : item
      ),
      "Статус записи справочника обновлен."
    );
  }

  async function deleteSelectedDirectoryRecord() {
    if (!selectedRecord || screenMode === "create") {
      return;
    }
    const usageCount = usageSummary?.total ?? 0;
    const confirmed = window.confirm(
      usageCount
        ? `Удалить запись «${getDirectoryRecordLabel(selectedRecord, editorKey, showAdvancedMode)}»?\n\nОна используется в системе ${usageCount} раз(а). Запись будет удалена из справочника без автоматической подмены связанных ссылок.`
        : `Удалить запись «${getDirectoryRecordLabel(selectedRecord, editorKey, showAdvancedMode)}»?`
    );
    if (!confirmed) {
      return;
    }
    if (editorKey === "__external__") {
      await saveDirectoryCollection(
        snapshot.externalSources.filter((item) => item.id !== selectedRecord.id),
        "Источник субтитров удален."
      );
    } else if (editorKey === "__templates__") {
      await saveDirectoryCollection(
        snapshot.templates.filter((item) => item.id !== selectedRecord.id),
        "Шаблон поста удален."
      );
    } else {
      await saveDirectoryCollection(
        currentRecords.filter((item) => item.id !== selectedRecord.id),
        "Запись справочника удалена."
      );
    }
    setSelectedRecordId("");
    setScreenMode("view");
    setRawMode(false);
  }

  function applyVisibleRecordOrder<T extends { id: string }>(collection: T[], orderedIds: string[]): T[] {
    const orderedMap = new Map(collection.map((item) => [item.id, item]));
    const visibleIds = new Set(orderedIds);
    const visibleQueue = orderedIds
      .map((id) => orderedMap.get(id))
      .filter((item): item is T => Boolean(item));
    let visibleIndex = 0;
    return collection.map((item) => {
      if (!visibleIds.has(item.id)) {
        return item;
      }
      const nextVisible = visibleQueue[visibleIndex];
      visibleIndex += 1;
      return nextVisible ?? item;
    });
  }

  async function persistRecordOrder(draggedRecordId: string, targetRecordId: string, orderedIds?: string[] | null) {
    if (draggedRecordId === targetRecordId) return;
    const reorderedCollection = orderedIds?.length
      ? applyVisibleRecordOrder([...currentRecords], orderedIds)
      : reorderByTarget([...currentRecords], draggedRecordId, targetRecordId);
    await saveDirectoryCollection(
      normalizeOrderedDirectoryCollection(reorderedCollection),
      "Порядок записей обновлен."
    );
  }

  function beginRecordDrag(recordId: string) {
    recordDragBaseIdsRef.current = orderedFilteredRecords.map((item) => item.id);
    setDragRecordId(recordId);
    setDragRecordTargetId(recordId);
    setRecordDragPreviewIds(recordDragBaseIdsRef.current);
  }

  function trackRecordDropTarget(recordId: string) {
    if (!dragRecordId || dragRecordId === recordId || dragRecordTargetId === recordId) return;
    setDragRecordTargetId(recordId);
    const source = recordDragBaseIdsRef.current ?? orderedFilteredRecords.map((item) => item.id);
    setRecordDragPreviewIds(reorderIdsByTarget([...source], dragRecordId, recordId));
  }

  function beginRecordPointerDrag(event: ReactPointerEvent<HTMLDivElement>, recordId: string) {
    if (event.button !== 0 || event.detail > 1 || shouldIgnoreSurfaceDrag(event.target)) {
      return;
    }
    if (directoryNavigationLocked && recordId !== selectedRecordId) {
      showDirectoryNavigationBlockedNotice();
      return;
    }
    setRecordPointerDrag({
      id: recordId,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    });
  }

  function handleDirectoryRecordClick(recordId: string) {
    if (suppressDirectoryRecordClickRef.current) {
      return;
    }
    if (!canLeaveCurrentDirectoryRecord(recordId)) {
      return;
    }
    openDirectoryRecord(recordId);
  }

  async function saveSelectedRecord() {
    if (screenMode !== "create" && !selectedRecord) return;
    if (rawMode) {
      try {
        const parsed = JSON.parse(jsonValue);
        await saveDirectoryCollection(parsed, "Исходные данные сохранены.");
        setScreenMode("view");
      } catch (error) {
        setEditorNotice({
          tone: "danger",
          text: error instanceof Error ? `Ошибка JSON: ${error.message}` : "Не удалось разобрать исходные данные."
        });
      }
      return;
    }
    if (!recordDraft) return;
    const normalizedRecordDraft = normalizeDirectoryEditorDraft(editorKey, cloneJson(recordDraft as EditorDraft));
    const draftName = normalizeLookupKey(getDirectoryComparableName(normalizedRecordDraft as EditorDraft, editorKey));
    const duplicateByName = draftName
      ? currentRecords.find((item) =>
          item.id !== (selectedRecord?.id ?? "") &&
          normalizeLookupKey(getDirectoryComparableName(item as EditorDraft, editorKey)) === draftName
        )
      : null;
    if (duplicateByName) {
      setEditorNotice({
        tone: "warning",
        text: `Похожая запись уже существует: ${getDirectoryRecordLabel(duplicateByName, editorKey)}. Сначала проверьте, нельзя ли использовать ее вместо создания дубля.`
      });
      return;
    }
    const comparableName = getDirectoryComparableName(normalizedRecordDraft as EditorDraft, editorKey);
    const crossEntityConflict = findCrossEntityConflict(
      snapshot,
      editorKey,
      comparableName,
      screenMode === "create" ? undefined : selectedRecord?.id
    );
    if (crossEntityConflict) {
      setEditorNotice({
        tone: "warning",
        text: `Название «${comparableName}» уже используется в сущности «${crossEntityConflict.group}». Отделы, роли участников и должности структуры должны быть разведены.`
      });
      return;
    }
    if (editorKey === "__external__") {
      const next =
        screenMode === "create"
          ? [...snapshot.externalSources, normalizedRecordDraft as ExternalSource]
          : snapshot.externalSources.map((item) =>
              item.id === selectedRecord!.id ? { ...item, ...(normalizedRecordDraft as ExternalSource) } : item
            );
      await saveDirectoryCollection(next, screenMode === "create" ? "Создан новый источник субтитров." : "Источник субтитров сохранен.");
      setSelectedRecordId((normalizedRecordDraft as ExternalSource).id);
      setScreenMode("view");
      return;
    }
    if (editorKey === "__templates__") {
      const next =
        screenMode === "create"
          ? [...snapshot.templates, normalizedRecordDraft as PostTemplate]
          : snapshot.templates.map((item) =>
              item.id === selectedRecord!.id ? { ...item, ...(normalizedRecordDraft as PostTemplate) } : item
            );
      await saveDirectoryCollection(next, screenMode === "create" ? "Создан новый шаблон поста." : "Шаблон поста сохранен.");
      setSelectedRecordId((normalizedRecordDraft as PostTemplate).id);
      setScreenMode("view");
      return;
    }
    const next = normalizeOrderedDirectoryCollection(
      screenMode === "create"
        ? [...currentRecords, normalizedRecordDraft as DirectoryRecord]
        : currentRecords.map((item) =>
            item.id === selectedRecord!.id ? { ...item, ...(normalizedRecordDraft as DirectoryRecord) } : item
          )
    );
    await saveDirectoryCollection(next, screenMode === "create" ? "Создана новая запись справочника." : "Запись справочника сохранена.");
    setSelectedRecordId((normalizedRecordDraft as DirectoryRecord).id);
    setScreenMode("view");
  }

  function beginEditing() {
    if (!selectedRecord) return;
    setRecordDraft(cloneJson(normalizedSelectedRecord ?? selectedRecord) as EditorDraft);
    setScreenMode("edit");
    setRawMode(false);
  }

  function beginEditingRecord(recordId: string) {
    if (!canLeaveCurrentDirectoryRecord(recordId)) {
      return;
    }
    const targetRecord = currentRecords.find((record) => record.id === recordId);
    if (!targetRecord) {
      return;
    }
    setSelectedRecordId(recordId);
    setRecordDraft(
      cloneJson(normalizeDirectoryEditorDraft(editorKey, cloneJson(targetRecord) as EditorDraft) as EditorDraft)
    );
    setScreenMode("edit");
    setRawMode(false);
    setEditorNotice(null);
  }

  function cancelEditing() {
    setRawMode(false);
    setEditorNotice(null);
    if (selectedRecord) {
      setRecordDraft(cloneJson(normalizedSelectedRecord ?? selectedRecord) as EditorDraft);
      setScreenMode("view");
      return;
    }
    setRecordDraft(null);
    setScreenMode("view");
  }

  function openDirectoryRecord(recordId: string) {
    setSelectedRecordId(recordId);
    setScreenMode("view");
    setRawMode(false);
  }

  useEffect(() => {
    if (!recordPointerDrag && !dragRecordId) {
      return;
    }

    function resetState(options?: { preservePreview?: boolean }) {
      document.body.classList.remove("app-reorder-active");
      setRecordPointerDrag(null);
      setDragRecordId(null);
      setDragRecordTargetId(null);
      if (!options?.preservePreview) {
        setRecordDragPreviewIds(null);
        recordDragBaseIdsRef.current = null;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const candidate = recordPointerDrag;
      const activeId = dragRecordId ?? candidate?.id;
      if (!activeId) {
        return;
      }
      if (candidate && event.pointerId !== candidate.pointerId) {
        return;
      }
      if (!dragRecordId && candidate) {
        const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
        if (distance < 10) {
          return;
        }
        document.body.classList.add("app-reorder-active");
        beginRecordDrag(candidate.id);
      }
      const targetRecordId = findNearestReorderTargetId("data-directory-record-order-id", activeId, event.clientX, event.clientY);
      if (targetRecordId && targetRecordId !== activeId) {
        trackRecordDropTarget(targetRecordId);
      }
    }

    function handlePointerUp() {
      const activeId = dragRecordId;
      const targetId = dragRecordTargetId;
      const didReorder = Boolean(activeId && targetId && activeId !== targetId);
      const committedIds =
        didReorder && activeId && targetId
          ? (recordDragPreviewIds ?? reorderIdsByTarget([...(recordDragBaseIdsRef.current ?? orderedFilteredRecords.map((item) => item.id))], activeId, targetId))
          : null;
      if (committedIds) {
        setRecordCommittedOrderIds(committedIds);
      }
      resetState({ preservePreview: didReorder });
      if (didReorder) {
        suppressDirectoryRecordClickRef.current = true;
        window.setTimeout(() => {
          suppressDirectoryRecordClickRef.current = false;
        }, 160);
      }
      if (activeId && targetId && activeId !== targetId) {
        void persistRecordOrder(activeId, targetId, committedIds)
          .catch(() => {
            setRecordCommittedOrderIds(null);
          })
          .finally(() => {
            setRecordDragPreviewIds(null);
            recordDragBaseIdsRef.current = null;
          });
      } else {
        setRecordDragPreviewIds(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragRecordId, dragRecordTargetId, orderedFilteredRecords, recordDragPreviewIds, recordPointerDrag]);

  return (
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="directories:list">
      <Panel title="Справочники и шаблоны" subtitle="Рабочие словари, источники субтитров и шаблоны постов редактируются через обычные формы.">
        <div className="section-stack">
          <div className="dashboard-actions primary-cluster">
            <Button className="primary" onClick={() => void createRecord()} disabled={directoryNavigationLocked}>Создать запись</Button>
            <ActionMenu label="Еще">
              <ActionMenuItem onClick={() => openDirectorySection("__templates__")} disabled={directoryNavigationLocked && editorKey !== "__templates__"}>Открыть шаблоны постов</ActionMenuItem>
              <ActionMenuItem onClick={() => openDirectorySection("__external__")} disabled={directoryNavigationLocked && editorKey !== "__external__"}>Открыть субтитры</ActionMenuItem>
            </ActionMenu>
          </div>
          <div className="list">
            {directoryKeys.map((key) => {
              const blocked = directoryNavigationLocked && editorKey !== key;
              return <div key={key} className={`list-item ${editorKey === key ? "active" : ""} ${blocked ? "nav-blocked" : ""}`} onClick={() => openDirectorySection(key)}><div className="card-header-row"><div className="card-header-main"><h3>{getDirectoryEditorMeta(key).title}</h3><div className="muted">{getDirectoryEditorMeta(key).subtitle}</div></div><div className="chip-group"><Chip>{snapshot.directories[key]?.length ?? 0}</Chip></div></div></div>;
            })}
            <div className={`list-item ${editorKey === "__external__" ? "active" : ""} ${directoryNavigationLocked && editorKey !== "__external__" ? "nav-blocked" : ""}`} onClick={() => openDirectorySection("__external__")}><div className="card-header-row"><div className="card-header-main"><h3>Субтитры</h3><div className="muted">Группы субтитров, партнеры и переводческие команды</div></div><div className="chip-group"><Chip>{snapshot.externalSources.length}</Chip></div></div></div>
            <div className={`list-item ${editorKey === "__templates__" ? "active" : ""} ${directoryNavigationLocked && editorKey !== "__templates__" ? "nav-blocked" : ""}`} onClick={() => openDirectorySection("__templates__")}><div className="card-header-row"><div className="card-header-main"><h3>Шаблоны постов</h3><div className="muted">Порядок блоков, нижний блок, стиль имен и область применения</div></div><div className="chip-group"><Chip>{snapshot.templates.length}</Chip></div></div></div>
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion
        scrollKey={`directories:records:${editorKey}`}
        style={{ order: screenMode === "view" ? 2 : 3 }}
      >
      <Panel title={`Записи: ${editorMeta.title}`} subtitle={editorMeta.subtitle}>
        <div className="section-stack">
          {toggleableCategoryMeta ? (
            <div className="detail-card">
              <div className="row spread" style={{ alignItems: "center", gap: 16 }}>
                <div>
                  <h4>{toggleableCategoryMeta.title}</h4>
                  <div className="muted">
                    {currentCategoryEnabled ? toggleableCategoryMeta.enabledText : toggleableCategoryMeta.disabledText}
                  </div>
                </div>
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={currentCategoryEnabled}
                    disabled={isSaving || directoryNavigationLocked || currentCategoryEditableCount === 0}
                    onChange={(event) => void toggleDirectoryCategory(event.target.checked)}
                  />
                  <span>{currentCategoryEnabled ? "Включено" : "Отключено"}</span>
                </label>
              </div>
              {currentCategoryEditableCount === 0 ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  {toggleableCategoryMeta.emptyText}
                </div>
              ) : null}
            </div>
          ) : null}
          <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Поиск по справочнику: ${editorMeta.title.toLowerCase()}`} />
          <div className="grid two">
            <select className="select-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive" | "archived")}>
              <option value="all">Все записи</option>
              <option value="active">Активные</option>
              <option value="inactive">Неактивные</option>
              <option value="archived">Архивные</option>
            </select>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Chip>{formatSimpleCount(orderedFilteredRecords.length, "запись", "записей")}</Chip>
            </div>
          </div>
          <div className="list compact-list">
            {orderedFilteredRecords.length ? orderedFilteredRecords.map((record) => (
              <div
                key={record.id}
                className={`list-item ${selectedRecordId === record.id && screenMode !== "create" ? "active" : ""} ${dragRecordId === record.id ? "dragging" : ""} ${dragRecordTargetId === record.id && dragRecordId !== record.id ? "drop-target" : ""} ${directoryNavigationLocked && selectedRecordId !== record.id ? "nav-blocked" : ""}`}
                data-directory-record-order-id={record.id}
                data-reorder-surface="true"
                onPointerDown={(event) => beginRecordPointerDrag(event, record.id)}
                onClick={() => handleDirectoryRecordClick(record.id)}
                onDoubleClick={() => beginEditingRecord(record.id)}
              >
                <div className="row spread">
                  <div>
                    <strong>{getDirectoryRecordLabel(record, editorKey, showAdvancedMode)}</strong>
                    <div className="muted">{getDirectoryRecordSecondary(record, editorKey, snapshot, showAdvancedMode)}</div>
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <Chip tone={normalizeDirectoryRecordStatus(record.status) === "archived" ? "warning" : normalizeDirectoryRecordStatus(record.status) === "inactive" ? "danger" : undefined}>{getDirectoryRecordStatusLabel(record.status)}</Chip>
                  </div>
                </div>
              </div>
            )) : <EmptyState title="Записи не найдены" body="Измените поисковый запрос, переключите фильтр или создайте новую запись." />}
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion
        scrollKey={`directories:details:${editorKey}:${selectedRecordId || screenMode}`}
        style={{ order: screenMode === "view" ? 3 : 2 }}
      >
      <Panel
        title={
          screenMode === "create"
            ? `Новая запись: ${editorMeta.title}`
            : currentRecord
              ? getDirectoryRecordLabel(currentRecord, editorKey, showAdvancedMode)
              : "Запись справочника"
        }
        subtitle={
          screenMode === "view"
            ? "Сначала просмотрите запись, а затем при необходимости включите редактирование."
            : screenMode === "edit"
              ? "Редактирование выбранной записи."
              : "Создание новой записи."
        }
        actions={
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Chip tone={screenMode === "view" ? undefined : recordDirty ? "warning" : "success"}>
              {screenMode === "view" ? "Просмотр" : recordDirty ? "Есть локальные правки" : "Готово к сохранению"}
            </Chip>
            {screenMode === "view" && selectedRecord ? <Button className="primary" onClick={beginEditing} disabled={isSaving}>Редактировать</Button> : null}
            {screenMode !== "view" ? <Button className="secondary" onClick={cancelEditing} disabled={isSaving}>Отменить</Button> : null}
            {screenMode !== "view" ? <Button className="primary" onClick={() => void saveSelectedRecord()} disabled={isSaving}>{isSaving ? "Сохраняем..." : "Сохранить запись"}</Button> : null}
            {screenMode === "edit" && selectedRecord ? <Button className="danger" onClick={() => void deleteSelectedDirectoryRecord()} disabled={isSaving}>Удалить</Button> : null}
            {(selectedRecord || (showAdvancedMode && screenMode !== "view")) ? (
              <ActionMenu label="Еще действия">
                {selectedRecord ? <ActionMenuItem onClick={duplicateRecord} disabled={isSaving}>Дублировать</ActionMenuItem> : null}
                {selectedRecord ? <ActionMenuItem onClick={() => void archiveRecord(selectedRecord.id)} disabled={isSaving}>{selectedRecord.status === "archived" ? "Восстановить запись" : "В архив"}</ActionMenuItem> : null}
                {screenMode === "view" && selectedRecord ? <ActionMenuItem className="danger" onClick={() => void deleteSelectedDirectoryRecord()} disabled={isSaving}>Удалить</ActionMenuItem> : null}
                {showAdvancedMode && screenMode !== "view" ? (
                  <ActionMenuItem onClick={() => setRawMode((value) => !value)} disabled={isSaving}>
                    {rawMode ? "Скрыть исходные данные" : "Показать исходные данные"}
                  </ActionMenuItem>
                ) : null}
              </ActionMenu>
            ) : null}
          </div>
        }
      >
        {isSaving ? <div className="notice-banner"><strong>Сохраняем...</strong><div>Запись справочника обновляется. Повторно нажимать кнопку не нужно.</div></div> : null}
        {!isSaving && editorNotice ? <div className="detail-card"><div className="row spread"><Chip tone={editorNotice.tone}>{editorNotice.tone === "success" ? "Сохранено" : editorNotice.tone === "warning" ? "Нужно проверить" : "Ошибка"}</Chip><div className="muted">{editorNotice.text}</div></div></div> : null}
        {!currentRecord ? <EmptyState title="Запись не выбрана" body="Выберите запись справочника слева или создайте новую." action={<Button className="primary" onClick={() => void createRecord()}>Создать запись</Button>} /> : screenMode === "view" ? (
          <div className="section-stack">
            <div className="detail-card">
              <h4>Краткая сводка</h4>
              <div className="compact-row"><strong>Название</strong><span className="muted">{getDirectoryRecordLabel(currentRecord, editorKey, showAdvancedMode)}</span></div>
              <div className="compact-row"><strong>Статус</strong><span className="muted">{getDirectoryRecordStatusLabel(currentRecord.status)}</span></div>
              <div className="compact-row"><strong>Описание</strong><span className="muted">{("description" in currentRecord && currentRecord.description) ? currentRecord.description : getDirectoryRecordSecondary(currentRecord, editorKey, snapshot, showAdvancedMode)}</span></div>
            </div>
            {selectedRecord && currentRecords.length > 1 ? (
              <div className="detail-card">
                <h4>Порядок в списке</h4>
                <div className="muted">Запись стоит на позиции {selectedRecordIndex + 1} из {currentRecords.length}. Чтобы изменить порядок, перетащите запись мышью в центральном реестре.</div>
              </div>
            ) : null}
            {editorKey === "__templates__" ? (
              <div className="detail-card">
                <h4>Предпросмотр шаблона</h4>
                <div className="muted">{buildTemplatePreview(currentRecord as PostTemplate, departmentNameById, releaseTypeNameById)}</div>
                <div className="post-preview-box compact" style={{ marginTop: 12 }}>
                  {buildTemplatePreviewText(currentRecord as PostTemplate, departmentNameById, releaseTypeNameById)}
                </div>
              </div>
            ) : null}
            <div className="detail-card">
              <h4>Где используется</h4>
              {usageSummary ? (
                <div className="section-stack compact">
                  <div className="compact-row"><strong>Связей найдено</strong><span className="muted">{usageSummary.total}</span></div>
                  {usageSummary.lines.length ? usageSummary.lines.map((line) => <div key={line} className="muted">{line}</div>) : <div className="muted">Для этой записи пока не найдено активных ссылок в участниках, релизах или структуре.</div>}
                </div>
              ) : <div className="muted">Выберите запись, чтобы увидеть, где она используется в системе.</div>}
            </div>
            {showAdvancedMode ? <div className="detail-card">
              <h4>Служебные сведения</h4>
              <div className="compact-row"><strong>ID</strong><span className="muted mono">{currentRecord.id}</span></div>
              <div className="compact-row"><strong>Последнее обновление</strong><span className="muted">{formatDate(currentRecord.updated_at)}</span></div>
            </div> : null}
          </div>
        ) : showAdvancedMode && rawMode ? (
          <textarea className="text-area json-box" value={jsonValue} onChange={(event) => setJsonValue(event.target.value)} />
        ) : (
          <div className="section-stack">
            {editorKey === "departments" ? (
              <>
                <div className="grid two">
                  <Field label="Название отдела"><input className="text-input" value={(recordDraft as DepartmentDirectoryItem).name} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), name: event.target.value })} /></Field>
                  <Field label="Короткое имя"><input className="text-input" value={(recordDraft as DepartmentDirectoryItem).short_name} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), short_name: event.target.value })} /></Field>
                </div>
                <div className="grid two">
                  {showAdvancedMode ? <Field label="Системное имя"><input className="text-input" value={(recordDraft as DepartmentDirectoryItem).slug} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), slug: event.target.value })} /></Field> : <div />}
                  <Field label="Тип отдела">
                    <select className="select-input" value={(recordDraft as DepartmentDirectoryItem).department_type_id ?? "department"} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), department_type_id: event.target.value })}>
                      {DEPARTMENT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid two">
                  <Field label="Родительский отдел">
                    <select className="select-input" value={(recordDraft as DepartmentDirectoryItem).parent_department_id ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), parent_department_id: event.target.value || null })}>
                      <option value="">Без родителя</option>
                      {mergeLookupOptionsWithCurrent(snapshot.departments, [(recordDraft as DepartmentDirectoryItem).parent_department_id]).filter((item) => item.id !== (recordDraft as DepartmentDirectoryItem).id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Порядок">
                    <input className="text-input" type="number" value={(recordDraft as DepartmentDirectoryItem).sort_order} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), sort_order: Number(event.target.value) || 0 })} />
                  </Field>
                </div>
                <div className="grid two">
                  <Field label="Показывать новичкам">
                    <select className="select-input" value={(recordDraft as DepartmentDirectoryItem).onboarding_visible_flag ? "yes" : "no"} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), onboarding_visible_flag: event.target.value === "yes" })}>
                      <option value="yes">Да</option>
                      <option value="no">Нет</option>
                    </select>
                  </Field>
                  <Field label="Статус записи">
                    <select className="select-input" value={normalizeDirectoryRecordStatus((recordDraft as DepartmentDirectoryItem).status)} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), status: event.target.value })}>
                      {DIRECTORY_RECORD_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid two">
                  <Field label="Теги через запятую"><input className="text-input" value={normalizeStringArray((recordDraft as DepartmentDirectoryItem).tags).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as DepartmentDirectoryItem), tags: splitCsv(event.target.value) })} /></Field>
                  <div />
                </div>
              </>
            ) : editorKey === "structure_positions" ? (
              <>
                <div className="grid two">
                  <Field label="Название должности"><input className="text-input" value={(recordDraft as StructurePosition).name} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), name: event.target.value })} /></Field>
                  <Field label="Короткая подпись"><input className="text-input" value={(recordDraft as StructurePosition).short_label} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), short_label: event.target.value })} /></Field>
                </div>
                <div className="grid two">
                  <Field label="Отдел">
                    <select className="select-input" value={(recordDraft as StructurePosition).department_id} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), department_id: event.target.value })}>
                      {mergeLookupOptionsWithCurrent(snapshot.departments, [(recordDraft as StructurePosition).department_id]).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Тип должности">
                    <select
                      className="select-input"
                      value={(recordDraft as StructurePosition).position_type_id ?? "worker"}
                      onChange={(event) => {
                        const nextType = event.target.value;
                        setRecordDraft({
                          ...(recordDraft as StructurePosition),
                          position_type_id: nextType,
                          is_leadership: nextType === "leadership",
                          is_curator: nextType === "curator",
                          is_admin: nextType === "admin"
                        });
                      }}
                    >
                      {POSITION_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid two">
                  <Field label="Подчиняется позиции">
                    <select className="select-input" value={(recordDraft as StructurePosition).reports_to_position_id ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), reports_to_position_id: event.target.value || null })}>
                      <option value="">Не указано</option>
                      {mergeLookupOptionsWithCurrent(snapshot.structurePositions, [(recordDraft as StructurePosition).reports_to_position_id]).filter((item) => item.id !== (recordDraft as StructurePosition).id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Порядок">
                    <input className="text-input" type="number" value={(recordDraft as StructurePosition).sort_order} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), sort_order: Number(event.target.value) || 0 })} />
                  </Field>
                </div>
                <div className="filter-chip-grid">
                  <ToggleChip label="Руководство" active={(recordDraft as StructurePosition).is_leadership} onToggle={(value) => setRecordDraft({ ...(recordDraft as StructurePosition), is_leadership: value })} tone="accent" />
                  <ToggleChip label="Кураторство" active={(recordDraft as StructurePosition).is_curator} onToggle={(value) => setRecordDraft({ ...(recordDraft as StructurePosition), is_curator: value })} tone="accent" />
                  <ToggleChip label="Административная роль" active={(recordDraft as StructurePosition).is_admin} onToggle={(value) => setRecordDraft({ ...(recordDraft as StructurePosition), is_admin: value })} tone="accent" />
                  <ToggleChip label="Одна ставка" active={(recordDraft as StructurePosition).is_single_seat} onToggle={(value) => setRecordDraft({ ...(recordDraft as StructurePosition), is_single_seat: value })} />
                  <ToggleChip label="Несколько держателей" active={(recordDraft as StructurePosition).can_have_multiple_holders} onToggle={(value) => setRecordDraft({ ...(recordDraft as StructurePosition), can_have_multiple_holders: value })} />
                </div>
                <div className="grid two">
                <Field label="Зоны ответственности через запятую"><input className="text-input" value={normalizeStringArray((recordDraft as StructurePosition).responsibility_scope_ids).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), responsibility_scope_ids: splitCsv(event.target.value) })} /></Field>
                  <Field label="Показывать новичкам">
                    <select className="select-input" value={(recordDraft as StructurePosition).onboarding_visible_flag ? "yes" : "no"} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), onboarding_visible_flag: event.target.value === "yes" })}>
                      <option value="yes">Да</option>
                      <option value="no">Нет</option>
                    </select>
                  </Field>
                </div>
                <Field label="Статус записи">
                  <select className="select-input" value={normalizeDirectoryRecordStatus((recordDraft as StructurePosition).status)} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), status: event.target.value })}>
                    {DIRECTORY_RECORD_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
                <div className="grid two">
                  <Field label="Внутреннее описание"><textarea className="text-area" value={(recordDraft as StructurePosition).description_internal ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), description_internal: event.target.value })} /></Field>
                <Field label="Описание для новичков"><textarea className="text-area" value={(recordDraft as StructurePosition).description_onboarding ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as StructurePosition), description_onboarding: event.target.value })} /></Field>
                </div>
              </>
            ) : editorKey === "__external__" ? (
              <>
                <Field label="Название"><input className="text-input" value={(recordDraft as ExternalSource).name} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), name: event.target.value })} /></Field>
                <Field label="Тип источника">
                  <select className="select-input" value={(recordDraft as ExternalSource).external_source_type_id ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), external_source_type_id: event.target.value })}>
                    <option value="">Не указан</option>
                    {mergeLookupOptionsWithCurrent(snapshot.directories.external_source_types ?? [], [(recordDraft as ExternalSource).external_source_type_id]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="Другие названия"><input className="text-input" value={normalizeStringArray((recordDraft as ExternalSource).aliases).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), aliases: splitCsv(event.target.value) })} /></Field>
                <Field label="Контакты"><input className="text-input" value={normalizeStringArray((recordDraft as ExternalSource).contacts).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), contacts: splitCsv(event.target.value) })} placeholder="Например: Telegram, VK, почта" /></Field>
                <Field label="Ссылки"><input className="text-input" value={normalizeStringArray((recordDraft as ExternalSource).links).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), links: splitCsv(event.target.value) })} placeholder="Можно указать несколько ссылок через запятую" /></Field>
                <Field label="Подпись для поста"><input className="text-input" value={(recordDraft as ExternalSource).preferred_post_label ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), preferred_post_label: event.target.value })} /></Field>
                <Field label="Комментарий"><textarea className="text-area" value={(recordDraft as ExternalSource).comment ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), comment: event.target.value })} /></Field>
                <Field label="Статус записи">
                  <select className="select-input" value={normalizeDirectoryRecordStatus((recordDraft as ExternalSource).status)} onChange={(event) => setRecordDraft({ ...(recordDraft as ExternalSource), status: event.target.value })}>
                    {DIRECTORY_RECORD_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
              </>
            ) : editorKey === "__templates__" ? (
              <>
                <Field label="Название шаблона" help="Понятное имя, по которому шаблон будут выбирать кураторы в карточке релиза."><input className="text-input" value={(recordDraft as PostTemplate).name} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), name: event.target.value })} /></Field>
                <Field label="Назначение шаблона" help="Определяет, для какого типа публикации рассчитан шаблон: основной пост, короткий пост, анонс или свободный вариант.">
                  <select className="select-input" value={(recordDraft as PostTemplate).template_type} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), template_type: event.target.value })}>
                    {TEMPLATE_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label="Краткое описание" help="Коротко опишите, когда использовать этот шаблон и чем он отличается от остальных."><textarea className="text-area" value={(recordDraft as PostTemplate).description ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), description: event.target.value })} /></Field>
                <Field label="Блоки поста" help="Порядок блоков определяет, в какой последовательности будут собираться части готового поста.">
                  <TemplateBlockOrderEditor
                    selectedIds={(recordDraft as PostTemplate).block_order}
                    onToggle={(blockId) =>
                      setRecordDraft({
                        ...(recordDraft as PostTemplate),
                        block_order: toggleId((recordDraft as PostTemplate).block_order, blockId)
                      })
                    }
                    onReorder={(nextOrder) =>
                      setRecordDraft({
                        ...(recordDraft as PostTemplate),
                        block_order: nextOrder
                      })
                    }
                  />
                </Field>
                <Field label="Скрывать пустые блоки" help="Если включено, пустые разделы не попадут в готовый текст поста."><select className="select-input" value={(recordDraft as PostTemplate).hide_empty_blocks ? "yes" : "no"} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), hide_empty_blocks: event.target.value === "yes" })}><option value="yes">Да</option><option value="no">Нет</option></select></Field>
                <Field label="Стиль имен" help="Определяет, как подписывать участников: именем из титров, отображаемым именем или упоминанием с именем."><select className="select-input" value={(recordDraft as PostTemplate).name_style ?? "credit_name"} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), name_style: event.target.value as PostTemplate["name_style"] })}><option value="credit_name">Имя в титрах</option><option value="display_name">Отображаемое имя</option><option value="mention_name">Упоминание и имя</option></select></Field>
                <Field label="Подходит для отделов" help="Ограничивает шаблон теми отделами, где он действительно нужен."><OptionChipGroup options={mergeLookupOptionsWithCurrent(snapshot.departments, (recordDraft as PostTemplate).applicable_department_ids ?? []).map((item) => ({ id: item.id, label: item.name }))} selectedIds={(recordDraft as PostTemplate).applicable_department_ids ?? []} onToggle={(departmentId) => setRecordDraft({ ...(recordDraft as PostTemplate), applicable_department_ids: toggleId((recordDraft as PostTemplate).applicable_department_ids ?? [], departmentId) })} /></Field>
                <Field label="Подходит для типов релиза" help="Помогает автоматически подсказывать нужный шаблон в карточке релиза."><OptionChipGroup options={mergeLookupOptionsWithCurrent(snapshot.directories.release_types ?? [], (recordDraft as PostTemplate).applicable_release_type_ids ?? []).map((item) => ({ id: item.id, label: item.name }))} selectedIds={(recordDraft as PostTemplate).applicable_release_type_ids ?? []} onToggle={(releaseTypeId) => setRecordDraft({ ...(recordDraft as PostTemplate), applicable_release_type_ids: toggleId((recordDraft as PostTemplate).applicable_release_type_ids ?? [], releaseTypeId) })} /></Field>
                <Field label="Нижний блок" help="Финальная подпись, благодарность или стандартный хвост, который добавляется внизу поста."><textarea className="text-area" value={(recordDraft as PostTemplate).footer ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), footer: event.target.value })} /></Field>
                <Field label="Статус записи">
                  <select className="select-input" value={normalizeDirectoryRecordStatus((recordDraft as PostTemplate).status)} onChange={(event) => setRecordDraft({ ...(recordDraft as PostTemplate), status: event.target.value })}>
                    {DIRECTORY_RECORD_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
                <div className="detail-card">
                  <h4>Предпросмотр шаблона</h4>
                  <div className="muted">{buildTemplatePreview(recordDraft as PostTemplate, departmentNameById, releaseTypeNameById)}</div>
                  <div className="post-preview-box compact" style={{ marginTop: 12 }}>
                    {buildTemplatePreviewText(recordDraft as PostTemplate, departmentNameById, releaseTypeNameById)}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid two">
                  <Field label="Название"><input className="text-input" value={(recordDraft as DirectoryRecord).name} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), name: event.target.value })} /></Field>
                  <Field label="Цвет метки"><div className="row"><input className="text-input" type="color" value={normalizeColorValue((recordDraft as DirectoryRecord).color)} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), color: event.target.value })} />{showAdvancedMode ? <input className="text-input" value={(recordDraft as DirectoryRecord).color ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), color: event.target.value })} /> : null}</div></Field>
                </div>
                <Field label="Статус записи">
                  <select className="select-input" value={normalizeDirectoryRecordStatus((recordDraft as DirectoryRecord).status)} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), status: event.target.value })}>
                    {DIRECTORY_RECORD_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label="Описание"><textarea className="text-area" value={(recordDraft as DirectoryRecord).description ?? ""} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), description: event.target.value })} /></Field>
                <Field label="Другие названия"><input className="text-input" value={((recordDraft as DirectoryRecord).aliases ?? []).join(", ")} onChange={(event) => setRecordDraft({ ...(recordDraft as DirectoryRecord), aliases: splitCsv(event.target.value) })} /></Field>
              </>
            )}
            {showAdvancedMode && currentRecord ? <div className="detail-card">
              <h4>Служебные сведения</h4>
              <div className="compact-row"><strong>ID</strong><span className="muted mono">{currentRecord.id}</span></div>
              <div className="compact-row"><strong>Статус</strong><span className="muted">{getDirectoryRecordStatusLabel(currentRecord.status)}</span></div>
              <div className="compact-row"><strong>Последнее обновление</strong><span className="muted">{formatDate(currentRecord.updated_at)}</span></div>
            </div> : null}
            <div className="detail-card">
              <h4>Где используется</h4>
              {usageSummary ? (
                <div className="section-stack compact">
                  <div className="compact-row"><strong>Связей найдено</strong><span className="muted">{usageSummary.total}</span></div>
                  {usageSummary.lines.length ? usageSummary.lines.map((line) => <div key={line} className="muted">{line}</div>) : <div className="muted">Для этой записи пока не найдено активных ссылок в участниках, релизах или структуре.</div>}
                </div>
              ) : <div className="muted">Выберите запись, чтобы увидеть, где она используется в системе.</div>}
            </div>
            {boundaryDescription ? (
              <div className="detail-card">
                <h4>Граница сущности</h4>
                <div className="muted">{boundaryDescription}</div>
              </div>
            ) : null}
            <div className="detail-card">
              <h4>Аудит пересечений</h4>
              {crossDirectoryAudit.length ? (
                <div className="section-stack compact">
                  <div className="muted">Найдены названия, которые одновременно встречаются в отделах, ролях или должностях. Их стоит развести, чтобы не плодить логические дубли.</div>
                  {crossDirectoryAudit.map((item) => (
                    <div key={item.name} className="compact-row">
                      <strong>{item.name}</strong>
                      <span className="muted">{item.groups.join(" • ")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">Логических дублей между отделами, ролями участников и должностями структуры сейчас не найдено.</div>
              )}
            </div>
          </div>
        )}
      </Panel>
      </ScrollRegion>
    </div>
  );
}

function StatisticsScreen({
  snapshot,
  onOpenRelease,
  onOpenDepartment
}: {
  snapshot: WorkspaceSnapshot;
  onOpenRelease: (id: string) => void;
  onOpenDepartment: (id: string) => void;
}) {
  const [bucketGroup, setBucketGroup] = useState<"status" | "department" | "year" | "type" | "problem">("status");
  const [selectedBucket, setSelectedBucket] = useState("in_work");
  const departmentNameById = useMemo(() => new Map(snapshot.departments.map((item) => [item.id, item.name])), [snapshot.departments]);
  const releaseStatusOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.release_statuses ?? []), [snapshot.directories.release_statuses]);
  const releaseStatusCategoryEnabled = releaseStatusOptions.length > 0;
  const releaseTypeOptions = useMemo(() => filterVisibleLookupRecords(snapshot.directories.release_types ?? []), [snapshot.directories.release_types]);
  const releaseTypeCategoryEnabled = releaseTypeOptions.length > 0;
  const releaseTypeNameById = useMemo(() => new Map(releaseTypeOptions.map((item) => [item.id, item.name])), [releaseTypeOptions]);
  const participantActionCount = useMemo(
    () => snapshot.participants.reduce((sum, item) => sum + (item.history?.length ?? 0), 0),
    [snapshot.participants]
  );
  const releaseActionCount = useMemo(
    () => snapshot.releases.reduce((sum, item) => sum + (item.history?.length ?? 0), 0),
    [snapshot.releases]
  );
  const totalDatabaseActionCount = participantActionCount + releaseActionCount;
  const buckets = useMemo(() => {
    const statusBuckets = [
      { id: "in_work", label: "Активные", value: snapshot.releases.filter((item) => item.release.release_status_id === "in_work").length },
      { id: "completed", label: "Завершено", value: snapshot.releases.filter((item) => item.release.release_status_id === "completed").length },
      { id: "frozen", label: "Заморожено", value: snapshot.releases.filter((item) => item.release.release_status_id === "frozen").length },
      { id: "canceled", label: "Отменено", value: snapshot.releases.filter((item) => item.release.release_status_id === "canceled").length },
      { id: "lost", label: "Утерянные", value: snapshot.releases.filter((item) => item.release.archival_state.includes("lost")).length }
    ];
    const problemBuckets = [
      { id: "missing_team", label: "Без полного состава", value: snapshot.releases.filter((item) => item.participants.length === 0).length },
      { id: "missing_post", label: "Без снимка поста", value: snapshot.releases.filter((item) => item.generated_posts.length === 0).length },
      { id: "missing_external", label: "Без внешнего источника", value: snapshot.releases.filter((item) => item.external.length === 0).length },
      { id: "archival_problem", label: "Архивные проблемы", value: snapshot.releases.filter((item) => item.release.archival_state !== "normal").length }
    ];
    return {
      status: releaseStatusCategoryEnabled ? statusBuckets : [],
      department: snapshot.statistics.byDepartment.map((item) => ({ id: item.label, ...item })),
      year: snapshot.statistics.byYear.map((item) => ({ id: item.label, ...item })),
      type: releaseTypeCategoryEnabled ? snapshot.statistics.byType.map((item) => ({ id: item.label, ...item })) : [],
      problem: problemBuckets
    };
  }, [releaseStatusCategoryEnabled, releaseTypeCategoryEnabled, snapshot]);

  useEffect(() => {
    if (!releaseStatusCategoryEnabled && bucketGroup === "status") {
      setBucketGroup("department");
      return;
    }
    if (!releaseTypeCategoryEnabled && bucketGroup === "type") {
      setBucketGroup(releaseStatusCategoryEnabled ? "status" : "department");
    }
  }, [bucketGroup, releaseStatusCategoryEnabled, releaseTypeCategoryEnabled]);

  useEffect(() => {
    const first = buckets[bucketGroup][0]?.id ?? "";
    setSelectedBucket((current) =>
      buckets[bucketGroup].some((item) => item.id === current) ? current : first
    );
  }, [bucketGroup, buckets]);

  const filteredReleases = useMemo(() => snapshot.releases.filter((item) => {
    if (!selectedBucket) return true;
    if (bucketGroup === "status") {
      if (!releaseStatusCategoryEnabled) return false;
      if (selectedBucket === "lost") return item.release.archival_state.includes("lost");
      return item.release.release_status_id === selectedBucket;
    }
    if (bucketGroup === "department") return item.release.department_ids.includes(selectedBucket) || item.release.primary_department_id === selectedBucket;
    if (bucketGroup === "year") return String(item.release.release_year ?? "Не указан") === selectedBucket;
    if (bucketGroup === "type") return releaseTypeCategoryEnabled && item.release.release_type_id === selectedBucket;
    if (bucketGroup === "problem") {
      if (selectedBucket === "missing_team") return item.participants.length === 0;
      if (selectedBucket === "missing_post") return item.generated_posts.length === 0;
      if (selectedBucket === "missing_external") return item.external.length === 0;
      if (selectedBucket === "archival_problem") return item.release.archival_state !== "normal";
    }
    return true;
  }), [bucketGroup, releaseStatusCategoryEnabled, releaseTypeCategoryEnabled, selectedBucket, snapshot.releases]);

  const selectedBucketMeta = buckets[bucketGroup].find((item) => item.id === selectedBucket) ?? buckets[bucketGroup][0] ?? null;
  const selectedReleaseActionCount = useMemo(
    () => filteredReleases.reduce((sum, item) => sum + (item.history?.length ?? 0), 0),
    [filteredReleases]
  );

  return (
    <>
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey="statistics:list">
      <Panel
        title="Статистика релизов"
        subtitle={
          releaseStatusCategoryEnabled && releaseTypeCategoryEnabled
            ? "Слева выбираются подборки по статусам, отделам, годам, типам и проблемным релизам."
            : releaseStatusCategoryEnabled
              ? "Слева выбираются подборки по статусам, отделам, годам и проблемным релизам."
              : releaseTypeCategoryEnabled
                ? "Слева выбираются подборки по отделам, годам, типам и проблемным релизам."
                : "Слева выбираются подборки по отделам, годам и проблемным релизам."
        }
      >
        <div className="section-stack">
          <div className="stat-grid">
            <StatCard label="Всего релизов" value={snapshot.statistics.totalReleases} />
            {releaseStatusCategoryEnabled ? <StatCard label="Активные" value={snapshot.statistics.inWork} /> : null}
            {releaseStatusCategoryEnabled ? <StatCard label="Завершено" value={snapshot.statistics.completed} /> : null}
            <StatCard label="Утерянные / архивные проблемы" value={snapshot.statistics.lost} />
            <StatCard label="Действий с базой" value={totalDatabaseActionCount} note={`${participantActionCount} по участникам • ${releaseActionCount} по релизам`} />
          </div>
          <div className="tabs">
            {([
              ["status", "По статусам"],
              ["department", "По отделам"],
              ["year", "По годам"],
              ["type", "По типам"],
              ["problem", "Проблемные"]
            ] as const)
              .filter(([id]) => releaseStatusCategoryEnabled || id !== "status")
              .filter(([id]) => releaseTypeCategoryEnabled || id !== "type")
              .map(([id, label]) => <button key={id} className={`tab ${bucketGroup === id ? "active" : ""}`} onClick={() => setBucketGroup(id)}>{label}</button>)}
          </div>
          <div className="list compact-list">
            {buckets[bucketGroup].length ? buckets[bucketGroup].map((item) => (
              <div key={item.id} className={`list-item ${selectedBucket === item.id ? "active" : ""}`} onClick={() => setSelectedBucket(item.id)}>
                <div className="card-header-row"><div className="card-header-main"><div>{item.label}</div></div><div className="chip-group"><Chip>{item.value}</Chip></div></div>
              </div>
            )) : <EmptyState title="Нет агрегатов" body="Этот блок заполнится, когда в наборе данных появятся релизы." />}
          </div>
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`statistics:results:${bucketGroup}:${selectedBucket}`}>
      <Panel title="Список релизов" subtitle="В центре открывается рабочий список релизов по выбранной подборке.">
        <div className="section-stack">
          {filteredReleases.length ? filteredReleases.map((item) => (
            <div key={item.release.id} className="list-item subdued">
              <div className="row spread">
                <div>
                  <strong>{getReleaseDisplayTitle(item.release)}</strong>
                  <div className="muted" title={[releaseStatusCategoryEnabled ? translateCode(item.release.release_status_id) : null, releaseTypeCategoryEnabled ? getLookupLabel(releaseTypeNameById, item.release.release_type_id, "Тип не указан") : null, getLookupLabel(departmentNameById, item.release.primary_department_id, "Отдел не указан")].filter(Boolean).join(" • ")}>
                    {[releaseStatusCategoryEnabled ? translateCode(item.release.release_status_id) : null, releaseTypeCategoryEnabled ? getLookupLabel(releaseTypeNameById, item.release.release_type_id, "Тип не указан") : null, getLookupLabel(departmentNameById, item.release.primary_department_id, "Отдел не указан")].filter(Boolean).join(" • ")}
                  </div>
                </div>
                <Button className="ghost" onClick={() => onOpenRelease(item.release.id)}>Открыть</Button>
              </div>
              <div className="muted">состав: {formatSimpleCount(getReleaseUniqueParticipantCount(item), "участник", "участников")} • внешние: {formatSimpleCount(item.external.length, "источник", "источников")} • посты: {formatSimpleCount(item.generated_posts.length, "снимок", "снимков")} • год: {item.release.release_year ?? "не указан"}</div>
            </div>
          )) : <EmptyState title="По выбранной подборке релизы не найдены" body="Смените группу слева или выберите другую подборку." />}
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`statistics:summary:${bucketGroup}:${selectedBucket}`}>
      <Panel title="Сводка по выборке" subtitle="Справа видно, какая подборка выбрана и что в нее попало.">
        {selectedBucketMeta ? (
          <div className="section-stack">
            <div className="detail-card">
              <h4>{selectedBucketMeta.label}</h4>
              <div className="muted">Найдено: {formatSimpleCount(selectedBucketMeta.value, "релиз", "релизов")}</div>
              <div className="muted">Текущая группа: {translateStatisticsGroup(bucketGroup)}</div>
              <div className="muted">Действий по этой подборке: {selectedReleaseActionCount}</div>
            </div>
            {bucketGroup === "department" ? <Button className="secondary" onClick={() => onOpenDepartment(selectedBucketMeta.id)}>Открыть отдел</Button> : null}
            <div className="detail-card">
              <h4>Как читать экран</h4>
              <div className="muted">Слева выбирается подборка, в центре открывается список релизов, а справа всегда видно, какая именно выборка сейчас открыта и сколько записей в нее вошло.</div>
            </div>
          </div>
        ) : <EmptyState title="Подборка не выбрана" body="Выберите группу и конкретную подборку слева." />}
      </Panel>
      </ScrollRegion>
    </div>
    </>
  );
}

function SystemScreen({
  snapshot,
  onRefresh,
  syncStatus,
  bootstrap,
  actorName,
  onDirtyChange,
  onRestoreLocalDraft,
  showAdvancedMode,
  onShowAppNotice
}: {
  snapshot: WorkspaceSnapshot;
  onRefresh: (force?: boolean) => Promise<void>;
  syncStatus: SyncStatus | null;
  bootstrap: AppBootstrapState;
  actorName: string;
  onDirtyChange: (dirty: boolean) => void;
  onRestoreLocalDraft: (draft: LocalUnsavedDraftFile) => void;
  showAdvancedMode: boolean;
  onShowAppNotice: (notice: { tone: "success" | "warning" | "danger"; text: string } | null) => void;
}) {
  const [systemTab, setSystemTab] = useState<"health" | "conflicts" | "recovery" | "git">("health");
  const [gitPath, setGitPath] = useState(snapshot.git.repoPath ?? "");
  const [commitMessage, setCommitMessage] = useState(`снимок данных: версия ${snapshot.manifest.dataset_revision}`);
  const [gitOutput, setGitOutput] = useState("");
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [selectedSystemItemId, setSelectedSystemItemId] = useState("");
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [lastManualBackup, setLastManualBackup] = useState<ManualBackupResult | null>(null);
  const [manualBackupMessage, setManualBackupMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [selectedLocalDraft, setSelectedLocalDraft] = useState<LocalUnsavedDraftFile | null>(null);

  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange]);

  async function refreshDiagnostics() {
    try {
      const next = await window.fronda.getSystemDiagnostics();
      setDiagnostics(next);
    } catch {
      setDiagnostics(null);
    }
  }

  useEffect(() => {
    startTransition(() => {
      void refreshDiagnostics();
    });
  }, [snapshot.manifest.dataset_revision]);

  async function createManualBackup() {
    setIsCreatingBackup(true);
    setManualBackupMessage({ tone: "warning", text: "Создаем ручную резервную копию..." });
    try {
      const result = await window.fronda.createManualBackup(actorName);
      setLastManualBackup(result);
      setManualBackupMessage({
        tone: "success",
        text: `Резервная копия создана: ${result.label}.`
      });
      await refreshDiagnostics();
    } catch (error) {
      setManualBackupMessage({
        tone: "warning",
        text: error instanceof Error ? error.message : "Не удалось создать резервную копию."
      });
    } finally {
      setIsCreatingBackup(false);
    }
  }

  async function exportRecoveryBundle() {
    setManualBackupMessage({ tone: "warning", text: "Собираем единый экспорт FRONDA..." });
    try {
      const output = await window.fronda.exportImportBundle(actorName);
      if (!output) {
        setManualBackupMessage(null);
        return;
      }
      onShowAppNotice({
        tone: "success",
        text: `👍 Акро благодарит тебя за Экспорт! Файл сохранен: ${getShortPathLabel(output)}.`
      });
      setManualBackupMessage({
        tone: "success",
        text: `Единый экспорт сохранен: ${getShortPathLabel(output)}. Этот файл можно импортировать в FRONDA как полный снимок таблиц.`
      });
    } catch (error) {
      setManualBackupMessage({
        tone: "warning",
        text: error instanceof Error ? error.message : "Не удалось сохранить единый экспорт FRONDA."
      });
    }
  }

  async function restoreManualBackup() {
    if (!selectedSystemItem || (selectedSystemItem as { group?: string }).group !== "backups") {
      return;
    }
    const confirmed = window.confirm("Восстановить рабочую папку из выбранной резервной копии?\n\nТекущие файлы в общей папке будут заменены содержимым этого снимка.");
    if (!confirmed) {
      return;
    }
    setManualBackupMessage({ tone: "warning", text: "Восстанавливаем рабочую папку из выбранной копии..." });
    try {
      await window.fronda.restoreManualBackup((selectedSystemItem as { path: string }).path, actorName);
      setManualBackupMessage({ tone: "success", text: "Рабочая папка восстановлена из выбранной резервной копии." });
      await onRefresh(true);
      await refreshDiagnostics();
    } catch (error) {
      setManualBackupMessage({
        tone: "warning",
        text: error instanceof Error ? error.message : "Не удалось восстановить рабочую папку из резервной копии."
      });
    }
  }

  async function deleteLocalDraft() {
    const draftToDelete =
      selectedLocalDraft
      ?? (
        selectedSystemItem && (selectedSystemItem as { group?: string }).group === "local_drafts"
          ? {
              id: selectedSystemItem.id,
              path: "path" in selectedSystemItem ? selectedSystemItem.path : "",
              label: ("title" in selectedSystemItem ? selectedSystemItem.title : selectedSystemItem.label) || selectedSystemItem.id
            }
          : null
      );

    if (!draftToDelete || !draftToDelete.path) {
      setManualBackupMessage({
        tone: "warning",
        text: "Сначала выберите локальный черновик, который нужно удалить."
      });
      return;
    }
    const confirmed = window.confirm("Удалить выбранный локальный черновик?\n\nЭто удалит только локальную копию правок на этом компьютере.");
    if (!confirmed) {
      return;
    }
    const previousDiagnostics = diagnostics;
    const nextSelectionId =
      diagnostics?.local_drafts.find((item) => item.path !== draftToDelete.path)?.id
      ?? diagnostics?.backup_snapshots[0]?.id
      ?? diagnostics?.pending_transactions[0]?.id
      ?? diagnostics?.failed_transactions[0]?.id
      ?? diagnostics?.active_locks[0]?.id
      ?? "";

    setDiagnostics((current) => current ? {
      ...current,
      local_drafts: current.local_drafts.filter((item) => item.path !== draftToDelete.path)
    } : current);
    setSelectedLocalDraft(null);
    setSelectedSystemItemId(nextSelectionId);
    setManualBackupMessage({ tone: "warning", text: "Удаляем локальный черновик..." });

    try {
      await window.fronda.deleteLocalUnsavedDraft(draftToDelete.path);
      setManualBackupMessage({ tone: "success", text: "Локальный черновик удален." });
      await refreshDiagnostics();
    } catch (error) {
      setDiagnostics(previousDiagnostics);
      setSelectedSystemItemId(draftToDelete.id);
      setManualBackupMessage({
        tone: "warning",
        text: error instanceof Error ? error.message : "Не удалось удалить локальный черновик."
      });
    }
  }

  function restoreSelectedLocalDraft() {
    if (!selectedLocalDraft) {
      setManualBackupMessage({
        tone: "warning",
        text: "Сначала выберите локальный черновик и дождитесь его загрузки."
      });
      return;
    }
    setManualBackupMessage({
      tone: "success",
      text: `Открываем локальный черновик: ${selectedLocalDraft.label}.`
    });
    onRestoreLocalDraft(selectedLocalDraft);
  }

  const conflictItems = useMemo(() => {
    const items: Array<{ id: string; title: string; detail: string; tone?: "warning" | "danger" | "success" | "accent" }> = [];
    if (syncStatus?.issues.length) {
      items.push({ id: "sync_issues", title: "Проблемы синхронизации", detail: syncStatus.issues.join(" • "), tone: "warning" });
    }
    if (snapshot.manifest.state !== "clean") {
      items.push({ id: "dataset_state", title: "Состояние данных требует внимания", detail: translateCode(snapshot.manifest.state), tone: "danger" });
    }
    const reviewImports = snapshot.imports.filter((item) => item.queue_status === "review");
    if (reviewImports.length) {
      items.push({ id: "review_imports", title: "Импорт требует ручной проверки", detail: `${reviewImports.length} файлов ждут разбор`, tone: "warning" });
    }
    if (diagnostics?.active_locks.length) {
      items.push({
        id: "locks",
        title: "Активные файлы блокировки",
        detail: formatSimpleCount(diagnostics.active_locks.length, "активный файл блокировки", "активных файлов блокировки"),
        tone: "accent"
      });
    }
    if (diagnostics?.pending_transactions.length) {
      items.push({ id: "pending_tx", title: "Незавершенные операции записи", detail: `${diagnostics.pending_transactions.length} операций ждут завершения`, tone: "danger" });
    }
    return items;
  }, [diagnostics, snapshot.imports, snapshot.manifest.state, syncStatus]);

  const recoveryItems = useMemo(() => [
    { id: "backups", title: "Резервные копии", value: diagnostics?.backup_snapshots.length ?? 0 },
    { id: "local_drafts", title: "Локальные черновики", value: diagnostics?.local_drafts.length ?? 0 },
    { id: "pending", title: "Ожидающие операции", value: diagnostics?.pending_transactions.length ?? 0 },
    { id: "failed", title: "Ошибки записи", value: diagnostics?.failed_transactions.length ?? 0 },
    { id: "locks", title: "Файлы блокировки", value: diagnostics?.active_locks.length ?? 0 }
  ], [diagnostics]);

  const healthItems = useMemo(() => [
    { id: "dataset_state", title: "Состояние данных", detail: `Состояние: ${translateCode(snapshot.manifest.state)}${showAdvancedMode ? ` • версия ${snapshot.manifest.dataset_revision}` : ""}`, tone: snapshot.manifest.state === "clean" ? "success" : "danger" as const },
    ...(showAdvancedMode ? [{ id: "compatibility", title: "Совместимость", detail: `Формат данных: ${snapshot.manifest.schema_version} • минимальная версия приложения: ${snapshot.manifest.app_min_version}`, tone: "accent" as const }] : []),
    { id: "workspace", title: "Рабочая папка", detail: bootstrap.workspace?.sharedDatasetPath ? getShortPathLabel(bootstrap.workspace.sharedDatasetPath) : "не подключена", tone: "accent" as const },
    { id: "sync", title: "Статус синхронизации", detail: syncStatus ? `${shortSyncLabel(syncStatus)}: ${syncStatus.message}` : "нет данных синхронизации", tone: statusTone(syncStatus ?? { mode: "RO_OFFLINE", message: "", issues: [] }) }
  ], [bootstrap.workspace?.sharedDatasetPath, showAdvancedMode, snapshot.manifest, syncStatus]);

  const recoveryDetails = useMemo(() => diagnostics
    ? [
        ...diagnostics.backup_snapshots.map((item) => ({ ...item, group: "backups" })),
        ...diagnostics.local_drafts.map((item) => ({ ...item, group: "local_drafts", updated_at: item.saved_at, tone: "warning" as const })),
        ...diagnostics.pending_transactions.map((item) => ({ ...item, group: "pending" })),
        ...diagnostics.failed_transactions.map((item) => ({ ...item, group: "failed" })),
        ...diagnostics.active_locks.map((item) => ({ ...item, group: "locks" }))
      ]
    : [], [diagnostics]);

  const gitItems = useMemo(() => [
    { id: "git_available", title: "Доступность Git", detail: snapshot.git.available ? "Локальный Git найден" : "Git не найден на этой машине", tone: snapshot.git.available ? "success" as const : "warning" as const },
    { id: "git_repo", title: "Подключенный репозиторий", detail: snapshot.git.repoPath || "репозиторий не настроен", tone: snapshot.git.configured ? "accent" as const : "warning" as const },
    { id: "git_remote", title: "Удаленный репозиторий", detail: snapshot.git.remoteOrigin || "адрес репозитория не задан", tone: snapshot.git.remoteOrigin ? "success" as const : "warning" as const },
    { id: "git_state", title: "Состояние локальной копии", detail: snapshot.git.clean === undefined ? "статус не получен" : snapshot.git.clean ? "изменений нет" : "есть изменения для архивного снимка", tone: snapshot.git.clean ? "success" as const : "warning" as const }
  ], [snapshot.git]);

  const currentItems = systemTab === "health"
    ? healthItems
    : systemTab === "conflicts"
      ? conflictItems
      : systemTab === "recovery"
        ? recoveryDetails
        : gitItems;

  useEffect(() => {
    setSelectedSystemItemId(currentItems[0]?.id ?? "");
  }, [systemTab, currentItems.length]);

  const selectedSystemItem = currentItems.find((item) => item.id === selectedSystemItemId) ?? currentItems[0] ?? null;
  const selectedLocalDraftComparison = useMemo(
    () => selectedLocalDraft ? buildLocalDraftComparisonSummary(selectedLocalDraft, snapshot) : null,
    [selectedLocalDraft, snapshot]
  );

  useEffect(() => {
    if (!selectedSystemItem || (selectedSystemItem as { group?: string }).group !== "local_drafts" || !("path" in selectedSystemItem) || !selectedSystemItem.path) {
      setSelectedLocalDraft(null);
      return;
    }
    let active = true;
    void window.fronda.getLocalUnsavedDraft(selectedSystemItem.path)
      .then((draft) => {
        if (active) {
          setSelectedLocalDraft(draft);
        }
      })
      .catch(() => {
        if (active) {
          setSelectedLocalDraft(null);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedSystemItem]);

  async function pickGitRepo() {
    const picked = await window.fronda.pickGitRepo();
    if (picked) setGitPath(picked);
  }

  async function saveGitRepo() {
    await window.fronda.configureGitRepo(gitPath);
    await onRefresh(true);
  }

  async function exportGit(mode: "config" | "full") {
    const output = await window.fronda.exportGitSnapshot(mode);
    setGitOutput(`Экспортировано в ${output}`);
    await onRefresh(true);
  }

  async function runGitCommit(push: boolean) {
    const result = await window.fronda.gitCommit(commitMessage, push);
    setGitOutput(result.output);
    await onRefresh(true);
  }

  return (
    <div className="page-body workspace-grid workspace-scroll-grid">
      <ScrollRegion scrollKey={`system:navigation:${systemTab}`}>
      <Panel title="Система" subtitle="Слева находятся только состояние набора, конфликты, восстановление и архивный слой Git.">
        <div className="tabs">
          {([
            ["health", "Состояние"],
          ["conflicts", "Конфликты"],
          ["recovery", "Восстановление"],
            ["git", "Архив Git"]
          ] as const).map(([tab, label]) => <button key={tab} className={`tab ${systemTab === tab ? "active" : ""}`} onClick={() => setSystemTab(tab)}>{label}</button>)}
        </div>
        <div className="detail-card">
          <h4>Краткое состояние</h4>
          <div className="summary-key-list">
            <div className="compact-row"><strong>Данные</strong><span className="muted">{translateCode(snapshot.manifest.state)}</span></div>
            <div className="compact-row"><strong>Локальная копия</strong><span className="muted">{syncStatus ? shortSyncLabel(syncStatus) : "—"}</span></div>
            <div className="compact-row"><strong>Импорт на проверке</strong><span className="muted">{snapshot.imports.filter((item) => item.queue_status === "review").length}</span></div>
            <div className="compact-row"><strong>Файлы блокировки</strong><span className="muted">{diagnostics?.active_locks.length ?? 0}</span></div>
          </div>
        </div>
        {syncStatus ? <div className={`notice-banner ${bannerClass(syncStatus)}`}>{syncStatus.message}</div> : null}
        {systemTab === "health" ? (
          <div className="detail-card">
            <h4>Основные действия</h4>
            <div className="muted">Локальная копия работает поверх общей папки. Перед записью приложение еще раз проверяет состояние набора и создает резервную копию.</div>
            <div className="dashboard-actions primary-cluster">
              <Button className="primary" onClick={() => void onRefresh(true)}>Обновить данные</Button>
              <Button className="secondary" onClick={() => void window.fronda.openSettingsFolder()}>Открыть настройки</Button>
              <ActionMenu>
                <ActionMenuItem onClick={() => startTransition(() => { void refreshDiagnostics(); })}>Обновить диагностику</ActionMenuItem>
                <ActionMenuItem onClick={() => void createManualBackup()}>Создать резервную копию</ActionMenuItem>
              </ActionMenu>
            </div>
          </div>
        ) : null}
        {systemTab === "conflicts" ? (
          <div className="detail-card">
            <h4>Что сейчас важно</h4>
            <div className="summary-key-list">
              <div className="compact-row"><span className="muted">Активные сигналы</span><Chip tone={conflictItems.length ? "warning" : "success"}>{conflictItems.length}</Chip></div>
              <div className="compact-row"><span className="muted">Импорт на проверке</span><Chip tone={snapshot.imports.filter((item) => item.queue_status === "review").length ? "warning" : "success"}>{snapshot.imports.filter((item) => item.queue_status === "review").length}</Chip></div>
              <div className="compact-row"><span className="muted">Файлы блокировки</span><Chip tone={diagnostics?.active_locks.length ? "warning" : "success"}>{diagnostics?.active_locks.length ?? 0}</Chip></div>
              <div className="compact-row"><span className="muted">Незавершенные записи</span><Chip tone={diagnostics?.pending_transactions.length ? "danger" : "success"}>{diagnostics?.pending_transactions.length ?? 0}</Chip></div>
            </div>
            <div className="muted">Сюда попадают устаревшая локальная копия, пакеты импорта на ручной проверке, файлы блокировки и незавершенные операции записи.</div>
          </div>
        ) : null}
        {systemTab === "recovery" ? (
          <div className="detail-card">
            <h4>Как работать с восстановлением</h4>
            <div className="summary-key-list">
              {recoveryItems.map((item) => (
                <div key={item.id} className="compact-row">
                  <span className="muted">{item.title}</span>
                  <Chip tone={item.value ? "warning" : "success"}>{item.value}</Chip>
                </div>
              ))}
            </div>
            <div className="muted">Если запись не дошла до общей папки, сначала проверьте локальный черновик. Полное восстановление набора лучше делать через резервную копию, а не поверх рабочей папки.</div>
            <div className="dashboard-actions primary-cluster" style={{ marginTop: 16 }}>
              <Button className="primary" onClick={() => void createManualBackup()} disabled={isCreatingBackup}>
                {isCreatingBackup ? "Создаем копию..." : "Создать резервную копию"}
              </Button>
              <Button className="secondary" onClick={() => void exportRecoveryBundle()} disabled={isCreatingBackup}>
                Экспортировать всё
              </Button>
              <Button className="secondary" onClick={() => void restoreManualBackup()} disabled={(selectedSystemItem as { group?: string } | null)?.group !== "backups"}>
                Восстановить
              </Button>
              <Button className="secondary" onClick={restoreSelectedLocalDraft} disabled={(selectedSystemItem as { group?: string } | null)?.group !== "local_drafts" || !selectedLocalDraft}>
                Восстановить в карточку
              </Button>
              <Button
                className="secondary"
                onClick={() => diagnostics?.shared_paths.backups ? void window.fronda.openResource(diagnostics.shared_paths.backups) : undefined}
                disabled={!diagnostics?.shared_paths.backups}
              >
                Открыть папку копий
              </Button>
              <ActionMenu label="Еще">
                <ActionMenuItem onClick={() => diagnostics?.local_paths.drafts ? void window.fronda.openResource(diagnostics.local_paths.drafts) : undefined} disabled={!diagnostics?.local_paths.drafts}>
                  Открыть папку черновиков
                </ActionMenuItem>
                <ActionMenuItem onClick={() => selectedLocalDraft ? void window.fronda.openResource(selectedLocalDraft.path) : undefined} disabled={!selectedLocalDraft}>
                  Открыть черновик
                </ActionMenuItem>
                <ActionMenuItem className="danger" onClick={() => void deleteLocalDraft()} disabled={(selectedSystemItem as { group?: string } | null)?.group !== "local_drafts"}>
                  Удалить локальную копию
                </ActionMenuItem>
              </ActionMenu>
            </div>
            {manualBackupMessage ? <div className={`notice-banner ${manualBackupMessage.tone}`} style={{ marginTop: 16 }}>{manualBackupMessage.text}</div> : null}
            {lastManualBackup ? (
              <div className="summary-key-list" style={{ marginTop: 16 }}>
                <div className="compact-row"><strong>Последняя ручная копия</strong><span className="muted">{formatDate(lastManualBackup.created_at)}</span></div>
                <div className="mono" title={lastManualBackup.path}>{lastManualBackup.path}</div>
              </div>
            ) : null}
            {selectedLocalDraft ? (
              <div className="summary-key-list" style={{ marginTop: 16 }}>
                <div className="compact-row"><strong>Выбранный черновик</strong><span className="muted">{selectedLocalDraft.label}</span></div>
                <div className="compact-row"><strong>Сохранен локально</strong><span className="muted">{selectedLocalDraft.saved_at ? formatDate(selectedLocalDraft.saved_at) : "дата неизвестна"}</span></div>
              </div>
            ) : null}
          </div>
        ) : null}
        {systemTab === "git" ? (
          <div className="section-stack">
            <details className="detail-disclosure">
              <summary className="disclosure-summary">
                <strong>О роли Git</strong>
                <span className="muted">Дополнительный архивный слой поверх общей папки.</span>
              </summary>
              <div className="detail-disclosure-body">
                <div className="muted">Git не является основным источником данных. Он нужен только для снимков, истории и резервного восстановления.</div>
              </div>
            </details>
            <Field label="Путь к локальному Git-репозиторию">
              <div className="row" style={{ flexWrap: "wrap" }}>
                <input className="text-input" value={gitPath} onChange={(event) => setGitPath(event.target.value)} />
                <Button className="secondary" onClick={() => void pickGitRepo()}>Обзор</Button>
                <Button className="primary" onClick={() => void saveGitRepo()}>Подключить</Button>
              </div>
            </Field>
            <div className="chip-group">
              <Chip tone={snapshot.git.available ? "success" : "warning"}>{snapshot.git.available ? "Git доступен" : "Git не найден"}</Chip>
              <Chip tone={snapshot.git.configured ? "accent" : undefined}>{snapshot.git.configured ? "репозиторий подключен" : "репозиторий не настроен"}</Chip>
              {snapshot.git.branch ? <Chip>{snapshot.git.branch}</Chip> : null}
            </div>
            <div className="dashboard-actions">
              <Button className="secondary" onClick={() => void exportGit("config")}>Снимок настроек</Button>
              <Button className="secondary" onClick={() => void exportGit("full")}>Полный снимок</Button>
            </div>
            <Field label="Сообщение коммита">
              <input className="text-input" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
            </Field>
            <div className="dashboard-actions primary-cluster">
              <Button className="secondary" onClick={() => void runGitCommit(false)}>Сохранить коммит</Button>
              <Button className="primary" onClick={() => void runGitCommit(true)}>Сохранить и отправить</Button>
            </div>
            {gitOutput ? (
              <details className="detail-disclosure">
                <summary className="disclosure-summary">
                  <strong>Вывод Git</strong>
                  <span className="muted">Последний ответ локального Git.</span>
                </summary>
                <div className="detail-disclosure-body">
                  <textarea className="text-area json-box" value={gitOutput} readOnly />
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {showAdvancedMode ? (
          <details className="detail-disclosure">
            <summary className="disclosure-summary">
              <strong>Служебные пути</strong>
              <span className="muted">Показываются только в расширенном режиме.</span>
            </summary>
            <div className="detail-disclosure-body section-stack compact">
              <div className="mono">{bootstrap.workspace?.sharedDatasetPath}</div>
              <div className="mono" title={bootstrap.settingsPath}>{bootstrap.settingsPath}</div>
            </div>
          </details>
        ) : null}
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`system:signals:${systemTab}`}>
      <Panel title="Главные сигналы" subtitle="В центре собраны только активные сигналы, очереди и проблемные записи.">
          <div className="list compact-list">
            {currentItems.length ? currentItems.map((item) => (
              <div key={item.id} className={`list-item subdued ${selectedSystemItemId === item.id ? "active" : ""}`} onClick={() => setSelectedSystemItemId(item.id)}>
              <div className="card-header-row"><div className="card-header-main"><strong>{("title" in item ? item.title : item.label) || item.id}</strong></div>{"tone" in item && item.tone ? <div className="chip-group"><Chip tone={item.tone as "warning" | "success" | "accent" | "danger"}>{translateTone(item.tone as "warning" | "success" | "accent" | "danger")}</Chip></div> : null}</div>
              <div className="muted">{("detail" in item ? item.detail : item.path) || ""}</div>
            </div>
          )) : <EmptyState title="Сигналов тревоги нет" body="На активной вкладке пока нет элементов. Это тоже полезное состояние: сейчас система работает спокойно." />}
        </div>
      </Panel>
      </ScrollRegion>

      <ScrollRegion scrollKey={`system:details:${systemTab}:${selectedSystemItemId || "empty"}`}>
      <Panel title="Детали сигнала" subtitle="Справа открываются пояснение, рекомендуемое действие и служебные данные только по выбранному сигналу.">
        {selectedSystemItem ? (
          <div className="section-stack">
            <div className="detail-card">
              <div className="card-header-row">
                <div className="card-header-main">
                  <h4>{("title" in selectedSystemItem ? selectedSystemItem.title : selectedSystemItem.label) || selectedSystemItem.id}</h4>
                </div>
                {"tone" in selectedSystemItem && selectedSystemItem.tone ? <div className="chip-group"><Chip tone={selectedSystemItem.tone as "warning" | "success" | "accent" | "danger"}>{translateTone(selectedSystemItem.tone as "warning" | "success" | "accent" | "danger")}</Chip></div> : null}
              </div>
              {"path" in selectedSystemItem && selectedSystemItem.path ? <div className="mono" title={selectedSystemItem.path}>{selectedSystemItem.path}</div> : null}
              {"detail" in selectedSystemItem && selectedSystemItem.detail ? <div className="muted" style={{ marginTop: 10 }}>{selectedSystemItem.detail}</div> : null}
              {"updated_at" in selectedSystemItem ? <div className="muted" style={{ marginTop: 10 }}>Обновлено: {selectedSystemItem.updated_at ? formatDate(selectedSystemItem.updated_at) : "дата неизвестна"}</div> : null}
            </div>
            {(selectedSystemItem as { group?: string } | null)?.group === "local_drafts" && selectedLocalDraft ? (
              <>
                <div className="detail-card">
                  <h4>Сравнение с текущими данными</h4>
                  <div className="summary-key-list">
                    <div className="compact-row"><strong>Тип записи</strong><span className="muted">{selectedLocalDraftComparison?.domainLabel ?? selectedLocalDraft.domain}</span></div>
                    <div className="compact-row"><strong>Что не сохранилось</strong><span className="muted">{selectedLocalDraft.reason || "Причина не указана"}</span></div>
                    <div className="compact-row"><strong>Локально сохранено</strong><span className="muted">{selectedLocalDraft.saved_at ? formatDate(selectedLocalDraft.saved_at) : "дата неизвестна"}</span></div>
                    <div className="compact-row"><strong>Текущая запись в наборе</strong><span className="muted">{selectedLocalDraftComparison?.currentLabel ?? "Запись в общей папке не найдена или не определяется"}</span></div>
                    <div className="compact-row"><strong>Состояние сравнения</strong><span className="muted">{selectedLocalDraftComparison?.statusText ?? "Нужно открыть и проверить вручную"}</span></div>
                  </div>
                  {selectedLocalDraft.shared_path ? <div className="mono" style={{ marginTop: 12 }} title={selectedLocalDraft.shared_path}>{selectedLocalDraft.shared_path}</div> : null}
                  <div className="dashboard-actions primary-cluster" style={{ marginTop: 16 }}>
                    <Button className="secondary" onClick={() => void window.fronda.openResource(selectedLocalDraft.path)}>Открыть черновик</Button>
                    <Button className="primary" onClick={restoreSelectedLocalDraft}>Восстановить в карточку</Button>
                    <Button className="danger" onClick={() => void deleteLocalDraft()}>Удалить локальную копию</Button>
                  </div>
                </div>
                <details className="detail-disclosure">
                  <summary className="disclosure-summary">
                    <strong>Содержимое черновика</strong>
                    <span className="muted">Можно открыть файл отдельно, сравнить глазами и потом восстановить в карточку.</span>
                  </summary>
                  <div className="detail-disclosure-body">
                    <textarea className="text-area json-box" value={toPrettyJson(selectedLocalDraft.payload)} readOnly />
                  </div>
                </details>
              </>
            ) : null}
            <div className="detail-card">
              <h4>Что сделать</h4>
              <div className="muted">{buildSystemActionHint(systemTab, selectedSystemItemId)}</div>
            </div>
            {diagnostics ? (
              <details className="detail-disclosure" open={showAdvancedMode}>
                <summary className="disclosure-summary">
                  <strong>Служебные папки</strong>
                  <span className="muted">Резервные копии, блокировки и операции записи.</span>
                </summary>
                <div className="detail-disclosure-body section-stack compact">
                  <div className="detail-card">
                    <h4>Резервные копии</h4>
                    <div className="mono" title={diagnostics.shared_paths.backups}>{diagnostics.shared_paths.backups}</div>
                  </div>
                  <div className="detail-card">
                    <h4>Файлы блокировки</h4>
                    <div className="mono" title={diagnostics.shared_paths.locks}>{diagnostics.shared_paths.locks}</div>
                  </div>
                  <div className="detail-card">
                    <h4>Операции записи</h4>
                    <div className="mono" title={diagnostics.shared_paths.transactions}>{diagnostics.shared_paths.transactions}</div>
                  </div>
                  <div className="detail-card">
                    <h4>Локальные черновики</h4>
                    <div className="mono" title={diagnostics.local_paths.drafts}>{diagnostics.local_paths.drafts}</div>
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        ) : <EmptyState title="Диагностика еще не загружена" body="После чтения рабочей папки здесь появятся резервные копии, файлы блокировки и служебные операции записи." />}
      </Panel>
      </ScrollRegion>
    </div>
  );
}

function getDirectoryEditorMeta(key: string): { title: string; subtitle: string } {
  const map: Record<string, { title: string; subtitle: string }> = {
    departments: { title: "Отделы", subtitle: "Производственные направления и секции студии" },
    structure_positions: { title: "Должности структуры", subtitle: "Управленческие и структурные позиции команды" },
    participant_roles: { title: "Роли участников", subtitle: "Что человек умеет и делает в релизах" },
    skills: { title: "Навыки", subtitle: "Рабочие умения, которые дополняют основные роли участника" },
    specializations: { title: "Специализации", subtitle: "Узкие сильные стороны внутри роли или навыка" },
    participant_statuses: { title: "Статусы участников", subtitle: "Активность, резерв, уход и блокировки" },
    release_statuses: { title: "Статусы релизов", subtitle: "Отключаемая категория для стадий жизненного цикла релиза" },
    release_types: { title: "Типы релиза", subtitle: "Отключаемая категория для типа релиза в карточке, фильтрах и посте" },
    note_types: { title: "Типы заметок", subtitle: "Классификация рабочих заметок по участникам" },
    disciplinary_types: { title: "Типы дисциплины", subtitle: "Замечания, предупреждения и блокировки" },
    reward_types: { title: "Типы поощрений", subtitle: "Награды, положительные отметки и приоритеты" },
    external_source_types: { title: "Типы источников субтитров", subtitle: "Группы субтитров, партнеры и внешние переводчики" },
    platforms: { title: "Площадки", subtitle: "Платформы и ссылки релизов" },
    genres: { title: "Жанры", subtitle: "Жанровые классификаторы релизов" },
    tags: { title: "Теги", subtitle: "Тематические и редакторские теги" }
  };
  return map[key] ?? { title: key, subtitle: "Рабочий справочник" };
}

function getDirectoryBoundaryDescription(editorKey: string): string | null {
  const map: Record<string, string> = {
    departments: "Здесь живут только направления и секции студии: Аниме, Дорамы, Фильмы, Сериалы, Онгоинги, Книги, Медиа. Функции вроде «переводчик» и «звукорежиссер» сюда не попадают.",
    structure_positions: "Здесь живут только управленческие и структурные позиции: Админ, глава направления, куратор, учитель. Это не навыки и не рабочие роли участника.",
    participant_roles: "Здесь живут только производственные роли участника: актер озвучивания, переводчик, звукорежиссер, художник, вокалист, техническая поддержка. Направления и кураторские позиции сюда не попадают."
  };
  return map[editorKey] ?? null;
}

function buildDirectoryCrossAudit(snapshot: WorkspaceSnapshot): Array<{ name: string; groups: string[] }> {
  const buckets = new Map<string, { name: string; groups: Set<string> }>();
  const register = (group: string, value?: string | null) => {
    const name = normalizeSingleLineText(value);
    const key = normalizeLookupKey(name);
    if (!name || !key) return;
    const existing = buckets.get(key);
    if (existing) {
      existing.groups.add(group);
      return;
    }
    buckets.set(key, { name, groups: new Set([group]) });
  };

  snapshot.departments.forEach((item) => register("Отделы", item.name));
  snapshot.structurePositions.forEach((item) => register("Должности структуры", item.name));
  (snapshot.directories.participant_roles ?? []).forEach((item) => register("Роли участников", item.name));

  return Array.from(buckets.values())
    .filter((item) => item.groups.size > 1)
    .map((item) => ({ name: item.name, groups: Array.from(item.groups).sort() }))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function findCrossEntityConflict(
  snapshot: WorkspaceSnapshot,
  editorKey: string,
  recordName: string,
  currentRecordId?: string
): { label: string; group: string } | null {
  const normalized = normalizeLookupKey(recordName);
  if (!normalized) return null;

  const comparableGroups: Record<string, Array<{ group: string; items: Array<{ id: string; name: string }> }>> = {
    departments: [
      { group: "Роли участников", items: (snapshot.directories.participant_roles ?? []).map((item) => ({ id: item.id, name: item.name })) },
      { group: "Должности структуры", items: snapshot.structurePositions.map((item) => ({ id: item.id, name: item.name })) }
    ],
    participant_roles: [
      { group: "Отделы", items: snapshot.departments.map((item) => ({ id: item.id, name: item.name })) },
      { group: "Должности структуры", items: snapshot.structurePositions.map((item) => ({ id: item.id, name: item.name })) }
    ],
    structure_positions: [
      { group: "Отделы", items: snapshot.departments.map((item) => ({ id: item.id, name: item.name })) },
      { group: "Роли участников", items: (snapshot.directories.participant_roles ?? []).map((item) => ({ id: item.id, name: item.name })) }
    ]
  };

  const groups = comparableGroups[editorKey] ?? [];
  for (const group of groups) {
    const match = group.items.find((item) => item.id !== currentRecordId && normalizeLookupKey(item.name) === normalized);
    if (match) {
      return { label: match.name, group: group.group };
    }
  }

  return null;
}

function getDirectoryComparableName(
  record: DirectoryRecord | DepartmentDirectoryItem | StructurePosition | ExternalSource | PostTemplate,
  editorKey: string
): string {
  if (editorKey === "departments") {
    return (record as DepartmentDirectoryItem).name;
  }
  if (editorKey === "structure_positions") {
    return (record as StructurePosition).name;
  }
  if (editorKey === "__external__") {
    return (record as ExternalSource).name;
  }
  if (editorKey === "__templates__") {
    return (record as PostTemplate).name;
  }
  return (record as DirectoryRecord).name;
}

function buildDirectoryUsageSummary(snapshot: WorkspaceSnapshot, editorKey: string, recordId: string): { total: number; lines: string[] } {
  const lines: string[] = [];
  let total = 0;
  const add = (label: string, count: number) => {
    if (!count) return;
    total += count;
    lines.push(`${label}: ${count}`);
  };

  switch (editorKey) {
    case "departments":
      add("участники", snapshot.participants.flatMap((item) => item.org.department_assignments).filter((item) => item.department_id === recordId).length);
      add("релизы", snapshot.releases.filter((item) => item.release.primary_department_id === recordId || item.release.department_ids.includes(recordId)).length);
      add("должности", snapshot.structurePositions.filter((item) => item.department_id === recordId).length);
      break;
    case "structure_positions":
      add("назначения", snapshot.assignments.filter((item) => item.position_id === recordId).length);
      add("замещения", snapshot.substitutions.filter((item) => item.source_position_id === recordId || item.substitute_position_id === recordId).length);
      add("временные назначения", snapshot.temporaryAssignments.filter((item) => item.position_id === recordId).length);
      break;
    case "participant_roles":
      add("роли участников", snapshot.participants.flatMap((item) => item.org.role_assignments).filter((item) => item.role_id === recordId).length);
      add("роли в релизах", snapshot.releases.flatMap((item) => item.participants).filter((item) => item.role_id === recordId).length);
      break;
    case "skills":
      add("карточки участников", snapshot.participants.flatMap((item) => item.org.skill_entries).filter((item) => item.skill_id === recordId).length);
      break;
    case "specializations":
      add("карточки участников", snapshot.participants.flatMap((item) => item.org.specialization_entries).filter((item) => item.specialization_id === recordId).length);
      break;
    case "participant_statuses":
      add("участники", snapshot.participants.filter((item) => item.profile.participant_status_id === recordId).length);
      break;
    case "release_statuses":
      add("релизы", snapshot.releases.filter((item) => item.release.release_status_id === recordId).length);
      break;
    case "release_types":
      add("релизы", snapshot.releases.filter((item) => item.release.release_type_id === recordId).length);
      break;
    case "note_types":
      add("заметки", snapshot.participants.flatMap((item) => item.notes).filter((item) => item.note_type_id === recordId).length);
      break;
    case "disciplinary_types":
      add("дисциплинарные записи", snapshot.participants.flatMap((item) => item.discipline).filter((item) => item.disciplinary_type_id === recordId).length);
      break;
    case "reward_types":
      add("поощрения", snapshot.participants.flatMap((item) => item.rewards).filter((item) => item.reward_type_id === recordId).length);
      break;
    case "external_source_types":
      add("источники субтитров", snapshot.externalSources.filter((item) => item.external_source_type_id === recordId).length);
      break;
    case "platforms":
      add("площадки релизов", snapshot.releases.flatMap((item) => item.content.platform_links).filter((item) => item.platform_id === recordId).length);
      break;
    case "genres":
      add("релизы", snapshot.releases.filter((item) => item.content.genre_ids.includes(recordId)).length);
      break;
    case "tags":
      add("релизы", snapshot.releases.filter((item) => item.content.tag_ids.includes(recordId)).length);
      break;
    case "__external__":
      add("релизы", snapshot.releases.flatMap((item) => item.external).filter((item) => item.external_source_id === recordId).length);
      break;
    case "__templates__":
      add("релизы", snapshot.releases.filter((item) => item.posting.default_post_template_id === recordId).length);
      add("сгенерированные посты", snapshot.releases.flatMap((item) => item.generated_posts).filter((item) => item.template_id === recordId).length);
      break;
    default:
      break;
  }

  return { total, lines };
}

function buildSystemActionHint(systemTab: "health" | "conflicts" | "recovery" | "git", itemId: string): string {
  if (systemTab === "health") {
    if (itemId === "dataset_state") return "Если состояние данных не в порядке, сначала откройте вкладку конфликтов и проверьте незавершенные операции.";
    if (itemId === "workspace") return "Проверьте, что путь указывает на локально синхронизированную папку Яндекс Диска и она доступна на запись.";
    return "Если сигнал выглядит устаревшим, выполните принудительную переиндексацию и обновите диагностику.";
  }
  if (systemTab === "conflicts") {
    return "Не вносите новые правки, пока не разберете этот сигнал. Для конфликтов записи и импортов на проверке безопаснее сначала сверить текущий снимок набора.";
  }
  if (systemTab === "recovery") {
    return "Используйте эти элементы как ориентир для восстановления. Полный возврат лучше делать через резервную копию и промежуточную проверку, а не поверх рабочей папки.";
  }
  return "Архив Git работает как дополнительный слой. Если он не настроен, основная работа через общую папку продолжает работать без ограничений.";
}

function buildLocalDraftComparisonSummary(draft: LocalUnsavedDraftFile, snapshot: WorkspaceSnapshot): {
  domainLabel: string;
  currentLabel: string;
  statusText: string;
} {
  const domainLabelMap: Record<string, string> = {
    participant: "Участник",
    release: "Релиз",
    directories: "Справочник",
    templates: "Шаблоны постов",
    external: "Субтитры",
    structure: "Структура"
  };

  if (draft.domain === "participant") {
    const participantId = (draft.payload as { profile?: { id?: string } } | undefined)?.profile?.id ?? draft.entity_id;
    const current = snapshot.participants.find((item) => item.profile.id === participantId);
    return {
      domainLabel: domainLabelMap[draft.domain],
      currentLabel: current ? `${current.profile.display_name} • обновлено ${formatDate(current.profile.updated_at)}` : "запись отсутствует",
      statusText: current
        ? (serializeStable(current) === serializeStable(draft.payload) ? "Локальный черновик совпадает с текущей записью." : "Локальный черновик отличается от текущей записи в наборе.")
        : "В общей папке такой записи сейчас нет."
    };
  }

  if (draft.domain === "release") {
    const releaseId = (draft.payload as { release?: { id?: string } } | undefined)?.release?.id ?? draft.entity_id;
    const current = snapshot.releases.find((item) => item.release.id === releaseId);
    return {
      domainLabel: domainLabelMap[draft.domain],
      currentLabel: current ? `${getReleaseDisplayTitle(current.release)} • обновлено ${formatDate(current.release.updated_at)}` : "запись отсутствует",
      statusText: current
        ? (serializeStable(current) === serializeStable(draft.payload) ? "Локальный черновик совпадает с текущим релизом." : "Локальный черновик отличается от текущего релиза в наборе.")
        : "В общей папке такой релиз сейчас не найден."
    };
  }

  if (draft.domain === "directories") {
    const current = snapshot.directories[draft.entity_id] ?? [];
    return {
      domainLabel: domainLabelMap[draft.domain],
      currentLabel: `${getDirectoryEditorMeta(draft.entity_id).title} • ${formatSimpleCount(current.length, "запись", "записей")}`,
      statusText: serializeStable(current) === serializeStable(draft.payload)
        ? "Локальный черновик совпадает с текущим справочником."
        : "Локальный черновик отличается от текущего справочника."
    };
  }

  if (draft.domain === "templates") {
    return {
      domainLabel: domainLabelMap[draft.domain],
      currentLabel: `Шаблоны постов • ${formatSimpleCount(snapshot.templates.length, "запись", "записей")}`,
      statusText: serializeStable(snapshot.templates) === serializeStable(draft.payload)
        ? "Локальный черновик совпадает с текущим набором шаблонов."
        : "Локальный черновик отличается от текущего набора шаблонов."
    };
  }

  if (draft.domain === "external") {
    return {
      domainLabel: domainLabelMap[draft.domain],
      currentLabel: `Субтитры • ${formatSimpleCount(snapshot.externalSources.length, "запись", "записей")}`,
      statusText: serializeStable(snapshot.externalSources) === serializeStable(draft.payload)
        ? "Локальный черновик совпадает с текущим списком субтитров."
        : "Локальный черновик отличается от текущего списка субтитров."
    };
  }

  const structureValue = getStructureSnapshotValue(snapshot, draft.entity_id);
  return {
    domainLabel: domainLabelMap[draft.domain] ?? draft.domain,
    currentLabel: `${translateStructureEditorKey((draft.entity_id as StructureEditorKey) || "department_profiles.json")} • ${formatSimpleCount(Array.isArray(structureValue) ? structureValue.length : 0, "запись", "записей")}`,
    statusText: serializeStable(structureValue) === serializeStable(draft.payload)
      ? "Локальный черновик совпадает с текущими данными структуры."
      : "Локальный черновик отличается от текущих данных структуры."
  };
}

function getStructureSnapshotValue(snapshot: WorkspaceSnapshot, editorKey: string): unknown {
  switch (editorKey) {
    case "department_profiles.json":
      return snapshot.departmentProfiles;
    case "position_assignments.json":
      return snapshot.assignments;
    case "substitutions.json":
      return snapshot.substitutions;
    case "temporary_assignments.json":
      return snapshot.temporaryAssignments;
    case "structure_contacts.json":
      return snapshot.structureContacts;
    case "structure_notes.json":
      return snapshot.structureNotes;
    default:
      return [];
  }
}

function getDirectoryRecordLabel(
  record: DirectoryRecord | DepartmentDirectoryItem | StructurePosition | ExternalSource | PostTemplate,
  editorKey: string,
  showAdvancedMode = false
): string {
  if (editorKey === "__external__") {
    return (record as ExternalSource).name;
  }
  if (editorKey === "__templates__") {
    return (record as PostTemplate).name;
  }
  if (editorKey === "departments") {
    const department = record as DepartmentDirectoryItem;
    return showAdvancedMode && department.short_name && department.short_name !== department.name ? `${department.name} (${department.short_name})` : department.name;
  }
  if (editorKey === "structure_positions") {
    const position = record as StructurePosition;
    return showAdvancedMode && position.short_label && position.short_label !== position.name ? `${position.name} • ${position.short_label}` : position.name;
  }
  return (record as DirectoryRecord).name || record.id;
}

function getDirectoryRecordSecondary(
  record: DirectoryRecord | DepartmentDirectoryItem | StructurePosition | ExternalSource | PostTemplate,
  editorKey: string,
  snapshot: WorkspaceSnapshot,
  showAdvancedMode = false
): string {
  const externalSourceTypeNameById = new Map((snapshot.directories.external_source_types ?? []).map((item) => [item.id, item.name]));
  const departmentNameById = new Map(snapshot.departments.map((item) => [item.id, item.name]));
  if (editorKey === "__external__") {
    const source = record as ExternalSource;
    return `${translateCode(source.status)} • ${externalSourceTypeNameById.get(source.external_source_type_id ?? "") ?? "тип не указан"}`;
  }
  if (editorKey === "__templates__") {
    const template = record as PostTemplate;
    return `${translateTemplateType(template.template_type)} • блоков: ${normalizeStringArray(template.block_order).length}`;
  }
  if (editorKey === "departments") {
    const department = record as DepartmentDirectoryItem;
    const typeLabel = DEPARTMENT_TYPE_OPTIONS.find((item) => item.id === department.department_type_id)?.label ?? "отдел";
    const shortLabel = showAdvancedMode && department.short_name && department.short_name !== department.name ? ` • короткое имя: ${department.short_name}` : "";
    return `${typeLabel} • ${department.onboarding_visible_flag ? "видно новичкам" : "только для команды"}${shortLabel}`;
  }
  if (editorKey === "structure_positions") {
    const position = record as StructurePosition;
    const departmentName = getLookupLabel(departmentNameById, position.department_id, "Отдел не указан");
    const flags = [
      position.is_leadership ? "руководство" : null,
      position.is_curator ? "куратор" : null,
      position.is_admin ? "админ" : null
    ].filter(Boolean);
    const shortLabel = showAdvancedMode && position.short_label && position.short_label !== position.name ? ` • короткая подпись: ${position.short_label}` : "";
    return `${departmentName} • ${flags.join(", ") || "обычная позиция"}${shortLabel}`;
  }
  const directory = record as DirectoryRecord;
  return `${translateCode(directory.status)} • ${directory.name}`;
}

function toggleDirectoryArchiveState<T extends { status: string; archived_at?: string | null }>(
  record: T
): T {
  const nextArchived = record.status !== "archived";
  const next = {
    ...record,
    status: nextArchived ? "archived" : "active",
    archived_at: nextArchived ? new Date().toISOString() : null
  } as T & { archived?: boolean };
  if ("archived" in record) {
    next.archived = nextArchived;
  }
  return next;
}

function normalizeOrderedDirectoryCollection<T>(collection: T[]): T[] {
  return collection.map((item, index) => {
    if (!item || typeof item !== "object" || !("sort_order" in (item as Record<string, unknown>))) {
      return item;
    }
    return {
      ...(item as Record<string, unknown>),
      sort_order: index + 1
    } as T;
  });
}

type ParticipantView = {
  id: string;
  nickname: string;
  displayName: string;
  mention?: string;
  vkSlug?: string;
  sortOrder: number;
  status: string;
  archived: boolean;
  departmentIds: string[];
  roleIds: string[];
  activityLevel: string;
  reliabilityLevel: string;
  warningCount: number;
  remarkCount: number;
  blacklistCount: number;
  activeDisciplineCount: number;
  hasVoiceSample: boolean;
  hasEquipment: boolean;
  topReleaseFit: boolean;
  commercialFit: boolean;
  keyMember: boolean;
  reliable: boolean;
  releaseCount: number;
  releaseLoadLabel: string;
  curatedReleaseCount: number;
  oldReleaseLoad: boolean;
  joinedAt?: string | null;
  noteTitle?: string;
  notePreview?: string;
  noteCount: number;
  noteTooltip?: string;
  noteSearch: string;
};

type ParticipantRegistrySort =
  | "alphabet"
  | "department"
  | "role"
  | "status"
  | "activity"
  | "reliability"
  | "problems"
  | "notes"
  | "manual";

const PARTICIPANT_REGISTRY_SORT_OPTIONS: Array<{ id: ParticipantRegistrySort; label: string }> = [
  { id: "alphabet", label: "По алфавиту" },
  { id: "department", label: "По отделу" },
  { id: "role", label: "По роли" },
  { id: "status", label: "По статусу" },
  { id: "activity", label: "По активности" },
  { id: "reliability", label: "По надежности" },
  { id: "problems", label: "По проблемам" },
  { id: "notes", label: "По заметкам" },
  { id: "manual", label: "Ручной порядок" }
];

type ReleaseView = {
  id: string;
  title: string;
  shortTitle?: string;
  secondaryTitle?: string;
  sortOrder: number;
  status: string;
  type: string;
  archived: boolean;
  staffingMode: "confirmed" | "aligning" | "provisional";
  primaryDepartmentId: string;
  departmentIds: string[];
  curatorId?: string | null;
  year?: number | null;
  archivalState: string;
  teamCount: number;
  externalCount: number;
  hasGeneratedPost: boolean;
  missingCoreRoles: string[];
};

function buildWorkspaceSummary(snapshot: WorkspaceSnapshot) {
  return {
    participants: {
      total: snapshot.participants.length,
      active: snapshot.participants.filter((item) => getParticipantLifecycleStatus(item) === "active").length
    },
    releases: {
      total: snapshot.releases.length,
      inWork: snapshot.releases.filter((item) => item.release.release_status_id === "in_work").length
    },
    imports: {
      review: snapshot.imports.filter((item) => item.queue_status === "review" || item.queue_status === "pending").length
    },
    system: {
      alerts: (snapshot.manifest.state !== "clean" ? 1 : 0) + snapshot.imports.filter((item) => item.queue_status === "review").length
    },
    cacheLabel: `версия ${snapshot.manifest.dataset_revision}`
  };
}

function sectionMeta(section: NavigationSection): string {
  const map: Record<NavigationSection, string> = {
    dashboard: "Главный обзор команды, релизов, импорта и системных сигналов.",
    structure: "Реестр отделов, должностей структуры, назначений и профилей для новичков.",
    composition: "Реестр участников с дисциплиной, вкладом, техникой и данными для постов.",
    releases: "Общий реестр релизов, состав, контент, субтитры и сборка постов.",
    imports: "Импорт таблиц и JSON с разбором сущностей, дублей и спорных строк.",
    directories: "Справочники, субтитры, шаблоны постов и служебные словари.",
    statistics: "Сводная аналитика по релизам, отделам, типам и архивным потерям.",
    system: "Состояние данных, конфликты, восстановление и архивный слой Git."
  };
  return map[section];
}

function buildParticipantViews(
  snapshot: WorkspaceSnapshot,
  releaseLinksById: Map<string, { participated: ReleaseAggregate[]; curated: ReleaseAggregate[]; linked: ReleaseAggregate[] }>
): ParticipantView[] {
  return [...snapshot.participants]
    .sort(compareParticipantAggregateOrder)
    .map((participant, index) => {
    const releaseLinks = releaseLinksById.get(participant.profile.id) ?? { participated: [], curated: [], linked: [] };
    const relatedReleases = releaseLinks.linked;
    const lifecycleStatus = getParticipantLifecycleStatus(participant);
    const noteMeta = buildParticipantNoteMeta(participant.notes);
      return {
        id: participant.profile.id,
        nickname: participant.profile.nickname,
        displayName: participant.profile.display_name,
        mention: participant.profile.posting.mention,
        vkSlug: participant.profile.posting.vk_slug,
        sortOrder: participant.profile.sort_order ?? index + 1,
        status: lifecycleStatus,
        archived: isParticipantArchivedEntity(participant),
        departmentIds: participant.org.department_assignments.map((item) => item.department_id),
      roleIds: participant.org.role_assignments.filter((item) => item.active).map((item) => item.role_id),
      activityLevel: computeParticipantActivity(participant, relatedReleases),
      reliabilityLevel: getParticipantReliabilityLabel(participant),
      warningCount: participant.discipline.filter((item) => item.severity === "warning").length,
      remarkCount: participant.discipline.filter((item) => item.severity === "remark").length,
      blacklistCount: participant.discipline.filter((item) => item.severity === "blacklist" || item.severity === "block").length,
      activeDisciplineCount: participant.discipline.filter((item) => item.active_flag).length,
      hasVoiceSample: participant.voice_sample.voice_sample_present,
      hasEquipment: Boolean(participant.equipment.microphone_type || participant.equipment.audio_interface || participant.equipment.hardware_notes),
      topReleaseFit: participantHasFlag(participant, "priority_top") || participantHasFlag(participant, "key_member"),
      commercialFit: participantHasFlag(participant, "priority_commercial"),
      keyMember: participantHasFlag(participant, "key_member"),
      reliable: participant.discipline.filter((item) => item.active_flag).length === 0,
      releaseCount: relatedReleases.length,
      releaseLoadLabel: getParticipantReleaseLoadLabel(relatedReleases.length),
      curatedReleaseCount: releaseLinks.curated.length,
      oldReleaseLoad: relatedReleases.some((item) => (item.release.release_year ?? 0) < new Date().getFullYear() - 2),
      joinedAt: participant.profile.joined_at,
      noteTitle: noteMeta?.title,
      notePreview: noteMeta?.preview,
      noteCount: noteMeta?.count ?? 0,
      noteTooltip: noteMeta?.tooltip,
      noteSearch: participant.notes.map((item) => `${item.title} ${item.body}`).join(" ")
    };
  });
}

function buildParticipantNoteMeta(notes: ParticipantNote[]) {
  const visibleNotes = [...notes]
    .map((item) => ({
      ...item,
      title: normalizeSingleLineText(item.title),
      body: normalizeSingleLineText(item.body)
    }))
    .filter((item) => item.title || item.body)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return Number(right.pinned) - Number(left.pinned);
      }
      const rightTimestamp = Date.parse(right.updated_at || right.created_at || "");
      const leftTimestamp = Date.parse(left.updated_at || left.created_at || "");
      return (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) - (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    });
  if (!visibleNotes.length) {
    return null;
  }
  const primary = visibleNotes[0];
  const title = primary.title || "Заметка";
  const preview = primary.body || primary.title || "Без текста заметки";
  const tooltip = visibleNotes
    .slice(0, 3)
    .map((item) => {
      const itemTitle = item.title || "Заметка";
      const itemBody = item.body || "без текста";
      return `${itemTitle}: ${itemBody}`;
    })
    .join(" • ");
  return {
    title,
    preview,
    count: visibleNotes.length,
    tooltip
  };
}

function buildParticipantReleaseLinkIndex(snapshotReleases: ReleaseAggregate[]) {
  const map = new Map<string, { participated: ReleaseAggregate[]; curated: ReleaseAggregate[]; linked: ReleaseAggregate[] }>();

  const ensure = (participantId: string) => {
    if (!map.has(participantId)) {
      map.set(participantId, { participated: [], curated: [], linked: [] });
    }
    return map.get(participantId)!;
  };

  snapshotReleases.forEach((release) => {
    release.participants.forEach((assignment) => {
      const bucket = ensure(assignment.participant_id);
      bucket.participated.push(release);
      bucket.linked = uniqueById([...bucket.linked, release], (item) => item.release.id);
    });

    uniqueById(
      [release.release.curator_id ?? "", ...(release.release.co_curator_ids ?? [])].filter(Boolean),
      (item) => item
    ).forEach((participantId) => {
      const bucket = ensure(participantId);
      bucket.curated.push(release);
      bucket.linked = uniqueById([...bucket.linked, release], (item) => item.release.id);
    });
  });

  return map;
}

function describeParticipantReleaseLink(
  release: ReleaseAggregate,
  participantId: string,
  roleNameById: Map<string, string>
): string {
  const roles = release.participants
    .filter((item) => item.participant_id === participantId)
    .sort((left, right) => (left.credit_order ?? 0) - (right.credit_order ?? 0))
    .map((item) => getLookupLabel(roleNameById, item.role_id, "Роль не указана"));
  const labels = [...roles];
  if (release.release.curator_id === participantId) {
    labels.unshift("Куратор");
  } else if (release.release.co_curator_ids.includes(participantId)) {
    labels.unshift("Со-куратор");
  }
  return labels.length ? labels.join(", ") : "Связь не указана";
}

function buildReleaseTeamEntries(
  release: ReleaseAggregate,
  participantNameById: Map<string, string>,
  roleNameById: Map<string, string>
) {
  const grouped = new Map<string, { participantId: string; displayName: string; roles: string[] }>();

  [...release.participants]
    .filter((item) => item.active_flag !== false)
    .sort((left, right) => (left.credit_order ?? Number.MAX_SAFE_INTEGER) - (right.credit_order ?? Number.MAX_SAFE_INTEGER))
    .forEach((item) => {
      const existing = grouped.get(item.participant_id) ?? {
        participantId: item.participant_id,
        displayName: participantNameById.get(item.participant_id) ?? "Участник не найден",
        roles: []
      };
      const staffRoleLabel = roleNameById.get(item.role_id)
        ?? translatePostBlockId(item.credit_group_id || item.role_id)
        ?? "Роль не указана";
      if (!existing.roles.includes(staffRoleLabel)) {
        existing.roles.push(staffRoleLabel);
      }
      grouped.set(item.participant_id, existing);
    });

  return [...grouped.values()];
}

function getReleaseUniqueParticipantCount(release: ReleaseAggregate): number {
  return new Set(
    release.participants
      .filter((item) => item.active_flag !== false)
      .map((item) => item.participant_id)
      .filter(Boolean)
  ).size;
}

function buildReleaseRoleEntries(
  release: ReleaseAggregate,
  participantNameById: Map<string, string>
) {
  return [...(release.roles ?? [])]
    .filter((item) => item.active_flag !== false)
    .sort((left, right) => (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER))
    .map((item) => {
      const primaryCharacters = normalizeStringArray(item.character_names ?? []);
      const secondaryCharacters = normalizeStringArray(item.secondary_character_names ?? []);
      const characterChunks: string[] = [];
      if (primaryCharacters.length) {
        characterChunks.push(primaryCharacters.join(", "));
      }
      if (secondaryCharacters.length) {
        characterChunks.push(`второстепенные: ${secondaryCharacters.join(", ")}`);
      }
      return {
        id: item.id,
        participantId: item.participant_id,
        participantLabel: participantNameById.get(item.participant_id) ?? "Участник не найден",
        characterText: characterChunks.join(" • ")
      };
    });
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function buildReleaseAssignmentLabel(
  item: ReleaseParticipantAssignment,
  participantNameById: Map<string, string>,
  roleNameById: Map<string, string>
): string {
  const participantLabel = participantNameById.get(item.participant_id) ?? "Участник не указан";
  const roleLabel = roleNameById.get(item.role_id) ?? translateCode(item.role_id) ?? "роль не указана";
  return `${participantLabel} (${roleLabel})`;
}

function buildReleaseRoleAssignmentLabel(
  item: ReleaseRoleAssignment,
  participantNameById: Map<string, string>
): string {
  const participantLabel = participantNameById.get(item.participant_id) ?? "Участник не указан";
  const primaryCharacters = normalizeStringArray(item.character_names ?? []);
  const secondaryCharacters = normalizeStringArray(item.secondary_character_names ?? []);
  const details: string[] = [];
  if (primaryCharacters.length) {
    details.push(primaryCharacters.join(", "));
  }
  if (secondaryCharacters.length) {
    details.push(`второстепенные: ${secondaryCharacters.join(", ")}`);
  }
  return details.length ? `${participantLabel} (${details.join(" • ")})` : participantLabel;
}

function buildReleaseTeamHistorySummary(
  sourceRelease: ReleaseAggregate | undefined,
  nextRelease: ReleaseAggregate,
  participantNameById: Map<string, string>,
  roleNameById: Map<string, string>
): string | null {
  if (!sourceRelease) {
    return null;
  }

  const beforeById = new Map(sourceRelease.participants.map((item) => [item.id, item]));
  const afterById = new Map(nextRelease.participants.map((item) => [item.id, item]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  nextRelease.participants.forEach((item) => {
    const previous = beforeById.get(item.id);
    if (!previous) {
      added.push(buildReleaseAssignmentLabel(item, participantNameById, roleNameById));
      return;
    }

    const itemChanges: string[] = [];
    if (previous.participant_id !== item.participant_id) {
      itemChanges.push(`участник: ${participantNameById.get(previous.participant_id) ?? "не указан"} → ${participantNameById.get(item.participant_id) ?? "не указан"}`);
    }
    if (previous.role_id !== item.role_id) {
      itemChanges.push(`рабочая роль: ${roleNameById.get(previous.role_id) ?? translateCode(previous.role_id) ?? "не указана"} → ${roleNameById.get(item.role_id) ?? translateCode(item.role_id) ?? "не указана"}`);
    }

    if (itemChanges.length) {
      changed.push(`${buildReleaseAssignmentLabel(item, participantNameById, roleNameById)} — ${itemChanges.join("; ")}`);
    }
  });

  sourceRelease.participants.forEach((item) => {
    if (!afterById.has(item.id)) {
      removed.push(buildReleaseAssignmentLabel(item, participantNameById, roleNameById));
    }
  });

  const parts: string[] = [];
  if (added.length) {
    parts.push(`добавлены: ${added.slice(0, 2).join(", ")}${added.length > 2 ? ` и еще ${added.length - 2}` : ""}`);
  }
  if (removed.length) {
    parts.push(`удалены: ${removed.slice(0, 2).join(", ")}${removed.length > 2 ? ` и еще ${removed.length - 2}` : ""}`);
  }
  if (changed.length) {
    parts.push(`изменены: ${changed.slice(0, 2).join(" • ")}${changed.length > 2 ? ` • и еще ${changed.length - 2}` : ""}`);
  }

  return parts.length ? `Обновлен состав релиза: ${parts.join(" • ")}` : null;
}

function buildReleaseRoleHistorySummary(
  sourceRelease: ReleaseAggregate | undefined,
  nextRelease: ReleaseAggregate,
  participantNameById: Map<string, string>
): string | null {
  if (!sourceRelease) {
    return null;
  }

  const sourceRoles = sourceRelease.roles ?? [];
  const nextRoles = nextRelease.roles ?? [];
  const beforeById = new Map(sourceRoles.map((item) => [item.id, item]));
  const afterById = new Map(nextRoles.map((item) => [item.id, item]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

      nextRoles.forEach((item) => {
    const previous = beforeById.get(item.id);
    if (!previous) {
      added.push(buildReleaseRoleAssignmentLabel(item, participantNameById));
      return;
    }

    const itemChanges: string[] = [];
    if (previous.participant_id !== item.participant_id) {
      itemChanges.push(`участник: ${participantNameById.get(previous.participant_id) ?? "не указан"} → ${participantNameById.get(item.participant_id) ?? "не указан"}`);
    }
    const previousCharacters = normalizeStringArray(previous.character_names ?? []);
    const nextCharacters = normalizeStringArray(item.character_names ?? []);
    if (!arraysEqual(previousCharacters, nextCharacters)) {
      itemChanges.push(`персонажи: ${previousCharacters.join(", ") || "не указаны"} → ${nextCharacters.join(", ") || "не указаны"}`);
    }
    const previousSecondaryCharacters = normalizeStringArray(previous.secondary_character_names ?? []);
    const nextSecondaryCharacters = normalizeStringArray(item.secondary_character_names ?? []);
    if (!arraysEqual(previousSecondaryCharacters, nextSecondaryCharacters)) {
      itemChanges.push(`второстепенные: ${previousSecondaryCharacters.join(", ") || "не указаны"} → ${nextSecondaryCharacters.join(", ") || "не указаны"}`);
    }

    if (itemChanges.length) {
      changed.push(`${buildReleaseRoleAssignmentLabel(item, participantNameById)} — ${itemChanges.join("; ")}`);
    }
  });

  sourceRoles.forEach((item) => {
    if (!afterById.has(item.id)) {
      removed.push(buildReleaseRoleAssignmentLabel(item, participantNameById));
    }
  });

  const parts: string[] = [];
  if (added.length) {
    parts.push(`добавлены: ${added.slice(0, 2).join(", ")}${added.length > 2 ? ` и еще ${added.length - 2}` : ""}`);
  }
  if (removed.length) {
    parts.push(`удалены: ${removed.slice(0, 2).join(", ")}${removed.length > 2 ? ` и еще ${removed.length - 2}` : ""}`);
  }
  if (changed.length) {
    parts.push(`изменены: ${changed.slice(0, 2).join(" • ")}${changed.length > 2 ? ` • и еще ${changed.length - 2}` : ""}`);
  }

  return parts.length ? `Обновлены роли релиза: ${parts.join(" • ")}` : null;
}

function buildReleaseViews(snapshot: WorkspaceSnapshot): ReleaseView[] {
  return [...snapshot.releases]
    .sort((left, right) => {
      const leftOrder = left.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.release.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return getReleaseDisplayTitle(left.release).localeCompare(getReleaseDisplayTitle(right.release), "ru");
    })
    .map((release, index) => {
    const staffingMode = getReleaseStaffingMode(release.release);
    const uniqueParticipants = new Set(release.participants.map((item) => item.participant_id).filter(Boolean));
    return {
      id: release.release.id,
      title: getReleaseDisplayTitle(release.release),
      shortTitle: release.release.short_title ?? "",
      secondaryTitle: getReleaseSecondaryDisplayTitle(release.release),
      sortOrder: release.release.sort_order ?? index + 1,
      status: release.release.release_status_id,
      type: release.release.release_type_id,
      archived: isReleaseArchivedEntity(release.release),
      staffingMode,
      primaryDepartmentId: release.release.primary_department_id,
      departmentIds: release.release.department_ids,
      curatorId: release.release.curator_id,
      year: release.release.release_year,
      archivalState: release.release.archival_state,
      teamCount: uniqueParticipants.size,
      externalCount: release.external.length,
      hasGeneratedPost: release.generated_posts.length > 0,
      missingCoreRoles: getReleaseMissingCoreRoles(release)
    };
  });
}

function FocusGroup({
  title,
  items,
  empty,
  onOpenParticipant
}: {
  title: string;
  items: ParticipantView[];
  empty: string;
  onOpenParticipant: (id: string) => void;
}) {
  return (
    <div className="detail-card card-shell dashboard-compact-card">
      <div className="card-section">
        <div className="card-header-main">
          <h4>{title}</h4>
        </div>
        {items.length ? (
          <div className="card-list">
            {items.map((item) => (
              <div
                key={item.id}
                className="compact-list-row compact-click-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpenParticipant(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenParticipant(item.id);
                  }
                }}
              >
                <div>
                  <strong>{item.displayName}</strong>
                  <div className="muted">{item.mention ?? `@${item.nickname}`}</div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="card-copy"><div className="muted">{empty}</div></div>}
      </div>
    </div>
  );
}

function QueueGroup({
  title,
  releases,
  releaseStatusCategoryEnabled,
  onOpenRelease
}: {
  title: string;
  releases: ReleaseView[];
  releaseStatusCategoryEnabled: boolean;
  onOpenRelease: (id: string) => void;
}) {
  return (
    <div className="detail-card card-shell dashboard-compact-card">
      <div className="card-section">
        <div className="card-header-main">
          <h4>{title}</h4>
        </div>
        {releases.length ? (
          <div className="card-list">
            {releases.map((item) => (
              <div
                key={item.id}
                className="compact-list-row compact-click-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpenRelease(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenRelease(item.id);
                  }
                }}
              >
                <div>
                  <strong>{item.title}</strong>
                  <div className="muted">
                    {[
                      releaseStatusCategoryEnabled ? getReleaseStatusLabel(item.status) : null,
                      ...(item.staffingMode === "confirmed" && item.missingCoreRoles.length
                        ? [`не хватает: ${formatPostGroupList(item.missingCoreRoles)}`]
                        : [])
                    ].filter(Boolean).join(" • ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="card-copy"><div className="muted">Нет подходящих релизов.</div></div>}
      </div>
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onToggle,
  tone
}: {
  label: string;
  active: boolean;
  onToggle: (value: boolean) => void;
  tone?: "accent" | "warning" | "danger" | "success";
}) {
  return (
    <button className={`tab ${active ? "active" : ""}`} onClick={() => onToggle(!active)}>
      <Chip tone={active ? tone : undefined}>{label}</Chip>
    </button>
  );
}

function OptionChipGroup({
  options,
  selectedIds,
  onToggle
}: {
  options: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="filter-chip-grid">
      {options.length ? options.map((option) => {
        const active = selectedIds.includes(option.id);
        return (
          <button key={option.id} className={`tab ${active ? "active" : ""}`} onClick={() => onToggle(option.id)}>
            <Chip tone={active ? "accent" : undefined}>{option.label}</Chip>
          </button>
        );
      }) : <div className="muted">Подходящие значения пока не настроены.</div>}
    </div>
  );
}

function TemplateBlockOrderEditor({
  selectedIds,
  onToggle,
  onReorder
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const selectedBlocks = selectedIds
    .map((id) => POST_TEMPLATE_BLOCK_OPTIONS.find((option) => option.id === id))
    .filter((option): option is typeof POST_TEMPLATE_BLOCK_OPTIONS[number] => Boolean(option));
  const availableBlocks = POST_TEMPLATE_BLOCK_OPTIONS.filter((item) => !selectedIds.includes(item.id));
  const [nextBlockId, setNextBlockId] = useState<string>(availableBlocks[0]?.id ?? "");

  useEffect(() => {
    if (!availableBlocks.some((item) => item.id === nextBlockId)) {
      setNextBlockId(availableBlocks[0]?.id ?? "");
    }
  }, [availableBlocks, nextBlockId]);

  function moveBlock(blockId: string, direction: "up" | "down") {
    const currentIndex = selectedIds.indexOf(blockId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= selectedIds.length) {
      return;
    }
    const nextIds = [...selectedIds];
    const [moved] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, moved);
    onReorder(nextIds);
  }

  const orderedBlocks = selectedIds
    .map((id) => selectedBlocks.find((block) => block.id === id))
    .filter((option): option is typeof POST_TEMPLATE_BLOCK_OPTIONS[number] => Boolean(option));

  return (
    <div className="section-stack compact">
      <div className="detail-card">
        <h4>Порядок выбранных блоков</h4>
        <div className="muted">Порядок блоков меняется только явными кнопками выше и ниже. Случайного снятия или ложного переноса больше быть не должно.</div>
      </div>
      <div className="ordered-block-list">
        {orderedBlocks.length ? orderedBlocks.map((block, index) => (
          <div
            key={block.id}
            className="ordered-block-item"
          >
            <div className="ordered-block-item-copy">
              <strong>{block.label}</strong>
              <span className="muted">Блок {index + 1} в итоговом тексте поста.</span>
            </div>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <Button
                className="ghost"
                onClick={() => moveBlock(block.id, "up")}
                disabled={index === 0}
              >
                Вверх
              </Button>
              <Button
                className="ghost"
                onClick={() => moveBlock(block.id, "down")}
                disabled={index === orderedBlocks.length - 1}
              >
                Вниз
              </Button>
              <Button
                className="ghost"
                onClick={() => onToggle(block.id)}
              >
                Убрать блок
              </Button>
            </div>
          </div>
        )) : <div className="muted">Сначала выберите хотя бы один блок, чтобы настроить порядок.</div>}
      </div>
      <div className="detail-card">
        <h4>Состав блоков</h4>
        <div className="muted">Добавление новых блоков теперь вынесено в отдельный явный шаг, чтобы обычный ЛКМ больше не конфликтовал с переносом.</div>
        {availableBlocks.length ? (
          <div className="row" style={{ marginTop: 12, alignItems: "end", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <Field label="Добавить блок">
                <select className="select-input" value={nextBlockId} onChange={(event) => setNextBlockId(event.target.value)}>
                  {availableBlocks.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
            </div>
            <Button className="secondary" onClick={() => nextBlockId && onToggle(nextBlockId)} disabled={!nextBlockId}>Добавить блок</Button>
          </div>
        ) : <div className="muted" style={{ marginTop: 12 }}>Все доступные блоки уже добавлены в шаблон.</div>}
      </div>
    </div>
  );
}

const STAFFING_FLAG_OPTIONS = [
  { id: "key_member", label: "Ключевой участник" },
  { id: "priority_top", label: "Подходит для топ-релизов" },
  { id: "priority_commercial", label: "Подходит для заказных проектов" },
  { id: "reliable", label: "Надежный" },
  { id: "fast_response", label: "Быстро отвечает" },
  { id: "tech_ready", label: "Технически готов" }
];

const REWARD_TAG_OPTIONS = [
  { id: "key_member", label: "Ключевой участник" },
  { id: "priority_top", label: "Приоритет на топ-релизы" },
  { id: "priority_commercial", label: "Приоритет на заказные проекты" },
  { id: "initiative", label: "Инициативность" },
  { id: "reliable", label: "Надежность" }
];

const VOICE_TAG_OPTIONS = [
  { id: "lead_roles", label: "Главные роли" },
  { id: "support_roles", label: "Второй план" },
  { id: "dramatic", label: "Драма" },
  { id: "comic", label: "Комедия" },
  { id: "singing", label: "Пение" },
  { id: "imported", label: "Из импорта" },
  { id: "needs_review", label: "Нужно переслушать" }
];

const PARTICIPANT_PRIORITY_OPTIONS = [
  { id: "normal", label: "Нормальный приоритет" },
  { id: "top", label: "Топ-релизы" },
  { id: "commercial", label: "Заказные проекты" },
  { id: "both", label: "Топ и заказные" }
] as const;

function getParticipantPickerLabel(participant: Pick<ParticipantListItem, "nickname" | "displayName">) {
  const nickname = normalizeSingleLineText(participant.nickname);
  const displayName = normalizeSingleLineText(participant.displayName);
  if (nickname && displayName && nickname !== displayName) {
    return `${nickname} — ${displayName}`;
  }
  return nickname || displayName || "Участник";
}

function sortParticipantPickerItems<T extends Pick<ParticipantListItem, "id" | "nickname" | "displayName">>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    getParticipantPickerLabel(left).localeCompare(getParticipantPickerLabel(right), "ru", { sensitivity: "base" })
  );
}

function buildParticipantPickerSearchIndex(
  participants: ParticipantAggregate[],
  participantList: ParticipantListItem[],
  lookupMaps: {
    departmentNameById: Map<string, string>;
    roleNameById: Map<string, string>;
    skillNameById: Map<string, string>;
    specializationNameById: Map<string, string>;
  }
): Map<string, string> {
  const fullById = new Map(participants.map((participant) => [participant.profile.id, participant]));
  const index = new Map<string, string>();
  participantList.forEach((listItem) => {
    const participant = fullById.get(listItem.id);
    index.set(listItem.id, buildParticipantPickerSearchText(participant, listItem, lookupMaps));
  });
  participants.forEach((participant) => {
    if (!index.has(participant.profile.id)) {
      index.set(participant.profile.id, buildParticipantPickerSearchText(participant, undefined, lookupMaps));
    }
  });
  return index;
}

function buildParticipantPickerSearchText(
  participant: ParticipantAggregate | undefined,
  listItem: ParticipantListItem | undefined,
  lookupMaps: {
    departmentNameById: Map<string, string>;
    roleNameById: Map<string, string>;
    skillNameById: Map<string, string>;
    specializationNameById: Map<string, string>;
  }
): string {
  const profile = participant?.profile;
  const org = participant?.org;
  const departmentIds = mergeStringValues(
    listItem?.departmentIds ?? [],
    org?.department_assignments.map((item) => item.department_id) ?? []
  );
  const roleIds = mergeStringValues(
    listItem?.roleIds ?? [],
    org?.role_assignments.map((item) => item.role_id) ?? [],
    org?.desired_role_ids ?? []
  );
  const skillIds = org?.skill_entries.map((item) => item.skill_id) ?? [];
  const specializationIds = org?.specialization_entries.map((item) => item.specialization_id) ?? [];
  const readableParts = [
    listItem?.id,
    listItem?.nickname,
    listItem?.displayName,
    listItem?.status,
    listItem?.activityLevel,
    listItem?.reliabilityLevel,
    profile?.nickname,
    profile?.nickname_pronunciation,
    profile?.display_name,
    profile?.real_name,
    profile?.contact_max,
    profile?.contact_phone,
    profile?.contact_telegram,
    profile?.contact_vk,
    profile?.contact_email,
    profile?.contact_odnoklassniki,
    ...(profile?.contacts ?? []),
    profile?.posting?.mention,
    profile?.posting?.mention_id,
    profile?.posting?.display_name_for_post,
    profile?.posting?.vk_slug,
    profile?.posting?.vk_url,
    profile?.posting?.post_copy_string,
    ...departmentIds,
    ...departmentIds.map((id) => lookupMaps.departmentNameById.get(id)),
    ...roleIds,
    ...roleIds.map((id) => lookupMaps.roleNameById.get(id)),
    ...skillIds,
    ...skillIds.map((id) => lookupMaps.skillNameById.get(id)),
    ...specializationIds,
    ...specializationIds.map((id) => lookupMaps.specializationNameById.get(id)),
    ...(participant?.notes.flatMap((item) => [item.title, item.body]) ?? []),
    ...(participant?.rewards.flatMap((item) => [item.description, ...item.tags]) ?? []),
    ...(participant?.discipline.map((item) => item.description) ?? []),
    participant ? JSON.stringify(participant) : null
  ];
  return readableParts
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");
}

function getLookupLabel(
  dictionary: Map<string, string>,
  value?: string | null,
  emptyText = "не указано"
) {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return emptyText;
  return dictionary.get(cleaned) ?? translateCode(cleaned) ?? emptyText;
}

function getLookupLabels(
  dictionary: Map<string, string>,
  values: Array<string | null | undefined>,
  emptyText = "не указаны"
) {
  const labels = values
    .map((value) => getLookupLabel(dictionary, value, ""))
    .filter(Boolean);
  return labels.length ? labels.join(", ") : emptyText;
}

function getRewardTagLabel(value?: string | null) {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return "";
  return REWARD_TAG_OPTIONS.find((item) => item.id === cleaned)?.label ?? translateCode(cleaned) ?? "";
}

function getRewardTagsLabel(values: Array<string | null | undefined>, emptyText = "без пометок") {
  const labels = values
    .map((value) => getRewardTagLabel(value))
    .filter(Boolean);
  return labels.length ? labels.join(", ") : emptyText;
}

function getRewardDisplayTitle(item: RewardEvent, rewardTypeNameById: Map<string, string>) {
  const description = cleanOptionalText(item.description);
  const rewardTypeLabel = getLookupLabel(rewardTypeNameById, item.reward_type_id, "Награда");
  if (!description) {
    return rewardTypeLabel;
  }
  if (
    description === "Новая награда / положительная пометка"
    || description === item.reward_type_id
  ) {
    return rewardTypeLabel;
  }
  return description;
}

function pluralizeRu(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function pluralizeSimple(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

function formatSimpleCount(count: number, one: string, many: string) {
  return `${count} ${pluralizeSimple(count, one, many)}`;
}

function getReleaseRussianTitleValue(release: { title_primary?: string | null }) {
  return normalizeSingleLineText(release.title_primary);
}

function getReleaseEnglishTitleValue(release: { title_secondary?: string | null }) {
  return cleanOptionalText(release.title_secondary);
}

function getReleaseDisplayTitle(release: { title_primary?: string | null; title_secondary?: string | null }) {
  return getReleaseRussianTitleValue(release) || getReleaseEnglishTitleValue(release) || "Новый релиз";
}

function getReleaseSecondaryDisplayTitle(release: { title_primary?: string | null; title_secondary?: string | null }) {
  const russianTitle = getReleaseRussianTitleValue(release);
  const englishTitle = getReleaseEnglishTitleValue(release);
  if (russianTitle && englishTitle && russianTitle !== englishTitle) {
    return englishTitle;
  }
  return "";
}

function getReleaseTitleSegments(release: { title_primary?: string | null; title_secondary?: string | null }) {
  const russianTitle = getReleaseRussianTitleValue(release);
  const englishTitle = getReleaseEnglishTitleValue(release);
  if (russianTitle && englishTitle && russianTitle !== englishTitle) {
    return [russianTitle, englishTitle];
  }
  const fallbackTitle = russianTitle || englishTitle;
  return fallbackTitle ? [fallbackTitle] : ["Новый релиз"];
}

function getDisciplineEventTitle(item: DisciplinaryEvent, disciplineTypeNameById: Map<string, string>) {
  return getLookupLabel(disciplineTypeNameById, item.disciplinary_type_id, translateCode(item.severity) || "Событие");
}

function getParticipantDisciplineSummary(participant?: ParticipantAggregate | null) {
  if (!participant) return "не указана";
  const activeEvents = participant.discipline.filter((item) => item.active_flag);
  const warnings = activeEvents.filter((item) => item.severity === "warning").length;
  const remarks = activeEvents.filter((item) => item.severity === "remark").length;
  const blocks = activeEvents.filter((item) => item.severity === "blacklist" || item.severity === "block").length;
  const parts: string[] = [];
  if (warnings) parts.push(`${warnings} ${pluralizeRu(warnings, "предупреждение", "предупреждения", "предупреждений")}`);
  if (remarks) parts.push(`${remarks} ${pluralizeRu(remarks, "замечание", "замечания", "замечаний")}`);
  if (blocks) parts.push(`${blocks} ${pluralizeRu(blocks, "блокировка", "блокировки", "блокировок")}`);
  return parts.length ? parts.join(" • ") : "без активных событий";
}

function hasParticipantBlacklist(participant?: ParticipantAggregate | null) {
  if (!participant) return false;
  return participant.discipline.some(
    (item) => item.active_flag && (item.severity === "blacklist" || item.severity === "block")
  );
}

function formatReleaseExternalMention(mention?: string | null, displayName?: string | null): string {
  const normalizedMention = cleanOptionalText(mention);
  const normalizedDisplayName = cleanOptionalText(displayName);
  if (normalizedMention && normalizedDisplayName) {
    return `${normalizedMention} (${normalizedDisplayName})`;
  }
  return normalizedMention || normalizedDisplayName || "";
}

function getReleaseExternalTitle(
  assignment: Pick<ReleaseExternalAssignment, "credit_label_override" | "external_source_id">,
  externalSourceNameById: Map<string, string>
): string {
  return (
    cleanOptionalText(assignment.credit_label_override)
    || externalSourceNameById.get(assignment.external_source_id ?? "")
    || ""
  );
}

function getReleaseExternalDisplayLine(
  assignment: Pick<ReleaseExternalAssignment, "credit_label_override" | "external_source_id" | "vk_mention" | "vk_display_name">,
  externalSourceNameById: Map<string, string>
): string {
  const title = getReleaseExternalTitle(assignment, externalSourceNameById);
  const mention = formatReleaseExternalMention(assignment.vk_mention, assignment.vk_display_name);
  if (title && mention) return `${title}: ${mention}`;
  return title || mention || "Источник субтитров";
}

function getReleaseExternalVariant(
  assignment: Pick<ReleaseExternalAssignment, "external_source_type_id" | "external_source_id">,
  externalSourceTypeById: Map<string, string>
): ReleaseExternalVariantId {
  const explicitType = cleanOptionalText(assignment.external_source_type_id);
  const sourceType = assignment.external_source_id ? externalSourceTypeById.get(assignment.external_source_id) : "";
  const variant = (explicitType || sourceType || "translator") as ReleaseExternalVariantId;
  return RELEASE_EXTERNAL_VARIANT_OPTIONS.some((item) => item.id === variant) ? variant : "translator";
}

function getReleaseExternalTranslatorLine(
  assignment: Pick<ReleaseExternalAssignment, "translator_names">
): string {
  const translators = normalizeStringArray(assignment.translator_names ?? []);
  return translators.length ? `Переводчики: ${translators.join(", ")}` : "";
}

function getReleaseDescriptionValue(content: Pick<ReleaseContent, "description_short" | "description_full">): string {
  return cleanOptionalText(content.description_full, true)
    || cleanOptionalText(content.description_short, true)
    || "";
}

function getReleaseFlagLabels(
  release: Pick<ReleaseAggregate["release"], "top_release_flag" | "commissioned_flag" | "training_flag" | "legacy_flag">
): string[] {
  const labels: string[] = [];
  if (release.top_release_flag) labels.push("Приоритетный релиз");
  if (release.commissioned_flag) labels.push("Заказной проект");
  if (release.training_flag) labels.push("Учебный релиз");
  if (release.legacy_flag) labels.push("Старый релиз");
  return labels;
}

function hasReleaseTranslationCoverage(release: ReleaseAggregate): boolean {
  const participantHasTranslation = release.participants.some((item) => {
    const groupId = canonicalPostGroupId(item.credit_group_id || item.role_id);
    const roleId = canonicalPostGroupId(item.role_id);
    return groupId === "translation" || roleId === "translation";
  });
  if (participantHasTranslation) {
    return true;
  }

  return release.external.some((item) => {
    const translators = normalizeStringArray(item.translator_names ?? []);
    const variant = cleanOptionalText(item.external_source_type_id);
    const groupId = canonicalPostGroupId(item.credit_group_id);
    return Boolean(
      translators.length
      || groupId === "translation"
      || variant === "translator"
      || variant === "fsg"
      || variant === "partner"
      || variant === "vk_only"
      || cleanOptionalText(item.external_source_id)
      || cleanOptionalText(item.credit_label_override)
      || cleanOptionalText(item.vk_mention)
      || cleanOptionalText(item.vk_display_name)
    );
  });
}

function hasReleaseCoreRoleCoverage(release: ReleaseAggregate, roleId: string): boolean {
  if (roleId === "translation") {
    return hasReleaseTranslationCoverage(release);
  }

  return release.participants.some((item) => {
    const groupId = canonicalPostGroupId(item.credit_group_id || item.role_id);
    const normalizedRoleId = canonicalPostGroupId(item.role_id);
    return groupId === roleId || normalizedRoleId === roleId;
  });
}

function getReleaseMissingCoreRoles(release: ReleaseAggregate): string[] {
  if (getReleaseStaffingMode(release.release) !== "confirmed") {
    return [];
  }
  return ["voice_cast", "translation", "mixing"].filter((roleId) => !hasReleaseCoreRoleCoverage(release, roleId));
}

function normalizeDepartmentInterest(value?: string | null): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    active: "participates",
    reserve: "can_help",
    paused: "abstains",
    archived: "declined",
    participates: "participates",
    abstains: "abstains",
    canhelp: "can_help",
    optional: "optional",
    declined: "declined",
    no: "declined"
  };
  return map[normalized] ?? "participates";
}

function getDepartmentInterestLabel(value?: string | null) {
  const normalized = normalizeDepartmentInterest(value);
  return DEPARTMENT_INTEREST_OPTIONS.find((option) => option.id === normalized)?.label ?? "Участвует";
}

function isArchivedReleaseState(value?: string | null) {
  const normalized = cleanOptionalText(value) ?? "";
  return normalized === "archived" || normalized === "archived_dropped";
}

function normalizeReleaseArchiveState(value?: string | null) {
  const normalized = cleanOptionalText(value) ?? "normal";
  if (normalized === "lost" || normalized === "frozen") return normalized;
  return isArchivedReleaseState(normalized) ? normalized : "normal";
}

function getReleaseSeparator(value?: string | null) {
  const normalized = cleanOptionalText(value);
  return normalized && POST_SEPARATOR_OPTIONS.includes(normalized as (typeof POST_SEPARATOR_OPTIONS)[number])
    ? normalized
    : POST_SEPARATOR_OPTIONS[0];
}

function toggleId(values: string[], id: string) {
  return values.includes(id) ? values.filter((item) => item !== id) : [...values, id];
}

function getReleaseStatusLabel(
  statusId?: string | null,
  options: Array<{ id: string; name: string }> = []
): string {
  const builtin: Record<string, string> = {
    announcement: "Анонс",
    in_work: "Активный",
    completed: "Завершен",
    frozen: "Заморожен",
    archived: "Архивный",
    canceled: "Отменен"
  };
  if (!statusId) return "Не указан";
  return builtin[statusId] ?? options.find((item) => item.id === statusId)?.name ?? translateCode(statusId);
}

function getReleaseConditionLabel(value?: string | null): string {
  const map: Record<string, string> = {
    normal: "Обычный",
    archived: "Архивный",
    archived_dropped: "Архивный • дропнутый",
    lost: "Утерян",
    frozen: "Заморожен"
  };
  return map[value ?? ""] ?? translateCode(value);
}

function isReleaseArchivedEntity(
  release: Pick<ReleaseAggregate["release"], "release_status_id" | "archival_state"> & { archived_at?: string | null }
) {
  return release.release_status_id === "archived" || isArchivedReleaseState(release.archival_state) || Boolean(release.archived_at);
}

function isReleaseArchivedView(item: Pick<ReleaseView, "status" | "archivalState" | "archived">) {
  return item.archived || item.status === "archived" || isArchivedReleaseState(item.archivalState);
}

function isAnnouncementRelease(release: Pick<ReleaseAggregate["release"], "release_status_id">) {
  return release.release_status_id === "announcement";
}

function getReleaseStaffingMode(release: Pick<ReleaseAggregate["release"], "release_status_id" | "staffing_mode">) {
  if (!isAnnouncementRelease(release)) {
    return "confirmed" as const;
  }
  return release.staffing_mode === "provisional" ? "provisional" : "aligning";
}

function normalizeReleaseStaffingMode(
  statusId?: string | null,
  staffingMode?: string | null
): "confirmed" | "aligning" | "provisional" {
  if (statusId !== "announcement") {
    return "confirmed";
  }
  return staffingMode === "provisional" ? "provisional" : "aligning";
}

function isAnimeLikeReleaseType(releaseTypeId?: string | null) {
  return releaseTypeId === "anime" || releaseTypeId === "ongoing";
}

function getAgeRatingOptionsForReleaseType(releaseTypeId?: string | null): string[] {
  return [...(isAnimeLikeReleaseType(releaseTypeId) ? ANIME_AGE_RATING_OPTIONS : STANDARD_AGE_RATING_OPTIONS)];
}

function normalizeAgeRating(value?: string | null, releaseTypeId?: string | null): string | undefined {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return undefined;
  const normalizedKey = normalizeLookupKey(cleaned);
  const aliasMap: Record<string, string> = {
    "0": "0+",
    "0plus": "0+",
    "6": "6+",
    "6plus": "6+",
    "12": "12+",
    "12plus": "12+",
    "16": "16+",
    "16plus": "16+",
    "18": "18+",
    "18plus": "18+",
    pg13: "PG-13",
    r17: "R-17"
  };
  const normalized = aliasMap[normalizedKey] ?? cleaned.toUpperCase();
  const allowed = getAgeRatingOptionsForReleaseType(releaseTypeId);
  return allowed.includes(normalized) ? normalized : cleaned;
}

function shouldIgnoreSurfaceDrag(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    ? Boolean(target.closest("button, input, select, textarea, a, label, summary, [data-prevent-drag='true']"))
    : false;
}

function getReleaseAgeRatingChoices(release: ReleaseAggregate | null | undefined): string[] {
  if (!release) return [...STANDARD_AGE_RATING_OPTIONS];
  const options = getAgeRatingOptionsForReleaseType(release.release.release_type_id);
  const current = cleanOptionalText(release.content.age_rating);
  return current && !options.includes(current) ? [current, ...options] : options;
}

function reorderByTarget<T extends { id: string }>(items: T[], draggedId: string, targetId: string): T[] {
  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function reorderIdsByTarget(items: string[], draggedId: string, targetId: string): string[] {
  const fromIndex = items.indexOf(draggedId);
  const toIndex = items.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function findNearestReorderTargetId(attributeName: string, activeId: string, clientX: number, clientY: number): string | null {
  const activeElement = Array.from(document.querySelectorAll<HTMLElement>(`[${attributeName}]`)).find(
    (element) => element.getAttribute(attributeName) === activeId
  );
  if (activeElement) {
    const activeRect = activeElement.getBoundingClientRect();
    if (
      clientX >= activeRect.left &&
      clientX <= activeRect.right &&
      clientY >= activeRect.top &&
      clientY <= activeRect.bottom
    ) {
      return null;
    }
  }

  const directTarget = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)
    ?.closest(`[${attributeName}]`)
    ?.getAttribute(attributeName);
  if (directTarget && directTarget !== activeId) {
    return directTarget;
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[${attributeName}]`));
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((element) => {
    const id = element.getAttribute(attributeName);
    if (!id || id === activeId) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const deltaX = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    const deltaY = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  });

  return bestId;
}

function participantHasFlag(participant: ParticipantAggregate, flag: string) {
  return participant.org.staffing_flags.includes(flag) || participant.rewards.some((item) => item.tags.includes(flag));
}

function readParticipantPriority(values: string[]) {
  const top = values.includes("priority_top");
  const commercial = values.includes("priority_commercial");
  if (top && commercial) return "both";
  if (top) return "top";
  if (commercial) return "commercial";
  return "normal";
}

function writeParticipantPriority(values: string[], nextValue: "normal" | "top" | "commercial" | "both") {
  const next = values.filter((item) => item !== "priority_top" && item !== "priority_commercial");
  if (nextValue === "top" || nextValue === "both") {
    next.push("priority_top");
  }
  if (nextValue === "commercial" || nextValue === "both") {
    next.push("priority_commercial");
  }
  return normalizeStringArray(next);
}

function normalizeVoiceTagId(value?: string | null): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    mainvoice: "lead_roles",
    supportvoice: "support_roles",
    leadroles: "lead_roles",
    supportroles: "support_roles",
    singing: "singing",
    imported: "imported",
    dramatic: "dramatic",
    comic: "comic",
    needsreview: "needs_review"
  };
  return map[normalized] ?? slugify(value ?? "voice_tag");
}

function compareParticipantAggregateOrder(left: ParticipantAggregate, right: ParticipantAggregate) {
  const leftOrder = left.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.profile.sort_order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.profile.display_name.localeCompare(right.profile.display_name, "ru");
}

function uniqueById<T>(values: T[], getId: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = getId(value);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function getParticipantPostDisplayName(participant: ParticipantAggregate): string {
  return (
    participant.profile.nickname.trim()
    || participant.profile.display_name.trim()
    || "—"
  );
}

function getVoiceSampleResource(voiceSample: ParticipantAggregate["voice_sample"]): string {
  return (voiceSample.voice_sample_url ?? voiceSample.voice_sample_storage_ref ?? "").trim();
}

function buildPostCopyString(participant: ParticipantAggregate): string {
  const mention = participant.profile.posting.mention?.trim();
  const name = getParticipantPostDisplayName(participant);
  if (mention && name) return `${mention} (${name})`;
  if (mention) return mention;
  return name || "—";
}

const PSEUDO_EMPTY_VALUES = new Set(["-", "—", "n/a", "null", "undefined", "нет", "не указано"]);

function normalizeSingleLineText(value?: string | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value?: string | null): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeSingleLineText(line))
    .filter(Boolean)
    .join("\n");
}

function cleanOptionalText(value?: string | null, multiline = false): string | undefined {
  const normalized = multiline ? normalizeMultilineText(value) : normalizeSingleLineText(value);
  if (!normalized || PSEUDO_EMPTY_VALUES.has(normalized.toLowerCase())) {
    return undefined;
  }
  return normalized;
}

function normalizeStringArray(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeSingleLineText(value);
    const key = normalized.toLowerCase();
    if (!normalized || PSEUDO_EMPTY_VALUES.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

function normalizeReleaseCastRoleType(value?: string | null): "main" | "secondary" {
  const normalized = cleanOptionalText(value)?.toLowerCase() ?? "";
  if (normalized.includes("глав")) {
    return "main";
  }
  return "secondary";
}

interface ReleaseRoleEditorCardProps {
  item: ReleaseRoleAssignment;
  participantLabel: string;
  isEditing: boolean;
  onSave: (roleId: string, patch: Partial<ReleaseRoleAssignment>) => void;
  onStartEdit: (roleId: string) => void;
  onDelete: (roleId: string) => void;
  onOpenParticipant: (participantId: string) => void;
}

const ReleaseRoleEditorCard = memo(function ReleaseRoleEditorCard({
  item,
  participantLabel,
  isEditing,
  onSave,
  onStartEdit,
  onDelete,
  onOpenParticipant
}: ReleaseRoleEditorCardProps) {
  const [characterNames, setCharacterNames] = useState<string[]>(item.character_names.length ? [...item.character_names] : [""]);
  const [secondaryCharacterNames, setSecondaryCharacterNames] = useState<string[]>(item.secondary_character_names.length ? [...item.secondary_character_names] : [""]);

  useEffect(() => {
    setCharacterNames(item.character_names.length ? [...item.character_names] : [""]);
    setSecondaryCharacterNames(item.secondary_character_names.length ? [...item.secondary_character_names] : [""]);
  }, [
    item.id,
    item.character_names.join("\u0001"),
    item.secondary_character_names.join("\u0001")
  ]);

  function addCharacterField(kind: "main" | "secondary") {
    if (kind === "main") {
      setCharacterNames((current) => [...current, ""]);
      return;
    }
    setSecondaryCharacterNames((current) => [...current, ""]);
  }

  function removeCharacterField(kind: "main" | "secondary", index: number) {
    if (kind === "main") {
      const nextValues = characterNames.filter((_, itemIndex) => itemIndex !== index);
      setCharacterNames(nextValues.length ? nextValues : [""]);
      return;
    }
    const nextValues = secondaryCharacterNames.filter((_, itemIndex) => itemIndex !== index);
    setSecondaryCharacterNames(nextValues.length ? nextValues : [""]);
  }

  function handleSave() {
    startTransition(() => {
      onSave(item.id, {
        character_names: normalizeStringArray(characterNames),
        secondary_character_names: normalizeStringArray(secondaryCharacterNames)
      });
    });
  }

  return (
    <div className="list-item subdued">
      <div className="row spread" style={{ gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <strong>{participantLabel}</strong>
          <div className="muted">Участник команды релиза</div>
        </div>
        <Chip>Роль персонажей</Chip>
      </div>
      {isEditing ? (
        <>
          <div className="grid two">
            <Field label="Персонажи">
              <div className="section-stack">
                {characterNames.map((value, index) => (
                  <div key={`${item.id}-character-${index}`} className="row" style={{ alignItems: "center", gap: 8 }}>
                    <input
                      className="text-input"
                      value={value}
                      onChange={(event) => {
                        const nextValues = [...characterNames];
                        nextValues[index] = event.target.value;
                        setCharacterNames(nextValues);
                      }}
                    />
                    {characterNames.length > 1 ? (
                      <Button className="ghost" onClick={() => removeCharacterField("main", index)}>Убрать</Button>
                    ) : null}
                  </div>
                ))}
                <div className="row">
                  <Button className="ghost" onClick={() => addCharacterField("main")}>Добавить персонажа</Button>
                </div>
              </div>
            </Field>
            <Field label="Второстепенные персонажи">
              <div className="section-stack">
                {secondaryCharacterNames.map((value, index) => (
                  <div key={`${item.id}-secondary-character-${index}`} className="row" style={{ alignItems: "center", gap: 8 }}>
                    <input
                      className="text-input"
                      value={value}
                      onChange={(event) => {
                        const nextValues = [...secondaryCharacterNames];
                        nextValues[index] = event.target.value;
                        setSecondaryCharacterNames(nextValues);
                      }}
                    />
                    {secondaryCharacterNames.length > 1 ? (
                      <Button className="ghost" onClick={() => removeCharacterField("secondary", index)}>Убрать</Button>
                    ) : null}
                  </div>
                ))}
                <div className="row">
                  <Button className="ghost" onClick={() => addCharacterField("secondary")}>Добавить второстепенного</Button>
                </div>
              </div>
            </Field>
          </div>
          <div className="row spread">
            <div className="muted">Сначала заполните нужные поля, потом сохраните карточку роли.</div>
            <div className="row">
              <Button className="ghost" onClick={() => onOpenParticipant(item.participant_id)} disabled={!item.participant_id}>Открыть участника</Button>
              <Button className="secondary" onClick={handleSave}>Сохранить</Button>
              <Button className="danger" onClick={() => onDelete(item.id)}>Удалить роль</Button>
            </div>
          </div>
        </>
      ) : (
        <div className="section-stack">
          <div className="grid two">
            <div>
              <div className="form-label">Персонажи</div>
              <div className="muted">{normalizeStringArray(item.character_names).join(", ") || "не указаны"}</div>
            </div>
            <div>
              <div className="form-label">Второстепенные персонажи</div>
              <div className="muted">{normalizeStringArray(item.secondary_character_names).join(", ") || "не указаны"}</div>
            </div>
          </div>
          <div className="row spread">
            <div className="muted">Карточка роли сохранена и открыта в режиме просмотра.</div>
            <div className="row">
              <Button className="ghost" onClick={() => onOpenParticipant(item.participant_id)} disabled={!item.participant_id}>Открыть участника</Button>
              <Button className="secondary" onClick={() => onStartEdit(item.id)}>Редактировать</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function parseAdditionalContactEntry(value?: string | null): { label: string; value: string } {
  const normalized = normalizeSingleLineText(value);
  if (!normalized) {
    return { label: "", value: "" };
  }

  for (const separator of [" — ", ": ", " - ", "—", ":", "-"]) {
    const separatorIndex = normalized.indexOf(separator);
    if (separatorIndex <= 0) {
      continue;
    }
    const label = normalizeSingleLineText(normalized.slice(0, separatorIndex));
    const contactValue = normalizeSingleLineText(normalized.slice(separatorIndex + separator.length));
    if (label && contactValue) {
      return { label, value: contactValue };
    }
  }

  return { label: "", value: normalized };
}

function serializeAdditionalContactEntry(entry: { label?: string | null; value?: string | null }): string {
  const label = normalizeSingleLineText(entry.label);
  const value = normalizeSingleLineText(entry.value);

  if (label && value) {
    return `${label}: ${value}`;
  }
  return value || label;
}

function normalizeParticipantAggregateDraft(participant: ParticipantAggregate) {
  delete (participant.profile as unknown as Record<string, unknown>).assigned_curator_id;
  participant.profile.nickname = normalizeSingleLineText(participant.profile.nickname);
  participant.profile.display_name =
    normalizeSingleLineText(participant.profile.display_name) ||
    participant.profile.nickname ||
    "Новый участник";
  participant.profile.nickname_pronunciation = cleanOptionalText(participant.profile.nickname_pronunciation);
  participant.profile.real_name = cleanOptionalText(participant.profile.real_name);
  participant.profile.sort_order = typeof participant.profile.sort_order === "number" ? participant.profile.sort_order : null;
  const normalizedStatus = normalizeParticipantStatusId(participant.profile.participant_status_id, participant.profile.reserve_flag);
  const legacyLeftRequested = normalizedStatus === "active" && Boolean(participant.profile.left_at);
  participant.profile.participant_status_id = normalizedStatus;
  participant.profile.status =
    normalizedStatus === "archived"
      || normalizedStatus === "blocked"
      || normalizedStatus === "left"
      || legacyLeftRequested
      || participant.profile.status === "archived"
      ? "archived"
      : "active";
  participant.profile.reserve_flag = normalizedStatus === "reserve";
  if (
    normalizedStatus === "archived"
    || normalizedStatus === "blocked"
    || normalizedStatus === "left"
    || legacyLeftRequested
  ) {
    participant.profile.archived_at = participant.profile.archived_at ?? new Date().toISOString();
  } else {
    participant.profile.archived_at = null;
  }
  if (normalizedStatus === "left" || normalizedStatus === "archived" || legacyLeftRequested) {
    participant.profile.left_at = participant.profile.left_at ?? new Date().toISOString();
  } else {
    participant.profile.left_at = null;
  }
  participant.profile.availability_note = cleanOptionalText(participant.profile.availability_note, true);
  participant.profile.contact_max = cleanOptionalText(participant.profile.contact_max);
  participant.profile.contact_phone = cleanOptionalText(participant.profile.contact_phone);
  participant.profile.contact_telegram = cleanOptionalText(participant.profile.contact_telegram);
  participant.profile.contact_vk = cleanOptionalText(participant.profile.contact_vk);
  participant.profile.contact_email = cleanOptionalText(participant.profile.contact_email);
  participant.profile.contact_odnoklassniki = cleanOptionalText(participant.profile.contact_odnoklassniki);
  participant.profile.contacts = normalizeStringArray(participant.profile.contacts);
  participant.profile.posting.mention = cleanOptionalText(participant.profile.posting.mention);
  participant.profile.posting.mention_id = cleanOptionalText(participant.profile.posting.mention_id);
  participant.profile.posting.display_name_for_post = cleanOptionalText(participant.profile.posting.display_name_for_post);
  delete (participant.profile.posting as unknown as Record<string, unknown>).preferred_credit_name;
  participant.profile.posting.vk_slug = normalizeVkSlug(participant.profile.posting.vk_slug) || undefined;
  participant.profile.posting.vk_url = cleanOptionalText(participant.profile.posting.vk_url);

  participant.org.department_assignments = participant.org.department_assignments.filter((item, index, array) => {
    item.department_id = normalizeSingleLineText(item.department_id);
    item.assignment_status = normalizeDepartmentInterest(item.assignment_status);
    item.comment = cleanOptionalText(item.comment, true);
    return Boolean(item.department_id) && array.findIndex((entry) => entry.department_id === item.department_id) === index;
  });
  participant.org.role_assignments = participant.org.role_assignments.filter((item, index, array) => {
    item.role_id = normalizeSingleLineText(item.role_id);
    item.department_id = cleanOptionalText(item.department_id) ?? null;
    item.note = cleanOptionalText(item.note, true);
    item.level = normalizeParticipantRoleLevel(item.level);
    return Boolean(item.role_id) && array.findIndex((entry) => `${entry.role_id}:${entry.department_id ?? ""}:${entry.started_at ?? ""}` === `${item.role_id}:${item.department_id ?? ""}:${item.started_at ?? ""}`) === index;
  });
  delete (participant.org as unknown as Record<string, unknown>).desired_department_ids;
  participant.org.desired_role_ids = normalizeStringArray(participant.org.desired_role_ids)
    .filter((item) => PARTICIPANT_GROWTH_INTENT_OPTIONS.some((option) => option.id === item));
  participant.org.staffing_flags = normalizeStringArray(participant.org.staffing_flags);
  participant.org.skill_entries = participant.org.skill_entries.filter((item, index, array) => {
    item.skill_id = normalizeSingleLineText(item.skill_id);
    item.level = cleanOptionalText(item.level);
    item.note = cleanOptionalText(item.note, true);
    return Boolean(item.skill_id) && array.findIndex((entry) => entry.skill_id === item.skill_id) === index;
  });
  participant.org.specialization_entries = participant.org.specialization_entries.filter((item, index, array) => {
    item.specialization_id = normalizeSingleLineText(item.specialization_id);
    item.level = cleanOptionalText(item.level);
    item.comment = cleanOptionalText(item.comment, true);
    return Boolean(item.specialization_id) && array.findIndex((entry) => entry.specialization_id === item.specialization_id) === index;
  });

  participant.equipment.equipment_status = cleanOptionalText(participant.equipment.equipment_status);
  participant.equipment.microphone_type = cleanOptionalText(participant.equipment.microphone_type);
  participant.equipment.audio_interface = cleanOptionalText(participant.equipment.audio_interface);
  participant.equipment.recording_space_quality = cleanOptionalText(participant.equipment.recording_space_quality);
  participant.equipment.monitoring = cleanOptionalText(participant.equipment.monitoring);
  participant.equipment.software_stack = cleanOptionalText(participant.equipment.software_stack);
  participant.equipment.hardware_notes = cleanOptionalText(participant.equipment.hardware_notes, true);
  participant.equipment.equipment_limitations = cleanOptionalText(participant.equipment.equipment_limitations, true);

  participant.voice_sample.voice_sample_url =
    cleanOptionalText(participant.voice_sample.voice_sample_url)
    ?? cleanOptionalText(participant.voice_sample.voice_sample_storage_ref);
  participant.voice_sample.voice_sample_storage_ref = undefined;
  participant.voice_sample.voice_sample_review_status = cleanOptionalText(participant.voice_sample.voice_sample_review_status);
  participant.voice_sample.voice_sample_reviewed_by = participant.voice_sample.voice_sample_reviewed_by || null;
  participant.voice_sample.voice_sample_comment = cleanOptionalText(participant.voice_sample.voice_sample_comment, true);
  participant.voice_sample.voice_tags = normalizeStringArray(participant.voice_sample.voice_tags).map(normalizeVoiceTagId);
  participant.voice_sample.voice_sample_present = Boolean(participant.voice_sample.voice_sample_url);

  participant.notes = participant.notes
    .map((item) => ({
      ...item,
      title: normalizeSingleLineText(item.title),
      body: normalizeMultilineText(item.body),
      priority: cleanOptionalText(item.priority) as ParticipantNote["priority"] | undefined ?? item.priority
    }))
    .filter((item) => item.title || item.body);
  participant.discipline = participant.discipline
    .map((item) => ({
      ...item,
      disciplinary_type_id: normalizeSingleLineText(item.disciplinary_type_id),
      description: normalizeMultilineText(item.description),
      resolution_note: cleanOptionalText(item.resolution_note, true)
    }))
    .filter((item) => item.disciplinary_type_id || item.description);
  participant.rewards = participant.rewards
    .map((item) => ({
      ...item,
      reward_type_id: normalizeSingleLineText(item.reward_type_id),
      description: normalizeMultilineText(item.description),
      tags: normalizeStringArray(item.tags)
    }))
    .filter((item) => item.reward_type_id || item.description || item.tags.length > 0);

  applyParticipantDerivedFields(participant);
}

function normalizeReleaseAggregateDraft(release: ReleaseAggregate) {
  release.release.title_primary = normalizeSingleLineText(release.release.title_primary);
  release.release.title_secondary = cleanOptionalText(release.release.title_secondary);
  release.release.release_status_id = cleanOptionalText(release.release.release_status_id) ?? "in_work";
  release.release.sort_order = typeof release.release.sort_order === "number" ? release.release.sort_order : null;
  release.release.primary_department_id =
    normalizeSingleLineText(release.release.primary_department_id) ||
    normalizeSingleLineText(release.release.department_ids[0]) ||
    "general";
  release.release.department_ids = normalizeStringArray([
    release.release.primary_department_id,
    ...release.release.department_ids
  ]);
  release.release.curator_id = release.release.curator_id || null;
  release.release.staffing_mode = normalizeReleaseStaffingMode(
    release.release.release_status_id,
    release.release.staffing_mode
  );
  release.release.production_priority = undefined;
  release.release.top_release_flag = Boolean(release.release.top_release_flag);
  release.release.commissioned_flag = Boolean(release.release.commissioned_flag);
  release.release.training_flag = Boolean(release.release.training_flag);
  release.release.legacy_flag = Boolean(release.release.legacy_flag);
  release.release.archival_state = normalizeReleaseArchiveState(release.release.archival_state);
  release.release.status = isReleaseArchivedEntity(release.release) ? "archived" : "active";

  const legacyRoles = release.participants.flatMap((item, index) => {
    const raw = item as ReleaseParticipantAssignment & {
      role_label_override?: string;
      character_names?: string[];
      secondary_character_names?: string[];
    };
    const roleType =
      cleanOptionalText(raw.role_label_override) || (raw.character_names?.length ?? 0) > 0 || (raw.secondary_character_names?.length ?? 0) > 0
        ? normalizeReleaseCastRoleType(raw.role_label_override)
        : null;
    if (!roleType || !normalizeSingleLineText(item.participant_id)) {
      return [];
    }
    return [createReleaseRoleDraft(release.release.id, item.participant_id, "Портативный пользователь", (release.roles?.length ?? 0) + index + 1, {
      role_type: roleType,
      character_names: normalizeStringArray(raw.character_names ?? []),
      secondary_character_names: normalizeStringArray(raw.secondary_character_names ?? []),
      comment_internal: cleanOptionalText(item.comment_internal, true)
    })];
  });

  release.participants = release.participants.filter((item, index, array) => {
    item.participant_id = normalizeSingleLineText(item.participant_id);
    item.role_id = canonicalRoleId(normalizeSingleLineText(item.role_id));
    item.credit_label_override = cleanOptionalText(item.credit_label_override);
    item.display_name_override = cleanOptionalText(item.display_name_override);
    item.department_id = cleanOptionalText(item.department_id) ?? null;
    item.comment_internal = cleanOptionalText(item.comment_internal, true);
    item.credit_group_id = canonicalPostGroupId(cleanOptionalText(item.credit_group_id) ?? item.role_id);
    delete (item as ReleaseParticipantAssignment & { role_label_override?: string }).role_label_override;
    delete (item as ReleaseParticipantAssignment & { character_names?: string[] }).character_names;
    delete (item as ReleaseParticipantAssignment & { secondary_character_names?: string[] }).secondary_character_names;
    return Boolean(item.participant_id) && Boolean(item.role_id) && array.findIndex((entry) => `${entry.participant_id}:${entry.role_id}:${entry.credit_group_id}` === `${item.participant_id}:${item.role_id}:${item.credit_group_id}`) === index;
  }).sort((left, right) => {
    const orderDelta = (left.credit_order ?? Number.MAX_SAFE_INTEGER) - (right.credit_order ?? Number.MAX_SAFE_INTEGER);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
  }).map((item, index) => ({
    ...item,
    credit_order: index + 1
  }));
  const releaseTeamParticipantIds = new Set(release.participants.map((item) => item.participant_id).filter(Boolean));
  release.roles = [...(release.roles ?? []), ...legacyRoles]
    .filter((item, index, array) => {
      item.participant_id = normalizeSingleLineText(item.participant_id);
      item.role_type = normalizeReleaseCastRoleType(item.role_type);
      item.character_names = normalizeStringArray(item.character_names ?? []);
      item.secondary_character_names = normalizeStringArray(item.secondary_character_names ?? []);
      item.comment_internal = cleanOptionalText(item.comment_internal, true);
      return Boolean(item.participant_id) && releaseTeamParticipantIds.has(item.participant_id) && array.findIndex((entry) => entry.id === item.id) === index;
    })
    .sort((left, right) => {
      const orderDelta = (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
    })
    .map((item, index) => ({
      ...item,
      display_order: index + 1
    }));
  release.external = release.external.filter((item, index, array) => {
    item.external_source_id = normalizeSingleLineText(item.external_source_id);
    item.external_source_type_id = cleanOptionalText(item.external_source_type_id);
    item.credit_group_id = canonicalPostGroupId(cleanOptionalText(item.credit_group_id) ?? "external_source");
    item.credit_label_override = cleanOptionalText(item.credit_label_override);
    item.vk_mention = cleanOptionalText(item.vk_mention);
    item.vk_display_name = cleanOptionalText(item.vk_display_name);
    item.translator_names = normalizeStringArray(item.translator_names ?? []);
    item.comment_internal = cleanOptionalText(item.comment_internal, true);
    const hasMeaningfulContent = Boolean(
      item.external_source_id
      || item.credit_label_override
      || item.vk_mention
      || item.vk_display_name
      || (item.translator_names?.length ?? 0)
    );
    return hasMeaningfulContent && array.findIndex((entry) => entry.id === item.id) === index;
  }).sort((left, right) => {
    const orderDelta = (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
  }).map((item, index) => ({
    ...item,
    display_order: index + 1
  }));

  release.content.description_full = getReleaseDescriptionValue(release.content);
  release.content.description_short = "";
  release.content.country_of_origin = cleanOptionalText(release.content.country_of_origin);
  release.content.age_rating = normalizeAgeRating(release.content.age_rating, release.release.release_type_id);
  release.content.content_status_note = cleanOptionalText(release.content.content_status_note, true);
  release.content.warning_notes = cleanOptionalText(release.content.warning_notes, true);
  release.content.genre_ids = normalizeStringArray(release.content.genre_ids);
  release.content.tag_ids = normalizeStringArray(release.content.tag_ids);
  release.content.platform_links = release.content.platform_links.filter((item, index, array) => {
    item.platform_id = normalizeSingleLineText(item.platform_id);
    item.label_override = cleanOptionalText(item.label_override);
    item.url = cleanOptionalText(item.url);
    return Boolean(item.platform_id || item.url) && array.findIndex((entry) => `${entry.platform_id}:${entry.url ?? ""}` === `${item.platform_id}:${item.url ?? ""}`) === index;
  }).map((item, index) => ({
    ...item,
    display_order: index + 1
  }));
  if (release.content.platform_links.length > 0) {
    const primaryIndex =
      release.content.platform_links.findIndex((item) => item.is_primary)
      ?? -1;
    const fallbackPrimaryIndex = release.content.platform_links.findIndex((item) => item.platform_id === "kodik");
    const activePrimaryIndex = primaryIndex >= 0
      ? primaryIndex
      : fallbackPrimaryIndex >= 0
        ? fallbackPrimaryIndex
        : 0;
    release.content.platform_links = release.content.platform_links.map((item, index) => ({
      ...item,
      is_primary: index === activePrimaryIndex
    }));
  }

  release.posting.default_post_template_id = release.posting.default_post_template_id || undefined;
  release.posting.episode_label_mode = release.posting.episode_label_mode === "single" ? "single" : "range";
  release.posting.separator_pattern = getReleaseSeparator(release.posting.separator_pattern);
  release.posting.include_age_rating_in_post = release.posting.include_age_rating_in_post !== false;
  release.posting.post_header_override = cleanOptionalText(release.posting.post_header_override);
  release.posting.post_footer_override = sanitizePostFooter(cleanOptionalText(release.posting.post_footer_override, true));
  release.posting.post_platform_block_override = cleanOptionalText(release.posting.post_platform_block_override, true);
  release.posting.post_external_block_override = cleanOptionalText(release.posting.post_external_block_override, true);
  release.posting.posting_notes_internal = cleanOptionalText(release.posting.posting_notes_internal, true);
  release.posting.post_tags_override = normalizeStringArray(release.posting.post_tags_override);
}

function normalizeDirectoryEditorDraft(
  editorKey: string,
  recordDraft: DirectoryRecord | DepartmentDirectoryItem | StructurePosition | ExternalSource | PostTemplate
): DirectoryRecord | DepartmentDirectoryItem | StructurePosition | ExternalSource | PostTemplate {
  if (editorKey === "__external__") {
    const next = recordDraft as ExternalSource;
    next.status = normalizeDirectoryRecordStatus(next.status);
    next.name = normalizeSingleLineText(next.name) || "Новый источник субтитров";
    next.aliases = normalizeStringArray(next.aliases);
    next.contacts = normalizeStringArray(next.contacts);
    next.links = normalizeStringArray(next.links);
    next.preferred_post_label = cleanOptionalText(next.preferred_post_label);
    next.comment = cleanOptionalText(next.comment, true);
    return next;
  }
  if (editorKey === "__templates__") {
    const next = recordDraft as PostTemplate;
    next.status = normalizeDirectoryRecordStatus(next.status);
    next.name = normalizeSingleLineText(next.name) || "Новый шаблон поста";
    next.description = cleanOptionalText(next.description, true);
    next.footer = sanitizePostFooter(cleanOptionalText(next.footer, true)) ?? "";
    next.block_order = normalizeStringArray(next.block_order);
    if (!next.block_order.length) {
      next.block_order = ["header", "platforms", "voice_cast", "mixing", "curator", "translation", "timing", "design", "rating", "genres", "description", "tags", "footer"];
    }
    if (!next.block_order.includes("curator")) {
      const mixingIndex = next.block_order.indexOf("mixing");
      next.block_order.splice(mixingIndex >= 0 ? mixingIndex + 1 : next.block_order.length, 0, "curator");
    }
    next.block_order = reorderTemplateBlocks(next.block_order);
    next.applicable_department_ids = normalizeStringArray(next.applicable_department_ids ?? []);
    next.applicable_release_type_ids = normalizeStringArray(next.applicable_release_type_ids ?? []);
    next.role_group_labels = Object.fromEntries(
      Object.entries(next.role_group_labels ?? {})
        .map(([key, value]) => [normalizeSingleLineText(key), normalizeSingleLineText(value)])
        .filter(([key, value]) => Boolean(key) && Boolean(value))
    );
    if (!next.role_group_labels.mixing || next.role_group_labels.mixing === "Сведение") {
      next.role_group_labels.mixing = "Звукорежиссер";
    }
    if (!next.role_group_labels.curator) {
      next.role_group_labels.curator = "Куратор";
    }
    if (!next.role_group_labels.external_source || next.role_group_labels.external_source === "Субтитры") {
      next.role_group_labels.external_source = "Перевод";
    }
    return next;
  }
  if (editorKey === "departments") {
    const next = recordDraft as DepartmentDirectoryItem;
    next.status = normalizeDirectoryRecordStatus(next.status);
    next.name = normalizeSingleLineText(next.name) || "Новый отдел";
    next.short_name = normalizeSingleLineText(next.short_name) || next.name;
    next.slug = normalizeSingleLineText(next.slug) || slugify(next.name);
    next.tags = normalizeStringArray(next.tags);
    next.parent_department_id = next.parent_department_id || null;
    return next;
  }
  if (editorKey === "structure_positions") {
    const next = recordDraft as StructurePosition;
    next.status = normalizeDirectoryRecordStatus(next.status);
    next.name = normalizeSingleLineText(next.name) || "Новая должность";
    next.short_label = normalizeSingleLineText(next.short_label);
    next.department_id = normalizeSingleLineText(next.department_id);
    next.reports_to_position_id = next.reports_to_position_id || null;
    next.responsibility_scope_ids = normalizeStringArray(next.responsibility_scope_ids);
    next.description_internal = cleanOptionalText(next.description_internal, true);
    next.description_onboarding = cleanOptionalText(next.description_onboarding, true);
    return next;
  }
  const next = recordDraft as DirectoryRecord;
  next.status = normalizeDirectoryRecordStatus(next.status);
  next.name = normalizeSingleLineText(next.name) || "Новая запись";
  next.description = cleanOptionalText(next.description, true);
  next.aliases = normalizeStringArray(next.aliases ?? []);
  next.color = normalizeColorValue(next.color);
  return next;
}

function participantNeedsAttention(participant: ParticipantAggregate): boolean {
  if (isParticipantArchivedEntity(participant)) {
    return false;
  }
  return (
    !normalizeSingleLineText(participant.profile.nickname) ||
    !normalizeSingleLineText(participant.profile.display_name) ||
    participant.org.department_assignments.length === 0 ||
    participant.org.role_assignments.filter((item) => item.active).length === 0 ||
    Boolean(participant.history?.some((item) => item.source === "import")) && !participant.profile.posting.mention
  );
}

function releaseNeedsAttention(release: ReleaseAggregate): boolean {
  if (isReleaseArchivedEntity(release.release)) {
    return false;
  }
  const staffingMode = getReleaseStaffingMode(release.release);
  const requiresTeam = staffingMode !== "aligning";
  const requiresPlatforms = release.release.release_status_id !== "announcement";
  const requiresGeneratedPost = staffingMode === "confirmed";
  return (
    (!getReleaseRussianTitleValue(release.release) && !getReleaseEnglishTitleValue(release.release)) ||
    (requiresTeam && release.participants.length === 0) ||
    (requiresPlatforms && release.content.platform_links.length === 0) ||
    (requiresGeneratedPost && release.generated_posts.length === 0) ||
    (Boolean(release.history?.some((item) => item.source === "import")) && !release.posting.default_post_template_id)
  );
}

function normalizeVkSlug(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?vk\.com\//i, "")
    .replace(/^@/, "")
    .replace(/^\/+|\/+$/g, "");
}

function buildVkUrl(slug?: string | null) {
  const normalized = normalizeVkSlug(slug);
  return normalized ? `https://vk.com/${normalized}` : "";
}

function normalizeColorValue(value?: string | null): string {
  const next = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(next)) return next;
  if (/^#[0-9a-fA-F]{3}$/.test(next)) {
    return `#${next[1]}${next[1]}${next[2]}${next[2]}${next[3]}${next[3]}`;
  }
  return "#5c5f66";
}

function getShortPathLabel(value?: string | null): string {
  if (!value) return "Не подключена";
  const parts = value.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return value;
  const separator = value.includes("\\") && !value.includes("/") ? "\\" : "/";
  const prefix = value.startsWith("/") ? "/" : "";
  return `${prefix}${parts[0]}${separator}...${separator}${parts.slice(-2).join(separator)}`;
}

function applyParticipantDerivedFields(participant: ParticipantAggregate) {
  participant.profile.posting.display_name_for_post = getParticipantPostDisplayName(participant);
  participant.profile.posting.vk_slug = normalizeVkSlug(participant.profile.posting.vk_slug) || undefined;
  if (participant.profile.posting.vk_slug) {
    const currentUrl = participant.profile.posting.vk_url?.trim();
    if (!currentUrl || /vk\.com\//i.test(currentUrl)) {
      participant.profile.posting.vk_url = buildVkUrl(participant.profile.posting.vk_slug);
    }
  }
  if (!participant.profile.contact_vk?.trim()) {
    participant.profile.contact_vk = participant.profile.posting.vk_url?.trim() || undefined;
  }
  participant.voice_sample.voice_sample_url = getVoiceSampleResource(participant.voice_sample) || undefined;
  participant.voice_sample.voice_sample_storage_ref = undefined;
  if (participant.voice_sample.voice_sample_url?.trim() && !participant.voice_sample.voice_sample_uploaded_at) {
    participant.voice_sample.voice_sample_uploaded_at = new Date().toISOString();
  }
  participant.voice_sample.voice_sample_present = Boolean(participant.voice_sample.voice_sample_url?.trim());
  participant.profile.posting.post_copy_string = buildPostCopyString(participant);
}

function buildTemplatePreview(
  template: PostTemplate,
  departmentNameById: Map<string, string>,
  releaseTypeNameById: Map<string, string>
) {
  const blockOrder = normalizeStringArray(template.block_order);
  const applicableDepartments = normalizeStringArray(template.applicable_department_ids ?? []);
  const applicableReleaseTypes = normalizeStringArray(template.applicable_release_type_ids ?? []);
  const blocks = blockOrder.map(translatePostBlockId).join(" → ");
  const departments = applicableDepartments.length
    ? ` • отделы: ${applicableDepartments.map((item) => getLookupLabel(departmentNameById, item, "")).join(", ")}`
    : "";
  const releaseTypes = applicableReleaseTypes.length
    ? ` • типы: ${applicableReleaseTypes.map((item) => getLookupLabel(releaseTypeNameById, item, "")).join(", ")}`
    : "";
  return `${blocks || "Блоки не заданы"}${departments}${releaseTypes}${template.footer ? ` • нижний блок: ${template.footer}` : ""}`;
}

function buildTemplatePreviewText(
  template: PostTemplate,
  departmentNameById: Map<string, string>,
  releaseTypeNameById: Map<string, string>
) {
  const blockOrder = normalizeStringArray(template.block_order);
  const applicableDepartments = normalizeStringArray(template.applicable_department_ids ?? []);
  const applicableReleaseTypes = normalizeStringArray(template.applicable_release_type_ids ?? []);
  const lines = [
    `Блоки: ${blockOrder.length ? blockOrder.map(translatePostBlockId).join(" → ") : "не заданы"}`
  ];

  if (applicableDepartments.length) {
    lines.push(
      `Отделы: ${applicableDepartments.map((item) => getLookupLabel(departmentNameById, item, "")).join(", ")}`
    );
  }
  if (applicableReleaseTypes.length) {
    lines.push(
      `Типы релиза: ${applicableReleaseTypes.map((item) => getLookupLabel(releaseTypeNameById, item, "")).join(", ")}`
    );
  }
  if (template.footer) {
    lines.push(`Нижний блок: ${template.footer}`);
  }

  return lines.join("\n");
}

function translatePostBlockId(value?: string | null): string {
  if (!value) return "—";
  return POST_BLOCK_LABELS[value] ?? translateCode(value) ?? "Блок не указан";
}

function formatPostGroupList(values: string[]): string {
  return values.length ? values.map(translatePostBlockId).join(", ") : "основные роли закрыты";
}

function canonicalRoleId(value?: string | null): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    voice_cast: "voice_cast",
    "озвучка": "voice_cast",
    "даббер": "voice_cast",
    dubbing: "voice_cast",
    translation: "translation",
    "перевод": "translation",
    "переводчик": "translation",
    mixing: "mixing",
    "сведение": "mixing",
    "звукорежиссер": "mixing",
    "звукорежиссёр": "mixing",
    "звук": "mixing",
    timing: "mixing",
    "тайминг": "mixing",
    design: "design",
    "оформление": "design",
    "художник": "design",
    visual: "design",
    vocal: "vocal",
    "вокал": "vocal",
    "вокалист": "vocal"
  };
  return map[normalized] ?? slugify(value ?? "role");
}

function canonicalPostGroupId(value?: string | null): string {
  const normalized = normalizeLookupKey(value);
  const map: Record<string, string> = {
    ...Object.fromEntries(Object.keys(POST_BLOCK_LABELS).map((key) => [normalizeLookupKey(key), key])),
    "озвучка": "voice_cast",
    "ролиозвучивали": "voice_cast",
    "перевод": "translation",
    "сведение": "mixing",
    "тайминг": "timing",
    "оформление": "design",
    "жанр": "genres",
    "описание": "description",
    "теги": "tags",
    "нижнийблок": "footer",
    "субтитры": "external_source",
    "внешнийисточник": "external_source"
  };
  return map[normalized] ?? canonicalRoleId(value);
}

function normalizeLookupKey(value?: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .trim();
}

function translateStructureEditorKey(key: string) {
  const map: Record<string, string> = {
    "structure_map.json": "карта структуры",
    "department_profiles.json": "профили отделов",
    "position_assignments.json": "назначения",
    "substitutions.json": "замещения",
    "temporary_assignments.json": "временные назначения",
    "structure_contacts.json": "контакты структуры",
    "structure_notes.json": "заметки по структуре"
  };
  return map[key] ?? key;
}

function computeParticipantActivity(participant: ParticipantAggregate, relatedReleases: ReleaseAggregate[]): string {
  if (participant.profile.reserve_flag) return "резерв";
  if (relatedReleases.some((item) => item.release.release_status_id === "in_work")) return "в работе";
  if (relatedReleases.length > 0) return "умеренный";
  return "низкий";
}

function normalizeParticipantStatusId(statusId?: string | null, reserveFlag = false): string {
  const normalized = normalizeSingleLineText(statusId).toLowerCase();
  if (normalized === "archived") return "archived";
  if (normalized === "active") return "active";
  if (normalized === "reserve") return "reserve";
  if (normalized === "blocked") return "blocked";
  if (normalized === "left") return "left";
  if (normalized === "inactive") return "inactive";
  if (reserveFlag) return "reserve";
  return normalized || "active";
}

function getParticipantLifecycleStatus(participant: ParticipantAggregate): string {
  const normalizedStatus = normalizeParticipantStatusId(participant.profile.participant_status_id, participant.profile.reserve_flag);
  if (normalizedStatus === "blocked") {
    return "blocked";
  }
  const legacyLeftRequested = normalizedStatus === "active" && Boolean(participant.profile.left_at);
  if (normalizedStatus === "left" || legacyLeftRequested) {
    return "left";
  }
  if (normalizedStatus === "inactive" || normalizedStatus === "reserve") {
    return normalizedStatus;
  }
  if (participant.profile.status === "archived" || Boolean(participant.profile.archived_at) || normalizedStatus === "archived") {
    return "archived";
  }
  return normalizedStatus;
}

function isParticipantArchivedStatus(statusId?: string | null): boolean {
  const normalizedStatus = normalizeParticipantStatusId(statusId);
  return normalizedStatus === "archived" || normalizedStatus === "blocked" || normalizedStatus === "left";
}

function isParticipantArchivedEntity(participant: ParticipantAggregate): boolean {
  const lifecycleStatus = getParticipantLifecycleStatus(participant);
  return lifecycleStatus === "archived" || lifecycleStatus === "blocked" || lifecycleStatus === "left";
}

function getParticipantReleaseLoadLabel(releaseCount: number): string {
  if (releaseCount <= 0) return "нет";
  if (releaseCount <= 2) return "маленькая";
  if (releaseCount <= 5) return "нормальная";
  if (releaseCount <= 10) return "высокая";
  return "огромная";
}

function getParticipantDictionLevel(participant: ParticipantAggregate): string | undefined {
  return participant.org.specialization_entries.find((item) => item.specialization_id === "diction")?.level;
}

function getParticipantGrowthLabels(participant: ParticipantAggregate): string[] {
  return participant.org.desired_role_ids.map((id) => PARTICIPANT_GROWTH_INTENT_OPTIONS.find((item) => item.id === id)?.label ?? id);
}

function getParticipantReliabilityLabel(participant: ParticipantAggregate): string {
  const activeNegative = participant.discipline.filter((item) => item.active_flag).length;
  if (activeNegative >= 3) return "риск";
  if (participantHasFlag(participant, "key_member") || participantHasFlag(participant, "priority_top")) return "высокий";
  return "нормальный";
}

function serializeStable(value: unknown): string {
  return JSON.stringify(value);
}

function translateTemplateKind(value?: string): string {
  const map: Record<string, string> = {
    participants_master: "главная таблица участников",
    releases_master: "главная таблица релизов",
    department_release_board: "кураторская таблица релизов отдела",
    new_participant_form: "анкета нового участника",
    mixed_historical: "смешанная историческая таблица",
    fronda_exchange_bundle: "единый экспорт FRONDA",
    unknown: "неизвестный шаблон"
  };
  return value ? map[value] ?? value : "не определен";
}

function translateImportSectionKind(value?: string): string {
  const map: Record<string, string> = {
    participants: "участники",
    releases: "релизы",
    relations: "связи",
    mixed: "смешанный раздел",
    archive: "архив",
    notes: "заметки",
    discipline: "дисциплина",
    rewards: "награды",
    external: "субтитры",
    unknown: "неопределенный раздел"
  };
  return value ? map[value] ?? value : "раздел не определен";
}

function matchesImportScope(
  sourceRefs: ImportSourceRef[] | undefined,
  selectedSheetName: string,
  selectedSection:
    | {
        row_start: number;
        row_end: number;
      }
    | null
) {
  if (!selectedSheetName) return true;
  const refs = sourceRefs?.filter((item) => item.sheet_name === selectedSheetName) ?? [];
  if (!refs.length) return false;
  if (!selectedSection) return true;
  return refs.some(
    (item) => item.row_number >= selectedSection.row_start && item.row_number <= selectedSection.row_end
  );
}

function formatImportSectionRange(rowStart: number, rowEnd: number) {
  return rowStart === rowEnd ? `строка ${rowStart}` : `строки ${rowStart}-${rowEnd}`;
}

function formatImportSourceRefs(sourceRefs: ImportSourceRef[]) {
  if (!sourceRefs.length) return "источник не указан";
  return sourceRefs
    .map((item) => `${item.sheet_name}: ${item.row_number}`)
    .join(" • ");
}

function formatImportConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function importConfidenceTone(confidence: number): "success" | "warning" | "danger" {
  if (confidence >= 0.85) return "success";
  if (confidence >= 0.65) return "warning";
  return "danger";
}

function describeImportConfidence(confidence: number): string {
  if (confidence >= 0.85) return "уверенно";
  if (confidence >= 0.65) return "нужно проверить";
  return "сомнительно";
}

function formatListSummary(values: string[] | undefined, fallback = "не указано") {
  return values && values.length ? values.join(", ") : fallback;
}

function describeImportNextStep(kind: ImportReviewEntityKind, hasDuplicates = false) {
  if (kind === "issue") return "Проверьте строки-источники и разбор заголовков, затем пересоберите предпросмотр.";
  if (kind === "duplicate") return "Сравните найденное совпадение с текущими данными и выберите, обновлять ли существующую запись.";
  if (hasDuplicates) return "Сначала проверьте совпадения. Если они корректны, обновляйте существующие записи вместо создания дублей.";
  if (kind === "relation") return "Проверьте, правильно ли связаны участник, релиз и роль, затем применяйте импорт.";
  if (kind === "external") return "Проверьте подпись источника и связи с релизом, затем создайте или обновите источник.";
  return "Проверьте поля и источник данных. Если все верно, запись можно создать или обновить.";
}

function translateParticipantPreset(value: "all" | "problem" | "top" | "archive" | "inactive" | "reliable"): string {
  const map = {
    all: "весь состав",
    problem: "проблемные",
    top: "важные релизы",
    archive: "архив",
    inactive: "малоактивные",
    reliable: "надежные"
  } as const;
  return map[value];
}

function translateReleaseQuickView(value: "all" | "in_work" | "completed" | "lost" | "archived" | "missing_post" | "missing_team"): string {
  const map = {
    all: "все релизы",
    in_work: "активные",
    completed: "завершенные",
    lost: "утерянные",
    archived: "архивные",
    missing_post: "без поста",
    missing_team: "без полного состава"
  } as const;
  return map[value];
}

function translateStatisticsGroup(group: "status" | "department" | "year" | "type" | "problem"): string {
  const map = {
    status: "По статусам",
    department: "По отделам",
    year: "По годам",
    type: "По типам",
    problem: "Проблемные релизы"
  } as const;
  return map[group];
}

function ImportParticipantsPreview({
  preview,
  onSelectTarget,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onSelectTarget: (id: string) => void;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="list compact-list">
      {preview.structured.participants.length ? preview.structured.participants.map((item) => (
        <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
          <div className="row spread">
            <div>
              <strong>{item.display_label}</strong>
              <div className="muted" title={item.mention || item.vk_url || "без ссылки и упоминания"}>
                {item.mention || item.vk_url || "без ссылки и упоминания"} • {describeImportConfidence(item.confidence)} • {formatImportConfidence(item.confidence)}
              </div>
            </div>
            <Chip tone={item.duplicate_matches.length ? "warning" : "success"}>{item.duplicate_matches.length ? "есть дубль" : "новый"}</Chip>
          </div>
          <div className="muted">роли: {formatListSummary(item.role_ids.map((value) => translateCode(value) || ""), "не указаны")} • отделы: {formatListSummary(item.department_ids.map((value) => translateCode(value) || ""), "не указаны")}</div>
          <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          <div className="muted">{item.confidence_reasons.join(" ")}</div>
          {item.duplicate_matches.length ? (
            <div className="section-stack compact" style={{ marginTop: 10 }}>
              {item.duplicate_matches.map((match) => (
                <div key={match.id} className="compact-row">
                  <span className="muted">{match.matched_label} • {match.reason}</span>
                  {match.domain === "participant" && match.matched_entity_id ? (
                    <Button className="ghost" onClick={() => onSelectTarget(match.matched_entity_id!)}>Использовать для обновления</Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )) : <EmptyState title="Участники не распознаны" body="В этом файле не найдено достаточно признаков участника." />}
    </div>
  );
}

function ImportReleasesPreview({
  preview,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="list compact-list">
      {preview.structured.releases.length ? preview.structured.releases.map((item) => (
        <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
          <div className="row spread">
            <div>
              <strong>{getReleaseDisplayTitle(item)}</strong>
              <div className="muted">
                {translateCode(item.primary_department_id) || "отдел не определен"} • {translateCode(item.release_status_id) || "статус не определен"} • {describeImportConfidence(item.confidence)} • {formatImportConfidence(item.confidence)}
              </div>
            </div>
            <Chip tone={item.duplicate_matches.length ? "warning" : "success"}>{item.duplicate_matches.length ? "есть дубль" : "новый"}</Chip>
          </div>
          <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          <div className="muted">площадки: {formatListSummary(item.platform_labels, "не указаны")} • жанры: {formatListSummary(item.genre_labels, "не указаны")}</div>
          {item.duplicate_matches.length ? <div className="muted">совпадения: {item.duplicate_matches.map((match) => match.matched_label).join(" • ")}</div> : null}
          <div className="muted">{item.confidence_reasons.join(" ")}</div>
        </div>
      )) : <EmptyState title="Релизы не распознаны" body="В этом файле не найдено достаточно признаков релиза." />}
    </div>
  );
}

function ImportRelationsPreview({
  preview,
  onOpenParticipant,
  onOpenRelease,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onOpenParticipant: (id: string) => void;
  onOpenRelease: (id: string) => void;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="list compact-list">
      {preview.structured.relations.length ? preview.structured.relations.map((item) => (
        <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
          <div className="muted">роли: {formatListSummary(item.role_labels, "не указаны")} • {describeImportConfidence(item.confidence)} • {formatImportConfidence(item.confidence)}</div>
          <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          <div className="muted">{item.confidence_reasons.join(" ")}</div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {item.participant_match_id ? <Button className="ghost" onClick={() => onOpenParticipant(item.participant_match_id!)}>Открыть совпавшего участника</Button> : null}
            {item.release_match_id ? <Button className="ghost" onClick={() => onOpenRelease(item.release_match_id!)}>Открыть совпавший релиз</Button> : null}
          </div>
        </div>
      )) : <EmptyState title="Связи не найдены" body="Здесь появятся связи участник ↔ релиз и источник субтитров ↔ релиз." />}
    </div>
  );
}

function ImportDuplicatesPreview({
  preview,
  onOpenParticipant,
  onOpenRelease,
  onSelectTarget,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onOpenParticipant: (id: string) => void;
  onOpenRelease: (id: string) => void;
  onSelectTarget: (id: string) => void;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="list compact-list">
      {preview.structured.duplicates.length ? preview.structured.duplicates.map((item) => (
        <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
          <div className="row spread">
            <div>
              <strong>{item.matched_label}</strong>
              <div className="muted">{item.reason} • уверенность {formatImportConfidence(item.confidence)}</div>
            </div>
            {item.domain === "participant" && item.matched_entity_id ? <Button className="ghost" onClick={() => onOpenParticipant(item.matched_entity_id!)}>Открыть</Button> : null}
            {item.domain === "release" && item.matched_entity_id ? <Button className="ghost" onClick={() => onOpenRelease(item.matched_entity_id!)}>Открыть</Button> : null}
          </div>
          {item.domain === "participant" && item.matched_entity_id ? (
            <div className="row" style={{ marginTop: 10 }}>
              <Button className="secondary" onClick={() => onSelectTarget(item.matched_entity_id!)}>Выбрать как цель обновления</Button>
            </div>
          ) : null}
        </div>
      )) : <EmptyState title="Дубли не найдены" body="Алгоритм не нашел явных совпадений по участникам, релизам и внешним источникам." />}
    </div>
  );
}

function ImportIssuesPreview({
  preview,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="section-stack">
      <div className="list compact-list">
        {preview.structured.issues.length ? preview.structured.issues.map((item) => (
          <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
            <div className="row spread">
              <strong>{item.code}</strong>
              <Chip tone={item.severity === "error" ? "danger" : item.severity === "warning" ? "warning" : "success"}>{translateCode(item.severity)}</Chip>
            </div>
            <div className="muted">{item.message}</div>
            <div className="muted">{item.source_sheet ? `лист: ${item.source_sheet}` : "лист не указан"} • {item.source_rows.length ? formatImportSectionRange(Math.min(...item.source_rows), Math.max(...item.source_rows)) : "строки не указаны"}</div>
          </div>
        )) : <EmptyState title="Ошибок нет" body="Сигнатура файла и распознавание сущностей отработали без критических замечаний." />}
      </div>
      {preview.structured.unknown_rows.length ? (
        <details className="detail-disclosure">
          <summary className="disclosure-summary">
            <strong>Строки для ручной проверки</strong>
            <span className="muted">Нераспознанные строки и их исходные значения.</span>
          </summary>
          <div className="detail-disclosure-body">
            <textarea className="text-area json-box" value={toPrettyJson(preview.structured.unknown_rows)} readOnly />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ImportNotesPreview({
  preview,
  selectedEntity,
  onSelectItem
}: {
  preview: ImportPreview;
  selectedEntity: SelectedImportReviewEntity | null;
  onSelectItem: (selection: SelectedImportReviewEntity) => void;
}) {
  return (
    <div className="section-stack">
      <div className="details-grid">
        <div className="detail-card"><h4>Заметки</h4><div className="muted">{preview.structured.notes.length}</div></div>
        <div className="detail-card"><h4>Дисциплина</h4><div className="muted">{preview.structured.discipline.length}</div></div>
        <div className="detail-card"><h4>Награды</h4><div className="muted">{preview.structured.rewards.length}</div></div>
      </div>
      <div className="list compact-list">
        {preview.structured.notes.map((item) => (
          <div key={item.id} className={`list-item subdued ${selectedEntity?.kind === "note" && selectedEntity.id === item.id ? "active" : ""}`} onClick={() => onSelectItem({ kind: "note", id: item.id })}>
            <strong>{item.title}</strong>
            <div className="muted">{item.body}</div>
            <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          </div>
        ))}
        {preview.structured.discipline.map((item) => (
          <div key={item.id} className={`list-item subdued ${selectedEntity?.kind === "discipline" && selectedEntity.id === item.id ? "active" : ""}`} onClick={() => onSelectItem({ kind: "discipline", id: item.id })}>
            <div className="row spread">
              <strong>{translateCode(item.severity)}</strong>
              <Chip tone={item.severity === "warning" || item.severity === "remark" ? "warning" : "danger"}>{translateCode(item.severity)}</Chip>
            </div>
            <div className="muted">{item.description}</div>
            <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          </div>
        ))}
        {preview.structured.rewards.map((item) => (
          <div key={item.id} className={`list-item subdued ${selectedEntity?.kind === "reward" && selectedEntity.id === item.id ? "active" : ""}`} onClick={() => onSelectItem({ kind: "reward", id: item.id })}>
            <strong>{item.description}</strong>
            <div className="muted">теги: {formatListSummary(item.tags, "не указаны")}</div>
            <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          </div>
        ))}
        {!preview.structured.notes.length && !preview.structured.discipline.length && !preview.structured.rewards.length ? (
          <EmptyState title="Дополнительные записи не найдены" body="Здесь появятся заметки, дисциплинарные события и награды, если они будут найдены в выбранной области файла." />
        ) : null}
      </div>
    </div>
  );
}

function ImportExternalPreview({
  preview,
  onSelectItem,
  selectedId
}: {
  preview: ImportPreview;
  onSelectItem: (id: string) => void;
  selectedId?: string;
}) {
  return (
    <div className="list compact-list">
      {preview.structured.external_sources.length ? preview.structured.external_sources.map((item) => (
        <div key={item.id} className={`list-item subdued ${selectedId === item.id ? "active" : ""}`} onClick={() => onSelectItem(item.id)}>
          <strong>{item.label}</strong>
          <div className="muted">{item.duplicate_matches.length ? "совпал с существующим источником" : "будет создан как новый источник"} • {describeImportConfidence(item.confidence)} • {formatImportConfidence(item.confidence)}</div>
          <div className="muted">источник: {formatImportSourceRefs(item.source_refs)}</div>
          <div className="muted">{item.confidence_reasons.join(" ")}</div>
        </div>
      )) : <EmptyState title="Источники субтитров не найдены" body="Здесь появятся группы субтитров, переводчики и партнерские команды." />}
    </div>
  );
}

function createDraftId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function createRecordMeta<T extends string>(prefix: T, actor = "Портативный пользователь") {
  const now = new Date().toISOString();
  return {
    id: createDraftId(prefix),
    schema_version: 1,
    record_revision: 1,
    created_at: now,
    updated_at: now,
    updated_by: actor,
    status: "active" as const,
    archived_at: null
  };
}

function createEntityManifestDraft(entityType: string, entityId: string, files: string[], actor = "Портативный пользователь"): EntityManifest {
  return {
    entity_id: entityId,
    entity_type: entityType,
    entity_revision: 1,
    files,
    updated_at: new Date().toISOString(),
    updated_by: actor,
    last_commit_id: null
  };
}

function createHistoryEntryDraft({
  actor,
  action,
  entityType,
  entityId,
  summary
}: {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}): EntityHistoryEntry {
  return {
    id: createDraftId("hist"),
    at: new Date().toISOString(),
    actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    source: "manual",
    summary
  };
}

function createEmptyParticipantAggregate(actor = "Портативный пользователь"): ParticipantAggregate {
  const profileBase = createRecordMeta("prt", actor);
  const profileId = profileBase.id;
  const draft: ParticipantAggregate = {
    entity_manifest: createEntityManifestDraft("participant", profileId, [
      "entity_manifest.json",
      "profile.json",
      "org.json",
      "equipment.json",
      "voice_sample.json",
      "notes.json",
      "discipline.json",
      "rewards.json",
      "history.jsonl"
    ], actor),
    profile: {
      ...profileBase,
      nickname: "",
      nickname_pronunciation: "",
      real_name: "",
      display_name: "Новый участник",
      participant_status_id: "active",
      sort_order: null,
      reserve_flag: false,
      joined_at: new Date().toISOString(),
      availability_note: "",
      contact_max: "",
      contact_phone: "",
      contact_telegram: "",
      contact_vk: "",
      contact_email: "",
      contact_odnoklassniki: "",
      contacts: [],
      posting: {}
    },
    org: {
      ...createRecordMeta("org", actor),
      department_assignments: [],
      role_assignments: [],
      desired_role_ids: [],
      skill_entries: [],
      specialization_entries: [],
      staffing_flags: []
    },
    equipment: {
      ...createRecordMeta("eq", actor)
    },
    voice_sample: {
      ...createRecordMeta("voice", actor),
      voice_sample_present: false,
      voice_tags: []
    },
    notes: [],
    discipline: [],
    rewards: [],
    history: [createHistoryEntryDraft({ actor, action: "create", entityType: "participant", entityId: profileId, summary: "Создана новая карточка участника" })]
  };
  applyParticipantDerivedFields(draft);
  return draft;
}

function cloneParticipantAggregateDraft(source: ParticipantAggregate, actor = "Портативный пользователь"): ParticipantAggregate {
  const next = cloneJson(source);
  const profileBase = createRecordMeta("prt", actor);
  next.profile = {
    ...next.profile,
    ...profileBase,
    nickname: `${next.profile.nickname || "participant"}_copy`,
    display_name: `${next.profile.display_name} (копия)`,
    sort_order: null
  };
  next.entity_manifest = createEntityManifestDraft("participant", next.profile.id, next.entity_manifest.files, actor);
  next.notes = next.notes.map((item) => ({ ...item, ...createRecordMeta("note", actor), participant_id: next.profile.id }));
  next.discipline = next.discipline.map((item) => ({ ...item, ...createRecordMeta("disc", actor), participant_id: next.profile.id }));
  next.rewards = next.rewards.map((item) => ({ ...item, ...createRecordMeta("reward", actor), participant_id: next.profile.id }));
  next.history = [createHistoryEntryDraft({ actor, action: "clone", entityType: "participant", entityId: next.profile.id, summary: "Карточка участника клонирована как новый черновик" })];
  return next;
}

function createParticipantNoteDraft(participantId: string, actor = "Портативный пользователь"): ParticipantNote {
  return {
    ...createRecordMeta("note", actor),
    participant_id: participantId,
    note_type_id: "working",
    title: "Новая заметка",
    body: "",
    author_id: null,
    priority: "normal",
    pinned: false,
    visibility_scope: "OPS",
    review_date: null,
    resolved_at: null,
    active_flag: true,
    related_department_id: null
  };
}

function createDisciplinaryEventDraft(participantId: string, severity: DisciplinaryEvent["severity"], actor = "Портативный пользователь"): DisciplinaryEvent {
  return {
    ...createRecordMeta("disc", actor),
    participant_id: participantId,
    disciplinary_type_id: severity,
    severity,
    date: new Date().toISOString(),
    author_id: null,
    description: "",
    evidence_ref: "",
    active_flag: true,
    expires_at: null,
    resolution_note: ""
  };
}

function createRewardEventDraft(participantId: string, actor = "Портативный пользователь"): RewardEvent {
  return {
    ...createRecordMeta("reward", actor),
    participant_id: participantId,
    reward_type_id: "positive_note",
    date: new Date().toISOString(),
    author_id: null,
    description: "Новая награда / положительная пометка",
    value: null,
    tags: []
  };
}

function getDefaultReleaseTypeId(departmentId?: string): string {
  const map: Record<string, string> = {
    dep_anime: "anime",
    dep_ongoings: "ongoing",
    dep_serials: "series",
    dep_films: "film",
    dep_dorama: "dorama",
    dep_books: "book",
    dep_funny: "funny",
    dep_erotica: "anime"
  };
  return departmentId ? (map[departmentId] ?? "anime") : "anime";
}

function createEmptyReleaseAggregate(actor = "Портативный пользователь", departmentId?: string, templateId?: string): ReleaseAggregate {
  const releaseBase = createRecordMeta("rel", actor);
  const releaseId = releaseBase.id;
  return {
    entity_manifest: createEntityManifestDraft("release", releaseId, [
      "entity_manifest.json",
      "release.json",
      "participants.json",
      "roles.json",
      "external.json",
      "content.json",
      "posting.json",
      "history.jsonl"
    ], actor),
    release: {
      ...releaseBase,
      title_primary: "",
      title_secondary: "",
      short_title: "",
      release_type_id: getDefaultReleaseTypeId(departmentId),
      release_status_id: "in_work",
      sort_order: null,
      staffing_mode: "confirmed",
      primary_department_id: departmentId ?? "general",
      department_ids: departmentId ? [departmentId] : [],
      curator_id: null,
      co_curator_ids: [],
      commissioned_flag: false,
      top_release_flag: false,
      training_flag: false,
      legacy_flag: false,
      archival_state: "normal",
      release_visibility: "internal",
      season_number: null,
      episode_start: null,
      episode_end: null,
      episode_count: null,
      release_year: new Date().getFullYear(),
      first_publish_date: null,
      last_update_date: null
    },
    participants: [],
    roles: [],
    external: [],
    content: {
      ...createRecordMeta("content", actor),
      release_id: releaseId,
      description_short: "",
      description_full: "",
      post_description_override: "",
      warning_notes: "",
      genre_ids: [],
      tag_ids: [],
      platform_links: [{
        platform_id: "kodik",
        url: "",
        label_override: "",
        display_order: 1,
        is_primary: true,
        active_flag: true
      }],
      country_of_origin: "",
      age_rating: "",
      content_status_note: ""
    },
    posting: {
      ...createRecordMeta("posting", actor),
      release_id: releaseId,
      default_post_template_id: templateId ?? null,
      episode_label_mode: "range",
      separator_pattern: POST_SEPARATOR_OPTIONS[0],
      include_age_rating_in_post: true,
      post_header_override: "",
      post_description_override: "",
      post_tags_override: [],
      post_platform_block_override: "",
      post_external_block_override: "",
      post_footer_override: "",
      hide_empty_blocks_flag: true,
      posting_notes_internal: ""
    },
    generated_posts: [],
    history: [createHistoryEntryDraft({ actor, action: "create", entityType: "release", entityId: releaseId, summary: "Создана новая карточка релиза" })]
  };
}

function cloneReleaseAggregateDraft(source: ReleaseAggregate, actor = "Портативный пользователь"): ReleaseAggregate {
  const next = cloneJson(source);
  const releaseBase = createRecordMeta("rel", actor);
  next.release = {
    ...next.release,
    ...releaseBase,
    title_primary: next.release.title_primary
      ? `${next.release.title_primary} (копия)`
      : next.release.title_secondary
        ? ""
        : "Копия релиза"
  };
  if (!next.release.title_primary && next.release.title_secondary) {
    next.release.title_secondary = `${next.release.title_secondary} (копия)`;
  }
  next.entity_manifest = createEntityManifestDraft("release", next.release.id, next.entity_manifest.files, actor);
  next.content = { ...next.content, ...createRecordMeta("content", actor), release_id: next.release.id };
  next.posting = { ...next.posting, ...createRecordMeta("posting", actor), release_id: next.release.id };
  next.participants = next.participants.map((item, index) => ({ ...item, ...createRecordMeta("rpa", actor), release_id: next.release.id, credit_order: index + 1 }));
  next.roles = (next.roles ?? []).map((item, index) => ({ ...item, ...createRecordMeta("rrl", actor), release_id: next.release.id, display_order: index + 1 }));
  next.external = next.external.map((item, index) => ({ ...item, ...createRecordMeta("rea", actor), release_id: next.release.id, display_order: index + 1 }));
  next.generated_posts = [];
  next.history = [createHistoryEntryDraft({ actor, action: "clone", entityType: "release", entityId: next.release.id, summary: "Карточка релиза клонирована" })];
  return next;
}

function createReleaseParticipantDraft(releaseId: string, participantId: string, roleId: string, departmentId: string | null | undefined, actor = "Портативный пользователь", order = 1): ReleaseParticipantAssignment {
  return {
    ...createRecordMeta("rpa", actor),
    release_id: releaseId,
    participant_id: participantId,
    role_id: canonicalRoleId(roleId),
    credit_group_id: canonicalPostGroupId(roleId),
    credit_label_override: "",
    display_name_override: "",
    department_id: departmentId ?? null,
    credit_order: order,
    is_primary_for_role: true,
    include_in_post: true,
    include_in_internal_stats: true,
    comment_internal: "",
    active_flag: true
  };
}

function createReleaseRoleDraft(
  releaseId: string,
  participantId: string,
  actor = "Портативный пользователь",
  order = 1,
  overrides?: Partial<ReleaseRoleAssignment>
): ReleaseRoleAssignment {
  const next: ReleaseRoleAssignment = {
    ...createRecordMeta("rrl", actor),
    release_id: releaseId,
    participant_id: participantId,
    role_type: "secondary",
    character_names: [],
    secondary_character_names: [],
    display_order: order,
    comment_internal: "",
    active_flag: true,
    ...overrides
  };
  next.role_type = normalizeReleaseCastRoleType(next.role_type);
  next.character_names = normalizeStringArray(next.character_names ?? []);
  next.secondary_character_names = normalizeStringArray(next.secondary_character_names ?? []);
  next.comment_internal = cleanOptionalText(next.comment_internal, true);
  return next;
}

function createReleaseExternalDraft(
  releaseId: string,
  externalSourceId: string,
  actor = "Портативный пользователь",
  order = 1,
  externalSourceTypeId: ReleaseExternalVariantId | "" = ""
): ReleaseExternalAssignment {
  return {
    ...createRecordMeta("rea", actor),
    release_id: releaseId,
    external_source_id: externalSourceId,
    external_source_type_id: externalSourceTypeId || null,
    credit_group_id: "субтитры",
    credit_label_override: "",
    vk_mention: "",
    vk_display_name: "",
    translator_names: [],
    display_order: order,
    include_in_post: true,
    is_primary_source: order === 1,
    comment_internal: ""
  };
}

function createPlatformLinkDraft(platformId = "", order = 1, isPrimary = order === 1 || platformId === "kodik"): ReleaseContent["platform_links"][number] {
  return {
    platform_id: platformId,
    url: "",
    label_override: "",
    display_order: order,
    is_primary: isPrimary,
    active_flag: true
  };
}

function createDepartmentDraft(name: string, shortName: string, actor = "Портативный пользователь", sortOrder = 1): DepartmentDirectoryItem {
  return {
    ...createRecordMeta("dep", actor),
    name,
    short_name: shortName,
    slug: slugify(name),
    department_type_id: "department",
    parent_department_id: null,
    onboarding_visible_flag: false,
    sort_order: sortOrder,
    tags: []
  };
}

function createDepartmentProfileDraft(departmentId: string): DepartmentProfile {
  return {
    department_id: departmentId,
    description_internal: "",
    description_onboarding: "",
    responsibility_summary: "",
    default_contact_participant_id: null,
    onboarding_visible_flag: false
  };
}

function createStructurePositionDraft(departmentId: string, name: string, actor = "Портативный пользователь", sortOrder = 1, positionType = "worker"): StructurePosition {
  return {
    ...createRecordMeta("pos", actor),
    department_id: departmentId,
    name,
    short_label: name,
    position_type_id: positionType,
    reports_to_position_id: null,
    is_leadership: positionType === "leadership",
    is_curator: positionType === "curator",
    is_admin: positionType === "admin",
    is_single_seat: true,
    can_have_multiple_holders: false,
    responsibility_scope_ids: [],
    onboarding_visible_flag: false,
    sort_order: sortOrder,
    description_internal: "",
    description_onboarding: ""
  };
}

function createPositionAssignmentEntry(departmentId: string, positionId: string, participantId: string, actor = "Портативный пользователь", assignmentKind: PositionAssignment["assignment_kind"] = "permanent"): PositionAssignment {
  return {
    ...createRecordMeta("assign", actor),
    position_id: positionId,
    participant_id: participantId,
    department_id: departmentId,
    assignment_kind: assignmentKind,
    started_at: new Date().toISOString(),
    planned_end_at: null,
    ended_at: null,
    active_flag: true,
    appointed_by: null,
    reason: "",
    comment_internal: "",
    visible_in_onboarding: false
  };
}

function createSubstitutionEntry(departmentId: string, positionId: string, participantId: string, actor = "Портативный пользователь"): Substitution {
  return {
    ...createRecordMeta("subst", actor),
    source_position_id: positionId,
    source_assignment_id: null,
    substitute_participant_id: participantId,
    substitute_position_id: null,
    department_id: departmentId,
    started_at: new Date().toISOString(),
    planned_end_at: null,
    ended_at: null,
    reason: "Временное замещение",
    visible_in_onboarding: false,
    comment_internal: ""
  };
}

function createTemporaryAssignmentEntry(departmentId: string, participantId: string, actor = "Портативный пользователь", reason = "Временно исполняет обязанности", positionId?: string): TemporaryAssignment {
  return {
    ...createRecordMeta("temp", actor),
    participant_id: participantId,
    department_id: departmentId,
    position_id: positionId ?? null,
    responsibility_scope_id: null,
    started_at: new Date().toISOString(),
    planned_end_at: null,
    ended_at: null,
    granted_by: null,
    reason,
    permissions_note: "",
    visible_in_onboarding: false
  };
}

function createDirectoryRecordDraft(actor = "Портативный пользователь", nameHint = "directory"): DirectoryRecord {
  return {
    ...createRecordMeta("dir", actor),
    name: `Новая запись (${nameHint})`,
    description: "",
    archived: false,
    aliases: [],
    color: ""
  };
}

function createExternalSourceDraft(actor = "Портативный пользователь"): ExternalSource {
  return {
    ...createRecordMeta("ext", actor),
    external_source_type_id: "fsg",
    name: "Новый источник субтитров",
    aliases: [],
    contacts: [],
    links: [],
    preferred_post_label: "",
    comment: ""
  };
}

function createPostTemplateDraft(actor = "Портативный пользователь"): PostTemplate {
  return {
    ...createRecordMeta("tpl", actor),
    name: "Новый шаблон поста",
    template_type: "standard_release_post",
    description: "",
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
    applicable_department_ids: [],
    applicable_release_type_ids: [],
    footer: ""
  };
}

function sanitizePostFooter(value?: string | null): string | undefined {
  const normalized = cleanOptionalText(value, true);
  return normalized && /^fronda$/i.test(normalized) ? "" : normalized;
}

function reorderTemplateBlocks(blockOrder: string[]): string[] {
  const next = [...normalizeStringArray(blockOrder)];
  moveBlockAfterId(next, "mixing", "voice_cast");
  moveBlockAfterId(next, "curator", "mixing");
  moveBlockAfterId(next, "translation", next.includes("curator") ? "curator" : "mixing");
  return Array.from(new Set(next));
}

function moveBlockAfterId(values: string[], targetId: string, afterId: string): void {
  const targetIndex = values.indexOf(targetId);
  const afterIndex = values.indexOf(afterId);
  if (targetIndex < 0 || afterIndex < 0 || targetIndex === afterIndex + 1) {
    return;
  }
  values.splice(targetIndex, 1);
  const refreshedAfterIndex = values.indexOf(afterId);
  values.splice(refreshedAfterIndex + 1, 0, targetId);
}

function splitCsv(value: string): string[] {
  return normalizeStringArray(value.split(/[,;\n]+/));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function translateCode(value?: string | null): string {
  if (!value) return "—";
  const map: Record<string, string> = {
    all: "все",
    active: "активный",
    reserve: "резерв",
    blocked: "заблокирован",
    left: "ушедший",
    archived: "архивный",
    announcement: "анонс",
    in_work: "активный",
    completed: "завершен",
    frozen: "заморожен",
    lost: "утерян",
    anime: "аниме",
    ongoing: "онгоинги",
    series: "сериалы",
    film: "фильм",
    dorama: "дорама",
    book: "книга",
    funny: "смешная озвучка",
    standard_release: "основной релиз",
    problem: "проблемные",
    top: "важные релизы",
    archive: "архивные",
    inactive: "неактивный",
    reliable: "надежные",
    missing_post: "без поста",
    missing_team: "без полного состава",
    canceled: "отменен",
    incoming: "входящие",
    pending: "ожидает проверки",
    review: "ручная проверка",
    resolved: "обработан",
    rejected: "отклонен",
    clean: "нормально",
    commit_pending: "ожидает завершения записи",
    repair_required: "требует восстановления",
    error: "ошибка",
    warning: "предупреждение",
    remark: "замечание",
    blacklist: "черный список",
    block: "блокировка",
    info: "информация",
    low: "низкий",
    normal: "нормальный",
    high: "повышенный",
    urgent: "срочный",
    commercial: "заказные проекты",
    both: "важные и заказные",
    full: "полный комплект",
    limited: "ограниченный комплект",
    needs_check: "нужна проверка",
    no_mic: "без микрофона",
    good: "хорошо",
    acceptable: "приемлемо",
    needs_work: "нужно доработать",
    new: "новая",
    in_review: "на проверке",
    approved: "одобрена",
    recheck: "нужна повторная проверка",
    permanent: "постоянное",
    acting: "временное исполнение",
    temporary: "временное",
    backup: "подмена",
    internship: "стажировка",
    assistant: "помощник",
    department: "основной отдел",
    release_unit: "релизный блок",
    support: "поддержка",
    leadership: "руководство",
    curator: "кураторство",
    admin: "администрирование",
    standard_release_post: "основной релизный пост",
    short_release_post: "короткий релизный пост",
    announcement_post: "анонс",
    custom: "свободный шаблон",
    RW_IN_SYNC: "синхронизировано",
    RO_STALE: "нужно обновление",
    RO_LOCKED_ENTITY: "запись занята",
    RO_CONFLICT: "есть конфликт",
    RO_RECOVERY: "нужна проверка",
    RO_OFFLINE: "только чтение",
    RO_PERMISSION: "нет доступа",
    RO_SCHEMA_MISMATCH: "версия не совпадает",
    RO_COMMIT_PENDING: "запись не завершена",
    manual: "вручную",
    import: "импорт",
    restore: "восстановление",
    system: "система",
    git: "архив Git",
    participant: "участник",
    release: "релиз",
    external: "субтитры",
    participates: "участвует",
    abstains: "воздерживается",
    can_help: "может",
    optional: "по желанию",
    declined: "нет",
    guided_work: "хочет работать под режиссурой",
    learn_new: "хочет научиться новому",
    bad: "плохая",
    okay: "неплохая",
    worker: "рабочая должность"
  };
  return map[value] ?? value;
}

function translateTemplateType(value?: string | null): string {
  return translateCode(value);
}

function shortSyncLabel(syncStatus: SyncStatus): string {
  const map: Partial<Record<SyncStatus["mode"], string>> = {
    RW_IN_SYNC: "Синхронизировано",
    RO_STALE: "Нужно обновление",
    RO_LOCKED_ENTITY: "Запись занята",
    RO_CONFLICT: "Есть конфликт",
    RO_RECOVERY: "Нужна проверка",
    RO_OFFLINE: "Только чтение",
    RO_PERMISSION: "Нет доступа",
    RO_SCHEMA_MISMATCH: "Версия не совпадает",
    RO_COMMIT_PENDING: "Запись не завершена"
  };
  return map[syncStatus.mode] ?? translateCode(syncStatus.mode);
}

function normalizeSyncText(value?: string | null): string {
  const text = (value ?? "").trim();
  if (!text) {
    return "";
  }
  if (
    /UNKNOWN:\s*unknown error,\s*read/i.test(text)
    || /\bunknown error,\s*read\b/i.test(text)
    || /временно .*перечит/i.test(text)
    || /временно .*недоступ/i.test(text)
    || /синхронизац.*облак/i.test(text)
  ) {
    return "Общая папка временно не успела перечитаться. Подождите синхронизацию облака и нажмите «Проверить снова» или «Обновить данные».";
  }
  return text;
}

function normalizeSyncStatusForUi(syncStatus: SyncStatus | null): SyncStatus | null {
  if (!syncStatus) {
    return null;
  }
  const message = normalizeSyncText(syncStatus.message) || syncStatus.message;
  const issues = syncStatus.issues.map((item) => normalizeSyncText(item)).filter(Boolean);
  return {
    ...syncStatus,
    message,
    issues
  };
}

function translateTone(value: "warning" | "success" | "accent" | "danger"): string {
  const map = {
    warning: "внимание",
    success: "норма",
    accent: "важно",
    danger: "ошибка"
  } as const;
  return map[value];
}

function statusTone(syncStatus: SyncStatus): "accent" | "warning" | "danger" | "success" | undefined {
  if (syncStatus.mode === "RW_IN_SYNC") return "success";
  if (syncStatus.mode === "RO_STALE") return "warning";
  if (syncStatus.mode === "RO_CONFLICT" || syncStatus.mode === "RO_RECOVERY" || syncStatus.mode === "RO_COMMIT_PENDING") return "danger";
  return "warning";
}

function bannerClass(syncStatus: SyncStatus): "warning" | "danger" | "success" {
  if (syncStatus.mode === "RW_IN_SYNC") return "success";
  if (syncStatus.mode === "RO_CONFLICT" || syncStatus.mode === "RO_RECOVERY" || syncStatus.mode === "RO_COMMIT_PENDING") return "danger";
  return "warning";
}

