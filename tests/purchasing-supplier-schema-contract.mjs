import fs from "node:fs";

const route = fs.readFileSync("src/routes/_app.purchasing.$requestId.tsx", "utf8");

if (!route.includes('.select("id,name")')) {
  throw new Error("Purchase detail must read the supplier name column from the suppliers table.");
}
if (!route.includes('.eq("active", true)')) {
  throw new Error("Purchase detail must filter suppliers using the suppliers.active column.");
}
if (!route.includes('.order("name")')) {
  throw new Error("Purchase detail must order suppliers by their canonical name column.");
}
const suppliersQuery = route.split('.from("suppliers")')[1]?.split(";\n")[0] ?? "";
if (suppliersQuery.includes("supplier_name") || suppliersQuery.includes("is_active")) {
  throw new Error("Purchase detail must not query legacy supplier_name fields from suppliers.");
}

console.log("purchasing supplier schema contract passed");
