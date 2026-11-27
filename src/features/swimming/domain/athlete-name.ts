/** Format a public athlete projection without depending on a page or database client. */
export function athleteName(athlete: { id: string; data: unknown }): string {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const name = object(object(athlete.data).name);
  return (
    [name.first, name.last]
      .filter((part) => typeof part === "string" && part)
      .join(" ") || athlete.id
  );
}
