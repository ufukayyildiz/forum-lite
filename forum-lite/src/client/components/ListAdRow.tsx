import type { AdsConfig } from "../lib/api";
import { AdSlot } from "./AdSlot";

export function listAdInterval(config?: AdsConfig) {
  const value = Number(config?.postInterval ?? 3);
  return Math.max(1, Math.min(20, Number.isFinite(value) ? value : 3));
}

export function shouldShowListAd(config: AdsConfig | undefined, position: number, total: number) {
  return Boolean(config?.enabled && position < total && position % listAdInterval(config) === 0);
}

export function ListAdRow({ config, index, colSpan }: { config?: AdsConfig; index: number; colSpan: number }) {
  if (!config?.enabled) return null;
  return (
    <tr className="gb-ad-table-row">
      <td colSpan={colSpan}>
        <AdSlot config={config} index={index} />
      </td>
    </tr>
  );
}
