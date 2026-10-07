import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const createPage = readFileSync(new URL("../src/routes/_app.quotes.new.tsx", import.meta.url), "utf8");
const editPage = readFileSync(new URL("../src/routes/_app.quotes.$id.edit.tsx", import.meta.url), "utf8");

for (const [name, page] of [["new quote", createPage], ["edit quote", editPage]]) {
  assert.match(page, /replace_quote_lines_and_snapshot/, `${name} must save lines and their material snapshot atomically`);
  assert.match(page, /item_template_id:\s*(?:l|line)\.template_id\s*\|\|\s*null/, `${name} must persist the selected item-template identity`);
}
assert.match(editPage, /template_id:\s*line\.item_template_id\s*\?\?\s*""/, "draft editing must retain the saved template identity");
assert.doesNotMatch(editPage, /\.from\("quote_line_items"\)\s*\.delete/, "edit must not delete lines outside the transactional RPC");

console.log("Quote material snapshot wiring contract: passed");
