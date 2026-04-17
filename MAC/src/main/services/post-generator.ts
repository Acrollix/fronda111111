import type {
  ExternalSource,
  ParticipantAggregate,
  PostTemplate,
  ReleaseAggregate,
  ReleaseExternalAssignment
} from "@shared/types";

export interface GeneratedPostResult {
  title: string;
  content: string;
  warnings: string[];
}

export interface GeneratedPostOptions {
  activeReleaseTypeIds?: Set<string>;
  releaseTypeNameById?: Map<string, string>;
}

const DEFAULT_BLOCK_ORDER = [
  "header",
  "platforms",
  "voice_cast",
  "mixing",
  "curator",
  "translation",
  "timing",
  "design",
  "rating",
  "genres",
  "description",
  "tags",
  "footer"
];

const DEFAULT_ROLE_LABELS: Record<string, string> = {
  voice_cast: "Роли озвучивали",
  translation: "Перевод",
  mixing: "Звукорежиссер",
  timing: "Тайминг",
  design: "Оформление",
  rating: "Возрастной рейтинг",
  vocal: "Вокал",
  curator: "Куратор",
  external_source: "Перевод"
};

const PRETTY_VALUES: Record<string, string> = {
  voice_cast: "Роли озвучивали",
  translation: "Перевод",
  mixing: "Звукорежиссер",
  timing: "Тайминг",
  design: "Оформление",
  vocal: "Вокал",
  curator: "Куратор",
  external_source: "Перевод",
  rating: "Возрастной рейтинг",
  anime: "Аниме",
  ongoing: "Онгоинг",
  series: "Сериал",
  film: "Фильм",
  dorama: "Дорама",
  book: "Книга",
  funny: "Смешная озвучка",
  dep_anime: "Аниме",
  dep_ongoings: "Онгоинг",
  dep_serials: "Сериал",
  dep_films: "Фильм",
  dep_dorama: "Дорама",
  dep_books: "Книга",
  dep_funny: "Смешная озвучка",
  dep_erotica: "Эротика",
  comedy: "Комедия",
  drama: "Драма",
  romance: "Романтика",
  action: "Экшен",
  fantasy: "Фэнтези",
  mystery: "Мистика",
  adventure: "Приключения",
  slice_of_life: "Повседневность",
  school: "Школа",
  sports: "Спорт",
  sci_fi: "Научная фантастика",
  thriller: "Триллер",
  horror: "Ужасы",
  historical: "Историческое",
  supernatural: "Сверхъестественное",
  mecha: "Меха",
  music: "Музыка",
  psychological: "Психологическое",
  detective: "Детектив",
  erotica: "Эротика",
  isekai: "Исекай",
  shounen: "Сёнэн",
  shoujo: "Сёдзё",
  seinen: "Сэйнэн",
  josei: "Дзёсэй",
  ecchi: "Этти",
  harem: "Гарем",
  reverse_harem: "Реверс-гарем",
  magic: "Магия",
  martial_arts: "Боевые искусства",
  military: "Военное",
  vampires: "Вампиры",
  demons: "Демоны",
  survival: "Выживание",
  post_apocalyptic: "Постапокалипсис",
  cyberpunk: "Киберпанк",
  parody: "Пародия",
  crime: "Криминал",
  everyday: "Бытовое",
  workplace: "Работа и студия",
  family: "Семья",
  friendship: "Дружба",
  politics: "Политика",
  mythology: "Мифология",
  new_release: "#новыйрелиз",
  new_episode: "#новаясерия",
  weekly_release: "#еженедельныйрелиз",
  voice: "#озвучка",
  dub: "#дубляж",
  subtitles: "#субтитры",
  completed: "#завершено",
  telegram: "Telegram",
  vk: "VK",
  kodik: "Kodik",
  anime365: "Anime365",
  youtube: "YouTube",
  rutube: "RuTube"
};

export class PostGeneratorService {
  generate(
    release: ReleaseAggregate,
    participants: ParticipantAggregate[],
    externalSources: ExternalSource[],
    template?: PostTemplate,
    options: GeneratedPostOptions = {}
  ): GeneratedPostResult {
    const warnings: string[] = [];
    const contentLines: string[] = [];
    const participantById = new Map(participants.map((item) => [item.profile.id, item]));
    const externalSourceById = new Map(externalSources.map((item) => [item.id, item]));
    const roleGroupLabels = {
      ...DEFAULT_ROLE_LABELS,
      ...(template?.role_group_labels ?? {})
    };
    if (!roleGroupLabels.curator) {
      roleGroupLabels.curator = "Куратор";
    }
    if (!roleGroupLabels.external_source || roleGroupLabels.external_source === "Субтитры") {
      roleGroupLabels.external_source = "Перевод";
    }
    if (!roleGroupLabels.mixing || roleGroupLabels.mixing === "Сведение") {
      roleGroupLabels.mixing = "Звукорежиссер";
    }
    const hideEmpty = template?.hide_empty_blocks ?? release.posting.hide_empty_blocks_flag;
    const separator = cleanSingleLineText(release.posting.separator_pattern) || "──────────";
    const title = buildPostTitle(release);
    const staffingMode = getReleaseStaffingMode(release);
    const participantGroups = groupParticipantCredits(release, participantById, template, warnings);
    const externalGroups = groupExternalCredits(release, externalSourceById);
    const ageRating = cleanSingleLineText(release.content.age_rating);
    const includeAgeRating = release.posting.include_age_rating_in_post !== false;
    const genres = release.content.genre_ids.map(prettifyValue).filter(Boolean);
    const description = pickDescription(release);
    const tags = pickTags(release);
    const footer = sanitizeFooter(
      cleanMultilineText(release.posting.post_footer_override)
      || cleanMultilineText(template?.footer)
    );
    const blockOrder = resolveBlockOrder(template?.block_order, participantGroups, externalGroups);
    if (includeAgeRating && ageRating && !blockOrder.includes("rating")) {
      const genresIndex = blockOrder.indexOf("genres");
      const insertAt = genresIndex >= 0 ? genresIndex : blockOrder.length;
      blockOrder.splice(insertAt, 0, "rating");
    }

    for (const block of blockOrder) {
      switch (block) {
        case "header":
          pushBlock(contentLines, [buildHeaderLine(release, title, options), separator]);
          break;
        case "platforms": {
          const platformLines = buildPlatformsBlock(release);
          if (platformLines.length === 0) {
            warnings.push("В релизе не указаны площадки для публикации.");
          }
          if (!hideEmpty || platformLines.length > 0) {
            pushBlock(contentLines, ["Смотрите нас на площадках:", ...platformLines, separator]);
          }
          break;
        }
        case "genres":
          if (!hideEmpty || genres.length > 0) {
            pushBlock(contentLines, [`Жанр: ${genres.join(", ") || "не указан"}`]);
          }
          break;
        case "rating":
          if (!includeAgeRating) {
            break;
          }
          if (!hideEmpty || Boolean(ageRating)) {
            pushBlock(contentLines, [`Возрастной рейтинг: ${ageRating || "не указан"}`]);
          }
          break;
        case "description":
          if (!description) {
            warnings.push("У релиза пока нет описания для поста.");
          }
          if (!hideEmpty || Boolean(description)) {
            pushBlock(contentLines, ["Описание:", description || "Описание пока не заполнено.", separator]);
          }
          break;
        case "tags":
          if (!hideEmpty || tags.length > 0) {
            pushBlock(contentLines, [tags.join(" ") || ""]);
          }
          break;
        case "footer":
          if (!hideEmpty || Boolean(footer)) {
            pushBlock(contentLines, [footer || ""]);
          }
          break;
        default: {
          const participantLines = participantGroups.get(block) ?? [];
          const externalLines = externalGroups.get(block) ?? [];
          const combined =
            block === "voice_cast" && staffingMode === "aligning"
              ? ["Состав еще согласуется"]
              : [...participantLines, ...externalLines];
          const blockLabel =
            block === "voice_cast" && staffingMode === "provisional"
              ? "Примерный состав"
              : (
                block === "external_source"
                  ? cleanSingleLineText(release.posting.post_external_block_override) || roleGroupLabels[block] || prettifyValue(block)
                  : roleGroupLabels[block] ?? prettifyValue(block)
              );
          if (!hideEmpty || combined.length > 0) {
            pushBlock(
              contentLines,
              [
                `${blockLabel}:`,
                ...(combined.length ? combined.map((item) => `• ${item}`) : ["—"])
              ]
            );
          }
        }
      }
    }

    return {
      title,
      content: contentLines.join("\n"),
      warnings: uniqueStrings(warnings)
    };
  }
}

function resolveBlockOrder(
  templateBlockOrder: string[] | undefined,
  participantGroups: Map<string, string[]>,
  externalGroups: Map<string, string[]>
): string[] {
  const baseOrder = uniqueStrings(templateBlockOrder?.length ? templateBlockOrder : DEFAULT_BLOCK_ORDER);
  moveBlockAfter(baseOrder, "mixing", "voice_cast");
  if ((participantGroups.has("curator") || externalGroups.has("curator")) && !baseOrder.includes("curator")) {
    const mixingIndex = baseOrder.indexOf("mixing");
    const insertAt = mixingIndex >= 0 ? mixingIndex + 1 : Math.max(baseOrder.indexOf("voice_cast") + 1, 0);
    baseOrder.splice(insertAt, 0, "curator");
  }
  moveBlockAfter(baseOrder, "curator", "mixing");
  moveBlockAfter(baseOrder, "translation", baseOrder.includes("curator") ? "curator" : "mixing");
  const known = new Set(baseOrder);
  const extraBlocks = uniqueStrings([
    ...Array.from(participantGroups.keys()),
    ...Array.from(externalGroups.keys())
  ]).filter((key) => !known.has(key));
  return [...baseOrder, ...extraBlocks];
}

function moveBlockAfter(order: string[], blockId: string, afterId: string): void {
  const blockIndex = order.indexOf(blockId);
  const afterIndex = order.indexOf(afterId);
  if (blockIndex < 0 || afterIndex < 0 || blockIndex === afterIndex + 1) {
    return;
  }
  order.splice(blockIndex, 1);
  const nextAfterIndex = order.indexOf(afterId);
  order.splice(nextAfterIndex + 1, 0, blockId);
}

function buildPostTitle(release: ReleaseAggregate): string {
  return cleanSingleLineText(release.posting.post_header_override)
    || getReleaseDisplayTitle(release)
    || "Новый релиз";
}

function buildHeaderLine(release: ReleaseAggregate, title: string, options: GeneratedPostOptions): string {
  const identity = buildReleaseIdentityLabel(release, options);
  const episodeLabel = buildSeasonEpisodeLabel(release);
  const titleSegments = cleanSingleLineText(release.posting.post_header_override)
    ? [title]
    : getReleaseTitleSegments(release);
  return `| ${[identity, ...titleSegments, episodeLabel || "без номера"].join(" | ")} |`;
}

function getReleaseDisplayTitle(release: ReleaseAggregate): string {
  const russianTitle = cleanSingleLineText(release.release.title_primary);
  const englishTitle = cleanSingleLineText(release.release.title_secondary);
  return russianTitle || englishTitle || "Новый релиз";
}

function getReleaseTitleSegments(release: ReleaseAggregate): string[] {
  const russianTitle = cleanSingleLineText(release.release.title_primary);
  const englishTitle = cleanSingleLineText(release.release.title_secondary);
  if (russianTitle && englishTitle && russianTitle !== englishTitle) {
    return [russianTitle, englishTitle];
  }
  return [russianTitle || englishTitle || "Новый релиз"];
}

function buildReleaseIdentityLabel(release: ReleaseAggregate, options: GeneratedPostOptions): string {
  const releaseTypeId = cleanSingleLineText(release.release.release_type_id);
  const releaseTypeEnabled = options.activeReleaseTypeIds === undefined || options.activeReleaseTypeIds.has(releaseTypeId);
  if (releaseTypeId && releaseTypeEnabled) {
    return cleanSingleLineText(options.releaseTypeNameById?.get(releaseTypeId))
      || prettifyValue(releaseTypeId)
      || releaseTypeId;
  }
  return prettifyValue(release.release.primary_department_id)
    || "Релиз";
}

function getReleaseStaffingMode(release: ReleaseAggregate): "confirmed" | "aligning" | "provisional" {
  if (release.release.release_status_id !== "announcement") {
    return "confirmed";
  }
  return release.release.staffing_mode === "provisional" ? "provisional" : "aligning";
}

function buildSeasonEpisodeLabel(release: ReleaseAggregate): string {
  const season = release.release.season_number ? `сезон ${release.release.season_number}` : "";
  const episodeStart = release.release.episode_start ?? null;
  const episodeEnd = release.release.episode_end ?? null;
  const episodeCount = release.release.episode_count ?? null;
  const episodeMode = release.posting.episode_label_mode === "single" ? "single" : "range";

  if (episodeMode === "single" && (episodeStart || episodeEnd)) {
    const singleEpisode = episodeEnd ?? episodeStart;
    return [season, `${singleEpisode} серия`].filter(Boolean).join(", ");
  }

  if (episodeStart && episodeEnd && episodeStart !== episodeEnd) {
    return [season, `${episodeStart}-${episodeEnd} серии`].filter(Boolean).join(", ");
  }
  if (episodeStart || episodeEnd) {
    const singleEpisode = episodeStart ?? episodeEnd;
    return [season, `${singleEpisode} серия`].filter(Boolean).join(", ");
  }
  if (episodeCount) {
    return [season, `${episodeCount} серий`].filter(Boolean).join(", ");
  }
  return season;
}

function buildPlatformsBlock(release: ReleaseAggregate): string[] {
  const override = cleanMultilineText(release.posting.post_platform_block_override);
  if (override) {
    return override.split("\n");
  }

  const activeLinks = [...release.content.platform_links]
    .filter((item) => item.active_flag);
  const hasExplicitPrimary = activeLinks.some((item) => item.is_primary);

  return activeLinks
    .sort((left, right) => {
      const leftPrimary = left.is_primary || (!hasExplicitPrimary && left.platform_id === "kodik");
      const rightPrimary = right.is_primary || (!hasExplicitPrimary && right.platform_id === "kodik");
      if (leftPrimary !== rightPrimary) {
        return leftPrimary ? -1 : 1;
      }
      return (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER);
    })
    .map((item) => {
      const label = cleanSingleLineText(item.label_override) || prettifyValue(item.platform_id);
      const url = cleanSingleLineText(item.url);
      return url ? `• ${label} — ${url}` : `• ${label}`;
    });
}

function groupParticipantCredits(
  release: ReleaseAggregate,
  participantById: Map<string, ParticipantAggregate>,
  template: PostTemplate | undefined,
  warnings: string[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const assignments = [...release.participants]
    .filter((item) => item.include_in_post !== false && item.active_flag !== false)
    .sort((left, right) => {
      const orderDelta = (left.credit_order ?? Number.MAX_SAFE_INTEGER) - (right.credit_order ?? Number.MAX_SAFE_INTEGER);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
    });

  for (const assignment of assignments) {
    const participant = participantById.get(assignment.participant_id);
    if (!participant) {
      warnings.push(`Не найден участник ${assignment.participant_id} для сборки поста.`);
      continue;
    }
    const groupId = canonicalPostGroup(assignment.credit_group_id || assignment.role_id || "voice_cast");
    const current = result.get(groupId) ?? [];
    current.push(formatParticipantCredit(participant, assignment, template?.name_style));
    result.set(groupId, current);
  }

  const curatorLines = collectCuratorLines(release, participantById, template?.name_style);
  if (curatorLines.length) {
    result.set("curator", curatorLines);
  }

  if (assignments.length > 0 && !Array.from(result.values()).some((items) => items.length > 0)) {
    warnings.push("Состав релиза найден, но не попал ни в один блок поста. Проверьте роли и группы в титрах.");
  }

  return result;
}

function collectCuratorLines(
  release: ReleaseAggregate,
  participantById: Map<string, ParticipantAggregate>,
  nameStyle: PostTemplate["name_style"] | undefined
): string[] {
  const curatorIds = uniqueStrings([
    release.release.curator_id ?? "",
    ...(release.release.co_curator_ids ?? [])
  ].filter(Boolean));

  return curatorIds.map((participantId) => {
    const participant = participantById.get(participantId);
    if (!participant) {
      return "";
    }
    return formatParticipantName(participant, nameStyle);
  }).filter(Boolean);
}

function groupExternalCredits(
  release: ReleaseAggregate,
  externalSourceById: Map<string, ExternalSource>
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const assignments = [...release.external]
    .filter((item) => item.include_in_post !== false)
    .sort((left, right) => {
      const orderDelta = (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
    });

  for (const assignment of assignments) {
    const source = externalSourceById.get(assignment.external_source_id ?? "");
    const groupId = canonicalPostGroup(assignment.credit_group_id || "external_source");
    const current = result.get(groupId) ?? [];
    const title =
      cleanSingleLineText(assignment.credit_label_override)
      || cleanSingleLineText(source?.preferred_post_label)
      || cleanSingleLineText(source?.name)
      || cleanSingleLineText(assignment.external_source_id)
      || "";
    const mention = cleanSingleLineText((assignment as ReleaseExternalAssignment & { vk_mention?: string }).vk_mention);
    const displayName = cleanSingleLineText((assignment as ReleaseExternalAssignment & { vk_display_name?: string }).vk_display_name);
    const translators = normalizeStringArray((assignment as ReleaseExternalAssignment & { translator_names?: string[] }).translator_names ?? []);
    const mentionText = mention && displayName
      ? `${mention} (${displayName})`
      : (mention || displayName || "");
    current.push(title && mentionText ? `${title}: ${mentionText}` : (title || mentionText || "Источник перевода"));
    if (translators.length) {
      current.push(`Переводчики: ${translators.join(", ")}`);
    }
    result.set(groupId, current);
  }

  return result;
}

function formatParticipantCredit(
  participant: ParticipantAggregate,
  assignment: ReleaseAggregate["participants"][number],
  nameStyle: PostTemplate["name_style"] | undefined
): string {
  const creditName = cleanSingleLineText(assignment.credit_label_override)
    || cleanSingleLineText(assignment.display_name_override)
    || cleanSingleLineText(participant.profile.nickname)
    || cleanSingleLineText(participant.profile.posting.display_name_for_post)
    || cleanSingleLineText(participant.profile.display_name)
    || "Участник";
  const mention = cleanSingleLineText(participant.profile.posting.mention);
  const baseName = nameStyle === "display_name" || nameStyle === "credit_name"
    ? creditName
    : (mention ? `${mention} (${creditName})` : creditName);
  return baseName;
}

function formatParticipantName(
  participant: ParticipantAggregate,
  nameStyle: PostTemplate["name_style"] | undefined
): string {
  const creditName = cleanSingleLineText(participant.profile.nickname)
    || cleanSingleLineText(participant.profile.posting.display_name_for_post)
    || cleanSingleLineText(participant.profile.display_name)
    || "Участник";
  const mention = cleanSingleLineText(participant.profile.posting.mention);

  if (nameStyle === "display_name" || nameStyle === "credit_name") {
    return creditName;
  }
  return mention ? `${mention} (${creditName})` : creditName;
}

function pickDescription(release: ReleaseAggregate): string {
  return cleanMultilineText(release.posting.post_description_override)
    || cleanMultilineText(release.content.post_description_override)
    || cleanMultilineText(release.content.description_full)
    || cleanMultilineText(release.content.description_short)
    || "";
}

function pickTags(release: ReleaseAggregate): string[] {
  const source = release.posting.post_tags_override.length
    ? release.posting.post_tags_override
    : release.content.tag_ids;
  return uniqueStrings(
    source
      .map((tag) => cleanSingleLineText(prettifyValue(tag)))
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "_")}`))
  );
}

function sanitizeFooter(value?: string | null): string {
  const normalized = cleanMultilineText(value);
  return /^fronda$/i.test(normalized) ? "" : normalized;
}

function canonicalPostGroup(value?: string | null): string {
  const normalized = slugKey(value);
  const map: Record<string, string> = {
    voicecast: "voice_cast",
    "озвучка": "voice_cast",
    "ролиозвучивали": "voice_cast",
    "дубляж": "voice_cast",
    translation: "translation",
    "перевод": "translation",
    mixing: "mixing",
    "сведение": "mixing",
    "звукорежиссер": "mixing",
    "звукорежиссёр": "mixing",
    timing: "timing",
    "тайминг": "timing",
    design: "design",
    "оформление": "design",
    visual: "design",
    vocal: "vocal",
    "вокал": "vocal",
    curator: "curator",
    "куратор": "curator",
    genres: "genres",
    "жанр": "genres",
    description: "description",
    "описание": "description",
    tags: "tags",
    "теги": "tags",
    footer: "footer",
    "нижнийблок": "footer",
    externalsource: "external_source",
    "субтитры": "external_source",
    "внешнийисточник": "external_source"
  };
  return map[normalized] ?? (cleanSingleLineText(value) || "voice_cast");
}

function prettifyValue(value?: string | null): string {
  if (!value) return "—";
  const cleaned = cleanSingleLineText(value) || "—";
  if (PRETTY_VALUES[cleaned]) {
    return PRETTY_VALUES[cleaned];
  }
  return cleaned.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function cleanSingleLineText(value?: string | null): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => cleanSingleLineText(value))
    .filter(Boolean);
}

function cleanMultilineText(value?: string | null): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => cleanSingleLineText(line))
    .filter(Boolean)
    .join("\n");
}

function pushBlock(target: string[], lines: string[]): void {
  const prepared = lines.filter(Boolean);
  if (!prepared.length) return;
  if (target.length > 0 && target[target.length - 1] !== "") {
    target.push("");
  }
  target.push(...prepared);
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function slugKey(value?: string | null): string {
  return cleanSingleLineText(value)
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[\s_-]+/g, "");
}
