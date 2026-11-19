import { useState } from "react";
import { Shield, Lock, User, ArrowRight, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { login, type Auth } from "../api";

export default function Login({ onSuccess }: { onSuccess: (auth: Auth) => void }) {
  const [username, setUsername] = useState("candidate1");
  const [password, setPassword] = useState("candidate123");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const auth = await login(username.trim(), password);
      onSuccess(auth);
    } catch {
      setError("Sign-in failed. Check your username and password.");
    } finally {
      setLoading(false);
    }
  };

  const setDemoCredentials = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError("");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl shadow-blue-500/5 border border-slate-200 overflow-hidden relative">
        {/* Subtle top accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 w-full" />

        <div className="p-8 sm:p-10">
          {/* Logo & Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/30 mb-4 transition-transform hover:scale-105">
              <Shield className="w-7 h-7 stroke-[2.2]" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
              Exam<span className="text-blue-600">Shield</span>
            </h1>
            <p className="text-xs font-medium text-slate-500 mt-1 uppercase tracking-wider">
              Secure Assessment Platform
            </p>
          </div>

          {/* Quick Demo Switcher */}
          <div className="mb-6 bg-slate-50 border border-slate-200/80 rounded-xl p-1.5 flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setDemoCredentials("candidate1", "candidate123")}
              className={`flex-1 py-1.5 px-3 rounded-lg font-medium transition-all ${
                username.startsWith("candidate")
                  ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Candidate Login
            </button>
            <button
              type="button"
              onClick={() => setDemoCredentials("proctor1", "proctor123")}
              className={`flex-1 py-1.5 px-3 rounded-lg font-medium transition-all ${
                username.startsWith("proctor")
                  ? "bg-white text-blue-700 shadow-sm border border-slate-200/60"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Proctor Login
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username or Candidate ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  aria-label="Username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. candidate1 or proctor1"
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-70 text-white font-semibold rounded-xl text-sm shadow-md shadow-blue-600/25 transition-all flex items-center justify-center gap-2 group cursor-pointer"
            >
              {loading ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Security Banner Footer */}
          <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-500">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Browser Integrity & Activity Shield Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}

