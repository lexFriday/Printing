export async function logAudit(
  _action: string,
  _entity_type: string,
  _entity_id: string | null,
  _new_values?: unknown,
  _old_values?: unknown,
) {
  // Operational changes are captured by trusted database triggers.
  // Keep this compatibility shim until existing callers are removed.
  return Promise.resolve();
}
