import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import type {
  ExternalSource,
  FrondaExchangeBundle,
  ImportBatch,
  ImportDisciplinaryCandidate,
  ImportDuplicateMatch,
  ImportExternalSourceCandidate,
  ImportHeaderMapping,
  ImportIssue,
  ImportMappingOverride,
  ImportNoteCandidate,
  ImportParticipantCandidate,
  ImportPreview,
  ImportReleaseCandidate,
  ImportReleaseRelationCandidate,
  ImportRewardCandidate,
  ImportTemplateKind,
  ImportWorkbookAnalysis,
  ParticipantAggregate,
  ReleaseAggregate,
  StructuredImportPreview
} from "@shared/types";
import {
  CLEAN_HEADER_ALIASES,
  CLEAN_ROLE_COLUMNS,
  CLEAN_SECTION_MARKERS
} from "./import-constants";
import { safeTimestamp, writeJsonFile } from "./fs-utils";

type CanonicalHeader =
  | "nickname"
  | "real_name"
  | "display_name"
  | "mention"
  | "mention_id"
  | "vk_slug"
  | "vk_url"
  | "department"
  | "role"
  | "skill"
  | "specialization"
  | "equipment"
  | "voice_sample"
  | "availability"
  | "participant_status"
  | "release_title"
  | "release_type"
  | "release_status"
  | "season"
  | "episode"
  | "year"
  | "curator"
  | "platform"
  | "genre"
  | "tag"
  | "external_source"
  | "note"
  | "comment"
  | "remark"
  | "warning"
  | "reward";

interface ParsedSheetRow {
  source_sheet: string;
  row_number: number;
  raw: Record<string, unknown>;
  canonical: Partial<Record<CanonicalHeader, string>>;
  role_cells: Array<{ role_label: string; value: string }>;
}

export class ImportService {
  private shouldQueueImportForReview(structured: StructuredImportPreview): boolean {
    return structured.issues.some((item) => item.severity === "error")
      || (!structured.exchange_bundle && structured.duplicates.length > 0);
  }

  async createImportPreview(
    sharedPath: string,
    sourceFile: string,
    participants: ParticipantAggregate[],
    releases: ReleaseAggregate[],
    externalSources: ExternalSource[],
    mappingOverrides: ImportMappingOverride[] = []
  ): Promise<ImportPreview> {
    const structured = await this.analyzeSourceFile(
      sourceFile,
      participants,
      releases,
      externalSources,
      mappingOverrides
    );
    const now = new Date().toISOString();
    const batchId = `imp_${safeTimestamp().replace(/[-:TZ.]/g, "")}`;
    const batch: ImportBatch = {
      id: batchId,
      schema_version: 1,
      record_revision: 1,
      created_at: now,
      updated_at: now,
      updated_by: "system",
      status: "active",
      source_filename: path.basename(sourceFile),
      source_type: path.extname(sourceFile).toLowerCase() === ".json" ? "json" : "excel",
      queue_status: this.shouldQueueImportForReview(structured) ? "review" : "pending",
      fingerprint: structured.source_signature,
      candidate_matches: structured.duplicates
        .map((item) => item.matched_entity_id)
        .filter((value): value is string => Boolean(value)),
      decision: "pending",
      template_kind: structured.template_kind,
      sheet_names: structured.sheet_names,
      detected_headers: structured.detected_headers.map((item) => item.original),
      detected_entities: {
        participants: structured.participants.length,
        releases: structured.releases.length,
        relations: structured.relations.length,
        external_sources: structured.external_sources.length
      },
      issue_count: structured.issues.length
    };
    structured.batch = batch;

    const targetDir = path.join(sharedPath, "imports", batch.queue_status, batchId);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourceFile, path.join(targetDir, path.basename(sourceFile)));
    await writeJsonFile(path.join(targetDir, "structured_preview.json"), structured);
    await writeJsonFile(path.join(targetDir, "candidate_matches.json"), structured.duplicates);
    await writeJsonFile(path.join(targetDir, "mapping_overrides.json"), mappingOverrides);
    await writeJsonFile(path.join(targetDir, "review_state.json"), batch);
    return { batch, structured };
  }

  async analyzeSourceFile(
    sourceFile: string,
    participants: ParticipantAggregate[],
    releases: ReleaseAggregate[],
    externalSources: ExternalSource[],
    mappingOverrides: ImportMappingOverride[] = []
  ): Promise<StructuredImportPreview> {
    if (path.extname(sourceFile).toLowerCase() === ".json") {
      const raw = JSON.parse(await fs.readFile(sourceFile, "utf8")) as unknown;
      if (this.isFrondaExchangeBundle(raw)) {
        return this.buildExchangeBundlePreview(raw, participants, releases, externalSources, mappingOverrides);
      }
      const parsed = this.parseJsonSourceValue(raw, mappingOverrides);
      const template = this.detectTemplate(parsed.headers, parsed.workbook);
      return this.buildStructuredPreview(
        parsed.rows,
        parsed.headers,
        parsed.sheetNames,
        parsed.workbook,
        template.kind,
        template.confidence,
        participants,
        releases,
        externalSources,
        mappingOverrides
      );
    }

    const parsed = this.parseExcelSource(sourceFile, mappingOverrides);
    const template = this.detectTemplate(parsed.headers, parsed.workbook);
    return this.buildStructuredPreview(
      parsed.rows,
      parsed.headers,
      parsed.sheetNames,
      parsed.workbook,
      template.kind,
      template.confidence,
      participants,
      releases,
      externalSources,
      mappingOverrides
    );
  }

  private parseJsonSourceValue(raw: unknown, mappingOverrides: ImportMappingOverride[]) {
    const items = Array.isArray(raw) ? raw : [raw];
    const headerSet = new Set<string>();
    items.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.keys(item as Record<string, unknown>).forEach((key) => headerSet.add(key));
      }
    });
    const headers = Array.from(headerSet).map((header) =>
      this.mapHeader(header, [], "JSON", mappingOverrides)
    );
    const rows = items.map((item, index) =>
      this.buildParsedRow(
        "JSON",
        index + 1,
        item && typeof item === "object" && !Array.isArray(item)
          ? { ...(item as Record<string, unknown>) }
          : { value: item },
        headers
      )
    );

    return {
      rows,
      headers,
      sheetNames: ["JSON"],
      workbook: {
        source_signature: buildSourceSignature(["JSON"], headers),
        sheets: [
          {
            sheet_name: "JSON",
            row_count: items.length,
            column_count: headers.length,
            merged_range_count: 0,
            hyperlink_count: 0,
            formula_count: 0,
            section_markers: [],
            repeated_header_rows: [],
            sections: [
              {
                id: "json_section",
                sheet_name: "JSON",
                kind: "data_block",
                row_start: 1,
                row_end: Math.max(items.length, 1),
                header_row_number: 1,
                confidence: 0.88,
                signals: ["json-source"],
                headers
              }
            ]
          }
        ],
        uncertain_sections: 0,
        repeated_headers: 0,
        status_markers: []
      } satisfies ImportWorkbookAnalysis
    };
  }

  private isFrondaExchangeBundle(raw: unknown): raw is FrondaExchangeBundle {
    return Boolean(raw)
      && typeof raw === "object"
      && !Array.isArray(raw)
      && (raw as { format?: unknown }).format === "fronda_exchange_bundle";
  }

  private buildExchangeBundlePreview(
    bundle: FrondaExchangeBundle,
    participants: ParticipantAggregate[],
    releases: ReleaseAggregate[],
    externalSources: ExternalSource[],
    mappingOverrides: ImportMappingOverride[]
  ): StructuredImportPreview {
    const duplicateMatches: ImportDuplicateMatch[] = [];

    const participantCandidates: ImportParticipantCandidate[] = (bundle.participants ?? []).map((item, index) => {
      const duplicate = participants.find((existing) => existing.profile.id === item.profile.id);
      const matches = duplicate ? [{
        id: `dup_bundle_participant_${index + 1}`,
        domain: "participant" as const,
        matched_entity_id: duplicate.profile.id,
        matched_label: duplicate.profile.display_name || duplicate.profile.nickname,
        reason: "ID участника уже существует в рабочем наборе.",
        confidence: 0.99
      }] : [];
      duplicateMatches.push(...matches);
      return {
        id: `bundle_participant_${item.profile.id}`,
        display_label: item.profile.display_name || item.profile.nickname,
        confidence: 0.98,
        confidence_reasons: ["Участник загружен из экспортного файла FRONDA."],
        nickname: item.profile.nickname,
        real_name: item.profile.real_name,
        display_name: item.profile.display_name,
        mention: item.profile.posting?.mention,
        mention_id: item.profile.posting?.mention_id,
        vk_slug: item.profile.posting?.vk_slug,
        vk_url: item.profile.posting?.vk_url,
        display_name_for_post: item.profile.posting?.display_name_for_post,
        department_ids: item.org.department_assignments.map((assignment) => assignment.department_id),
        role_ids: item.org.role_assignments.map((assignment) => assignment.role_id),
        skill_ids: item.org.skill_entries.map((entry) => entry.skill_id),
        specialization_ids: item.org.specialization_entries.map((entry) => entry.specialization_id),
        equipment_notes: [item.equipment.hardware_notes].filter(Boolean) as string[],
        voice_sample_refs: [item.voice_sample.voice_sample_url, item.voice_sample.voice_sample_storage_ref].filter(Boolean) as string[],
        availability_note: item.profile.availability_note,
        source_refs: [{ sheet_name: "FRONDA bundle", row_number: index + 1 }],
        source_rows: [index + 1],
        note_titles: item.notes.map((note) => note.title).filter(Boolean),
        discipline_flags: item.discipline.map((entry) => entry.severity).filter(Boolean),
        reward_flags: item.rewards.map((entry) => entry.description).filter(Boolean),
        duplicate_matches: matches
      };
    });

    const releaseCandidates: ImportReleaseCandidate[] = (bundle.releases ?? []).map((item, index) => {
      const duplicate = releases.find((existing) => existing.release.id === item.release.id);
      const matches = duplicate ? [{
        id: `dup_bundle_release_${index + 1}`,
        domain: "release" as const,
        matched_entity_id: duplicate.release.id,
        matched_label: duplicate.release.title_primary,
        reason: "ID релиза уже существует в рабочем наборе.",
        confidence: 0.99
      }] : [];
      duplicateMatches.push(...matches);
      return {
        id: `bundle_release_${item.release.id}`,
        display_label: item.release.title_primary,
        title_primary: item.release.title_primary,
        confidence: 0.98,
        confidence_reasons: ["Релиз загружен из экспортного файла FRONDA."],
        release_type_id: item.release.release_type_id,
        release_status_id: item.release.release_status_id,
        primary_department_id: item.release.primary_department_id,
        department_ids: item.release.department_ids,
        curator_hint: item.release.curator_id ?? undefined,
        season_number: item.release.season_number ?? undefined,
        episode_start: item.release.episode_start ?? undefined,
        episode_end: item.release.episode_end ?? undefined,
        release_year: item.release.release_year ?? undefined,
        notes: [item.content.description_short, item.content.description_full].filter(Boolean) as string[],
        genre_labels: item.content.genre_ids,
        tag_labels: item.content.tag_ids,
        platform_labels: item.content.platform_links.map((link) => link.label_override || link.platform_id),
        external_source_labels: item.external
          .map((assignment) => assignment.credit_label_override || assignment.external_source_id || assignment.vk_display_name || assignment.vk_mention)
          .filter((value): value is string => Boolean(value)),
        source_refs: [{ sheet_name: "FRONDA bundle", row_number: index + 1 }],
        source_rows: [index + 1],
        duplicate_matches: matches
      };
    });

    const relationCandidates: ImportReleaseRelationCandidate[] = (bundle.releases ?? []).flatMap((release, releaseIndex) =>
      (release.participants ?? []).map((assignment, assignmentIndex) => ({
        id: `bundle_relation_${release.release.id}_${assignment.id}`,
        participant_candidate_id: `bundle_participant_${assignment.participant_id}`,
        release_candidate_id: `bundle_release_${release.release.id}`,
        role_labels: [assignment.credit_label_override || assignment.role_id],
        department_hint: assignment.department_id ?? undefined,
        source_refs: [{ sheet_name: "FRONDA bundle", row_number: releaseIndex + assignmentIndex + 1 }],
        source_rows: [releaseIndex + assignmentIndex + 1],
        confidence: 0.98,
        confidence_reasons: ["Связь участника с релизом загружена из экспортного файла FRONDA."]
      }))
    );

    const externalCandidates: ImportExternalSourceCandidate[] = (bundle.external_sources ?? []).map((item, index) => {
      const duplicate = externalSources.find((existing) => existing.id === item.id);
      const matches = duplicate ? [{
        id: `dup_bundle_external_${index + 1}`,
        domain: "external" as const,
        matched_entity_id: duplicate.id,
        matched_label: duplicate.name,
        reason: "ID источника уже существует в рабочем наборе.",
        confidence: 0.99
      }] : [];
      duplicateMatches.push(...matches);
      return {
        id: `bundle_external_${item.id}`,
        label: item.name,
        links: item.links,
        confidence: 0.96,
        confidence_reasons: ["Источник загружен из экспортного файла FRONDA."],
        source_type_hint: item.external_source_type_id,
        source_refs: [{ sheet_name: "FRONDA bundle", row_number: index + 1 }],
        source_rows: [index + 1],
        duplicate_matches: matches
      };
    });

    return {
      batch: {} as ImportBatch,
      template_kind: "fronda_exchange_bundle",
      template_confidence: 1,
      source_signature: `fronda_bundle_${bundle.exported_at}`,
      sheet_names: ["FRONDA bundle"],
      workbook: {
        source_signature: `fronda_bundle_${bundle.exported_at}`,
        sheets: [
          {
            sheet_name: "FRONDA bundle",
            row_count: (bundle.participants?.length ?? 0) + (bundle.releases?.length ?? 0),
            column_count: 1,
            merged_range_count: 0,
            hyperlink_count: 0,
            formula_count: 0,
            section_markers: ["fronda_exchange_bundle"],
            repeated_header_rows: [],
            sections: [
              {
                id: "fronda_bundle_section",
                sheet_name: "FRONDA bundle",
                kind: "data_block",
                title: "Единый экспорт FRONDA",
                row_start: 1,
                row_end: Math.max((bundle.participants?.length ?? 0) + (bundle.releases?.length ?? 0), 1),
                header_row_number: 1,
                confidence: 1,
                signals: ["fronda_exchange_bundle"],
                headers: []
              }
            ]
          }
        ],
        uncertain_sections: 0,
        repeated_headers: 0,
        status_markers: ["fronda_exchange_bundle"]
      },
      mapping_overrides: mappingOverrides,
      detected_headers: [],
      participants: participantCandidates,
      releases: releaseCandidates,
      relations: relationCandidates,
      notes: [],
      discipline: [],
      rewards: [],
      external_sources: externalCandidates,
      duplicates: duplicateMatches,
      issues: [],
      unknown_rows: [],
      suggested_actions: [
        "Это единый экспорт FRONDA. В нем уже собраны участники, релизы и связанные источники в одном файле.",
        "Проверьте совпадения и дубли, затем импортируйте файл поверх текущей базы без удаления существующих данных."
      ],
      exchange_bundle: bundle
    };
  }

  private parseExcelSource(sourceFile: string, mappingOverrides: ImportMappingOverride[]) {
    const workbook = XLSX.readFile(sourceFile, {
      cellFormula: true,
      cellText: true,
      cellHTML: false,
      cellNF: false
    });

    const rows: ParsedSheetRow[] = [];
    const headers: ImportHeaderMapping[] = [];
    const sheets: ImportWorkbookAnalysis["sheets"] = [];
    const statusMarkers: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        raw: false,
        defval: ""
      });
      const headerRows = this.findHeaderRows(matrix, sheetName, mappingOverrides);
      const statusRows = this.findStatusMarkerRows(matrix);
      statusMarkers.push(...statusRows.map((row) => row.label));
      const { hyperlinkCount, formulaCount } = countSheetSignals(sheet);

      const sections = headerRows.map((header, index) => {
        const nextHeader = headerRows[index + 1]?.rowIndex ?? matrix.length;
        const title = findNearestStatusTitle(statusRows, header.rowIndex);
        const end = Math.max(header.rowIndex + 1, nextHeader - 1);
        const sampleRows = matrix.slice(
          header.rowIndex + 1,
          Math.min(end + 1, header.rowIndex + 6)
        );
        const mappings = header.values.map((value, columnIndex) =>
          this.mapHeader(
            value || `column_${columnIndex + 1}`,
            sampleRows,
            sheetName,
            mappingOverrides,
            columnIndex
          )
        );
        headers.push(...mappings);

        for (let rowIndex = header.rowIndex + 1; rowIndex <= end; rowIndex += 1) {
          const row = matrix[rowIndex] ?? [];
          const rawRow: Record<string, string> = Object.fromEntries(
            mappings.map((mapping, columnIndex) => [
              mapping.original,
              cellDisplayValue(sheet, rowIndex, columnIndex, row[columnIndex])
            ])
          );
          if (Object.values(rawRow).every((value: unknown) => String(value).trim().length === 0)) continue;
          if (this.isRepeatedHeaderRow(rawRow, mappings.map((item: ImportHeaderMapping) => item.original))) continue;
          if (isStatusRow(Object.values(rawRow))) continue;
          rows.push(this.buildParsedRow(sheetName, rowIndex + 1, rawRow, mappings));
        }

        return {
          id: `${slugify(sheetName)}_section_${index + 1}`,
          sheet_name: sheetName,
          kind: "data_block" as const,
          title,
          row_start: header.rowIndex + 1,
          row_end: end + 1,
          header_row_number: header.rowIndex + 1,
          confidence: Math.min(0.98, 0.45 + header.score / 20),
          signals: [
            title ? `section:${title}` : "section:untitled",
            `headers:${mappings.filter((item) => item.canonical).length}`
          ],
          headers: mappings
        };
      });

      sheets.push({
        sheet_name: sheetName,
        row_count: matrix.length,
        column_count: matrix.reduce((max, row) => Math.max(max, row.length), 0),
        merged_range_count: Array.isArray(sheet["!merges"]) ? sheet["!merges"].length : 0,
        hyperlink_count: hyperlinkCount,
        formula_count: formulaCount,
        section_markers: statusRows.map((item) => item.label),
        repeated_header_rows: headerRows.slice(1).map((item) => item.rowIndex + 1),
        sections: sections.length
          ? sections
          : [
              {
                id: `${slugify(sheetName)}_status`,
                sheet_name: sheetName,
                kind: "status_marker",
                title: statusRows[0]?.label,
                row_start: 1,
                row_end: Math.max(matrix.length, 1),
                confidence: 0.2,
                signals: ["no-header-detected"],
                headers: []
              }
            ]
      });
    }

    return {
      rows,
      headers: dedupeHeaders(headers),
      sheetNames: workbook.SheetNames,
      workbook: {
        source_signature: buildSourceSignature(workbook.SheetNames, headers),
        sheets,
        uncertain_sections: sheets
          .flatMap((sheet) => sheet.sections)
          .filter((section) => section.confidence < 0.6).length,
        repeated_headers: sheets.reduce((sum, sheet) => sum + sheet.repeated_header_rows.length, 0),
        status_markers: Array.from(new Set(statusMarkers))
      } satisfies ImportWorkbookAnalysis
    };
  }

  private findHeaderRows(
    matrix: Array<Array<string | number | boolean | null>>,
    sheetName: string,
    mappingOverrides: ImportMappingOverride[]
  ) {
    const candidates: Array<{ rowIndex: number; values: string[]; score: number }> = [];
    matrix.forEach((row, rowIndex) => {
      const values = row.map((cell) => String(cell ?? "").trim());
      if (values.filter(Boolean).length < 2) return;
      const score = values.reduce((sum, value, columnIndex) => {
        if (!value) return sum;
        const mapping = this.mapHeader(value, [], sheetName, mappingOverrides, columnIndex);
        return sum + (mapping.canonical ? 3 : 0) + (this.resolveRoleColumn(value) ? 2 : 0) + 1;
      }, 0);
      if (score >= 6) {
        candidates.push({ rowIndex, values, score });
      }
    });

    if (candidates.length) {
      return dedupeHeaderCandidates(candidates);
    }

    let bestIndex = 0;
    let bestScore = -1;
    matrix.slice(0, 40).forEach((row, rowIndex) => {
      const score = row
        .map((cell) => String(cell ?? "").trim())
        .reduce((sum, value) => sum + (this.resolveCanonicalHeader(value) ? 2 : value ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = rowIndex;
      }
    });

    return [
      {
        rowIndex: bestIndex,
        values: matrix[bestIndex]?.map((cell) => String(cell ?? "").trim()) ?? ["column_1"],
        score: Math.max(bestScore, 1)
      }
    ];
  }

  private findStatusMarkerRows(matrix: Array<Array<string | number | boolean | null>>) {
    return matrix.flatMap((row, rowIndex) => {
      const values = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
      if (!values.length || values.length > 3) return [];
      const label = values.join(" ").trim();
      const normalized = normalizeText(label);
      return CLEAN_SECTION_MARKERS.some((marker) => normalized.includes(marker)) ||
        (/^[A-ZА-ЯЁ0-9\s-]+$/u.test(label) && label.length <= 40)
        ? [{ rowIndex, label }]
        : [];
    });
  }

  private mapHeader(
    header: string,
    sampleRows: Array<Array<string | number | boolean | null>>,
    sourceSheet: string,
    mappingOverrides: ImportMappingOverride[],
    index = 0
  ): ImportHeaderMapping {
    const original = header.trim() || `column_${index + 1}`;
    const override = findMappingOverride(mappingOverrides, sourceSheet, original);
    const canonical = override?.ignore
      ? undefined
      : (override?.canonical as CanonicalHeader | undefined) ?? this.resolveCanonicalHeader(original);
    const sampleValues = sampleRows
      .map((row) => String(row[index] ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return {
      original,
      canonical,
      confidence: override ? 0.99 : canonical ? 0.84 : this.estimateHeaderConfidence(original, sampleValues),
      source_sheet: sourceSheet,
      sample_values: sampleValues
    };
  }

  private buildParsedRow(
    sourceSheet: string,
    rowNumber: number,
    rawRow: Record<string, unknown>,
    mappings: ImportHeaderMapping[]
  ): ParsedSheetRow {
    const canonical: Partial<Record<CanonicalHeader, string>> = {};
    const role_cells: Array<{ role_label: string; value: string }> = [];

    for (const mapping of mappings) {
      const rawValue = String(rawRow[mapping.original] ?? "").trim();
      if (!rawValue) continue;
      const canonicalKey = mapping.canonical as CanonicalHeader | undefined;
      if (canonicalKey) {
        canonical[canonicalKey] = [canonical[canonicalKey], rawValue].filter(Boolean).join(" | ");
      }
      const roleLabel = this.resolveRoleColumn(mapping.original);
      if (roleLabel) {
        role_cells.push({ role_label: roleLabel, value: rawValue });
      }
    }

    return {
      source_sheet: sourceSheet,
      row_number: rowNumber,
      raw: rawRow,
      canonical,
      role_cells
    };
  }

  private buildStructuredPreview(
    rows: ParsedSheetRow[],
    headers: ImportHeaderMapping[],
    sheetNames: string[],
    workbook: ImportWorkbookAnalysis,
    templateKind: ImportTemplateKind,
    confidence: number,
    participants: ParticipantAggregate[],
    releases: ReleaseAggregate[],
    externalSources: ExternalSource[],
    mappingOverrides: ImportMappingOverride[]
  ): StructuredImportPreview {
    const participantMap = new Map<string, ImportParticipantCandidate>();
    const releaseMap = new Map<string, ImportReleaseCandidate>();
    const relationMap = new Map<string, ImportReleaseRelationCandidate>();
    const externalMap = new Map<string, ImportExternalSourceCandidate>();

    const notes: ImportNoteCandidate[] = [];
    const discipline: ImportDisciplinaryCandidate[] = [];
    const rewards: ImportRewardCandidate[] = [];
    const issues: ImportIssue[] = [];
    const unknown_rows: StructuredImportPreview["unknown_rows"] = [];
    const duplicates: ImportDuplicateMatch[] = [];

    rows.forEach((row, index) => {
      let recognized = false;

      const releaseCandidate = this.getOrCreateReleaseCandidate(releaseMap, row, releases, duplicates);
      if (releaseCandidate) recognized = true;

      const participantCandidate = this.getOrCreateParticipantCandidate(
        participantMap,
        row,
        participants,
        duplicates,
        index
      );
      if (participantCandidate) recognized = true;

      const roleLabels = uniqueStrings([
        ...splitMultiValue(row.canonical.role),
        ...row.role_cells.map((item) => item.role_label)
      ]);

      if (participantCandidate && releaseCandidate && roleLabels.length) {
        recognized = true;
        this.addRelationCandidate(relationMap, {
          participant_candidate_id: participantCandidate.id,
          release_candidate_id: releaseCandidate.id,
          role_labels: roleLabels,
          department_hint: row.canonical.department,
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number],
          confidence: 0.9,
          confidence_reasons: [
            "В строке одновременно найдены участник, релиз и роли, поэтому связь создана автоматически."
          ]
        });
      }

      if (releaseCandidate) {
        for (const roleCell of row.role_cells) {
          for (const person of splitPeopleList(roleCell.value)) {
            const personCandidate = this.getOrCreateLooseParticipantCandidate(
              participantMap,
              person,
              row,
              participants,
              duplicates
            );
            if (!personCandidate) continue;
            recognized = true;
            this.addRelationCandidate(relationMap, {
              participant_candidate_id: personCandidate.id,
              release_candidate_id: releaseCandidate.id,
              role_labels: [roleCell.role_label],
              department_hint: row.canonical.department,
              source_refs: [createSourceRef(row)],
              source_rows: [row.row_number],
              confidence: 0.82,
              confidence_reasons: [
                `Из колонки роли "${roleCell.role_label}" извлечено имя участника.`
              ]
            });
          }
        }
      }

      const externalLabel = firstDefined(
        row.canonical.external_source,
        row.raw["FSG"],
        row.raw["Источник субтитров"],
        row.raw["Партнерская FSG"]
      );
      if (releaseCandidate && externalLabel) {
        const externalCandidate = this.getOrCreateExternalCandidate(
          externalMap,
          String(externalLabel),
          row,
          externalSources,
          duplicates
        );
        if (!externalCandidate) return;
        recognized = true;
        this.addRelationCandidate(relationMap, {
          release_candidate_id: releaseCandidate.id,
          external_source_label: externalCandidate.label,
          role_labels: ["Перевод"],
          department_hint: row.canonical.department,
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number],
          confidence: 0.8,
          confidence_reasons: ["В строке найдена группа субтитров или FSG."]
        });
      }

      const noteBody = [row.canonical.note, row.canonical.comment].filter(Boolean).join("\n");
      if (noteBody) {
        recognized = true;
        notes.push({
          id: `inote_${index + 1}`,
          participant_candidate_id: participantCandidate?.id,
          release_candidate_id: releaseCandidate?.id,
          title: row.canonical.note ? "Импортированная заметка" : "Импортированный комментарий",
          body: noteBody,
          note_type_hint: row.canonical.note ? "working" : "comment",
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number]
        });
      }

      if (row.canonical.remark) {
        recognized = true;
        discipline.push({
          id: `idisc_${index + 1}_remark`,
          participant_candidate_id: participantCandidate?.id,
          severity: "remark",
          description: row.canonical.remark,
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number]
        });
      }

      if (row.canonical.warning) {
        recognized = true;
        discipline.push({
          id: `idisc_${index + 1}_warning`,
          participant_candidate_id: participantCandidate?.id,
          severity: "warning",
          description: row.canonical.warning,
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number]
        });
      }

      if (row.canonical.reward) {
        recognized = true;
        rewards.push({
          id: `ireward_${index + 1}`,
          participant_candidate_id: participantCandidate?.id,
          description: row.canonical.reward,
          tags: splitMultiValue(row.canonical.reward).map(slugify),
          source_refs: [createSourceRef(row)],
          source_rows: [row.row_number]
        });
      }

      if (!recognized) {
        unknown_rows.push({
          source_sheet: row.source_sheet,
          row_number: row.row_number,
          raw: row.raw
        });
      }
    });

    if (templateKind === "unknown") {
      issues.push({
        id: "unknown_template",
        severity: "warning",
        code: "UNKNOWN_TEMPLATE",
        message:
          "Не удалось уверенно определить шаблон источника. Проверьте заголовки и сопоставьте их с нужными полями перед импортом.",
        source_rows: []
      });
    }
    if (workbook.uncertain_sections > 0) {
      issues.push({
        id: "uncertain_sections",
        severity: "warning",
        code: "UNCERTAIN_SECTIONS",
        message: `В книге есть неуверенно распознанные разделы: ${workbook.uncertain_sections}. Перед импортом еще раз проверьте структуру листов.`,
        source_rows: []
      });
    }
    if (unknown_rows.length > 0) {
      issues.push({
        id: "unknown_rows",
        severity: unknown_rows.length > 5 ? "warning" : "info",
        code: "UNRECOGNIZED_ROWS",
        message: `Не удалось распознать ${unknown_rows.length} строк. Их нужно проверить вручную перед импортом.`,
        source_rows: unknown_rows.map((item) => item.row_number)
      });
    }

    const suggested_actions = [
      ...(templateKind === "unknown"
        ? ["Сначала уточните тип источника и сопоставление колонок, затем повторите импорт."]
        : []),
      ...(duplicates.length > 0
        ? ["Проверьте найденные дубли и решите, какие данные нужно объединить с текущей базой."]
        : []),
      ...(workbook.repeated_headers > 0
        ? ["Проверьте повторяющиеся заголовки и лишние секции листов."]
        : []),
      ...(Array.from(relationMap.values()).length > 0
        ? ["Проверьте связи участников с релизами и роли, которые распознаны автоматически."]
        : [])
    ];
    if (!suggested_actions.length) {
      suggested_actions.push(
        "Импорт выглядит пригодным к обработке: проверьте совпадения и примените его к текущей базе."
      );
    }

    return {
      batch: {} as ImportBatch,
      template_kind: templateKind,
      template_confidence: confidence,
      source_signature: workbook.source_signature,
      sheet_names: sheetNames,
      workbook,
      mapping_overrides: mappingOverrides,
      detected_headers: headers,
      participants: Array.from(participantMap.values()),
      releases: Array.from(releaseMap.values()),
      relations: Array.from(relationMap.values()),
      notes,
      discipline,
      rewards,
      external_sources: Array.from(externalMap.values()),
      duplicates,
      issues,
      unknown_rows,
      suggested_actions
    };
  }

  private detectTemplate(headers: ImportHeaderMapping[], workbook: ImportWorkbookAnalysis) {
    const canonicalHeaders = headers.map((item) => item.canonical).filter(Boolean);
    const participantScore = canonicalHeaders.filter((header) =>
      ["nickname", "real_name", "mention", "vk_slug", "department", "role", "skill", "equipment"].includes(
        header!
      )
    ).length;
    const releaseScore = canonicalHeaders.filter((header) =>
      ["release_title", "release_type", "release_status", "season", "episode", "curator", "platform", "genre"].includes(
        header!
      )
    ).length;
    const formScore = canonicalHeaders.filter((header) =>
      ["nickname", "real_name", "mention", "vk_url", "voice_sample", "equipment"].includes(header!)
    ).length;
    const roleColumns = headers.filter((item) => this.resolveRoleColumn(item.original)).length;
    const sheetHints = workbook.sheets.map((sheet) => normalizeText(sheet.sheet_name)).join(" | ");

    if (sheetHints.includes("анкета") || (formScore >= 4 && headers.length <= 14)) {
      return { kind: "new_participant_form" as ImportTemplateKind, confidence: 0.8 };
    }
    if (
      (sheetHints.includes("контракт") || workbook.status_markers.length > 0) &&
      releaseScore >= 4 &&
      roleColumns >= 2
    ) {
      return { kind: "department_release_board" as ImportTemplateKind, confidence: 0.9 };
    }
    if (participantScore >= 6 && releaseScore <= 2) {
      return { kind: "participants_master" as ImportTemplateKind, confidence: 0.87 };
    }
    if (releaseScore >= 5) {
      return { kind: "releases_master" as ImportTemplateKind, confidence: 0.84 };
    }
    if (participantScore >= 3 && releaseScore >= 3) {
      return { kind: "mixed_historical" as ImportTemplateKind, confidence: 0.74 };
    }
    return { kind: "unknown" as ImportTemplateKind, confidence: 0.28 };
  }

  private getOrCreateParticipantCandidate(
    participantMap: Map<string, ImportParticipantCandidate>,
    row: ParsedSheetRow,
    participants: ParticipantAggregate[],
    duplicates: ImportDuplicateMatch[],
    index: number
  ) {
    const nickname = row.canonical.nickname;
    const realName = row.canonical.real_name;
    const displayName = row.canonical.display_name;
    const mention = row.canonical.mention;
    const vkUrl = row.canonical.vk_url;
    const vkSlug = row.canonical.vk_slug;
    if (!(nickname || realName || displayName || mention || vkUrl || vkSlug)) return null;

    const key = normalizeText(
      firstDefined(mention, vkUrl, vkSlug, nickname, displayName, realName) ?? `row_${index}`
    );
    const existing = participantMap.get(key);
    if (existing) {
      this.mergeParticipantCandidate(existing, row);
      return existing;
    }

    const confidence_reasons = [
      mention ? "Найдено упоминание VK." : null,
      vkUrl || vkSlug ? "Найдена ссылка или короткий адрес VK." : null,
      nickname ? "Найден ник." : null,
      displayName || realName ? "Найдено имя." : null
    ].filter(Boolean) as string[];

    const candidate: ImportParticipantCandidate = {
      id: `pc_${participantMap.size + 1}`,
      display_label:
        firstDefined(displayName, nickname, realName, mention, "Без имени") ?? "Без имени",
      confidence: scoreFromSignals(confidence_reasons.length, 0.55, 0.96),
      confidence_reasons,
      nickname,
      real_name: realName,
      display_name: displayName ?? firstDefined(realName, nickname),
      mention,
      mention_id: row.canonical.mention_id,
      vk_slug: vkSlug,
      vk_url: vkUrl,
      display_name_for_post: firstDefined(
        row.canonical.display_name,
        row.canonical.real_name,
        row.canonical.nickname
      ),
      department_ids: splitMultiValue(row.canonical.department).map(slugify),
      role_ids: splitMultiValue(row.canonical.role).map(slugify),
      skill_ids: splitMultiValue(row.canonical.skill).map(slugify),
      specialization_ids: splitMultiValue(row.canonical.specialization).map(slugify),
      equipment_notes: splitMultiValue(row.canonical.equipment),
      voice_sample_refs: splitMultiValue(row.canonical.voice_sample),
      availability_note: row.canonical.availability,
      note_titles: [],
      discipline_flags: [],
      reward_flags: [],
      source_refs: [createSourceRef(row)],
      source_rows: [row.row_number],
      duplicate_matches: this.findParticipantDuplicates(
        {
          nickname,
          real_name: realName,
          display_name: displayName,
          mention,
          vk_slug: vkSlug,
          vk_url: vkUrl
        },
        participants
      )
    };
    duplicates.push(...candidate.duplicate_matches);
    participantMap.set(key, candidate);
    return candidate;
  }

  private getOrCreateLooseParticipantCandidate(
    participantMap: Map<string, ImportParticipantCandidate>,
    label: string,
    row: ParsedSheetRow,
    participants: ParticipantAggregate[],
    duplicates: ImportDuplicateMatch[]
  ) {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const key = normalizeText(trimmed);
    const existing = participantMap.get(key);
    if (existing) {
      if (!existing.source_rows.includes(row.row_number)) existing.source_rows.push(row.row_number);
      mergeSourceRefs(existing.source_refs, [createSourceRef(row)]);
      return existing;
    }

    const candidate: ImportParticipantCandidate = {
      id: `pc_${participantMap.size + 1}`,
      display_label: trimmed,
      confidence: 0.58,
      confidence_reasons: ["Имя добавлено из релизной таблицы без полного профиля участника."],
      display_name: trimmed,
      department_ids: [],
      role_ids: [],
      skill_ids: [],
      specialization_ids: [],
      equipment_notes: [],
      voice_sample_refs: [],
      note_titles: [],
      discipline_flags: [],
      reward_flags: [],
      source_refs: [createSourceRef(row)],
      source_rows: [row.row_number],
      duplicate_matches: this.findParticipantDuplicates(
        { nickname: trimmed, display_name: trimmed },
        participants
      )
    };
    duplicates.push(...candidate.duplicate_matches);
    participantMap.set(key, candidate);
    return candidate;
  }

  private mergeParticipantCandidate(candidate: ImportParticipantCandidate, row: ParsedSheetRow) {
    candidate.nickname = candidate.nickname ?? row.canonical.nickname;
    candidate.real_name = candidate.real_name ?? row.canonical.real_name;
    candidate.display_name = candidate.display_name ?? row.canonical.display_name;
    candidate.mention = candidate.mention ?? row.canonical.mention;
    candidate.mention_id = candidate.mention_id ?? row.canonical.mention_id;
    candidate.vk_slug = candidate.vk_slug ?? row.canonical.vk_slug;
    candidate.vk_url = candidate.vk_url ?? row.canonical.vk_url;
    candidate.display_name_for_post = candidate.display_name_for_post ?? row.canonical.display_name;
    mergeStringArrays(candidate.department_ids, splitMultiValue(row.canonical.department).map(slugify));
    mergeStringArrays(candidate.role_ids, splitMultiValue(row.canonical.role).map(slugify));
    mergeStringArrays(candidate.skill_ids, splitMultiValue(row.canonical.skill).map(slugify));
    mergeStringArrays(
      candidate.specialization_ids,
      splitMultiValue(row.canonical.specialization).map(slugify)
    );
    mergeStringArrays(candidate.equipment_notes, splitMultiValue(row.canonical.equipment));
    mergeStringArrays(candidate.voice_sample_refs, splitMultiValue(row.canonical.voice_sample));
    mergeSourceRefs(candidate.source_refs, [createSourceRef(row)]);
    if (!candidate.source_rows.includes(row.row_number)) candidate.source_rows.push(row.row_number);
    candidate.confidence = Math.min(0.98, candidate.confidence + 0.04);
  }

  private getOrCreateReleaseCandidate(
    releaseMap: Map<string, ImportReleaseCandidate>,
    row: ParsedSheetRow,
    releases: ReleaseAggregate[],
    duplicates: ImportDuplicateMatch[]
  ) {
    const title = row.canonical.release_title;
    if (!title) return null;
    const department = row.canonical.department;
    const key = normalizeText(
      `${title}|${department ?? ""}|${row.canonical.season ?? ""}|${row.canonical.episode ?? ""}`
    );
    const existing = releaseMap.get(key);
    if (existing) {
      this.mergeReleaseCandidate(existing, row);
      return existing;
    }

    const confidence_reasons = [
      "Найдено название релиза.",
      department ? "Найден основной отдел." : null,
      row.canonical.release_status ? "Найден статус релиза." : null,
      row.canonical.season || row.canonical.episode ? "Найдены сезон или серия." : null
    ].filter(Boolean) as string[];

    const candidate: ImportReleaseCandidate = {
      id: `rc_${releaseMap.size + 1}`,
      display_label: title,
      confidence: scoreFromSignals(confidence_reasons.length, 0.62, 0.97),
      confidence_reasons,
      title_primary: title,
      release_type_id: row.canonical.release_type,
      release_status_id: row.canonical.release_status,
      primary_department_id: department ? slugify(department) : undefined,
      department_ids: splitMultiValue(department).map(slugify),
      curator_hint: row.canonical.curator,
      release_year: parseOptionalNumber(row.canonical.year),
      season_number: parseOptionalNumber(row.canonical.season),
      episode_start: parseEpisodeStart(row.canonical.episode),
      episode_end: parseEpisodeEnd(row.canonical.episode),
      platform_labels: splitMultiValue(row.canonical.platform),
      genre_labels: splitMultiValue(row.canonical.genre),
      tag_labels: splitMultiValue(row.canonical.tag),
      notes: [row.canonical.comment, row.canonical.note].filter(Boolean) as string[],
      external_source_labels: splitMultiValue(row.canonical.external_source),
      source_refs: [createSourceRef(row)],
      source_rows: [row.row_number],
      duplicate_matches: this.findReleaseDuplicates(
        {
          title_primary: title,
          primary_department_id: department,
          season_number: row.canonical.season,
          episode: row.canonical.episode,
          year: row.canonical.year
        },
        releases
      )
    };
    duplicates.push(...candidate.duplicate_matches);
    releaseMap.set(key, candidate);
    return candidate;
  }

  private mergeReleaseCandidate(candidate: ImportReleaseCandidate, row: ParsedSheetRow) {
    candidate.release_type_id = candidate.release_type_id ?? row.canonical.release_type;
    candidate.release_status_id = candidate.release_status_id ?? row.canonical.release_status;
    candidate.primary_department_id =
      candidate.primary_department_id ??
      (row.canonical.department ? slugify(row.canonical.department) : undefined);
    mergeStringArrays(candidate.department_ids, splitMultiValue(row.canonical.department).map(slugify));
    candidate.curator_hint = candidate.curator_hint ?? row.canonical.curator;
    candidate.release_year = candidate.release_year ?? parseOptionalNumber(row.canonical.year);
    candidate.season_number = candidate.season_number ?? parseOptionalNumber(row.canonical.season);
    candidate.episode_start = candidate.episode_start ?? parseEpisodeStart(row.canonical.episode);
    candidate.episode_end = candidate.episode_end ?? parseEpisodeEnd(row.canonical.episode);
    mergeStringArrays(candidate.platform_labels, splitMultiValue(row.canonical.platform));
    mergeStringArrays(candidate.genre_labels, splitMultiValue(row.canonical.genre));
    mergeStringArrays(candidate.tag_labels, splitMultiValue(row.canonical.tag));
    mergeStringArrays(
      candidate.notes,
      [row.canonical.comment, row.canonical.note].filter(Boolean) as string[]
    );
    mergeStringArrays(
      candidate.external_source_labels,
      splitMultiValue(row.canonical.external_source)
    );
    mergeSourceRefs(candidate.source_refs, [createSourceRef(row)]);
    if (!candidate.source_rows.includes(row.row_number)) candidate.source_rows.push(row.row_number);
    candidate.confidence = Math.min(0.99, candidate.confidence + 0.03);
  }

  private getOrCreateExternalCandidate(
    externalMap: Map<string, ImportExternalSourceCandidate>,
    label: string,
    row: ParsedSheetRow,
    externalSources: ExternalSource[],
    duplicates: ImportDuplicateMatch[]
  ) {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const key = normalizeText(trimmed);
    const existing = externalMap.get(key);
    if (existing) {
      mergeStringArrays(existing.links, extractUrls(trimmed));
      if (!existing.source_rows.includes(row.row_number)) existing.source_rows.push(row.row_number);
      mergeSourceRefs(existing.source_refs, [createSourceRef(row)]);
      existing.confidence = Math.min(0.99, existing.confidence + 0.02);
      return existing;
    }

    const confidenceReasons = [
      "Найден источник перевода или FSG.",
      extractUrls(trimmed).length > 0 ? "Найдены ссылки источника." : null
    ].filter(Boolean) as string[];

    const candidate: ImportExternalSourceCandidate = {
      id: `extc_${externalMap.size + 1}`,
      label: trimmed,
      confidence: scoreFromSignals(confidenceReasons.length, 0.68, 0.95),
      confidence_reasons: confidenceReasons,
      source_type_hint: normalizeText(trimmed).includes("fsg") ? "fsg" : undefined,
      links: extractUrls(trimmed),
      source_refs: [createSourceRef(row)],
      source_rows: [row.row_number],
      duplicate_matches: this.findExternalDuplicates(trimmed, externalSources)
    };

    duplicates.push(...candidate.duplicate_matches);
    externalMap.set(key, candidate);
    return candidate;
  }

  private addRelationCandidate(
    relationMap: Map<string, ImportReleaseRelationCandidate>,
    relation: Omit<ImportReleaseRelationCandidate, "id">
  ) {
    const key = normalizeText(
      [
        relation.participant_candidate_id,
        relation.participant_match_id,
        relation.release_candidate_id,
        relation.release_match_id,
        relation.external_source_label,
        [...relation.role_labels].sort().join("|")
      ]
        .filter(Boolean)
        .join("::")
    );

    const existing = relationMap.get(key);
    if (existing) {
      mergeStringArrays(existing.role_labels, relation.role_labels);
      existing.department_hint = existing.department_hint ?? relation.department_hint;
      mergeSourceRefs(existing.source_refs, relation.source_refs);
      mergeNumberArrays(existing.source_rows, relation.source_rows);
      mergeStringArrays(existing.confidence_reasons, relation.confidence_reasons);
      existing.confidence = Math.min(0.99, Math.max(existing.confidence, relation.confidence));
      return existing;
    }

    const created: ImportReleaseRelationCandidate = {
      id: `relc_${relationMap.size + 1}`,
      ...relation,
      role_labels: uniqueStrings(relation.role_labels),
      source_refs: [...relation.source_refs],
      source_rows: [...relation.source_rows],
      confidence_reasons: [...relation.confidence_reasons]
    };
    relationMap.set(key, created);
    return created;
  }

  private findParticipantDuplicates(
    candidate: Partial<{
      nickname: string;
      real_name: string;
      display_name: string;
      mention: string;
      vk_slug: string;
      vk_url: string;
    }>,
    participants: ParticipantAggregate[]
  ): ImportDuplicateMatch[] {
    const matches: ImportDuplicateMatch[] = [];
    const mention = normalizeText(candidate.mention);
    const vkSlug = normalizeText(candidate.vk_slug);
    const vkUrl = normalizeText(candidate.vk_url);
    const nickname = normalizeText(candidate.nickname);
    const displayName = normalizeText(candidate.display_name ?? candidate.real_name);

    for (const participant of participants) {
      const profile = participant.profile;
      const participantMention = normalizeText(profile.posting.mention);
      const participantVkSlug = normalizeText(profile.posting.vk_slug);
      const participantVkUrl = normalizeText(profile.posting.vk_url);
      const participantNickname = normalizeText(profile.nickname);
      const participantDisplayName = normalizeText(profile.display_name);
      const participantRealName = normalizeText(profile.real_name);

      if (mention && participantMention && mention === participantMention) {
        matches.push({
          id: `dup_p_${participant.profile.id}_mention`,
          domain: "participant",
          matched_entity_id: participant.profile.id,
          matched_label: participant.profile.display_name,
          reason: "Совпадает упоминание VK.",
          confidence: 0.99
        });
        continue;
      }

      if (vkUrl && participantVkUrl && vkUrl === participantVkUrl) {
        matches.push({
          id: `dup_p_${participant.profile.id}_vkurl`,
          domain: "participant",
          matched_entity_id: participant.profile.id,
          matched_label: participant.profile.display_name,
          reason: "Совпадает полный адрес VK.",
          confidence: 0.98
        });
        continue;
      }

      if (vkSlug && participantVkSlug && vkSlug === participantVkSlug) {
        matches.push({
          id: `dup_p_${participant.profile.id}_vkslug`,
          domain: "participant",
          matched_entity_id: participant.profile.id,
          matched_label: participant.profile.display_name,
          reason: "Совпадает короткий адрес VK.",
          confidence: 0.96
        });
        continue;
      }

      if (nickname && participantNickname && nickname === participantNickname) {
        matches.push({
          id: `dup_p_${participant.profile.id}_nick`,
          domain: "participant",
          matched_entity_id: participant.profile.id,
          matched_label: participant.profile.display_name,
          reason: "Совпадает ник.",
          confidence: 0.92
        });
        continue;
      }

      if (
        displayName &&
        (displayName === participantDisplayName || (participantRealName && displayName === participantRealName))
      ) {
        matches.push({
          id: `dup_p_${participant.profile.id}_name`,
          domain: "participant",
          matched_entity_id: participant.profile.id,
          matched_label: participant.profile.display_name,
          reason: "Совпадает отображаемое или реальное имя.",
          confidence: 0.84
        });
      }
    }

    return uniqueDuplicates(matches);
  }

  private findReleaseDuplicates(
    candidate: Partial<{
      title_primary: string;
      primary_department_id: string;
      season_number: string;
      episode: string;
      year: string;
    }>,
    releases: ReleaseAggregate[]
  ): ImportDuplicateMatch[] {
    const matches: ImportDuplicateMatch[] = [];
    const title = normalizeText(candidate.title_primary);
    const department = normalizeText(candidate.primary_department_id);
    const season = parseOptionalNumber(candidate.season_number);
    const episodeStart = parseEpisodeStart(candidate.episode);
    const episodeEnd = parseEpisodeEnd(candidate.episode);
    const year = parseOptionalNumber(candidate.year);

    for (const release of releases) {
      const releaseTitle = normalizeText(release.release.title_primary);
      if (!title || !releaseTitle || title !== releaseTitle) continue;

      let confidence = 0.82;
      const reasons = ["Совпадает название релиза."];

      if (department && normalizeText(release.release.primary_department_id) === department) {
        confidence += 0.06;
        reasons.push("Совпадает основной отдел.");
      }
      if (season != null && release.release.season_number === season) {
        confidence += 0.03;
        reasons.push("Совпадает сезон.");
      }
      if (
        episodeStart != null &&
        episodeEnd != null &&
        release.release.episode_start === episodeStart &&
        release.release.episode_end === episodeEnd
      ) {
        confidence += 0.04;
        reasons.push("Совпадает диапазон серий.");
      }
      if (year != null && release.release.release_year === year) {
        confidence += 0.03;
        reasons.push("Совпадает год.");
      }

      matches.push({
        id: `dup_r_${release.release.id}`,
        domain: "release",
        matched_entity_id: release.release.id,
        matched_label: release.release.title_primary,
        reason: reasons.join(" "),
        confidence: Math.min(confidence, 0.99)
      });
    }

    return uniqueDuplicates(matches);
  }

  private findExternalDuplicates(
    label: string,
    externalSources: ExternalSource[]
  ): ImportDuplicateMatch[] {
    const normalized = normalizeText(label);
    const links = extractUrls(label).map(normalizeText);
    const matches: ImportDuplicateMatch[] = [];

    for (const source of externalSources) {
      const name = normalizeText(source.name);
      const aliases = source.aliases.map(normalizeText);
      const existingLinks = source.links.map(normalizeText);
      if (normalized && (normalized === name || aliases.includes(normalized))) {
        matches.push({
          id: `dup_e_${source.id}_name`,
          domain: "external",
          matched_entity_id: source.id,
          matched_label: source.name,
          reason: "Совпадает название источника или alias.",
          confidence: 0.93
        });
        continue;
      }

      const sharedLink = links.find((item) => existingLinks.includes(item));
      if (sharedLink) {
        matches.push({
          id: `dup_e_${source.id}_link`,
          domain: "external",
          matched_entity_id: source.id,
          matched_label: source.name,
          reason: "Совпадает ссылка источника.",
          confidence: 0.97
        });
      }
    }

    return uniqueDuplicates(matches);
  }

  private resolveCanonicalHeader(original: string): CanonicalHeader | undefined {
    const normalized = normalizeText(original);
    if (!normalized) return undefined;
    for (const [canonical, aliases] of Object.entries(CLEAN_HEADER_ALIASES) as Array<
      [CanonicalHeader, ReadonlyArray<string>]
    >) {
      if (aliases.some((alias) => normalizeText(alias) === normalized)) {
        return canonical;
      }
    }
    return undefined;
  }

  private resolveRoleColumn(original: string) {
    const normalized = normalizeText(original);
    if (!normalized) return undefined;
    for (const column of CLEAN_ROLE_COLUMNS) {
      if (column.aliases.some((alias) => normalizeText(alias) === normalized)) {
        return column.label;
      }
    }
    return undefined;
  }

  private estimateHeaderConfidence(original: string, sampleValues: string[]) {
    const normalized = normalizeText(original);
    if (!normalized) return 0.1;
    if (this.resolveCanonicalHeader(original)) return 0.86;
    if (this.resolveRoleColumn(original)) return 0.8;

    let confidence = 0.24;
    const sampleText = normalizeText(sampleValues.join(" "));
    if (sampleText.includes("@")) confidence += 0.08;
    if (sampleText.includes("vk.com") || sampleText.includes("https://")) confidence += 0.08;
    if (sampleText.match(/\d+/)) confidence += 0.04;
    return Math.min(confidence, 0.6);
  }

  private isRepeatedHeaderRow(current: Record<string, unknown>, headerLabels: string[]) {
    const currentValues = Object.values(current)
      .map((cell) => String(cell ?? "").trim())
      .filter(Boolean)
      .map(normalizeText);
    if (!currentValues.length) return false;

    return headerLabels.length > 1 && headerLabels.every((headerLabel) => {
      const normalized = normalizeText(headerLabel);
      return !normalized || currentValues.includes(normalized);
    });
  }
}

function dedupeHeaders(headers: ImportHeaderMapping[]): ImportHeaderMapping[] {
  const map = new Map<string, ImportHeaderMapping>();
  for (const header of headers) {
    const key = `${header.source_sheet ?? ""}::${normalizeText(header.original)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...header, sample_values: [...header.sample_values] });
      continue;
    }
    existing.canonical = existing.canonical ?? header.canonical;
    existing.confidence = Math.max(existing.confidence, header.confidence);
    existing.sample_values = uniqueStrings([...existing.sample_values, ...header.sample_values]).slice(0, 5);
  }
  return Array.from(map.values());
}

function dedupeHeaderCandidates(candidates: Array<{ rowIndex: number; values: string[]; score: number }>) {
  const accepted: Array<{ rowIndex: number; values: string[]; score: number }> = [];
  for (const candidate of candidates.sort((a, b) => a.rowIndex - b.rowIndex)) {
    const normalizedValues = candidate.values.map(normalizeText).filter(Boolean);
    const overlapsExisting = accepted.some((existing) => {
      const existingValues = existing.values.map(normalizeText).filter(Boolean);
      const overlap = normalizedValues.filter((value) => existingValues.includes(value)).length;
      return overlap >= Math.max(2, Math.ceil(Math.min(normalizedValues.length, existingValues.length) * 0.6));
    });
    if (!overlapsExisting) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

function findNearestStatusTitle(statusRows: Array<{ rowIndex: number; label: string }>, headerRowIndex: number) {
  const previousRows = statusRows.filter((row) => row.rowIndex < headerRowIndex);
  return previousRows[previousRows.length - 1]?.label;
}

function countSheetSignals(sheet: XLSX.WorkSheet) {
  let hyperlinkCount = 0;
  let formulaCount = 0;

  for (const [cellRef, cell] of Object.entries(sheet)) {
    if (cellRef.startsWith("!")) continue;
    const typedCell = cell as XLSX.CellObject;
    if (typedCell?.l?.Target) hyperlinkCount += 1;
    if (typedCell?.f) formulaCount += 1;
  }

  return { hyperlinkCount, formulaCount };
}

function cellDisplayValue(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  columnIndex: number,
  fallback: string | number | boolean | null
) {
  const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const cell = sheet[cellRef] as XLSX.CellObject | undefined;
  const hyperlink = cell?.l?.Target;
  const formula = cell?.f;
  const display = String(cell?.w ?? fallback ?? "").trim();

  if (hyperlink && display && !display.includes(hyperlink)) {
    return `${display} ${hyperlink}`.trim();
  }
  if (hyperlink) return hyperlink;
  if (formula && display) return display;
  return display;
}

function findMappingOverride(
  overrides: ImportMappingOverride[],
  sourceSheet: string | undefined,
  originalHeader: string
) {
  return overrides.find(
    (item) =>
      normalizeText(item.original_header) === normalizeText(originalHeader) &&
      normalizeText(item.source_sheet) === normalizeText(sourceSheet)
  );
}

function buildSourceSignature(sheetNames: string[], headers: ImportHeaderMapping[]) {
  return normalizeText(
    `${sheetNames.join("|")}::${headers
      .map((item) => `${item.source_sheet ?? ""}:${item.original}:${item.canonical ?? ""}`)
      .join("|")}`
  ).slice(0, 240);
}

function firstDefined<T>(...values: Array<T | null | undefined>) {
  return values.find((value) => value !== undefined && value !== null && value !== "") as
    | T
    | undefined;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»"'`]/g, "")
    .trim();
}

function splitMultiValue(value: unknown) {
  return String(value ?? "")
    .split(/[,;|/]+|\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPeopleList(value: unknown) {
  return String(value ?? "")
    .split(/[,;/]+|\s+и\s+|\s+&\s+|\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length > 1);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function mergeStringArrays(target: string[], additions: Array<string | undefined>) {
  const merged = uniqueStrings([...target, ...additions.filter(Boolean) as string[]]);
  target.splice(0, target.length, ...merged);
}

function mergeNumberArrays(target: number[], additions: Array<number | undefined>) {
  const next = [...target];
  for (const value of additions) {
    if (typeof value !== "number" || Number.isNaN(value) || next.includes(value)) continue;
    next.push(value);
  }
  next.sort((a, b) => a - b);
  target.splice(0, target.length, ...next);
}

function createSourceRef(row: ParsedSheetRow) {
  return {
    sheet_name: row.source_sheet,
    row_number: row.row_number
  };
}

function mergeSourceRefs(
  target: Array<{ sheet_name: string; row_number: number }>,
  additions: Array<{ sheet_name: string; row_number: number }>
) {
  const next = [...target];
  for (const value of additions) {
    if (!next.some((item) => item.sheet_name === value.sheet_name && item.row_number === value.row_number)) {
      next.push(value);
    }
  }
  target.splice(0, target.length, ...next);
}

function slugify(value: unknown) {
  const normalized = normalizeText(value)
    .replace(/[^a-zа-яё0-9]+/giu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function parseOptionalNumber(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const matched = raw.match(/\d+/);
  if (!matched) return undefined;
  const number = Number(matched[0]);
  return Number.isFinite(number) ? number : undefined;
}

function parseEpisodeStart(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const range = raw.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) return Number(range[1]);
  return parseOptionalNumber(raw);
}

function parseEpisodeEnd(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const range = raw.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) return Number(range[2]);
  return parseOptionalNumber(raw);
}

function scoreFromSignals(signalCount: number, min: number, max: number) {
  if (signalCount <= 0) return min;
  const score = min + signalCount * 0.08;
  return Math.max(min, Math.min(max, score));
}

function extractUrls(value: unknown) {
  const raw = String(value ?? "");
  return uniqueStrings(raw.match(/https?:\/\/[^\s,;]+/giu) ?? []);
}

function isStatusRow(row: Array<string | number | boolean | null>) {
  const values = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
  if (!values.length || values.length > 3) return false;
  const label = normalizeText(values.join(" "));
  return CLEAN_SECTION_MARKERS.some((marker) => label.includes(normalizeText(marker)));
}

function uniqueDuplicates(items: ImportDuplicateMatch[]) {
  const map = new Map<string, ImportDuplicateMatch>();
  for (const item of items) {
    const key = `${item.domain}::${item.matched_entity_id ?? item.matched_label}::${item.reason}`;
    const existing = map.get(key);
    if (!existing || existing.confidence < item.confidence) {
      map.set(key, item);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.confidence - a.confidence);
}
