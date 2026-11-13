import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Same look as the sign-up inputs, with a smaller corner radius for onboarding. */
export const fieldClass =
  "w-full rounded-md border border-input bg-white px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground";

export function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive" aria-hidden>*</span> : <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
      </span>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select",
  invalid,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldClass, "appearance-none pr-9", !value && "text-subtle-foreground", invalid && "border-destructive focus:border-destructive focus:ring-destructive/15")}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** A dropdown you can type into. `allowCustom` lets people use a value that isn't in the list. */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Search",
  invalid,
  disabled,
  allowCustom,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
  label: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(value), [value]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setQ(value);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [value]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s && s !== value.toLowerCase() ? options.filter((o) => o.toLowerCase().includes(s)) : options;
    return list.slice(0, 60);
  }, [q, options, value]);
  const typed = q.trim();
  const canUseTyped = allowCustom && typed.length > 1 && !options.some((o) => o.toLowerCase() === typed.toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setQ(v);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-invalid={invalid || undefined}
        aria-autocomplete="list"
        disabled={disabled}
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          // Typing only filters the list. The value changes when an option is picked (or typed text is accepted).
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQ(value);
          }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            if (shown[0]) pick(shown[0]);
            else if (canUseTyped) pick(typed);
          }
        }}
        className={cn(fieldClass, "pl-9", invalid && "border-destructive focus:border-destructive focus:ring-destructive/15")}
      />
      {open && !disabled ? (
        <ul id={id} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-white p-1 shadow-lift">
          {shown.map((o) => (
            <li key={o} role="option" aria-selected={o === value}>
              <button type="button" onClick={() => pick(o)} className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-muted">
                {o}
                {o === value ? <Check className="size-4 text-primary" /> : null}
              </button>
            </li>
          ))}
          {canUseTyped ? (
            <li>
              <button type="button" onClick={() => pick(typed)} className="w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-primary transition hover:bg-muted">
                Use “{typed}”
              </button>
            </li>
          ) : null}
          {shown.length === 0 && !canUseTyped ? <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** A selectable card. `multi` shows a checkbox, otherwise a radio dot. */
export function OptionCard({
  selected,
  onClick,
  multi,
  icon: Icon,
  title,
  text,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  multi?: boolean;
  icon?: ComponentType<{ className?: string }>;
  title: string;
  text?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "group flex items-start gap-3 rounded-md border p-3.5 text-left transition",
        selected ? "border-primary/50 bg-primary/5 ring-4 ring-primary/10" : "border-input bg-white hover:border-primary/40 hover:bg-muted/60",
        className,
      )}
    >
      {Icon ? (
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-md transition", selected ? "bg-gradient-primary text-on-brand" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
          <Icon className="size-4.5" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {text ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{text}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center border transition",
          multi ? "rounded-sm" : "rounded-full",
          selected ? "border-primary bg-primary text-on-brand" : "border-input bg-white",
        )}
      >
        {selected ? multi ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-2 rounded-full bg-white" /> : null}
      </span>
    </button>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
