export const ASSET_CATEGORIES = [
  {value: "person", label: "人物"},
  {value: "location", label: "地点"},
  {value: "object", label: "物品"},
  {value: "creature", label: "生物"},
  {value: "vehicle", label: "载具"},
  {value: "other", label: "其他"},
] as const;

export type AssetCategory = typeof ASSET_CATEGORIES[number]["value"];
export function assetCategoryLabel(category?: string): string {
  return ASSET_CATEGORIES.find(item => item.value === category)?.label || "人物";
}
