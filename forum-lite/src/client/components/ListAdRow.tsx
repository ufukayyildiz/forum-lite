import type { AdsConfig } from "../lib/api";
import { AdSlot } from "./AdSlot";

const LIST_AD_INTERVAL = 7;

export function shouldShowLeadListAd(config: AdsConfig | undefined, total: number) {
  return Boolean(config?.enabled && total > 0);
}

export function shouldShowListAd(config: AdsConfig | undefined, position: number, total: number) {
  return Boolean(config?.enabled && position < total && position % LIST_AD_INTERVAL === 0);
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
        <AdSlot config={config} index={index} />
      </td>
    </tr>
  );
}
