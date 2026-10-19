'use client'
import { useId, type ReactNode } from 'react'

// Native form controls styled per the design (label above control,
// 42px inputs, reskinned select chevron) with the design tokens.

const control = [
  'w-full rounded-(--radius-sharp) border border-(--color-border-control) bg-(--color-bg-surface)',
  'text-base text-(--color-text-primary) placeholder:text-(--color-text-tertiary)',
  'transition-[border-color] duration-150 ease',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)',
  'disabled:opacity-40 disabled:cursor-not-allowed',
].join(' ')

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1 mb-3">
      <label htmlFor={htmlFor} className="text-base font-medium text-(--color-text-primary)">{label}</label>
      {children}
      {hint ? <p className="text-sm text-(--color-text-tertiary) m-0">{hint}</p> : null}
    </div>
  )
}

export function Select({ label, hint, value, onChange, options, id: idProp, disabled }: {
  label: string
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  id?: string
  disabled?: boolean
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${control} h-[42px] px-3 pr-9 appearance-none cursor-pointer bg-no-repeat bg-[right_12px_center] bg-[length:16px_16px]`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2388899D' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-(--color-bg-overlay)">
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function TextInput({ label, hint, value, onChange, placeholder, id: idProp, type = 'text', mono }: {
  label: string
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
  type?: string
  mono?: boolean
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className={`${control} h-[42px] px-3 ${mono ? 'font-mono text-sm' : ''}`}
      />
    </Field>
  )
}

export function TextArea({ label, hint, value, onChange, placeholder, rows = 3 }: {
  label: string
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`${control} px-3 py-2 font-mono text-sm resize-y`}
      />
    </Field>
  )
}

export function CheckRow({ checked, onChange, children, id: idProp, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  id?: string
  disabled?: boolean
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <div className="flex items-start gap-2 my-1.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-4 w-4 shrink-0 cursor-pointer accent-(--color-text-primary)"
      />
      <label htmlFor={id} className="text-base text-(--color-text-secondary) cursor-pointer">{children}</label>
    </div>
  )
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="border-0 p-0 m-0 mb-3">
      <legend className="text-base font-medium text-(--color-text-primary) mb-1">{legend}</legend>
      {children}
    </fieldset>
  )
}
