// ===== Starting data =====
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

// ===== Functions =====

// Returns an array of notes whose text contains `word`, ignoring case.
function searchNotes(word) {
  const lowerWord = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(lowerWord));
}

// Returns the note object with the most characters, or null if notes is empty.
function longestNote() {
  if (notes.length === 0) return null;
  return notes.reduce((longest, note) =>
    note.text.length > longest.text.length ? note : longest
  );
}

// Returns an object counting notes per category, e.g. { personal: 2, work: 1, study: 2 }.
function countByCategory() {
  const counts = {};
  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }
  return counts;
}

// Returns a sentence summarising how many notes exist per category.
function getSummary() {
  const total = notes.length;
  const noun = total === 1 ? "note" : "notes";

  if (total === 0) return `0 ${noun}.`;

  const counts = countByCategory();
  const order = ["personal", "work", "study"];
  const parts = order
    .filter((category) => counts[category] > 0)
    .map((category) => `${counts[category]} ${category}`);

  return `${total} ${noun}: ${parts.join(", ")}.`;
}

// Returns true if a note with the same text already exists, ignoring case
// and extra leading/trailing spaces.
function isDuplicate(text) {
  const normalized = text.trim().toLowerCase();
  return notes.some((note) => note.text.trim().toLowerCase() === normalized);
}

// Adds a note if the text is 1-200 characters, not a duplicate, and the
// category is one of personal, work or study. Returns true when added,
// false otherwise (and logs the reason it was rejected).
function addNote(text, category) {
  const validCategories = ["personal", "work", "study"];
  const trimmed = text.trim();

  if (trimmed.length < 1 || trimmed.length > 200) {
    console.log(
      `addNote rejected: text must be 1-200 characters (got ${trimmed.length}).`
    );
    return false;
  }

  if (!validCategories.includes(category)) {
    console.log(`addNote rejected: "${category}" is not a valid category.`);
    return false;
  }

  if (isDuplicate(trimmed)) {
    console.log(`addNote rejected: a note with this text already exists.`);
    return false;
  }

  const nextId = notes.reduce((max, note) => Math.max(max, note.id), 0) + 1;
  notes.push({ id: nextId, text: trimmed, category });
  return true;
}

// Runs `testFn` against a temporary notes array, then restores the
// original array. Used below to test empty/edge-case scenarios without
// permanently losing the starting data.
function withTempNotes(tempNotes, testFn) {
  const original = notes;
  notes = tempNotes;
  testFn();
  notes = original;
}

// ===== Tests =====

// --- searchNotes ---
console.log(searchNotes("day"));
// expect: [{ id: 2, text: "Finish the Day 3 assignment", category: "study" }]
// ("day" matches "Day" in the text, case-insensitive)

console.log(searchNotes("xyz"));
// expect: [] (no note contains "xyz")

// --- longestNote ---
console.log(longestNote());
// expect: { id: 3, text: "Email the project report to Grace", category: "work" }
// (34 characters, the longest note)

withTempNotes([], () => {
  console.log(longestNote());
  // expect: null (no notes)
});

// --- countByCategory ---
console.log(countByCategory());
// expect: { personal: 2, study: 2, work: 1 }

withTempNotes([], () => {
  console.log(countByCategory());
  // expect: {} (no notes)
});

// --- getSummary ---
console.log(getSummary());
// expect: "5 notes: 2 personal, 1 work, 2 study."

withTempNotes(
  [{ id: 99, text: "A single test note", category: "personal" }],
  () => {
    console.log(getSummary());
    // expect: "1 note: 1 personal." (singular "note")
  }
);

// --- isDuplicate ---
console.log(isDuplicate("buy milk and bread"));
// expect: true (matches note id 1, ignoring case)

console.log(isDuplicate("  Buy MILK and Bread  "));
// expect: true (matches note id 1, ignoring case and extra spaces)

console.log(isDuplicate("Go to the gym"));
// expect: false (no existing note matches)

// --- addNote ---
console.log(addNote("Pack gym bag", "personal"));
// expect: true (valid text, valid category, not a duplicate)

console.log(addNote("buy milk and bread", "personal"));
// expect: false, with a logged reason:
// "addNote rejected: a note with this text already exists."

console.log(addNote("Plan the team offsite", "fun"));
// expect: false, with a logged reason:
// 'addNote rejected: "fun" is not a valid category.'

console.log(addNote("", "personal"));
// expect: false, with a logged reason:
// "addNote rejected: text must be 1-200 characters (got 0)."

console.log(notes);
// expect: the original 5 notes plus the new "Pack gym bag" note (6 total)
