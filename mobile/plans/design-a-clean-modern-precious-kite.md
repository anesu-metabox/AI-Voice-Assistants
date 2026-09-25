# Plan: vocalist.ai Mobile App UI

## Context

Build a pixel-faithful, mobile-optimized web implementation of the vocalist.ai AI voice assistant app inside the existing React + Vite + Tailwind CSS v4 project. Since this is a web project (not React Native), the deliverable is a mobile-framed web UI rendered inside a ~390×844 phone shell — all five key screens navigable via a floating bottom tab bar and screen-state React hooks.

## Aesthetic Decisions

- **Stance:** Clean minimalist SaaS — white card surfaces on #F8FAFC, generous whitespace, structured hierarchy
- **Fonts:** Bricolage Grotesque (headings) + Inter (body/labels) — both from Google Fonts
- **Palette:** Primary #3B5BDB / #4F46E5 indigo-blue, deep slate text #0D1526 / #1E293B, emerald #22C55E, amber #F59E0B, crimson #EF4444, border #E8ECF4
- **Voxi mascot:** CSS/SVG inline art — stylized robotic fox with cyan/violet headphone rings and glowing LED eyes. Simple but characterful, not photo-realistic.

## Implementation Architecture

All code lives in `src/`. Files to create or modify:

### 1. `src/index.css`
- Add Google Fonts `@import` at top: Bricolage Grotesque (700, 800) + Inter (400, 500, 600, 700)
- Add Tailwind CSS v4 `@theme` block with vocalist.ai design tokens (`--color-primary`, `--color-accent`, `--color-bg`, etc.)
- CSS custom properties for shadows, radii, and font families

### 2. `src/App.tsx`
- Top-level app shell holding `currentScreen` state and `activeTab` state
- Renders a 390px-wide, 844px-tall centered phone frame
- Hosts the bottom tab bar and the FAB (mic button)
- Routes to one of 6 screen components based on state

### 3. Screen components (create in `src/screens/`)

| File | Screen |
|---|---|
| `SplashScreen.tsx` | Loading/splash with Voxi mascot + progress pill |
| `OnboardingScreen.tsx` | 3-step flow (Step 2: Company Profile, Step 3: AI Assistant config) |
| `DashboardScreen.tsx` | Home tab with metric cards + bar chart + active assistant card |
| `CallsScreen.tsx` | Call history feed with filter chips + tap-to-inspect drawer |
| `IntegrationsScreen.tsx` | Google Calendar + 3CX PBX cards + security callout |
| `LiveCallModal.tsx` | Full-screen live voice session overlay |

### 4. `src/components/`

| File | Purpose |
|---|---|
| `VoxiMascot.tsx` | SVG robotic fox with animated eyes/headphones; prop: `size`, `mood` |
| `BottomTabBar.tsx` | Curved floating tab bar with 4 tabs + center FAB |
| `AudioOrb.tsx` | Animated radial pulse orb for live call screen |
| `BarChart.tsx` | 7-day call volume bar chart (pure CSS/SVG — no recharts needed) |
| `CallCard.tsx` | Individual call record card |
| `MetricCard.tsx` | KPI tile (value + trend + label) |

## Key Implementation Details

### Bottom Tab Bar + FAB
- `position: absolute; bottom: 0` within the phone frame
- SVG curved cutout in the center using `clip-path` or `border-radius` trick
- FAB: 56px circular button with `background: linear-gradient(#3B5BDB, #4F46E5)`, glow `box-shadow: 0 0 24px rgba(79,70,229,0.5)`, mic SVG icon
- Tabs: Home, Calls, Integrations, Settings — icon + label, active tab uses `#3B5BDB` tint

### Voxi Mascot (SVG — Pixar/Astro Bot aesthetic)
Detailed inline SVG portrait capturing the full 3D render description:
- **Body:** Rounded matte-white ceramic torso/head with warm metallic orange accents on ear tips, cheek patches, and tail stripe
- **Eyes:** Large glowing cyan LED circles (`#06B6D4`) with inner white highlight dots and a subtle cyan radial glow `filter: drop-shadow(0 0 8px #06B6D4)`
- **Headphones:** Over-ear arc in cyan (`#06B6D4`) with neon-violet (`#8B5CF6`) ear cup rings; integrated boom microphone arm extending from left cup
- **Expression:** Expressive friendly smile — curved mouth line with small white teeth, soft blush marks on cheeks
- **Soundwave rings:** 3 concentric ellipse rings beneath paws with animated opacity pulse (`@keyframes ringPulse`) in cyan-to-violet gradient
- **Lighting illusion:** Subtle radial gradient fills on all rounded shapes to simulate soft studio ambient occlusion (lighter center, slightly darker rim)
- SVG viewport ~200×240px; exported as `VoxiMascot.tsx` React component with `size` and `animated` props

### Live Call Modal
- Opens from FAB tap, overlays full phone frame
- Animated orb: concentric rings with `@keyframes pulse` scaling and opacity cycling
- Voxi mascot SVG positioned above orb center
- Bottom sheet: scrollable transcript with alternating User (right, blue bubble) and AI (left, white bubble) entries
- Live MM:SS counter via `setInterval`

### Onboarding (Steps 2 & 3)
- Step pill indicators: 3 pill-shaped step badges, active = filled blue
- Step 2: styled text inputs with floating labels for Company Name, Website, Phone, Email, Timezone select
- Step 3: Voice Model carousel (horizontal scroll of 5 pill cards — Aoede, Puck, Charon, Kore, Fenrir), Tone selection pills, capability checkboxes
- Sticky bottom row: "Save Draft" (outline) + "Publish Assistant" (filled primary)

### Dashboard Charts
- 7-day bar chart: pure inline SVG with rounded rect bars, y-axis labels, day labels
- Realistic data: Mon–Sun call volumes [12, 8, 15, 6, 18, 9, 14]

## Font Wiring (Vite / CSS)
```css
/* src/index.css — FIRST lines */
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import 'tailwindcss';
```

## Verification
1. Dev server is already running — check preview panel shows the splash screen with Voxi
2. Tap "Get Started" → onboarding step 2 → step 3 → dashboard
3. Bottom tab bar navigates Home / Calls / Integrations
4. Tap center FAB → Live Call modal opens, timer ticks, orb pulses
5. Calls tab: filter chips highlight, tap a call card → inspect drawer slides up
6. Integrations tab: cards display status, buttons are interactive (toggle state)
