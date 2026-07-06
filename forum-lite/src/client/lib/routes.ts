import {
  DEFAULT_LOCALE,
  localizePath,
  parseLocalePath,
  shouldLocalizePath,
  type SupportedLocale,
} from "../../shared/locales";

type WithIds = { id?: string | number; publicId?: string | number | null };
type WithCategoryPublicId = { categoryPublicId?: string | number | null; categoryId?: string | number | null };

export function currentLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return parseLocalePath(window.location.pathname).locale;
}

export function publicPath(path: string, locale = currentLocale()): string {
  if (!shouldLocalizePath(path)) return localizePath(path, DEFAULT_LOCALE);
  return localizePath(path, locale);
}

export function threadPath(thread: WithIds): string {
  return publicPath(`/t/${thread.publicId ?? thread.id}`);
}

export function categoryPath(category: WithIds): string {
  return publicPath(`/c/${category.publicId ?? category.id}`);
}

export function categoryPathFromRow(row: WithCategoryPublicId): string {
  return publicPath(`/c/${row.categoryPublicId ?? row.categoryId}`);
}

export function memberPath(username: string): string {
  return publicPath(`/u/${encodeURIComponent(username)}`);
}

export function tagPath(slug: string): string {
  return publicPath(`/tag/${encodeURIComponent(slug)}`);
}
