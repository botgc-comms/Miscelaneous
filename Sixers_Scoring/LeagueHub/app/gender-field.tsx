'use client';
import { Pick } from './widgets';
export function GenderField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>Gender (optional)</span>
      <Pick
        label="Gender for participation statistics"
        value={value || 'not-recorded'}
        onChange={(v) => onChange(v === 'not-recorded' ? '' : v)}
        options={[
          { value: 'not-recorded', label: 'Not recorded' },
          { value: 'boy', label: 'Boy' },
          { value: 'girl', label: 'Girl' },
          { value: 'another', label: 'Another gender' },
          { value: 'prefer-not-to-say', label: 'Prefer not to say' },
        ]}
      />
      <small>
        Used in the Foundation’s participation statistics. You can leave this
        blank or update it later.
      </small>
    </label>
  );
}
