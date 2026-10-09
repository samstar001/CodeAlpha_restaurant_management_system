# AGENT.md: Restaurant Management System

> The single source of truth for this project: scope, design, API contracts, phase plan and progress.
> Read this file first before changing anything.
>
> **Rules for anyone working in this repo (human or AI assistant):**
>
> 1. Follow the architecture in [Section 3](#3-architecture) and the contracts in [Section 7](#7-api-contracts).
> 2. Work one phase at a time, in order ([Section 10](#10-phases)).
> 3. Every feature PR ticks its box in the phase tracker and updates any contract it changes.
> 4. Business rules live in services only ([Section 6](#6-business-rules)).

**Project:** CodeAlpha Backend Internship, Task 3
**Last updated:** 2026-10-09
**Current phase:** Phase 1 (not started)

---

## 1. Overview

A backend REST API for running a restaurant: managing the menu, taking orders (dine-in, takeout, delivery), reserving tables, and keeping ingredient inventory in sync automatically as orders arrive.

### Task requirements (from CodeAlpha)

| #   | Requirement                                                                        | Covered in    |
| --- | ---------------------------------------------------------------------------------- | ------------- |
| R1  | Set up backend with Express.js to handle orders, tables, inventory                 | Phases 1, 3   |
| R2  | Design database models: menu items, orders, tables, reservations, inventory        | Phase 2       |
| R3  | Create APIs: place orders, reserve tables, update inventory, view menu             | Phases 4 to 8 |
| R4  | Implement logic: order processing, table availability check, inventory auto-update | Phases 6 to 8 |
| R5  | Optional: reporting (daily sales, stock alerts) and admin access panel             | Phase 9       |

---

## 2. Tech stack (final)

| Concern                   | Choice                                            | Notes                                                                                                      |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Language                  | JavaScript (CommonJS: `require`/`module.exports`) | Chosen for simple Jest compatibility                                                                       |
| Runtime / framework       | Node.js 20+ and **Express 5**                     | Express 5 forwards async errors to the error handler automatically, so no `asyncHandler` wrapper is needed |
| Database                  | PostgreSQL                                        |                                                                                                            |
| ORM                       | **Prisma 6.19.3 (pinned)**                        | Prisma 7 requires driver adapters and a new config file; 6.x keeps setup simple                            |
| Validation                | **Zod** (v4)                                      | Use `error.issues` when formatting validation errors                                                       |
| Auth                      | JWT (`jsonwebtoken`) + `bcryptjs`                 | `bcryptjs` is pure JS, so no native build problems on Windows                                              |
| Security / logging        | `helmet`, `cors`, `morgan`                        |                                                                                                            |
| Testing                   | **Jest** + **Supertest**                          | Separate test database via `.env.test`                                                                     |
| API docs / manual testing | **Postman** collection stored in `/postman`       |                                                                                                            |

---

## 3. Architecture

### 3.1 Request flow

```
Request -> Route -> Validate (Zod) -> Auth middleware -> Controller -> Service -> Prisma -> PostgreSQL
                                                                          |
                                                             Business rules live HERE
Errors from any layer -> central errorHandler -> consistent JSON response
```

- **Routes:** map URL + method to a controller and attach middleware. No logic.
- **Controllers:** read the request, call a service, shape the response. No business rules.
- **Services:** all business logic. The only layer that talks to Prisma. Throw `AppError`; never send responses.
- **Middleware:** `validate(schema)`, `authenticate`, `optionalAuth`, `requireRole('ADMIN')`, `notFound`, `errorHandler`.

### 3.2 Folder structure

```
restaurant-management-system/
├── AGENT.md
├── README.md
├── .env / .env.example / .env.test
├── jest.config.js
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.js
├── postman/                    # exported collection + environment
├── docs/
├── src/
│   ├── app.js                  # builds the Express app (no listen)
│   ├── server.js               # starts the server
│   ├── config/                 # env.js (validated env), prisma.js (client singleton)
│   ├── middleware/             # authenticate, optionalAuth, requireRole, validate, notFound, errorHandler
│   ├── utils/                  # AppError.js, response.js, tokens.js
│   ├── routes/index.js         # mounts every module under /api/v1
│   └── modules/
│       └── <module>/           # <module>.routes / .controller / .service / .schema
│           # modules: auth, categories, menu, inventory, tables, reservations, orders, reports
└── tests/
    ├── setup.js                # loads .env.test
    ├── unit/                   # pure logic (price calc, overlap check, status transitions)
    └── integration/            # Supertest against the real app + test database
```

### 3.3 Environment variables

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/restaurant?schema=public"
JWT_SECRET="change-me"
JWT_EXPIRES_IN="1d"
PORT=3000
RESERVATION_DEFAULT_MINUTES=90
RESERVATION_BUFFER_MINUTES=15
```

`.env` and `.env.test` are never committed. `.env.example` always stays current.

---

## 4. Roles and access

| Role                     | Can do                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Guest** (no token)     | View menu, place an order (guest order)                                                                                |
| **CUSTOMER** (logged in) | Everything a guest can, plus: place orders linked to their account, view own orders, make/view/cancel own reservations |
| **ADMIN**                | Manage menu, categories, recipes, inventory, tables; view all orders and reservations; update order status; reports    |

**Decision:** placing an order needs no login; viewing an order or reservation requires login.
**Consequence:** a guest order has no owner and is not viewable by customers afterward. The guest receives the `orderId` in the response only. Orders placed with a valid token are linked to that user (`optionalAuth`).

---

## 5. Data model

> Field-level design. The authoritative version is `prisma/schema.prisma` once written (Phase 2).

### 5.1 Models

**User**: `id`, `email` (unique), `passwordHash`, `name`, `phone?`, `role` (CUSTOMER | ADMIN), `createdAt`

**Category**: `id`, `name` (unique)

**MenuItem**: `id`, `name`, `description?`, `price` (Decimal), `isAvailable` (bool, manual switch), `isDeleted` (bool, soft delete), `categoryId`, timestamps

**InventoryItem**: `id`, `name` (unique), `quantityGrams` (Decimal, **may go negative**), `reorderLevel` (Decimal), timestamps

**RecipeItem** (join): `menuItemId`, `inventoryItemId`, `gramsUsed` (Decimal). Unique on (`menuItemId`, `inventoryItemId`)

**Table**: `id`, `number` (unique), `capacity`, `status` (FREE | OCCUPIED)

**Reservation**: `id`, `userId`, `tableId`, `startTime`, `endTime`, `partySize`, `status` (CONFIRMED | CANCELLED | COMPLETED | NO_SHOW), `createdAt`

**Order**: `id`, `userId?`, `tableId?`, `type` (DINE_IN | TAKEOUT | DELIVERY), `status` (PENDING | PREPARING | SERVED | PAID | CANCELLED), `totalAmount` (Decimal, stored), `deliveryAddress?`, `notes?`, timestamps

**OrderItem**: `id`, `orderId`, `menuItemId`, `quantity`, `unitPrice` (Decimal, **snapshot at order time**)

### 5.2 Relationships

```
Category 1──* MenuItem 1──* RecipeItem *──1 InventoryItem
User 1──* Order 1──* OrderItem *──1 MenuItem
User 1──* Reservation *──1 Table 1──* Order
```

### 5.3 Modelling rules

- Money is `Decimal`, never `Float`.
- Inventory unit is **grams** everywhere (liquids included, to keep a single unit system).
- `Order.tableId` is required only when `type = DINE_IN`; `deliveryAddress` only when `type = DELIVERY`. Enforced in Zod and the service.
- Order total and each item's `unitPrice` are stored so later price changes never rewrite history.
- Deleting a menu item is a **soft delete** (`isDeleted = true`) so past orders keep their history.

---

## 6. Business rules

### 6.1 Order processing

1. Validate payload (Zod). Every menu item must exist, not be deleted, and have `isAvailable = true`.
2. Compute `totalAmount = Σ (current price × quantity)` and snapshot each `unitPrice`.
3. In **one `prisma.$transaction`**: create Order + OrderItems, then decrement each ingredient by `gramsUsed × quantity` using atomic `{ decrement }`.
4. If `DINE_IN`: mark the table `OCCUPIED`.
5. After commit: find ingredients now below `reorderLevel` or negative and return them in `warnings`.

**Status lifecycle**

```
PENDING -> PREPARING -> SERVED -> PAID
   |           |
   +-----------+--> CANCELLED
```

- Only ADMIN moves status forward. Backward moves are not allowed.
- Customers may cancel only their own order while `PENDING`. ADMIN may cancel `PENDING` or `PREPARING`.
- `SERVED` and `PAID` orders cannot be cancelled.

### 6.2 Inventory auto-update

- Ordering deducts stock via recipes. Stock may go negative (**allow and flag**).
- Negative or below-`reorderLevel` stock appears in `GET /inventory/alerts` and in the order response `warnings`.
- **Cancel rule (confirmed):** cancelling a `PENDING` order **restocks** its ingredients; cancelling a `PREPARING` order does **not**.
- Restocking otherwise is a manual admin action (`POST /inventory/:id/restock`).

### 6.3 Table availability

A table is **unavailable** for a requested time when:

- it has a `CONFIRMED` reservation overlapping the window, **or**
- it is currently `OCCUPIED` by an unpaid order (for "now" requests).

Capacity must be ≥ party size.

**Overlap rule (confirmed):** two reservations on the same table conflict when
`newStart < existingEnd + buffer AND newEnd + buffer > existingStart`. Default duration **90 min**, buffer **15 min**. Only `CONFIRMED` reservations count.

**Warning rule:** if a customer orders for a table that is reserved or occupied, the system **warns** that the table may be assigned to someone who paid earlier rather than hard-blocking. Exact trigger settled in Phase 8 (see [Section 11](#11-open-questions)).

### 6.4 Reservations

- Customer supplies `startTime`, `partySize`, optional `tableId`. `endTime = startTime + default duration`.
- If `tableId` is omitted, pick the smallest free table that fits the party.
- Conflict check and insert run inside a `Serializable` transaction (retry on conflict). Production-grade alternative: PostgreSQL exclusion constraint on (table, time range) via a raw SQL migration.
- Customers can cancel their own reservation; cancelled reservations stop blocking the slot.

### 6.5 Edge cases (decided)

| Case                                       | Behaviour                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Order for an already-occupied table        | Allowed: append to the table's open order (`POST /orders/:id/items`)            |
| Overlapping reservation request            | `409 CONFLICT` with the conflicting window and, if possible, alternative tables |
| Not enough stock                           | Order accepted, stock goes negative, `warnings` returned                        |
| Cancel after inventory deducted            | Restock only if status was `PENDING`                                            |
| Two simultaneous orders for the last stock | Safe: atomic decrement, no read-then-check                                      |
| Two simultaneous reservations for one slot | Safe: Serializable transaction (or DB constraint)                               |

---

## 7. API contracts

**Base URL:** `/api/v1`
**Auth header:** `Authorization: Bearer <jwt>`
**Legend:** 🌐 public · 🔓 optional auth · 🔐 login required · 👑 admin only

### 7.0 Conventions

**Success**

```json
{ "success": true, "data": {}, "warnings": [] }
```

`warnings` appears only when there is something to flag.

**Error**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable",
    "details": []
  }
}
```

| Status | Code               | When                                                               |
| ------ | ------------------ | ------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR` | Zod validation failed                                              |
| 401    | `UNAUTHENTICATED`  | Missing or invalid token                                           |
| 403    | `FORBIDDEN`        | Wrong role or not the owner                                        |
| 404    | `NOT_FOUND`        | Resource does not exist                                            |
| 409    | `CONFLICT`         | Reservation overlap, duplicate unique value, illegal status change |
| 500    | `INTERNAL_ERROR`   | Unexpected failure                                                 |

Prisma `P2002` (unique violation) maps to 409; `P2025` (record not found) maps to 404.

### 7.1 Auth (Phase 4)

| Method | Path             | Access | Body                                | Returns            |
| ------ | ---------------- | ------ | ----------------------------------- | ------------------ |
| POST   | `/auth/register` | 🌐     | `{ name, email, password, phone? }` | `201` user + token |
| POST   | `/auth/login`    | 🌐     | `{ email, password }`               | `200` user + token |
| GET    | `/auth/me`       | 🔐     | none                                | `200` current user |

Registration always creates `CUSTOMER`. Admins are created by the seed script.

### 7.2 Categories and menu (Phase 5)

| Method | Path              | Access | Notes                                                               |
| ------ | ----------------- | ------ | ------------------------------------------------------------------- |
| GET    | `/menu`           | 🌐     | Query: `categoryId?`, `availableOnly?`. Excludes soft-deleted items |
| GET    | `/menu/:id`       | 🌐     | Includes recipe                                                     |
| POST   | `/menu`           | 👑     | `{ name, description?, price, categoryId, isAvailable? }`           |
| PATCH  | `/menu/:id`       | 👑     | Partial update                                                      |
| DELETE | `/menu/:id`       | 👑     | Soft delete                                                         |
| GET    | `/categories`     | 🌐     |                                                                     |
| POST   | `/categories`     | 👑     | `{ name }`                                                          |
| PATCH  | `/categories/:id` | 👑     | `{ name }`                                                          |
| DELETE | `/categories/:id` | 👑     | `409` if it still has items                                         |

### 7.3 Inventory and recipes (Phase 6)

| Method | Path                     | Access | Notes                                                                   |
| ------ | ------------------------ | ------ | ----------------------------------------------------------------------- |
| GET    | `/inventory`             | 👑     | All items                                                               |
| POST   | `/inventory`             | 👑     | `{ name, quantityGrams, reorderLevel }`                                 |
| PATCH  | `/inventory/:id`         | 👑     | Edit name or `reorderLevel`                                             |
| POST   | `/inventory/:id/restock` | 👑     | `{ grams }` adds to current quantity                                    |
| GET    | `/inventory/alerts`      | 👑     | Items below `reorderLevel` or negative                                  |
| PUT    | `/menu/:id/recipe`       | 👑     | `{ ingredients: [{ inventoryItemId, gramsUsed }] }` replaces the recipe |

### 7.4 Tables (Phase 7)

| Method | Path                   | Access | Notes                                                                    |
| ------ | ---------------------- | ------ | ------------------------------------------------------------------------ |
| GET    | `/tables`              | 👑     | All tables with current status                                           |
| POST   | `/tables`              | 👑     | `{ number, capacity }`                                                   |
| PATCH  | `/tables/:id`          | 👑     | Edit capacity or status                                                  |
| GET    | `/tables/availability` | 🌐     | Query: `startTime`, `partySize`, `durationMinutes?`; returns free tables |

### 7.5 Reservations (Phase 7)

| Method | Path                       | Access | Notes                                                            |
| ------ | -------------------------- | ------ | ---------------------------------------------------------------- |
| POST   | `/reservations`            | 🔐     | `{ startTime, partySize, tableId? }`; `201` or `409` on conflict |
| GET    | `/reservations/mine`       | 🔐     | Own reservations                                                 |
| GET    | `/reservations`            | 👑     | Query: `date?`, `status?`, `tableId?`                            |
| PATCH  | `/reservations/:id/cancel` | 🔐     | Owner or admin                                                   |
| PATCH  | `/reservations/:id/status` | 👑     | `{ status }` (COMPLETED, NO_SHOW)                                |

### 7.6 Orders (Phase 8)

| Method | Path                 | Access | Notes                                              |
| ------ | -------------------- | ------ | -------------------------------------------------- |
| POST   | `/orders`            | 🔓     | See request below                                  |
| POST   | `/orders/:id/items`  | 🔓     | Append items to an open dine-in order              |
| GET    | `/orders/mine`       | 🔐     | Own orders                                         |
| GET    | `/orders/:id`        | 🔐     | Owner or admin                                     |
| GET    | `/orders`            | 👑     | Query: `status?`, `type?`, `date?`                 |
| PATCH  | `/orders/:id/status` | 👑     | `{ status }`; forward transitions only             |
| PATCH  | `/orders/:id/cancel` | 🔐     | Owner (PENDING only) or admin; restocks if PENDING |

**`POST /orders` request**

```json
{
  "type": "DINE_IN",
  "tableId": 4,
  "deliveryAddress": null,
  "notes": "No onions",
  "items": [
    { "menuItemId": 12, "quantity": 2 },
    { "menuItemId": 7, "quantity": 1 }
  ]
}
```

**Response `201`**

```json
{
  "success": true,
  "data": {
    "id": 101,
    "status": "PENDING",
    "totalAmount": "8500.00",
    "items": []
  },
  "warnings": [
    {
      "type": "LOW_STOCK",
      "inventoryItemId": 3,
      "name": "Rice",
      "quantityGrams": -150
    }
  ]
}
```

### 7.7 Reports (Phase 9, 👑)

| Method | Path                                   | Returns                                                          |
| ------ | -------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/reports/daily-sales?date=YYYY-MM-DD` | Total revenue, order count, breakdown by type (PAID orders only) |
| GET    | `/reports/top-items?from=&to=&limit=`  | Best-selling menu items                                          |
| GET    | `/reports/stock-alerts`                | Same data as `/inventory/alerts`                                 |

---

## 8. Admin panel (optional)

API-first: the admin-only endpoints above form the "admin access panel". A simple front-end can be added later if time permits; the backend must not depend on it.

---

## 9. Development standards

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Validation:** every route with input has a Zod schema; no unvalidated `req.body` reaches a service.
- **Errors:** services throw `AppError(statusCode, code, message)`.
- **Comments:** comment the _why_ of business rules (stock deduction, overlap check, transactions).
- **Secrets:** never commit `.env` or `.env.test`.

### Definition of done (per feature)

1. Endpoint(s) match [Section 7](#7-api-contracts)
2. Zod validation and error cases handled
3. Tests written and passing (Jest)
4. Request(s) added to the Postman collection
5. This file updated if a contract or rule changed
6. Box ticked in [Section 10](#10-phases), PR merged

### GitHub workflow

- `main` always works. One feature = one branch = one PR.
- Branch naming: `feature/p<phase>-<short-name>` (e.g. `feature/p5-menu-crud`).
- Create a **GitHub Milestone** per phase and a **GitHub Issue** per checkbox.
- Tag a release when a phase completes: Phase 1 = `v0.1.0`, Phase 2 = `v0.2.0` ... Phase 9 = `v0.9.0`, Phase 10 = `v1.0.0`.

```bash
# start a feature
git checkout main && git pull
git checkout -b feature/p5-menu-crud

# commit in small steps
git add .
git commit -m "feat(menu): add create and list menu item endpoints"

# push and open a PR on GitHub
git push -u origin feature/p5-menu-crud

# after the PR is merged
git checkout main && git pull
git tag -a v0.5.0 -m "Phase 5: categories and menu"
git push origin v0.5.0
```

---

## 10. Phases

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. When a box is ticked, add the PR link in the [progress log](#progress-log).

### Phase 1: Project setup and repository `v0.1.0`

**Goal:** a runnable project skeleton on GitHub.

- [ ] Run the scaffold script (`setup.sh`) to create folders/files and install packages
- [ ] Create the GitHub repository and push the initial commit
- [ ] Copy this AGENT.md into the repo root
- [ ] Create `.env` from `.env.example` and set `DATABASE_URL`; create the `restaurant` and `restaurant_test` databases
- [ ] Create GitHub Milestones (Phases 1 to 10)

**Done when:** `npm install` works on a fresh clone and the repo is on GitHub.

### Phase 2: Database design and Prisma schema `v0.2.0`

**Goal:** the full data model in PostgreSQL. Covers **R2**.

- [ ] Write `schema.prisma`: all models, enums, relations, unique constraints (see [Section 5](#5-data-model))
- [ ] Run the first migration (`npm run db:migrate`)
- [ ] Seed script: one ADMIN user, categories, sample menu items, ingredients with recipes, tables
- [ ] Verify the data in Prisma Studio (`npm run db:studio`)

**Done when:** a fresh database can be migrated and seeded with two commands.

### Phase 3: Core infrastructure `v0.3.0`

**Goal:** the shared plumbing every module depends on. Covers **R1**.

- [ ] `config/env.js` (validate env vars with Zod) and `config/prisma.js` (client singleton)
- [ ] `AppError`, response helpers
- [ ] `validate` middleware (Zod for body, params, query)
- [ ] `notFound` and central `errorHandler` (maps ZodError, `P2002`, `P2025`, AppError)
- [ ] `app.js` / `server.js` split with helmet, cors, morgan, JSON parsing
- [ ] `GET /api/v1/health`
- [ ] Postman collection created with a `baseUrl` environment variable

**Done when:** the server starts, `/health` responds, and a bad request returns the standard error shape.

### Phase 4: Authentication and authorization `v0.4.0`

**Goal:** secure identity and roles. Covers [Section 4](#4-roles-and-access).

- [ ] `POST /auth/register` and `POST /auth/login` (bcryptjs + JWT)
- [ ] `GET /auth/me`
- [ ] Middleware: `authenticate`, `optionalAuth`, `requireRole`
- [ ] Postman: login request saves the token to an environment variable
- [ ] Tests: register, login, wrong password, protected route without token

**Done when:** an admin-only test route returns 403 for a customer and 200 for an admin.

### Phase 5: Categories and menu management `v0.5.0`

**Goal:** view and manage the menu. Covers part of **R3**.

- [ ] Categories: list, create, update, delete (blocked if items exist)
- [ ] Menu: list with filters, get one, create, update, soft delete (admin only)
- [ ] `isAvailable` toggle
- [ ] Tests for admin-only enforcement and soft delete
- [ ] Resolve open question #1 (soft delete confirmed)

**Done when:** a guest can view the menu and an admin can fully manage it.

### Phase 6: Inventory and recipes `v0.6.0`

**Goal:** ingredient stock and the menu-to-inventory link. Covers part of **R3** and **R4**.

- [ ] Inventory CRUD and restock
- [ ] `PUT /menu/:id/recipe` (replace a menu item's ingredient list)
- [ ] `GET /inventory/alerts` (negative or below reorder level)
- [ ] Tests: recipe replacement, restock, alert logic

**Done when:** every seeded menu item has a recipe and alerts reflect stock correctly.

### Phase 7: Tables and reservations `v0.7.0`

**Goal:** table availability and conflict-free booking. Covers part of **R3** and **R4**.

- [ ] Tables CRUD
- [ ] `GET /tables/availability` (capacity + overlap aware)
- [ ] `POST /reservations` with overlap detection (90 min default, 15 min buffer) in a Serializable transaction
- [ ] Auto-pick smallest suitable table when `tableId` is omitted
- [ ] View own / all reservations, cancel, status update
- [ ] Tests: overlap boundaries, buffer, cancelled slot reopens, two simultaneous bookings

**Done when:** two overlapping bookings for one table can never both succeed.

### Phase 8: Orders and processing `v0.8.0`

**Goal:** the core transaction. Covers **R3** and **R4**.

- [ ] `POST /orders` with price calculation, `unitPrice` snapshot, transactional inventory deduction, warnings
- [ ] Dine-in handling: occupy the table, append items to an open order
- [ ] Status transitions (validated, forward only)
- [ ] Cancel order (restock only if `PENDING`)
- [ ] View own order, admin order list with filters
- [ ] Free the table when an order becomes `PAID` or `CANCELLED`
- [ ] Optional auth on order creation (guest vs logged-in)
- [ ] Resolve open question #3 (table warning trigger)
- [ ] Tests: total calculation, stock deduction, negative stock warning, cancel/restock rule, illegal transitions

**Done when:** placing an order updates stock correctly and the full lifecycle works end to end.

### Phase 9: Reporting and admin `v0.9.0`

**Goal:** the optional features. Covers **R5**.

- [ ] `GET /reports/daily-sales`
- [ ] `GET /reports/top-items`
- [ ] `GET /reports/stock-alerts`
- [ ] Tests for report calculations

**Done when:** an admin can see accurate daily revenue and low-stock alerts.

### Phase 10: Testing, documentation and release `v1.0.0`

**Goal:** make it submission-ready.

- [ ] Fill test gaps; run the full suite (`npm test`)
- [ ] Final Postman collection (folders per module, example responses, saved token flow) exported to `/postman`
- [ ] README: setup, env vars, migrate/seed, run, test, API summary
- [ ] Review against the task requirements table in [Section 1](#1-overview)
- [ ] Tag `v1.0.0` and write the GitHub release notes

**Done when:** a stranger can clone the repo, follow the README, and run the whole API.

### Progress log

| Date       | Phase / Feature                     | PR / Commit | Notes                     |
| ---------- | ----------------------------------- | ----------- | ------------------------- |
| 2026-10-09 | Planning, AGENT.md, scaffold script | n/a         | Design decisions captured |

---

## 11. Open questions

Defaults below are used unless changed. Each is resolved in the phase shown.

| #   | Question                                                           | Default                                                                                                | Resolve in |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Menu deletion with past orders                                     | Soft delete (`isDeleted`)                                                                              | Phase 5    |
| 2   | Is `RESERVED` stored or derived?                                   | Derived from reservations at query time; stored status is FREE/OCCUPIED only                           | Phase 7    |
| 3   | Trigger for the "table may go to someone who paid earlier" warning | Warn when ordering for a table that is OCCUPIED or has a reservation starting within the buffer window | Phase 8    |
| 4   | Delivery fees / delivery tracking                                  | Out of scope for v1                                                                                    | n/a        |
| 5   | Payment                                                            | Status change to `PAID` only; no payment method or amount record                                       | Phase 8    |

---

## 12. Decision log

| Decision                                                         | Made by          | Date       |
| ---------------------------------------------------------------- | ---------------- | ---------- |
| Express.js backend                                               | User             | 2026-10-08 |
| PostgreSQL + Prisma + Zod                                        | User             | 2026-10-08 |
| JavaScript, Jest, Postman                                        | User             | 2026-10-09 |
| Recipe-based inventory (menu item to ingredient + grams)         | User             | 2026-10-08 |
| Negative stock allowed and flagged                               | User             | 2026-10-08 |
| Guests can order; login required to view own orders/reservations | User             | 2026-10-08 |
| Menu update/delete admin-only                                    | User (confirmed) | 2026-10-09 |
| Cancel restocks only PENDING orders                              | User (confirmed) | 2026-10-09 |
| Overlap-checked reservations, 90 min default + 15 min buffer     | User (confirmed) | 2026-10-09 |
| Prisma pinned to 6.19.3 (avoid Prisma 7 adapter/config changes)  | Proposed         | 2026-10-09 |
| CommonJS modules, Express 5, `bcryptjs`                          | Proposed         | 2026-10-09 |
