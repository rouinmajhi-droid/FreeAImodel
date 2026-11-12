import React, { useState } from 'react';
import { Zap, RefreshCw, AlertCircle } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup } from 'firebase/auth';

interface LoginModalProps {
  onSuccess?: () => void;
  onDevQuickLogin?: (email: string, name: string) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await signInWithPopup(auth, googleProvider);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.warn('Google Sign-in exception:', err);
      setErrorMsg(err.message || 'Google sign-in was blocked or dismissed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 shadow-2xl max-w-sm w-full p-8 text-center animate-in fade-in zoom-in-95 duration-200 mx-auto">
      {/* FreeAIModel Brand Logo */}
      <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-sm mx-auto mb-5">
        <Zap className="w-6 h-6 fill-white text-white" />
      </div>

      {/* Clean Minimalist Heading */}
      <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">
        Sign in to FreeAIModel
      </h1>
      <p className="mt-1.5 text-xs text-zinc-500 mb-6">
        Access your unified API gateway and model endpoints.
      </p>

      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs text-left flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Prominent Google Sign-In Button */}
      <button
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white font-medium text-sm shadow-sm transition-all cursor-pointer disabled:opacity-60"
      >
        {isLoading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
            <span>Signing in...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span className="font-medium">Sign in with Google</span>
          </>
        )}
      </button>

      <p className="mt-4 text-[11px] text-zinc-400">
        Free developer account • Instant API key allocation
      </p>
    </div>
  );
};
