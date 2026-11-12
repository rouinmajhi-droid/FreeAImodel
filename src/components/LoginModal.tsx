import React, { useState } from 'react';
import { Zap, RefreshCw, AlertCircle, ArrowLeft } from 'lucide-react';
import { auth, googleProvider, githubProvider, microsoftProvider } from '../lib/firebase';
import { signInWithPopup } from 'firebase/auth';

interface LoginModalProps {
  onSuccess?: () => void;
  onBack?: () => void;
  isFullPage?: boolean;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess, onBack, isFullPage = false }) => {
  const [activeProvider, setActiveProvider] = useState<'google' | 'github' | 'microsoft' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSignIn = async (provider: any, name: 'google' | 'github' | 'microsoft') => {
    setActiveProvider(name);
    setErrorMsg(null);
    try {
      await signInWithPopup(auth, provider);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.warn(`${name} Sign-in exception:`, err);
      // Clean up common error messages
      if (err.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in cancelled by user.');
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        setErrorMsg('An account already exists with the same email address. Sign in with Google.');
      } else {
        setErrorMsg(err.message || `${name} sign-in failed. Please try again.`);
      }
    } finally {
      setActiveProvider(null);
    }
  };

  const content = (
    <div className="bg-white rounded-2xl border border-zinc-200/90 shadow-2xl max-w-md w-full p-8 sm:p-10 text-center animate-in fade-in zoom-in-95 duration-200 mx-auto relative">
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-5 left-5 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 font-medium cursor-pointer transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
      )}

      {/* FreeAIModel Brand Logo */}
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-purple-500 flex items-center justify-center text-white shadow-md shadow-violet-500/20 mx-auto mb-5">
        <Zap className="w-7 h-7 fill-white text-white" />
      </div>

      {/* Clean Minimalist Heading */}
      <h1 className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight">
        Welcome to FreeAIModel
      </h1>
      <p className="mt-2 text-xs sm:text-sm text-zinc-500 mb-7 max-w-xs mx-auto">
        Sign in to get your free API key, test all AI models, and access the developer gateway.
      </p>

      {errorMsg && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-800 text-xs text-left flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* 3 OAuth Sign-In Buttons */}
      <div className="space-y-3">
        {/* Google Sign-In */}
        <button
          onClick={() => handleSignIn(googleProvider, 'google')}
          disabled={activeProvider !== null}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-white font-medium text-sm shadow-sm transition-all cursor-pointer disabled:opacity-60"
        >
          {activeProvider === 'google' ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
              <span>Connecting Google...</span>
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
              <span>Continue with Google</span>
            </>
          )}
        </button>

        {/* GitHub Sign-In */}
        <button
          onClick={() => handleSignIn(githubProvider, 'github')}
          disabled={activeProvider !== null}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-zinc-50 active:scale-[0.99] text-zinc-800 font-medium text-sm border border-zinc-300 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
        >
          {activeProvider === 'github' ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-zinc-500" />
              <span>Connecting GitHub...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 shrink-0 fill-current text-zinc-900" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span>Continue with GitHub</span>
            </>
          )}
        </button>

        {/* Microsoft Sign-In */}
        <button
          onClick={() => handleSignIn(microsoftProvider, 'microsoft')}
          disabled={activeProvider !== null}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-zinc-50 active:scale-[0.99] text-zinc-800 font-medium text-sm border border-zinc-300 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
        >
          {activeProvider === 'microsoft' ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-zinc-500" />
              <span>Connecting Microsoft...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z"/>
                <path fill="#81bc06" d="M12 1h10v10H12z"/>
                <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                <path fill="#ffba08" d="M12 12h10v10H12z"/>
              </svg>
              <span>Continue with Microsoft</span>
            </>
          )}
        </button>
      </div>

      {/* Footer reassurance */}
      <div className="mt-7 pt-5 border-t border-zinc-100 text-center">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Free developer tier includes unlimited model discovery, test keys, and unified routing.
        </p>
      </div>
    </div>
  );

  if (isFullPage) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex flex-col justify-center items-center p-4 sm:p-6 antialiased">
        {content}
      </div>
    );
  }

  return content;
};
