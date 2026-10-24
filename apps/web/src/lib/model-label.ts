/** Who made a piece of study material, for "Made by …" lines. */
export function modelLabel(model: string | null | undefined) {
  if (!model) return "AI";
  if (model.startsWith("claude")) return "Claude";
  if (model.startsWith("@cf/")) return "Talvra's basic AI (simpler results)";
  return model;
}
