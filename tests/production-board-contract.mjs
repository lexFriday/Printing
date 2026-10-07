import fs from "node:fs";
const route = fs.readFileSync("src/routes/_app.production.index.tsx", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20260909192000_production_project_assignments.sql",
  "utf8",
);
for (const text of [
  "Production queue",
  "Needs assignment",
  "Unassigned",
  "Assign team",
  "Open item",
  "production_workspace_queue",
]) {
  if (!route.includes(text)) throw new Error(`Production board missing ${text}.`);
}
for (const text of [
  "production_job_assignments",
  "set_production_job_assignments",
  "production_workspace_queue",
  "can_access_production_job",
]) {
  if (!migration.includes(text)) throw new Error(`Production task migration missing ${text}.`);
}
if (route.includes("My work"))
  throw new Error("Production workers must not have an all-work toggle.");
console.log("production board contract: passed");
