/**
 * The front door. From docs/01-PRODUCT_SPEC.md and docs/08-DESIGN_SYSTEM.md.
 *
 * "The question sits high and large, alone, with the four intent chips beneath.
 * No hero image, no stat row, no gradient. Below the fold, the four category
 * staves begin immediately — the product is visible without scrolling past
 * decoration. A judge sees the arena within one scroll."
 *
 * Both paths reach the same place: a user who prefers browsing never has to use
 * the input at all.
 */

import { CATEGORY_LIST } from "@khoros/core";
import { Chip } from "@khoros/ui";

import { ArenaSection } from "@/components/ArenaSection";
import { IntentForm } from "@/components/IntentForm";

// Rankings come from a materialised view that the indexer refreshes; revalidate
// rather than rebuild so the arena reflects a fresh cycle without a deploy.
export const revalidate = 60;

export default function FrontDoor(): React.ReactElement {
  return (
    <>
      <section className="front-door">
        <div className="site-shell">
          <h1 className="khoros-display front-question">
            What&rsquo;s your financial goal?
          </h1>

          <IntentForm />

          <div className="chip-row">
            {CATEGORY_LIST.map((c) => (
              <Chip
                key={c.id}
                href={`/arena/${c.id}?intent=${encodeURIComponent(c.seedChip)}`}
              >
                {c.seedChip}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/*
        The four arenas begin immediately. Equal height allocation per category
        is enforced in ArenaSection, so a thinner category shows an invitation
        at the same height rather than collapsing.
      */}
      <div className="site-shell">
        {CATEGORY_LIST.map((c) => (
          <ArenaSection key={c.id} category={c.id} limit={3} />
        ))}
      </div>
    </>
  );
}
