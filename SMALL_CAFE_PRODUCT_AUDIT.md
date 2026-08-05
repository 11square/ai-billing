# Small Cafe POS Product Audit

Date: 5 August 2026  
Scope: billing, sales returns, inventory, stock, raw materials, recipes/manufacturing, purchases, purchase returns, vendors, customers, credit/debit, expenses, profit, reporting, users, controls and operational reliability.

## 1. Executive conclusion

The application is a usable early-stage billing and finished-goods stock system. It is not yet an inventory-accounting and manufacturing system.

The biggest structural problem is that quantities and balances are stored as editable totals rather than being derived from auditable transaction ledgers. A small cafe needs to answer:

- Why did this stock quantity change?
- Which purchase supplied this material and at what cost?
- Which production batch consumed it?
- What was the real cost of the item when it was sold?
- Was money received, refunded, written off or adjusted?
- Why does a customer or vendor owe this balance?

The current system cannot reliably answer all of these questions. It has partial support for billing, payments, invoice edits, cancellation, finished-product stock, purchase entry, customer credit and BOQ reporting, but it lacks the underlying ledgers required for accurate inventory and profit.

### Overall readiness

| Module | Current maturity | Assessment |
|---|---:|---|
| POS billing | 65% | Usable for straightforward sales, but server-side controls and returns need work |
| Sales returns/refunds | 30% | Quantity reduction and cancellation exist; proper return documents do not |
| Finished-goods stock | 45% | Quantity is tracked, but movements are not auditable |
| Raw-material stock | 10% | BOQ text exists; no raw-material master or real stock |
| Manufacturing | 10% | Theoretical consumption report only; no production batches |
| Purchase orders | 45% | Purchase entry works, but ordering, receiving, returns and payables are conflated |
| Customer accounts | 35% | Running total exists; no debit/credit ledger or statements |
| Vendor accounts | 15% | Vendor master exists; no payable ledger or payment history |
| Expenses | 5% | No expense model or ledger |
| Profit analysis | 20% | Uses current product cost, not historical/batch cost |
| Reports | 40% | Useful sales summaries, but several totals can include cancelled invoices |
| Security/control | 25% | Authentication exists; permissions are not enforced on business routes |
| Reliability/testing | 15% | Transactions exist in some flows; automated tests and migrations are missing |

## 2. Billing and POS audit

### What exists

- Product/category browsing and search
- Barcode text search
- Quantity-based and weight-based sales
- Cart-level fixed discount
- Cash, UPI, card and credit selections
- Partial cash/credit sale with customer association
- Customer creation during credit checkout
- Invoice and payment creation in one database transaction
- Receipt display and printing
- Custom receipt settings and auto-print option
- Invoice list, date/status filters and invoice detail
- Editing quantities on bakery invoices
- Returning reduced quantities to finished-goods stock
- Recording the refund amount when an edited paid invoice becomes cheaper
- Recording later payments against unpaid/partial invoices
- Cancelling an invoice and restoring finished-goods stock

### Missing basic billing capabilities

#### P0: Financial and stock correctness

1. **Server-authoritative pricing and tax**
   
   The invoice API accepts product name, unit price and GST rate from the browser. It must load the product on the server and calculate from trusted data, with a controlled override permission where necessary.

2. **Stock validation and locking during sale**
   
   New invoices decrement stock without first locking the product and verifying sufficient quantity. Two simultaneous bills can oversell an item or produce negative stock.

3. **Safe invoice numbering**
   
   Invoice numbers use the number of invoices created that day plus one. Concurrent checkouts can generate the same number. Use a database-backed sequence or unique retry mechanism.

4. **Input validation**
   
   Validate non-empty items, valid product IDs, positive quantities, allowed payment methods, non-negative payments, discount limits, payment not exceeding allowed amount, and customer requirement for credit.

5. **Idempotency**
   
   Retrying checkout after a network timeout can create a duplicate invoice. Each checkout needs a client-generated idempotency key.

6. **Cost snapshot per invoice line**
   
   Store `unitCost`, `costTotal`, `grossProfit` and the costing source on every invoice item. Historical profit must not change when today's purchase price changes.

7. **Correct GST handling**
   
   The POS currently submits a zero GST rate for every item even though products have GST fields. Decide whether menu prices are tax-inclusive or tax-exclusive and consistently calculate, display and report the tax.

#### P0: Sales returns and refunds

The current invoice edit is not a complete sales-return system. Add a separate `SalesReturn` and `SalesReturnItem` document.

A proper return requires:

- Return number and original invoice reference
- Full or partial item return
- Quantity and reason per item
- Condition: resellable, damaged, expired or wasted
- Restock destination or wastage posting
- Refund amount and refund method
- Credit-note/customer-ledger posting
- User and manager approval
- Return receipt
- Date/time and audit history

Critical current issue: cancelling a paid invoice restores stock but does not create a negative payment/refund record. This makes cash and payment reports disagree with the real-world refund.

#### P1: Expected POS basics

- Percentage discount as well as fixed discount
- Item-level discount
- Discount reason and manager approval above a limit
- Hold/resume bill
- Add/remove items on an open bill before payment
- Reprint receipt with reprint audit
- Receipt number/return number search
- Scan-to-add barcode workflow
- Sale notes and line-item notes
- Exchange workflow, implemented as return plus new sale
- Multiple payment methods on one bill from the UI
- Cash tendered and change stored for reconciliation
- Daily register opening/closing and cash variance

### Required billing lifecycle

`Draft sale -> validated checkout -> invoice -> payment/credit -> optional return -> refund or credit adjustment -> immutable audit trail`

Invoices should never be silently rewritten after accounting finalization. Corrections should create linked adjustment/return records.

## 3. Products and menu audit

### What exists

- Product CRUD with soft removal
- Categories, description, barcode and image
- Selling price, MRP, cost price, GST and HSN fields
- Minimum stock and expiry date fields
- Own-made versus outsourced classification
- Quantity or measured sale mode
- BOQ stored as JSON for own-made items
- Low-stock display

### Missing essentials

- Separate raw-material, packaging and finished-product item types
- SKU/code independent from barcode
- Purchase unit, stock unit, recipe unit and their conversions
- Decimal stock quantity where necessary
- Product price history
- Cost history
- Multiple recipe versions with effective dates
- Recipe yield and batch size
- Active/inactive availability independent of deletion
- Pack sizes and conversions
- Category and unit master tables instead of free text
- Duplicate product detection
- Tax-inclusive/exclusive configuration
- Product change audit log

Images should not be mandatory for basic product creation. A cafe should be able to create operational items such as flour, gas cylinders or cake boxes without an image.

## 4. Raw-material inventory audit

### Current state

There is no raw-material model. BOQ lines contain ingredient names and quantities as JSON text inside a finished product. Those ingredients cannot:

- Hold stock
- Be purchased as controlled materials
- Have vendors or cost history
- Be adjusted or wasted
- Be linked reliably across recipes
- Be valued
- Trigger low-stock alerts

The BOQ report multiplies recipe text quantities by units sold. This is theoretical usage only. It does not deduct any ingredient stock.

### Required raw-material master

Each material should include:

- Code and name
- Category: ingredient, packaging, consumable
- Purchase unit and stock unit
- Conversion factor, e.g. 1 kg = 1,000 g
- Decimal quantity precision
- Current weighted-average cost
- Minimum/reorder quantity
- Preferred vendor
- Shelf life and expiry tracking setting
- Active status

Examples: flour, sugar, butter, milk, chocolate, coffee beans, paper cups, lids, cake boards and boxes.

### Required stock ledger

Create one immutable `StockMovement` table. Every quantity change must create a movement containing:

- Item and location
- Movement type
- Quantity in/out
- Unit cost and value
- Reference type and ID
- Date/time
- User
- Reason and notes
- Balance after movement, if maintained

Movement types:

- Opening balance
- Purchase receipt
- Purchase return
- Production consumption
- Production output
- Sale
- Sales return
- Wastage/spoilage
- Stock adjustment
- Internal consumption

Do not allow direct editing of the stock number. Use an adjustment entry with a reason.

### Stocktaking

Add:

- Start stock count
- Freeze or identify movements during counting
- Enter physical quantity
- Calculate system-versus-physical variance
- Recount workflow
- Approval
- Post variance adjustment
- Printable/exportable count sheet

## 5. Recipe and manufacturing audit

### Current state

- Products can be marked as own-made.
- A BOQ can contain ingredient name, quantity and unit.
- Reports estimate BOQ consumption from sales.
- Finished-goods stock is manually opened or restocked.

This does not represent manufacturing. There is no material issue, production batch, yield, wastage, finished-goods receipt or batch costing.

### Required recipe structure

- Recipe header linked to finished product
- Version and effective date
- Standard batch size
- Expected yield
- Ingredient lines linked to raw-material IDs
- Packaging lines
- Unit conversions
- Preparation loss percentage
- Optional labour/overhead amount
- Calculated batch and unit cost

### Required production workflow

`Plan batch -> issue/consume materials -> record actual output -> record waste/variance -> receive finished goods`

A production batch should capture:

- Batch number and production date
- Recipe version
- Planned and actual quantity
- Actual ingredients consumed
- Ingredient cost snapshot
- Wastage and reason
- Produced quantity
- Unit production cost
- User responsible
- Status: draft, in progress, completed, cancelled

Cancelling a completed batch must reverse the original movements with linked reversal entries; it must not delete history.

### Costing

Recommended initial method:

- Raw materials: moving weighted-average cost
- Outsourced finished goods: moving weighted-average cost
- Manufactured goods: actual or standard batch cost
- Sales: cost snapshot from finished-goods cost when sold

## 6. Purchases and purchase orders audit

### What exists

- Vendor selection
- Purchase header and items
- Supplier bill number
- Paid/pending selection
- Product quantity and cost
- Creation inside a transaction
- Immediate finished-product stock increase
- Updating the product's latest cost/selling price/MRP
- Marking a purchase paid
- Deleting a purchase and reversing stock

### Structural issue

The current module is named Purchase Order, but it behaves like a received purchase bill. Creating it immediately increases stock. Payment status and procurement status are also combined.

Separate these concepts:

1. Purchase order: intent to order
2. Goods receipt: quantity actually received
3. Purchase bill: supplier financial document
4. Vendor payment: money paid
5. Purchase return: items sent back

### Missing purchase basics

#### Purchase order

- Draft/edit before approval
- PO number
- Expected delivery date
- Ordered quantity versus received quantity
- Approval and cancellation reason
- Printable/sendable PO

#### Goods receipt

- Full or partial receipt
- Received, rejected and damaged quantities
- Batch/expiry data
- Actual unit cost
- Stock movement only on receipt
- Multiple receipts against one PO

#### Supplier bill and payment

- Supplier invoice uniqueness check
- Bill due date
- Separate payable amount
- Partial payments
- Multiple payments
- Payment history and references
- Outstanding vendor balance
- Vendor debit/credit notes

#### Purchase return

- Return number
- Original purchase/receipt link
- Partial quantity
- Return reason
- Stock deduction
- Vendor debit-note posting
- Refund or payable adjustment
- Return document printing

Critical current issue: deleting a purchase can make stock negative if some purchased stock has already been sold. Posted purchases should not be hard-deleted. Use a controlled reversal or purchase return.

The current cost update also replaces the product cost with the latest purchase cost. It should calculate weighted-average cost unless batch costing is selected.

## 7. Vendors and payable accounts audit

### What exists

- Vendor create, view, update and delete
- Contact details, GSTIN and address
- Vendors linked to purchases

### Missing essentials

- Vendor opening balance
- Vendor payable ledger
- Purchase bill debit entries
- Payment credit entries
- Purchase return/debit note
- Advance payments
- Running balance
- Due dates and aging
- Statement by date range
- Vendor payment screen
- Vendor purchase history and item price history
- Prevent deletion when referenced; use inactive status
- Duplicate phone/GSTIN checking

## 8. Customers and credit/debit audit

### What exists

- Customer CRUD and phone-based resolution
- Order history
- `totalPurchases` and `totalCredit` totals
- Credit sale and partial payment
- Later payment recording through the invoice screen
- Credit adjustment when an invoice is edited or cancelled

### Why current totals are insufficient

`totalCredit` is a mutable summary. It does not explain individual debit and credit entries, opening balances, returns, write-offs or advance money. Reconstructing a trustworthy statement is difficult.

### Required customer ledger

Create immutable entries with:

- Customer
- Date
- Type: opening balance, credit sale, receipt, sales return, refund, advance, adjustment, write-off
- Reference type and ID
- Debit
- Credit
- Payment method/reference
- Notes
- User

Balance formula:

`customer amount due = opening debit + credit sales - receipts - returns +/- approved adjustments`

### Missing customer basics

- Record customer receipt directly from customer account
- Allocate a receipt across one or more invoices
- Unallocated advance balance
- Refund/customer payout
- Credit limit
- Due date and credit terms
- Aging buckets
- Customer statement with opening, transactions and closing balance
- Print/PDF/share statement
- Reminder tracking
- Prevent deletion with transaction history; use inactive status
- Merge duplicate customers
- Export customer accounts

## 9. Expenses audit

### Current state

There is no expense model. The dashboard's Expenses figure currently represents cost of goods sold inferred from sales and profit, not real operating expenses.

### Required expense module

- Expense categories
- Cash/bank/UPI payment account
- Vendor/payee
- Amount and tax
- Date
- Receipt attachment
- Recurring flag
- Notes
- Created/approved by
- Edit/reversal audit

Typical categories: rent, salary, electricity, gas, repairs, delivery, cleaning, maintenance, marketing, bank charges and miscellaneous.

Expenses must post to the cash/register or other selected payment account so daily money reconciliation remains correct.

## 10. Profit and reports audit

### What exists

- Dashboard sales, order count, estimated profit, purchases and stock value
- Daily and monthly sales reports
- GST grouping
- Low/out-of-stock reports
- Generated daily reports
- Payment-method summary
- Own-made versus outsourced sales
- Theoretical BOQ consumption
- Top-selling items

### Accuracy problems

1. Daily/monthly report queries do not consistently exclude cancelled invoices.
2. Top-selling calculations can include cancelled invoices.
3. Dashboard pending-order query treats every non-paid invoice as pending, including cancelled invoices.
4. Profit uses the product's current purchase price instead of cost at sale.
5. Manufactured item cost is not calculated from real raw-material consumption.
6. Purchase amounts are not the same as expenses or COGS.
7. Stock value uses current quantity multiplied by one product cost, without a stock ledger or costing method.
8. Refunds and returns are not reported as a separate sales deduction.
9. No operating expense data exists.
10. Payment collection reports can become inaccurate when paid invoices are cancelled without refund entries.

### Required management reports

#### Sales

- Gross sales, discounts, returns and net sales
- Cash/UPI/card/credit collections
- Item/category sales
- Hour/day/month comparison
- Cancelled and returned sales
- Discounts by user and reason

#### Inventory

- Stock on hand and valuation
- Stock movement register
- Low stock and reorder
- Wastage
- Expiry
- Physical-count variance
- Raw-material consumption

#### Manufacturing

- Planned versus actual yield
- Standard versus actual consumption
- Batch cost
- Production waste
- Finished-goods output

#### Profit

- Item contribution margin
- Gross profit by product/category
- Gross profit by day/month
- Operating expenses
- Operating profit
- Manufactured versus outsourced margin

#### Receivables/payables

- Customer balances and aging
- Customer ledger/statement
- Vendor balances and aging
- Vendor ledger/statement

## 11. Users, permissions and audit controls

### What exists

- JWT authentication
- Admin, manager and cashier role values
- Disabled public registration
- Login rate limiting and security headers

### Missing controls

The role-check helper exists but is not applied to business routes. Any logged-in user can reach product edits, stock changes, purchase deletion, customer deletion, invoice cancellation and report settings through the API.

Implement permissions for:

- Billing
- Manual price override
- Discount limit
- Return/refund
- Invoice cancellation
- Stock adjustment
- Purchase approval/receipt/return
- Expense approval
- Customer balance adjustment
- Reports and profit visibility
- User/settings administration

Create a permanent audit log with before/after values for financial, stock and master-data changes.

## 12. Staff and attendance audit

### What exists

- Staff CRUD with soft deactivation
- Morning/evening attendance
- Present, absent, leave and weekly-off statuses
- Monthly attendance summary
- Salary field

### Missing small-cafe basics

- Staff user account linkage
- PIN login
- Permission assignment
- Salary calculation/payroll register
- Salary advances/deductions
- Salary payment history
- Overtime/half-day rules if required

Payroll is secondary to inventory and accounting and can follow the core modules.

## 13. Settings and printing audit

### What exists

- Receipt business name, contact, GSTIN and footer
- Paper size/font options
- Auto-print and test print
- PWA installation shell

### Missing essentials

- Server-stored settings shared across devices; current receipt configuration is browser-local
- Printer mapping and failure feedback
- Return receipt, purchase order and statement templates
- Sequential document series settings
- Backup/export settings
- Financial year and tax configuration

## 14. Engineering and data-safety audit

### Critical gaps

- No automated test suite
- No reliable versioned migration workflow for all new structures
- No API schema/central request validation
- No idempotent financial endpoints
- Limited concurrency protection
- No immutable audit ledger
- No documented backup/restore verification
- No error-monitoring integration
- No pagination for growing invoices, purchases and customer lists
- Several N+1 database operations in dashboard profit calculation
- A scheduled report runs inside the web process rather than a durable job mechanism

### Minimum production controls

- Unit tests for all money and unit-conversion calculations
- Integration tests for sales, returns, purchases, production and ledgers
- Transaction tests proving rollback safety
- Concurrency tests for stock and invoice numbers
- Daily automated database backup
- Tested restore procedure
- Structured application logs
- Error and uptime monitoring
- Data export for the business owner

## 15. Recommended target data model

### Masters

- Product
- RawMaterial
- UnitOfMeasure
- UnitConversion
- Recipe
- RecipeLine
- Customer
- Vendor
- ExpenseCategory
- User and Permission

### Transactions

- Sale/Invoice and InvoiceItem
- Payment
- SalesReturn and SalesReturnItem
- CustomerLedgerEntry
- PurchaseOrder and PurchaseOrderItem
- GoodsReceipt and GoodsReceiptItem
- PurchaseBill
- VendorPayment
- PurchaseReturn and PurchaseReturnItem
- VendorLedgerEntry
- ProductionBatch and ProductionConsumption
- StockMovement
- StockCount
- Expense
- CashRegisterShift and CashMovement
- AuditLog

## 16. Prioritized delivery plan

### Release 1: Correct the current billing foundation

- Exclude cancelled documents from every sales/report query
- Server-side pricing, tax and stock validation
- Stock locks and safe invoice numbering
- Cost snapshot on invoice items
- Proper sales-return/refund documents
- Paid-invoice cancellation refund handling
- Request validation and permissions
- Automated tests for billing/refund/credit flows

### Release 2: Raw materials and auditable stock

- Raw-material master
- Units and conversions
- Immutable stock ledger
- Controlled stock adjustment and wastage
- Stocktaking
- Raw-material purchasing

### Release 3: Recipes and production

- Structured recipe master
- Recipe costing
- Production batches
- Ingredient consumption and finished output
- Yield and wastage
- Batch/unit cost

### Release 4: Complete purchasing and vendors

- Separate PO, goods receipt and supplier bill
- Partial receiving
- Purchase returns
- Vendor payments
- Vendor payable ledger and statements
- Weighted-average costing

### Release 5: Customer accounts and expenses

- Customer debit/credit ledger
- Receipts, advances, returns and adjustments
- Aging and statements
- Expense ledger
- Register/cash reconciliation

### Release 6: Accurate management reporting

- Net sales and return reporting
- Stock valuation and movement reports
- Production variance and wastage
- Item/category margin
- Gross and operating profit
- Receivable/payable aging

## 17. Definition of a complete small-cafe product

The product can be considered functionally complete for a small cafe when it can pass this end-to-end scenario without manual spreadsheet corrections:

1. Create flour in kilograms and consume it in grams.
2. Create and approve a supplier PO.
3. Partially receive the order and capture cost, batch and expiry.
4. Record the supplier bill as partially unpaid.
5. Manufacture a cake batch using the recipe.
6. Deduct actual ingredients and add actual finished cakes.
7. Record production wastage.
8. Sell cakes using cash and customer credit.
9. Return one sale item, decide whether to restock or waste it, and issue a refund/credit.
10. Receive a later customer payment and print the customer's ledger statement.
11. Return damaged flour to the supplier and update the vendor balance.
12. Record rent and electricity expenses.
13. Reconcile the day's cash.
14. Produce a report showing net sales, COGS, gross profit, expenses, operating profit, stock value, customer dues and vendor dues.

Until those steps reconcile exactly, dashboard profit should be labelled estimated rather than final.
