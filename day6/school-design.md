# School Database Design

## Tables

### `students`
Stores one row per student: `student_id` (primary key), `name` and `email`.
Both `name` and `email` are `NOT NULL`, and `email` is `UNIQUE` so two students cannot
share the same address.

### `courses`
Stores one row per course: `course_id` (primary key), `title` and `credits`.
Both are `NOT NULL`, and a `CHECK` makes sure credits are greater than zero.

### `enrolments`
Stores one row per enrolment, meaning the fact that one student is taking one course:
`enrolment_id` (primary key), `student_id` and `course_id` (both foreign keys, both
`NOT NULL`) and `grade`. The grade can be `NULL` because a student has no grade until the
work is marked. A `UNIQUE (student_id, course_id)` rule stops the same student enrolling
on the same course twice.

## Relationships

- **students to enrolments is one-to-many.** One student can have many enrolments, but each
  enrolment belongs to exactly one student.
- **courses to enrolments is one-to-many.** One course can have many enrolments, but each
  enrolment belongs to exactly one course.
- **students to courses is many-to-many.** One student can take many courses, and one
  course has many students.

A many-to-many relationship needs a join table because a single column cannot hold
"many" values cleanly. Storing a list of course ids inside a student row would break
the rules of a relational table, make queries awkward and make it impossible to use a
foreign key. The `enrolments` table splits the relationship into two one-to-many links.
It is also the natural home for data that belongs to the *pair*, such as the grade,
because a grade is not a property of the student alone or the course alone.

## Index

I would add an index on `enrolments(course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);
```

The `UNIQUE (student_id, course_id)` rule already creates an index that helps when
searching by student, but it does not help when searching by course alone. Queries such as
"all students on one course" and "number of students per course" filter and join on
`course_id`, so without this index SQLite would have to scan the whole table as it grows.

## SQL or NoSQL?

I would choose SQL for this system. School data is structured and highly related: students,
courses and enrolments always have the same fields and link to each other, and the
questions we ask (who is on this course, who has no enrolments, how many per course) are
exactly what joins and `GROUP BY` do well. A relational database also enforces the rules
that matter here, such as unique emails, no duplicate enrolments and no enrolment for a
student that does not exist, so bad data is rejected instead of silently stored. NoSQL
databases suit very large or fast-changing data with flexible shapes, or workloads that
need to scale across many servers, but a school's data is small, stable and consistent, so
those benefits would not outweigh the loss of joins and built-in integrity.
