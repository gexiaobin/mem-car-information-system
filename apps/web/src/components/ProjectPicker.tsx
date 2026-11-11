import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Project } from "@autovoyage/shared";

export type ProjectSelection = { selected: string[]; custom: string[] };

/** Standard project chips plus a bounded free-text list for items the store has not catalogued. */
export default function ProjectPicker({
  projects,
  selected,
  custom,
  onChange,
  filter,
  legend = "本次服务项目（可多选）",
  customLegend = "其他项目（手动填写）",
  single = false,
  maxCustom = 8,
  disabled = false,
}: {
  projects: Project[];
  selected: string[];
  custom: string[];
  onChange: (next: ProjectSelection) => void;
  filter?: (project: Project) => boolean;
  legend?: string;
  customLegend?: string;
  single?: boolean;
  maxCustom?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const toggle = (projectId: string) => {
    if (single) {
      onChange({
        selected: selected.includes(projectId) ? [] : [projectId],
        custom: [],
      });
      return;
    }
    onChange({
      selected: selected.includes(projectId)
        ? selected.length > 1
          ? selected.filter((id) => id !== projectId)
          : selected
        : [...selected, projectId],
      custom,
    });
  };
  const addCustom = () => {
    const value = draft.trim();
    if (!value) return;
    if (value.length > 60) {
      setNote("单个补充项目请控制在 60 字以内");
      return;
    }
    if (custom.includes(value)) {
      setNote("该项目已添加");
      return;
    }
    if (!single && custom.length >= maxCustom) {
      setNote(`最多补充 ${maxCustom} 个项目`);
      return;
    }
    setNote("");
    setDraft("");
    onChange({
      selected: single ? [] : selected,
      custom: single ? [value] : [...custom, value],
    });
  };
  return (
    <fieldset className="project-group-filter" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="project-choice-chips">
        {projects
          .filter((project) => project.active && (filter ? filter(project) : true))
          .map((project) => (
            <button
              key={project.id}
              type="button"
              aria-pressed={selected.includes(project.id)}
              className={selected.includes(project.id) ? "selected" : ""}
              onClick={() => toggle(project.id)}
            >
              {selected.includes(project.id) && <Check size={14} />} {project.name}
            </button>
          ))}
      </div>
      <p className="project-custom-legend">{customLegend}</p>
      {custom.length > 0 && (
        <div className="project-choice-chips project-custom-chips">
          {custom.map((item) => (
            <button
              key={item}
              type="button"
              className="selected"
              aria-pressed="true"
              onClick={() => onChange({ selected, custom: custom.filter((x) => x !== item) })}
            >
              <X size={14} /> {item}
            </button>
          ))}
        </div>
      )}
      <div className="project-custom-add">
        <input
          value={draft}
          maxLength={60}
          placeholder="如：加装行车记录仪"
          aria-label={customLegend}
          onChange={(e) => {
            setDraft(e.target.value);
            setNote("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={addCustom} disabled={!draft.trim()}>
          <Plus size={16} /> 添加
        </button>
      </div>
      {note && <p className="project-custom-note" role="status">{note}</p>}
    </fieldset>
  );
}
