import React from 'react';

interface ProviderLogoProps {
  provider: string;
  className?: string;
  size?: number;
}

export const ProviderLogo: React.FC<ProviderLogoProps> = ({
  provider,
  className = '',
  size = 18,
}) => {
  const norm = (provider || '').toLowerCase().trim();

  // OpenAI
  if (norm.includes('openai') || norm.startsWith('gpt') || norm.startsWith('o1') || norm.startsWith('o3')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={`text-emerald-600 shrink-0 ${className}`}
        aria-label="OpenAI"
      >
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3428 7.897a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1683a.0757.0757 0 0 1-.071 0l-4.8303-2.7866A4.504 4.504 0 0 1 2.3428 7.897zm16.5991 3.8558L13.1038 8.3843l2.0153-1.1635a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.402-.6853zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1635a.0804.0804 0 0 1-.038-.0567V6.0748a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.4598a.7948.7948 0 0 0-.3927.6813l-.0048 6.7219zm1.0835-2.2227l2.607-1.5046 2.6118 1.5046v3.0137l-2.6118 1.5046-2.607-1.5046z" />
      </svg>
    );
  }

  // Groq
  if (norm.includes('groq')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`text-amber-600 shrink-0 ${className}`}
        aria-label="Groq"
      >
        <rect width="24" height="24" rx="5" fill="#F55036" />
        <path
          d="M17.5 12.5C17.5 15.26 15.26 17.5 12.5 17.5C9.74 17.5 7.5 15.26 7.5 12.5C7.5 9.74 9.74 7.5 12.5 7.5C14.15 7.5 15.6 8.3 16.5 9.55L14.8 11.2C14.3 10.3 13.45 9.8 12.5 9.8C11 9.8 9.8 11 9.8 12.5C9.8 14 11 15.2 12.5 15.2C13.7 15.2 14.7 14.4 15.1 13.3H12.5V11.2H17.4C17.45 11.6 17.5 12.05 17.5 12.5Z"
          fill="white"
        />
      </svg>
    );
  }

  // Google Gemini
  if (norm.includes('gemini') || norm.includes('google')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 ${className}`}
        aria-label="Google Gemini"
      >
        <path
          d="M12 24C12 17.3726 6.62742 12 0 12C6.62742 12 12 6.62742 12 0C12 6.62742 17.3726 12 24 12C17.3726 12 12 17.3726 12 24Z"
          fill="url(#gemini-grad)"
        />
        <defs>
          <linearGradient id="gemini-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1BA1E3" />
            <stop offset="0.5" stopColor="#7C3AED" />
            <stop offset="1" stopColor="#D946EF" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  // Anthropic / Claude
  if (norm.includes('anthropic') || norm.includes('claude')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={`text-[#D97757] shrink-0 ${className}`}
        aria-label="Anthropic"
      >
        <path d="M14.2 3.5h3.4L24 20.5h-3.6l-1.9-4.8H11l-1.9 4.8H5.5L14.2 3.5zm2.4 9.4l-2.4-6.3-2.4 6.3h4.8zM0 20.5h3.8L8.6 8.2 4.8 8.2 0 20.5z" />
      </svg>
    );
  }

  // DeepSeek
  if (norm.includes('deepseek')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`text-sky-600 shrink-0 ${className}`}
        aria-label="DeepSeek"
      >
        <rect width="24" height="24" rx="5" fill="#0284C7" />
        <path
          d="M6 15C6 11.5 8.5 8 13.5 8C17 8 18.5 10 18.5 12C18.5 14.5 16 16.5 13.5 16.5C10 16.5 8.5 15 8.5 13.5"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="15.5" cy="11.5" r="1.5" fill="white" />
      </svg>
    );
  }

  // Mistral
  if (norm.includes('mistral') || norm.includes('codestral') || norm.includes('pixtral')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 ${className}`}
        aria-label="Mistral"
      >
        <rect width="24" height="24" rx="5" fill="#FA520F" />
        <path
          d="M6 6H9V18H6V6ZM15 6H18V18H15V6ZM10.5 9H13.5V15H10.5V9Z"
          fill="white"
        />
      </svg>
    );
  }

  // Meta / Llama
  if (norm.includes('llama') || norm.includes('meta')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={`text-blue-600 shrink-0 ${className}`}
        aria-label="Meta Llama"
      >
        <path d="M12 4.3C8.7 4.3 6.1 6.5 4.8 9.5 3.5 12.6 3.9 16 6 18.2c1.8 1.9 4.3 2.5 6 1.1 1.7 1.4 4.2.8 6-1.1 2.1-2.2 2.5-5.6 1.2-8.7-1.3-3-3.9-5.2-7.2-5.2zm-2.8 11.2c-1.4 0-2.6-1.3-2.6-3.4 0-2.3 1.3-4.3 2.9-4.3 1.5 0 2.6 1.7 2.6 3.8 0 2.2-1.2 3.9-2.9 3.9zm5.6 0c-1.7 0-2.9-1.7-2.9-3.9 0-2.1 1.1-3.8 2.6-3.8 1.6 0 2.9 2 2.9 4.3 0 2.1-1.2 3.4-2.6 3.4z" />
      </svg>
    );
  }

  // Cerebras
  if (norm.includes('cerebras')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 ${className}`}
        aria-label="Cerebras"
      >
        <rect width="24" height="24" rx="5" fill="#E11D48" />
        <polygon
          points="12,5 18,9 18,15 12,19 6,15 6,9"
          fill="none"
          stroke="white"
          strokeWidth="2"
        />
        <circle cx="12" cy="12" r="2.5" fill="white" />
      </svg>
    );
  }

  // OpenRouter
  if (norm.includes('openrouter')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 ${className}`}
        aria-label="OpenRouter"
      >
        <rect width="24" height="24" rx="5" fill="#6366F1" />
        <path
          d="M7 12H17M17 12L13 8M17 12L13 16"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // Default AI chip icon
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-zinc-600 shrink-0 ${className}`}
      aria-label={provider || 'AI'}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3" />
      <path d="M15 1v3" />
      <path d="M9 20v3" />
      <path d="M15 20v3" />
      <path d="M20 9h3" />
      <path d="M20 14h3" />
      <path d="M1 9h3" />
      <path d="M1 14h3" />
    </svg>
  );
};
