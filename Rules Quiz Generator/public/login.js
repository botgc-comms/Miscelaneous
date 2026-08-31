const params = new URLSearchParams(window.location.search);
const nextInput = document.getElementById("login-next");
const errorMessage = document.getElementById("login-error");
const username = document.getElementById("login-username");
const password = document.getElementById("login-password");
const toggle = document.getElementById("toggle-password");
const requestedPath = params.get("next");

if (requestedPath?.startsWith("/") && !requestedPath.startsWith("//")) {
  nextInput.value = requestedPath;
}

if (params.get("error") === "1") {
  errorMessage.hidden = false;
  username.setAttribute("aria-invalid", "true");
  password.setAttribute("aria-invalid", "true");
}

toggle.addEventListener("click", () => {
  const reveal = password.type === "password";
  password.type = reveal ? "text" : "password";
  toggle.textContent = reveal ? "Hide" : "Show";
  toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  password.focus();
});
