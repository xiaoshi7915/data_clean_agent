import { Routes, Route } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import Home from "./pages/Home";

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      <Toaster richColors position="top-center" />
    </>
  );
}

export default App;
