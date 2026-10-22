// Sizes are width × height. Keep opposite orientations paired; some model
// resolutions approximate the named ratio because dimensions align to 32 pixels.
const landscapeSizes = ["608x352", "736x416", "832x480", "864x480", "960x544", "1024x576", "1056x608", "1152x640", "1216x672", "1280x736", "1344x768", "1920x1088"];
const photoSizes = ["640x416", "960x640", "1536x1024", "1920x1280"];
const transpose = (size: string) => size.split("x").reverse().join("x");
export const GENERATION_SIZES = [
  { ratio: "16:9", label: "16:9 横屏", sizes: landscapeSizes },
  { ratio: "9:16", label: "9:16 竖屏", sizes: landscapeSizes.map(transpose) },
  { ratio: "3:2", label: "3:2 横向照片", sizes: photoSizes },
  { ratio: "2:3", label: "2:3 纵向照片", sizes: photoSizes.map(transpose) },
  { ratio: "1:1", label: "1:1 方形", sizes: ["512x512", "768x768", "1024x1024", "1536x1536", "2048x2048"] },
];
export function defaultGenerationSize(ratio: string): string {
  if (ratio === "16:9") return "1344x768";
  if (ratio === "9:16") return "768x1344";
  return GENERATION_SIZES.find(group => group.ratio === ratio)?.sizes[0] || "1344x768";
}

// Repair old saved sizes as well as changes of orientation. Preserve resolution
// when its transposed counterpart is offered by the target ratio.
export function normalizeGenerationSize(ratio: string, size?: string): string {
  const sizes = GENERATION_SIZES.find(group => group.ratio === ratio)?.sizes || [];
  if (size && sizes.includes(size)) return size;
  if (size && sizes.includes(transpose(size))) return transpose(size);
  return defaultGenerationSize(ratio);
}
