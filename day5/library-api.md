# Library API Design: Books Resource

A REST API for a library's collection of books. All requests and responses use JSON.
The resource is `books`, and each book has an `id` assigned by the server.

## Book object

```json
{
  "id": 7,
  "title": "Things Fall Apart",
  "author": "Chinua Achebe",
  "year": 1958,
  "isbn": "9780385474542",
  "available": true
}
```

## Endpoints

### 1. List all books
- **Method:** `GET`
- **Path:** `/books`
- **Description:** Returns every book in the library.
- **Request body:** none
- **Success status:** `200 OK`

### 2. Get one book
- **Method:** `GET`
- **Path:** `/books/{id}`
- **Description:** Returns the single book with the given id.
- **Request body:** none
- **Success status:** `200 OK`

### 3. Create a book
- **Method:** `POST`
- **Path:** `/books`
- **Description:** Adds a new book to the library; the server assigns the `id`.
- **Example request body:**
  ```json
  {
    "title": "Weep Not, Child",
    "author": "Ngugi wa Thiong'o",
    "year": 1964,
    "isbn": "9780435908300"
  }
  ```
- **Success status:** `201 Created` (the response body is the new book, including its `id`)

### 4. Update a book (replace)
- **Method:** `PUT`
- **Path:** `/books/{id}`
- **Description:** Replaces all the details of an existing book.
- **Example request body:**
  ```json
  {
    "title": "Things Fall Apart",
    "author": "Chinua Achebe",
    "year": 1958,
    "isbn": "9780385474542",
    "available": false
  }
  ```
- **Success status:** `200 OK`

### 5. Update part of a book
- **Method:** `PATCH`
- **Path:** `/books/{id}`
- **Description:** Changes only the fields that are sent, for example marking a book as borrowed.
- **Example request body:**
  ```json
  { "available": false }
  ```
- **Success status:** `200 OK`

### 6. Delete a book
- **Method:** `DELETE`
- **Path:** `/books/{id}`
- **Description:** Removes the book from the library.
- **Request body:** none
- **Success status:** `204 No Content` (no response body)

### 7. List books by an author
- **Method:** `GET`
- **Path:** `/books?author=Chinua%20Achebe`
- **Description:** Returns only the books whose author matches the `author` query parameter.
- **Request body:** none
- **Success status:** `200 OK` (an empty list `[]` if the author has no books)

## Error codes

### 400 Bad Request
The request is malformed or the data is invalid, so the server cannot process it.
- **Example:** `POST /books` with a body that has no `title`, or with `"year": "last year"`
  instead of a number.
- **Example response:**
  ```json
  { "error": "title is required" }
  ```

### 404 Not Found
The requested resource does not exist.
- **Example:** `GET /books/9999` when no book has the id 9999 (the same applies to
  `PUT`, `PATCH` and `DELETE` on a missing id).
- **Example response:**
  ```json
  { "error": "Book with id 9999 not found" }
  ```
