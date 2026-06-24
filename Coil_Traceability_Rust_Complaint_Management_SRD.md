# Software Requirement Document
## Coil Traceability & Rust Complaint Management System (CTRCMS)
**Prepared for:** Sunrack Solar Structures
**Document Type:** Functional & Technical Requirement Specification
**Version:** 1.0
**Date:** 17-June-2026

---

## 1. Project Overview

### 1.1 Background

Sunrack procures coils from AM/NS India (AMNS), processes them through a third-party slitter (Shiv Sagar Slitter), and manufactures solar mounting components such as walkway trays and support frames. These components are supplied to EPC/installation partners (e.g., Suntrop Solar) who install them at end-customer sites (e.g., JLM Automotive, Bangalore).

A recent field complaint illustrates the problem this software is meant to solve: red rust was observed in walkway trays and support frame edges roughly two months after installation at a customer site. When AMNS investigated the complaint, they required complete documented evidence covering:

- The original coil number, grade, coating class, size, and weight supplied
- Mill Test Certificate (MTC), invoice, and transporter/vehicle details for the original dispatch
- Which coil was slit into which slit coils, and on what date
- Which slit coil/batch was used to manufacture which finished components
- QC inspection results before dispatch
- Dispatch details, site receipt, and installation date
- Photographic evidence and root cause findings related to the complaint

Currently, this information is scattered across Excel sheets, paper challans, WhatsApp photos, and individual team records at the warehouse, slitter, production floor, dispatch desk, and site. Reconstructing a single coil's journey takes days of manual cross-referencing, delays supplier response, and weakens Sunrack's position when a complaint needs to be defended with evidence (as seen in the AMNS visit report, where the root cause was eventually traced to handling/storage damage and excess forming flash rather than the supplied coil material itself).

### 1.2 Why This Software Is Needed

- Rust and corrosion complaints on Magnelis/Galvanized/coated coil products require **end-to-end traceability** — from the raw coil received from AMNS, through slitting, production, dispatch, and installation, down to the exact complaint location.
- Without a system, root-cause analysis is slow, supplier escalation lacks evidence, and Sunrack cannot quickly prove whether a defect originated from supplied material, processing, handling, or installation.
- A digital, coil-centric traceability system will let any authorized user pull the **complete lifecycle of a coil in seconds**, supporting faster supplier resolution, audit readiness, and stronger quality accountability.

### 1.3 Scope

The system will digitally record and link every stage of material movement — inward coil receipt, slitting, Sunrack receipt, storage/inspection, production issue, manufacturing, QC, dispatch, site installation, and complaint handling — under a single traceable reference: the **Coil Number**.

---

## 2. Main Objective

- The **Coil Number** (e.g., `V9888D000M`) shall act as the **Primary Reference ID** across the entire system.
- Every downstream record (slit coil, production batch, finished product, dispatch note, site installation, complaint) must carry a traceable link back to one or more parent coil numbers.
- A user shall be able to **search by Coil Number** (or by slit coil ID, batch number, dispatch note, project name, or complaint ID) and instantly retrieve the **complete history** of that coil — from AMNS dispatch to site installation and any associated complaint.
- The system must support **partial/many-to-many traceability**, since one coil may be slit into multiple slit coils, and one finished product/dispatch may draw from multiple slit coils or batches.

---

## 3. End-to-End Workflow

The system must digitally mirror the following physical and document flow:

| Step | Stage | Description |
|---|---|---|
| 1 | **AMNS Coil Dispatch** | AMNS dispatches coil with MTC, invoice, transporter & vehicle details to Shiv Sagar Slitter. |
| 2 | **Receipt at Shiv Sagar Slitter** | Slitter receives coil, verifies weight/condition, records receipt against coil number. |
| 3 | **Slitting Process** | Coil is slit into multiple slit coils as per width specification; slitting date, slit coil IDs, and yield recorded. |
| 4 | **Dispatch from Shiv Sagar to Sunrack** | Slit coils dispatched to Sunrack with delivery note, vehicle, and transporter details. |
| 5 | **Receipt at Sunrack** | Sunrack warehouse receives slit coils, verifies against dispatch note, records receipt date and condition. |
| 6 | **Storage & Inspection** | Slit coils stored; visual/quality inspection logged (coating condition, physical damage, moisture, etc.). |
| 7 | **Issue to Production** | Slit coils issued to production floor against a production order; issue quantity and date recorded. |
| 8 | **Walkway / Support Frame Manufacturing** | Production team manufactures finished components (walkway trays, support frames) under a batch number; linked to issued slit coil(s). |
| 9 | **QC Inspection** | Finished goods inspected; QC result (Pass/Fail/Rework), inspector, and remarks recorded. |
| 10 | **Dispatch to Client Project Site** | Finished goods dispatched to project site with dispatch note, vehicle, transporter, and quantity. |
| 11 | **Site Receipt** | EPC/client team confirms receipt at site; receipt date and quantity recorded. |
| 12 | **Installation** | Components installed at site; installation date, installer (EPC partner), and location recorded. |
| 13 | **Rust Complaint Raised** | If a complaint arises, it is logged against the installed component(s)/batch(es), automatically pulling the linked coil history for investigation. |

```
AMNS Coil ──▶ Slitter Receipt ──▶ Slitting ──▶ Dispatch to Sunrack ──▶ Sunrack Receipt
   ──▶ Storage/Inspection ──▶ Issue to Production ──▶ Manufacturing (Batch)
   ──▶ QC Inspection ──▶ Dispatch to Site ──▶ Site Receipt ──▶ Installation
   ──▶ [Complaint, if any]
```

---

## 4. Core Modules

### 4.1 Coil Master / Inward Module
Captures original coil details as received from AMNS at the slitter. This is the root record of the entire traceability chain.

### 4.2 Slitting Tracking Module
Records the slitting event: parent coil number, resulting slit coil IDs, slit width/size, slitting date, and yield/scrap.

### 4.3 Sunrack Receipt Module
Records receipt of slit coils at Sunrack's warehouse, referencing the slitter's dispatch note and linking back to slit coil ID(s) and parent coil number(s).

### 4.4 Production Tracking Module
Tracks issue of slit coils to production, the production order, batch number, product type, and quantity produced, with linkage to the slit coil(s) consumed.

### 4.5 Finished Goods Module
Maintains the finished product inventory (walkway trays, support frames, etc.) with batch-level linkage to production records and QC status.

### 4.6 Dispatch Module
Records dispatch of finished goods to client project sites — dispatch note, vehicle, transporter, quantity, and linked batch number(s).

### 4.7 Site Installation Module
Captures site receipt and installation details — project name, client name, site location, installation date, installer/EPC partner, and quantity installed, linked to dispatch note and batch number(s).

### 4.8 Complaint Management Module
Logs rust/quality complaints against installed components. Allows linking a complaint to specific batch numbers/installed units, uploading rust photos, and recording root cause and resolution remarks. Automatically triggers a traceability lookup to the originating coil(s).

### 4.9 Traceability Report Module
The core reporting engine. Given any reference ID (coil number, slit coil ID, batch number, dispatch note, or complaint ID), generates a complete forward and backward traceability timeline with all linked documents.

### 4.10 Document and Photo Upload Module
Allows uploading and attaching supporting documents (MTC, invoice, delivery notes, QC reports, rust photos, site photos) at every stage, stored against the relevant record.

### 4.11 User Role and Approval Module
Manages role-based access control, data entry permissions, and approval workflows (e.g., QC sign-off, complaint closure approval).

---

## 5. Important Data Fields

### 5.1 Coil Master (Inward from AMNS)

| Field | Example | Notes |
|---|---|---|
| Coil Number (Primary Key) | V9888D000M | Unique, system-wide reference |
| Grade | IZMC560S | |
| Coating | ZM150 / ZM160 | Magnelis coating class |
| Size (Thickness x Width) | 1.0 x 1040 mm | |
| Weight | 18.66 MT | |
| Supplier | AMNS (Hazira Plant) | |
| MTC Number | — | Mill Test Certificate reference, file upload |
| Invoice Number | — | |
| Dispatch Date (AMNS) | — | |
| Vehicle Number | — | |
| Transporter Name | — | |
| Receipt Date (Slitter) | — | |
| Receiving Condition Remarks | — | Physical inspection notes |

### 5.2 Slitting Record

| Field | Notes |
|---|---|
| Parent Coil Number | Link to Coil Master |
| Slit Coil ID(s) | One-to-many per parent coil |
| Slit Width / Size | |
| Slitting Date | |
| Slit Coil Weight | |
| Slitter Location | Shiv Sagar Slitter |
| Dispatch Note (Slitter → Sunrack) | |
| Vehicle Number | |
| Transporter Name | |

### 5.3 Sunrack Receipt & Storage

| Field | Notes |
|---|---|
| Slit Coil ID | Link to Slitting Record |
| Receipt Date (Sunrack) | |
| Storage Location/Bin | |
| Inspection Result | Visual/coating condition |
| Inspection Remarks | |
| Inspection Photos | |

### 5.4 Production

| Field | Notes |
|---|---|
| Production Order Number | |
| Batch Number (Primary Key for production) | |
| Slit Coil ID(s) Consumed | Many-to-one or many-to-many |
| Product Type | e.g., Walkway Tray, Support Frame |
| Quantity Produced | |
| Production Date | |
| Operator/Shift | |

### 5.5 QC Inspection

| Field | Notes |
|---|---|
| Batch Number | Link to Production |
| QC Result | Pass / Fail / Rework |
| Inspector Name | |
| Inspection Date | |
| QC Remarks | |
| QC Photos | |

### 5.6 Dispatch to Site

| Field | Notes |
|---|---|
| Dispatch Note Number | |
| Batch Number(s) | Link to Production/QC |
| Quantity Dispatched | |
| Dispatch Date | |
| Vehicle Number | |
| Transporter Name | |
| Project Name | |
| Client Name | |
| Site Location | |

### 5.7 Site Installation

| Field | Notes |
|---|---|
| Dispatch Note Number | Link to Dispatch |
| Site Receipt Date | |
| Installation Date | |
| Installer / EPC Partner | e.g., Suntrop Solar |
| Quantity Installed | |
| Installation Photos | |

### 5.8 Complaint Record

| Field | Notes |
|---|---|
| Complaint ID | Auto-generated |
| Complaint Date | |
| Project / Client Name | |
| Site Location | |
| Batch Number(s)/Component(s) Affected | Link to Production/Installation |
| Complaint Description | |
| Rust Photos | |
| Linked Coil Number(s) | Auto-derived via traceability chain |
| Root Cause Remarks | e.g., handling damage, excess forming flash, transport, coating defect |
| Resolution Status | Open / Under Investigation / Closed |
| Resolution Date | |
| Responsible Stage | AMNS / Slitter / Sunrack Production / Transport / Site Handling |

---

## 6. Traceability Logic

The traceability engine must maintain a connected chain of records as follows:

```
Coil  →  Slit Coil  →  Production Batch  →  Finished Product  →  Dispatch  →  Site  →  Installation  →  Complaint
```

**Key rules:**

- A **Coil** can produce **multiple Slit Coils** (one-to-many).
- A **Slit Coil** can be consumed across **one or more Production Batches**, and a **Production Batch** may consume **one or more Slit Coils** (many-to-many) — the system must support partial consumption tracking.
- A **Production Batch** generates a **Finished Product** quantity, which can be split across **multiple Dispatches**.
- A **Dispatch** is linked to **one Site/Project**, but a **Site/Project** may receive **multiple Dispatches** over time.
- An **Installation** record links the dispatched quantity to actual on-site placement.
- A **Complaint** is raised against an installed component/batch, and the system must **auto-resolve backward** through the chain to identify every originating Coil Number(s), Slitting record, MTC, and supplier dispatch document involved — without requiring manual cross-referencing.
- The system should also support **forward traceability**: given a Coil Number, show every Slit Coil, Batch, Dispatch, Site, and any Complaint it is connected to, even across multiple projects.

---

## 7. Report Output (Traceability Timeline)

When a user searches for Coil Number `V9888D000M`, the system shall generate a single-page (and exportable PDF) **Traceability Timeline Report** containing:

1. **Coil Master Details** — Grade, Coating, Size, Weight, Supplier, MTC, Invoice, AMNS dispatch date, vehicle/transporter.
2. **Slitting Details** — Slit coil ID(s) generated, slitting date, dispatch to Sunrack details.
3. **Sunrack Receipt & Inspection** — Receipt date, storage condition, inspection remarks/photos.
4. **Production Details** — Production order, batch number(s), product type, quantity produced, production date.
5. **QC Results** — Pass/Fail status, inspector, remarks, photos.
6. **Dispatch Details** — Dispatch note, vehicle, transporter, project/client name, site location, quantity.
7. **Site Installation** — Receipt date, installation date, installer/EPC partner, quantity installed.
8. **Linked Complaints (if any)** — Complaint ID, date, description, rust photos, root cause, resolution status.
9. **All Linked Documents** — MTC, invoice, delivery notes, QC reports, and photos available as downloadable attachments directly from the timeline view.

The report must visually present this as a **chronological timeline** (stage-by-stage) so it can be shared directly with AMNS or internal management without additional formatting.

---

## 8. User Roles

| Role | Permissions |
|---|---|
| **Admin** | Full access; manages users, roles, master data, and system configuration. |
| **Purchase / Warehouse Team** | Creates Coil Master records on inward receipt; uploads MTC/invoice; manages storage/inspection entries. |
| **Slitter / Processing Team** | Records slitting events, slit coil generation, and dispatch to Sunrack. |
| **Production Team** | Records issue of slit coils to production, production orders, batch numbers, and quantities produced. |
| **QC Team** | Records QC inspection results, remarks, and photos; approves/rejects batches. |
| **Dispatch Team** | Creates dispatch records to project sites; manages vehicle/transporter details. |
| **Site Team / EPC Coordinator** | Confirms site receipt and installation details; uploads installation photos. |
| **Management** | Read-only access to all modules; views dashboards, traceability reports, and complaint analytics; exports reports. |

Each role should have **module-level and field-level access control**, with an audit log capturing who created/edited each record and when.

---

## 9. Expected Benefits

- **Faster supplier response** — instantly produce the exact coil, MTC, and dispatch evidence AMNS or any supplier requests, instead of taking days to manually trace records.
- **Proper root cause analysis** — clear visibility into whether an issue originates from supplied material, slitting, storage, production, transport, or site handling.
- **Proof of material quality** — documented chain of custody and inspection records protect Sunrack's position when material quality is questioned.
- **Audit-ready traceability** — complete, timestamped digital records replace scattered Excel sheets and paper trails, ready for customer or certification audits.
- **Reduced manual Excel tracking** — eliminates duplicate data entry and manual cross-referencing across multiple spreadsheets and WhatsApp threads.
- **Better complaint handling** — structured complaint logging with photo evidence, linked root cause, and resolution tracking improves customer communication and closure time.

---

## 10. Non-Functional Requirements (Recommended)

| Requirement | Description |
|---|---|
| **Platform** | Web-based application, accessible on desktop and mobile (for site/warehouse data entry). |
| **Database** | Relational database (e.g., PostgreSQL/MySQL) to maintain referential integrity across linked records. |
| **File Storage** | Cloud or server-based storage for photos, MTCs, invoices, and reports (with size/type validation). |
| **Search** | Global search bar supporting Coil Number, Slit Coil ID, Batch Number, Dispatch Note, Project Name, or Complaint ID. |
| **Export** | PDF/Excel export of traceability reports and complaint logs. |
| **Notifications** | Optional email/SMS alerts on complaint creation and QC failure. |
| **Audit Trail** | Every record change logged with user, timestamp, and old/new values. |
| **Scalability** | Must support thousands of coils, batches, and dispatch records without performance degradation. |
| **Backup** | Daily automated backup of database and uploaded documents. |

---

## 11. Suggested Database Entity Relationship (Summary)

```
Coil (1) ───< Slitting Record (N)
Slitting Record (1) ───< Production Batch (N)   [many-to-many via junction table]
Production Batch (1) ───< QC Inspection (1)
Production Batch (1) ───< Dispatch (N)
Dispatch (1) ───< Site Installation (1)
Site Installation (1) ───< Complaint (N)
```

A **junction/mapping table** (e.g., `BatchSlitCoilMap`) is recommended between Slitting Records and Production Batches to correctly handle many-to-many consumption, since a batch may use multiple slit coils and a slit coil may be partially consumed across multiple batches.

---

## 12. Document Notes for Developer / Build Tool

- Treat **Coil Number** as the immutable root identifier; all other IDs (Slit Coil ID, Batch Number, Dispatch Note, Complaint ID) should be auto-generated but always store a foreign-key path back to one or more Coil Numbers.
- Build the **Traceability Report Module first** as the core feature, since it is the primary value driver (instant timeline generation from any reference ID).
- Design all data-entry forms to allow **photo and document upload at every stage**, since visual evidence (e.g., rust photos, shoe marks, liquid stains, forming flash) is critical to root cause analysis, as seen in real complaint investigations.
- Implement **role-based dashboards**: warehouse/production users see only data-entry screens for their stage; management sees full read-only traceability and complaint analytics.
- Plan for **partial quantity tracking** (weight/length/quantity) at each stage so the system can handle real-world splits (e.g., one coil slit into multiple widths, one batch dispatched to multiple sites).

---

## 13. Implementation Phases (Step-by-Step Build Plan for Cursor AI / Developer)

Build the system incrementally. Each phase should be fully working and testable before moving to the next — do not jump ahead to later phases until the current phase's acceptance criteria pass.

### Phase 0 — Project Setup & Foundation

**Goal:** Get a running skeleton app with database, auth, and folder structure in place.

- Initialize project (frontend + backend framework of choice) and connect to a relational database (PostgreSQL/MySQL).
- Set up environment config, `.env` handling, and file/document storage (local or cloud bucket) for later photo/MTC uploads.
- Build the **User & Role module**: login, role-based access (Admin, Purchase/Warehouse, Slitter/Processing, Production, QC, Dispatch, Site Team, Management).
- Build a basic navigation shell (sidebar/menu) with placeholder pages for each future module.

**Acceptance criteria:** A user can log in, see role-appropriate menu items, and the database connects successfully with empty tables created for Users and Roles.

---

### Phase 1 — Coil Master / Inward Module

**Goal:** Capture the root record of the traceability chain.

- Create `Coil` table/entity with fields from Section 5.1 (Coil Number as primary key, Grade, Coating, Size, Weight, Supplier, MTC Number, Invoice Number, Dispatch Date, Vehicle Number, Transporter Name, Receipt Date, Receiving Condition Remarks).
- Build Create/Read/Update form for Purchase/Warehouse role to enter a new coil on inward receipt.
- Add file upload for MTC and Invoice documents attached to the coil record.
- Build a Coil list/search view filterable by Coil Number, Grade, Supplier, Date range.

**Acceptance criteria:** A user with Warehouse role can create a coil record for `V9888D000M`, upload an MTC PDF, and retrieve it by searching the coil number.

---

### Phase 2 — Slitting Tracking Module

**Goal:** Link slit coils back to a parent coil.

- Create `SlittingRecord` table with fields from Section 5.2, with a foreign key to one parent `Coil Number`.
- Support generating multiple Slit Coil IDs per parent coil (one-to-many).
- Build a form for Slitter/Processing role to log slitting date, slit width/size, slit coil weight, and dispatch-to-Sunrack details (vehicle, transporter, dispatch note).
- Update the Coil detail page to display all linked Slit Coil records underneath it.

**Acceptance criteria:** From the Coil `V9888D000M` detail page, a user can see every Slit Coil ID generated from it, with slitting date and dispatch info.

---

### Phase 3 — Sunrack Receipt & Storage/Inspection Module

**Goal:** Record receipt and inspection at Sunrack's warehouse.

- Create `SunrackReceipt` table with fields from Section 5.3, linked to a `Slit Coil ID`.
- Build a form for Warehouse role to confirm receipt against the slitter's dispatch note, log storage location/bin, and record inspection result, remarks, and photos.
- Add photo upload capability (multiple images) tied to the inspection record.

**Acceptance criteria:** A Slit Coil record shows its Sunrack receipt date, inspection status, and at least one uploaded inspection photo.

---

### Phase 4 — Production Tracking Module

**Goal:** Track issue of slit coils into production batches, supporting many-to-many consumption.

- Create `ProductionBatch` table with fields from Section 5.4 (Production Order, Batch Number, Product Type, Quantity Produced, Production Date, Operator/Shift).
- Create a junction table `BatchSlitCoilMap` to link one or more Slit Coil IDs to one or more Production Batches (handle partial quantity consumption).
- Build a form for Production role to issue slit coil(s) to a new or existing batch and record quantity produced.
- Update Slit Coil detail view to show which batch(es) consumed it, and how much.

**Acceptance criteria:** A Slit Coil can be split across two different batches, and each Batch detail page correctly lists every Slit Coil ID (and quantity) it consumed.

---

### Phase 5 — QC Inspection Module

**Goal:** Record quality sign-off before goods are released to dispatch.

- Create `QCInspection` table with fields from Section 5.5, linked one-to-one (or one-to-many for re-inspection) with `Production Batch`.
- Build a form for QC role to record result (Pass/Fail/Rework), inspector name, date, remarks, and photos.
- Enforce a rule: a batch cannot be selected in the Dispatch module unless it has a QC result of "Pass."

**Acceptance criteria:** A batch with QC result "Fail" is blocked from appearing in the Dispatch module's available-batch list; a "Pass" batch is selectable.

---

### Phase 6 — Dispatch Module

**Goal:** Record outbound shipment of finished goods to client project sites.

- Create `Dispatch` table with fields from Section 5.6, linked to one or more `Batch Number(s)`.
- Build a form for Dispatch role to create a dispatch note: select QC-passed batch(es), enter quantity, vehicle, transporter, project name, client name, site location, and dispatch date.
- Support splitting one batch's quantity across multiple dispatch notes (partial dispatch).

**Acceptance criteria:** A dispatch note can reference multiple batches, and a batch's total dispatched quantity across all dispatch notes cannot exceed its produced quantity.

---

### Phase 7 — Site Installation Module

**Goal:** Confirm receipt and installation at the client site.

- Create `SiteInstallation` table with fields from Section 5.7, linked to a `Dispatch Note Number`.
- Build a form for Site Team/EPC Coordinator role to confirm site receipt date, installation date, installer/EPC partner name, quantity installed, and upload installation photos.

**Acceptance criteria:** A Dispatch record shows linked installation date, installer name, and at least one installation photo once the site team submits the form.

---

### Phase 8 — Complaint Management Module

**Goal:** Log and investigate rust/quality complaints with automatic backward traceability.

- Create `Complaint` table with fields from Section 5.8, linked to one or more `Batch Number(s)` / installed components.
- Build a form for any authorized role to raise a complaint: complaint date, project/client name, site location, affected batch(es), description, rust photo upload, root cause remarks, responsible stage, and resolution status.
- Implement the **auto-trace function**: when a complaint is linked to a batch, the system automatically resolves and displays every upstream Slit Coil ID(s) and original Coil Number(s) involved (per Section 6 logic).
- Add status workflow: Open → Under Investigation → Closed, with resolution date and approval by Management/Admin role.

**Acceptance criteria:** Raising a complaint against a batch automatically surfaces the correct originating Coil Number(s) (e.g., `V9888D000M`) without manual lookup.

---

### Phase 9 — Traceability Report Module

**Goal:** Build the core reporting engine described in Section 7 — the primary value feature.

- Build a global search bar accepting Coil Number, Slit Coil ID, Batch Number, Dispatch Note, Project Name, or Complaint ID.
- On search, generate a chronological **Traceability Timeline** view covering all 9 stages listed in Section 7 (Coil Master → Slitting → Sunrack Receipt → Production → QC → Dispatch → Site Installation → Complaints → Linked Documents).
- Each stage in the timeline should show key fields and link out to the underlying record and its uploaded documents/photos.
- Add a "Download as PDF" / "Export" button to generate a shareable report (for sending to AMNS or internal management).

**Acceptance criteria:** Searching `V9888D000M` returns a single-page timeline showing every stage from AMNS dispatch through to any linked complaint, exportable as a PDF.

---

### Phase 10 — Dashboards, Notifications & Polish

**Goal:** Add management visibility and finishing touches.

- Build a Management dashboard: counts of open complaints, batches pending QC, recent dispatches, complaint root-cause breakdown (e.g., handling damage vs. forming flash vs. supplied material).
- Add optional email/SMS notification triggers on complaint creation and QC failure.
- Implement the audit trail (user, timestamp, old/new values) across all modules per Section 10.
- Conduct end-to-end testing of the full chain using a real example (e.g., trace `V9888D000M` from coil receipt through to the JLM Automotive-style complaint) to confirm no broken links in the traceability chain.

**Acceptance criteria:** Management role can view a dashboard summarizing complaint and QC status, and a full end-to-end trace test passes with no missing links.

---

*End of Document*
