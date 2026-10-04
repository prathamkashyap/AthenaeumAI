import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initTheme } from "./lib/theme";

// Apply the stored theme before the first render, on every route.
//
// This runs at module scope rather than inside an effect or a mounted component:
// `ThemeToggle` lives in `AppLayout`, so the public landing page and the auth
// screen never had a theme applied at all, and even the authenticated shell only
// got one after mount — which is a visible flash from the default. Running here
// means the first painted frame is already correct, with no inline duplicate of
// this logic in index.html to drift out of sync.
initTheme();

createRoot(document.getElementById("root")!).render(<App />);
