import { useState } from "react";
import type { Auth } from "./api";
import Login from "./pages/Login";
import Candidate from "./pages/Candidate";
import Proctor from "./pages/Proctor";

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const demo = params.get("demo");
      const token = params.get("token");
      if (demo === "candidate") return { access_token: token || "demo-token", role: "candidate", id: "candidate1", name: "Alice Candidate" };
      if (demo === "proctor") return { access_token: token || "demo-token", role: "proctor", id: "proctor1", name: "Pat Proctor" };
    } catch {}
    return null;
  });

  if (!auth) {
    return <Login onSuccess={(a) => setAuth(a)} />;
  }

  if (auth.role === "proctor") {
    return <Proctor auth={auth} onLogout={() => setAuth(null)} />;
  }

  return <Candidate auth={auth} onLogout={() => setAuth(null)} />;
}
