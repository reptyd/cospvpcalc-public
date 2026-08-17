// Bespoke beta creature editor - the Creatures sub-view of CustomPageBeta.
// All builder LOGIC lives in `../engine/creatureBuilderModel` (shared with the
// classic editor); this file is purely the beta markup + UI state. The editor
// is always stepped (Basics / Abilities / Statuses) with a live preview.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, ImagePlus, PawPrint, Pencil, Plus, Trash2 } from "lucide-react";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../shared/customAbilities";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { IconImg } from "../components/IconImg";
import { fileToCustomIconDataUrl, dataUrlByteLength } from "../shared/imageIcon";
import { formatBytes, getLocalStorageUsage } from "../shared/localStorageQuota";
import { BetaSelect } from "../components/beta/BetaSelect";
import {
  decodeCustomCreatureCode,
  encodeCustomCreatureCode,
  getCustomCreatureRecord,
  registerCustomCreatureRecord,
  unregisterCustomCreatureRecord,
  clearCustomCreatureRecords,
  type CustomCreatureRecord,
} from "../engine/customCreatures";
import { BreathProfileEditor, makeBlankBreathProfile } from "../components/custom/BreathProfileEditor";
import {
  ABILITY_KIND_LABELS,
  OPTIONAL_STAT_FIELDS,
  REQUIRED_STAT_FIELDS,
  STATUS_KIND_LABELS,
  addOrIgnoreAbility,
  buildAbilityMetaText,
  buildBuilderStateFromRecord,
  buildRecordFromBuilder,
  collectSelectedAbilities,
  collectSelectedStatuses,
  collectStatusOptions,
  collectSupportedAbilityOptions,
  createEmptyBuilderState,
  createRecordFromExistingCreature,
  findStatusName,
  formatValueInput,
  getSelectedAbilityValueOptions,
  hasAbilityInBuilder,
  makeAbilityRef,
  normalizeKey,
  removeAbilityByName,
  type AbilityLibraryKind,
  type AbilityLibraryOption,
  type BuilderState,
  type EditableStatusEffect,
  type MessageState,
  type SelectedAbilityEntry,
  type SelectedStatusEntry,
  type StatusApplicationKind,
} from "../engine/creatureBuilderModel";

export type CustomCreaturesBetaProps = {
  creatureNames: string[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  customCreatures: CustomCreatureRecord[];
};

// Editor steps. Each step shows one focused panel instead of the whole form at
// once, so the builder reads as a designed flow rather than a dump of every
// ability + status inline.
type EditorStep = "basics" | "abilities" | "statuses";
const EDITOR_STEP_DEFS: ReadonlyArray<{ key: EditorStep; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "abilities", label: "Abilities" },
  { key: "statuses", label: "Statuses" },
];

export default function CustomCreaturesBeta({
  creatureNames,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  customCreatures,
}: CustomCreaturesBetaProps) {
  const templateNameId = useId();
  const customNameId = useId();
  const iconSourceId = useId();
  const lastCodeId = useId();
  const importCodeId = useId();
  const [builder, setBuilder] = useState<BuilderState>(createEmptyBuilderState());
  // Landing (list of created creatures) vs the editor (the builder form), so the
  // Creatures tab matches the Abilities / Timings / Statuses flow.
  const [view, setView] = useState<"list" | "editor">("list");
  // Which focused step is showing.
  const [step, setStep] = useState<EditorStep>("basics");
  const showStep = (key: EditorStep) => step === key;
  const [message, setMessage] = useState<MessageState>(null);
  // Hidden file input the "Upload image" button proxies to, plus a busy flag
  // while the picked image is being downscaled.
  const iconFileInputRef = useRef<HTMLInputElement | null>(null);
  const [iconBusy, setIconBusy] = useState(false);

  const handleIconFile = async (file: File | null | undefined) => {
    if (!file) return;
    setIconBusy(true);
    try {
      const { dataUrl } = await fileToCustomIconDataUrl(file);
      setBuilder((current) => ({ ...current, iconDataUrl: dataUrl }));
      setMessage(null);
    } catch (error) {
      setMessage({
        kind: "error",
        lines: [error instanceof Error ? error.message : "That image could not be used."],
      });
    } finally {
      setIconBusy(false);
    }
  };

  const clearCustomIcon = () => setBuilder((current) => ({ ...current, iconDataUrl: null }));
  const openNewCreature = () => {
    setBuilder(createEmptyBuilderState());
    setMessage(null);
    setStep("basics");
    setView("editor");
  };
  const openEditCreature = (record: CustomCreatureRecord) => {
    setBuilder(buildBuilderStateFromRecord(record));
    setMessage(null);
    setStep("basics");
    setView("editor");
  };
  const [templateName, setTemplateName] = useState("");
  const [showAdvancedStats, setShowAdvancedStats] = useState(false);
  const [lastCode, setLastCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [abilitySearch, setAbilitySearch] = useState("");
  const [abilityKindFilter, setAbilityKindFilter] = useState<AbilityLibraryKind | "all">("all");
  const [statusSearch, setStatusSearch] = useState("");
  const [statusDraft, setStatusDraft] = useState({
    kind: "onHit" as StatusApplicationKind,
    value: "1",
  });
  const [customAbilityRecords, setCustomAbilityRecords] = useState<
    CustomAbilityRecord[]
  >(() => listCustomAbilityRecords());
  useEffect(() => {
    return subscribeCustomAbilityRegistry(() => {
      setCustomAbilityRecords(listCustomAbilityRecords());
    });
  }, []);

  const abilityOptions = useMemo(() => {
    const builtIn = collectSupportedAbilityOptions();
    // Append user-authored abilities so they appear in the same
    // picker. Their `kind: "user"` flag drives both the filter chip
    // and the add-handler branch (writes to userAbilityIds instead
    // of the kind-bucketed ability lists).
    const userOptions: AbilityLibraryOption[] = customAbilityRecords.map((record) => {
      const id = record.spec.id;
      const name = record.spec.display_name || id;
      const semantics =
        "Custom-authored ability - runs through the engine's user-ability dispatch.";
      return {
        name,
        semantics,
        subtype: null,
        defaultValue: null,
        valueOptions: [],
        kind: "user",
        userAbilityId: id,
        searchText: `${name} ${id} custom user`.toLowerCase(),
      };
    });
    return [...builtIn, ...userOptions];
  }, [customAbilityRecords]);
  const abilityValueOptionsByName = useMemo(
    () => new Map(abilityOptions.map((option) => [normalizeKey(option.name), option.valueOptions])),
    [abilityOptions],
  );
  const statusOptions = useMemo(() => collectStatusOptions(), []);
  const selectedAbilities = useMemo(() => collectSelectedAbilities(builder), [builder]);
  const selectedStatuses = useMemo(() => collectSelectedStatuses(builder), [builder]);
  const appetiteRequired =
    builder.passiveAbilities.some((entry) => entry.name === "Gourmandizer") ||
    builder.activatedAbilities.some((entry) => entry.name === "Reflux");
  const filteredAbilityOptions = useMemo(() => {
    const query = abilitySearch.trim().toLowerCase();
    return abilityOptions
      .filter((entry) => abilityKindFilter === "all" || entry.kind === abilityKindFilter)
      .filter((entry) => {
        // User-kind options de-dup by id (name may collide); other
        // kinds use the legacy name-based check.
        if (entry.kind === "user") {
          return entry.userAbilityId
            ? !builder.userAbilityIds.includes(entry.userAbilityId)
            : true;
        }
        return !hasAbilityInBuilder(builder, entry.name);
      })
      .filter((entry) => !query || entry.searchText.includes(query));
  }, [abilityKindFilter, abilityOptions, abilitySearch, builder]);
  const filteredStatusOptions = useMemo(() => {
    const query = statusSearch.trim().toLowerCase();
    return statusOptions.filter((entry) => !query || entry.searchText.includes(query));
  }, [statusOptions, statusSearch]);

  const loadTemplate = (name: string) => {
    const customRecord = getCustomCreatureRecord(name);
    const templateRecord = customRecord ?? createRecordFromExistingCreature(name);
    if (!templateRecord) {
      setMessage({ kind: "error", lines: [`Could not load template "${name}".`] });
      return;
    }
    setBuilder(buildBuilderStateFromRecord(templateRecord));
    setTemplateName(name);
    setMessage({ kind: "success", lines: [`Loaded "${name}" into the editor.`] });
  };

  const addAbilityOption = (option: AbilityLibraryOption) => {
    // User-authored abilities live on a separate field
    // (`builder.userAbilityIds`). They share the same picker UI but
    // a different attach path. Bail early once they're attached.
    if (option.kind === "user" && option.userAbilityId) {
      if (builder.userAbilityIds.includes(option.userAbilityId)) {
        setMessage({ kind: "warning", lines: [`"${option.name}" is already attached.`] });
        return;
      }
      setBuilder((current) => ({
        ...current,
        userAbilityIds: [...current.userAbilityIds, option.userAbilityId!],
      }));
      setMessage(null);
      return;
    }
    if (hasAbilityInBuilder(builder, option.name)) {
      setMessage({ kind: "warning", lines: [`"${option.name}" is already added.`] });
      return;
    }
    setBuilder((current) => ({
      ...current,
      passiveAbilities:
        option.kind === "passive" ? addOrIgnoreAbility(current.passiveAbilities, makeAbilityRef(option)) : current.passiveAbilities,
      activatedAbilities:
        option.kind === "activated" ? addOrIgnoreAbility(current.activatedAbilities, makeAbilityRef(option)) : current.activatedAbilities,
      breathAbilities:
        option.kind === "breath" ? addOrIgnoreAbility(current.breathAbilities, makeAbilityRef(option)) : current.breathAbilities,
      otherAbilities:
        option.kind === "other"
          ? current.otherAbilities.some((entry) => normalizeKey(entry.name) === normalizeKey(option.name))
            ? current.otherAbilities
            : [
                ...current.otherAbilities,
                {
                  name: option.name,
                  valueInput: formatValueInput(option.defaultValue ?? option.valueOptions[0]?.value ?? null),
                  semantics: option.semantics,
                },
              ].sort((left, right) => left.name.localeCompare(right.name))
          : current.otherAbilities,
      stats:
        option.kind === "breath" && !current.stats.breath.trim() && current.breathAbilities.length === 0
          ? { ...current.stats, breath: option.name }
          : current.stats,
    }));
    setMessage(null);
  };

  const updateSelectedAbilityValue = (entry: SelectedAbilityEntry, nextValue: string) => {
    setBuilder((current) => ({
      ...current,
      passiveAbilities:
        entry.kind === "passive"
          ? current.passiveAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.passiveAbilities,
      activatedAbilities:
        entry.kind === "activated"
          ? current.activatedAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.activatedAbilities,
      breathAbilities:
        entry.kind === "breath"
          ? current.breathAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.breathAbilities,
      otherAbilities:
        entry.kind === "other"
          ? current.otherAbilities.map((item) => (item.name === entry.name ? { ...item, valueInput: nextValue } : item))
          : current.otherAbilities,
    }));
  };

  const removeSelectedAbility = (entry: SelectedAbilityEntry) => {
    setBuilder((current) => ({
      ...current,
      passiveAbilities: entry.kind === "passive" ? removeAbilityByName(current.passiveAbilities, entry.name) : current.passiveAbilities,
      activatedAbilities:
        entry.kind === "activated" ? removeAbilityByName(current.activatedAbilities, entry.name) : current.activatedAbilities,
      breathAbilities: entry.kind === "breath" ? removeAbilityByName(current.breathAbilities, entry.name) : current.breathAbilities,
      otherAbilities:
        entry.kind === "other"
          ? current.otherAbilities.filter((item) => normalizeKey(item.name) !== normalizeKey(entry.name))
          : current.otherAbilities,
    }));
  };


  const addStatusEffect = (statusId: string) => {
    const kind = statusDraft.kind;
    const valueInput = statusDraft.value;
    // Intrinsic by default (empty source = always applied, not bound to any one
    // ability toggle). Previously every effect was silently stamped with the
    // first ability alphabetically, so a creature's whole status kit hung off
    // one ability - disabling that ability stripped everything. The user now
    // assigns a source per effect via the Source picker on each row below.
    const sourceAbility = "";
    if (!statusId) {
      setMessage({ kind: "error", lines: ["Pick a status first."] });
      return;
    }
    const nextEntry = { statusId, valueInput, sourceAbility };
    const currentEntries =
      kind === "onHit" ? builder.onHitStatuses : kind === "onHitTaken" ? builder.onHitTakenStatuses : builder.resistStatuses;
    if (
      currentEntries.some(
        (entry) =>
          entry.statusId === nextEntry.statusId && normalizeKey(entry.sourceAbility) === normalizeKey(nextEntry.sourceAbility),
      )
    ) {
      setMessage({ kind: "warning", lines: [`"${findStatusName(statusOptions, statusId)}" is already added for this application type.`] });
      return;
    }
    setBuilder((current) =>
      kind === "onHit"
        ? { ...current, onHitStatuses: [...current.onHitStatuses, nextEntry] }
        : kind === "onHitTaken"
          ? { ...current, onHitTakenStatuses: [...current.onHitTakenStatuses, nextEntry] }
          : { ...current, resistStatuses: [...current.resistStatuses, nextEntry] },
    );
    setMessage(null);
  };

  const updateSelectedStatus = (entry: SelectedStatusEntry, patch: Partial<EditableStatusEffect>) => {
    setBuilder((current) => ({
      ...current,
      onHitStatuses:
        entry.kind === "onHit"
          ? current.onHitStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.onHitStatuses,
      onHitTakenStatuses:
        entry.kind === "onHitTaken"
          ? current.onHitTakenStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.onHitTakenStatuses,
      resistStatuses:
        entry.kind === "resist"
          ? current.resistStatuses.map((item, index) => (index === entry.index ? { ...item, ...patch } : item))
          : current.resistStatuses,
    }));
  };

  const removeSelectedStatus = (entry: SelectedStatusEntry) => {
    setBuilder((current) => ({
      ...current,
      onHitStatuses:
        entry.kind === "onHit" ? current.onHitStatuses.filter((_, index) => index !== entry.index) : current.onHitStatuses,
      onHitTakenStatuses:
        entry.kind === "onHitTaken"
          ? current.onHitTakenStatuses.filter((_, index) => index !== entry.index)
          : current.onHitTakenStatuses,
      resistStatuses:
        entry.kind === "resist" ? current.resistStatuses.filter((_, index) => index !== entry.index) : current.resistStatuses,
    }));
  };

  const createOrUpdate = async () => {
    const built = buildRecordFromBuilder(builder);
    if (!built.record) {
      setMessage({ kind: "error", lines: [built.error ?? "Custom creature could not be built."] });
      return;
    }
    const originalName = builder.editingOriginalName;
    if (originalName && originalName !== built.record.creature.name) {
      unregisterCustomCreatureRecord(originalName);
    }
    const result = await registerCustomCreatureRecord(built.record, {
      replace: Boolean(originalName && originalName === built.record.creature.name),
    });
    if (!result.ok) {
      setMessage({ kind: "error", lines: [result.error ?? "Custom creature could not be registered."] });
      return;
    }
    const code = encodeCustomCreatureCode(built.record);
    setLastCode(code);
    // When localStorage rejected the write the creature is live in memory but
    // gone on reload - say so loudly instead of the usual "saved" reassurance.
    const storageWarn = result.storageQuotaExceeded
      ? [
          "Browser storage is full, so this creature is active now but will NOT survive a reload. Remove some custom creatures or icons to free space.",
        ]
      : [];
    const messageKind = result.storageQuotaExceeded ? "error" : result.warnings.length > 0 ? "warning" : "success";
    const savedLine = result.storageQuotaExceeded
      ? `${originalName ? "Updated" : "Created"} "${built.record.creature.name}" (in this session only).`
      : `${originalName ? "Updated" : "Created"} "${built.record.creature.name}".`;
    const persistLine = result.storageQuotaExceeded
      ? "Its shareable code is below - use it to keep the creature."
      : "Saved to this browser - it stays after a reload. Its code is for sharing the creature or moving it to another device.";
    try {
      await navigator.clipboard.writeText(code);
      setMessage({
        kind: messageKind,
        lines: [
          savedLine,
          persistLine,
          ...(result.storageQuotaExceeded ? [] : ["The code was also copied to your clipboard."]),
          ...storageWarn,
          ...result.warnings,
        ],
      });
    } catch {
      setMessage({
        kind: messageKind,
        lines: [savedLine, persistLine, ...storageWarn, ...result.warnings],
      });
    }
    setBuilder((current) => ({ ...current, editingOriginalName: built.record!.creature.name }));
    // Saved -> back to the landing, where the new/updated creature now appears.
    setView("list");
  };

  // Copy a shareable code for the *current* builder without saving first, so the
  // export action in the preview pane works even before the first Save.
  const copyCurrentCode = async () => {
    const built = buildRecordFromBuilder(builder);
    if (!built.record) {
      setMessage({ kind: "error", lines: [built.error ?? "Custom creature could not be built."] });
      return;
    }
    const code = encodeCustomCreatureCode(built.record);
    setLastCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setMessage({ kind: "success", lines: ["Creature code copied to your clipboard."] });
    } catch {
      setMessage({ kind: "warning", lines: ["Could not copy automatically — copy it from the code box below the preview."] });
    }
  };

  const importCreatureCode = async () => {
    const decoded = decodeCustomCreatureCode(importCode);
    if (!decoded.ok || !decoded.payload) {
      setMessage({ kind: "error", lines: [decoded.error ?? "Custom creature code is invalid."] });
      return;
    }
    const result = await registerCustomCreatureRecord(decoded.payload, {
      replace: Boolean(getCustomCreatureRecord(decoded.payload.creature.name)),
    });
    if (!result.ok) {
      setMessage({ kind: "error", lines: [result.error ?? "Custom creature could not be imported."] });
      return;
    }
    setBuilder(
      buildBuilderStateFromRecord({
        creature: decoded.payload.creature,
        effects: decoded.payload.effects,
        appetite: decoded.payload.appetite,
        iconName: decoded.payload.iconName,
        iconDataUrl: null,
        createdAt: Date.now(),
      }),
    );
    setLastCode(importCode.trim());
    setMessage({
      kind: result.warnings.length > 0 ? "warning" : "success",
      lines: [
        `Imported "${decoded.payload.creature.name}".`,
        "Saved to this browser. Keep its code to share it or move it to another device.",
        ...result.warnings,
      ],
    });
  };

  return (
    <section className="panel custom-creatures-builder">
      {message ? (
        <div className={`custom-creature-message ${message.kind}`}>
          {message.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}

      {view === "editor" ? (
        <div className="cc-editor">
          <div className="cc-editor__bar">
            <button type="button" className="secondary cc-editor__back" onClick={() => setView("list")}>
              ← Back to creatures
            </button>
            <span className="cc-editor__title">
              {builder.editingOriginalName ? `Editing “${builder.editingOriginalName}”` : "New creature"}
            </span>
            <button type="button" className="primary cc-editor__save" onClick={() => void createOrUpdate()}>
              {builder.editingOriginalName ? "Save changes" : "Add creature"}
            </button>
          </div>
          <nav className="cc-steps" aria-label="Creature editor sections">
            {EDITOR_STEP_DEFS.map((def) => {
                const count =
                  def.key === "abilities"
                    ? selectedAbilities.length + builder.userAbilityIds.length
                    : def.key === "statuses"
                      ? selectedStatuses.length
                      : null;
                return (
                  <button
                    key={def.key}
                    type="button"
                    className={step === def.key ? "cc-step active" : "cc-step"}
                    onClick={() => setStep(def.key)}
                    aria-current={step === def.key ? "step" : undefined}
                  >
                    <span className="cc-step__label">{def.label}</span>
                    {count != null && count > 0 ? <span className="cc-step__count">{count}</span> : null}
                  </button>
                );
              })}
          </nav>
          <div className="cc-editor__panes">
          <div className="cc-editor__form">
          <div className="panel-block">
          {showStep("basics") ? (
          <div className="cc-editor__top">
            <div className="custom-creature-editor-section cc-section--identity">
              <h4>Identity</h4>
              <div className="cc-identity-grid">
                <div className="field">
                  <label htmlFor={customNameId}>Creature name</label>
                  <input
                    id={customNameId}
                    value={builder.name}
                    onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value }))}
                    placeholder="My Custom Creature"
                  />
                </div>
                <div className="field cc-icon-field">
                  <label htmlFor={iconSourceId}>Icon</label>
                  <div
                    className={`cc-icon-control${iconBusy ? " is-busy" : ""}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleIconFile(event.dataTransfer.files?.[0]);
                    }}
                  >
                    <IconImg
                      src={builder.iconDataUrl ?? getCreatureIcon(builder.iconName.trim() || builder.name.trim())}
                      alt={builder.name || "icon"}
                      size={56}
                    />
                    <div className="cc-icon-control__body">
                      {builder.iconDataUrl ? (
                        <>
                          <span className="cc-icon-control__meta">
                            Custom image · {formatBytes(dataUrlByteLength(builder.iconDataUrl))}
                          </span>
                          <div className="cc-icon-control__actions">
                            <button type="button" className="secondary" onClick={() => iconFileInputRef.current?.click()} disabled={iconBusy}>
                              <ImagePlus size={14} aria-hidden="true" /> Replace
                            </button>
                            <button type="button" className="secondary" onClick={clearCustomIcon} disabled={iconBusy}>
                              Remove
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <CreatureNameInput
                            id={iconSourceId}
                            value={builder.iconName}
                            onChange={(value) => setBuilder((current) => ({ ...current, iconName: value }))}
                            creatureNames={creatureNames}
                            placeholder="Borrow a creature's icon (optional)"
                            maxSuggestions={6}
                          />
                          <button
                            type="button"
                            className="secondary cc-icon-control__upload"
                            onClick={() => iconFileInputRef.current?.click()}
                            disabled={iconBusy}
                          >
                            <ImagePlus size={14} aria-hidden="true" /> {iconBusy ? "Processing…" : "Upload image"}
                          </button>
                        </>
                      )}
                    </div>
                    <input
                      ref={iconFileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        void handleIconFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </div>
                </div>
              </div>
              {/* Template loader demoted to a clearly-framed "start from" helper -
                  it's a convenience, not the primary identity field. */}
              <div className="cc-template">
                <div className="cc-template__head">
                  <span className="cc-template__title">Start from a template</span>
                  <span className="muted">Copy an existing creature's stats &amp; kit as a base, then tweak.</span>
                </div>
                <div className="cc-template__row">
                  <div className="icon-input">
                    <IconImg src={getCreatureIcon(templateName)} alt={templateName || "template"} size={32} />
                    <CreatureNameInput
                      id={templateNameId}
                      value={templateName}
                      onChange={setTemplateName}
                      creatureNames={creatureNames}
                      placeholder="Search existing creature..."
                    />
                  </div>
                  <div className="row-actions">
                    <button type="button" className="secondary" onClick={() => loadTemplate(templateName)} disabled={!templateName.trim()}>
                      Load
                    </button>
                    <button type="button" className="secondary" onClick={() => { setBuilder(createEmptyBuilderState()); setMessage(null); }}>
                      Blank
                    </button>
                  </div>
                </div>
              </div>
              <StorageMeter customCreatures={customCreatures} />
            </div>

            <div className="custom-creature-editor-section cc-section--stats">
              <h4>Core stats</h4>
              <p className="muted cc-section__hint">
                Only Tier, Health, Weight, Damage, and Bite Cooldown are required — everything else is optional.
              </p>
              <div className="custom-creature-stats-grid">
                {REQUIRED_STAT_FIELDS.map(([field, label]) => (
                  <div key={field} className="field">
                    <label>{label}</label>
                    <input aria-label={label} value={builder.stats[field]} onChange={(event) => setBuilder((current) => ({ ...current, stats: { ...current.stats, [field]: event.target.value } }))} />
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => setShowAdvancedStats((current) => !current)}>
                  {showAdvancedStats ? "Hide optional stats" : "Show optional stats"}
                </button>
              </div>
              {showAdvancedStats ? (
                <>
                  <div className="custom-creature-stats-grid">
                    {OPTIONAL_STAT_FIELDS.map(([field, label]) => (
                      <div key={field} className="field">
                        <label>{label}</label>
                        <input aria-label={label} value={builder.stats[field]} onChange={(event) => setBuilder((current) => ({ ...current, stats: { ...current.stats, [field]: event.target.value } }))} />
                      </div>
                    ))}
                  </div>
                  {/* Appetite only feeds Gourmandizer / Reflux. Always available
                      under optional stats so it's never hidden; the hint turns
                      into a call-out when one of those abilities is attached. */}
                  <div className={`custom-creature-optional-section cc-appetite${appetiteRequired ? " cc-appetite--needed" : ""}`}>
                    <div className="custom-creature-optional-head">
                      <strong>Appetite base</strong>
                      <span className="muted">
                        {appetiteRequired
                          ? "Set this — the Gourmandizer / Reflux you attached uses it."
                          : "Only used by Gourmandizer / Reflux. Leave blank otherwise."}
                      </span>
                    </div>
                    <input
                      aria-label="Appetite base"
                      value={builder.appetiteValue}
                      onChange={(event) => setBuilder((current) => ({ ...current, appetiteValue: event.target.value }))}
                      placeholder={appetiteRequired ? "Required, e.g. 1200" : "Optional"}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
          ) : null}

          {showStep("abilities") ? (
          <>
          <div className="custom-creature-editor-section">
            <h4>Supported abilities</h4>
            <p className="muted">
              All abilities the engine recognises - built-in modeled / partial
              entries plus any custom abilities you authored under{" "}
              <em>Custom &gt; Abilities</em>. Click a tile to attach it. Use the{" "}
              <strong>Custom</strong> filter chip to narrow to your own.
            </p>
            <div className="custom-creature-picker-toolbar">
              <input
                value={abilitySearch}
                onChange={(event) => setAbilitySearch(event.target.value)}
                placeholder="Search abilities by name or type..."
                aria-label="Search abilities by name or type"
              />
              <div className="custom-creature-chip-row">
                <button type="button" className={abilityKindFilter === "all" ? "reference-chip active" : "reference-chip"} onClick={() => setAbilityKindFilter("all")}>All</button>
                {(["passive", "activated", "breath", "user"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={abilityKindFilter === kind ? "reference-chip active" : "reference-chip"}
                    onClick={() => setAbilityKindFilter(kind)}
                  >
                    {ABILITY_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
            <div className="custom-creature-picker-list custom-creature-picker-list-abilities">
              {filteredAbilityOptions.length === 0 ? <div className="muted">No supported abilities match the current search.</div> : null}
              {filteredAbilityOptions.map((option) => (
                <button key={`${option.kind}-${option.name}`} type="button" className="custom-creature-picker-item" onClick={() => addAbilityOption(option)}>
                  <div className="custom-creature-picker-copy">
                    <strong>{option.name}</strong>
                    <span className="muted">
                      {buildAbilityMetaText(option)}
                    </span>
                  </div>
                  <span className="custom-creature-picker-action">Add</span>
                </button>
              ))}
            </div>
            <div className="custom-creature-selection-list">
              <label>Selected abilities</label>
              {selectedAbilities.length === 0 && builder.userAbilityIds.length === 0 ? (
                <div className="muted">None selected.</div>
              ) : null}
              {selectedAbilities.map((entry) => {
                const valueOptions = getSelectedAbilityValueOptions(entry, abilityValueOptionsByName);
                return (
                  <div key={`${entry.kind}-${entry.name}`} className="custom-creature-selected-row">
                    <div>
                      <strong>{entry.name}</strong>
                      <div className="muted">{buildAbilityMetaText({ ...entry, valueOptions })}</div>
                    </div>
                    {valueOptions.length > 0 ? (
                      <BetaSelect
                        value={entry.valueInput}
                        onChange={(next) => updateSelectedAbilityValue(entry, next)}
                        options={valueOptions.map((o) => ({ value: o.value, label: o.label }))}
                        ariaLabel={`${entry.name} value`}
                        placeholder="Pick value…"
                      />
                    ) : (
                      <input value={entry.valueInput} onChange={(event) => updateSelectedAbilityValue(entry, event.target.value)} placeholder="value" />
                    )}
                    <span className="muted">
                      {entry.kind === "other"
                        ? "Uses the modeled passive runtime for this ability."
                        : entry.kind === "breath"
                          ? "Will also set Breath automatically if Breath stat is blank."
                          : "Uses the normal ability runtime for this type."}
                    </span>
                    <button type="button" className="secondary" onClick={() => removeSelectedAbility(entry)}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {builder.userAbilityIds.map((id) => {
                const record = customAbilityRecords.find((r) => r.spec.id === id);
                const displayName = record?.spec.display_name ?? id;
                return (
                  <div key={`user-${id}`} className="custom-creature-selected-row">
                    <div>
                      <strong>{displayName}</strong>
                      <div className="muted" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
                        {id}
                      </div>
                    </div>
                    <span className="reference-chip" style={{ alignSelf: "center" }}>Custom</span>
                    <span className="muted">
                      Runs through the engine's user-ability dispatch.
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setBuilder((current) => ({
                          ...current,
                          userAbilityIds: current.userAbilityIds.filter((existingId) => existingId !== id),
                        }));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="custom-creature-editor-section">
            <h4>Custom breath profile</h4>
            <p className="muted">
              Author a breath weapon directly instead of picking a known
              type. When set, this overrides the Breath name - the engine runs your
              profile as-is (build buffs still apply on top). Special-kind picker
              covers lance / plasma / auto-fire / heal / cloud, plus on-tick status
              procs that can reference your custom statuses.
            </p>
            {builder.customBreathProfile ? (
              <>
                <BreathProfileEditor
                  value={builder.customBreathProfile}
                  onChange={(next) =>
                    setBuilder((current) => ({ ...current, customBreathProfile: next }))
                  }
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setBuilder((current) => ({ ...current, customBreathProfile: null }))
                  }
                >
                  Remove custom breath
                </button>
              </>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setBuilder((current) => ({
                    ...current,
                    customBreathProfile: makeBlankBreathProfile(),
                  }))
                }
              >
                + Author custom breath profile
              </button>
            )}
          </div>
          </>
          ) : null}

          {showStep("statuses") ? (
          <div className="custom-creature-editor-section">
            <h4>Supported statuses</h4>
            <p className="muted">
              This picker shows only statuses that currently have at least some implementation on the site: modeled or partial.
            </p>
            <div className="custom-creature-picker-toolbar">
              <input
                value={statusSearch}
                onChange={(event) => setStatusSearch(event.target.value)}
                placeholder="Search supported statuses..."
                aria-label="Search supported statuses"
              />
              <div className="custom-status-inline-row">
                <div className="custom-creature-chip-row">
                  {(["onHit", "onHitTaken", "resist"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={statusDraft.kind === kind ? "reference-chip active" : "reference-chip"}
                      onClick={() =>
                        setStatusDraft((current) => ({
                          ...current,
                          kind,
                          value:
                            current.value === "" ||
                            (current.kind === "resist" && current.value === "0.25") ||
                            (current.kind !== "resist" && current.value === "1")
                              ? kind === "resist"
                                ? "0.25"
                                : "1"
                              : current.value,
                        }))
                      }
                    >
                      {STATUS_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
                <label className="custom-status-inline-value">
                  <span>{statusDraft.kind === "resist" ? "Default Fraction" : "Default Stacks"}</span>
                  <input
                    value={statusDraft.value}
                    onChange={(event) => setStatusDraft((current) => ({ ...current, value: event.target.value }))}
                  />
                </label>
              </div>
            </div>
            <div className="custom-creature-picker-list custom-creature-picker-list-statuses">
              {filteredStatusOptions.length === 0 ? <div className="muted">No supported statuses match the current search.</div> : null}
              {filteredStatusOptions.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  className="custom-creature-picker-item custom-creature-picker-item-status"
                  onClick={() => addStatusEffect(status.id)}
                >
                  <div className="custom-creature-picker-copy">
                    <div className="custom-status-inline-head">
                    <strong>{status.name}</strong>
                      <span className="custom-status-row-badge" data-status={status.status === "Modeled" ? "modeled" : "partial"}>{status.status}</span>
                    </div>
                    <span className="muted">{status.summary}</span>
                    {status.details.length > 0 ? (
                      <span className="muted custom-status-inline-details">
                        {/* Visible bullet separator. Pre-2026-05-18
                            details joined with a single space ran on
                            as a wall of text - on narrow viewports the
                            wrapped lines crowded the next card's title,
                            producing the reported "overlap". */}
                        {status.details.join(" • ")}
                      </span>
                    ) : null}
                  </div>
                  <span className="custom-creature-picker-action">Add</span>
                </button>
              ))}
            </div>
            <div className="custom-creature-selection-list">
              <label>Selected statuses</label>
              {selectedStatuses.length === 0 ? <div className="muted">None selected.</div> : null}
              {selectedStatuses.map((entry) => {
                const statusMeta = statusOptions.find((status) => status.id === entry.statusId);
                return (
                <div key={`${entry.kind}-${entry.statusId}-${entry.index}`} className="custom-creature-selected-row custom-creature-selected-row-status">
                  <div>
                    <strong>{findStatusName(statusOptions, entry.statusId)}</strong>
                    <div className="muted">{STATUS_KIND_LABELS[entry.kind]}</div>
                    {statusMeta ? <div className="muted">{statusMeta.summary}</div> : null}
                    <label className="custom-creature-status-source">
                      <span className="muted">Source</span>
                      <BetaSelect
                        value={entry.sourceAbility}
                        onChange={(next) => updateSelectedStatus(entry, { sourceAbility: next })}
                        ariaLabel="Status source ability"
                        options={[
                          { value: "", label: "Intrinsic (always on)" },
                          ...(entry.sourceAbility && !selectedAbilities.some((ability) => ability.name === entry.sourceAbility)
                            ? [{ value: entry.sourceAbility, label: entry.sourceAbility }]
                            : []),
                          ...selectedAbilities.map((ability) => ({ value: ability.name, label: ability.name })),
                        ]}
                      />
                    </label>
                  </div>
                  <input value={entry.valueInput} onChange={(event) => updateSelectedStatus(entry, { valueInput: event.target.value })} placeholder={entry.kind === "resist" ? "fraction" : "stacks"} />
                  <span className="muted">{entry.kind === "resist" ? "Fraction" : "Stacks"}</span>
                  <button type="button" className="secondary" onClick={() => removeSelectedStatus(entry)}>
                    Remove
                  </button>
                </div>
              )})}
            </div>
          </div>
          ) : null}
          </div>
          </div>
          <aside className="cc-editor__preview-pane">
            <CreaturePreviewCard builder={builder} getCreatureIcon={getCreatureIcon} />
            <div className="cc-preview-code">
              <button
                type="button"
                className="cc-preview-code__copy"
                onClick={() => void copyCurrentCode()}
              >
                <Copy size={14} strokeWidth={2} aria-hidden="true" /> Copy creature code
              </button>
              {lastCode ? (
                <details className="cc-preview-code__details">
                  <summary>View / edit code</summary>
                  <textarea
                    id={lastCodeId}
                    value={lastCode}
                    onChange={(event) => setLastCode(event.target.value)}
                    rows={4}
                    aria-label="Current creature code"
                  />
                </details>
              ) : (
                <p className="cc-preview-code__hint">
                  Builds a shareable, compressed creature code you can paste back in.
                </p>
              )}
            </div>
          </aside>
          </div>
        </div>
      ) : (
        <div className="cc-landing">
          <section className="custom-hero">
            <div className="custom-hero-text">
              <h2 className="custom-hero-title">Custom Creatures</h2>
              <p className="custom-hero-desc muted">
                Build creatures and use them anywhere — they're saved in this browser. Copy a creature's
                code to share it or move it to another device. Pick any as Compare / Best Builds A or B.
              </p>
            </div>
            <div className="custom-hero-actions">
              <button type="button" className="primary cc-new-btn" onClick={openNewCreature}>
                <Plus size={16} strokeWidth={2.6} aria-hidden="true" /> New creature
              </button>
            </div>
          </section>

          {customCreatures.length === 0 ? (
            <div className="creg-empty">
              <span className="creg-empty__icon">
                <PawPrint size={26} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <div className="creg-empty__title">No creatures created yet</div>
              <p className="creg-empty__hint">
                Click <em>New creature</em> to build one from scratch or an existing template, or paste a
                shared creature code below.
              </p>
              <button type="button" className="primary creg-empty__cta" onClick={openNewCreature}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" /> New creature
              </button>
            </div>
          ) : (
            <div className="creg">
              <div className="creg-count">
                {customCreatures.length} saved creature{customCreatures.length === 1 ? "" : "s"}
              </div>
              <StorageMeter customCreatures={customCreatures} />
              <div className="creg-grid">
                {customCreatures.map((record) => {
                  const code = encodeCustomCreatureCode(record);
                  return (
                    <article key={record.creature.name} className="creg-card cc-creature-card">
                      <div className="cc-creature-card__head">
                        <IconImg
                          src={record.iconDataUrl ?? getCreatureIcon(record.creature.name) ?? getCreatureIcon(record.iconName ?? "")}
                          alt={record.creature.name}
                          size={42}
                        />
                        <div className="cc-creature-card__id">
                          <h4 className="creg-card__name">{record.creature.name}</h4>
                          <div className="cc-creature-card__sub">
                            Tier {record.creature.stats.tier} · {record.creature.passiveAbilities?.length ?? 0}P ·{" "}
                            {record.creature.activatedAbilities?.length ?? 0}A ·{" "}
                            {record.creature.breathAbilities?.length ?? 0}B
                          </div>
                        </div>
                      </div>
                      <div className="creg-card__foot">
                        <button type="button" className="creg-card__btn" onClick={() => openEditCreature(record)}>
                          <Pencil size={13} strokeWidth={2} aria-hidden="true" /> Edit
                        </button>
                        <div className="creg-card__actions">
                          <button type="button" className="creg-card__btn" onClick={() => onNameAChange(record.creature.name)} title="Use as Compare/Best Builds A">
                            Use A
                          </button>
                          <button type="button" className="creg-card__btn" onClick={() => onNameBChange(record.creature.name)} title="Use as Compare B">
                            Use B
                          </button>
                          <button
                            type="button"
                            className="creg-card__btn"
                            aria-label={`Copy code for ${record.creature.name}`}
                            onClick={async () => {
                              setLastCode(code);
                              try {
                                await navigator.clipboard.writeText(code);
                                setMessage({ kind: "success", lines: [`Copied code for "${record.creature.name}".`] });
                              } catch {
                                setMessage({ kind: "warning", lines: [`Could not copy "${record.creature.name}" automatically.`] });
                              }
                            }}
                          >
                            <Copy size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="creg-card__btn creg-card__btn--danger"
                            aria-label={`Remove ${record.creature.name}`}
                            onClick={() => {
                              if (!window.confirm(`Remove "${record.creature.name}"? This cannot be undone.`)) return;
                              unregisterCustomCreatureRecord(record.creature.name);
                              setMessage({ kind: "success", lines: [`Removed "${record.creature.name}".`] });
                            }}
                          >
                            <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(`Remove all ${customCreatures.length} custom creatures? This cannot be undone.`)) return;
                    clearCustomCreatureRecords();
                    setMessage({ kind: "success", lines: ["Removed all custom creatures."] });
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className="cc-import">
            <label htmlFor={importCodeId} className="cc-import__label">Import a creature from a shared code</label>
            <textarea
              id={importCodeId}
              value={importCode}
              onChange={(event) => setImportCode(event.target.value)}
              rows={3}
              placeholder="Paste a creature code here."
            />
            <div className="row-actions">
              <button type="button" className="secondary" onClick={importCreatureCode} disabled={!importCode.trim()}>
                Import code
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const PREVIEW_STAT_TILES: Array<[keyof BuilderState["stats"], string, string?]> = [
  ["health", "HP"],
  ["damage", "Damage"],
  ["weight", "Weight"],
  ["biteCooldown", "Bite CD", "s"],
  ["healthRegen", "HP Regen"],
  ["stamRegen", "Stam Regen"],
];

function prettyStatusId(statusId: string): string {
  return statusId.replace(/_Status$/i, "").replace(/_/g, " ").trim() || statusId;
}

// How full the browser's ~5 MB localStorage budget is. Custom icons are the
// heaviest thing the user can store here, so this surfaces the cost and warns
// before a save would be rejected. Recomputes whenever the saved set changes
// (a save or delete rewrites the storage key).
function StorageMeter({ customCreatures }: { customCreatures: CustomCreatureRecord[] }) {
  const [usage, setUsage] = useState(() => getLocalStorageUsage());
  useEffect(() => {
    setUsage(getLocalStorageUsage());
  }, [customCreatures]);
  const pct = Math.round(usage.ratio * 100);
  const level = usage.ratio >= 0.95 ? "danger" : usage.ratio >= 0.8 ? "warn" : "ok";
  return (
    <div className={`cc-storage cc-storage--${level}`}>
      <div className="cc-storage__head">
        <span className="cc-storage__label">Browser storage</span>
        <span className="cc-storage__value">
          {formatBytes(usage.usedBytes)} / {formatBytes(usage.budgetBytes)}
        </span>
      </div>
      <div className="cc-storage__bar">
        <div className="cc-storage__fill" style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      {level !== "ok" ? (
        <p className="cc-storage__note">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {level === "danger"
              ? "Storage is full. New creatures and uploaded icons can't be saved — they'll work this session but vanish on reload. Remove a creature or icon to free space."
              : "Storage is filling up. Uploaded icons take the most space; free some before saving fails."}
          </span>
        </p>
      ) : null}
    </div>
  );
}

// Live preview of the creature being edited - updates as the form is filled,
// mirroring the beta creature-card aesthetic (icon + name + tier, stat tiles,
// ability / status chips). Reads the builder state directly (no engine build),
// so it shows even a partially-filled creature.
function CreaturePreviewCard({
  builder,
  getCreatureIcon,
}: {
  builder: BuilderState;
  getCreatureIcon: (name: string) => string | null;
}) {
  const abilities = collectSelectedAbilities(builder);
  const statuses = collectSelectedStatuses(builder);
  const name = builder.name.trim();
  const iconSrc = builder.iconDataUrl ?? getCreatureIcon(builder.iconName.trim() || name);
  const tier = builder.stats.tier.trim();
  return (
    <div className="cc-preview">
      <div className="cc-preview__head">
        <IconImg src={iconSrc} alt={name || "preview"} size={48} />
        <div className="cc-preview__id">
          <strong className="cc-preview__name">{name || "Unnamed creature"}</strong>
          <span className="cc-preview__tier">Tier {tier || "—"}</span>
        </div>
      </div>
      <div className="cc-preview__stats">
        {PREVIEW_STAT_TILES.map(([field, label, suffix]) => {
          const value = (builder.stats[field] ?? "").trim();
          return (
            <div key={field} className="cc-preview__stat">
              <span className="cc-preview__stat-label">{label}</span>
              <span className="cc-preview__stat-value">{value ? `${value}${suffix ?? ""}` : "—"}</span>
            </div>
          );
        })}
      </div>
      <div className="cc-preview__section">
        <span className="cc-preview__section-label">Abilities · {abilities.length}</span>
        {abilities.length === 0 ? (
          <span className="cc-preview__empty">None selected yet</span>
        ) : (
          <div className="cc-preview__chips">
            {abilities.map((ability) => (
              <span key={`${ability.kind}-${ability.name}`} className="cc-preview__chip">
                {ability.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="cc-preview__section">
        <span className="cc-preview__section-label">Statuses · {statuses.length}</span>
        {statuses.length === 0 ? (
          <span className="cc-preview__empty">None selected yet</span>
        ) : (
          <div className="cc-preview__chips">
            {statuses.map((status, index) => (
              <span
                key={`${status.kind}-${status.statusId}-${index}`}
                className={`cc-preview__chip cc-preview__chip--status cc-preview__chip--status-${status.kind}`}
              >
                <span className="cc-preview__chip-kind">{STATUS_KIND_LABELS[status.kind]}</span>
                {prettyStatusId(status.statusId)}
                {status.valueInput ? ` ${status.valueInput}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
