import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type GbSelectValue = string | number;

export type GbSelectOption = {
  value: GbSelectValue;
  label: string;
  description?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  tone?: "default" | "green" | "yellow" | "red" | "gray";
};

type Props = {
  value: GbSelectValue | null | undefined;
  options: GbSelectOption[];
  onChange: (value: GbSelectValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  renderOption?: (option: GbSelectOption, selected: boolean) => ReactNode;
};

function toneClass(tone?: GbSelectOption["tone"]) {
  return tone && tone !== "default" ? ` gb-select-option-${tone}` : "";
}

export function GbSelect({
  value,
  options,
  onChange,
  placeholder = "select...",
  disabled = false,
  className = "",
  style,
  testId,
  renderOption,
}: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => String(option.value) === String(value));
  const hasSelection = !!selected;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className={`gb-select ${className}`} style={style}>
      <button
        id={id}
        type="button"
        className={`gb-input gb-select-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        disabled={disabled}
        onClick={() => !disabled && setOpen((current) => !current)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !disabled) {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
      >
        <span className={hasSelection ? "gb-select-value" : "gb-select-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
      </button>

      {open && !disabled && (
        <div className="gb-select-menu" role="listbox" aria-labelledby={id}>
          {options.length ? options.map((option) => {
            const selectedOption = selected ? String(selected.value) === String(option.value) : false;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={selectedOption}
                aria-disabled={option.disabled || undefined}
                className={`gb-select-option${selectedOption ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}${toneClass(option.tone)}`}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {renderOption ? renderOption(option, selectedOption) : (
                  <>
                    <span className="gb-select-option-label">{option.label}</span>
                    {option.description && <span className="gb-select-option-desc">{option.description}</span>}
                    {option.meta && <span className="gb-select-option-meta">{option.meta}</span>}
                  </>
                )}
              </button>
            );
          }) : (
            <div className="gb-select-empty">no options</div>
          )}
        </div>
      )}
    </div>
  );
}
