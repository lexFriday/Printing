import fs from "node:fs";

const route = fs.readFileSync("src/routes/_app.calendar.tsx", "utf8");
const sidebar = fs.readFileSync("src/components/AppSidebar.tsx", "utf8");

for (const text of ["Calendar", "target_completion_date", "Open Job Order", "No scheduled work"]) {
  if (!route.includes(text)) throw new Error(`Calendar route is missing ${text}.`);
}
if (!sidebar.includes('url: "/calendar"')) throw new Error("Calendar must be available from primary navigation.");
console.log("calendar workflow contract passed");
