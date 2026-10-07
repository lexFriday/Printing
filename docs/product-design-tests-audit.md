# Product Design Tests Audit

Date: 2026-07-02

Purpose: apply the 17 product-design tests to the main Mitzy Sy Printing System screens before approving UI changes. This is an approval gate, not a redesign plan.

Scoring:

- 17/17 = Excellent
- 15-16 = Production Ready
- 12-14 = Needs Revision
- Below 12 = Redesign

Core workflow being tested:

```txt
Customer Inquiry
-> Quotation
-> Job Order
-> Expense Tracking
-> Invoice
-> Payment
-> Profitability
```

## Executive Summary

| Screen           | Primary User          | Job                                               | Score | Approval         |
| ---------------- | --------------------- | ------------------------------------------------- | ----- | ---------------- |
| Dashboard        | Owner / staff by role | See work requiring attention today                | 14/17 | Needs Revision   |
| Quotes List      | Sales / admin staff   | Find or create quotations                         | 15/17 | Production Ready |
| New/Edit Quote   | Sales / admin staff   | Create pricing and save/send quote                | 14/17 | Needs Revision   |
| Quote Detail     | Sales / admin staff   | Review quote and move it forward                  | 15/17 | Production Ready |
| Job Order Detail | Admin staff / owner   | Track production, expenses, and billing readiness | 15/17 | Production Ready |
| Invoice Detail   | Accounting / owner    | Review invoice balance and record payment         | 16/17 | Production Ready |
| Reports          | Accounting / owner    | Review operational money/report views             | 13/17 | Needs Revision   |
| Customers        | Sales / admin staff   | Find or create customer records                   | 15/17 | Production Ready |
| Users            | Owner                 | Assign or disable user access                     | 16/17 | Production Ready |
| Audit Logs       | Owner                 | Review critical system activity                   | 15/17 | Production Ready |
| Print Pages      | Sales / accounting    | Print customer-facing documents                   | 16/17 | Production Ready |

Main findings:

1. Reports is the highest cognitive-load screen because it combines several report workflows.
2. Dashboard is useful, but it can still feel like multiple queues competing for attention.
3. New/Edit Quote is the most important screen and should stay highly protected from bloat.
4. Detail pages are now mostly aligned around header, guidance, summary, line items, related work.
5. Owner-only screens are clearer than the operational screens because they have narrower jobs.

## Dashboard

Primary user: staff member or owner checking today's work.

One-sentence job: this screen exists to show work requiring attention.

Primary action: create or open the next work item.

Score: 14/17, Needs Revision.

Passes:

- User Test: mostly pass, but role-specific content changes the primary user.
- Job Test: pass.
- 3 Second Test: pass for status-only viewer and mostly pass for staff.
- Dashboard Test: pass; it shows queues, not random charts.
- Workflow Test: pass.
- Data Duplication Test: pass.
- Status Test: pass.
- Client Test: pass.

Fails / weak spots:

- Primary Action Test: weak. Multiple `View all` links can compete with the real next action.
- Delete 50% Test: weak. Some queue sections may be removable for specific roles without breaking their work.
- Cognitive Load Test: weak when all cards have populated tables.

Minimal fix:

- Keep the dashboard as queues only.
- Make `New Quote` the strongest staff action where role allows.
- Keep each queue to a small preview and let `View all` remain secondary.
- Do not add charts.

## Quotes List

Primary user: sales or admin staff.

One-sentence job: this screen exists to find, filter, and create quotations.

Primary action: New quote.

Score: 15/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass.
- 3 Second Test: pass.
- Workflow Test: pass.
- Data Duplication Test: pass.
- Status Test: pass.
- Client Test: pass.

Weak spots:

- Hide Test: filters and table density can be heavy for a first-time user.
- Mom Test: row click affordance may not be obvious unless buttons/links are visible.

Minimal fix:

- Keep `New quote` prominent.
- Keep row links explicit enough that users know where to click.
- Do not hide core quote number/project/customer fields.

## New/Edit Quote

Primary user: sales or admin staff creating pricing.

One-sentence job: this screen exists to create a quotation with embedded pricing.

Primary action: Save and submit/send quote.

Score: 14/17, Needs Revision.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: mostly pass.
- Data Duplication Test: pass; calculator is embedded in line items.
- Workflow Test: pass.
- Client Test: pass.
- Status Test: pass.

Fails / weak spots:

- 3 Second Test: weak because line-item pricing has many fields by nature.
- Cognitive Load Test: weak when multiple pricing modes and totals are visible together.
- Training Test: weak for first-time staff using square-foot pricing.

Minimal fix:

- Keep the current two-section structure.
- Keep draft autosave visible but quiet.
- Do not add more workflow buttons.
- Put advanced/internal sections below line items.
- Keep totals obvious and derived, never directly editable.

## Quote Detail

Primary user: sales or admin staff moving the quote forward.

One-sentence job: this screen exists to review a quote and take the next allowed workflow action.

Primary action: status-dependent, such as Send Quote, Mark Approved, or Convert to Job Order.

Score: 15/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass when status-dependent actions are clean.
- 3 Second Test: pass.
- Workflow Test: pass.
- Status Test: pass.
- Data Duplication Test: pass.
- Client Test: pass.
- Owner Test: pass.

Weak spots:

- Cognitive Load Test: the summary, customer details, quote details, workflow state, and attachments can add up.
- Hide Test: attachments should stay below primary quote review content.

Minimal fix:

- Keep the invoice-style rhythm:
  - header/actions
  - next step guidance
  - total/status summary
  - customer/details
  - line items
  - attachments/secondary info
- Keep only the current status action visually primary.

## Job Order Detail

Primary user: admin staff or owner managing production.

One-sentence job: this screen exists to track production, expenses, and billing readiness.

Primary action: status-dependent production action or Add expense.

Score: 15/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Workflow Test: pass.
- Data Duplication Test: pass; expenses become reports.
- Status Test: pass; job status changes what can happen next.
- Owner Test: pass after completed state was clarified.
- Client Test: pass.

Weak spots:

- Primary Action Test: can be split between status action, add expense, and generate invoice.
- Cognitive Load Test: revenue/profit/status/expense content is dense.

Minimal fix:

- Keep completed state visually closed.
- Keep status movement and invoice generation separate.
- Keep long line item/expense tables internally scrollable after a small number of rows.
- Do not add production scheduling.

## Invoice Detail

Primary user: accounting or owner.

One-sentence job: this screen exists to review invoice balance and record payment.

Primary action: Record Payment / Mark Paid.

Score: 16/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass.
- 3 Second Test: pass.
- Workflow Test: pass.
- Data Duplication Test: pass.
- Status Test: pass.
- Screen Split Test: pass.
- Client Test: pass.
- Owner Test: pass.

Weak spot:

- Hide Test: print buttons should remain visually secondary to payment state.

Minimal fix:

- Keep balance strip strongest.
- Keep `Sales Invoice` and `Delivery Receipt` secondary.
- Keep line items read-only.
- Keep VAT/EWT display tied to invoice snapshot values.

## Reports

Primary user: accounting or owner.

One-sentence job: this screen exists to review derived operational reports.

Primary action: choose the report group/subreport needed today.

Score: 13/17, Needs Revision.

Passes:

- Data Duplication Test: pass; reports derive from operational records.
- Client Test: pass.
- Dashboard Test: mostly pass; reports answer real questions.
- Status Test: pass.
- Production Safety: pass, reports are readers.

Fails / weak spots:

- User Test: weak; accounting and owner have different report needs.
- Primary Action Test: weak; report group, subreport, date filters, print, pay actions all compete.
- Screen Split Test: weak; money in, money out, operations, and profit are separate workflows.
- Cognitive Load Test: weak.
- Training Test: weak for first-time users.

Minimal fix:

- Keep role gating:
  - accounting sees money work only
  - owner/admin sees full reports
- Do not add a report builder.
- Consider separate landing sections later only if users still struggle.
- Keep payment actions only where they directly complete accounting work.

## Customers

Primary user: sales or admin staff.

One-sentence job: this screen exists to find or create customer records.

Primary action: New customer.

Score: 15/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass.
- 3 Second Test: pass.
- Workflow Test: pass.
- Data Duplication Test: pass.
- Client Test: pass.

Weak spots:

- Mom Test: row click vs explicit `View Customer` can be debated.
- Hide Test: table can be dense with many old customers.

Minimal fix:

- Keep explicit `View Customer` unless row-click affordance is made obvious.
- Keep TIN optional but formatted and unique when present.
- Do not make customer management a CRM.

## Users

Primary user: owner.

One-sentence job: this screen exists to assign access and activate/deactivate users.

Primary action: update role/status.

Score: 16/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass.
- 3 Second Test: pass.
- Screen Split Test: pass.
- Client Test: pass.
- Production Safety: pass.

Weak spot:

- Training Test: role meaning must remain clear, especially `Admin Staff` vs owner.

Minimal fix:

- Keep role labels business-friendly.
- Do not add configurable permission matrix yet.

## Audit Logs

Primary user: owner.

One-sentence job: this screen exists to review critical system activity.

Primary action: search/filter audit activity.

Score: 15/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- 3 Second Test: pass.
- Client Test: pass for production safety.
- Owner Test: pass.
- Exception Test: pass because this is a safety review screen.

Weak spots:

- Primary Action Test: search is useful but not a workflow completion action.
- Delete 50% Test: audit data is inherently dense.

Minimal fix:

- Keep owner-only.
- Keep search simple.
- Do not expose to admin staff/accounting/sales.

## Print Pages

Primary user: sales or accounting.

One-sentence job: this screen exists to produce a customer-facing document.

Primary action: print/download.

Score: 16/17, Production Ready.

Passes:

- User Test: pass.
- Job Test: pass.
- Primary Action Test: pass.
- 3 Second Test: pass.
- Data Duplication Test: pass; prints render existing records.
- Client Test: pass.
- Training Test: pass.

Weak spot:

- Hide Test: document metadata must stay minimal so the print does not become an internal record dump.

Minimal fix:

- Keep print pages read-only.
- Keep quote print header clean.
- Keep attachments out of print.
- Keep invoice/DR tax behavior explicit.

## Fix Priority

### Priority 1: Reports Cognitive Load

Reason: lowest score and highest chance of training burden.

Lazy fix:

- Keep current reports, but make each role see fewer choices.
- Do not add charts or builder.
- Keep payment actions close to pending expenses only.

### Priority 2: New/Edit Quote First-Time Clarity

Reason: quote creation is the most important workflow.

Lazy fix:

- Keep fields grouped.
- Keep totals sticky/obvious.
- Keep save state visible.
- Hide internal/reference sections lower on the page.

### Priority 3: Dashboard Primary Action

Reason: dashboard should show work, not become a mini reports page.

Lazy fix:

- Strong `New Quote` where permitted.
- Small queue previews.
- Secondary `View all` links.

## Screens Approved As-Is For Now

These do not need immediate redesign:

- Quotes List
- Quote Detail
- Job Order Detail
- Invoice Detail
- Customers
- Users
- Audit Logs
- Print Pages

## Screens Needing Revision Before Final UX Approval

- Dashboard
- New/Edit Quote
- Reports

## Final Recommendation

Do not redesign the whole app. The current system mostly follows the PRD workflow. The next UI pass should focus only on:

```txt
Reports: reduce choices by role and context.
New/Edit Quote: reduce field noise without hiding pricing power.
Dashboard: make the next action more obvious than the queue previews.
```

Everything else is good enough for production unless manual QA finds a specific workflow blocker.
