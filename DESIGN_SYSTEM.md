# MedShip Prometheus Design System

Design guidance derived from the **YashAdmin (Vite)** template in `/design-reference/`. All UI must match this template's visual style. Rebuild everything using **Tailwind CSS + shadcn/ui** — never import react-bootstrap.

---

## Typography

| Token | Value |
|-------|-------|
| Font family | `Poppins`, sans-serif (via `next/font/google`, variable `--font-poppins`) |
| Mono font | `Geist Mono` (variable `--font-geist-mono`) |
| Base font size | `0.875rem` (14px) |
| Heading font weight | `500` (medium) |
| Body line height | `1.5` |

### Heading Scale

| Level | Size |
|-------|------|
| H1 | `2.25rem` (36px) |
| H2 | `1.875rem` (30px) |
| H3 | `1.5rem` (24px) |
| H4 | `1.125rem` (18px) |
| H5 | `1rem` (16px) |
| H6 | `0.938rem` (15px) |

### Usage

```tsx
// In layout.tsx — Poppins is loaded with weights 300-700
import { Poppins } from 'next/font/google'
const poppins = Poppins({ variable: '--font-poppins', subsets: ['latin'], weight: ['300','400','500','600','700'] })

// In globals.css — mapped to Tailwind's font-sans
--font-sans: var(--font-poppins), 'Poppins', sans-serif;
```

---

## Color Palette

### Brand Colors (Tailwind: `text-medship-*`, `bg-medship-*`)

| Name | Hex | Tailwind Class | Usage |
|------|-----|----------------|-------|
| Primary | `#452B90` | `medship-primary` | Buttons, links, active states, primary CTAs |
| Primary Light | `#6B4BC4` | `medship-primary-light` | Hover states |
| Primary Dark | `#2A1B5A` | `medship-primary-dark` | Pressed states |
| Secondary | `#F8B940` | `medship-secondary` | Sidebar active text, accents, highlights |
| Secondary Dark | `#F6A70F` | `medship-secondary-dark` | Secondary hover |
| Success | `#3A9B94` | `medship-success` | Positive indicators, delivered, connected |
| Info | `#58BAD7` | `medship-info` | Informational badges, shipped status |
| Warning | `#FF9F00` | `medship-warning` | Pending states, low stock, caution |
| Danger | `#FF5E5E` | `medship-danger` | Errors, failures, out of stock, destructive actions |

### Semantic Colors (CSS Variables)

| Token | Light | Dark |
|-------|-------|------|
| `--background` | `#F3F0EC` | `#151C2C` |
| `--foreground` | `#374557` | `#DDDDDD` |
| `--card` | `#FFFFFF` | `#182237` |
| `--card-foreground` | `#374557` | `#DDDDDD` |
| `--primary` | `#452B90` | `#7C5DC7` |
| `--secondary` | `#F8B940` | `#F8B940` |
| `--muted` | `#F3F0EC` | `#1E2A4A` |
| `--muted-foreground` | `#888888` | `#828690` |
| `--destructive` | `#FF5E5E` | `#FF5E5E` |
| `--border` | `#E6E6E6` | `rgba(255,255,255,0.10)` |

### Chart Colors

| Slot | Light | Dark | Typical Use |
|------|-------|------|-------------|
| `--chart-1` | `#452B90` | `#7C5DC7` | Revenue, primary metric |
| `--chart-2` | `#3A9B94` | `#4DC7BF` | Success counts |
| `--chart-3` | `#F8B940` | `#F8B940` | Secondary metric |
| `--chart-4` | `#58BAD7` | `#58BAD7` | Info metric |
| `--chart-5` | `#FF9F00` | `#FF9F00` | Warning/tertiary |

### Sidebar Colors

| Token | Light | Dark |
|-------|-------|------|
| `--sidebar` | `#222B40` (dark navy) | `#0F1629` |
| `--sidebar-foreground` | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.65)` |
| `--sidebar-primary` | `#F8B940` (gold) | `#F8B940` |
| `--sidebar-accent` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.06)` |
| `--sidebar-border` | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.08)` |

---

## Shadows

| Name | Value | Usage |
|------|-------|-------|
| Card shadow | `0 0 2.5rem 0 rgba(82, 63, 105, 0.1)` | All cards in light mode |
| Card hover shadow | `0 0 1.875rem rgba(69, 43, 144, 0.15)` | Card hover states |
| Sidebar shadow | `0 0.9375rem 1.875rem 0 rgba(0, 0, 0, 0.02)` | Sidebar panel |
| Table hover shadow | `0 0 1.875rem rgba(69, 43, 144, 0.12)` | Table row hover (optional) |
| Dark mode | `none` | Shadows are disabled in dark mode |

---

## Border Radius

| Token | Value | Computed |
|-------|-------|----------|
| `--radius` (base) | `0.625rem` | 10px |
| `--radius-sm` | `0.375rem` | 6px |
| `--radius-md` | `0.5rem` | 8px |
| `--radius-lg` | `0.625rem` | 10px |
| `--radius-xl` | `0.875rem` | 14px |

---

## Layout Dimensions

### Sidebar

| Property | Value |
|----------|-------|
| Width (expanded) | `15rem` (240px) |
| Width (collapsed) | `3.75rem` (60px) |
| Transition | `all 300ms` |
| Logo area height | `4.375rem` (70px) |

### Header

| Property | Value |
|----------|-------|
| Height | `4.375rem` (70px) |
| Horizontal padding | `2.1rem` |
| Background | `bg-background` (matches body) |

### Content Area

| Property | Value |
|----------|-------|
| Page padding | `p-6` (1.5rem) |
| Background | `bg-background` |

---

## Component Specifications

### Card (`src/components/ui/card.tsx`)

```
Border:         1px solid #E6E6E6 (light) / rgba(255,255,255,0.1) (dark)
Border radius:  0.625rem (10px)
Shadow:         0 0 2.5rem 0 rgba(82, 63, 105, 0.1) (light only)
Background:     bg-card (#FFFFFF light / #182237 dark)

Header padding: px-5 py-5 (20px)
Header border:  border-bottom 1px solid #E6E6E6
Title font:     font-heading, text-base, font-medium, capitalize

Content padding: px-5 py-5 (20px)

Footer padding: px-5 py-4
Footer border:  border-top
Footer bg:      bg-muted/50
```

### KPI Card (`src/components/dashboard/KpiCard.tsx`)

```
Layout:         Horizontal — icon circle | value + title | trend badge
Icon container: 3.75rem (60px) round circle, colored bg at 10% opacity
Value font:     text-[2rem], font-semibold, leading-tight
Title font:     text-[0.875rem], font-medium, uppercase, text-muted-foreground
Trend badge:    rounded-full, px-2 py-1, text-xs, colored bg/text
```

Icon color mapping:
- Primary metric → `text-medship-primary` / `bg-medship-primary/10`
- Success metric → `text-medship-success` / `bg-medship-success/10`
- Info metric → `text-medship-info` / `bg-medship-info/10`
- Warning metric → `text-medship-warning` / `bg-medship-warning/10`

### Status Badge (`src/components/dashboard/StatusBadge.tsx`)

```
Container:  inline-flex, rounded-full, px-2 py-0.5, text-xs, font-medium
Variants:   'default' (text only) | 'dot' (colored dot + text)
Dot size:   h-1.5 w-1.5 rounded-full
```

| Color | Statuses |
|-------|----------|
| Green (success) | success, delivered, synced, healthy, connected, closed won |
| Blue (info) | shipped |
| Purple (primary) | required, yes |
| Orange (warning) | pending, warning, low stock, optional, retrying, not_configured, disconnected |
| Red (danger) | failed, error, cancelled, out of stock |
| Gray (default) | any unrecognized status |

### Data Table (`src/components/dashboard/DataTable.tsx`)

```
Header cell:    py-[0.9375rem] px-[0.625rem], text-[0.875rem], font-medium, capitalize
Body cell:      py-[0.9375rem] px-[0.625rem], align-middle, whitespace-nowrap
Row border:     border-b border-[#E6E6E6]
Striped rows:   odd rows bg-[#F3F0EC] (light) / bg-[rgba(255,255,255,0.02)] (dark)
Hover:          bg-[#F3F0EC] (light) / bg-[rgba(255,255,255,0.04)] (dark)
Pagination:     "Showing X to Y of Z entries" text, numbered page buttons
```

### Sidebar Navigation

```
Section header: text-[0.75rem], font-normal, uppercase, tracking-[0.05rem], text-medship-secondary
Nav item font:  text-[0.813rem], font-normal
Nav item pad:   px-5 py-[0.625rem] (expanded) / p-[0.813rem] (collapsed)
Icon size:      h-[1.375rem] w-[1.375rem]
Icon margin:    mr-[0.65rem]
Active color:   text-medship-secondary (#F8B940 gold)
Hover color:    text-medship-secondary
Default color:  text-sidebar-foreground (white at 70% opacity)
```

### Charts (recharts)

```
Grid stroke:    #E6E6E6
Axis tick font: fontSize 12, fill #888888, fontFamily 'Poppins'
Axis line:      stroke #E6E6E6
Tooltip:        rounded-[0.625rem], border border-[#E6E6E6], bg-white,
                shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]
Tooltip text:   text-[0.813rem], headings text-[#374557], values text-[#888]
Legend text:     fontSize 0.75rem, color #888888, fontFamily 'Poppins'
```

Chart-specific colors:
- Revenue area fill: linear gradient `#452B90` (15% → 0% opacity)
- Revenue stroke: `#452B90`, strokeWidth 2.5
- Pie/donut: `['#452B90', '#3A9B94', '#F8B940', '#58BAD7', '#FF9F00', '#FF5E5E']`
- Success bars: `#3A9B94`
- Failed bars: `#FF5E5E`

---

## Responsive Breakpoints

| Name | Width | Sidebar Behavior |
|------|-------|------------------|
| Mobile | `< 768px` | Hidden, hamburger toggle, overlay drawer |
| Tablet | `768px–1279px` | Collapsible (icons only or expanded) |
| Desktop | `1280px+` | Expanded by default |

---

## File Structure

```
src/components/
├── ui/                          # shadcn/ui primitives (card, button, table, etc.)
├── layout/
│   ├── Sidebar.tsx              # Collapsible sidebar with 3 nav sections
│   ├── SidebarContext.tsx        # Sidebar state (collapse, mobile toggle)
│   ├── Header.tsx               # 70px header with search, theme toggle, avatar
│   └── PageHeader.tsx           # Page title + optional description + actions
├── dashboard/
│   ├── KpiCard.tsx              # Metric card with icon, value, trend
│   ├── StatusBadge.tsx          # Colored status pills
│   ├── SyncStatusCard.tsx       # Integration status (compact + full modes)
│   ├── DataTable.tsx            # Sortable, paginated, expandable table
│   ├── SparklineChart.tsx       # Mini stacked bar (recharts)
│   ├── RefreshIndicator.tsx     # Auto-refresh toggle + countdown
│   └── EmptyState.tsx           # Zero-data placeholder
└── charts/
    ├── RevenueChart.tsx         # 12-month area chart
    ├── CategoryPieChart.tsx     # Donut chart
    └── SyncSuccessChart.tsx     # Stacked bar chart
```

---

## Do's and Don'ts

### Do

- Use `Poppins` for all text — it's loaded globally via `next/font/google`
- Use the `medship-*` Tailwind classes for brand colors
- Apply `shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)]` to cards in light mode
- Use `border border-[#E6E6E6]` on cards and table rows
- Use `rounded-[0.625rem]` (10px) for card corners
- Use semantic color variables (`bg-background`, `text-foreground`, `bg-card`) for theme-awareness
- Stripe table rows with `bg-[#F3F0EC]` on alternating rows
- Use uppercase section headers in the sidebar with `text-medship-secondary`
- Keep the warm cream body background (`#F3F0EC`)

### Don't

- Import or use `react-bootstrap` components
- Use Geist, Inter, or serif fonts — Poppins is the only body font
- Use generic gray colors (`text-gray-500`) — use `text-muted-foreground` or `text-medship-text`
- Use `ring-1 ring-foreground/10` on cards — use `border` + `shadow` instead
- Make cards flat/borderless — every card needs the YashAdmin shadow + border
- Use pure white (`#FFFFFF`) as the page background — the body bg is `#F3F0EC`
- Hardcode light-mode colors without dark-mode equivalents
