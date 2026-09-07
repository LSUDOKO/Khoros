"use client";

/**
 * Artifact 10 — the configurable boundaries, one variant per category.
 *
 * docs/03 lists a distinct set of knobs for each category. The discriminated
 * union means adding a category without its fields is a type error, which is
 * how equal depth stays enforced here rather than remembered.
 *
 * Copy rule from docs/01: the interface talks like a knowledgeable person. Every
 * label below is what the setting does, not what the protocol calls it.
 */

import type { CategoryBoundaries, Protocol } from "@khoros/core";

type Props = {
  boundaries: CategoryBoundaries;
  onChange: (next: CategoryBoundaries) => void;
};

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function BoundaryFields({ boundaries, onChange }: Props): React.ReactElement {
  switch (boundaries.kind) {
    // ---------------------------------------------------------------- rebalancing
    case "rebalancing":
      return (
        <div className="field-row">
          <div className="field">
            <label htmlFor="widthProfile">How wide a price range</label>
            <select
              id="widthProfile"
              value={boundaries.widthProfile}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  widthProfile: e.target.value as typeof boundaries.widthProfile,
                })
              }
            >
              <option value="tight">Tight — more fees, rebalances more often</option>
              <option value="balanced">Balanced</option>
              <option value="wide">Wide — fewer rebalances, lower fee capture</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="maxSlippageBps">Most slippage you will accept</label>
            <input
              id="maxSlippageBps"
              inputMode="numeric"
              value={boundaries.maxSlippageBps}
              onChange={(e) =>
                onChange({ ...boundaries, maxSlippageBps: num(e.target.value, 50) })
              }
            />
            <p className="field-hint">Basis points. 50 = 0.5%.</p>
          </div>

          <div className="field">
            <label htmlFor="maxRebalancesPerDay">Most rebalances per day</label>
            <input
              id="maxRebalancesPerDay"
              inputMode="numeric"
              value={boundaries.maxRebalancesPerDay}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  maxRebalancesPerDay: num(e.target.value, 4),
                })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="minSecondsBetween">Least time between rebalances</label>
            <input
              id="minSecondsBetween"
              inputMode="numeric"
              value={boundaries.minSecondsBetween}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  minSecondsBetween: num(e.target.value, 3600),
                })
              }
            />
            <p className="field-hint">Seconds. Stops churn in a volatile hour.</p>
          </div>
        </div>
      );

    // --------------------------------------------------------------- grid trading
    case "grid-trading":
      return (
        <div className="field-row">
          <div className="field">
            <label htmlFor="priceMin">Bottom of the range</label>
            <input
              id="priceMin"
              inputMode="decimal"
              value={boundaries.priceMin}
              onChange={(e) =>
                onChange({ ...boundaries, priceMin: num(e.target.value, 0) })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="priceMax">Top of the range</label>
            <input
              id="priceMax"
              inputMode="decimal"
              value={boundaries.priceMax}
              onChange={(e) =>
                onChange({ ...boundaries, priceMax: num(e.target.value, 0) })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="levels">How many levels</label>
            <input
              id="levels"
              inputMode="numeric"
              value={boundaries.levels}
              onChange={(e) => onChange({ ...boundaries, levels: num(e.target.value, 20) })}
            />
          </div>

          <div className="field">
            <label htmlFor="spacing">How levels are spaced</label>
            <select
              id="spacing"
              value={boundaries.spacing}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  spacing: e.target.value as typeof boundaries.spacing,
                })
              }
            >
              <option value="geometric">Geometric — even percentage steps</option>
              <option value="arithmetic">Arithmetic — even price steps</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="gridSlippage">Most slippage per trade</label>
            <input
              id="gridSlippage"
              inputMode="numeric"
              value={boundaries.maxSlippageBps}
              onChange={(e) =>
                onChange({ ...boundaries, maxSlippageBps: num(e.target.value, 50) })
              }
            />
            <p className="field-hint">Basis points.</p>
          </div>

          <div className="field">
            <label htmlFor="stopOut">Stop everything below</label>
            <input
              id="stopOut"
              inputMode="decimal"
              value={boundaries.stopOutPrice ?? ""}
              placeholder="Optional"
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  stopOutPrice:
                    e.target.value.trim() === ""
                      ? undefined
                      : num(e.target.value, 0),
                })
              }
            />
          </div>
        </div>
      );

    // ---------------------------------------------------------- yield optimisation
    case "yield-optimisation": {
      const toggle = (p: Protocol): void => {
        const has = boundaries.protocolAllowlist.includes(p);
        onChange({
          ...boundaries,
          protocolAllowlist: has
            ? boundaries.protocolAllowlist.filter((x) => x !== p)
            : [...boundaries.protocolAllowlist, p],
        });
      };

      return (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="riskProfile">How much risk</label>
              <select
                id="riskProfile"
                value={boundaries.riskProfile}
                onChange={(e) =>
                  onChange({
                    ...boundaries,
                    riskProfile: e.target.value as typeof boundaries.riskProfile,
                  })
                }
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="maxConcentrationBps">Most in any one protocol</label>
              <input
                id="maxConcentrationBps"
                inputMode="numeric"
                value={boundaries.maxConcentrationBps}
                onChange={(e) =>
                  onChange({
                    ...boundaries,
                    maxConcentrationBps: num(e.target.value, 6000),
                  })
                }
              />
              <p className="field-hint">Basis points. 6000 = 60%.</p>
            </div>

            <div className="field">
              <label htmlFor="minSpreadBps">Least extra yield worth moving for</label>
              <input
                id="minSpreadBps"
                inputMode="numeric"
                value={boundaries.minSpreadBps}
                onChange={(e) =>
                  onChange({ ...boundaries, minSpreadBps: num(e.target.value, 50) })
                }
              />
              <p className="field-hint">Basis points.</p>
            </div>

            <div className="field">
              <label htmlFor="minHoldSeconds">Least time before moving again</label>
              <input
                id="minHoldSeconds"
                inputMode="numeric"
                value={boundaries.minHoldSeconds}
                onChange={(e) =>
                  onChange({
                    ...boundaries,
                    minHoldSeconds: num(e.target.value, 172_800),
                  })
                }
              />
              <p className="field-hint">Seconds.</p>
            </div>
          </div>

          <fieldset className="field">
            <legend className="khoros-label">Protocols it may use</legend>
            <div className="checkbox-row">
              {(["venus", "lista", "pancakeswap-v3", "aave-v3"] as Protocol[]).map(
                (p) => (
                  <label key={p} className="checkbox">
                    <input
                      type="checkbox"
                      checked={boundaries.protocolAllowlist.includes(p)}
                      onChange={() => toggle(p)}
                    />
                    {p}
                  </label>
                ),
              )}
            </div>
            <p className="field-hint">
              Capital can never leave this set. Unticking one removes it entirely.
            </p>
          </fieldset>
        </>
      );
    }

    // ------------------------------------------------------------- health factor
    case "health-factor":
      return (
        <div className="field-row">
          <div className="field">
            <label htmlFor="hfFloor">Act when health factor falls to</label>
            <input
              id="hfFloor"
              inputMode="decimal"
              value={boundaries.hfFloor}
              onChange={(e) =>
                onChange({ ...boundaries, hfFloor: num(e.target.value, 1.15) })
              }
            />
            <p className="field-hint">Liquidation happens at 1.0.</p>
          </div>

          <div className="field">
            <label htmlFor="hfTarget">Restore it to</label>
            <input
              id="hfTarget"
              inputMode="decimal"
              value={boundaries.hfTarget}
              onChange={(e) =>
                onChange({ ...boundaries, hfTarget: num(e.target.value, 1.4) })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="preferredResponse">What it should try first</label>
            <select
              id="preferredResponse"
              value={boundaries.preferredResponse}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  preferredResponse: e.target
                    .value as typeof boundaries.preferredResponse,
                })
              }
            >
              <option value="collateral-first">Add collateral — cheaper</option>
              <option value="deleverage-first">Pay down debt</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="maxInterventionsPerDay">Most interventions per day</label>
            <input
              id="maxInterventionsPerDay"
              inputMode="numeric"
              value={boundaries.maxInterventionsPerDay}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  maxInterventionsPerDay: num(e.target.value, 6),
                })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="predictiveConfidence">How early to act</label>
            <select
              id="predictiveConfidence"
              value={boundaries.predictiveConfidence}
              onChange={(e) =>
                onChange({
                  ...boundaries,
                  predictiveConfidence: num(e.target.value, 0.95),
                })
              }
            >
              <option value={0.9}>Only when a fall is very likely</option>
              <option value={0.95}>Balanced</option>
              <option value={0.99}>At the first sign of risk</option>
            </select>
            <p className="field-hint">
              Acts on a projected breach, not just the current level.
            </p>
          </div>
        </div>
      );
  }
}
