# SnapShare Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from the
people they follow. This plan estimates the load and describes an architecture that can
handle it.

## 1. Assumptions

- 10,000,000 registered users.
- 10% of them are active each day.
- Each active user uploads **1 photo per day**.
- Each active user views **50 feed pages per day** (one feed page request = one feed view).
- An average photo is **2 MB**, and each photo also gets a **50 KB thumbnail**.
- One day has 86,400 seconds, and traffic is averaged evenly over the day.
- Peak traffic is **5×** the average.
- Units are decimal: 1 MB = 1,000 KB, 1 GB = 1,000 MB, 1 TB = 1,000 GB.
- A year has 365 days, and storage counts each photo once (copies kept for safety are
  ignored in the estimate).

**Daily active users (DAU):** 10,000,000 × 10% = **1,000,000 users per day**.

## 2. Estimates

### Uploads per second
- Uploads per day = 1,000,000 users × 1 photo = 1,000,000 photos.
- Average = 1,000,000 ÷ 86,400 ≈ **11.6 uploads/second** (about 12).
- Peak = 11.6 × 5 ≈ **58 uploads/second**.

### Feed views per second
- Feed views per day = 1,000,000 users × 50 = 50,000,000 views.
- Average = 50,000,000 ÷ 86,400 ≈ **579 views/second**.
- Peak = 579 × 5 ≈ **2,894 views/second** (about 2,900).

### Storage per year
- Photos per day: 1,000,000 × 2 MB = 2,000,000 MB = **2 TB/day**.
- Thumbnails per day: 1,000,000 × 50 KB = 50,000,000 KB = **50 GB/day**.
- Per year: photos 2 TB × 365 = **730 TB**, thumbnails 50 GB × 365 = **18.25 TB**.
- **Total ≈ 748 TB per year, about 0.75 PB**, or roughly 365 million new photos.

| Measure | Average | Peak (5×) |
|---|---|---|
| Uploads per second | ≈ 12 | ≈ 58 |
| Feed views per second | ≈ 579 | ≈ 2,894 |
| Storage per year | ≈ 748 TB | - |

## 3. Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are 50 feed views for every 1 upload (579 ÷ 11.6 = 50),
so reads outnumber writes by about 50 to 1.

What this means for the design:
- Make reads cheap: serve images from a **CDN**, keep popular data in a **cache**, and send
  feed queries to a **read replica** so they do not compete with writes.
- Writes are rare enough that a single primary database can handle them, and slow work
  such as thumbnail creation can be done in the background through a **queue**.
- Spend effort on caching and on spreading read traffic, not on making single writes faster.

## 4. Why photos do not belong in the database

At about 748 TB per year, storing photos inside the database would make it huge, slow and
very expensive. Every backup, restore and replica copy would have to move all those bytes,
and each photo download would tie up a database connection that is needed for real queries.
Databases are also built for small, structured rows, not large files, and photo files
cannot be served directly through a CDN from a table.

Photos should go into **object storage** (for example Amazon S3 or Google Cloud Storage),
which is cheap, almost unlimited in size, copies data for safety automatically and gives
every file a URL. The database keeps only the **metadata**: the photo id, owner, caption,
time, status and the object storage key (the file's address).

## 5. Architecture diagram

```text
                        Users (mobile app / web browser)
            |                                  |
            | photo + thumbnail downloads      | API requests (HTTPS)
            v                                  v
     +-------------+               +-----------------------+
     |     CDN     |               |     Load Balancer     |
     +-------------+               +-----------------------+
            |                                  |
            |                                  v
            | cache miss       +-------------------------------+
            |                  |       App servers (many)      |
            |                  |  stateless, identical copies  |
            |                  +-------------------------------+
            |                                  |
            |           +----------+-----------+-------+-----------------------+
            |           |          v                   v                       v
            |           |    +-----------+   +-------------------+   +-------------------+
            |           |    |   Cache   |   |  Database PRIMARY |   |       Queue       |
            |           |    |  (Redis)  |   |    (all writes)   |   |  (thumbnail jobs) |
            |           |    +-----------+   +-------------------+   +-------------------+
            |           |                              |                       |
            |           |                              | replication           |
            |           |                              v                       v
            |           |                    +-------------------+   +-------------------+
            |           |                    |    Read REPLICA   |   |       Worker      |
            |           |                    |    (feed reads)   |   | (makes thumbnails)|
            |           |                    +-------------------+   +-------------------+
            |           |                                                      |
            v           v                                                      |
    +-------------------------------------------------------+                  |
    |                     Object Storage                    |<-----------------+
    |         originals (2 MB) + thumbnails (50 KB)         |
    +-------------------------------------------------------+
```

How to read it:
- **Photo downloads** go to the CDN. On a cache miss the CDN fetches the file from Object Storage.
- **API requests** (upload, feed) go through the Load Balancer to any App server.
- App servers save originals to Object Storage, **write** to the Database PRIMARY, **read**
  the feed from the Cache first and then the Read REPLICA, and add thumbnail jobs to the Queue.
- The Database PRIMARY copies every change to the Read REPLICA (replication).
- The Worker takes jobs from the Queue, reads the original photo from Object Storage and
  saves the thumbnail back to it.

## 6. Components, one sentence each

- **CDN:** solves slow image loading for users far from our servers by keeping copies of
  photos and thumbnails at locations near them, which also takes most image traffic off our servers.
- **Load balancer:** solves the problem of one server being overloaded or failing by
  spreading requests across many app servers and skipping any that are down.
- **App servers:** solve the problem of running the app's logic (login, upload, feed) at
  scale by being identical, stateless copies that we can add more of as traffic grows.
- **Cache:** solves repeated, expensive database reads by keeping frequently requested
  data, such as recent feed pages, in fast memory.
- **Database (primary):** solves the need for one reliable, consistent place to store users,
  follows and photo metadata, and it handles all the writes.
- **Read replica:** solves read overload on the primary by holding a copy of its data that
  serves feed and profile reads.
- **Object storage:** solves the problem of storing hundreds of terabytes of photo files
  cheaply and safely, outside the database.
- **Queue:** solves the problem of slow background work blocking the user by holding jobs
  (such as "make a thumbnail") until a worker is free, even during upload spikes.
- **Worker:** solves thumbnail creation by picking up queued jobs and producing the 50 KB
  version, so the app servers stay free to answer users.

## 7. Upload flow, step by step

1. The user picks a photo and writes a caption; the app sends an upload request to SnapShare.
2. The **load balancer** passes the request to one of the **app servers**.
3. The app server checks the user is logged in and validates the file (type such as JPEG or
   PNG, and a maximum size).
4. The app server saves the original photo to **object storage** under a unique key.
5. The app server writes a new row to the **primary database** (user, caption, time, the
   object key and status "processing").
6. The app server adds a "create thumbnail" job (photo id and key) to the **queue**.
7. The app server immediately replies "upload successful" to the user, who does not wait
   for the thumbnail.
8. A **worker** takes the job from the queue, downloads the original from object storage and
   creates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage and updates the database row to status
   "ready" with the thumbnail key. If the worker fails, the job returns to the queue and is retried.
10. The affected cache entries (the uploader's profile and followers' feed pages) are
    cleared, so the next feed request loads the new photo.
11. When followers open their feed, the app server reads from the cache or the read replica,
    and their phones download the thumbnails through the **CDN**.

## 8. Trade-offs

1. **Fast reads vs fresh data (read replica and cache).** Replicas can lag a little behind
   the primary, and cached data can be stale, so a follower may not see a new photo for a
   few seconds. We accept this because feeds do not need to be perfectly up to date. To
   limit the problem, a user's own new photo can be read from the primary, and the cache
   entry can be cleared when a photo becomes ready. The cost is extra complexity in
   knowing when to clear (invalidate) the cache.
2. **Quick response vs instant thumbnails (queue).** Using a queue means the user gets a
   fast reply and spikes are absorbed, but the thumbnail appears seconds later, so the app
   needs a placeholder image for photos with status "processing". It also adds two more
   parts (queue and worker) to run and monitor.
3. **Simple uploads vs efficient uploads.** Sending photos through the app servers is the
   simplest design, but it means they handle about 23 MB/s on average (11.6 × 2 MB) and
   about 116 MB/s at peak. At larger scale, the app could instead give the phone a
   temporary upload link so that it sends the photo straight to object storage, which
   saves server bandwidth but adds more steps to the upload flow.
4. **Speed vs cost (CDN and storage).** A CDN makes the app faster and cheaper to run at
   scale, but we pay for it, and storing every photo forever means paying for roughly
   0.75 PB more each year. We could reduce the bill later by compressing old photos or
   moving rarely viewed ones to cheaper storage, at the cost of slower access to them.
