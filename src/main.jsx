import React from "react";
import ReactDOM from "react-dom/client";
import FiiScreenerSimulador from "./App.jsx";

// As variáveis VITE_* são lidas do arquivo .env (veja .env.example).
// A chave anon é pública por desenho; a segurança vem da política RLS no Supabase.
const supabase = {
  url: import.meta.env.VITE_SUPABASE_URL || "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FiiScreenerSimulador supabase={supabase} />
  </React.StrictMode>
);
