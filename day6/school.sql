-- School database: students, courses and enrolments (SQLite)

PRAGMA foreign_keys = ON;

-- Drop old tables so the script can be run again (child table first)
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ===== Tables =====
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
  course_id INTEGER PRIMARY KEY,
  title     TEXT NOT NULL,
  credits   INTEGER NOT NULL CHECK (credits > 0)
);

-- Join table: one row = one student enrolled on one course
CREATE TABLE enrolments (
  enrolment_id INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL,
  course_id    INTEGER NOT NULL,
  grade        INTEGER CHECK (grade BETWEEN 0 AND 100), -- NULL = not graded yet
  FOREIGN KEY (student_id) REFERENCES students (student_id),
  FOREIGN KEY (course_id)  REFERENCES courses (course_id),
  UNIQUE (student_id, course_id)  -- same student cannot join the same course twice
);

-- ===== Sample data =====
INSERT INTO students (student_id, name, email) VALUES
  (1, 'Amina Hassan', 'amina.hassan@example.com'),
  (2, 'Brian Otieno', 'brian.otieno@example.com'),
  (3, 'Grace Wanjiru', 'grace.wanjiru@example.com'),
  (4, 'David Kamau', 'david.kamau@example.com');

INSERT INTO courses (course_id, title, credits) VALUES
  (1, 'Web Development', 4),
  (2, 'Databases', 3),
  (3, 'Computer Networks', 3),
  (4, 'Software Testing', 2);

INSERT INTO enrolments (student_id, course_id, grade) VALUES
  (1, 1, 78),
  (1, 2, 85),
  (2, 1, 64),
  (2, 3, NULL),
  (3, 2, 91),
  (3, 1, 72);

-- ===== Queries =====

-- 1. All courses for one student (by name)
SELECT c.title, c.credits, e.grade
FROM students AS s
JOIN enrolments AS e ON e.student_id = s.student_id
JOIN courses AS c ON c.course_id = e.course_id
WHERE s.name = 'Amina Hassan';

-- 2. All students on one course
SELECT s.name, s.email, e.grade
FROM courses AS c
JOIN enrolments AS e ON e.course_id = c.course_id
JOIN students AS s ON s.student_id = e.student_id
WHERE c.title = 'Web Development';

-- 3. Number of students per course (LEFT JOIN keeps courses with 0 students)
SELECT c.title, COUNT(e.enrolment_id) AS student_count
FROM courses AS c
LEFT JOIN enrolments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title
ORDER BY student_count DESC, c.title;

-- 4. Students who have no enrolments
SELECT s.student_id, s.name
FROM students AS s
LEFT JOIN enrolments AS e ON e.student_id = s.student_id
WHERE e.enrolment_id IS NULL;

-- 5. Update one enrolment's grade (Brian Otieno, Computer Networks)
UPDATE enrolments
SET grade = 70
WHERE student_id = (SELECT student_id FROM students WHERE name = 'Brian Otieno')
  AND course_id  = (SELECT course_id FROM courses WHERE title = 'Computer Networks');

-- Check the update worked
SELECT s.name, c.title, e.grade
FROM enrolments AS e
JOIN students AS s ON s.student_id = e.student_id
JOIN courses AS c ON c.course_id = e.course_id
WHERE s.name = 'Brian Otieno';
