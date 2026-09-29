import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "./theme";
export default function ThemeToggle({
  className = "icon",
}: {
  className?: string;
}) {
  const dark = useTheme() === "dark";
  return (
    <button
      className={className}
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Usar tema branco" : "Usar tema preto"}
      title={dark ? "Tema branco" : "Tema preto"}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
