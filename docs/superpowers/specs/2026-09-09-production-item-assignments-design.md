# Production Item Assignments Design

## Outcome

Production workers land on the items assigned to them and can immediately see readiness, the current blocker, and the next safe action. Owners and Admins assign one or more active Production users directly from each immutable Job Order line item.

## Source of truth

`job_order_line_items` owns production-item identity and order. `production_item_assignments` owns assignment history, with one active row per item/user and soft removal for auditability. Material readiness, progress, blockers, queue membership, and completion remain derived. `production_tasks.assignee_id` and `production_job_assignments` cease to authorize work; legacy project assignments are expanded to their Job Order items once, then retired.

## Workflow

Owners/Admins open Production to a three-view queue: Needs assignment, Active, Completed. Each row represents an item, not an undifferentiated project. They can assign a team in context, search active Production users, see workload, and safely save against the assignment set they opened. Removing the final assignee from active work requires explicit confirmation.

Production users see My Production: only their active assigned items, ordered by blocker/urgency and Job Order item order. Opening an item shows project context but exposes only assigned item work. Each item names its status, blocker, next action, and the outcome of that action.

Staff retains operational visibility but is never described as personally assigned work. Owner/Admin/Staff access to existing operational records remains unchanged; only Owner/Admin can assign.

## Data and concurrency

The new table records `job_order_line_item_id`, `user_id`, `assigned_by`, `assigned_at`, `removed_by`, and `removed_at`, with a partial unique index for active pairs. The write RPC locks the item, validates active Production roles, compares the caller's expected active user set with the database set, and rejects stale saves. It soft-removes missing users and inserts newly selected users in one transaction.

## Permissions

Database access is authoritative. Production users may read a Job Order shell only when at least one contained item is assigned to them. Item, task, material, and mutation RPCs must filter or authorize by the target line item. Task `assignee_id` is informational legacy data only and must not override item assignment. Owner/Admin/Staff keep established operational access; protected exceptions remain Owner/Admin-only.

## Recovery and edge cases

Null production status is rendered as Not prepared and cannot crash the queue. Missing production records, dates, materials, steps, inactive users, cancelled work, stale saves, network failures, and expired sessions produce explicit recoverable states. Cancelled work is excluded from active queues. Assignment UI preserves selection after save failure and refreshes on stale data.

## Rollout

Migrations are forward-only. Existing active project assignments are copied to every current Job Order item, then marked removed. No remote migration is applied until local/remote migration histories and live function signatures are reconciled. Rollback disables the new UI/RPC path; historical rows remain intact rather than being deleted.

