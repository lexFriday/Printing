# PRD

# **Mitzy Sy Printing System**

## **Production PRD v1.0**

---

# **1\. Project Overview**

## **Project Name**

Mitzy Sy Printing Operations System

## **Purpose**

Build a lightweight web application that eliminates manual re-encoding between quotation and invoice while providing project profitability visibility.

The system will automate the core workflow:

Customer Inquiry  
→ Quotation  
→ Job Order  
→ Expense Tracking  
→ Invoice  
→ Payment  
→ Profitability

The client currently uses Excel calculators for pricing and QuickBooks for accounting.

This system is not intended to replace QuickBooks.

Its purpose is to streamline quotation, invoicing, and project monitoring operations.

---

# **2\. Business Problem**

Current process:

1. Staff receives customer inquiry.  
2. Staff computes pricing using Excel calculator.  
3. Staff manually creates quotation.  
4. Customer approves quotation.  
5. Staff manually creates job order.  
6. Project is completed.  
7. Staff manually recreates invoice.  
8. Errors occur during copy-paste and re-encoding.  
9. Project expenses are tracked separately.  
10. Profitability is difficult to determine.

### **Desired Outcome**

* Generate quotations directly from calculator inputs  
* Convert quotations into job orders  
* Convert job orders into invoices  
* Eliminate duplicate encoding  
* Track project expenses  
* View project profitability

---

# **3\. Users & Roles**

## **Admin**

Permissions:

* Manage users  
* Manage pricing defaults  
* View all records  
* Generate reports  
* Edit system settings

---

## **Staff**

Permissions:

* Create quotations  
* Send quotations  
* Create job orders  
* Record expenses  
* Generate invoices  
* Mark invoices paid

---

## **Viewer (Optional)**

Permissions:

* View quotations  
* View invoices  
* View reports

No create or edit access.

---

# **4\. Core Workflow**

---

## **Workflow 1 — Create Quotation**

### **Step 1**

Create customer record or select existing customer.

Required fields:

* Customer Name  
* Contact Person  
* Contact Number  
* Email (optional)

---

### **Step 2**

Create quotation.

Fields:

* Quote Number (auto-generated)  
* Quote Date  
* Customer  
* Project Name  
* Remarks

Status:

Draft

---

### **Step 3**

Add quotation line items.

Each line item supports:

### **Pricing Mode**

Option A

#### **Square Foot Pricing**

Used for custom-size printing.

Inputs:

* Description  
* Unit of Measure  
* Width  
* Height  
* Quantity  
* Rate Per Sq Ft

Supported Units:

Inches  
Feet  
Millimeters  
Centimeters  
Meters

System calculates:

* Total Sq Ft  
* Unit Price  
* Line Total

---

Option B

#### **Fixed Unit Pricing**

Used for standard products.

Example:

A4 Detailer  
Menu Board

Inputs:

* Description  
* Quantity  
* Unit Price

System calculates:

* Line Total

---

### **Quote Totals**

System automatically computes:

* Subtotal  
* Discount (future)  
* Grand Total

No manual total editing allowed.

---

### **Step 4**

Send quotation.

Status changes:

Draft → Sent

---

### **Step 5**

Customer decision.

Status becomes:

Approved  
Rejected

---

# **Workflow 2 — Convert Quote to Job Order**

When quotation is approved:

User clicks:

Convert to Job Order

System automatically creates Job Order.

No re-encoding.

---

## **Job Order Fields**

Inherited from quotation:

* Customer  
* Project  
* Line Items  
* Pricing  
* Total Amount

Additional fields:

* Target Completion Date  
* Internal Notes

Status:

Open  
Completed

---

# **Workflow 3 — Expense Tracking**

Expenses are recorded inside Job Orders.

No separate expense module.

---

## **Add Expense**

Fields:

* Expense Date  
* Expense Type  
* Description  
* Amount

Expense Types:

Materials  
Labor  
Delivery  
Outsourcing  
Miscellaneous

---

## **Expense Summary**

System automatically computes:

Total Expenses

for each Job Order.

---

# **Workflow 4 — Generate Invoice**

When project is ready for billing:

User clicks:

Generate Invoice

System creates invoice from Job Order.

No manual recreation.

No copy-paste.

No retyping.

---

## **Invoice Fields**

Inherited automatically:

* Customer  
* Project  
* Line Items  
* Quantities  
* Prices  
* Totals

Additional fields:

* Invoice Number  
* Invoice Date  
* Due Date

Status:

Issued  
Paid

---

# **Workflow 5 — Payment Recording**

User can mark invoice as paid.

Action:

Mark Paid

Status:

Issued → Paid

Record:

* Payment Date  
* Remarks

---

# **Workflow 6 — Project Profitability**

Each Job Order contains profitability information.

---

## **Revenue**

Source:

Approved Quotation Total

---

## **Expenses**

Source:

Recorded Job Expenses

---

## **Profit**

Formula:

Profit \= Revenue \- Expenses

---

## **Margin %**

Formula:

Margin % \= Profit ÷ Revenue × 100

---

## **Profitability Display**

Show:

* Revenue  
* Total Expenses  
* Profit  
* Margin %

on the Job Order screen.

---

# **5\. Status Definitions**

## **Quotation**

Draft  
Sent  
Approved  
Rejected

---

## **Job Order**

Open  
Completed

---

## **Invoice**

Issued  
Paid

---

# **6\. Reports**

## **Quote History**

Filters:

* Date Range  
* Customer  
* Status

---

## **Job Profitability Report**

Columns:

* Job Number  
* Customer  
* Revenue  
* Expenses  
* Profit  
* Margin %

---

## **Invoice Report**

Columns:

* Invoice Number  
* Customer  
* Amount  
* Status  
* Date

---

# **7\. Dashboard**

The dashboard should be task-focused.

Not analytics-focused.

---

## **Section 1**

Quotes Requiring Action

Show:

* Draft Quotes  
* Sent Quotes

---

## **Section 2**

Active Jobs

Show:

* Open Job Orders

---

## **Section 3**

Outstanding Invoices

Show:

* Issued Invoices

---

# **8\. Audit Log**

Track:

* Quotation Created  
* Quotation Updated  
* Quotation Sent  
* Quotation Approved  
* Quotation Rejected  
* Job Order Created  
* Expense Added  
* Invoice Generated  
* Invoice Marked Paid

Store:

* User  
* Date  
* Action  
* Record

---

# **9\. Business Rules**

## **Rule 1**

Quotation line items are the pricing source of truth.

All calculations must derive from quotation line items.

---

## **Rule 2**

Invoices must be generated from approved quotations or job orders.

Invoices cannot be manually recreated.

---

## **Rule 3**

System-generated totals cannot be manually edited.

---

## **Rule 4**

Project profitability must derive from:

Revenue \- Expenses

No manual profit entry.

---

## **Rule 5**

Historical invoices must retain their original values even if pricing changes later.

Job Orders and Invoices must store pricing snapshots.

---

# **10\. Future Enhancements (Out of Scope)**

The following are intentionally excluded from Version 1:

* Inventory Management  
* CRM Pipeline  
* Accounting System  
* QuickBooks Replacement  
* Purchasing Module  
* Workflow Builder  
* Approval Engine  
* Advanced Collections  
* Custom Report Builder  
* Production Scheduling  
* Supplier Management

These may be considered in future phases after successful adoption of the core workflow.

---

# **Success Criteria**

The project is considered successful if:

1. Staff can create quotations without using Excel outside the system.  
2. Approved quotations convert into job orders without re-encoding.  
3. Job orders convert into invoices without re-encoding.  
4. Invoice creation errors are eliminated.  
5. Project expenses can be recorded.  
6. Profitability can be viewed per project.  
7. Staff can complete the entire workflow within a single system.

# Data Model

## **11\. Data Model**

### **Purpose**

The data model defines the source of truth records used throughout the system.

The goal is to ensure:

* No duplicate encoding  
* No duplicate pricing logic  
* Consistent quotation, job order, and invoice values  
* Reliable project profitability reporting  
* Historical record integrity

---

## **11.1 Core Data Relationships**

Customer  
   │  
   ▼  
Quotation  
   │  
   ▼  
Quote Line Items  
   │  
   ▼  
Job Order  
   │  
   ├── Job Expenses  
   │  
   ▼  
Invoice

### **Source of Truth Rule**

Quote Line Items are the pricing source of truth.

All quotation totals must be derived from Quote Line Items.

Job Orders and Invoices must store pricing snapshots to preserve historical values.

---

# **11.2 Users**

### **Purpose**

System authentication and permissions.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| name | String | Yes |
| email | String | Yes |
| password\_hash | String | Yes |
| role | Enum | Yes |
| status | Enum | Yes |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

### **Role Values**

admin  
staff  
viewer

### **Status Values**

active  
inactive  
---

# **11.3 Customers**

### **Purpose**

Master customer records.

A customer may have multiple quotations, job orders, and invoices.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| customer\_code | String | Auto |
| customer\_name | String | Yes |
| contact\_person | String | Yes |
| contact\_number | String | Yes |
| email | String | No |
| address | Text | No |
| notes | Text | No |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

---

# **11.4 Quotations**

### **Purpose**

Stores quotation header information.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| quote\_number | String | Auto |
| customer\_id | UUID | Yes |
| project\_name | String | Yes |
| quote\_date | Date | Yes |
| remarks | Text | No |
| subtotal | Decimal | System |
| total\_amount | Decimal | System |
| status | Enum | Yes |
| sent\_at | Timestamp | No |
| approved\_at | Timestamp | No |
| rejected\_at | Timestamp | No |
| created\_by | UUID | Yes |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

### **Status Values**

draft  
sent  
approved  
rejected  
---

# **11.5 Quote Line Items**

### **Purpose**

Stores quotation pricing details.

This is the most important table in the system.

All pricing calculations originate here.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| quotation\_id | UUID | Yes |
| description | String | Yes |
| pricing\_mode | Enum | Yes |
| unit\_of\_measure | Enum | Conditional |
| width | Decimal | Conditional |
| height | Decimal | Conditional |
| quantity | Decimal | Yes |
| rate\_per\_sqft | Decimal | Conditional |
| computed\_sqft | Decimal | System |
| unit\_price | Decimal | Yes |
| line\_total | Decimal | System |
| sort\_order | Integer | No |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

---

### **Pricing Modes**

sqft  
fixed  
---

### **Unit of Measure Values**

inches  
feet  
millimeters  
centimeters  
meters  
---

### **Square Foot Pricing Example**

Description: Tarpaulin

Pricing Mode: sqft

Width: 8  
Height: 4

Rate Per Sq Ft: 180

Quantity: 1

System calculates:

Computed Sq Ft  
Unit Price  
Line Total  
---

### **Fixed Pricing Example**

Description: A4 Detailer

Pricing Mode: fixed

Quantity: 12

Unit Price: 50

System calculates:

Line Total \= Qty × Unit Price  
---

# **11.6 Job Orders**

### **Purpose**

Represents approved quotations that are currently being worked on.

Job Orders store quotation snapshots.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| job\_number | String | Auto |
| quotation\_id | UUID | Yes |
| customer\_id | UUID | Yes |
| project\_name | String | Yes |
| quoted\_amount | Decimal | Snapshot |
| target\_completion\_date | Date | No |
| internal\_notes | Text | No |
| status | Enum | Yes |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

### **Status Values**

open  
completed  
---

### **Snapshot Rule**

When a Job Order is created:

Quoted Amount  
Project Name  
Customer  
Pricing

must be copied from the approved quotation.

Future quote changes must not affect historical Job Orders.

---

# **11.7 Job Expenses**

### **Purpose**

Tracks expenses associated with a Job Order.

Used for project profitability reporting.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| job\_order\_id | UUID | Yes |
| expense\_date | Date | Yes |
| expense\_type | Enum | Yes |
| description | Text | Yes |
| amount | Decimal | Yes |
| created\_by | UUID | Yes |
| created\_at | Timestamp | Yes |

---

### **Expense Types**

materials  
labor  
delivery  
outsourcing  
miscellaneous  
---

### **Profitability Calculation**

Total Expenses  
\=  
Sum(Job Expenses)  
---

# **11.8 Invoices**

### **Purpose**

Stores customer billing records.

Invoices are generated from Job Orders.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| invoice\_number | String | Auto |
| job\_order\_id | UUID | Yes |
| customer\_id | UUID | Yes |
| invoice\_date | Date | Yes |
| due\_date | Date | No |
| invoice\_amount | Decimal | Snapshot |
| status | Enum | Yes |
| paid\_at | Timestamp | No |
| payment\_remarks | Text | No |
| created\_at | Timestamp | Yes |
| updated\_at | Timestamp | Yes |

---

### **Status Values**

issued  
paid  
---

### **Snapshot Rule**

When an invoice is generated:

Customer  
Project  
Line Items  
Invoice Amount

must be copied from the Job Order.

Future Job Order changes must not affect historical invoices.

---

# **11.9 Audit Logs**

### **Purpose**

Tracks important system actions for accountability and troubleshooting.

### **Fields**

| Field | Type | Required |
| ----- | ----- | ----- |
| id | UUID | Yes |
| user\_id | UUID | Yes |
| action | String | Yes |
| entity\_type | String | Yes |
| entity\_id | UUID | Yes |
| old\_values | JSON | No |
| new\_values | JSON | No |
| created\_at | Timestamp | Yes |

---

### **Audit Events**

Track:

Quotation Created  
Quotation Updated  
Quotation Sent  
Quotation Approved  
Quotation Rejected

Job Order Created  
Job Order Completed

Expense Added  
Expense Updated

Invoice Generated  
Invoice Marked Paid

User Created  
User Updated  
---

# **11.10 Derived System Calculations**

The following values must never be manually entered.

---

### **Quote Line Total**

Line Total  
\=  
Quantity × Unit Price  
---

### **Square Foot Calculation**

Computed Sq Ft  
\=  
Converted Width (ft)  
×  
Converted Height (ft)  
---

### **Square Foot Unit Price**

Unit Price  
\=  
Computed Sq Ft × Rate Per Sq Ft  
---

### **Quote Total**

Quote Total  
\=  
Sum(All Line Totals)  
---

### **Total Expenses**

Total Expenses  
\=  
Sum(Job Expenses)  
---

### **Project Profit**

Profit  
\=  
Revenue \- Expenses  
---

### **Project Margin %**

Margin %  
\=  
(Profit ÷ Revenue) × 100  
---

# **11.11 Data Integrity Rules**

### **Rule 1**

Quotation totals cannot be manually edited.

They must derive from Quote Line Items.

---

### **Rule 2**

Invoices must be generated from Job Orders.

Manual invoice creation is not allowed.

---

### **Rule 3**

Job Orders store pricing snapshots.

Future quotation changes must not alter Job Orders.

---

### **Rule 4**

Invoices store billing snapshots.

Future Job Order changes must not alter invoices.

---

### **Rule 5**

Profitability must derive from:

Revenue  
\-  
Expenses

Manual profit entry is prohibited.

---

### **Rule 6**

All critical actions must generate audit log entries.

This ensures accountability and historical traceability.

# Screen-by-Screen UX Requirements

# **12\. Screen-by-Screen UX Requirements**

## **Purpose**

The system should be designed around the operational workflow.

Users should always know:

* Where they are  
* What they need to do  
* What happens next

The interface should prioritize task completion over analytics.

The system should avoid unnecessary dashboards, excessive filters, or complex navigation.

---

# **12.1 Dashboard**

## **Purpose**

Provide a task-oriented landing page showing work requiring attention.

The dashboard should not function as a management analytics page.

---

## **Sections**

### **Quotes Requiring Action**

Display:

* Draft Quotes  
* Sent Quotes

Columns:

Quote Number  
Customer  
Project  
Amount  
Status  
Date

Primary Action:

View Quote  
---

### **Active Jobs**

Display:

* Open Job Orders

Columns:

Job Number  
Customer  
Project  
Quoted Amount  
Status

Primary Action:

View Job  
---

### **Outstanding Invoices**

Display:

* Issued Invoices

Columns:

Invoice Number  
Customer  
Amount  
Date  
Status

Primary Action:

View Invoice  
---

## **Dashboard Actions**

Primary:

New Quote

Secondary:

View Job  
View Invoice  
---

## **Empty State**

If no records exist:

Display:

No active work found.

Create a quotation to begin a new project.

Show button:

Create Quote  
---

# **12.2 Quotes List Screen**

## **Purpose**

View and manage quotations.

---

## **Table Columns**

Quote Number  
Customer  
Project  
Quote Date  
Amount  
Status  
---

## **Filters**

Date Range  
Customer  
Status  
---

## **Actions**

Per Row:

View  
Edit  
Send  
Convert

Actions displayed depend on quote status.

---

## **Primary Action**

Create Quote  
---

## **Empty State**

No quotations found.

Create your first quotation.

Button:

Create Quote  
---

# **12.3 Create/Edit Quote Screen**

## **Purpose**

Create pricing and quotation details.

This is the most important screen in the system.

The calculator should be embedded directly inside the quotation workflow.

Users should never leave the quotation screen to perform pricing calculations.

---

## **Section 1 — Quote Information**

Fields:

Quote Number (Auto)  
Quote Date  
Customer  
Project Name  
Remarks

Required:

Customer  
Project Name  
---

## **Section 2 — Line Items**

Button:

Add Line Item  
---

### **Line Item Structure**

Fields:

Description  
Pricing Mode  
Quantity  
---

## **Pricing Mode: Square Foot**

Display:

Unit of Measure  
Width  
Height  
Rate Per Sq Ft

Supported Units:

Inches  
Feet  
Millimeters  
Centimeters  
Meters

System calculates:

Computed Sq Ft  
Unit Price  
Line Total

Read-only:

Computed Sq Ft  
Unit Price  
Line Total  
---

## **Pricing Mode: Fixed Unit**

Display:

Unit Price  
Quantity

System calculates:

Line Total

Read-only:

Line Total  
---

## **Totals Section**

Display:

Subtotal  
Grand Total

Read-only.

No manual editing allowed.

---

## **Actions**

Primary:

Save Quote

Secondary:

Send Quote  
---

## **Validation Rules**

Required:

Customer  
Project Name  
Description  
Quantity

For Square Foot Pricing:

Width  
Height  
Rate Per Sq Ft

must be provided.

---

# **12.4 Quote Details Screen**

## **Purpose**

Review quotation and perform status actions.

---

## **Display**

Quote Information:

Customer  
Project  
Date  
Status

Line Items:

Description  
Qty  
Price  
Amount

Totals:

Subtotal  
Grand Total  
---

## **Available Actions**

### **Draft**

Edit  
Send Quote  
---

### **Sent**

Approve  
Reject  
---

### **Approved**

Convert To Job Order  
---

### **Rejected**

View only.

---

## **Success Message**

Quotation successfully updated.  
---

# **12.5 Job Orders List Screen**

## **Purpose**

Track active work.

---

## **Columns**

Job Number  
Customer  
Project  
Quoted Amount  
Status  
---

## **Filters**

Date Range  
Customer  
Status  
---

## **Primary Action**

View Job  
---

## **Empty State**

No active jobs found.  
---

# **12.6 Job Order Details Screen**

## **Purpose**

Manage project execution and profitability.

---

## **Section 1 — Job Summary**

Display:

Job Number  
Customer  
Project  
Quoted Amount  
Status  
---

## **Section 2 — Expenses**

Display:

Expense Date  
Expense Type  
Description  
Amount

Button:

Add Expense  
---

## **Add Expense Modal**

Fields:

Expense Date  
Expense Type  
Description  
Amount

Expense Types:

Materials  
Labor  
Delivery  
Outsourcing  
Miscellaneous  
---

## **Section 3 — Profitability**

Display:

Revenue  
Expenses  
Profit  
Margin %

Read-only.

System generated.

---

## **Actions**

Primary:

Add Expense

Secondary:

Complete Job  
Generate Invoice  
---

## **Validation**

Amount must be greater than zero.

Expense Type required.

Description required.

---

# **12.7 Invoice List Screen**

## **Purpose**

Track issued and paid invoices.

---

## **Columns**

Invoice Number  
Customer  
Amount  
Invoice Date  
Status  
---

## **Filters**

Date Range  
Customer  
Status  
---

## **Actions**

View Invoice  
---

## **Empty State**

No invoices found.  
---

# **12.8 Invoice Details Screen**

## **Purpose**

Review invoice and record payment.

---

## **Display**

Invoice Number  
Customer  
Project  
Invoice Date  
Due Date  
Status  
Amount  
---

## **Invoice Line Items**

Display inherited quotation items.

Read-only.

---

## **Actions**

Primary:

Mark Paid  
---

## **Mark Paid Modal**

Fields:

Payment Date  
Remarks  
---

## **Success Message**

Invoice marked as paid.  
---

## **Restrictions**

Users cannot edit:

Invoice Amount  
Line Items  
Totals

after invoice generation.

---

# **12.9 Reports Screen**

## **Purpose**

Provide operational visibility.

Reports must be generated from recorded system data.

No manual report entries.

---

## **Tab 1 — Project Profitability**

Columns:

Job Number  
Customer  
Revenue  
Expenses  
Profit  
Margin %

Filters:

Date Range  
Customer  
---

## **Tab 2 — Quote History**

Columns:

Quote Number  
Customer  
Amount  
Status  
Date

Filters:

Date Range  
Customer  
Status  
---

## **Tab 3 — Invoice Report**

Columns:

Invoice Number  
Customer  
Amount  
Status  
Date

Filters:

Date Range  
Customer  
Status  
---

# **12.10 System States**

Every screen must support:

## **Loading State**

Display loading indicators while data is retrieved.

---

## **Empty State**

Explain why data is not visible and what action the user can take next.

---

## **Validation State**

Display inline field-level validation messages.

---

## **Success State**

Display confirmation after successful actions.

Examples:

Quote saved successfully.  
Expense added successfully.  
Invoice generated successfully.  
---

## **Error State**

Display clear and actionable messages.

Example:

Unable to generate invoice.

Please contact your administrator.  
---

## **Permission State**

Users without permission should see:

You do not have permission to perform this action.  
---

## **Final UX Principle**

Every screen should have one obvious primary action.

Examples:

Quotes → Save Quote  
Job Orders → Add Expense  
Invoices → Mark Paid

# Validation Rules & Business Constraints

# **13\. Validation Rules & Business Constraints**

## **Purpose**

Validation rules ensure data integrity and prevent invalid records from entering the system.

These rules must be enforced both in the user interface and backend.

---

# **13.1 Customer Validation**

## **Required Fields**

The following fields are mandatory:

Customer Name  
Contact Person  
Contact Number  
---

## **Rules**

Customer Name must not be blank.

Contact Person must not be blank.

Contact Number must not be blank.

Duplicate customer records should be discouraged through search suggestions.

---

# **13.2 Quotation Validation**

## **Required Fields**

Customer  
Project Name  
At Least One Line Item  
---

## **Rules**

Quotation cannot be saved without a customer.

Quotation cannot be saved without a project name.

Quotation must contain at least one line item.

Quote Total must be greater than zero.

---

## **Status Restrictions**

Draft quotations may be edited.

Sent quotations may not be edited unless returned to Draft.

Approved quotations become read-only.

Rejected quotations become read-only.

---

# **13.3 Quote Line Item Validation**

## **Common Rules**

Description required.

Quantity must be greater than zero.

Unit Price must be greater than or equal to zero.

Line Total is system-generated.

---

## **Square Foot Pricing Validation**

Required:

Width  
Height  
Rate Per Sq Ft  
Unit of Measure

Width must be greater than zero.

Height must be greater than zero.

Rate Per Sq Ft must be greater than zero.

Computed Sq Ft must be system-generated.

---

## **Fixed Pricing Validation**

Required:

Quantity  
Unit Price

Quantity must be greater than zero.

Unit Price must be greater than or equal to zero.

---

# **13.4 Job Order Validation**

Job Orders may only be created from Approved Quotations.

Manual Job Order creation is not allowed.

Every Job Order must reference one Quotation.

---

# **13.5 Expense Validation**

Required:

Expense Date  
Expense Type  
Description  
Amount

Amount must be greater than zero.

Expense Type must be selected from the approved list.

Future dates are not allowed.

---

# **13.6 Invoice Validation**

Invoices may only be generated from Job Orders.

Manual invoice creation is not allowed.

Invoice Amount must equal the generated Job Order billing amount.

Invoice totals are read-only.

---

# **13.7 Payment Validation**

Payment Date required.

Invoices already marked Paid cannot be marked Paid again.

Only users with appropriate permissions may record payments.

---

# **13.8 Audit Validation**

The following actions must always create audit records:

Quotation Created  
Quotation Updated  
Quotation Sent  
Quotation Approved  
Quotation Rejected

Job Order Created  
Job Order Completed

Expense Added  
Expense Updated  
Expense Deleted

Invoice Generated  
Invoice Marked Paid

User Created  
User Updated  
---

# **13.9 Historical Record Protection**

Approved Quotations may not be edited.

Generated Invoices may not be edited.

Historical values must remain unchanged even if future pricing changes occur.

Job Orders and Invoices must store snapshots.

---

# **14\. Open Questions & Business Decisions**

## **Purpose**

Items requiring client confirmation before development begins.

---

# **Question 1 — Discounts**

Can quotations contain discounts?

Options:

No Discounts  
Fixed Amount Discount  
Percentage Discount

Impact:

Affects quote calculations.

---

# **Question 2 — VAT / Tax Handling**

Will quotations and invoices require VAT calculations?

Options:

VAT Exclusive  
VAT Inclusive  
No VAT

Impact:

Changes pricing calculations and invoice display.

---

# **Question 3 — Invoice Structure**

Can one Job Order generate multiple invoices?

Examples:

Deposit Invoice  
Progress Billing  
Final Billing

or

One Job Order \= One Invoice

Impact:

Major database and workflow impact.

---

# **Question 4 — Customer Approval Recording**

Should approval be recorded inside the system?

Options:

Manual Status Update  
Approval Date  
Approval Attachment

Impact:

Changes approval workflow.

---

# **Question 5 — File Attachments**

Should users be able to upload:

Artwork Files  
Reference Images  
Signed Quotations  
Purchase Orders

Impact:

Adds document storage requirements.

---

# **Question 6 — QuickBooks Integration**

Version 1 Assumption:

No Integration

Invoices are managed independently.

Future integration may be considered.

---

# **15\. Acceptance Criteria**

## **Purpose**

Defines the measurable conditions for project completion.

The system is considered complete when all criteria below are met.

---

# **15.1 Quotation Management**

Users can create quotations.

Users can edit Draft quotations.

Users can send quotations.

Users can approve or reject quotations.

Quotation totals are automatically calculated.

No manual total editing is allowed.

---

# **15.2 Pricing Calculator**

Users can create Square Foot Pricing items.

Users can create Fixed Pricing items.

System automatically calculates:

Sq Ft  
Unit Price  
Line Total  
Quote Total

System supports:

Inches  
Feet  
Millimeters  
Centimeters  
Meters  
---

# **15.3 Job Orders**

Approved quotations can be converted into Job Orders.

No re-encoding is required.

Job Orders inherit quotation data.

Job Orders store quotation snapshots.

---

# **15.4 Expense Tracking**

Users can add project expenses.

Expenses appear immediately in profitability calculations.

Total Expenses are automatically computed.

---

# **15.5 Invoice Management**

Users can generate invoices from Job Orders.

No re-encoding is required.

Invoices inherit pricing information.

Invoices store billing snapshots.

---

# **15.6 Payment Recording**

Users can mark invoices as Paid.

Payment dates are recorded.

Invoice status updates automatically.

---

# **15.7 Profitability Tracking**

System automatically computes:

Revenue  
Expenses  
Profit  
Margin %

No manual profit calculations required.

---

# **15.8 Reporting**

Users can generate:

Quote History Report  
Job Profitability Report  
Invoice Report

Reports use recorded system data only.

---

# **15.9 Security & Permissions**

Role permissions function correctly.

Unauthorized users cannot perform restricted actions.

All critical actions generate audit logs.

---

# **15.10 Success Metrics**

The project is considered successful when:

* Staff no longer recreate invoices manually.  
* Quote-to-Invoice conversion requires no re-encoding.  
* Project profitability is visible per Job Order.  
* Pricing calculations are automated.  
* Historical records remain accurate.  
* Users can complete the full workflow inside the system.  
* Invoice copy-paste errors are eliminated.

# Non-Functional Requirements (NFRs)

# **16\. Non-Functional Requirements (NFRs)**

Most junior PRDs skip this.

Most production issues happen because this section is missing.

Functional requirements tell developers **what** to build.

Non-functional requirements tell developers **how the system must behave in production**.

---

# **16\. Non-Functional Requirements**

## **Purpose**

Define system-wide requirements for performance, reliability, security, usability, maintainability, and operational safety.

These requirements apply to all modules and workflows.

---

# **16.1 Performance Requirements**

## **Page Load Time**

The system should load standard pages within:

\< 3 seconds

under normal operating conditions.

---

## **Search Performance**

The following searches should return results within:

\< 2 seconds

* Customer Search  
* Quotation Search  
* Job Order Search  
* Invoice Search

---

## **Report Generation**

Standard reports should generate within:

\< 5 seconds

for normal data volumes.

---

## **Concurrent Users**

The system should support:

10–20 concurrent users

without noticeable performance degradation.

This is sufficient for Version 1 operations.

---

# **16.2 Availability Requirements**

The system should be available during business hours.

Target uptime:

99%

excluding planned maintenance.

---

## **Error Recovery**

Unexpected system failures should not result in data corruption.

Users should be able to resume work after reconnecting.

---

# **16.3 Security Requirements**

## **Authentication**

Users must log in before accessing the system.

---

## **Password Storage**

Passwords must never be stored in plain text.

Passwords must be stored using secure password hashing.

---

## **Authorization**

Role-based access control must be enforced.

Users may only perform actions permitted by their assigned role.

---

## **Session Security**

Users should be automatically logged out after prolonged inactivity.

Recommended:

60 minutes

of inactivity.

---

# **16.4 Data Integrity Requirements**

## **Single Source of Truth**

Quotation Line Items are the pricing source of truth.

All totals must derive from quotation line items.

---

## **Snapshot Protection**

Job Orders must store quotation snapshots.

Invoices must store billing snapshots.

Historical records must not change when source records are modified later.

---

## **Calculation Protection**

Users cannot manually edit:

Quote Totals  
Invoice Totals  
Profit Calculations  
Margin Calculations

These values must always be system-generated.

---

# **16.5 Audit Requirements**

The system must record:

Create  
Update  
Delete  
Approve  
Reject  
Generate  
Mark Paid

events for all critical records.

---

Audit entries must include:

User  
Timestamp  
Action  
Record Reference  
---

Audit records should not be editable by standard users.

---

# **16.6 Backup & Recovery Requirements**

System data should be backed up regularly.

Recommended:

Daily Backup  
---

Backup retention:

30 Days Minimum  
---

The system should support restoration from backup in case of:

Server Failure  
Database Corruption  
Accidental Data Loss  
---

# **16.7 Usability Requirements**

## **Workflow Simplicity**

Users should be able to complete:

Create Quote  
Convert Job  
Generate Invoice  
Record Payment

without requiring formal training.

---

## **Navigation**

The application should prioritize workflow completion.

Navigation should remain limited to:

Dashboard  
Quotes  
Jobs  
Invoices  
Reports  
Settings  
---

## **Primary Actions**

Every screen should contain one obvious primary action.

Examples:

Quote Screen → Save Quote  
Job Screen → Add Expense  
Invoice Screen → Mark Paid  
---

# **16.8 Browser Support**

Version 1 should support:

Google Chrome  
Microsoft Edge  
Safari

latest stable versions.

---

## **Responsive Support**

System should be usable on:

Desktop  
Tablet

Mobile support is optional for Version 1\.

---

# **16.9 Maintainability Requirements**

## **Configurable Values**

The following should be configurable without code changes:

User Roles  
Expense Types  
Default Settings  
---

## **Hardcoded Logic**

The following should remain hardcoded in Version 1:

Workflow Structure  
Status Definitions  
Core Navigation

to reduce complexity.

---

# **16.10 Scalability Requirements**

Version 1 should support:

Thousands of Customers  
Thousands of Quotations  
Thousands of Invoices

without requiring architectural redesign.

---

Future enhancements such as:

Inventory  
QuickBooks Integration  
Production Scheduling  
CRM

should be able to be added without rewriting the core Quote → Job → Invoice workflow.

---

# **16.11 Production Readiness Checklist**

The system is considered production-ready only when:

### **Functional**

* Quotations can be created  
* Job Orders can be generated  
* Invoices can be generated  
* Payments can be recorded  
* Profitability can be calculated

### **Data Integrity**

* No duplicate pricing logic  
* No manual total editing  
* Historical records preserved

### **Security**

* Login required  
* Role permissions enforced  
* Audit logs active

### **Operations**

* Backups configured  
* Error handling implemented  
* Reports functioning

### **User Experience**

* Workflow is task-oriented  
* No duplicate encoding required  
* Users can complete the workflow without external spreadsheets

---

# UX PRINCIPLES

# **17\. UX Design Principles & Workflow Guidance**

Because the transcript reveals something important:

The client is **not a software company**.

They're a printing company with staff that currently do:

Calculator  
→ Quote  
→ Job  
→ Invoice

using Excel, documents, and manual processes.

The biggest risk is not technical.

The biggest risk is building a system that forces staff to think differently than they do today.

---

# **17\. UX Design Principles & Workflow Guidance**

## **Purpose**

Define the UX philosophy that should guide all screens, workflows, and implementation decisions.

The objective is not to build the most feature-rich system.

The objective is to make quotation creation, invoicing, and project tracking faster, easier, and less error-prone than the client's current spreadsheet process.

All UX decisions should support the client's existing workflow rather than forcing users to learn a new operational model.

---

# **17.1 Core UX Principle**

## **The System Should Feel Like An Improved Version Of Their Existing Workflow**

Current workflow:

Customer Inquiry  
→ Calculator  
→ Quote  
→ Job  
→ Invoice

The system should preserve this mental model.

Users should immediately understand where they are in the process.

The system should never require users to understand:

Database Structure  
Relationships  
Backend Logic  
Internal Status Rules

Users should only see:

Customer  
Quote  
Job  
Invoice

because that is how they already think about their work.

---

# **17.2 Workflow-First Design**

Every screen should answer:

### **Where am I?**

Example:

Quote \#Q-2025-001  
---

### **What is this screen for?**

Example:

Create Pricing

or

Track Project Expenses  
---

### **What should I do next?**

Every screen must have one obvious next action.

---

# **17.3 Calculator Must Be Invisible**

## **Critical UX Principle**

The client repeatedly described the calculator as part of quotation creation.

They did not describe it as a separate workflow.

Therefore:

Do NOT build:

Calculator Screen  
---

Instead:

Embed the calculator inside quotation line items.

Bad UX:

Open Calculator  
Calculate  
Copy Result  
Create Quote  
Paste Result  
---

Good UX:

Create Quote  
↓  
Add Item  
↓  
Enter Dimensions  
↓  
System Calculates

One flow.

No copying.

No switching screens.

---

# **17.4 Quotes Should Be The Center Of The System**

The most frequent action in the business is creating quotations.

Therefore:

The fastest action in the system should be:

Create Quote  
---

Dashboard should emphasize:

New Quote

not reports.

---

Navigation should prioritize:

Quotes

before everything else.

---

# **17.5 Remove Unnecessary Decisions**

Users should not have to decide:

Which Calculator To Use  
Which Workflow To Start  
Which Status To Pick  
Which Report To Open

The system should determine these automatically whenever possible.

---

Example:

Bad:

Select Workflow:  
\- Standard  
\- Estimate  
\- Project  
\- Print  
---

Good:

Create Quote

The workflow unfolds naturally afterward.

---

# **17.6 Progressive Disclosure**

Users should only see information relevant to the current task.

---

### **Creating A Quote**

Show:

Customer  
Project  
Items  
Price

Do not show:

Expenses  
Profit  
Invoice  
Audit Logs  
---

### **Working On A Job**

Show:

Project  
Expenses  
Profitability

Do not show:

Quote Editing  
---

### **Viewing Invoice**

Show:

Invoice  
Payment Status

Do not show:

Calculator Fields  
---

# **17.7 Prevent Re-Encoding Everywhere**

This was one of the client's strongest pain points.

Therefore:

The UI should aggressively reuse information.

---

Quote Screen:

Customer  
Items  
Pricing  
---

Generate Job Order:

One Click

No re-entry.

---

Generate Invoice:

One Click

No re-entry.

---

The user should never type the same information twice.

---

# **17.8 Project Profitability Should Be Effortless**

The client said:

"We want to know if we made money on the project."

This means profitability is a result.

Not a workflow.

---

Bad UX:

Profitability Module  
Costing Module  
Analysis Module  
---

Good UX:

Inside Job Order:

Revenue  
Expenses  
Profit  
Margin

Automatically visible.

---

# **17.9 Dashboards Should Show Work, Not Analytics**

The client is running operations.

Not a finance department.

Not an executive analytics team.

---

Default Dashboard:

### **Quotes Requiring Action**

Draft  
Sent  
---

### **Jobs In Progress**

Open Jobs  
---

### **Unpaid Invoices**

Issued Invoices  
---

Avoid:

Pie Charts  
Graphs  
Revenue Trends  
Forecasts  
KPIs Everywhere

Those can be future enhancements.

---

# **17.10 Statuses Must Reflect Real Business States**

The client already understands:

Draft Quote  
Approved Quote  
Job  
Invoice  
Paid

Use those.

---

Avoid:

Pending Review  
Processing  
Awaiting Conversion  
Ready For Billing  
Finalized  
Archived

These create confusion.

---

# **17.11 Every Screen Needs One Primary Action**

Quote Screen:

Save Quote  
---

Quote Details:

Send Quote

or

Convert To Job

depending on status.

---

Job Screen:

Add Expense  
---

Invoice Screen:

Mark Paid  
---

Users should never see 5 equally important buttons.

---

# **17.12 Minimize Training Requirements**

A new staff member should be able to understand:

Create Quote  
Convert To Job  
Add Expense  
Generate Invoice  
Mark Paid

within minutes.

If formal training is required to understand the workflow, the UX is too complex.

---

# **17.13 Success Definition For UX**

The UX is considered successful when:

### **Quotation Creation**

Users can create quotations faster than the current spreadsheet process.

---

### **Invoice Generation**

Users no longer retype quotation information.

---

### **Expense Tracking**

Users can record expenses directly inside the project.

---

### **Profitability**

Users can immediately see:

Revenue  
Expenses  
Profit

without running separate reports.

---

### **Cognitive Load**

Users always know:

Where they are  
What they are doing  
What happens next

without needing instructions.

---

# **Senior UX Conclusion**

Based on the transcript, the client is not asking for software sophistication.

They are asking for:

Less Encoding  
Less Copy-Paste  
Less Errors  
Faster Quoting  
Easy Profit Tracking

Therefore the UX philosophy should be:

Workflow First  
Task First  
Calculator Embedded  
No Duplicate Entry  
No Unnecessary Decisions  
One Clear Next Action

# UI PRINCIPLES

## **18\. User Interface Design Principles & Layout Requirements**

### **Purpose**

This section defines how the user interface should look, feel, and behave based on the client's actual workflow.

The goal is not to build a complex ERP system.

The goal is to create a system that feels like a natural upgrade from the client's current spreadsheet-based process.

The interface should prioritize:

* Speed  
* Simplicity  
* Low cognitive load  
* Minimal training requirements  
* Fast quotation creation  
* Elimination of duplicate encoding

The system should feel familiar to users who currently work with Excel, quotations, and invoices.

---

# **18.1 Primary UX Philosophy**

## **The Quote Is The Center Of The System**

Based on the client interview, quotation creation is the primary business activity.

Users think in terms of:

Customer  
→ Quote  
→ Job  
→ Invoice

The system should be organized around this workflow.

The user should never need to think about:

Modules  
Databases  
Relationships  
Technical Processes

The software should guide them naturally through the workflow.

---

## **Workflow Before Analytics**

The primary purpose of the system is:

Create Quotes  
Generate Invoices  
Track Expenses  
View Profit

The primary purpose is NOT:

Analytics  
Forecasting  
KPIs  
Business Intelligence

Therefore the interface should prioritize work completion over reporting.

---

# **18.2 Visual Design Direction**

## **Overall Style**

The interface should feel like:

Excel  
\+  
QuickBooks  
\+  
Simple CRM

The interface should NOT feel like:

ERP Software  
Accounting Platforms  
Enterprise Back Office Systems  
---

## **Design Characteristics**

Use:

* Clean layouts  
* Large readable tables  
* Clear actions  
* Familiar terminology  
* Minimal navigation  
* Consistent page structure

Avoid:

* Excessive charts  
* Complex dashboards  
* Technical terminology  
* Nested menus  
* Advanced configuration screens

---

# **18.3 Main Navigation**

Navigation should remain intentionally small.

### **Sidebar Navigation**

Dashboard

Quotes  
Jobs  
Invoices

Reports

Settings

No additional modules should be introduced in Version 1\.

---

## **Navigation Principles**

The navigation should reflect how the client runs the business.

Not how the database is structured.

Do not create separate navigation items for:

Calculator  
Expenses  
Customers  
Profitability

These should exist inside the workflow where they are needed.

---

# **18.4 Dashboard Design**

## **Purpose**

Show work requiring attention.

Not business analytics.

---

## **Dashboard Layout**

### **Primary Action Area**

Large button:

\+ New Quote

This should be the most prominent action on the page.

---

### **Section 1 — Quotes Requiring Action**

Display:

Draft Quotes  
Sent Quotes

Columns:

Quote Number  
Customer  
Amount  
Date  
Status  
---

### **Section 2 — Active Jobs**

Display:

Open Jobs

Columns:

Job Number  
Customer  
Project  
Amount  
---

### **Section 3 — Outstanding Invoices**

Display:

Issued Invoices

Columns:

Invoice Number  
Customer  
Amount  
Due Date  
---

## **Dashboard Elements To Avoid**

Do not prioritize:

Revenue Charts  
Pie Charts  
Forecasts  
Advanced KPIs  
Trend Analysis

These can be future enhancements.

---

# **18.5 Quote Creation Screen**

## **Purpose**

Create customer quotations and calculate pricing.

This is the most important screen in the system.

---

## **Design Principle**

The calculator must be embedded inside quotation creation.

The user should never leave the quotation screen to calculate pricing.

---

## **Screen Layout**

### **Header Section**

Fields:

Customer  
Project Name  
Quote Date  
Remarks  
---

### **Main Section — Line Items**

Display line items in spreadsheet format.

Layout:

| Description | Pricing Type | Qty | Width | Height | Unit | Rate | Unit Price | Total |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

This should resemble the client's current Excel workflow.

---

## **Pricing Type**

### **Option A — Square Foot Pricing**

Display:

Width  
Height  
Unit  
Rate Per Sq Ft

Automatically calculate:

Computed Sq Ft  
Unit Price  
Line Total  
---

### **Option B — Fixed Unit Pricing**

Display:

Quantity  
Unit Price

Automatically calculate:

Line Total  
---

## **Live Calculation**

Pricing calculations should occur immediately as values are entered.

Users should never need to press:

Calculate

The system should calculate automatically.

---

## **Quote Summary Panel**

Display:

Subtotal  
Grand Total

Always visible while editing.

Automatically updated.

---

## **Primary Action**

Save Quote  
---

## **Secondary Action**

Send Quote  
---

# **18.6 Quote Details Screen**

## **Purpose**

Review quotation information and move the workflow forward.

---

## **Layout**

### **Summary Section**

Display:

Customer  
Project  
Amount  
Status

Large and easy to read.

---

### **Line Items Section**

Display quotation details.

Read-only unless quotation is Draft.

---

## **Contextual Actions**

### **Draft**

Show:

Edit  
Send Quote  
---

### **Sent**

Show:

Approve  
Reject  
---

### **Approved**

Show:

Convert To Job Order  
---

Only display actions relevant to the current status.

---

# **18.7 Job Order Screen**

## **Purpose**

Manage project execution and profitability.

---

## **Design Principle**

The Job Order screen should focus on one thing:

Did this project make money?  
---

## **Layout**

### **Project Summary Card**

Display:

Customer  
Project  
Quoted Revenue  
Status  
---

### **Expenses Section**

Table:

| Date | Type | Description | Amount |

Button:

\+ Add Expense  
---

### **Profitability Card**

Display:

Revenue

Expenses

Profit

Margin %

Automatically calculated.

Always visible.

---

## **Primary Action**

Add Expense  
---

## **Secondary Actions**

Complete Job  
Generate Invoice  
---

# **18.8 Invoice Screen**

## **Purpose**

Finalize customer billing.

---

## **Design Principle**

The invoice should feel familiar because it originates from the quotation.

The user should immediately recognize the information.

---

## **Layout**

### **Summary Section**

Display:

Invoice Number  
Customer  
Project  
Invoice Date  
Amount  
Status  
---

### **Line Items Section**

Display inherited quotation items.

Read-only.

---

## **Primary Action**

Mark Paid  
---

## **Restrictions**

Users may not edit:

Invoice Totals  
Line Items  
Amounts

after invoice generation.

---

# **18.9 Report Screens**

## **Purpose**

Provide operational visibility.

Reports should remain simple.

---

## **Available Reports**

### **Project Profitability**

Columns:

Job Number  
Customer  
Revenue  
Expenses  
Profit  
Margin %  
---

### **Quote History**

Columns:

Quote Number  
Customer  
Amount  
Status  
Date  
---

### **Invoice Report**

Columns:

Invoice Number  
Customer  
Amount  
Status  
Date  
---

## **Report Philosophy**

Reports should answer operational questions.

They should not become analytics platforms.

---

# **18.10 Empty State Design**

Every screen must guide the user when no records exist.

---

### **Quotes**

No quotations found.

Create your first quotation to begin.

Button:

Create Quote  
---

### **Jobs**

No active jobs found.  
---

### **Invoices**

No invoices found.  
---

# **18.11 Action Hierarchy**

Every screen should have one obvious primary action.

### **Dashboard**

New Quote  
---

### **Quote Screen**

Save Quote  
---

### **Quote Details**

Send Quote

or

Convert To Job Order

depending on status.

---

### **Job Order**

Add Expense  
---

### **Invoice**

Mark Paid  
---

Secondary actions should be visually less prominent.

---

# **18.12 Cognitive Load Requirements**

The interface should minimize user decisions.

Users should never need to decide:

Which workflow to use  
Which calculator to open  
Which module to enter first  
Which status to assign

The system should guide users through the workflow automatically.

---

# **18.13 User Experience Success Criteria**

The user experience is considered successful when:

### **Quotation Creation**

Users can create quotations faster than the current Excel process.

---

### **Invoice Generation**

Users can generate invoices without retyping quotation data.

---

### **Expense Tracking**

Users can record expenses directly from the Job Order.

---

### **Profitability**

Users can immediately see:

Revenue  
Expenses  
Profit  
Margin

without generating reports.

---

### **Learnability**

A new employee should be able to understand:

Create Quote  
Convert To Job  
Add Expense  
Generate Invoice  
Mark Paid

within a few minutes of using the system.

---

## **Final UI Design Principle**

The system should feel like:

An upgraded version of the client's Excel calculator and quotation process.

It should not feel like:

An ERP system  
An accounting platform  
A complex business management suite

The best UI for this client is the one that removes duplicate work, reduces mistakes, and helps staff move from quotation to invoice as quickly as possible.

