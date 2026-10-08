// ===== Select elements =====
const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusMessage = document.getElementById("status");
const usersList = document.getElementById("users-list");

const API_URL = "https://jsonplaceholder.typicode.com/users";

// All users returned by the API. Filtering works on this array,
// so typing in the filter box never triggers a new request.
let allUsers = [];

// ===== Draw a list of users =====
function renderUsers(list) {
  usersList.textContent = "";

  if (list.length === 0 && allUsers.length > 0) {
    const message = document.createElement("li");
    message.textContent = "No users match your filter.";
    usersList.append(message);
    return;
  }

  list.forEach((user) => {
    const item = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("div");
    email.textContent = `Email: ${user.email}`;

    const city = document.createElement("div");
    city.textContent = `City: ${user.address.city}`;

    const company = document.createElement("div");
    company.textContent = `Company: ${user.company.name}`;

    item.append(name, email, city, company);
    usersList.append(item);
  });
}

// ===== Filter the stored users =====
function applyFilter() {
  const searchText = filterInput.value.trim().toLowerCase();
  const matches = allUsers.filter((user) =>
    user.name.toLowerCase().includes(searchText)
  );
  renderUsers(matches);
}

// ===== Fetch users from the API =====
async function loadUsers() {
  statusMessage.textContent = "Loading users...";
  loadButton.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    allUsers = await response.json();
    applyFilter();
    statusMessage.textContent = `Loaded ${allUsers.length} users.`;
  } catch (error) {
    statusMessage.textContent = `Error: could not load users. (${error.message})`;
  } finally {
    loadButton.disabled = false;
  }
}

// ===== Events =====
loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", applyFilter);
