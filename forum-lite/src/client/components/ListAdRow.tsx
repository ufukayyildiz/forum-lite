import type { AdsConfig } from "../lib/api";
import { activeAdInterval, type AdIntervalKind } from "../lib/ads";
import { AdSlot } from "./AdSlot";

export function shouldShowLeadListAd(config: AdsConfig | undefined, total: number) {
  return Boolean(config?.enabled && total > 0);
}

export function shouldShowListAd(
  config: AdsConfig | undefined,
  position: number,
  total: number,
  kind: AdIntervalKind = "topic",
) {
  return Boolean(config?.enabled && position > 0 && total > 0 && position % activeAdInterval(config, kind) === 0);
}

export function ListAdRow({
  config,
  index,
  colSpan,
  lead = false,
}: {
  config?: AdsConfig;
  index: number;
  colSpan: number;
  lead?: boolean;
}) {
  if (!config?.enabled) return null;
  return (
    <tr className={`gb-ad-table-row${lead ? " gb-ad-table-row-lead" : ""}`}>
      <td colSpan={colSpan}>
        <AdSlot config={config} index={index} height={lead ? 100 : undefined} />
      </td>
    </tr>
  );
}
