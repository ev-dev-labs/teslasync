---
description: "Replace window.prompt() and window.confirm() with proper Modal dialogs on Commands page"
---

# Replace Browser Dialogs with Modal Components

## Problem

The Vehicle Commands page uses `window.prompt()` for PIN entry, temperature input,
speed limits, and `window.confirm()` for destructive commands. These browser dialogs:
- Look ugly and break the glassmorphic design
- Don't work well on mobile (tiny text, no styling)
- Can't be customized (no validation feedback, no icons)
- Block the main thread

## Current State

```
web/src/features/system/pages/CommandsPage.tsx
```

Commands using `window.prompt()` (count: 10+):
- Speed Limit — enter MPH (line 260)
- Speed Limit Activate — enter PIN (line 276)
- Speed Limit Deactivate — enter PIN (line 289)
- Clear Speed PIN — enter PIN (line 301)
- Valet Mode — enter PIN (line 322)
- PIN to Drive — enter PIN (line 364)
- Set Temps — enter °C (line 397)
- COP Temperature — select level (line 478)
- Set Charging Amps — enter amps (line ~545)
- Set Charge Limit — enter % (line ~555)
- Send Address — enter address (line ~690)
- Send GPS — enter lat,lon (line ~700)

Commands using `window.confirm()`:
- Erase Data (line 352)
- Remote Start Drive (line ~575)

## Available Components

- `Modal` from `@/components/ui` — open/onClose/title/size props, glassmorphic styling
- `Input` from `@/components/ui` — styled text input
- `Button` from `@/components/ui` — styled button with loading state
- `Select` from `@/components/ui` — dropdown select

## Task

### Step 1: Create Reusable Command Dialog Components

Create `web/src/features/system/components/CommandInputDialog.tsx`:

A general-purpose dialog for commands that need user input (PIN, temperature, etc.):

```tsx
interface CommandInputDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  validation?: (value: string) => string | null;  // returns error message or null
  loading?: boolean;
  icon?: React.ReactNode;
}
```

Features:
- Glassmorphic Modal with icon + title
- Input with real-time validation feedback
- Submit button disabled until valid
- Enter key submits, Escape closes
- Password type for PIN entry (dots instead of digits)
- Auto-focus input on open

### Step 2: Create Confirmation Dialog for Dangerous Commands

Create `web/src/features/system/components/CommandConfirmDialog.tsx`:

```tsx
interface CommandConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;    // default: "Confirm"
  variant?: 'danger' | 'warning';
  loading?: boolean;
  countdown?: number;       // seconds before confirm button enables (default: 3 for danger)
}
```

Features:
- Red/amber styling based on variant
- AlertTriangle icon for danger
- Countdown timer for destructive commands (button disabled for 3s)
- "Type ERASE to confirm" for Erase Data command specifically

### Step 3: Create Select Dialog for Multi-Option Commands

Create `web/src/features/system/components/CommandSelectDialog.tsx`:

For commands with fixed options (COP Temperature: Low/Med/High, Sunroof: Vent/Close/Stop):

```tsx
interface CommandSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  title: string;
  options: Array<{ value: string; label: string; description?: string; icon?: React.ReactNode }>;
  loading?: boolean;
}
```

### Step 4: Replace All Browser Dialogs

Update `CommandsPage.tsx` (or the new component files from the commands page
improvement prompt) to use these dialog components.

**PIN Entry commands** → `CommandInputDialog` with `type="password"` and
`validation={v => /^\d{4}$/.test(v) ? null : 'Enter a 4-digit PIN'}`:
- Speed Limit Activate/Deactivate
- Clear Speed PIN
- Valet Mode
- PIN to Drive

**Numeric Input commands** → `CommandInputDialog` with `type="number"`:
- Speed Limit (validation: 50-90)
- Set Temps (validation: 15-30°C)
- Set Charging Amps (validation: 1-48)
- Set Charge Limit (validation: 50-100%)

**Text Input commands** → `CommandInputDialog` with `type="text"`:
- Send Address
- Send GPS coordinates
- Rename Vehicle
- Schedule Software Update (time input)

**Multi-option commands** → `CommandSelectDialog`:
- COP Temperature (Low / Medium / High)

**Destructive commands** → `CommandConfirmDialog` with `variant="danger"`:
- Erase Data (countdown: 5, type "ERASE" to confirm)
- Remote Start Drive (countdown: 3)

### Step 5: State Management

Use a single dialog state reducer in the vehicle command center:

```tsx
type DialogState =
  | { type: 'closed' }
  | { type: 'input'; config: CommandInputDialogProps }
  | { type: 'confirm'; config: CommandConfirmDialogProps }
  | { type: 'select'; config: CommandSelectDialogProps };

const [dialog, setDialog] = useState<DialogState>({ type: 'closed' });
```

This avoids having 15 separate `useState` booleans for each dialog.

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] All PIN entry commands show modal with password input
- [ ] All numeric commands show modal with number input + validation
- [ ] Erase Data shows danger confirmation with countdown
- [ ] Remote Start shows danger confirmation with countdown
- [ ] No `window.prompt()` or `window.confirm()` calls remain in the file
- [ ] Modals are keyboard accessible (Enter submits, Escape closes)
- [ ] Modals look correct on mobile viewport (375px)

## Commit

```bash
git add -A
git commit -m "feat(web): replace browser dialogs with glassmorphic modals on Commands page

- Create CommandInputDialog for PIN, temp, and numeric inputs
- Create CommandConfirmDialog with countdown for destructive commands
- Create CommandSelectDialog for multi-option commands
- Replace all window.prompt() and window.confirm() calls
- Add real-time validation feedback on all inputs"
```
