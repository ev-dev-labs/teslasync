# Form Guidelines

TeslaSync forms follow a single set of conventions for validation, error
display, dirty-state warnings, and autosave so users get the same experience
across pages.

## TL;DR

| Need                         | Use                                                                         |
| ---------------------------- | --------------------------------------------------------------------------- |
| Validate user input          | A `zod` schema co-located with the form                                     |
| React forms layer            | `react-hook-form` + `@hookform/resolvers/zod` (for new forms)               |
| Field error rendering        | Built-in `error` prop on `<Input>` / `<Select>` / `<Textarea>` or `<FormField>` |
| Form-level / cross-field err | `<AlertBanner variant="danger">` at the top of the form                     |
| Submit success / failure     | `useMutationToast()` from `@/api/hooks/_toastHelpers`                       |
| "You have unsaved changes"   | `useDirtyForm(isDirty)`                                                     |
| Long-form draft persistence  | `useAutosave({ key, data })` + `loadAutosave(key)` + `clearAutosave(key)`   |
| Confirm Cancel / back        | `useConfirm()` paired with strings from `useDirtyForm`                      |

---

## 1. Validation

Define a single zod schema next to the form. The schema is the source of
truth for shape and validation rules — the same schema runs on every save.

```ts
// web/src/features/notifications/schemas/alertRule.ts
import { z } from 'zod'

export const alertRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  signal_name: z.string().trim().min(1, 'Signal is required'),
  op: z.enum(['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']),
  cooldown_min: z.number().int().min(1).max(1440),
  // ...
}).superRefine((data, ctx) => {
  // cross-field rules (range needs min<=max, etc.)
})

export type AlertRuleFormData = z.infer<typeof alertRuleSchema>
```

**Validation triggers**

- **On blur** — primary feedback. The user knows something is wrong as soon
  as they leave the field.
- **On submit** — backstop. Every field is validated again before the
  mutation fires.
- **Never on every keystroke** — too noisy.

For new forms wired via `react-hook-form`, this is the default — pass
`mode: 'onBlur'` and `resolver: zodResolver(alertRuleSchema)` to `useForm()`.

---

## 2. Error display

| Error kind                       | Where it goes                                                          |
| -------------------------------- | ---------------------------------------------------------------------- |
| Single field invalid             | Inline below the field — the `error` prop on `<Input>` / `<Select>` / `<Textarea>`, or `<FormField error={...}>` for composite controls |
| Cross-field / form-level         | `<AlertBanner variant="danger">` at the top of the form                |
| Server validation (4xx with body)| Same `<AlertBanner>` slot — `setError('root', ...)` if using RHF        |
| Submit network failure (5xx)     | Toast — `useMutationToast().error(err, key, fallback)`                  |
| Successful save                  | Toast — `useMutationToast().success(key, fallback)`                     |

```tsx
{formError && (
  <AlertBanner variant="danger">{formError}</AlertBanner>
)}

<Input
  label={t('alerts.name', 'Name')}
  {...register('name')}
  error={errors.name?.message}
/>

<FormField label={t('alerts.signal', 'Signal')} error={errors.signal_name?.message}>
  <SignalPicker value={signal} onChange={setSignal} />
</FormField>
```

---

## 3. Unsaved-changes guard (`useDirtyForm`)

Long-form editors (Alert Studio rule editor, Automation builder, Geofence
form) should warn the user before they lose work.

```tsx
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useConfirm } from '@/hooks/useConfirm'

const { isDirty, title, message, discardLabel, keepEditingLabel } =
  useDirtyForm(form.formState.isDirty)
const { confirm, dialogProps } = useConfirm()

const handleCancel = async () => {
  if (isDirty) {
    const ok = await confirm({
      title, message,
      variant: 'warning',
      confirmLabel: discardLabel,
      cancelLabel: keepEditingLabel,
    })
    if (!ok) return
  }
  navigate(-1)
}

return (
  <>
    <Button onClick={handleCancel}>{t('common.cancel', 'Cancel')}</Button>
    {dialogProps && <ConfirmDialog {...dialogProps} />}
  </>
)
```

**Browser navigation** (refresh / close tab / external link) is automatically
guarded via `beforeunload` — no extra wiring needed.

**In-app navigation guard limitation:** TeslaSync uses `<BrowserRouter>` (not
the data-router API), so React Router's `useBlocker` is not available. For
in-app Cancel / back buttons, pair `useDirtyForm` with `useConfirm()` as
shown above. Full route-blocker support requires migrating `main.tsx` to
`createBrowserRouter` + `RouterProvider`.

---

## 4. Autosave drafts (`useAutosave`)

For long-form editors where the user might walk away mid-edit, persist a
draft to `localStorage` so the next session can offer a "Restore draft?"
prompt.

```tsx
import { useAutosave, loadAutosaveEnvelope, clearAutosave } from '@/hooks/useAutosave'

const DRAFT_KEY = `alert-rule-${selectedId ?? 'new'}`

// On open: offer to restore the previous draft (if any).
useEffect(() => {
  const envelope = loadAutosaveEnvelope<EditorState>(DRAFT_KEY)
  if (envelope && shouldOfferRestore(envelope.savedAt)) {
    // Show "Restore draft from X minutes ago?" prompt — see useConfirm.
  }
}, [DRAFT_KEY])

// While editing: persist the draft on a debounce.
useAutosave({ key: DRAFT_KEY, data: editor, paused: isSaving })

// On successful submit: clear the draft so it doesn't resurrect.
useEffect(() => {
  if (saveMut.isSuccess) clearAutosave(DRAFT_KEY)
}, [saveMut.isSuccess])
```

**When to autosave**

- Multi-step or 5+ field forms where the user invests time before submit.
- Long free-text fields (rule descriptions, automation actions).

**When not to autosave**

- Single-field inline edits (settings toggles save on change).
- Forms that contain secrets (passwords, tokens) — never persist these to
  `localStorage`.

---

## 5. Field components

| Use                              | Why                                                                       |
| -------------------------------- | ------------------------------------------------------------------------- |
| `<Input>` from `@/components/ui` | Most fields. Built-in `label`, `hint`, `error`, `icon`, `suffix`.         |
| `<Select>`, `<Textarea>`         | Same — they share the field shape.                                        |
| `<Toggle>`                       | Boolean toggles. Renders its own label.                                   |
| `<FormField>` from `@/components/forms` | Custom composite controls (coordinate pickers, code editors) and  toggle groups that don't accept a `label` prop. Provides label + hint + error in the same shape so the page stays visually consistent. |

Never roll your own `<label>` + `<input>` + `<p className="text-red-…">`
combo — use one of the above.

---

## 6. Submit pattern

```tsx
const { handleSubmit, register, formState: { errors, isDirty, isSubmitting } } =
  useForm<AlertRuleFormData>({ resolver: zodResolver(alertRuleSchema), mode: 'onBlur' })
const saveMut = useSaveAlertRule()
useDirtyForm(isDirty)
useAutosave({ key, data: watchAll, paused: isSubmitting })

const onSubmit = handleSubmit(async (data) => {
  try {
    await saveMut.mutateAsync(data)
    clearAutosave(key)
    navigate('/alerts')
  } catch (err) {
    setError('root', { message: err instanceof Error ? err.message : 'Save failed' })
  }
})

<form onSubmit={onSubmit} noValidate>
  {errors.root && <AlertBanner variant="danger">{errors.root.message}</AlertBanner>}
  <Input label={t('name', 'Name')} {...register('name')} error={errors.name?.message} />
  …
  <Button type="submit" loading={isSubmitting}>{t('common.save', 'Save')}</Button>
</form>
```

---

## 7. Adoption status (Phase 40 / Prompt 28)

- ✅ `<FormField>`, `useDirtyForm`, `useAutosave` shipped
- ✅ `alertRuleSchema`, `geofenceFormSchema` shipped
- ✅ Alert Studio editor: dirty guard + autosave + zod validation
- ✅ Geofence editor: zod validation + dirty guard
- ✅ Automation builder: dirty guard + autosave (replacing inline beforeunload)
- 🚧 Settings sections — auto-save on change; dirty guard not applicable
- 🚧 Remaining forms — adopt incrementally as touched
