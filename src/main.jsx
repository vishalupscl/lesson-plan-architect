import "./storage-shim.js";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import TeacherOnboarding from "./onboarding/TeacherOnboarding.jsx";
import AdminRecords from "./admin/AdminRecords.jsx";
import LessonPlanArchitect from "./LessonPlanArchitect.jsx";

// The homepage is the teacher-facing onboarding. The full Lesson Plan
// Architect studio stays at /#studio; the password-protected records
// database (all submitted profiles) lives at /#admin.
function routeFromHash() {
  const h = window.location.hash;
  if (h.startsWith("#studio")) return "studio";
  if (h.startsWith("#admin") || h.startsWith("#records")) return "admin";
  return "onboarding";
}

const ROUTE_META = {
  studio: { background: "#0b0e1a", title: "Lesson Plan Architect — Studio" },
  admin: { background: "#f7f4ee", title: "Teacher Records — Admin" },
  onboarding: { background: "#f7f4ee", title: "Teacher Profile" }
};

function Root() {
  const [route, setRoute] = useState(routeFromHash());

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.body.style.background = ROUTE_META[route].background;
    document.title = ROUTE_META[route].title;
  }, [route]);

  if (route === "studio") {
    return (
      <div style={{ minHeight: "100vh", padding: "24px", boxSizing: "border-box" }}>
        <LessonPlanArchitect />
      </div>
    );
  }
  if (route === "admin") return <AdminRecords />;
  return <TeacherOnboarding />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// Installability: register the service worker in production builds only, so
// dev never serves stale files.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
