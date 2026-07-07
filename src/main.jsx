import "./storage-shim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import LessonPlanArchitect from "./LessonPlanArchitect.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ minHeight: "100vh", padding: "24px", boxSizing: "border-box" }}>
      <LessonPlanArchitect />
    </div>
  </React.StrictMode>
);
