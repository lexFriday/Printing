import { createClient } from "@supabase/supabase-js";

// Assigns NJL roles to already-provisioned auth accounts. Account creation and
// passwords stay outside source control; missing accounts are reported safely.
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const assignments = [
  { role: "owner", people: ["Louise Relucano", "Nikko Relucano"], emails: ["njladvertisingcorp@gmail.com", "louiserelucano@yahoo.com"] },
  { role: "admin", people: ["Michaela Corre", "Mylene Ibarbia"], emails: ["njliconceptz@yahoo.com", "njliconceptzadvertising@gmail.com"] },
  { role: "staff", people: ["Jeremy Josef", "Michael Aranton"], emails: ["njliconceptzprod@yahoo.com"] },
];

const result = await admin.auth.admin.listUsers();
if (result.error) throw result.error;
const usersByEmail = new Map(result.data.users.map((user) => [user.email?.toLowerCase(), user]));
const missing = [];
for (const assignment of assignments) {
  for (const email of assignment.emails) {
    const user = usersByEmail.get(email.toLowerCase());
    if (!user) { missing.push(email); continue; }
    const profile = await admin.from("profiles").upsert({ id: user.id, display_name: assignment.people[0], email: user.email }, { onConflict: "id" });
    if (profile.error) throw new Error(`profile ${email}: ${profile.error.message}`);
    const role = await admin.from("user_roles").upsert({ user_id: user.id, role: assignment.role }, { onConflict: "user_id,role" });
    if (role.error) throw new Error(`role ${email}: ${role.error.message}`);
    console.log(`${email} -> ${assignment.role}`);
  }
}
if (missing.length) {
  console.error(`Missing NJL accounts (create/invite before rerunning): ${missing.join(", ")}`);
  process.exitCode = 2;
} else console.log("All NJL role assignments applied.");
