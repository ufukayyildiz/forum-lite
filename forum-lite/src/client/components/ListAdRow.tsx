import type { AdsConfig } from "../lib/api";
import { activeAdInterval, type AdIntervalKind } from "../lib/ads";
import { AdSlot } from "./AdSlot";

const MAX_INLINE_LIST_ADS = 12;

export function shouldShowLeadListAd(config: AdsConfig | undefined, total: number) {
  return Boolean(config?.enabled && total > 0);
}

export function shouldShowListAd(
  config: AdsConfig | undefined,
  position: number,
  total: number,
  kind: AdIntervalKind = "topic",
) {
  if (!config?.enabled || position <= 0 || total <= 0) return false;
  const interval = activeAdInterval(config, kind);
  if (position % interval !== 0) return false;
  return position / interval <= MAX_INLINE_LIST_ADS;
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
