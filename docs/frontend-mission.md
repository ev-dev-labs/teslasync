MISSION

Modernize the ENTIRE TeslaSync frontend into a cohesive, polished,
production-quality application.

Repository:

F:\github\TeslaSync\web

This is NOT a page-by-page cosmetic redesign.

The objective is to establish a consistent frontend architecture and
design system, then systematically migrate the entire application to it.

The final application should feel as though one senior product design
and engineering team built the entire product.

============================================================
0. NON-NEGOTIABLE PRINCIPLES
============================================================

1. Inspect before changing.
2. Preserve existing functionality and business behavior.
3. Do not invent backend capabilities or fake data.
4. Establish shared design patterns before redesigning individual pages.
5. Reuse components aggressively where patterns repeat.
6. Do not create competing implementations of the same UI pattern.
7. Responsive design is required, not optional.
8. Accessibility is required, not optional.
9. Loading, empty, error and offline states are part of the design.
10. Do not equate "modern" with neon, gradients, glassmorphism or excessive
    rounded cards.
11. Prefer subtle, sophisticated visual design.
12. Optimize for information hierarchy and usability over decoration.
13. Do not sacrifice functionality for visual appearance.
14. Do not declare success merely because TypeScript/build passes.
15. Perform visual and responsive QA after implementation.
16. When a repeated pattern is discovered, consider extracting a shared
    component before continuing.
17. Global design changes must remain consistent across the entire app.
18. Do not allow feature agents to independently invent new visual systems.

============================================================
1. COMPLETE APPLICATION AUDIT
============================================================

Before modifying UI, inspect the entire frontend.

Inspect:

src/
routes
pages
layouts
components
features
hooks
services
api
stores
types
utils
styles
assets
themes
charts
tests

Also inspect:

package.json
Tailwind configuration
CSS architecture
theme configuration
routing
authentication
state management
query/cache layer
API layer
chart libraries
icon libraries
testing configuration
build configuration

Create an application inventory.

For every route/page record:

- route
- purpose
- primary user goal
- data source
- major components
- current design patterns
- duplicated components
- responsive issues
- accessibility issues
- loading behavior
- empty behavior
- error behavior
- visual inconsistencies
- architectural issues
- modernization priority

DO NOT begin random page redesigns before this audit.

============================================================
2. CREATE FRONTEND DESIGN CONTRACT
============================================================

Create a single source of truth:

frontend-design-contract.md

or equivalent existing project documentation.

Every frontend agent MUST read this before modifying UI.

It defines:

- colors
- typography
- spacing
- surfaces
- borders
- radius
- shadows
- icons
- buttons
- forms
- tables
- navigation
- dialogs
- drawers
- charts
- states
- responsive rules
- accessibility
- motion
- component architecture

The design contract must be treated as an application-wide API.

============================================================
3. DESIGN SYSTEM ARCHITECTURE
============================================================

Use this architecture:

Design Tokens
      ↓
Primitive Components
      ↓
Composite Components
      ↓
Feature Components
      ↓
Pages
      ↓
Application Shell

Do NOT allow every page to invent its own visual implementation.

Example:

Design Tokens
 ├── colors
 ├── typography
 ├── spacing
 ├── radius
 ├── elevation
 ├── breakpoints
 └── motion

        ↓

Primitives
 ├── Button
 ├── Card
 ├── Input
 ├── Badge
 ├── Icon
 ├── Tooltip
 ├── Skeleton
 └── Progress

        ↓

Composite Components
 ├── PageHeader
 ├── MetricCard
 ├── StatusBadge
 ├── ChartCard
 ├── DataTable
 ├── FilterBar
 ├── EmptyState
 ├── ErrorState
 ├── LoadingState
 └── ActionMenu

        ↓

Feature Components

        ↓

Pages

============================================================
4. SHARED COMPONENT RULE
============================================================

Before creating a new component, ask:

"Does this pattern already exist?"

"Can an existing component support this use case?"

"Will another feature need this?"

"Should this become a shared component?"

If three or more areas use the same pattern, strongly consider
extracting it.

Do NOT create:

BatteryCard
BatterySummaryCard
BatteryMetricCard
BatteryStatusCard

if they are all variations of the same underlying pattern.

Prefer a composable shared component.

============================================================
5. COLOR SYSTEM
============================================================

IMPORTANT:

NO NEON UI.

Do not use fluorescent colors as the default visual language.

Avoid excessive use of:

- fluorescent green
- electric cyan
- neon purple
- radioactive yellow
- highly saturated gradients
- glowing borders
- glowing text
- glowing shadows
- neon chart lines
- neon progress bars

Do NOT equate:

modern = neon
futuristic = neon
technical = neon

The target aesthetic is:

premium
calm
technical
modern
sophisticated
subtle

Use semantic colors.

Example categories:

background
surface
surface-elevated
surface-hover

border
border-subtle

text-primary
text-secondary
text-muted
text-disabled

brand
success
warning
error
info

online
offline
charging
stale

Use muted/desaturated accents.

Color should communicate meaning and hierarchy,
not decorate every component.

============================================================
6. TEXT COLOR SYSTEM
============================================================

Do not use pure white everywhere.

Establish:

Primary text
Secondary text
Tertiary/muted text
Disabled text

Example dark-theme direction:

Primary:
soft off-white

Secondary:
medium-light gray

Muted:
subtle gray

Disabled:
low-emphasis gray

All muted colors must still satisfy accessibility requirements.

Do not make secondary information unnecessarily bright.

============================================================
7. VISUAL INTENSITY
============================================================

Every page has a limited visual intensity budget.

Ask:

"What should the user look at first?"

Only important information should receive strong visual emphasis.

Typical hierarchy:

Primary metric
    ↓
Important state
    ↓
Primary action
    ↓
Secondary information
    ↓
Metadata

Do not make every card, chart, label and badge visually loud.

============================================================
8. SURFACE SYSTEM
============================================================

Use surfaces to create hierarchy instead of bright colors.

Example:

Application background
      ↓
Surface
      ↓
Elevated surface
      ↓
Hover surface

Differences should primarily come from:

- subtle brightness
- borders
- spacing
- elevation

Avoid excessive shadows.

Avoid glowing cards.

Avoid excessive glassmorphism.

============================================================
9. TYPOGRAPHY
============================================================

Create a consistent typography hierarchy.

Define:

- display
- page title
- section title
- widget title
- metric
- body
- secondary
- caption
- label

Rules:

- consistent font family
- consistent weights
- consistent line heights
- consistent sizes
- no arbitrary typography per page
- don't make everything bold
- metrics should have strong hierarchy

============================================================
10. SPACING
============================================================

Use a consistent spacing scale.

Prefer existing project/Tailwind tokens.

Avoid arbitrary values scattered throughout the application.

Spacing should communicate:

- grouping
- hierarchy
- separation
- density

TeslaSync should be information-dense without feeling cramped.

============================================================
11. APPLICATION SHELL
============================================================

Modernize the global shell before feature pages.

Includes:

- sidebar
- header
- navigation
- breadcrumbs
- page container
- global search
- notifications
- user menu
- responsive navigation

The shell must work consistently on every route.

============================================================
12. SIDEBAR
============================================================

Create one navigation system.

Support:

- active state
- nested navigation
- collapsed mode
- mobile mode
- keyboard navigation
- accessible labels
- badges where appropriate
- logical grouping

Avoid excessively deep navigation.

Use progressive disclosure.

Do not create different navigation behavior per feature.

============================================================
13. HEADER / PAGE HEADER
============================================================

Create reusable:

PageHeader

It should support:

- title
- description
- breadcrumb
- context
- date range
- filters
- actions
- status
- menus

Do not let individual pages implement unrelated headers.

============================================================
14. PAGE LAYOUT SYSTEM
============================================================

Create reusable layouts such as:

PageLayout
DetailPage
ListPage
DashboardPage
SettingsPage
AnalyticsPage

Typical structure:

Page
 ├── PageHeader
 ├── Toolbar
 └── PageContent

Pages should not invent layout structures unnecessarily.

============================================================
15. RESPONSIVE DESIGN
============================================================

Every page and component must work at:

320px
375px
390px
430px
768px
1024px
1280px
1440px
1920px
2560px

Do NOT simply shrink desktop.

Each component needs an intentional strategy:

- resize
- reflow
- stack
- collapse
- simplify
- change orientation
- hide secondary content
- change visualization

============================================================
16. MOBILE
============================================================

Mobile is a first-class experience.

At small widths:

- preserve primary information
- remove unnecessary metadata
- stack content
- simplify controls
- use touch-friendly controls
- avoid hover-only behavior
- avoid horizontal page scrolling
- redesign charts if required
- transform tables when necessary

If a desktop component doesn't work on mobile,
redesign the component.

Do not simply make it smaller.

============================================================
17. TABLE SYSTEM
============================================================

Create a reusable DataTable system.

Every table must define its mobile strategy:

- horizontal scrolling
- column prioritization
- responsive collapse
- card transformation
- pagination
- virtualization where appropriate

Never allow accidental page-level horizontal overflow.

============================================================
18. FORM SYSTEM
============================================================

Create consistent:

- Input
- Select
- Combobox
- Checkbox
- Radio
- Switch
- Textarea
- Date picker
- Validation
- Helper text
- Error state

All forms should share:

- labels
- spacing
- typography
- focus behavior
- error behavior
- disabled behavior

============================================================
19. BUTTON SYSTEM
============================================================

Standard variants:

Primary
Secondary
Outline
Ghost
Destructive
Icon
Link

Every button supports:

default
hover
active
focus
disabled
loading

Do not create custom button styling inside features.

============================================================
20. MODAL / DRAWER SYSTEM
============================================================

Create reusable:

Dialog
Modal
Drawer
BottomSheet

Standardize:

- header
- close
- footer
- actions
- scrolling
- focus trap
- keyboard behavior
- mobile behavior

============================================================
21. STATUS SYSTEM
============================================================

Create one semantic status system.

Possible states:

online
offline
connecting
charging
stale
unknown
success
warning
error
queued
processing
complete
failed

Each status has:

- icon
- text
- semantic color
- accessible meaning

Color must never be the only indication.

============================================================
22. LOADING SYSTEM
============================================================

Every async interface must have a designed loading state.

Prefer contextual skeletons.

Avoid unnecessary:

"Loading..."

text everywhere.

Prevent layout shift.

Use:

- skeleton
- progress
- spinner
- placeholder

appropriately.

============================================================
23. EMPTY STATES
============================================================

Every data-driven page must handle empty data.

Empty states should explain:

What is empty?
Why?
What happens next?

Where useful provide an action.

============================================================
24. ERROR SYSTEM
============================================================

Standardize errors.

Every error should answer:

What happened?
Can I retry?
What should I do?

Support:

- retry
- refresh
- recovery
- navigation

when appropriate.

============================================================
25. OFFLINE / STALE DATA
============================================================

TeslaSync must distinguish:

Loading
No data
Offline
Stale
Error
Unknown

Do not represent all of these with one generic error state.

============================================================
26. DATE / TIME SYSTEM
============================================================

Centralize formatting.

Do not allow every feature to invent its own date/time format.

Use context-aware formatting.

Example:

Dashboard:
Today
7 days
30 days
90 days
Custom

Historical analytics:
Year
Quarter
Month
Week
Day
Custom

Long-term:
Year
Custom

Date-range UI should adapt to the page context.

============================================================
27. CHART SYSTEM
============================================================

Create one chart design language.

Standardize:

- palette
- axes
- grid
- tooltip
- legend
- labels
- line thickness
- point size
- empty state
- loading
- error
- responsive behavior

Charts should use restrained colors.

Avoid rainbow charts.

Avoid neon lines.

Avoid unnecessary gradients.

Grid lines should be subtle.

Reference/target lines should be subdued.

Primary data should have the strongest visual weight.

============================================================
28. DATA VISUALIZATION
============================================================

Choose visualization based on the question.

Do not use charts simply because they look good.

Examples:

Trend → line
Comparison → bar
Composition → appropriate proportional visualization
Distribution → histogram/distribution
Relationship → scatter
Current value → metric/gauge only when useful

Avoid:

- 3D charts
- decorative charts
- excessive colors
- misleading scales
- unnecessary animation

============================================================
29. TESLASYNC DOMAIN COMPONENTS
============================================================

Create reusable domain components where appropriate.

Vehicle:

VehicleIdentity
VehicleStatus
VehicleSelector

Battery:

BatteryMetric
BatteryStatus
BatteryHealth

Charging:

ChargingStatus
ChargingSession
ChargingHistory

Driving:

TripSummary
TripList
DrivingMetrics

Location:

VehicleLocation
MapPanel

Connectivity:

ConnectionStatus
TelemetryStatus
SyncStatus

Commands:

CommandStatus
CommandQueue
CommandHistory

These should reuse global primitives.

============================================================
30. ACCESSIBILITY
============================================================

Every component must consider:

- semantic HTML
- keyboard navigation
- focus
- screen readers
- ARIA
- color contrast
- touch targets
- reduced motion
- accessible labels
- accessible tables
- accessible charts
- form errors

Never communicate important state through color alone.

============================================================
31. MOTION
============================================================

Use motion for:

- transitions
- feedback
- state changes
- navigation
- expansion/collapse

Avoid decorative animation.

Avoid:

- constant pulsing
- excessive bouncing
- unnecessary spinning
- distracting transitions

Respect prefers-reduced-motion.

============================================================
32. ICONOGRAPHY
============================================================

Use one consistent icon system.

Standardize:

- icon family
- stroke weight
- sizes
- alignment
- semantic usage

Do not randomly mix icon libraries.

============================================================
33. DATA / UI SEPARATION
============================================================

Prefer:

API
 ↓
Query/Data Hook
 ↓
Feature Container
 ↓
Presentational Components

Do not bury complex API logic inside visual components.

Reuse existing query/cache infrastructure.

Do not duplicate server state unnecessarily.

============================================================
34. TYPESCRIPT
============================================================

Rules:

- avoid any
- avoid unnecessary type assertions
- explicit component contracts
- reusable domain types
- predictable props
- strict typing
- no ignored errors

============================================================
35. PERFORMANCE
============================================================

Review:

- unnecessary renders
- duplicate queries
- excessive polling
- expensive effects
- large chart datasets
- oversized assets
- bundle size
- unnecessary dependencies
- expensive calculations

Do not optimize blindly.

Measure and simplify.

============================================================
36. ERROR ISOLATION
============================================================

One failed widget/page component must not unnecessarily crash
the entire application.

Use appropriate boundaries.

For example:

Dashboard
 ├── Widget A
 ├── Widget B
 ├── Widget C ← error
 ├── Widget D
 └── Widget E

Widget C should show its error state while the dashboard remains usable.

============================================================
37. EXTREME DATA TESTING
============================================================

Every component should be tested with:

0
1
10
99
999
999999
very large values
negative values where valid
null
undefined
missing data
long labels
long vehicle names
long addresses
large datasets
many rows
many vehicles
long timestamps

Never design only for ideal data.

============================================================
38. FEATURE MODERNIZATION ORDER
============================================================

Do NOT randomly redesign pages.

Use:

PHASE 0
Complete audit

↓

PHASE 1
Design contract + tokens

↓

PHASE 2
Primitive components

↓

PHASE 3
Application shell

↓

PHASE 4
Shared components

↓

PHASE 5
Dashboard

↓

PHASE 6
Vehicles

↓

PHASE 7
Charging

↓

PHASE 8
Trips

↓

PHASE 9
Telemetry

↓

PHASE 10
Commands

↓

PHASE 11
Settings / Account / secondary pages

↓

PHASE 12
Responsive sweep

↓

PHASE 13
Accessibility sweep

↓

PHASE 14
Performance sweep

↓

PHASE 15
Global visual consistency sweep

============================================================
39. AGENT FLEET
============================================================

ORCHESTRATOR

Responsible for:

- task queue
- dependencies
- architecture
- agent coordination
- quality gates
- final acceptance


DESIGN SYSTEM ARCHITECT

Responsible for:

- design tokens
- typography
- colors
- spacing
- visual language
- shared component standards

This agent owns the design contract.


FRONTEND ARCHITECT

Responsible for:

- component architecture
- feature boundaries
- data/presentation separation
- state management
- TypeScript architecture


APPLICATION SHELL AGENT

Responsible for:

- sidebar
- header
- navigation
- layout
- breadcrumbs
- responsive shell


SHARED COMPONENT AGENT

Responsible for:

- Button
- Card
- Input
- Table
- Dialog
- Drawer
- Badge
- Status
- Tooltip
- DatePicker
- FilterBar
- Loading
- Empty
- Error
- Chart primitives


FEATURE AGENTS

Dashboard
Vehicles
Charging
Trips
Telemetry
Commands
Settings
Account


RESPONSIVE QA AGENT

Tests:

320
375
390
430
768
1024
1280
1440
1920
2560


ACCESSIBILITY AGENT

Checks:

keyboard
focus
ARIA
contrast
screen readers
touch targets
reduced motion


PERFORMANCE AGENT

Checks:

rendering
network
queries
charts
bundle
assets


VISUAL QA AGENT

Reviews:

hierarchy
spacing
colors
typography
consistency
responsive behavior
states
polish

============================================================
40. AGENT RULE
============================================================

Feature agents MUST NOT introduce new global visual patterns
without consulting the design-system architecture.

If an agent discovers a repeated pattern:

STOP

→ report pattern
→ determine if shared component is appropriate
→ create/reuse shared component
→ migrate usage
→ continue feature work

============================================================
41. MASTER AGENTIC LOOP
============================================================


                 ┌──────────────────┐
                 │    DISCOVER      │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │      AUDIT       │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ DESIGN CONTRACT  │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ DESIGN TOKENS    │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │   PRIMITIVES     │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │  SHARED UI       │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ APPLICATION SHELL│
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ FEATURE MIGRATION│
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │   TYPECHECK      │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │      TEST        │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │      BUILD       │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ RESPONSIVE QA    │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ ACCESSIBILITY QA │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ PERFORMANCE QA   │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │   VISUAL QA      │
                 └────────┬─────────┘
                          ↓
                 ┌──────────────────┐
                 │ CONSISTENCY QA   │
                 └────────┬─────────┘
                          ↓
                     ┌────┴────┐
                     │         │
                    FAIL      PASS
                     │         │
                     ↓         ↓
                    FIX      ACCEPT
                     │
                     └────────────→ QA

============================================================
42. ITERATION RULE
============================================================
Never stop after the first implementation.
For every failure:
IDENTIFY
→ FIX
→ TYPECHECK
→ TEST
→ BUILD
→ REVIEW
→ REPEAT
Continue until the quality gate passes.
============================================================
43. VISUAL QA GATE
============================================================
Before accepting a page:
COLOR
- no unnecessary neon
- no fluorescent UI
- no glowing text
- no glowing borders
- no rainbow charts
- restrained accent colors
- semantic colors consistent
TYPOGRAPHY
- clear hierarchy
- readable primary text
- readable secondary text
- no excessive bold
- no arbitrary font sizes
LAYOUT
- alignment
- spacing
- hierarchy
- density
- no accidental whitespace
- no clipping
RESPONSIVE
- 320px
- 375px
- 430px
- 768px
- 1024px
- 1440px
- 1920px
- 2560px
STATES
- loading
- empty
- error
- offline
- stale
- success
- disabled
ACCESSIBILITY
- keyboard
- focus
- contrast
- screen reader
- touch targets
- reduced motion
============================================================
44. PAGE DEFINITION OF DONE
============================================================
A page is complete only when:
[ ] Uses global design system
[ ] Uses shared components
[ ] No unnecessary duplicated UI
[ ] Clear information hierarchy
[ ] Responsive
[ ] Mobile reviewed
[ ] Desktop reviewed
[ ] Loading state
[ ] Empty state
[ ] Error state
[ ] Offline/stale state where relevant
[ ] Accessibility reviewed
[ ] Theme reviewed
[ ] Extreme data reviewed
[ ] TypeScript passes
[ ] Lint passes
[ ] Tests pass
[ ] Build passes
[ ] Visual QA passes
============================================================
45. APPLICATION DEFINITION OF DONE
============================================================
The entire frontend is complete only when:
[ ] All routes audited
[ ] Design contract established
[ ] Design tokens established
[ ] Primitive components established
[ ] Shared components established
[ ] Application shell standardized
[ ] Navigation standardized
[ ] Page layouts standardized
[ ] Forms standardized
[ ] Tables standardized
[ ] Dialogs standardized
[ ] Drawers standardized
[ ] Charts standardized
[ ] Status system standardized
[ ] Date/time system standardized
[ ] Loading standardized
[ ] Empty states standardized
[ ] Error states standardized
[ ] Responsive sweep completed
[ ] Accessibility sweep completed
[ ] Performance sweep completed
[ ] Visual consistency sweep completed
[ ] No major duplicated UI patterns remain
[ ] TypeScript passes
[ ] Lint passes
[ ] Tests pass
[ ] Production build passes
============================================================
46. FINAL PRODUCT STANDARD
============================================================
The final TeslaSync frontend must feel like ONE product.
NOT:
Page A → modern
Page B → old
Page C → neon
Page D → different card system
Page E → different buttons
Page F → desktop only
Instead:

                TESLASYNC
                    │
             DESIGN SYSTEM
                    │
      ┌─────────────┼─────────────┐
      │             │             │
   NAVIGATION     CONTENT      INTERACTION
      │             │             │
      └─────────────┼─────────────┘
                    │
            SHARED COMPONENTS
                    │
      ┌─────────────┼─────────────┐
      │             │             │
  Dashboard      Vehicles      Charging
      │             │             │
      └─────────────┼─────────────┘
                    │
              CONSISTENT UX
                    │
           RESPONSIVE EVERYWHERE
                    │
            ACCESSIBLE EVERYWHERE
                    │
             SUBTLE COLOR SYSTEM
                    │
              POLISHED PRODUCT

FINAL PRINCIPLE:
Do not optimize for the number of files changed.
Optimize for:
COHERENCE
USABILITY
ACCESSIBILITY
RESPONSIVENESS
PERFORMANCE
MAINTAINABILITY
VISUAL POLISH
The frontend should feel intentionally designed, not merely redesigned.


### The key addition from your screenshot

I would make this **especially important** in the actual agent prompt:

> **Modernization must reduce visual noise, not increase it.**

So when an agent sees something like:

- neon green `#00ff00`
- electric cyan
- saturated purple
- pure white everywhere
- glowing charts
- colored progress bars

it should **actively replace those with a restrained semantic palette**, rather than preserving them because they technically "match the existing theme."

The target should be closer to:

**deep neutral surfaces + soft off-white typography + muted semantic colors + subtle borders + restrained accents + strong hierarchy.**

That rule applies to **the entire frontend**, not just the dashboard.