# UI Design Context — Medical Shipment

This document defines the visual identity and design tokens for all MedShip Prometheus UI components. Every new component or page must follow these guidelines.

---

## Brand Identity

**Company:** Medical Shipment LLC
**App Name:** MedShip Prometheus
**Brand Font:** Outfit (Google Fonts)
**Logo:** Cross/plus shape composed of four colored squares — Light Blue (left), Dark Blue (top + bottom), Bright Green (right), White (center)

---

## Color Palette

### Primary Colors

| Name         | Hex       | RGB            | PMS      | Usage                                              |
|--------------|-----------|----------------|----------|-----------------------------------------------------|
| Light Blue   | `#1E98D5` | 30, 152, 213   | 2925 C   | Primary actions, links, active states, sidebar accent |
| Dark Blue    | `#1C3C6E` | 28, 60, 110    | 654 C    | Sidebar background, headings, dark emphasis          |
| Bright Green | `#0FA62C` | 15, 166, 44    | 3529 C   | Success states, positive metrics, confirmations      |

### Secondary Colors

| Name       | Hex       | RGB            | PMS      | Usage                                          |
|------------|-----------|----------------|----------|-------------------------------------------------|
| White      | `#FFFFFF` | 255, 255, 255  | —        | Backgrounds, cards, primary foreground on dark  |
| Pale Blue  | `#B5C8CD` | 181, 200, 205  | 4155 C   | Muted backgrounds, disabled states, borders     |
| Slate Gray | `#576671` | 87, 102, 113   | 431 C    | Body text, secondary text, icons                |
| Magenta    | `#A0007E` | 160, 0, 126    | 2415 C   | Accent highlights, alerts, special callouts     |

### Derived / Semantic Colors

| Token        | Value       | Derivation                                |
|--------------|-------------|-------------------------------------------|
| Primary      | `#1E98D5`   | Light Blue                                |
| Primary Dark | `#1C3C6E`   | Dark Blue                                 |
| Secondary    | `#0FA62C`   | Bright Green                              |
| Success      | `#0FA62C`   | Bright Green                              |
| Info         | `#1E98D5`   | Light Blue                                |
| Warning      | `#E89C0C`   | Warm amber (complement to palette)        |
| Danger       | `#D93025`   | Red (standard danger, contrasts palette)  |
| Accent       | `#A0007E`   | Magenta                                   |
| Body BG      | `#F4F7F9`   | Very light cool gray (derived from Pale Blue) |
| Card BG      | `#FFFFFF`   | White                                     |
| Heading      | `#1C3C6E`   | Dark Blue                                 |
| Body Text    | `#576671`   | Slate Gray                                |
| Border       | `#D6DEE3`   | Lightened Pale Blue                       |
| Muted Text   | `#8A9BA5`   | Lightened Slate Gray                      |

### Dark Mode

| Token        | Value                        |
|--------------|------------------------------|
| Body BG      | `#0F1A2E`                    |
| Card BG      | `#162035`                    |
| Foreground   | `#E0E6EB`                    |
| Primary      | `#3AACE3` (lightened LB)     |
| Border       | `rgba(255, 255, 255, 0.10)`  |
| Muted Text   | `#7A8D99`                    |
| Sidebar BG   | `#0B1221`                    |

---

## Typography

| Element       | Font    | Weight | Size        | Line Height |
|---------------|---------|--------|-------------|-------------|
| Body          | Outfit  | 400    | 0.875rem    | 1.5         |
| H1            | Outfit  | 600    | 1.75rem     | 1.3         |
| H2            | Outfit  | 600    | 1.375rem    | 1.3         |
| H3            | Outfit  | 500    | 1.125rem    | 1.4         |
| H4            | Outfit  | 500    | 1rem        | 1.4         |
| Small/Caption | Outfit  | 400    | 0.75rem     | 1.4         |
| Button        | Outfit  | 500    | 0.875rem    | 1           |
| Mono/Code     | Geist Mono | 400 | 0.8125rem   | 1.5         |

---

## Spacing & Layout

| Token             | Value       |
|-------------------|-------------|
| Sidebar width     | 16.875rem (270px) expanded, 5rem (80px) collapsed |
| Header height     | 4.375rem (70px) |
| Card border-radius| 0.625rem (10px) |
| Card shadow       | `0 0 2.5rem 0 rgba(28, 60, 110, 0.08)` |
| Card shadow hover | `0 0 1.875rem rgba(30, 152, 213, 0.12)` |
| Card padding      | 1.5rem |
| Page padding      | 1.5rem |
| Gap (default)     | 1.5rem |

---

## Chart Colors (Recharts)

Use this ordered palette for chart series:

1. `#1E98D5` — Light Blue (primary)
2. `#0FA62C` — Bright Green
3. `#1C3C6E` — Dark Blue
4. `#A0007E` — Magenta
5. `#E89C0C` — Warning amber
6. `#B5C8CD` — Pale Blue

---

## Component Guidelines

### Buttons
- **Primary:** `bg-medship-primary text-white` (Light Blue `#1E98D5`)
- **Secondary/Outline:** `border-medship-primary text-medship-primary`
- **Success:** `bg-medship-success text-white` (Bright Green `#0FA62C`)
- **Danger:** `bg-medship-danger text-white`
- Border radius: `rounded-lg` (0.625rem)

### Cards
- White background, rounded-lg, card shadow
- Header uses Dark Blue (`#1C3C6E`) heading text
- Body text in Slate Gray (`#576671`)

### Sidebar
- Background: Dark Blue `#1C3C6E`
- Active item: Light Blue `#1E98D5` left border + light blue text
- Hover: `rgba(255, 255, 255, 0.06)` background
- Logo appears at top, white version on dark background

### Tables
- Header: Pale Blue background (`#B5C8CD` at ~15% opacity)
- Row stripe: alternating with very light cool gray
- Border: `#D6DEE3`

### Status Indicators
- **Success/Active:** Bright Green `#0FA62C`
- **Info/Syncing:** Light Blue `#1E98D5`
- **Warning:** `#E89C0C`
- **Error/Failed:** `#D93025`
- **Inactive/Disabled:** Pale Blue `#B5C8CD`

---

## Logo Assets

- **Icon (color):** `public/ms-icon-color.png` — used in sidebar, favicon
- The logo is a cross/plus made of 4 squares: Light Blue (left), Dark Blue (top + bottom), Bright Green (right), White center space

---

## Tailwind Token Reference

All brand colors are available as Tailwind utilities via the `medship-` prefix:

```
bg-medship-primary        → #1E98D5
bg-medship-primary-dark   → #1C3C6E
bg-medship-secondary      → #0FA62C
bg-medship-success        → #0FA62C
bg-medship-info           → #1E98D5
bg-medship-warning        → #E89C0C
bg-medship-danger         → #D93025
bg-medship-accent         → #A0007E
bg-medship-pale-blue      → #B5C8CD
bg-medship-slate          → #576671
bg-medship-body-bg        → #F4F7F9
bg-medship-heading        → #1C3C6E
bg-medship-text           → #576671
bg-medship-border         → #D6DEE3
```

These work with all Tailwind utilities: `text-`, `border-`, `ring-`, `fill-`, `stroke-`, etc.
