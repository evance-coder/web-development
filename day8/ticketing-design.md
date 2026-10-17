# TicketHub Design Document

TicketHub is a website that sells tickets for concerts and events. Most days it is quiet, but when a very
popular concert goes on sale, thousands of people try to buy the same seats at the same moment. The design
has to stay **correct** (no seat is ever sold twice) and **available** during those spikes.

This document follows the six-part design framework: requirements, estimates, API, data model,
architecture and trade-offs. Section 5 explains in detail how the design prevents two people from buying the same seat.

**Facts used:** 2 million registered users; on a normal day 50,000 people visit, each viewing 10 pages, and 5,000
tickets are sold; when a popular concert goes on sale, 200,000 people try to buy its 20,000 seats in the first 10 minutes.

## 1. Requirements

### Functional requirements
- Users can register and log in.
- Users can browse and search events (by name, city and date) and see event details.
- Users can see a seat map showing which seats are available.
- Users can choose seats and **hold** them for a short time (10 minutes) while they pay.
- Users can pay for held seats and receive tickets (with a QR code) by e-mail and in their account.
- Users can view their tickets and orders.
- Held seats that are not paid for are released automatically when the hold expires.

### Non-functional requirements
- **Correctness (most important):** a seat is never sold to two people, and a customer is never charged
  for a seat they do not get. Seat state must be strongly consistent.
- **Speed:** event pages and seat maps load in under 1 second for 95% of requests; a seat-hold request answers in under 500 ms, even on sale day.
- **Availability under load:** the site stays up during a big sale. If demand is higher than we can serve, users wait in an orderly queue instead of seeing errors.
- **Fairness:** first come, first served. One person (or bot) cannot grab most of the seats: there is a limit of 4 seats per order, rate limiting and bot protection.
- **Durability:** a paid ticket is never lost (replicated database and backups).
- **Security:** HTTPS everywhere, hashed passwords, and card details are handled only by the payment provider, never stored by us.
- **Payment safety:** retrying a payment (for example after a network error) never charges the customer twice.

## 2. Estimates

### Assumptions
- One page view is about one request to our servers (images and scripts come from the CDN).
- Peak traffic on a normal day is **5×** the average. A day has 86,400 seconds.
- On sale day, each of the 200,000 people makes about **10 requests** in the 10-minute window (event page, seat-map refreshes, hold attempts, payment) and about **3 seat-hold attempts** (because seats disappear while they choose).
- The first minute of the sale is about **3×** busier than the 10-minute average.

### Normal day

| Measure | Calculation | Average | Peak (5×) |
|---|---|---|---|
| Page views | 50,000 visitors × 10 pages = 500,000 per day ÷ 86,400 | ≈ 5.8 / s | ≈ 29 / s |
| Tickets sold | 5,000 per day ÷ 86,400 | ≈ 0.06 / s | ≈ 0.3 / s |

A normal day is tiny: one modest server could handle it.

### Big sale (200,000 people, 20,000 seats, 10 minutes = 600 s)

| Measure | Calculation | Average | Peak (first-minute surge, 3×) |
|---|---|---|---|
| People arriving | 200,000 ÷ 600 | ≈ 333 / s | |
| Requests | 200,000 × 10 = 2,000,000 ÷ 600 | ≈ 3,300 / s | ≈ 10,000 / s |
| Seat-hold attempts (writes) | 200,000 × 3 = 600,000 ÷ 600 | ≈ 1,000 / s | ≈ 3,000 / s |
| Successful sales | at most 20,000 ÷ 600 | ≈ 33 / s | ≈ 100 / s |

Demand is 10 people for every seat, so about **180,000 people (90%) will not get a ticket**. Most of the traffic is
people being told "sorry, taken", so rejecting them has to be cheap.

### Comparison

| | Normal day | Big sale | Difference |
|---|---|---|---|
| Requests per second (average) | ≈ 6 | ≈ 3,300 | about **575×** more |
| Requests per second (peak) | ≈ 29 | ≈ 10,000 | about **350×** more |
| Seat writes per second (peak) | ≈ 0.3 | ≈ 3,000 | about **10,000×** more |
| Tickets sold | 5,000 in a whole day | 20,000 in 10 minutes | **4× a normal day, in 10 minutes** |

**What this means:** the design is not driven by normal days. It is driven by a few minutes on sale day, and by the
rule that no seat may be sold twice while thousands of people fight for it.

## 3. API

Base URL: `https://api.tickethub.example/v1`. JSON requests and responses. After login the client sends
`Authorization: Bearer <token>`.

| Method | Path | Description | Success status |
|---|---|---|---|
| `POST` | `/auth/register` and `/auth/login` | Create an account / log in and get a token | `201` / `200` |
| `GET` | `/events` | Browse and search events (`?city=`, `?date=`, `?q=`, `?page=`) | `200 OK` |
| `GET` | `/events/{eventId}` | Event details | `200 OK` |
| `GET` | `/events/{eventId}/seats` | Seat map with each seat's status (`?section=`) | `200 OK` |
| `POST` | `/holds` | **Hold** one or more seats for 10 minutes (all or nothing) | `201 Created` |
| `DELETE` | `/holds/{holdId}` | Release a hold early | `204 No Content` |
| `POST` | `/orders` | Create an order for a hold (needs an `Idempotency-Key` header) | `201 Created` |
| `POST` | `/orders/{orderId}/payments` | **Pay** for the order and receive the tickets | `200 OK` |
| `GET` | `/me/tickets` | View my tickets | `200 OK` |
| `GET` | `/orders/{orderId}` | View one order and its status | `200 OK` |

### Example: hold seats, `POST /holds`

```json
{
  "event_id": 1,
  "seat_ids": [101, 102]
}
```

Response `201 Created`:

```json
{
  "hold_id": 5521,
  "event_id": 1,
  "seat_ids": [101, 102],
  "expires_at": "2026-12-01T10:10:00Z"
}
```

Response `409 Conflict` if any requested seat is no longer available (nothing is held):

```json
{
  "error": {
    "code": "SEATS_UNAVAILABLE",
    "message": "One or more of the seats you chose were just taken. Please choose different seats.",
    "unavailable_seat_ids": [102]
  }
}
```

### Example: pay, `POST /orders/812/payments`

```json
{
  "payment_token": "tok_from_payment_provider"
}
```

Response `200 OK`:

```json
{
  "order_id": 812,
  "status": "paid",
  "tickets": [
    { "ticket_code": "9f3a1c7be2d04a55", "section": "A", "row": "1", "seat": 1 },
    { "ticket_code": "4be8d210aa7c93f1", "section": "A", "row": "1", "seat": 2 }
  ]
}
```

### Error codes

| Status | When it happens |
|---|---|
| `400 Bad Request` | Invalid body, for example no seats chosen or more than 4 seats in one hold. |
| `401 Unauthorized` | Missing or expired token. |
| `402 Payment Required` | The payment provider declined the payment. The hold stays until it expires, so the user can try another card. |
| `404 Not Found` | The event, hold or order does not exist. |
| `409 Conflict` | A seat was already taken (hold request), or the same order already exists. |
| `410 Gone` | The hold expired before the user paid. The user must choose seats again. |
| `429 Too Many Requests` | Rate limit reached or the waiting room is full; the response says when to retry. |

### Safe retries
`POST /orders` needs an `Idempotency-Key` header: sending the same request twice returns the same order instead
of creating a second one. The payment uses the order id as its idempotency key with the payment provider, so a retry can never charge twice.

## 4. Data model

Six tables. The SQL was written for **SQLite** and tested there; on PostgreSQL (the production choice) the same design
uses identity columns, `TIMESTAMPTZ` and `now() + interval '10 minutes'`.

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per account | `id` (PK), `email` (UNIQUE), `password_hash` |
| `events` | One row per concert or event | `id` (PK), `title`, `venue`, `city`, `starts_at`, `sale_starts_at`, `status` |
| `seats` | One row per physical seat **per event**; holds the seat's current status | `id` (PK), `event_id` (FK), `status` (`available`, `held`, `sold`), `hold_id` (FK), `hold_expires_at`, `price_cents` |
| `holds` | A temporary reservation of seats for a user | `id` (PK), `user_id` (FK), `event_id` (FK), `status`, `expires_at` |
| `orders` | A purchase | `id` (PK), `user_id` (FK), `hold_id` (FK, UNIQUE), `total_cents`, `status`, `idempotency_key` (UNIQUE) |
| `tickets` | One row per ticket issued | `id` (PK), `order_id` (FK), `seat_id` (FK), `ticket_code` (UNIQUE), `status` |

### Relationships
- **users to holds and orders: one-to-many.** A user can make many holds and many orders; each belongs to one user.
- **events to seats: one-to-many.** An event has many seats; each seat row belongs to one event.
- **holds to seats: one-to-many.** One hold covers several seats; a seat is in at most one hold at a time.
- **holds to orders: one-to-one.** A hold becomes at most one order (`orders.hold_id` is UNIQUE).
- **orders to tickets: one-to-many.** One order has one ticket per seat.
- **seats to tickets: one valid ticket at most.** A seat can only ever have one *valid* ticket (enforced by a unique index below).
- **users to events: many-to-many**, through orders and tickets: a user can attend many events and an event has many buyers.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  venue          TEXT NOT NULL,
  city           TEXT NOT NULL,
  starts_at      TEXT NOT NULL,
  sale_starts_at TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'on_sale'
                 CHECK (status IN ('upcoming', 'on_sale', 'sold_out', 'cancelled'))
);

-- A hold = "these seats are reserved for this user until expires_at"
CREATE TABLE holds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id),
  event_id   INTEGER NOT NULL REFERENCES events (id),
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'paid', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per physical seat per event
CREATE TABLE seats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        INTEGER NOT NULL REFERENCES events (id),
  section         TEXT NOT NULL,
  row_label       TEXT NOT NULL,
  seat_number     INTEGER NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  status          TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'held', 'sold')),
  hold_id         INTEGER REFERENCES holds (id),
  hold_expires_at TEXT,
  UNIQUE (event_id, section, row_label, seat_number),
  CHECK ((status = 'held') = (hold_id IS NOT NULL))  -- a seat has a hold only while held
);

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id),
  hold_id         INTEGER NOT NULL UNIQUE REFERENCES holds (id),  -- one order per hold
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  idempotency_key TEXT NOT NULL UNIQUE,                           -- stops double charging on retries
  payment_ref     TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders (id),
  seat_id     INTEGER NOT NULL REFERENCES seats (id),
  ticket_code TEXT NOT NULL UNIQUE,                               -- printed as a QR code
  status      TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Safety net: a seat can have at most ONE valid ticket, whatever the application does
CREATE UNIQUE INDEX uq_one_valid_ticket_per_seat ON tickets (seat_id) WHERE status = 'valid';

CREATE INDEX idx_seats_event_status ON seats (event_id, status);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
```

### Example queries

The seat map, a user's tickets (a four-table JOIN), and the background job that releases expired holds:

```sql
-- Seat map for an event (what GET /events/1/seats returns); expired holds show as available
SELECT id, section, row_label, seat_number, price_cents,
       CASE WHEN status = 'held' AND hold_expires_at <= datetime('now')
            THEN 'available' ELSE status END AS status
FROM seats
WHERE event_id = 1
ORDER BY section, row_label, seat_number;

-- A user's tickets (what GET /me/tickets returns): JOIN across four tables
SELECT t.ticket_code, e.title, e.starts_at, e.venue, s.section, s.row_label, s.seat_number
FROM tickets AS t
JOIN orders AS o ON o.id = t.order_id
JOIN seats  AS s ON s.id = t.seat_id
JOIN events AS e ON e.id = s.event_id
WHERE o.user_id = 7
  AND t.status = 'valid'
ORDER BY e.starts_at;

-- Background job: release holds that have expired (runs every minute)
UPDATE seats
SET status = 'available', hold_id = NULL, hold_expires_at = NULL
WHERE status = 'held' AND hold_expires_at <= datetime('now');
```

The two indexes `idx_seats_event_status` and `idx_orders_user_created` serve these queries: the seat map reads all seats
of one event, and "my tickets" reads one user's orders, newest first. Without them the database would scan every seat
and every order.

## 5. Preventing two people from buying the same seat

### The problem: "check, then act"
The obvious code is: (1) read the seat; (2) if it is `available`, mark it `held`. When two people click at the same
moment, both can pass step 1 before either does step 2, and **both** get the seat. This is a race condition.
Checking in the application, or in a cache, is not enough.

### The solution: let the database make the decision, atomically
The design uses four layers. Each one alone is useful; together they make double-booking impossible.

**Layer 1: one atomic, conditional `UPDATE` inside a transaction.** Holding seats is a single statement that checks
and changes in one step (the full SQL is below). The condition `status = 'available'` is part of the `UPDATE`
itself, so the database decides who wins. In PostgreSQL, two transactions updating the same row cannot both
succeed: the second waits for the first to finish, then re-checks the condition, finds the seat is now `held`, and updates
**zero rows**. The application counts the rows changed: if it is fewer than the number of seats requested, it rolls back and returns `409`.

| Time | Person A | Person B | Seat 101 |
|---|---|---|---|
| 1 | `UPDATE ... WHERE status='available'` | | locked by A |
| 2 | | `UPDATE ... WHERE status='available'` waits | still locked |
| 3 | 1 row changed, `COMMIT` | | `held` by A |
| 4 | | condition re-checked: not available, **0 rows changed**, `ROLLBACK`, `409` | `held` by A |

**Layer 2: all or nothing.** A hold request for several seats runs as one transaction. If any seat is taken, the
whole transaction is rolled back, so nobody is left holding half of the seats they wanted. To avoid two people
deadlocking on overlapping seats, seats are always locked in ascending `id` order (and if the database ever
reports a deadlock, one transaction is retried).

**Layer 3: holds expire.** A hold lasts 10 minutes. The condition also accepts a seat whose hold has expired
(`status = 'held' AND hold_expires_at <= now`), so abandoned seats return to sale even if the cleanup job is late.

**Layer 4: constraints as a safety net.** Even if a bug in the code tried to double-sell, the database refuses:
- `CREATE UNIQUE INDEX ... ON tickets (seat_id) WHERE status = 'valid'` allows **only one valid ticket per seat**.
  (A cancelled ticket does not count, so a cancelled seat can be sold again.)
- `CHECK ((status = 'held') = (hold_id IS NOT NULL))` stops a seat being "held" by nobody.
- `UNIQUE (hold_id)` on `orders` means a hold can become only one order, and `UNIQUE (idempotency_key)` stops duplicate orders from retries.

### Step 1: hold the seats

```sql
-- Step 1 of buying: try to hold seats 101 and 102 for user 7 (all in ONE transaction)
BEGIN;

INSERT INTO holds (user_id, event_id, expires_at)
VALUES (:user_id, :event_id, datetime('now', '+10 minutes'));   -- PostgreSQL: now() + interval '10 minutes'

UPDATE seats
SET status = 'held',
    hold_id = :hold_id,                                          -- id of the hold row just inserted
    hold_expires_at = datetime('now', '+10 minutes')
WHERE event_id = :event_id
  AND id IN (101, 102)
  AND (status = 'available'
       OR (status = 'held' AND hold_expires_at <= datetime('now')));  -- an expired hold is free again

-- The application now checks how many rows the UPDATE changed:
--   changed = 2 (all seats requested)  ->  COMMIT;  respond 201 Created
--   changed < 2 (someone else got one) ->  ROLLBACK; respond 409 Conflict
```

### Step 2: pay, then issue the tickets
The payment provider is called **outside** the database transaction, because a slow external call must never
keep seats locked. After the provider confirms the charge, one short transaction finalises everything:

```sql
-- Step 2 of buying: after the payment provider confirms the charge, finalise (ONE transaction)
BEGIN;

-- Create one ticket per seat in the hold, but only if the hold is still valid
INSERT INTO tickets (order_id, seat_id, ticket_code)
SELECT :order_id, id, lower(hex(randomblob(8)))                  -- PostgreSQL: gen_random_uuid()
FROM seats
WHERE hold_id = :hold_id
  AND status = 'held'
  AND hold_expires_at > datetime('now');

-- Mark those same seats as sold
UPDATE seats
SET status = 'sold', hold_id = NULL, hold_expires_at = NULL
WHERE hold_id = :hold_id
  AND status = 'held'
  AND hold_expires_at > datetime('now');

UPDATE orders SET status = 'paid', payment_ref = :payment_ref WHERE id = :order_id;
UPDATE holds  SET status = 'paid' WHERE id = :hold_id;

-- The application checks that the number of tickets created equals the number of seats in the order:
--   equal      -> COMMIT;   the tickets are issued
--   not equal  -> ROLLBACK; the hold had expired, so refund the payment
```

If the hold expired while the customer was paying, the transaction rolls back, the tickets are not issued and
the customer is **refunded automatically**. Because the seats are only marked `sold` when this transaction succeeds, a seat can never be sold twice.
Paying the same hold again is blocked by `UNIQUE (hold_id)` on `orders`.

### Other rules
- **The cache and the read replica are never used to decide anything.** The seat map may be a second or two old,
  so a user might click a seat that has just gone. That is acceptable, because the hold step above is the only thing that decides.
- A user may hold at most 4 seats, and hold requests are rate limited, so one person cannot hoard seats.

### Test results
I tested this SQL, and these results show how it behaves:
- 40 simultaneous hold attempts on the same seat: **exactly 1 succeeded**.
- A request for seats 2 and 3 when seat 2 was taken: nothing was held (all or nothing), and seat 3 stayed available.
- After a hold expired, another user could take the seats.
- Paying a valid hold created the tickets and marked the seats sold; paying it a second time was blocked; paying an expired hold issued no tickets.
- Inserting a second valid ticket for a sold seat was rejected by the unique index.

SQLite allows only one writer at a time, so this test proves the logic; in production, PostgreSQL's row locks give the same guarantee for transactions on different rows in parallel.

## 6. Architecture

```text
                      Users (web / mobile) - up to 200,000 at once on sale day
         |                   |                      |
         | name lookup       | pages, images, JS    | everything else
         v                   v                      v
   +-----------+      +-------------+ +---------------------------+
   |    DNS    |      |     CDN     | |     WAF + rate limiter    |
   +-----------+      +-------------+ |    WAITING ROOM (admits   |
                                      |   users at a safe pace)   |
                                      +---------------------------+
                                                    |
                                                    |
                                                    v
                                        +-----------------------+
                                        |     Load balancer     |
                                        +-----------------------+
                                                    |
                                +-------------------+-------------------+
                                v                   v                   v         charge / refund
                        +---------------+   +---------------+   +---------------+           +------------------+
                        |  App server 1 |   |  App server 2 |   |  App server N |<--------->| Payment provider |
                        |  (stateless)  |   |  (stateless)  |   | (auto-scaled) |           |    (external)    |
                        +---------------+   +---------------+   +---------------+           +------------------+
                                |                   |                   |
                                +-------------------+-------------------+
                                                    |
                    +-------------------------------+-----------------------------------+
                    v                               v                                   v
           +-----------------+          +-----------------------+             +-------------------+
           |  Cache (Redis)  |          |    PRIMARY database   |             |       Queue       |
           |seat-map snapshot|          | (seats, holds, orders)|             | (background jobs) |
           |   rate limits   |          | single source of truth|             +-------------------+
           +-----------------+          +-----------------------+                       |
                                                    |                                   |
                                                    | replication                       |
                                                    |                                   |
                                                    v                                   v
                                        +-----------------------+           +-----------------------+
                                        |      Read replica     |           |        Workers        |
                                        |  (browse, my tickets) |           |  (e-mail, QR tickets, |
                                        +-----------------------+           |  hold expiry sweeper) |
                                                                            +-----------------------+


```

### Components, one sentence each
- **DNS:** solves finding the site by turning `tickethub.example` into the address of the CDN and entry points.
- **CDN:** solves slow loading and server overload by serving the website's pages, images and scripts (and cached event details) from locations near users, so most requests never reach our servers.
- **WAF, rate limiter and waiting room:** solve the sale-day flood by blocking bots, limiting requests per user, and putting people in an orderly queue that lets them in at a pace the system can handle.
- **Load balancer:** solves a single server being overloaded by spreading requests across the app servers and skipping any that are unhealthy.
- **App servers:** solve running the business logic (browsing, holding, paying) at scale by being stateless copies that can be added quickly before a big sale.
- **Cache (Redis):** solves repeated reads and cheap rejection by keeping event details, a one-second-old seat-map snapshot, rate-limit counters and the list of already sold seats in fast memory.
- **Primary database:** solves correctness by being the single source of truth for seats, holds and orders, with transactions that make the double-booking rules hold.
- **Read replica:** solves read load on the primary by serving browsing queries and "my tickets" from a copy of the data.
- **Queue:** solves slow work blocking buyers by holding jobs (send e-mail, create QR ticket, release expired holds) until a worker is free.
- **Workers:** solve doing that slow work without slowing the purchase, by processing queue jobs separately.
- **Payment provider (external):** solves taking card payments safely, so our system never stores card details.

### How it survives the big sale
1. **The waiting room turns a spike into a steady flow.** Instead of 10,000 requests per second hitting the servers, the
   waiting room admits people at a controlled pace, so the app servers and database see a load they can handle (the target is roughly 1,000 hold attempts per second; this must be confirmed by load testing).
   Users see their place in the queue instead of errors.
2. **Most reads never reach the servers.** The event page, images and scripts come from the CDN, and the seat map comes
   from a cache that is refreshed every second, so thousands of people watching the seat map cost almost nothing.
3. **Rejecting is cheap.** Since 90% of people lose, the cache keeps a list of seats that are already held or sold, and
   most failing attempts are rejected there without touching the database. The database still has the final say.
4. **The database only does the work that needs strong consistency.** Seat holds and payments go to the primary in short
   transactions; browsing goes to the replica and cache. The payment call is made outside any database transaction.
5. **App servers scale out.** They are stateless, so extra servers are started ahead of announced sales (we know when tickets go on sale).
6. **Slow work is asynchronous.** Tickets are e-mailed by workers, so a slow e-mail service cannot slow down purchases.
7. **Failures are contained.** If the cache fails, requests fall back to the database (slower but correct); if the payment provider is slow, the hold
   simply waits until it expires; if workers fall behind, jobs wait in the queue.
8. **No single point of failure:** two or more app servers, a standby for the load balancer, a database standby that can be
   promoted, a replicated cache and queue, all in more than one availability zone.

Before a real sale, the whole system should be load tested with a simulated 200,000 users.

## 7. Trade-offs

1. **Strong consistency vs speed and scale.** Every seat decision goes to one primary database, which is
   slower and harder to scale than using a cache or replica, but it is the only way to be sure no seat is sold twice.
   We accept lower speed for the seat decision, and protect the primary with the waiting room and cache, rather than risk
   double-selling. The seat map itself is allowed to be slightly out of date.
2. **Fairness vs convenience (waiting room).** A waiting room keeps the site up and gives everyone an ordered turn, but users
   dislike waiting, and a queue is only fair if bots cannot cheat it. We choose to protect the site, and to admit people
   in the order they joined (people who joined before the sale starts are shuffled randomly, so being first to click is not a race).
3. **Hold length: fairness to buyers vs seats sitting idle.** A 10-minute hold gives people time to pay, but while
   seats are held nobody else can buy them, and malicious users could hoard seats. A shorter hold releases seats faster and
   keeps demand moving, but rushes honest buyers and causes more expired payments. We choose 10 minutes, with a limit of 4
   seats per order and rate limits.
4. **Cost vs availability.** Extra servers, replicas and a waiting room cost money, and are only really needed for a few
   events a year. We accept the cost for important sales by scaling up just before them and scaling down afterwards, instead of paying for peak capacity all year.
5. **Pay-after-hold vs reserve-after-pay.** Taking payment *after* holding the seats means customers are never charged
   for seats they do not get, but a hold can expire during payment, so we need refunds for that rare case. Charging first would be simpler, but would charge people for seats that are then unavailable.
