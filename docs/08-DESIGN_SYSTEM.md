# 08 — Design System

## The idea

*Khoros* is a chorus. Many voices, each with its own line, performing together
under one conductor. The user conducts; the agents perform.

That gives the interface its central structure: **the stave**. An agent is not a
card floating in a grid — it is a horizontal line with its performance written
along it. A leaderboard is a set of staves stacked into a score. This is the one
place the design spends its boldness, and everything else stays quiet around it.

It is also functional rather than decorative. A stave carries an agent's name,
trust score, six metrics, and a performance curve in a single horizontal band, at
higher density and with better cross-agent comparison than a card grid manages.
Comparing agents is the entire job of the arena; the layout should make comparison
the path of least resistance.

**What we are deliberately not doing:** no cream background with a terracotta
accent, no near-black canvas with one acid highlight, no grid of identical rounded
cards with the same soft shadow under each, no tracked-out all-caps eyebrow above
every heading, no arrow appended to button text, no monospace as decoration for
small labels. These are the defaults that show up on every generated interface
regardless of subject, and this subject deserves its own.

---

## Colour

Drawn from brass instruments and printed scores: aged metal, dark ink, cool paper.

```css
:root {
  --paper:    #E8EAE4;  /* cool sage-grey ground, not cream */
  --paper-lift: #F1F2EE; /* raised surface: panels, hover */
  --ink:      #182220;  /* deep pine — text, staves */
  --ink-soft: #6B7570;  /* secondary text, axis labels */
  --rule:     #C6CBC2;  /* hairlines, stave lines */

  --verdigris: #1F5F58; /* primary action, live state */
  --brass:     #A87C1F; /* verified, settled, payment-backed */
  --madder:    #8F2F2C; /* risk, liquidation, blocked */
}
```

Three accents, three jobs, no overlap:

| Colour | Means | Appears on |
|--------|-------|------------|
| Verdigris | Act / live | Primary buttons, active session, running agent |
| Brass | Verified / paid | Trust badges, payment-backed reviews, settled jobs |
| Madder | Risk / stopped | HF warnings, blocked actions, revoke |

Semantic discipline matters more than the specific hues. Brass never decorates. If
something is brass, a payment stands behind it.

**Dark mode** inverts to `--ink` ground with `--paper` text, accents lifted ~12%
for contrast. Not a separate palette, a transform.

Contrast floor: 4.5:1 for body text, 3:1 for large text and UI boundaries.
Never rely on hue alone — every state carries a shape or label as well.

---

## Type

Two families, clearly distinct in construction so they never read as one.

**Spectral** — display. A transitional serif with real personality and a wide
weight range. Headings, agent names, the front-door question, numbers that are the
point of a screen.

**Archivo** — interface and data. A grotesque with genuine tabular figures. Body
text, labels, table data, every number in a column.

Tabular figures are the reason for this pairing, not a stylistic flourish. Metric
columns only align if the digits are monospaced in width, and a column of
misaligned returns is harder to scan. That is a functional requirement; using a
full monospace face for small labels as a "technical" affectation is not, and we
don't.

```css
--font-display: "Spectral", Georgia, serif;
--font-ui:      "Archivo", system-ui, sans-serif;
```

Scale, classical proportions, 16px base:

| Token | Size / line-height | Family | Use |
|-------|--------------------|--------|-----|
| `display` | 3.25rem / 1.08 | Spectral 400 | Front-door question |
| `title` | 2rem / 1.2 | Spectral 500 | Page titles |
| `section` | 1.375rem / 1.3 | Spectral 500 | Section headings |
| `agent` | 1.125rem / 1.3 | Spectral 500 | Agent name on a stave |
| `body` | 1rem / 1.6 | Archivo 400 | Prose |
| `data` | 0.9375rem / 1.4 | Archivo 500 tnum | Metric values |
| `label` | 0.8125rem / 1.4 | Archivo 400 | Column headers, captions |

Body prose caps at 68 characters. Sentence case everywhere — no all-caps labels.
Never accent a single word in a heading with a different colour or weight; if a
heading needs emphasis, rewrite the heading.

---

## The stave

The signature component. One agent, one horizontal band.

```
├──────────────────────────────────────────────────────────────────────────┤
│  Meridian LP Keeper                                    0.91 ▏▏▏▏▏▏▏▏▏░░  │
│  Rebalancing · PancakeSwap V3 · 214 payment-backed reviews               │
│  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╱╲╌╌╌╌╌╌╌╌╌╱╌╌╌╌╌╌╌╌╲╌╌╌╌╌╌╱╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  │
│  18.4% fee APR    −4.2% dd    31 rebal.   94% in range   3.2s   $412k    │
├──────────────────────────────────────────────────────────────────────────┤
```

Four rows inside one band:

1. **Name** (Spectral) right-aligned against the **trust score** with its
   confidence interval drawn as a filled bar. A wide interval reads as a short
   fill with a long ghost — uncertainty is visible, not hidden behind a number.
2. **Provenance** (label): category, protocols, review count. Payment-backed
   review count is in brass.
3. **The stave line** — a hairline rule spanning the full width with the
   performance sparkline drawn *on* it. Above the line is gain, below is loss. The
   rule is the zero axis. This is where the metaphor and the information coincide.
4. **Metrics** — the six slots, tabular, evenly distributed, same order for every
   category so the eye learns one position.

Separated by `--rule` hairlines, no card borders, no shadows, no border radius on
the band itself. Density comes from the rules, not from boxes.

Hover raises the band to `--paper-lift` and thickens the stave line. That is the
whole hover treatment — no lift, no shadow, no scale.

---

## Layout

Left-aligned throughout. Centred text appears only in genuinely empty states.

**Front door.** The question sits high and large, alone, with the four intent chips
beneath. No hero image, no stat row, no gradient. Below the fold, the four category
staves begin immediately — the product is visible without scrolling past
decoration. A judge sees the arena within one scroll.

**Arena index.** Four sections, one per category, identical structure and identical
height allocation. If one category has fewer agents, it shows an empty-state
invitation at the same height rather than collapsing — visual equality is part of
how we demonstrate category equality.

**Agent profile.** Two columns on desktop: the narrative and track record at 62%
on the left, identity and permissions at 38% on the right. The right column is
sticky. Single column below 900px with the identity block first, because on mobile
"is this thing real" comes before "how did it perform".

**Hire flow.** Four panels stacked on one page, all visible, no wizard. The
permissions preview panel is the tallest and uses `--paper-lift` — it is the panel
that earns trust, so it gets the visual weight.

**Dashboard.** A stave per active engagement, with its live telemetry feed beneath
it. Blocked actions render in madder at the same size as executed ones. Revoke is
a persistent control on each stave, never in a menu.

Grid: 12 columns, 72px max gutter, 1280px content maximum. Vertical rhythm on an
8px base.

---

## Motion

One orchestrated moment: **the prune toggle**. Flipping it re-sorts the arena, and
the staves animate to their new positions over 420ms with a gentle ease. Agents
that fall are briefly marked. This is the demonstration of the product's central
claim, so it gets the one piece of choreography in the interface.

Everything else responds to action and nothing else. Panels expand, confirmations
appear, the telemetry feed pushes new rows in. No entrance animations on scroll,
no fade-and-slide on every section, no hover transitions on every element.

`prefers-reduced-motion` removes the reorder animation and re-sorts instantly. The
information is identical either way.

---

## Data display

**Numbers carry their uncertainty.** A metric from a small sample renders with its
sample size adjacent in `--ink-soft`. Never present `n=3` with the same authority
as `n=300`.

**Sparklines are on the stave**, not in a separate cell. The rule is the axis.

**Trust scores show intervals.** The filled portion is the point estimate; the
ghost extension is the 95% interval. Two agents at 0.88 with different confidence
look different, because they are different.

**Negative values in madder, positive in ink.** Not green. Green-for-good is the
convention every trading interface uses and it makes the palette generic; here,
madder marks loss and drawdown, and gain is simply the default ink. The stave
position (above or below the line) already carries direction.

---

## Components

Primitives live in `packages/ui`. The list is deliberately short.

| Component | Notes |
|-----------|-------|
| `Stave` | The agent row. Variants: `arena`, `dashboard`, `compact` |
| `TrustBar` | Score with interval ghost |
| `MetricRow` | Six tabular slots, fixed order |
| `PruneToggle` | The two-state control plus its explanatory line |
| `PermissionList` | Renders `describeScope()` output. Never takes free text |
| `TelemetryFeed` | SSE list, executed and blocked at equal weight |
| `VerifyLink` | External link to BscScan / 8004scan / Altana Explorer |
| `Chip` | Intent seeds on the front door |
| `Panel` | `--paper-lift` surface, hairline border, no shadow |

`VerifyLink` exists as a primitive because every external claim must be
verifiable and it should be impossible to render a claim without one.

---

## Accessibility floor

Not a phase — a condition of every component being considered done.

- Visible focus ring on every interactive element: 2px `--verdigris`, 2px offset.
- Full keyboard operation, including the prune toggle and revoke.
- The arena is a real `<table>` semantically, styled as staves. Screen readers get
  a comparison table; sighted users get a score.
- Live telemetry uses `aria-live="polite"`.
- Every colour-coded state has a text label or icon alongside.
- Touch targets 44px minimum.
- Test at 320px width and at 200% zoom.

---

## Writing

Plain verbs, sentence case, no filler. The interface names things the way a user
would.

Buttons name their outcome and keep the same word through the whole flow. "Hire
this agent" → toast "Agent hired". "Stop this agent" → "Agent stopped". Never
"Submit", never "Confirm" as a standalone.

Errors say what happened and what to do:

> The rebalance was blocked because slippage would have reached 0.8%, above your
> 0.5% cap. Raise the cap, or wait for the pool to settle.

Not "Transaction failed" and not an apology.

Empty states invite:

> No grid trading agents have a payment-backed track record yet. Switch to
> unfiltered to see all 47 registered agents in this category.

Never "No data available".
