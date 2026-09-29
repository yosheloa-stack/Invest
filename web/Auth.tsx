import { lazy, Suspense, useState, type FormEvent } from "react";
import { api } from "./format";
import type { User } from "./types";
const Scene3D = lazy(() => import("./Scene3D"));
export default function Auth({
  allowSignup,
  onLogin,
}: {
  allowSignup: boolean;
  onLogin: (u: User) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(
          mode === "signup" ? { name, email, password } : { email, password },
        ),
      });
      onLogin(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <Suspense fallback={<div className="scene3d" />}>
        <Scene3D />
      </Suspense>
      <div className="auth-copy">
        <div className="mark big" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>Yosh Scanner</h1>
        <p>
          Sinais de compra e venda para opções de 5, 10 e 15 minutos, só de
          estratégias que venceram o teste em histórico real.
        </p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => setMode("login")}
          >
            Entrar
          </button>
          {allowSignup && (
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              onClick={() => setMode("signup")}
            >
              Criar conta
            </button>
          )}
        </div>
        {mode === "signup" && (
          <label>
            Nome
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              minLength={2}
            />
          </label>
        )}
        <label>
          E-mail
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={mode === "signup" ? 8 : 1}
          />
        </label>
        {mode === "signup" && <small>Pelo menos 8 caracteres.</small>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Aguarde…" : mode === "signup" ? "Criar conta" : "Entrar"}
        </button>
        <small className="auth-foot">
          Modo paper: o sistema avisa, você decide. Nenhuma ordem é enviada.
        </small>
      </form>
    </div>
  );
}
