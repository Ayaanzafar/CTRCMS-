# CTRCMS Design System — Master

> Generated from ui-ux-pro-max for Sunrack Solar Structures.  
> Use this file across all phases; page overrides go in `design-system/pages/`.

## Pattern
**Enterprise Gateway** — trust signals, role-based navigation, audit-ready data.

## Style
**Trust & Authority** — certificates, metrics, professional navy palette. No playful gradients or AI purple/pink.

## Colors
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#0F172A` | Sidebar, headings, primary buttons |
| Secondary | `#334155` | Secondary text, borders |
| CTA / Accent | `#0369A1` | Links, active nav, primary actions |
| Background | `#F8FAFC` | Page background |
| Text | `#020617` | Body text |

## Typography
- **Headings:** Fira Code
- **Body:** Fira Sans
- [Google Fonts](https://fonts.google.com/share?selection.family=Fira+Code:wght@400;500;600;700|Fira+Sans:wght@300;400;500;600;700)

## UI Stack (all phases)
1. **shadcn/ui** — forms, tables, dialogs, cards
2. **21st.dev / Magic MCP** — hero, polished components per screen
3. **Lucide React** — icons only (no emoji icons)

## Component conventions
- Transitions: 150–300ms on hover/focus
- `cursor-pointer` on all clickable elements
- WCAG AA contrast minimum (4.5:1)
- Respect `prefers-reduced-motion`
- Breakpoints: 375px, 768px, 1024px, 1440px

## Anti-patterns (avoid)
- Playful / consumer SaaS aesthetics
- Hidden credentials in UI
- AI purple/pink gradients
- Scattered Excel-style unstyled tables

## Phase module styling
Each module placeholder → full implementation uses:
- `PageHeader` + `Card` layout
- shadcn `Table` for lists
- shadcn `Dialog`/`Sheet` for create/edit
- File upload via `DocumentUploadZone`
