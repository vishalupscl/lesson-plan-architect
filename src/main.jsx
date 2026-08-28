import "./storage-shim.js";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import TeacherOnboarding from "./onboarding/TeacherOnboarding.jsx";
import LessonPlanArchitect from "./LessonPlanArchitect.jsx";

// The homepage is the teacher-facing onboarding. The full Lesson Plan
// Architect studio (taxonomy, intake, review queue, profiles) stays available
// for coordinators/admins at /#studio.
function isStudioRoute() {
  const h = window.location.hash;
  return h.startsWith("#studio") || h.startsWith("#admin");
}

function Root() {
  const [studio, setStudio] = useState(isStudioRoute());

  useEffect(() => {
    const onHash = () => setStudio(isStudioRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.body.style.background = studio ? "#0b0e1a" : "#f7f4ee";
    document.title = studio ? "Lesson Plan Architect — Studio" : "Teacher Profile";
  }, [studio]);

  if (studio) {
    return (
      <div style={{ minHeight: "100vh", padding: "24px", boxSizing: "border-box" }}>
        <LessonPlanArchitect />
      </div>
    );
  }
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
