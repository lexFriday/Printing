# Build Package Overview

# **Build Package Overview**

## **Product Summary**

Mitzy Sy Printing Operations System is a workflow automation platform designed to eliminate duplicate encoding between quotation, job order, and invoice creation while providing simple project profitability tracking.

The system replaces the current spreadsheet-driven operational process with a guided workflow that allows staff to:

Create Quotation  
→ Convert To Job Order  
→ Record Project Expenses  
→ Generate Invoice  
→ Record Payment  
→ View Profitability

The system is operational in nature and is not intended to replace accounting software.

QuickBooks remains the accounting system of record.

The application focuses on:

* Quotation generation  
* Embedded pricing calculator  
* Job tracking  
* Expense tracking  
* Invoice generation  
* Payment status tracking  
* Project profitability visibility

---

## **Main Business Problem**

Current staff workflow requires:

Calculator  
→ Manual Quote Creation  
→ Manual Job Creation  
→ Manual Invoice Creation

This creates:

* Duplicate encoding  
* Copy-paste mistakes  
* Invoice inconsistencies  
* Poor project profitability visibility

The system solves this by establishing a single workflow and a single pricing source of truth.

---

## **Core Workflow**

### **Workflow A — Quotation Creation**

Trigger:

Customer requests pricing

Actor:

Staff

Action:

Create Quote  
Add Line Items  
Calculate Pricing  
Send Quote

Outcome:

Quotation Created

---

### **Workflow B — Quote Approval**

Trigger:

Customer approves quotation

Actor:

Staff

Action:

Mark Quote Approved

Outcome:

Approved Quote

---

### **Workflow C — Job Order Creation**

Trigger:

Approved Quote

Actor:

Staff

Action:

Convert To Job Order

Outcome:

Job Order Created

---

### **Workflow D — Expense Tracking**

Trigger:

Project execution begins

Actor:

Staff

Action:

Record Expenses

Outcome:

Project Cost Visibility

---

### **Workflow E — Invoice Generation**

Trigger:

Project ready for billing

Actor:

Staff

Action:

Generate Invoice

Outcome:

Invoice Created

---

### **Workflow F — Payment Recording**

Trigger:

Customer payment received

Actor:

Staff

Action:

Mark Paid

Outcome:

Invoice Closed

---

### **Workflow G — Profitability Monitoring**

Trigger:

Expenses recorded

Actor:

Staff  
Admin

Action:

View Job Profitability

Outcome:

Revenue  
Expenses  
Profit  
Margin

displayed automatically.

---

## **Primary Users**

Only users performing actual work are included.

### **Admin**

Responsibilities:

Manage Users  
View All Records  
Manage System Settings  
Generate Reports

---

### **Staff**

Responsibilities:

Create Quotes  
Manage Jobs  
Record Expenses  
Generate Invoices  
Record Payments

---

### **Viewer**

Responsibilities:

View Records  
View Reports

No editing permissions.

---

## **Main System Hubs**

The system revolves around four operational hubs:

### **Hub 1 — Quotes**

Purpose:

Create Pricing  
Create Quotations

Core Record:

Quotation

---

### **Hub 2 — Jobs**

Purpose:

Track Project Execution  
Track Expenses

Core Record:

Job Order

---

### **Hub 3 — Invoices**

Purpose:

Bill Customers  
Track Payment Status

Core Record:

Invoice

---

### **Hub 4 — Reports**

Purpose:

View Operational Data

Core Records:

Profitability  
Quote History  
Invoice History

---

## **Source of Truth Architecture**

### **Pricing Source Of Truth**

Quote Line Items

All calculations must originate from Quote Line Items.

---

### **Job Snapshot**

Job Orders store quotation snapshots.

This prevents future quotation changes from altering historical projects.

---

### **Invoice Snapshot**

Invoices store billing snapshots.

This prevents future project changes from altering historical invoices.

---

## **Required Data Records**

The workflow cannot function without:

Users  
Customers  
Quotations  
Quote Line Items  
Job Orders  
Job Expenses  
Invoices  
Audit Logs

These records are required.

No additional business entities are required for Version 1\.

---

## **Implementation Order**

### **Phase 1**

Foundation

Authentication  
Users  
Customers  
Quotations  
Quote Line Items

---

### **Phase 2**

Operational Workflow

Quote Approval  
Job Orders  
Expense Tracking

---

### **Phase 3**

Billing

Invoice Generation  
Payment Recording

---

### **Phase 4**

Reporting

Profitability  
Quote Reports  
Invoice Reports  
Audit Logs

---

## **Key Risks**

### **Risk 1 — Duplicate Pricing Logic**

If pricing calculations exist in:

Calculator  
Quote  
Invoice  
Reports

independently,

the system will eventually produce inconsistent totals.

Mitigation:

Quote Line Items remain the only pricing source of truth.

---

### **Risk 2 — Manual Invoice Editing**

Allowing invoice amounts to be edited creates reconciliation issues.

Mitigation:

Invoices generated from Job Orders only.

---

### **Risk 3 — Historical Data Corruption**

Changing quotations after jobs or invoices exist may alter historical profitability.

Mitigation:

Snapshot storage.

---

### **Risk 4 — Scope Expansion**

Potential requests:

Inventory  
CRM  
Accounting  
QuickBooks Replacement  
Production Scheduling

may appear during development.

Mitigation:

Strict adherence to approved scope.

---

## **Explicit Out Of Scope**

The following are not part of Version 1:

Inventory Management  
CRM  
Accounting System  
QuickBooks Replacement  
Supplier Management  
Purchasing  
Workflow Builder  
Approval Engine  
Advanced Collections  
Production Scheduling  
Custom Report Builder  
Analytics Platform

These features must not be introduced during implementation without a formal scope review.

# UX Architecture Review

# **2\. UX Architecture Review**

## **Purpose**

This section identifies workflow friction, UX risks, navigation risks, missing states, and implementation concerns before development begins.

The goal is to ensure users always know:

Where am I?  
What am I doing?  
What should I do next?

The system should guide users through the workflow naturally without requiring training or memorization.

---

# **Workflow A — Create Quotation**

## **Screen**

Quotes List  
→  
Create Quote  
---

## **Primary User Goal**

Create and send a quotation as quickly as possible.

---

## **Potential UX Risks**

### **Issue**

Too many pricing entry methods.

---

### **Why It Matters**

Users currently think:

Size  
→  
Price  
→  
Quote

If the UI introduces:

Pricing Templates  
Calculator Module  
Product Builder  
Costing Screen

users may not know where pricing begins.

---

### **Recommended UX Direction**

Use only:

Add Line Item

with:

Square Foot Pricing  
or  
Fixed Pricing

inside the line item itself.

No separate calculator navigation.

---

## **Potential UX Risks**

### **Issue**

Users may not understand why totals changed.

---

### **Why It Matters**

The system calculates automatically.

Users may not realize:

Width  
Height  
Rate  
Qty

caused the change.

---

### **Recommended UX Direction**

Update totals live.

Highlight calculated fields visually.

Show:

Calculated Automatically

beneath system-generated values.

---

## **Navigation Review**

### **Duplicate Navigation Risk**

None currently identified.

The workflow is linear.

---

## **Missing States**

### **Loading State**

Display:

Loading quotation...  
---

### **Empty State**

Display:

No line items added yet.

Action:

Add Line Item  
---

### **Validation State**

Display inline errors:

Width is required.  
Rate per Sq Ft is required.  
Quantity must be greater than zero.  
---

### **Success State**

Display:

Quote saved successfully.  
---

### **Error State**

Display:

Unable to save quote.

Please try again.  
---

### **Permission State**

Display:

You do not have permission to edit quotations.  
---

### **Locked State**

For Approved Quotes:

Display:

This quotation has been approved and can no longer be edited.  
---

# **Workflow B — Send Quote**

## **Screen**

Quote Details  
---

## **Primary User Goal**

Move quotation to customer review.

---

## **Potential UX Risk**

### **Issue**

User may not know whether quote has already been sent.

---

### **Why It Matters**

Duplicate sending may occur.

---

### **Recommended UX Direction**

Show visible status badge:

Draft  
Sent  
Approved  
Rejected

at the top of the page.

---

## **Missing States**

### **Success State**

Quotation sent successfully.  
---

### **Error State**

Unable to send quotation.  
---

### **Locked State**

Sent quotations should not be editable.

Display:

This quotation has already been sent.  
---

# **Workflow C — Convert To Job Order**

## **Screen**

Quote Details  
---

## **Primary User Goal**

Start project execution.

---

## **Potential UX Risk**

### **Issue**

User may not understand why conversion is unavailable.

---

### **Why It Matters**

Only approved quotations can become Job Orders.

---

### **Recommended UX Direction**

Hide conversion button until:

Quote Status \= Approved  
---

## **Blocker State**

Display:

This quotation must be approved before a Job Order can be created.  
---

## **Success State**

Job Order created successfully.  
---

# **Workflow D — Record Expenses**

## **Screen**

Job Order Details  
---

## **Primary User Goal**

Record project costs.

---

## **Potential UX Risk**

### **Issue**

Users may forget to record expenses.

---

### **Why It Matters**

Profitability becomes inaccurate.

---

### **Recommended UX Direction**

Place Expense section immediately below Project Summary.

Do not hide it behind tabs.

---

## **Potential UX Risk**

### **Issue**

Users may not understand profitability calculation.

---

### **Why It Matters**

Trust in reporting decreases.

---

### **Recommended UX Direction**

Display:

Revenue  
Expenses  
Profit  
Margin %

together on one card.

---

## **Missing States**

### **Empty State**

No expenses recorded yet.

Action:

Add Expense  
---

### **Validation State**

Amount must be greater than zero.  
Expense Type is required.  
---

### **Success State**

Expense added successfully.  
---

### **Error State**

Unable to save expense.  
---

# **Workflow E — Generate Invoice**

## **Screen**

Job Order Details  
---

## **Primary User Goal**

Create customer invoice.

---

## **Potential UX Risk**

### **Issue**

Users may expect invoice editing.

---

### **Why It Matters**

Invoice values must remain consistent.

---

### **Recommended UX Direction**

Invoice should inherit data automatically.

Display:

Generated from Job Order

near invoice summary.

---

## **Blocker State**

If Job Order is incomplete:

Display:

Complete the Job Order before generating an invoice.

(Note: This assumes the business wants completed jobs before invoicing. This requires confirmation in Missing Decisions.)

---

## **Success State**

Invoice generated successfully.  
---

# **Workflow F — Record Payment**

## **Screen**

Invoice Details  
---

## **Primary User Goal**

Close invoice.

---

## **Potential UX Risk**

### **Issue**

User may accidentally mark wrong invoice as paid.

---

### **Why It Matters**

Financial reporting becomes inaccurate.

---

### **Recommended UX Direction**

Require confirmation:

Mark this invoice as paid?

before status change.

---

## **Missing States**

### **Success State**

Invoice marked as paid.  
---

### **Error State**

Unable to update invoice.  
---

### **Locked State**

Display:

This invoice has already been marked as paid.  
---

# **Workflow G — View Profitability**

## **Screen**

Job Order Details  
Reports  
---

## **Primary User Goal**

Determine whether project was profitable.

---

## **Potential UX Risk**

### **Issue**

Profit numbers appear incorrect because expenses were not entered.

---

### **Why It Matters**

Users may lose trust in the system.

---

### **Recommended UX Direction**

Display warning when:

Expenses \= 0

Message:

No expenses have been recorded for this project.  
Profitability may be incomplete.  
---

# **Cross-System Navigation Review**

## **Navigation Structure**

Current:

Dashboard  
Quotes  
Jobs  
Invoices  
Reports  
Settings  
---

## **Navigation Risk**

Low.

Navigation mirrors actual workflow.

No duplicate entry points currently exist.

---

# **Global Missing States Review**

Every page must support:

## **Loading**

Loading...  
---

## **Empty**

No records found.

with next action guidance.

---

## **Validation**

Field-level messages.

Not generic popups.

---

## **Success**

Clear confirmation after every save action.

---

## **Error**

Actionable error message.

Never:

Something went wrong.

without guidance.

---

## **Permission Denied**

You do not have permission to perform this action.  
---

## **Locked / Finalized**

For:

Approved Quotes  
Generated Invoices  
Paid Invoices

Clearly explain why editing is unavailable.

---

# **UX Risks Requiring Product Review**

## **Risk 1**

Invoice generation rule unclear.

Current PRD does not define:

Can invoices be generated before job completion?

Business decision required.

---

## **Risk 2**

Quote approval workflow unclear.

Current PRD does not define:

Who performs approval?  
Customer?  
Staff?  
Owner?

Business decision required.

---

## **Risk 3**

Partial payment behavior undefined.

Current PRD supports:

Issued  
Paid

only.

Need confirmation that partial payments are not required.

---

# **UX Architecture Conclusion**

The overall workflow is strong because it is naturally linear:

Quote  
→  
Job  
→  
Expense  
→  
Invoice  
→  
Payment

The biggest UX priority is preserving the client's current mental model:

Calculator  
→  
Quote  
→  
Invoice

while eliminating duplicate encoding.

If users always see one obvious next action, the system will remain simple, trainable, and aligned with the workflow described in the client interview.

# Module Specifications.

# **3\. Module Specifications**

## **Purpose**

This section converts the approved workflows into implementation-ready modules.

A module exists only if it directly supports a business workflow.

No module should exist solely because it is technically convenient.

---

# **Module 1 — Authentication & User Management**

## **Goal**

Control system access and permissions.

---

## **Workflow Supported**

Login  
Permission Enforcement  
User Access Control  
---

## **Dependencies**

None.

This module must be implemented first.

---

## **Required Data**

### **User**

Name  
Email  
Password Hash  
Role  
Status  
---

## **Business Rules**

Users must log in before accessing the system.

Passwords must be securely hashed.

Inactive users cannot log in.

Role permissions must be enforced throughout the application.

---

## **Permissions**

### **Admin**

Can:

Create Users  
Edit Users  
Deactivate Users  
Assign Roles  
---

### **Staff**

Can:

Login  
Perform Operational Work  
---

### **Viewer**

Can:

View Records  
View Reports  
---

## **Validation Rules**

Email must be unique.

Password required.

Role required.

---

## **Acceptance Tests**

### **Test 1**

Given:

Valid credentials

When:

User logs in

Then:

Dashboard loads successfully  
---

### **Test 2**

Given:

Inactive user

When:

User attempts login

Then:

Access denied  
---

## **Out Of Scope**

Single Sign-On  
OAuth  
Multi-Factor Authentication

Version 1 only.

---

# **Module 2 — Customers**

## **Goal**

Store customer records used by quotations, jobs, and invoices.

---

## **Workflow Supported**

Customer Selection  
Customer Management  
---

## **Dependencies**

Authentication

---

## **Required Data**

Customer Name  
Contact Person  
Contact Number  
Email  
Address  
Notes  
---

## **Business Rules**

Customers may have multiple quotations.

Customers may have multiple job orders.

Customers may have multiple invoices.

Customer deletion is not allowed if related records exist.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

Create  
 Edit  
 View

---

### **Viewer**

View only.

---

## **Validation Rules**

Customer Name required.

Contact Person required.

Contact Number required.

---

## **Acceptance Tests**

### **Test 1**

Create customer successfully.

### **Test 2**

Customer appears in quotation customer selector.

---

## **Out Of Scope**

CRM  
Lead Management  
Sales Pipeline  
---

# **Module 3 — Quotations**

## **Goal**

Create customer quotations and pricing.

This is the core operational module.

---

## **Workflow Supported**

Create Quote  
Edit Quote  
Send Quote  
Approve Quote  
Reject Quote  
---

## **Dependencies**

Customers

Authentication

---

## **Required Data**

### **Quote Header**

Customer  
Project Name  
Quote Date  
Remarks  
Status  
---

### **Quote Line Items**

Description  
Pricing Mode  
Quantity  
Pricing Details  
---

## **Business Rules**

Quote must contain at least one line item.

Quote total is system-generated.

Manual total editing prohibited.

Approved quotations become read-only.

Rejected quotations become read-only.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

Create  
 Edit Draft  
 Send  
 Approve  
 Reject

(Approval workflow requires business confirmation.)

---

### **Viewer**

View only.

---

## **Validation Rules**

Customer required.

Project Name required.

Line Item required.

Quote Total \> 0\.

---

## **Acceptance Tests**

### **Test 1**

User creates quotation.

System calculates total automatically.

---

### **Test 2**

User sends quotation.

Status changes:

Draft → Sent  
---

### **Test 3**

User approves quotation.

Status changes:

Sent → Approved  
---

## **Out Of Scope**

Multi-Level Approvals  
Approval Chains  
Workflow Builder  
---

# **Module 4 — Pricing Calculator**

## **Goal**

Calculate quotation pricing.

Embedded inside quotation line items.

Not a standalone module.

---

## **Workflow Supported**

Quote Pricing  
---

## **Dependencies**

Quotation Line Items

---

## **Required Data**

### **Square Foot Pricing**

Width  
Height  
Unit  
Rate Per Sq Ft  
Quantity  
---

### **Fixed Pricing**

Unit Price  
Quantity  
---

## **Business Rules**

Calculator cannot exist independently.

Calculations occur automatically.

Users do not press Calculate.

---

## **Permissions**

Same as quotation permissions.

---

## **Validation Rules**

Width \> 0\.

Height \> 0\.

Rate \> 0\.

Quantity \> 0\.

---

## **Acceptance Tests**

### **Test 1**

User enters dimensions.

System computes:

Sq Ft  
Unit Price  
Line Total

automatically.

---

### **Test 2**

User updates dimensions.

Totals recalculate immediately.

---

## **Out Of Scope**

Pricing Templates  
Cost Libraries  
Complex Costing Engines  
---

# **Module 5 — Job Orders**

## **Goal**

Track approved projects.

---

## **Workflow Supported**

Convert Quote  
Manage Project  
Track Profitability  
---

## **Dependencies**

Approved Quotations

---

## **Required Data**

Customer  
Project  
Quoted Amount  
Status  
---

## **Business Rules**

Job Orders can only be created from Approved Quotes.

Job Orders store quotation snapshots.

Manual Job Order creation prohibited.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

Create from Approved Quote.

View.

Complete Job.

---

### **Viewer**

View only.

---

## **Validation Rules**

Approved quotation required.

---

## **Acceptance Tests**

### **Test 1**

Approved Quote converts to Job Order.

---

### **Test 2**

Quotation values copied successfully.

---

## **Out Of Scope**

Production Scheduling  
Task Management  
Manufacturing Workflow  
---

# **Module 6 — Job Expenses**

## **Goal**

Track project costs.

---

## **Workflow Supported**

Expense Recording  
Profitability Tracking  
---

## **Dependencies**

Job Orders

---

## **Required Data**

Date  
Type  
Description  
Amount  
---

## **Business Rules**

Expenses belong to Job Orders.

Expenses affect profitability immediately.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

Create  
 Edit

---

### **Viewer**

View only.

---

## **Validation Rules**

Amount \> 0\.

Description required.

Type required.

---

## **Acceptance Tests**

### **Test 1**

Expense recorded successfully.

---

### **Test 2**

Profitability updates automatically.

---

## **Out Of Scope**

Purchasing  
Procurement  
Cost Accounting  
---

# **Module 7 — Invoices**

## **Goal**

Bill customers.

---

## **Workflow Supported**

Generate Invoice  
Record Payment  
---

## **Dependencies**

Job Orders

---

## **Required Data**

Invoice Number  
Customer  
Amount  
Status  
---

## **Business Rules**

Invoices generated from Job Orders only.

Manual invoice creation prohibited.

Invoice amounts are snapshots.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

Generate Invoice.

Mark Paid.

---

### **Viewer**

View only.

---

## **Validation Rules**

Job Order required.

Invoice Amount \> 0\.

---

## **Acceptance Tests**

### **Test 1**

Generate Invoice from Job Order.

---

### **Test 2**

Invoice inherits customer and pricing.

---

### **Test 3**

Invoice status updates:

Issued → Paid  
---

## **Out Of Scope**

Credit Notes  
Refunds  
Partial Payments

Pending business confirmation.

---

# **Module 8 — Reports**

## **Goal**

Provide operational visibility.

---

## **Workflow Supported**

Review Quotes  
Review Invoices  
Review Profitability  
---

## **Dependencies**

Quotations

Job Orders

Invoices

Expenses

---

## **Required Data**

Derived from operational records.

No manual report data.

---

## **Business Rules**

Reports are read-only.

Reports derive from source records.

---

## **Permissions**

### **Admin**

Full access.

---

### **Staff**

View reports.

---

### **Viewer**

View reports.

---

## **Validation Rules**

Date filters optional.

---

## **Acceptance Tests**

### **Test 1**

Quote History Report loads.

---

### **Test 2**

Invoice Report loads.

---

### **Test 3**

Profitability Report loads.

---

## **Out Of Scope**

Custom Report Builder  
Analytics Platform  
Forecasting  
---

# **Module 9 — Audit Logs**

## **Goal**

Track critical actions.

---

## **Workflow Supported**

Compliance  
Traceability  
Troubleshooting  
---

## **Dependencies**

All modules.

---

## **Required Data**

User  
Action  
Record  
Timestamp  
---

## **Business Rules**

Audit logs generated automatically.

Audit logs cannot be edited.

---

## **Permissions**

### **Admin**

View logs.

---

### **Staff**

No access.

---

### **Viewer**

No access.

---

## **Validation Rules**

All critical actions must generate audit entries.

---

## **Acceptance Tests**

### **Test 1**

Create Quote generates audit log.

### **Test 2**

Generate Invoice generates audit log.

### **Test 3**

Mark Paid generates audit log.

---

## **Out Of Scope**

Audit Export Engine  
Compliance Reporting  
---

# Page Specifications.

# **4\. Page Specifications**

## **Purpose**

This section defines every user-facing page required to complete the approved workflow.

Pages should be designed around user tasks, not database entities.

Every page must have:

Clear Purpose  
Clear Primary Action  
Clear Success State  
Clear Error State  
Clear Next Step

Users should never wonder:

What do I do next?

---

# **Page 1 — Login**

## **Route**

/login

---

## **Purpose**

Authenticate users.

---

## **Primary User Goal**

Access the system.

---

## **Primary Action**

Sign In

---

## **Required Sections**

### **Login Form**

Fields:

Email  
Password

---

## **Available Actions**

Sign In

---

## **Empty State**

Not applicable.

---

## **Loading State**

Signing In...

---

## **Validation State**

Email is required.  
Password is required.

---

## **Success State**

Redirect:

/dashboard

---

## **Error State**

Invalid email or password.

---

## **Permission Rules**

Public page.

---

## **Acceptance Tests**

User can log in successfully.

---

# **Page 2 — Dashboard**

## **Route**

/dashboard

---

## **Purpose**

Show work requiring attention.

---

## **Primary User Goal**

Continue operational work.

---

## **Primary Action**

New Quote

---

## **Required Sections**

### **Quotes Requiring Action**

Display:

Draft Quotes  
Sent Quotes

---

### **Active Jobs**

Display:

Open Job Orders

---

### **Outstanding Invoices**

Display:

Issued Invoices

---

## **Available Actions**

Create Quote  
View Quote  
View Job  
View Invoice

---

## **Empty State**

No active work found.

Create a quotation to begin.

---

## **Loading State**

Loading dashboard...

---

## **Success State**

Not applicable.

---

## **Error State**

Unable to load dashboard.

---

## **Permission Rules**

Authenticated users only.

---

## **Acceptance Tests**

Dashboard displays records correctly.

---

# **Page 3 — Quotes List**

## **Route**

/quotes

---

## **Purpose**

View and manage quotations.

---

## **Primary User Goal**

Find or create quotations.

---

## **Primary Action**

Create Quote

---

## **Required Sections**

### **Quote Table**

Columns:

Quote Number  
Customer  
Project  
Amount  
Status  
Date

---

### **Filters**

Date Range  
Customer  
Status

---

## **Available Actions**

View  
Edit  
Send  
Convert

---

## **Empty State**

No quotations found.

Button:

Create Quote

---

## **Loading State**

Loading quotations...

---

## **Validation State**

Filter validation only.

---

## **Success State**

Not applicable.

---

## **Error State**

Unable to load quotations.

---

## **Permission Rules**

Viewer \= Read Only.

---

## **Acceptance Tests**

Users can locate quotations.

---

# **Page 4 — Create Quote**

## **Route**

/quotes/new

---

## **Purpose**

Create a new quotation.

---

## **Primary User Goal**

Generate pricing and create a quote.

---

## **Primary Action**

Save Quote

---

## **Required Sections**

### **Quote Information**

Fields:

Customer  
Project Name  
Quote Date  
Remarks

---

### **Line Items Table**

Columns:

Description  
Pricing Type  
Qty  
Width  
Height  
Unit  
Rate  
Unit Price  
Line Total

---

### **Quote Summary**

Display:

Subtotal  
Grand Total

---

## **Available Actions**

Save Quote  
Send Quote  
Add Line Item  
Delete Line Item

---

## **Empty State**

No line items added.

Action:

Add Line Item

---

## **Loading State**

Loading quote form...

---

## **Validation State**

Customer required.  
Project Name required.  
Line Item required.

---

## **Success State**

Quote saved successfully.

---

## **Error State**

Unable to save quote.

---

## **Permission Rules**

Staff and Admin only.

---

## **Acceptance Tests**

Quote can be created and saved.

---

# **Page 5 — Quote Details**

## **Route**

/quotes/{id}

---

## **Purpose**

Review and progress quotation.

---

## **Primary User Goal**

Move quote through workflow.

---

## **Primary Action**

Depends on status.

### **Draft**

Send Quote

---

### **Approved**

Convert To Job Order

---

## **Required Sections**

### **Quote Summary**

Customer  
Project  
Amount  
Status

---

### **Line Items**

Read-only display.

---

## **Available Actions**

Edit  
Send  
Approve  
Reject  
Convert

Based on status.

---

## **Empty State**

Not applicable.

---

## **Loading State**

Loading quotation...

---

## **Success State**

Quotation updated successfully.

---

## **Error State**

Unable to update quotation.

---

## **Permission Rules**

Viewer \= Read Only.

---

## **Acceptance Tests**

Status transitions function correctly.

---

# **Page 6 — Job Orders List**

## **Route**

/jobs

---

## **Purpose**

Track active projects.

---

## **Primary User Goal**

Locate and manage jobs.

---

## **Primary Action**

View Job

---

## **Required Sections**

### **Jobs Table**

Columns:

Job Number  
Customer  
Project  
Amount  
Status

---

## **Empty State**

No active jobs found.

---

## **Loading State**

Loading jobs...

---

## **Error State**

Unable to load jobs.

---

## **Permission Rules**

Authenticated users.

---

## **Acceptance Tests**

Jobs display correctly.

---

# **Page 7 — Job Order Details**

## **Route**

/jobs/{id}

---

## **Purpose**

Track project execution and profitability.

---

## **Primary User Goal**

Record expenses.

---

## **Primary Action**

Add Expense

---

## **Required Sections**

### **Project Summary**

Customer  
Project  
Revenue  
Status

---

### **Expense Table**

Columns:

Date  
Type  
Description  
Amount

---

### **Profitability Card**

Display:

Revenue  
Expenses  
Profit  
Margin %

---

## **Available Actions**

Add Expense  
Complete Job  
Generate Invoice

---

## **Empty State**

No expenses recorded yet.

---

## **Loading State**

Loading job...

---

## **Validation State**

Amount must be greater than zero.

---

## **Success State**

Expense added successfully.

---

## **Error State**

Unable to save expense.

---

## **Permission Rules**

Viewer \= Read Only.

---

## **Acceptance Tests**

Expenses update profitability immediately.

---

# **Page 8 — Invoice List**

## **Route**

/invoices

---

## **Purpose**

Track invoices.

---

## **Primary User Goal**

Find invoices requiring action.

---

## **Primary Action**

View Invoice

---

## **Required Sections**

### **Invoice Table**

Columns:

Invoice Number  
Customer  
Amount  
Date  
Status

---

## **Empty State**

No invoices found.

---

## **Loading State**

Loading invoices...

---

## **Error State**

Unable to load invoices.

---

## **Permission Rules**

Authenticated users.

---

## **Acceptance Tests**

Invoices display correctly.

---

# **Page 9 — Invoice Details**

## **Route**

/invoices/{id}

---

## **Purpose**

Review invoice and record payment.

---

## **Primary User Goal**

Mark invoice as paid.

---

## **Primary Action**

Mark Paid

---

## **Required Sections**

### **Invoice Summary**

Invoice Number  
Customer  
Project  
Amount  
Status

---

### **Line Items**

Read-only.

---

## **Available Actions**

Mark Paid

---

## **Empty State**

Not applicable.

---

## **Loading State**

Loading invoice...

---

## **Validation State**

Payment Date required.

---

## **Success State**

Invoice marked as paid.

---

## **Error State**

Unable to update invoice.

---

## **Permission Rules**

Staff and Admin only.

---

## **Acceptance Tests**

Invoice status updates correctly.

---

# **Page 10 — Reports**

## **Route**

/reports

---

## **Purpose**

View operational reports.

---

## **Primary User Goal**

Review business activity.

---

## **Primary Action**

Run Report

---

## **Required Sections**

### **Project Profitability**

### **Quote History**

### **Invoice History**

---

## **Empty State**

No report data available.

---

## **Loading State**

Generating report...

---

## **Error State**

Unable to generate report.

---

## **Permission Rules**

Authenticated users.

---

## **Acceptance Tests**

All reports generate successfully.

---

# **Page 11 — User Management**

## **Route**

/settings/users

---

## **Purpose**

Manage system users.

---

## **Primary User Goal**

Create and manage users.

---

## **Primary Action**

Create User

---

## **Permission Rules**

Admin only.

---

## **Acceptance Tests**

Admins can manage users.

---

# **Page Coverage Validation**

All approved workflows are covered:

Login  
Dashboard  
Quotes  
Jobs  
Invoices  
Reports  
Users

No additional pages are required for Version 1\.

---

# Blocker Handling Design

# **5\. Blocker Handling Design**

## **Purpose**

Users should never be left wondering:

Why can't I continue?

Every workflow blocker must:

* Be visible  
* Explain why the action is unavailable  
* Explain what must happen next  
* Provide a clear recovery path

The system should prevent invalid actions before they occur.

---

# **Blocker 1 — Cannot Send Quote**

## **Workflow**

Create Quote  
→  
Send Quote

---

## **Blocking Condition**

One or more required fields missing.

Examples:

No Customer Selected  
No Project Name  
No Line Items  
Quote Total \= 0

---

## **Where It Appears**

Quote Create Screen

Quote Edit Screen

---

## **Display Method**

Inline validation.

Top-page warning summary.

---

## **User Message**

This quotation cannot be sent yet.

Complete all required information before sending.

---

## **Resolution Actions**

Show missing items:

Customer Required  
Project Name Required  
At Least One Line Item Required

---

## **UX Behavior**

Disable:

Send Quote

until requirements are satisfied.

---

# **Blocker 2 — Cannot Approve Quote**

## **Workflow**

Sent Quote  
→  
Approved Quote

---

## **Blocking Condition**

Quote not in:

Sent

status.

---

## **Where It Appears**

Quote Details Page

---

## **User Message**

Only sent quotations can be approved.

---

## **Resolution Action**

Send the quotation first.

---

## **UX Behavior**

Hide:

Approve  
Reject

buttons until quote status is:

Sent

---

# **Blocker 3 — Cannot Convert To Job Order**

## **Workflow**

Quote  
→  
Job Order

---

## **Blocking Condition**

Quote status is not:

Approved

---

## **Where It Appears**

Quote Details Page

---

## **User Message**

This quotation must be approved before a Job Order can be created.

---

## **Resolution Action**

Approve quotation.

---

## **UX Behavior**

Disable or hide:

Convert To Job Order

until status becomes:

Approved

---

# **Blocker 4 — Duplicate Job Order Creation**

## **Workflow**

Approved Quote  
→  
Job Order

---

## **Blocking Condition**

Job Order already exists.

---

## **Where It Appears**

Quote Details Page

---

## **User Message**

A Job Order has already been created for this quotation.

---

## **Resolution Action**

Navigate to existing Job Order.

---

## **UX Behavior**

Replace:

Convert To Job Order

with:

View Job Order

---

# **Blocker 5 — Cannot Add Expense**

## **Workflow**

Job Order  
→  
Expense Entry

---

## **Blocking Condition**

Required expense fields incomplete.

Examples:

Missing Date  
Missing Type  
Missing Description  
Amount \<= 0

---

## **Where It Appears**

Add Expense Modal

---

## **User Message**

Please complete all required fields.

---

## **Resolution Action**

Highlight invalid fields.

---

## **UX Behavior**

Prevent submission.

---

# **Blocker 6 — Profitability Is Incomplete**

## **Workflow**

Job Order  
→  
Profitability View

---

## **Blocking Condition**

No expenses recorded.

---

## **Where It Appears**

Job Order Details

Profitability Card

---

## **User Message**

No expenses have been recorded for this project.

Profitability calculations may be incomplete.

---

## **Resolution Action**

Add expenses.

---

## **UX Behavior**

Show warning banner.

Do not block workflow.

---

# **Blocker 7 — Cannot Generate Invoice**

## **Workflow**

Job Order  
→  
Invoice

---

## **Blocking Condition**

Business rule not yet confirmed.

Current PRD ambiguity:

Can invoices be generated before job completion?

---

## **Product Decision Required**

Option A:

Job must be completed first

Option B:

Invoice can be generated anytime

---

## **Status**

Open Product Decision

---

## **Implementation Risk**

High

Developer cannot finalize workflow until decision is made.

---

# **Blocker 8 — Duplicate Invoice Generation**

## **Workflow**

Job Order  
→  
Invoice

---

## **Blocking Condition**

Invoice already exists.

---

## **Where It Appears**

Job Order Details

---

## **User Message**

An invoice has already been generated for this Job Order.

---

## **Resolution Action**

View existing invoice.

---

## **UX Behavior**

Replace:

Generate Invoice

with:

View Invoice

---

# **Blocker 9 — Cannot Mark Invoice Paid**

## **Workflow**

Invoice  
→  
Paid

---

## **Blocking Condition**

Invoice already marked paid.

---

## **Where It Appears**

Invoice Details

---

## **User Message**

This invoice has already been marked as paid.

---

## **Resolution Action**

None required.

---

## **UX Behavior**

Hide:

Mark Paid

button.

---

# **Blocker 10 — Permission Denied**

## **Workflow**

All modules.

---

## **Blocking Condition**

User lacks required permission.

---

## **Where It Appears**

Any protected action.

---

## **User Message**

You do not have permission to perform this action.

---

## **Resolution Action**

Contact Administrator.

---

## **UX Behavior**

Protected actions should be hidden whenever possible.

Do not allow users to click actions they cannot perform.

---

# **Blocker 11 — Deleted Or Missing Record**

## **Workflow**

All modules.

---

## **Blocking Condition**

Requested record cannot be found.

---

## **Where It Appears**

View pages.

---

## **User Message**

The requested record could not be found.

---

## **Resolution Action**

Return to list page.

---

## **UX Behavior**

Provide:

Back To Quotes  
Back To Jobs  
Back To Invoices

depending on context.

---

# **Blocker 12 — Audit-Sensitive Records**

## **Workflow**

Approved Quotes

Generated Invoices

Paid Invoices

---

## **Blocking Condition**

User attempts modification of finalized records.

---

## **Where It Appears**

Record Detail Screens

---

## **User Message**

This record has been finalized and can no longer be edited.

---

## **Resolution Action**

None.

Record is read-only.

---

## **UX Behavior**

Disable edit controls.

Display lock indicator.

---

# **Workflow Progress Indicators**

To reduce confusion, every major record should display a workflow indicator.

---

## **Quotation**

Display:

Draft  
→  
Sent  
→  
Approved  
→  
Job Order

Highlight current stage.

---

## **Job Order**

Display:

Open  
→  
Completed  
→  
Invoice

Highlight current stage.

---

## **Invoice**

Display:

Issued  
→  
Paid

Highlight current stage.

---

# **Blocker Severity Classification**

## **Critical**

Blocks workflow completely.

Examples:

Missing Customer  
Missing Line Items  
Missing Approval  
Permission Denied

---

## **Warning**

Workflow may continue, but results may be incomplete.

Examples:

No Expenses Recorded  
Missing Notes

---

## **Informational**

No action required.

Examples:

Invoice Already Generated  
Record Locked

---

# **Blocker Handling Success Criteria**

The blocker handling system is successful when:

* Users always know why an action is unavailable.  
* Users always know how to resolve a blocker.  
* No silent failures occur.  
* No hidden business rules exist.  
* Finalized records remain protected.  
* Workflow progression is obvious.

---

# Setup Completion Design

# **6\. Setup Completion Design**

## **Purpose**

Users should never be dropped into an empty system without knowing what must be configured first.

The system should always answer:

What is missing?  
What should I do next?

Every required setup record should have:

* Completion Indicator  
* Missing Information Indicator  
* Recommended Next Action

The system should guide users toward a usable operational state.

---

# **Setup Flow Overview**

The system requires only a small number of setup records before operational work can begin.

Required setup sequence:

Create Users  
→  
Create Customers  
→  
Create First Quote

Everything else derives from workflow activity.

---

# **Setup Record 1 — Users**

## **Purpose**

Allow staff to access the system.

---

## **Required Before**

Operational Use

---

## **Completion Indicator**

Display:

Users Configured

when:

At Least One Active User Exists

---

## **Missing Information Indicator**

Display:

No active users have been configured.

---

## **Next Action Guidance**

Button:

Create User

---

## **Dashboard Setup Card**

Display:

User Setup  
Status: Incomplete

until first user exists.

---

# **Setup Record 2 — Customers**

## **Purpose**

Quotations require customers.

---

## **Required Before**

Quote Creation

---

## **Completion Indicator**

Display:

Customer Database Ready

when:

At Least One Customer Exists

---

## **Missing Information Indicator**

Display:

No customers found.

---

## **Next Action Guidance**

Button:

Create Customer

---

## **Dashboard Setup Card**

Display:

Customer Setup  
Status: Incomplete

until first customer exists.

---

# **Setup Record 3 — First Quotation**

## **Purpose**

Begin operational workflow.

---

## **Required Before**

Nothing.

This is the first operational activity.

---

## **Completion Indicator**

Display:

Quotation Workflow Started

when:

At Least One Quote Exists

---

## **Missing Information Indicator**

Display:

No quotations have been created.

---

## **Next Action Guidance**

Button:

Create Quote

---

# **Setup Record 4 — Job Orders**

## **Purpose**

Begin project tracking.

---

## **Completion Indicator**

Display:

Project Tracking Active

when:

At Least One Job Order Exists

---

## **Missing Information Indicator**

Display:

No Job Orders have been created.

---

## **Next Action Guidance**

Approve a quotation to create a Job Order.

---

# **Setup Record 5 — Expense Tracking**

## **Purpose**

Enable profitability calculations.

---

## **Completion Indicator**

Display:

Expense Tracking Active

when:

At Least One Expense Exists

---

## **Missing Information Indicator**

Display:

No expenses have been recorded.

---

## **Next Action Guidance**

Button:

Add Expense

---

## **UX Warning**

If:

Expenses \= 0

Display:

Project profitability may be incomplete.

---

# **Setup Record 6 — Invoice Workflow**

## **Purpose**

Enable customer billing.

---

## **Completion Indicator**

Display:

Invoice Workflow Active

when:

At Least One Invoice Exists

---

## **Missing Information Indicator**

Display:

No invoices have been generated.

---

## **Next Action Guidance**

Button:

Generate Invoice

---

# **Setup Record 7 — Payment Tracking**

## **Purpose**

Enable collection tracking.

---

## **Completion Indicator**

Display:

Payment Tracking Active

when:

At Least One Invoice Is Paid

---

## **Missing Information Indicator**

Display:

No payments have been recorded.

---

## **Next Action Guidance**

Button:

Mark Paid

---

# **Record Completion Design**

Every major record should display completion status.

---

# **Quotation Completion**

## **Complete When**

All required fields exist:

Customer  
Project Name  
At Least One Line Item  
Valid Total

---

## **Incomplete Indicator**

Display:

Quotation Incomplete

---

## **Completion Indicator**

Display:

Ready To Send

---

## **Next Action**

Send Quote

---

# **Job Order Completion**

## **Complete When**

Business rule pending confirmation.

Potential definition:

Project Status \= Completed

---

## **Incomplete Indicator**

Display:

Job In Progress

---

## **Completion Indicator**

Display:

Ready For Invoice

---

## **Next Action**

Generate Invoice

---

# **Invoice Completion**

## **Complete When**

Invoice Status:

Paid

---

## **Incomplete Indicator**

Display:

Awaiting Payment

---

## **Completion Indicator**

Display:

Paid

---

## **Next Action**

Mark Paid

---

# **Dashboard Setup Guidance**

During early adoption, display a setup checklist at the top of the Dashboard.

---

## **Example**

Getting Started

✓ Create User

✓ Create Customer

✓ Create Quote

□ Create Job Order

□ Add Expense

□ Generate Invoice

□ Record Payment

---

## **UX Behavior**

As each milestone is completed:

Automatically mark complete.

---

## **Purpose**

Help first-time users understand workflow progression.

---

# **Workflow Progress Guidance**

Every record page should display:

## **Current Stage**

Example:

Quote  
→  
Job  
→  
Invoice  
→  
Paid

Highlight current stage.

---

## **Next Action Prompt**

Examples:

### **Quote**

Next Step: Send Quote

---

### **Approved Quote**

Next Step: Convert To Job Order

---

### **Job Order**

Next Step: Add Expenses

or

Next Step: Generate Invoice

depending on state.

---

### **Invoice**

Next Step: Record Payment

---

# **Setup Completion Success Criteria**

The setup guidance system is successful when:

* Users know exactly what must be configured.  
* Users know exactly what step comes next.  
* No empty screen leaves users confused.  
* New staff can learn workflow progression naturally.  
* The system actively guides users from Quote → Job → Invoice → Payment.

---

**Build Package Section 6 Complete**

Reply:

next

to continue to **Section 7 — Missing Decisions**.

# Missing Decisions

# **7\. Missing Decisions**

## **Purpose**

This section identifies all business, workflow, UX, validation, and implementation decisions that remain unresolved.

These items must be reviewed and approved before development begins.

The goal is to eliminate developer assumptions.

If a rule is not defined here or elsewhere in the PRD, developers must not invent behavior.

---

# **Executive Summary**

The PRD is approximately:

90–95% complete

The remaining items are not architecture issues.

They are business decisions.

Most are small.

However, several have direct workflow and database impact.

---

# **7.1 Missing Business Rules**

---

## **Decision 1 — Quote Approval Process**

### **Current State**

The PRD includes:

Draft  
Sent  
Approved  
Rejected

statuses.

However:

The approval process is undefined.

---

### **Missing Information**

Who performs approval?

Options:

Customer Approval  
Internal Staff Approval  
Owner Approval  
Admin Approval

---

### **Why It Matters**

Determines:

Available Actions  
Permissions  
Workflow Logic  
Audit Logs

---

### **Implementation Risk**

Medium

---

### **Recommendation**

Client confirmation required.

---

# **Decision 2 — How Approval Is Recorded**

### **Current State**

Approval exists.

Recording method is undefined.

---

### **Missing Information**

Options:

Manual Status Change  
Approval Date  
Approval Notes  
Approval Attachment

---

### **Why It Matters**

Determines audit trail requirements.

---

### **Implementation Risk**

Low

---

# **Decision 3 — Invoice Generation Rule**

### **Current State**

Undefined.

---

### **Missing Information**

Can invoices be generated:

Only After Job Completion

or

At Any Time During Project

---

### **Why It Matters**

Direct workflow impact.

---

### **Implementation Risk**

High

---

# **Decision 4 — Multiple Invoices Per Job**

### **Current State**

Assumed:

One Job  
\=  
One Invoice

but not confirmed.

---

### **Missing Information**

Can jobs have:

Deposit Invoice  
Progress Billing  
Final Billing

---

### **Why It Matters**

Major database impact.

Major workflow impact.

---

### **Implementation Risk**

Critical

---

# **Decision 5 — Discounts**

### **Current State**

PRD references:

Discount (Future)

but behavior is undefined.

---

### **Missing Information**

Version 1 support?

No Discounts  
Fixed Amount  
Percentage

---

### **Why It Matters**

Affects:

Quote Calculations  
Invoice Totals  
Reports

---

### **Implementation Risk**

Medium

---

# **Decision 6 — Tax / VAT Handling**

### **Current State**

Undefined.

---

### **Missing Information**

Pricing should be:

VAT Exclusive  
VAT Inclusive  
No VAT

---

### **Why It Matters**

Affects:

Quote Totals  
Invoice Totals  
Reports

---

### **Implementation Risk**

Critical

Financial calculations cannot be finalized until confirmed.

---

# **Decision 7 — File Attachments**

### **Current State**

Not included.

---

### **Missing Information**

Should users upload:

Artwork  
Reference Images  
Signed Quotes  
Purchase Orders

---

### **Why It Matters**

Adds:

Storage  
Permissions  
Upload Validation

---

### **Implementation Risk**

Medium

---

# **7.2 Missing Permission Decisions**

---

## **Decision 8 — Who Can Approve Quotes**

### **Current State**

Undefined.

---

### **Missing Information**

Who can perform:

Approve  
Reject

Options:

Admin  
Staff  
Owner  
Specific Role

---

### **Implementation Risk**

Medium

---

## **Decision 9 — Who Can Edit Expenses**

### **Current State**

Create/Edit assumed.

---

### **Missing Information**

Can users edit:

Existing Expenses

after creation?

---

### **Why It Matters**

Profitability integrity.

---

### **Implementation Risk**

Low

---

## **Decision 10 — Who Can Mark Paid**

### **Current State**

Staff assumed.

---

### **Missing Information**

Should:

All Staff  
Admin Only  
Selected Users

record payments?

---

### **Implementation Risk**

Low

---

# **7.3 Missing Validation Rules**

---

## **Decision 11 — Negative Values**

### **Current State**

Undefined.

---

### **Missing Information**

Can users enter:

Negative Expenses  
Negative Prices  
Negative Quantities

---

### **Recommendation**

Business confirmation required.

---

### **Implementation Risk**

Medium

---

## **Decision 12 — Duplicate Customers**

### **Current State**

Search suggested.

---

### **Missing Information**

Should duplicate customer names be:

Allowed  
Blocked  
Warned

---

### **Implementation Risk**

Low

---

## **Decision 13 — Duplicate Projects**

### **Current State**

Undefined.

---

### **Missing Information**

Can one customer have:

Multiple Jobs With Same Project Name

---

### **Implementation Risk**

Low

---

# **7.4 Missing UX Decisions**

---

## **Decision 14 — Dashboard Setup Checklist**

### **Current State**

Recommended.

Not approved.

---

### **Missing Information**

Should first-time users see:

Setup Checklist

on Dashboard?

---

### **Implementation Risk**

Low

---

## **Decision 15 — Workflow Progress Indicator**

### **Current State**

Recommended.

Not approved.

---

### **Missing Information**

Should records display:

Quote  
→ Job  
→ Invoice  
→ Paid

progress bars?

---

### **Implementation Risk**

Low

---

## **Decision 16 — Quote Sending Method**

### **Current State**

Undefined.

---

### **Missing Information**

Does:

Send Quote

mean:

Status Change Only

or

Email Quote To Customer

---

### **Why It Matters**

Major implementation difference.

---

### **Implementation Risk**

High

---

# **7.5 Missing Edge Case Decisions**

---

## **Decision 17 — Quote Rejection Recovery**

### **Current State**

Rejected quotes become read-only.

---

### **Missing Information**

Can users:

Clone Rejected Quote  
Reopen Rejected Quote

---

### **Implementation Risk**

Low

---

## **Decision 18 — Invoice Mistakes**

### **Current State**

No edit after generation.

---

### **Missing Information**

If invoice generated incorrectly:

What happens?

Options:

Delete  
Void  
Regenerate

---

### **Why It Matters**

Financial workflow.

---

### **Implementation Risk**

High

---

## **Decision 19 — Expense Mistakes**

### **Current State**

Undefined.

---

### **Missing Information**

Can users:

Delete Expenses  
Edit Expenses  
Void Expenses

---

### **Implementation Risk**

Medium

---

# **7.6 Implementation Assumptions Requiring Confirmation**

These assumptions currently exist in the PRD.

Development should not begin until confirmed.

---

### **Assumption A**

One Job \= One Invoice

Status:

Unconfirmed

---

### **Assumption B**

Invoices Generated From Jobs

Status:

Unconfirmed

---

### **Assumption C**

Quote Approval Is Manual

Status:

Unconfirmed

---

### **Assumption D**

Partial Payments Not Supported

Status:

Unconfirmed

---

### **Assumption E**

No VAT Handling

Status:

Unconfirmed

---

# **Missing Decisions Priority Matrix**

## **Critical Before Development**

Must be answered.

Invoice Generation Rule  
Multiple Invoices Per Job  
VAT Handling  
Quote Approval Ownership  
Quote Sending Method  
Invoice Correction Process

---

## **Should Be Answered Before Development**

Discount Rules  
Expense Editing Rules  
Payment Permissions  
Attachment Requirements

---

## **Can Be Deferred**

Setup Checklist  
Progress Indicators  
Duplicate Customer Warnings  
Rejected Quote Recovery

---

# **Product Review Conclusion**

The PRD is structurally complete.

The remaining gaps are business decisions rather than design problems.

No new modules are required.

No architectural redesign is required.

Development should not begin until the Critical decisions above are reviewed and approved.

---

**Build Package Section 7 Complete**

Reply:

next

to continue to **Section 8 — Final Implementation Order**.

# Final Implementation Order

# **8\. Final Implementation Order**

## **Purpose**

This implementation order minimizes rework, prevents duplicated pricing logic, and keeps the build aligned with the approved workflow.

The system should be built in this order:

Foundation  
→ Quote Creation  
→ Job Orders  
→ Expenses  
→ Invoices  
→ Reports  
→ Audit / Hardening

---

# **Phase 1 — Foundation \+ Core Records**

## **Goal**

Establish the minimum system foundation required for operational work.

## **Modules**

Authentication  
User Management  
Customers  
Base Navigation  
Dashboard Shell

## **Pages**

/login  
/dashboard  
/settings/users  
/customers or customer selector inside quote form

## **Dependencies**

None.

## **Build Notes**

Implement only the roles approved in the PRD:

Admin  
Staff  
Viewer

Do not add extra roles.

Do not build CRM functionality.

## **Acceptance Goal**

Users can log in, access the dashboard, manage users if Admin, and create/select customers for quotations.

---

# **Phase 2 — Quotation \+ Embedded Calculator**

## **Goal**

Build the core product experience.

This is the most important phase.

## **Modules**

Quotations  
Quote Line Items  
Embedded Pricing Calculator

## **Pages**

/quotes  
/quotes/new  
/quotes/{id}  
/quotes/{id}/edit

## **Dependencies**

Authentication  
Customers

## **Build Notes**

The calculator must be embedded inside quote line items.

Do not build a separate calculator page.

Support only the two approved pricing modes:

Square Foot Pricing  
Fixed Unit Pricing

## **Required Calculations**

Computed Sq Ft  
Unit Price  
Line Total  
Quote Total

## **Acceptance Goal**

Staff can create a quotation with one or more line items, and totals calculate automatically without Excel or manual total entry.

---

# **Phase 3 — Quote Status Workflow**

## **Goal**

Enable quotation progression.

## **Modules**

Quote Status Management  
Quote Send  
Quote Approve  
Quote Reject

## **Pages**

/quotes/{id}

## **Dependencies**

Phase 2

## **Build Notes**

Implement only the approved statuses:

Draft  
Sent  
Approved  
Rejected

Do not add approval chains or workflow builders.

## **Acceptance Goal**

Users can move quotations through the approved lifecycle, and locked statuses prevent inappropriate editing.

---

# **Phase 4 — Job Orders**

## **Goal**

Convert approved quotations into operational job records.

## **Modules**

Job Orders  
Quote-to-Job Conversion  
Job Snapshot

## **Pages**

/jobs  
/jobs/{id}

## **Dependencies**

Approved Quotations

## **Build Notes**

Job Orders must only be created from approved quotations.

Manual Job Order creation is out of scope.

Job Orders must store quotation snapshots.

## **Acceptance Goal**

An approved quotation can be converted into a Job Order without re-encoding.

---

# **Phase 5 — Job Expenses \+ Profitability**

## **Goal**

Enable per-project cost tracking and profitability visibility.

## **Modules**

Job Expenses  
Profitability Calculation

## **Pages**

/jobs/{id}

## **Dependencies**

Job Orders

## **Build Notes**

Expenses must belong to Job Orders.

Do not build a separate expense accounting module.

Profitability must derive from:

Revenue \- Expenses

## **Acceptance Goal**

Staff can add expenses to a Job Order and immediately see revenue, expenses, profit, and margin.

---

# **Phase 6 — Invoice Generation \+ Payment Status**

## **Goal**

Generate invoices from Job Orders without re-encoding.

## **Modules**

Invoices  
Job-to-Invoice Generation  
Payment Status  
Invoice Snapshot

## **Pages**

/invoices  
/invoices/{id}

## **Dependencies**

Job Orders  
Job Snapshot

## **Build Notes**

Invoices must be generated from Job Orders.

Manual invoice creation is out of scope.

Invoice amounts must be snapshots.

Payment status is limited to:

Issued  
Paid

until partial payments are approved.

## **Acceptance Goal**

Staff can generate an invoice from a Job Order and mark the invoice as paid.

---

# **Phase 7 — Reports**

## **Goal**

Provide operational reporting from recorded data.

## **Modules**

Quote History Report  
Job Profitability Report  
Invoice Report

## **Pages**

/reports

## **Dependencies**

Quotations  
Job Orders  
Expenses  
Invoices

## **Build Notes**

Reports must be read-only.

Reports must derive from source records.

Do not build a custom report builder.

## **Acceptance Goal**

Users can view quote history, invoice history, and project profitability from system data.

---

# **Phase 8 — Audit Logs \+ Production Hardening**

## **Goal**

Add production safety and traceability.

## **Modules**

Audit Logs  
Permission Enforcement  
Validation Hardening  
Error States  
Locked States  
Backup Readiness

## **Pages**

/settings/audit-logs

Admin only.

## **Dependencies**

All prior phases.

## **Build Notes**

Audit logs should track critical actions:

Quote Created  
Quote Updated  
Quote Sent  
Quote Approved  
Quote Rejected  
Job Created  
Expense Added  
Invoice Generated  
Invoice Marked Paid  
User Updated

## **Acceptance Goal**

The system is production-safe, permission-controlled, auditable, and resistant to accidental data corruption.

---

# **Final Build Sequence Summary**

1\. Auth \+ Users \+ Customers  
2\. Quotes \+ Line Items \+ Calculator  
3\. Quote Status Workflow  
4\. Job Orders  
5\. Expenses \+ Profitability  
6\. Invoices \+ Payments  
7\. Reports  
8\. Audit \+ Hardening

---

# **Build Completion Definition**

The build is complete when:

A staff user can create a quote  
→ calculate pricing  
→ send/approve quote  
→ convert it to a job  
→ record expenses  
→ generate invoice  
→ mark paid  
→ view profitability

without retyping quotation details into the invoice and without manually calculating project profit.

