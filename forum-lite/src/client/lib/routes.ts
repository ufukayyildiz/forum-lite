type WithIds = { id?: string | number; publicId?: string | number | null };
type WithCategoryPublicId = { categoryPublicId?: string | number | null; categoryId?: string | number | null };

export function threadPath(thread: WithIds): string {
  return `/t/${thread.publicId ?? thread.id}`;
}

export function categoryPath(category: WithIds): string {
  return `/c/${category.publicId ?? category.id}`;
}

export function categoryPathFromRow(row: WithCategoryPublicId): string {
  return `/c/${row.categoryPublicId ?? row.categoryId}`;
}
