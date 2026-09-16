'use client';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Flag } from 'lucide-react';
import type { State, Member, Action } from '@/lib/model';
export type AppTools = {
  s: State;
  me: Member;
  busy: boolean;
  workspace: string;
  demo: boolean;
  view: string;
  act: (a: Action) => Promise<any>;
  edit: (kind: string, data?: any) => void;
  refresh: () => Promise<void>;
};
export function Pick({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(v) => onChange(String(v || ''))}
      disabled={disabled}
    >
      <SelectTrigger className="pick" aria-label={label}>
        <SelectValue>
          {options.find((o) => o.value === value)?.label || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function CheckField({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check-field">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  large = false,
  hint,
  min,
  max,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  large?: boolean;
  hint?: string;
  min?: number | string;
  max?: number | string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {large ? (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={2000}
          rows={3}
        />
      ) : (
        <input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          maxLength={type === 'text' ? 500 : undefined}
          min={min}
          max={max}
          step={type === 'number' ? 'any' : undefined}
        />
      )}{' '}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Flag size={32} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === 'live' || status === 'completed' ? 'green' : status === 'scheduled' ? 'amber' : ''}`}
    >
      {status === 'live'
        ? '● Live scoring'
        : status === 'completed'
          ? '✓ Completed'
          : status === 'scheduled'
            ? 'Upcoming'
            : status}
    </span>
  );
}
export function dateLabel(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
export function Dot({ color }: { color: string }) {
  return <span className="team-dot" style={{ background: color }} />;
}
