export const velocityTeamId = "velocity-swimming";

function assertRecordScope(kind, id, data) {
  if (data == null) return; // Deletions can remove an old out-of-scope record.
  if (kind === "team" && id !== velocityTeamId) {
    throw new Error("Only Velocity Swimming team records can be imported.");
  }
  if (["swim", "relay"].includes(kind) && data.teamId !== velocityTeamId) {
    throw new Error("Only results recorded for Velocity Swimming can be imported.");
  }
  if (kind === "athlete" && data.teamId && data.teamId !== velocityTeamId) {
    throw new Error("Omit a historical athlete's non-Velocity team ID; preserve the team name instead.");
  }
  if (kind === "knowledge" && data.kind !== "meet") {
    throw new Error("Only meet catalog entries can be imported.");
  }
}

export function assertVelocityImportBatch(batch) {
  for (const row of batch.rows ?? []) {
    assertRecordScope(row.kind, row.id, row.data);
    for (const parent of row.prerequisites ?? []) {
      assertRecordScope(parent.kind, parent.id, parent.data);
    }
  }
}

export function assertVelocityCollectionBatch(batch) {
  const kinds = { teams: "team", athletes: "athlete", swims: "swim", relay_results: "relay", knowledge_entries: "knowledge" };
  for (const write of batch.writes ?? []) {
    const [collection, id] = write.path.split("/");
    assertRecordScope(kinds[collection], id, write.after);
  }
}
