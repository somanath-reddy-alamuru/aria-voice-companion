import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker so Aria installs as a real app (home-screen
// icon, its own window, works even with a flaky connection). Safe to skip
// silently if the browser doesn't support it or this isn't a secure context.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[Aria] service worker registration failed:", err);
    });
  });
}