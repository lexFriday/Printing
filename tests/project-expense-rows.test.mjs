import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectExpenseRows,
  summarizeProjectProfitability,
} from "../src/lib/projectExpenseRows.ts";

test("uses only Operations-confirmed direct costs and shared allocations once per Job Order", () => {
  const rows = buildProjectExpenseRows(
    [
      {
        id: "direct",
        amount: 100,
        job_order_id: "job-a",
        expense_type: "materials",
        project_cost_confirmed_at: "2026-09-15T00:00:00Z",
      },
      { id: "shared", amount: 100, job_order_id: null, expense_type: "transport" },
      { id: "general", amount: 25, job_order_id: null, expense_type: "utilities" },
    ],
    [
      {
        job_expense_id: "shared",
        job_order_id: "job-a",
        allocated_amount: 60,
        confirmed_at: "2026-09-15T00:00:00Z",
      },
      {
        job_expense_id: "shared",
        job_order_id: "job-b",
        allocated_amount: 40,
        confirmed_at: "2026-09-15T00:00:00Z",
      },
    ],
  );

  assert.deepEqual(
    rows.map((row) => [row.jobOrderId, row.projectAmount]),
    [
      ["job-a", 100],
      ["job-a", 60],
      ["job-b", 40],
    ],
  );
  assert.deepEqual(
    summarizeProjectProfitability(
      [
        { id: "job-a", job_number: "JO-1", project_name: "A", quoted_amount: 300 },
        { id: "job-b", job_number: "JO-2", project_name: "B", quoted_amount: 200 },
      ],
      rows,
    ).map((row) => [row.jobOrderId, row.totalCost, row.profit]),
    [
      ["job-a", 160, 140],
      ["job-b", 40, 160],
    ],
  );
});

test("rejects a shared expense with a direct Job Order link", () => {
  assert.throws(
    () =>
      buildProjectExpenseRows(
        [{ id: "bad", amount: 100, job_order_id: "job-a" }],
        [{ job_expense_id: "bad", job_order_id: "job-b", allocated_amount: 100 }],
      ),
    /both a direct Job Order and allocations/,
  );
});

test("uses only confirmed partial allocations in project profitability", () => {
  const rows = buildProjectExpenseRows(
    [{ id: "bulk-materials", amount: 50000, job_order_id: null, expense_type: "materials" }],
    [
      {
        job_expense_id: "bulk-materials",
        job_order_id: "job-a",
        allocated_amount: 20000,
        confirmed_at: "2026-09-15T00:00:00Z",
      },
    ],
  );

  assert.deepEqual(rows, [
    {
      expenseId: "bulk-materials",
      jobOrderId: "job-a",
      projectAmount: 20000,
      category: "materials",
      isShared: true,
    },
  ]);
});

test("keeps saved but unconfirmed project costs out of profitability", () => {
  const rows = buildProjectExpenseRows(
    [
      { id: "direct", amount: 100, job_order_id: "job-a", expense_type: "materials" },
      { id: "shared", amount: 100, job_order_id: null, expense_type: "transport" },
    ],
    [{ job_expense_id: "shared", job_order_id: "job-a", allocated_amount: 100 }],
  );

  assert.deepEqual(rows, []);
});
