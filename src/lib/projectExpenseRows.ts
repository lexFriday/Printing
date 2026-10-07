export type ExpenseSource = {
  id: string;
  amount: number | string;
  job_order_id: string | null;
  expense_type?: string | null;
  disbursement_category?: string | null;
  disbursement_subcategory?: string | null;
  /** Direct Job Order costs are reportable immediately after the approved JO is selected. */
  project_cost_confirmed_at?: string | null;
};

export type AllocationSource = {
  job_expense_id: string;
  job_order_id: string;
  allocated_amount: number | string;
  /** A shared cost is reportable only after Operations confirms the allocation. */
  confirmed_at?: string | null;
};

export type ProjectExpenseRow = {
  expenseId: string;
  jobOrderId: string;
  projectAmount: number;
  category: string;
  isShared: boolean;
};

export type ProjectSource = {
  id: string;
  job_number: string;
  project_name: string;
  quoted_amount: number | string;
};

function money(value: number | string, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a valid amount.`);
  return amount;
}

export function buildProjectExpenseRows(
  expenses: ExpenseSource[],
  allocations: AllocationSource[],
): ProjectExpenseRow[] {
  const sharesByExpense = new Map<string, AllocationSource[]>();
  const expenseIds = new Set(expenses.map((expense) => expense.id));
  for (const allocation of allocations) {
    if (!expenseIds.has(allocation.job_expense_id))
      throw new Error(`Allocation references unknown expense ${allocation.job_expense_id}.`);
    const shares = sharesByExpense.get(allocation.job_expense_id) ?? [];
    if (shares.some((share) => share.job_order_id === allocation.job_order_id))
      throw new Error("A shared expense cannot allocate the same Job Order twice.");
    shares.push(allocation);
    sharesByExpense.set(allocation.job_expense_id, shares);
  }

  return expenses.flatMap<ProjectExpenseRow>((expense) => {
    const originalAmount = money(expense.amount, "Expense amount");
    const shares = sharesByExpense.get(expense.id) ?? [];
    const category = (
      expense.disbursement_subcategory ||
      expense.expense_type ||
      expense.disbursement_category ||
      "other"
    )
      .trim()
      .toLowerCase();
    if (expense.job_order_id && shares.length)
      throw new Error("An expense cannot have both a direct Job Order and allocations.");
    if (expense.job_order_id)
      return [
        {
          expenseId: expense.id,
          jobOrderId: expense.job_order_id,
          projectAmount: originalAmount,
          category,
          isShared: false,
        },
      ];
    const confirmedShares = shares.filter((share) => Boolean(share.confirmed_at));
    if (!confirmedShares.length) return [];
    const total = shares.reduce(
      (sum, share) => sum + money(share.allocated_amount, "Allocated amount"),
      0,
    );
    if (total - originalAmount > 0.005)
      throw new Error("Shared allocations cannot exceed the expense amount.");
    return confirmedShares.map((share) => ({
      expenseId: expense.id,
      jobOrderId: share.job_order_id,
      projectAmount: money(share.allocated_amount, "Allocated amount"),
      category,
      isShared: true,
    }));
  });
}

export function summarizeProjectProfitability(jobs: ProjectSource[], rows: ProjectExpenseRow[]) {
  return jobs.map((job) => {
    const projectRows = rows.filter((row) => row.jobOrderId === job.id);
    const revenue = money(job.quoted_amount, "Job Order amount");
    const totalCost = projectRows.reduce((sum, row) => sum + row.projectAmount, 0);
    const profit = revenue - totalCost;
    return {
      jobOrderId: job.id,
      jobNumber: job.job_number,
      projectName: job.project_name,
      revenue,
      totalCost,
      profit,
      marginPercent: revenue === 0 ? 0 : (profit / revenue) * 100,
    };
  });
}
